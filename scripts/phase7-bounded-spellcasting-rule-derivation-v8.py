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
DEFAULT_OUTPUT = PROJECT_ROOT / "_phase7_bounded_spellcasting_rule_derivation_v8"

EXPECTED = {
    "source_monsters": 322,
    "registry": 322,
    "engine_profiles": 322,
    "action_profiles": 836,
    "automation_backlog": 3264,
    "v4_resolution_rows": 105,
    "v6_resolution_rows": 1248,
    "narrative_only_actions": 209,
    "existing_recharge_profiles": 71,
    "existing_usage_profiles": 22,
    "existing_spellcasting_profiles": 0,
    "existing_pb_profiles": 0,
    "existing_xp_profiles": 0,
    "existing_rules_version_profiles": 0,
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

EXPECTED_V8 = {
    "recharge_entries": 75,
    "recharge_monsters": 74,
    "recharge_na_monsters": 248,
    "usage_entries": 79,
    "usage_monsters": 57,
    "usage_na_monsters": 265,
    "spellcasting_traits": 39,
    "spellcasting_monsters": 37,
    "spellcasting_na_monsters": 285,
    "pb_derived": 322,
    "xp_derived": 293,
    "xp_unresolved_cr0": 29,
    "rules_version_derived": 322,
    "resolution_rows": 1903,
    "backlog_removed": 1810,
    "backlog_after": 1454,
}

EXPECTED_REMAINING_BACKLOG = {
    "alignment": 322,
    "aoe_definitions": 270,
    "bonus_actions": 322,
    "lair_actions": 322,
    "save_based_abilities": 186,
    "xp": 29,
    "attack_profiles": 3,
}

# Official 2024 Basic Rules / SRD 5.2.1 rule tables.
# XP for CR 0 is intentionally absent because the official table says "0 or 10".
XP_BY_CR = {
    "1/8": 25,
    "1/4": 50,
    "1/2": 100,
    "1": 200,
    "2": 450,
    "3": 700,
    "4": 1100,
    "5": 1800,
    "6": 2300,
    "7": 2900,
    "8": 3900,
    "9": 5000,
    "10": 5900,
    "11": 7200,
    "12": 8400,
    "13": 10000,
    "14": 11500,
    "15": 13000,
    "16": 15000,
    "17": 18000,
    "18": 20000,
    "19": 22000,
    "20": 25000,
    "21": 33000,
    "22": 41000,
    "23": 50000,
    "24": 62000,
    "25": 75000,
    "26": 90000,
    "27": 105000,
    "28": 120000,
    "29": 135000,
    "30": 155000,
}

def pb_for_cr(cr_numeric: float) -> int:
    if cr_numeric <= 4:
        return 2
    if cr_numeric <= 8:
        return 3
    if cr_numeric <= 12:
        return 4
    if cr_numeric <= 16:
        return 5
    if cr_numeric <= 20:
        return 6
    if cr_numeric <= 24:
        return 7
    if cr_numeric <= 28:
        return 8
    if cr_numeric <= 30:
        return 9
    raise ValueError(f"Unsupported CR for PB derivation: {cr_numeric}")

RECHARGE_ROLL_RE = re.compile(
    r"\(Recharge\s+([1-6])(?:\s*[-–]\s*([1-6]))?\)",
    re.IGNORECASE,
)
RECHARGE_REST_RE = re.compile(
    r"\(Recharges?\s+after\s+a\s+(Short|Long)(?:\s+or\s+(Long|Short))?\s+Rest\)",
    re.IGNORECASE,
)
USAGE_DAY_NAME_RE = re.compile(r"\(([1-9]\d*)\s*/\s*Day\)", re.IGNORECASE)

SPELL_TRAIT_NAME_RE = re.compile(
    r"\b(spellcasting|innate spellcasting|shared spellcasting|psionics?)\b",
    re.IGNORECASE,
)
ABILITY_RE = re.compile(
    r"\b(?:innate\s+)?spellcasting\s+ability\s+is\s+"
    r"(Strength|Dexterity|Constitution|Intelligence|Wisdom|Charisma)\b",
    re.IGNORECASE,
)
SHARED_ABILITY_RE = re.compile(
    r"\buses\s+(Strength|Dexterity|Constitution|Intelligence|Wisdom|Charisma)"
    r"\s+as\s+(?:her|his|its|their)\s+spellcasting\s+ability\b",
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
SINGLE_INNATE_RE = re.compile(
    r"\bcan\s+innately\s+cast\s+_([^_]+)_",
    re.IGNORECASE,
)
INTRO_AT_WILL_RE = re.compile(
    r"\bcan\s+cast\s+(.+?)\s+at\s+will\s+and\s+has\s+the\s+following\b",
    re.IGNORECASE,
)

SECTIONS = [
    ("actions", ("actions",)),
    ("traits", ("traits", "specialAbilities", "special_abilities")),
    ("reactions", ("reactions",)),
    ("legendary_actions", ("legendaryActions", "legendary_actions")),
]

def now_iso():
    return datetime.now(timezone.utc).isoformat()

def cjson(value):
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))

def jload(text):
    if text is None:
        return None
    try:
        return json.loads(text)
    except Exception:
        return None

def normkey(value):
    return re.sub(r"[^a-z0-9]", "", str(value).lower())

def top_lookup(obj, *names):
    if not isinstance(obj, dict):
        return None
    idx = {normkey(k): k for k in obj.keys()}
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

def split_spell_text(text: str):
    # Conservative split: commas are list delimiters in the audited source forms.
    return [x.strip().strip("*") for x in text.split(",") if x.strip()]

def parse_spell_lines(description: str):
    result = []
    for raw_line in description.splitlines():
        line = raw_line.strip()
        if not line:
            continue

        m = AT_WILL_RE.match(line)
        if m:
            result.append({
                "kind": "AT_WILL",
                "spells": split_spell_text(m.group(1)),
                "raw_line": raw_line,
            })
            continue

        m = DAY_LIST_RE.match(line)
        if m:
            result.append({
                "kind": "PER_DAY",
                "uses": int(m.group(1)),
                "period": "day",
                "spells": split_spell_text(m.group(2)),
                "raw_line": raw_line,
            })
            continue

        m = CANTRIP_RE.match(line)
        if m:
            result.append({
                "kind": "CANTRIP_AT_WILL",
                "level": 0,
                "spells": split_spell_text(m.group(1)),
                "raw_line": raw_line,
            })
            continue

        m = SLOT_RE.match(line)
        if m:
            result.append({
                "kind": "SLOTS",
                "level": int(m.group(1)),
                "slots": int(m.group(2)),
                "spells": split_spell_text(m.group(3)),
                "raw_line": raw_line,
            })
            continue

    return result

def spell_trait_kind(name: str):
    n = name.lower()
    if "shared spellcasting" in n:
        return "SHARED"
    if "innate spellcasting" in n:
        return "INNATE"
    if "spellcasting" in n:
        return "PREPARED_OR_KNOWN"
    if "psionic" in n:
        return "PSIONICS"
    return "OTHER"

def build_spell_trait(section, index, name, desc, raw):
    ability_match = ABILITY_RE.search(desc) or SHARED_ABILITY_RE.search(desc)
    save_match = SAVE_DC_RE.search(desc)
    attack_match = SPELL_ATTACK_RE.search(desc)
    caster_match = CASTER_LEVEL_RE.search(desc)
    lines = parse_spell_lines(desc)

    special_lines = []
    single = SINGLE_INNATE_RE.search(desc)
    if single:
        special_lines.append({
            "kind": "PER_DAY_FROM_TRAIT_NAME"
            if USAGE_DAY_NAME_RE.search(name)
            else "SINGLE_INNATE",
            "uses": int(USAGE_DAY_NAME_RE.search(name).group(1))
            if USAGE_DAY_NAME_RE.search(name)
            else None,
            "period": "day" if USAGE_DAY_NAME_RE.search(name) else None,
            "spells": [single.group(1).strip()],
            "raw_evidence": single.group(0),
        })

    intro = INTRO_AT_WILL_RE.search(desc)
    if intro:
        text = intro.group(1).strip()
        # The audited form is "disguise self and invisibility".
        parts = [p.strip() for p in re.split(r"\s+and\s+", text) if p.strip()]
        special_lines.append({
            "kind": "AT_WILL_INTRO_TEXT",
            "spells": parts,
            "raw_evidence": intro.group(0),
        })

    kind = spell_trait_kind(name)
    automation_ready = kind != "SHARED"
    parse_status = "STRUCTURED_RAW_PRESERVED"
    if kind == "SHARED":
        parse_status = "CONDITIONAL_SHARED_RAW_PRESERVED"
    elif ability_match and (lines or special_lines):
        parse_status = "BOUNDED_STRUCTURED"
    elif ability_match:
        parse_status = "PARTIAL_METADATA_RAW_PRESERVED"
    else:
        parse_status = "RAW_PRESERVED_ONLY"

    return {
        "section": section,
        "entry_index": index,
        "trait_name": name,
        "trait_kind": kind,
        "casting_ability": ability_match.group(1).lower() if ability_match else None,
        "spell_save_dc": int(save_match.group(1)) if save_match else None,
        "spell_attack_bonus": int(attack_match.group(1)) if attack_match else None,
        "caster_level": int(caster_match.group(1)) if caster_match else None,
        "spell_lines": lines,
        "special_spell_lines": special_lines,
        "automation_ready": automation_ready,
        "parse_status": parse_status,
        "raw_description": desc,
        "raw_entry": raw,
        "evidence": "EXPLICIT_NAMED_SPELLCASTING_TRAIT",
    }

def build_source_inventories(source_rows):
    recharge = defaultdict(list)
    usage = defaultdict(list)
    spellcasting = defaultdict(list)

    for mid, src in source_rows.items():
        stat = src["stat"]
        for section, aliases in SECTIONS:
            entries = list_named_entries(top_lookup(stat, *aliases))
            for index, (name, desc, raw) in enumerate(entries):
                rm = RECHARGE_ROLL_RE.search(name)
                if rm:
                    recharge[mid].append({
                        "section": section,
                        "entry_index": index,
                        "entry_name": name,
                        "kind": "D6_ROLL",
                        "die": "d6",
                        "minimum": int(rm.group(1)),
                        "maximum": int(rm.group(2) or rm.group(1)),
                        "evidence": "STRICT_ENTRY_NAME_RECHARGE",
                    })

                rr = RECHARGE_REST_RE.search(name)
                if rr:
                    rests = [rr.group(1).lower()]
                    if rr.group(2):
                        rests.append(rr.group(2).lower())
                    recharge[mid].append({
                        "section": section,
                        "entry_index": index,
                        "entry_name": name,
                        "kind": "REST",
                        "rest_types": sorted(set(rests)),
                        "evidence": "STRICT_ENTRY_NAME_RECHARGE",
                    })

                um = USAGE_DAY_NAME_RE.search(name)
                if um:
                    usage[mid].append({
                        "section": section,
                        "entry_index": index,
                        "entry_name": name,
                        "kind": "PER_DAY",
                        "uses": int(um.group(1)),
                        "period": "day",
                        "scope": "NAMED_STATBLOCK_ENTRY",
                        "evidence": "STRICT_ENTRY_NAME_USAGE",
                    })

                if SPELL_TRAIT_NAME_RE.search(name):
                    spell = build_spell_trait(section, index, name, desc, raw)
                    spellcasting[mid].append(spell)

                    # Per-day spell-list groups are scoped Spellcasting resources.
                    for line_index, line in enumerate(spell["spell_lines"]):
                        if line.get("kind") == "PER_DAY":
                            usage[mid].append({
                                "section": section,
                                "entry_index": index,
                                "entry_name": name,
                                "kind": "PER_DAY",
                                "uses": line["uses"],
                                "period": "day",
                                "scope": "SPELLCASTING_GROUP",
                                "spell_line_index": line_index,
                                "spells": line["spells"],
                                "evidence": "STRICT_SPELLCASTING_PER_DAY_LINE",
                            })

    return recharge, usage, spellcasting

def check_project_rules_version_evidence():
    content_library = PROJECT_ROOT / "src" / "lib" / "contentLibrary.ts"
    readme = PROJECT_ROOT / "README_M1_5_LOCAL_COMPENDIUM_CHARACTER_SHEETS.md"

    evidence = []
    if content_library.exists():
        text = content_library.read_text(encoding="utf-8", errors="ignore")
        if "SRD 5.2.1 (2024)" in text:
            evidence.append(str(content_library))
    if readme.exists():
        text = readme.read_text(encoding="utf-8", errors="ignore")
        if "SRD 5.2.1 (2024 rules)" in text:
            evidence.append(str(readme))

    if not evidence:
        raise RuntimeError(
            "Cannot derive rules_version: no internal project mapping from SRD 5.2.1 to 2024 was found."
        )
    return evidence

def current_counts(db):
    return {
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
        "existing_recharge_profiles": db.execute(
            "SELECT COUNT(*) FROM phase7_monster_engine_profiles WHERE recharge_abilities_json IS NOT NULL"
        ).fetchone()[0],
        "existing_usage_profiles": db.execute(
            "SELECT COUNT(*) FROM phase7_monster_engine_profiles WHERE usage_limits_resources_json IS NOT NULL"
        ).fetchone()[0],
        "existing_spellcasting_profiles": db.execute(
            "SELECT COUNT(*) FROM phase7_monster_engine_profiles WHERE spellcasting_json IS NOT NULL"
        ).fetchone()[0],
        "existing_pb_profiles": db.execute(
            "SELECT COUNT(*) FROM phase7_monster_engine_profiles WHERE proficiency_bonus IS NOT NULL"
        ).fetchone()[0],
        "existing_xp_profiles": db.execute(
            "SELECT COUNT(*) FROM phase7_monster_engine_profiles WHERE xp IS NOT NULL"
        ).fetchone()[0],
        "existing_rules_version_profiles": db.execute(
            "SELECT COUNT(*) FROM phase7_monster_engine_profiles WHERE rules_version IS NOT NULL"
        ).fetchone()[0],
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
        raise RuntimeError("Missing required tables: " + ", ".join(missing))
    if "phase7_v8_resolution_log" in tables:
        raise RuntimeError("V8 already appears to be applied.")

    actual = current_counts(db)
    for key, expected in EXPECTED.items():
        if actual[key] != expected:
            raise RuntimeError(f"State drift: {key} expected={expected} actual={actual[key]}")

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
            "Backlog state drift: "
            + json.dumps({"expected": EXPECTED_BACKLOG, "actual": backlog}, sort_keys=True)
        )

    metadata = {
        r[0]: r[1]
        for r in db.execute("SELECT key,value FROM metadata")
    }
    if "5.2.1" not in metadata.get("dataset_source", ""):
        raise RuntimeError("Monster dataset_source is not SRD 5.2.1.")
    if "srd-5.2.1" not in metadata.get("dataset_version", ""):
        raise RuntimeError("Monster dataset_version is not SRD 5.2.1.")

    rules_evidence = check_project_rules_version_evidence()
    return actual, backlog, rules_evidence

def log_resolution(db, mid, resolution_type, subject_key, payload, evidence_rule):
    db.execute("""
        INSERT INTO phase7_v8_resolution_log
        (monster_id,resolution_type,subject_key,payload_json,evidence_rule,created_at)
        VALUES (?,?,?,?,?,?)
    """, (
        mid, resolution_type, subject_key, cjson(payload),
        evidence_rule, now_iso()
    ))

def apply_v8(db, output: Path):
    _, _, rules_evidence_paths = preconditions(db)

    source_rows = {}
    for r in db.execute("SELECT id,name,stat_block_json FROM monsters ORDER BY id"):
        stat = jload(r[2])
        if not isinstance(stat, dict):
            raise RuntimeError(f"Malformed source JSON for {r[0]}")
        source_rows[r[0]] = {"name": r[1], "stat": stat}

    registry = {
        r[0]: {
            "name": r[1],
            "cr_text": r[2],
            "cr_numeric": r[3],
            "source": r[4],
        }
        for r in db.execute("""
            SELECT monster_id,name,cr_text,cr_numeric,source
            FROM phase7_monster_registry
        """)
    }

    if set(source_rows) != set(registry):
        raise RuntimeError("Source/registry monster ID set mismatch.")

    recharge, usage, spellcasting = build_source_inventories(source_rows)

    recharge_entries = sum(len(v) for v in recharge.values())
    usage_entries = sum(len(v) for v in usage.values())
    spell_traits = sum(len(v) for v in spellcasting.values())

    observed = {
        "recharge_entries": recharge_entries,
        "recharge_monsters": len(recharge),
        "recharge_na_monsters": len(source_rows) - len(recharge),
        "usage_entries": usage_entries,
        "usage_monsters": len(usage),
        "usage_na_monsters": len(source_rows) - len(usage),
        "spellcasting_traits": spell_traits,
        "spellcasting_monsters": len(spellcasting),
        "spellcasting_na_monsters": len(source_rows) - len(spellcasting),
    }
    for key, expected in EXPECTED_V8.items():
        if key in observed and observed[key] != expected:
            raise RuntimeError(f"V8 source inventory drift {key}: expected={expected} actual={observed[key]}")

    # Existing V4 positive profiles must be subsets of the complete source inventories.
    existing_recharge = {
        r[0] for r in db.execute("""
            SELECT monster_id FROM phase7_monster_engine_profiles
            WHERE recharge_abilities_json IS NOT NULL
        """)
    }
    existing_usage = {
        r[0] for r in db.execute("""
            SELECT monster_id FROM phase7_monster_engine_profiles
            WHERE usage_limits_resources_json IS NOT NULL
        """)
    }
    if not existing_recharge.issubset(set(recharge)):
        raise RuntimeError("Existing recharge profile exists outside V8 source inventory.")
    if not existing_usage.issubset(set(usage)):
        raise RuntimeError("Existing usage profile exists outside V8 source inventory.")

    db.executescript("""
    CREATE TABLE phase7_v8_resolution_log (
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

    CREATE TABLE phase7_v8_batches (
        id TEXT PRIMARY KEY,
        created_at TEXT NOT NULL,
        recharge_entries INTEGER NOT NULL,
        recharge_monsters INTEGER NOT NULL,
        recharge_na_monsters INTEGER NOT NULL,
        usage_entries INTEGER NOT NULL,
        usage_monsters INTEGER NOT NULL,
        usage_na_monsters INTEGER NOT NULL,
        spellcasting_traits INTEGER NOT NULL,
        spellcasting_monsters INTEGER NOT NULL,
        spellcasting_na_monsters INTEGER NOT NULL,
        pb_derived INTEGER NOT NULL,
        xp_derived INTEGER NOT NULL,
        xp_unresolved_cr0 INTEGER NOT NULL,
        rules_version_derived INTEGER NOT NULL,
        resolution_rows INTEGER NOT NULL,
        backlog_removed INTEGER NOT NULL,
        backlog_after INTEGER NOT NULL,
        phase_status TEXT NOT NULL
    );
    """)

    removed = 0

    # ------------------------------------------------------------------
    # Recharge: complete source inventory, then N/A for monsters with none.
    # ------------------------------------------------------------------
    for mid in source_rows:
        entries = recharge.get(mid, [])
        if entries:
            db.execute("""
                UPDATE phase7_monster_engine_profiles
                SET recharge_abilities_json=?
                WHERE monster_id=?
            """, (cjson(entries), mid))
            log_resolution(
                db, mid, "SOURCE_INVENTORY", "recharge_abilities",
                {"entries": entries, "entry_count": len(entries)},
                "COMPLETE_NAMED_ENTRY_RECHARGE_INVENTORY"
            )
        else:
            current = db.execute("""
                SELECT recharge_abilities_json
                FROM phase7_monster_engine_profiles
                WHERE monster_id=?
            """, (mid,)).fetchone()[0]
            if current is not None:
                raise RuntimeError(f"Recharge N/A conflict: {mid}")
            log_resolution(
                db, mid, "NOT_APPLICABLE", "recharge_abilities",
                {"semantic": "NOT_APPLICABLE", "reason": "NO_STANDARD_RECHARGE_NOTATION_IN_COMPLETE_SOURCE_SECTIONS"},
                "COMPLETE_SOURCE_LIMITED_USE_INVENTORY"
            )

    cur = db.execute("""
        DELETE FROM phase7_monster_automation_backlog
        WHERE gap_type='recharge_abilities'
    """)
    if cur.rowcount != EXPECTED_BACKLOG["recharge_abilities"]:
        raise RuntimeError(f"Unexpected recharge backlog deletion count: {cur.rowcount}")
    removed += cur.rowcount

    # ------------------------------------------------------------------
    # Usage: named N/Day + scoped per-day Spellcasting groups.
    # ------------------------------------------------------------------
    for mid in source_rows:
        entries = usage.get(mid, [])
        if entries:
            db.execute("""
                UPDATE phase7_monster_engine_profiles
                SET usage_limits_resources_json=?
                WHERE monster_id=?
            """, (cjson(entries), mid))
            log_resolution(
                db, mid, "SOURCE_INVENTORY", "usage_limits_resources",
                {"entries": entries, "entry_count": len(entries)},
                "COMPLETE_STANDARD_USAGE_AND_SCOPED_SPELLCASTING_INVENTORY"
            )
        else:
            current = db.execute("""
                SELECT usage_limits_resources_json
                FROM phase7_monster_engine_profiles
                WHERE monster_id=?
            """, (mid,)).fetchone()[0]
            if current is not None:
                raise RuntimeError(f"Usage N/A conflict: {mid}")
            log_resolution(
                db, mid, "NOT_APPLICABLE", "usage_limits_resources",
                {"semantic": "NOT_APPLICABLE", "reason": "NO_STANDARD_PER_DAY_USAGE_IN_COMPLETE_SOURCE_SECTIONS"},
                "COMPLETE_SOURCE_LIMITED_USE_INVENTORY"
            )

    cur = db.execute("""
        DELETE FROM phase7_monster_automation_backlog
        WHERE gap_type='usage_limits_resources'
    """)
    if cur.rowcount != EXPECTED_BACKLOG["usage_limits_resources"]:
        raise RuntimeError(f"Unexpected usage backlog deletion count: {cur.rowcount}")
    removed += cur.rowcount

    # ------------------------------------------------------------------
    # Spellcasting: preserve raw evidence for every positive trait.
    # ------------------------------------------------------------------
    for mid in source_rows:
        traits = spellcasting.get(mid, [])
        if traits:
            payload = {
                "traits": traits,
                "trait_count": len(traits),
                "automation_ready_trait_count": sum(
                    1 for t in traits if t.get("automation_ready")
                ),
                "raw_evidence_preserved": True,
            }
            db.execute("""
                UPDATE phase7_monster_engine_profiles
                SET spellcasting_json=?
                WHERE monster_id=?
            """, (cjson(payload), mid))
            log_resolution(
                db, mid, "SOURCE_INVENTORY", "spellcasting",
                payload,
                "EXPLICIT_NAMED_SPELLCASTING_TRAIT_IN_COMPLETE_SOURCE_TRAITS"
            )
        else:
            current = db.execute("""
                SELECT spellcasting_json
                FROM phase7_monster_engine_profiles
                WHERE monster_id=?
            """, (mid,)).fetchone()[0]
            if current is not None:
                raise RuntimeError(f"Spellcasting N/A conflict: {mid}")
            log_resolution(
                db, mid, "NOT_APPLICABLE", "spellcasting",
                {"semantic": "NOT_APPLICABLE", "reason": "NO_NAMED_SPELLCASTING_TRAIT_IN_COMPLETE_SOURCE_TRAITS"},
                "COMPLETE_SOURCE_TRAIT_PARTITION"
            )

    cur = db.execute("""
        DELETE FROM phase7_monster_automation_backlog
        WHERE gap_type='spellcasting'
    """)
    if cur.rowcount != EXPECTED_BACKLOG["spellcasting"]:
        raise RuntimeError(f"Unexpected spellcasting backlog deletion count: {cur.rowcount}")
    removed += cur.rowcount

    # ------------------------------------------------------------------
    # Proficiency Bonus: official 2024 PB-by-CR rule table.
    # ------------------------------------------------------------------
    pb_count = 0
    for mid, reg in registry.items():
        cr_num = reg["cr_numeric"]
        if cr_num is None:
            raise RuntimeError(f"Missing CR numeric for PB derivation: {mid}")
        pb = pb_for_cr(float(cr_num))
        db.execute("""
            UPDATE phase7_monster_engine_profiles
            SET proficiency_bonus=?
            WHERE monster_id=?
        """, (pb, mid))
        log_resolution(
            db, mid, "RULE_DERIVED", "proficiency_bonus",
            {
                "value": pb,
                "cr_text": reg["cr_text"],
                "cr_numeric": cr_num,
                "rule_source": "D&D 2024 Basic Rules / SRD 5.2.1 — Proficiency Bonus by Challenge Rating",
            },
            "OFFICIAL_2024_CR_TO_PB_TABLE"
        )
        pb_count += 1

    cur = db.execute("""
        DELETE FROM phase7_monster_automation_backlog
        WHERE gap_type='proficiency_bonus'
    """)
    if cur.rowcount != EXPECTED_BACKLOG["proficiency_bonus"]:
        raise RuntimeError(f"Unexpected PB backlog deletion count: {cur.rowcount}")
    removed += cur.rowcount

    # ------------------------------------------------------------------
    # XP: official 2024 XP-by-CR table, but CR 0 remains unresolved.
    # ------------------------------------------------------------------
    xp_count = 0
    xp_cr0 = 0
    for mid, reg in registry.items():
        cr_text = str(reg["cr_text"])
        cr_num = float(reg["cr_numeric"])
        if cr_num == 0:
            xp_cr0 += 1
            continue
        if cr_text not in XP_BY_CR:
            raise RuntimeError(f"No official XP mapping encoded for CR {cr_text}: {mid}")
        xp = XP_BY_CR[cr_text]
        db.execute("""
            UPDATE phase7_monster_engine_profiles
            SET xp=?
            WHERE monster_id=?
        """, (xp, mid))
        log_resolution(
            db, mid, "RULE_DERIVED", "xp",
            {
                "value": xp,
                "cr_text": cr_text,
                "cr_numeric": cr_num,
                "rule_source": "D&D 2024 Basic Rules / SRD 5.2.1 — Experience Points by Challenge Rating",
            },
            "OFFICIAL_2024_CR_TO_XP_TABLE_NONZERO_CR"
        )
        cur = db.execute("""
            DELETE FROM phase7_monster_automation_backlog
            WHERE monster_id=? AND gap_type='xp'
        """, (mid,))
        if cur.rowcount != 1:
            raise RuntimeError(f"Expected one XP backlog row for {mid}, got {cur.rowcount}")
        removed += 1
        xp_count += 1

    if xp_count != EXPECTED_V8["xp_derived"] or xp_cr0 != EXPECTED_V8["xp_unresolved_cr0"]:
        raise RuntimeError(f"XP derivation drift: derived={xp_count} cr0={xp_cr0}")

    # ------------------------------------------------------------------
    # Rules Version: internal project mapping ties this dataset to 2024.
    # ------------------------------------------------------------------
    rules_count = 0
    for mid, reg in registry.items():
        if reg["source"] != "srd-5.2.1":
            raise RuntimeError(f"Unexpected monster source for rules-version derivation: {mid}={reg['source']}")
        db.execute("""
            UPDATE phase7_monster_engine_profiles
            SET rules_version='2024'
            WHERE monster_id=?
        """, (mid,))
        log_resolution(
            db, mid, "RULE_DERIVED", "rules_version",
            {
                "value": "2024",
                "source": reg["source"],
                "internal_evidence_paths": rules_evidence_paths,
                "external_rule_source": "D&D SRD 5.2.1 / updated 2024 (5.5e) ruleset",
            },
            "PROJECT_SRD_5_2_1_TO_2024_MAPPING"
        )
        rules_count += 1

    cur = db.execute("""
        DELETE FROM phase7_monster_automation_backlog
        WHERE gap_type='rules_version'
    """)
    if cur.rowcount != EXPECTED_BACKLOG["rules_version"]:
        raise RuntimeError(f"Unexpected rules-version backlog deletion count: {cur.rowcount}")
    removed += cur.rowcount

    if pb_count != EXPECTED_V8["pb_derived"]:
        raise RuntimeError(f"PB derivation count drift: {pb_count}")
    if rules_count != EXPECTED_V8["rules_version_derived"]:
        raise RuntimeError(f"Rules-version derivation count drift: {rules_count}")

    resolution_rows = db.execute(
        "SELECT COUNT(*) FROM phase7_v8_resolution_log"
    ).fetchone()[0]
    if resolution_rows != EXPECTED_V8["resolution_rows"]:
        raise RuntimeError(
            f"V8 resolution row mismatch: expected={EXPECTED_V8['resolution_rows']} actual={resolution_rows}"
        )

    if removed != EXPECTED_V8["backlog_removed"]:
        raise RuntimeError(
            f"V8 backlog removal mismatch: expected={EXPECTED_V8['backlog_removed']} actual={removed}"
        )

    backlog_after = db.execute(
        "SELECT COUNT(*) FROM phase7_monster_automation_backlog"
    ).fetchone()[0]
    if backlog_after != EXPECTED_V8["backlog_after"]:
        raise RuntimeError(
            f"V8 backlog after mismatch: expected={EXPECTED_V8['backlog_after']} actual={backlog_after}"
        )

    remaining_backlog = {
        r[0]: r[1]
        for r in db.execute("""
            SELECT gap_type,COUNT(*)
            FROM phase7_monster_automation_backlog
            GROUP BY gap_type
        """)
    }
    if remaining_backlog != EXPECTED_REMAINING_BACKLOG:
        raise RuntimeError(
            "Unexpected V8 remaining backlog: "
            + json.dumps(remaining_backlog, sort_keys=True)
        )

    batch_id = "phase7-v8-" + datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    db.execute("""
        INSERT INTO phase7_v8_batches
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    """, (
        batch_id, now_iso(),
        recharge_entries, len(recharge), len(source_rows) - len(recharge),
        usage_entries, len(usage), len(source_rows) - len(usage),
        spell_traits, len(spellcasting), len(source_rows) - len(spellcasting),
        pb_count, xp_count, xp_cr0, rules_count,
        resolution_rows, removed, backlog_after,
        "BOUNDED_SPELLCASTING_RULE_DERIVATION_APPLIED_PHASE7_OPEN"
    ))

    fk = db.execute("PRAGMA foreign_key_check").fetchall()
    if fk:
        raise RuntimeError(f"V8 introduced FK errors: {len(fk)}")

    output.mkdir(parents=True, exist_ok=True)
    report = {
        "package": "PHASE7_BOUNDED_SPELLCASTING_RULE_DERIVATION_V8",
        "rechargeEntries": recharge_entries,
        "rechargeMonsters": len(recharge),
        "rechargeNotApplicable": len(source_rows) - len(recharge),
        "usageEntries": usage_entries,
        "usageMonsters": len(usage),
        "usageNotApplicable": len(source_rows) - len(usage),
        "spellcastingTraits": spell_traits,
        "spellcastingMonsters": len(spellcasting),
        "spellcastingNotApplicable": len(source_rows) - len(spellcasting),
        "proficiencyBonusDerived": pb_count,
        "xpDerived": xp_count,
        "xpUnresolvedCr0": xp_cr0,
        "rulesVersionDerived": rules_count,
        "resolutionRows": resolution_rows,
        "backlogRemoved": removed,
        "backlogAfter": backlog_after,
        "remainingBacklog": remaining_backlog,
        "phaseStatus": "BOUNDED_SPELLCASTING_RULE_DERIVATION_APPLIED_PHASE7_OPEN",
        "next": "PHASE7_FINAL_RESIDUAL_MONSTER_SEMANTICS_AUDIT",
    }
    (output / "phase7_bounded_spellcasting_rule_derivation_v8_report.json").write_text(
        json.dumps(report, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    (output / "PHASE7_BOUNDED_SPELLCASTING_RULE_DERIVATION_V8_SUMMARY.md").write_text(
        f"""# Phase 7 — Bounded Spellcasting / Rule Derivation V8

- Recharge entries: {recharge_entries} across {len(recharge)} monsters
- Recharge N/A: {len(source_rows)-len(recharge)}
- Usage entries: {usage_entries} across {len(usage)} monsters
- Usage N/A: {len(source_rows)-len(usage)}
- Spellcasting traits: {spell_traits} across {len(spellcasting)} monsters
- Spellcasting N/A: {len(source_rows)-len(spellcasting)}
- Proficiency Bonus derived: {pb_count}
- XP derived: {xp_count}
- XP intentionally unresolved at CR 0: {xp_cr0}
- Rules Version derived as 2024: {rules_count}
- V8 resolution rows: {resolution_rows}
- Backlog removed: {removed}
- Backlog remaining: {backlog_after}

## Remaining backlog

{json.dumps(remaining_backlog, ensure_ascii=False, indent=2)}

## Guardrails

- CR 0 XP remains unresolved because the official 2024 table is `0 or 10`.
- Shared/coven Spellcasting is preserved as conditional raw evidence and is not marked automation-ready.
- Per-day Spellcasting groups are scoped to Spellcasting resources.
- Recharge and usage are rebuilt from a complete source inventory rather than assuming one resource per monster.
- Rules Version requires an internal project SRD 5.2.1 → 2024 mapping before migration proceeds.

**Status: BOUNDED_SPELLCASTING_RULE_DERIVATION_APPLIED_PHASE7_OPEN**
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
            print("V8_PRECHECK=PASS")
            return 0

        db.execute("BEGIN IMMEDIATE")
        try:
            report = apply_v8(db, Path(args.output))
            db.commit()
        except Exception:
            db.rollback()
            raise

        integrity = db.execute("PRAGMA integrity_check").fetchone()[0]
        fk = db.execute("PRAGMA foreign_key_check").fetchall()
        if integrity != "ok" or fk:
            raise RuntimeError(f"Post-V8 DB check failed integrity={integrity} fk={len(fk)}")

        print("PHASE 7 BOUNDED SPELLCASTING/RULE DERIVATION V8 APPLIED")
        print(f"RECHARGE_ENTRIES={report['rechargeEntries']}")
        print(f"RECHARGE_MONSTERS={report['rechargeMonsters']}")
        print(f"RECHARGE_NOT_APPLICABLE={report['rechargeNotApplicable']}")
        print(f"USAGE_ENTRIES={report['usageEntries']}")
        print(f"USAGE_MONSTERS={report['usageMonsters']}")
        print(f"USAGE_NOT_APPLICABLE={report['usageNotApplicable']}")
        print(f"SPELLCASTING_TRAITS={report['spellcastingTraits']}")
        print(f"SPELLCASTING_MONSTERS={report['spellcastingMonsters']}")
        print(f"SPELLCASTING_NOT_APPLICABLE={report['spellcastingNotApplicable']}")
        print(f"PROFICIENCY_BONUS_DERIVED={report['proficiencyBonusDerived']}")
        print(f"XP_DERIVED={report['xpDerived']}")
        print(f"XP_UNRESOLVED_CR0={report['xpUnresolvedCr0']}")
        print(f"RULES_VERSION_DERIVED={report['rulesVersionDerived']}")
        print(f"V8_RESOLUTION_ROWS={report['resolutionRows']}")
        print(f"BACKLOG_REMOVED={report['backlogRemoved']}")
        print(f"AUTOMATION_BACKLOG={report['backlogAfter']}")
        print("INTEGRITY=ok")
        print("FOREIGN_KEYS=ok")
        print("PHASE_STATUS=BOUNDED_SPELLCASTING_RULE_DERIVATION_APPLIED_PHASE7_OPEN")
        print("NEXT=PHASE7_FINAL_RESIDUAL_MONSTER_SEMANTICS_AUDIT")
        print(f"OUTPUT={args.output}")
        return 0
    finally:
        db.close()

if __name__ == "__main__":
    raise SystemExit(main())
