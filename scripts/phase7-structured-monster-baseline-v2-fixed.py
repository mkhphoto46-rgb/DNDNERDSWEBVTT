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
DEFAULT_OUTPUT = PROJECT_ROOT / "_phase7_structured_monster_baseline_v2_fixed"
DEFAULT_EXPECTED_SHA = "f13b2be4c17031f514146b20f48556147fd0704941f945bdfd3bedce64dd44a6"

EXPECTED_MONSTERS = 322
EXPECTED_METADATA = 4
SOURCE_COLUMNS = [
    "id","name","name_lower","size","type","cr","cr_numeric","armor_class",
    "hp_max","hp_formula","initiative_modifier","source","attribution",
    "search_text","stat_block_json"
]

GAP_FIELDS = (
    "alignment","saving_throws","xp","proficiency_bonus","bonus_actions",
    "reactions","legendary_actions","lair_actions","spellcasting",
    "recharge_abilities","multiattack","attack_profiles",
    "save_based_abilities","aoe_definitions","usage_limits_resources",
    "rules_version"
)

def now_iso():
    return datetime.now(timezone.utc).isoformat()

def sha256_file(path: Path):
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()

def cjson(v):
    return json.dumps(v, ensure_ascii=False, sort_keys=True, separators=(",", ":"), default=str)

def logical_digest(db, table, order_by):
    cols = [r[1] for r in db.execute(f'PRAGMA table_info("{table}")')]
    rows = db.execute(f'SELECT * FROM "{table}" ORDER BY {order_by}').fetchall()
    return hashlib.sha256(cjson({"columns": cols, "rows": [list(r) for r in rows]}).encode("utf-8")).hexdigest()

def norm_key(k):
    return re.sub(r"[^a-z0-9]", "", str(k).lower())

def nget(obj, *names):
    if not isinstance(obj, dict):
        return None
    idx = {norm_key(k): k for k in obj.keys()}
    for name in names:
        hit = idx.get(norm_key(name))
        if hit is not None:
            return obj[hit]
    return None

def json_or_null(v):
    return None if v is None else cjson(v)

def number(v):
    if isinstance(v, bool) or v is None:
        return None
    if isinstance(v, (int, float)):
        return v
    if isinstance(v, str):
        t = v.strip()
        if re.fullmatch(r"-?\d+(?:\.\d+)?", t):
            return float(t) if "." in t else int(t)
    return None

def scalar(v):
    return v if isinstance(v, (str, int, float, bool)) else None

def hit_dice(v):
    if not isinstance(v, str):
        return None
    t = re.sub(r"\s+", "", v.strip())
    return t if re.fullmatch(r"\d+d\d+(?:[+-]\d+)?", t, re.I) else None

def explicit_year(*values):
    years = []
    for v in values:
        if isinstance(v, str):
            years.extend(re.findall(r"\b(2014|2024)\b", v))
    years = sorted(set(years))
    return years[0] if len(years) == 1 else None

def normalized_actions(v):
    result = []
    if isinstance(v, list):
        for i, x in enumerate(v):
            if isinstance(x, dict):
                name = nget(x, "name", "title")
                result.append((i, str(name).strip() if name is not None else f"Action {i+1}", x))
            elif isinstance(x, str):
                result.append((i, f"Action {i+1}", {"description": x}))
    elif isinstance(v, dict):
        for i, (name, x) in enumerate(v.items()):
            if isinstance(x, dict):
                d = dict(x)
                if nget(d, "name", "title") is None:
                    d["name"] = name
                result.append((i, str(name), d))
            else:
                result.append((i, str(name), {"description": x}))
    return result

def create_schema(db):
    # Deliberately no FK from phase7_monster_registry to legacy monsters.
    # Source linkage is independently verified by monster_id + name + source JSON hash.
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
        batch_id TEXT NOT NULL
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
        physical_source_sha256 TEXT NOT NULL,
        source_monster_count INTEGER NOT NULL,
        source_metadata_count INTEGER NOT NULL,
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
        malformed_source_json_count INTEGER NOT NULL,
        phase_status TEXT NOT NULL
    );
    """)

def preconditions(db, db_path, expected_sha):
    if sha256_file(db_path).lower() != expected_sha.lower():
        raise RuntimeError(
            "Physical source SHA mismatch. A fresh diagnostic/audit is required. "
            f"expected={expected_sha.lower()} actual={sha256_file(db_path).lower()}"
        )
    if db.execute("PRAGMA integrity_check").fetchone()[0] != "ok":
        raise RuntimeError("SQLite integrity_check failed.")
    fk = db.execute("PRAGMA foreign_key_check").fetchall()
    if fk:
        raise RuntimeError(f"Existing database has {len(fk)} foreign-key errors.")

    tables = {r[0] for r in db.execute("SELECT name FROM sqlite_master WHERE type='table'")}
    for t in ("monsters", "metadata"):
        if t not in tables:
            raise RuntimeError(f"Missing source table: {t}")
    phase7 = sorted(t for t in tables if t.startswith("phase7_"))
    if phase7:
        raise RuntimeError("Phase 7 tables already exist: " + ", ".join(phase7))

    cols = [r[1] for r in db.execute('PRAGMA table_info("monsters")')]
    if cols != SOURCE_COLUMNS:
        raise RuntimeError(f"Source monsters schema mismatch. actual={cols}")

    mc = db.execute("SELECT COUNT(*) FROM monsters").fetchone()[0]
    md = db.execute("SELECT COUNT(*) FROM metadata").fetchone()[0]
    if mc != EXPECTED_MONSTERS:
        raise RuntimeError(f"Expected {EXPECTED_MONSTERS} monsters, got {mc}")
    if md != EXPECTED_METADATA:
        raise RuntimeError(f"Expected {EXPECTED_METADATA} metadata rows, got {md}")

    null_ids = db.execute("SELECT COUNT(*) FROM monsters WHERE id IS NULL OR trim(id)=''").fetchone()[0]
    dup_ids = db.execute("SELECT COUNT(*) FROM (SELECT id FROM monsters GROUP BY id HAVING COUNT(*)>1)").fetchone()[0]
    if null_ids or dup_ids:
        raise RuntimeError(f"Unsafe source IDs: null/empty={null_ids}, duplicate_groups={dup_ids}")

def action_profile(a):
    attack_bonus = number(nget(a, "attack_bonus", "attackbonus", "to_hit", "tohit"))
    save_dc = number(nget(a, "save_dc", "savedc", "dc"))
    damage = nget(a, "damage", "damage_roll", "damageroll")
    save = nget(a, "save", "saving_throw", "savingthrow")
    area = nget(a, "area", "aoe", "area_of_effect", "areaofeffect")
    recharge = nget(a, "recharge")
    uses = nget(a, "uses", "usage", "per_day", "perday")
    status = "EXPLICIT_STRUCTURED_FIELDS" if any(
        v is not None for v in (attack_bonus, save_dc, damage, save, area, recharge, uses)
    ) else "NARRATIVE_ONLY"
    return attack_bonus, save_dc, damage, save, area, recharge, uses, status

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--db", default=str(DEFAULT_DB))
    ap.add_argument("--output", default=str(DEFAULT_OUTPUT))
    ap.add_argument("--expected-source-sha", default=DEFAULT_EXPECTED_SHA)
    ap.add_argument("--apply", action="store_true")
    args = ap.parse_args()

    db_path = Path(args.db)
    output = Path(args.output)
    if not db_path.exists():
        raise RuntimeError(f"DB missing: {db_path}")

    db = sqlite3.connect(db_path)
    db.row_factory = sqlite3.Row
    db.execute("PRAGMA foreign_keys=ON")
    try:
        preconditions(db, db_path, args.expected_source_sha)
        if not args.apply:
            print("V2_FIXED_PRECHECK=PASS")
            return 0

        output.mkdir(parents=True, exist_ok=True)
        physical_sha = sha256_file(db_path)
        before_monsters = logical_digest(db, "monsters", "id")
        before_metadata = logical_digest(db, "metadata", "key")
        batch = "phase7-v2-fixed-" + datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")

        action_count = explicit_count = narrative_count = backlog_count = malformed_count = 0

        db.execute("BEGIN IMMEDIATE")
        try:
            create_schema(db)

            for row in db.execute("SELECT * FROM monsters ORDER BY id").fetchall():
                raw = row["stat_block_json"] or "{}"
                try:
                    stat = json.loads(raw)
                    if not isinstance(stat, dict):
                        raise ValueError("root not object")
                    malformed = False
                except Exception:
                    stat = {}
                    malformed = True
                    malformed_count += 1

                mid = str(row["id"])
                stat_hash = hashlib.sha256(raw.encode("utf-8", errors="replace")).hexdigest()
                db.execute("""
                    INSERT INTO phase7_monster_registry
                    (monster_id,name,name_lower,size,creature_type,cr_text,cr_numeric,armor_class,
                     hp_max,hp_formula,initiative_modifier,source,attribution,source_stat_block_sha256,
                     baseline_status,batch_id)
                    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
                """, (
                    mid,row["name"],row["name_lower"],row["size"],row["type"],row["cr"],
                    row["cr_numeric"],row["armor_class"],row["hp_max"],row["hp_formula"],
                    row["initiative_modifier"],row["source"],row["attribution"],stat_hash,
                    "SOURCE_JSON_MALFORMED" if malformed else "BASELINE_IMPORTED_EXPLICIT_ONLY",batch
                ))

                speed = nget(stat, "speed")
                abilities = nget(stat, "ability_scores", "abilityscores", "abilities")
                if abilities is None:
                    amap = {}
                    for k in ("str","dex","con","int","wis","cha"):
                        v = nget(stat, k)
                        if v is not None: amap[k] = v
                    abilities = amap or None

                values = {
                    "alignment": scalar(nget(stat,"alignment")),
                    "saving_throws": nget(stat,"saving_throws","savingthrows","saves"),
                    "xp": number(nget(stat,"xp","experience")),
                    "proficiency_bonus": number(nget(stat,"proficiency_bonus","proficiencybonus","pb")),
                    "bonus_actions": nget(stat,"bonus_actions","bonusactions"),
                    "reactions": nget(stat,"reactions"),
                    "legendary_actions": nget(stat,"legendary_actions","legendaryactions"),
                    "lair_actions": nget(stat,"lair_actions","lairactions"),
                    "spellcasting": nget(stat,"spellcasting","spells"),
                    "recharge_abilities": nget(stat,"recharge_abilities","rechargeabilities"),
                    "multiattack": nget(stat,"multiattack"),
                    "attack_profiles": nget(stat,"attack_profiles","attackprofiles","attacks"),
                    "save_based_abilities": nget(stat,"save_based_abilities","savebasedabilities"),
                    "aoe_definitions": nget(stat,"aoe_definitions","aoedefinitions","aoe","area_of_effect"),
                    "usage_limits_resources": nget(stat,"usage_limits_resources","usagelimitsresources","resources","uses"),
                    "rules_version": scalar(nget(stat,"rules_version","rulesversion","version","edition")),
                }
                if values["rules_version"] is None:
                    values["rules_version"] = explicit_year(row["source"], row["attribution"])

                actions = normalized_actions(nget(stat,"actions"))
                derived_attacks=[]; derived_saves=[]; derived_aoe=[]; derived_uses=[]; derived_recharge=[]

                for idx, name, a in actions:
                    attack_bonus, save_dc, damage, save, area, recharge, uses, status = action_profile(a)
                    desc = nget(a,"description","desc")
                    db.execute("""
                        INSERT INTO phase7_monster_action_profiles
                        (monster_id,action_index,action_name,description,attack_bonus,save_dc,
                         damage_json,save_json,area_json,recharge_json,usage_json,profile_status,
                         raw_action_json,batch_id)
                        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)
                    """, (
                        mid,idx,name,str(desc) if isinstance(desc,(str,int,float)) else None,
                        attack_bonus,save_dc,json_or_null(damage),json_or_null(save),json_or_null(area),
                        json_or_null(recharge),json_or_null(uses),status,cjson(a),batch
                    ))
                    action_count += 1
                    if status == "EXPLICIT_STRUCTURED_FIELDS":
                        explicit_count += 1
                        derived_attacks.append({"action_index":idx,"action_name":name,"attack_bonus":attack_bonus,"save_dc":save_dc,"damage":damage})
                    else:
                        narrative_count += 1
                    if save_dc is not None or save is not None:
                        derived_saves.append({"action_index":idx,"action_name":name,"save_dc":save_dc,"save":save})
                    if area is not None:
                        derived_aoe.append({"action_index":idx,"action_name":name,"area":area})
                    if uses is not None:
                        derived_uses.append({"action_index":idx,"action_name":name,"uses":uses})
                    if recharge is not None:
                        derived_recharge.append({"action_index":idx,"action_name":name,"recharge":recharge})
                    if values["multiattack"] is None and name.strip().lower() == "multiattack":
                        values["multiattack"] = a

                if values["attack_profiles"] is None and derived_attacks:
                    values["attack_profiles"] = derived_attacks
                if values["save_based_abilities"] is None and derived_saves:
                    values["save_based_abilities"] = derived_saves
                if values["aoe_definitions"] is None and derived_aoe:
                    values["aoe_definitions"] = derived_aoe
                if values["usage_limits_resources"] is None and derived_uses:
                    values["usage_limits_resources"] = derived_uses
                if values["recharge_abilities"] is None and derived_recharge:
                    values["recharge_abilities"] = derived_recharge

                gaps = (["malformed_stat_block_json"] if malformed else []) + [
                    g for g in GAP_FIELDS if values[g] is None
                ]

                evidence = {
                    "source_table":"monsters","source_monster_id":mid,
                    "source_stat_block_sha256":stat_hash,
                    "policy":"explicit structured fields only; no narrative inference"
                }

                db.execute("""
                    INSERT INTO phase7_monster_engine_profiles
                    (monster_id,alignment,hit_dice,speed_json,ability_scores_json,saving_throws_json,
                     skills_json,damage_vulnerabilities_json,damage_resistances_json,damage_immunities_json,
                     condition_immunities_json,senses_json,passive_perception,languages_json,xp,
                     proficiency_bonus,traits_json,bonus_actions_json,reactions_json,legendary_actions_json,
                     lair_actions_json,spellcasting_json,recharge_abilities_json,multiattack_json,
                     attack_profiles_json,save_based_abilities_json,aoe_definitions_json,
                     usage_limits_resources_json,rules_version,source_evidence_json,automation_status,
                     automation_gaps_json,batch_id)
                    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
                """, (
                    mid,values["alignment"],hit_dice(row["hp_formula"]),json_or_null(speed),
                    json_or_null(abilities),json_or_null(values["saving_throws"]),
                    json_or_null(nget(stat,"skills")),
                    json_or_null(nget(stat,"damage_vulnerabilities","damagevulnerabilities","vulnerabilities")),
                    json_or_null(nget(stat,"damage_resistances","damageresistances","resistances")),
                    json_or_null(nget(stat,"damage_immunities","damageimmunities","immunities")),
                    json_or_null(nget(stat,"condition_immunities","conditionimmunities")),
                    json_or_null(nget(stat,"senses")),number(nget(stat,"passive_perception","passiveperception")),
                    json_or_null(nget(stat,"languages")),values["xp"],values["proficiency_bonus"],
                    json_or_null(nget(stat,"traits","special_abilities","specialabilities")),
                    json_or_null(values["bonus_actions"]),json_or_null(values["reactions"]),
                    json_or_null(values["legendary_actions"]),json_or_null(values["lair_actions"]),
                    json_or_null(values["spellcasting"]),json_or_null(values["recharge_abilities"]),
                    json_or_null(values["multiattack"]),json_or_null(values["attack_profiles"]),
                    json_or_null(values["save_based_abilities"]),json_or_null(values["aoe_definitions"]),
                    json_or_null(values["usage_limits_resources"]),
                    str(values["rules_version"]) if values["rules_version"] is not None else None,
                    cjson(evidence),"STRUCTURED_BASELINE_COMPLETE" if not gaps else "STRUCTURED_BASELINE_WITH_GAPS",
                    cjson(gaps),batch
                ))

                for gap in gaps:
                    db.execute("""
                        INSERT INTO phase7_monster_automation_backlog
                        (monster_id,gap_type,status,evidence_note,batch_id)
                        VALUES (?,?,?,?,?)
                    """, (
                        mid,gap,"OPEN",
                        "Missing as explicit structured source data; no narrative inference performed.",batch
                    ))
                    backlog_count += 1

            after_monsters = logical_digest(db,"monsters","id")
            after_metadata = logical_digest(db,"metadata","key")
            if before_monsters != after_monsters:
                raise RuntimeError("Safety failure: source monsters table changed.")
            if before_metadata != after_metadata:
                raise RuntimeError("Safety failure: source metadata table changed.")

            rc = db.execute("SELECT COUNT(*) FROM phase7_monster_registry").fetchone()[0]
            pc = db.execute("SELECT COUNT(*) FROM phase7_monster_engine_profiles").fetchone()[0]
            if rc != EXPECTED_MONSTERS or pc != EXPECTED_MONSTERS:
                raise RuntimeError(f"Symmetry failure registry={rc} profiles={pc}")

            db.execute("""
                INSERT INTO phase7_baseline_batches
                (id,created_at,physical_source_sha256,source_monster_count,source_metadata_count,
                 source_monsters_digest_before,source_monsters_digest_after,
                 source_metadata_digest_before,source_metadata_digest_after,
                 registry_count,engine_profile_count,action_profile_count,automation_backlog_count,
                 narrative_action_count,explicit_action_profile_count,malformed_source_json_count,phase_status)
                VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
            """, (
                batch,now_iso(),physical_sha,EXPECTED_MONSTERS,EXPECTED_METADATA,
                before_monsters,after_monsters,before_metadata,after_metadata,rc,pc,action_count,
                backlog_count,narrative_count,explicit_count,malformed_count,
                "STRUCTURED_MONSTER_BASELINE_READY_PHASE7_OPEN"
            ))

            fk = db.execute("PRAGMA foreign_key_check").fetchall()
            if fk:
                raise RuntimeError(f"Post-migration FK errors={len(fk)}")
            db.commit()
        except Exception:
            db.rollback()
            raise

        if db.execute("PRAGMA integrity_check").fetchone()[0] != "ok":
            raise RuntimeError("Post-migration integrity_check failed.")

        report = {
            "package":"PHASE7_STRUCTURED_MONSTER_BASELINE_V2_FIXED",
            "sourceMonsters":EXPECTED_MONSTERS,"registry":rc,"engineProfiles":pc,
            "actionProfiles":action_count,"explicitActionProfiles":explicit_count,
            "narrativeOnlyActions":narrative_count,"automationBacklog":backlog_count,
            "malformedSourceJson":malformed_count,
            "sourceMonstersUnchanged":before_monsters==after_monsters,
            "sourceMetadataUnchanged":before_metadata==after_metadata,
            "integrity":"ok","foreignKeys":"ok",
            "phaseStatus":"STRUCTURED_MONSTER_BASELINE_READY_PHASE7_OPEN",
            "next":"PHASE7_EVIDENCE_BOUNDED_MONSTER_RULES_AND_ACTION_PARSING"
        }
        (output/"phase7_structured_monster_baseline_v2_fixed_report.json").write_text(
            json.dumps(report,ensure_ascii=False,indent=2),encoding="utf-8"
        )
        (output/"PHASE7_STRUCTURED_MONSTER_BASELINE_V2_FIXED_SUMMARY.md").write_text(
            f"""# Phase 7 Structured Monster Baseline V2 FIXED

- Source Monsters: {EXPECTED_MONSTERS}
- Structured Registry: {rc}
- Engine Profiles: {pc}
- Action Profiles: {action_count}
- Explicit Action Profiles: {explicit_count}
- Narrative-only Actions: {narrative_count}
- Automation Backlog: {backlog_count}
- Malformed Source JSON: {malformed_count}
- Source Monsters table unchanged: YES
- Source Metadata table unchanged: YES
- Integrity: ok
- Foreign Keys: ok

**Status: STRUCTURED_MONSTER_BASELINE_READY_PHASE7_OPEN**

The legacy source tables were not modified. Mechanics were not inferred from narrative prose.
""", encoding="utf-8"
        )

        print("PHASE 7 STRUCTURED MONSTER BASELINE V2 FIXED APPLIED")
        print(f"SOURCE_MONSTERS={EXPECTED_MONSTERS}")
        print(f"REGISTRY={rc}")
        print(f"ENGINE_PROFILES={pc}")
        print(f"ACTION_PROFILES={action_count}")
        print(f"EXPLICIT_ACTION_PROFILES={explicit_count}")
        print(f"NARRATIVE_ONLY_ACTIONS={narrative_count}")
        print(f"AUTOMATION_BACKLOG={backlog_count}")
        print(f"MALFORMED_SOURCE_JSON={malformed_count}")
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
