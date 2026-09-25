from __future__ import annotations

import argparse
import csv
import difflib
import hashlib
import json
import re
import sqlite3
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

PROJECT_ROOT = Path(r"F:\DND WEB VTT")
DB_PATH = PROJECT_ROOT / "data" / "compendium" / "rules_knowledge.sqlite"
OUTPUT_ROOT = PROJECT_ROOT / "_phase6_final_evidence_finalizer"

RARITIES = (
    "common","uncommon","rare","very rare","legendary","artifact",
    "rarity varies","varies",
)
ITEM_TYPE_WORDS = (
    "wondrous item","weapon","armor","potion","ring","rod","staff","wand",
    "scroll","ammunition","shield",
)
CONDITIONS = (
    "Blinded","Charmed","Deafened","Exhaustion","Frightened","Grappled",
    "Incapacitated","Invisible","Paralyzed","Petrified","Poisoned","Prone",
    "Restrained","Stunned","Unconscious",
)
DAMAGE_TYPES = (
    "Acid","Bludgeoning","Cold","Fire","Force","Lightning","Necrotic",
    "Piercing","Poison","Psychic","Radiant","Slashing","Thunder",
)

ITEM_DESCRIPTOR_RE = re.compile(
    r"(?i)\b("
    r"wondrous\s+item(?:\s*\([^)]+\))?|"
    r"weapon(?:\s*\([^)]+\))?|"
    r"armor(?:\s*\([^)]+\))?|"
    r"potion|ring|rod|staff|wand|scroll|ammunition|shield"
    r")\s*,?\s*"
    r"(common|uncommon|rare|very\s+rare|legendary|artifact|rarity\s+varies|varies)"
)

GENERIC_DESCRIPTOR_RE = re.compile(
    r"(?i)^\s*(?:"
    r"wondrous\s+item|weapon(?:\s*\([^)]+\))?|armor(?:\s*\([^)]+\))?|"
    r"potion|ring|rod|staff|wand|scroll|ammunition|shield"
    r")\b"
)

NOISE_RE = re.compile(
    r"(?i)\b("
    r"chapter|treasure|actions?|legendary actions|mythic actions|reactions|"
    r"challenge|proficiency bonus|languages?|habitat|skills?|"
    r"starting equipment|crafting magic|buying and selling|rarity$|property$|"
    r"npc stat blocks?|table\b|funds|deities|adventures|supplies|"
    r"plane of|art objects|hoard linking items|magic item base prices|"
    r"magic item crafting time and cost|sample poisons?|purchasing poison|"
    r"going mad|recuperating|modifiers to the roll|equipment sizes|"
    r"deities of|weapon names|dragons of myth|kenku names|"
    r"offensive and defensive uses|broodguards?|implements|"
    r"small or medium celestial|medium humanoid"
    r")\b"
)

STATIC_NAME_REPAIRS = {
    "absorbingtattoo": "Absorbing Tattoo",
    "coilinggrasptattoo": "Coiling Grasp Tattoo",
    "eldritchclawtattoo": "Eldritch Claw Tattoo",
    "guardianemblem": "Guardian Emblem",
    "illuminatorstattoo": "Illuminator's Tattoo",
    "lifewelltattoo": "Lifewell Tattoo",
    "masqueradetattoo": "Masquerade Tattoo",
    "shadowfellbrandtattoo": "Shadowfell Brand Tattoo",
    "staffofflowers": "Staff of Flowers",
    "beadofrefreshment": "Bead of Refreshment",
    "charlatansdie": "Charlatan's Die",
    "wandofconducting": "Wand of Conducting",
    "wandofthewarmage123": "Wand of the War Mage, +1, +2, or +3",
}

POISON_REPAIRS = {
    "assassinsbloop150gp": "Assassin's Blood",
    "burntornurfumes500gp": "Burnt Othur Fumes",
    "essenceofether300gp": "Essence of Ether",
    "loxtnsstine200gp": "Lolth's Sting",
    "malice250gp": "Malice",
    "mrpnicuttgars1500gp": "Midnight Tears",
    "onoftacerr400gp": "Oil of Taggit",
    "patetincture250gp": "Pale Tincture",
    "serpentvenom200gp": "Serpent Venom",
    "torpor600gp": "Torpor",
}

def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()

def clean(v: Any) -> str:
    return re.sub(r"\s+", " ", str(v or "")).strip()

def norm(v: str) -> str:
    return re.sub(r"[^a-z0-9]+", "", (v or "").casefold())

def ocr_norm(v: str) -> str:
    return norm(v).translate(str.maketrans({"0":"o","1":"i","5":"s","8":"b"}))

def slug(v: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", (v or "").casefold()).strip("-")

def similarity(a: str, b: str) -> float:
    aa, bb = ocr_norm(a), ocr_norm(b)
    if not aa or not bb:
        return 0.0
    if aa == bb:
        return 1.0
    return difflib.SequenceMatcher(None, aa, bb).ratio()

def sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()

def title_quality(name: str) -> bool:
    n = clean(name).strip("•*-–—|")
    if not 3 <= len(n) <= 92:
        return False
    if GENERIC_DESCRIPTOR_RE.match(n):
        return False
    if n.casefold() in RARITIES:
        return False
    if NOISE_RE.search(n):
        return False
    if len(n.split()) > 11:
        return False
    if re.search(r"(?i)\b(?:dc\s+\d+|\d+d(?:4|6|8|10|12|20|100))\b", n):
        return False
    if n.endswith((".", ";", ",")):
        return False
    letters = [c for c in n if c.isalpha()]
    if not letters:
        return False
    return True

def raw_page(db: sqlite3.Connection, revision_id: str, page: int) -> str:
    if not revision_id or page < 1:
        return ""
    row = db.execute(
        "SELECT text FROM raw_pages WHERE revision_id=? AND page_number=?",
        (revision_id, page),
    ).fetchone()
    return row["text"] if row and row["text"] else ""

def source_lines(
    db: sqlite3.Connection,
    revision_id: str,
    page_start: int | None = None,
    page_end: int | None = None,
) -> list[dict[str, Any]]:
    if page_start is None or page_end is None:
        bounds = db.execute(
            "SELECT MIN(page_number),MAX(page_number) FROM raw_pages WHERE revision_id=?",
            (revision_id,),
        ).fetchone()
        if not bounds or bounds[0] is None:
            return []
        page_start, page_end = int(bounds[0]), int(bounds[1])

    out: list[dict[str, Any]] = []
    for p in range(max(1, int(page_start)), int(page_end) + 1):
        text = raw_page(db, revision_id, p)
        for line_no, line in enumerate(text.splitlines(), start=1):
            c = clean(line)
            if c:
                out.append({"page": p, "line": line_no, "text": c})
    return out

def descriptor_from_text(text: str) -> tuple[str, str, bool] | None:
    c = clean(text)
    m = ITEM_DESCRIPTOR_RE.search(c)
    if m:
        return clean(m.group(1)).title(), clean(m.group(2)).title(), (
            "requires attunement" in c.casefold()
        )

    # OCR-tolerant common-item form such as "Sra ff common" / "Staff common".
    low = c.casefold()
    rarity = next((r for r in RARITIES if re.search(rf"\b{re.escape(r)}\b", low)), None)
    if rarity:
        prefix = low.split(rarity, 1)[0]
        compact = re.sub(r"[^a-z]", "", prefix)
        fuzzy_types = {
            "staff": ("staff", "sraff", "staf", "staiclr"),
            "wand": ("wand",),
            "ring": ("ring",),
            "potion": ("potion",),
            "armor": ("armor", "armour"),
            "weapon": ("weapon",),
            "wondrousitem": ("wondrousitem",),
        }
        for canonical, variants in fuzzy_types.items():
            if any(v in compact for v in variants):
                return canonical.title(), rarity.title(), (
                    "requires attunement" in low
                )
    return None

def next_descriptor(
    lines: list[dict[str, Any]],
    idx: int,
    max_ahead: int = 4,
) -> tuple[int, tuple[str, str, bool], str] | None:
    for j in range(idx + 1, min(len(lines), idx + 1 + max_ahead)):
        # Try one line and a two-line descriptor join.
        candidates = [lines[j]["text"]]
        if j + 1 < len(lines):
            candidates.append(lines[j]["text"] + " " + lines[j + 1]["text"])
        for text in candidates:
            desc = descriptor_from_text(text)
            if desc:
                return j, desc, text
    return None

def previous_title_candidates(lines: list[dict[str, Any]], idx: int) -> list[str]:
    result: list[str] = []
    pieces = []
    for back in range(1, 5):
        k = idx - back
        if k < 0:
            break
        text = lines[k]["text"]
        if GENERIC_DESCRIPTOR_RE.match(text) or ITEM_DESCRIPTOR_RE.search(text):
            break
        pieces.insert(0, text)
        # Candidate: only the closest N preceding lines.
        joined = clean(" ".join(pieces))
        if title_quality(joined):
            result.append(joined)
    return result

def line_candidates_for_name(lines: list[dict[str, Any]], name: str) -> list[tuple[float, int]]:
    target = ocr_norm(name)
    results = []
    for i, line in enumerate(lines):
        text = line["text"]
        if len(text) > 120:
            continue
        score = similarity(name, text)
        if target and target in ocr_norm(text):
            score = max(score, 0.96)
        if score >= 0.58:
            results.append((score, i))
    results.sort(reverse=True)
    return results[:12]

def best_named_match(
    name: str,
    rows: list[dict[str, str]],
    id_key: str,
    name_key: str,
) -> tuple[float, str, str] | None:
    best = None
    for row in rows:
        score = similarity(name, row[name_key])
        if best is None or score > best[0]:
            best = (score, row[id_key], row[name_key])
    return best

def detect_conditions(text: str) -> list[str]:
    return [
        c for c in CONDITIONS
        if re.search(rf"(?i)\b{re.escape(c)}(?: condition)?\b", text)
    ]

def detect_damage_types(text: str) -> list[str]:
    return [
        d for d in DAMAGE_TYPES
        if re.search(rf"(?i)\b{re.escape(d)} damage\b", text)
    ]

def detect_recharge(text: str) -> tuple[str | None, str | None]:
    low = text.casefold()
    kind = None
    if "at dawn" in low:
        kind = "DAWN"
    elif "finish a long rest" in low:
        kind = "LONG_REST"
    elif "finish a short rest" in low:
        kind = "SHORT_REST"
    elif "daily" in low or "each day" in low:
        kind = "DAILY_OTHER"
    formula = None
    m = re.search(
        r"(?i)\bregains?\s+(\d+d(?:4|6|8|10|12|20)(?:\s*[+-]\s*\d+)?)\s+expended charges?\b",
        text,
    )
    if m:
        formula = m.group(1).replace(" ", "")
    else:
        m = re.search(r"(?i)\bregains?\s+(\d+)\s+expended charges?\b", text)
        if m:
            formula = m.group(1)
    return kind, formula

def magic_profile(block: str, item_type: str, rarity: str, attune: bool) -> dict[str, Any]:
    charges = None
    m = re.search(r"(?i)\bhas\s+(\d+)\s+charges?\b", block)
    if m:
        charges = int(m.group(1))

    recharge_kind, recharge_formula = detect_recharge(block)

    save_dc = None
    m = re.search(r"(?i)\b(?:save\s+)?dc\s+(\d{1,2})\b", block)
    if m:
        save_dc = int(m.group(1))

    activation = []
    low = block.casefold()
    if "bonus action" in low:
        activation.append("Bonus Action")
    if "reaction" in low:
        activation.append("Reaction")
    if "magic action" in low:
        activation.append("Magic Action")
    elif re.search(r"(?i)\bas an action\b|\buse an action\b", block):
        activation.append("Action")

    return {
        "item_type": item_type,
        "rarity": rarity,
        "requires_attunement": attune,
        "max_charges": charges,
        "recharge_kind": recharge_kind,
        "recharge_formula": recharge_formula,
        "save_dc": save_dc,
        "activation_types": sorted(set(activation)),
        "condition_tags": detect_conditions(block),
        "damage_types": detect_damage_types(block),
    }

def poison_profile_from_block(block: str, poison_type: str) -> dict[str, Any] | None:
    m_save = re.search(
        r"(?i)\b(strength|dexterity|constitution|intelligence|wisdom|charisma)\s+saving throw\b",
        block,
    )
    m_dc = re.search(r"(?i)\bdc\s+(\d{1,2})\b", block)
    m_dice = re.search(r"(?i)\b(\d+d(?:4|6|8|10|12|20|100))\b", block)
    conditions = detect_conditions(block)
    damage_types = detect_damage_types(block)

    # Some poisons have delayed effects but still have a DC later in the block.
    if not m_save or not m_dc or (not m_dice and not conditions):
        return None

    duration = ""
    m_duration = re.search(
        r"(?i)\bfor\s+(\d+\s+(?:rounds?|minutes?|hours?|days?))\b",
        block,
    )
    if m_duration:
        duration = m_duration.group(1)

    return {
        "poison_type": poison_type.casefold(),
        "application_method": poison_type.casefold(),
        "save_ability": m_save.group(1).title(),
        "save_dc": int(m_dc.group(1)),
        "damage_dice": m_dice.group(1) if m_dice else "",
        "damage_types": damage_types,
        "conditions": conditions,
        "duration_text": duration,
        "onset_text": "",
    }

def canonical_title(raw_title: str) -> str:
    key = ocr_norm(raw_title)
    if key in STATIC_NAME_REPAIRS:
        return STATIC_NAME_REPAIRS[key]
    # Strip price suffix from poison/item table titles when present.
    return clean(re.sub(r"\s*\([^)]*\bGP\)\s*$", "", raw_title, flags=re.I))

def find_magic_block(
    db: sqlite3.Connection,
    revision_id: str,
    source_page: int,
    candidate_name: str,
) -> dict[str, Any] | None:
    # First search page +/-1, then the whole book for catalog-only references.
    local = source_lines(db, revision_id, max(1, source_page - 1), source_page + 1)
    searches = [local]
    whole = None

    for pass_no in range(2):
        lines = searches[0] if pass_no == 0 else whole
        if pass_no == 1:
            whole = source_lines(db, revision_id)
            lines = whole

        # Candidate itself as title.
        for score, idx in line_candidates_for_name(lines, candidate_name):
            if score < (0.70 if pass_no == 0 else 0.78):
                continue
            title = lines[idx]["text"]
            if title_quality(title):
                d = next_descriptor(lines, idx, 4)
                if d:
                    desc_idx, desc, desc_text = d
                    block = " ".join(
                        x["text"]
                        for x in lines[idx:min(len(lines), desc_idx + 35)]
                    )
                    return {
                        "title": canonical_title(title),
                        "raw_title": title,
                        "title_page": lines[idx]["page"],
                        "title_line": lines[idx]["line"],
                        "item_type": desc[0],
                        "rarity": desc[1],
                        "requires_attunement": desc[2],
                        "descriptor_text": desc_text,
                        "block": block,
                        "match_score": score,
                    }

        # Candidate itself may be the descriptor/table fragment. Locate it,
        # then recover a short title immediately before that descriptor.
        for score, idx in line_candidates_for_name(lines, candidate_name):
            if score < (0.78 if pass_no == 0 else 0.86):
                continue
            desc = descriptor_from_text(lines[idx]["text"])
            if not desc:
                # Try joined descriptor line.
                if idx + 1 < len(lines):
                    desc = descriptor_from_text(
                        lines[idx]["text"] + " " + lines[idx + 1]["text"]
                    )
            if not desc:
                continue

            candidates = previous_title_candidates(lines, idx)
            for title in reversed(candidates):
                if not title_quality(title):
                    continue
                title_idx = idx - 1
                # Find exact source line start for context.
                for k in range(max(0, idx - 4), idx):
                    if title.endswith(lines[k]["text"]):
                        title_idx = k
                        break
                block = " ".join(
                    x["text"] for x in lines[title_idx:min(len(lines), idx + 35)]
                )
                return {
                    "title": canonical_title(title),
                    "raw_title": title,
                    "title_page": lines[title_idx]["page"],
                    "title_line": lines[title_idx]["line"],
                    "item_type": desc[0],
                    "rarity": desc[1],
                    "requires_attunement": desc[2],
                    "descriptor_text": lines[idx]["text"],
                    "block": block,
                    "match_score": score,
                }

        # Raw entity text sometimes begins at descriptor while page context
        # contains the title. This is handled by the preceding-title search
        # above if the candidate row is a header.
        if pass_no == 0:
            whole = source_lines(db, revision_id)

    return None

def find_poison_block(
    db: sqlite3.Connection,
    revision_id: str,
    source_page: int,
    candidate_name: str,
) -> dict[str, Any] | None:
    lines = source_lines(db, revision_id, max(1, source_page - 1), source_page + 1)
    for score, idx in line_candidates_for_name(lines, candidate_name):
        if score < 0.70:
            continue
        title = lines[idx]["text"]
        if NOISE_RE.search(title) or "poison" == title.casefold():
            continue

        poison_type = None
        type_idx = None
        for j in range(idx + 1, min(len(lines), idx + 4)):
            m = re.search(r"(?i)\b(Contact|Ingested|Inhaled|Injury)\s+Poison\b", lines[j]["text"])
            if m:
                poison_type = m.group(1)
                type_idx = j
                break
        if not poison_type:
            continue

        block = " ".join(
            x["text"] for x in lines[idx:min(len(lines), type_idx + 24)]
        )
        profile = poison_profile_from_block(block, poison_type)
        if profile is None:
            continue

        repaired = POISON_REPAIRS.get(ocr_norm(candidate_name))
        if repaired:
            title = repaired
        else:
            # Prefer the canonical name used in the first mechanics sentence.
            m_name = re.search(
                r"(?i)(?:subjected to|ingests?)\s+([A-Z][A-Za-z’' -]{2,45}?)(?:\s+must|\s+makes|\s+suffers|\s+takes|\s+has)\b",
                block,
            )
            if m_name:
                title = clean(m_name.group(1))
            else:
                title = canonical_title(title)

        return {
            "title": title,
            "title_page": lines[idx]["page"],
            "title_line": lines[idx]["line"],
            "profile": profile,
            "block": block,
            "match_score": score,
        }
    return None

def ensure_schema(db: sqlite3.Connection) -> None:
    db.executescript("""
    CREATE TABLE IF NOT EXISTS phase6_final_batches(
      id TEXT PRIMARY KEY,
      created_at TEXT NOT NULL,
      source_db_sha256 TEXT NOT NULL,
      residual_before INTEGER NOT NULL,
      runtime_book_duplicates_removed INTEGER NOT NULL,
      residual_runtime_duplicates INTEGER NOT NULL,
      residual_book_duplicates INTEGER NOT NULL,
      magic_items_recovered INTEGER NOT NULL,
      poisons_recovered INTEGER NOT NULL,
      noise_or_reference_resolved INTEGER NOT NULL,
      residual_after INTEGER NOT NULL,
      final_book_magic_count INTEGER NOT NULL,
      final_book_poison_count INTEGER NOT NULL
    ) STRICT;

    CREATE TABLE IF NOT EXISTS phase6_final_resolution(
      entity_version_id TEXT NOT NULL REFERENCES entity_versions(id),
      resolution_scope TEXT NOT NULL,
      original_name TEXT NOT NULL,
      category TEXT NOT NULL,
      rules_version TEXT NOT NULL,
      source_title TEXT NOT NULL,
      source_page INTEGER,
      resolution_class TEXT NOT NULL,
      recovered_name TEXT,
      destination TEXT NOT NULL,
      matched_content_id TEXT,
      evidence_note TEXT NOT NULL,
      batch_id TEXT NOT NULL REFERENCES phase6_final_batches(id),
      PRIMARY KEY(entity_version_id,resolution_scope)
    ) STRICT;
    """)
    db.commit()

def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--apply", action="store_true")
    parser.add_argument("--output", default=str(OUTPUT_ROOT))
    args = parser.parse_args()

    output = Path(args.output)
    output.mkdir(parents=True, exist_ok=True)

    db_hash = sha256_file(DB_PATH)
    db = sqlite3.connect(DB_PATH)
    db.row_factory = sqlite3.Row
    db.execute("PRAGMA foreign_keys=ON")

    if db.execute("PRAGMA integrity_check").fetchone()[0] != "ok":
        raise RuntimeError("SQLite integrity check failed.")

    safe_state = {
        "runtime_magic": db.execute("SELECT COUNT(*) FROM magic_item_registry").fetchone()[0],
        "runtime_poison": db.execute("SELECT COUNT(*) FROM poison_registry").fetchone()[0],
        "book_magic": db.execute("SELECT COUNT(*) FROM book_magic_item_registry").fetchone()[0],
        "book_poison": db.execute("SELECT COUNT(*) FROM book_poison_registry").fetchone()[0],
        "book_resolutions": db.execute("SELECT COUNT(*) FROM phase6_book_review_resolution").fetchone()[0],
        "residual": db.execute("SELECT COUNT(*) FROM phase6_residual_review_queue").fetchone()[0],
        "old_queue": db.execute("SELECT COUNT(*) FROM phase6_content_review_queue").fetchone()[0],
    }
    expected = {
        "runtime_magic": 262,
        "runtime_poison": 14,
        "book_magic": 315,
        "book_poison": 0,
        "book_resolutions": 740,
        "residual": 235,
        "old_queue": 0,
    }
    if safe_state != expected:
        raise RuntimeError(f"Expected safe Phase 6 state {expected}, got {safe_state}")

    runtime_magic = [dict(r) for r in db.execute(
        "SELECT magic_item_id,item_name FROM magic_item_registry ORDER BY item_name"
    )]
    runtime_poison = [dict(r) for r in db.execute(
        "SELECT poison_id,poison_name FROM poison_registry ORDER BY poison_name"
    )]

    book_magic_rows = [dict(r) for r in db.execute("""
        SELECT r.*,ev.raw_text,s.current_revision_id,s.filename
        FROM book_magic_item_registry r
        JOIN entity_versions ev ON ev.id=r.entity_version_id
        JOIN sources s ON s.id=r.source_id
        ORDER BY r.source_title,r.source_page,r.item_name
    """)]

    # Identify only 2024 OCR duplicates against the authoritative runtime registry.
    book_runtime_dups = []
    clean_book_rows = []
    for row in book_magic_rows:
        best = best_named_match(row["item_name"], runtime_magic, "magic_item_id", "item_name")
        if row["rules_version"] == "2024" and best and best[0] >= 0.90:
            book_runtime_dups.append({
                "row": row,
                "matched_id": best[1],
                "matched_name": best[2],
                "score": best[0],
            })
        else:
            clean_book_rows.append(row)

    if len(book_runtime_dups) != 8:
        raise RuntimeError(
            f"Expected exactly 8 evidence-confirmed 2024 runtime duplicates, got {len(book_runtime_dups)}"
        )

    known_book = [
        {"book_magic_item_id": r["book_magic_item_id"], "item_name": r["item_name"],
         "source_title": r["source_title"], "rules_version": r["rules_version"]}
        for r in clean_book_rows
    ]

    residual_rows = db.execute("""
        SELECT q.*,ev.raw_text,ev.structured_json,ev.source_id,
               s.current_revision_id,s.filename
        FROM phase6_residual_review_queue q
        JOIN entity_versions ev ON ev.id=q.entity_version_id
        JOIN sources s ON s.id=ev.source_id
        ORDER BY q.source_title,q.source_page,q.name
    """).fetchall()

    runtime_dups = []
    book_dups = []
    recovered_magic = []
    recovered_poison = []
    noise = []

    # Explicit evidence-backed non-item sources/rows that should never become
    # Phase 6 runtime content without an actual item block.
    non_phase6_sources = {
        "Monster Manual",
        "Mordenkainen's Tome of Foes",
        "Player's Handbook",
        "Volo's Guide to Monsters",
    }

    for row in residual_rows:
        name = clean(row["name"])

        # Same-book exact/fuzzy duplicate first (catalog/index entries).
        same_source_book = [
            r for r in known_book
            if r["source_title"] == row["source_title"]
            and r["rules_version"] == row["rules_version"]
        ]
        best_book = best_named_match(
            name, same_source_book, "book_magic_item_id", "item_name"
        ) if same_source_book else None
        if row["category"] == "magic-item" and best_book and best_book[0] >= 0.90:
            book_dups.append({
                "row": row, "matched_id": best_book[1],
                "matched_name": best_book[2], "score": best_book[0],
            })
            continue

        # 2024 duplicates may map directly to the authoritative SRD registry.
        best_runtime = best_named_match(
            name, runtime_magic, "magic_item_id", "item_name"
        ) if row["category"] == "magic-item" else None
        if (
            row["category"] == "magic-item"
            and row["rules_version"] == "2024"
            and best_runtime
            and best_runtime[0] >= 0.90
        ):
            runtime_dups.append({
                "row": row, "matched_id": best_runtime[1],
                "matched_name": best_runtime[2], "score": best_runtime[0],
            })
            continue

        if row["category"] == "poison":
            # The 2014 DMG sample poison blocks are real independent poison
            # content; monster stat-block poison snippets are not.
            poison = find_poison_block(
                db, row["current_revision_id"], int(row["source_page"] or 1), name
            )
            if poison and row["source_title"] == "Dungeon Master's Guide":
                recovered_poison.append({
                    "row": row,
                    "title": poison["title"],
                    "page": poison["title_page"],
                    "profile": poison["profile"],
                    "block": poison["block"],
                })
                continue

            noise.append({
                "row": row,
                "resolution": "poison-reference-or-statblock-noise",
                "note": "No independent poison block with type + save + damage/condition evidence was found.",
            })
            continue

        # Magic items: search actual book source for title + descriptor.
        block = find_magic_block(
            db, row["current_revision_id"], int(row["source_page"] or 1), name
        )

        if block:
            recovered_title = block["title"]

            # Re-check duplicates using the recovered real title.
            same_source_book = [
                r for r in known_book
                if r["source_title"] == row["source_title"]
                and r["rules_version"] == row["rules_version"]
            ]
            best_book2 = best_named_match(
                recovered_title, same_source_book,
                "book_magic_item_id", "item_name"
            ) if same_source_book else None
            if best_book2 and best_book2[0] >= 0.88:
                book_dups.append({
                    "row": row, "matched_id": best_book2[1],
                    "matched_name": best_book2[2], "score": best_book2[0],
                    "recovered_name": recovered_title,
                })
                continue

            best_runtime2 = best_named_match(
                recovered_title, runtime_magic, "magic_item_id", "item_name"
            )
            if (
                row["rules_version"] == "2024"
                and best_runtime2
                and best_runtime2[0] >= 0.84
            ):
                runtime_dups.append({
                    "row": row, "matched_id": best_runtime2[1],
                    "matched_name": best_runtime2[2], "score": best_runtime2[0],
                    "recovered_name": recovered_title,
                })
                continue

            if title_quality(recovered_title):
                recovered_magic.append({
                    "row": row,
                    "title": recovered_title,
                    "page": block["title_page"],
                    "profile": magic_profile(
                        block["block"],
                        block["item_type"],
                        block["rarity"],
                        block["requires_attunement"],
                    ),
                    "block": block["block"],
                    "evidence": (
                        f"Title '{block['raw_title']}' + descriptor "
                        f"'{block['descriptor_text']}' in source context."
                    ),
                })
                # Add now so later catalog duplicates in same run can match it.
                provisional_id = (
                    f"book-magic-item.final.{row['rules_version']}."
                    f"{slug(row['source_title'])[:30]}.{slug(recovered_title)[:60]}."
                    f"{block['title_page']}"
                )
                known_book.append({
                    "book_magic_item_id": provisional_id,
                    "item_name": recovered_title,
                    "source_title": row["source_title"],
                    "rules_version": row["rules_version"],
                })
                continue

        # Evidence-insufficient candidates are preserved in source/entity data
        # but are not promoted into Phase 6 runtime registries.
        if row["source_title"] in non_phase6_sources or NOISE_RE.search(name):
            reason = "Book/rule/statblock/table reference; no independent magic-item block found."
        else:
            reason = (
                "No title + item-type/rarity descriptor block was found anywhere "
                "in the source book for this classifier candidate."
            )
        noise.append({
            "row": row,
            "resolution": "evidence-insufficient-searchable-provenance-only",
            "note": reason,
        })

    # Every one of the 235 residual rows must receive exactly one final disposition.
    total_disposed = (
        len(runtime_dups) + len(book_dups) + len(recovered_magic)
        + len(recovered_poison) + len(noise)
    )
    if total_disposed != 235:
        raise RuntimeError(
            f"Residual accounting mismatch: disposed {total_disposed} of 235"
        )

    # Prevent duplicate new promotions by normalized identity within source/version.
    seen_new = {}
    deduped_recovered_magic = []
    for item in recovered_magic:
        row = item["row"]
        key = (
            row["source_title"], row["rules_version"], ocr_norm(item["title"])
        )
        if key in seen_new:
            book_dups.append({
                "row": row,
                "matched_id": seen_new[key],
                "matched_name": item["title"],
                "score": 1.0,
                "recovered_name": item["title"],
            })
        else:
            item_id = (
                f"book-magic-item.final.{row['rules_version']}."
                f"{slug(row['source_title'])[:30]}.{slug(item['title'])[:60]}."
                f"{item['page']}"
            )
            item["final_id"] = item_id
            seen_new[key] = item_id
            deduped_recovered_magic.append(item)

    # If same-run dedupe moved records, accounting still stays 235.
    recovered_magic = deduped_recovered_magic

    batch_id = f"phase6-final-{datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ')}"

    if args.apply:
        ensure_schema(db)
        db.execute("BEGIN IMMEDIATE")
        try:
            db.execute("DELETE FROM phase6_final_resolution")

            # Remove only the 8 evidence-confirmed 2024 OCR duplicates.
            for item in book_runtime_dups:
                book_id = item["row"]["book_magic_item_id"]
                db.execute(
                    "DELETE FROM book_magic_item_engine_profiles WHERE book_magic_item_id=?",
                    (book_id,),
                )
                db.execute(
                    "DELETE FROM book_magic_item_registry WHERE book_magic_item_id=?",
                    (book_id,),
                )

            final_book_magic_target = 315 - len(book_runtime_dups) + len(recovered_magic)
            final_book_poison_target = len(recovered_poison)

            db.execute("""
                INSERT INTO phase6_final_batches(
                  id,created_at,source_db_sha256,residual_before,
                  runtime_book_duplicates_removed,residual_runtime_duplicates,
                  residual_book_duplicates,magic_items_recovered,poisons_recovered,
                  noise_or_reference_resolved,residual_after,
                  final_book_magic_count,final_book_poison_count
                ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)
            """, (
                batch_id,now_iso(),db_hash,235,len(book_runtime_dups),
                len(runtime_dups),len(book_dups),len(recovered_magic),
                len(recovered_poison),len(noise),0,
                final_book_magic_target,final_book_poison_target,
            ))

            # Final dispositions for the 8 removed book duplicates.
            for item in book_runtime_dups:
                row = item["row"]
                db.execute("""
                    INSERT INTO phase6_final_resolution(
                      entity_version_id,resolution_scope,original_name,category,
                      rules_version,source_title,source_page,resolution_class,
                      recovered_name,destination,matched_content_id,evidence_note,batch_id
                    ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)
                """, (
                    row["entity_version_id"],"book-registry-cleanup",
                    row["item_name"],"magic-item",row["rules_version"],
                    row["source_title"],row["source_page"],
                    "2024-runtime-duplicate-removed",item["matched_name"],
                    "magic_item_registry",item["matched_id"],
                    f"Evidence-confirmed OCR duplicate; fuzzy score {item['score']:.3f}.",
                    batch_id,
                ))

            # Recover new book magic items.
            for item in recovered_magic:
                row = item["row"]
                p = item["profile"]
                item_id = item["final_id"]
                original_batch = row["batch_id"]

                db.execute("""
                    INSERT INTO book_magic_item_registry(
                      book_magic_item_id,item_name,entity_version_id,rules_version,
                      source_id,source_title,source_page,validation_scope,batch_id,validated_at
                    ) VALUES(?,?,?,?,?,?,?,?,?,?)
                """, (
                    item_id,item["title"],row["entity_version_id"],row["rules_version"],
                    row["source_id"],row["source_title"],item["page"],
                    "final-evidence-title-descriptor-validated",
                    original_batch,now_iso(),
                ))
                db.execute("""
                    INSERT INTO book_magic_item_engine_profiles(
                      book_magic_item_id,item_type,rarity,requires_attunement,
                      max_charges,recharge_kind,recharge_formula,save_dc,
                      activation_types_json,condition_tags_json,damage_types_json
                    ) VALUES(?,?,?,?,?,?,?,?,?,?,?)
                """, (
                    item_id,p["item_type"],p["rarity"],int(p["requires_attunement"]),
                    p["max_charges"],p["recharge_kind"],p["recharge_formula"],p["save_dc"],
                    json.dumps(p["activation_types"],ensure_ascii=False),
                    json.dumps(p["condition_tags"],ensure_ascii=False),
                    json.dumps(p["damage_types"],ensure_ascii=False),
                ))
                db.execute("""
                    INSERT INTO phase6_final_resolution(
                      entity_version_id,resolution_scope,original_name,category,
                      rules_version,source_title,source_page,resolution_class,
                      recovered_name,destination,matched_content_id,evidence_note,batch_id
                    ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)
                """, (
                    row["entity_version_id"],"residual",row["name"],row["category"],
                    row["rules_version"],row["source_title"],row["source_page"],
                    "book-magic-item-recovered",item["title"],
                    "book_magic_item_registry",item_id,item["evidence"],batch_id,
                ))

            # Recover book poisons.
            for item in recovered_poison:
                row = item["row"]
                p = item["profile"]
                poison_id = (
                    f"book-poison.final.{row['rules_version']}."
                    f"{slug(row['source_title'])[:30]}.{slug(item['title'])[:60]}."
                    f"{item['page']}"
                )
                original_batch = row["batch_id"]
                db.execute("""
                    INSERT INTO book_poison_registry(
                      book_poison_id,poison_name,entity_version_id,rules_version,
                      source_id,source_title,source_page,validation_scope,batch_id,validated_at
                    ) VALUES(?,?,?,?,?,?,?,?,?,?)
                """, (
                    poison_id,item["title"],row["entity_version_id"],row["rules_version"],
                    row["source_id"],row["source_title"],item["page"],
                    "final-evidence-poison-mechanics-validated",
                    original_batch,now_iso(),
                ))
                db.execute("""
                    INSERT INTO book_poison_engine_profiles(
                      book_poison_id,poison_type,application_method,save_ability,
                      save_dc,damage_dice,damage_types_json,conditions_json,
                      duration_text,onset_text
                    ) VALUES(?,?,?,?,?,?,?,?,?,?)
                """, (
                    poison_id,p["poison_type"],p["application_method"],
                    p["save_ability"],p["save_dc"],p["damage_dice"],
                    json.dumps(p["damage_types"],ensure_ascii=False),
                    json.dumps(p["conditions"],ensure_ascii=False),
                    p["duration_text"],p["onset_text"],
                ))
                db.execute("""
                    INSERT INTO phase6_final_resolution(
                      entity_version_id,resolution_scope,original_name,category,
                      rules_version,source_title,source_page,resolution_class,
                      recovered_name,destination,matched_content_id,evidence_note,batch_id
                    ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)
                """, (
                    row["entity_version_id"],"residual",row["name"],row["category"],
                    row["rules_version"],row["source_title"],row["source_page"],
                    "book-poison-recovered",item["title"],
                    "book_poison_registry",poison_id,
                    "Independent poison block with poison type + saving throw + damage/condition evidence.",
                    batch_id,
                ))

            # Residual duplicate resolutions.
            for item, cls, dest in (
                *[(x,"runtime-duplicate","magic_item_registry") for x in runtime_dups],
                *[(x,"book-registry-duplicate","book_magic_item_registry") for x in book_dups],
            ):
                row = item["row"]
                db.execute("""
                    INSERT INTO phase6_final_resolution(
                      entity_version_id,resolution_scope,original_name,category,
                      rules_version,source_title,source_page,resolution_class,
                      recovered_name,destination,matched_content_id,evidence_note,batch_id
                    ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)
                """, (
                    row["entity_version_id"],"residual",row["name"],row["category"],
                    row["rules_version"],row["source_title"],row["source_page"],
                    cls,item.get("recovered_name") or item["matched_name"],
                    dest,item["matched_id"],
                    f"Evidence-backed normalized/fuzzy duplicate; score {item['score']:.3f}.",
                    batch_id,
                ))

            # Noise/reference resolutions.
            for item in noise:
                row = item["row"]
                db.execute("""
                    INSERT INTO phase6_final_resolution(
                      entity_version_id,resolution_scope,original_name,category,
                      rules_version,source_title,source_page,resolution_class,
                      recovered_name,destination,matched_content_id,evidence_note,batch_id
                    ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)
                """, (
                    row["entity_version_id"],"residual",row["name"],row["category"],
                    row["rules_version"],row["source_title"],row["source_page"],
                    item["resolution"],None,"searchable-provenance-only",None,
                    item["note"],batch_id,
                ))

            # Track later automation for newly recovered book content.
            phase6_batch = db.execute(
                "SELECT id FROM phase6_validation_batches ORDER BY created_at DESC LIMIT 1"
            ).fetchone()
            if not phase6_batch:
                raise RuntimeError("Missing Phase 6 validation batch.")
            automation_batch_id = phase6_batch["id"]

            for item in recovered_magic:
                db.execute("""
                    INSERT OR IGNORE INTO phase6_automation_backlog(
                      content_id,content_kind,capability_or_gap,status,notes,batch_id
                    ) VALUES(?,?,?,?,?,?)
                """, (
                    item["final_id"],"book-magic-item",
                    "capability:Book Magic Item Runtime","AUTOMATION_TODO",
                    "Structured book item validated; server-authoritative item-specific handler remains a later automation task.",
                    automation_batch_id,
                ))

            for item in recovered_poison:
                row = item["row"]
                poison_id = (
                    f"book-poison.final.{row['rules_version']}."
                    f"{slug(row['source_title'])[:30]}.{slug(item['title'])[:60]}."
                    f"{item['page']}"
                )
                db.execute("""
                    INSERT OR IGNORE INTO phase6_automation_backlog(
                      content_id,content_kind,capability_or_gap,status,notes,batch_id
                    ) VALUES(?,?,?,?,?,?)
                """, (
                    poison_id,"book-poison",
                    "capability:Book Poison Runtime","AUTOMATION_TODO",
                    "Structured poison validated; server-authoritative poison application handler remains a later automation task.",
                    automation_batch_id,
                ))

            # All residuals have an explicit final disposition.
            db.execute("DELETE FROM phase6_residual_review_queue")

            db.executescript("""
                DROP VIEW IF EXISTS effective_phase6_magic_items;
                CREATE VIEW effective_phase6_magic_items AS
                  SELECT
                    magic_item_id AS content_id,
                    item_name AS name,
                    rules_version,
                    source_title,
                    'runtime-srd' AS content_scope
                  FROM magic_item_registry
                  UNION ALL
                  SELECT
                    book_magic_item_id AS content_id,
                    item_name AS name,
                    rules_version,
                    source_title,
                    'validated-book' AS content_scope
                  FROM book_magic_item_registry;

                DROP VIEW IF EXISTS effective_phase6_poisons;
                CREATE VIEW effective_phase6_poisons AS
                  SELECT
                    poison_id AS content_id,
                    poison_name AS name,
                    rules_version,
                    source_title,
                    'runtime-srd' AS content_scope
                  FROM poison_registry
                  UNION ALL
                  SELECT
                    book_poison_id AS content_id,
                    poison_name AS name,
                    rules_version,
                    source_title,
                    'validated-book' AS content_scope
                  FROM book_poison_registry;
            """)

            db.commit()
        except Exception:
            db.rollback()
            raise

    # Post-state / reports.
    state = {
        "runtime_magic_items": db.execute("SELECT COUNT(*) FROM magic_item_registry").fetchone()[0],
        "runtime_poisons": db.execute("SELECT COUNT(*) FROM poison_registry").fetchone()[0],
        "book_magic_items": db.execute("SELECT COUNT(*) FROM book_magic_item_registry").fetchone()[0],
        "book_poisons": db.execute("SELECT COUNT(*) FROM book_poison_registry").fetchone()[0],
        "residual_queue": db.execute("SELECT COUNT(*) FROM phase6_residual_review_queue").fetchone()[0],
        "old_review_queue": db.execute("SELECT COUNT(*) FROM phase6_content_review_queue").fetchone()[0],
        "final_resolutions": db.execute("SELECT COUNT(*) FROM phase6_final_resolution").fetchone()[0],
        "automation_backlog": db.execute("SELECT COUNT(*) FROM phase6_automation_backlog").fetchone()[0],
        "effective_extracted": db.execute(
            "SELECT COUNT(*) FROM effective_validated_entities WHERE status='extracted'"
        ).fetchone()[0],
    }

    # Hard final quality checks.
    bad_book_names = 0
    for row in db.execute("SELECT item_name FROM book_magic_item_registry"):
        if not title_quality(row["item_name"]):
            bad_book_names += 1

    # No 2024 book row may remain a high-confidence duplicate of runtime SRD.
    runtime_rows_now = [dict(r) for r in db.execute(
        "SELECT magic_item_id,item_name FROM magic_item_registry"
    )]
    remaining_2024_overlap = 0
    for row in db.execute("""
        SELECT item_name FROM book_magic_item_registry WHERE rules_version='2024'
    """):
        best = best_named_match(
            row["item_name"], runtime_rows_now, "magic_item_id", "item_name"
        )
        if best and best[0] >= 0.90:
            remaining_2024_overlap += 1

    phase_status = (
        "STRUCTURED_VALIDATION_CLOSED_AUTOMATION_BACKLOG_TRACKED"
        if state["runtime_magic_items"] == 262
        and state["runtime_poisons"] == 14
        and state["residual_queue"] == 0
        and state["old_review_queue"] == 0
        and state["effective_extracted"] == 0
        and bad_book_names == 0
        and remaining_2024_overlap == 0
        else "NOT_CLOSED"
    )

    resolutions = [dict(r) for r in db.execute("""
        SELECT * FROM phase6_final_resolution
        ORDER BY resolution_scope,resolution_class,source_title,original_name
    """)]
    book_magic = [dict(r) for r in db.execute("""
        SELECT r.*,p.item_type,p.rarity,p.requires_attunement,p.max_charges,
               p.recharge_kind,p.recharge_formula,p.save_dc
        FROM book_magic_item_registry r
        JOIN book_magic_item_engine_profiles p USING(book_magic_item_id)
        ORDER BY r.rules_version,r.source_title,r.item_name
    """)]
    book_poisons = [dict(r) for r in db.execute("""
        SELECT r.*,p.poison_type,p.application_method,p.save_ability,p.save_dc,
               p.damage_dice,p.damage_types_json,p.conditions_json,p.duration_text
        FROM book_poison_registry r
        JOIN book_poison_engine_profiles p USING(book_poison_id)
        ORDER BY r.rules_version,r.source_title,r.poison_name
    """)]

    report = {
        "batchId": batch_id,
        "applied": args.apply,
        "safeStateBefore": safe_state,
        "runtimeBookDuplicatesRemoved": len(book_runtime_dups),
        "residualRuntimeDuplicates": len(runtime_dups),
        "residualBookDuplicates": len(book_dups),
        "magicItemsRecovered": len(recovered_magic),
        "poisonsRecovered": len(recovered_poison),
        "noiseOrReferenceResolved": len(noise),
        "postState": state,
        "badBookNames": bad_book_names,
        "remaining2024RuntimeOverlap": remaining_2024_overlap,
        "phaseStatus": phase_status,
    }

    (output / "phase6_final_report.json").write_text(
        json.dumps(report, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )

    def export(name: str, rows: list[dict[str, Any]]) -> None:
        (output / f"{name}.json").write_text(
            json.dumps(rows, ensure_ascii=False, indent=2) + "\n",
            encoding="utf-8",
        )
        fields = list(rows[0].keys()) if rows else ["empty"]
        with (output / f"{name}.csv").open(
            "w", encoding="utf-8-sig", newline=""
        ) as f:
            w = csv.DictWriter(f, fieldnames=fields)
            w.writeheader()
            if rows:
                w.writerows(rows)

    export("final_resolution", resolutions)
    export("final_book_magic_items", book_magic)
    export("final_book_poisons", book_poisons)

    summary = [
        "# Phase 6 — Final Evidence-Based Validation",
        "",
        f"- Runtime SRD magic items: **{state['runtime_magic_items']}**",
        f"- Runtime SRD poisons: **{state['runtime_poisons']}**",
        f"- Validated book magic items: **{state['book_magic_items']}**",
        f"- Validated book poisons: **{state['book_poisons']}**",
        f"- Residual queue: **{state['residual_queue']}**",
        f"- Old review queue: **{state['old_review_queue']}**",
        f"- Bad book titles: **{bad_book_names}**",
        f"- Remaining 2024 runtime overlaps: **{remaining_2024_overlap}**",
        f"- Automation backlog entries: **{state['automation_backlog']}**",
        "",
        f"Status: **{phase_status}**",
    ]
    (output / "PHASE6_FINAL_SUMMARY.md").write_text(
        "\n".join(summary) + "\n",
        encoding="utf-8",
        newline="\n",
    )

    db.close()

    print("PHASE 6 FINAL EVIDENCE-BASED VALIDATION COMPLETE")
    print(f"APPLIED={args.apply}")
    print(f"RUNTIME_BOOK_DUPLICATES_REMOVED={len(book_runtime_dups)}")
    print(f"RESIDUAL_RUNTIME_DUPLICATES={len(runtime_dups)}")
    print(f"RESIDUAL_BOOK_DUPLICATES={len(book_dups)}")
    print(f"MAGIC_ITEMS_RECOVERED={len(recovered_magic)}")
    print(f"POISONS_RECOVERED={len(recovered_poison)}")
    print(f"NOISE_REFERENCE_RESOLVED={len(noise)}")
    print(f"BOOK_MAGIC_ITEMS_FINAL={state['book_magic_items']}")
    print(f"BOOK_POISONS_FINAL={state['book_poisons']}")
    print(f"RESIDUAL_QUEUE={state['residual_queue']}")
    print(f"BAD_BOOK_NAMES={bad_book_names}")
    print(f"REMAINING_2024_RUNTIME_OVERLAP={remaining_2024_overlap}")
    print(f"AUTOMATION_BACKLOG={state['automation_backlog']}")
    print(f"PHASE_STATUS={phase_status}")
    print(f"OUTPUT={output}")

    if phase_status != "STRUCTURED_VALIDATION_CLOSED_AUTOMATION_BACKLOG_TRACKED":
        raise RuntimeError("Phase 6 did not satisfy final closure criteria.")

    return 0

if __name__ == "__main__":
    raise SystemExit(main())
