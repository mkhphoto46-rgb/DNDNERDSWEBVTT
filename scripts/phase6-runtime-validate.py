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
OUTPUT_ROOT = PROJECT_ROOT / "_phase6_magic_items_poisons_runtime"

CONDITIONS = (
    "Blinded","Charmed","Deafened","Exhaustion","Frightened","Grappled",
    "Incapacitated","Invisible","Paralyzed","Petrified","Poisoned","Prone",
    "Restrained","Stunned","Unconscious",
)
DAMAGE_TYPES = (
    "Acid","Bludgeoning","Cold","Fire","Force","Lightning","Necrotic",
    "Piercing","Poison","Psychic","Radiant","Slashing","Thunder",
)

def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()

def clean(value: Any) -> str:
    return re.sub(r"\s+", " ", str(value or "")).strip()

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

def first(s: dict[str, Any], *keys: str) -> Any:
    for key in keys:
        if key in s and s[key] not in (None, "", [], {}):
            return s[key]
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
        "equipment_registry": db.execute("SELECT COUNT(*) FROM equipment_registry").fetchone()[0],
        "phase5_review_queue": db.execute("SELECT COUNT(*) FROM phase5_equipment_review_queue").fetchone()[0],
        "phase5_resolution_count": db.execute("SELECT COUNT(*) FROM phase5_review_resolution").fetchone()[0],
        "official_books": db.execute("SELECT COUNT(*) FROM sources WHERE source_kind LIKE 'official-%'").fetchone()[0],
    }

def detect_recharge(text: str) -> tuple[str | None, str | None]:
    low = text.casefold()
    kind = None
    if "daily at dawn" in low or "at dawn" in low:
        kind = "DAWN"
    elif "when you finish a long rest" in low or "after you finish a long rest" in low:
        kind = "LONG_REST"
    elif "when you finish a short rest" in low or "after you finish a short rest" in low:
        kind = "SHORT_REST"
    elif "each day" in low or "daily" in low:
        kind = "DAILY_OTHER"

    dice = None
    m = re.search(
        r"(?i)\bregains?\s+(\d+d(?:4|6|8|10|12|20)(?:\s*[+-]\s*\d+)?)\s+expended charges?\b",
        text,
    )
    if m:
        dice = m.group(1).replace(" ", "")
    else:
        m = re.search(r"(?i)\bregains?\s+(\d+)\s+expended charges?\b", text)
        if m:
            dice = m.group(1)

    return kind, dice

def detect_activation_types(text: str) -> list[str]:
    low = text.casefold()
    out = []
    if "magic action" in low:
        out.append("Magic Action")
    elif re.search(r"(?i)\btake an action\b|\buse an action\b", text):
        out.append("Action")
    if "bonus action" in low:
        out.append("Bonus Action")
    if "reaction" in low:
        out.append("Reaction")
    if re.search(r"(?i)\bwhen you (?:hit|fail|succeed|are hit|take damage|roll)\b", text):
        out.append("Trigger")
    return sorted(set(out))

def detect_passive_tags(text: str) -> list[str]:
    out = []
    low = text.casefold()
    if "resistance to" in low:
        out.append("Resistance")
    if "immunity to" in low or "immune to" in low:
        out.append("Immunity")
    if "armor class" in low or re.search(r"(?i)\bbonus to ac\b", text):
        out.append("AC Modifier")
    if re.search(r"(?i)\bbonus to attack rolls?\b", text):
        out.append("Attack Modifier")
    if re.search(r"(?i)\bbonus to damage rolls?\b", text):
        out.append("Damage Modifier")
    if "saving throw" in low:
        out.append("Saving Throw")
    if re.search(r"(?i)\bwalking speed\b|\bspeed increases?\b", text):
        out.append("Speed Modifier")
    if re.search(r"(?i)\bability score\b", text):
        out.append("Ability Score Modifier")
    if "darkvision" in low:
        out.append("Vision")
    if "temporary hit points" in low:
        out.append("Temporary HP")
    return sorted(set(out))

def detect_condition_tags(text: str) -> list[str]:
    out = []
    for condition in CONDITIONS:
        if re.search(rf"(?i)\b{re.escape(condition)}(?: condition)?\b", text):
            out.append(condition)
    return out

def detect_damage_types(text: str) -> list[str]:
    out = []
    for dtype in DAMAGE_TYPES:
        if re.search(rf"(?i)\b{re.escape(dtype)} damage\b", text):
            out.append(dtype)
    return out

def detect_granted_spells(text: str, spell_names: list[str]) -> list[str]:
    # Conservative: only exact spell names that appear near a cast/casting verb.
    found = []
    for spell in spell_names:
        if len(spell) < 4:
            continue
        escaped = re.escape(spell)
        patterns = (
            rf"(?i)\bcast(?:s|ing)?\s+(?:the\s+)?{escaped}\b",
            rf"(?i)\b{escaped}\s+spell\b",
        )
        if any(re.search(p, text) for p in patterns):
            found.append(spell)
    return sorted(set(found))

def magic_item_profile(row: sqlite3.Row, spell_names: list[str]) -> dict[str, Any]:
    s = parse_json(row["structured_json"])
    text = row["raw_text"] or ""

    attunement = first(s, "attunement","requiresAttunement","requires_attunement")
    if attunement is None:
        attunement = "requires attunement" in text.casefold()

    charges = first(s, "charges","maxCharges","max_charges")
    if charges is None:
        m = re.search(r"(?i)\bhas\s+(\d+)\s+charges?\b", text)
        if m:
            charges = int(m.group(1))
    try:
        charges_int = int(charges) if charges is not None else None
    except Exception:
        charges_int = None

    recharge_kind, recharge_formula = detect_recharge(text)

    save_dc = first(s, "saveDC","save_dc","dc")
    if save_dc is None:
        m = re.search(r"(?i)\b(?:save\s+)?dc\s+(\d{1,2})\b", text)
        if m:
            save_dc = int(m.group(1))
    try:
        save_dc_int = int(save_dc) if save_dc is not None else None
    except Exception:
        save_dc_int = None

    attack_bonus = first(s, "attackBonus","attack_bonus")
    try:
        attack_bonus_int = int(attack_bonus) if attack_bonus is not None else None
    except Exception:
        attack_bonus_int = None

    spells = first(s, "grantedSpells","granted_spells","spells")
    if not isinstance(spells, list):
        spells = detect_granted_spells(text, spell_names)
    else:
        spells = [clean(x) for x in spells if clean(x)]

    activation_types = detect_activation_types(text)
    passive_tags = detect_passive_tags(text)
    conditions = detect_condition_tags(text)
    damage_types = detect_damage_types(text)

    complexity_tags = []
    low = text.casefold()
    if "roll on the" in low or "random" in low:
        complexity_tags.append("Random Table")
    if "transform" in low or "polymorph" in low:
        complexity_tags.append("Transformation")
    if "summon" in low or "appears in an unoccupied space" in low:
        complexity_tags.append("Summoning")
    if "sentient" in low:
        complexity_tags.append("Sentient Item")
    if "curse" in low or "cursed" in low:
        complexity_tags.append("Curse")
    if "teleport" in low:
        complexity_tags.append("Teleportation")

    capabilities = []
    if attunement:
        capabilities.append("Attunement")
    if charges_int is not None:
        capabilities.append("Charges")
    if recharge_kind or recharge_formula:
        capabilities.append("Recharge")
    if spells:
        capabilities.append("Granted Spells")
    if save_dc_int is not None:
        capabilities.append("Save DC")
    if attack_bonus_int is not None:
        capabilities.append("Attack Bonus")
    if activation_types:
        capabilities.append("Activation")
    if passive_tags:
        capabilities.append("Passive Modifier")
    if conditions:
        capabilities.append("Condition")
    if damage_types:
        capabilities.append("Damage")

    gaps = []
    if charges_int is not None and recharge_kind is None and "regain" in low:
        gaps.append("recharge-parse-review")
    if "cast" in low and not spells:
        gaps.append("granted-spell-parse-review")
    for tag in complexity_tags:
        gaps.append(f"bespoke:{tag.casefold().replace(' ', '-')}")

    return {
        "item_type": clean(first(s, "itemType","item_type","type","category") or row["subcategory"]),
        "rarity": clean(first(s, "rarity","itemRarity","item_rarity")),
        "requires_attunement": bool(attunement),
        "max_charges": charges_int,
        "recharge_kind": recharge_kind,
        "recharge_formula": recharge_formula,
        "save_dc": save_dc_int,
        "attack_bonus": attack_bonus_int,
        "granted_spells": spells,
        "activation_types": activation_types,
        "passive_tags": passive_tags,
        "condition_tags": conditions,
        "damage_types": damage_types,
        "complexity_tags": complexity_tags,
        "capabilities": sorted(set(capabilities)),
        "automation_gaps": sorted(set(gaps)),
    }

def poison_profile(row: sqlite3.Row) -> dict[str, Any]:
    s = parse_json(row["structured_json"])
    text = row["raw_text"] or ""

    poison_type = clean(
        first(s, "poisonType","poison_type","type","category")
        or row["subcategory"]
    ).casefold()
    application_method = poison_type or None

    save_ability = first(s, "saveAbility","save_ability","savingThrow","saving_throw")
    if save_ability is None:
        m = re.search(
            r"(?i)\b(strength|dexterity|constitution|intelligence|wisdom|charisma)\s+saving throw\b",
            text,
        )
        if m:
            save_ability = m.group(1).title()

    save_dc = first(s, "saveDC","save_dc","dc")
    if save_dc is None:
        m = re.search(r"(?i)\bdc\s+(\d{1,2})\b", text)
        if m:
            save_dc = int(m.group(1))
    try:
        save_dc_int = int(save_dc) if save_dc is not None else None
    except Exception:
        save_dc_int = None

    damage_dice = first(s, "damage","damageDice","damage_dice")
    if damage_dice is None:
        m = re.search(r"(?i)\b(\d+d(?:4|6|8|10|12|20|100))\b", text)
        if m:
            damage_dice = m.group(1)

    damage_types = detect_damage_types(text)
    structured_damage_type = first(s, "damageType","damage_type")
    if structured_damage_type and clean(structured_damage_type) not in damage_types:
        damage_types.append(clean(structured_damage_type))

    conditions = detect_condition_tags(text)
    structured_condition = first(s, "condition","conditions")
    if isinstance(structured_condition, list):
        for value in structured_condition:
            if clean(value) and clean(value) not in conditions:
                conditions.append(clean(value))
    elif structured_condition and clean(structured_condition) not in conditions:
        conditions.append(clean(structured_condition))

    duration_text = clean(first(s, "duration","durationText","duration_text"))
    if not duration_text:
        m = re.search(
            r"(?i)\bfor\s+(\d+\s+(?:round|rounds|minute|minutes|hour|hours|day|days))\b",
            text,
        )
        if m:
            duration_text = m.group(1)

    onset_text = clean(first(s, "onset","onsetTime","onset_time"))
    if not onset_text:
        m = re.search(
            r"(?i)\b(?:after|at the end of)\s+([^.;]{1,60})",
            text,
        )
        if m and "saving throw" not in m.group(1).casefold():
            onset_text = clean(m.group(1))

    repeat_save = bool(
        re.search(r"(?i)\brepeats? the (?:saving throw|save)\b", text)
    )
    save_half = bool(re.search(r"(?i)\bhalf as much damage\b|\bhalf damage\b", text))
    save_no_effect = bool(
        re.search(r"(?i)\bon a successful save[^.]{0,80}\b(?:no effect|takes no damage)\b", text)
    )

    gaps = []
    if not application_method:
        gaps.append("application")
    if save_dc_int is None:
        gaps.append("save-dc")
    if not save_ability:
        gaps.append("save-ability")
    if not damage_dice and not conditions:
        gaps.append("damage-or-condition")

    return {
        "poison_type": poison_type,
        "application_method": application_method,
        "save_ability": clean(save_ability),
        "save_dc": save_dc_int,
        "damage_dice": clean(damage_dice),
        "damage_types": sorted(set(damage_types)),
        "conditions": sorted(set(conditions)),
        "duration_text": duration_text,
        "onset_text": onset_text,
        "repeat_save": repeat_save,
        "save_half": save_half,
        "save_no_effect": save_no_effect,
        "automation_gaps": gaps,
    }

def ensure_schema(db: sqlite3.Connection) -> None:
    db.executescript("""
    CREATE TABLE IF NOT EXISTS phase6_validation_batches(
      id TEXT PRIMARY KEY,
      created_at TEXT NOT NULL,
      source_db_sha256 TEXT NOT NULL,
      magic_item_count INTEGER NOT NULL,
      poison_count INTEGER NOT NULL,
      review_count INTEGER NOT NULL,
      automation_backlog_count INTEGER NOT NULL
    ) STRICT;

    CREATE TABLE IF NOT EXISTS magic_item_registry(
      magic_item_id TEXT PRIMARY KEY,
      item_name TEXT NOT NULL,
      entity_version_id TEXT NOT NULL REFERENCES entity_versions(id),
      rules_version TEXT NOT NULL,
      source_id TEXT NOT NULL REFERENCES sources(id),
      source_title TEXT NOT NULL,
      validation_scope TEXT NOT NULL,
      batch_id TEXT NOT NULL REFERENCES phase6_validation_batches(id),
      validated_at TEXT NOT NULL
    ) STRICT;

    CREATE TABLE IF NOT EXISTS magic_item_engine_profiles(
      magic_item_id TEXT PRIMARY KEY REFERENCES magic_item_registry(magic_item_id),
      item_type TEXT NOT NULL,
      rarity TEXT NOT NULL,
      requires_attunement INTEGER NOT NULL,
      max_charges INTEGER,
      recharge_kind TEXT,
      recharge_formula TEXT,
      save_dc INTEGER,
      attack_bonus INTEGER,
      granted_spells_json TEXT NOT NULL,
      activation_types_json TEXT NOT NULL,
      passive_tags_json TEXT NOT NULL,
      condition_tags_json TEXT NOT NULL,
      damage_types_json TEXT NOT NULL,
      complexity_tags_json TEXT NOT NULL,
      capabilities_json TEXT NOT NULL,
      automation_gaps_json TEXT NOT NULL
    ) STRICT;

    CREATE TABLE IF NOT EXISTS poison_registry(
      poison_id TEXT PRIMARY KEY,
      poison_name TEXT NOT NULL,
      entity_version_id TEXT NOT NULL REFERENCES entity_versions(id),
      rules_version TEXT NOT NULL,
      source_id TEXT NOT NULL REFERENCES sources(id),
      source_title TEXT NOT NULL,
      validation_scope TEXT NOT NULL,
      batch_id TEXT NOT NULL REFERENCES phase6_validation_batches(id),
      validated_at TEXT NOT NULL
    ) STRICT;

    CREATE TABLE IF NOT EXISTS poison_engine_profiles(
      poison_id TEXT PRIMARY KEY REFERENCES poison_registry(poison_id),
      poison_type TEXT NOT NULL,
      application_method TEXT NOT NULL,
      save_ability TEXT NOT NULL,
      save_dc INTEGER NOT NULL,
      damage_dice TEXT NOT NULL,
      damage_types_json TEXT NOT NULL,
      conditions_json TEXT NOT NULL,
      duration_text TEXT NOT NULL,
      onset_text TEXT NOT NULL,
      repeat_save INTEGER NOT NULL,
      save_half INTEGER NOT NULL,
      save_no_effect INTEGER NOT NULL,
      automation_gaps_json TEXT NOT NULL
    ) STRICT;

    CREATE TABLE IF NOT EXISTS phase6_content_review_queue(
      entity_version_id TEXT PRIMARY KEY REFERENCES entity_versions(id),
      name TEXT NOT NULL,
      category TEXT NOT NULL,
      rules_version TEXT NOT NULL,
      source_title TEXT NOT NULL,
      source_page INTEGER,
      confidence REAL NOT NULL,
      origin TEXT NOT NULL,
      resolution_hint TEXT NOT NULL,
      batch_id TEXT NOT NULL REFERENCES phase6_validation_batches(id)
    ) STRICT;

    CREATE TABLE IF NOT EXISTS phase6_automation_backlog(
      content_id TEXT NOT NULL,
      content_kind TEXT NOT NULL,
      capability_or_gap TEXT NOT NULL,
      status TEXT NOT NULL,
      notes TEXT NOT NULL,
      batch_id TEXT NOT NULL REFERENCES phase6_validation_batches(id),
      PRIMARY KEY(content_id,content_kind,capability_or_gap)
    ) STRICT;

    DROP VIEW IF EXISTS effective_magic_items;
    CREATE VIEW effective_magic_items AS
      SELECT r.*, p.*
      FROM magic_item_registry r
      JOIN magic_item_engine_profiles p USING(magic_item_id);

    DROP VIEW IF EXISTS effective_poisons;
    CREATE VIEW effective_poisons AS
      SELECT r.*, p.*
      FROM poison_registry r
      JOIN poison_engine_profiles p USING(poison_id);
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
    if deps["core_rule_registry"] != 75:
        raise RuntimeError("Phase 1 dependency mismatch.")
    if (deps["class_registry"], deps["subclass_registry"], deps["class_feature_registry"]) != (12,48,442):
        raise RuntimeError("Phase 2 dependency mismatch.")
    if (deps["species_registry"], deps["background_registry"], deps["feat_registry"]) != (10,16,75):
        raise RuntimeError("Phase 3 dependency mismatch.")
    if deps["spell_registry"] != 339 or deps["book_spell_registry"] < 475:
        raise RuntimeError("Phase 4 dependency mismatch.")
    if deps["equipment_registry"] != 182 or deps["phase5_review_queue"] != 0 or deps["phase5_resolution_count"] != 135:
        raise RuntimeError("Phase 5 dependency mismatch.")
    if deps["official_books"] != 13:
        raise RuntimeError("Official book count mismatch.")

    srd_rows = db.execute("""
        SELECT ev.*, s.title AS source_title
        FROM current_entity_versions ev
        JOIN sources s ON s.id=ev.source_id
        WHERE ev.category IN ('magic-item','poison')
          AND ev.rules_version='2024'
          AND ev.status='validated'
          AND s.title='SRD 5.2.1'
        ORDER BY ev.category,ev.name
    """).fetchall()

    counts = Counter(row["category"] for row in srd_rows)
    if dict(counts) != {"magic-item":262, "poison":14}:
        raise RuntimeError(f"SRD Phase 6 distribution mismatch: {dict(counts)}")

    spell_names = [
        row["spell_name"]
        for row in db.execute("SELECT spell_name FROM spell_registry ORDER BY length(spell_name) DESC")
    ]

    magic_items = [
        (row, magic_item_profile(row, spell_names))
        for row in srd_rows if row["category"] == "magic-item"
    ]
    poisons = [
        (row, poison_profile(row))
        for row in srd_rows if row["category"] == "poison"
    ]

    # No SRD poison may remain without basic executable save/application data.
    bad_poisons = [
        (row["name"], profile["automation_gaps"])
        for row, profile in poisons
        if profile["automation_gaps"]
    ]
    if bad_poisons:
        raise RuntimeError(f"Poison profile recovery incomplete: {bad_poisons}")

    extracted_rows = db.execute("""
        SELECT ev.*, s.title AS source_title
        FROM current_entity_versions ev
        JOIN sources s ON s.id=ev.source_id
        WHERE ev.category IN ('magic-item','poison')
          AND ev.status='extracted'
          AND s.source_kind LIKE 'official-%'
        ORDER BY s.source_priority DESC,s.title,ev.name
    """).fetchall()

    review_map: dict[str, dict[str, Any]] = {}
    for row in extracted_rows:
        review_map[row["id"]] = {
            "entity_version_id": row["id"],
            "name": clean(row["name"]),
            "category": row["category"],
            "rules_version": row["rules_version"],
            "source_title": row["source_title"],
            "source_page": row["source_page_start"],
            "confidence": float(row["confidence"]),
            "origin": "phase6-native-category",
            "resolution_hint": "source-review-before-promotion",
        }

    # Carry Phase 5 candidates routed toward Phase 6/later review.
    phase5_routes = db.execute("""
        SELECT r.*, ev.confidence
        FROM phase5_review_resolution r
        JOIN entity_versions ev ON ev.id=r.entity_version_id
        WHERE r.authoritative_destination IN (
          'phase6_magic_item_registry',
          'phase6_poison_registry',
          'phase6_or_later_review'
        )
    """).fetchall()

    for row in phase5_routes:
        if row["entity_version_id"] in review_map:
            continue
        review_map[row["entity_version_id"]] = {
            "entity_version_id": row["entity_version_id"],
            "name": clean(row["original_name"]),
            "category": row["original_category"],
            "rules_version": row["rules_version"],
            "source_title": row["source_title"],
            "source_page": row["source_page"],
            "confidence": float(row["confidence"]),
            "origin": "phase5-route",
            "resolution_hint": row["authoritative_destination"],
        }

    review = list(review_map.values())

    backlog: list[dict[str, str]] = []
    for row, p in magic_items:
        content_id = f"magic-item.{slug(row['name'])}"
        for capability in p["capabilities"]:
            backlog.append({
                "content_id": content_id,
                "content_kind": "magic-item",
                "capability_or_gap": f"capability:{capability}",
                "status": "AUTOMATION_TODO",
                "notes": "Structured capability detected; runtime handler must be implemented/tested in the automation pass.",
            })
        for gap in p["automation_gaps"]:
            backlog.append({
                "content_id": content_id,
                "content_kind": "magic-item",
                "capability_or_gap": f"gap:{gap}",
                "status": "STRUCTURED_REVIEW_TODO",
                "notes": "Structured profile preserves the item, but this mechanic requires targeted handler/review.",
            })

    for row, p in poisons:
        content_id = f"poison.{slug(row['name'])}"
        for capability in ("Application","Saving Throw","Damage/Condition"):
            backlog.append({
                "content_id": content_id,
                "content_kind": "poison",
                "capability_or_gap": f"capability:{capability}",
                "status": "AUTOMATION_TODO",
                "notes": "Poison mechanic is structured and ready for later server-authoritative runtime handler implementation.",
            })

    # Deduplicate backlog rows.
    unique_backlog = {}
    for item in backlog:
        key = (item["content_id"], item["content_kind"], item["capability_or_gap"])
        unique_backlog[key] = item
    backlog = list(unique_backlog.values())

    batch_id = f"phase6-runtime-{datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ')}"

    if args.apply:
        ensure_schema(db)
        db.execute("BEGIN IMMEDIATE")
        try:
            db.execute("DELETE FROM phase6_automation_backlog")
            db.execute("DELETE FROM phase6_content_review_queue")
            db.execute("DELETE FROM magic_item_engine_profiles")
            db.execute("DELETE FROM poison_engine_profiles")
            db.execute("DELETE FROM magic_item_registry")
            db.execute("DELETE FROM poison_registry")

            db.execute("""
                INSERT INTO phase6_validation_batches(
                  id,created_at,source_db_sha256,magic_item_count,poison_count,
                  review_count,automation_backlog_count
                ) VALUES(?,?,?,?,?,?,?)
            """, (
                batch_id,now_iso(),db_hash_before,262,14,len(review),len(backlog)
            ))

            for row, p in magic_items:
                item_id = f"magic-item.{slug(row['name'])}"
                db.execute("""
                    INSERT INTO magic_item_registry(
                      magic_item_id,item_name,entity_version_id,rules_version,
                      source_id,source_title,validation_scope,batch_id,validated_at
                    ) VALUES(?,?,?,?,?,?,?,?,?)
                """, (
                    item_id,row["name"],row["id"],"2024",row["source_id"],
                    row["source_title"],"validated-srd-structured-runtime-baseline",
                    batch_id,now_iso(),
                ))
                db.execute("""
                    INSERT INTO magic_item_engine_profiles(
                      magic_item_id,item_type,rarity,requires_attunement,max_charges,
                      recharge_kind,recharge_formula,save_dc,attack_bonus,
                      granted_spells_json,activation_types_json,passive_tags_json,
                      condition_tags_json,damage_types_json,complexity_tags_json,
                      capabilities_json,automation_gaps_json
                    ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
                """, (
                    item_id,p["item_type"],p["rarity"],int(p["requires_attunement"]),
                    p["max_charges"],p["recharge_kind"],p["recharge_formula"],
                    p["save_dc"],p["attack_bonus"],
                    json.dumps(p["granted_spells"],ensure_ascii=False),
                    json.dumps(p["activation_types"],ensure_ascii=False),
                    json.dumps(p["passive_tags"],ensure_ascii=False),
                    json.dumps(p["condition_tags"],ensure_ascii=False),
                    json.dumps(p["damage_types"],ensure_ascii=False),
                    json.dumps(p["complexity_tags"],ensure_ascii=False),
                    json.dumps(p["capabilities"],ensure_ascii=False),
                    json.dumps(p["automation_gaps"],ensure_ascii=False),
                ))

            for row, p in poisons:
                poison_id = f"poison.{slug(row['name'])}"
                db.execute("""
                    INSERT INTO poison_registry(
                      poison_id,poison_name,entity_version_id,rules_version,
                      source_id,source_title,validation_scope,batch_id,validated_at
                    ) VALUES(?,?,?,?,?,?,?,?,?)
                """, (
                    poison_id,row["name"],row["id"],"2024",row["source_id"],
                    row["source_title"],"validated-srd-structured-runtime-baseline",
                    batch_id,now_iso(),
                ))
                db.execute("""
                    INSERT INTO poison_engine_profiles(
                      poison_id,poison_type,application_method,save_ability,save_dc,
                      damage_dice,damage_types_json,conditions_json,duration_text,
                      onset_text,repeat_save,save_half,save_no_effect,automation_gaps_json
                    ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)
                """, (
                    poison_id,p["poison_type"],p["application_method"],
                    p["save_ability"],p["save_dc"],p["damage_dice"],
                    json.dumps(p["damage_types"],ensure_ascii=False),
                    json.dumps(p["conditions"],ensure_ascii=False),
                    p["duration_text"],p["onset_text"],int(p["repeat_save"]),
                    int(p["save_half"]),int(p["save_no_effect"]),
                    json.dumps(p["automation_gaps"],ensure_ascii=False),
                ))

            for item in review:
                db.execute("""
                    INSERT INTO phase6_content_review_queue(
                      entity_version_id,name,category,rules_version,source_title,
                      source_page,confidence,origin,resolution_hint,batch_id
                    ) VALUES(?,?,?,?,?,?,?,?,?,?)
                """, (
                    item["entity_version_id"],item["name"],item["category"],
                    item["rules_version"],item["source_title"],item["source_page"],
                    item["confidence"],item["origin"],item["resolution_hint"],batch_id,
                ))

            for item in backlog:
                db.execute("""
                    INSERT INTO phase6_automation_backlog(
                      content_id,content_kind,capability_or_gap,status,notes,batch_id
                    ) VALUES(?,?,?,?,?,?)
                """, (
                    item["content_id"],item["content_kind"],item["capability_or_gap"],
                    item["status"],item["notes"],batch_id,
                ))

            db.commit()
        except Exception:
            db.rollback()
            raise

    magic_count = db.execute("SELECT COUNT(*) FROM magic_item_registry").fetchone()[0]
    magic_profiles = db.execute("SELECT COUNT(*) FROM magic_item_engine_profiles").fetchone()[0]
    poison_count = db.execute("SELECT COUNT(*) FROM poison_registry").fetchone()[0]
    poison_profiles = db.execute("SELECT COUNT(*) FROM poison_engine_profiles").fetchone()[0]
    review_count = db.execute("SELECT COUNT(*) FROM phase6_content_review_queue").fetchone()[0]
    backlog_count = db.execute("SELECT COUNT(*) FROM phase6_automation_backlog").fetchone()[0]
    poison_gap_count = db.execute("""
        SELECT COUNT(*) FROM poison_engine_profiles
        WHERE automation_gaps_json <> '[]'
    """).fetchone()[0]

    datasets = {
        "magic_item_registry": [dict(r) for r in db.execute(
            "SELECT * FROM magic_item_registry ORDER BY item_name"
        )],
        "magic_item_engine_profiles": [dict(r) for r in db.execute(
            "SELECT * FROM magic_item_engine_profiles ORDER BY magic_item_id"
        )],
        "poison_registry": [dict(r) for r in db.execute(
            "SELECT * FROM poison_registry ORDER BY poison_name"
        )],
        "poison_engine_profiles": [dict(r) for r in db.execute(
            "SELECT * FROM poison_engine_profiles ORDER BY poison_id"
        )],
        "content_review_queue": [dict(r) for r in db.execute(
            "SELECT * FROM phase6_content_review_queue ORDER BY origin,source_title,name"
        )],
        "automation_backlog": [dict(r) for r in db.execute(
            "SELECT * FROM phase6_automation_backlog ORDER BY content_kind,content_id,capability_or_gap"
        )],
    }

    report = {
        "batchId":batch_id,
        "applied":args.apply,
        "dependencies":deps,
        "magicItemRegistryCount":magic_count,
        "magicItemEngineProfileCount":magic_profiles,
        "poisonRegistryCount":poison_count,
        "poisonEngineProfileCount":poison_profiles,
        "reviewQueueCount":review_count,
        "automationBacklogCount":backlog_count,
        "poisonProfilesWithStructuredGaps":poison_gap_count,
        "phaseStatus": (
            "STRUCTURED_BASELINE_COMPLETE_BOOK_REVIEW_PENDING"
            if review_count else "READY_TO_CLOSE"
        ),
        "lockedArchitecture": {
            "autoUseItems":False,
            "playerOrDmInitiatesUse":True,
            "serverAuthoritative":True,
            "attunementRuntimeTarget":True,
            "chargeRuntimeTarget":True,
            "rechargeRuntimeTarget":True,
            "grantedSpellRuntimeTarget":True,
            "poisonApplicationRuntimeTarget":True,
            "poisonSaveDamageConditionRuntimeTarget":True,
        },
    }

    (output/"phase6_validation_report.json").write_text(
        json.dumps(report,ensure_ascii=False,indent=2)+"\n",encoding="utf-8"
    )

    def export(name: str, rows: list[dict[str, Any]]) -> None:
        (output/f"{name}.json").write_text(
            json.dumps(rows,ensure_ascii=False,indent=2)+"\n",encoding="utf-8"
        )
        fields = list(rows[0].keys()) if rows else ["empty"]
        with (output/f"{name}.csv").open("w",encoding="utf-8-sig",newline="") as f:
            w=csv.DictWriter(f,fieldnames=fields)
            w.writeheader()
            if rows:
                w.writerows(rows)

    for name, rows in datasets.items():
        export(name, rows)

    summary = [
        "# Phase 6 — Structured Magic Item / Poison Runtime Baseline","",
        f"- Magic item registry: **{magic_count}**",
        f"- Magic item engine profiles: **{magic_profiles}**",
        f"- Poison registry: **{poison_count}**",
        f"- Poison engine profiles: **{poison_profiles}**",
        f"- Poison structured gaps: **{poison_gap_count}**",
        f"- Book/OCR review queue: **{review_count}**",
        f"- Explicit automation backlog entries: **{backlog_count}**","",
        f"Status: **{report['phaseStatus']}**",
    ]
    (output/"PHASE6_VALIDATION_SUMMARY.md").write_text(
        "\n".join(summary)+"\n",encoding="utf-8",newline="\n"
    )

    db.close()

    print("PHASE 6 STRUCTURED MAGIC ITEM / POISON RUNTIME BASELINE COMPLETE")
    print(f"APPLIED={args.apply}")
    print(f"MAGIC_ITEMS={magic_count}")
    print(f"MAGIC_ITEM_PROFILES={magic_profiles}")
    print(f"POISONS={poison_count}")
    print(f"POISON_PROFILES={poison_profiles}")
    print(f"POISON_STRUCTURED_GAPS={poison_gap_count}")
    print(f"REVIEW_QUEUE={review_count}")
    print(f"AUTOMATION_BACKLOG={backlog_count}")
    print(f"PHASE_STATUS={report['phaseStatus']}")
    print(f"OUTPUT={output}")
    return 0

if __name__ == "__main__":
    raise SystemExit(main())
