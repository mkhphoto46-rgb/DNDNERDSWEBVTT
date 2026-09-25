from __future__ import annotations

import argparse
import csv
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
OUTPUT_ROOT = PROJECT_ROOT / "_phase2_classes_validation"

BASELINE = {
    "sources": 14,
    "categories": 35,
    "entities": 18641,
    "validated": 1123,
    "extracted": 17518,
    "books": 13,
    "core_registry": 75,
}

CLASS_RANGES = {
    "Barbarian": (48, 56),
    "Bard": (57, 67),
    "Cleric": (68, 77),
    "Druid": (78, 88),
    "Fighter": (89, 98),
    "Monk": (99, 107),
    "Paladin": (108, 117),
    "Ranger": (118, 127),
    "Rogue": (128, 137),
    "Sorcerer": (138, 149),
    "Warlock": (150, 161),
    "Wizard": (162, 175),
}

SUBCLASSES: dict[str, list[tuple[str, list[str]]]] = {
    "Barbarian": [
        ("Path of the Berserker", ["Path of the Berserker", "Berserker"]),
        ("Path of the Wild Heart", ["Path of the Wild Heart", "Wild Heart"]),
        ("Path of the World Tree", ["Path of the World Tree", "World Tree"]),
        ("Path of the Zealot", ["Path of the Zealot", "Zealot"]),
    ],
    "Bard": [
        ("College of Dance", ["College of Dance"]),
        ("College of Glamour", ["College of Glamour", "Glamour"]),
        ("College of Lore", ["College of Lore", "Lore"]),
        ("College of Valor", ["College of Valor", "Valor"]),
    ],
    "Cleric": [
        ("Life Domain", ["Life Domain"]),
        ("Light Domain", ["Light Domain"]),
        ("Trickery Domain", ["Trickery Domain"]),
        ("War Domain", ["War Domain"]),
    ],
    "Druid": [
        ("Circle of the Land", ["Circle of the Land"]),
        ("Circle of the Moon", ["Circle of the Moon"]),
        ("Circle of the Sea", ["Circle of the Sea"]),
        ("Circle of the Stars", ["Circle of the Stars"]),
    ],
    "Fighter": [
        ("Battle Master", ["Battle Master"]),
        ("Champion", ["Champion"]),
        ("Eldritch Knight", ["Eldritch Knight"]),
        ("Psi Warrior", ["Psi Warrior"]),
    ],
    "Monk": [
        ("Warrior of Mercy", ["Warrior of Mercy", "Mercy"]),
        ("Warrior of the Elements", ["Warrior of the Elements", "Elements"]),
        ("Warrior of the Open Hand", ["Warrior of the Open Hand", "Open Hand"]),
        ("Warrior of Shadow", ["Warrior of Shadow", "Shadow"]),
    ],
    "Paladin": [
        ("Oath of Devotion", ["Oath of Devotion"]),
        ("Oath of Glory", ["Oath of Glory"]),
        ("Oath of the Ancients", ["Oath of the Ancients"]),
        ("Oath of Vengeance", ["Oath of Vengeance"]),
    ],
    "Ranger": [
        ("Beast Master", ["Beast Master"]),
        ("Fey Wanderer", ["Fey Wanderer"]),
        ("Gloom Stalker", ["Gloom Stalker"]),
        ("Hunter", ["Hunter"]),
    ],
    "Rogue": [
        ("Arcane Trickster", ["Arcane Trickster"]),
        ("Assassin", ["Assassin"]),
        ("Soulknife", ["Soulknife"]),
        ("Thief", ["Thief"]),
    ],
    "Sorcerer": [
        ("Aberrant Sorcery", ["Aberrant Sorcery", "Aberrant"]),
        ("Clockwork Sorcery", ["Clockwork Sorcery", "Clockwork"]),
        ("Draconic Sorcery", ["Draconic Sorcery", "Draconic"]),
        ("Wild Magic", ["Wild Magic"]),
    ],
    "Warlock": [
        ("Archfey Patron", ["Archfey Patron", "Archfey"]),
        ("Celestial Patron", ["Celestial Patron", "Celestial"]),
        ("Fiend Patron", ["Fiend Patron", "Fiend"]),
        ("Great Old One Patron", ["Great Old One Patron", "Great Old One"]),
    ],
    "Wizard": [
        ("Abjurer", ["Abjurer", "School of Abjuration"]),
        ("Diviner", ["Diviner", "School of Divination"]),
        ("Evoker", ["Evoker", "School of Evocation"]),
        ("Illusionist", ["Illusionist", "School of Illusion"]),
    ],
}

def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()

def sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()

def norm(value: str) -> str:
    return re.sub(r"[^a-z0-9]+", " ", (value or "").casefold()).strip()

def slug(value: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", (value or "").casefold()).strip("-")

def clean(value: str) -> str:
    return re.sub(r"\s+", " ", value or "").strip()

def count_baseline(db: sqlite3.Connection) -> dict[str, int]:
    return {
        "sources": db.execute("SELECT COUNT(*) FROM sources").fetchone()[0],
        "categories": db.execute("SELECT COUNT(*) FROM category_catalog").fetchone()[0],
        "entities": db.execute("SELECT COUNT(*) FROM current_entity_versions").fetchone()[0],
        "validated": db.execute("SELECT COUNT(*) FROM current_entity_versions WHERE status='validated'").fetchone()[0],
        "extracted": db.execute("SELECT COUNT(*) FROM current_entity_versions WHERE status='extracted'").fetchone()[0],
        "books": db.execute("SELECT COUNT(*) FROM sources WHERE source_kind LIKE 'official-%'").fetchone()[0],
        "core_registry": db.execute("SELECT COUNT(*) FROM core_rule_registry").fetchone()[0],
    }

def ensure_schema(db: sqlite3.Connection) -> None:
    db.executescript("""
    CREATE TABLE IF NOT EXISTS class_validation_batches(
      id TEXT PRIMARY KEY,
      created_at TEXT NOT NULL,
      source_db_sha256 TEXT NOT NULL,
      class_count INTEGER NOT NULL,
      subclass_count INTEGER NOT NULL,
      feature_count INTEGER NOT NULL,
      synthetic_feature_count INTEGER NOT NULL
    ) STRICT;

    CREATE TABLE IF NOT EXISTS class_registry(
      class_id TEXT PRIMARY KEY,
      class_name TEXT NOT NULL,
      entity_version_id TEXT NOT NULL REFERENCES entity_versions(id),
      rules_version TEXT NOT NULL,
      source_id TEXT NOT NULL REFERENCES sources(id),
      source_title TEXT NOT NULL,
      source_page INTEGER,
      validation_scope TEXT NOT NULL,
      batch_id TEXT NOT NULL REFERENCES class_validation_batches(id),
      validated_at TEXT NOT NULL
    ) STRICT;

    CREATE TABLE IF NOT EXISTS subclass_registry(
      subclass_id TEXT PRIMARY KEY,
      class_name TEXT NOT NULL,
      subclass_name TEXT NOT NULL,
      entity_version_id TEXT NOT NULL REFERENCES entity_versions(id),
      rules_version TEXT NOT NULL,
      source_id TEXT NOT NULL REFERENCES sources(id),
      source_title TEXT NOT NULL,
      source_page INTEGER,
      match_method TEXT NOT NULL,
      validation_scope TEXT NOT NULL,
      batch_id TEXT NOT NULL REFERENCES class_validation_batches(id),
      validated_at TEXT NOT NULL
    ) STRICT;

    CREATE TABLE IF NOT EXISTS class_feature_registry(
      feature_id TEXT PRIMARY KEY,
      class_name TEXT NOT NULL,
      subclass_name TEXT,
      feature_name TEXT NOT NULL,
      feature_level INTEGER,
      entity_version_id TEXT NOT NULL REFERENCES entity_versions(id),
      rules_version TEXT NOT NULL,
      source_id TEXT NOT NULL REFERENCES sources(id),
      source_title TEXT NOT NULL,
      source_page INTEGER,
      validation_scope TEXT NOT NULL,
      batch_id TEXT NOT NULL REFERENCES class_validation_batches(id),
      validated_at TEXT NOT NULL
    ) STRICT;

    DROP VIEW IF EXISTS effective_classes;
    CREATE VIEW effective_classes AS
      SELECT r.*, ev.name, ev.summary, ev.structured_json, ev.status AS entity_status
      FROM class_registry r
      JOIN entity_versions ev ON ev.id=r.entity_version_id;

    DROP VIEW IF EXISTS effective_subclasses;
    CREATE VIEW effective_subclasses AS
      SELECT r.*, ev.name, ev.summary, ev.structured_json, ev.status AS entity_status
      FROM subclass_registry r
      JOIN entity_versions ev ON ev.id=r.entity_version_id;

    DROP VIEW IF EXISTS effective_class_features;
    CREATE VIEW effective_class_features AS
      SELECT r.*, ev.name, ev.summary, ev.structured_json, ev.status AS entity_status
      FROM class_feature_registry r
      JOIN entity_versions ev ON ev.id=r.entity_version_id;
    """)
    db.commit()

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

def create_synthetic_entity(
    db: sqlite3.Connection,
    *,
    canonical_id: str,
    version_id: str,
    canonical_key: str,
    category: str,
    name: str,
    source: sqlite3.Row,
    page: sqlite3.Row,
    structured: dict[str, Any],
    raw_text: str,
    summary: str,
) -> None:
    db.execute("""
        INSERT INTO canonical_entities(id,canonical_key,category,name)
        VALUES(?,?,?,?)
        ON CONFLICT(id) DO NOTHING
    """, (canonical_id, canonical_key, category, name))

    content_sha = hashlib.sha256(
        (
            source["id"] + "|" + str(page["page_number"]) + "|" + category + "|" +
            name + "|" + raw_text
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
        f"phase2:{category}:{canonical_key}",
        category,
        structured.get("subclassName") or "",
        name,
        summary,
        json.dumps(structured, ensure_ascii=False, separators=(",", ":")),
        raw_text,
        page["page_number"],
        page["page_number"],
        "2024",
        500,
        "validated",
        0.99,
        content_sha,
        now_iso(),
    ))

def heading_score(text: str, aliases: list[str]) -> int:
    score = 0
    lines = [clean(line) for line in (text or "").splitlines() if clean(line)]
    low_text = norm(text)
    for alias in aliases:
        n = norm(alias)
        if n and n in low_text:
            score = max(score, 100)
        for line in lines:
            line_n = norm(line)
            if line_n == n:
                score = max(score, 1000)
            elif line_n.startswith(n) and len(line_n) <= len(n) + 30:
                score = max(score, 800)
            elif n and n in line_n and len(line_n) <= len(n) + 50:
                score = max(score, 500)
    return score

def first_available_page(
    pages: dict[int, sqlite3.Row],
    start: int,
    end: int,
) -> sqlite3.Row:
    for page_no in range(start, end + 1):
        page = pages.get(page_no)
        if page is not None:
            return page
    raise RuntimeError(f"No raw page exists in expected range {start}-{end}.")

def find_subclass_page(
    pages: dict[int, sqlite3.Row],
    class_name: str,
    aliases: list[str],
) -> tuple[sqlite3.Row, str]:
    start, end = CLASS_RANGES[class_name]
    scored: list[tuple[int, int, sqlite3.Row]] = []

    for page_no in range(start, end + 1):
        page = pages.get(page_no)
        if page is None:
            continue
        score = heading_score(page["text"], aliases)
        if score:
            scored.append((score, page_no, page))

    if scored:
        scored.sort(key=lambda x: (x[0], x[1]), reverse=True)
        return scored[0][2], "heading-or-exact-text"

    # Safe fallback: use the class subclass-overview page, never another book.
    overview: list[tuple[int, sqlite3.Row]] = []
    for page_no in range(start, end + 1):
        page = pages.get(page_no)
        if page is None:
            continue
        text_n = norm(page["text"])
        if "subclass" in text_n or "subclasses" in text_n:
            overview.append((page_no, page))

    if overview:
        overview.sort(key=lambda x: x[0])
        return overview[0][1], "class-subclass-overview-fallback"

    page = first_available_page(pages, start, end)
    return page, "class-section-fallback"

def normalize_level_token(token: str) -> int | None:
    token = token.strip().upper().replace("O", "0").replace("I", "1").replace("L", "1")
    if not token.isdigit():
        return None
    value = int(token)
    return value if 1 <= value <= 20 else None

LEVEL_HEADING = re.compile(
    r"(?i)^\s*L\s*E\s*V\s*E\s*L\s*([0-9OIL]{1,2})\s*[:.]\s*(.+?)\s*$"
)

def clean_feature_title(title: str) -> str:
    title = clean(title)
    title = re.sub(r"\s{2,}", " ", title)
    return title.strip(" -–—:;.")

def valid_feature_title(title: str) -> bool:
    n = norm(title)
    if not n or len(title) < 3 or len(title) > 90:
        return False
    bad = (
        "chapter ", "spell list", " spells", "spell school", "cantrips",
        "experience points", "character level", "proficiency bonus",
    )
    if any(term in n for term in bad):
        return False
    if sum(ch.isalpha() for ch in title) < 3:
        return False
    return True

def extract_level_features(
    pages: dict[int, sqlite3.Row],
    class_name: str,
    subclass_starts: list[tuple[int, str]],
) -> list[dict[str, Any]]:
    start, end = CLASS_RANGES[class_name]
    out: list[dict[str, Any]] = []

    for page_no in range(start, end + 1):
        page = pages.get(page_no)
        if page is None:
            continue

        lines = page["text"].splitlines()
        for i, line in enumerate(lines):
            match = LEVEL_HEADING.match(line)
            if not match:
                continue

            level = normalize_level_token(match.group(1))
            title = clean_feature_title(match.group(2))
            if level is None or not valid_feature_title(title):
                continue

            subclass_name = None
            eligible = [(p, n) for p, n in subclass_starts if p <= page_no]
            if eligible:
                eligible.sort(key=lambda x: x[0])
                latest_page, latest_name = eligible[-1]
                # Only attribute to subclass after a real subclass section page.
                if latest_page >= start + 2:
                    subclass_name = latest_name

            body_lines = [line]
            for follow in lines[i + 1:]:
                if LEVEL_HEADING.match(follow):
                    break
                if len("\n".join(body_lines)) > 2600:
                    break
                body_lines.append(follow)

            raw_block = clean("\n".join(body_lines))
            key = (
                class_name,
                subclass_name or "",
                level,
                norm(title),
            )
            out.append({
                "key": key,
                "class_name": class_name,
                "subclass_name": subclass_name,
                "level": level,
                "title": title,
                "page": page,
                "raw_block": raw_block,
            })

    dedup: dict[tuple[Any, ...], dict[str, Any]] = {}
    for item in out:
        existing = dedup.get(item["key"])
        if existing is None or len(item["raw_block"]) > len(existing["raw_block"]):
            dedup[item["key"]] = item
    return list(dedup.values())

def infer_srd_feature_parent(row: sqlite3.Row) -> tuple[str, int | None]:
    try:
        structured = json.loads(row["structured_json"] or "{}")
    except Exception:
        structured = {}

    parent = ""
    for key in ("class", "className", "parentClass", "parent_class", "class_name"):
        value = structured.get(key)
        if isinstance(value, str) and value in CLASS_RANGES:
            parent = value
            break

    if not parent:
        text = norm(f'{row["name"]} {row["summary"]} {row["raw_text"]} {row["subcategory"]}')
        for class_name in CLASS_RANGES:
            if re.search(rf"\b{re.escape(norm(class_name))}\b", text):
                parent = class_name
                break

    level = None
    for key in ("level", "classLevel", "levelRequired", "unlockLevel", "requiredLevel"):
        value = structured.get(key)
        if isinstance(value, int) and 1 <= value <= 20:
            level = value
            break
        if isinstance(value, str) and value.isdigit() and 1 <= int(value) <= 20:
            level = int(value)
            break

    return parent, level

def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--apply", action="store_true")
    parser.add_argument("--output", default=str(OUTPUT_ROOT))
    args = parser.parse_args()

    output = Path(args.output)
    output.mkdir(parents=True, exist_ok=True)

    if not DB_PATH.exists():
        raise RuntimeError(f"Missing DB: {DB_PATH}")

    db_sha_before = sha256_file(DB_PATH)
    db = sqlite3.connect(DB_PATH)
    db.row_factory = sqlite3.Row
    db.execute("PRAGMA foreign_keys=ON")

    baseline = count_baseline(db)
    for key, expected in BASELINE.items():
        if baseline[key] != expected:
            raise RuntimeError(
                f"Phase 2 baseline mismatch for {key}: expected {expected}, got {baseline[key]}"
            )

    if db.execute("PRAGMA integrity_check").fetchone()[0] != "ok":
        raise RuntimeError("SQLite integrity check failed.")

    ensure_schema(db)
    phb = get_phb(db)
    pages = get_pages(db, phb["current_revision_id"])

    batch_id = f"phase2-classes-{datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ')}"

    class_manifest: list[dict[str, Any]] = []
    subclass_manifest: list[dict[str, Any]] = []
    synthetic_features: list[dict[str, Any]] = []

    subclass_start_by_class: dict[str, list[tuple[int, str]]] = {}

    for class_name, (start, end) in CLASS_RANGES.items():
        page = first_available_page(pages, start, end)

        class_manifest.append({
            "class_name": class_name,
            "source_page": page["page_number"],
            "source_title": phb["title"],
        })

        starts: list[tuple[int, str]] = []
        for subclass_name, aliases in SUBCLASSES[class_name]:
            sub_page, method = find_subclass_page(pages, class_name, aliases)
            starts.append((sub_page["page_number"], subclass_name))
            subclass_manifest.append({
                "class_name": class_name,
                "subclass_name": subclass_name,
                "source_page": sub_page["page_number"],
                "match_method": method,
                "source_title": phb["title"],
            })
        subclass_start_by_class[class_name] = starts

        synthetic_features.extend(
            extract_level_features(pages, class_name, starts)
        )

    # Register the existing validated SRD 5.2.1 class features too.
    srd_rows = db.execute("""
        SELECT ev.*, s.title AS source_title, s.filename AS source_filename
        FROM current_entity_versions ev
        JOIN sources s ON s.id=ev.source_id
        WHERE ev.category='class-feature'
          AND ev.rules_version='2024'
          AND ev.status IN ('validated','engine-ready','automated','tested')
          AND s.title='SRD 5.2.1'
        ORDER BY ev.name
    """).fetchall()

    srd_features: list[dict[str, Any]] = []
    for row in srd_rows:
        parent, level = infer_srd_feature_parent(row)
        if not parent:
            continue
        srd_features.append({
            "class_name": parent,
            "subclass_name": None,
            "feature_name": clean(row["name"]),
            "feature_level": level,
            "entity_version_id": row["id"],
            "source_id": row["source_id"],
            "source_title": row["source_title"],
            "source_page": row["source_page_start"],
            "validation_scope": "structured-open-rule",
        })

    if len(class_manifest) != 12:
        raise RuntimeError(f"Expected 12 classes, got {len(class_manifest)}")
    if len(subclass_manifest) != 48:
        raise RuntimeError(f"Expected 48 subclasses, got {len(subclass_manifest)}")
    if len(srd_features) < 200:
        raise RuntimeError(f"Expected at least 200 validated SRD class features, got {len(srd_features)}")

    if args.apply:
        db.execute("BEGIN IMMEDIATE")
        try:
            # Insert classes.
            for item in class_manifest:
                class_name = item["class_name"]
                page = pages[item["source_page"]]
                canonical_id = f"entity-class-2024-{slug(class_name)}"
                version_id = f"version-class-2024-{slug(class_name)}"
                create_synthetic_entity(
                    db,
                    canonical_id=canonical_id,
                    version_id=version_id,
                    canonical_key=f"class:{slug(class_name)}:2024",
                    category="class",
                    name=class_name,
                    source=phb,
                    page=page,
                    structured={
                        "className": class_name,
                        "rulesVersion": "2024",
                        "validationScope": "identity-and-source",
                    },
                    raw_text=clean(page["text"])[:3200],
                    summary=f"Validated 2024 class identity for {class_name}.",
                )
                item["entity_version_id"] = version_id

            # Insert subclasses.
            for item in subclass_manifest:
                class_name = item["class_name"]
                subclass_name = item["subclass_name"]
                page = pages[item["source_page"]]
                canonical_id = (
                    f"entity-subclass-2024-{slug(class_name)}-{slug(subclass_name)}"
                )
                version_id = (
                    f"version-subclass-2024-{slug(class_name)}-{slug(subclass_name)}"
                )
                create_synthetic_entity(
                    db,
                    canonical_id=canonical_id,
                    version_id=version_id,
                    canonical_key=(
                        f"subclass:{slug(class_name)}:{slug(subclass_name)}:2024"
                    ),
                    category="subclass",
                    name=subclass_name,
                    source=phb,
                    page=page,
                    structured={
                        "className": class_name,
                        "subclassName": subclass_name,
                        "rulesVersion": "2024",
                        "validationScope": "identity-and-source",
                        "matchMethod": item["match_method"],
                    },
                    raw_text=clean(page["text"])[:3200],
                    summary=(
                        f"Validated 2024 subclass identity for "
                        f"{class_name} / {subclass_name}."
                    ),
                )
                item["entity_version_id"] = version_id

            synthetic_feature_rows: list[dict[str, Any]] = []
            for feature in synthetic_features:
                class_name = feature["class_name"]
                subclass_name = feature["subclass_name"]
                level = feature["level"]
                title = feature["title"]
                page = feature["page"]

                parent_slug = slug(subclass_name) if subclass_name else "base"
                canonical_id = (
                    f"entity-class-feature-2024-{slug(class_name)}-"
                    f"{parent_slug}-{level}-{slug(title)}"
                )
                version_id = (
                    f"version-class-feature-2024-{slug(class_name)}-"
                    f"{parent_slug}-{level}-{slug(title)}"
                )
                create_synthetic_entity(
                    db,
                    canonical_id=canonical_id,
                    version_id=version_id,
                    canonical_key=(
                        f"class-feature:{slug(class_name)}:{parent_slug}:"
                        f"{level}:{slug(title)}:2024"
                    ),
                    category="class-feature",
                    name=title,
                    source=phb,
                    page=page,
                    structured={
                        "className": class_name,
                        "subclassName": subclass_name,
                        "level": level,
                        "featureName": title,
                        "rulesVersion": "2024",
                        "validationScope": "heading-level-source-text",
                    },
                    raw_text=feature["raw_block"],
                    summary=(
                        f"Validated 2024 feature heading for {class_name}"
                        + (f" / {subclass_name}" if subclass_name else "")
                        + f" at level {level}: {title}."
                    ),
                )
                synthetic_feature_rows.append({
                    "class_name": class_name,
                    "subclass_name": subclass_name,
                    "feature_name": title,
                    "feature_level": level,
                    "entity_version_id": version_id,
                    "source_id": phb["id"],
                    "source_title": phb["title"],
                    "source_page": page["page_number"],
                    "validation_scope": "heading-level-source-text",
                })

            # Prefer PHB feature records for matching class/level/name; use SRD to
            # fill structured/open features that the strict heading parser did not recover.
            feature_map: dict[tuple[str, int | None, str], dict[str, Any]] = {}
            for row in srd_features:
                key = (
                    row["class_name"],
                    row["feature_level"],
                    norm(row["feature_name"]),
                )
                feature_map[key] = row

            for row in synthetic_feature_rows:
                key = (
                    row["class_name"],
                    row["feature_level"],
                    norm(row["feature_name"]),
                )
                feature_map[key] = row

            final_features = list(feature_map.values())

            db.execute("""
                INSERT INTO class_validation_batches(
                  id,created_at,source_db_sha256,class_count,subclass_count,
                  feature_count,synthetic_feature_count
                ) VALUES(?,?,?,?,?,?,?)
            """, (
                batch_id,
                now_iso(),
                db_sha_before,
                len(class_manifest),
                len(subclass_manifest),
                len(final_features),
                len(synthetic_feature_rows),
            ))

            for item in class_manifest:
                db.execute("""
                    INSERT INTO class_registry(
                      class_id,class_name,entity_version_id,rules_version,source_id,
                      source_title,source_page,validation_scope,batch_id,validated_at
                    ) VALUES(?,?,?,?,?,?,?,?,?,?)
                    ON CONFLICT(class_id) DO UPDATE SET
                      entity_version_id=excluded.entity_version_id,
                      rules_version=excluded.rules_version,
                      source_id=excluded.source_id,
                      source_title=excluded.source_title,
                      source_page=excluded.source_page,
                      validation_scope=excluded.validation_scope,
                      batch_id=excluded.batch_id,
                      validated_at=excluded.validated_at
                """, (
                    f"class.{slug(item['class_name'])}",
                    item["class_name"],
                    item["entity_version_id"],
                    "2024",
                    phb["id"],
                    phb["title"],
                    item["source_page"],
                    "identity-and-source",
                    batch_id,
                    now_iso(),
                ))

            for item in subclass_manifest:
                db.execute("""
                    INSERT INTO subclass_registry(
                      subclass_id,class_name,subclass_name,entity_version_id,
                      rules_version,source_id,source_title,source_page,match_method,
                      validation_scope,batch_id,validated_at
                    ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)
                    ON CONFLICT(subclass_id) DO UPDATE SET
                      entity_version_id=excluded.entity_version_id,
                      rules_version=excluded.rules_version,
                      source_id=excluded.source_id,
                      source_title=excluded.source_title,
                      source_page=excluded.source_page,
                      match_method=excluded.match_method,
                      validation_scope=excluded.validation_scope,
                      batch_id=excluded.batch_id,
                      validated_at=excluded.validated_at
                """, (
                    (
                        f"subclass.{slug(item['class_name'])}."
                        f"{slug(item['subclass_name'])}"
                    ),
                    item["class_name"],
                    item["subclass_name"],
                    item["entity_version_id"],
                    "2024",
                    phb["id"],
                    phb["title"],
                    item["source_page"],
                    item["match_method"],
                    "identity-and-source",
                    batch_id,
                    now_iso(),
                ))

            db.execute("DELETE FROM class_feature_registry")
            for item in final_features:
                feature_id = (
                    f"feature.{slug(item['class_name'])}."
                    f"{slug(item['subclass_name'] or 'base')}."
                    f"{item['feature_level'] if item['feature_level'] is not None else 'x'}."
                    f"{slug(item['feature_name'])}"
                )
                db.execute("""
                    INSERT OR REPLACE INTO class_feature_registry(
                      feature_id,class_name,subclass_name,feature_name,feature_level,
                      entity_version_id,rules_version,source_id,source_title,source_page,
                      validation_scope,batch_id,validated_at
                    ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)
                """, (
                    feature_id,
                    item["class_name"],
                    item["subclass_name"],
                    item["feature_name"],
                    item["feature_level"],
                    item["entity_version_id"],
                    "2024",
                    item["source_id"],
                    item["source_title"],
                    item["source_page"],
                    item["validation_scope"],
                    batch_id,
                    now_iso(),
                ))

            db.commit()
        except Exception:
            db.rollback()
            raise

    # Reports from current DB state.
    class_count = db.execute("SELECT COUNT(*) FROM class_registry").fetchone()[0]
    subclass_count = db.execute("SELECT COUNT(*) FROM subclass_registry").fetchone()[0]
    feature_count = db.execute("SELECT COUNT(*) FROM class_feature_registry").fetchone()[0]

    fallback_subclasses = db.execute("""
        SELECT COUNT(*) FROM subclass_registry
        WHERE match_method <> 'heading-or-exact-text'
    """).fetchone()[0]

    feature_source_counts = {
        row["source_title"]: row["n"]
        for row in db.execute("""
            SELECT source_title, COUNT(*) AS n
            FROM class_feature_registry
            GROUP BY source_title
        """)
    }

    after = count_baseline(db)
    report = {
        "batchId": batch_id,
        "applied": args.apply,
        "baselineBefore": baseline,
        "statusAfter": after,
        "classRegistryCount": class_count,
        "subclassRegistryCount": subclass_count,
        "featureRegistryCount": feature_count,
        "fallbackSubclassCount": fallback_subclasses,
        "strictSyntheticFeatureCandidates": len(synthetic_features),
        "validatedSrdFeatureInputs": len(srd_features),
        "featureSourceCounts": feature_source_counts,
        "policy": {
            "2024Only": True,
            "classes": "2024 PHB identity/source validated",
            "subclasses": "48 canonical 2024 PHB subclass identities",
            "features": "validated SRD features plus strict PHB LEVEL-heading recovery",
            "noisyPdfCandidatesPromoted": False,
            "legacyPreserved": True,
        },
    }

    (output / "phase2_validation_report.json").write_text(
        json.dumps(report, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )

    classes_out = [
        dict(row)
        for row in db.execute("""
            SELECT * FROM class_registry ORDER BY class_name
        """)
    ]
    subclasses_out = [
        dict(row)
        for row in db.execute("""
            SELECT * FROM subclass_registry ORDER BY class_name,subclass_name
        """)
    ]
    features_out = [
        dict(row)
        for row in db.execute("""
            SELECT * FROM class_feature_registry
            ORDER BY class_name,subclass_name,feature_level,feature_name
        """)
    ]

    (output / "classes_registry.json").write_text(
        json.dumps(classes_out, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    (output / "subclasses_registry.json").write_text(
        json.dumps(subclasses_out, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    (output / "class_features_registry.json").write_text(
        json.dumps(features_out, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )

    def write_csv(name: str, rows: list[dict[str, Any]]) -> None:
        if not rows:
            return
        with (output / name).open("w", encoding="utf-8-sig", newline="") as handle:
            writer = csv.DictWriter(handle, fieldnames=list(rows[0].keys()))
            writer.writeheader()
            writer.writerows(rows)

    write_csv("classes_registry.csv", classes_out)
    write_csv("subclasses_registry.csv", subclasses_out)
    write_csv("class_features_registry.csv", features_out)

    coverage: list[dict[str, Any]] = []
    for class_name in CLASS_RANGES:
        coverage.append({
            "class_name": class_name,
            "class_registered": db.execute(
                "SELECT COUNT(*) FROM class_registry WHERE class_name=?",
                (class_name,),
            ).fetchone()[0],
            "subclasses_registered": db.execute(
                "SELECT COUNT(*) FROM subclass_registry WHERE class_name=?",
                (class_name,),
            ).fetchone()[0],
            "features_registered": db.execute(
                "SELECT COUNT(*) FROM class_feature_registry WHERE class_name=?",
                (class_name,),
            ).fetchone()[0],
        })

    (output / "class_coverage.json").write_text(
        json.dumps(coverage, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )

    with (output / "class_coverage.csv").open("w", encoding="utf-8-sig", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=[
            "class_name","class_registered","subclasses_registered","features_registered"
        ])
        writer.writeheader()
        writer.writerows(coverage)

    summary = [
        "# Phase 2 — Classes / Subclasses / Class Features Validation",
        "",
        f"- Classes: **{class_count}**",
        f"- Subclasses: **{subclass_count}**",
        f"- Class features: **{feature_count}**",
        f"- Subclass source fallbacks: **{fallback_subclasses}**",
        "",
        "## Coverage",
    ]
    for item in coverage:
        summary.append(
            f'- {item["class_name"]}: '
            f'{item["subclasses_registered"]} subclasses; '
            f'{item["features_registered"]} features.'
        )

    (output / "PHASE2_VALIDATION_SUMMARY.md").write_text(
        "\n".join(summary) + "\n",
        encoding="utf-8",
        newline="\n",
    )

    db.close()

    print("PHASE 2 CLASSES VALIDATION COMPLETE")
    print(f"APPLIED={args.apply}")
    print(f"CLASSES={class_count}")
    print(f"SUBCLASSES={subclass_count}")
    print(f"FEATURES={feature_count}")
    print(f"FALLBACK_SUBCLASSES={fallback_subclasses}")
    print(f"OUTPUT={output}")
    return 0

if __name__ == "__main__":
    raise SystemExit(main())
