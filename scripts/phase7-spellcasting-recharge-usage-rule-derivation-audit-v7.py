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
DEFAULT_OUTPUT = PROJECT_ROOT / "_phase7_spellcasting_recharge_usage_rule_derivation_audit_v7"

EXPECTED = {
    "source_monsters": 322,
    "registry": 322,
    "engine_profiles": 322,
    "action_profiles": 836,
    "automation_backlog": 3264,
    "v4_resolution_rows": 105,
    "v6_resolution_rows": 1248,
    "narrative_only_actions": 209,
}

EXPECTED_BACKLOG = {
    "alignment": 322,
    "aoe_definitions": 270,
    "bonus_actions": 322,
    "lair_actions": 322,
    "proficiency_bonus": 322,
    "rules_version": 322,
    "save_based_abilities": 186,
    "spellcasting": 322,
    "xp": 322,
    "usage_limits_resources": 300,
    "recharge_abilities": 251,
    "attack_profiles": 3,
}

SPELL_TRAIT_NAME_RE = re.compile(
    r"\b(spellcasting|innate spellcasting|shared spellcasting|psionics?)\b",
    re.IGNORECASE,
)
ABILITY_RE = re.compile(
    r"\b(?:spellcasting|spell casting)\s+ability\s+is\s+"
    r"(Strength|Dexterity|Constitution|Intelligence|Wisdom|Charisma)\b",
    re.IGNORECASE,
)
SAVE_DC_RE = re.compile(r"\bspell\s+save\s+DC\s+(\d{1,2})\b", re.IGNORECASE)
SPELL_ATTACK_RE = re.compile(
    r"([+-]\d+)\s+to\s+hit\s+with\s+spell\s+attacks?\b",
    re.IGNORECASE,
)
CASTER_LEVEL_RE = re.compile(
    r"\b(?:an?|the)\s+(\d+)(?:st|nd|rd|th)-level\s+spellcaster\b",
    re.IGNORECASE,
)
RECHARGE_ROLL_RE = re.compile(
    r"\(Recharge\s+([1-6])(?:\s*[-–]\s*([1-6]))?\)",
    re.IGNORECASE,
)
RECHARGE_REST_RE = re.compile(
    r"\(Recharges?\s+after\s+a\s+(Short|Long)(?:\s+or\s+(Long|Short))?\s+Rest\)",
    re.IGNORECASE,
)
USAGE_DAY_NAME_RE = re.compile(r"\(([1-9]\d*)\s*/\s*Day\)", re.IGNORECASE)
USAGE_TEXT_RE = re.compile(
    r"\b([1-9]\d*)\s*/\s*day(?:\s+each)?\b",
    re.IGNORECASE,
)
AT_WILL_RE = re.compile(r"^\s*(?:[-*]\s*)?At\s+will\s*:\s*(.+)$", re.IGNORECASE)
DAY_LIST_RE = re.compile(
    r"^\s*(?:[-*]\s*)?([1-9]\d*)\s*/\s*day(?:\s+each)?\s*:\s*(.+)$",
    re.IGNORECASE,
)
CANTRIP_RE = re.compile(
    r"^\s*(?:[-*]\s*)?Cantrips?\s*\(at\s+will\)\s*:\s*(.+)$",
    re.IGNORECASE,
)
SLOT_RE = re.compile(
    r"^\s*(?:[-*]\s*)?([1-9])(?:st|nd|rd|th)\s+level\s*\((\d+)\s+slots?\)\s*:\s*(.+)$",
    re.IGNORECASE,
)

TEXT_EXTENSIONS = {".ts", ".tsx", ".js", ".mjs", ".cjs", ".json", ".md"}
SKIP_DIRS = {
    "node_modules", "dist", ".git", "_hotfix_backups",
    "PHASE7_STRUCTURED_MONSTER_BASELINE_V2_FIXED",
    "PHASE7_EVIDENCE_BOUNDED_MONSTER_RULES_AUDIT_V3",
    "PHASE7_STRICT_ACTION_SEMANTICS_V4",
    "PHASE7_SAVE_AOE_OPTIONAL_SEMANTICS_AUDIT_V5",
    "PHASE7_STRICT_SAVE_AOE_OPTIONAL_RESOLUTION_V6",
    "PHASE7_STRICT_SAVE_AOE_OPTIONAL_RESOLUTION_V6_FIXED",
}

def now_iso():
    return datetime.now(timezone.utc).isoformat()

def normkey(value):
    return re.sub(r"[^a-z0-9]", "", str(value).lower())

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
                v = row.get(key, "")
                if isinstance(v, (list, dict)):
                    v = json.dumps(v, ensure_ascii=False, sort_keys=True)
                out[key] = v
            w.writerow(out)

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

def top_lookup(obj, *names):
    if not isinstance(obj, dict):
        return None
    idx = {normkey(k): k for k in obj}
    for name in names:
        key = idx.get(normkey(name))
        if key is not None:
            return obj[key]
    return None

def parse_spell_lines(description: str):
    lines = []
    unparsed_spellish = []
    for raw_line in description.splitlines():
        line = raw_line.strip()
        if not line:
            continue

        m = AT_WILL_RE.match(line)
        if m:
            lines.append({
                "kind": "AT_WILL",
                "spells_text": m.group(1).strip(),
                "raw_line": raw_line,
            })
            continue

        m = DAY_LIST_RE.match(line)
        if m:
            lines.append({
                "kind": "PER_DAY",
                "uses": int(m.group(1)),
                "spells_text": m.group(2).strip(),
                "raw_line": raw_line,
            })
            continue

        m = CANTRIP_RE.match(line)
        if m:
            lines.append({
                "kind": "CANTRIP_AT_WILL",
                "level": 0,
                "spells_text": m.group(1).strip(),
                "raw_line": raw_line,
            })
            continue

        m = SLOT_RE.match(line)
        if m:
            lines.append({
                "kind": "SLOTS",
                "level": int(m.group(1)),
                "slots": int(m.group(2)),
                "spells_text": m.group(3).strip(),
                "raw_line": raw_line,
            })
            continue

        if re.search(
            r"\b(?:cantrips?|level|slots?|at will|/day)\b",
            line,
            re.IGNORECASE,
        ):
            unparsed_spellish.append(raw_line)

    return lines, unparsed_spellish

def preflight(db):
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
        "monsters", "metadata",
        "phase7_monster_registry",
        "phase7_monster_engine_profiles",
        "phase7_monster_action_profiles",
        "phase7_monster_automation_backlog",
        "phase7_v4_resolution_log",
        "phase7_v6_resolution_log",
    }
    missing = sorted(required - tables)
    if missing:
        raise RuntimeError("Missing tables: " + ", ".join(missing))

    actual = {
        "source_monsters": db.execute("SELECT COUNT(*) FROM monsters").fetchone()[0],
        "registry": db.execute("SELECT COUNT(*) FROM phase7_monster_registry").fetchone()[0],
        "engine_profiles": db.execute("SELECT COUNT(*) FROM phase7_monster_engine_profiles").fetchone()[0],
        "action_profiles": db.execute("SELECT COUNT(*) FROM phase7_monster_action_profiles").fetchone()[0],
        "automation_backlog": db.execute("SELECT COUNT(*) FROM phase7_monster_automation_backlog").fetchone()[0],
        "v4_resolution_rows": db.execute("SELECT COUNT(*) FROM phase7_v4_resolution_log").fetchone()[0],
        "v6_resolution_rows": db.execute("SELECT COUNT(*) FROM phase7_v6_resolution_log").fetchone()[0],
        "narrative_only_actions": db.execute(
            "SELECT COUNT(*) FROM phase7_monster_action_profiles WHERE profile_status='NARRATIVE_ONLY'"
        ).fetchone()[0],
    }
    for key, expected in EXPECTED.items():
        if actual[key] != expected:
            raise RuntimeError(f"State drift: {key} expected={expected} actual={actual[key]}")

    backlog = {
        r[0]: r[1]
        for r in db.execute("""
            SELECT gap_type, COUNT(*)
            FROM phase7_monster_automation_backlog
            GROUP BY gap_type
        """)
    }
    if backlog != EXPECTED_BACKLOG:
        raise RuntimeError(
            "V7 backlog state drift: "
            + json.dumps({"expected": EXPECTED_BACKLOG, "actual": backlog}, sort_keys=True)
        )
    return actual, backlog, integrity, len(fk)

def scan_project_evidence(root: Path):
    patterns = [
        ("SRD_521", re.compile(r"\bSRD\s*5\.2\.1\b|srd-5\.2\.1", re.I)),
        ("RULES_2024", re.compile(r"\b2024\b.*\b(?:SRD|rules?)\b|\b(?:SRD|rules?)\b.*\b2024\b", re.I)),
        ("CR_XP", re.compile(r"\b(?:challenge rating|CR)\b.*\bXP\b|\bXP\b.*\b(?:challenge rating|CR)\b", re.I)),
        ("PROFICIENCY_BONUS", re.compile(r"\bproficiency bonus\b", re.I)),
    ]
    rows = []
    for base in [root / "server", root / "src", root / "data", root]:
        if not base.exists():
            continue
        for path in base.rglob("*"):
            if not path.is_file() or path.suffix.lower() not in TEXT_EXTENSIONS:
                continue
            try:
                rel_parts = path.relative_to(root).parts
            except Exception:
                continue
            if any(part in SKIP_DIRS for part in rel_parts):
                continue
            if path.stat().st_size > 5_000_000:
                continue
            try:
                text = path.read_text(encoding="utf-8", errors="ignore")
            except Exception:
                continue
            for lineno, line in enumerate(text.splitlines(), 1):
                hits = [name for name, rx in patterns if rx.search(line)]
                if hits:
                    rows.append({
                        "path": str(path),
                        "line": lineno,
                        "evidence_types": hits,
                        "text": line[:1000],
                    })
    # De-dupe because root is scanned after subdirs too.
    uniq = {}
    for row in rows:
        uniq[(row["path"], row["line"], tuple(row["evidence_types"]))] = row
    return list(uniq.values())

def inspect_sqlite_evidence(project_root: Path):
    db_files = []
    data_root = project_root / "data"
    if data_root.exists():
        for path in data_root.rglob("*.sqlite"):
            db_files.append(path)

    schema_rows = []
    sample_rows = []
    keywords = ("xp", "proficiency", "challenge", "cr", "rules_version", "edition", "source")
    for db_path in sorted(set(db_files)):
        try:
            db = sqlite3.connect(f"file:{db_path.as_posix()}?mode=ro", uri=True)
        except Exception:
            continue
        try:
            tables = [
                r[0] for r in db.execute(
                    "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"
                )
            ]
            for table in tables:
                try:
                    cols = db.execute(f'PRAGMA table_info("{table}")').fetchall()
                except Exception:
                    continue
                col_names = [c[1] for c in cols]
                relevant = [
                    c for c in col_names
                    if any(k in normkey(c) for k in keywords)
                ]
                if not relevant:
                    continue
                schema_rows.append({
                    "database": str(db_path),
                    "table": table,
                    "columns": col_names,
                    "relevant_columns": relevant,
                })
                try:
                    quoted = ", ".join(f'"{c}"' for c in relevant[:8])
                    q = f'SELECT {quoted} FROM "{table}" LIMIT 25'
                    for row in db.execute(q):
                        sample_rows.append({
                            "database": str(db_path),
                            "table": table,
                            "columns": relevant[:8],
                            "values": list(row),
                        })
                except Exception:
                    pass
        finally:
            db.close()
    return schema_rows, sample_rows

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
        actual, backlog, integrity, fk_errors = preflight(db)

        registry = {
            r["monster_id"]: dict(r)
            for r in db.execute("SELECT * FROM phase7_monster_registry")
        }
        profiles = {
            r["monster_id"]: dict(r)
            for r in db.execute("SELECT * FROM phase7_monster_engine_profiles")
        }

        source_rows = {}
        for r in db.execute("SELECT id,name,stat_block_json FROM monsters ORDER BY name"):
            stat = jload(r["stat_block_json"])
            if not isinstance(stat, dict):
                raise RuntimeError(f"Malformed source stat_block_json: {r['id']}")
            source_rows[r["id"]] = {
                "name": r["name"],
                "stat": stat,
            }

        # ------------------------------------------------------------------
        # Spellcasting evidence / parseability
        # ------------------------------------------------------------------
        spell_rows = []
        spell_summary = Counter()
        spell_monsters = set()

        for mid, src in source_rows.items():
            traits = top_lookup(
                src["stat"],
                "traits", "specialAbilities", "special_abilities"
            )
            for trait_index, (name, desc, raw) in enumerate(list_named_entries(traits)):
                if not SPELL_TRAIT_NAME_RE.search(f"{name} {desc}"):
                    continue

                spell_monsters.add(mid)
                ability_match = ABILITY_RE.search(desc)
                save_match = SAVE_DC_RE.search(desc)
                attack_match = SPELL_ATTACK_RE.search(desc)
                caster_match = CASTER_LEVEL_RE.search(desc)
                spell_lines, unparsed_spellish = parse_spell_lines(desc)

                trait_kind = "OTHER"
                nname = name.lower()
                if "shared spellcasting" in nname:
                    trait_kind = "SHARED"
                elif "innate spellcasting" in nname:
                    trait_kind = "INNATE"
                elif "spellcasting" in nname:
                    trait_kind = "PREPARED_OR_KNOWN"
                elif "psionic" in nname:
                    trait_kind = "PSIONICS"

                strict_core = bool(
                    ability_match
                    and (
                        save_match
                        or attack_match
                        or caster_match
                        or spell_lines
                    )
                )
                strict_lists = bool(spell_lines) and not unparsed_spellish

                spell_rows.append({
                    "monster_id": mid,
                    "monster_name": src["name"],
                    "trait_index": trait_index,
                    "trait_name": name,
                    "trait_kind": trait_kind,
                    "ability": ability_match.group(1).lower() if ability_match else "",
                    "spell_save_dc": int(save_match.group(1)) if save_match else "",
                    "spell_attack_bonus": int(attack_match.group(1)) if attack_match else "",
                    "caster_level": int(caster_match.group(1)) if caster_match else "",
                    "parsed_spell_lines": spell_lines,
                    "unparsed_spellish_lines": unparsed_spellish,
                    "strict_core_fields": strict_core,
                    "strict_spell_list_lines": strict_lists,
                    "description": desc,
                    "raw_trait_json": raw,
                })
                spell_summary[f"kind:{trait_kind}"] += 1
                spell_summary["traits_total"] += 1
                spell_summary["with_ability"] += int(bool(ability_match))
                spell_summary["with_save_dc"] += int(bool(save_match))
                spell_summary["with_attack_bonus"] += int(bool(attack_match))
                spell_summary["with_caster_level"] += int(bool(caster_match))
                spell_summary["with_spell_lines"] += int(bool(spell_lines))
                spell_summary["strict_core_fields"] += int(strict_core)
                spell_summary["strict_spell_list_lines"] += int(strict_lists)

        write_csv(output / "spellcasting_trait_parseability.csv", spell_rows)
        write_csv(
            output / "spellcasting_parseability_summary.csv",
            [{"metric": k, "count": v} for k, v in sorted(spell_summary.items())],
        )

        # ------------------------------------------------------------------
        # Residual Recharge / Usage evidence outside already resolved action suffixes
        # ------------------------------------------------------------------
        residual_rows = []
        residual_monsters = defaultdict(set)

        def scan_entry(mid, monster_name, section, entry_index, name, desc):
            haystack_name = name or ""
            haystack_desc = desc or ""

            m = RECHARGE_ROLL_RE.search(haystack_name)
            if m:
                residual_rows.append({
                    "monster_id": mid,
                    "monster_name": monster_name,
                    "section": section,
                    "entry_index": entry_index,
                    "entry_name": name,
                    "evidence_type": "RECHARGE_NAME_D6",
                    "parsed_value": {
                        "minimum": int(m.group(1)),
                        "maximum": int(m.group(2) or m.group(1)),
                    },
                    "description": desc,
                })
                residual_monsters["RECHARGE_NAME_D6"].add(mid)

            m = RECHARGE_REST_RE.search(haystack_name)
            if m:
                rests = [m.group(1).lower()]
                if m.group(2):
                    rests.append(m.group(2).lower())
                residual_rows.append({
                    "monster_id": mid,
                    "monster_name": monster_name,
                    "section": section,
                    "entry_index": entry_index,
                    "entry_name": name,
                    "evidence_type": "RECHARGE_NAME_REST",
                    "parsed_value": {"rest_types": sorted(set(rests))},
                    "description": desc,
                })
                residual_monsters["RECHARGE_NAME_REST"].add(mid)

            m = USAGE_DAY_NAME_RE.search(haystack_name)
            if m:
                residual_rows.append({
                    "monster_id": mid,
                    "monster_name": monster_name,
                    "section": section,
                    "entry_index": entry_index,
                    "entry_name": name,
                    "evidence_type": "USAGE_NAME_PER_DAY",
                    "parsed_value": {"uses": int(m.group(1)), "period": "day"},
                    "description": desc,
                })
                residual_monsters["USAGE_NAME_PER_DAY"].add(mid)

            # Description-level evidence is audited but not automatically safe.
            desc_usage = sorted({int(x) for x in USAGE_TEXT_RE.findall(haystack_desc)})
            if desc_usage:
                residual_rows.append({
                    "monster_id": mid,
                    "monster_name": monster_name,
                    "section": section,
                    "entry_index": entry_index,
                    "entry_name": name,
                    "evidence_type": "USAGE_DESCRIPTION_PER_DAY",
                    "parsed_value": {"uses_seen": desc_usage},
                    "description": desc,
                })
                residual_monsters["USAGE_DESCRIPTION_PER_DAY"].add(mid)

            if re.search(r"\brecharg", haystack_desc, re.I):
                residual_rows.append({
                    "monster_id": mid,
                    "monster_name": monster_name,
                    "section": section,
                    "entry_index": entry_index,
                    "entry_name": name,
                    "evidence_type": "RECHARGE_DESCRIPTION_TEXT",
                    "parsed_value": {},
                    "description": desc,
                })
                residual_monsters["RECHARGE_DESCRIPTION_TEXT"].add(mid)

        for mid, src in source_rows.items():
            for section_name, aliases in [
                ("actions", ("actions",)),
                ("traits", ("traits", "specialAbilities", "special_abilities")),
                ("reactions", ("reactions",)),
                ("legendary_actions", ("legendaryActions", "legendary_actions")),
            ]:
                value = top_lookup(src["stat"], *aliases)
                for i, (name, desc, raw) in enumerate(list_named_entries(value)):
                    scan_entry(mid, src["name"], section_name, i, name, desc)

        write_csv(output / "residual_recharge_usage_evidence.csv", residual_rows)
        write_csv(
            output / "residual_recharge_usage_summary.csv",
            [
                {
                    "evidence_type": k,
                    "rows": sum(1 for r in residual_rows if r["evidence_type"] == k),
                    "monsters": len(v),
                }
                for k, v in sorted(residual_monsters.items())
            ],
        )

        # ------------------------------------------------------------------
        # Current metadata, source/attribution and CR distribution
        # ------------------------------------------------------------------
        metadata_rows = [dict(r) for r in db.execute("SELECT * FROM metadata ORDER BY key")]
        write_csv(output / "monsters_metadata.csv", metadata_rows)

        source_summary = Counter()
        cr_summary = Counter()
        rule_rows = []
        for mid, reg in registry.items():
            source_summary[(reg.get("source"), reg.get("attribution"))] += 1
            cr_summary[(reg.get("cr_text"), reg.get("cr_numeric"))] += 1
            rule_rows.append({
                "monster_id": mid,
                "monster_name": reg.get("name"),
                "source": reg.get("source"),
                "attribution": reg.get("attribution"),
                "cr_text": reg.get("cr_text"),
                "cr_numeric": reg.get("cr_numeric"),
                "xp_profile": profiles[mid].get("xp"),
                "proficiency_bonus_profile": profiles[mid].get("proficiency_bonus"),
                "rules_version_profile": profiles[mid].get("rules_version"),
            })
        write_csv(output / "rule_derivation_monster_inventory.csv", rule_rows)
        write_csv(
            output / "source_attribution_summary.csv",
            [
                {"source": k[0], "attribution": k[1], "monster_count": v}
                for k, v in source_summary.most_common()
            ],
        )
        write_csv(
            output / "challenge_rating_distribution.csv",
            [
                {"cr_text": k[0], "cr_numeric": k[1], "monster_count": v}
                for k, v in sorted(
                    cr_summary.items(),
                    key=lambda kv: (
                        float("inf") if kv[0][1] is None else kv[0][1],
                        str(kv[0][0]),
                    ),
                )
            ],
        )

        # ------------------------------------------------------------------
        # Search project text and SQLite data for authoritative derivation evidence
        # ------------------------------------------------------------------
        project_evidence = scan_project_evidence(PROJECT_ROOT)
        write_csv(output / "project_rule_derivation_text_evidence.csv", project_evidence)

        sqlite_schema, sqlite_samples = inspect_sqlite_evidence(PROJECT_ROOT)
        write_csv(output / "project_sqlite_rule_evidence_schema.csv", sqlite_schema)
        write_csv(output / "project_sqlite_rule_evidence_samples.csv", sqlite_samples)

        # ------------------------------------------------------------------
        # Backlog / closure candidates
        # ------------------------------------------------------------------
        write_csv(
            output / "v7_backlog_by_gap_type.csv",
            [
                {"gap_type": k, "backlog_rows": v}
                for k, v in sorted(backlog.items(), key=lambda kv: (-kv[1], kv[0]))
            ],
        )

        candidate_summary = [
            {
                "family": "spellcasting",
                "current_backlog": backlog["spellcasting"],
                "positive_source_monsters": len(spell_monsters),
                "positive_source_rows": len(spell_rows),
                "safe_to_auto_resolve_now": "NO",
                "reason": "Trait forms vary; V7 measures strict parseability first.",
            },
            {
                "family": "recharge_abilities",
                "current_backlog": backlog["recharge_abilities"],
                "positive_source_monsters": len(
                    residual_monsters["RECHARGE_NAME_D6"]
                    | residual_monsters["RECHARGE_NAME_REST"]
                    | residual_monsters["RECHARGE_DESCRIPTION_TEXT"]
                ),
                "positive_source_rows": sum(
                    1 for r in residual_rows
                    if r["evidence_type"].startswith("RECHARGE")
                ),
                "safe_to_auto_resolve_now": "NO",
                "reason": "Residual trait/description evidence must be separated from already-resolved action suffixes.",
            },
            {
                "family": "usage_limits_resources",
                "current_backlog": backlog["usage_limits_resources"],
                "positive_source_monsters": len(
                    residual_monsters["USAGE_NAME_PER_DAY"]
                    | residual_monsters["USAGE_DESCRIPTION_PER_DAY"]
                ),
                "positive_source_rows": sum(
                    1 for r in residual_rows
                    if r["evidence_type"].startswith("USAGE")
                ),
                "safe_to_auto_resolve_now": "NO",
                "reason": "Description-level /day can refer to spell lists or shared resources; scope must be proven.",
            },
            {
                "family": "xp",
                "current_backlog": backlog["xp"],
                "positive_source_monsters": 0,
                "positive_source_rows": 0,
                "safe_to_auto_resolve_now": "ONLY_IF_INTERNAL_CR_XP_MAPPING_FOUND",
                "reason": "Do not hardcode CR→XP without project-authoritative evidence.",
            },
            {
                "family": "proficiency_bonus",
                "current_backlog": backlog["proficiency_bonus"],
                "positive_source_monsters": 0,
                "positive_source_rows": 0,
                "safe_to_auto_resolve_now": "ONLY_IF_INTERNAL_CR_PB_MAPPING_FOUND",
                "reason": "Do not derive PB from CR without project-authoritative evidence.",
            },
            {
                "family": "rules_version",
                "current_backlog": backlog["rules_version"],
                "positive_source_monsters": 0,
                "positive_source_rows": 0,
                "safe_to_auto_resolve_now": "ONLY_IF_INTERNAL_SOURCE_VERSION_MAPPING_FOUND",
                "reason": "All records say SRD 5.2.1, but year/version mapping must be evidenced internally.",
            },
        ]
        write_csv(output / "v7_resolution_candidate_summary.csv", candidate_summary)

        report = {
            "package": "PHASE7_SPELLCASTING_RECHARGE_USAGE_RULE_DERIVATION_AUDIT_V7",
            "createdAt": now_iso(),
            "readOnly": True,
            "integrity": integrity,
            "foreignKeyErrors": fk_errors,
            "counts": actual,
            "backlog": backlog,
            "spellcastingTraits": len(spell_rows),
            "spellcastingMonsters": len(spell_monsters),
            "spellcastingStrictCoreRows": spell_summary["strict_core_fields"],
            "spellcastingStrictListRows": spell_summary["strict_spell_list_lines"],
            "residualRechargeUsageRows": len(residual_rows),
            "projectTextEvidenceRows": len(project_evidence),
            "projectSqliteEvidenceTables": len(sqlite_schema),
            "projectSqliteEvidenceSamples": len(sqlite_samples),
            "phaseStatus": "PHASE7_V7_RULE_DERIVATION_AUDIT_COMPLETE",
            "next": "REVIEW_V7_AND_BUILD_BOUNDED_SPELLCASTING_AND_DERIVATION_RESOLUTION",
        }
        (output / "phase7_spellcasting_recharge_usage_rule_derivation_audit_v7_report.json").write_text(
            json.dumps(report, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )

        summary = f"""# Phase 7 — Spellcasting / Recharge / Usage / Rule Derivation Audit V7

**Mode:** READ-ONLY

- Source monsters: {actual['source_monsters']}
- Current backlog: {actual['automation_backlog']}
- Narrative-only actions: {actual['narrative_only_actions']}
- Spellcasting-like trait rows: {len(spell_rows)}
- Monsters with spellcasting-like traits: {len(spell_monsters)}
- Spellcasting rows with strict core fields: {spell_summary['strict_core_fields']}
- Spellcasting rows with fully recognized spell-list line forms: {spell_summary['strict_spell_list_lines']}
- Residual recharge/usage evidence rows: {len(residual_rows)}
- Project text evidence rows for SRD/rules/CR/XP/PB: {len(project_evidence)}
- SQLite tables with potentially relevant rule-derivation columns: {len(sqlite_schema)}
- SQLite sample rows exported: {len(sqlite_samples)}
- Integrity: {integrity}
- Foreign-key errors: {fk_errors}

## Guardrails

1. Spellcasting is not resolved merely because a trait name contains `Spellcasting`.
2. `/day` inside a spell list is not automatically a generic monster resource.
3. Recharge/usage text in descriptions is audit evidence, not automatic mechanics.
4. XP, proficiency bonus, and rules version remain unresolved unless an internal project source
   proves the mapping.
5. This package modifies no database or source file.

**Status: PHASE7_V7_RULE_DERIVATION_AUDIT_COMPLETE**
"""
        (output / "PHASE7_SPELLCASTING_RECHARGE_USAGE_RULE_DERIVATION_AUDIT_V7_SUMMARY.md").write_text(
            summary,
            encoding="utf-8",
        )

        print("PHASE 7 SPELLCASTING/RECHARGE/USAGE/RULE DERIVATION AUDIT V7 COMPLETE")
        print("READ_ONLY=YES")
        print(f"INTEGRITY={integrity}")
        print(f"FOREIGN_KEYS={fk_errors}")
        print(f"SOURCE_MONSTERS={actual['source_monsters']}")
        print(f"AUTOMATION_BACKLOG={actual['automation_backlog']}")
        print(f"NARRATIVE_ONLY_ACTIONS={actual['narrative_only_actions']}")
        print(f"SPELLCASTING_TRAITS={len(spell_rows)}")
        print(f"SPELLCASTING_MONSTERS={len(spell_monsters)}")
        print(f"SPELLCASTING_STRICT_CORE_ROWS={spell_summary['strict_core_fields']}")
        print(f"SPELLCASTING_STRICT_LIST_ROWS={spell_summary['strict_spell_list_lines']}")
        print(f"RESIDUAL_RECHARGE_USAGE_ROWS={len(residual_rows)}")
        print(f"PROJECT_TEXT_EVIDENCE_ROWS={len(project_evidence)}")
        print(f"PROJECT_SQLITE_EVIDENCE_TABLES={len(sqlite_schema)}")
        print(f"PROJECT_SQLITE_EVIDENCE_SAMPLES={len(sqlite_samples)}")
        print("PHASE_STATUS=PHASE7_V7_RULE_DERIVATION_AUDIT_COMPLETE")
        print("NEXT=REVIEW_V7_AND_BUILD_BOUNDED_SPELLCASTING_AND_DERIVATION_RESOLUTION")
        print(f"OUTPUT={output}")
        return 0
    finally:
        db.close()

if __name__ == "__main__":
    raise SystemExit(main())
