from __future__ import annotations

import argparse
import json
import re
import sqlite3
from pathlib import Path

DEFAULT_DB = Path(r"F:\DND WEB VTT\data\compendium\rules_knowledge.sqlite")

EXPECTED = {
    "runtime_magic": 262,
    "runtime_poison": 14,
    "book_magic": 303,
    "book_poison": 0,
    "residual": 0,
    "old_queue": 0,
    "final_resolutions": 254,
    "automation_backlog": 819,
    "effective_extracted": 0,
    "q_magic": 104,
    "q_poison": 11,
}


def q1(db, sql, params=()):
    return int(db.execute(sql, params).fetchone()[0])


def title_issue(name: str):
    n = re.sub(r"\s+", " ", (name or "")).strip()
    compact = re.sub(r"[^a-z]", "", n.casefold())
    if not n or len(n) > 120 or len(n.split()) > 14:
        return True
    if re.search(r"(?i)\b(?:requires attunement|saving throw|as an action|bonus action|reaction|hit points?|damage)\b", n):
        return True
    if re.search(r"(?i)\b(?:dc\s*\d+|\d+d(?:4|6|8|10|12|20|100))\b", n):
        return True
    if re.match(r"(?i)^\s*(?:wondrous\s+item|weapon\s*\(|armor\s*\(|wand\s*,|ring\s*,|rod\s*,|staff\s*,|scroll\s*,|potion\s*,|ammunition\s*,|shield\s*,)", n):
        return True
    if any(tok in compact for tok in ("chapter", "proficiencybonus", "startingequipment", "samplepoisons", "habitatanytreasureany")):
        return True
    if re.fullmatch(r"(?i)(actions?|reactions?|skills?|languages?|habitat|treasure|rarity|property|poison)", n):
        return True
    if n.endswith((".", ";")):
        return True
    return False


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--db", default=str(DEFAULT_DB))
    args = ap.parse_args()
    db = sqlite3.connect(args.db)
    db.row_factory = sqlite3.Row
    errors = []

    integrity = db.execute("PRAGMA integrity_check").fetchone()[0]
    if integrity != "ok": errors.append(f"integrity={integrity}")
    fk = list(db.execute("PRAGMA foreign_key_check"))
    if fk: errors.append(f"foreign_key_check={len(fk)}")

    got = {
        "runtime_magic": q1(db, "SELECT COUNT(*) FROM magic_item_registry"),
        "runtime_poison": q1(db, "SELECT COUNT(*) FROM poison_registry"),
        "book_magic": q1(db, "SELECT COUNT(*) FROM book_magic_item_registry"),
        "book_poison": q1(db, "SELECT COUNT(*) FROM book_poison_registry"),
        "residual": q1(db, "SELECT COUNT(*) FROM phase6_residual_review_queue"),
        "old_queue": q1(db, "SELECT COUNT(*) FROM phase6_content_review_queue"),
        "final_resolutions": q1(db, "SELECT COUNT(*) FROM phase6_final_resolution"),
        "automation_backlog": q1(db, "SELECT COUNT(*) FROM phase6_automation_backlog"),
        "effective_extracted": q1(db, "SELECT COUNT(*) FROM effective_validated_entities WHERE status='extracted'"),
        "q_magic": q1(db, "SELECT COUNT(*) FROM phase6_final_resolution WHERE resolution_scope='residual' AND resolution_class='v2-magic-recovery-quarantined'"),
        "q_poison": q1(db, "SELECT COUNT(*) FROM phase6_final_resolution WHERE resolution_scope='residual' AND resolution_class='v2-poison-recovery-quarantined'"),
    }
    for k, v in EXPECTED.items():
        if got[k] != v: errors.append(f"{k}: expected {v}, got {got[k]}")

    if q1(db, "SELECT COUNT(*) FROM phase6_final_resolution WHERE resolution_class IN ('book-magic-item-recovered','book-poison-recovered')") != 0:
        errors.append("v2 recovered resolution classes still active")
    if q1(db, "SELECT COUNT(*) FROM book_magic_item_registry WHERE book_magic_item_id LIKE 'book-magic-item.final.%'") != 0:
        errors.append("v2 final magic IDs still active")
    if q1(db, "SELECT COUNT(*) FROM book_poison_registry WHERE book_poison_id LIKE 'book-poison.final.%'") != 0:
        errors.append("v2 final poison IDs still active")
    if q1(db, "SELECT COUNT(*) FROM book_magic_item_engine_profiles") != 303:
        errors.append("book magic profile count != 303")
    if q1(db, "SELECT COUNT(*) FROM book_poison_engine_profiles") != 0:
        errors.append("book poison profile count != 0")
    if q1(db, "SELECT COUNT(*) FROM effective_phase6_magic_items") != 565:
        errors.append("effective magic count != 565")
    if q1(db, "SELECT COUNT(*) FROM effective_phase6_poisons") != 14:
        errors.append("effective poison count != 14")
    if q1(db, "SELECT COUNT(*) FROM phase6_quality_repair_resolution WHERE action='preexisting-heading-noise-removed'") != 3:
        errors.append("expected 3 pre-existing heading-noise removals")
    if q1(db, "SELECT COUNT(*) FROM phase6_quality_repair_resolution WHERE action='preexisting-title-prefix-repaired'") != 2:
        errors.append("expected 2 pre-existing title-prefix repairs")
    if q1(db, "SELECT COUNT(*) FROM book_magic_item_registry WHERE lower(replace(replace(replace(item_name,' ',''),':',''),'/','')) LIKE '%chapter%'") != 0:
        errors.append("chapter-heading text remains in validated book magic titles")
    if q1(db, "SELECT COUNT(*) FROM book_magic_item_registry WHERE lower(replace(replace(item_name,' ',''),':','')) LIKE 'magicitem%' OR lower(replace(replace(item_name,' ',''),':','')) LIKE 'macicitem%'") != 0:
        errors.append("generic MAGIC ITEM prefix remains in validated book magic titles")

    bad = []
    for r in db.execute("SELECT book_magic_item_id,item_name,source_title,source_page FROM book_magic_item_registry"):
        if title_issue(r["item_name"]):
            bad.append(dict(r))
    if bad:
        errors.append(f"independent conservative title QA found {len(bad)} row(s)")

    batch = db.execute("SELECT * FROM phase6_quality_repair_batches ORDER BY created_at DESC LIMIT 1").fetchone()
    if not batch:
        errors.append("missing phase6_quality_repair_batches row")
    elif batch["quality_status"] != "SAFE_BASELINE_RESTORED_PHASE6_REOPENED":
        errors.append(f"unexpected quality status {batch['quality_status']}")
    else:
        if batch["preexisting_heading_noise_removed"] != 3:
            errors.append("quality batch did not record 3 heading-noise removals")
        if batch["preexisting_title_repairs"] != 2:
            errors.append("quality batch did not record 2 title repairs")

    print("INTEGRITY=" + integrity)
    for k, v in got.items(): print(f"{k.upper()}={v}")
    print(f"INDEPENDENT_BAD_TITLES={len(bad)}")
    print(f"ERRORS={len(errors)}")
    if errors:
        for e in errors: print("ERROR: " + e)
        raise SystemExit(4)
    print("PHASE_STATUS=SAFE_BASELINE_RESTORED_PHASE6_REOPENED")
    print("NEXT=EVIDENCE_BOUNDED_PHASE6_FINALIZATION")

if __name__ == "__main__":
    main()
