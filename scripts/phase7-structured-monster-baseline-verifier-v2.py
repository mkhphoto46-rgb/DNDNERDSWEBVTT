from __future__ import annotations

import argparse
import json
import sqlite3
from pathlib import Path

PROJECT_ROOT = Path(r"F:\DND WEB VTT")
DEFAULT_DB = PROJECT_ROOT / "data" / "compendium" / "monsters.sqlite"
DEFAULT_OUTPUT = PROJECT_ROOT / "_phase7_structured_monster_baseline_v2"
EXPECTED_COUNT = 322

JSON_COLUMNS = {
    "phase7_monster_engine_profiles": [
        "speed_json","ability_scores_json","saving_throws_json","skills_json",
        "damage_vulnerabilities_json","damage_resistances_json","damage_immunities_json",
        "condition_immunities_json","senses_json","languages_json","traits_json",
        "bonus_actions_json","reactions_json","legendary_actions_json","lair_actions_json",
        "spellcasting_json","recharge_abilities_json","multiattack_json","attack_profiles_json",
        "save_based_abilities_json","aoe_definitions_json","usage_limits_resources_json",
        "source_evidence_json","automation_gaps_json"
    ],
    "phase7_monster_action_profiles": [
        "damage_json","save_json","area_json","recharge_json","usage_json","raw_action_json"
    ]
}

def digest(db, table, order_by):
    import hashlib
    rows = db.execute(f'SELECT * FROM "{table}" ORDER BY {order_by}').fetchall()
    cols = [r[1] for r in db.execute(f'PRAGMA table_info("{table}")')]
    payload = json.dumps({"columns": cols, "rows": [list(r) for r in rows]},
                         ensure_ascii=False, sort_keys=True, separators=(",",":"))
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--db", default=str(DEFAULT_DB))
    ap.add_argument("--output", default=str(DEFAULT_OUTPUT))
    args = ap.parse_args()

    db_path = Path(args.db)
    output = Path(args.output)
    db = sqlite3.connect(db_path)

    errors = []
    try:
        integrity = db.execute("PRAGMA integrity_check").fetchone()[0]
        fk = db.execute("PRAGMA foreign_key_check").fetchall()
        if integrity != "ok":
            errors.append(f"integrity={integrity}")
        if fk:
            errors.append(f"foreign_key_errors={len(fk)}")

        required_tables = [
            "monsters","metadata","phase7_monster_registry","phase7_monster_engine_profiles",
            "phase7_monster_action_profiles","phase7_monster_automation_backlog",
            "phase7_baseline_batches"
        ]
        tables = {r[0] for r in db.execute("SELECT name FROM sqlite_master WHERE type='table'")}
        for table in required_tables:
            if table not in tables:
                errors.append(f"missing_table={table}")

        registry = db.execute("SELECT COUNT(*) FROM phase7_monster_registry").fetchone()[0]
        profiles = db.execute("SELECT COUNT(*) FROM phase7_monster_engine_profiles").fetchone()[0]
        actions = db.execute("SELECT COUNT(*) FROM phase7_monster_action_profiles").fetchone()[0]
        backlog = db.execute("SELECT COUNT(*) FROM phase7_monster_automation_backlog").fetchone()[0]
        source = db.execute("SELECT COUNT(*) FROM monsters").fetchone()[0]

        if source != EXPECTED_COUNT:
            errors.append(f"source_count={source}")
        if registry != EXPECTED_COUNT:
            errors.append(f"registry_count={registry}")
        if profiles != EXPECTED_COUNT:
            errors.append(f"profile_count={profiles}")

        orphan_profiles = db.execute("""
            SELECT COUNT(*) FROM phase7_monster_engine_profiles p
            LEFT JOIN phase7_monster_registry r ON r.monster_id=p.monster_id
            WHERE r.monster_id IS NULL
        """).fetchone()[0]
        orphan_actions = db.execute("""
            SELECT COUNT(*) FROM phase7_monster_action_profiles a
            LEFT JOIN phase7_monster_registry r ON r.monster_id=a.monster_id
            WHERE r.monster_id IS NULL
        """).fetchone()[0]
        orphan_backlog = db.execute("""
            SELECT COUNT(*) FROM phase7_monster_automation_backlog b
            LEFT JOIN phase7_monster_registry r ON r.monster_id=b.monster_id
            WHERE r.monster_id IS NULL
        """).fetchone()[0]

        if orphan_profiles: errors.append(f"orphan_profiles={orphan_profiles}")
        if orphan_actions: errors.append(f"orphan_actions={orphan_actions}")
        if orphan_backlog: errors.append(f"orphan_backlog={orphan_backlog}")

        batch = db.execute("""
            SELECT source_monsters_digest_before,source_monsters_digest_after,
                   source_metadata_digest_before,source_metadata_digest_after,
                   registry_count,engine_profile_count,action_profile_count,
                   automation_backlog_count,narrative_action_count,
                   explicit_action_profile_count,phase_status
            FROM phase7_baseline_batches
            ORDER BY created_at DESC LIMIT 1
        """).fetchone()

        if not batch:
            errors.append("missing_baseline_batch")
            batch = [None] * 11
        else:
            if batch[0] != batch[1]:
                errors.append("source_monsters_digest_changed")
            if batch[2] != batch[3]:
                errors.append("source_metadata_digest_changed")
            if batch[4] != registry:
                errors.append("batch_registry_count_mismatch")
            if batch[5] != profiles:
                errors.append("batch_profile_count_mismatch")
            if batch[6] != actions:
                errors.append("batch_action_count_mismatch")
            if batch[7] != backlog:
                errors.append("batch_backlog_count_mismatch")
            if batch[10] != "STRUCTURED_MONSTER_BASELINE_READY_PHASE7_OPEN":
                errors.append(f"unexpected_status={batch[10]}")

        malformed_json = 0
        for table, cols in JSON_COLUMNS.items():
            for col in cols:
                for (raw,) in db.execute(f'SELECT "{col}" FROM "{table}" WHERE "{col}" IS NOT NULL'):
                    try:
                        json.loads(raw)
                    except Exception:
                        malformed_json += 1
        if malformed_json:
            errors.append(f"malformed_baseline_json={malformed_json}")

        bad_source_links = db.execute("""
            SELECT COUNT(*) FROM phase7_monster_registry r
            LEFT JOIN monsters m ON m.id=r.monster_id
            WHERE m.id IS NULL OR m.name<>r.name
        """).fetchone()[0]
        if bad_source_links:
            errors.append(f"bad_source_links={bad_source_links}")

        report_path = output / "phase7_structured_monster_baseline_v2_report.json"
        summary_path = output / "PHASE7_STRUCTURED_MONSTER_BASELINE_V2_SUMMARY.md"
        if not report_path.exists():
            errors.append("missing_output_report")
        if not summary_path.exists():
            errors.append("missing_output_summary")

        print(f"INTEGRITY={integrity}")
        print(f"FOREIGN_KEYS={'ok' if not fk else len(fk)}")
        print(f"SOURCE_MONSTERS={source}")
        print(f"REGISTRY={registry}")
        print(f"ENGINE_PROFILES={profiles}")
        print(f"ACTION_PROFILES={actions}")
        print(f"AUTOMATION_BACKLOG={backlog}")
        print(f"ORPHAN_PROFILES={orphan_profiles}")
        print(f"ORPHAN_ACTIONS={orphan_actions}")
        print(f"ORPHAN_BACKLOG={orphan_backlog}")
        print(f"MALFORMED_BASELINE_JSON={malformed_json}")
        print(f"BAD_SOURCE_LINKS={bad_source_links}")
        if batch:
            print(f"NARRATIVE_ONLY_ACTIONS={batch[8]}")
            print(f"EXPLICIT_ACTION_PROFILES={batch[9]}")
        print(f"ERRORS={len(errors)}")
        for err in errors:
            print("ERROR:", err)

        if errors:
            return 1

        print("PHASE_STATUS=STRUCTURED_MONSTER_BASELINE_READY_PHASE7_OPEN")
        print("NEXT=PHASE7_EVIDENCE_BOUNDED_MONSTER_RULES_AND_ACTION_PARSING")
        print("OK: Independent Phase 7 structured baseline verification")
        return 0
    finally:
        db.close()

if __name__ == "__main__":
    raise SystemExit(main())
