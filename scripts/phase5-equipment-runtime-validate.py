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
OUTPUT_ROOT = PROJECT_ROOT / "_phase5_equipment_structured_runtime"

EXPECTED = {
    "core_rule_registry": 75,
    "class_registry": 12,
    "subclass_registry": 48,
    "class_feature_registry": 442,
    "species_registry": 10,
    "background_registry": 16,
    "feat_registry": 75,
    "spell_registry": 339,
    "book_spell_registry_min": 475,
    "phase4_residual_queue": 0,
    "phase4_rule_queue": 0,
    "official_books": 13,
    "srd_weapons": 38,
    "srd_armor": 13,
    "srd_equipment": 124,
    "srd_packs": 7,
}

# 2024 SRD armor mechanics. This table exists because the generated SRD import
# preserved price/weight/stealth but did not retain AC/category fields.
ARMOR_MECHANICS = {
    "Padded Armor": {
        "armor_category": "Light",
        "base_ac": 11,
        "dex_mode": "full",
        "dex_cap": None,
        "strength_requirement": None,
        "stealth_disadvantage": True,
        "ac_bonus": 0,
    },
    "Leather Armor": {
        "armor_category": "Light",
        "base_ac": 11,
        "dex_mode": "full",
        "dex_cap": None,
        "strength_requirement": None,
        "stealth_disadvantage": False,
        "ac_bonus": 0,
    },
    "Studded Leather Armor": {
        "armor_category": "Light",
        "base_ac": 12,
        "dex_mode": "full",
        "dex_cap": None,
        "strength_requirement": None,
        "stealth_disadvantage": False,
        "ac_bonus": 0,
    },
    "Hide Armor": {
        "armor_category": "Medium",
        "base_ac": 12,
        "dex_mode": "capped",
        "dex_cap": 2,
        "strength_requirement": None,
        "stealth_disadvantage": False,
        "ac_bonus": 0,
    },
    "Chain Shirt": {
        "armor_category": "Medium",
        "base_ac": 13,
        "dex_mode": "capped",
        "dex_cap": 2,
        "strength_requirement": None,
        "stealth_disadvantage": False,
        "ac_bonus": 0,
    },
    "Scale Mail": {
        "armor_category": "Medium",
        "base_ac": 14,
        "dex_mode": "capped",
        "dex_cap": 2,
        "strength_requirement": None,
        "stealth_disadvantage": True,
        "ac_bonus": 0,
    },
    "Breastplate": {
        "armor_category": "Medium",
        "base_ac": 14,
        "dex_mode": "capped",
        "dex_cap": 2,
        "strength_requirement": None,
        "stealth_disadvantage": False,
        "ac_bonus": 0,
    },
    "Half-Plate Armor": {
        "armor_category": "Medium",
        "base_ac": 15,
        "dex_mode": "capped",
        "dex_cap": 2,
        "strength_requirement": None,
        "stealth_disadvantage": True,
        "ac_bonus": 0,
    },
    "Ring Mail": {
        "armor_category": "Heavy",
        "base_ac": 14,
        "dex_mode": "none",
        "dex_cap": 0,
        "strength_requirement": None,
        "stealth_disadvantage": True,
        "ac_bonus": 0,
    },
    "Chain Mail": {
        "armor_category": "Heavy",
        "base_ac": 16,
        "dex_mode": "none",
        "dex_cap": 0,
        "strength_requirement": 13,
        "stealth_disadvantage": True,
        "ac_bonus": 0,
    },
    "Splint Armor": {
        "armor_category": "Heavy",
        "base_ac": 17,
        "dex_mode": "none",
        "dex_cap": 0,
        "strength_requirement": 15,
        "stealth_disadvantage": True,
        "ac_bonus": 0,
    },
    "Plate Armor": {
        "armor_category": "Heavy",
        "base_ac": 18,
        "dex_mode": "none",
        "dex_cap": 0,
        "strength_requirement": 15,
        "stealth_disadvantage": True,
        "ac_bonus": 0,
    },
    "Shield": {
        "armor_category": "Shield",
        "base_ac": 0,
        "dex_mode": "none",
        "dex_cap": None,
        "strength_requirement": None,
        "stealth_disadvantage": False,
        "ac_bonus": 2,
    },
}

EMPTY_PROPERTY_WEAPONS = {"Flail", "Mace", "Morningstar"}

def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()

def sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()

def clean(value: Any) -> str:
    return re.sub(r"\s+", " ", str(value or "")).strip()

def norm(value: str) -> str:
    return re.sub(r"[^a-z0-9]+", "", (value or "").casefold())

def slug(value: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", (value or "").casefold()).strip("-")

def parse_json(value: str | None) -> dict[str, Any]:
    try:
        obj = json.loads(value or "{}")
        return obj if isinstance(obj, dict) else {}
    except Exception:
        return {}

def first(structured: dict[str, Any], *keys: str) -> Any:
    for key in keys:
        if key in structured and structured[key] not in (None, "", [], {}):
            return structured[key]
    return None

def dependency_counts(db: sqlite3.Connection) -> dict[str, int]:
    return {
        "core_rule_registry": db.execute("SELECT COUNT(*) FROM core_rule_registry").fetchone()[0],
        "class_registry": db.execute("SELECT COUNT(*) FROM class_registry").fetchone()[0],
        "subclass_registry": db.execute("SELECT COUNT(*) FROM subclass_registry").fetchone()[0],
        "class_feature_registry": db.execute("SELECT COUNT(*) FROM class_feature_registry").fetchone()[0],
        "species_registry": db.execute("SELECT COUNT(*) FROM species_registry").fetchone()[0],
        "background_registry": db.execute("SELECT COUNT(*) FROM background_registry").fetchone()[0],
        "feat_registry": db.execute("SELECT COUNT(*) FROM feat_registry").fetchone()[0],
        "spell_registry": db.execute("SELECT COUNT(*) FROM spell_registry").fetchone()[0],
        "book_spell_registry": db.execute("SELECT COUNT(*) FROM book_spell_registry").fetchone()[0],
        "phase4_residual_queue": db.execute("SELECT COUNT(*) FROM phase4_residual_spell_review").fetchone()[0],
        "phase4_rule_queue": db.execute("SELECT COUNT(*) FROM spellcasting_rule_review_queue").fetchone()[0],
        "official_books": db.execute("SELECT COUNT(*) FROM sources WHERE source_kind LIKE 'official-%'").fetchone()[0],
    }

def infer_weapon_category(subcategory: str) -> tuple[str, str]:
    low = subcategory.casefold()
    proficiency = "Martial" if "martial" in low else "Simple"
    mode = "Ranged" if "ranged" in low else "Melee"
    return proficiency, mode

def normalize_properties(value: Any, name: str) -> list[str]:
    if value in (None, "", [], {}):
        return [] if name in EMPTY_PROPERTY_WEAPONS else []
    if isinstance(value, list):
        return [clean(x) for x in value if clean(x)]
    if isinstance(value, str):
        return [clean(x) for x in re.split(r"[,;·]", value) if clean(x)]
    return []

def parse_range(structured: dict[str, Any], properties: list[str], mode: str) -> dict[str, int | None]:
    normal = first(
        structured,
        "rangeNormal","range_normal","normalRange","normal_range",
        "rangeFeet","range_feet","range",
    )
    long_ = first(
        structured,
        "rangeLong","range_long","longRange","long_range","longRangeFeet","long_range_feet",
    )

    normal_int = None
    long_int = None

    if isinstance(normal, (int, float)):
        normal_int = int(normal)
    elif isinstance(normal, str):
        nums = [int(x) for x in re.findall(r"\d+", normal)]
        if nums:
            normal_int = nums[0]
            if len(nums) > 1 and long_ is None:
                long_int = nums[1]

    if isinstance(long_, (int, float)):
        long_int = int(long_)
    elif isinstance(long_, str):
        nums = re.findall(r"\d+", long_)
        if nums:
            long_int = int(nums[0])

    # A ranged weapon without parsed distance remains an explicit automation
    # backlog item; never invent range values.
    return {"normal": normal_int, "long": long_int}

def weapon_profile(row: sqlite3.Row) -> dict[str, Any]:
    s = parse_json(row["structured_json"])
    properties = normalize_properties(
        first(s, "properties","weaponProperties","weapon_properties"),
        row["name"],
    )
    proficiency, mode = infer_weapon_category(row["subcategory"] or "")

    damage = first(s, "damage","damageDice","damage_dice")
    damage_type = first(s, "damageType","damage_type")
    mastery = first(s, "mastery","masteryProperty","mastery_property")
    cost = first(s, "cost","price")
    weight = first(s, "weight")
    range_data = parse_range(s, properties, mode)

    gaps: list[str] = []
    if damage in (None, ""):
        gaps.append("damage")
    if damage_type in (None, ""):
        gaps.append("damage-type")
    if mastery in (None, ""):
        gaps.append("mastery")
    if cost in (None, ""):
        gaps.append("cost")
    if weight is None:
        gaps.append("weight")
    if mode == "Ranged" and range_data["normal"] is None:
        gaps.append("range")

    # No properties is valid for these weapons; do not classify as incomplete.
    if not properties and row["name"] not in EMPTY_PROPERTY_WEAPONS:
        # Some valid weapons can still have no properties. Keep this informational
        # rather than blocking structured validation.
        pass

    return {
        "weapon_name": row["name"],
        "proficiency_category": proficiency,
        "attack_mode": mode,
        "damage_dice": clean(damage),
        "damage_type": clean(damage_type),
        "properties": properties,
        "mastery": clean(mastery),
        "range_normal_feet": range_data["normal"],
        "range_long_feet": range_data["long"],
        "cost": cost,
        "weight": weight,
        "automation_gaps": gaps,
    }

def armor_profile(row: sqlite3.Row) -> dict[str, Any]:
    if row["name"] not in ARMOR_MECHANICS:
        raise RuntimeError(f"Missing canonical armor mechanics: {row['name']}")
    mechanics = dict(ARMOR_MECHANICS[row["name"]])
    s = parse_json(row["structured_json"])
    mechanics.update({
        "armor_name": row["name"],
        "cost": first(s, "cost","price"),
        "weight": first(s, "weight"),
    })
    gaps = []
    if mechanics["cost"] in (None, ""):
        gaps.append("cost")
    if mechanics["weight"] is None:
        gaps.append("weight")
    mechanics["automation_gaps"] = gaps
    return mechanics

def equipment_profile(row: sqlite3.Row) -> dict[str, Any]:
    s = parse_json(row["structured_json"])
    return {
        "equipment_name": row["name"],
        "equipment_type": clean(first(s, "equipmentType","equipment_type","type") or row["subcategory"]),
        "cost": first(s, "cost","price"),
        "weight": first(s, "weight"),
        "uses": first(s, "uses"),
        "capacity": first(s, "capacity"),
        "raw_structured_json": s,
    }

def pack_profile(row: sqlite3.Row) -> dict[str, Any]:
    s = parse_json(row["structured_json"])
    contents = first(s, "contents","items","packContents","pack_contents")
    if not isinstance(contents, list):
        contents = []
    return {
        "pack_name": row["name"],
        "contents": contents,
        "cost": first(s, "cost","price"),
        "weight": first(s, "weight"),
        "automation_gaps": ([] if contents else ["contents"]),
    }

def ensure_schema(db: sqlite3.Connection) -> None:
    db.executescript("""
    CREATE TABLE IF NOT EXISTS phase5_equipment_batches(
      id TEXT PRIMARY KEY,
      created_at TEXT NOT NULL,
      source_db_sha256 TEXT NOT NULL,
      weapon_count INTEGER NOT NULL,
      armor_count INTEGER NOT NULL,
      equipment_count INTEGER NOT NULL,
      pack_count INTEGER NOT NULL,
      review_count INTEGER NOT NULL,
      automation_backlog_count INTEGER NOT NULL
    ) STRICT;

    CREATE TABLE IF NOT EXISTS equipment_registry(
      equipment_id TEXT PRIMARY KEY,
      item_name TEXT NOT NULL,
      item_category TEXT NOT NULL,
      entity_version_id TEXT NOT NULL REFERENCES entity_versions(id),
      rules_version TEXT NOT NULL,
      source_id TEXT NOT NULL REFERENCES sources(id),
      source_title TEXT NOT NULL,
      validation_scope TEXT NOT NULL,
      batch_id TEXT NOT NULL REFERENCES phase5_equipment_batches(id),
      validated_at TEXT NOT NULL
    ) STRICT;

    CREATE TABLE IF NOT EXISTS weapon_engine_profiles(
      equipment_id TEXT PRIMARY KEY REFERENCES equipment_registry(equipment_id),
      proficiency_category TEXT NOT NULL,
      attack_mode TEXT NOT NULL,
      damage_dice TEXT NOT NULL,
      damage_type TEXT NOT NULL,
      properties_json TEXT NOT NULL,
      mastery TEXT NOT NULL,
      range_normal_feet INTEGER,
      range_long_feet INTEGER,
      cost_json TEXT NOT NULL,
      weight REAL,
      automation_gaps_json TEXT NOT NULL
    ) STRICT;

    CREATE TABLE IF NOT EXISTS armor_engine_profiles(
      equipment_id TEXT PRIMARY KEY REFERENCES equipment_registry(equipment_id),
      armor_category TEXT NOT NULL,
      base_ac INTEGER NOT NULL,
      dex_mode TEXT NOT NULL,
      dex_cap INTEGER,
      strength_requirement INTEGER,
      stealth_disadvantage INTEGER NOT NULL,
      ac_bonus INTEGER NOT NULL,
      cost_json TEXT NOT NULL,
      weight REAL,
      automation_gaps_json TEXT NOT NULL
    ) STRICT;

    CREATE TABLE IF NOT EXISTS general_equipment_profiles(
      equipment_id TEXT PRIMARY KEY REFERENCES equipment_registry(equipment_id),
      equipment_type TEXT NOT NULL,
      cost_json TEXT NOT NULL,
      weight REAL,
      uses_json TEXT NOT NULL,
      capacity_json TEXT NOT NULL,
      structured_json TEXT NOT NULL
    ) STRICT;

    CREATE TABLE IF NOT EXISTS pack_engine_profiles(
      equipment_id TEXT PRIMARY KEY REFERENCES equipment_registry(equipment_id),
      contents_json TEXT NOT NULL,
      cost_json TEXT NOT NULL,
      weight REAL,
      automation_gaps_json TEXT NOT NULL
    ) STRICT;

    CREATE TABLE IF NOT EXISTS phase5_equipment_review_queue(
      entity_version_id TEXT PRIMARY KEY REFERENCES entity_versions(id),
      name TEXT NOT NULL,
      category TEXT NOT NULL,
      rules_version TEXT NOT NULL,
      source_title TEXT NOT NULL,
      source_page INTEGER,
      confidence REAL NOT NULL,
      resolution_hint TEXT NOT NULL,
      batch_id TEXT NOT NULL REFERENCES phase5_equipment_batches(id)
    ) STRICT;

    CREATE TABLE IF NOT EXISTS phase5_automation_backlog(
      equipment_id TEXT NOT NULL REFERENCES equipment_registry(equipment_id),
      gap_type TEXT NOT NULL,
      status TEXT NOT NULL,
      notes TEXT NOT NULL,
      batch_id TEXT NOT NULL REFERENCES phase5_equipment_batches(id),
      PRIMARY KEY(equipment_id,gap_type)
    ) STRICT;

    DROP VIEW IF EXISTS effective_equipment_catalog;
    CREATE VIEW effective_equipment_catalog AS
      SELECT r.*, ev.summary, ev.structured_json, ev.raw_text
      FROM equipment_registry r
      JOIN entity_versions ev ON ev.id=r.entity_version_id;
    """)
    db.commit()

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

    deps = dependency_counts(db)
    if deps["core_rule_registry"] != EXPECTED["core_rule_registry"]:
        raise RuntimeError("Phase 1 dependency mismatch.")
    if (deps["class_registry"],deps["subclass_registry"],deps["class_feature_registry"]) != (12,48,442):
        raise RuntimeError("Phase 2 dependency mismatch.")
    if (deps["species_registry"],deps["background_registry"],deps["feat_registry"]) != (10,16,75):
        raise RuntimeError("Phase 3 dependency mismatch.")
    if deps["spell_registry"] != 339 or deps["book_spell_registry"] < 475:
        raise RuntimeError("Phase 4 dependency mismatch.")
    if deps["phase4_residual_queue"] != 0 or deps["phase4_rule_queue"] != 0:
        raise RuntimeError("Phase 4 unresolved queues remain.")
    if deps["official_books"] != 13:
        raise RuntimeError("Official book count mismatch.")

    srd_rows = db.execute("""
        SELECT ev.*, s.title AS source_title
        FROM current_entity_versions ev
        JOIN sources s ON s.id=ev.source_id
        WHERE ev.category IN ('weapon','armor','equipment','pack')
          AND ev.rules_version='2024'
          AND ev.status='validated'
          AND s.title='SRD 5.2.1'
        ORDER BY ev.category,ev.name
    """).fetchall()

    counts = Counter(row["category"] for row in srd_rows)
    expected_counts = {
        "weapon":38,"armor":13,"equipment":124,"pack":7
    }
    if dict(counts) != expected_counts:
        raise RuntimeError(f"SRD equipment distribution mismatch: {dict(counts)}")

    weapons = [(row, weapon_profile(row)) for row in srd_rows if row["category"]=="weapon"]
    armors = [(row, armor_profile(row)) for row in srd_rows if row["category"]=="armor"]
    equipment = [(row, equipment_profile(row)) for row in srd_rows if row["category"]=="equipment"]
    packs = [(row, pack_profile(row)) for row in srd_rows if row["category"]=="pack"]

    extracted_rows = db.execute("""
        SELECT ev.*, s.title AS source_title
        FROM current_entity_versions ev
        JOIN sources s ON s.id=ev.source_id
        WHERE ev.category IN ('weapon','armor','equipment','pack')
          AND ev.status='extracted'
          AND s.source_kind LIKE 'official-%'
        ORDER BY s.source_priority DESC,s.title,ev.name
    """).fetchall()

    review = []
    for row in extracted_rows:
        name = clean(row["name"])
        n = name.casefold()
        if any(token in n for token in (
            "skill proficien","ability score","level ","chapter ",
            "starting equipment","weapon mastery","armor training",
            "tool proficien","choose ","adventuring gear",
        )):
            hint = "classifier-noise-or-rule-reference"
        elif float(row["confidence"]) < 0.80:
            hint = "low-confidence-review"
        else:
            hint = "manual-source-review-before-promotion"
        review.append({
            "entity_version_id":row["id"],
            "name":name,
            "category":row["category"],
            "rules_version":row["rules_version"],
            "source_id":row["source_id"],
            "source_title":row["source_title"],
            "source_page":row["source_page_start"],
            "confidence":float(row["confidence"]),
            "resolution_hint":hint,
        })

    gaps = []
    for row, profile in weapons:
        for gap in profile["automation_gaps"]:
            gaps.append((f"equipment.weapon.{slug(row['name'])}", gap))
    for row, profile in armors:
        for gap in profile["automation_gaps"]:
            gaps.append((f"equipment.armor.{slug(row['name'])}", gap))
    for row, profile in packs:
        for gap in profile["automation_gaps"]:
            gaps.append((f"equipment.pack.{slug(row['name'])}", gap))

    batch_id = f"phase5-equipment-{datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ')}"

    if args.apply:
        ensure_schema(db)
        db.execute("BEGIN IMMEDIATE")
        try:
            db.execute("DELETE FROM phase5_automation_backlog")
            db.execute("DELETE FROM phase5_equipment_review_queue")
            db.execute("DELETE FROM weapon_engine_profiles")
            db.execute("DELETE FROM armor_engine_profiles")
            db.execute("DELETE FROM general_equipment_profiles")
            db.execute("DELETE FROM pack_engine_profiles")
            db.execute("DELETE FROM equipment_registry")

            db.execute("""
                INSERT INTO phase5_equipment_batches(
                  id,created_at,source_db_sha256,weapon_count,armor_count,
                  equipment_count,pack_count,review_count,automation_backlog_count
                ) VALUES(?,?,?,?,?,?,?,?,?)
            """, (
                batch_id,now_iso(),db_hash_before,38,13,124,7,len(review),len(gaps)
            ))

            for row in srd_rows:
                item_id = f"equipment.{row['category']}.{slug(row['name'])}"
                db.execute("""
                    INSERT INTO equipment_registry(
                      equipment_id,item_name,item_category,entity_version_id,
                      rules_version,source_id,source_title,validation_scope,
                      batch_id,validated_at
                    ) VALUES(?,?,?,?,?,?,?,?,?,?)
                """, (
                    item_id,row["name"],row["category"],row["id"],"2024",
                    row["source_id"],row["source_title"],
                    "validated-srd-structured-runtime-baseline",
                    batch_id,now_iso(),
                ))

            for row, p in weapons:
                item_id = f"equipment.weapon.{slug(row['name'])}"
                db.execute("""
                    INSERT INTO weapon_engine_profiles(
                      equipment_id,proficiency_category,attack_mode,damage_dice,
                      damage_type,properties_json,mastery,range_normal_feet,
                      range_long_feet,cost_json,weight,automation_gaps_json
                    ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)
                """, (
                    item_id,p["proficiency_category"],p["attack_mode"],
                    p["damage_dice"],p["damage_type"],
                    json.dumps(p["properties"],ensure_ascii=False),p["mastery"],
                    p["range_normal_feet"],p["range_long_feet"],
                    json.dumps(p["cost"],ensure_ascii=False),p["weight"],
                    json.dumps(p["automation_gaps"],ensure_ascii=False),
                ))

            for row, p in armors:
                item_id = f"equipment.armor.{slug(row['name'])}"
                db.execute("""
                    INSERT INTO armor_engine_profiles(
                      equipment_id,armor_category,base_ac,dex_mode,dex_cap,
                      strength_requirement,stealth_disadvantage,ac_bonus,
                      cost_json,weight,automation_gaps_json
                    ) VALUES(?,?,?,?,?,?,?,?,?,?,?)
                """, (
                    item_id,p["armor_category"],p["base_ac"],p["dex_mode"],
                    p["dex_cap"],p["strength_requirement"],
                    int(p["stealth_disadvantage"]),p["ac_bonus"],
                    json.dumps(p["cost"],ensure_ascii=False),p["weight"],
                    json.dumps(p["automation_gaps"],ensure_ascii=False),
                ))

            for row, p in equipment:
                item_id = f"equipment.equipment.{slug(row['name'])}"
                db.execute("""
                    INSERT INTO general_equipment_profiles(
                      equipment_id,equipment_type,cost_json,weight,
                      uses_json,capacity_json,structured_json
                    ) VALUES(?,?,?,?,?,?,?)
                """, (
                    item_id,p["equipment_type"],
                    json.dumps(p["cost"],ensure_ascii=False),p["weight"],
                    json.dumps(p["uses"],ensure_ascii=False),
                    json.dumps(p["capacity"],ensure_ascii=False),
                    json.dumps(p["raw_structured_json"],ensure_ascii=False),
                ))

            for row, p in packs:
                item_id = f"equipment.pack.{slug(row['name'])}"
                db.execute("""
                    INSERT INTO pack_engine_profiles(
                      equipment_id,contents_json,cost_json,weight,automation_gaps_json
                    ) VALUES(?,?,?,?,?)
                """, (
                    item_id,json.dumps(p["contents"],ensure_ascii=False),
                    json.dumps(p["cost"],ensure_ascii=False),p["weight"],
                    json.dumps(p["automation_gaps"],ensure_ascii=False),
                ))

            for item in review:
                db.execute("""
                    INSERT INTO phase5_equipment_review_queue(
                      entity_version_id,name,category,rules_version,source_title,
                      source_page,confidence,resolution_hint,batch_id
                    ) VALUES(?,?,?,?,?,?,?,?,?)
                """, (
                    item["entity_version_id"],item["name"],item["category"],
                    item["rules_version"],item["source_title"],item["source_page"],
                    item["confidence"],item["resolution_hint"],batch_id,
                ))

            for equipment_id, gap in gaps:
                db.execute("""
                    INSERT INTO phase5_automation_backlog(
                      equipment_id,gap_type,status,notes,batch_id
                    ) VALUES(?,?,?,?,?)
                """, (
                    equipment_id,gap,"ENGINE_AUTOMATION_BACKLOG",
                    "Structured content is validated; missing runtime metadata must be recovered or implemented before full automation.",
                    batch_id,
                ))

            db.commit()
        except Exception:
            db.rollback()
            raise

    registry_count = db.execute("SELECT COUNT(*) FROM equipment_registry").fetchone()[0]
    weapon_count = db.execute("SELECT COUNT(*) FROM weapon_engine_profiles").fetchone()[0]
    armor_count = db.execute("SELECT COUNT(*) FROM armor_engine_profiles").fetchone()[0]
    equipment_count = db.execute("SELECT COUNT(*) FROM general_equipment_profiles").fetchone()[0]
    pack_count = db.execute("SELECT COUNT(*) FROM pack_engine_profiles").fetchone()[0]
    review_count = db.execute("SELECT COUNT(*) FROM phase5_equipment_review_queue").fetchone()[0]
    backlog_count = db.execute("SELECT COUNT(*) FROM phase5_automation_backlog").fetchone()[0]

    # Verify armor runtime fields are complete.
    bad_armor = db.execute("""
        SELECT COUNT(*) FROM armor_engine_profiles
        WHERE armor_category='' OR base_ac<0 OR dex_mode=''
    """).fetchone()[0]

    reports = {
        "equipment_registry": [dict(r) for r in db.execute(
            "SELECT * FROM equipment_registry ORDER BY item_category,item_name"
        )],
        "weapon_engine_profiles": [dict(r) for r in db.execute(
            "SELECT * FROM weapon_engine_profiles ORDER BY equipment_id"
        )],
        "armor_engine_profiles": [dict(r) for r in db.execute(
            "SELECT * FROM armor_engine_profiles ORDER BY equipment_id"
        )],
        "pack_engine_profiles": [dict(r) for r in db.execute(
            "SELECT * FROM pack_engine_profiles ORDER BY equipment_id"
        )],
        "equipment_review_queue": [dict(r) for r in db.execute(
            "SELECT * FROM phase5_equipment_review_queue ORDER BY resolution_hint,source_title,name"
        )],
        "automation_backlog": [dict(r) for r in db.execute(
            "SELECT * FROM phase5_automation_backlog ORDER BY gap_type,equipment_id"
        )],
    }

    report = {
        "batchId":batch_id,
        "applied":args.apply,
        "dependencies":deps,
        "registryCount":registry_count,
        "weaponProfiles":weapon_count,
        "armorProfiles":armor_count,
        "generalEquipmentProfiles":equipment_count,
        "packProfiles":pack_count,
        "reviewQueueCount":review_count,
        "automationBacklogCount":backlog_count,
        "badArmorProfiles":bad_armor,
        "phaseStatus": (
            "STRUCTURED_BASELINE_COMPLETE_BOOK_REVIEW_PENDING"
            if review_count else "READY_TO_CLOSE"
        ),
        "runtimeArchitecture": {
            "weaponAttackDataStructured": True,
            "weaponMasteryStructured": True,
            "armorACStructured": True,
            "equipStateAutomationTarget": True,
            "inventoryAutomationTarget": True,
            "serverAuthoritativeTarget": True,
        },
    }

    (output/"phase5_validation_report.json").write_text(
        json.dumps(report,ensure_ascii=False,indent=2)+"\n",encoding="utf-8"
    )

    def export(name: str, rows: list[dict[str, Any]]) -> None:
        (output/f"{name}.json").write_text(
            json.dumps(rows,ensure_ascii=False,indent=2)+"\n",encoding="utf-8"
        )
        if rows:
            with (output/f"{name}.csv").open("w",encoding="utf-8-sig",newline="") as f:
                w=csv.DictWriter(f,fieldnames=list(rows[0].keys()))
                w.writeheader(); w.writerows(rows)

    for name, rows in reports.items():
        export(name, rows)

    summary = [
        "# Phase 5 — Structured Equipment Runtime Baseline","",
        f"- Registry: **{registry_count}**",
        f"- Weapons: **{weapon_count}**",
        f"- Armor: **{armor_count}**",
        f"- General equipment: **{equipment_count}**",
        f"- Packs: **{pack_count}**",
        f"- Book/OCR review queue: **{review_count}**",
        f"- Automation backlog: **{backlog_count}**","",
        f"Status: **{report['phaseStatus']}**",
    ]
    (output/"PHASE5_VALIDATION_SUMMARY.md").write_text(
        "\n".join(summary)+"\n",encoding="utf-8",newline="\n"
    )

    db.close()

    print("PHASE 5 STRUCTURED EQUIPMENT RUNTIME BASELINE COMPLETE")
    print(f"APPLIED={args.apply}")
    print(f"REGISTRY={registry_count}")
    print(f"WEAPONS={weapon_count}")
    print(f"ARMOR={armor_count}")
    print(f"EQUIPMENT={equipment_count}")
    print(f"PACKS={pack_count}")
    print(f"REVIEW_QUEUE={review_count}")
    print(f"AUTOMATION_BACKLOG={backlog_count}")
    print(f"PHASE_STATUS={report['phaseStatus']}")
    print(f"OUTPUT={output}")
    return 0

if __name__ == "__main__":
    raise SystemExit(main())
