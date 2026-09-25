from __future__ import annotations

import argparse
import json
import re
import shutil
import sqlite3
from datetime import datetime, timezone
from pathlib import Path

PROJECT_ROOT = Path(r"F:\DND WEB VTT")
DEFAULT_DB = PROJECT_ROOT / "data" / "compendium" / "monsters.sqlite"
DEFAULT_OUTPUT = PROJECT_ROOT / "_phase7_strict_action_semantics_v4"

EXPECTED = {
    "source_monsters": 322,
    "registry": 322,
    "engine_profiles": 322,
    "action_profiles": 836,
    "automation_backlog": 4572,
}

EXPECTED_RECOVERY = {
    "recharge_actions": 72,
    "recharge_monsters": 71,
    "usage_actions": 24,
    "usage_monsters": 22,
    "strict_attack_actions": 9,
    "strict_attack_monsters": 8,
    "backlog_removed": 101,
    "backlog_after": 4471,
}

RECHARGE_ROLL_RE = re.compile(
    r"\(Recharge\s+([1-6])(?:\s*[-–]\s*([1-6]))?\)\s*$",
    re.IGNORECASE,
)
RECHARGE_REST_RE = re.compile(
    r"\(Recharges?\s+after\s+a\s+(Short|Long)(?:\s+or\s+(Long|Short))?\s+Rest\)\s*$",
    re.IGNORECASE,
)
USAGE_DAY_RE = re.compile(
    r"\(([1-9]\d*)\s*/\s*Day\)\s*$",
    re.IGNORECASE,
)
STRICT_ATTACK_RE = re.compile(
    r"^(Melee|Ranged)\s+Weapon\s+Attack:\s*"
    r"([+-]\d+)\s+to\s+hit,\s*"
    r"(reach|range)\s+(\d+)(?:/(\d+))?\s*ft\.,\s*"
    r"([^\.]+)\.\s*"
    r"Hit:\s*(\d+)"
    r"(?:\s*\(([^)]+)\))?\s+"
    r"([A-Za-z]+)\s+damage\.\s*$",
    re.IGNORECASE,
)

def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()

def cjson(v) -> str:
    return json.dumps(v, ensure_ascii=False, sort_keys=True, separators=(",", ":"))

def parse_json(text):
    if text is None:
        return None
    try:
        return json.loads(text)
    except Exception:
        return None

def backup_database(source: Path, destination: Path):
    destination.parent.mkdir(parents=True, exist_ok=True)
    src = sqlite3.connect(str(source), timeout=10)
    dst = sqlite3.connect(str(destination))
    try:
        src.backup(dst)
    finally:
        dst.close()
        src.close()

def copy_database_online(source: Path, destination: Path):
    if destination.exists():
        destination.unlink()
    backup_database(source, destination)

def counts(db):
    return {
        "source_monsters": db.execute("SELECT COUNT(*) FROM monsters").fetchone()[0],
        "registry": db.execute("SELECT COUNT(*) FROM phase7_monster_registry").fetchone()[0],
        "engine_profiles": db.execute("SELECT COUNT(*) FROM phase7_monster_engine_profiles").fetchone()[0],
        "action_profiles": db.execute("SELECT COUNT(*) FROM phase7_monster_action_profiles").fetchone()[0],
        "automation_backlog": db.execute("SELECT COUNT(*) FROM phase7_monster_automation_backlog").fetchone()[0],
    }

def preconditions(db):
    integrity = db.execute("PRAGMA integrity_check").fetchone()[0]
    fk = db.execute("PRAGMA foreign_key_check").fetchall()
    if integrity != "ok":
        raise RuntimeError(f"integrity_check={integrity}")
    if fk:
        raise RuntimeError(f"foreign_key_errors={len(fk)}")

    tables = {r[0] for r in db.execute(
        "SELECT name FROM sqlite_master WHERE type='table'"
    )}
    required = {
        "monsters",
        "phase7_monster_registry",
        "phase7_monster_engine_profiles",
        "phase7_monster_action_profiles",
        "phase7_monster_automation_backlog",
        "phase7_baseline_batches",
    }
    missing = sorted(required - tables)
    if missing:
        raise RuntimeError("Missing V2 tables: " + ", ".join(missing))
    if "phase7_v4_resolution_log" in tables:
        raise RuntimeError("V4 already appears to be applied: phase7_v4_resolution_log exists.")

    actual = counts(db)
    for key, expected in EXPECTED.items():
        if actual[key] != expected:
            raise RuntimeError(f"State drift: {key} expected={expected} actual={actual[key]}")

    batch = db.execute("""
        SELECT phase_status
        FROM phase7_baseline_batches
        ORDER BY created_at DESC
        LIMIT 1
    """).fetchone()
    if not batch or batch[0] != "STRUCTURED_MONSTER_BASELINE_READY_PHASE7_OPEN":
        raise RuntimeError(f"Unexpected Phase 7 baseline status: {batch[0] if batch else None}")

def parse_recharge(action_name: str, action_index: int):
    m = RECHARGE_ROLL_RE.search(action_name)
    if m:
        low = int(m.group(1))
        high = int(m.group(2) or m.group(1))
        if high < low:
            return None
        return {
            "action_index": action_index,
            "action_name": action_name,
            "kind": "D6_ROLL",
            "die": "d6",
            "minimum": low,
            "maximum": high,
            "evidence": "STRICT_ACTION_NAME_SUFFIX",
        }
    m = RECHARGE_REST_RE.search(action_name)
    if m:
        rests = [m.group(1).lower()]
        if m.group(2):
            rests.append(m.group(2).lower())
        rests = sorted(set(rests))
        return {
            "action_index": action_index,
            "action_name": action_name,
            "kind": "REST",
            "rest_types": rests,
            "evidence": "STRICT_ACTION_NAME_SUFFIX",
        }
    return None

def parse_usage(action_name: str, action_index: int):
    m = USAGE_DAY_RE.search(action_name)
    if not m:
        return None
    return {
        "action_index": action_index,
        "action_name": action_name,
        "kind": "PER_DAY",
        "uses": int(m.group(1)),
        "period": "day",
        "evidence": "STRICT_ACTION_NAME_SUFFIX",
    }

def parse_strict_attack(description: str | None, action_name: str, action_index: int):
    if not isinstance(description, str):
        return None
    m = STRICT_ATTACK_RE.match(description.strip())
    if not m:
        return None
    attack_mode = m.group(1).lower()
    attack_bonus = int(m.group(2))
    range_kind = m.group(3).lower()
    normal_ft = int(m.group(4))
    long_ft = int(m.group(5)) if m.group(5) else None
    target_text = m.group(6).strip()
    average = int(m.group(7))
    formula = m.group(8)
    if formula:
        formula = re.sub(r"\s+", "", formula.lower())
        if not re.fullmatch(r"\d+d\d+(?:[+-]\d+)?", formula):
            return None
    damage_type = m.group(9).lower()

    if attack_mode == "melee" and range_kind != "reach":
        return None
    if attack_mode == "ranged" and range_kind != "range":
        return None

    return {
        "action_index": action_index,
        "action_name": action_name,
        "attack_kind": f"{attack_mode.upper()}_WEAPON",
        "attack_bonus": attack_bonus,
        "range": {
            "kind": range_kind,
            "normal_ft": normal_ft,
            "long_ft": long_ft,
        },
        "target_text": target_text,
        "damage": [
            {
                "average": average,
                "formula": formula,
                "damage_type": damage_type,
            }
        ],
        "evidence": "STRICT_FULL_STANDARD_ATTACK_TEXT",
    }

def merge_list_json(existing_text, new_entries):
    existing = parse_json(existing_text)
    if existing is None:
        existing = []
    if not isinstance(existing, list):
        raise RuntimeError("Expected engine profile JSON field to be a list or null.")
    result = list(existing)
    seen = {
        (x.get("action_index"), x.get("action_name"))
        for x in result
        if isinstance(x, dict)
    }
    for entry in new_entries:
        key = (entry.get("action_index"), entry.get("action_name"))
        if key not in seen:
            result.append(entry)
            seen.add(key)
    return cjson(result)

def apply_v4(db, output: Path):
    preconditions(db)

    db.executescript("""
    CREATE TABLE phase7_v4_resolution_log (
        monster_id TEXT NOT NULL,
        action_index INTEGER NOT NULL,
        resolution_type TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        evidence_rule TEXT NOT NULL,
        created_at TEXT NOT NULL,
        PRIMARY KEY (monster_id, action_index, resolution_type),
        FOREIGN KEY (monster_id) REFERENCES phase7_monster_registry(monster_id)
    );
    """)

    actions = db.execute("""
        SELECT monster_id, action_index, action_name, description,
               attack_bonus, save_dc, damage_json, save_json, area_json,
               recharge_json, usage_json, profile_status
        FROM phase7_monster_action_profiles
        ORDER BY monster_id, action_index
    """).fetchall()

    recharge_by_monster = {}
    usage_by_monster = {}
    attack_by_monster = {}
    recharge_actions = 0
    usage_actions = 0
    strict_attack_actions = 0

    for row in actions:
        (
            monster_id, action_index, action_name, description,
            attack_bonus, save_dc, damage_json, save_json, area_json,
            recharge_json, usage_json, profile_status
        ) = row

        recharge = parse_recharge(action_name, action_index)
        if recharge is not None:
            recharge_actions += 1
            recharge_by_monster.setdefault(monster_id, []).append(recharge)
            if recharge_json is None:
                db.execute("""
                    UPDATE phase7_monster_action_profiles
                    SET recharge_json=?
                    WHERE monster_id=? AND action_index=?
                """, (cjson(recharge), monster_id, action_index))
            db.execute("""
                INSERT INTO phase7_v4_resolution_log
                (monster_id,action_index,resolution_type,payload_json,evidence_rule,created_at)
                VALUES (?,?,?,?,?,?)
            """, (
                monster_id, action_index, "RECHARGE",
                cjson(recharge), "STRICT_ACTION_NAME_SUFFIX", now_iso()
            ))

        usage = parse_usage(action_name, action_index)
        if usage is not None:
            usage_actions += 1
            usage_by_monster.setdefault(monster_id, []).append(usage)
            if usage_json is None:
                db.execute("""
                    UPDATE phase7_monster_action_profiles
                    SET usage_json=?
                    WHERE monster_id=? AND action_index=?
                """, (cjson(usage), monster_id, action_index))
            db.execute("""
                INSERT INTO phase7_v4_resolution_log
                (monster_id,action_index,resolution_type,payload_json,evidence_rule,created_at)
                VALUES (?,?,?,?,?,?)
            """, (
                monster_id, action_index, "USAGE_PER_DAY",
                cjson(usage), "STRICT_ACTION_NAME_SUFFIX", now_iso()
            ))

    # Strict attacks are intentionally limited to monsters whose engine attack_profiles_json is NULL.
    missing_attack_monsters = {
        r[0] for r in db.execute("""
            SELECT monster_id
            FROM phase7_monster_engine_profiles
            WHERE attack_profiles_json IS NULL
        """)
    }

    for row in actions:
        (
            monster_id, action_index, action_name, description,
            attack_bonus, save_dc, damage_json, save_json, area_json,
            recharge_json, usage_json, profile_status
        ) = row
        if monster_id not in missing_attack_monsters:
            continue
        if profile_status != "NARRATIVE_ONLY":
            continue
        parsed = parse_strict_attack(description, action_name, action_index)
        if parsed is None:
            continue

        strict_attack_actions += 1
        attack_by_monster.setdefault(monster_id, []).append(parsed)

        action_damage = parsed["damage"]
        db.execute("""
            UPDATE phase7_monster_action_profiles
            SET attack_bonus=?,
                damage_json=?,
                profile_status='V4_STRICT_STANDARD_ATTACK'
            WHERE monster_id=? AND action_index=?
        """, (
            parsed["attack_bonus"],
            cjson(action_damage),
            monster_id,
            action_index,
        ))
        db.execute("""
            INSERT INTO phase7_v4_resolution_log
            (monster_id,action_index,resolution_type,payload_json,evidence_rule,created_at)
            VALUES (?,?,?,?,?,?)
        """, (
            monster_id, action_index, "STRICT_STANDARD_ATTACK",
            cjson(parsed), "STRICT_FULL_STANDARD_ATTACK_TEXT", now_iso()
        ))

    # Exact V3 evidence-count guardrails.
    actual_recharge_monsters = len(recharge_by_monster)
    actual_usage_monsters = len(usage_by_monster)
    actual_attack_monsters = len(attack_by_monster)

    observed = {
        "recharge_actions": recharge_actions,
        "recharge_monsters": actual_recharge_monsters,
        "usage_actions": usage_actions,
        "usage_monsters": actual_usage_monsters,
        "strict_attack_actions": strict_attack_actions,
        "strict_attack_monsters": actual_attack_monsters,
    }
    for key, expected in EXPECTED_RECOVERY.items():
        if key in observed and observed[key] != expected:
            raise RuntimeError(
                f"V4 evidence drift: {key} expected={expected} actual={observed[key]}"
            )

    # Aggregate canonical semantics into engine profiles.
    for monster_id, entries in recharge_by_monster.items():
        current = db.execute("""
            SELECT recharge_abilities_json
            FROM phase7_monster_engine_profiles
            WHERE monster_id=?
        """, (monster_id,)).fetchone()[0]
        db.execute("""
            UPDATE phase7_monster_engine_profiles
            SET recharge_abilities_json=?
            WHERE monster_id=?
        """, (merge_list_json(current, entries), monster_id))

    for monster_id, entries in usage_by_monster.items():
        current = db.execute("""
            SELECT usage_limits_resources_json
            FROM phase7_monster_engine_profiles
            WHERE monster_id=?
        """, (monster_id,)).fetchone()[0]
        db.execute("""
            UPDATE phase7_monster_engine_profiles
            SET usage_limits_resources_json=?
            WHERE monster_id=?
        """, (merge_list_json(current, entries), monster_id))

    for monster_id, entries in attack_by_monster.items():
        current = db.execute("""
            SELECT attack_profiles_json
            FROM phase7_monster_engine_profiles
            WHERE monster_id=?
        """, (monster_id,)).fetchone()[0]
        if current is not None:
            raise RuntimeError(f"Safety failure: strict attack target already has attack profiles: {monster_id}")
        db.execute("""
            UPDATE phase7_monster_engine_profiles
            SET attack_profiles_json=?
            WHERE monster_id=?
        """, (cjson(entries), monster_id))

    # Remove only the exact resolved backlog types for affected monsters.
    removed = 0
    for monster_id in recharge_by_monster:
        cur = db.execute("""
            DELETE FROM phase7_monster_automation_backlog
            WHERE monster_id=? AND gap_type='recharge_abilities'
        """, (monster_id,))
        removed += cur.rowcount
    for monster_id in usage_by_monster:
        cur = db.execute("""
            DELETE FROM phase7_monster_automation_backlog
            WHERE monster_id=? AND gap_type='usage_limits_resources'
        """, (monster_id,))
        removed += cur.rowcount
    for monster_id in attack_by_monster:
        cur = db.execute("""
            DELETE FROM phase7_monster_automation_backlog
            WHERE monster_id=? AND gap_type='attack_profiles'
        """, (monster_id,))
        removed += cur.rowcount

    if removed != EXPECTED_RECOVERY["backlog_removed"]:
        raise RuntimeError(
            f"V4 backlog removal mismatch: expected={EXPECTED_RECOVERY['backlog_removed']} actual={removed}"
        )

    backlog_after = db.execute(
        "SELECT COUNT(*) FROM phase7_monster_automation_backlog"
    ).fetchone()[0]
    if backlog_after != EXPECTED_RECOVERY["backlog_after"]:
        raise RuntimeError(
            f"V4 backlog_after mismatch: expected={EXPECTED_RECOVERY['backlog_after']} actual={backlog_after}"
        )

    # Persist stage marker.
    db.execute("""
        CREATE TABLE phase7_v4_batches (
            id TEXT PRIMARY KEY,
            created_at TEXT NOT NULL,
            recharge_actions INTEGER NOT NULL,
            recharge_monsters INTEGER NOT NULL,
            usage_actions INTEGER NOT NULL,
            usage_monsters INTEGER NOT NULL,
            strict_attack_actions INTEGER NOT NULL,
            strict_attack_monsters INTEGER NOT NULL,
            backlog_removed INTEGER NOT NULL,
            backlog_after INTEGER NOT NULL,
            phase_status TEXT NOT NULL
        )
    """)
    batch_id = "phase7-v4-" + datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    db.execute("""
        INSERT INTO phase7_v4_batches
        VALUES (?,?,?,?,?,?,?,?,?,?,?)
    """, (
        batch_id, now_iso(),
        recharge_actions, actual_recharge_monsters,
        usage_actions, actual_usage_monsters,
        strict_attack_actions, actual_attack_monsters,
        removed, backlog_after,
        "STRICT_ACTION_SEMANTICS_APPLIED_PHASE7_OPEN"
    ))

    fk = db.execute("PRAGMA foreign_key_check").fetchall()
    if fk:
        raise RuntimeError(f"V4 introduced foreign-key errors: {len(fk)}")

    output.mkdir(parents=True, exist_ok=True)
    report = {
        "package": "PHASE7_STRICT_ACTION_SEMANTICS_V4",
        "rechargeActions": recharge_actions,
        "rechargeMonsters": actual_recharge_monsters,
        "usageActions": usage_actions,
        "usageMonsters": actual_usage_monsters,
        "strictAttackActions": strict_attack_actions,
        "strictAttackMonsters": actual_attack_monsters,
        "backlogRemoved": removed,
        "backlogAfter": backlog_after,
        "phaseStatus": "STRICT_ACTION_SEMANTICS_APPLIED_PHASE7_OPEN",
        "next": "PHASE7_SAVE_AOE_AND_OPTIONAL_SECTION_SEMANTICS_AUDIT",
    }
    (output / "phase7_strict_action_semantics_v4_report.json").write_text(
        json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    (output / "PHASE7_STRICT_ACTION_SEMANTICS_V4_SUMMARY.md").write_text(
        f"""# Phase 7 Strict Action Semantics V4

- Recharge actions recovered: {recharge_actions}
- Monsters with recharge semantics: {actual_recharge_monsters}
- Per-day usage actions recovered: {usage_actions}
- Monsters with per-day usage semantics: {actual_usage_monsters}
- Strict standard attacks recovered: {strict_attack_actions}
- Monsters receiving missing attack profiles: {actual_attack_monsters}
- Backlog rows removed: {removed}
- Backlog rows remaining: {backlog_after}

**Status: STRICT_ACTION_SEMANTICS_APPLIED_PHASE7_OPEN**

Only strict action-name suffixes and full standard attack-text matches were parsed.
No Save DC, AoE, Spellcasting, alignment, XP/PB, or optional-section absence was inferred in V4.
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

    db_path = Path(args.db)
    output = Path(args.output)
    if not db_path.exists():
        raise RuntimeError(f"DB missing: {db_path}")

    db = sqlite3.connect(str(db_path), timeout=10)
    db.execute("PRAGMA foreign_keys=ON")
    try:
        preconditions(db)
        if not args.apply:
            print("V4_PRECHECK=PASS")
            return 0

        db.execute("BEGIN IMMEDIATE")
        try:
            report = apply_v4(db, output)
            db.commit()
        except Exception:
            db.rollback()
            raise

        integrity = db.execute("PRAGMA integrity_check").fetchone()[0]
        if integrity != "ok":
            raise RuntimeError(f"Post-V4 integrity_check={integrity}")

        print("PHASE 7 STRICT ACTION SEMANTICS V4 APPLIED")
        print(f"RECHARGE_ACTIONS={report['rechargeActions']}")
        print(f"RECHARGE_MONSTERS={report['rechargeMonsters']}")
        print(f"USAGE_ACTIONS={report['usageActions']}")
        print(f"USAGE_MONSTERS={report['usageMonsters']}")
        print(f"STRICT_ATTACK_ACTIONS={report['strictAttackActions']}")
        print(f"STRICT_ATTACK_MONSTERS={report['strictAttackMonsters']}")
        print(f"BACKLOG_REMOVED={report['backlogRemoved']}")
        print(f"AUTOMATION_BACKLOG={report['backlogAfter']}")
        print("INTEGRITY=ok")
        print("FOREIGN_KEYS=ok")
        print("PHASE_STATUS=STRICT_ACTION_SEMANTICS_APPLIED_PHASE7_OPEN")
        print("NEXT=PHASE7_SAVE_AOE_AND_OPTIONAL_SECTION_SEMANTICS_AUDIT")
        print(f"OUTPUT={output}")
        return 0
    finally:
        db.close()

if __name__ == "__main__":
    raise SystemExit(main())
