from __future__ import annotations

import argparse
import hashlib
import json
import re
import sqlite3
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path

PROJECT_ROOT = Path(r"F:\DND WEB VTT")
DEFAULT_DB = PROJECT_ROOT / "data" / "compendium" / "monsters.sqlite"
DEFAULT_OUTPUT = PROJECT_ROOT / "_phase7_final_residual_classification_v10"

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
    "bonus_profiles": 0,
    "save_based_profiles": 136,
    "aoe_profiles": 52,
    "attack_profiles": 319,
    "xp_profiles": 293,
    "alignment_profiles": 0,
    "lair_profiles": 0,
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

EXPECTED_V10 = {
    "structured": 62,
    "not_applicable": 650,
    "quarantined": 742,
    "resolution_rows": 1454,
    "quarantine_rows": 742,
    "bonus_structured_monsters": 31,
    "bonus_structured_entries": 33,
    "bonus_na_monsters": 291,
    "save_structured_monsters": 31,
    "save_na_monsters": 155,
    "attack_na_monsters": 3,
    "aoe_na_monsters": 201,
    "aoe_quarantined_monsters": 69,
    "alignment_quarantined_monsters": 322,
    "lair_quarantined_monsters": 322,
    "xp_quarantined_monsters": 29,
    "backlog_after": 0,
}

V9_AUDITED_AOE_AMBIGUOUS_IDS = {
    "srd:air-elemental",
    "srd:androsphinx",
    "srd:animated-armor",
    "srd:ankheg",
    "srd:archmage",
    "srd:azer",
    "srd:balor",
    "srd:bearded-devil",
    "srd:behir",
    "srd:black-pudding",
    "srd:chain-devil",
    "srd:chuul",
    "srd:cloaker",
    "srd:darkmantle",
    "srd:dretch",
    "srd:dryad",
    "srd:efreeti",
    "srd:ettercap",
    "srd:fire-elemental",
    "srd:flesh-golem",
    "srd:flying-sword",
    "srd:gelatinous-cube",
    "srd:giant-fire-beetle",
    "srd:giant-octopus",
    "srd:giant-spider",
    "srd:giant-wolf-spider",
    "srd:gibbering-mouther",
    "srd:glabrezu",
    "srd:green-hag",
    "srd:hezrou",
    "srd:ice-devil",
    "srd:imp",
    "srd:kraken",
    "srd:lich",
    "srd:mage",
    "srd:magmin",
    "srd:marilith",
    "srd:medusa",
    "srd:mummy-lord",
    "srd:nalfeshnee",
    "srd:night-hag",
    "srd:nightmare",
    "srd:octopus",
    "srd:oni",
    "srd:pit-fiend",
    "srd:pseudodragon",
    "srd:purple-worm",
    "srd:quasit",
    "srd:remorhaz",
    "srd:rug-of-smothering",
    "srd:rust-monster",
    "srd:sahuagin",
    "srd:sea-hag",
    "srd:shield-guardian",
    "srd:shrieker",
    "srd:solar",
    "srd:spider",
    "srd:storm-giant",
    "srd:succubusincubus",
    "srd:swarm-of-bats",
    "srd:swarm-of-poisonous-snakes",
    "srd:swarm-of-quippers",
    "srd:swarm-of-spiders",
    "srd:tarrasque",
    "srd:treant",
    "srd:vrock",
    "srd:water-elemental",
    "srd:will-o-wisp",
    "srd:wraith",
}

BONUS_TRUE_IDS = {
    "srd:clay-golem",
    "srd:dryad",
    "srd:elephant",
    "srd:ghost",
    "srd:giant-hyena",
    "srd:giant-octopus",
    "srd:gnoll",
    "srd:goblin",
    "srd:gorgon",
    "srd:green-hag",
    "srd:harpy",
    "srd:lion",
    "srd:magmin",
    "srd:mammoth",
    "srd:octopus",
    "srd:orc",
    "srd:panther",
    "srd:phase-spider",
    "srd:priest",
    "srd:saber-toothed-tiger",
    "srd:sea-hag",
    "srd:shadow",
    "srd:solar",
    "srd:spy",
    "srd:tiger",
    "srd:treant",
    "srd:triceratops",
    "srd:vampire",
    "srd:warhorse",
    "srd:weretiger",
    "srd:will-o-wisp",
}

BONUS_NONSELF_IDS = {
    "srd:adult-copper-dragon",
    "srd:ancient-copper-dragon",
    "srd:copper-dragon-wyrmling",
    "srd:dretch",
    "srd:gibbering-mouther",
    "srd:stone-golem",
    "srd:young-copper-dragon",
}

ANTIMAGIC_SAVE_IDS = {
    "srd:animated-armor",
    "srd:flying-sword",
    "srd:rug-of-smothering",
}
DYNAMIC_SAVE_IDS = {
    "srd:ogre-zombie",
    "srd:zombie",
}
ALTERNATIVE_SAVE_IDS = {
    "srd:bulette",
}
SAVE_FALSE_POSITIVE_IDS = {
    "srd:knight",
}

STRICT_SAVE_RE = re.compile(
    r"\bDC\s+(\d{1,2})\s+"
    r"(Strength|Dexterity|Constitution|Intelligence|Wisdom|Charisma)\s+"
    r"saving\s+throw\b",
    re.IGNORECASE,
)
ANY_SAVE_RE = re.compile(r"\bsaving\s+throw\b", re.IGNORECASE)

BONUS_TEXT_RE = re.compile(r"\bbonus action\b", re.IGNORECASE)
ALIGNMENT_KEY_RE = re.compile(r"alignment", re.IGNORECASE)
ALIGNMENT_VALUE_RE = re.compile(
    r"\b(?:lawful|neutral|chaotic)\s+(?:good|neutral|evil)\b|"
    r"\b(?:unaligned|any alignment|any non-good alignment|any non-lawful alignment)\b",
    re.IGNORECASE,
)
LAIR_KEY_RE = re.compile(r"lair.?actions?", re.IGNORECASE)
LAIR_TEXT_RE = re.compile(r"\blair action\b", re.IGNORECASE)

AOE_HINT_RE = re.compile(
    r"\b(?:cone|line|radius|sphere|cylinder|cube|within\s+\d+\s+feet|"
    r"each creature in|creatures? in|area)\b",
    re.IGNORECASE,
)
ATTACK_HINT_RE = re.compile(
    r"\b(?:Melee|Ranged)\s+(?:Weapon|Spell)\s+Attack\b|\bto\s+hit\b|\bHit:\b",
    re.IGNORECASE,
)
XP_TEXT_RE = re.compile(r"\b(\d[\d,]*)\s*XP\b", re.IGNORECASE)

SECTION_ALIASES = [
    ("traits", ("traits", "specialAbilities", "special_abilities")),
    ("actions", ("actions",)),
    ("bonus_actions", ("bonusActions", "bonus_actions")),
    ("reactions", ("reactions",)),
    ("legendary_actions", ("legendaryActions", "legendary_actions")),
    ("lair_actions", ("lairActions", "lair_actions")),
]

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

def top_lookup(obj, *names):
    if not isinstance(obj, dict):
        return None
    idx = {normkey(k): k for k in obj.keys()}
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

def logical_digest(db, table):
    cols = [r[1] for r in db.execute(f'PRAGMA table_info("{table}")')]
    if not cols:
        raise RuntimeError(f"Missing table for digest: {table}")
    order = ", ".join(f'"{c}"' for c in cols)
    h = hashlib.sha256()
    for row in db.execute(f'SELECT {order} FROM "{table}" ORDER BY rowid'):
        h.update(cjson(list(row)).encode("utf-8"))
        h.update(b"\n")
    return h.hexdigest()

def current_counts(db):
    return {
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
        "bonus_profiles": db.execute(
            "SELECT COUNT(*) FROM phase7_monster_engine_profiles WHERE bonus_actions_json IS NOT NULL"
        ).fetchone()[0],
        "save_based_profiles": db.execute(
            "SELECT COUNT(*) FROM phase7_monster_engine_profiles WHERE save_based_abilities_json IS NOT NULL"
        ).fetchone()[0],
        "aoe_profiles": db.execute(
            "SELECT COUNT(*) FROM phase7_monster_engine_profiles WHERE aoe_definitions_json IS NOT NULL"
        ).fetchone()[0],
        "attack_profiles": db.execute(
            "SELECT COUNT(*) FROM phase7_monster_engine_profiles WHERE attack_profiles_json IS NOT NULL"
        ).fetchone()[0],
        "xp_profiles": db.execute(
            "SELECT COUNT(*) FROM phase7_monster_engine_profiles WHERE xp IS NOT NULL"
        ).fetchone()[0],
        "alignment_profiles": db.execute(
            "SELECT COUNT(*) FROM phase7_monster_engine_profiles WHERE alignment IS NOT NULL"
        ).fetchone()[0],
        "lair_profiles": db.execute(
            "SELECT COUNT(*) FROM phase7_monster_engine_profiles WHERE lair_actions_json IS NOT NULL"
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
        "phase7_v8_resolution_log",
    }
    missing = sorted(required - tables)
    if missing:
        raise RuntimeError("Missing required tables: " + ", ".join(missing))
    if "phase7_v10_resolution_log" in tables:
        raise RuntimeError("V10 already appears to be applied.")

    actual = current_counts(db)
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

def load_source(db):
    rows = {}
    for r in db.execute("SELECT id,name,search_text,stat_block_json FROM monsters ORDER BY id"):
        stat = jload(r[3])
        if not isinstance(stat, dict):
            raise RuntimeError(f"Malformed source JSON: {r[0]}")
        rows[r[0]] = {
            "name": r[1],
            "search_text": r[2] or "",
            "stat": stat,
        }
    return rows

def standard_entries(stat):
    for section, aliases in SECTION_ALIASES:
        for index, (name, desc, raw) in enumerate(
            list_named_entries(top_lookup(stat, *aliases))
        ):
            yield section, index, name, desc, raw

def bonus_evidence(source):
    evidence = defaultdict(list)
    for mid, src in source.items():
        for section, index, name, desc, raw in standard_entries(src["stat"]):
            if BONUS_TEXT_RE.search(desc):
                sentences = [
                    s.strip()
                    for s in re.split(r"(?<=[.!?])\s+", desc.replace("\n", " "))
                    if BONUS_TEXT_RE.search(s)
                ]
                evidence[mid].append({
                    "section": section,
                    "entry_index": index,
                    "entry_name": name,
                    "evidence_sentences": sentences,
                    "raw_description": desc,
                    "raw_entry": raw,
                })
    return evidence

def save_evidence(source, backlog_ids):
    strict = {}
    any_save = {}
    for mid in backlog_ids:
        found = []
        for section, index, name, desc, raw in standard_entries(source[mid]["stat"]):
            if not ANY_SAVE_RE.search(desc):
                continue
            clauses = [
                {
                    "dc_kind": "FIXED",
                    "dc": int(m.group(1)),
                    "abilities": [m.group(2).lower()],
                    "raw_match": m.group(0),
                }
                for m in STRICT_SAVE_RE.finditer(desc)
            ]
            found.append({
                "section": section,
                "entry_index": index,
                "entry_name": name,
                "clauses": clauses,
                "raw_description": desc,
                "raw_entry": raw,
            })
        any_save[mid] = found
        strict[mid] = [f for f in found if f["clauses"]]
    return strict, any_save

def aoe_hint_ids(source, backlog_ids):
    result = set()
    evidence = {}
    for mid in backlog_ids:
        found = []
        for section, index, name, desc, raw in standard_entries(source[mid]["stat"]):
            hits = [m.group(0) for m in AOE_HINT_RE.finditer(desc)]
            if hits:
                found.append({
                    "section": section,
                    "entry_index": index,
                    "entry_name": name,
                    "hint_matches": hits,
                    "raw_description": desc,
                })
        if found:
            result.add(mid)
            evidence[mid] = found
    return result, evidence

def attack_hint_ids(source, backlog_ids):
    result = set()
    evidence = {}
    for mid in backlog_ids:
        found = []
        for section, index, name, desc, raw in standard_entries(source[mid]["stat"]):
            if ATTACK_HINT_RE.search(desc):
                found.append({
                    "section": section,
                    "entry_index": index,
                    "entry_name": name,
                    "raw_description": desc,
                })
        if found:
            result.add(mid)
            evidence[mid] = found
    return result, evidence

def log_resolution(db, mid, gap, disposition, payload, evidence_rule):
    db.execute("""
        INSERT INTO phase7_v10_resolution_log
        (monster_id,gap_type,disposition,payload_json,evidence_rule,created_at)
        VALUES (?,?,?,?,?,?)
    """, (
        mid, gap, disposition, cjson(payload), evidence_rule, now_iso()
    ))

def quarantine(db, mid, gap, reason_code, payload, policy):
    db.execute("""
        INSERT INTO phase7_monster_quarantine
        (monster_id,gap_type,reason_code,evidence_json,resolution_policy,created_at)
        VALUES (?,?,?,?,?,?)
    """, (
        mid, gap, reason_code, cjson(payload), policy, now_iso()
    ))
    log_resolution(
        db, mid, gap, "QUARANTINED",
        {
            "reason_code": reason_code,
            "evidence": payload,
            "resolution_policy": policy,
        },
        "EXPLICIT_QUARANTINE_CLASSIFICATION"
    )

def apply_v10(db, output):
    preconditions(db)

    source_digest_before = logical_digest(db, "monsters")
    metadata_digest_before = logical_digest(db, "metadata")

    source = load_source(db)
    all_ids = set(source)
    if len(all_ids) != 322:
        raise RuntimeError("Unexpected source monster ID count.")

    backlog_ids = defaultdict(set)
    for mid, gap in db.execute(
        "SELECT monster_id,gap_type FROM phase7_monster_automation_backlog"
    ):
        backlog_ids[gap].add(mid)

    # V9 evidence guardrails.
    alignment_positive = set()
    for mid in backlog_ids["alignment"]:
        src = source[mid]
        matches = recursive_matches(src["stat"], ALIGNMENT_KEY_RE, ALIGNMENT_VALUE_RE)
        search_matches = ALIGNMENT_VALUE_RE.findall(src["search_text"])
        if matches or search_matches:
            alignment_positive.add(mid)
    if alignment_positive:
        raise RuntimeError(
            f"V10 evidence drift: alignment evidence unexpectedly exists for {sorted(alignment_positive)[:5]}"
        )

    lair_positive = set()
    for mid in backlog_ids["lair_actions"]:
        raw_text = json.dumps(source[mid]["stat"], ensure_ascii=False)
        matches = recursive_matches(source[mid]["stat"], LAIR_KEY_RE, LAIR_TEXT_RE)
        if matches or LAIR_TEXT_RE.search(raw_text):
            lair_positive.add(mid)
    if lair_positive:
        raise RuntimeError(
            f"V10 evidence drift: lair evidence unexpectedly exists for {sorted(lair_positive)[:5]}"
        )

    bonus_found = bonus_evidence(source)
    bonus_positive_ids = set(bonus_found)
    expected_bonus_all = BONUS_TRUE_IDS | BONUS_NONSELF_IDS
    if bonus_positive_ids != expected_bonus_all:
        raise RuntimeError(
            "V10 bonus evidence drift: "
            + json.dumps({
                "missing": sorted(expected_bonus_all - bonus_positive_ids),
                "extra": sorted(bonus_positive_ids - expected_bonus_all),
            })
        )
    bonus_entry_count = sum(len(bonus_found[mid]) for mid in BONUS_TRUE_IDS)
    if len(BONUS_TRUE_IDS) != 31 or bonus_entry_count != 33:
        raise RuntimeError(
            f"V10 curated bonus count drift monsters={len(BONUS_TRUE_IDS)} entries={bonus_entry_count}"
        )

    strict_saves, any_saves = save_evidence(source, backlog_ids["save_based_abilities"])
    strict_save_ids = {mid for mid, rows in strict_saves.items() if rows}
    if len(strict_save_ids) != 25:
        raise RuntimeError(f"V10 strict save evidence drift: expected=25 actual={len(strict_save_ids)}")

    any_nonstandard_ids = {
        mid for mid, rows in any_saves.items()
        if rows and mid not in strict_save_ids
    }
    expected_nonstandard = ANTIMAGIC_SAVE_IDS | DYNAMIC_SAVE_IDS | ALTERNATIVE_SAVE_IDS | SAVE_FALSE_POSITIVE_IDS
    if any_nonstandard_ids != expected_nonstandard:
        raise RuntimeError(
            "V10 nonstandard save drift: "
            + json.dumps({
                "missing": sorted(expected_nonstandard - any_nonstandard_ids),
                "extra": sorted(any_nonstandard_ids - expected_nonstandard),
            })
        )

    aoe_positive_ids, aoe_evidence = aoe_hint_ids(
        source, backlog_ids["aoe_definitions"]
    )
    if aoe_positive_ids != V9_AUDITED_AOE_AMBIGUOUS_IDS:
        raise RuntimeError(
            "V10 FIXED AoE evidence drift versus exact V9 audited set: "
            + json.dumps({
                "expected_count": len(V9_AUDITED_AOE_AMBIGUOUS_IDS),
                "actual_count": len(aoe_positive_ids),
                "missing": sorted(V9_AUDITED_AOE_AMBIGUOUS_IDS - aoe_positive_ids),
                "extra": sorted(aoe_positive_ids - V9_AUDITED_AOE_AMBIGUOUS_IDS),
            }, sort_keys=True)
        )

    attack_positive_ids, attack_evidence = attack_hint_ids(
        source, backlog_ids["attack_profiles"]
    )
    if attack_positive_ids:
        raise RuntimeError(
            f"V10 attack residual evidence drift: expected none, got {sorted(attack_positive_ids)}"
        )
    expected_attack_ids = {"srd:frog", "srd:sea-horse", "srd:shrieker"}
    if backlog_ids["attack_profiles"] != expected_attack_ids:
        raise RuntimeError(
            f"V10 attack residual IDs drift: {sorted(backlog_ids['attack_profiles'])}"
        )

    xp_direct = set()
    for mid in backlog_ids["xp"]:
        src = source[mid]
        raw_text = json.dumps(src["stat"], ensure_ascii=False)
        structured = recursive_matches(
            src["stat"], re.compile(r"^(xp|experience|experiencepoints)$", re.I)
        )
        if XP_TEXT_RE.search(raw_text + " " + src["search_text"]) or structured:
            xp_direct.add(mid)
        cr_num = db.execute(
            "SELECT cr_numeric FROM phase7_monster_registry WHERE monster_id=?",
            (mid,)
        ).fetchone()[0]
        if cr_num != 0:
            raise RuntimeError(f"V10 XP residual is not CR 0: {mid}={cr_num}")
    if xp_direct:
        raise RuntimeError(
            f"V10 XP direct evidence drift: expected none, got {sorted(xp_direct)}"
        )

    db.executescript("""
    CREATE TABLE phase7_v10_resolution_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        monster_id TEXT NOT NULL,
        gap_type TEXT NOT NULL,
        disposition TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        evidence_rule TEXT NOT NULL,
        created_at TEXT NOT NULL,
        UNIQUE(monster_id,gap_type),
        FOREIGN KEY (monster_id) REFERENCES phase7_monster_registry(monster_id)
    );

    CREATE TABLE phase7_monster_quarantine (
        monster_id TEXT NOT NULL,
        gap_type TEXT NOT NULL,
        reason_code TEXT NOT NULL,
        evidence_json TEXT NOT NULL,
        resolution_policy TEXT NOT NULL,
        created_at TEXT NOT NULL,
        PRIMARY KEY (monster_id,gap_type),
        FOREIGN KEY (monster_id) REFERENCES phase7_monster_registry(monster_id)
    );

    CREATE TABLE phase7_v10_batches (
        id TEXT PRIMARY KEY,
        created_at TEXT NOT NULL,
        structured_count INTEGER NOT NULL,
        not_applicable_count INTEGER NOT NULL,
        quarantined_count INTEGER NOT NULL,
        resolution_rows INTEGER NOT NULL,
        quarantine_rows INTEGER NOT NULL,
        bonus_structured_monsters INTEGER NOT NULL,
        bonus_structured_entries INTEGER NOT NULL,
        save_structured_monsters INTEGER NOT NULL,
        attack_na_monsters INTEGER NOT NULL,
        aoe_na_monsters INTEGER NOT NULL,
        aoe_quarantined_monsters INTEGER NOT NULL,
        alignment_quarantined_monsters INTEGER NOT NULL,
        lair_quarantined_monsters INTEGER NOT NULL,
        xp_quarantined_monsters INTEGER NOT NULL,
        backlog_after INTEGER NOT NULL,
        source_monsters_digest TEXT NOT NULL,
        source_metadata_digest TEXT NOT NULL,
        phase_status TEXT NOT NULL,
        package_version TEXT NOT NULL
    );
    """)

    # ----------------------------------------------------------
    # Alignment: source unavailable -> quarantine, never N/A.
    # ----------------------------------------------------------
    for mid in sorted(backlog_ids["alignment"]):
        quarantine(
            db, mid, "alignment",
            "SOURCE_FIELD_UNAVAILABLE",
            {
                "source_record_has_alignment_key_or_value": False,
                "search_text_has_alignment_value": False,
            },
            "DO_NOT_INFER_ALIGNMENT_WITHOUT_EXPLICIT_SOURCE"
        )

    # ----------------------------------------------------------
    # Lair Actions: source section unavailable -> quarantine.
    # ----------------------------------------------------------
    for mid in sorted(backlog_ids["lair_actions"]):
        quarantine(
            db, mid, "lair_actions",
            "SOURCE_SECTION_UNAVAILABLE",
            {
                "source_record_has_lair_action_key_or_text": False,
            },
            "DO_NOT_MARK_NOT_APPLICABLE_BECAUSE_COMPACT_STATBLOCK_SOURCE_MAY_OMIT_LAIR_CONTENT"
        )

    # ----------------------------------------------------------
    # CR 0 XP: official rule ambiguity -> quarantine.
    # ----------------------------------------------------------
    for mid in sorted(backlog_ids["xp"]):
        quarantine(
            db, mid, "xp",
            "OFFICIAL_CR0_XP_AMBIGUOUS",
            {
                "cr": 0,
                "direct_source_xp_evidence": False,
                "official_table_value": "0 or 10",
            },
            "REQUIRE_DIRECT_SOURCE_XP_OR_EXPLICIT_CAMPAIGN_POLICY_BEFORE_POPULATING"
        )

    # ----------------------------------------------------------
    # AoE: no hint -> N/A; hint present -> quarantine.
    # ----------------------------------------------------------
    for mid in sorted(backlog_ids["aoe_definitions"]):
        if mid in aoe_positive_ids:
            quarantine(
                db, mid, "aoe_definitions",
                "AREA_LIKE_TEXT_REQUIRES_CASE_SPECIFIC_SEMANTICS",
                {
                    "source_evidence": aoe_evidence[mid],
                    "existing_aoe_profile": None,
                },
                "DO_NOT_AUTOMATE_FROM_BROAD_RANGE_RADIUS_AREA_TEXT_WITHOUT_GEOMETRY_AND_TARGETING_REVIEW"
            )
        else:
            log_resolution(
                db, mid, "aoe_definitions", "NOT_APPLICABLE",
                {
                    "reason": "NO_AREA_HINT_IN_COMPLETE_STANDARD_STATBLOCK_SECTIONS",
                },
                "COMPLETE_STANDARD_SECTION_INVENTORY"
            )

    # ----------------------------------------------------------
    # Bonus Actions: 31 explicit self capabilities, 291 N/A.
    # ----------------------------------------------------------
    for mid in sorted(backlog_ids["bonus_actions"]):
        if mid in BONUS_TRUE_IDS:
            entries = bonus_found[mid]
            db.execute("""
                UPDATE phase7_monster_engine_profiles
                SET bonus_actions_json=?
                WHERE monster_id=?
            """, (cjson(entries), mid))
            log_resolution(
                db, mid, "bonus_actions", "STRUCTURED_SOURCE",
                {
                    "entries": entries,
                    "entry_count": len(entries),
                    "classification": "MONSTER_CAN_USE_BONUS_ACTION",
                },
                "CURATED_V9_EXPLICIT_SELF_BONUS_ACTION_EVIDENCE"
            )
        else:
            if mid in BONUS_NONSELF_IDS:
                payload = {
                    "reason": "BONUS_ACTION_TEXT_REFERS_TO_TARGET_OR_OTHER_CREATURE_NOT_MONSTER_CAPABILITY",
                    "source_evidence": bonus_found[mid],
                }
                evidence_rule = "CURATED_V9_NONSELF_BONUS_ACTION_FALSE_POSITIVE"
            else:
                payload = {
                    "reason": "NO_BONUS_ACTION_TEXT_IN_COMPLETE_STANDARD_STATBLOCK_SECTIONS",
                }
                evidence_rule = "COMPLETE_STANDARD_SECTION_INVENTORY"
            log_resolution(
                db, mid, "bonus_actions", "NOT_APPLICABLE",
                payload,
                evidence_rule
            )

    # ----------------------------------------------------------
    # Save-based abilities: 25 strict + 6 nonstandard structured.
    # ----------------------------------------------------------
    save_positive_ids = set(strict_save_ids)

    for mid in sorted(ANTIMAGIC_SAVE_IDS):
        rows = any_saves[mid]
        entry = rows[0]
        entry["clauses"] = [{
            "dc_kind": "REFERENCE",
            "dc_reference": "caster_spell_save_dc",
            "abilities": ["constitution"],
            "trigger": "targeted_by_dispel_magic",
            "failure": "falls_unconscious_for_1_minute",
        }]
        save_positive_ids.add(mid)

    for mid in sorted(ALTERNATIVE_SAVE_IDS):
        rows = any_saves[mid]
        entry = rows[0]
        entry["clauses"] = [{
            "dc_kind": "FIXED",
            "dc": 16,
            "abilities": ["strength", "dexterity"],
            "ability_choice": "target_choice",
            "trigger": "deadly_leap",
        }]
        save_positive_ids.add(mid)

    for mid in sorted(DYNAMIC_SAVE_IDS):
        rows = any_saves[mid]
        entry = rows[0]
        entry["clauses"] = [{
            "dc_kind": "EXPRESSION",
            "dc_expression": "5 + damage_taken",
            "abilities": ["constitution"],
            "trigger": "damage_reduces_to_0_hp",
            "exceptions": ["radiant_damage", "critical_hit"],
            "success": "drops_to_1_hp_instead",
        }]
        save_positive_ids.add(mid)

    if len(save_positive_ids) != 31:
        raise RuntimeError(
            f"V10 save structured count drift expected=31 actual={len(save_positive_ids)}"
        )

    for mid in sorted(backlog_ids["save_based_abilities"]):
        if mid in save_positive_ids:
            entries = strict_saves[mid] if mid in strict_save_ids else any_saves[mid]
            payload = {
                "entries": entries,
                "entry_count": len(entries),
                "source_evidence_preserved": True,
            }
            db.execute("""
                UPDATE phase7_monster_engine_profiles
                SET save_based_abilities_json=?
                WHERE monster_id=?
            """, (cjson(entries), mid))
            log_resolution(
                db, mid, "save_based_abilities", "STRUCTURED_SOURCE",
                payload,
                "V9_STRICT_OR_CURATED_NONSTANDARD_SAVE_EVIDENCE"
            )
        else:
            if mid in SAVE_FALSE_POSITIVE_IDS:
                payload = {
                    "reason": "TEXT_MODIFIES_ANOTHER_CREATURES_SAVE_BUT_DOES_NOT_REQUIRE_A_SAVE",
                    "source_evidence": any_saves[mid],
                }
                rule = "CURATED_V9_SAVE_FALSE_POSITIVE"
            else:
                payload = {
                    "reason": "NO_SAVING_THROW_PHRASE_IN_COMPLETE_STANDARD_STATBLOCK_SECTIONS",
                }
                rule = "COMPLETE_STANDARD_SECTION_INVENTORY"
            log_resolution(
                db, mid, "save_based_abilities", "NOT_APPLICABLE",
                payload, rule
            )

    # ----------------------------------------------------------
    # Attack profiles: the final three monsters have no attack.
    # ----------------------------------------------------------
    for mid in sorted(backlog_ids["attack_profiles"]):
        log_resolution(
            db, mid, "attack_profiles", "NOT_APPLICABLE",
            {
                "reason": "NO_ATTACK_LIKE_ENTRY_IN_COMPLETE_STANDARD_STATBLOCK_SECTIONS",
                "source_action_names": [
                    name for _, _, name, _, _ in standard_entries(source[mid]["stat"])
                ],
            },
            "V9_CASE_BY_CASE_RESIDUAL_ATTACK_REVIEW"
        )

    # Every original backlog row must now have exactly one V10 disposition.
    resolution_rows = db.execute(
        "SELECT COUNT(*) FROM phase7_v10_resolution_log"
    ).fetchone()[0]
    if resolution_rows != EXPECTED_V10["resolution_rows"]:
        raise RuntimeError(
            f"V10 resolution row mismatch expected={EXPECTED_V10['resolution_rows']} actual={resolution_rows}"
        )

    structured = db.execute("""
        SELECT COUNT(*) FROM phase7_v10_resolution_log
        WHERE disposition='STRUCTURED_SOURCE'
    """).fetchone()[0]
    not_applicable = db.execute("""
        SELECT COUNT(*) FROM phase7_v10_resolution_log
        WHERE disposition='NOT_APPLICABLE'
    """).fetchone()[0]
    quarantined = db.execute("""
        SELECT COUNT(*) FROM phase7_v10_resolution_log
        WHERE disposition='QUARANTINED'
    """).fetchone()[0]
    quarantine_rows = db.execute(
        "SELECT COUNT(*) FROM phase7_monster_quarantine"
    ).fetchone()[0]

    expected_dispositions = {
        "structured": EXPECTED_V10["structured"],
        "not_applicable": EXPECTED_V10["not_applicable"],
        "quarantined": EXPECTED_V10["quarantined"],
        "quarantine_rows": EXPECTED_V10["quarantine_rows"],
    }
    actual_dispositions = {
        "structured": structured,
        "not_applicable": not_applicable,
        "quarantined": quarantined,
        "quarantine_rows": quarantine_rows,
    }
    if actual_dispositions != expected_dispositions:
        raise RuntimeError(
            "V10 disposition count mismatch: "
            + json.dumps({
                "expected": expected_dispositions,
                "actual": actual_dispositions,
            }, sort_keys=True)
        )

    # Delete only after every row is classified.
    cur = db.execute("DELETE FROM phase7_monster_automation_backlog")
    if cur.rowcount != EXPECTED["automation_backlog"]:
        raise RuntimeError(
            f"V10 backlog delete count mismatch expected={EXPECTED['automation_backlog']} actual={cur.rowcount}"
        )

    backlog_after = db.execute(
        "SELECT COUNT(*) FROM phase7_monster_automation_backlog"
    ).fetchone()[0]
    if backlog_after != 0:
        raise RuntimeError(f"V10 backlog after expected=0 actual={backlog_after}")

    source_digest_after = logical_digest(db, "monsters")
    metadata_digest_after = logical_digest(db, "metadata")
    if source_digest_after != source_digest_before:
        raise RuntimeError("Source monsters table changed during V10.")
    if metadata_digest_after != metadata_digest_before:
        raise RuntimeError("Source metadata table changed during V10.")

    # Final field counts.
    bonus_profiles = db.execute("""
        SELECT COUNT(*) FROM phase7_monster_engine_profiles
        WHERE bonus_actions_json IS NOT NULL
    """).fetchone()[0]
    save_profiles = db.execute("""
        SELECT COUNT(*) FROM phase7_monster_engine_profiles
        WHERE save_based_abilities_json IS NOT NULL
    """).fetchone()[0]
    if bonus_profiles != 31:
        raise RuntimeError(f"V10 bonus profile count expected=31 actual={bonus_profiles}")
    if save_profiles != 167:
        raise RuntimeError(f"V10 save profile count expected=167 actual={save_profiles}")

    batch_id = "phase7-v10-" + datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    db.execute("""
        INSERT INTO phase7_v10_batches
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    """, (
        batch_id, now_iso(),
        structured, not_applicable, quarantined,
        resolution_rows, quarantine_rows,
        31, 33, 31, 3, 201, 69, 322, 322, 29,
        backlog_after,
        source_digest_after, metadata_digest_after,
        "FINAL_RESIDUALS_CLASSIFIED_READY_FOR_PHASE7_CLOSURE",
        "V10_FIXED"
    ))

    # Note: schema includes a trailing package_version column below.
    fk = db.execute("PRAGMA foreign_key_check").fetchall()
    if fk:
        raise RuntimeError(f"V10 introduced FK errors: {len(fk)}")

    output.mkdir(parents=True, exist_ok=True)
    report = {
        "package": "PHASE7_FINAL_RESIDUAL_CLASSIFICATION_V10_FIXED",
        "structured": structured,
        "notApplicable": not_applicable,
        "quarantined": quarantined,
        "resolutionRows": resolution_rows,
        "quarantineRows": quarantine_rows,
        "bonusStructuredMonsters": 31,
        "bonusStructuredEntries": 33,
        "saveStructuredMonsters": 31,
        "attackNotApplicableMonsters": 3,
        "aoeNotApplicableMonsters": 201,
        "aoeQuarantinedMonsters": 69,
        "alignmentQuarantinedMonsters": 322,
        "lairQuarantinedMonsters": 322,
        "xpQuarantinedMonsters": 29,
        "backlogAfter": backlog_after,
        "sourceMonstersUnchanged": True,
        "sourceMetadataUnchanged": True,
        "phaseStatus": "FINAL_RESIDUALS_CLASSIFIED_READY_FOR_PHASE7_CLOSURE",
        "next": "PHASE7_FINAL_CLOSURE_VERIFY",
    }
    (output / "phase7_final_residual_classification_v10_report.json").write_text(
        json.dumps(report, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )

    quarantine_summary = {
        gap: db.execute(
            "SELECT COUNT(*) FROM phase7_monster_quarantine WHERE gap_type=?",
            (gap,)
        ).fetchone()[0]
        for gap in ("alignment", "lair_actions", "xp", "aoe_definitions")
    }

    (output / "PHASE7_FINAL_RESIDUAL_CLASSIFICATION_V10_SUMMARY.md").write_text(
        f"""# Phase 7 — Final Residual Classification V10

- Structured from source evidence: {structured}
- Explicit NOT_APPLICABLE: {not_applicable}
- Quarantined unresolved/source-limited: {quarantined}
- Total V10 resolution rows: {resolution_rows}
- Active automation backlog after V10: {backlog_after}

## Structured
- Bonus Action monsters: 31
- Bonus Action source entries: 33
- Additional Save-based monsters: 31

## NOT_APPLICABLE
- Bonus Actions: 291
- Save-based abilities: 155
- Attack profiles: 3
- AoE definitions: 201

## Quarantine
- Alignment: {quarantine_summary['alignment']}
- Lair Actions: {quarantine_summary['lair_actions']}
- CR 0 XP: {quarantine_summary['xp']}
- AoE case-specific/ambiguous: {quarantine_summary['aoe_definitions']}

Quarantine means **unknown / unsupported by the current source contract**, not false and not absent.

The original `monsters` and `metadata` source tables are logically unchanged.

**Status: FINAL_RESIDUALS_CLASSIFIED_READY_FOR_PHASE7_CLOSURE**

Next: run an independent final Phase 7 closure verifier before declaring Phase 7 closed.
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
            print("V10_PRECHECK=PASS")
            return 0

        db.execute("BEGIN IMMEDIATE")
        try:
            report = apply_v10(db, Path(args.output))
            db.commit()
        except Exception:
            db.rollback()
            raise

        integrity = db.execute("PRAGMA integrity_check").fetchone()[0]
        fk = db.execute("PRAGMA foreign_key_check").fetchall()
        if integrity != "ok" or fk:
            raise RuntimeError(f"Post-V10 DB check failed integrity={integrity} fk={len(fk)}")

        print("PHASE 7 FINAL RESIDUAL CLASSIFICATION V10 APPLIED")
        print(f"STRUCTURED={report['structured']}")
        print(f"NOT_APPLICABLE={report['notApplicable']}")
        print(f"QUARANTINED={report['quarantined']}")
        print(f"V10_RESOLUTION_ROWS={report['resolutionRows']}")
        print(f"QUARANTINE_ROWS={report['quarantineRows']}")
        print(f"BONUS_STRUCTURED_MONSTERS={report['bonusStructuredMonsters']}")
        print(f"BONUS_STRUCTURED_ENTRIES={report['bonusStructuredEntries']}")
        print(f"SAVE_STRUCTURED_MONSTERS={report['saveStructuredMonsters']}")
        print(f"ATTACK_NOT_APPLICABLE={report['attackNotApplicableMonsters']}")
        print(f"AOE_NOT_APPLICABLE={report['aoeNotApplicableMonsters']}")
        print(f"AOE_QUARANTINED={report['aoeQuarantinedMonsters']}")
        print(f"ALIGNMENT_QUARANTINED={report['alignmentQuarantinedMonsters']}")
        print(f"LAIR_QUARANTINED={report['lairQuarantinedMonsters']}")
        print(f"XP_QUARANTINED={report['xpQuarantinedMonsters']}")
        print(f"AUTOMATION_BACKLOG={report['backlogAfter']}")
        print("SOURCE_MONSTERS_UNCHANGED=YES")
        print("SOURCE_METADATA_UNCHANGED=YES")
        print("INTEGRITY=ok")
        print("FOREIGN_KEYS=ok")
        print("PHASE_STATUS=FINAL_RESIDUALS_CLASSIFIED_READY_FOR_PHASE7_CLOSURE")
        print("NEXT=PHASE7_FINAL_CLOSURE_VERIFY")
        print(f"OUTPUT={args.output}")
        return 0
    finally:
        db.close()

if __name__ == "__main__":
    raise SystemExit(main())
