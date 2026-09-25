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
DEFAULT_OUTPUT = PROJECT_ROOT / "_phase7_final_residual_monster_semantics_audit_v9"

EXPECTED = {
    "source_monsters": 322,
    "registry": 322,
    "engine_profiles": 322,
    "action_profiles": 836,
    "automation_backlog": 1454,
    "v4_resolution_rows": 105,
    "v6_resolution_rows": 1248,
    "v8_resolution_rows": 1903,
    "narrative_only_actions": 209,
}

EXPECTED_BACKLOG = {
    "alignment": 322,
    "aoe_definitions": 270,
    "attack_profiles": 3,
    "bonus_actions": 322,
    "lair_actions": 322,
    "save_based_abilities": 186,
    "xp": 29,
}

SECTION_ALIASES = [
    ("traits", ("traits", "specialAbilities", "special_abilities")),
    ("actions", ("actions",)),
    ("bonus_actions", ("bonusActions", "bonus_actions")),
    ("reactions", ("reactions",)),
    ("legendary_actions", ("legendaryActions", "legendary_actions")),
    ("lair_actions", ("lairActions", "lair_actions")),
]

STRICT_SAVE_RE = re.compile(
    r"\bDC\s+(\d{1,2})\s+"
    r"(Strength|Dexterity|Constitution|Intelligence|Wisdom|Charisma)\s+"
    r"saving\s+throw\b",
    re.IGNORECASE,
)
ANY_SAVE_RE = re.compile(r"\bsaving\s+throw\b", re.IGNORECASE)

COMPLETE_AOE_PATTERNS = [
    ("CONE", re.compile(r"\b(\d+)-foot\s+cone\b", re.I)),
    ("LINE", re.compile(
        r"\b(\d+)-foot\s+line\s+that\s+is\s+(\d+)\s+(?:feet|ft\.)\s+wide\b", re.I
    )),
    ("CYLINDER", re.compile(
        r"\b(\d+)-foot-radius,\s*(\d+)-foot-tall\s+cylinder\b", re.I
    )),
]
AOE_HINT_RE = re.compile(
    r"\b(?:cone|line|radius|sphere|cylinder|cube|within\s+\d+\s+feet|"
    r"each creature in|creatures? in|area)\b",
    re.IGNORECASE,
)

ATTACK_HINT_RE = re.compile(
    r"\b(?:Melee|Ranged)\s+(?:Weapon|Spell)\s+Attack\b|\bto\s+hit\b|\bHit:\b",
    re.IGNORECASE,
)

ALIGNMENT_KEY_RE = re.compile(r"alignment", re.IGNORECASE)
ALIGNMENT_VALUE_RE = re.compile(
    r"\b(?:lawful|neutral|chaotic)\s+(?:good|neutral|evil)\b|"
    r"\b(?:unaligned|any alignment|any non-good alignment|any non-lawful alignment)\b",
    re.IGNORECASE,
)

BONUS_KEY_RE = re.compile(r"bonus.?actions?", re.IGNORECASE)
BONUS_TEXT_RE = re.compile(r"\bbonus action\b", re.IGNORECASE)
LAIR_KEY_RE = re.compile(r"lair.?actions?", re.IGNORECASE)
LAIR_TEXT_RE = re.compile(r"\blair action\b", re.IGNORECASE)

XP_TEXT_RE = re.compile(r"\b(\d[\d,]*)\s*XP\b", re.IGNORECASE)

def now_iso():
    return datetime.now(timezone.utc).isoformat()

def normkey(v):
    return re.sub(r"[^a-z0-9]", "", str(v).lower())

def jload(text):
    try:
        return json.loads(text)
    except Exception:
        return None

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

def top_lookup(obj, *names):
    if not isinstance(obj, dict):
        return None
    idx = {normkey(k): k for k in obj}
    for name in names:
        key = idx.get(normkey(name))
        if key is not None:
            return obj[key]
    return None

def list_named_entries(value):
    result = []
    if isinstance(value, list):
        for i, item in enumerate(value):
            if isinstance(item, dict):
                name = item.get("name") or item.get("title") or f"Entry {i+1}"
                desc = item.get("description") or item.get("desc") or item.get("text")
                result.append((str(name), desc if isinstance(desc, str) else "", item))
            elif isinstance(item, str):
                result.append((f"Entry {i+1}", item, {"description": item}))
    elif isinstance(value, dict):
        nested = value.get("actions")
        if isinstance(nested, list):
            return list_named_entries(nested)
        for name, item in value.items():
            if isinstance(item, dict):
                desc = item.get("description") or item.get("desc") or item.get("text")
                result.append((str(name), desc if isinstance(desc, str) else "", item))
    return result

def recursive_matches(value, key_rx, value_rx=None, path="$"):
    rows = []
    if isinstance(value, dict):
        for key, item in value.items():
            child = f"{path}.{key}"
            if key_rx.search(str(key)):
                rows.append({
                    "path": child,
                    "match_kind": "KEY",
                    "key": str(key),
                    "value": item,
                })
            rows.extend(recursive_matches(item, key_rx, value_rx, child))
    elif isinstance(value, list):
        for i, item in enumerate(value):
            rows.extend(recursive_matches(item, key_rx, value_rx, f"{path}[{i}]"))
    elif value_rx and isinstance(value, str):
        if value_rx.search(value):
            rows.append({
                "path": path,
                "match_kind": "VALUE",
                "key": "",
                "value": value,
            })
    return rows

def preflight(db):
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
        "phase7_v6_resolution_log",
        "phase7_v8_resolution_log",
    }
    tables = {r[0] for r in db.execute(
        "SELECT name FROM sqlite_master WHERE type='table'"
    )}
    missing = sorted(required - tables)
    if missing:
        raise RuntimeError("Missing required tables: " + ", ".join(missing))

    actual = {
        "source_monsters": db.execute("SELECT COUNT(*) FROM monsters").fetchone()[0],
        "registry": db.execute("SELECT COUNT(*) FROM phase7_monster_registry").fetchone()[0],
        "engine_profiles": db.execute("SELECT COUNT(*) FROM phase7_monster_engine_profiles").fetchone()[0],
        "action_profiles": db.execute("SELECT COUNT(*) FROM phase7_monster_action_profiles").fetchone()[0],
        "automation_backlog": db.execute("SELECT COUNT(*) FROM phase7_monster_automation_backlog").fetchone()[0],
        "v4_resolution_rows": db.execute("SELECT COUNT(*) FROM phase7_v4_resolution_log").fetchone()[0],
        "v6_resolution_rows": db.execute("SELECT COUNT(*) FROM phase7_v6_resolution_log").fetchone()[0],
        "v8_resolution_rows": db.execute("SELECT COUNT(*) FROM phase7_v8_resolution_log").fetchone()[0],
        "narrative_only_actions": db.execute(
            "SELECT COUNT(*) FROM phase7_monster_action_profiles WHERE profile_status='NARRATIVE_ONLY'"
        ).fetchone()[0],
    }
    for key, expected in EXPECTED.items():
        if actual[key] != expected:
            raise RuntimeError(f"State drift {key}: expected={expected} actual={actual[key]}")

    backlog = {
        r[0]: r[1]
        for r in db.execute("""
            SELECT gap_type,COUNT(*)
            FROM phase7_monster_automation_backlog
            GROUP BY gap_type
        """)
    }
    if backlog != EXPECTED_BACKLOG:
        raise RuntimeError(
            "Backlog drift: "
            + json.dumps({"expected": EXPECTED_BACKLOG, "actual": backlog}, sort_keys=True)
        )
    return actual, backlog, integrity, len(fk)

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--db", default=str(DEFAULT_DB))
    ap.add_argument("--output", default=str(DEFAULT_OUTPUT))
    args = ap.parse_args()

    output = Path(args.output)
    output.mkdir(parents=True, exist_ok=True)

    db = sqlite3.connect(args.db)
    db.row_factory = sqlite3.Row
    try:
        actual, backlog, integrity, fk_errors = preflight(db)

        registry = {
            r["monster_id"]: dict(r)
            for r in db.execute("SELECT * FROM phase7_monster_registry")
        }
        profiles = {
            r["monster_id"]: dict(r)
            for r in db.execute("SELECT * FROM phase7_monster_engine_profiles")
        }
        source = {}
        for r in db.execute("SELECT id,name,search_text,stat_block_json FROM monsters ORDER BY name"):
            stat = jload(r["stat_block_json"])
            if not isinstance(stat, dict):
                raise RuntimeError(f"Malformed source JSON: {r['id']}")
            source[r["id"]] = {
                "name": r["name"],
                "search_text": r["search_text"] or "",
                "stat": stat,
            }

        backlog_ids = defaultdict(set)
        for r in db.execute("SELECT monster_id,gap_type FROM phase7_monster_automation_backlog"):
            backlog_ids[r["gap_type"]].add(r["monster_id"])

        # --------------------------------------------------------------
        # Alignment evidence
        # --------------------------------------------------------------
        alignment_rows = []
        alignment_positive = set()
        for mid in sorted(backlog_ids["alignment"]):
            src = source[mid]
            matches = recursive_matches(
                src["stat"], ALIGNMENT_KEY_RE, ALIGNMENT_VALUE_RE
            )
            search_matches = ALIGNMENT_VALUE_RE.findall(src["search_text"])
            if matches or search_matches:
                alignment_positive.add(mid)
            alignment_rows.append({
                "monster_id": mid,
                "monster_name": src["name"],
                "structured_matches": matches,
                "search_text_alignment_matches": search_matches,
                "current_alignment_profile": profiles[mid].get("alignment"),
            })
        write_csv(output / "alignment_residual_evidence.csv", alignment_rows)

        # --------------------------------------------------------------
        # Bonus / Lair evidence
        # --------------------------------------------------------------
        optional_rows = []
        bonus_positive = set()
        lair_positive = set()
        for mid in registry:
            src = source[mid]
            bonus_matches = recursive_matches(
                src["stat"], BONUS_KEY_RE, BONUS_TEXT_RE
            )
            lair_matches = recursive_matches(
                src["stat"], LAIR_KEY_RE, LAIR_TEXT_RE
            )
            raw_text = json.dumps(src["stat"], ensure_ascii=False)
            bonus_text = bool(BONUS_TEXT_RE.search(raw_text))
            lair_text = bool(LAIR_TEXT_RE.search(raw_text))
            if bonus_matches or bonus_text:
                bonus_positive.add(mid)
            if lair_matches or lair_text:
                lair_positive.add(mid)
            optional_rows.append({
                "monster_id": mid,
                "monster_name": src["name"],
                "bonus_key_or_value_matches": bonus_matches,
                "bonus_text_anywhere": bonus_text,
                "lair_key_or_value_matches": lair_matches,
                "lair_text_anywhere": lair_text,
                "bonus_profile_present": profiles[mid].get("bonus_actions_json") is not None,
                "lair_profile_present": profiles[mid].get("lair_actions_json") is not None,
            })
        write_csv(output / "bonus_lair_residual_evidence.csv", optional_rows)

        # --------------------------------------------------------------
        # Residual Save evidence
        # --------------------------------------------------------------
        save_rows = []
        save_monster_state = Counter()
        for mid in sorted(backlog_ids["save_based_abilities"]):
            src = source[mid]
            found = []
            for section, aliases in SECTION_ALIASES:
                for index, (name, desc, raw) in enumerate(
                    list_named_entries(top_lookup(src["stat"], *aliases))
                ):
                    if not ANY_SAVE_RE.search(desc):
                        continue
                    strict = [
                        {
                            "dc": int(m.group(1)),
                            "ability": m.group(2).lower(),
                            "match": m.group(0),
                        }
                        for m in STRICT_SAVE_RE.finditer(desc)
                    ]
                    found.append({
                        "section": section,
                        "entry_index": index,
                        "entry_name": name,
                        "strict_matches": strict,
                        "description": desc,
                    })
            if found:
                strict_count = sum(len(x["strict_matches"]) for x in found)
                state = "HAS_STRICT_SAVE" if strict_count else "NONSTANDARD_SAVE_TEXT"
            else:
                state = "NO_SAVE_PHRASE_IN_STANDARD_SECTIONS"
            save_monster_state[state] += 1
            save_rows.append({
                "monster_id": mid,
                "monster_name": src["name"],
                "state": state,
                "evidence": found,
            })
        write_csv(output / "save_based_abilities_residual_evidence.csv", save_rows)

        # --------------------------------------------------------------
        # Residual AoE evidence
        # --------------------------------------------------------------
        aoe_rows = []
        aoe_monster_state = Counter()
        for mid in sorted(backlog_ids["aoe_definitions"]):
            src = source[mid]
            found = []
            for section, aliases in SECTION_ALIASES:
                for index, (name, desc, raw) in enumerate(
                    list_named_entries(top_lookup(src["stat"], *aliases))
                ):
                    hints = list(AOE_HINT_RE.finditer(desc))
                    if not hints:
                        continue
                    complete = []
                    for kind, rx in COMPLETE_AOE_PATTERNS:
                        for m in rx.finditer(desc):
                            complete.append({
                                "kind": kind,
                                "match": m.group(0),
                                "groups": list(m.groups()),
                            })
                    found.append({
                        "section": section,
                        "entry_index": index,
                        "entry_name": name,
                        "complete_geometry_matches": complete,
                        "hint_matches": [m.group(0) for m in hints],
                        "description": desc,
                    })
            complete_count = sum(len(x["complete_geometry_matches"]) for x in found)
            if complete_count:
                state = "HAS_COMPLETE_GEOMETRY"
            elif found:
                state = "AOE_LIKE_TEXT_INCOMPLETE_OR_NON_AOE"
            else:
                state = "NO_AOE_HINT_IN_STANDARD_SECTIONS"
            aoe_monster_state[state] += 1
            aoe_rows.append({
                "monster_id": mid,
                "monster_name": src["name"],
                "state": state,
                "evidence": found,
            })
        write_csv(output / "aoe_residual_evidence.csv", aoe_rows)

        # --------------------------------------------------------------
        # 3 residual attack-profile monsters
        # --------------------------------------------------------------
        attack_rows = []
        for mid in sorted(backlog_ids["attack_profiles"]):
            src = source[mid]
            candidate_entries = []
            for section, aliases in SECTION_ALIASES:
                for index, (name, desc, raw) in enumerate(
                    list_named_entries(top_lookup(src["stat"], *aliases))
                ):
                    if ATTACK_HINT_RE.search(desc):
                        candidate_entries.append({
                            "section": section,
                            "entry_index": index,
                            "entry_name": name,
                            "description": desc,
                            "raw_entry": raw,
                        })
            action_profiles = [
                dict(r) for r in db.execute("""
                    SELECT action_index,action_name,description,profile_status,
                           attack_bonus,damage_json,save_json,area_json
                    FROM phase7_monster_action_profiles
                    WHERE monster_id=?
                    ORDER BY action_index
                """, (mid,))
            ]
            attack_rows.append({
                "monster_id": mid,
                "monster_name": src["name"],
                "cr_text": registry[mid].get("cr_text"),
                "source_attack_like_entries": candidate_entries,
                "current_action_profiles": action_profiles,
                "current_attack_profiles_json": profiles[mid].get("attack_profiles_json"),
            })
        write_csv(output / "attack_profile_residual_cases.csv", attack_rows)

        # --------------------------------------------------------------
        # 29 CR 0 XP cases: look for direct XP evidence only.
        # --------------------------------------------------------------
        xp_rows = []
        xp_direct_count = 0
        for mid in sorted(backlog_ids["xp"]):
            src = source[mid]
            raw_text = json.dumps(src["stat"], ensure_ascii=False)
            matches = sorted(set(XP_TEXT_RE.findall(raw_text + " " + src["search_text"])))
            structured_xp_matches = recursive_matches(
                src["stat"], re.compile(r"^(xp|experience|experiencepoints)$", re.I)
            )
            if matches or structured_xp_matches:
                xp_direct_count += 1
            xp_rows.append({
                "monster_id": mid,
                "monster_name": src["name"],
                "cr_text": registry[mid].get("cr_text"),
                "cr_numeric": registry[mid].get("cr_numeric"),
                "text_xp_matches": matches,
                "structured_xp_matches": structured_xp_matches,
                "current_xp_profile": profiles[mid].get("xp"),
            })
        write_csv(output / "cr0_xp_residual_cases.csv", xp_rows)

        # --------------------------------------------------------------
        # Summary + closure classification
        # --------------------------------------------------------------
        classification = [
            {
                "family": "alignment",
                "backlog_rows": backlog["alignment"],
                "positive_evidence_monsters": len(alignment_positive),
                "no_evidence_monsters": backlog["alignment"] - len(alignment_positive),
                "closure_candidate": "ONLY_IF_SOURCE_EVIDENCE_IS_COMPLETE_OR_POLICY_ACCEPTS_UNKNOWN",
                "note": "Alignment must not be invented when absent from source.",
            },
            {
                "family": "bonus_actions",
                "backlog_rows": backlog["bonus_actions"],
                "positive_evidence_monsters": len(bonus_positive),
                "no_evidence_monsters": backlog["bonus_actions"] - len(bonus_positive),
                "closure_candidate": "ONLY_IF_NO_HIDDEN_EVIDENCE_AND_SOURCE_SCHEMA_IS_COMPLETE",
                "note": "Separate section absence requires evidence that source preserves Bonus Actions.",
            },
            {
                "family": "lair_actions",
                "backlog_rows": backlog["lair_actions"],
                "positive_evidence_monsters": len(lair_positive),
                "no_evidence_monsters": backlog["lair_actions"] - len(lair_positive),
                "closure_candidate": "ONLY_IF_NO_HIDDEN_EVIDENCE_AND_SOURCE_SCHEMA_IS_COMPLETE",
                "note": "Lair Actions may be external to compact stat blocks; do not infer N/A prematurely.",
            },
            {
                "family": "save_based_abilities",
                "backlog_rows": backlog["save_based_abilities"],
                "positive_evidence_monsters": (
                    save_monster_state["HAS_STRICT_SAVE"]
                    + save_monster_state["NONSTANDARD_SAVE_TEXT"]
                ),
                "no_evidence_monsters": save_monster_state["NO_SAVE_PHRASE_IN_STANDARD_SECTIONS"],
                "closure_candidate": "YES_FOR_NO_EVIDENCE_PARTITION_IF_COMPLETE_SECTION_INVENTORY_HOLDS",
                "note": "Nonstandard save wording must remain separately reviewed.",
            },
            {
                "family": "aoe_definitions",
                "backlog_rows": backlog["aoe_definitions"],
                "positive_evidence_monsters": (
                    aoe_monster_state["HAS_COMPLETE_GEOMETRY"]
                    + aoe_monster_state["AOE_LIKE_TEXT_INCOMPLETE_OR_NON_AOE"]
                ),
                "no_evidence_monsters": aoe_monster_state["NO_AOE_HINT_IN_STANDARD_SECTIONS"],
                "closure_candidate": "YES_FOR_NO_EVIDENCE_PARTITION_IF_COMPLETE_SECTION_INVENTORY_HOLDS",
                "note": "AoE-like text requires false-positive review before automation.",
            },
            {
                "family": "attack_profiles",
                "backlog_rows": backlog["attack_profiles"],
                "positive_evidence_monsters": sum(
                    1 for r in attack_rows if r["source_attack_like_entries"]
                ),
                "no_evidence_monsters": sum(
                    1 for r in attack_rows if not r["source_attack_like_entries"]
                ),
                "closure_candidate": "CASE_BY_CASE_ONLY",
                "note": "Only three monsters remain; inspect exact evidence rather than broad parsing.",
            },
            {
                "family": "xp",
                "backlog_rows": backlog["xp"],
                "positive_evidence_monsters": xp_direct_count,
                "no_evidence_monsters": backlog["xp"] - xp_direct_count,
                "closure_candidate": "ONLY_WITH_DIRECT_SOURCE_EVIDENCE_OR_EXPLICIT_CR0_POLICY",
                "note": "Official CR 0 XP is 0 or 10; no arbitrary choice is permitted.",
            },
        ]
        write_csv(output / "v9_residual_closure_classification.csv", classification)

        report = {
            "package": "PHASE7_FINAL_RESIDUAL_MONSTER_SEMANTICS_AUDIT_V9",
            "createdAt": now_iso(),
            "readOnly": True,
            "integrity": integrity,
            "foreignKeyErrors": fk_errors,
            "counts": actual,
            "backlog": backlog,
            "alignmentEvidenceMonsters": len(alignment_positive),
            "bonusActionEvidenceMonsters": len(bonus_positive),
            "lairActionEvidenceMonsters": len(lair_positive),
            "saveResidualStates": dict(save_monster_state),
            "aoeResidualStates": dict(aoe_monster_state),
            "attackResidualCases": len(attack_rows),
            "cr0XpDirectEvidenceMonsters": xp_direct_count,
            "phaseStatus": "PHASE7_V9_FINAL_RESIDUAL_AUDIT_COMPLETE",
            "next": "REVIEW_V9_AND_DECIDE_FINAL_PHASE7_RESOLUTION_OR_QUARANTINE",
        }
        (output / "phase7_final_residual_monster_semantics_audit_v9_report.json").write_text(
            json.dumps(report, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )

        summary = f"""# Phase 7 — Final Residual Monster Semantics Audit V9

**Mode:** READ-ONLY

- Source monsters: {actual['source_monsters']}
- Current backlog: {actual['automation_backlog']}
- Narrative-only actions: {actual['narrative_only_actions']}
- Alignment evidence monsters: {len(alignment_positive)}
- Bonus Action evidence monsters: {len(bonus_positive)}
- Lair Action evidence monsters: {len(lair_positive)}

## Save residual states

{json.dumps(dict(save_monster_state), ensure_ascii=False, indent=2)}

## AoE residual states

{json.dumps(dict(aoe_monster_state), ensure_ascii=False, indent=2)}

## Tiny residual sets

- Attack-profile cases: {len(attack_rows)}
- CR 0 XP cases with direct XP evidence: {xp_direct_count} / {backlog['xp']}

## Purpose

V9 does not modify any database or source file.
It determines whether the remaining Phase 7 backlog can be:
1. resolved from direct evidence,
2. safely marked NOT_APPLICABLE from a complete source partition, or
3. explicitly quarantined as unresolved/ambiguous without inventing mechanics.

**Status: PHASE7_V9_FINAL_RESIDUAL_AUDIT_COMPLETE**
"""
        (output / "PHASE7_FINAL_RESIDUAL_MONSTER_SEMANTICS_AUDIT_V9_SUMMARY.md").write_text(
            summary, encoding="utf-8"
        )

        print("PHASE 7 FINAL RESIDUAL MONSTER SEMANTICS AUDIT V9 COMPLETE")
        print("READ_ONLY=YES")
        print(f"INTEGRITY={integrity}")
        print(f"FOREIGN_KEYS={fk_errors}")
        print(f"SOURCE_MONSTERS={actual['source_monsters']}")
        print(f"AUTOMATION_BACKLOG={actual['automation_backlog']}")
        print(f"NARRATIVE_ONLY_ACTIONS={actual['narrative_only_actions']}")
        print(f"ALIGNMENT_EVIDENCE_MONSTERS={len(alignment_positive)}")
        print(f"BONUS_ACTION_EVIDENCE_MONSTERS={len(bonus_positive)}")
        print(f"LAIR_ACTION_EVIDENCE_MONSTERS={len(lair_positive)}")
        print(f"SAVE_RESIDUAL_STRICT={save_monster_state['HAS_STRICT_SAVE']}")
        print(f"SAVE_RESIDUAL_NONSTANDARD={save_monster_state['NONSTANDARD_SAVE_TEXT']}")
        print(f"SAVE_RESIDUAL_NO_EVIDENCE={save_monster_state['NO_SAVE_PHRASE_IN_STANDARD_SECTIONS']}")
        print(f"AOE_RESIDUAL_COMPLETE={aoe_monster_state['HAS_COMPLETE_GEOMETRY']}")
        print(f"AOE_RESIDUAL_AMBIGUOUS={aoe_monster_state['AOE_LIKE_TEXT_INCOMPLETE_OR_NON_AOE']}")
        print(f"AOE_RESIDUAL_NO_EVIDENCE={aoe_monster_state['NO_AOE_HINT_IN_STANDARD_SECTIONS']}")
        print(f"ATTACK_RESIDUAL_CASES={len(attack_rows)}")
        print(f"CR0_XP_DIRECT_EVIDENCE_MONSTERS={xp_direct_count}")
        print("PHASE_STATUS=PHASE7_V9_FINAL_RESIDUAL_AUDIT_COMPLETE")
        print("NEXT=REVIEW_V9_AND_DECIDE_FINAL_PHASE7_RESOLUTION_OR_QUARANTINE")
        print(f"OUTPUT={output}")
        return 0
    finally:
        db.close()

if __name__ == "__main__":
    raise SystemExit(main())
