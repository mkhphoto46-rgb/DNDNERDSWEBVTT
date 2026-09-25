from __future__ import annotations

import argparse
import json
import sqlite3
from pathlib import Path

PROJECT_ROOT = Path(r"F:\DND WEB VTT")
DEFAULT_DB = PROJECT_ROOT / "data" / "compendium" / "monsters.sqlite"
DEFAULT_OUTPUT = PROJECT_ROOT / "_phase7_strict_save_aoe_optional_resolution_v6"

EXPECTED = {
    "source_monsters": 322,
    "registry": 322,
    "engine_profiles": 322,
    "action_profiles": 836,
    "backlog": 3264,
    "v4_resolution_rows": 105,
    "v6_resolution_rows": 1248,
    "save_action_logs": 177,
    "aoe_action_logs": 52,
    "na_logs": 1019,
    "action_save_json": 177,
    "action_save_dc": 176,
    "action_area_json": 52,
    "engine_save_based": 136,
    "engine_aoe": 52,
    "saving_throw_profiles": 91,
    "reaction_profiles": 11,
    "legendary_profiles": 30,
    "multiattack_profiles": 137,
    "narrative_only": 209,
}

EXPECTED_BACKLOG = {
    "alignment": 322,
    "aoe_definitions": 270,
    "bonus_actions": 322,
    "lair_actions": 322,
    "proficiency_bonus": 322,
    "rules_version": 322,
    "save_based_abilities": 186,
    "spellcasting": 322,
    "xp": 322,
    "usage_limits_resources": 300,
    "recharge_abilities": 251,
    "attack_profiles": 3,
}

def one(db, sql, params=()):
    return db.execute(sql, params).fetchone()[0]

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--db", default=str(DEFAULT_DB))
    ap.add_argument("--output", default=str(DEFAULT_OUTPUT))
    args = ap.parse_args()

    db = sqlite3.connect(args.db)
    errors = []
    try:
        integrity = db.execute("PRAGMA integrity_check").fetchone()[0]
        fk = db.execute("PRAGMA foreign_key_check").fetchall()
        if integrity != "ok":
            errors.append(f"integrity={integrity}")
        if fk:
            errors.append(f"foreign_key_errors={len(fk)}")

        metrics = {
            "source_monsters": one(db, "SELECT COUNT(*) FROM monsters"),
            "registry": one(db, "SELECT COUNT(*) FROM phase7_monster_registry"),
            "engine_profiles": one(db, "SELECT COUNT(*) FROM phase7_monster_engine_profiles"),
            "action_profiles": one(db, "SELECT COUNT(*) FROM phase7_monster_action_profiles"),
            "backlog": one(db, "SELECT COUNT(*) FROM phase7_monster_automation_backlog"),
            "v4_resolution_rows": one(db, "SELECT COUNT(*) FROM phase7_v4_resolution_log"),
            "v6_resolution_rows": one(db, "SELECT COUNT(*) FROM phase7_v6_resolution_log"),
            "save_action_logs": one(db, "SELECT COUNT(*) FROM phase7_v6_resolution_log WHERE resolution_type='STRICT_SAVE_ACTION'"),
            "aoe_action_logs": one(db, "SELECT COUNT(*) FROM phase7_v6_resolution_log WHERE resolution_type='STRICT_AOE_ACTION'"),
            "na_logs": one(db, "SELECT COUNT(*) FROM phase7_v6_resolution_log WHERE resolution_type='NOT_APPLICABLE'"),
            "action_save_json": one(db, "SELECT COUNT(*) FROM phase7_monster_action_profiles WHERE save_json IS NOT NULL"),
            "action_save_dc": one(db, "SELECT COUNT(*) FROM phase7_monster_action_profiles WHERE save_dc IS NOT NULL"),
            "action_area_json": one(db, "SELECT COUNT(*) FROM phase7_monster_action_profiles WHERE area_json IS NOT NULL"),
            "engine_save_based": one(db, "SELECT COUNT(*) FROM phase7_monster_engine_profiles WHERE save_based_abilities_json IS NOT NULL"),
            "engine_aoe": one(db, "SELECT COUNT(*) FROM phase7_monster_engine_profiles WHERE aoe_definitions_json IS NOT NULL"),
            "saving_throw_profiles": one(db, "SELECT COUNT(*) FROM phase7_monster_engine_profiles WHERE saving_throws_json IS NOT NULL"),
            "reaction_profiles": one(db, "SELECT COUNT(*) FROM phase7_monster_engine_profiles WHERE reactions_json IS NOT NULL"),
            "legendary_profiles": one(db, "SELECT COUNT(*) FROM phase7_monster_engine_profiles WHERE legendary_actions_json IS NOT NULL"),
            "multiattack_profiles": one(db, "SELECT COUNT(*) FROM phase7_monster_engine_profiles WHERE multiattack_json IS NOT NULL"),
            "narrative_only": one(db, "SELECT COUNT(*) FROM phase7_monster_action_profiles WHERE profile_status='NARRATIVE_ONLY'"),
        }

        for key, expected in EXPECTED.items():
            if metrics[key] != expected:
                errors.append(f"{key}: expected={expected} actual={metrics[key]}")

        backlog = {
            r[0]: r[1]
            for r in db.execute("""
                SELECT gap_type,COUNT(*)
                FROM phase7_monster_automation_backlog
                GROUP BY gap_type
            """)
        }
        for gap, expected in EXPECTED_BACKLOG.items():
            actual = backlog.get(gap, 0)
            if actual != expected:
                errors.append(f"backlog[{gap}]: expected={expected} actual={actual}")

        unexpected = sorted(set(backlog) - set(EXPECTED_BACKLOG))
        if unexpected:
            errors.append(f"unexpected_backlog_types={unexpected}")

        for gap in ("saving_throws","reactions","legendary_actions","multiattack"):
            if backlog.get(gap, 0):
                errors.append(f"resolved_optional_gap_still_backlogged={gap}:{backlog[gap]}")

        # All resolved save/area fields must be valid JSON.
        malformed = 0
        for table, col in (
            ("phase7_monster_action_profiles","save_json"),
            ("phase7_monster_action_profiles","area_json"),
            ("phase7_monster_engine_profiles","save_based_abilities_json"),
            ("phase7_monster_engine_profiles","aoe_definitions_json"),
            ("phase7_v6_resolution_log","payload_json"),
        ):
            for (raw,) in db.execute(
                f'SELECT "{col}" FROM "{table}" WHERE "{col}" IS NOT NULL'
            ):
                try:
                    json.loads(raw)
                except Exception:
                    malformed += 1
        if malformed:
            errors.append(f"malformed_json={malformed}")

        # N/A family counts.
        na_expected = {
            "saving_throws": 231,
            "reactions": 311,
            "legendary_actions": 292,
            "multiattack": 185,
        }
        for subject, expected in na_expected.items():
            actual = one(db, """
                SELECT COUNT(*) FROM phase7_v6_resolution_log
                WHERE resolution_type='NOT_APPLICABLE' AND subject_key=?
            """, (subject,))
            if actual != expected:
                errors.append(f"na[{subject}]: expected={expected} actual={actual}")

        batch = db.execute("""
            SELECT save_clauses,save_actions,save_monsters,
                   aoe_definitions,aoe_actions,aoe_monsters,
                   backlog_removed,backlog_after,phase_status
            FROM phase7_v6_batches
            ORDER BY created_at DESC LIMIT 1
        """).fetchone()
        if not batch:
            errors.append("missing_v6_batch")
        else:
            expected_batch = (202,177,136,64,52,52,1207,3264,
                              "STRICT_SAVE_AOE_OPTIONAL_RESOLUTION_APPLIED_PHASE7_OPEN")
            if tuple(batch) != expected_batch:
                errors.append(f"v6_batch_mismatch={tuple(batch)}")

        output = Path(args.output)
        for fn in (
            "phase7_strict_save_aoe_optional_resolution_v6_report.json",
            "PHASE7_STRICT_SAVE_AOE_OPTIONAL_RESOLUTION_V6_SUMMARY.md",
        ):
            if not (output / fn).exists():
                errors.append(f"missing_output={fn}")

        print(f"INTEGRITY={integrity}")
        print(f"FOREIGN_KEYS={'ok' if not fk else len(fk)}")
        for k, v in metrics.items():
            print(f"{k.upper()}={v}")
        print(f"MALFORMED_JSON={malformed}")
        print(f"ERRORS={len(errors)}")
        for error in errors:
            print("ERROR:", error)

        if errors:
            return 1

        print("PHASE_STATUS=STRICT_SAVE_AOE_OPTIONAL_RESOLUTION_APPLIED_PHASE7_OPEN")
        print("NEXT=PHASE7_SPELLCASTING_RECHARGE_USAGE_AND_RULE_DERIVATION_AUDIT")
        print("OK: Independent Phase 7 V6 verification")
        return 0
    finally:
        db.close()

if __name__ == "__main__":
    raise SystemExit(main())
