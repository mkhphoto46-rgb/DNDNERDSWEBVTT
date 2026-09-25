from __future__ import annotations

import argparse
import csv
import json
import re
import sqlite3
from collections import Counter, defaultdict
from datetime import datetime, timezone
from pathlib import Path

PROJECT_ROOT = Path(r"F:\DND WEB VTT")
DEFAULT_DB = PROJECT_ROOT / "data" / "compendium" / "monsters.sqlite"
DEFAULT_OUTPUT = PROJECT_ROOT / "_phase7_evidence_bounded_monster_rules_audit_v3"

EXPECTED_SOURCE_MONSTERS = 322
EXPECTED_REGISTRY = 322
EXPECTED_ENGINE_PROFILES = 322
EXPECTED_ACTION_PROFILES = 836
EXPECTED_BACKLOG = 4572

SPECIAL_KEYS = [
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
]

def now_iso():
    return datetime.now(timezone.utc).isoformat()

def nkey(value):
    return re.sub(r"[^a-z0-9]", "", str(value).lower())

def write_csv(path: Path, rows: list[dict]):
    if not rows:
        path.write_text("empty\n", encoding="utf-8-sig")
        return
    fields = []
    for row in rows:
        for key in row:
            if key not in fields:
                fields.append(key)
    with path.open("w", encoding="utf-8-sig", newline="") as f:
        w = csv.DictWriter(f, fieldnames=fields)
        w.writeheader()
        for row in rows:
            out = {}
            for key in fields:
                value = row.get(key, "")
                if isinstance(value, (list, dict)):
                    value = json.dumps(value, ensure_ascii=False, sort_keys=True)
                out[key] = value
            w.writerow(out)

def read_json(text):
    try:
        value = json.loads(text)
        return value
    except Exception:
        return None

def shape_of(value):
    if value is None:
        return "null"
    if isinstance(value, dict):
        keys = sorted(nkey(k) for k in value.keys())
        return "object:" + ",".join(keys)
    if isinstance(value, list):
        if not value:
            return "array:empty"
        kinds = sorted(set(type(x).__name__ for x in value))
        dict_keys = Counter()
        for item in value[:20]:
            if isinstance(item, dict):
                dict_keys.update(nkey(k) for k in item.keys())
        suffix = ""
        if dict_keys:
            suffix = ":keys=" + ",".join(sorted(dict_keys))
        return "array:" + ",".join(kinds) + suffix
    return type(value).__name__

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--db", default=str(DEFAULT_DB))
    ap.add_argument("--output", default=str(DEFAULT_OUTPUT))
    args = ap.parse_args()

    db_path = Path(args.db)
    output = Path(args.output)
    output.mkdir(parents=True, exist_ok=True)

    if not db_path.exists():
        raise RuntimeError(f"monsters.sqlite missing: {db_path}")

    db = sqlite3.connect(str(db_path))
    db.row_factory = sqlite3.Row
    try:
        integrity = db.execute("PRAGMA integrity_check").fetchone()[0]
        fk_errors = len(db.execute("PRAGMA foreign_key_check").fetchall())

        tables = {r[0] for r in db.execute(
            "SELECT name FROM sqlite_master WHERE type='table'"
        )}
        required_tables = {
            "monsters",
            "metadata",
            "phase7_monster_registry",
            "phase7_monster_engine_profiles",
            "phase7_monster_action_profiles",
            "phase7_monster_automation_backlog",
            "phase7_baseline_batches",
        }
        missing_tables = sorted(required_tables - tables)
        if missing_tables:
            raise RuntimeError("Missing V2 baseline tables: " + ", ".join(missing_tables))

        counts = {
            "source_monsters": db.execute("SELECT COUNT(*) FROM monsters").fetchone()[0],
            "registry": db.execute("SELECT COUNT(*) FROM phase7_monster_registry").fetchone()[0],
            "engine_profiles": db.execute("SELECT COUNT(*) FROM phase7_monster_engine_profiles").fetchone()[0],
            "action_profiles": db.execute("SELECT COUNT(*) FROM phase7_monster_action_profiles").fetchone()[0],
            "automation_backlog": db.execute("SELECT COUNT(*) FROM phase7_monster_automation_backlog").fetchone()[0],
        }

        expected = {
            "source_monsters": EXPECTED_SOURCE_MONSTERS,
            "registry": EXPECTED_REGISTRY,
            "engine_profiles": EXPECTED_ENGINE_PROFILES,
            "action_profiles": EXPECTED_ACTION_PROFILES,
            "automation_backlog": EXPECTED_BACKLOG,
        }

        state_errors = []
        if integrity != "ok":
            state_errors.append(f"integrity={integrity}")
        if fk_errors:
            state_errors.append(f"foreign_key_errors={fk_errors}")
        for key, value in expected.items():
            if counts[key] != value:
                state_errors.append(f"{key}: expected {value}, got {counts[key]}")

        batch = db.execute("""
            SELECT *
            FROM phase7_baseline_batches
            ORDER BY created_at DESC
            LIMIT 1
        """).fetchone()
        if not batch:
            state_errors.append("missing phase7 baseline batch")
            batch_info = {}
        else:
            batch_info = dict(batch)
            if batch_info.get("phase_status") != "STRUCTURED_MONSTER_BASELINE_READY_PHASE7_OPEN":
                state_errors.append(
                    f"unexpected phase status={batch_info.get('phase_status')}"
                )

        if state_errors:
            raise RuntimeError("V3 safety stop: " + " | ".join(state_errors))

        # 1) Backlog distribution.
        backlog_rows = [
            dict(r) for r in db.execute("""
                SELECT
                    b.gap_type,
                    COUNT(*) AS backlog_rows,
                    COUNT(DISTINCT b.monster_id) AS monsters_affected
                FROM phase7_monster_automation_backlog b
                GROUP BY b.gap_type
                ORDER BY backlog_rows DESC, b.gap_type
            """)
        ]
        write_csv(output / "backlog_by_gap_type.csv", backlog_rows)

        # 2) Monster-by-monster gap inventory.
        monster_gap_rows = []
        for r in db.execute("""
            SELECT
                r.monster_id,
                r.name,
                r.creature_type,
                r.cr_text,
                COUNT(b.gap_type) AS gap_count,
                GROUP_CONCAT(b.gap_type, '|') AS gap_types
            FROM phase7_monster_registry r
            LEFT JOIN phase7_monster_automation_backlog b
              ON b.monster_id = r.monster_id
            GROUP BY r.monster_id, r.name, r.creature_type, r.cr_text
            ORDER BY gap_count DESC, r.name
        """):
            item = dict(r)
            gaps = item.get("gap_types")
            item["gap_types"] = sorted(gaps.split("|")) if gaps else []
            monster_gap_rows.append(item)
        write_csv(output / "monster_gap_inventory.csv", monster_gap_rows)

        # 3) Action profile status distribution.
        action_status_rows = [
            dict(r) for r in db.execute("""
                SELECT
                    profile_status,
                    COUNT(*) AS action_count,
                    COUNT(DISTINCT monster_id) AS monsters_affected
                FROM phase7_monster_action_profiles
                GROUP BY profile_status
                ORDER BY action_count DESC
            """)
        ]
        write_csv(output / "action_profile_status_summary.csv", action_status_rows)

        # 4) Full narrative-only action set for evidence-bounded parser design.
        narrative_rows = []
        for r in db.execute("""
            SELECT
                a.monster_id,
                r.name AS monster_name,
                r.creature_type,
                r.cr_text,
                a.action_index,
                a.action_name,
                a.description,
                a.raw_action_json
            FROM phase7_monster_action_profiles a
            JOIN phase7_monster_registry r
              ON r.monster_id = a.monster_id
            WHERE a.profile_status = 'NARRATIVE_ONLY'
            ORDER BY r.name, a.action_index
        """):
            item = dict(r)
            raw = read_json(item["raw_action_json"])
            item["raw_action_shape"] = shape_of(raw)
            narrative_rows.append(item)
        write_csv(output / "narrative_only_actions.csv", narrative_rows)

        # 5) Full explicit action summary, but without duplicating full source text unnecessarily.
        explicit_rows = []
        for r in db.execute("""
            SELECT
                a.monster_id,
                r.name AS monster_name,
                r.creature_type,
                r.cr_text,
                a.action_index,
                a.action_name,
                a.attack_bonus,
                a.save_dc,
                CASE WHEN a.damage_json IS NOT NULL THEN 1 ELSE 0 END AS has_damage,
                CASE WHEN a.save_json IS NOT NULL THEN 1 ELSE 0 END AS has_save,
                CASE WHEN a.area_json IS NOT NULL THEN 1 ELSE 0 END AS has_area,
                CASE WHEN a.recharge_json IS NOT NULL THEN 1 ELSE 0 END AS has_recharge,
                CASE WHEN a.usage_json IS NOT NULL THEN 1 ELSE 0 END AS has_usage
            FROM phase7_monster_action_profiles a
            JOIN phase7_monster_registry r
              ON r.monster_id = a.monster_id
            WHERE a.profile_status = 'EXPLICIT_STRUCTURED_FIELDS'
            ORDER BY r.name, a.action_index
        """):
            explicit_rows.append(dict(r))
        write_csv(output / "explicit_action_profiles.csv", explicit_rows)

        # 6) Field coverage from engine profiles.
        profile_columns = [
            "alignment","hit_dice","speed_json","ability_scores_json","saving_throws_json",
            "skills_json","damage_vulnerabilities_json","damage_resistances_json",
            "damage_immunities_json","condition_immunities_json","senses_json",
            "passive_perception","languages_json","xp","proficiency_bonus","traits_json",
            "bonus_actions_json","reactions_json","legendary_actions_json","lair_actions_json",
            "spellcasting_json","recharge_abilities_json","multiattack_json",
            "attack_profiles_json","save_based_abilities_json","aoe_definitions_json",
            "usage_limits_resources_json","rules_version"
        ]
        field_coverage = []
        for col in profile_columns:
            present = db.execute(
                f'SELECT COUNT(*) FROM phase7_monster_engine_profiles WHERE "{col}" IS NOT NULL'
            ).fetchone()[0]
            field_coverage.append({
                "field": col,
                "present_monsters": present,
                "missing_monsters": EXPECTED_ENGINE_PROFILES - present,
                "coverage_percent": round(present * 100.0 / EXPECTED_ENGINE_PROFILES, 2),
            })
        write_csv(output / "engine_profile_field_coverage.csv", field_coverage)

        # 7) Raw source top-level key frequency and shapes.
        top_key_counts = Counter()
        normalized_key_examples = defaultdict(Counter)
        per_monster_shape_rows = []
        special_shapes = defaultdict(Counter)
        malformed = 0

        for r in db.execute("""
            SELECT id, name, stat_block_json
            FROM monsters
            ORDER BY name
        """):
            raw = read_json(r["stat_block_json"])
            if not isinstance(raw, dict):
                malformed += 1
                continue
            normalized_keys = sorted(nkey(k) for k in raw.keys())
            per_monster_shape_rows.append({
                "monster_id": r["id"],
                "monster_name": r["name"],
                "top_level_keys": normalized_keys,
                "top_level_key_count": len(normalized_keys),
            })
            for key, value in raw.items():
                nk = nkey(key)
                top_key_counts[nk] += 1
                normalized_key_examples[nk][str(key)] += 1
                if nk in {nkey(x) for x in SPECIAL_KEYS}:
                    special_shapes[nk][shape_of(value)] += 1

        source_key_rows = []
        for key, count in sorted(top_key_counts.items(), key=lambda kv: (-kv[1], kv[0])):
            source_key_rows.append({
                "normalized_key": key,
                "monster_count": count,
                "original_key_examples": dict(normalized_key_examples[key].most_common(10)),
            })
        write_csv(output / "source_top_level_key_frequency.csv", source_key_rows)
        write_csv(output / "source_statblock_key_inventory_by_monster.csv", per_monster_shape_rows)

        shape_rows = []
        for key, counter in sorted(special_shapes.items()):
            for shape, count in counter.most_common():
                shape_rows.append({
                    "normalized_key": key,
                    "shape": shape,
                    "monster_count": count,
                })
        write_csv(output / "special_section_shape_summary.csv", shape_rows)

        # 8) Backlog categories crossed with source-key evidence.
        source_presence = defaultdict(int)
        aliases = {
            "alignment": ["alignment"],
            "saving_throws": ["savingthrows","saves"],
            "xp": ["xp","experience"],
            "proficiency_bonus": ["proficiencybonus","pb"],
            "bonus_actions": ["bonusactions"],
            "reactions": ["reactions"],
            "legendary_actions": ["legendaryactions"],
            "lair_actions": ["lairactions"],
            "spellcasting": ["spellcasting","spells"],
            "recharge_abilities": ["rechargeabilities","recharge"],
            "multiattack": ["multiattack"],
            "attack_profiles": ["attackprofiles","attacks"],
            "save_based_abilities": ["savebasedabilities"],
            "aoe_definitions": ["aoedefinitions","aoe","areaofeffect"],
            "usage_limits_resources": ["usagelimitsresources","resources","uses"],
            "rules_version": ["rulesversion","version","edition"],
        }
        source_monsters = []
        for r in db.execute("SELECT id,name,stat_block_json FROM monsters ORDER BY id"):
            raw = read_json(r["stat_block_json"])
            if not isinstance(raw, dict):
                continue
            keys = {nkey(k) for k in raw.keys()}
            source_monsters.append((r["id"], r["name"], keys))

        evidence_rows = []
        for gap_type in [r["gap_type"] for r in backlog_rows]:
            alias_keys = set(aliases.get(gap_type, [nkey(gap_type)]))
            direct_source_count = sum(
                1 for _,_,keys in source_monsters
                if keys & alias_keys
            )
            backlog_count = next(r["backlog_rows"] for r in backlog_rows if r["gap_type"] == gap_type)
            evidence_rows.append({
                "gap_type": gap_type,
                "backlog_rows": backlog_count,
                "monsters_with_matching_top_level_source_key": direct_source_count,
                "direct_top_level_recovery_ceiling": min(backlog_count, direct_source_count),
                "parser_note": (
                    "Direct source-key evidence exists"
                    if direct_source_count
                    else "No matching top-level structured source key; narrative/section parsing would be required"
                )
            })
        write_csv(output / "backlog_source_evidence_matrix.csv", evidence_rows)

        # 9) Compact report.
        report = {
            "package": "PHASE7_EVIDENCE_BOUNDED_MONSTER_RULES_AUDIT_V3",
            "createdAt": now_iso(),
            "readOnly": True,
            "integrity": integrity,
            "foreignKeyErrors": fk_errors,
            "counts": counts,
            "baselineBatch": batch_info,
            "malformedSourceJson": malformed,
            "backlogTypes": len(backlog_rows),
            "narrativeOnlyActions": len(narrative_rows),
            "explicitActionProfiles": len(explicit_rows),
            "phaseStatus": "PHASE7_EVIDENCE_AUDIT_COMPLETE",
            "next": "DESIGN_BOUNDED_PARSERS_FROM_V3_EVIDENCE",
        }
        (output / "phase7_evidence_bounded_monster_rules_audit_v3_report.json").write_text(
            json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8"
        )

        top_gaps = backlog_rows[:10]
        summary_lines = [
            "# Phase 7 — Evidence-Bounded Monster Rules Audit V3",
            "",
            "**Mode:** READ-ONLY",
            "",
            f"- Source monsters: {counts['source_monsters']}",
            f"- Structured registry: {counts['registry']}",
            f"- Engine profiles: {counts['engine_profiles']}",
            f"- Action profiles: {counts['action_profiles']}",
            f"- Automation backlog: {counts['automation_backlog']}",
            f"- Narrative-only actions: {len(narrative_rows)}",
            f"- Explicit action profiles: {len(explicit_rows)}",
            f"- Malformed source JSON: {malformed}",
            f"- Integrity: {integrity}",
            f"- Foreign-key errors: {fk_errors}",
            "",
            "## Largest backlog categories",
        ]
        for item in top_gaps:
            summary_lines.append(
                f"- `{item['gap_type']}`: {item['backlog_rows']} monsters/rows"
            )
        summary_lines += [
            "",
            "**Status: PHASE7_EVIDENCE_AUDIT_COMPLETE**",
            "",
            "No database or project source file was modified.",
            "Next: design narrow parsers only for categories whose source shapes/evidence are strong enough.",
        ]
        (output / "PHASE7_EVIDENCE_BOUNDED_MONSTER_RULES_AUDIT_V3_SUMMARY.md").write_text(
            "\n".join(summary_lines) + "\n", encoding="utf-8"
        )

        print("PHASE 7 EVIDENCE-BOUNDED MONSTER RULES AUDIT V3 COMPLETE")
        print("READ_ONLY=YES")
        print(f"INTEGRITY={integrity}")
        print(f"FOREIGN_KEYS={fk_errors}")
        print(f"SOURCE_MONSTERS={counts['source_monsters']}")
        print(f"REGISTRY={counts['registry']}")
        print(f"ENGINE_PROFILES={counts['engine_profiles']}")
        print(f"ACTION_PROFILES={counts['action_profiles']}")
        print(f"AUTOMATION_BACKLOG={counts['automation_backlog']}")
        print(f"NARRATIVE_ONLY_ACTIONS={len(narrative_rows)}")
        print(f"EXPLICIT_ACTION_PROFILES={len(explicit_rows)}")
        print(f"BACKLOG_TYPES={len(backlog_rows)}")
        print(f"MALFORMED_SOURCE_JSON={malformed}")
        print("PHASE_STATUS=PHASE7_EVIDENCE_AUDIT_COMPLETE")
        print("NEXT=DESIGN_BOUNDED_PARSERS_FROM_V3_EVIDENCE")
        print(f"OUTPUT={output}")
        return 0
    finally:
        db.close()

if __name__ == "__main__":
    raise SystemExit(main())
