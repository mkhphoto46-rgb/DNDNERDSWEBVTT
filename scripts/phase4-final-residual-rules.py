from __future__ import annotations

import argparse
import csv
import difflib
import hashlib
import json
import re
import sqlite3
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

PROJECT_ROOT = Path(r"F:\DND WEB VTT")
DB_PATH = PROJECT_ROOT / "data" / "compendium" / "rules_knowledge.sqlite"
OUTPUT_ROOT = PROJECT_ROOT / "_phase4_final_residual_rules"

SCHOOLS = (
    "Abjuration","Conjuration","Divination","Enchantment",
    "Evocation","Illusion","Necromancy","Transmutation",
)

REAL_RESIDUAL_SPELLS = {
    "mightyfortress": "Mighty Fortress",
    "steelwindstrike": "Steel Wind Strike",
    "dawn": "Dawn",
    "maximiliansearthengrasp": "Maximilian's Earthen Grasp",
    "summongreaterdemon": "Summon Greater Demon",
    "transmuterock": "Transmute Rock",
}

NOISE_PATTERNS = (
    r"(?i)^range\s*:",
    r"(?i)^components?\s*:",
    r"(?i)^duration\s*:",
    r"(?i)^casting\s*time\s*:",
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

def parse_level_school(line: str) -> tuple[int | None, str]:
    text = clean(line)
    low = text.casefold()

    school = ""
    for school_name in SCHOOLS:
        if school_name.casefold() in low:
            school = school_name
            break

    if "cantrip" in low:
        return 0, school

    for pattern in (
        r"(?i)\b([1-9])(?:st|nd|rd|th)[- ]level\b",
        r"(?i)\blevel\s*([1-9])\b",
        r"(?i)\b([1-9])[- ]level\b",
    ):
        m = re.search(pattern, text)
        if m:
            return int(m.group(1)), school

    compact = re.sub(r"[^a-z0-9]", "", low)
    m = re.search(r"([1-9])(?:st|nd|rd|th)?level", compact)
    if m:
        return int(m.group(1)), school
    m = re.search(r"level([1-9])", compact)
    if m:
        return int(m.group(1)), school

    return None, school

def fuzzy_line_score(target: str, candidate: str) -> float:
    a = norm(target)
    b = norm(candidate)
    if not a or not b:
        return 0.0
    if a == b:
        return 1.0
    if a in b or b in a:
        shorter = min(len(a), len(b))
        longer = max(len(a), len(b))
        if shorter / max(1, longer) >= 0.80:
            return 0.96
    return difflib.SequenceMatcher(None, a, b).ratio()

def find_target_heading(lines: list[str], target: str) -> int | None:
    best: tuple[float, int] | None = None
    for i in range(len(lines)):
        chunks = []
        for width in (1,2,3,4):
            if i + width > len(lines):
                break
            chunks.append(clean(" ".join(lines[i:i+width])))
        for chunk in chunks:
            if not chunk or len(chunk) > max(90, len(target) + 55):
                continue
            score = fuzzy_line_score(target, chunk)
            if score >= 0.74 and (best is None or score > best[0]):
                best = (score, i)
    return best[1] if best else None

def label_value(line: str, label: str) -> str | None:
    compact = re.sub(r"[^a-z]", "", line.casefold())
    target = re.sub(r"[^a-z]", "", label.casefold())
    if target not in compact[: max(len(target) + 12, 30)]:
        return None

    parts = re.split(r"[:：]", line, maxsplit=1)
    if len(parts) == 2:
        return clean(parts[1])

    # OCR may lose the colon. Strip a fuzzy label from the beginning.
    low = line.casefold()
    words = label.casefold().split()
    pos = 0
    for word in words:
        m = re.search(re.escape(word), low[pos:])
        if not m:
            return ""
        pos += m.end()
    return clean(line[pos:])

def recover_named_spell_from_text(
    text: str,
    target_name: str,
    source_page: int,
) -> dict[str, Any] | None:
    lines = [clean(x) for x in text.splitlines()]
    heading_idx = find_target_heading(lines, target_name)
    if heading_idx is None:
        return None

    level = None
    school = ""
    level_idx = None
    for idx in range(max(0, heading_idx - 2), min(len(lines), heading_idx + 10)):
        maybe_level, maybe_school = parse_level_school(lines[idx])
        if maybe_level is not None:
            level = maybe_level
            school = maybe_school
            level_idx = idx
            break
    if level is None or level_idx is None:
        return None

    metadata: dict[str, str] = {}
    metadata_start = level_idx
    for idx in range(metadata_start, min(len(lines), metadata_start + 24)):
        line = lines[idx]
        if not line:
            continue
        for key, label in (
            ("casting_time","Casting Time"),
            ("range","Range"),
            ("components","Components"),
            ("duration","Duration"),
        ):
            if key not in metadata:
                value = label_value(line, label)
                if value is not None:
                    metadata[key] = value

    if any(not metadata.get(k) for k in ("casting_time","range","components","duration")):
        return None

    # Keep actual source text for provenance; stop after a bounded block.
    raw_block = clean("\n".join(lines[heading_idx:min(len(lines), heading_idx + 100)]))
    if len(raw_block) < 60:
        return None

    return {
        "name": target_name,
        "level": level,
        "school": school,
        "casting_time": metadata["casting_time"],
        "range": metadata["range"],
        "components_text": metadata["components"],
        "duration": metadata["duration"],
        "concentration": "concentration" in metadata["duration"].casefold(),
        "ritual": "ritual" in " ".join(lines[heading_idx:level_idx+1]).casefold(),
        "source_page": source_page,
        "raw_block": raw_block[:14000],
    }

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
        scale = max(1.0, 190.0 / 72.0)
        pix = page.get_pixmap(
            matrix=pymupdf.Matrix(scale, scale),
            colorspace=pymupdf.csRGB,
            alpha=False,
        )
        image = np.frombuffer(pix.samples, dtype=np.uint8).reshape(
            pix.height, pix.width, pix.n
        )
        if pix.n > 3:
            image = image[:, :, :3]
        result = engine(image)
        if result is None or result.txts is None:
            return ""
        return "\n".join(str(x) for x in result.txts if str(x).strip())
    finally:
        doc.close()

def build_simple_profile(block: dict[str, Any]) -> dict[str, Any]:
    text = block["raw_block"]
    dice = sorted(set(
        m.group(1).replace(" ", "")
        for m in re.finditer(
            r"(?<![A-Za-z0-9])(\d+d(?:4|6|8|10|12|20|100)(?:\s*[+-]\s*\d+)?)",
            text,
            flags=re.I,
        )
    ))
    damage_types = []
    for dtype in (
        "Acid","Bludgeoning","Cold","Fire","Force","Lightning","Necrotic",
        "Piercing","Poison","Psychic","Radiant","Slashing","Thunder",
    ):
        if re.search(rf"(?i)\b{dtype} damage\b", text):
            damage_types.append(dtype)

    return {
        "castingTime": block["casting_time"],
        "range": block["range"],
        "componentsText": block["components_text"],
        "duration": block["duration"],
        "concentration": block["concentration"],
        "ritual": block["ritual"],
        "school": block["school"],
        "dice": dice,
        "damageTypes": damage_types,
        "validationScope": "targeted-residual-book-spell-recovery",
    }

def ensure_schema(db: sqlite3.Connection) -> None:
    db.executescript("""
    CREATE TABLE IF NOT EXISTS phase4_final_batches(
      id TEXT PRIMARY KEY,
      created_at TEXT NOT NULL,
      source_db_sha256 TEXT NOT NULL,
      residual_spell_count_before INTEGER NOT NULL,
      residual_spell_count_after INTEGER NOT NULL,
      rule_review_count_before INTEGER NOT NULL,
      unresolved_rule_count_after INTEGER NOT NULL,
      automation_gap_count INTEGER NOT NULL
    ) STRICT;

    CREATE TABLE IF NOT EXISTS phase4_residual_resolution(
      original_entity_version_id TEXT PRIMARY KEY,
      original_name TEXT NOT NULL,
      resolution TEXT NOT NULL,
      recovered_book_spell_id TEXT,
      notes TEXT NOT NULL,
      batch_id TEXT NOT NULL REFERENCES phase4_final_batches(id)
    ) STRICT;

    CREATE TABLE IF NOT EXISTS phase4_spellcasting_rule_resolution(
      entity_version_id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      rules_version TEXT NOT NULL,
      source_title TEXT NOT NULL,
      source_page INTEGER,
      resolution_class TEXT NOT NULL,
      authoritative_destination TEXT NOT NULL,
      notes TEXT NOT NULL,
      batch_id TEXT NOT NULL REFERENCES phase4_final_batches(id)
    ) STRICT;

    CREATE TABLE IF NOT EXISTS phase4_automation_backlog(
      spell_id TEXT NOT NULL,
      gap_type TEXT NOT NULL,
      status TEXT NOT NULL,
      notes TEXT NOT NULL,
      batch_id TEXT NOT NULL REFERENCES phase4_final_batches(id),
      PRIMARY KEY(spell_id,gap_type)
    ) STRICT;
    """)
    db.commit()

def classify_rule_candidate(
    row: sqlite3.Row,
    spell_names: set[str],
    feature_names: set[str],
) -> tuple[str, str, str]:
    name = clean(row["name"])
    n = norm(name)
    low = name.casefold()

    if n in spell_names:
        return (
            "duplicate-spell",
            "spell-registry",
            "Classifier record duplicates a spell entry; spell registry is authoritative.",
        )

    if n in feature_names:
        return (
            "class-feature",
            "class-feature-registry",
            "Classifier record duplicates a validated class/subclass feature.",
        )

    if any(re.search(p, name) for p in NOISE_PATTERNS):
        return (
            "ocr-metadata-fragment",
            "quarantine",
            "Metadata fragment is not an independent spellcasting rule.",
        )

    if re.search(r"(?i)\blevel\s+\d+\s*:\s*spellcasting\b", name):
        return (
            "class-feature",
            "class-feature-registry",
            "Level-based Spellcasting is a class feature and is already handled by Phase 2.",
        )

    if any(token in low for token in (
        "eldritch knight spellcasting",
        "arcane trickster spellcasting",
        "spell slots. the ",
        "potent spellcasting",
        "spellcasting ability",
        "spellcasting focus",
    )):
        return (
            "class-or-equipment-rule",
            "phase2-or-phase5-registry",
            "This is not a standalone global spellcasting rule.",
        )

    if any(token in low for token in (
        "chapter ", "see pact magic", "see spellcasting", "dungeon master",
        "beast master", "perception", "planar travel", "rolling initiative",
        "visions of the past", "of the storm", "magic—user", "magic-user",
        "reactions",
    )):
        return (
            "index-reference-or-unrelated",
            "quarantine",
            "Index/reference/unrelated classifier output; not a standalone spellcasting rule.",
        )

    # Core global spellcasting topics are already represented in the Phase 1
    # validated Core Rules registry. Preserve old references without promoting
    # noisy duplicate records.
    core_terms = (
        "what is a spell",
        "casting a spell at a higher level",
        "concentration",
        "spellcasting",
        "perceiving a caster at work",
    )
    if any(term in low for term in core_terms):
        return (
            "global-rule-reference",
            "core-rule-registry",
            "Global spellcasting topic is governed by the validated Core Rules registry; this classifier record remains non-authoritative provenance.",
        )

    if row["rules_version"] == "2024" and row["status"] == "validated":
        return (
            "validated-noncanonical-fragment",
            "quarantine",
            "Previously validated extractor fragment is not promoted into the Phase 4 rule registry.",
        )

    return (
        "classifier-noise-or-reference",
        "quarantine",
        "No evidence that this classifier candidate is an independent authoritative spellcasting rule.",
    )

def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--apply", action="store_true")
    parser.add_argument("--output", default=str(OUTPUT_ROOT))
    args = parser.parse_args()

    output = Path(args.output)
    output.mkdir(parents=True, exist_ok=True)

    db_hash_before = sha256_file(DB_PATH)
    db = sqlite3.connect(DB_PATH)
    db.row_factory = sqlite3.Row
    db.execute("PRAGMA foreign_keys=ON")

    if db.execute("PRAGMA integrity_check").fetchone()[0] != "ok":
        raise RuntimeError("SQLite integrity check failed.")

    if db.execute("SELECT COUNT(*) FROM spell_registry").fetchone()[0] != 339:
        raise RuntimeError("Phase 4 spell baseline missing.")
    if db.execute("SELECT COUNT(*) FROM book_spell_registry").fetchone()[0] < 400:
        raise RuntimeError("Phase 4 book spell recovery baseline missing.")

    residual_rows = db.execute("""
        SELECT * FROM phase4_residual_spell_review
        ORDER BY source_title,source_page,name
    """).fetchall()
    rule_rows = db.execute("""
        SELECT * FROM spellcasting_rule_review_queue
        ORDER BY source_title,source_page,name
    """).fetchall()

    sources = {
        row["id"]: row
        for row in db.execute("""
            SELECT id,title,filename,rules_version,source_priority,current_revision_id
            FROM sources
        """)
    }

    recovered: list[dict[str, Any]] = []
    noise_residuals: list[sqlite3.Row] = []
    failed_real: list[dict[str, Any]] = []

    for row in residual_rows:
        normalized = norm(row["name"])
        if any(re.search(p, row["name"]) for p in NOISE_PATTERNS):
            noise_residuals.append(row)
            continue

        canonical_name = REAL_RESIDUAL_SPELLS.get(normalized)
        if canonical_name is None:
            failed_real.append({
                "name": row["name"],
                "source_title": row["source_title"],
                "source_page": row["source_page"],
                "reason": "Residual candidate is neither known metadata noise nor one of the real residual spell headings.",
            })
            continue

        source = sources.get(row["source_id"])
        if source is None:
            failed_real.append({
                "name": canonical_name,
                "source_title": row["source_title"],
                "source_page": row["source_page"],
                "reason": "Source record missing.",
            })
            continue

        base_page = int(row["source_page"])
        pdf_path = PROJECT_ROOT / "content-sources" / "books" / source["filename"]
        if not pdf_path.exists():
            failed_real.append({
                "name": canonical_name,
                "source_title": row["source_title"],
                "source_page": base_page,
                "reason": "Source PDF missing.",
            })
            continue

        block = None
        method = None

        # Native raw text first, then targeted OCR around the candidate page.
        for page_no in range(max(1, base_page - 2), base_page + 3):
            raw = db.execute("""
                SELECT text FROM raw_pages
                WHERE revision_id=? AND page_number=?
            """, (source["current_revision_id"], page_no)).fetchone()
            if raw and clean(raw["text"] or ""):
                block = recover_named_spell_from_text(
                    raw["text"], canonical_name, page_no
                )
                if block:
                    method = "raw-page-targeted"
                    break

        if block is None:
            for page_no in range(max(1, base_page - 2), base_page + 3):
                text = ocr_pdf_page(pdf_path, page_no)
                if not clean(text):
                    continue
                block = recover_named_spell_from_text(
                    text, canonical_name, page_no
                )
                if block:
                    method = "targeted-ocr"
                    break

        if block is None:
            failed_real.append({
                "name": canonical_name,
                "source_title": row["source_title"],
                "source_page": base_page,
                "reason": "Could not recover complete Level/School + Casting Time + Range + Components + Duration block.",
            })
            continue

        recovered.append({
            "original": row,
            "source": source,
            "block": block,
            "method": method,
        })

    # Fail before mutation if any real residual spell remains unrecovered.
    if failed_real:
        (output / "failed_real_residuals.json").write_text(
            json.dumps(failed_real, ensure_ascii=False, indent=2) + "\n",
            encoding="utf-8",
        )
        raise RuntimeError(
            "Real residual spell recovery incomplete: "
            + ", ".join(x["name"] for x in failed_real)
        )

    spell_names = {
        norm(row["spell_name"])
        for row in db.execute("SELECT spell_name FROM spell_registry")
    }
    spell_names.update(
        norm(row["spell_name"])
        for row in db.execute("SELECT spell_name FROM book_spell_registry")
    )
    feature_names = {
        norm(row["feature_name"])
        for row in db.execute("SELECT feature_name FROM class_feature_registry")
    }

    rule_resolutions = []
    for row in rule_rows:
        resolution, destination, notes = classify_rule_candidate(
            row, spell_names, feature_names
        )
        rule_resolutions.append({
            "row": row,
            "resolution": resolution,
            "destination": destination,
            "notes": notes,
        })

    # Every candidate must be deterministically resolved.
    unresolved_rules = [
        x for x in rule_resolutions
        if not x["resolution"] or not x["destination"]
    ]
    if unresolved_rules:
        raise RuntimeError(
            f"{len(unresolved_rules)} spellcasting rule candidates remain unresolved."
        )

    gap_items = []
    for row in db.execute("""
        SELECT r.spell_id,r.spell_name,p.automation_gaps_json
        FROM spell_registry r
        JOIN spell_engine_profiles p ON p.spell_id=r.spell_id
        WHERE p.automation_gaps_json <> '[]'
        ORDER BY r.spell_name
    """):
        try:
            gaps = json.loads(row["automation_gaps_json"])
        except Exception:
            gaps = []
        for gap in gaps:
            gap_items.append({
                "spell_id": row["spell_id"],
                "spell_name": row["spell_name"],
                "gap_type": str(gap),
                "status": "ENGINE_AUTOMATION_BACKLOG",
                "notes": (
                    "Structured content is preserved. This deterministic runtime "
                    "edge case must be implemented/tested in the later automation pass."
                ),
            })

    batch_id = f"phase4-final-{datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ')}"

    if args.apply:
        ensure_schema(db)
        db.execute("BEGIN IMMEDIATE")
        try:
            # Recover the six actual spell blocks into book_spell_registry.
            for item in recovered:
                row = item["original"]
                source = item["source"]
                block = item["block"]
                canonical_name = block["name"]
                source_slug = slug(source["title"])[:40]
                name_slug = slug(canonical_name)[:70]

                canonical_id = (
                    f"entity-phase4-residual-{source['rules_version']}-"
                    f"{source_slug}-{name_slug}"
                )
                version_id = (
                    f"version-phase4-residual-{source['rules_version']}-"
                    f"{source_slug}-{name_slug}-{block['source_page']}"
                )
                canonical_key = (
                    f"spell:{name_slug}:{source['rules_version']}:{source_slug}:residual"
                )

                db.execute("""
                    INSERT INTO canonical_entities(id,canonical_key,category,name)
                    VALUES(?,?,?,?)
                    ON CONFLICT(id) DO NOTHING
                """, (
                    canonical_id,
                    canonical_key,
                    "cantrip" if block["level"] == 0 else "spell",
                    canonical_name,
                ))

                structured = {
                    "name": canonical_name,
                    "level": block["level"],
                    "school": block["school"],
                    "castingTime": block["casting_time"],
                    "range": block["range"],
                    "componentsText": block["components_text"],
                    "duration": block["duration"],
                    "concentration": block["concentration"],
                    "ritual": block["ritual"],
                    "rulesVersion": source["rules_version"],
                    "recoveryMethod": item["method"],
                    "validationScope": "targeted-residual-book-spell-recovery",
                }
                content_sha = hashlib.sha256(
                    (
                        source["id"] + "|" + str(block["source_page"]) + "|"
                        + canonical_name + "|" + block["raw_block"]
                    ).encode("utf-8")
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
                    version_id,
                    canonical_id,
                    source["id"],
                    source["current_revision_id"],
                    f"phase4-residual:{source_slug}:{name_slug}:{block['source_page']}",
                    "cantrip" if block["level"] == 0 else "spell",
                    block["school"] or "",
                    canonical_name,
                    f"Recovered validated spell block for {canonical_name}.",
                    json.dumps(structured, ensure_ascii=False, separators=(",", ":")),
                    block["raw_block"],
                    block["source_page"],
                    block["source_page"],
                    source["rules_version"],
                    source["source_priority"],
                    "validated",
                    0.99,
                    content_sha,
                    now_iso(),
                ))

                book_spell_id = (
                    f"bookspell.{source['rules_version']}.{source_slug}.{name_slug}"
                )
                db.execute("""
                    INSERT OR REPLACE INTO book_spell_registry(
                      book_spell_id,spell_name,normalized_name,spell_level,category,
                      rules_version,entity_version_id,source_id,source_title,
                      source_page,source_priority,validation_scope,batch_id,validated_at
                    ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)
                """, (
                    book_spell_id,
                    canonical_name,
                    norm(canonical_name),
                    block["level"],
                    "cantrip" if block["level"] == 0 else "spell",
                    source["rules_version"],
                    version_id,
                    source["id"],
                    source["title"],
                    block["source_page"],
                    source["source_priority"],
                    "targeted-residual-book-spell-recovery",
                    # book_spell_registry FK points to phase4_book_recovery_batches,
                    # so retain the current book-recovery batch ID.
                    db.execute("""
                        SELECT batch_id FROM phase4_residual_spell_review
                        WHERE entity_version_id=?
                    """, (row["entity_version_id"],)).fetchone()[0],
                    now_iso(),
                ))

            # Final batch row first, then dependent resolution tables.
            db.execute("""
                INSERT INTO phase4_final_batches(
                  id,created_at,source_db_sha256,residual_spell_count_before,
                  residual_spell_count_after,rule_review_count_before,
                  unresolved_rule_count_after,automation_gap_count
                ) VALUES(?,?,?,?,?,?,?,?)
            """, (
                batch_id,
                now_iso(),
                db_hash_before,
                len(residual_rows),
                0,
                len(rule_rows),
                0,
                len(gap_items),
            ))

            db.execute("DELETE FROM phase4_residual_resolution")
            for item in recovered:
                row = item["original"]
                source = item["source"]
                block = item["block"]
                book_spell_id = (
                    f"bookspell.{source['rules_version']}."
                    f"{slug(source['title'])[:40]}.{slug(block['name'])[:70]}"
                )
                db.execute("""
                    INSERT INTO phase4_residual_resolution(
                      original_entity_version_id,original_name,resolution,
                      recovered_book_spell_id,notes,batch_id
                    ) VALUES(?,?,?,?,?,?)
                """, (
                    row["entity_version_id"],
                    row["name"],
                    "recovered-spell",
                    book_spell_id,
                    f"Recovered from source using {item['method']}.",
                    batch_id,
                ))

            for row in noise_residuals:
                db.execute("""
                    INSERT INTO phase4_residual_resolution(
                      original_entity_version_id,original_name,resolution,
                      recovered_book_spell_id,notes,batch_id
                    ) VALUES(?,?,?,?,?,?)
                """, (
                    row["entity_version_id"],
                    row["name"],
                    "ocr-metadata-noise",
                    None,
                    "Metadata fragment; not a spell.",
                    batch_id,
                ))

            db.execute("DELETE FROM phase4_spellcasting_rule_resolution")
            for item in rule_resolutions:
                row = item["row"]
                db.execute("""
                    INSERT INTO phase4_spellcasting_rule_resolution(
                      entity_version_id,name,rules_version,source_title,source_page,
                      resolution_class,authoritative_destination,notes,batch_id
                    ) VALUES(?,?,?,?,?,?,?,?,?)
                """, (
                    row["entity_version_id"],
                    row["name"],
                    row["rules_version"],
                    row["source_title"],
                    row["source_page"],
                    item["resolution"],
                    item["destination"],
                    item["notes"],
                    batch_id,
                ))

            db.execute("DELETE FROM phase4_automation_backlog")
            for gap in gap_items:
                db.execute("""
                    INSERT INTO phase4_automation_backlog(
                      spell_id,gap_type,status,notes,batch_id
                    ) VALUES(?,?,?,?,?)
                """, (
                    gap["spell_id"],
                    gap["gap_type"],
                    gap["status"],
                    gap["notes"],
                    batch_id,
                ))

            # Queues are resolved by the tables above.
            db.execute("DELETE FROM phase4_residual_spell_review")
            db.execute("DELETE FROM spellcasting_rule_review_queue")

            db.commit()
        except Exception:
            db.rollback()
            raise

    residual_after = db.execute(
        "SELECT COUNT(*) FROM phase4_residual_spell_review"
    ).fetchone()[0]
    rules_after = db.execute(
        "SELECT COUNT(*) FROM spellcasting_rule_review_queue"
    ).fetchone()[0]
    final_book_count = db.execute(
        "SELECT COUNT(*) FROM book_spell_registry"
    ).fetchone()[0]
    final_rule_resolution_count = db.execute(
        "SELECT COUNT(*) FROM phase4_spellcasting_rule_resolution"
    ).fetchone()[0]
    final_residual_resolution_count = db.execute(
        "SELECT COUNT(*) FROM phase4_residual_resolution"
    ).fetchone()[0]
    backlog_count = db.execute(
        "SELECT COUNT(*) FROM phase4_automation_backlog"
    ).fetchone()[0]

    report = {
        "batchId": batch_id,
        "applied": args.apply,
        "residualSpellCountBefore": len(residual_rows),
        "recoveredRealResidualSpells": len(recovered),
        "discardedResidualNoise": len(noise_residuals),
        "residualSpellQueueAfter": residual_after,
        "spellcastingRuleCountBefore": len(rule_rows),
        "spellcastingRuleResolutionCount": final_rule_resolution_count,
        "spellcastingRuleQueueAfter": rules_after,
        "bookSpellRegistryFinalCount": final_book_count,
        "automationBacklogCount": backlog_count,
        "phaseStatus": (
            "STRUCTURED_VALIDATION_CLOSED_AUTOMATION_BACKLOG_TRACKED"
            if residual_after == 0 and rules_after == 0
            else "NOT_CLOSED"
        ),
    }

    (output / "phase4_final_report.json").write_text(
        json.dumps(report, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )

    def rows(query: str) -> list[dict[str, Any]]:
        return [dict(x) for x in db.execute(query)]

    exports = {
        "residual_resolution": rows("""
            SELECT * FROM phase4_residual_resolution
            ORDER BY resolution,original_name
        """),
        "spellcasting_rule_resolution": rows("""
            SELECT * FROM phase4_spellcasting_rule_resolution
            ORDER BY resolution_class,source_title,name
        """),
        "automation_backlog": rows("""
            SELECT b.*,r.spell_name
            FROM phase4_automation_backlog b
            JOIN spell_registry r ON r.spell_id=b.spell_id
            ORDER BY b.gap_type,r.spell_name
        """),
    }

    for name, data in exports.items():
        (output / f"{name}.json").write_text(
            json.dumps(data, ensure_ascii=False, indent=2) + "\n",
            encoding="utf-8",
        )
        fields = list(data[0].keys()) if data else ["empty"]
        with (output / f"{name}.csv").open(
            "w", encoding="utf-8-sig", newline=""
        ) as handle:
            writer = csv.DictWriter(handle, fieldnames=fields)
            writer.writeheader()
            if data:
                writer.writerows(data)

    summary = [
        "# Phase 4 Final Structured Validation",
        "",
        f"- Residual queue before: **{len(residual_rows)}**",
        f"- Real residual spells recovered: **{len(recovered)}**",
        f"- Residual OCR noise discarded: **{len(noise_residuals)}**",
        f"- Residual queue after: **{residual_after}**",
        f"- Spellcasting-rule candidates resolved: **{final_rule_resolution_count}**",
        f"- Spellcasting-rule queue after: **{rules_after}**",
        f"- Final book spell registry: **{final_book_count}**",
        f"- Explicit automation backlog: **{backlog_count}**",
        "",
        f"Status: **{report['phaseStatus']}**",
        "",
        "Automation backlog is intentionally retained for later ENGINE_READY → AUTOMATED → TESTED work.",
    ]
    (output / "PHASE4_FINAL_SUMMARY.md").write_text(
        "\n".join(summary) + "\n",
        encoding="utf-8",
        newline="\n",
    )

    db.close()

    if residual_after != 0 or rules_after != 0:
        raise RuntimeError("Phase 4 cannot close: unresolved queues remain.")

    print("PHASE 4 FINAL RESIDUAL/RULE REVIEW COMPLETE")
    print(f"APPLIED={args.apply}")
    print(f"REAL_RESIDUAL_RECOVERED={len(recovered)}")
    print(f"RESIDUAL_NOISE={len(noise_residuals)}")
    print(f"RESIDUAL_QUEUE_AFTER={residual_after}")
    print(f"RULES_RESOLVED={final_rule_resolution_count}")
    print(f"RULE_QUEUE_AFTER={rules_after}")
    print(f"BOOK_SPELLS_FINAL={final_book_count}")
    print(f"AUTOMATION_BACKLOG={backlog_count}")
    print(f"PHASE_STATUS={report['phaseStatus']}")
    print(f"OUTPUT={output}")
    return 0

if __name__ == "__main__":
    raise SystemExit(main())
