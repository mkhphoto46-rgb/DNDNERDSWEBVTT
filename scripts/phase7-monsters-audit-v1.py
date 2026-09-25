from __future__ import annotations
import argparse
import csv
import hashlib
import json
import os
import re
import sqlite3
from pathlib import Path
from datetime import datetime, timezone

PROJECT_ROOT = Path(r"F:\DND WEB VTT")
RULES_DB = PROJECT_ROOT / "data" / "compendium" / "rules_knowledge.sqlite"
MONSTERS_DB = PROJECT_ROOT / "data" / "compendium" / "monsters.sqlite"
OUTPUT_ROOT = PROJECT_ROOT / "_phase7_monsters_audit_v1"

REQUIRED_FIELDS = {
    "name": ["name", "monster_name", "creature_name", "title"],
    "size": ["size"],
    "creature_type": ["creature_type", "type", "monster_type"],
    "alignment": ["alignment"],
    "ac": ["ac", "armor_class", "armorclass"],
    "hp": ["hp", "hit_points", "hitpoints", "max_hp"],
    "hit_dice": ["hit_dice", "hitdice"],
    "speed": ["speed", "movement", "walk_speed"],
    "ability_scores": ["strength", "str", "dexterity", "dex", "constitution", "con", "intelligence", "int", "wisdom", "wis", "charisma", "cha", "abilities", "ability_scores"],
    "saving_throws": ["saving_throws", "saves", "save_proficiencies"],
    "skills": ["skills"],
    "vulnerabilities": ["vulnerabilities", "damage_vulnerabilities"],
    "resistances": ["resistances", "damage_resistances"],
    "immunities": ["immunities", "damage_immunities"],
    "condition_immunities": ["condition_immunities"],
    "senses": ["senses"],
    "passive_perception": ["passive_perception", "passiveperception"],
    "languages": ["languages"],
    "cr": ["cr", "challenge_rating", "challenge"],
    "xp": ["xp", "experience"],
    "proficiency_bonus": ["proficiency_bonus", "pb"],
    "traits": ["traits", "special_abilities", "special_traits"],
    "actions": ["actions"],
    "bonus_actions": ["bonus_actions", "bonusactions"],
    "reactions": ["reactions"],
    "legendary_actions": ["legendary_actions", "legendaryactions"],
    "lair_actions": ["lair_actions", "lairactions"],
    "spellcasting": ["spellcasting", "spells"],
    "recharge_abilities": ["recharge", "recharge_abilities"],
    "multiattack": ["multiattack"],
    "attack_profiles": ["attack_profiles", "attacks", "attack"],
    "save_based_abilities": ["save_dc", "saving_throw", "save_based"],
    "aoe_definitions": ["aoe", "area", "area_of_effect"],
    "usage_limits_resources": ["uses", "usage", "resources", "charges", "per_day", "per_rest"],
    "provenance": ["source", "source_title", "source_book", "book", "page", "source_page"],
    "rules_version": ["rules_version", "version", "edition", "year"],
}

KEYWORDS = [
    "monster", "creature", "stat block", "statblock",
    "legendary action", "lair action", "multiattack",
    "monster template", "attack profile"
]

def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()

def sha256(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()

def safe_count(db: sqlite3.Connection, table: str) -> int:
    try:
        return int(db.execute(f'SELECT COUNT(*) FROM "{table}"').fetchone()[0])
    except Exception:
        return -1

def get_tables(db: sqlite3.Connection):
    rows = db.execute("""
        SELECT name, sql
        FROM sqlite_master
        WHERE type='table' AND name NOT LIKE 'sqlite_%'
        ORDER BY name
    """).fetchall()
    result = []
    for name, sql in rows:
        cols = db.execute(f'PRAGMA table_info("{name}")').fetchall()
        result.append({
            "table": name,
            "count": safe_count(db, name),
            "columns": [c[1] for c in cols],
            "sql": sql or "",
        })
    return result

def flatten_json_keys(value, prefix="", out=None, depth=0):
    if out is None:
        out = set()
    if depth > 5:
        return out
    if isinstance(value, dict):
        for k, v in value.items():
            key = str(k).strip().lower()
            out.add(key)
            flatten_json_keys(v, f"{prefix}.{key}" if prefix else key, out, depth+1)
    elif isinstance(value, list):
        for item in value[:10]:
            flatten_json_keys(item, prefix, out, depth+1)
    return out

def detect_json_keys(db: sqlite3.Connection, table: str, columns: list[str]) -> set[str]:
    jsonish = [
        c for c in columns
        if any(x in c.lower() for x in ("json", "payload", "data", "stat_block", "statblock", "profile", "details", "content"))
    ]
    keys = set()
    for col in jsonish[:8]:
        try:
            rows = db.execute(
                f'SELECT "{col}" FROM "{table}" WHERE "{col}" IS NOT NULL LIMIT 20'
            ).fetchall()
        except Exception:
            continue
        for (raw,) in rows:
            if not isinstance(raw, str):
                continue
            raw = raw.strip()
            if not raw or raw[0] not in "[{":
                continue
            try:
                obj = json.loads(raw)
            except Exception:
                continue
            flatten_json_keys(obj, out=keys)
    return keys

def candidate_score(table: dict) -> int:
    text = " ".join([table["table"]] + table["columns"]).lower()
    score = 0
    for term in ("monster", "creature", "statblock", "stat_block"):
        if term in text:
            score += 4
    for term in ("ac", "hp", "challenge", "cr", "actions", "traits", "senses"):
        if term in text:
            score += 1
    return score

def inspect_sqlite(path: Path, label: str):
    result = {
        "label": label,
        "path": str(path),
        "exists": path.exists(),
        "sha256": None,
        "integrity": None,
        "foreign_key_errors": None,
        "tables": [],
        "monster_candidates": [],
    }
    if not path.exists():
        return result

    result["sha256"] = sha256(path)
    db = sqlite3.connect(path)
    try:
        result["integrity"] = db.execute("PRAGMA integrity_check").fetchone()[0]
        result["foreign_key_errors"] = len(db.execute("PRAGMA foreign_key_check").fetchall())
        tables = get_tables(db)
        result["tables"] = tables
        candidates = []
        for t in tables:
            score = candidate_score(t)
            if score <= 0:
                continue
            keys = detect_json_keys(db, t["table"], t["columns"])
            candidates.append({
                "table": t["table"],
                "count": t["count"],
                "columns": t["columns"],
                "json_keys": sorted(keys),
                "candidate_score": score,
            })
        result["monster_candidates"] = sorted(
            candidates, key=lambda x: (-x["candidate_score"], x["table"])
        )
    finally:
        db.close()
    return result

def detect_phase6_closed(rules_info):
    if not rules_info.get("exists"):
        return {"status": "UNKNOWN", "evidence": "rules_knowledge.sqlite missing"}
    db = sqlite3.connect(Path(rules_info["path"]))
    try:
        tables = [r[0] for r in db.execute(
            "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'"
        )]
        hits = []
        for t in tables:
            if "phase6" not in t.lower():
                continue
            cols = [r[1] for r in db.execute(f'PRAGMA table_info("{t}")')]
            status_cols = [c for c in cols if "status" in c.lower() or "closure" in c.lower()]
            if not status_cols:
                continue
            for c in status_cols:
                try:
                    rows = db.execute(
                        f'SELECT "{c}" FROM "{t}" WHERE "{c}" IS NOT NULL ORDER BY rowid DESC LIMIT 10'
                    ).fetchall()
                except Exception:
                    continue
                for (v,) in rows:
                    if isinstance(v, str) and "FINAL_CLOSED_GREEN" in v:
                        hits.append({"table": t, "column": c, "value": v})
        return {
            "status": "CONFIRMED" if hits else "NOT_CONFIRMED",
            "evidence": hits[:20]
        }
    finally:
        db.close()

def scan_project_files(project_root: Path):
    inventory = []
    mentions = []
    candidates = []

    explicit = [
        project_root / "server" / "compendium.ts",
        project_root / "server" / "rulebooks.ts",
        project_root / "package.json",
    ]
    for p in explicit:
        if p.exists() and p.is_file():
            candidates.append(p)

    scripts_dir = project_root / "scripts"
    if scripts_dir.exists():
        for p in scripts_dir.iterdir():
            if p.is_file() and any(k in p.name.lower() for k in ("monster", "compendium", "creature")):
                candidates.append(p)

    for base in [project_root / "server", project_root / "src"]:
        if base.exists():
            for p in base.rglob("*"):
                if p.is_file() and any(k in p.name.lower() for k in ("monster", "compendium", "creature")):
                    candidates.append(p)

    seen = set()
    for p in candidates:
        key = str(p).lower()
        if key in seen:
            continue
        seen.add(key)
        try:
            size = p.stat().st_size
            record = {
                "path": str(p),
                "size_bytes": size,
                "sha256": sha256(p) if size <= 50_000_000 else "",
            }
            inventory.append(record)
            if size <= 2_000_000:
                try:
                    text = p.read_text(encoding="utf-8", errors="ignore")
                except Exception:
                    text = ""
                low = text.lower()
                hit_counts = {kw: low.count(kw) for kw in KEYWORDS if low.count(kw)}
                if hit_counts:
                    mentions.append({
                        "path": str(p),
                        "keyword_counts": hit_counts,
                    })
        except Exception:
            continue
    return inventory, mentions

def build_gap_matrix(monster_info):
    schema_keys = set()
    nested_keys = set()
    for c in monster_info.get("monster_candidates", []):
        schema_keys.update(x.lower() for x in c["columns"])
        nested_keys.update(x.lower() for x in c.get("json_keys", []))

    rows = []
    for field, synonyms in REQUIRED_FIELDS.items():
        direct = sorted({s for s in synonyms if s.lower() in schema_keys})
        nested = sorted({s for s in synonyms if s.lower() in nested_keys})
        if direct:
            status = "PRESENT_COLUMN"
            evidence = ", ".join(direct)
        elif nested:
            status = "PRESENT_NESTED_JSON"
            evidence = ", ".join(nested)
        else:
            status = "NOT_SEEN_IN_SCHEMA"
            evidence = ""
        rows.append({
            "required_field": field,
            "status": status,
            "evidence": evidence,
        })
    return rows

def write_csv(path: Path, rows: list[dict]):
    if not rows:
        path.write_text("empty\n", encoding="utf-8-sig")
        return
    fields = []
    for r in rows:
        for k in r:
            if k not in fields:
                fields.append(k)
    with path.open("w", encoding="utf-8-sig", newline="") as f:
        w = csv.DictWriter(f, fieldnames=fields)
        w.writeheader()
        for r in rows:
            out = {}
            for k in fields:
                v = r.get(k, "")
                if isinstance(v, (dict, list)):
                    v = json.dumps(v, ensure_ascii=False)
                out[k] = v
            w.writerow(out)

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--project-root", default=str(PROJECT_ROOT))
    ap.add_argument("--output", default=str(OUTPUT_ROOT))
    args = ap.parse_args()

    project_root = Path(args.project_root)
    output = Path(args.output)

    if not project_root.exists():
        raise RuntimeError(f"Project root not found: {project_root}")

    output.mkdir(parents=True, exist_ok=True)

    rules_db = project_root / "data" / "compendium" / "rules_knowledge.sqlite"
    monsters_db = project_root / "data" / "compendium" / "monsters.sqlite"

    rules_info = inspect_sqlite(rules_db, "rules_knowledge")
    monsters_info = inspect_sqlite(monsters_db, "monsters")
    phase6 = detect_phase6_closed(rules_info)
    file_inventory, mentions = scan_project_files(project_root)
    gaps = build_gap_matrix(monsters_info)

    all_tables = []
    for info in (rules_info, monsters_info):
        for t in info.get("tables", []):
            all_tables.append({
                "database": info["label"],
                "table": t["table"],
                "row_count": t["count"],
                "columns": t["columns"],
            })

    candidates = []
    for info in (rules_info, monsters_info):
        for c in info.get("monster_candidates", []):
            candidates.append({
                "database": info["label"],
                "table": c["table"],
                "row_count": c["count"],
                "candidate_score": c["candidate_score"],
                "columns": c["columns"],
                "json_keys": c["json_keys"],
            })

    present = sum(1 for r in gaps if r["status"] != "NOT_SEEN_IN_SCHEMA")
    missing = len(gaps) - present

    blockers = []
    if phase6["status"] != "CONFIRMED":
        blockers.append("Phase 6 FINAL_CLOSED_GREEN was not independently confirmed in rules_knowledge.sqlite.")
    if not monsters_info["exists"]:
        blockers.append("monsters.sqlite is missing.")
    elif monsters_info["integrity"] != "ok":
        blockers.append("monsters.sqlite integrity_check is not ok.")
    elif monsters_info["foreign_key_errors"]:
        blockers.append(f"monsters.sqlite has {monsters_info['foreign_key_errors']} foreign-key errors.")
    if not monsters_info.get("monster_candidates"):
        blockers.append("No monster/creature/statblock table candidates were detected in monsters.sqlite.")

    report = {
        "auditVersion": "PHASE7_MONSTERS_AUDIT_V1",
        "createdAt": now_iso(),
        "projectRoot": str(project_root),
        "readOnly": True,
        "phase6Closure": phase6,
        "rulesKnowledge": {
            "exists": rules_info["exists"],
            "path": rules_info["path"],
            "sha256": rules_info["sha256"],
            "integrity": rules_info["integrity"],
            "foreignKeyErrors": rules_info["foreign_key_errors"],
            "tableCount": len(rules_info["tables"]),
        },
        "monstersDatabase": {
            "exists": monsters_info["exists"],
            "path": monsters_info["path"],
            "sha256": monsters_info["sha256"],
            "integrity": monsters_info["integrity"],
            "foreignKeyErrors": monsters_info["foreign_key_errors"],
            "tableCount": len(monsters_info["tables"]),
            "candidateTableCount": len(monsters_info["monster_candidates"]),
        },
        "monsterFieldCoverage": {
            "requiredFields": len(gaps),
            "presentOrNested": present,
            "notSeen": missing,
        },
        "sourceFilesDetected": len(file_inventory),
        "sourceFilesWithMonsterMentions": len(mentions),
        "blockers": blockers,
        "phaseStatus": "PHASE7_AUDIT_COMPLETE_READ_ONLY",
        "next": "REVIEW_AUDIT_AND_DEFINE_PHASE7_STRUCTURED_MONSTER_BASELINE",
    }

    (output / "phase7_monsters_audit_report.json").write_text(
        json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    write_csv(output / "sqlite_table_inventory.csv", all_tables)
    write_csv(output / "monster_table_candidates.csv", candidates)
    write_csv(output / "monster_field_gap_matrix.csv", gaps)
    write_csv(output / "project_source_file_inventory.csv", file_inventory)
    write_csv(output / "project_monster_mentions.csv", mentions)

    summary = f"""# Phase 7 — Monsters Audit V1

**Mode:** READ-ONLY  
**Project root:** `{project_root}`

## Phase 6 prerequisite
- Closure confirmation: **{phase6['status']}**

## Local databases
- `rules_knowledge.sqlite`: exists={rules_info['exists']}, integrity={rules_info['integrity']}, FK errors={rules_info['foreign_key_errors']}
- `monsters.sqlite`: exists={monsters_info['exists']}, integrity={monsters_info['integrity']}, FK errors={monsters_info['foreign_key_errors']}

## Monster schema discovery
- Candidate monster tables: **{len(monsters_info.get('monster_candidates', []))}**
- Required Phase 7 field families checked: **{len(gaps)}**
- Present as columns/nested JSON: **{present}**
- Not seen in detected schema: **{missing}**

## Project code discovery
- Relevant source files detected: **{len(file_inventory)}**
- Files containing monster/statblock keywords: **{len(mentions)}**

## Blockers
{os.linesep.join('- ' + b for b in blockers) if blockers else '- None detected by V1 audit.'}

## Important
This audit does **not** modify any database, source file, or project state.

**Status: PHASE7_AUDIT_COMPLETE_READ_ONLY**

Next step: use this evidence to define the structured Monster Template baseline and the exact migration/validation scope.
"""
    (output / "PHASE7_MONSTERS_AUDIT_V1_SUMMARY.md").write_text(summary, encoding="utf-8")

    print("PHASE 7 MONSTERS AUDIT V1 COMPLETE")
    print("READ_ONLY=YES")
    print(f"PHASE6_CLOSURE={phase6['status']}")
    print(f"RULES_DB_EXISTS={rules_info['exists']}")
    print(f"RULES_DB_INTEGRITY={rules_info['integrity']}")
    print(f"RULES_DB_FOREIGN_KEYS={rules_info['foreign_key_errors']}")
    print(f"MONSTERS_DB_EXISTS={monsters_info['exists']}")
    print(f"MONSTERS_DB_INTEGRITY={monsters_info['integrity']}")
    print(f"MONSTERS_DB_FOREIGN_KEYS={monsters_info['foreign_key_errors']}")
    print(f"MONSTER_CANDIDATE_TABLES={len(monsters_info.get('monster_candidates', []))}")
    print(f"MONSTER_REQUIRED_FIELD_FAMILIES={len(gaps)}")
    print(f"MONSTER_FIELD_FAMILIES_PRESENT={present}")
    print(f"MONSTER_FIELD_FAMILIES_NOT_SEEN={missing}")
    print(f"RELEVANT_SOURCE_FILES={len(file_inventory)}")
    print(f"SOURCE_FILES_WITH_MONSTER_MENTIONS={len(mentions)}")
    print(f"BLOCKERS={len(blockers)}")
    print("PHASE_STATUS=PHASE7_AUDIT_COMPLETE_READ_ONLY")
    print("NEXT=REVIEW_AUDIT_AND_DEFINE_PHASE7_STRUCTURED_MONSTER_BASELINE")
    print(f"OUTPUT={output}")
    return 0

if __name__ == "__main__":
    raise SystemExit(main())
