from __future__ import annotations

import argparse
import json
import sqlite3
from pathlib import Path

PROJECT_ROOT = Path(r"F:\DND WEB VTT")
DEFAULT_DB = PROJECT_ROOT / "data" / "compendium" / "monsters.sqlite"
DEFAULT_OUTPUT = PROJECT_ROOT / "_phase7_strict_action_semantics_v4"

EXPECTED = {
    "source_monsters": 322,
    "registry": 322,
    "engine_profiles": 322,
    "action_profiles": 836,
    "backlog": 4471,
    "recharge_actions": 72,
    "recharge_monsters": 71,
    "usage_actions": 24,
    "usage_monsters": 22,
    "strict_attack_actions": 9,
    "strict_attack_monsters": 8,
    "resolution_rows": 105,
}

def count(db, sql, params=()):
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

        tables = {r[0] for r in db.execute(
            "SELECT name FROM sqlite_master WHERE type='table'"
        )}
        required = {
            "phase7_v4_resolution_log",
            "phase7_v4_batches",
            "phase7_monster_registry",
            "phase7_monster_engine_profiles",
            "phase7_monster_action_profiles",
            "phase7_monster_automation_backlog",
        }
        for t in sorted(required - tables):
            errors.append(f"missing_table={t}")

        metrics = {
            "source_monsters": count(db, "SELECT COUNT(*) FROM monsters"),
            "registry": count(db, "SELECT COUNT(*) FROM phase7_monster_registry"),
            "engine_profiles": count(db, "SELECT COUNT(*) FROM phase7_monster_engine_profiles"),
            "action_profiles": count(db, "SELECT COUNT(*) FROM phase7_monster_action_profiles"),
            "backlog": count(db, "SELECT COUNT(*) FROM phase7_monster_automation_backlog"),
            "recharge_actions": count(db, "SELECT COUNT(*) FROM phase7_v4_resolution_log WHERE resolution_type='RECHARGE'"),
            "recharge_monsters": count(db, "SELECT COUNT(DISTINCT monster_id) FROM phase7_v4_resolution_log WHERE resolution_type='RECHARGE'"),
            "usage_actions": count(db, "SELECT COUNT(*) FROM phase7_v4_resolution_log WHERE resolution_type='USAGE_PER_DAY'"),
            "usage_monsters": count(db, "SELECT COUNT(DISTINCT monster_id) FROM phase7_v4_resolution_log WHERE resolution_type='USAGE_PER_DAY'"),
            "strict_attack_actions": count(db, "SELECT COUNT(*) FROM phase7_v4_resolution_log WHERE resolution_type='STRICT_STANDARD_ATTACK'"),
            "strict_attack_monsters": count(db, "SELECT COUNT(DISTINCT monster_id) FROM phase7_v4_resolution_log WHERE resolution_type='STRICT_STANDARD_ATTACK'"),
            "resolution_rows": count(db, "SELECT COUNT(*) FROM phase7_v4_resolution_log"),
        }

        for key, expected in EXPECTED.items():
            if metrics[key] != expected:
                errors.append(f"{key}: expected={expected} actual={metrics[key]}")

        # Resolved monsters must no longer carry those exact backlog gaps.
        recharge_backlog = count(db, """
            SELECT COUNT(*)
            FROM phase7_monster_automation_backlog b
            WHERE b.gap_type='recharge_abilities'
              AND EXISTS (
                SELECT 1 FROM phase7_v4_resolution_log r
                WHERE r.monster_id=b.monster_id
                  AND r.resolution_type='RECHARGE'
              )
        """)
        usage_backlog = count(db, """
            SELECT COUNT(*)
            FROM phase7_monster_automation_backlog b
            WHERE b.gap_type='usage_limits_resources'
              AND EXISTS (
                SELECT 1 FROM phase7_v4_resolution_log r
                WHERE r.monster_id=b.monster_id
                  AND r.resolution_type='USAGE_PER_DAY'
              )
        """)
        attack_backlog = count(db, """
            SELECT COUNT(*)
            FROM phase7_monster_automation_backlog b
            WHERE b.gap_type='attack_profiles'
              AND EXISTS (
                SELECT 1 FROM phase7_v4_resolution_log r
                WHERE r.monster_id=b.monster_id
                  AND r.resolution_type='STRICT_STANDARD_ATTACK'
              )
        """)
        if recharge_backlog:
            errors.append(f"resolved_recharge_still_backlogged={recharge_backlog}")
        if usage_backlog:
            errors.append(f"resolved_usage_still_backlogged={usage_backlog}")
        if attack_backlog:
            errors.append(f"resolved_attack_still_backlogged={attack_backlog}")

        # Canonical engine fields must exist for all resolved monsters.
        missing_recharge_engine = count(db, """
            SELECT COUNT(DISTINCT r.monster_id)
            FROM phase7_v4_resolution_log r
            JOIN phase7_monster_engine_profiles p ON p.monster_id=r.monster_id
            WHERE r.resolution_type='RECHARGE'
              AND p.recharge_abilities_json IS NULL
        """)
        missing_usage_engine = count(db, """
            SELECT COUNT(DISTINCT r.monster_id)
            FROM phase7_v4_resolution_log r
            JOIN phase7_monster_engine_profiles p ON p.monster_id=r.monster_id
            WHERE r.resolution_type='USAGE_PER_DAY'
              AND p.usage_limits_resources_json IS NULL
        """)
        missing_attack_engine = count(db, """
            SELECT COUNT(DISTINCT r.monster_id)
            FROM phase7_v4_resolution_log r
            JOIN phase7_monster_engine_profiles p ON p.monster_id=r.monster_id
            WHERE r.resolution_type='STRICT_STANDARD_ATTACK'
              AND p.attack_profiles_json IS NULL
        """)
        if missing_recharge_engine:
            errors.append(f"missing_recharge_engine={missing_recharge_engine}")
        if missing_usage_engine:
            errors.append(f"missing_usage_engine={missing_usage_engine}")
        if missing_attack_engine:
            errors.append(f"missing_attack_engine={missing_attack_engine}")

        malformed_json = 0
        for table, col in [
            ("phase7_v4_resolution_log","payload_json"),
            ("phase7_monster_engine_profiles","recharge_abilities_json"),
            ("phase7_monster_engine_profiles","usage_limits_resources_json"),
            ("phase7_monster_engine_profiles","attack_profiles_json"),
            ("phase7_monster_action_profiles","recharge_json"),
            ("phase7_monster_action_profiles","usage_json"),
            ("phase7_monster_action_profiles","damage_json"),
        ]:
            for (raw,) in db.execute(
                f'SELECT "{col}" FROM "{table}" WHERE "{col}" IS NOT NULL'
            ):
                try:
                    json.loads(raw)
                except Exception:
                    malformed_json += 1
        if malformed_json:
            errors.append(f"malformed_json={malformed_json}")

        # The three unresolved no-attack source monsters must remain backlogged.
        remaining_attack_backlog = count(db, """
            SELECT COUNT(*)
            FROM phase7_monster_automation_backlog
            WHERE gap_type='attack_profiles'
        """)
        if remaining_attack_backlog != 3:
            errors.append(f"remaining_attack_backlog expected=3 actual={remaining_attack_backlog}")

        batch = db.execute("""
            SELECT phase_status, backlog_after
            FROM phase7_v4_batches
            ORDER BY created_at DESC
            LIMIT 1
        """).fetchone()
        if not batch:
            errors.append("missing_v4_batch")
        else:
            if batch[0] != "STRICT_ACTION_SEMANTICS_APPLIED_PHASE7_OPEN":
                errors.append(f"bad_v4_status={batch[0]}")
            if batch[1] != EXPECTED["backlog"]:
                errors.append(f"batch_backlog_after={batch[1]}")

        output = Path(args.output)
        for fn in (
            "phase7_strict_action_semantics_v4_report.json",
            "PHASE7_STRICT_ACTION_SEMANTICS_V4_SUMMARY.md",
        ):
            if not (output / fn).exists():
                errors.append(f"missing_output={fn}")

        print(f"INTEGRITY={integrity}")
        print(f"FOREIGN_KEYS={'ok' if not fk else len(fk)}")
        for key, value in metrics.items():
            print(f"{key.upper()}={value}")
        print(f"REMAINING_ATTACK_PROFILE_BACKLOG={remaining_attack_backlog}")
        print(f"MALFORMED_JSON={malformed_json}")
        print(f"ERRORS={len(errors)}")
        for error in errors:
            print("ERROR:", error)

        if errors:
            return 1

        print("PHASE_STATUS=STRICT_ACTION_SEMANTICS_APPLIED_PHASE7_OPEN")
        print("NEXT=PHASE7_SAVE_AOE_AND_OPTIONAL_SECTION_SEMANTICS_AUDIT")
        print("OK: Independent Phase 7 V4 verification")
        return 0
    finally:
        db.close()

if __name__ == "__main__":
    raise SystemExit(main())
