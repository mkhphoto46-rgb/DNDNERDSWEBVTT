from __future__ import annotations
import argparse, json, sqlite3
from pathlib import Path

ROOT=Path(r"F:\DND WEB VTT")
DEFAULT_DB=ROOT/"data"/"compendium"/"monsters.sqlite"
DEFAULT_OUTPUT=ROOT/"_phase7_structured_monster_baseline_v2_fixed"
EXPECTED=322

JSON_COLS={
"phase7_monster_engine_profiles":[
"speed_json","ability_scores_json","saving_throws_json","skills_json",
"damage_vulnerabilities_json","damage_resistances_json","damage_immunities_json",
"condition_immunities_json","senses_json","languages_json","traits_json",
"bonus_actions_json","reactions_json","legendary_actions_json","lair_actions_json",
"spellcasting_json","recharge_abilities_json","multiattack_json","attack_profiles_json",
"save_based_abilities_json","aoe_definitions_json","usage_limits_resources_json",
"source_evidence_json","automation_gaps_json"],
"phase7_monster_action_profiles":[
"damage_json","save_json","area_json","recharge_json","usage_json","raw_action_json"]
}

def main():
    ap=argparse.ArgumentParser()
    ap.add_argument("--db",default=str(DEFAULT_DB))
    ap.add_argument("--output",default=str(DEFAULT_OUTPUT))
    a=ap.parse_args()
    db=sqlite3.connect(a.db)
    errors=[]
    try:
        integrity=db.execute("PRAGMA integrity_check").fetchone()[0]
        fk=db.execute("PRAGMA foreign_key_check").fetchall()
        if integrity!="ok": errors.append(f"integrity={integrity}")
        if fk: errors.append(f"fk={len(fk)}")

        tables={r[0] for r in db.execute("SELECT name FROM sqlite_master WHERE type='table'")}
        req={"monsters","metadata","phase7_monster_registry","phase7_monster_engine_profiles",
             "phase7_monster_action_profiles","phase7_monster_automation_backlog","phase7_baseline_batches"}
        for t in sorted(req-tables): errors.append(f"missing_table={t}")

        counts={}
        for t in req:
            if t in tables: counts[t]=db.execute(f'SELECT COUNT(*) FROM "{t}"').fetchone()[0]

        for t in ("monsters","phase7_monster_registry","phase7_monster_engine_profiles"):
            if counts.get(t)!=EXPECTED: errors.append(f"{t}_count={counts.get(t)}")

        bad_links=db.execute("""
            SELECT COUNT(*) FROM phase7_monster_registry r
            LEFT JOIN monsters m ON m.id=r.monster_id
            WHERE m.id IS NULL OR m.name<>r.name
        """).fetchone()[0]
        if bad_links: errors.append(f"bad_source_links={bad_links}")

        orphan_profiles=db.execute("""
            SELECT COUNT(*) FROM phase7_monster_engine_profiles p
            LEFT JOIN phase7_monster_registry r ON r.monster_id=p.monster_id
            WHERE r.monster_id IS NULL
        """).fetchone()[0]
        orphan_actions=db.execute("""
            SELECT COUNT(*) FROM phase7_monster_action_profiles a
            LEFT JOIN phase7_monster_registry r ON r.monster_id=a.monster_id
            WHERE r.monster_id IS NULL
        """).fetchone()[0]
        orphan_backlog=db.execute("""
            SELECT COUNT(*) FROM phase7_monster_automation_backlog b
            LEFT JOIN phase7_monster_registry r ON r.monster_id=b.monster_id
            WHERE r.monster_id IS NULL
        """).fetchone()[0]
        if orphan_profiles: errors.append(f"orphan_profiles={orphan_profiles}")
        if orphan_actions: errors.append(f"orphan_actions={orphan_actions}")
        if orphan_backlog: errors.append(f"orphan_backlog={orphan_backlog}")

        malformed=0
        for table,cols in JSON_COLS.items():
            for col in cols:
                for (raw,) in db.execute(f'SELECT "{col}" FROM "{table}" WHERE "{col}" IS NOT NULL'):
                    try: json.loads(raw)
                    except Exception: malformed+=1
        if malformed: errors.append(f"malformed_json={malformed}")

        batch=db.execute("""
            SELECT source_monsters_digest_before,source_monsters_digest_after,
                   source_metadata_digest_before,source_metadata_digest_after,
                   registry_count,engine_profile_count,action_profile_count,
                   automation_backlog_count,narrative_action_count,
                   explicit_action_profile_count,malformed_source_json_count,phase_status
            FROM phase7_baseline_batches ORDER BY created_at DESC LIMIT 1
        """).fetchone()
        if not batch:
            errors.append("missing_batch")
        else:
            if batch[0]!=batch[1]: errors.append("source_monsters_changed")
            if batch[2]!=batch[3]: errors.append("source_metadata_changed")
            if batch[4]!=EXPECTED or batch[5]!=EXPECTED: errors.append("batch_symmetry_mismatch")
            if batch[11]!="STRUCTURED_MONSTER_BASELINE_READY_PHASE7_OPEN":
                errors.append(f"bad_status={batch[11]}")

        output=Path(a.output)
        for fn in ("phase7_structured_monster_baseline_v2_fixed_report.json",
                   "PHASE7_STRUCTURED_MONSTER_BASELINE_V2_FIXED_SUMMARY.md"):
            if not (output/fn).exists(): errors.append(f"missing_output={fn}")

        print(f"INTEGRITY={integrity}")
        print(f"FOREIGN_KEYS={'ok' if not fk else len(fk)}")
        print(f"SOURCE_MONSTERS={counts.get('monsters')}")
        print(f"REGISTRY={counts.get('phase7_monster_registry')}")
        print(f"ENGINE_PROFILES={counts.get('phase7_monster_engine_profiles')}")
        print(f"ACTION_PROFILES={counts.get('phase7_monster_action_profiles')}")
        print(f"AUTOMATION_BACKLOG={counts.get('phase7_monster_automation_backlog')}")
        print(f"BAD_SOURCE_LINKS={bad_links}")
        print(f"ORPHAN_PROFILES={orphan_profiles}")
        print(f"ORPHAN_ACTIONS={orphan_actions}")
        print(f"ORPHAN_BACKLOG={orphan_backlog}")
        print(f"MALFORMED_BASELINE_JSON={malformed}")
        if batch:
            print(f"NARRATIVE_ONLY_ACTIONS={batch[8]}")
            print(f"EXPLICIT_ACTION_PROFILES={batch[9]}")
            print(f"MALFORMED_SOURCE_JSON={batch[10]}")
        print(f"ERRORS={len(errors)}")
        for e in errors: print("ERROR:",e)
        if errors: return 1
        print("PHASE_STATUS=STRUCTURED_MONSTER_BASELINE_READY_PHASE7_OPEN")
        print("NEXT=PHASE7_EVIDENCE_BOUNDED_MONSTER_RULES_AND_ACTION_PARSING")
        print("OK: Independent V2 FIXED verification")
        return 0
    finally:
        db.close()

if __name__=="__main__":
    raise SystemExit(main())
