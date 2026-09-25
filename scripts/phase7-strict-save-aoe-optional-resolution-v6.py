from __future__ import annotations

import argparse
import json
import re
import sqlite3
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path

PROJECT_ROOT = Path(r"F:\DND WEB VTT")
DEFAULT_DB = PROJECT_ROOT / "data" / "compendium" / "monsters.sqlite"
DEFAULT_OUTPUT = PROJECT_ROOT / "_phase7_strict_save_aoe_optional_resolution_v6"

EXPECTED = {
    "source_monsters": 322,
    "registry": 322,
    "engine_profiles": 322,
    "action_profiles": 836,
    "automation_backlog": 4471,
    "v4_resolution_rows": 105,
}

EXPECTED_V6 = {
    "save_clauses": 202,
    "save_actions": 177,
    "save_monsters": 136,
    "save_actions_single_dc": 176,
    "aoe_definitions": 64,
    "aoe_actions": 52,
    "aoe_monsters": 52,
    "na_saving_throws": 231,
    "na_reactions": 311,
    "na_legendary_actions": 292,
    "na_multiattack": 185,
    "v6_resolution_rows": 1248,
    "backlog_removed": 1207,
    "backlog_after": 3264,
    "remaining_narrative_only_actions": 209,
}

SAVE_DC_RE = re.compile(
    r"\bDC\s+(\d{1,2})\s+"
    r"(Strength|Dexterity|Constitution|Intelligence|Wisdom|Charisma)\s+"
    r"saving\s+throw\b",
    re.IGNORECASE,
)

CONE_RE = re.compile(r"\b(\d+)-foot\s+cone\b", re.IGNORECASE)
LINE_RE = re.compile(
    r"\b(\d+)-foot\s+line\s+that\s+is\s+(\d+)\s+(?:feet|ft\.)\s+wide\b",
    re.IGNORECASE,
)
CYLINDER_RE = re.compile(
    r"\b(\d+)-foot-radius,\s*(\d+)-foot-tall\s+cylinder\b",
    re.IGNORECASE,
)

def now_iso():
    return datetime.now(timezone.utc).isoformat()

def cjson(v):
    return json.dumps(v, ensure_ascii=False, sort_keys=True, separators=(",", ":"))

def jload(text):
    if text is None:
        return None
    try:
        return json.loads(text)
    except Exception:
        return None

def normkey(v):
    return re.sub(r"[^a-z0-9]", "", str(v).lower())

def table_names(db):
    return {r[0] for r in db.execute(
        "SELECT name FROM sqlite_master WHERE type='table'"
    )}

def counts(db):
    return {
        "source_monsters": db.execute("SELECT COUNT(*) FROM monsters").fetchone()[0],
        "registry": db.execute("SELECT COUNT(*) FROM phase7_monster_registry").fetchone()[0],
        "engine_profiles": db.execute("SELECT COUNT(*) FROM phase7_monster_engine_profiles").fetchone()[0],
        "action_profiles": db.execute("SELECT COUNT(*) FROM phase7_monster_action_profiles").fetchone()[0],
        "automation_backlog": db.execute("SELECT COUNT(*) FROM phase7_monster_automation_backlog").fetchone()[0],
        "v4_resolution_rows": db.execute("SELECT COUNT(*) FROM phase7_v4_resolution_log").fetchone()[0],
    }

def source_key_present(stat, key):
    if not isinstance(stat, dict):
        return False
    target = normkey(key)
    return any(normkey(k) == target for k in stat.keys())

def extract_actions(stat):
    if not isinstance(stat, dict):
        return []
    value = None
    for k, v in stat.items():
        if normkey(k) == "actions":
            value = v
            break
    if isinstance(value, list):
        return value
    return []

def action_name(item):
    if isinstance(item, dict):
        for k in ("name", "title"):
            if isinstance(item.get(k), str):
                return item[k]
    return ""

def preconditions(db):
    integrity = db.execute("PRAGMA integrity_check").fetchone()[0]
    fk = db.execute("PRAGMA foreign_key_check").fetchall()
    if integrity != "ok":
        raise RuntimeError(f"integrity_check={integrity}")
    if fk:
        raise RuntimeError(f"foreign_key_errors={len(fk)}")

    required = {
        "monsters",
        "phase7_monster_registry",
        "phase7_monster_engine_profiles",
        "phase7_monster_action_profiles",
        "phase7_monster_automation_backlog",
        "phase7_v4_resolution_log",
        "phase7_v4_batches",
    }
    missing = sorted(required - table_names(db))
    if missing:
        raise RuntimeError("Missing required Phase 7 tables: " + ", ".join(missing))

    if "phase7_v6_resolution_log" in table_names(db):
        raise RuntimeError("V6 already appears applied.")

    actual = counts(db)
    for key, expected in EXPECTED.items():
        if actual[key] != expected:
            raise RuntimeError(f"State drift: {key} expected={expected} actual={actual[key]}")

    # V5/V3 source-contract guardrails.
    source_stats = {}
    for r in db.execute("SELECT id,stat_block_json FROM monsters"):
        stat = jload(r[1])
        if not isinstance(stat, dict):
            raise RuntimeError(f"Malformed source stat block: {r[0]}")
        source_stats[r[0]] = stat

    source_saves = {mid for mid, stat in source_stats.items() if source_key_present(stat, "saving_throws")}
    source_reactions = {mid for mid, stat in source_stats.items() if source_key_present(stat, "reactions")}
    source_legendary = {mid for mid, stat in source_stats.items() if source_key_present(stat, "legendary_actions")}
    source_multi = set()
    for mid, stat in source_stats.items():
        for item in extract_actions(stat):
            if normkey(action_name(item)) == "multiattack":
                source_multi.add(mid)
                break

    contract = {
        "saving_throws": (source_saves, 91, "saving_throws_json", 231),
        "reactions": (source_reactions, 11, "reactions_json", 311),
        "legendary_actions": (source_legendary, 30, "legendary_actions_json", 292),
        "multiattack": (source_multi, 137, "multiattack_json", 185),
    }

    for gap, (present_ids, present_count, profile_col, backlog_count) in contract.items():
        if len(present_ids) != present_count:
            raise RuntimeError(f"Source contract drift {gap}: expected present={present_count} actual={len(present_ids)}")
        profile_present = {
            r[0] for r in db.execute(
                f'SELECT monster_id FROM phase7_monster_engine_profiles WHERE "{profile_col}" IS NOT NULL'
            )
        }
        if profile_present != present_ids:
            missing_profile = sorted(present_ids - profile_present)[:5]
            extra_profile = sorted(profile_present - present_ids)[:5]
            raise RuntimeError(
                f"Profile/source partition mismatch for {gap}; "
                f"missing_profile={missing_profile} extra_profile={extra_profile}"
            )
        backlog_ids = {
            r[0] for r in db.execute(
                "SELECT monster_id FROM phase7_monster_automation_backlog WHERE gap_type=?",
                (gap,)
            )
        }
        expected_backlog_ids = set(source_stats) - present_ids
        if len(backlog_ids) != backlog_count or backlog_ids != expected_backlog_ids:
            raise RuntimeError(
                f"Backlog/source partition mismatch for {gap}: "
                f"expected={backlog_count} actual={len(backlog_ids)}"
            )

def parse_save_clauses(text):
    if not isinstance(text, str):
        return []
    result = []
    for m in SAVE_DC_RE.finditer(text):
        result.append({
            "dc": int(m.group(1)),
            "ability": m.group(2).lower(),
            "evidence": "STRICT_DC_ABILITY_SAVING_THROW_TEXT",
            "match_text": m.group(0),
        })
    return result

def parse_aoe(text):
    if not isinstance(text, str):
        return []
    result = []

    for m in CONE_RE.finditer(text):
        result.append({
            "shape": "CONE",
            "length_ft": int(m.group(1)),
            "evidence": "STRICT_COMPLETE_AOE_PHRASE",
            "match_text": m.group(0),
        })

    for m in LINE_RE.finditer(text):
        result.append({
            "shape": "LINE",
            "length_ft": int(m.group(1)),
            "width_ft": int(m.group(2)),
            "evidence": "STRICT_COMPLETE_AOE_PHRASE",
            "match_text": m.group(0),
        })

    for m in CYLINDER_RE.finditer(text):
        result.append({
            "shape": "CYLINDER",
            "radius_ft": int(m.group(1)),
            "height_ft": int(m.group(2)),
            "evidence": "STRICT_COMPLETE_AOE_PHRASE",
            "match_text": m.group(0),
        })

    # De-duplicate identical geometry. This intentionally ignores broad phrases such
    # as "1-foot cube" that can describe an affected object rather than an AoE.
    deduped = []
    seen = set()
    for entry in result:
        identity = tuple(
            (k, v) for k, v in entry.items()
            if k not in {"evidence", "match_text"}
        )
        if identity not in seen:
            seen.add(identity)
            deduped.append(entry)
    return deduped

def apply_v6(db, output):
    preconditions(db)

    db.executescript("""
    CREATE TABLE phase7_v6_resolution_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        monster_id TEXT NOT NULL,
        resolution_type TEXT NOT NULL,
        subject_key TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        evidence_rule TEXT NOT NULL,
        created_at TEXT NOT NULL,
        UNIQUE(monster_id,resolution_type,subject_key),
        FOREIGN KEY (monster_id) REFERENCES phase7_monster_registry(monster_id)
    );

    CREATE TABLE phase7_v6_batches (
        id TEXT PRIMARY KEY,
        created_at TEXT NOT NULL,
        save_clauses INTEGER NOT NULL,
        save_actions INTEGER NOT NULL,
        save_monsters INTEGER NOT NULL,
        aoe_definitions INTEGER NOT NULL,
        aoe_actions INTEGER NOT NULL,
        aoe_monsters INTEGER NOT NULL,
        na_saving_throws INTEGER NOT NULL,
        na_reactions INTEGER NOT NULL,
        na_legendary_actions INTEGER NOT NULL,
        na_multiattack INTEGER NOT NULL,
        backlog_removed INTEGER NOT NULL,
        backlog_after INTEGER NOT NULL,
        phase_status TEXT NOT NULL
    );
    """)

    actions = [
        dict(zip(
            [d[0] for d in cur.description],
            row
        ))
        for cur in [db.execute("""
            SELECT monster_id,action_index,action_name,description,
                   save_dc,save_json,area_json,profile_status
            FROM phase7_monster_action_profiles
            ORDER BY monster_id,action_index
        """)]
        for row in cur.fetchall()
    ]

    save_by_monster = defaultdict(list)
    aoe_by_monster = defaultdict(list)
    save_clause_count = 0
    save_action_count = 0
    save_single_dc_count = 0
    aoe_definition_count = 0
    aoe_action_count = 0
    narrative_promoted = 0

    for row in actions:
        mid = row["monster_id"]
        idx = row["action_index"]
        name = row["action_name"]
        desc = row["description"]

        saves = parse_save_clauses(desc)
        aoes = parse_aoe(desc)

        if saves:
            if row["save_json"] is not None:
                raise RuntimeError(f"V6 refuses to overwrite existing save_json: {mid} action={idx}")

            save_clause_count += len(saves)
            save_action_count += 1
            unique_dcs = sorted({s["dc"] for s in saves})

            db.execute("""
                UPDATE phase7_monster_action_profiles
                SET save_json=?,
                    save_dc=CASE WHEN ?=1 THEN ? ELSE save_dc END
                WHERE monster_id=? AND action_index=?
            """, (
                cjson(saves),
                len(unique_dcs),
                unique_dcs[0] if len(unique_dcs) == 1 else None,
                mid, idx
            ))

            if len(unique_dcs) == 1:
                save_single_dc_count += 1

            payload = {
                "action_index": idx,
                "action_name": name,
                "clauses": saves,
            }
            save_by_monster[mid].append(payload)
            db.execute("""
                INSERT INTO phase7_v6_resolution_log
                (monster_id,resolution_type,subject_key,payload_json,evidence_rule,created_at)
                VALUES (?,?,?,?,?,?)
            """, (
                mid, "STRICT_SAVE_ACTION", f"action:{idx}",
                cjson(payload), "STRICT_DC_ABILITY_SAVING_THROW_TEXT", now_iso()
            ))

        if aoes:
            if row["area_json"] is not None:
                raise RuntimeError(f"V6 refuses to overwrite existing area_json: {mid} action={idx}")

            aoe_definition_count += len(aoes)
            aoe_action_count += 1
            db.execute("""
                UPDATE phase7_monster_action_profiles
                SET area_json=?
                WHERE monster_id=? AND action_index=?
            """, (cjson(aoes), mid, idx))

            payload = {
                "action_index": idx,
                "action_name": name,
                "geometries": aoes,
            }
            aoe_by_monster[mid].append(payload)
            db.execute("""
                INSERT INTO phase7_v6_resolution_log
                (monster_id,resolution_type,subject_key,payload_json,evidence_rule,created_at)
                VALUES (?,?,?,?,?,?)
            """, (
                mid, "STRICT_AOE_ACTION", f"action:{idx}",
                cjson(payload), "STRICT_COMPLETE_AOE_PHRASE", now_iso()
            ))

        if (saves or aoes) and row["profile_status"] == "NARRATIVE_ONLY":
            db.execute("""
                UPDATE phase7_monster_action_profiles
                SET profile_status='V6_STRICT_SAVE_AOE'
                WHERE monster_id=? AND action_index=?
            """, (mid, idx))
            narrative_promoted += 1

    observed = {
        "save_clauses": save_clause_count,
        "save_actions": save_action_count,
        "save_monsters": len(save_by_monster),
        "save_actions_single_dc": save_single_dc_count,
        "aoe_definitions": aoe_definition_count,
        "aoe_actions": aoe_action_count,
        "aoe_monsters": len(aoe_by_monster),
    }
    for key in (
        "save_clauses","save_actions","save_monsters","save_actions_single_dc",
        "aoe_definitions","aoe_actions","aoe_monsters"
    ):
        if observed[key] != EXPECTED_V6[key]:
            raise RuntimeError(f"V6 evidence drift {key}: expected={EXPECTED_V6[key]} actual={observed[key]}")

    if narrative_promoted != 60:
        raise RuntimeError(f"V6 narrative promotion drift: expected=60 actual={narrative_promoted}")

    # Populate engine-level canonical arrays for monsters with direct action evidence.
    for mid, entries in save_by_monster.items():
        current = db.execute("""
            SELECT save_based_abilities_json
            FROM phase7_monster_engine_profiles
            WHERE monster_id=?
        """, (mid,)).fetchone()[0]
        if current is not None:
            raise RuntimeError(f"V6 refuses to overwrite save_based_abilities_json: {mid}")
        db.execute("""
            UPDATE phase7_monster_engine_profiles
            SET save_based_abilities_json=?
            WHERE monster_id=?
        """, (cjson(entries), mid))

    for mid, entries in aoe_by_monster.items():
        current = db.execute("""
            SELECT aoe_definitions_json
            FROM phase7_monster_engine_profiles
            WHERE monster_id=?
        """, (mid,)).fetchone()[0]
        if current is not None:
            raise RuntimeError(f"V6 refuses to overwrite aoe_definitions_json: {mid}")
        db.execute("""
            UPDATE phase7_monster_engine_profiles
            SET aoe_definitions_json=?
            WHERE monster_id=?
        """, (cjson(entries), mid))

    removed = 0

    # Resolved by positive action evidence.
    for mid in save_by_monster:
        cur = db.execute("""
            DELETE FROM phase7_monster_automation_backlog
            WHERE monster_id=? AND gap_type='save_based_abilities'
        """, (mid,))
        removed += cur.rowcount

    for mid in aoe_by_monster:
        cur = db.execute("""
            DELETE FROM phase7_monster_automation_backlog
            WHERE monster_id=? AND gap_type='aoe_definitions'
        """, (mid,))
        removed += cur.rowcount

    # Optional absence semantics: only families with a proven complete source partition.
    optional_specs = {
        "saving_throws": ("saving_throws", "saving_throws_json", EXPECTED_V6["na_saving_throws"]),
        "reactions": ("reactions", "reactions_json", EXPECTED_V6["na_reactions"]),
        "legendary_actions": ("legendary_actions", "legendary_actions_json", EXPECTED_V6["na_legendary_actions"]),
    }

    source_stats = {}
    for r in db.execute("SELECT id,stat_block_json FROM monsters"):
        source_stats[r[0]] = jload(r[1])

    na_counts = {}
    for gap, (source_key, profile_col, expected_na) in optional_specs.items():
        absent_ids = [
            mid for mid, stat in source_stats.items()
            if not source_key_present(stat, source_key)
        ]
        if len(absent_ids) != expected_na:
            raise RuntimeError(f"V6 N/A drift {gap}: expected={expected_na} actual={len(absent_ids)}")

        count = 0
        for mid in absent_ids:
            if db.execute(
                f'SELECT "{profile_col}" FROM phase7_monster_engine_profiles WHERE monster_id=?',
                (mid,)
            ).fetchone()[0] is not None:
                raise RuntimeError(f"Cannot mark {gap} N/A; profile has value for {mid}")

            payload = {
                "gap_type": gap,
                "semantic": "NOT_APPLICABLE",
                "reason": f"SOURCE_SCHEMA_OPTIONAL_KEY_ABSENT:{source_key}",
            }
            db.execute("""
                INSERT INTO phase7_v6_resolution_log
                (monster_id,resolution_type,subject_key,payload_json,evidence_rule,created_at)
                VALUES (?,?,?,?,?,?)
            """, (
                mid, "NOT_APPLICABLE", gap, cjson(payload),
                "COMPLETE_SOURCE_SCHEMA_PARTITION", now_iso()
            ))
            cur = db.execute("""
                DELETE FROM phase7_monster_automation_backlog
                WHERE monster_id=? AND gap_type=?
            """, (mid, gap))
            if cur.rowcount != 1:
                raise RuntimeError(f"Expected one {gap} backlog row for {mid}, got {cur.rowcount}")
            removed += 1
            count += 1
        na_counts[gap] = count

    # Multiattack is represented inside the complete source action list, not as a top-level key.
    multi_present = set()
    for mid, stat in source_stats.items():
        if any(normkey(action_name(item)) == "multiattack" for item in extract_actions(stat)):
            multi_present.add(mid)
    multi_absent = sorted(set(source_stats) - multi_present)
    if len(multi_present) != 137 or len(multi_absent) != EXPECTED_V6["na_multiattack"]:
        raise RuntimeError(
            f"V6 multiattack partition drift: present={len(multi_present)} absent={len(multi_absent)}"
        )

    multi_na = 0
    for mid in multi_absent:
        current = db.execute("""
            SELECT multiattack_json
            FROM phase7_monster_engine_profiles
            WHERE monster_id=?
        """, (mid,)).fetchone()[0]
        if current is not None:
            raise RuntimeError(f"Cannot mark multiattack N/A; profile has value for {mid}")

        payload = {
            "gap_type": "multiattack",
            "semantic": "NOT_APPLICABLE",
            "reason": "COMPLETE_SOURCE_ACTION_LIST_HAS_NO_MULTIATTACK_ACTION",
        }
        db.execute("""
            INSERT INTO phase7_v6_resolution_log
            (monster_id,resolution_type,subject_key,payload_json,evidence_rule,created_at)
            VALUES (?,?,?,?,?,?)
        """, (
            mid, "NOT_APPLICABLE", "multiattack", cjson(payload),
            "COMPLETE_SOURCE_ACTION_LIST_PARTITION", now_iso()
        ))
        cur = db.execute("""
            DELETE FROM phase7_monster_automation_backlog
            WHERE monster_id=? AND gap_type='multiattack'
        """, (mid,))
        if cur.rowcount != 1:
            raise RuntimeError(f"Expected one multiattack backlog row for {mid}, got {cur.rowcount}")
        removed += 1
        multi_na += 1

    na_counts["multiattack"] = multi_na

    if removed != EXPECTED_V6["backlog_removed"]:
        raise RuntimeError(
            f"V6 backlog removal mismatch: expected={EXPECTED_V6['backlog_removed']} actual={removed}"
        )

    backlog_after = db.execute(
        "SELECT COUNT(*) FROM phase7_monster_automation_backlog"
    ).fetchone()[0]
    if backlog_after != EXPECTED_V6["backlog_after"]:
        raise RuntimeError(
            f"V6 backlog after mismatch: expected={EXPECTED_V6['backlog_after']} actual={backlog_after}"
        )

    remaining_narrative = db.execute("""
        SELECT COUNT(*) FROM phase7_monster_action_profiles
        WHERE profile_status='NARRATIVE_ONLY'
    """).fetchone()[0]
    if remaining_narrative != EXPECTED_V6["remaining_narrative_only_actions"]:
        raise RuntimeError(
            f"V6 narrative-only count mismatch: "
            f"expected={EXPECTED_V6['remaining_narrative_only_actions']} actual={remaining_narrative}"
        )

    resolution_rows = db.execute("SELECT COUNT(*) FROM phase7_v6_resolution_log").fetchone()[0]
    if resolution_rows != EXPECTED_V6["v6_resolution_rows"]:
        raise RuntimeError(
            f"V6 resolution row mismatch: expected={EXPECTED_V6['v6_resolution_rows']} actual={resolution_rows}"
        )

    batch_id = "phase7-v6-" + datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    db.execute("""
        INSERT INTO phase7_v6_batches
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    """, (
        batch_id, now_iso(),
        save_clause_count, save_action_count, len(save_by_monster),
        aoe_definition_count, aoe_action_count, len(aoe_by_monster),
        na_counts["saving_throws"], na_counts["reactions"],
        na_counts["legendary_actions"], na_counts["multiattack"],
        removed, backlog_after,
        "STRICT_SAVE_AOE_OPTIONAL_RESOLUTION_APPLIED_PHASE7_OPEN"
    ))

    fk = db.execute("PRAGMA foreign_key_check").fetchall()
    if fk:
        raise RuntimeError(f"V6 introduced FK errors: {len(fk)}")

    output.mkdir(parents=True, exist_ok=True)
    report = {
        "package": "PHASE7_STRICT_SAVE_AOE_OPTIONAL_RESOLUTION_V6",
        "saveClauses": save_clause_count,
        "saveActions": save_action_count,
        "saveMonsters": len(save_by_monster),
        "saveActionsSingleDc": save_single_dc_count,
        "aoeDefinitions": aoe_definition_count,
        "aoeActions": aoe_action_count,
        "aoeMonsters": len(aoe_by_monster),
        "notApplicable": na_counts,
        "backlogRemoved": removed,
        "backlogAfter": backlog_after,
        "remainingNarrativeOnlyActions": remaining_narrative,
        "phaseStatus": "STRICT_SAVE_AOE_OPTIONAL_RESOLUTION_APPLIED_PHASE7_OPEN",
        "next": "PHASE7_SPELLCASTING_RECHARGE_USAGE_AND_RULE_DERIVATION_AUDIT",
    }
    (output / "phase7_strict_save_aoe_optional_resolution_v6_report.json").write_text(
        json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8"
    )

    (output / "PHASE7_STRICT_SAVE_AOE_OPTIONAL_RESOLUTION_V6_SUMMARY.md").write_text(
        f"""# Phase 7 — Strict Save/AoE/Optional Resolution V6

- Save clauses recovered: {save_clause_count}
- Save-bearing actions: {save_action_count}
- Monsters with save-based abilities: {len(save_by_monster)}
- Single-DC save actions: {save_single_dc_count}
- Complete AoE geometries recovered: {aoe_definition_count}
- AoE-bearing actions: {aoe_action_count}
- Monsters with complete AoE evidence: {len(aoe_by_monster)}
- Saving Throws marked N/A from complete source-key partition: {na_counts['saving_throws']}
- Reactions marked N/A from complete source-key partition: {na_counts['reactions']}
- Legendary Actions marked N/A from complete source-key partition: {na_counts['legendary_actions']}
- Multiattack marked N/A from complete source-action partition: {na_counts['multiattack']}
- Backlog rows removed: {removed}
- Backlog remaining: {backlog_after}
- Narrative-only actions remaining: {remaining_narrative}

Important semantic guardrail:
`monster saving throw proficiency` and `target saving throw required by an action`
remain separate concepts.

AoE guardrail:
Only complete Cone, Line-with-width, and Radius+Height Cylinder phrases were accepted.
Object-size phrases such as Rust Monster's `1-foot cube` are intentionally not AoE.

Status: STRICT_SAVE_AOE_OPTIONAL_RESOLUTION_APPLIED_PHASE7_OPEN
""",
        encoding="utf-8",
    )
    return report

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--db", default=str(DEFAULT_DB))
    ap.add_argument("--output", default=str(DEFAULT_OUTPUT))
    ap.add_argument("--apply", action="store_true")
    args = ap.parse_args()

    db = sqlite3.connect(args.db, timeout=10)
    db.execute("PRAGMA foreign_keys=ON")
    try:
        preconditions(db)
        if not args.apply:
            print("V6_PRECHECK=PASS")
            return 0

        db.execute("BEGIN IMMEDIATE")
        try:
            report = apply_v6(db, Path(args.output))
            db.commit()
        except Exception:
            db.rollback()
            raise

        integrity = db.execute("PRAGMA integrity_check").fetchone()[0]
        fk = db.execute("PRAGMA foreign_key_check").fetchall()
        if integrity != "ok" or fk:
            raise RuntimeError(f"Post-V6 DB check failed: integrity={integrity} fk={len(fk)}")

        print("PHASE 7 STRICT SAVE/AOE/OPTIONAL RESOLUTION V6 APPLIED")
        print(f"SAVE_CLAUSES={report['saveClauses']}")
        print(f"SAVE_ACTIONS={report['saveActions']}")
        print(f"SAVE_MONSTERS={report['saveMonsters']}")
        print(f"SAVE_ACTIONS_SINGLE_DC={report['saveActionsSingleDc']}")
        print(f"AOE_DEFINITIONS={report['aoeDefinitions']}")
        print(f"AOE_ACTIONS={report['aoeActions']}")
        print(f"AOE_MONSTERS={report['aoeMonsters']}")
        print(f"NA_SAVING_THROWS={report['notApplicable']['saving_throws']}")
        print(f"NA_REACTIONS={report['notApplicable']['reactions']}")
        print(f"NA_LEGENDARY_ACTIONS={report['notApplicable']['legendary_actions']}")
        print(f"NA_MULTIATTACK={report['notApplicable']['multiattack']}")
        print(f"BACKLOG_REMOVED={report['backlogRemoved']}")
        print(f"AUTOMATION_BACKLOG={report['backlogAfter']}")
        print(f"NARRATIVE_ONLY_ACTIONS={report['remainingNarrativeOnlyActions']}")
        print("INTEGRITY=ok")
        print("FOREIGN_KEYS=ok")
        print("PHASE_STATUS=STRICT_SAVE_AOE_OPTIONAL_RESOLUTION_APPLIED_PHASE7_OPEN")
        print("NEXT=PHASE7_SPELLCASTING_RECHARGE_USAGE_AND_RULE_DERIVATION_AUDIT")
        print(f"OUTPUT={args.output}")
        return 0
    finally:
        db.close()

if __name__ == "__main__":
    raise SystemExit(main())
