from __future__ import annotations

import argparse
import json
import sqlite3
from pathlib import Path

PROJECT_ROOT = Path(r"F:\DND WEB VTT")
DEFAULT_DB = PROJECT_ROOT / "data" / "compendium" / "monsters.sqlite"
DEFAULT_OUTPUT = PROJECT_ROOT / "_phase7_bounded_spellcasting_rule_derivation_v8"

EXPECTED = {
    "source_monsters": 322,
    "registry": 322,
    "engine_profiles": 322,
    "action_profiles": 836,
    "backlog": 1454,
    "v4_resolution_rows": 105,
    "v6_resolution_rows": 1248,
    "v8_resolution_rows": 1903,
    "recharge_profiles": 74,
    "usage_profiles": 57,
    "spellcasting_profiles": 37,
    "pb_profiles": 322,
    "xp_profiles": 293,
    "rules_version_profiles": 322,
    "xp_null_cr0": 29,
    "xp_nonnull_cr0": 0,
}

EXPECTED_BACKLOG = {
    "alignment": 322,
    "aoe_definitions": 270,
    "bonus_actions": 322,
    "lair_actions": 322,
    "save_based_abilities": 186,
    "xp": 29,
    "attack_profiles": 3,
}

EXPECTED_LOG_COUNTS = {
    ("SOURCE_INVENTORY", "recharge_abilities"): 74,
    ("NOT_APPLICABLE", "recharge_abilities"): 248,
    ("SOURCE_INVENTORY", "usage_limits_resources"): 57,
    ("NOT_APPLICABLE", "usage_limits_resources"): 265,
    ("SOURCE_INVENTORY", "spellcasting"): 37,
    ("NOT_APPLICABLE", "spellcasting"): 285,
    ("RULE_DERIVED", "proficiency_bonus"): 322,
    ("RULE_DERIVED", "xp"): 293,
    ("RULE_DERIVED", "rules_version"): 322,
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
            "v8_resolution_rows": one(db, "SELECT COUNT(*) FROM phase7_v8_resolution_log"),
            "recharge_profiles": one(db, "SELECT COUNT(*) FROM phase7_monster_engine_profiles WHERE recharge_abilities_json IS NOT NULL"),
            "usage_profiles": one(db, "SELECT COUNT(*) FROM phase7_monster_engine_profiles WHERE usage_limits_resources_json IS NOT NULL"),
            "spellcasting_profiles": one(db, "SELECT COUNT(*) FROM phase7_monster_engine_profiles WHERE spellcasting_json IS NOT NULL"),
            "pb_profiles": one(db, "SELECT COUNT(*) FROM phase7_monster_engine_profiles WHERE proficiency_bonus IS NOT NULL"),
            "xp_profiles": one(db, "SELECT COUNT(*) FROM phase7_monster_engine_profiles WHERE xp IS NOT NULL"),
            "rules_version_profiles": one(db, "SELECT COUNT(*) FROM phase7_monster_engine_profiles WHERE rules_version IS NOT NULL"),
            "xp_null_cr0": one(db, """
                SELECT COUNT(*)
                FROM phase7_monster_engine_profiles p
                JOIN phase7_monster_registry r ON r.monster_id=p.monster_id
                WHERE r.cr_numeric=0 AND p.xp IS NULL
            """),
            "xp_nonnull_cr0": one(db, """
                SELECT COUNT(*)
                FROM phase7_monster_engine_profiles p
                JOIN phase7_monster_registry r ON r.monster_id=p.monster_id
                WHERE r.cr_numeric=0 AND p.xp IS NOT NULL
            """),
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
        if backlog != EXPECTED_BACKLOG:
            errors.append(
                "backlog mismatch expected="
                + json.dumps(EXPECTED_BACKLOG, sort_keys=True)
                + " actual="
                + json.dumps(backlog, sort_keys=True)
            )

        for (rtype, subject), expected in EXPECTED_LOG_COUNTS.items():
            actual = one(db, """
                SELECT COUNT(*)
                FROM phase7_v8_resolution_log
                WHERE resolution_type=? AND subject_key=?
            """, (rtype, subject))
            if actual != expected:
                errors.append(
                    f"log[{rtype},{subject}] expected={expected} actual={actual}"
                )

        # Canonical source inventory entry totals.
        recharge_entries = 0
        usage_entries = 0
        spell_traits = 0
        malformed = 0
        for col, counter_name in (
            ("recharge_abilities_json", "recharge"),
            ("usage_limits_resources_json", "usage"),
            ("spellcasting_json", "spell"),
        ):
            for (raw,) in db.execute(
                f'SELECT "{col}" FROM phase7_monster_engine_profiles WHERE "{col}" IS NOT NULL'
            ):
                try:
                    value = json.loads(raw)
                except Exception:
                    malformed += 1
                    continue
                if counter_name == "recharge":
                    if not isinstance(value, list):
                        malformed += 1
                    else:
                        recharge_entries += len(value)
                elif counter_name == "usage":
                    if not isinstance(value, list):
                        malformed += 1
                    else:
                        usage_entries += len(value)
                else:
                    if not isinstance(value, dict) or not isinstance(value.get("traits"), list):
                        malformed += 1
                    else:
                        spell_traits += len(value["traits"])

        if recharge_entries != 75:
            errors.append(f"recharge_entries expected=75 actual={recharge_entries}")
        if usage_entries != 79:
            errors.append(f"usage_entries expected=79 actual={usage_entries}")
        if spell_traits != 39:
            errors.append(f"spellcasting_traits expected=39 actual={spell_traits}")

        # Every rules_version must be exactly 2024.
        wrong_rules = one(db, """
            SELECT COUNT(*) FROM phase7_monster_engine_profiles
            WHERE rules_version IS NULL OR rules_version!='2024'
        """)
        if wrong_rules:
            errors.append(f"wrong_rules_version={wrong_rules}")

        # PB must match the official CR bands.
        bad_pb = one(db, """
            SELECT COUNT(*)
            FROM phase7_monster_engine_profiles p
            JOIN phase7_monster_registry r ON r.monster_id=p.monster_id
            WHERE p.proficiency_bonus !=
                CASE
                    WHEN r.cr_numeric <= 4 THEN 2
                    WHEN r.cr_numeric <= 8 THEN 3
                    WHEN r.cr_numeric <= 12 THEN 4
                    WHEN r.cr_numeric <= 16 THEN 5
                    WHEN r.cr_numeric <= 20 THEN 6
                    WHEN r.cr_numeric <= 24 THEN 7
                    WHEN r.cr_numeric <= 28 THEN 8
                    WHEN r.cr_numeric <= 30 THEN 9
                END
        """)
        if bad_pb:
            errors.append(f"bad_pb_derivations={bad_pb}")

        # CR 0 XP must remain unresolved.
        if metrics["xp_nonnull_cr0"]:
            errors.append("CR0 XP was populated despite official 0-or-10 ambiguity.")

        # JSON validity for all newly structured fields and log payloads.
        for table, col in (
            ("phase7_monster_engine_profiles", "recharge_abilities_json"),
            ("phase7_monster_engine_profiles", "usage_limits_resources_json"),
            ("phase7_monster_engine_profiles", "spellcasting_json"),
            ("phase7_v8_resolution_log", "payload_json"),
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

        batch = db.execute("""
            SELECT recharge_entries,recharge_monsters,recharge_na_monsters,
                   usage_entries,usage_monsters,usage_na_monsters,
                   spellcasting_traits,spellcasting_monsters,spellcasting_na_monsters,
                   pb_derived,xp_derived,xp_unresolved_cr0,rules_version_derived,
                   resolution_rows,backlog_removed,backlog_after,phase_status
            FROM phase7_v8_batches
            ORDER BY created_at DESC LIMIT 1
        """).fetchone()
        expected_batch = (
            75,74,248,
            79,57,265,
            39,37,285,
            322,293,29,322,
            1903,1810,1454,
            "BOUNDED_SPELLCASTING_RULE_DERIVATION_APPLIED_PHASE7_OPEN"
        )
        if not batch:
            errors.append("missing_v8_batch")
        elif tuple(batch) != expected_batch:
            errors.append(f"v8_batch_mismatch={tuple(batch)}")

        output = Path(args.output)
        for fn in (
            "phase7_bounded_spellcasting_rule_derivation_v8_report.json",
            "PHASE7_BOUNDED_SPELLCASTING_RULE_DERIVATION_V8_SUMMARY.md",
        ):
            if not (output / fn).exists():
                errors.append(f"missing_output={fn}")

        print(f"INTEGRITY={integrity}")
        print(f"FOREIGN_KEYS={'ok' if not fk else len(fk)}")
        for key, value in metrics.items():
            print(f"{key.upper()}={value}")
        print(f"RECHARGE_ENTRIES={recharge_entries}")
        print(f"USAGE_ENTRIES={usage_entries}")
        print(f"SPELLCASTING_TRAITS={spell_traits}")
        print(f"BAD_PB_DERIVATIONS={bad_pb}")
        print(f"WRONG_RULES_VERSION={wrong_rules}")
        print(f"MALFORMED_JSON={malformed}")
        print(f"ERRORS={len(errors)}")
        for error in errors:
            print("ERROR:", error)

        if errors:
            return 1

        print("PHASE_STATUS=BOUNDED_SPELLCASTING_RULE_DERIVATION_APPLIED_PHASE7_OPEN")
        print("NEXT=PHASE7_FINAL_RESIDUAL_MONSTER_SEMANTICS_AUDIT")
        print("OK: Independent Phase 7 V8 verification")
        return 0
    finally:
        db.close()

if __name__ == "__main__":
    raise SystemExit(main())
