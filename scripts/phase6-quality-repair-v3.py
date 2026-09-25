from __future__ import annotations

import argparse
import csv
import hashlib
import json
import re
import sqlite3
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

DEFAULT_PROJECT_ROOT = Path(r"F:\DND WEB VTT")
DEFAULT_DB = DEFAULT_PROJECT_ROOT / "data" / "compendium" / "rules_knowledge.sqlite"
DEFAULT_OUTPUT = DEFAULT_PROJECT_ROOT / "_phase6_quality_repair_v3"

EXPECTED_PRE = {
    "runtime_magic": 262,
    "runtime_poison": 14,
    "book_magic": 410,
    "book_poison": 11,
    "residual": 0,
    "old_queue": 0,
    "final_resolutions": 254,
    "automation_backlog": 934,
    "effective_extracted": 0,
    "recovered_magic_resolution": 104,
    "recovered_poison_resolution": 11,
}

EXPECTED_POST = {
    "runtime_magic": 262,
    "runtime_poison": 14,
    "book_magic": 303,
    "book_poison": 0,
    "residual": 0,
    "old_queue": 0,
    "final_resolutions": 254,
    "automation_backlog": 819,
    "effective_extracted": 0,
    "quarantined_magic_resolution": 104,
    "quarantined_poison_resolution": 11,
}

# Evidence-confirmed pre-v2 quality defects found in the local database.
# These are exact content IDs, so the repair cannot broaden accidentally.
PREEXISTING_HEADING_NOISE_IDS = (
    "book-magic-item.2014.dungeon-master-s-guide.ch-apter-7-i-tre-asure.153",
    "book-magic-item.2014.dungeon-master-s-guide.ch-apter-7-tre-asure.189",
    "book-magic-item.2014.dungeon-master-s-guide.ch-apter-7-treas-ure.219",
)

PREEXISTING_TITLE_REPAIRS = {
    "book-magic-item.2014.mordenkainen-s-tome-of-foes.m-ac-ic-item-greate-r-silver-sword.90": (
        "M AC IC ITEM: GREATE R SILVER SWORD",
        "GREATE R SILVER SWORD",
        "Source page 90 shows the generic heading prefix 'MAGIC ITEM:' immediately before the actual item title; V3 removes only that prefix and preserves the OCR title text.",
    ),
    "book-magic-item.2014.mordenkainen-s-tome-of-foes.m-ag-ic-item-infe-rnal-t-ack.168": (
        "M AG IC ITEM : INFE RNAL T ACK",
        "INFE RNAL T ACK",
        "Source page 168 shows the generic heading prefix 'MAGIC ITEM:' immediately before the actual item title; V3 removes only that prefix and preserves the OCR title text.",
    ),
}


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


def q1(db: sqlite3.Connection, sql: str, params: tuple[Any, ...] = ()) -> int:
    row = db.execute(sql, params).fetchone()
    return int(row[0]) if row else 0


def state(db: sqlite3.Connection, post: bool = False) -> dict[str, int]:
    out = {
        "runtime_magic": q1(db, "SELECT COUNT(*) FROM magic_item_registry"),
        "runtime_poison": q1(db, "SELECT COUNT(*) FROM poison_registry"),
        "book_magic": q1(db, "SELECT COUNT(*) FROM book_magic_item_registry"),
        "book_poison": q1(db, "SELECT COUNT(*) FROM book_poison_registry"),
        "residual": q1(db, "SELECT COUNT(*) FROM phase6_residual_review_queue"),
        "old_queue": q1(db, "SELECT COUNT(*) FROM phase6_content_review_queue"),
        "final_resolutions": q1(db, "SELECT COUNT(*) FROM phase6_final_resolution"),
        "automation_backlog": q1(db, "SELECT COUNT(*) FROM phase6_automation_backlog"),
        "effective_extracted": q1(db, "SELECT COUNT(*) FROM effective_validated_entities WHERE status='extracted'"),
    }
    if post:
        out["quarantined_magic_resolution"] = q1(
            db,
            "SELECT COUNT(*) FROM phase6_final_resolution WHERE resolution_scope='residual' AND resolution_class='v2-magic-recovery-quarantined'",
        )
        out["quarantined_poison_resolution"] = q1(
            db,
            "SELECT COUNT(*) FROM phase6_final_resolution WHERE resolution_scope='residual' AND resolution_class='v2-poison-recovery-quarantined'",
        )
    else:
        out["recovered_magic_resolution"] = q1(
            db,
            "SELECT COUNT(*) FROM phase6_final_resolution WHERE resolution_scope='residual' AND resolution_class='book-magic-item-recovered'",
        )
        out["recovered_poison_resolution"] = q1(
            db,
            "SELECT COUNT(*) FROM phase6_final_resolution WHERE resolution_scope='residual' AND resolution_class='book-poison-recovered'",
        )
    return out


def ensure_repair_schema(db: sqlite3.Connection) -> None:
    db.executescript(
        """
        CREATE TABLE IF NOT EXISTS phase6_quality_repair_batches(
          id TEXT PRIMARY KEY,
          created_at TEXT NOT NULL,
          source_db_sha256 TEXT NOT NULL,
          source_status TEXT NOT NULL,
          quarantined_magic_items INTEGER NOT NULL,
          quarantined_poisons INTEGER NOT NULL,
          removed_automation_rows INTEGER NOT NULL,
          preexisting_heading_noise_removed INTEGER NOT NULL,
          preexisting_title_repairs INTEGER NOT NULL,
          post_book_magic_count INTEGER NOT NULL,
          post_book_poison_count INTEGER NOT NULL,
          post_automation_backlog INTEGER NOT NULL,
          quality_status TEXT NOT NULL
        ) STRICT;

        CREATE TABLE IF NOT EXISTS phase6_quality_repair_resolution(
          content_id TEXT NOT NULL,
          entity_version_id TEXT,
          action TEXT NOT NULL,
          old_name TEXT,
          new_name TEXT,
          evidence_note TEXT NOT NULL,
          batch_id TEXT NOT NULL,
          PRIMARY KEY(content_id, action)
        ) STRICT;
        """
    )


def fetch_v2_promotions(db: sqlite3.Connection) -> tuple[list[sqlite3.Row], list[sqlite3.Row]]:
    magic = list(
        db.execute(
            """
            SELECT fr.*, bmi.book_magic_item_id, bmi.item_name,
                   bmi.validation_scope, bmi.source_id, bmi.source_page AS registry_source_page
            FROM phase6_final_resolution fr
            JOIN book_magic_item_registry bmi
              ON bmi.entity_version_id = fr.entity_version_id
             AND bmi.book_magic_item_id = fr.matched_content_id
            WHERE fr.resolution_scope='residual'
              AND fr.resolution_class='book-magic-item-recovered'
            ORDER BY fr.source_title, fr.source_page, fr.original_name
            """
        )
    )
    poison = list(
        db.execute(
            """
            SELECT fr.*, bp.book_poison_id, bp.poison_name,
                   bp.validation_scope, bp.source_id, bp.source_page AS registry_source_page
            FROM phase6_final_resolution fr
            JOIN book_poison_registry bp
              ON bp.entity_version_id = fr.entity_version_id
             AND bp.book_poison_id = fr.matched_content_id
            WHERE fr.resolution_scope='residual'
              AND fr.resolution_class='book-poison-recovered'
            ORDER BY fr.source_title, fr.source_page, fr.original_name
            """
        )
    )
    return magic, poison


def write_json(path: Path, data: Any) -> None:
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def write_csv(path: Path, rows: list[dict[str, Any]]) -> None:
    fields = list(rows[0].keys()) if rows else ["empty"]
    with path.open("w", encoding="utf-8-sig", newline="") as f:
        w = csv.DictWriter(f, fieldnames=fields)
        w.writeheader()
        if rows:
            w.writerows(rows)


def title_issue(name: str) -> str | None:
    """Independent conservative title QA for the remaining pre-v2 registry."""
    n = re.sub(r"\s+", " ", (name or "")).strip()
    compact = re.sub(r"[^a-z]", "", n.casefold())
    if not n:
        return "empty"
    if len(n) > 120:
        return "too-long"
    if len(n.split()) > 14:
        return "too-many-words"
    if re.search(r"(?i)\b(?:requires attunement|saving throw|as an action|bonus action|reaction|hit points?|damage)\b", n):
        return "mechanics-text-in-title"
    if re.search(r"(?i)\b(?:dc\s*\d+|\d+d(?:4|6|8|10|12|20|100))\b", n):
        return "mechanics-number-in-title"
    if re.match(r"(?i)^\s*(?:wondrous\s+item|weapon\s*\(|armor\s*\(|wand\s*,|ring\s*,|rod\s*,|staff\s*,|scroll\s*,|potion\s*,|ammunition\s*,|shield\s*,)", n):
        return "descriptor-in-title"
    if any(tok in compact for tok in (
        "chapter", "chaptre", "chaptter", "actionsonly", "legendaryactions",
        "proficiencybonus", "startingequipment", "samplepoisons", "habitatanytreasureany",
    )):
        return "heading-or-statblock-noise"
    if re.fullmatch(r"(?i)(actions?|reactions?|skills?|languages?|habitat|treasure|rarity|property|poison)", n):
        return "generic-heading"
    if n.endswith((".", ";")):
        return "sentence-ending"
    letters = sum(ch.isalpha() for ch in n)
    if letters < 3:
        return "too-few-letters"
    return None


def remaining_quality_issues(db: sqlite3.Connection) -> list[dict[str, Any]]:
    issues: list[dict[str, Any]] = []
    for row in db.execute(
        "SELECT book_magic_item_id,item_name,source_title,source_page,rules_version,validation_scope FROM book_magic_item_registry ORDER BY source_title,source_page,item_name"
    ):
        problem = title_issue(row["item_name"])
        if problem:
            issues.append({
                "content_id": row["book_magic_item_id"],
                "name": row["item_name"],
                "source_title": row["source_title"],
                "source_page": row["source_page"],
                "rules_version": row["rules_version"],
                "validation_scope": row["validation_scope"],
                "issue": problem,
            })
    return issues


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--db", default=str(DEFAULT_DB))
    ap.add_argument("--output", default=str(DEFAULT_OUTPUT))
    ap.add_argument("--apply", action="store_true")
    args = ap.parse_args()

    db_path = Path(args.db)
    output = Path(args.output)
    output.mkdir(parents=True, exist_ok=True)

    if not db_path.exists():
        raise RuntimeError(f"Database not found: {db_path}")

    source_sha = sha256_file(db_path)
    db = sqlite3.connect(db_path)
    db.row_factory = sqlite3.Row
    db.execute("PRAGMA foreign_keys=ON")

    integrity = db.execute("PRAGMA integrity_check").fetchone()[0]
    if integrity != "ok":
        raise RuntimeError(f"SQLite integrity failed: {integrity}")
    if list(db.execute("PRAGMA foreign_key_check")):
        raise RuntimeError("Foreign-key check failed before repair.")

    before = state(db, post=False)
    if before != EXPECTED_PRE:
        raise RuntimeError(f"Safety stop. Expected exact v2 state {EXPECTED_PRE}, got {before}")

    magic, poisons = fetch_v2_promotions(db)
    if len(magic) != 104 or len(poisons) != 11:
        raise RuntimeError(f"Safety stop. Expected 104/11 v2 promotions, got {len(magic)}/{len(poisons)}")

    magic_ids = [r["book_magic_item_id"] for r in magic]
    poison_ids = [r["book_poison_id"] for r in poisons]

    backlog_for_promotions = q1(
        db,
        f"SELECT COUNT(*) FROM phase6_automation_backlog WHERE content_id IN ({','.join('?' for _ in (magic_ids + poison_ids))})",
        tuple(magic_ids + poison_ids),
    )
    if backlog_for_promotions != 115:
        raise RuntimeError(f"Safety stop. Expected 115 v2 automation rows, got {backlog_for_promotions}")

    quarantined_magic = [
        {
            "content_id": r["book_magic_item_id"],
            "original_name": r["original_name"],
            "v2_recovered_name": r["recovered_name"],
            "registry_name": r["item_name"],
            "source_title": r["source_title"],
            "source_page": r["source_page"],
            "reason": "V2 recovery is quarantined because the parser used unbounded multi-entry source blocks and permissive descriptor matching; promotion is no longer trusted.",
        }
        for r in magic
    ]
    quarantined_poisons = [
        {
            "content_id": r["book_poison_id"],
            "original_name": r["original_name"],
            "v2_recovered_name": r["recovered_name"],
            "registry_name": r["poison_name"],
            "source_title": r["source_title"],
            "source_page": r["source_page"],
            "reason": "V2 poison profile is quarantined because the mechanics block could include adjacent poison entries, contaminating dice/conditions/damage fields.",
        }
        for r in poisons
    ]

    # Exact pre-v2 defects are verified before any mutation.
    heading_noise_rows = []
    for cid in PREEXISTING_HEADING_NOISE_IDS:
        r = db.execute(
            "SELECT book_magic_item_id,item_name,entity_version_id,source_title,source_page FROM book_magic_item_registry WHERE book_magic_item_id=?",
            (cid,),
        ).fetchone()
        if not r or "chapter" not in re.sub(r"[^a-z]", "", r["item_name"].casefold()):
            raise RuntimeError(f"Safety stop. Expected exact chapter-heading noise row is missing or changed: {cid}")
        heading_noise_rows.append(r)

    title_repair_rows = []
    for cid, (old_name, new_name, note) in PREEXISTING_TITLE_REPAIRS.items():
        r = db.execute(
            "SELECT book_magic_item_id,item_name,entity_version_id,source_title,source_page FROM book_magic_item_registry WHERE book_magic_item_id=?",
            (cid,),
        ).fetchone()
        if not r or r["item_name"] != old_name:
            raise RuntimeError(f"Safety stop. Expected exact title-repair row is missing or changed: {cid}")
        title_repair_rows.append((r, old_name, new_name, note))

    if args.apply:
        ensure_repair_schema(db)
        batch_id = f"phase6-quality-repair-v3-{datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ')}"
        db.execute("BEGIN IMMEDIATE")
        try:
            for r in magic:
                cid = r["book_magic_item_id"]
                db.execute("DELETE FROM book_magic_item_engine_profiles WHERE book_magic_item_id=?", (cid,))
                db.execute("DELETE FROM phase6_automation_backlog WHERE content_id=?", (cid,))
                db.execute("DELETE FROM book_magic_item_registry WHERE book_magic_item_id=?", (cid,))
                db.execute(
                    """
                    UPDATE phase6_final_resolution
                       SET resolution_class='v2-magic-recovery-quarantined',
                           destination='searchable-provenance-only',
                           matched_content_id=NULL,
                           evidence_note='V3 quality repair rejected the V2 promotion. The V2 parser could bind prose/table/statblock headings as titles and could read across adjacent item blocks. Source/entity provenance is preserved; this candidate requires bounded evidence before any future promotion.'
                     WHERE entity_version_id=? AND resolution_scope='residual'
                    """,
                    (r["entity_version_id"],),
                )

            for r in poisons:
                cid = r["book_poison_id"]
                db.execute("DELETE FROM book_poison_engine_profiles WHERE book_poison_id=?", (cid,))
                db.execute("DELETE FROM phase6_automation_backlog WHERE content_id=?", (cid,))
                db.execute("DELETE FROM book_poison_registry WHERE book_poison_id=?", (cid,))
                db.execute(
                    """
                    UPDATE phase6_final_resolution
                       SET resolution_class='v2-poison-recovery-quarantined',
                           destination='searchable-provenance-only',
                           matched_content_id=NULL,
                           evidence_note='V3 quality repair rejected the V2 poison promotion. The V2 mechanics window could read into adjacent poison entries and contaminate dice, conditions, and damage fields. Source/entity provenance is preserved for future bounded recovery.'
                     WHERE entity_version_id=? AND resolution_scope='residual'
                    """,
                    (r["entity_version_id"],),
                )

            # Remove three exact pre-v2 chapter-heading false positives.
            for r in heading_noise_rows:
                cid = r["book_magic_item_id"]
                db.execute("DELETE FROM book_magic_item_engine_profiles WHERE book_magic_item_id=?", (cid,))
                db.execute("DELETE FROM book_magic_item_registry WHERE book_magic_item_id=?", (cid,))
                db.execute(
                    """
                    INSERT INTO phase6_quality_repair_resolution(
                      content_id,entity_version_id,action,old_name,new_name,evidence_note,batch_id
                    ) VALUES(?,?,?,?,?,?,?)
                    """,
                    (cid,r["entity_version_id"],"preexisting-heading-noise-removed",r["item_name"],None,
                     "Exact local source context shows this registry row is a CHAPTER 7 / TREASURE running heading between real item blocks, not a magic-item title.",batch_id),
                )

            # Strip only the generic 'MAGIC ITEM:' heading prefix from two
            # evidence-confirmed Mordenkainen rows. Preserve the OCR title text.
            for r, old_name, new_name, note in title_repair_rows:
                cid = r["book_magic_item_id"]
                db.execute("UPDATE book_magic_item_registry SET item_name=? WHERE book_magic_item_id=?", (new_name,cid))
                db.execute(
                    """
                    INSERT INTO phase6_quality_repair_resolution(
                      content_id,entity_version_id,action,old_name,new_name,evidence_note,batch_id
                    ) VALUES(?,?,?,?,?,?,?)
                    """,
                    (cid,r["entity_version_id"],"preexisting-title-prefix-repaired",old_name,new_name,note,batch_id),
                )

            db.executescript(
                """
                DROP VIEW IF EXISTS effective_phase6_magic_items;
                CREATE VIEW effective_phase6_magic_items AS
                  SELECT magic_item_id AS content_id,item_name AS name,rules_version,source_title,'runtime-srd' AS content_scope
                  FROM magic_item_registry
                  UNION ALL
                  SELECT book_magic_item_id AS content_id,item_name AS name,rules_version,source_title,'validated-book' AS content_scope
                  FROM book_magic_item_registry;

                DROP VIEW IF EXISTS effective_phase6_poisons;
                CREATE VIEW effective_phase6_poisons AS
                  SELECT poison_id AS content_id,poison_name AS name,rules_version,source_title,'runtime-srd' AS content_scope
                  FROM poison_registry
                  UNION ALL
                  SELECT book_poison_id AS content_id,poison_name AS name,rules_version,source_title,'validated-book' AS content_scope
                  FROM book_poison_registry;
                """
            )

            after_preview = state(db, post=True)
            issues_preview = remaining_quality_issues(db)
            if after_preview != EXPECTED_POST:
                raise RuntimeError(f"Post-state mismatch before commit. Expected {EXPECTED_POST}, got {after_preview}")
            if issues_preview:
                raise RuntimeError(f"Conservative title QA found {len(issues_preview)} issue(s); refusing commit.")
            if q1(db, "SELECT COUNT(*) FROM book_magic_item_engine_profiles") != 303:
                raise RuntimeError("Book magic registry/profile count mismatch.")
            if q1(db, "SELECT COUNT(*) FROM book_poison_engine_profiles") != 0:
                raise RuntimeError("Book poison profiles remain after quarantine.")
            if q1(db, "SELECT COUNT(*) FROM book_magic_item_registry WHERE book_magic_item_id LIKE 'book-magic-item.final.%'") != 0:
                raise RuntimeError("V2 final magic IDs remain after quarantine.")
            if q1(db, "SELECT COUNT(*) FROM book_poison_registry WHERE book_poison_id LIKE 'book-poison.final.%'") != 0:
                raise RuntimeError("V2 final poison IDs remain after quarantine.")
            if list(db.execute("PRAGMA foreign_key_check")):
                raise RuntimeError("Foreign-key check failed after repair.")

            db.execute(
                """
                INSERT INTO phase6_quality_repair_batches(
                  id,created_at,source_db_sha256,source_status,
                  quarantined_magic_items,quarantined_poisons,removed_automation_rows,
                  preexisting_heading_noise_removed,preexisting_title_repairs,
                  post_book_magic_count,post_book_poison_count,post_automation_backlog,quality_status
                ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)
                """,
                (
                    batch_id, now_iso(), source_sha, "V2_FALSE_GREEN_REJECTED",
                    104, 11, 115, 3, 2, 303, 0, 819,
                    "SAFE_BASELINE_RESTORED_PHASE6_REOPENED",
                ),
            )
            db.commit()
        except Exception:
            db.rollback()
            raise

    after = state(db, post=True) if args.apply else before
    issues = remaining_quality_issues(db) if args.apply else []

    remaining_magic = [dict(r) for r in db.execute(
        "SELECT book_magic_item_id,item_name,rules_version,source_title,source_page,validation_scope FROM book_magic_item_registry ORDER BY rules_version,source_title,item_name"
    )]

    report = {
        "repairVersion": "3",
        "applied": bool(args.apply),
        "sourceDbSha256": source_sha,
        "stateBefore": before,
        "quarantinedMagicItems": 104,
        "quarantinedPoisons": 11,
        "removedAutomationRows": 115,
        "preexistingHeadingNoiseRemoved": 3,
        "preexistingTitlePrefixRepairs": 2,
        "stateAfter": after,
        "remainingTitleQualityIssues": len(issues),
        "phaseStatus": "SAFE_BASELINE_RESTORED_PHASE6_REOPENED" if args.apply else "DRY_RUN_ONLY",
        "nextRequiredStep": "Evidence-bounded recovery/finalization must run before Phase 6 can close. Phase 7 remains blocked.",
    }
    write_json(output / "phase6_quality_repair_v3_report.json", report)
    write_json(output / "quarantined_v2_magic_items.json", quarantined_magic)
    write_csv(output / "quarantined_v2_magic_items.csv", quarantined_magic)
    write_json(output / "quarantined_v2_poisons.json", quarantined_poisons)
    write_csv(output / "quarantined_v2_poisons.csv", quarantined_poisons)
    write_json(output / "remaining_validated_book_magic_items.json", remaining_magic)
    write_csv(output / "remaining_validated_book_magic_items.csv", remaining_magic)
    write_json(output / "remaining_title_quality_issues.json", issues)

    summary = f"""# Phase 6 Quality Repair V3\n\n- Applied: {bool(args.apply)}\n- V2 magic promotions quarantined: 104\n- V2 poison promotions quarantined: 11\n- Automation rows removed: 115\n- Remaining validated book magic items: {after.get('book_magic', before.get('book_magic'))}\n- Remaining validated book poisons: {after.get('book_poison', before.get('book_poison'))}\n- Automation backlog: {after.get('automation_backlog', before.get('automation_backlog'))}\n- Conservative title QA issues: {len(issues)}\n- Status: {'SAFE_BASELINE_RESTORED_PHASE6_REOPENED' if args.apply else 'DRY_RUN_ONLY'}\n\nPhase 6 is intentionally NOT closed by this repair. The false-green V2 recovery is removed from effective registries while source/entity provenance remains preserved. The next step is an evidence-bounded finalizer/recovery pass.\n"""
    (output / "PHASE6_QUALITY_REPAIR_V3_SUMMARY.md").write_text(summary, encoding="utf-8")

    print("PHASE 6 QUALITY REPAIR V3 COMPLETE")
    print(f"APPLIED={args.apply}")
    if args.apply:
        for k, v in after.items():
            print(f"{k.upper()}={v}")
        print(f"TITLE_QUALITY_ISSUES={len(issues)}")
        print("PHASE_STATUS=SAFE_BASELINE_RESTORED_PHASE6_REOPENED")
    print(f"OUTPUT={output}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
