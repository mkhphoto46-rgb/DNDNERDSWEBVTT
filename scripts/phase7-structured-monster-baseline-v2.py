from __future__ import annotations

import argparse
import hashlib
import json
import re
import sqlite3
from datetime import datetime, timezone
from pathlib import Path

PROJECT_ROOT = Path(r"F:\DND WEB VTT")
DEFAULT_DB = PROJECT_ROOT / "data" / "compendium" / "monsters.sqlite"
DEFAULT_OUTPUT = PROJECT_ROOT / "_phase7_structured_monster_baseline_v2"

EXPECTED_SOURCE_SHA256 = "52a371445ce0812ca930aea418e7d7e9d6459f1778a6e14cb56592f08f5a08af"
EXPECTED_SOURCE_COUNT = 322

REQUIRED_SOURCE_COLUMNS = {
    "id", "name", "name_lower", "size", "type", "cr", "cr_numeric",
    "armor_class", "hp_max", "hp_formula", "initiative_modifier",
    "source", "attribution", "search_text", "stat_block_json"
}

BASELINE_GAPS = (
    "alignment",
    "saving_throws",
    "xp",
    "proficiency_bonus",
    "bonus_actions",
    "reactions",
    "legendary_actions",
    "lair_actions",
    "spellcasting",
    "recharge_abilities",
    "multiattack",
    "attack_profiles",
    "save_based_abilities",
    "aoe_definitions",
    "usage_limits_resources",
    "rules_version",
)

def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()

def sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()

def canonical_json(value) -> str:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))

def json_hash(value) -> str:
    return hashlib.sha256(canonical_json(value).encode("utf-8")).hexdigest()

def table_digest(db: sqlite3.Connection, table: str, order_by: str) -> str:
    cols = [r[1] for r in db.execute(f'PRAGMA table_info("{table}")')]
    rows = db.execute(f'SELECT * FROM "{table}" ORDER BY {order_by}').fetchall()
    payload = {"columns": cols, "rows": [list(r) for r in rows]}
    return json_hash(payload)

def ci_get(obj: dict, *keys):
    if not isinstance(obj, dict):
        return None
    index = {str(k).lower(): k for k in obj}
    for key in keys:
        hit = index.get(key.lower())
        if hit is not None:
            return obj[hit]
    return None

def as_json_or_null(value):
    if value is None:
        return None
    return canonical_json(value)

def scalar_or_none(value):
    if value is None:
        return None
    if isinstance(value, (str, int, float, bool)):
        return value
    return None

def number_or_none(value):
    if isinstance(value, bool):
        return None
    if isinstance(value, (int, float)):
        return value
    if isinstance(value, str):
        text = value.strip()
        if re.fullmatch(r"-?\d+(?:\.\d+)?", text):
            return float(text) if "." in text else int(text)
    return None

def dice_formula_or_none(value):
    if not isinstance(value, str):
        return None
    text = value.strip()
    if re.fullmatch(r"\d+d\d+(?:\s*[+-]\s*\d+)?", text, flags=re.I):
        return re.sub(r"\s+", "", text)
    return None

def explicit_year(*values):
    years = []
    for value in values:
        if not isinstance(value, str):
            continue
        years.extend(re.findall(r"\b(20(?:14|24))\b", value))
    years = sorted(set(years))
    return years[0] if len(years) == 1 else None

def normalize_actions(actions):
    """Return exact action objects without interpreting narrative prose."""
    normalized = []
    if isinstance(actions, list):
        for idx, action in enumerate(actions):
            if isinstance(action, dict):
                name = ci_get(action, "name", "title")
                normalized.append((idx, str(name).strip() if name is not None else f"Action {idx+1}", action))
            elif isinstance(action, str):
                normalized.append((idx, f"Action {idx+1}", {"description": action}))
    elif isinstance(actions, dict):
        for idx, (name, payload) in enumerate(actions.items()):
            if isinstance(payload, dict):
                data = dict(payload)
                if ci_get(data, "name", "title") is None:
                    data["name"] = name
                normalized.append((idx, str(name), data))
            else:
                normalized.append((idx, str(name), {"description": payload}))
    return normalized

def explicit_action_profile(action: dict):
    attack_bonus = number_or_none(ci_get(action, "attack_bonus", "attackbonus"))
    save_dc = number_or_none(ci_get(action, "save_dc", "savedc"))
    damage = ci_get(action, "damage")
    save = ci_get(action, "save", "saving_throw", "savingthrow")
    area = ci_get(action, "area", "aoe", "area_of_effect", "areaofeffect")
    recharge = ci_get(action, "recharge")
    uses = ci_get(action, "uses", "usage", "per_day", "perday")
    profile_status = "NARRATIVE_ONLY"
    if any(v is not None for v in (attack_bonus, save_dc, damage, save, area, recharge, uses)):
        profile_status = "EXPLICIT_STRUCTURED_FIELDS"
    return {
        "attack_bonus": attack_bonus,
        "save_dc": save_dc,
        "damage": damage,
        "save": save,
        "area": area,
        "recharge": recharge,
        "uses": uses,
        "profile_status": profile_status,
    }

def create_schema(db: sqlite3.Connection):
    db.executescript("""
    CREATE TABLE phase7_monster_registry (
        monster_id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        name_lower TEXT NOT NULL,
        size TEXT,
        creature_type TEXT,
        cr_text TEXT,
        cr_numeric REAL,
        armor_class INTEGER,
        hp_max INTEGER,
        hp_formula TEXT,
        initiative_modifier INTEGER,
        source TEXT,
        attribution TEXT,
        source_stat_block_sha256 TEXT NOT NULL,
        baseline_status TEXT NOT NULL,
        batch_id TEXT NOT NULL,
        FOREIGN KEY (monster_id) REFERENCES monsters(id)
    );

    CREATE TABLE phase7_monster_engine_profiles (
        monster_id TEXT PRIMARY KEY,
        alignment TEXT,
        hit_dice TEXT,
        speed_json TEXT,
        ability_scores_json TEXT,
        saving_throws_json TEXT,
        skills_json TEXT,
        damage_vulnerabilities_json TEXT,
        damage_resistances_json TEXT,
        damage_immunities_json TEXT,
        condition_immunities_json TEXT,
        senses_json TEXT,
        passive_perception INTEGER,
        languages_json TEXT,
        xp INTEGER,
        proficiency_bonus INTEGER,
        traits_json TEXT,
        bonus_actions_json TEXT,
        reactions_json TEXT,
        legendary_actions_json TEXT,
        lair_actions_json TEXT,
        spellcasting_json TEXT,
        recharge_abilities_json TEXT,
        multiattack_json TEXT,
        attack_profiles_json TEXT,
        save_based_abilities_json TEXT,
        aoe_definitions_json TEXT,
        usage_limits_resources_json TEXT,
        rules_version TEXT,
        source_evidence_json TEXT NOT NULL,
        automation_status TEXT NOT NULL,
        automation_gaps_json TEXT NOT NULL,
        batch_id TEXT NOT NULL,
        FOREIGN KEY (monster_id) REFERENCES phase7_monster_registry(monster_id)
    );

    CREATE TABLE phase7_monster_action_profiles (
        monster_id TEXT NOT NULL,
        action_index INTEGER NOT NULL,
        action_name TEXT NOT NULL,
        description TEXT,
        attack_bonus REAL,
        save_dc INTEGER,
        damage_json TEXT,
        save_json TEXT,
        area_json TEXT,
        recharge_json TEXT,
        usage_json TEXT,
        profile_status TEXT NOT NULL,
        raw_action_json TEXT NOT NULL,
        batch_id TEXT NOT NULL,
        PRIMARY KEY (monster_id, action_index),
        FOREIGN KEY (monster_id) REFERENCES phase7_monster_registry(monster_id)
    );

    CREATE TABLE phase7_monster_automation_backlog (
        monster_id TEXT NOT NULL,
        gap_type TEXT NOT NULL,
        status TEXT NOT NULL,
        evidence_note TEXT NOT NULL,
        batch_id TEXT NOT NULL,
        PRIMARY KEY (monster_id, gap_type),
        FOREIGN KEY (monster_id) REFERENCES phase7_monster_registry(monster_id)
    );

    CREATE TABLE phase7_baseline_batches (
        id TEXT PRIMARY KEY,
        created_at TEXT NOT NULL,
        source_db_sha256 TEXT NOT NULL,
        source_monster_count INTEGER NOT NULL,
        source_monsters_digest_before TEXT NOT NULL,
        source_monsters_digest_after TEXT NOT NULL,
        source_metadata_digest_before TEXT NOT NULL,
        source_metadata_digest_after TEXT NOT NULL,
        registry_count INTEGER NOT NULL,
        engine_profile_count INTEGER NOT NULL,
        action_profile_count INTEGER NOT NULL,
        automation_backlog_count INTEGER NOT NULL,
        narrative_action_count INTEGER NOT NULL,
        explicit_action_profile_count INTEGER NOT NULL,
        phase_status TEXT NOT NULL
    );
    """)

def require_clean_preconditions(db: sqlite3.Connection, db_path: Path):
    tables = {r[0] for r in db.execute("SELECT name FROM sqlite_master WHERE type='table'")}
    if "monsters" not in tables or "metadata" not in tables:
        raise RuntimeError("Expected monsters/metadata source tables are missing.")

    phase7_tables = sorted(t for t in tables if t.startswith("phase7_"))
    if phase7_tables:
        raise RuntimeError(
            "Safety stop: Phase 7 structured tables already exist: " + ", ".join(phase7_tables)
        )

    columns = {r[1] for r in db.execute('PRAGMA table_info("monsters")')}
    missing = sorted(REQUIRED_SOURCE_COLUMNS - columns)
    if missing:
        raise RuntimeError(f"Source monsters schema drift: missing columns {missing}")

    count = db.execute("SELECT COUNT(*) FROM monsters").fetchone()[0]
    if count != EXPECTED_SOURCE_COUNT:
        raise RuntimeError(
            f"Source monster count drift: expected {EXPECTED_SOURCE_COUNT}, got {count}"
        )

    current_sha = sha256_file(db_path)
    if current_sha != EXPECTED_SOURCE_SHA256:
        raise RuntimeError(
            "Source monsters.sqlite changed since Audit V1. "
            f"Expected SHA256={EXPECTED_SOURCE_SHA256}, got={current_sha}. "
            "Run a fresh read-only Phase 7 audit before migration."
        )

    integrity = db.execute("PRAGMA integrity_check").fetchone()[0]
    if integrity != "ok":
        raise RuntimeError(f"SQLite integrity_check failed: {integrity}")

    fk = db.execute("PRAGMA foreign_key_check").fetchall()
    if fk:
        raise RuntimeError(f"Foreign-key errors before migration: {len(fk)}")

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--db", default=str(DEFAULT_DB))
    ap.add_argument("--output", default=str(DEFAULT_OUTPUT))
    ap.add_argument("--apply", action="store_true")
    args = ap.parse_args()

    db_path = Path(args.db)
    output = Path(args.output)

    if not db_path.exists():
        raise RuntimeError(f"monsters.sqlite not found: {db_path}")

    db = sqlite3.connect(db_path)
    db.row_factory = sqlite3.Row
    db.execute("PRAGMA foreign_keys=ON")

    try:
        require_clean_preconditions(db, db_path)

        if not args.apply:
            print("PHASE 7 STRUCTURED MONSTER BASELINE V2 PRECHECK PASS")
            print("READ_ONLY=YES")
            return 0

        output.mkdir(parents=True, exist_ok=True)
        batch_id = "phase7-monster-baseline-v2-" + datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")

        source_sha = sha256_file(db_path)
        monsters_digest_before = table_digest(db, "monsters", "id")
        metadata_digest_before = table_digest(db, "metadata", "key")

        db.execute("BEGIN IMMEDIATE")
        try:
            create_schema(db)

            rows = db.execute("SELECT * FROM monsters ORDER BY id").fetchall()
            action_count = 0
            narrative_action_count = 0
            explicit_action_count = 0
            backlog_count = 0

            for row in rows:
                raw_json = row["stat_block_json"] or "{}"
                try:
                    stat = json.loads(raw_json)
                    if not isinstance(stat, dict):
                        raise ValueError("stat_block_json root is not object")
                except Exception:
                    stat = {}
                    malformed = True
                else:
                    malformed = False

                monster_id = str(row["id"])
                stat_hash = hashlib.sha256(raw_json.encode("utf-8", errors="replace")).hexdigest()

                db.execute("""
                    INSERT INTO phase7_monster_registry (
                        monster_id,name,name_lower,size,creature_type,cr_text,cr_numeric,
                        armor_class,hp_max,hp_formula,initiative_modifier,source,attribution,
                        source_stat_block_sha256,baseline_status,batch_id
                    ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
                """, (
                    monster_id, row["name"], row["name_lower"], row["size"], row["type"],
                    row["cr"], row["cr_numeric"], row["armor_class"], row["hp_max"],
                    row["hp_formula"], row["initiative_modifier"], row["source"],
                    row["attribution"], stat_hash,
                    "SOURCE_JSON_MALFORMED" if malformed else "BASELINE_IMPORTED_EXPLICIT_ONLY",
                    batch_id
                ))

                speed = ci_get(stat, "speed")
                abilities = ci_get(stat, "ability_scores", "abilities")
                if abilities is None:
                    ability_map = {}
                    for key in ("str", "dex", "con", "int", "wis", "cha"):
                        v = ci_get(stat, key)
                        if v is not None:
                            ability_map[key] = v
                    abilities = ability_map or None

                saving_throws = ci_get(stat, "saving_throws", "saves")
                skills = ci_get(stat, "skills")
                vulnerabilities = ci_get(stat, "damage_vulnerabilities", "vulnerabilities")
                resistances = ci_get(stat, "damage_resistances", "resistances")
                immunities = ci_get(stat, "damage_immunities", "immunities")
                condition_immunities = ci_get(stat, "condition_immunities")
                senses = ci_get(stat, "senses")
                passive = number_or_none(ci_get(stat, "passive_perception"))
                languages = ci_get(stat, "languages")
                traits = ci_get(stat, "traits", "special_abilities")
                alignment = scalar_or_none(ci_get(stat, "alignment"))
                xp = number_or_none(ci_get(stat, "xp", "experience"))
                pb = number_or_none(ci_get(stat, "proficiency_bonus", "pb"))
                bonus_actions = ci_get(stat, "bonus_actions")
                reactions = ci_get(stat, "reactions")
                legendary_actions = ci_get(stat, "legendary_actions")
                lair_actions = ci_get(stat, "lair_actions")
                spellcasting = ci_get(stat, "spellcasting", "spells")
                recharge_abilities = ci_get(stat, "recharge_abilities", "recharge")
                multiattack = ci_get(stat, "multiattack")
                top_attack_profiles = ci_get(stat, "attack_profiles", "attacks")
                save_based = ci_get(stat, "save_based_abilities")
                aoe = ci_get(stat, "aoe_definitions", "aoe", "area_of_effect")
                resources = ci_get(stat, "usage_limits_resources", "resources", "uses")
                rules_version = scalar_or_none(ci_get(stat, "rules_version", "version", "edition"))
                if rules_version is None:
                    rules_version = explicit_year(row["source"], row["attribution"])

                hit_dice = dice_formula_or_none(row["hp_formula"])

                actions = ci_get(stat, "actions")
                normalized_actions = normalize_actions(actions)
                structured_action_profiles = []
                explicit_save_profiles = []
                explicit_aoe_profiles = []
                explicit_resource_profiles = []
                recharge_profiles = []

                for idx, action_name, action in normalized_actions:
                    profile = explicit_action_profile(action)
                    desc = ci_get(action, "description", "desc")
                    desc_text = str(desc) if isinstance(desc, (str, int, float)) else None

                    db.execute("""
                        INSERT INTO phase7_monster_action_profiles (
                            monster_id,action_index,action_name,description,attack_bonus,save_dc,
                            damage_json,save_json,area_json,recharge_json,usage_json,
                            profile_status,raw_action_json,batch_id
                        ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)
                    """, (
                        monster_id, idx, action_name, desc_text,
                        profile["attack_bonus"], profile["save_dc"],
                        as_json_or_null(profile["damage"]),
                        as_json_or_null(profile["save"]),
                        as_json_or_null(profile["area"]),
                        as_json_or_null(profile["recharge"]),
                        as_json_or_null(profile["uses"]),
                        profile["profile_status"], canonical_json(action), batch_id
                    ))
                    action_count += 1
                    if profile["profile_status"] == "EXPLICIT_STRUCTURED_FIELDS":
                        explicit_action_count += 1
                        structured_action_profiles.append({
                            "action_index": idx,
                            "action_name": action_name,
                            "attack_bonus": profile["attack_bonus"],
                            "save_dc": profile["save_dc"],
                            "damage": profile["damage"],
                        })
                    else:
                        narrative_action_count += 1

                    if profile["save_dc"] is not None or profile["save"] is not None:
                        explicit_save_profiles.append({
                            "action_index": idx, "action_name": action_name,
                            "save_dc": profile["save_dc"], "save": profile["save"]
                        })
                    if profile["area"] is not None:
                        explicit_aoe_profiles.append({
                            "action_index": idx, "action_name": action_name, "area": profile["area"]
                        })
                    if profile["uses"] is not None:
                        explicit_resource_profiles.append({
                            "action_index": idx, "action_name": action_name, "uses": profile["uses"]
                        })
                    if profile["recharge"] is not None:
                        recharge_profiles.append({
                            "action_index": idx, "action_name": action_name, "recharge": profile["recharge"]
                        })
                    if multiattack is None and action_name.strip().lower() == "multiattack":
                        multiattack = action

                attack_profiles = top_attack_profiles if top_attack_profiles is not None else (structured_action_profiles or None)
                if save_based is None:
                    save_based = explicit_save_profiles or None
                if aoe is None:
                    aoe = explicit_aoe_profiles or None
                if resources is None:
                    resources = explicit_resource_profiles or None
                if recharge_abilities is None:
                    recharge_abilities = recharge_profiles or None

                evidence = {
                    "source_table": "monsters",
                    "source_monster_id": monster_id,
                    "stat_block_sha256": stat_hash,
                    "migration_policy": "explicit-structured-fields-only; no narrative inference",
                }

                field_values = {
                    "alignment": alignment,
                    "saving_throws": saving_throws,
                    "xp": xp,
                    "proficiency_bonus": pb,
                    "bonus_actions": bonus_actions,
                    "reactions": reactions,
                    "legendary_actions": legendary_actions,
                    "lair_actions": lair_actions,
                    "spellcasting": spellcasting,
                    "recharge_abilities": recharge_abilities,
                    "multiattack": multiattack,
                    "attack_profiles": attack_profiles,
                    "save_based_abilities": save_based,
                    "aoe_definitions": aoe,
                    "usage_limits_resources": resources,
                    "rules_version": rules_version,
                }

                gaps = []
                if malformed:
                    gaps.append("malformed_stat_block_json")
                for gap in BASELINE_GAPS:
                    if field_values.get(gap) is None:
                        gaps.append(gap)

                automation_status = "STRUCTURED_BASELINE_COMPLETE" if not gaps else "STRUCTURED_BASELINE_WITH_GAPS"

                db.execute("""
                    INSERT INTO phase7_monster_engine_profiles (
                        monster_id,alignment,hit_dice,speed_json,ability_scores_json,
                        saving_throws_json,skills_json,damage_vulnerabilities_json,
                        damage_resistances_json,damage_immunities_json,condition_immunities_json,
                        senses_json,passive_perception,languages_json,xp,proficiency_bonus,
                        traits_json,bonus_actions_json,reactions_json,legendary_actions_json,
                        lair_actions_json,spellcasting_json,recharge_abilities_json,multiattack_json,
                        attack_profiles_json,save_based_abilities_json,aoe_definitions_json,
                        usage_limits_resources_json,rules_version,source_evidence_json,
                        automation_status,automation_gaps_json,batch_id
                    ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
                """, (
                    monster_id, alignment, hit_dice,
                    as_json_or_null(speed), as_json_or_null(abilities),
                    as_json_or_null(saving_throws), as_json_or_null(skills),
                    as_json_or_null(vulnerabilities), as_json_or_null(resistances),
                    as_json_or_null(immunities), as_json_or_null(condition_immunities),
                    as_json_or_null(senses), passive, as_json_or_null(languages),
                    xp, pb, as_json_or_null(traits),
                    as_json_or_null(bonus_actions), as_json_or_null(reactions),
                    as_json_or_null(legendary_actions), as_json_or_null(lair_actions),
                    as_json_or_null(spellcasting), as_json_or_null(recharge_abilities),
                    as_json_or_null(multiattack), as_json_or_null(attack_profiles),
                    as_json_or_null(save_based), as_json_or_null(aoe),
                    as_json_or_null(resources), str(rules_version) if rules_version is not None else None,
                    canonical_json(evidence), automation_status, canonical_json(gaps), batch_id
                ))

                for gap in gaps:
                    db.execute("""
                        INSERT INTO phase7_monster_automation_backlog
                        (monster_id,gap_type,status,evidence_note,batch_id)
                        VALUES (?,?,?,?,?)
                    """, (
                        monster_id, gap, "OPEN",
                        "Not present as an explicit structured field in the current local monster record. "
                        "No narrative inference was performed.", batch_id
                    ))
                    backlog_count += 1

            monsters_digest_after = table_digest(db, "monsters", "id")
            metadata_digest_after = table_digest(db, "metadata", "key")

            if monsters_digest_before != monsters_digest_after:
                raise RuntimeError("Safety failure: source monsters table changed during migration.")
            if metadata_digest_before != metadata_digest_after:
                raise RuntimeError("Safety failure: source metadata table changed during migration.")

            registry_count = db.execute("SELECT COUNT(*) FROM phase7_monster_registry").fetchone()[0]
            profile_count = db.execute("SELECT COUNT(*) FROM phase7_monster_engine_profiles").fetchone()[0]

            if registry_count != EXPECTED_SOURCE_COUNT or profile_count != EXPECTED_SOURCE_COUNT:
                raise RuntimeError(
                    f"Baseline symmetry failure: registry={registry_count}, profiles={profile_count}"
                )

            db.execute("""
                INSERT INTO phase7_baseline_batches (
                    id,created_at,source_db_sha256,source_monster_count,
                    source_monsters_digest_before,source_monsters_digest_after,
                    source_metadata_digest_before,source_metadata_digest_after,
                    registry_count,engine_profile_count,action_profile_count,
                    automation_backlog_count,narrative_action_count,
                    explicit_action_profile_count,phase_status
                ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
            """, (
                batch_id, now_iso(), source_sha, EXPECTED_SOURCE_COUNT,
                monsters_digest_before, monsters_digest_after,
                metadata_digest_before, metadata_digest_after,
                registry_count, profile_count, action_count, backlog_count,
                narrative_action_count, explicit_action_count,
                "STRUCTURED_MONSTER_BASELINE_READY_PHASE7_OPEN"
            ))

            fk = db.execute("PRAGMA foreign_key_check").fetchall()
            if fk:
                raise RuntimeError(f"Foreign-key errors after migration: {len(fk)}")

            db.commit()
        except Exception:
            db.rollback()
            raise

        final_integrity = db.execute("PRAGMA integrity_check").fetchone()[0]
        if final_integrity != "ok":
            raise RuntimeError(f"Post-migration integrity_check failed: {final_integrity}")

        report = {
            "phase": 7,
            "package": "PHASE7_STRUCTURED_MONSTER_BASELINE_V2",
            "batchId": batch_id,
            "sourceMonsterCount": EXPECTED_SOURCE_COUNT,
            "registryCount": registry_count,
            "engineProfileCount": profile_count,
            "actionProfileCount": action_count,
            "narrativeActionCount": narrative_action_count,
            "explicitActionProfileCount": explicit_action_count,
            "automationBacklogCount": backlog_count,
            "sourceMonstersTableUnchanged": monsters_digest_before == monsters_digest_after,
            "sourceMetadataTableUnchanged": metadata_digest_before == metadata_digest_after,
            "integrity": final_integrity,
            "foreignKeyErrors": 0,
            "phaseStatus": "STRUCTURED_MONSTER_BASELINE_READY_PHASE7_OPEN",
            "next": "PHASE7_EVIDENCE_BOUNDED_MONSTER_RULES_AND_ACTION_PARSING",
        }
        (output / "phase7_structured_monster_baseline_v2_report.json").write_text(
            json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8"
        )

        summary = f"""# Phase 7 Structured Monster Baseline V2

- Source monsters: {EXPECTED_SOURCE_COUNT}
- Structured registry: {registry_count}
- Engine profiles: {profile_count}
- Action profiles: {action_count}
- Explicit structured action profiles: {explicit_action_count}
- Narrative-only actions retained without inference: {narrative_action_count}
- Automation backlog rows: {backlog_count}
- Source `monsters` table unchanged: YES
- Source `metadata` table unchanged: YES
- SQLite integrity: {final_integrity}
- Foreign key errors: 0

**Status: STRUCTURED_MONSTER_BASELINE_READY_PHASE7_OPEN**

This stage is additive. The legacy/source `monsters` table remains authoritative input and was not modified.
No mechanic was inferred from narrative prose.

Next: evidence-bounded parsing/validation for attacks, saves, recharge, multiattack, spellcasting, reactions, legendary/lair actions, and other missing structured mechanics.
"""
        (output / "PHASE7_STRUCTURED_MONSTER_BASELINE_V2_SUMMARY.md").write_text(summary, encoding="utf-8")

        print("PHASE 7 STRUCTURED MONSTER BASELINE V2 APPLIED")
        print(f"SOURCE_MONSTERS={EXPECTED_SOURCE_COUNT}")
        print(f"REGISTRY={registry_count}")
        print(f"ENGINE_PROFILES={profile_count}")
        print(f"ACTION_PROFILES={action_count}")
        print(f"EXPLICIT_ACTION_PROFILES={explicit_action_count}")
        print(f"NARRATIVE_ONLY_ACTIONS={narrative_action_count}")
        print(f"AUTOMATION_BACKLOG={backlog_count}")
        print("SOURCE_MONSTERS_UNCHANGED=YES")
        print("SOURCE_METADATA_UNCHANGED=YES")
        print("INTEGRITY=ok")
        print("FOREIGN_KEYS=ok")
        print("PHASE_STATUS=STRUCTURED_MONSTER_BASELINE_READY_PHASE7_OPEN")
        print("NEXT=PHASE7_EVIDENCE_BOUNDED_MONSTER_RULES_AND_ACTION_PARSING")
        print(f"OUTPUT={output}")
        return 0
    finally:
        db.close()

if __name__ == "__main__":
    raise SystemExit(main())
