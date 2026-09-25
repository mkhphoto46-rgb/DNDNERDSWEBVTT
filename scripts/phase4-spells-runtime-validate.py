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
OUTPUT_ROOT = PROJECT_ROOT / "_phase4_spells_structured_runtime"

EXPECTED_DEPENDENCIES = {
    "core_rule_registry": 75,
    "class_registry": 12,
    "subclass_registry": 48,
    "class_feature_registry": 442,
    "species_registry": 10,
    "background_registry": 16,
    "feat_registry": 75,
    "official_books": 13,
}

EXPECTED_SRD_LEVELS = {
    0: 27, 1: 57, 2: 57, 3: 42, 4: 34,
    5: 38, 6: 31, 7: 20, 8: 17, 9: 16,
}

ABILITY_NAMES = {
    "strength": "Strength",
    "dexterity": "Dexterity",
    "constitution": "Constitution",
    "intelligence": "Intelligence",
    "wisdom": "Wisdom",
    "charisma": "Charisma",
}

DAMAGE_TYPES = (
    "Acid","Bludgeoning","Cold","Fire","Force","Lightning","Necrotic",
    "Piercing","Poison","Psychic","Radiant","Slashing","Thunder",
)

DICE_RE = re.compile(r"(?<![A-Za-z0-9])(\d+d(?:4|6|8|10|12|20|100)(?:\s*[+-]\s*\d+)?)", re.I)

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
    return re.sub(r"[^a-z0-9]+", " ", (value or "").casefold()).strip()

def dependency_counts(db: sqlite3.Connection) -> dict[str, int]:
    return {
        "core_rule_registry": db.execute("SELECT COUNT(*) FROM core_rule_registry").fetchone()[0],
        "class_registry": db.execute("SELECT COUNT(*) FROM class_registry").fetchone()[0],
        "subclass_registry": db.execute("SELECT COUNT(*) FROM subclass_registry").fetchone()[0],
        "class_feature_registry": db.execute("SELECT COUNT(*) FROM class_feature_registry").fetchone()[0],
        "species_registry": db.execute("SELECT COUNT(*) FROM species_registry").fetchone()[0],
        "background_registry": db.execute("SELECT COUNT(*) FROM background_registry").fetchone()[0],
        "feat_registry": db.execute("SELECT COUNT(*) FROM feat_registry").fetchone()[0],
        "official_books": db.execute("SELECT COUNT(*) FROM sources WHERE source_kind LIKE 'official-%'").fetchone()[0],
    }

def ensure_schema(db: sqlite3.Connection) -> None:
    db.executescript("""
    CREATE TABLE IF NOT EXISTS phase4_spell_batches(
      id TEXT PRIMARY KEY,
      created_at TEXT NOT NULL,
      source_db_sha256 TEXT NOT NULL,
      srd_spell_count INTEGER NOT NULL,
      book_recovery_count INTEGER NOT NULL,
      spellcasting_rule_review_count INTEGER NOT NULL
    ) STRICT;

    CREATE TABLE IF NOT EXISTS spell_registry(
      spell_id TEXT PRIMARY KEY,
      spell_name TEXT NOT NULL,
      spell_level INTEGER NOT NULL,
      category TEXT NOT NULL,
      entity_version_id TEXT NOT NULL REFERENCES entity_versions(id),
      rules_version TEXT NOT NULL,
      source_id TEXT NOT NULL REFERENCES sources(id),
      source_title TEXT NOT NULL,
      validation_scope TEXT NOT NULL,
      batch_id TEXT NOT NULL REFERENCES phase4_spell_batches(id),
      validated_at TEXT NOT NULL
    ) STRICT;

    CREATE INDEX IF NOT EXISTS idx_spell_registry_name
      ON spell_registry(spell_name);
    CREATE INDEX IF NOT EXISTS idx_spell_registry_level
      ON spell_registry(spell_level);

    CREATE TABLE IF NOT EXISTS spell_engine_profiles(
      spell_id TEXT PRIMARY KEY REFERENCES spell_registry(spell_id),
      casting_time TEXT NOT NULL,
      action_resource TEXT,
      range_text TEXT NOT NULL,
      components_json TEXT NOT NULL,
      duration_text TEXT NOT NULL,
      concentration INTEGER NOT NULL,
      ritual INTEGER NOT NULL,
      school TEXT NOT NULL,
      classes_json TEXT NOT NULL,
      attack_roll INTEGER NOT NULL,
      save_ability TEXT,
      dice_json TEXT NOT NULL,
      damage_types_json TEXT NOT NULL,
      healing_detected INTEGER NOT NULL,
      area_shape TEXT,
      area_size_feet INTEGER,
      cantrip_scaling_detected INTEGER NOT NULL,
      upcast_detected INTEGER NOT NULL,
      save_half_detected INTEGER NOT NULL,
      save_none_detected INTEGER NOT NULL,
      target_selection_required INTEGER NOT NULL,
      automation_completeness INTEGER NOT NULL,
      automation_gaps_json TEXT NOT NULL,
      parser_version TEXT NOT NULL
    ) STRICT;

    CREATE TABLE IF NOT EXISTS book_spell_recovery_queue(
      entity_version_id TEXT PRIMARY KEY REFERENCES entity_versions(id),
      name TEXT NOT NULL,
      category TEXT NOT NULL,
      rules_version TEXT NOT NULL,
      source_id TEXT NOT NULL REFERENCES sources(id),
      source_title TEXT NOT NULL,
      source_page INTEGER,
      confidence REAL NOT NULL,
      quality TEXT NOT NULL,
      reason TEXT NOT NULL,
      batch_id TEXT NOT NULL REFERENCES phase4_spell_batches(id)
    ) STRICT;

    CREATE TABLE IF NOT EXISTS spellcasting_rule_review_queue(
      entity_version_id TEXT PRIMARY KEY REFERENCES entity_versions(id),
      name TEXT NOT NULL,
      rules_version TEXT NOT NULL,
      source_id TEXT NOT NULL REFERENCES sources(id),
      source_title TEXT NOT NULL,
      source_page INTEGER,
      status TEXT NOT NULL,
      confidence REAL NOT NULL,
      reason TEXT NOT NULL,
      batch_id TEXT NOT NULL REFERENCES phase4_spell_batches(id)
    ) STRICT;

    DROP VIEW IF EXISTS effective_spells;
    CREATE VIEW effective_spells AS
      SELECT r.*, ev.summary, ev.structured_json, ev.raw_text,
             ev.status AS entity_status,
             p.casting_time, p.action_resource, p.range_text,
             p.components_json, p.duration_text, p.concentration, p.ritual,
             p.school, p.classes_json, p.attack_roll, p.save_ability,
             p.dice_json, p.damage_types_json, p.healing_detected,
             p.area_shape, p.area_size_feet, p.cantrip_scaling_detected,
             p.upcast_detected, p.save_half_detected, p.save_none_detected,
             p.target_selection_required, p.automation_completeness,
             p.automation_gaps_json
      FROM spell_registry r
      JOIN entity_versions ev ON ev.id=r.entity_version_id
      JOIN spell_engine_profiles p ON p.spell_id=r.spell_id;
    """)
    db.commit()

def parse_json(value: str | None) -> dict[str, Any]:
    try:
        obj = json.loads(value or "{}")
        return obj if isinstance(obj, dict) else {}
    except Exception:
        return {}

def get_action_resource(casting_time: str) -> str | None:
    n = norm(casting_time)
    if "bonus action" in n:
        return "Bonus Action"
    if "reaction" in n:
        return "Reaction"
    if n == "action" or n.startswith("1 action") or " action" in n:
        return "Action"
    if "minute" in n or "hour" in n:
        return "Extended"
    return None

def find_save_ability(text: str) -> str | None:
    matches: list[str] = []
    for key, label in ABILITY_NAMES.items():
        if re.search(rf"(?i)\b{key}\b[^.\n]{{0,40}}\bsaving throw\b", text):
            matches.append(label)
        elif re.search(rf"(?i)\b{key}\s+saving throw\b", text):
            matches.append(label)
    return matches[0] if len(set(matches)) == 1 else None

def detect_attack_roll(text: str) -> bool:
    return bool(
        re.search(r"(?i)\bspell attack\b", text)
        or re.search(r"(?i)\bmake (?:a|an) (?:ranged|melee)?\s*spell attack\b", text)
    )

def detect_damage_types(text: str) -> list[str]:
    out = []
    for dtype in DAMAGE_TYPES:
        if re.search(rf"(?i)\b{re.escape(dtype)} damage\b", text):
            out.append(dtype)
    return out

def detect_area(text: str) -> tuple[str | None, int | None]:
    patterns = (
        ("Sphere", r"(?i)\b(\d+)[- ]foot[- ]radius\s+sphere\b"),
        ("Cylinder", r"(?i)\b(\d+)[- ]foot[- ]radius\s+(?:and\s+\d+[- ]foot[- ]high\s+)?cylinder\b"),
        ("Cone", r"(?i)\b(\d+)[- ]foot\s+cone\b"),
        ("Cube", r"(?i)\b(\d+)[- ]foot\s+cube\b"),
        ("Line", r"(?i)\b(\d+)[- ]foot[- ]long[^.\n]{0,40}\bline\b"),
        ("Emanation", r"(?i)\b(\d+)[- ]foot\s+emanation\b"),
    )
    for shape, pattern in patterns:
        m = re.search(pattern, text)
        if m:
            return shape, int(m.group(1))
    return None, None

def build_profile(row: sqlite3.Row) -> dict[str, Any]:
    structured = parse_json(row["structured_json"])
    text = row["raw_text"] or ""

    level = structured.get("level")
    try:
        level = int(level)
    except Exception:
        level = 0 if row["category"] == "cantrip" else None

    casting_time = clean(str(structured.get("castingTime") or structured.get("casting_time") or ""))
    range_text = clean(str(structured.get("range") or ""))
    duration = clean(str(structured.get("duration") or ""))
    school = clean(str(structured.get("school") or ""))

    components = structured.get("components")
    if not isinstance(components, (list, dict, str)):
        components = []

    classes = structured.get("classes")
    if not isinstance(classes, list):
        classes = []

    concentration = bool(structured.get("concentration", False))
    ritual = bool(structured.get("ritual", False))
    attack = detect_attack_roll(text)
    save_ability = find_save_ability(text)
    dice = sorted(set(m.group(1).replace(" ", "") for m in DICE_RE.finditer(text)))
    damage_types = detect_damage_types(text)
    healing = bool(re.search(r"(?i)\b(?:regains?|restore[sd]?)\b[^.\n]{0,50}\bhit points?\b", text))
    area_shape, area_size = detect_area(text)
    cantrip_scaling = bool(
        (level == 0)
        and re.search(r"(?i)\b(?:cantrip upgrade|levels?\s+5|level\s+5)\b", text)
    )
    upcast = bool(
        (level or 0) > 0
        and re.search(r"(?i)\busing a higher[- ]level spell slot\b|\bat higher levels?\b", text)
    )
    save_half = bool(
        re.search(r"(?i)\bhalf as much damage\b|\bhalf damage\b", text)
    )
    save_none = bool(
        re.search(r"(?i)\b(?:takes?|take)\s+no damage\b|\bon a successful save[^.]{0,70}\bno damage\b", text)
    )
    target_selection = bool(
        re.search(r"(?i)\b(?:creature|target|object|point|space)s?\s+(?:you can see|within range|of your choice)\b", text)
        or area_shape
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
    if not classes:
        gaps.append("classes")
    if not dice and (damage_types or healing):
        gaps.append("dice-formula")
    if re.search(r"(?i)\bsaving throw\b", text) and not save_ability:
        gaps.append("save-ability")
    if level == 0 and re.search(r"(?i)\bdamage\b", text) and not cantrip_scaling:
        gaps.append("cantrip-scaling-review")
    if (level or 0) > 0 and re.search(r"(?i)\bhigher[- ]level\b", text) and not upcast:
        gaps.append("upcast-review")

    completeness = max(0, 100 - 10 * len(gaps))

    return {
        "spell_level": level,
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
        "completeness": completeness,
        "gaps": gaps,
    }

def quality_for_book_candidate(row: sqlite3.Row) -> tuple[str, str]:
    name = clean(row["name"])
    structured = parse_json(row["structured_json"])
    metadata_fields = sum(
        1 for key in ("level","school","castingTime","range","components","duration")
        if structured.get(key) not in (None, "", [], {})
    )

    bad_tokens = (
        "casting time", "chapter ", "spell list", "components",
        "duration", "range:", "level ", "wizard)", "warlock,",
    )
    if any(token in name.casefold() for token in bad_tokens):
        return "quarantine", "heading looks like metadata/OCR fragment"

    letters = sum(ch.isalpha() for ch in name)
    if not name or len(name) > 70 or letters < max(2, int(len(name) * 0.5)):
        return "quarantine", "name quality too low"

    if metadata_fields >= 5 and float(row["confidence"]) >= 0.80:
        return "high", "clean name + strong structured metadata"
    if metadata_fields >= 3:
        return "review", "plausible spell block but incomplete metadata"
    return "quarantine", "insufficient structured spell metadata"

def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--apply", action="store_true")
    parser.add_argument("--output", default=str(OUTPUT_ROOT))
    args = parser.parse_args()

    output = Path(args.output)
    output.mkdir(parents=True, exist_ok=True)

    if not DB_PATH.exists():
        raise RuntimeError(f"Missing database: {DB_PATH}")

    db_hash_before = sha256_file(DB_PATH)
    db = sqlite3.connect(DB_PATH)
    db.row_factory = sqlite3.Row
    db.execute("PRAGMA foreign_keys=ON")

    if db.execute("PRAGMA integrity_check").fetchone()[0] != "ok":
        raise RuntimeError("SQLite integrity check failed.")

    deps = dependency_counts(db)
    if deps != EXPECTED_DEPENDENCIES:
        raise RuntimeError(f"Phase dependency mismatch: {deps}")

    srd_rows = db.execute("""
        SELECT ev.*, s.title AS source_title, s.source_kind
        FROM current_entity_versions ev
        JOIN sources s ON s.id=ev.source_id
        WHERE ev.category IN ('spell','cantrip')
          AND ev.rules_version='2024'
          AND ev.status='validated'
          AND s.title='SRD 5.2.1'
        ORDER BY ev.category, ev.name
    """).fetchall()

    if len(srd_rows) != 339:
        raise RuntimeError(f"Expected 339 validated SRD spells/cantrips, got {len(srd_rows)}")

    profiles: list[tuple[sqlite3.Row, dict[str, Any]]] = []
    level_counts = Counter()
    for row in srd_rows:
        profile = build_profile(row)
        level = profile["spell_level"]
        if level is None or not 0 <= level <= 9:
            raise RuntimeError(f"Invalid spell level for {row['name']}: {level}")
        level_counts[level] += 1
        profiles.append((row, profile))

    if dict(sorted(level_counts.items())) != EXPECTED_SRD_LEVELS:
        raise RuntimeError(
            f"SRD spell level distribution mismatch: {dict(sorted(level_counts.items()))}"
        )

    book_rows = db.execute("""
        SELECT ev.*, s.title AS source_title
        FROM current_entity_versions ev
        JOIN sources s ON s.id=ev.source_id
        WHERE ev.category IN ('spell','cantrip')
          AND ev.status='extracted'
          AND s.source_kind LIKE 'official-%'
        ORDER BY s.source_priority DESC, s.title, ev.name
    """).fetchall()

    recovery: list[dict[str, Any]] = []
    for row in book_rows:
        quality, reason = quality_for_book_candidate(row)
        recovery.append({
            "entity_version_id": row["id"],
            "name": clean(row["name"]),
            "category": row["category"],
            "rules_version": row["rules_version"],
            "source_id": row["source_id"],
            "source_title": row["source_title"],
            "source_page": row["source_page_start"],
            "confidence": float(row["confidence"]),
            "quality": quality,
            "reason": reason,
        })

    rule_rows = db.execute("""
        SELECT ev.*, s.title AS source_title
        FROM current_entity_versions ev
        JOIN sources s ON s.id=ev.source_id
        WHERE ev.category='spellcasting-rule'
        ORDER BY s.source_priority DESC, s.title, ev.name
    """).fetchall()

    rule_review = [{
        "entity_version_id": row["id"],
        "name": clean(row["name"]),
        "rules_version": row["rules_version"],
        "source_id": row["source_id"],
        "source_title": row["source_title"],
        "source_page": row["source_page_start"],
        "status": row["status"],
        "confidence": float(row["confidence"]),
        "reason": (
            "Review required before promotion; spellcasting-rule classifier output "
            "may contain spell text or OCR fragments."
        ),
    } for row in rule_rows]

    batch_id = f"phase4-spells-{datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ')}"

    if args.apply:
        ensure_schema(db)
        db.execute("BEGIN IMMEDIATE")
        try:
            db.execute("DELETE FROM spell_engine_profiles")
            db.execute("DELETE FROM spell_registry")
            db.execute("DELETE FROM book_spell_recovery_queue")
            db.execute("DELETE FROM spellcasting_rule_review_queue")

            db.execute("""
                INSERT INTO phase4_spell_batches(
                  id,created_at,source_db_sha256,srd_spell_count,
                  book_recovery_count,spellcasting_rule_review_count
                ) VALUES(?,?,?,?,?,?)
            """, (
                batch_id, now_iso(), db_hash_before, len(srd_rows),
                len(recovery), len(rule_review),
            ))

            for row, profile in profiles:
                spell_id = (
                    f"spell.{re.sub(r'[^a-z0-9]+','-',row['name'].casefold()).strip('-')}"
                )
                db.execute("""
                    INSERT INTO spell_registry(
                      spell_id,spell_name,spell_level,category,entity_version_id,
                      rules_version,source_id,source_title,validation_scope,
                      batch_id,validated_at
                    ) VALUES(?,?,?,?,?,?,?,?,?,?,?)
                """, (
                    spell_id, row["name"], profile["spell_level"], row["category"],
                    row["id"], "2024", row["source_id"], row["source_title"],
                    "validated-srd-structured-runtime-baseline", batch_id, now_iso(),
                ))

                db.execute("""
                    INSERT INTO spell_engine_profiles(
                      spell_id,casting_time,action_resource,range_text,components_json,
                      duration_text,concentration,ritual,school,classes_json,
                      attack_roll,save_ability,dice_json,damage_types_json,
                      healing_detected,area_shape,area_size_feet,
                      cantrip_scaling_detected,upcast_detected,save_half_detected,
                      save_none_detected,target_selection_required,
                      automation_completeness,automation_gaps_json,parser_version
                    ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
                """, (
                    spell_id,
                    profile["casting_time"],
                    profile["action_resource"],
                    profile["range_text"],
                    json.dumps(profile["components"], ensure_ascii=False),
                    profile["duration"],
                    int(profile["concentration"]),
                    int(profile["ritual"]),
                    profile["school"],
                    json.dumps(profile["classes"], ensure_ascii=False),
                    int(profile["attack_roll"]),
                    profile["save_ability"],
                    json.dumps(profile["dice"], ensure_ascii=False),
                    json.dumps(profile["damage_types"], ensure_ascii=False),
                    int(profile["healing"]),
                    profile["area_shape"],
                    profile["area_size"],
                    int(profile["cantrip_scaling"]),
                    int(profile["upcast"]),
                    int(profile["save_half"]),
                    int(profile["save_none"]),
                    int(profile["target_selection"]),
                    profile["completeness"],
                    json.dumps(profile["gaps"], ensure_ascii=False),
                    "phase4-v1",
                ))

            for item in recovery:
                db.execute("""
                    INSERT INTO book_spell_recovery_queue(
                      entity_version_id,name,category,rules_version,source_id,
                      source_title,source_page,confidence,quality,reason,batch_id
                    ) VALUES(?,?,?,?,?,?,?,?,?,?,?)
                """, (
                    item["entity_version_id"], item["name"], item["category"],
                    item["rules_version"], item["source_id"], item["source_title"],
                    item["source_page"], item["confidence"], item["quality"],
                    item["reason"], batch_id,
                ))

            for item in rule_review:
                db.execute("""
                    INSERT INTO spellcasting_rule_review_queue(
                      entity_version_id,name,rules_version,source_id,source_title,
                      source_page,status,confidence,reason,batch_id
                    ) VALUES(?,?,?,?,?,?,?,?,?,?)
                """, (
                    item["entity_version_id"], item["name"], item["rules_version"],
                    item["source_id"], item["source_title"], item["source_page"],
                    item["status"], item["confidence"], item["reason"], batch_id,
                ))

            db.commit()
        except Exception:
            db.rollback()
            raise

    spell_count = db.execute("SELECT COUNT(*) FROM spell_registry").fetchone()[0]
    cantrip_count = db.execute(
        "SELECT COUNT(*) FROM spell_registry WHERE spell_level=0"
    ).fetchone()[0]
    leveled_count = db.execute(
        "SELECT COUNT(*) FROM spell_registry WHERE spell_level>0"
    ).fetchone()[0]
    engine_count = db.execute("SELECT COUNT(*) FROM spell_engine_profiles").fetchone()[0]
    recovery_count = db.execute("SELECT COUNT(*) FROM book_spell_recovery_queue").fetchone()[0]
    rule_review_count = db.execute("SELECT COUNT(*) FROM spellcasting_rule_review_queue").fetchone()[0]

    completeness_rows = db.execute("""
        SELECT automation_completeness, COUNT(*) AS n
        FROM spell_engine_profiles
        GROUP BY automation_completeness
        ORDER BY automation_completeness DESC
    """).fetchall()

    gap_counts: Counter[str] = Counter()
    engine_rows = [dict(row) for row in db.execute("""
        SELECT r.spell_id,r.spell_name,r.spell_level,r.category,
               p.*
        FROM spell_registry r
        JOIN spell_engine_profiles p ON p.spell_id=r.spell_id
        ORDER BY r.spell_level,r.spell_name
    """)]
    for row in engine_rows:
        try:
            gaps = json.loads(row["automation_gaps_json"])
        except Exception:
            gaps = []
        for gap in gaps:
            gap_counts[str(gap)] += 1

    recovery_rows = [dict(row) for row in db.execute("""
        SELECT * FROM book_spell_recovery_queue
        ORDER BY quality,source_title,name
    """)]
    quality_counts = Counter(row["quality"] for row in recovery_rows)

    report = {
        "batchId": batch_id,
        "applied": args.apply,
        "dependencies": deps,
        "spellRegistryCount": spell_count,
        "cantripCount": cantrip_count,
        "leveledSpellCount": leveled_count,
        "engineProfileCount": engine_count,
        "bookRecoveryQueueCount": recovery_count,
        "bookRecoveryQualityCounts": dict(quality_counts),
        "spellcastingRuleReviewQueueCount": rule_review_count,
        "levelCounts": {str(k): v for k, v in sorted(level_counts.items())},
        "automationGapCounts": dict(gap_counts),
        "automationCompletenessDistribution": {
            str(row["automation_completeness"]): row["n"]
            for row in completeness_rows
        },
        "phaseStatus": (
            "STRUCTURED_BASELINE_COMPLETE_BOOK_RECOVERY_PENDING"
            if recovery_count or rule_review_count
            else "READY_TO_CLOSE"
        ),
        "lockedRuntimeArchitecture": {
            "autoPlay": False,
            "playerOrDmInitiatesCast": True,
            "serverAuthoritative": True,
            "deterministicMathAutomationTarget": True,
            "diceSelectionAutomationTarget": True,
            "cantripScalingAutomationTarget": True,
            "upcastAutomationTarget": True,
            "targetAndAoEValidationTarget": True,
            "damageHealingPipelineTarget": True,
        },
    }

    (output / "phase4_runtime_validation_report.json").write_text(
        json.dumps(report, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )

    registry_rows = [dict(row) for row in db.execute("""
        SELECT * FROM spell_registry ORDER BY spell_level,spell_name
    """)]

    for filename, rows in (
        ("spell_registry", registry_rows),
        ("spell_engine_profiles", engine_rows),
        ("book_spell_recovery_queue", recovery_rows),
        ("spellcasting_rule_review_queue", [dict(r) for r in db.execute(
            "SELECT * FROM spellcasting_rule_review_queue ORDER BY source_title,name"
        )]),
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

    gap_rows = [{"gap": k, "spell_count": v} for k, v in sorted(gap_counts.items())]
    with (output / "spell_engine_gap_matrix.csv").open(
        "w", encoding="utf-8-sig", newline=""
    ) as handle:
        writer = csv.DictWriter(handle, fieldnames=["gap","spell_count"])
        writer.writeheader()
        writer.writerows(gap_rows)
    (output / "spell_engine_gap_matrix.json").write_text(
        json.dumps(gap_rows, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )

    summary = [
        "# Phase 4 — Structured Spell Runtime Baseline",
        "",
        f"- Validated spell registry: **{spell_count}**",
        f"- Cantrips: **{cantrip_count}**",
        f"- Leveled spells: **{leveled_count}**",
        f"- Engine profiles: **{engine_count}**",
        f"- Book spell recovery queue: **{recovery_count}**",
        f"- Spellcasting-rule review queue: **{rule_review_count}**",
        "",
        "## Status",
        "",
        report["phaseStatus"],
        "",
        "## Automation gaps",
    ]
    for gap, count in sorted(gap_counts.items()):
        summary.append(f"- {gap}: {count}")

    (output / "PHASE4_RUNTIME_SUMMARY.md").write_text(
        "\n".join(summary) + "\n",
        encoding="utf-8",
        newline="\n",
    )

    db.close()

    print("PHASE 4 STRUCTURED SPELL RUNTIME BASELINE COMPLETE")
    print(f"APPLIED={args.apply}")
    print(f"SPELLS={spell_count}")
    print(f"CANTRIPS={cantrip_count}")
    print(f"LEVELED_SPELLS={leveled_count}")
    print(f"ENGINE_PROFILES={engine_count}")
    print(f"BOOK_RECOVERY_QUEUE={recovery_count}")
    print(f"SPELLCASTING_RULE_REVIEW={rule_review_count}")
    print(f"PHASE_STATUS={report['phaseStatus']}")
    print(f"OUTPUT={output}")
    return 0

if __name__ == "__main__":
    raise SystemExit(main())
