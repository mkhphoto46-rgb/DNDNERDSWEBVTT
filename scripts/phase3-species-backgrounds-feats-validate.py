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
OUTPUT_ROOT = PROJECT_ROOT / "_phase3_species_backgrounds_feats_validation"

SPECIES = (
    "Aasimar","Dragonborn","Dwarf","Elf","Gnome",
    "Goliath","Halfling","Human","Orc","Tiefling",
)

BACKGROUNDS = (
    "Acolyte","Artisan","Charlatan","Criminal","Entertainer","Farmer",
    "Guard","Guide","Hermit","Merchant","Noble","Sage","Sailor",
    "Scribe","Soldier","Wayfarer",
)

FEATS = {
    "origin": (
        "Alert","Crafter","Healer","Lucky","Magic Initiate","Musician",
        "Savage Attacker","Skilled","Tavern Brawler","Tough",
    ),
    "general": (
        "Ability Score Improvement","Actor","Athlete","Charger","Chef",
        "Crossbow Expert","Crusher","Defensive Duelist","Dual Wielder",
        "Durable","Elemental Adept","Fey-Touched","Grappler",
        "Great Weapon Master","Heavily Armored","Heavy Armor Master",
        "Inspiring Leader","Keen Mind","Lightly Armored","Mage Slayer",
        "Martial Weapon Training","Medium Armor Master","Moderately Armored",
        "Mounted Combatant","Observant","Piercer","Poisoner","Polearm Master",
        "Resilient","Ritual Caster","Sentinel","Shadow-Touched","Sharpshooter",
        "Shield Master","Skill Expert","Skulker","Slasher","Speedy",
        "Spell Sniper","Telekinetic","Telepathic","War Caster","Weapon Master",
    ),
    "fighting-style": (
        "Archery","Blind Fighting","Defense","Dueling","Great Weapon Fighting",
        "Interception","Protection","Thrown Weapon Fighting",
        "Two-Weapon Fighting","Unarmed Fighting",
    ),
    "epic-boon": (
        "Boon of Combat Prowess","Boon of Dimensional Travel",
        "Boon of Energy Resistance","Boon of Fate","Boon of Fortitude",
        "Boon of Irresistible Offense","Boon of Recovery","Boon of Skill",
        "Boon of Speed","Boon of Spell Recall","Boon of the Night Spirit",
        "Boon of Truesight",
    ),
}

PAGE_RANGES = {
    "background": (174, 187),
    "species": (184, 198),
    "feat": (197, 213),
}

def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()

def sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()

def clean(value: str) -> str:
    return re.sub(r"\s+", " ", value or "").strip()

def norm(value: str) -> str:
    return re.sub(r"[^a-z0-9]+", "", (value or "").casefold())

def slug(value: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", (value or "").casefold()).strip("-")

def get_phb(db: sqlite3.Connection) -> sqlite3.Row:
    row = db.execute("""
        SELECT id,title,filename,current_revision_id,source_priority
        FROM sources
        WHERE title='Player''s Handbook'
          AND rules_version='2024'
          AND source_kind='official-core'
          AND current_revision_id IS NOT NULL
        ORDER BY source_priority DESC
        LIMIT 1
    """).fetchone()
    if row is None:
        raise RuntimeError("2024 Player's Handbook source not found.")
    return row

def get_pages(db: sqlite3.Connection, revision_id: str) -> dict[int, sqlite3.Row]:
    return {
        row["page_number"]: row
        for row in db.execute("""
            SELECT id,revision_id,page_number,text,text_sha256,extraction_method
            FROM raw_pages
            WHERE revision_id=?
            ORDER BY page_number
        """, (revision_id,))
    }

def line_similarity(canonical: str, line: str) -> float:
    a = norm(canonical)
    b = norm(line)
    if not a or not b:
        return 0.0
    if a == b:
        return 1.0
    if a in b and len(b) <= len(a) + 16:
        return 0.97
    if b in a and len(a) <= len(b) + 8:
        return 0.95
    return difflib.SequenceMatcher(None, a, b).ratio()

def get_targeted_ocr_runtime() -> tuple[Any, Any, Any]:
    try:
        import fitz
        import numpy as np
        from rapidocr import RapidOCR
    except Exception as exc:
        raise RuntimeError(
            "Targeted OCR dependencies are unavailable. "
            "Re-run the Rules Knowledge v2 setup if needed."
        ) from exc
    return fitz, np, RapidOCR(params={"Global.log_level": "warning"})

def ocr_pdf_page(pdf_path: Path, page_no: int) -> str:
    fitz, np, engine = get_targeted_ocr_runtime()
    document = fitz.open(str(pdf_path))
    try:
        if page_no < 1 or page_no > document.page_count:
            return ""
        page = document.load_page(page_no - 1)
        scale = max(1.0, 170.0 / 72.0)
        pix = page.get_pixmap(
            matrix=fitz.Matrix(scale, scale),
            colorspace=fitz.csRGB,
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
        document.close()

def shadow_page(
    page_no: int,
    text: str,
    revision_id: str,
) -> dict[str, Any]:
    return {
        "id": f"targeted-ocr-{page_no}",
        "revision_id": revision_id,
        "page_number": page_no,
        "text": text,
        "text_sha256": hashlib.sha256(text.encode("utf-8")).hexdigest(),
        "extraction_method": "targeted-ocr-recovery",
    }

def find_heading_with_ocr_recovery(
    pages: dict[int, Any],
    canonical: str,
    start: int,
    end: int,
    *,
    pdf_path: Path,
    revision_id: str,
    threshold: float = 0.72,
) -> tuple[Any, int, float, str, str]:
    try:
        page, index, score, matched = find_heading(
            pages, canonical, start, end, threshold=threshold
        )
        return page, index, score, matched, "raw-pages"
    except RuntimeError:
        recovered_pages = dict(pages)

        # First fill physically missing raw pages only.
        missing = [page_no for page_no in range(start, end + 1) if page_no not in recovered_pages]
        for page_no in missing:
            text = ocr_pdf_page(pdf_path, page_no)
            if clean(text):
                recovered_pages[page_no] = shadow_page(page_no, text, revision_id)

        try:
            page, index, score, matched = find_heading(
                recovered_pages, canonical, start, end, threshold=threshold
            )
            pages.update(recovered_pages)
            return page, index, score, matched, "targeted-ocr-missing-pages"
        except RuntimeError:
            # If native text exists but is too damaged, OCR the whole narrow section.
            for page_no in range(start, end + 1):
                text = ocr_pdf_page(pdf_path, page_no)
                if clean(text):
                    recovered_pages[page_no] = shadow_page(page_no, text, revision_id)

            page, index, score, matched = find_heading(
                recovered_pages, canonical, start, end, threshold=max(0.68, threshold - 0.04)
            )
            pages.update(recovered_pages)
            return page, index, score, matched, "targeted-ocr-section"

def find_heading(
    pages: dict[int, sqlite3.Row],
    canonical: str,
    start: int,
    end: int,
    *,
    threshold: float = 0.72,
) -> tuple[sqlite3.Row, int, float, str]:
    matches: list[tuple[float, int, int, sqlite3.Row, str]] = []
    for page_no in range(start, end + 1):
        page = pages.get(page_no)
        if page is None:
            continue
        lines = page["text"].splitlines()
        for index, line in enumerate(lines):
            stripped = clean(line)
            if not stripped:
                continue
            if len(stripped) > max(90, len(canonical) + 45):
                continue
            score = line_similarity(canonical, stripped)
            # Short names need stronger evidence.
            required = 0.84 if len(norm(canonical)) <= 7 else threshold
            if score >= required:
                matches.append((score, -page_no, -index, page, stripped))

    if not matches:
        raise RuntimeError(
            f'No reliable 2024 PHB heading found for "{canonical}" '
            f'in pages {start}-{end}.'
        )

    matches.sort(reverse=True, key=lambda x: (x[0], x[1], x[2]))
    score, _, neg_index, page, matched_line = matches[0]
    return page, -neg_index, score, matched_line

def canonical_names_for(category: str) -> list[str]:
    if category == "species":
        return list(SPECIES)
    if category == "background":
        return list(BACKGROUNDS)
    if category == "feat":
        out: list[str] = []
        for names in FEATS.values():
            out.extend(names)
        return out
    raise ValueError(category)

def looks_like_canonical_heading(line: str, canonical: str) -> bool:
    stripped = clean(line)
    if not stripped:
        return False

    # Real section headings in these PHB sections are short. Do not let ordinary
    # prose containing another background/species/feat name terminate the block.
    max_len = max(54, len(canonical) + 28)
    if len(stripped) > max_len:
        return False

    score = line_similarity(canonical, stripped)
    required = 0.96 if len(norm(canonical)) <= 7 else 0.88
    if score < required:
        return False

    words = stripped.split()
    canonical_words = canonical.split()
    if len(words) > max(len(canonical_words) + 4, 8):
        return False

    return True

def extract_block(
    pages: dict[int, Any],
    category: str,
    canonical: str,
    heading_page: int,
    heading_index: int,
) -> str:
    start, end = PAGE_RANGES[category]
    other_names = [n for n in canonical_names_for(category) if n != canonical]
    collected: list[str] = []

    for page_no in range(heading_page, min(end, heading_page + 2) + 1):
        page = pages.get(page_no)
        if page is None:
            continue

        lines = page["text"].splitlines()
        begin = heading_index if page_no == heading_page else 0

        for idx in range(begin, len(lines)):
            line = clean(lines[idx])

            if not line:
                if collected:
                    collected.append("")
                continue

            if collected and any(
                looks_like_canonical_heading(line, other)
                for other in other_names
            ):
                block = clean("\n".join(collected))
                if len(block) >= 25:
                    return block[:12000]

            collected.append(line)

            if len("\n".join(collected)) >= 12000:
                return clean("\n".join(collected))[:12000]

    block = clean("\n".join(collected))

    # Last-resort local source recovery: if the block is still tiny because of
    # damaged OCR layout, retain the rest of the heading page from the matched
    # heading onward. This preserves actual PHB source text and does not invent data.
    if len(block) < 25:
        page = pages.get(heading_page)
        if page is not None:
            lines = page["text"].splitlines()
            fallback = clean("\n".join(lines[heading_index:]))
            if len(fallback) > len(block):
                block = fallback

    return block[:12000]


def parse_species(name: str, block: str) -> dict[str, Any]:
    data: dict[str, Any] = {
        "speciesName": name,
        "rulesVersion": "2024",
        "validationScope": "identity-source-block-plus-safe-fields",
    }

    speed = re.search(r"(?i)\bspeed\b[^0-9]{0,30}(\d{2,3})\s*(?:feet|ft\.?)", block)
    if speed:
        data["speedFeet"] = int(speed.group(1))

    if re.search(r"(?i)\bdarkvision\b", block):
        data["hasDarkvision"] = True

    size = re.search(r"(?i)\bsize\b[^A-Za-z]{0,10}(Small|Medium|Small or Medium|Medium or Small)", block)
    if size:
        data["sizeText"] = size.group(1)

    creature = re.search(r"(?i)\bcreature type\b[^A-Za-z]{0,12}([A-Za-z ]{3,30})", block)
    if creature:
        data["creatureTypeText"] = clean(creature.group(1)).split(".")[0][:40]

    data["sourceBlock"] = block
    return data

def parse_background(name: str, block: str) -> dict[str, Any]:
    data: dict[str, Any] = {
        "backgroundName": name,
        "rulesVersion": "2024",
        "validationScope": "identity-source-block-plus-safe-fields",
    }

    feat = re.search(r"(?i)\bfeat\b\s*[:.\-]\s*([A-Za-z][A-Za-z '\-]{2,60})", block)
    if feat:
        data["originFeatText"] = clean(feat.group(1)).split(".")[0][:70]

    skills = re.search(
        r"(?i)\bskill proficien(?:cy|cies)\b\s*[:.\-]\s*([A-Za-z, '&\-]{3,100})",
        block,
    )
    if skills:
        data["skillProficienciesText"] = clean(skills.group(1)).split(".")[0][:120]

    tool = re.search(
        r"(?i)\btool proficien(?:cy|cies)\b\s*[:.\-]\s*([A-Za-z0-9, '&\-]{3,100})",
        block,
    )
    if tool:
        data["toolProficiencyText"] = clean(tool.group(1)).split(".")[0][:120]

    ability = re.search(
        r"(?i)\bability scores?\b\s*[:.\-]\s*([A-Za-z, '&\-]{3,100})",
        block,
    )
    if ability:
        data["abilityScoresText"] = clean(ability.group(1)).split(".")[0][:120]

    data["sourceBlock"] = block
    return data

def parse_feat(name: str, feat_type: str, block: str) -> dict[str, Any]:
    data: dict[str, Any] = {
        "featName": name,
        "featType": feat_type,
        "rulesVersion": "2024",
        "validationScope": "identity-source-block-plus-safe-fields",
    }

    prereq = re.search(
        r"(?i)\bprerequisite\b\s*[:.\-]?\s*([^\n]{2,180})",
        block,
    )
    if prereq:
        data["prerequisiteText"] = clean(prereq.group(1))[:200]

    if re.search(r"(?i)\brepeatable\b", block):
        data["repeatableMentioned"] = True

    data["sourceBlock"] = block
    return data

def ensure_schema(db: sqlite3.Connection) -> None:
    db.executescript("""
    CREATE TABLE IF NOT EXISTS phase3_validation_batches(
      id TEXT PRIMARY KEY,
      created_at TEXT NOT NULL,
      source_db_sha256 TEXT NOT NULL,
      species_count INTEGER NOT NULL,
      background_count INTEGER NOT NULL,
      feat_count INTEGER NOT NULL
    ) STRICT;

    CREATE TABLE IF NOT EXISTS species_registry(
      species_id TEXT PRIMARY KEY,
      species_name TEXT NOT NULL UNIQUE,
      entity_version_id TEXT NOT NULL REFERENCES entity_versions(id),
      rules_version TEXT NOT NULL,
      source_id TEXT NOT NULL REFERENCES sources(id),
      source_title TEXT NOT NULL,
      source_page INTEGER NOT NULL,
      heading_score REAL NOT NULL,
      validation_scope TEXT NOT NULL,
      batch_id TEXT NOT NULL REFERENCES phase3_validation_batches(id),
      validated_at TEXT NOT NULL
    ) STRICT;

    CREATE TABLE IF NOT EXISTS background_registry(
      background_id TEXT PRIMARY KEY,
      background_name TEXT NOT NULL UNIQUE,
      entity_version_id TEXT NOT NULL REFERENCES entity_versions(id),
      rules_version TEXT NOT NULL,
      source_id TEXT NOT NULL REFERENCES sources(id),
      source_title TEXT NOT NULL,
      source_page INTEGER NOT NULL,
      heading_score REAL NOT NULL,
      validation_scope TEXT NOT NULL,
      batch_id TEXT NOT NULL REFERENCES phase3_validation_batches(id),
      validated_at TEXT NOT NULL
    ) STRICT;

    CREATE TABLE IF NOT EXISTS feat_registry(
      feat_id TEXT PRIMARY KEY,
      feat_name TEXT NOT NULL UNIQUE,
      feat_type TEXT NOT NULL,
      entity_version_id TEXT NOT NULL REFERENCES entity_versions(id),
      rules_version TEXT NOT NULL,
      source_id TEXT NOT NULL REFERENCES sources(id),
      source_title TEXT NOT NULL,
      source_page INTEGER NOT NULL,
      heading_score REAL NOT NULL,
      validation_scope TEXT NOT NULL,
      batch_id TEXT NOT NULL REFERENCES phase3_validation_batches(id),
      validated_at TEXT NOT NULL
    ) STRICT;

    DROP VIEW IF EXISTS effective_species;
    CREATE VIEW effective_species AS
      SELECT r.*, ev.summary, ev.structured_json, ev.status AS entity_status
      FROM species_registry r
      JOIN entity_versions ev ON ev.id=r.entity_version_id;

    DROP VIEW IF EXISTS effective_backgrounds;
    CREATE VIEW effective_backgrounds AS
      SELECT r.*, ev.summary, ev.structured_json, ev.status AS entity_status
      FROM background_registry r
      JOIN entity_versions ev ON ev.id=r.entity_version_id;

    DROP VIEW IF EXISTS effective_feats;
    CREATE VIEW effective_feats AS
      SELECT r.*, ev.summary, ev.structured_json, ev.status AS entity_status
      FROM feat_registry r
      JOIN entity_versions ev ON ev.id=r.entity_version_id;
    """)
    db.commit()

def create_entity(
    db: sqlite3.Connection,
    *,
    category: str,
    name: str,
    source: sqlite3.Row,
    page: sqlite3.Row,
    block: str,
    structured: dict[str, Any],
) -> str:
    canonical_id = f"entity-phase3-2024-{category}-{slug(name)}"
    version_id = f"version-phase3-2024-{category}-{slug(name)}"
    canonical_key = f"{category}:{slug(name)}:2024"

    db.execute("""
        INSERT INTO canonical_entities(id,canonical_key,category,name)
        VALUES(?,?,?,?)
        ON CONFLICT(id) DO NOTHING
    """, (canonical_id, canonical_key, category, name))

    content_sha = hashlib.sha256(
        (
            source["id"] + "|" + str(page["page_number"]) + "|" +
            category + "|" + name + "|" + block
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
          subcategory=excluded.subcategory,
          summary=excluded.summary,
          structured_json=excluded.structured_json,
          raw_text=excluded.raw_text,
          source_page_start=excluded.source_page_start,
          source_page_end=excluded.source_page_end,
          status='validated',
          confidence=excluded.confidence,
          content_sha256=excluded.content_sha256
    """, (
        version_id,
        canonical_id,
        source["id"],
        source["current_revision_id"],
        f"phase3:{category}:{slug(name)}",
        category,
        structured.get("featType") or "",
        name,
        f"Validated 2024 {category} record for {name}.",
        json.dumps(structured, ensure_ascii=False, separators=(",", ":")),
        block,
        page["page_number"],
        page["page_number"],
        "2024",
        500,
        "validated",
        0.99,
        content_sha,
        now_iso(),
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

    deps = {
        "core": db.execute("SELECT COUNT(*) FROM core_rule_registry").fetchone()[0],
        "classes": db.execute("SELECT COUNT(*) FROM class_registry").fetchone()[0],
        "subclasses": db.execute("SELECT COUNT(*) FROM subclass_registry").fetchone()[0],
        "features": db.execute("SELECT COUNT(*) FROM class_feature_registry").fetchone()[0],
        "books": db.execute("SELECT COUNT(*) FROM sources WHERE source_kind LIKE 'official-%'").fetchone()[0],
    }
    if deps != {"core":75,"classes":12,"subclasses":48,"features":442,"books":13}:
        raise RuntimeError(f"Phase dependency mismatch: {deps}")

    ensure_schema(db)
    phb = get_phb(db)
    pages = get_pages(db, phb["current_revision_id"])
    phb_pdf_path = PROJECT_ROOT / "content-sources" / "books" / phb["filename"]
    if not phb_pdf_path.exists():
        raise RuntimeError(f"Missing PHB PDF: {phb_pdf_path}")

    batch_id = f"phase3-{datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ')}"

    species_manifest: list[dict[str, Any]] = []
    background_manifest: list[dict[str, Any]] = []
    feat_manifest: list[dict[str, Any]] = []

    for name in SPECIES:
        page, index, score, matched, recovery_method = find_heading_with_ocr_recovery(
            pages,
            name,
            *PAGE_RANGES["species"],
            pdf_path=phb_pdf_path,
            revision_id=phb["current_revision_id"],
        )
        block = extract_block(
            pages, "species", name, page["page_number"], index
        )
        if len(block) < 12:
            raise RuntimeError(f"Species source block too small: {name}")
        species_manifest.append({
            "name": name,
            "page": page,
            "score": score,
            "matched": matched,
            "recovery_method": recovery_method,
            "block": block,
            "structured": {
                **parse_species(name, block),
                "sourceRecoveryMethod": recovery_method,
            },
        })

    for name in BACKGROUNDS:
        page, index, score, matched, recovery_method = find_heading_with_ocr_recovery(
            pages,
            name,
            *PAGE_RANGES["background"],
            pdf_path=phb_pdf_path,
            revision_id=phb["current_revision_id"],
        )
        block = extract_block(
            pages, "background", name, page["page_number"], index
        )
        if len(block) < 12:
            raise RuntimeError(f"Background source block too small: {name}")
        background_manifest.append({
            "name": name,
            "page": page,
            "score": score,
            "matched": matched,
            "recovery_method": recovery_method,
            "block": block,
            "structured": {
                **parse_background(name, block),
                "sourceRecoveryMethod": recovery_method,
            },
        })

    for feat_type, names in FEATS.items():
        for name in names:
            page, index, score, matched, recovery_method = find_heading_with_ocr_recovery(
                pages,
                name,
                *PAGE_RANGES["feat"],
                pdf_path=phb_pdf_path,
                revision_id=phb["current_revision_id"],
            )
            block = extract_block(
                pages, "feat", name, page["page_number"], index
            )
            if len(block) < 12:
                raise RuntimeError(f"Feat source block too small: {name}")
            feat_manifest.append({
                "name": name,
                "feat_type": feat_type,
                "page": page,
                "score": score,
                "matched": matched,
                "recovery_method": recovery_method,
                "block": block,
                "structured": {
                    **parse_feat(name, feat_type, block),
                    "sourceRecoveryMethod": recovery_method,
                },
            })

    if len(species_manifest) != 10:
        raise RuntimeError(f"Expected 10 species, got {len(species_manifest)}")
    if len(background_manifest) != 16:
        raise RuntimeError(f"Expected 16 backgrounds, got {len(background_manifest)}")
    if len(feat_manifest) != 75:
        raise RuntimeError(f"Expected 75 feats, got {len(feat_manifest)}")

    if args.apply:
        db.execute("BEGIN IMMEDIATE")
        try:
            db.execute("""
                INSERT INTO phase3_validation_batches(
                  id,created_at,source_db_sha256,species_count,background_count,feat_count
                ) VALUES(?,?,?,?,?,?)
            """, (batch_id, now_iso(), db_sha_before, 10, 16, 75))

            for item in species_manifest:
                version_id = create_entity(
                    db,
                    category="species",
                    name=item["name"],
                    source=phb,
                    page=item["page"],
                    block=item["block"],
                    structured=item["structured"],
                )
                db.execute("""
                    INSERT INTO species_registry(
                      species_id,species_name,entity_version_id,rules_version,
                      source_id,source_title,source_page,heading_score,
                      validation_scope,batch_id,validated_at
                    ) VALUES(?,?,?,?,?,?,?,?,?,?,?)
                    ON CONFLICT(species_id) DO UPDATE SET
                      entity_version_id=excluded.entity_version_id,
                      source_page=excluded.source_page,
                      heading_score=excluded.heading_score,
                      batch_id=excluded.batch_id,
                      validated_at=excluded.validated_at
                """, (
                    f"species.{slug(item['name'])}",
                    item["name"],
                    version_id,
                    "2024",
                    phb["id"],
                    phb["title"],
                    item["page"]["page_number"],
                    item["score"],
                    "identity-source-block-plus-safe-fields",
                    batch_id,
                    now_iso(),
                ))

            for item in background_manifest:
                version_id = create_entity(
                    db,
                    category="background",
                    name=item["name"],
                    source=phb,
                    page=item["page"],
                    block=item["block"],
                    structured=item["structured"],
                )
                db.execute("""
                    INSERT INTO background_registry(
                      background_id,background_name,entity_version_id,rules_version,
                      source_id,source_title,source_page,heading_score,
                      validation_scope,batch_id,validated_at
                    ) VALUES(?,?,?,?,?,?,?,?,?,?,?)
                    ON CONFLICT(background_id) DO UPDATE SET
                      entity_version_id=excluded.entity_version_id,
                      source_page=excluded.source_page,
                      heading_score=excluded.heading_score,
                      batch_id=excluded.batch_id,
                      validated_at=excluded.validated_at
                """, (
                    f"background.{slug(item['name'])}",
                    item["name"],
                    version_id,
                    "2024",
                    phb["id"],
                    phb["title"],
                    item["page"]["page_number"],
                    item["score"],
                    "identity-source-block-plus-safe-fields",
                    batch_id,
                    now_iso(),
                ))

            for item in feat_manifest:
                version_id = create_entity(
                    db,
                    category="feat",
                    name=item["name"],
                    source=phb,
                    page=item["page"],
                    block=item["block"],
                    structured=item["structured"],
                )
                db.execute("""
                    INSERT INTO feat_registry(
                      feat_id,feat_name,feat_type,entity_version_id,rules_version,
                      source_id,source_title,source_page,heading_score,
                      validation_scope,batch_id,validated_at
                    ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)
                    ON CONFLICT(feat_id) DO UPDATE SET
                      entity_version_id=excluded.entity_version_id,
                      feat_type=excluded.feat_type,
                      source_page=excluded.source_page,
                      heading_score=excluded.heading_score,
                      batch_id=excluded.batch_id,
                      validated_at=excluded.validated_at
                """, (
                    f"feat.{slug(item['name'])}",
                    item["name"],
                    item["feat_type"],
                    version_id,
                    "2024",
                    phb["id"],
                    phb["title"],
                    item["page"]["page_number"],
                    item["score"],
                    "identity-source-block-plus-safe-fields",
                    batch_id,
                    now_iso(),
                ))

            db.commit()
        except Exception:
            db.rollback()
            raise

    species_count = db.execute("SELECT COUNT(*) FROM species_registry").fetchone()[0]
    background_count = db.execute("SELECT COUNT(*) FROM background_registry").fetchone()[0]
    feat_count = db.execute("SELECT COUNT(*) FROM feat_registry").fetchone()[0]

    feat_type_counts = {
        row["feat_type"]: row["n"]
        for row in db.execute("""
            SELECT feat_type, COUNT(*) AS n
            FROM feat_registry
            GROUP BY feat_type
            ORDER BY feat_type
        """)
    }

    report = {
        "batchId": batch_id,
        "applied": args.apply,
        "dependencies": deps,
        "speciesRegistryCount": species_count,
        "backgroundRegistryCount": background_count,
        "featRegistryCount": feat_count,
        "featTypeCounts": feat_type_counts,
        "sourceRecoveryCounts": {
            "speciesTargetedOcr": sum(
                1 for x in species_manifest if x.get("recovery_method") != "raw-pages"
            ),
            "backgroundTargetedOcr": sum(
                1 for x in background_manifest if x.get("recovery_method") != "raw-pages"
            ),
            "featTargetedOcr": sum(
                1 for x in feat_manifest if x.get("recovery_method") != "raw-pages"
            ),
        },
        "sourceBlockMinimumLengths": {
            "species": min(len(x["block"]) for x in species_manifest),
            "background": min(len(x["block"]) for x in background_manifest),
            "feat": min(len(x["block"]) for x in feat_manifest),
        },
        "policy": {
            "rulesVersion": "2024",
            "source": "Player's Handbook",
            "legacyPreserved": True,
            "noisyAuditCandidatesPromoted": False,
            "validationScope": "identity-source-block-plus-safe-fields",
        },
    }
    (output / "phase3_validation_report.json").write_text(
        json.dumps(report, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )

    def table_rows(query: str) -> list[dict[str, Any]]:
        return [dict(row) for row in db.execute(query)]

    species_rows = table_rows("SELECT * FROM species_registry ORDER BY species_name")
    background_rows = table_rows("SELECT * FROM background_registry ORDER BY background_name")
    feat_rows = table_rows("SELECT * FROM feat_registry ORDER BY feat_type,feat_name")

    for filename, rows in (
        ("species_registry", species_rows),
        ("background_registry", background_rows),
        ("feat_registry", feat_rows),
    ):
        (output / f"{filename}.json").write_text(
            json.dumps(rows, ensure_ascii=False, indent=2) + "\n",
            encoding="utf-8",
        )
        if rows:
            with (output / f"{filename}.csv").open(
                "w", encoding="utf-8-sig", newline=""
            ) as handle:
                writer = csv.DictWriter(handle, fieldnames=list(rows[0].keys()))
                writer.writeheader()
                writer.writerows(rows)

    summary = [
        "# Phase 3 Validation",
        "",
        f"- Species: **{species_count}**",
        f"- Backgrounds: **{background_count}**",
        f"- Feats: **{feat_count}**",
        "",
        "## Feat Types",
    ]
    for key, value in sorted(feat_type_counts.items()):
        summary.append(f"- {key}: {value}")

    (output / "PHASE3_VALIDATION_SUMMARY.md").write_text(
        "\n".join(summary) + "\n",
        encoding="utf-8",
        newline="\n",
    )

    db.close()

    print("PHASE 3 VALIDATION COMPLETE")
    print(f"APPLIED={args.apply}")
    print(f"SPECIES={species_count}")
    print(f"BACKGROUNDS={background_count}")
    print(f"FEATS={feat_count}")
    print(
        "TARGETED_OCR="
        f"species:{sum(1 for x in species_manifest if x.get('recovery_method') != 'raw-pages')},"
        f"backgrounds:{sum(1 for x in background_manifest if x.get('recovery_method') != 'raw-pages')},"
        f"feats:{sum(1 for x in feat_manifest if x.get('recovery_method') != 'raw-pages')}"
    )
    print(
        "MIN_SOURCE_BLOCK="
        f"species:{min(len(x['block']) for x in species_manifest)},"
        f"backgrounds:{min(len(x['block']) for x in background_manifest)},"
        f"feats:{min(len(x['block']) for x in feat_manifest)}"
    )
    print(f"OUTPUT={output}")
    return 0

if __name__ == "__main__":
    raise SystemExit(main())
