from __future__ import annotations

import argparse
import hashlib
import json
import sqlite3
from datetime import datetime, timezone
from pathlib import Path

PROJECT_ROOT = Path(r"F:\DND WEB VTT")
DEFAULT_DB = PROJECT_ROOT / "data" / "compendium" / "monsters.sqlite"
DEFAULT_OUTPUT = PROJECT_ROOT / "_phase7_final_closure_verify_v11"

EXPECTED_COUNTS = {
    "source_monsters": 322,
    "metadata": 4,
    "registry": 322,
    "engine_profiles": 322,
    "action_profiles": 836,
    "automation_backlog": 0,
    "v4_resolution_rows": 105,
    "v6_resolution_rows": 1248,
    "v8_resolution_rows": 1903,
    "v10_resolution_rows": 1454,
    "quarantine_rows": 742,
    "narrative_only": 209,
}

EXPECTED_ENGINE_COVERAGE = {
    "saving_throws_json": 91,
    "bonus_actions_json": 31,
    "reactions_json": 11,
    "legendary_actions_json": 30,
    "lair_actions_json": 0,
    "spellcasting_json": 37,
    "recharge_abilities_json": 74,
    "multiattack_json": 137,
    "attack_profiles_json": 319,
    "save_based_abilities_json": 167,
    "aoe_definitions_json": 52,
    "usage_limits_resources_json": 57,
    "xp": 293,
    "proficiency_bonus": 322,
    "rules_version": 322,
    "alignment": 0,
}

EXPECTED_V10_DISPOSITIONS = {
    "STRUCTURED_SOURCE": 62,
    "NOT_APPLICABLE": 650,
    "QUARANTINED": 742,
}

EXPECTED_V10_GAPS = {
    "alignment": 322,
    "aoe_definitions": 270,
    "attack_profiles": 3,
    "bonus_actions": 322,
    "lair_actions": 322,
    "save_based_abilities": 186,
    "xp": 29,
}

EXPECTED_QUARANTINE = {
    "alignment": 322,
    "aoe_definitions": 69,
    "lair_actions": 322,
    "xp": 29,
}

EXPECTED_V10_BATCH = {
    "structured_count": 62,
    "not_applicable_count": 650,
    "quarantined_count": 742,
    "resolution_rows": 1454,
    "quarantine_rows": 742,
    "bonus_structured_monsters": 31,
    "bonus_structured_entries": 33,
    "save_structured_monsters": 31,
    "attack_na_monsters": 3,
    "aoe_na_monsters": 201,
    "aoe_quarantined_monsters": 69,
    "alignment_quarantined_monsters": 322,
    "lair_quarantined_monsters": 322,
    "xp_quarantined_monsters": 29,
    "backlog_after": 0,
    "phase_status": "FINAL_RESIDUALS_CLASSIFIED_READY_FOR_PHASE7_CLOSURE",
    "package_version": "V10_FIXED",
}

def now_iso():
    return datetime.now(timezone.utc).isoformat()

def cjson(value):
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))

def logical_digest(db, table):
    cols = [r[1] for r in db.execute(f'PRAGMA table_info("{table}")')]
    if not cols:
        raise RuntimeError(f"Cannot digest missing table: {table}")
    select_cols = ", ".join(f'"{c}"' for c in cols)
    h = hashlib.sha256()
    for row in db.execute(f'SELECT {select_cols} FROM "{table}" ORDER BY rowid'):
        h.update(cjson(list(row)).encode("utf-8"))
        h.update(b"\n")
    return h.hexdigest()

def one(db, sql, params=()):
    return db.execute(sql, params).fetchone()[0]

def dict_count(db, sql, params=()):
    return {r[0]: r[1] for r in db.execute(sql, params)}

def get_tables(db):
    return {
        r[0] for r in db.execute(
            "SELECT name FROM sqlite_master WHERE type='table'"
        )
    }

def validate_json_columns(db):
    malformed = []
    checked_values = 0
    for table in sorted(get_tables(db)):
        cols = [r[1] for r in db.execute(f'PRAGMA table_info("{table}")')]
        json_cols = [
            c for c in cols
            if c.endswith("_json")
            or c in {"stat_block_json", "payload_json", "evidence_json"}
        ]
        for col in json_cols:
            for rowid, raw in db.execute(
                f'SELECT rowid, "{col}" FROM "{table}" WHERE "{col}" IS NOT NULL'
            ):
                checked_values += 1
                try:
                    json.loads(raw)
                except Exception as exc:
                    malformed.append({
                        "table": table,
                        "column": col,
                        "rowid": rowid,
                        "error": str(exc),
                    })
    return checked_values, malformed

def validate_orphans(db):
    registry_ids = {
        r[0] for r in db.execute(
            "SELECT monster_id FROM phase7_monster_registry"
        )
    }
    orphan_rows = []
    checked_rows = 0
    for table in sorted(get_tables(db)):
        cols = [r[1] for r in db.execute(f'PRAGMA table_info("{table}")')]
        if "monster_id" not in cols or table == "phase7_monster_registry":
            continue
        for rowid, monster_id in db.execute(
            f'SELECT rowid, monster_id FROM "{table}" WHERE monster_id IS NOT NULL'
        ):
            checked_rows += 1
            if monster_id not in registry_ids:
                orphan_rows.append({
                    "table": table,
                    "rowid": rowid,
                    "monster_id": monster_id,
                })
    return checked_rows, orphan_rows

def verify(db_path: Path, output: Path, foundation_passed: bool):
    errors = []
    warnings = []

    uri = db_path.resolve().as_uri() + "?mode=ro"
    db = sqlite3.connect(uri, uri=True)
    db.row_factory = sqlite3.Row
    try:
        integrity = db.execute("PRAGMA integrity_check").fetchone()[0]
        fk_errors = db.execute("PRAGMA foreign_key_check").fetchall()
        if integrity != "ok":
            errors.append(f"integrity_check={integrity}")
        if fk_errors:
            errors.append(f"foreign_key_errors={len(fk_errors)}")

        required_tables = {
            "monsters",
            "metadata",
            "phase7_monster_registry",
            "phase7_monster_engine_profiles",
            "phase7_monster_action_profiles",
            "phase7_monster_automation_backlog",
            "phase7_v4_resolution_log",
            "phase7_v6_resolution_log",
            "phase7_v8_resolution_log",
            "phase7_v10_resolution_log",
            "phase7_monster_quarantine",
            "phase7_v10_batches",
        }
        missing_tables = sorted(required_tables - get_tables(db))
        if missing_tables:
            errors.append("missing_tables=" + ",".join(missing_tables))

        counts = {
            "source_monsters": one(db, "SELECT COUNT(*) FROM monsters"),
            "metadata": one(db, "SELECT COUNT(*) FROM metadata"),
            "registry": one(db, "SELECT COUNT(*) FROM phase7_monster_registry"),
            "engine_profiles": one(db, "SELECT COUNT(*) FROM phase7_monster_engine_profiles"),
            "action_profiles": one(db, "SELECT COUNT(*) FROM phase7_monster_action_profiles"),
            "automation_backlog": one(db, "SELECT COUNT(*) FROM phase7_monster_automation_backlog"),
            "v4_resolution_rows": one(db, "SELECT COUNT(*) FROM phase7_v4_resolution_log"),
            "v6_resolution_rows": one(db, "SELECT COUNT(*) FROM phase7_v6_resolution_log"),
            "v8_resolution_rows": one(db, "SELECT COUNT(*) FROM phase7_v8_resolution_log"),
            "v10_resolution_rows": one(db, "SELECT COUNT(*) FROM phase7_v10_resolution_log"),
            "quarantine_rows": one(db, "SELECT COUNT(*) FROM phase7_monster_quarantine"),
            "narrative_only": one(db, """
                SELECT COUNT(*) FROM phase7_monster_action_profiles
                WHERE profile_status='NARRATIVE_ONLY'
            """),
        }
        for key, expected in EXPECTED_COUNTS.items():
            if counts[key] != expected:
                errors.append(f"count[{key}] expected={expected} actual={counts[key]}")

        # Source ID quality / uniqueness.
        source_nonempty_ids = one(db, """
            SELECT COUNT(*) FROM monsters
            WHERE id IS NOT NULL AND TRIM(id)!=''
        """)
        source_unique_ids = one(db, "SELECT COUNT(DISTINCT id) FROM monsters")
        registry_unique_ids = one(
            db, "SELECT COUNT(DISTINCT monster_id) FROM phase7_monster_registry"
        )
        if source_nonempty_ids != 322:
            errors.append(f"source_nonempty_ids expected=322 actual={source_nonempty_ids}")
        if source_unique_ids != 322:
            errors.append(f"source_unique_ids expected=322 actual={source_unique_ids}")
        if registry_unique_ids != 322:
            errors.append(f"registry_unique_ids expected=322 actual={registry_unique_ids}")

        # Source/registry identity equality.
        source_ids = {r[0] for r in db.execute("SELECT id FROM monsters")}
        registry_ids = {
            r[0] for r in db.execute(
                "SELECT monster_id FROM phase7_monster_registry"
            )
        }
        if source_ids != registry_ids:
            errors.append(
                f"source_registry_id_set_mismatch missing_registry={len(source_ids-registry_ids)} "
                f"extra_registry={len(registry_ids-source_ids)}"
            )

        # Engine coverage.
        engine_coverage = {}
        for col, expected in EXPECTED_ENGINE_COVERAGE.items():
            actual = one(
                db,
                f'SELECT COUNT(*) FROM phase7_monster_engine_profiles WHERE "{col}" IS NOT NULL'
            )
            engine_coverage[col] = actual
            if actual != expected:
                errors.append(
                    f"engine_coverage[{col}] expected={expected} actual={actual}"
                )

        # All rules versions must be 2024 and all PB values must be populated.
        wrong_rules = one(db, """
            SELECT COUNT(*) FROM phase7_monster_engine_profiles
            WHERE rules_version IS NULL OR rules_version!='2024'
        """)
        if wrong_rules:
            errors.append(f"wrong_rules_version={wrong_rules}")

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

        # CR 0 XP must still be unresolved, nonzero CR XP must be present.
        cr0_xp_nonnull = one(db, """
            SELECT COUNT(*)
            FROM phase7_monster_engine_profiles p
            JOIN phase7_monster_registry r ON r.monster_id=p.monster_id
            WHERE r.cr_numeric=0 AND p.xp IS NOT NULL
        """)
        cr0_xp_null = one(db, """
            SELECT COUNT(*)
            FROM phase7_monster_engine_profiles p
            JOIN phase7_monster_registry r ON r.monster_id=p.monster_id
            WHERE r.cr_numeric=0 AND p.xp IS NULL
        """)
        nonzero_xp_null = one(db, """
            SELECT COUNT(*)
            FROM phase7_monster_engine_profiles p
            JOIN phase7_monster_registry r ON r.monster_id=p.monster_id
            WHERE r.cr_numeric>0 AND p.xp IS NULL
        """)
        if cr0_xp_nonnull != 0:
            errors.append(f"cr0_xp_nonnull expected=0 actual={cr0_xp_nonnull}")
        if cr0_xp_null != 29:
            errors.append(f"cr0_xp_null expected=29 actual={cr0_xp_null}")
        if nonzero_xp_null != 0:
            errors.append(f"nonzero_xp_null expected=0 actual={nonzero_xp_null}")

        # V10 disposition and gap accounting.
        dispositions = dict_count(db, """
            SELECT disposition,COUNT(*)
            FROM phase7_v10_resolution_log
            GROUP BY disposition
        """)
        if dispositions != EXPECTED_V10_DISPOSITIONS:
            errors.append(
                "v10_dispositions expected="
                + cjson(EXPECTED_V10_DISPOSITIONS)
                + " actual="
                + cjson(dispositions)
            )

        v10_gaps = dict_count(db, """
            SELECT gap_type,COUNT(*)
            FROM phase7_v10_resolution_log
            GROUP BY gap_type
        """)
        if v10_gaps != EXPECTED_V10_GAPS:
            errors.append(
                "v10_gap_counts expected="
                + cjson(EXPECTED_V10_GAPS)
                + " actual="
                + cjson(v10_gaps)
            )

        quarantine_counts = dict_count(db, """
            SELECT gap_type,COUNT(*)
            FROM phase7_monster_quarantine
            GROUP BY gap_type
        """)
        if quarantine_counts != EXPECTED_QUARANTINE:
            errors.append(
                "quarantine_counts expected="
                + cjson(EXPECTED_QUARANTINE)
                + " actual="
                + cjson(quarantine_counts)
            )

        # V10 (monster,gap) must be unique and total 1454.
        v10_distinct = one(db, """
            SELECT COUNT(*) FROM (
                SELECT monster_id,gap_type
                FROM phase7_v10_resolution_log
                GROUP BY monster_id,gap_type
            )
        """)
        if v10_distinct != 1454:
            errors.append(f"v10_distinct_pairs expected=1454 actual={v10_distinct}")

        # Quarantine <-> V10 QUARANTINED must be a perfect 1:1 match.
        q_without_r = one(db, """
            SELECT COUNT(*)
            FROM phase7_monster_quarantine q
            LEFT JOIN phase7_v10_resolution_log r
              ON r.monster_id=q.monster_id
             AND r.gap_type=q.gap_type
             AND r.disposition='QUARANTINED'
            WHERE r.id IS NULL
        """)
        r_without_q = one(db, """
            SELECT COUNT(*)
            FROM phase7_v10_resolution_log r
            LEFT JOIN phase7_monster_quarantine q
              ON q.monster_id=r.monster_id
             AND q.gap_type=r.gap_type
            WHERE r.disposition='QUARANTINED'
              AND q.monster_id IS NULL
        """)
        if q_without_r:
            errors.append(f"quarantine_without_resolution={q_without_r}")
        if r_without_q:
            errors.append(f"resolution_without_quarantine={r_without_q}")

        # Canonical consistency of quarantine families.
        quarantine_canonical_conflicts = {
            "alignment": one(db, """
                SELECT COUNT(*)
                FROM phase7_monster_quarantine q
                JOIN phase7_monster_engine_profiles p ON p.monster_id=q.monster_id
                WHERE q.gap_type='alignment' AND p.alignment IS NOT NULL
            """),
            "lair_actions": one(db, """
                SELECT COUNT(*)
                FROM phase7_monster_quarantine q
                JOIN phase7_monster_engine_profiles p ON p.monster_id=q.monster_id
                WHERE q.gap_type='lair_actions' AND p.lair_actions_json IS NOT NULL
            """),
            "xp": one(db, """
                SELECT COUNT(*)
                FROM phase7_monster_quarantine q
                JOIN phase7_monster_engine_profiles p ON p.monster_id=q.monster_id
                JOIN phase7_monster_registry r ON r.monster_id=q.monster_id
                WHERE q.gap_type='xp' AND (p.xp IS NOT NULL OR r.cr_numeric!=0)
            """),
            "aoe_definitions": one(db, """
                SELECT COUNT(*)
                FROM phase7_monster_quarantine q
                JOIN phase7_monster_engine_profiles p ON p.monster_id=q.monster_id
                WHERE q.gap_type='aoe_definitions'
                  AND p.aoe_definitions_json IS NOT NULL
            """),
        }
        for gap, conflicts in quarantine_canonical_conflicts.items():
            if conflicts:
                errors.append(
                    f"quarantine_canonical_conflict[{gap}]={conflicts}"
                )

        # NOT_APPLICABLE canonical consistency for V10 families.
        na_conflicts = {
            "bonus_actions": one(db, """
                SELECT COUNT(*)
                FROM phase7_v10_resolution_log r
                JOIN phase7_monster_engine_profiles p ON p.monster_id=r.monster_id
                WHERE r.gap_type='bonus_actions'
                  AND r.disposition='NOT_APPLICABLE'
                  AND p.bonus_actions_json IS NOT NULL
            """),
            "save_based_abilities": one(db, """
                SELECT COUNT(*)
                FROM phase7_v10_resolution_log r
                JOIN phase7_monster_engine_profiles p ON p.monster_id=r.monster_id
                WHERE r.gap_type='save_based_abilities'
                  AND r.disposition='NOT_APPLICABLE'
                  AND p.save_based_abilities_json IS NOT NULL
            """),
            "attack_profiles": one(db, """
                SELECT COUNT(*)
                FROM phase7_v10_resolution_log r
                JOIN phase7_monster_engine_profiles p ON p.monster_id=r.monster_id
                WHERE r.gap_type='attack_profiles'
                  AND r.disposition='NOT_APPLICABLE'
                  AND p.attack_profiles_json IS NOT NULL
            """),
            "aoe_definitions": one(db, """
                SELECT COUNT(*)
                FROM phase7_v10_resolution_log r
                JOIN phase7_monster_engine_profiles p ON p.monster_id=r.monster_id
                WHERE r.gap_type='aoe_definitions'
                  AND r.disposition='NOT_APPLICABLE'
                  AND p.aoe_definitions_json IS NOT NULL
            """),
        }
        for gap, conflicts in na_conflicts.items():
            if conflicts:
                errors.append(f"not_applicable_canonical_conflict[{gap}]={conflicts}")

        # STRUCTURED_SOURCE canonical consistency.
        structured_conflicts = {
            "bonus_actions": one(db, """
                SELECT COUNT(*)
                FROM phase7_v10_resolution_log r
                JOIN phase7_monster_engine_profiles p ON p.monster_id=r.monster_id
                WHERE r.gap_type='bonus_actions'
                  AND r.disposition='STRUCTURED_SOURCE'
                  AND p.bonus_actions_json IS NULL
            """),
            "save_based_abilities": one(db, """
                SELECT COUNT(*)
                FROM phase7_v10_resolution_log r
                JOIN phase7_monster_engine_profiles p ON p.monster_id=r.monster_id
                WHERE r.gap_type='save_based_abilities'
                  AND r.disposition='STRUCTURED_SOURCE'
                  AND p.save_based_abilities_json IS NULL
            """),
        }
        for gap, conflicts in structured_conflicts.items():
            if conflicts:
                errors.append(f"structured_canonical_conflict[{gap}]={conflicts}")

        # JSON validity over all *_json / payload / evidence columns.
        json_checked, malformed_json = validate_json_columns(db)
        if malformed_json:
            errors.append(f"malformed_json_values={len(malformed_json)}")

        # Explicit orphan scan across every phase7 table with a monster_id.
        orphan_checked, orphan_rows = validate_orphans(db)
        if orphan_rows:
            errors.append(f"orphan_rows={len(orphan_rows)}")

        # V10 batch and source logical digest verification.
        batch = db.execute("""
            SELECT *
            FROM phase7_v10_batches
            ORDER BY created_at DESC
            LIMIT 1
        """).fetchone()
        if not batch:
            errors.append("missing_v10_batch")
            batch_info = {}
            source_monsters_digest = None
            source_metadata_digest = None
        else:
            batch_info = dict(batch)
            for key, expected in EXPECTED_V10_BATCH.items():
                if batch_info.get(key) != expected:
                    errors.append(
                        f"v10_batch[{key}] expected={expected} actual={batch_info.get(key)}"
                    )
            source_monsters_digest = logical_digest(db, "monsters")
            source_metadata_digest = logical_digest(db, "metadata")
            if source_monsters_digest != batch_info.get("source_monsters_digest"):
                errors.append("source_monsters_digest_mismatch")
            if source_metadata_digest != batch_info.get("source_metadata_digest"):
                errors.append("source_metadata_digest_mismatch")

        # Source dataset identity remains SRD 5.2.1.
        metadata = {
            r[0]: r[1] for r in db.execute("SELECT key,value FROM metadata")
        }
        if "5.2.1" not in metadata.get("dataset_source", ""):
            errors.append("dataset_source_is_not_srd_5_2_1")
        if "srd-5.2.1" not in metadata.get("dataset_version", ""):
            errors.append("dataset_version_is_not_srd_5_2_1")

        wrong_registry_source = one(db, """
            SELECT COUNT(*) FROM phase7_monster_registry
            WHERE source!='srd-5.2.1'
        """)
        if wrong_registry_source:
            errors.append(f"wrong_registry_source={wrong_registry_source}")

        # Foundation is supplied only on the second, final pass.
        if foundation_passed is False:
            closure_status = "DATABASE_CLOSURE_VERIFY_PASS" if not errors else "DATABASE_CLOSURE_VERIFY_FAIL"
        else:
            closure_status = "FINAL_CLOSED_GREEN" if not errors else "FINAL_CLOSURE_FAIL"

        report = {
            "package": "PHASE7_FINAL_CLOSURE_VERIFY_V11",
            "createdAt": now_iso(),
            "readOnly": True,
            "foundationPassed": foundation_passed,
            "integrity": integrity,
            "foreignKeyErrors": len(fk_errors),
            "counts": counts,
            "engineCoverage": engine_coverage,
            "v10Dispositions": dispositions,
            "v10GapCounts": v10_gaps,
            "quarantineCounts": quarantine_counts,
            "quarantineCanonicalConflicts": quarantine_canonical_conflicts,
            "notApplicableCanonicalConflicts": na_conflicts,
            "structuredCanonicalConflicts": structured_conflicts,
            "jsonValuesChecked": json_checked,
            "malformedJson": malformed_json,
            "orphanRowsChecked": orphan_checked,
            "orphanRows": orphan_rows,
            "sourceMonstersDigest": source_monsters_digest,
            "sourceMetadataDigest": source_metadata_digest,
            "v10Batch": batch_info,
            "wrongRulesVersion": wrong_rules,
            "badProficiencyBonusDerivations": bad_pb,
            "cr0XpNull": cr0_xp_null,
            "cr0XpNonNull": cr0_xp_nonnull,
            "nonzeroCrXpNull": nonzero_xp_null,
            "errors": errors,
            "warnings": warnings,
            "closureStatus": closure_status,
            "next": (
                "PHASE8_MAY_BEGIN"
                if foundation_passed and not errors
                else "RUN_FOUNDATION_AND_FINAL_PASS"
                if not foundation_passed and not errors
                else "STOP_AND_REVIEW"
            ),
        }

        output.mkdir(parents=True, exist_ok=True)
        report_name = (
            "phase7_final_closure_v11_report.json"
            if foundation_passed
            else "phase7_database_closure_precheck_v11_report.json"
        )
        (output / report_name).write_text(
            json.dumps(report, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )

        summary_name = (
            "PHASE7_FINAL_CLOSURE_V11_SUMMARY.md"
            if foundation_passed
            else "PHASE7_DATABASE_CLOSURE_PRECHECK_V11_SUMMARY.md"
        )
        summary = f"""# Phase 7 — Final Closure Verify V11

- Mode: READ-ONLY
- Foundation passed: {foundation_passed}
- Integrity: {integrity}
- Foreign-key errors: {len(fk_errors)}
- Source monsters: {counts['source_monsters']}
- Registry: {counts['registry']}
- Engine profiles: {counts['engine_profiles']}
- Action profiles: {counts['action_profiles']}
- Active automation backlog: {counts['automation_backlog']}
- V10 resolution rows: {counts['v10_resolution_rows']}
- Quarantine rows: {counts['quarantine_rows']}
- JSON values checked: {json_checked}
- Malformed JSON values: {len(malformed_json)}
- Monster-linked rows checked for orphans: {orphan_checked}
- Orphan rows: {len(orphan_rows)}
- Errors: {len(errors)}

## V10 dispositions
- Structured: {dispositions.get('STRUCTURED_SOURCE', 0)}
- Not Applicable: {dispositions.get('NOT_APPLICABLE', 0)}
- Quarantined: {dispositions.get('QUARANTINED', 0)}

## Quarantine
- Alignment: {quarantine_counts.get('alignment', 0)}
- AoE Definitions: {quarantine_counts.get('aoe_definitions', 0)}
- Lair Actions: {quarantine_counts.get('lair_actions', 0)}
- CR 0 XP: {quarantine_counts.get('xp', 0)}

Quarantine remains explicit unknown/source-limited state; it is not treated as N/A.

**Closure Status: {closure_status}**
"""
        if foundation_passed and not errors:
            summary += "\n**PHASE 8 MAY NOW BEGIN.**\n"
        (output / summary_name).write_text(summary, encoding="utf-8")

        print("PHASE 7 FINAL CLOSURE VERIFY V11")
        print("READ_ONLY=YES")
        print(f"FOUNDATION_PASSED={'YES' if foundation_passed else 'NO'}")
        print(f"INTEGRITY={integrity}")
        print(f"FOREIGN_KEYS={len(fk_errors)}")
        print(f"SOURCE_MONSTERS={counts['source_monsters']}")
        print(f"REGISTRY={counts['registry']}")
        print(f"ENGINE_PROFILES={counts['engine_profiles']}")
        print(f"ACTION_PROFILES={counts['action_profiles']}")
        print(f"AUTOMATION_BACKLOG={counts['automation_backlog']}")
        print(f"V4_RESOLUTION_ROWS={counts['v4_resolution_rows']}")
        print(f"V6_RESOLUTION_ROWS={counts['v6_resolution_rows']}")
        print(f"V8_RESOLUTION_ROWS={counts['v8_resolution_rows']}")
        print(f"V10_RESOLUTION_ROWS={counts['v10_resolution_rows']}")
        print(f"QUARANTINE_ROWS={counts['quarantine_rows']}")
        print(f"STRUCTURED={dispositions.get('STRUCTURED_SOURCE', 0)}")
        print(f"NOT_APPLICABLE={dispositions.get('NOT_APPLICABLE', 0)}")
        print(f"QUARANTINED={dispositions.get('QUARANTINED', 0)}")
        print(f"QUARANTINE_ALIGNMENT={quarantine_counts.get('alignment', 0)}")
        print(f"QUARANTINE_AOE_DEFINITIONS={quarantine_counts.get('aoe_definitions', 0)}")
        print(f"QUARANTINE_LAIR_ACTIONS={quarantine_counts.get('lair_actions', 0)}")
        print(f"QUARANTINE_XP={quarantine_counts.get('xp', 0)}")
        print(f"JSON_VALUES_CHECKED={json_checked}")
        print(f"MALFORMED_JSON={len(malformed_json)}")
        print(f"ORPHAN_ROWS_CHECKED={orphan_checked}")
        print(f"ORPHAN_ROWS={len(orphan_rows)}")
        print(f"SOURCE_MONSTERS_DIGEST_MATCH={'YES' if batch and source_monsters_digest == batch_info.get('source_monsters_digest') else 'NO'}")
        print(f"SOURCE_METADATA_DIGEST_MATCH={'YES' if batch and source_metadata_digest == batch_info.get('source_metadata_digest') else 'NO'}")
        print(f"BAD_PB_DERIVATIONS={bad_pb}")
        print(f"WRONG_RULES_VERSION={wrong_rules}")
        print(f"CR0_XP_NULL={cr0_xp_null}")
        print(f"CR0_XP_NONNULL={cr0_xp_nonnull}")
        print(f"NONZERO_CR_XP_NULL={nonzero_xp_null}")
        print(f"ERRORS={len(errors)}")
        for error in errors:
            print("ERROR:", error)
        print(f"PHASE7_CLOSURE_STATUS={closure_status}")
        if foundation_passed and not errors:
            print("PHASE 8 MAY NOW BEGIN")
        print(f"OUTPUT={output}")

        return 0 if not errors else 1
    finally:
        db.close()

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--db", default=str(DEFAULT_DB))
    ap.add_argument("--output", default=str(DEFAULT_OUTPUT))
    ap.add_argument("--foundation-passed", action="store_true")
    args = ap.parse_args()

    db_path = Path(args.db)
    if not db_path.exists():
        raise RuntimeError(f"DB missing: {db_path}")

    return verify(
        db_path=db_path,
        output=Path(args.output),
        foundation_passed=bool(args.foundation_passed),
    )

if __name__ == "__main__":
    raise SystemExit(main())
