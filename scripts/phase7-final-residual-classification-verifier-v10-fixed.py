from __future__ import annotations

import argparse
import json
import sqlite3
from pathlib import Path

PROJECT_ROOT = Path(r"F:\DND WEB VTT")
DEFAULT_DB = PROJECT_ROOT / "data" / "compendium" / "monsters.sqlite"
DEFAULT_OUTPUT = PROJECT_ROOT / "_phase7_final_residual_classification_v10"

EXPECTED = {
    "source_monsters": 322,
    "registry": 322,
    "engine_profiles": 322,
    "action_profiles": 836,
    "backlog": 0,
    "v4_resolution_rows": 105,
    "v6_resolution_rows": 1248,
    "v8_resolution_rows": 1903,
    "v10_resolution_rows": 1454,
    "quarantine_rows": 742,
    "bonus_profiles": 31,
    "save_based_profiles": 167,
    "aoe_profiles": 52,
    "attack_profiles": 319,
    "xp_profiles": 293,
    "alignment_profiles": 0,
    "lair_profiles": 0,
    "narrative_only": 209,
}

EXPECTED_DISPOSITIONS = {
    "STRUCTURED_SOURCE": 62,
    "NOT_APPLICABLE": 650,
    "QUARANTINED": 742,
}

EXPECTED_QUARANTINE = {
    "alignment": 322,
    "lair_actions": 322,
    "xp": 29,
    "aoe_definitions": 69,
}

EXPECTED_GAP_COUNTS = {
    "alignment": 322,
    "aoe_definitions": 270,
    "attack_profiles": 3,
    "bonus_actions": 322,
    "lair_actions": 322,
    "save_based_abilities": 186,
    "xp": 29,
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
            "v10_resolution_rows": one(db, "SELECT COUNT(*) FROM phase7_v10_resolution_log"),
            "quarantine_rows": one(db, "SELECT COUNT(*) FROM phase7_monster_quarantine"),
            "bonus_profiles": one(db, "SELECT COUNT(*) FROM phase7_monster_engine_profiles WHERE bonus_actions_json IS NOT NULL"),
            "save_based_profiles": one(db, "SELECT COUNT(*) FROM phase7_monster_engine_profiles WHERE save_based_abilities_json IS NOT NULL"),
            "aoe_profiles": one(db, "SELECT COUNT(*) FROM phase7_monster_engine_profiles WHERE aoe_definitions_json IS NOT NULL"),
            "attack_profiles": one(db, "SELECT COUNT(*) FROM phase7_monster_engine_profiles WHERE attack_profiles_json IS NOT NULL"),
            "xp_profiles": one(db, "SELECT COUNT(*) FROM phase7_monster_engine_profiles WHERE xp IS NOT NULL"),
            "alignment_profiles": one(db, "SELECT COUNT(*) FROM phase7_monster_engine_profiles WHERE alignment IS NOT NULL"),
            "lair_profiles": one(db, "SELECT COUNT(*) FROM phase7_monster_engine_profiles WHERE lair_actions_json IS NOT NULL"),
            "narrative_only": one(db, "SELECT COUNT(*) FROM phase7_monster_action_profiles WHERE profile_status='NARRATIVE_ONLY'"),
        }
        for key, expected in EXPECTED.items():
            if metrics[key] != expected:
                errors.append(f"{key}: expected={expected} actual={metrics[key]}")

        dispositions = {
            r[0]: r[1]
            for r in db.execute("""
                SELECT disposition,COUNT(*)
                FROM phase7_v10_resolution_log
                GROUP BY disposition
            """)
        }
        if dispositions != EXPECTED_DISPOSITIONS:
            errors.append(
                "disposition mismatch expected="
                + json.dumps(EXPECTED_DISPOSITIONS, sort_keys=True)
                + " actual="
                + json.dumps(dispositions, sort_keys=True)
            )

        quarantine = {
            r[0]: r[1]
            for r in db.execute("""
                SELECT gap_type,COUNT(*)
                FROM phase7_monster_quarantine
                GROUP BY gap_type
            """)
        }
        if quarantine != EXPECTED_QUARANTINE:
            errors.append(
                "quarantine mismatch expected="
                + json.dumps(EXPECTED_QUARANTINE, sort_keys=True)
                + " actual="
                + json.dumps(quarantine, sort_keys=True)
            )

        gaps = {
            r[0]: r[1]
            for r in db.execute("""
                SELECT gap_type,COUNT(*)
                FROM phase7_v10_resolution_log
                GROUP BY gap_type
            """)
        }
        if gaps != EXPECTED_GAP_COUNTS:
            errors.append(
                "gap resolution mismatch expected="
                + json.dumps(EXPECTED_GAP_COUNTS, sort_keys=True)
                + " actual="
                + json.dumps(gaps, sort_keys=True)
            )

        # Every quarantine row must have a matching V10 QUARANTINED resolution.
        missing_quarantine_resolution = one(db, """
            SELECT COUNT(*)
            FROM phase7_monster_quarantine q
            LEFT JOIN phase7_v10_resolution_log r
              ON r.monster_id=q.monster_id
             AND r.gap_type=q.gap_type
             AND r.disposition='QUARANTINED'
            WHERE r.id IS NULL
        """)
        if missing_quarantine_resolution:
            errors.append(f"quarantine_without_resolution={missing_quarantine_resolution}")

        # No non-quarantined V10 resolution may appear in quarantine.
        stray_quarantine = one(db, """
            SELECT COUNT(*)
            FROM phase7_monster_quarantine q
            JOIN phase7_v10_resolution_log r
              ON r.monster_id=q.monster_id
             AND r.gap_type=q.gap_type
            WHERE r.disposition!='QUARANTINED'
        """)
        if stray_quarantine:
            errors.append(f"stray_quarantine={stray_quarantine}")

        # JSON validity.
        malformed = 0
        for table, col in (
            ("phase7_monster_engine_profiles", "bonus_actions_json"),
            ("phase7_monster_engine_profiles", "save_based_abilities_json"),
            ("phase7_v10_resolution_log", "payload_json"),
            ("phase7_monster_quarantine", "evidence_json"),
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

        # Source logical digests from batch must exist and be well-formed.
        batch = db.execute("""
            SELECT structured_count,not_applicable_count,quarantined_count,
                   resolution_rows,quarantine_rows,
                   bonus_structured_monsters,bonus_structured_entries,
                   save_structured_monsters,attack_na_monsters,
                   aoe_na_monsters,aoe_quarantined_monsters,
                   alignment_quarantined_monsters,lair_quarantined_monsters,
                   xp_quarantined_monsters,backlog_after,
                   source_monsters_digest,source_metadata_digest,
                   phase_status,package_version
            FROM phase7_v10_batches
            ORDER BY created_at DESC LIMIT 1
        """).fetchone()
        expected_prefix = (
            62,650,742,1454,742,
            31,33,31,3,201,69,322,322,29,0
        )
        if not batch:
            errors.append("missing_v10_batch")
        else:
            if tuple(batch[:15]) != expected_prefix:
                errors.append(f"v10_batch_counts_mismatch={tuple(batch[:15])}")
            if len(batch[15]) != 64 or len(batch[16]) != 64:
                errors.append("v10_batch_source_digest_invalid")
            if batch[17] != "FINAL_RESIDUALS_CLASSIFIED_READY_FOR_PHASE7_CLOSURE":
                errors.append(f"v10_bad_phase_status={batch[17]}")
            if batch[18] != "V10_FIXED":
                errors.append(f"v10_fixed_bad_package_version={batch[18]}")

        output = Path(args.output)
        for fn in (
            "phase7_final_residual_classification_v10_report.json",
            "PHASE7_FINAL_RESIDUAL_CLASSIFICATION_V10_SUMMARY.md",
        ):
            if not (output / fn).exists():
                errors.append(f"missing_output={fn}")

        print(f"INTEGRITY={integrity}")
        print(f"FOREIGN_KEYS={'ok' if not fk else len(fk)}")
        for key, value in metrics.items():
            print(f"{key.upper()}={value}")
        print(f"STRUCTURED={dispositions.get('STRUCTURED_SOURCE',0)}")
        print(f"NOT_APPLICABLE={dispositions.get('NOT_APPLICABLE',0)}")
        print(f"QUARANTINED={dispositions.get('QUARANTINED',0)}")
        for gap, value in quarantine.items():
            print(f"QUARANTINE_{gap.upper()}={value}")
        print(f"MALFORMED_JSON={malformed}")
        print(f"ERRORS={len(errors)}")
        for error in errors:
            print("ERROR:", error)

        if errors:
            return 1

        print("PHASE_STATUS=FINAL_RESIDUALS_CLASSIFIED_READY_FOR_PHASE7_CLOSURE")
        print("NEXT=PHASE7_FINAL_CLOSURE_VERIFY")
        print("OK: Independent Phase 7 V10 verification")
        return 0
    finally:
        db.close()

if __name__ == "__main__":
    raise SystemExit(main())
