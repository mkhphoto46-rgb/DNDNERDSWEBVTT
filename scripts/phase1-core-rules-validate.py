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
OUTPUT_ROOT = PROJECT_ROOT / "_phase1_core_rules_validation"

BASELINE = {
    "sources": 14,
    "categories": 35,
    "entities": 18640,
    "validated": 1050,
    "extracted": 17590,
    "books": 13,
}

CONCEPTS: list[dict[str, Any]] = [
    {"category":"action-economy","name":"Action","aliases":["take an action","action on your turn","one action"]},
    {"category":"action-economy","name":"Bonus Action","aliases":["bonus action"]},
    {"category":"action-economy","name":"Reaction","aliases":["reaction","take a reaction"]},
    {"category":"action-economy","name":"Free Object Interaction","aliases":["interact with one object","object interaction"]},

    {"category":"action","name":"Attack","aliases":["attack action"]},
    {"category":"action","name":"Dash","aliases":["dash action"]},
    {"category":"action","name":"Disengage","aliases":["disengage action"]},
    {"category":"action","name":"Dodge","aliases":["dodge action"]},
    {"category":"action","name":"Help","aliases":["help action"]},
    {"category":"action","name":"Hide","aliases":["hide action"]},
    {"category":"action","name":"Influence","aliases":["influence action"]},
    {"category":"action","name":"Magic","aliases":["magic action"]},
    {"category":"action","name":"Ready","aliases":["ready action"]},
    {"category":"action","name":"Search","aliases":["search action"]},
    {"category":"action","name":"Study","aliases":["study action"]},
    {"category":"action","name":"Utilize","aliases":["utilize action"]},

    {"category":"movement","name":"Speed","aliases":["speed","movement speed"]},
    {"category":"movement","name":"Difficult Terrain","aliases":["difficult terrain"]},
    {"category":"movement","name":"Climbing","aliases":["climbing","climb speed"]},
    {"category":"movement","name":"Swimming","aliases":["swimming","swim speed"]},
    {"category":"movement","name":"Flying","aliases":["flying","fly speed"]},
    {"category":"movement","name":"Crawling","aliases":["crawling"]},
    {"category":"movement","name":"Jumping","aliases":["jumping","long jump","high jump"]},
    {"category":"movement","name":"Stand Up","aliases":["stand up","standing up"]},
    {"category":"movement","name":"Squeezing","aliases":["squeezing","squeeze through"]},
    {"category":"movement","name":"Forced Movement","aliases":["forced movement","move the target"]},

    {"category":"vision","name":"Bright Light","aliases":["bright light"]},
    {"category":"vision","name":"Dim Light","aliases":["dim light"]},
    {"category":"vision","name":"Darkness","aliases":["darkness"]},
    {"category":"vision","name":"Lightly Obscured","aliases":["lightly obscured"]},
    {"category":"vision","name":"Heavily Obscured","aliases":["heavily obscured"]},
    {"category":"vision","name":"Line of Sight","aliases":["line of sight","can see the target"]},
    {"category":"vision","name":"Darkvision","aliases":["darkvision"]},
    {"category":"vision","name":"Blindsight","aliases":["blindsight"]},
    {"category":"vision","name":"Truesight","aliases":["truesight"]},

    {"category":"short-rest","name":"Short Rest","aliases":["short rest"]},
    {"category":"long-rest","name":"Long Rest","aliases":["long rest"]},
    {"category":"rest","name":"Hit Dice Recovery","aliases":["hit dice","hit point dice"]},

    {"category":"condition","name":"Blinded","aliases":["blinded"]},
    {"category":"condition","name":"Charmed","aliases":["charmed"]},
    {"category":"condition","name":"Deafened","aliases":["deafened"]},
    {"category":"condition","name":"Exhaustion","aliases":["exhaustion"]},
    {"category":"condition","name":"Frightened","aliases":["frightened"]},
    {"category":"condition","name":"Grappled","aliases":["grappled"]},
    {"category":"condition","name":"Incapacitated","aliases":["incapacitated"]},
    {"category":"condition","name":"Invisible","aliases":["invisible"]},
    {"category":"condition","name":"Paralyzed","aliases":["paralyzed"]},
    {"category":"condition","name":"Petrified","aliases":["petrified"]},
    {"category":"condition","name":"Poisoned","aliases":["poisoned"]},
    {"category":"condition","name":"Prone","aliases":["prone"]},
    {"category":"condition","name":"Restrained","aliases":["restrained"]},
    {"category":"condition","name":"Stunned","aliases":["stunned"]},
    {"category":"condition","name":"Unconscious","aliases":["unconscious"]},

    {"category":"combat-rule","name":"Initiative","aliases":["initiative"]},
    {"category":"combat-rule","name":"Surprise","aliases":["surprise","surprised"]},
    {"category":"combat-rule","name":"Attack Roll","aliases":["attack roll"]},
    {"category":"combat-rule","name":"Damage Roll","aliases":["damage roll"]},
    {"category":"combat-rule","name":"Critical Hit","aliases":["critical hit","critical hits"]},
    {"category":"combat-rule","name":"Cover","aliases":["half cover","three-quarters cover","total cover"]},
    {"category":"combat-rule","name":"Temporary Hit Points","aliases":["temporary hit points","temporary hp"]},
    {"category":"combat-rule","name":"Healing","aliases":["regain hit points","healing"]},
    {"category":"combat-rule","name":"Death Saving Throw","aliases":["death saving throw","death saves"]},
    {"category":"combat-rule","name":"Resistance","aliases":["damage resistance","resistance to"]},
    {"category":"combat-rule","name":"Immunity","aliases":["damage immunity","immunity to"]},
    {"category":"combat-rule","name":"Vulnerability","aliases":["damage vulnerability","vulnerability to"]},

    {"category":"spellcasting-rule","name":"Concentration","aliases":["concentration"]},
    {"category":"spellcasting-rule","name":"Spell Slots","aliases":["spell slot","spell slots"]},
    {"category":"spellcasting-rule","name":"Casting Time","aliases":["casting time"]},
    {"category":"spellcasting-rule","name":"Spell Range","aliases":["range of a spell","spell's range"]},
    {"category":"spellcasting-rule","name":"Spell Targets","aliases":["spell target","targets of a spell"]},
    {"category":"spellcasting-rule","name":"Components","aliases":["verbal component","somatic component","material component"]},
    {"category":"spellcasting-rule","name":"Duration","aliases":["spell duration","duration"]},
    {"category":"spellcasting-rule","name":"Ritual","aliases":["ritual","ritual casting"]},
    {"category":"spellcasting-rule","name":"Spell Save DC","aliases":["spell save dc"]},
    {"category":"spellcasting-rule","name":"Spell Attack","aliases":["spell attack"]},
]

ENGINE_ALIASES = {
    "Action": ["turn economy","action"],
    "Bonus Action": ["bonus action","bonusAction"],
    "Reaction": ["reaction"],
    "Attack": ["resolveAttack","attack action","attackAction"],
    "Dash": ["dash"],
    "Disengage": ["disengage"],
    "Dodge": ["dodge"],
    "Help": ["help"],
    "Hide": ["hide"],
    "Ready": ["readied","ready action"],
    "Movement": ["movement"],
    "Speed": ["speed"],
    "Stand Up": ["stand up","standUp"],
    "Difficult Terrain": ["difficult terrain"],
    "Initiative": ["initiative"],
    "Attack Roll": ["attack roll","attackRoll"],
    "Damage Roll": ["damage roll","damageRoll"],
    "Critical Hit": ["critical hit","critical"],
    "Temporary Hit Points": ["temporary hp","tempHp","temporary hit points"],
    "Healing": ["healing","heal"],
    "Death Saving Throw": ["death save","deathSave"],
    "Resistance": ["resistance"],
    "Immunity": ["immunity"],
    "Vulnerability": ["vulnerability"],
    "Concentration": ["concentration"],
    "Spell Slots": ["spell slot","spellSlot"],
    "Spell Attack": ["spell attack","spellAttack"],
    "Spell Save DC": ["spell dc","spellDc","spell save dc"],
    "Prone": ["prone"],
    "Poisoned": ["poisoned"],
    "Restrained": ["restrained"],
    "Unconscious": ["unconscious"],
    "Cover": ["cover"],
    "Exhaustion": ["exhaustion"],
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

def count_baseline(db: sqlite3.Connection) -> dict[str, int]:
    return {
        "sources": db.execute("SELECT COUNT(*) FROM sources").fetchone()[0],
        "categories": db.execute("SELECT COUNT(*) FROM category_catalog").fetchone()[0],
        "entities": db.execute("SELECT COUNT(*) FROM current_entity_versions").fetchone()[0],
        "validated": db.execute("SELECT COUNT(*) FROM current_entity_versions WHERE status='validated'").fetchone()[0],
        "extracted": db.execute("SELECT COUNT(*) FROM current_entity_versions WHERE status='extracted'").fetchone()[0],
        "books": db.execute("SELECT COUNT(*) FROM sources WHERE source_kind LIKE 'official-%'").fetchone()[0],
    }

def candidate_score(row: sqlite3.Row, concept: dict[str, Any]) -> int:
    name = norm(row["name"])
    concept_name = norm(concept["name"])
    aliases = [norm(x) for x in concept["aliases"]]
    text = norm(f'{row["name"]}\n{row["summary"]}\n{row["raw_text"]}')
    score = 0

    if name == concept_name:
        score += 2000
    elif name.startswith(concept_name) or concept_name.startswith(name):
        score += 1200
    elif concept_name in name:
        score += 900

    alias_name_hits = sum(1 for alias in aliases if alias and alias in name)
    alias_text_hits = sum(1 for alias in aliases if alias and alias in text)
    score += alias_name_hits * 500
    score += min(alias_text_hits, 4) * 120

    if row["category"] == concept["category"]:
        score += 500
    elif row["category"] == "rule":
        score += 100

    source_title = row["source_title"]
    # PHB is preferred for player-facing core mechanics. DMG is allowed but loses ties.
    if source_title == "Player's Handbook":
        score += 180
    elif source_title == "Dungeon Master's Guide":
        score += 100
    elif source_title == "Monster Manual":
        score += 50

    score += int(float(row["confidence"]) * 100)
    if row["source_page_start"] is not None:
        score += 10

    return score

def select_candidate(db: sqlite3.Connection, concept: dict[str, Any]) -> dict[str, Any]:
    rows = db.execute("""
        SELECT
          ev.*,
          s.title AS source_title,
          s.filename AS source_filename,
          s.publication_year,
          s.source_kind,
          s.source_priority AS actual_source_priority,
          s.current_revision_id
        FROM current_entity_versions ev
        JOIN sources s ON s.id=ev.source_id
        WHERE
          s.rules_version='2024'
          AND s.source_kind='official-core'
          AND s.source_priority=500
          AND ev.status IN ('extracted','validated','engine-ready','automated','tested')
          AND ev.category IN (
            'action','bonus-action','reaction','action-economy','condition','vision',
            'movement','short-rest','long-rest','rest','combat-rule','spellcasting-rule','rule'
          )
    """).fetchall()

    scored: list[tuple[int, sqlite3.Row]] = []
    aliases = [norm(x) for x in concept["aliases"]]
    concept_name = norm(concept["name"])

    for row in rows:
        text = norm(f'{row["name"]}\n{row["summary"]}\n{row["raw_text"]}')
        if concept_name not in text and not any(alias in text for alias in aliases if alias):
            continue
        score = candidate_score(row, concept)
        scored.append((score, row))

    if scored:
        scored.sort(
            key=lambda item: (
                item[0],
                float(item[1]["confidence"]),
                -(item[1]["source_page_start"] or 99999),
                item[1]["id"],
            ),
            reverse=True,
        )
        row = scored[0][1]
        return {
            "kind": "entity",
            "row": row,
            "score": scored[0][0],
        }

    # Recovery path: the classifier may have failed to make an entity even when
    # the 2024 book page was extracted successfully. Search immutable raw pages
    # from 2024 official-core sources before considering any legacy fallback.
    source_rows = db.execute("""
        SELECT
          id,title,filename,publication_year,rules_version,source_kind,source_priority,current_revision_id
        FROM sources
        WHERE rules_version='2024'
          AND source_kind='official-core'
          AND source_priority=500
          AND current_revision_id IS NOT NULL
        ORDER BY
          CASE title
            WHEN 'Player''s Handbook' THEN 0
            WHEN 'Dungeon Master''s Guide' THEN 1
            WHEN 'Monster Manual' THEN 2
            ELSE 3
          END
    """).fetchall()

    needles = [concept["name"]] + list(concept["aliases"])
    page_hits: list[tuple[int, sqlite3.Row, sqlite3.Row, str]] = []

    for source in source_rows:
        pages = db.execute("""
            SELECT id,revision_id,page_number,text,extraction_method,text_sha256
            FROM raw_pages
            WHERE revision_id=?
        """, (source["current_revision_id"],)).fetchall()

        for page in pages:
            page_norm = norm(page["text"])
            hit_strength = 0
            best_needle = ""
            for needle in needles:
                needle_norm = norm(needle)
                if not needle_norm:
                    continue
                if needle_norm in page_norm:
                    strength = 1000 + len(needle_norm)
                    # Strong preference for heading-like appearances near the
                    # start of a line/page segment.
                    raw_low = (page["text"] or "").casefold()
                    raw_needle = needle.casefold()
                    if re.search(rf"(?m)^\s*{re.escape(raw_needle)}\b", raw_low):
                        strength += 1200
                    if strength > hit_strength:
                        hit_strength = strength
                        best_needle = needle

            if hit_strength:
                source_bonus = {
                    "Player's Handbook": 300,
                    "Dungeon Master's Guide": 200,
                    "Monster Manual": 100,
                }.get(source["title"], 0)
                page_hits.append(
                    (hit_strength + source_bonus, source, page, best_needle)
                )

    if not page_hits:
        raise RuntimeError(
            f'No 2024 official-core entity or raw-page evidence found for '
            f'{concept["category"]} / {concept["name"]}'
        )

    page_hits.sort(
        key=lambda item: (
            item[0],
            -(item[2]["page_number"] or 99999),
            item[1]["title"],
        ),
        reverse=True,
    )
    score, source, page, matched = page_hits[0]

    return {
        "kind": "raw-page",
        "score": score,
        "source": source,
        "page": page,
        "matched_needle": matched,
    }


def ensure_schema(db: sqlite3.Connection) -> None:
    db.executescript("""
    CREATE TABLE IF NOT EXISTS core_rule_validation_batches(
      id TEXT PRIMARY KEY,
      created_at TEXT NOT NULL,
      policy TEXT NOT NULL,
      source_db_sha256 TEXT NOT NULL,
      concept_count INTEGER NOT NULL,
      promoted_entity_count INTEGER NOT NULL DEFAULT 0
    ) STRICT;

    CREATE TABLE IF NOT EXISTS core_rule_registry(
      concept_id TEXT PRIMARY KEY,
      core_category TEXT NOT NULL,
      concept_name TEXT NOT NULL,
      effective_entity_version_id TEXT NOT NULL REFERENCES entity_versions(id),
      rules_version TEXT NOT NULL,
      source_id TEXT NOT NULL REFERENCES sources(id),
      source_title TEXT NOT NULL,
      source_filename TEXT NOT NULL,
      source_page_start INTEGER,
      source_page_end INTEGER,
      selection_score INTEGER NOT NULL,
      validation_method TEXT NOT NULL,
      validation_status TEXT NOT NULL,
      batch_id TEXT NOT NULL REFERENCES core_rule_validation_batches(id),
      validated_at TEXT NOT NULL
    ) STRICT;

    CREATE TABLE IF NOT EXISTS core_rule_validation_history(
      id INTEGER PRIMARY KEY,
      batch_id TEXT NOT NULL REFERENCES core_rule_validation_batches(id),
      concept_id TEXT NOT NULL,
      entity_version_id TEXT NOT NULL REFERENCES entity_versions(id),
      previous_status TEXT NOT NULL,
      new_status TEXT NOT NULL,
      created_at TEXT NOT NULL
    ) STRICT;

    DROP VIEW IF EXISTS effective_core_rules;
    CREATE VIEW effective_core_rules AS
      SELECT
        r.concept_id,
        r.core_category,
        r.concept_name,
        r.rules_version,
        r.source_title,
        r.source_filename,
        r.source_page_start,
        r.source_page_end,
        r.validation_status,
        ev.id AS entity_version_id,
        ev.name,
        ev.summary,
        ev.structured_json,
        ev.raw_text,
        ev.status AS entity_status,
        ev.confidence
      FROM core_rule_registry r
      JOIN entity_versions ev ON ev.id=r.effective_entity_version_id;
    """)
    db.commit()

def scan_engine_gap() -> list[dict[str, Any]]:
    source_files = [
        p for root in (PROJECT_ROOT / "src", PROJECT_ROOT / "server")
        for p in root.rglob("*.ts")
        if not p.name.endswith(".d.ts")
    ]
    tests = [p for p in (PROJECT_ROOT / "src").rglob("*.test.ts")]

    source_blob = "\n".join(
        p.read_text(encoding="utf-8", errors="ignore").casefold()
        for p in source_files
    )
    test_blob = "\n".join(
        p.read_text(encoding="utf-8", errors="ignore").casefold()
        for p in tests
    )

    matrix: list[dict[str, Any]] = []
    for concept in CONCEPTS:
        aliases = ENGINE_ALIASES.get(concept["name"], concept["aliases"] + [concept["name"]])
        aliases = [a.casefold() for a in aliases]
        source_hits = [a for a in aliases if a and a in source_blob]
        test_hits = [a for a in aliases if a and a in test_blob]

        if test_hits:
            state = "IMPLEMENTED_TESTED"
        elif source_hits:
            state = "IMPLEMENTED_OR_REFERENCED"
        else:
            state = "MISSING_OR_UNCONFIRMED"

        matrix.append({
            "core_category": concept["category"],
            "core_concept": concept["name"],
            "engine_state": state,
            "source_hits": source_hits[:6],
            "test_hits": test_hits[:6],
        })
    return matrix

def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--apply", action="store_true")
    parser.add_argument("--output", default=str(OUTPUT_ROOT))
    args = parser.parse_args()

    OUTPUT_ROOT.mkdir(parents=True, exist_ok=True)
    output = Path(args.output)
    output.mkdir(parents=True, exist_ok=True)

    if not DB_PATH.exists():
        raise SystemExit(f"Missing database: {DB_PATH}")

    db_hash_before = sha256_file(DB_PATH)
    db = sqlite3.connect(DB_PATH)
    db.row_factory = sqlite3.Row
    db.execute("PRAGMA foreign_keys=ON")

    baseline = count_baseline(db)
    for key, expected in BASELINE.items():
        if baseline[key] != expected:
            raise RuntimeError(
                f"Baseline mismatch for {key}: expected {expected}, got {baseline[key]}"
            )

    integrity = db.execute("PRAGMA integrity_check").fetchone()[0]
    if integrity != "ok":
        raise RuntimeError(f"SQLite integrity_check failed: {integrity}")

    ensure_schema(db)

    selections: list[dict[str, Any]] = []
    unique_entities: set[str] = set()

    for concept in CONCEPTS:
        selected = select_candidate(db, concept)
        concept_id = f'core.{concept["category"]}.{slug(concept["name"])}'

        if selected["kind"] == "entity":
            row = selected["row"]
            selection = {
                "concept_id": concept_id,
                "core_category": concept["category"],
                "core_concept": concept["name"],
                "entity_version_id": row["id"],
                "entity_name": row["name"],
                "stored_category": row["category"],
                "rules_version": row["rules_version"],
                "source_id": row["source_id"],
                "source_title": row["source_title"],
                "source_filename": row["source_filename"],
                "source_page_start": row["source_page_start"],
                "source_page_end": row["source_page_end"],
                "previous_status": row["status"],
                "confidence": float(row["confidence"]),
                "selection_score": selected["score"],
                "selection_method": "existing-2024-entity",
                "synthetic_from_raw_page": False,
            }
            unique_entities.add(row["id"])
        else:
            source = selected["source"]
            page = selected["page"]
            synthetic_entity_id = f"entity-core-{slug(concept['category'])}-{slug(concept['name'])}"
            synthetic_version_id = (
                f"version-core-{slug(concept['category'])}-{slug(concept['name'])}-"
                f"{hashlib.sha256((source['id'] + ':' + str(page['page_number'])).encode()).hexdigest()[:12]}"
            )
            selection = {
                "concept_id": concept_id,
                "core_category": concept["category"],
                "core_concept": concept["name"],
                "entity_version_id": synthetic_version_id,
                "canonical_id": synthetic_entity_id,
                "entity_name": concept["name"],
                "stored_category": concept["category"],
                "rules_version": "2024",
                "source_id": source["id"],
                "source_title": source["title"],
                "source_filename": source["filename"],
                "source_page_start": page["page_number"],
                "source_page_end": page["page_number"],
                "revision_id": source["current_revision_id"],
                "previous_status": "raw-page-only",
                "confidence": 0.95,
                "selection_score": selected["score"],
                "selection_method": "2024-raw-page-recovery",
                "synthetic_from_raw_page": True,
                "matched_needle": selected["matched_needle"],
                "raw_page_text": page["text"],
                "raw_page_text_sha256": page["text_sha256"],
            }
            unique_entities.add(synthetic_version_id)

        selections.append(selection)

    if len(selections) != len(CONCEPTS):
        raise RuntimeError(f"Expected {len(CONCEPTS)} concept selections, got {len(selections)}")

    bad_versions = [x for x in selections if x["rules_version"] != "2024"]
    bad_sources = [x for x in selections if x["source_title"] not in {
        "Player's Handbook", "Dungeon Master's Guide", "Monster Manual"
    }]
    if bad_versions or bad_sources:
        raise RuntimeError("Validation policy violation: a selected source is not 2024 official core.")

    batch_id = f"phase1-core-{datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ')}"
    promoted = 0

    if args.apply:
        db.execute("BEGIN IMMEDIATE")
        try:
            db.execute(
                """
                INSERT INTO core_rule_validation_batches(
                  id,created_at,policy,source_db_sha256,concept_count,promoted_entity_count
                ) VALUES(?,?,?,?,?,0)
                """,
                (
                    batch_id,
                    now_iso(),
                    "2024 official core only; deterministic source selection; legacy preserved but never auto-promoted",
                    db_hash_before,
                    len(selections),
                ),
            )

            for item in selections:
                if item.get("synthetic_from_raw_page"):
                    canonical_key = (
                        f'core:{item["core_category"]}:{slug(item["core_concept"])}:2024'
                    )
                    db.execute(
                        """
                        INSERT INTO canonical_entities(id,canonical_key,category,name)
                        VALUES(?,?,?,?)
                        ON CONFLICT(id) DO NOTHING
                        """,
                        (
                            item["canonical_id"],
                            canonical_key,
                            item["core_category"],
                            item["core_concept"],
                        ),
                    )

                    structured = {
                        "coreConcept": item["core_concept"],
                        "coreCategory": item["core_category"],
                        "validationMethod": "2024-raw-page-recovery",
                        "matchedNeedle": item.get("matched_needle", ""),
                        "sourcePage": item["source_page_start"],
                    }
                    content_sha = hashlib.sha256(
                        (
                            item["raw_page_text_sha256"]
                            + "|"
                            + item["core_category"]
                            + "|"
                            + item["core_concept"]
                        ).encode("utf-8")
                    ).hexdigest()

                    db.execute(
                        """
                        INSERT INTO entity_versions(
                          id,canonical_id,source_id,revision_id,source_record_key,
                          category,subcategory,name,summary,structured_json,raw_text,
                          source_page_start,source_page_end,rules_version,source_priority,
                          status,confidence,content_sha256,created_at
                        ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
                        ON CONFLICT(id) DO NOTHING
                        """,
                        (
                            item["entity_version_id"],
                            item["canonical_id"],
                            item["source_id"],
                            item["revision_id"],
                            f'phase1-raw-page:{item["core_category"]}:{slug(item["core_concept"])}',
                            item["core_category"],
                            "",
                            item["core_concept"],
                            f'Validated 2024 core rule recovered from raw page {item["source_page_start"]}.',
                            json.dumps(structured, ensure_ascii=False, separators=(",", ":")),
                            item["raw_page_text"],
                            item["source_page_start"],
                            item["source_page_end"],
                            "2024",
                            500,
                            "validated",
                            item["confidence"],
                            content_sha,
                            now_iso(),
                        ),
                    )
                    previous_status = "raw-page-only"
                    promoted += 1
                else:
                    current = db.execute(
                        "SELECT status FROM entity_versions WHERE id=?",
                        (item["entity_version_id"],),
                    ).fetchone()
                    if current is None:
                        raise RuntimeError(
                            f'Missing selected entity version: {item["entity_version_id"]}'
                        )
                    previous_status = str(current[0])

                    if previous_status == "extracted":
                        db.execute(
                            "UPDATE entity_versions SET status='validated' WHERE id=?",
                            (item["entity_version_id"],),
                        )
                        promoted += 1

                db.execute(
                    """
                    INSERT INTO core_rule_registry(
                      concept_id,core_category,concept_name,effective_entity_version_id,
                      rules_version,source_id,source_title,source_filename,
                      source_page_start,source_page_end,selection_score,validation_method,
                      validation_status,batch_id,validated_at
                    ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
                    ON CONFLICT(concept_id) DO UPDATE SET
                      core_category=excluded.core_category,
                      concept_name=excluded.concept_name,
                      effective_entity_version_id=excluded.effective_entity_version_id,
                      rules_version=excluded.rules_version,
                      source_id=excluded.source_id,
                      source_title=excluded.source_title,
                      source_filename=excluded.source_filename,
                      source_page_start=excluded.source_page_start,
                      source_page_end=excluded.source_page_end,
                      selection_score=excluded.selection_score,
                      validation_method=excluded.validation_method,
                      validation_status=excluded.validation_status,
                      batch_id=excluded.batch_id,
                      validated_at=excluded.validated_at
                    """,
                    (
                        item["concept_id"],
                        item["core_category"],
                        item["core_concept"],
                        item["entity_version_id"],
                        item["rules_version"],
                        item["source_id"],
                        item["source_title"],
                        item["source_filename"],
                        item["source_page_start"],
                        item["source_page_end"],
                        item["selection_score"],
                        "phase1-2024-official-core-priority-v1",
                        "validated",
                        batch_id,
                        now_iso(),
                    ),
                )

                db.execute(
                    """
                    INSERT INTO core_rule_validation_history(
                      batch_id,concept_id,entity_version_id,previous_status,new_status,created_at
                    ) VALUES(?,?,?,?,?,?)
                    """,
                    (
                        batch_id,
                        item["concept_id"],
                        item["entity_version_id"],
                        previous_status,
                        "validated",
                        now_iso(),
                    ),
                )

            db.execute(
                "UPDATE core_rule_validation_batches SET promoted_entity_count=? WHERE id=?",
                (promoted, batch_id),
            )
            db.commit()
        except Exception:
            db.rollback()
            raise

    engine_gap = scan_engine_gap()

    status_after = count_baseline(db)
    registry_count = db.execute("SELECT COUNT(*) FROM core_rule_registry").fetchone()[0]
    registry_legacy = db.execute(
        "SELECT COUNT(*) FROM core_rule_registry WHERE rules_version<>'2024'"
    ).fetchone()[0]
    registry_unvalidated = db.execute("""
        SELECT COUNT(*)
        FROM core_rule_registry r
        JOIN entity_versions ev ON ev.id=r.effective_entity_version_id
        WHERE ev.status NOT IN ('validated','engine-ready','automated','tested')
    """).fetchone()[0]

    report = {
        "batchId": batch_id,
        "applied": args.apply,
        "databaseSha256Before": db_hash_before,
        "baselineBefore": baseline,
        "statusAfter": status_after,
        "conceptCount": len(CONCEPTS),
        "selectionCount": len(selections),
        "uniqueSelectedEntities": len(unique_entities),
        "rawPageRecoveryCount": sum(1 for x in selections if x.get("synthetic_from_raw_page")),
        "promotedEntityCount": promoted,
        "registryCount": registry_count,
        "registryLegacyCount": registry_legacy,
        "registryUnvalidatedCount": registry_unvalidated,
        "policy": {
            "2024OfficialCoreOnly": True,
            "legacyAutoPromotion": False,
            "existingLegacyRecordsPreserved": True,
            "rawTextOverwritten": False,
            "sourceProvenancePreserved": True,
        },
    }

    (output / "phase1_validation_report.json").write_text(
        json.dumps(report, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    (output / "core_rule_validation_manifest.json").write_text(
        json.dumps(selections, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    (output / "engine_gap_matrix.json").write_text(
        json.dumps(engine_gap, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )

    with (output / "core_rule_registry.csv").open("w", encoding="utf-8-sig", newline="") as handle:
        fields = [
            "concept_id","core_category","core_concept","entity_version_id","entity_name",
            "stored_category","rules_version","source_title","source_filename",
            "source_page_start","source_page_end","previous_status","confidence","selection_score",
            "selection_method","synthetic_from_raw_page"
        ]
        writer = csv.DictWriter(handle, fieldnames=fields, extrasaction="ignore")
        writer.writeheader()
        writer.writerows(selections)

    with (output / "engine_gap_matrix.csv").open("w", encoding="utf-8-sig", newline="") as handle:
        fields = ["core_category","core_concept","engine_state","source_hits","test_hits"]
        writer = csv.DictWriter(handle, fieldnames=fields, extrasaction="ignore")
        writer.writeheader()
        writer.writerows(engine_gap)

    gap_counts = Counter(x["engine_state"] for x in engine_gap)
    summary = [
        "# Phase 1 Core Rules Validation",
        "",
        f"- Applied: **{args.apply}**",
        f"- Core concepts: **{len(CONCEPTS)}**",
        f"- Selected 2024 official-core records: **{len(selections)}**",
        f"- Unique selected records: **{len(unique_entities)}**",
        f"- Raw-page 2024 recoveries: **{sum(1 for x in selections if x.get('synthetic_from_raw_page'))}**",
        f"- Newly promoted records: **{promoted}**",
        f"- Registry rows: **{registry_count}**",
        f"- Legacy registry rows: **{registry_legacy}**",
        "",
        "## Engine gap matrix",
    ]
    for key, value in sorted(gap_counts.items()):
        summary.append(f"- {key}: {value}")
    summary += [
        "",
        "## Policy",
        "- 2024 official core is authoritative for Phase 1.",
        "- Legacy records remain in the database but are not auto-promoted.",
        "- Original raw text and source provenance are preserved.",
        "",
    ]
    (output / "PHASE1_VALIDATION_SUMMARY.md").write_text(
        "\n".join(summary),
        encoding="utf-8",
        newline="\n",
    )

    db.close()

    print("PHASE 1 CORE RULES VALIDATION COMPLETE")
    print(f"APPLIED={args.apply}")
    print(f"CONCEPTS={len(CONCEPTS)}")
    print(f"UNIQUE_SELECTED={len(unique_entities)}")
    print(f"RAW_PAGE_RECOVERIES={sum(1 for x in selections if x.get('synthetic_from_raw_page'))}")
    print(f"PROMOTED={promoted}")
    print(f"REGISTRY={registry_count}")
    print(f"LEGACY_REGISTRY={registry_legacy}")
    print(f"OUTPUT={output}")
    return 0

if __name__ == "__main__":
    raise SystemExit(main())
