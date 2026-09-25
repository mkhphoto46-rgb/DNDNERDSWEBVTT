from __future__ import annotations

import argparse
import csv
import hashlib
import json
import re
import sqlite3
from collections import Counter, defaultdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

PROJECT_ROOT = Path(r"F:\DND WEB VTT")
DB_PATH = PROJECT_ROOT / "data" / "compendium" / "rules_knowledge.sqlite"
OUTPUT_ROOT = PROJECT_ROOT / "_phase4_book_spell_recovery"

SCHOOLS = (
    "Abjuration","Conjuration","Divination","Enchantment",
    "Evocation","Illusion","Necromancy","Transmutation",
)
ABILITY_NAMES = {
    "strength": "Strength","dexterity": "Dexterity","constitution": "Constitution",
    "intelligence": "Intelligence","wisdom": "Wisdom","charisma": "Charisma",
}
DAMAGE_TYPES = (
    "Acid","Bludgeoning","Cold","Fire","Force","Lightning","Necrotic",
    "Piercing","Poison","Psychic","Radiant","Slashing","Thunder",
)
DICE_RE = re.compile(
    r"(?<![A-Za-z0-9])(\d+d(?:4|6|8|10|12|20|100)(?:\s*[+-]\s*\d+)?)", re.I
)

def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()

def clean(value: str) -> str:
    return re.sub(r"\s+", " ", value or "").strip()

def norm(value: str) -> str:
    return re.sub(r"[^a-z0-9]+", "", (value or "").casefold())

def slug(value: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", (value or "").casefold()).strip("-")

def sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()

def parse_json(value: str | None) -> dict[str, Any]:
    try:
        obj = json.loads(value or "{}")
        return obj if isinstance(obj, dict) else {}
    except Exception:
        return {}

def label_compact(value: str) -> str:
    return re.sub(r"[^a-z]", "", value.casefold())

def line_has_label(line: str, label: str) -> bool:
    compact = label_compact(line)
    target = label_compact(label)
    return target in compact[: max(len(target) + 10, 28)]

def parse_level_school(line: str) -> tuple[int | None, str]:
    text = clean(line)
    low = text.casefold()
    school = ""
    for candidate in SCHOOLS:
        if candidate.casefold() in low:
            school = candidate
            break
    if "cantrip" in low:
        return 0, school
    for pattern in (
        r"(?i)\blevel\s*([1-9])\b",
        r"(?i)\b([1-9])(?:st|nd|rd|th)[- ]level\b",
        r"(?i)\b([1-9])[- ]level\b",
    ):
        m = re.search(pattern, text)
        if m:
            return int(m.group(1)), school
    compact = re.sub(r"[^a-z0-9]", "", low)
    m = re.search(r"level([1-9])", compact)
    if m:
        return int(m.group(1)), school
    return None, school

def valid_spell_name(value: str) -> bool:
    name = clean(value)
    if not 2 <= len(name) <= 78:
        return False
    low = name.casefold()
    bad = (
        "casting time", "range", "components", "duration", "chapter ",
        "spell descriptions", "spell list", "appendix", "level ",
        "cantrip ", "table ", "saving throw",
    )
    if any(token in low for token in bad):
        return False
    letters = sum(ch.isalpha() for ch in name)
    return letters >= max(2, int(len(name) * 0.55))

def normalize_heading_text(value: str) -> str:
    value = clean(value).strip("•*·|")
    value = value.replace("’", "'").replace("‘", "'").replace("“", '"').replace("”", '"')
    tokens = value.split()
    if (
        2 <= len(tokens) <= 8
        and all(re.fullmatch(r"[A-Za-z'’-]+", t) for t in tokens)
        and any(len(t) == 1 for t in tokens)
        and sum(len(t) for t in tokens) <= 45
    ):
        joined = "".join(tokens)
        if valid_spell_name(joined):
            return joined
    return value

def find_save_ability(text: str) -> str | None:
    hits: list[str] = []
    for key, label in ABILITY_NAMES.items():
        patterns = (
            rf"(?i)\bmust make (?:a|an)\s+{key}\s+saving throw\b",
            rf"(?i)\bmakes? (?:a|an)\s+{key}\s+saving throw\b",
            rf"(?i)\bsucceed on (?:a|an)\s+{key}\s+saving throw\b",
            rf"(?i)\bfail(?:s|ed)? (?:a|an)\s+{key}\s+saving throw\b",
        )
        if any(re.search(p, text) for p in patterns):
            hits.append(label)
    hits = sorted(set(hits))
    return hits[0] if len(hits) == 1 else None

def detect_attack_roll(text: str) -> bool:
    return bool(
        re.search(r"(?i)\bmake (?:a|an) (?:ranged |melee )?spell attack\b", text)
        or re.search(r"(?i)\bspell attack roll\b", text)
    )

def detect_damage_types(text: str) -> list[str]:
    return [d for d in DAMAGE_TYPES if re.search(rf"(?i)\b{re.escape(d)} damage\b", text)]

def detect_area(text: str) -> tuple[str | None, int | None]:
    for shape, pattern in (
        ("Sphere", r"(?i)\b(\d+)[- ]foot[- ]radius\s+sphere\b"),
        ("Cylinder", r"(?i)\b(\d+)[- ]foot[- ]radius[^.\n]{0,50}\bcylinder\b"),
        ("Cone", r"(?i)\b(\d+)[- ]foot\s+cone\b"),
        ("Cube", r"(?i)\b(\d+)[- ]foot\s+cube\b"),
        ("Line", r"(?i)\b(\d+)[- ]foot[- ]long[^.\n]{0,50}\bline\b"),
        ("Emanation", r"(?i)\b(\d+)[- ]foot\s+emanation\b"),
    ):
        m = re.search(pattern, text)
        if m:
            return shape, int(m.group(1))
    return None, None

def parse_components(value: str) -> list[str]:
    upper = value.upper()
    return [
        c for c in ("V","S","M")
        if re.search(rf"(?<![A-Z]){c}(?![A-Z])", upper)
    ]

def parse_spell_block(lines: list[str], casting_index: int, source_page: int) -> dict[str, Any] | None:
    nonempty_before = [
        (idx, clean(lines[idx]))
        for idx in range(max(0, casting_index - 7), casting_index)
        if clean(lines[idx])
    ]
    level_idx = None
    level = None
    school = ""
    for idx, line in reversed(nonempty_before):
        maybe_level, maybe_school = parse_level_school(line)
        if maybe_level is not None:
            level_idx = idx
            level = maybe_level
            school = maybe_school
            break
    if level_idx is None or level is None:
        return None

    heading_lines = [
        clean(lines[idx]) for idx in range(max(0, level_idx - 2), level_idx)
        if clean(lines[idx])
    ]
    if not heading_lines:
        return None

    name = normalize_heading_text(heading_lines[-1])
    if not valid_spell_name(name) and len(heading_lines) >= 2:
        name = normalize_heading_text(" ".join(heading_lines[-2:]))
    if not valid_spell_name(name):
        return None

    metadata: dict[str, str] = {}
    for idx in range(casting_index, min(len(lines), casting_index + 12)):
        line = clean(lines[idx])
        if not line:
            continue
        if line_has_label(line, "Casting Time") and "casting_time" not in metadata:
            metadata["casting_time"] = re.split(r"[:：]", line, maxsplit=1)[-1].strip()
        elif line_has_label(line, "Range") and "range" not in metadata:
            metadata["range"] = re.split(r"[:：]", line, maxsplit=1)[-1].strip()
        elif line_has_label(line, "Components") and "components" not in metadata:
            metadata["components"] = re.split(r"[:：]", line, maxsplit=1)[-1].strip()
        elif line_has_label(line, "Duration") and "duration" not in metadata:
            metadata["duration"] = re.split(r"[:：]", line, maxsplit=1)[-1].strip()

    if sum(k in metadata for k in ("casting_time","range","components","duration")) < 4:
        return None

    body = clean("\n".join(lines[level_idx:]))[:14000]
    concentration = "concentration" in metadata["duration"].casefold()
    ritual = "ritual" in " ".join(heading_lines + [lines[level_idx]]).casefold()

    return {
        "name": name,
        "level": level,
        "school": school,
        "casting_time": metadata["casting_time"],
        "range": metadata["range"],
        "components_text": metadata["components"],
        "components": parse_components(metadata["components"]),
        "duration": metadata["duration"],
        "concentration": concentration,
        "ritual": ritual,
        "source_page": source_page,
        "raw_block": body,
    }

def scan_text_for_spell_blocks(text: str, page_no: int) -> list[dict[str, Any]]:
    lines = text.splitlines()
    out = []
    seen = set()
    for idx, line in enumerate(lines):
        if not line_has_label(line, "Casting Time"):
            continue
        block = parse_spell_block(lines, idx, page_no)
        if block is None:
            continue
        key = (norm(block["name"]), block["level"])
        if key not in seen:
            seen.add(key)
            out.append(block)
    return out

def get_ocr_runtime() -> tuple[Any, Any, Any]:
    try:
        import pymupdf
        import numpy as np
        from rapidocr import RapidOCR
    except Exception as exc:
        raise RuntimeError("Targeted OCR dependencies are unavailable.") from exc
    return pymupdf, np, RapidOCR(params={"Global.log_level": "warning"})

def ocr_pdf_page(pdf_path: Path, page_no: int) -> str:
    pymupdf, np, engine = get_ocr_runtime()
    doc = pymupdf.open(str(pdf_path))
    try:
        if page_no < 1 or page_no > doc.page_count:
            return ""
        page = doc.load_page(page_no - 1)
        scale = max(1.0, 170.0 / 72.0)
        pix = page.get_pixmap(
            matrix=pymupdf.Matrix(scale, scale),
            colorspace=pymupdf.csRGB,
            alpha=False,
        )
        image = np.frombuffer(pix.samples, dtype=np.uint8).reshape(pix.height, pix.width, pix.n)
        if pix.n > 3:
            image = image[:, :, :3]
        result = engine(image)
        if result is None or result.txts is None:
            return ""
        return "\n".join(str(x) for x in result.txts if str(x).strip())
    finally:
        doc.close()

def get_action_resource(casting_time: str) -> str | None:
    low = casting_time.casefold()
    if "bonus action" in low:
        return "Bonus Action"
    if "reaction" in low:
        return "Reaction"
    if "action" in low:
        return "Action"
    if "minute" in low or "hour" in low:
        return "Extended"
    return None

def make_profile(
    name: str, level: int, school: str, casting_time: str, range_text: str,
    components: list[str], duration: str, concentration: bool, ritual: bool,
    raw_text: str, classes: list[str] | None = None,
) -> dict[str, Any]:
    classes = classes or []
    dice = sorted(set(m.group(1).replace(" ", "") for m in DICE_RE.finditer(raw_text)))
    damage_types = detect_damage_types(raw_text)
    healing = bool(
        re.search(r"(?i)\b(?:regains?|restore[sd]?)\b[^.\n]{0,60}\bhit points?\b", raw_text)
    )
    attack = detect_attack_roll(raw_text)
    save_ability = find_save_ability(raw_text)
    area_shape, area_size = detect_area(raw_text)
    direct_save = bool(
        re.search(
            r"(?i)\b(?:must make|makes? (?:a|an)|succeed on (?:a|an)|fails? (?:a|an))"
            r"[^.\n]{0,45}\bsaving throw\b", raw_text
        )
    )
    has_damage_or_healing = bool(damage_types or healing)
    scaling_evidence = bool(
        re.search(r"(?i)\blevels?\s+5\b|\blevel\s+5\b|\bcantrip upgrade\b", raw_text)
    )
    upcast_evidence = bool(
        re.search(r"(?i)\busing a higher[- ]level spell slot\b|\bat higher levels?\b", raw_text)
    )
    cantrip_scaling = bool(level == 0 and has_damage_or_healing and scaling_evidence)
    upcast = bool(level > 0 and upcast_evidence)
    save_half = bool(re.search(r"(?i)\bhalf as much damage\b|\bhalf damage\b", raw_text))
    save_none = bool(re.search(r"(?i)\b(?:takes?|take)\s+no damage\b", raw_text))
    target_selection = bool(
        re.search(
            r"(?i)\b(?:target|creature|object|point|space)s?\b[^.\n]{0,80}"
            r"\b(?:within range|you can see|of your choice)\b", raw_text
        ) or area_shape
    )

    gaps: list[str] = []
    if not casting_time:
        gaps.append("casting-time")
    if not range_text:
        gaps.append("range")
    if not duration:
        gaps.append("duration")
    if not school:
        gaps.append("school")
    if direct_save and not save_ability:
        gaps.append("save-ability")
    if re.search(r"(?i)\broll\b[^.\n]{0,60}\bdamage\b", raw_text) and not dice:
        gaps.append("dice-formula")
    if level == 0 and has_damage_or_healing and scaling_evidence and not cantrip_scaling:
        gaps.append("cantrip-scaling")
    if level > 0 and upcast_evidence and not upcast:
        gaps.append("upcast")

    return {
        "casting_time": casting_time,
        "action_resource": get_action_resource(casting_time),
        "range_text": range_text,
        "components": components,
        "duration": duration,
        "concentration": concentration,
        "ritual": ritual,
        "school": school,
        "classes": classes,
        "attack_roll": attack,
        "save_ability": save_ability,
        "dice": dice,
        "damage_types": damage_types,
        "healing": healing,
        "area_shape": area_shape,
        "area_size": area_size,
        "cantrip_scaling": cantrip_scaling,
        "upcast": upcast,
        "save_half": save_half,
        "save_none": save_none,
        "target_selection": target_selection,
        "completeness": max(0, 100 - 10 * len(gaps)),
        "gaps": gaps,
    }

def ensure_schema(db: sqlite3.Connection) -> None:
    db.executescript("""
    CREATE TABLE IF NOT EXISTS phase4_book_recovery_batches(
      id TEXT PRIMARY KEY,
      created_at TEXT NOT NULL,
      source_db_sha256 TEXT NOT NULL,
      discovered_block_count INTEGER NOT NULL,
      recovered_spell_count INTEGER NOT NULL,
      source_presence_count INTEGER NOT NULL,
      residual_review_count INTEGER NOT NULL
    ) STRICT;

    CREATE TABLE IF NOT EXISTS book_spell_registry(
      book_spell_id TEXT PRIMARY KEY,
      spell_name TEXT NOT NULL,
      normalized_name TEXT NOT NULL,
      spell_level INTEGER NOT NULL,
      category TEXT NOT NULL,
      rules_version TEXT NOT NULL,
      entity_version_id TEXT NOT NULL REFERENCES entity_versions(id),
      source_id TEXT NOT NULL REFERENCES sources(id),
      source_title TEXT NOT NULL,
      source_page INTEGER NOT NULL,
      source_priority INTEGER NOT NULL,
      validation_scope TEXT NOT NULL,
      batch_id TEXT NOT NULL REFERENCES phase4_book_recovery_batches(id),
      validated_at TEXT NOT NULL
    ) STRICT;

    CREATE INDEX IF NOT EXISTS idx_book_spell_registry_name
      ON book_spell_registry(normalized_name,rules_version);

    CREATE TABLE IF NOT EXISTS spell_source_presence(
      presence_id TEXT PRIMARY KEY,
      normalized_name TEXT NOT NULL,
      spell_name TEXT NOT NULL,
      spell_level INTEGER NOT NULL,
      rules_version TEXT NOT NULL,
      source_id TEXT NOT NULL REFERENCES sources(id),
      source_title TEXT NOT NULL,
      source_page INTEGER NOT NULL,
      matched_baseline_spell_id TEXT,
      batch_id TEXT NOT NULL REFERENCES phase4_book_recovery_batches(id)
    ) STRICT;

    CREATE TABLE IF NOT EXISTS phase4_residual_spell_review(
      entity_version_id TEXT PRIMARY KEY REFERENCES entity_versions(id),
      name TEXT NOT NULL,
      rules_version TEXT NOT NULL,
      source_id TEXT NOT NULL REFERENCES sources(id),
      source_title TEXT NOT NULL,
      source_page INTEGER,
      prior_quality TEXT NOT NULL,
      reason TEXT NOT NULL,
      batch_id TEXT NOT NULL REFERENCES phase4_book_recovery_batches(id)
    ) STRICT;

    DROP VIEW IF EXISTS effective_spell_catalog;
    CREATE VIEW effective_spell_catalog AS
      SELECT
        'baseline' AS registry_kind,
        r.spell_id AS registry_id,
        r.spell_name,
        lower(replace(replace(r.spell_name,' ',''),'-','')) AS normalized_name,
        r.spell_level,
        r.category,
        r.rules_version,
        r.entity_version_id,
        r.source_id,
        r.source_title,
        1000 AS source_priority
      FROM spell_registry r
      UNION ALL
      SELECT
        'book' AS registry_kind,
        b.book_spell_id AS registry_id,
        b.spell_name,
        b.normalized_name,
        b.spell_level,
        b.category,
        b.rules_version,
        b.entity_version_id,
        b.source_id,
        b.source_title,
        b.source_priority
      FROM book_spell_registry b;
    """)
    db.commit()

def create_book_entity(
    db: sqlite3.Connection, source: sqlite3.Row,
    block: dict[str, Any], profile: dict[str, Any],
) -> str:
    name = block["name"]
    rules_version = source["rules_version"]
    source_slug = slug(source["title"])[:60]
    key_slug = slug(name)[:80]
    canonical_id = f"entity-book-spell-{rules_version}-{source_slug}-{key_slug}"
    version_id = f"version-book-spell-{rules_version}-{source_slug}-{key_slug}-{block['source_page']}"
    canonical_key = f"spell:{key_slug}:{rules_version}:{source_slug}"

    db.execute("""
        INSERT INTO canonical_entities(id,canonical_key,category,name)
        VALUES(?,?,?,?)
        ON CONFLICT(id) DO NOTHING
    """, (
        canonical_id, canonical_key,
        "cantrip" if block["level"] == 0 else "spell", name,
    ))

    structured = {
        "name": name,"level": block["level"],"school": block["school"],
        "castingTime": block["casting_time"],"range": block["range"],
        "components": block["components"],"componentsText": block["components_text"],
        "duration": block["duration"],"concentration": block["concentration"],
        "ritual": block["ritual"],"rulesVersion": rules_version,
        "automationProfile": profile,"validationScope": "book-spell-block-structure",
    }
    content_sha = hashlib.sha256(
        (source["id"] + "|" + str(block["source_page"]) + "|" + name + "|" + block["raw_block"]).encode("utf-8")
    ).hexdigest()

    db.execute("""
        INSERT INTO entity_versions(
          id,canonical_id,source_id,revision_id,source_record_key,
          category,subcategory,name,summary,structured_json,raw_text,
          source_page_start,source_page_end,rules_version,source_priority,
          status,confidence,content_sha256,created_at
        ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
        ON CONFLICT(id) DO UPDATE SET
          structured_json=excluded.structured_json,
          raw_text=excluded.raw_text,
          status='validated',
          confidence=excluded.confidence,
          content_sha256=excluded.content_sha256
    """, (
        version_id,canonical_id,source["id"],source["current_revision_id"],
        f"phase4-book-spell:{source_slug}:{key_slug}:{block['source_page']}",
        "cantrip" if block["level"] == 0 else "spell",
        block["school"] or "",name,f"Validated {rules_version} spell block for {name}.",
        json.dumps(structured, ensure_ascii=False, separators=(",", ":")),
        block["raw_block"],block["source_page"],block["source_page"],rules_version,
        source["source_priority"],"validated",0.97,content_sha,now_iso(),
    ))
    return version_id

def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--apply", action="store_true")
    parser.add_argument("--output", default=str(OUTPUT_ROOT))
    args = parser.parse_args()
    output = Path(args.output)
    output.mkdir(parents=True, exist_ok=True)

    db_sha_before = sha256_file(DB_PATH)
    db = sqlite3.connect(DB_PATH)
    db.row_factory = sqlite3.Row
    db.execute("PRAGMA foreign_keys=ON")

    if db.execute("PRAGMA integrity_check").fetchone()[0] != "ok":
        raise RuntimeError("SQLite integrity check failed.")
    if db.execute("SELECT COUNT(*) FROM spell_registry").fetchone()[0] != 339:
        raise RuntimeError("Phase 4 structured baseline is missing.")
    if db.execute("SELECT COUNT(*) FROM spell_engine_profiles").fetchone()[0] != 339:
        raise RuntimeError("Phase 4 engine profiles are missing.")

    sources = db.execute("""
        SELECT id,title,filename,rules_version,source_kind,source_priority,current_revision_id
        FROM sources
        WHERE source_kind LIKE 'official-%' AND current_revision_id IS NOT NULL
        ORDER BY source_priority DESC,title
    """).fetchall()

    baseline = {
        norm(row["spell_name"]): dict(row)
        for row in db.execute("""
            SELECT spell_id,spell_name,spell_level,rules_version FROM spell_registry
        """)
    }

    queue_rows = db.execute("""
        SELECT * FROM book_spell_recovery_queue ORDER BY source_id,source_page
    """).fetchall()
    queue_pages: dict[str, set[int]] = defaultdict(set)
    queue_entities_by_source_page: dict[tuple[str,int], list[sqlite3.Row]] = defaultdict(list)
    for row in queue_rows:
        if row["source_page"] is not None:
            p = int(row["source_page"])
            queue_pages[row["source_id"]].add(p)
            queue_entities_by_source_page[(row["source_id"],p)].append(row)

    discovered: list[dict[str, Any]] = []
    page_scan_stats: list[dict[str, Any]] = []

    for source in sources:
        pages = db.execute("""
            SELECT page_number,text FROM raw_pages
            WHERE revision_id=? ORDER BY page_number
        """, (source["current_revision_id"],)).fetchall()
        page_map = {int(r["page_number"]): r["text"] or "" for r in pages}
        candidate_pages = list(queue_pages.get(source["id"], set()))
        for page_no, text in page_map.items():
            if "casting" in text.casefold() and "time" in text.casefold():
                candidate_pages.append(page_no)
        candidate_pages = sorted(set(candidate_pages))

        pdf_path = PROJECT_ROOT / "content-sources" / "books" / source["filename"]
        raw_blocks = 0
        ocr_pages = 0
        ocr_blocks = 0

        for page_no in candidate_pages:
            raw_text = page_map.get(page_no, "")
            blocks = scan_text_for_spell_blocks(raw_text, page_no)
            raw_blocks += len(blocks)

            if not blocks and (source["id"],page_no) in queue_entities_by_source_page and pdf_path.exists():
                ocr_text = ocr_pdf_page(pdf_path, page_no)
                if clean(ocr_text):
                    ocr_pages += 1
                    found = scan_text_for_spell_blocks(ocr_text, page_no)
                    ocr_blocks += len(found)
                    blocks = found

            for block in blocks:
                discovered.append({
                    **block,
                    "source_id": source["id"],
                    "source_title": source["title"],
                    "rules_version": source["rules_version"],
                    "source_priority": source["source_priority"],
                    "current_revision_id": source["current_revision_id"],
                })

        page_scan_stats.append({
            "source_title": source["title"],"rules_version": source["rules_version"],
            "candidate_pages": len(candidate_pages),"raw_blocks": raw_blocks,
            "ocr_pages": ocr_pages,"ocr_blocks": ocr_blocks,
        })

    unique: dict[tuple[str,str,str], dict[str, Any]] = {}
    for item in discovered:
        key = (item["source_id"], item["rules_version"], norm(item["name"]))
        old = unique.get(key)
        if old is None or item["source_page"] < old["source_page"]:
            unique[key] = item
    discovered = list(unique.values())

    source_by_id = {r["id"]: r for r in sources}
    book_only = []
    source_presence = []
    for block in discovered:
        base = baseline.get(norm(block["name"]))
        if block["rules_version"] == "2024" and base is not None:
            source_presence.append({"block": block, "baseline_spell_id": base["spell_id"]})
            continue
        profile = make_profile(
            block["name"],block["level"],block["school"],block["casting_time"],
            block["range"],block["components"],block["duration"],block["concentration"],
            block["ritual"],block["raw_block"],
        )
        book_only.append({"block": block, "profile": profile})

    batch_id = f"phase4-book-recovery-{datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ')}"

    if args.apply:
        ensure_schema(db)
        db.execute("BEGIN IMMEDIATE")
        try:
            db.execute("DELETE FROM book_spell_registry")
            db.execute("DELETE FROM spell_source_presence")
            db.execute("DELETE FROM phase4_residual_spell_review")

            db.execute("""
                INSERT INTO phase4_book_recovery_batches(
                  id,created_at,source_db_sha256,discovered_block_count,
                  recovered_spell_count,source_presence_count,residual_review_count
                ) VALUES(?,?,?,?,?,?,?)
            """, (batch_id,now_iso(),db_sha_before,len(discovered),len(book_only),len(source_presence),0))

            for item in book_only:
                block = item["block"]
                profile = item["profile"]
                source = source_by_id[block["source_id"]]
                version_id = create_book_entity(db, source, block, profile)
                book_spell_id = (
                    f"bookspell.{block['rules_version']}.{slug(block['source_title'])[:40]}."
                    f"{slug(block['name'])[:70]}"
                )
                db.execute("""
                    INSERT OR REPLACE INTO book_spell_registry(
                      book_spell_id,spell_name,normalized_name,spell_level,category,
                      rules_version,entity_version_id,source_id,source_title,source_page,
                      source_priority,validation_scope,batch_id,validated_at
                    ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)
                """, (
                    book_spell_id,block["name"],norm(block["name"]),block["level"],
                    "cantrip" if block["level"] == 0 else "spell",block["rules_version"],
                    version_id,block["source_id"],block["source_title"],block["source_page"],
                    block["source_priority"],"book-spell-block-structure",batch_id,now_iso(),
                ))

            for item in source_presence:
                block = item["block"]
                presence_id = (
                    f"presence.{block['rules_version']}.{slug(block['source_title'])[:40]}."
                    f"{slug(block['name'])[:70]}"
                )
                db.execute("""
                    INSERT OR REPLACE INTO spell_source_presence(
                      presence_id,normalized_name,spell_name,spell_level,rules_version,
                      source_id,source_title,source_page,matched_baseline_spell_id,batch_id
                    ) VALUES(?,?,?,?,?,?,?,?,?,?)
                """, (
                    presence_id,norm(block["name"]),block["name"],block["level"],
                    block["rules_version"],block["source_id"],block["source_title"],
                    block["source_page"],item["baseline_spell_id"],batch_id,
                ))

            matched_pairs = {(x["source_id"], x["source_page"]) for x in discovered}
            residual = []
            for row in queue_rows:
                pair = (row["source_id"], int(row["source_page"]) if row["source_page"] is not None else -1)
                if pair in matched_pairs:
                    continue
                residual.append(row)
                db.execute("""
                    INSERT OR REPLACE INTO phase4_residual_spell_review(
                      entity_version_id,name,rules_version,source_id,source_title,
                      source_page,prior_quality,reason,batch_id
                    ) VALUES(?,?,?,?,?,?,?,?,?)
                """, (
                    row["entity_version_id"],row["name"],row["rules_version"],row["source_id"],
                    row["source_title"],row["source_page"],row["quality"],
                    "No reliable structured spell block recovered from source page.",batch_id,
                ))

            db.execute("""
                UPDATE phase4_book_recovery_batches
                SET residual_review_count=? WHERE id=?
            """, (len(residual), batch_id))

            baseline_rows = db.execute("""
                SELECT r.spell_id,r.spell_name,r.spell_level,ev.raw_text,ev.structured_json
                FROM spell_registry r JOIN entity_versions ev ON ev.id=r.entity_version_id
            """).fetchall()

            for row in baseline_rows:
                s = parse_json(row["structured_json"])
                components = s.get("components")
                if not isinstance(components, list):
                    components = []
                classes = s.get("classes")
                if not isinstance(classes, list):
                    classes = []
                profile = make_profile(
                    row["spell_name"],int(row["spell_level"]),clean(str(s.get("school") or "")),
                    clean(str(s.get("castingTime") or s.get("casting_time") or "")),
                    clean(str(s.get("range") or "")),components,clean(str(s.get("duration") or "")),
                    bool(s.get("concentration", False)),bool(s.get("ritual", False)),
                    row["raw_text"] or "",classes,
                )
                db.execute("""
                    UPDATE spell_engine_profiles
                    SET action_resource=?,attack_roll=?,save_ability=?,dice_json=?,
                        damage_types_json=?,healing_detected=?,area_shape=?,area_size_feet=?,
                        cantrip_scaling_detected=?,upcast_detected=?,save_half_detected=?,
                        save_none_detected=?,target_selection_required=?,
                        automation_completeness=?,automation_gaps_json=?,
                        parser_version='phase4-v2'
                    WHERE spell_id=?
                """, (
                    profile["action_resource"],int(profile["attack_roll"]),profile["save_ability"],
                    json.dumps(profile["dice"],ensure_ascii=False),
                    json.dumps(profile["damage_types"],ensure_ascii=False),
                    int(profile["healing"]),profile["area_shape"],profile["area_size"],
                    int(profile["cantrip_scaling"]),int(profile["upcast"]),
                    int(profile["save_half"]),int(profile["save_none"]),
                    int(profile["target_selection"]),profile["completeness"],
                    json.dumps(profile["gaps"],ensure_ascii=False),row["spell_id"],
                ))

            db.commit()
        except Exception:
            db.rollback()
            raise

    recovered_count = db.execute("SELECT COUNT(*) FROM book_spell_registry").fetchone()[0]
    presence_count = db.execute("SELECT COUNT(*) FROM spell_source_presence").fetchone()[0]
    residual_count = db.execute("SELECT COUNT(*) FROM phase4_residual_spell_review").fetchone()[0]

    gap_counts: Counter[str] = Counter()
    for row in db.execute("""
        SELECT automation_gaps_json FROM spell_engine_profiles
        WHERE automation_gaps_json <> '[]'
    """):
        for gap in json.loads(row["automation_gaps_json"]):
            gap_counts[gap] += 1

    book_rows = [dict(r) for r in db.execute("""
        SELECT * FROM book_spell_registry ORDER BY rules_version DESC,spell_level,spell_name
    """)]
    presence_rows = [dict(r) for r in db.execute("""
        SELECT * FROM spell_source_presence ORDER BY source_title,spell_name
    """)]
    residual_rows = [dict(r) for r in db.execute("""
        SELECT * FROM phase4_residual_spell_review ORDER BY prior_quality,source_title,name
    """)]

    report = {
        "batchId": batch_id,"applied": args.apply,
        "discoveredStructuredBlocks": len(discovered),
        "bookSpellRegistryCount": recovered_count,
        "sourcePresenceCount": presence_count,
        "residualReviewCount": residual_count,
        "bookSpellRulesVersionCounts": dict(Counter(r["rules_version"] for r in book_rows)),
        "bookSpellSourceCounts": dict(Counter(r["source_title"] for r in book_rows)),
        "baselineAutomationGapCountsAfterRefine": dict(gap_counts),
        "pageScanStats": page_scan_stats,
        "phaseStatus": (
            "BOOK_RECOVERY_NEEDS_RESIDUAL_REVIEW" if residual_count else
            ("BOOK_RECOVERY_COMPLETE_RULE_REVIEW_PENDING"
             if db.execute("SELECT COUNT(*) FROM spellcasting_rule_review_queue").fetchone()[0]
             else "READY_TO_CLOSE")
        ),
    }
    (output / "phase4_book_recovery_report.json").write_text(
        json.dumps(report,ensure_ascii=False,indent=2)+"\n",encoding="utf-8"
    )

    def save_rows(name: str, rows: list[dict[str, Any]]) -> None:
        (output / f"{name}.json").write_text(
            json.dumps(rows,ensure_ascii=False,indent=2)+"\n",encoding="utf-8"
        )
        if rows:
            with (output / f"{name}.csv").open("w",encoding="utf-8-sig",newline="") as f:
                w=csv.DictWriter(f,fieldnames=list(rows[0].keys()))
                w.writeheader(); w.writerows(rows)

    save_rows("book_spell_registry",book_rows)
    save_rows("spell_source_presence",presence_rows)
    save_rows("residual_spell_review",residual_rows)
    save_rows("page_scan_stats",page_scan_stats)
    save_rows("baseline_gap_matrix_after_refine",[
        {"gap":k,"spell_count":v} for k,v in sorted(gap_counts.items())
    ])

    summary = [
        "# Phase 4 — Book Spell Recovery","",
        f"- Structured spell blocks discovered: **{len(discovered)}**",
        f"- Book spell registry: **{recovered_count}**",
        f"- 2024 baseline source-presence matches: **{presence_count}**",
        f"- Residual review queue: **{residual_count}**","",
        f"Status: **{report['phaseStatus']}**","",
        "## Remaining baseline automation gaps",
    ]
    if gap_counts:
        summary += [f"- {k}: {v}" for k,v in sorted(gap_counts.items())]
    else:
        summary.append("- None from deterministic parser checks.")
    (output / "PHASE4_BOOK_RECOVERY_SUMMARY.md").write_text(
        "\n".join(summary)+"\n",encoding="utf-8",newline="\n"
    )

    db.close()
    print("PHASE 4 BOOK SPELL RECOVERY COMPLETE")
    print(f"APPLIED={args.apply}")
    print(f"DISCOVERED_BLOCKS={len(discovered)}")
    print(f"BOOK_SPELLS={recovered_count}")
    print(f"SOURCE_PRESENCE={presence_count}")
    print(f"RESIDUAL_REVIEW={residual_count}")
    print(f"BASELINE_GAPS={sum(gap_counts.values())}")
    print(f"PHASE_STATUS={report['phaseStatus']}")
    print(f"OUTPUT={output}")
    return 0

if __name__ == "__main__":
    raise SystemExit(main())
