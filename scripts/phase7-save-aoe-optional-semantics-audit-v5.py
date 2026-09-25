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
DEFAULT_OUTPUT = PROJECT_ROOT / "_phase7_save_aoe_optional_semantics_audit_v5"

EXPECTED = {
    "source_monsters": 322,
    "registry": 322,
    "engine_profiles": 322,
    "action_profiles": 836,
    "automation_backlog": 4471,
    "v4_resolution_rows": 105,
}

SAVE_DC_RE = re.compile(
    r"\bDC\s+(\d{1,2})\s+"
    r"(Strength|Dexterity|Constitution|Intelligence|Wisdom|Charisma)\s+"
    r"saving\s+throw\b",
    re.IGNORECASE,
)
AOE_PATTERNS = [
    ("CONE", re.compile(r"\b(\d+)-foot\s+cone\b", re.I)),
    ("LINE", re.compile(r"\b(\d+)-foot(?:-long)?\s+line(?:\s+that\s+is\s+(\d+)\s+feet\s+wide)?\b", re.I)),
    ("RADIUS", re.compile(r"\b(\d+)-foot-radius\s+(sphere|circle|cylinder)\b", re.I)),
    ("CUBE", re.compile(r"\b(\d+)-foot\s+cube\b", re.I)),
    ("SPHERE", re.compile(r"\b(\d+)-foot\s+sphere\b", re.I)),
    ("CYLINDER", re.compile(r"\b(\d+)-foot(?:-tall)?\s+cylinder\b", re.I)),
]
SPELL_TRAIT_RE = re.compile(r"\b(spellcasting|innate spellcasting|psionics?)\b", re.I)
MULTIATTACK_NAME_RE = re.compile(r"^multiattack$", re.I)
REACTION_NAME_RE = re.compile(r"\breaction\b", re.I)
LEGENDARY_NAME_RE = re.compile(r"\blegendary\b", re.I)
BONUS_NAME_RE = re.compile(r"\bbonus action\b", re.I)
LAIR_NAME_RE = re.compile(r"\blair\b", re.I)

def now_iso():
    return datetime.now(timezone.utc).isoformat()

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
                v = row.get(key, "")
                if isinstance(v, (dict, list)):
                    v = json.dumps(v, ensure_ascii=False, sort_keys=True)
                out[key] = v
            w.writerow(out)

def jload(text):
    if text is None:
        return None
    try:
        return json.loads(text)
    except Exception:
        return None

def normkey(s):
    return re.sub(r"[^a-z0-9]", "", str(s).lower())

def top_lookup(obj, *names):
    if not isinstance(obj, dict):
        return None
    idx = {normkey(k): k for k in obj}
    for name in names:
        k = idx.get(normkey(name))
        if k is not None:
            return obj[k]
    return None

def list_named_entries(value):
    result = []
    if isinstance(value, list):
        for i, item in enumerate(value):
            if isinstance(item, dict):
                name = item.get("name") or item.get("title") or f"Entry {i+1}"
                desc = item.get("description") or item.get("desc") or item.get("text")
                result.append((str(name), desc, item))
            elif isinstance(item, str):
                result.append((f"Entry {i+1}", item, {"description": item}))
    elif isinstance(value, dict):
        # common section object with `actions`
        nested = value.get("actions")
        if isinstance(nested, list):
            return list_named_entries(nested)
        for name, item in value.items():
            if isinstance(item, dict):
                d = item.get("description") or item.get("desc") or item.get("text")
                result.append((str(name), d, item))
    return result

def counts(db):
    return {
        "source_monsters": db.execute("SELECT COUNT(*) FROM monsters").fetchone()[0],
        "registry": db.execute("SELECT COUNT(*) FROM phase7_monster_registry").fetchone()[0],
        "engine_profiles": db.execute("SELECT COUNT(*) FROM phase7_monster_engine_profiles").fetchone()[0],
        "action_profiles": db.execute("SELECT COUNT(*) FROM phase7_monster_action_profiles").fetchone()[0],
        "automation_backlog": db.execute("SELECT COUNT(*) FROM phase7_monster_automation_backlog").fetchone()[0],
        "v4_resolution_rows": db.execute("SELECT COUNT(*) FROM phase7_v4_resolution_log").fetchone()[0],
    }

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--db", default=str(DEFAULT_DB))
    ap.add_argument("--output", default=str(DEFAULT_OUTPUT))
    args = ap.parse_args()

    db_path = Path(args.db)
    output = Path(args.output)
    output.mkdir(parents=True, exist_ok=True)

    db = sqlite3.connect(str(db_path))
    db.row_factory = sqlite3.Row
    try:
        integrity = db.execute("PRAGMA integrity_check").fetchone()[0]
        fk_errors = len(db.execute("PRAGMA foreign_key_check").fetchall())
        actual = counts(db)

        errors = []
        if integrity != "ok":
            errors.append(f"integrity={integrity}")
        if fk_errors:
            errors.append(f"foreign_key_errors={fk_errors}")
        for key, expected in EXPECTED.items():
            if actual[key] != expected:
                errors.append(f"{key}: expected={expected} actual={actual[key]}")
        if errors:
            raise RuntimeError("V5 safety stop: " + " | ".join(errors))

        # Current backlog distribution.
        backlog_by_type = [
            dict(r) for r in db.execute("""
                SELECT gap_type, COUNT(*) AS backlog_rows,
                       COUNT(DISTINCT monster_id) AS monsters_affected
                FROM phase7_monster_automation_backlog
                GROUP BY gap_type
                ORDER BY backlog_rows DESC, gap_type
            """)
        ]
        write_csv(output / "v5_backlog_by_gap_type.csv", backlog_by_type)
        backlog_map = {r["gap_type"]: r["backlog_rows"] for r in backlog_by_type}

        # Current profiles and source records.
        profile_rows = {
            r["monster_id"]: dict(r)
            for r in db.execute("SELECT * FROM phase7_monster_engine_profiles")
        }
        registry = {
            r["monster_id"]: dict(r)
            for r in db.execute("SELECT * FROM phase7_monster_registry")
        }
        action_rows = [
            dict(r) for r in db.execute("""
                SELECT a.*, r.name AS monster_name
                FROM phase7_monster_action_profiles a
                JOIN phase7_monster_registry r ON r.monster_id=a.monster_id
                ORDER BY r.name, a.action_index
            """)
        ]

        source_rows = {}
        for r in db.execute("SELECT id,name,stat_block_json FROM monsters ORDER BY name"):
            source_rows[r["id"]] = {
                "name": r["name"],
                "stat": jload(r["stat_block_json"]),
            }

        # Strict Save DC candidates and action AOE candidates.
        save_candidates = []
        aoe_candidates = []
        spell_candidates = []
        hidden_optional_evidence = []
        monster_evidence = defaultdict(lambda: {
            "save_action_matches": 0,
            "aoe_action_matches": 0,
            "spell_trait_matches": 0,
            "multiattack_action_names": 0,
            "reaction_source_entries": 0,
            "legendary_source_entries": 0,
            "bonus_source_entries": 0,
            "lair_source_entries": 0,
        })

        # Scan actions.
        for row in action_rows:
            desc = row.get("description")
            text = desc if isinstance(desc, str) else ""
            mid = row["monster_id"]

            save_matches = list(SAVE_DC_RE.finditer(text))
            for m in save_matches:
                candidate = {
                    "monster_id": mid,
                    "monster_name": row["monster_name"],
                    "action_index": row["action_index"],
                    "action_name": row["action_name"],
                    "save_dc": int(m.group(1)),
                    "save_ability": m.group(2).lower(),
                    "full_match": m.group(0),
                    "description": text,
                    "current_profile_status": row["profile_status"],
                    "current_save_dc": row["save_dc"],
                    "current_save_json": row["save_json"],
                    "current_area_json": row["area_json"],
                }
                save_candidates.append(candidate)
                monster_evidence[mid]["save_action_matches"] += 1

            for kind, pattern in AOE_PATTERNS:
                for m in pattern.finditer(text):
                    aoe_candidates.append({
                        "monster_id": mid,
                        "monster_name": row["monster_name"],
                        "action_index": row["action_index"],
                        "action_name": row["action_name"],
                        "aoe_kind": kind,
                        "full_match": m.group(0),
                        "groups": [g for g in m.groups()],
                        "description": text,
                        "current_area_json": row["area_json"],
                    })
                    monster_evidence[mid]["aoe_action_matches"] += 1

            if MULTIATTACK_NAME_RE.match(str(row["action_name"]).strip()):
                monster_evidence[mid]["multiattack_action_names"] += 1

        # Scan source special sections and traits for hidden optional evidence.
        source_section_rows = []
        for mid, src in source_rows.items():
            stat = src["stat"]
            if not isinstance(stat, dict):
                continue

            traits = top_lookup(stat, "traits", "specialAbilities", "special_abilities")
            for tname, tdesc, raw in list_named_entries(traits):
                haystack = f"{tname} {tdesc or ''}"
                if SPELL_TRAIT_RE.search(haystack):
                    spell_candidates.append({
                        "monster_id": mid,
                        "monster_name": src["name"],
                        "trait_name": tname,
                        "description": tdesc or "",
                        "raw_trait_json": raw,
                    })
                    monster_evidence[mid]["spell_trait_matches"] += 1

            reactions = top_lookup(stat, "reactions")
            reaction_entries = list_named_entries(reactions)
            monster_evidence[mid]["reaction_source_entries"] = len(reaction_entries)

            legendary = top_lookup(stat, "legendaryActions", "legendary_actions")
            legendary_entries = list_named_entries(legendary)
            monster_evidence[mid]["legendary_source_entries"] = len(legendary_entries)

            bonus = top_lookup(stat, "bonusActions", "bonus_actions")
            bonus_entries = list_named_entries(bonus)
            monster_evidence[mid]["bonus_source_entries"] = len(bonus_entries)

            lair = top_lookup(stat, "lairActions", "lair_actions")
            lair_entries = list_named_entries(lair)
            monster_evidence[mid]["lair_source_entries"] = len(lair_entries)

            source_section_rows.append({
                "monster_id": mid,
                "monster_name": src["name"],
                "reaction_entries": len(reaction_entries),
                "legendary_entries": len(legendary_entries),
                "bonus_action_entries": len(bonus_entries),
                "lair_action_entries": len(lair_entries),
                "spell_trait_matches": monster_evidence[mid]["spell_trait_matches"],
                "multiattack_action_names": monster_evidence[mid]["multiattack_action_names"],
                "save_action_matches": monster_evidence[mid]["save_action_matches"],
                "aoe_action_matches": monster_evidence[mid]["aoe_action_matches"],
            })

        write_csv(output / "strict_save_dc_candidates.csv", save_candidates)
        write_csv(output / "strict_aoe_phrase_candidates.csv", aoe_candidates)
        write_csv(output / "spellcasting_trait_candidates.csv", spell_candidates)
        write_csv(output / "source_optional_section_evidence.csv", source_section_rows)

        # Save candidate shape summary.
        save_shape_counter = Counter()
        for c in save_candidates:
            save_shape_counter[(c["save_ability"], c["current_profile_status"])] += 1
        save_shape_rows = [
            {
                "save_ability": ability,
                "current_profile_status": status,
                "candidate_count": count,
            }
            for (ability, status), count in sorted(
                save_shape_counter.items(),
                key=lambda kv: (-kv[1], kv[0])
            )
        ]
        write_csv(output / "save_candidate_shape_summary.csv", save_shape_rows)

        aoe_shape_counter = Counter(c["aoe_kind"] for c in aoe_candidates)
        aoe_shape_rows = [
            {"aoe_kind": kind, "candidate_count": count}
            for kind, count in aoe_shape_counter.most_common()
        ]
        write_csv(output / "aoe_candidate_shape_summary.csv", aoe_shape_rows)

        # Optional absence audit: distinguish "source evidence present" from "no evidence anywhere".
        optional_specs = {
            "saving_throws": ("saving_throws_json", "save_action_matches"),
            "reactions": ("reactions_json", "reaction_source_entries"),
            "legendary_actions": ("legendary_actions_json", "legendary_source_entries"),
            "bonus_actions": ("bonus_actions_json", "bonus_source_entries"),
            "lair_actions": ("lair_actions_json", "lair_source_entries"),
            "spellcasting": ("spellcasting_json", "spell_trait_matches"),
            "multiattack": ("multiattack_json", "multiattack_action_names"),
            "save_based_abilities": ("save_based_abilities_json", "save_action_matches"),
            "aoe_definitions": ("aoe_definitions_json", "aoe_action_matches"),
        }

        backlog_sets = defaultdict(set)
        for r in db.execute("SELECT monster_id,gap_type FROM phase7_monster_automation_backlog"):
            backlog_sets[r["gap_type"]].add(r["monster_id"])

        optional_matrix = []
        contradiction_rows = []
        for gap_type, (profile_col, evidence_key) in optional_specs.items():
            backlogged = backlog_sets.get(gap_type, set())
            no_external_evidence = 0
            external_evidence = 0
            profile_present = 0

            for mid in registry:
                profile = profile_rows[mid]
                present = profile.get(profile_col) is not None
                evidence_count = monster_evidence[mid][evidence_key]
                is_backlogged = mid in backlogged

                if present:
                    profile_present += 1

                if is_backlogged:
                    if evidence_count:
                        external_evidence += 1
                        contradiction_rows.append({
                            "gap_type": gap_type,
                            "monster_id": mid,
                            "monster_name": registry[mid]["name"],
                            "profile_field": profile_col,
                            "profile_present": present,
                            "evidence_count": evidence_count,
                            "evidence_type": evidence_key,
                        })
                    else:
                        no_external_evidence += 1

            optional_matrix.append({
                "gap_type": gap_type,
                "backlog_rows": len(backlogged),
                "profile_present_monsters": profile_present,
                "backlogged_with_external_evidence": external_evidence,
                "backlogged_with_no_external_evidence": no_external_evidence,
                "audit_interpretation": (
                    "Cannot mark absence NOT_APPLICABLE until source contract is proven"
                    if gap_type in {"bonus_actions","lair_actions","spellcasting","save_based_abilities","aoe_definitions"}
                    else "Candidate for absence semantics if zero hidden-evidence contradictions remain"
                ),
            })

        write_csv(output / "optional_absence_semantics_matrix.csv", optional_matrix)
        write_csv(output / "backlogged_with_hidden_evidence.csv", contradiction_rows)

        # Rules version / XP / PB evidence scan.
        version_rows = []
        source_string_counts = Counter()
        for mid, reg in registry.items():
            source = reg.get("source") or ""
            attribution = reg.get("attribution") or ""
            source_string_counts[(source, attribution)] += 1
            years = sorted(set(re.findall(r"\b(2014|2024)\b", f"{source} {attribution}")))
            version_rows.append({
                "monster_id": mid,
                "monster_name": reg["name"],
                "source": source,
                "attribution": attribution,
                "explicit_years": years,
                "rules_version_profile": profile_rows[mid].get("rules_version"),
                "cr_text": reg.get("cr_text"),
                "cr_numeric": reg.get("cr_numeric"),
                "xp_profile": profile_rows[mid].get("xp"),
                "proficiency_bonus_profile": profile_rows[mid].get("proficiency_bonus"),
            })
        write_csv(output / "rules_version_xp_pb_evidence.csv", version_rows)

        source_strings = [
            {
                "source": source,
                "attribution": attribution,
                "monster_count": count,
                "explicit_years": sorted(set(re.findall(r"\b(2014|2024)\b", f"{source} {attribution}"))),
            }
            for (source, attribution), count in source_string_counts.most_common()
        ]
        write_csv(output / "source_attribution_summary.csv", source_strings)

        # High-level report.
        report = {
            "package": "PHASE7_SAVE_AOE_OPTIONAL_SEMANTICS_AUDIT_V5",
            "createdAt": now_iso(),
            "readOnly": True,
            "integrity": integrity,
            "foreignKeyErrors": fk_errors,
            "counts": actual,
            "saveDcCandidates": len(save_candidates),
            "saveDcCandidateMonsters": len({c["monster_id"] for c in save_candidates}),
            "aoePhraseCandidates": len(aoe_candidates),
            "aoeCandidateMonsters": len({c["monster_id"] for c in aoe_candidates}),
            "spellcastingTraitCandidates": len(spell_candidates),
            "spellcastingCandidateMonsters": len({c["monster_id"] for c in spell_candidates}),
            "hiddenEvidenceBacklogRows": len(contradiction_rows),
            "phaseStatus": "PHASE7_V5_SEMANTICS_AUDIT_COMPLETE",
            "next": "REVIEW_V5_AND_BUILD_STRICT_SAVE_AOE_OPTIONAL_RESOLUTION",
        }
        (output / "phase7_save_aoe_optional_semantics_audit_v5_report.json").write_text(
            json.dumps(report, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )

        top_backlog = "\n".join(
            f"- `{r['gap_type']}`: {r['backlog_rows']}"
            for r in backlog_by_type[:16]
        )
        summary = f"""# Phase 7 Save/AoE/Optional Semantics Audit V5

**Mode:** READ-ONLY

- Source monsters: {actual['source_monsters']}
- Engine profiles: {actual['engine_profiles']}
- Action profiles: {actual['action_profiles']}
- Current automation backlog: {actual['automation_backlog']}
- V4 resolution rows: {actual['v4_resolution_rows']}
- Strict Save DC text candidates: {len(save_candidates)}
- Monsters with strict Save DC candidates: {len({c['monster_id'] for c in save_candidates})}
- Strict AoE phrase candidates: {len(aoe_candidates)}
- Monsters with strict AoE candidates: {len({c['monster_id'] for c in aoe_candidates})}
- Spellcasting trait candidates: {len(spell_candidates)}
- Monsters with spellcasting trait candidates: {len({c['monster_id'] for c in spell_candidates})}
- Backlog rows with hidden evidence: {len(contradiction_rows)}
- Integrity: {integrity}
- Foreign-key errors: {fk_errors}

## Current backlog
{top_backlog}

**Status: PHASE7_V5_SEMANTICS_AUDIT_COMPLETE**

This audit changes nothing. It separates:
1. strict recoverable Save/AoE evidence,
2. optional features that may legitimately be absent,
3. hidden structured evidence that V2/V4 missed,
4. source-contract questions that must remain unresolved until proven.
"""
        (output / "PHASE7_SAVE_AOE_OPTIONAL_SEMANTICS_AUDIT_V5_SUMMARY.md").write_text(
            summary, encoding="utf-8"
        )

        print("PHASE 7 SAVE/AOE/OPTIONAL SEMANTICS AUDIT V5 COMPLETE")
        print("READ_ONLY=YES")
        print(f"INTEGRITY={integrity}")
        print(f"FOREIGN_KEYS={fk_errors}")
        print(f"SOURCE_MONSTERS={actual['source_monsters']}")
        print(f"ENGINE_PROFILES={actual['engine_profiles']}")
        print(f"ACTION_PROFILES={actual['action_profiles']}")
        print(f"AUTOMATION_BACKLOG={actual['automation_backlog']}")
        print(f"V4_RESOLUTION_ROWS={actual['v4_resolution_rows']}")
        print(f"SAVE_DC_CANDIDATES={len(save_candidates)}")
        print(f"SAVE_DC_CANDIDATE_MONSTERS={len({c['monster_id'] for c in save_candidates})}")
        print(f"AOE_CANDIDATES={len(aoe_candidates)}")
        print(f"AOE_CANDIDATE_MONSTERS={len({c['monster_id'] for c in aoe_candidates})}")
        print(f"SPELLCASTING_TRAIT_CANDIDATES={len(spell_candidates)}")
        print(f"SPELLCASTING_CANDIDATE_MONSTERS={len({c['monster_id'] for c in spell_candidates})}")
        print(f"HIDDEN_EVIDENCE_BACKLOG_ROWS={len(contradiction_rows)}")
        print("PHASE_STATUS=PHASE7_V5_SEMANTICS_AUDIT_COMPLETE")
        print("NEXT=REVIEW_V5_AND_BUILD_STRICT_SAVE_AOE_OPTIONAL_RESOLUTION")
        print(f"OUTPUT={output}")
        return 0
    finally:
        db.close()

if __name__ == "__main__":
    raise SystemExit(main())
