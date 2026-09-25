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
RULES_DB = PROJECT_ROOT / "data" / "compendium" / "rules_knowledge.sqlite"
MONSTERS_DB = PROJECT_ROOT / "data" / "compendium" / "monsters.sqlite"
DEFAULT_OUTPUT = PROJECT_ROOT / "_phase8_family_semantics_audit_v5"

EXPECTED = {
    "registry_rows": 70,
    "structured_sections": 60,
    "review_sections": 10,
    "family_links": 77,
    "structured_links": 67,
    "review_links": 10,
    "backlog_rows": 67,
}

EXPECTED_STRUCTURED_FAMILY_COUNTS = {
    "chases": 8,
    "crafting": 1,
    "downtime_recovery": 1,
    "exploration_core": 11,
    "mounts": 3,
    "mounts_vehicles": 6,
    "movement_environment": 14,
    "objects": 6,
    "rests_survival": 10,
    "siege": 1,
    "traps": 6,
}

# These are evidence detectors, NOT rule parsers.
SIGNALS = {
    "dc_fixed": re.compile(r"\bDC\s*\d+\b", re.I),
    "dice_formula": re.compile(r"(?<![A-Za-z0-9])(?:\d+d\d+(?:\s*[+-]\s*\d+)?|d\d+)(?![A-Za-z0-9])", re.I),
    "distance": re.compile(r"\b\d+(?:\.\d+)?\s*(?:feet|foot|ft\.?|miles?|yards?)\b", re.I),
    "time_quantity": re.compile(r"\b\d+(?:\.\d+)?\s*(?:rounds?|minutes?|hours?|days?|weeks?)\b", re.I),
    "currency": re.compile(r"\b\d+(?:,\d{3})*(?:\.\d+)?\s*(?:CP|SP|EP|GP|PP)\b", re.I),
    "weight": re.compile(r"\b\d+(?:,\d{3})*(?:\.\d+)?\s*(?:pounds?|lb\.?)\b", re.I),
    "percentage": re.compile(r"\b\d+(?:\.\d+)?\s*%"),
    "multiplier": re.compile(r"\b(?:twice|half|double|triple|times)\b", re.I),
    "ability_check": re.compile(r"\b(?:ability check|Strength check|Dexterity check|Constitution check|Intelligence check|Wisdom check|Charisma check)\b", re.I),
    "saving_throw": re.compile(r"\b(?:saving throw|save)\b", re.I),
    "attack_roll": re.compile(r"\battack roll\b", re.I),
    "action_economy": re.compile(r"\b(?:Action|Bonus Action|Reaction)\b"),
    "speed_movement": re.compile(r"\b(?:Speed|movement|move|Travel Pace)\b", re.I),
    "rest_reference": re.compile(r"\b(?:Short Rest|Long Rest|rest)\b", re.I),
    "condition_reference": re.compile(r"\b(?:Exhaustion|Prone|Grappled|Restrained|Unconscious|Incapacitated)\b", re.I),
    "damage_reference": re.compile(r"\b(?:damage|Hit Points?|HP)\b", re.I),
    "table_reference": re.compile(r"\btable\b", re.I),
    "procedure_trigger": re.compile(r"\b(?:when|whenever|if|until|at the start|at the end|each time|per day|per hour)\b", re.I),
}

NUMERIC_SIGNAL_NAMES = {
    "dc_fixed","dice_formula","distance","time_quantity","currency",
    "weight","percentage","multiplier",
}
MECHANICAL_SIGNAL_NAMES = {
    "ability_check","saving_throw","attack_roll","action_economy",
    "speed_movement","rest_reference","condition_reference","damage_reference",
}
STRUCTURE_SIGNAL_NAMES = {"table_reference","procedure_trigger"}

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
                value = row.get(key, "")
                if isinstance(value, (dict, list)):
                    value = json.dumps(value, ensure_ascii=False, sort_keys=True)
                out[key] = value
            w.writerow(out)

def phase7_dependency():
    if not MONSTERS_DB.exists():
        return {"ok": False, "reason": "monsters.sqlite missing"}
    db = sqlite3.connect(f"file:{MONSTERS_DB.as_posix()}?mode=ro", uri=True)
    try:
        backlog = db.execute(
            "SELECT COUNT(*) FROM phase7_monster_automation_backlog"
        ).fetchone()[0]
        batch = db.execute("""
            SELECT phase_status,package_version,backlog_after
            FROM phase7_v10_batches ORDER BY created_at DESC LIMIT 1
        """).fetchone()
        ok = (
            backlog == 0 and batch
            and batch[0] == "FINAL_RESIDUALS_CLASSIFIED_READY_FOR_PHASE7_CLOSURE"
            and batch[1] == "V10_FIXED"
            and batch[2] == 0
        )
        return {"ok": bool(ok), "backlog": backlog, "batch": list(batch) if batch else None}
    finally:
        db.close()

def evidence_matches(text: str):
    evidence = {}
    for name, rx in SIGNALS.items():
        matches = []
        for m in rx.finditer(text or ""):
            value = re.sub(r"\s+", " ", m.group(0)).strip()
            if value not in matches:
                matches.append(value)
            if len(matches) >= 12:
                break
        if matches:
            evidence[name] = matches
    return evidence

def evidence_class(evidence: dict):
    names = set(evidence)
    numeric = names & NUMERIC_SIGNAL_NAMES
    mechanical = names & MECHANICAL_SIGNAL_NAMES
    structural = names & STRUCTURE_SIGNAL_NAMES

    # Deliberately conservative. These labels describe evidence density only.
    if numeric and mechanical:
        return "NUMERIC_PLUS_MECHANICAL_EVIDENCE"
    if numeric and structural:
        return "NUMERIC_PLUS_PROCEDURAL_EVIDENCE"
    if numeric:
        return "NUMERIC_EVIDENCE_ONLY"
    if mechanical and structural:
        return "MECHANICAL_PLUS_PROCEDURAL_EVIDENCE"
    if mechanical:
        return "MECHANICAL_EVIDENCE_ONLY"
    if structural:
        return "PROCEDURAL_EVIDENCE_ONLY"
    return "NARRATIVE_OR_TABLE_CONTEXT_ONLY"

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--db", default=str(RULES_DB))
    ap.add_argument("--output", default=str(DEFAULT_OUTPUT))
    args = ap.parse_args()

    output = Path(args.output)
    output.mkdir(parents=True, exist_ok=True)

    p7 = phase7_dependency()
    if not p7.get("ok"):
        raise RuntimeError(
            "Phase 8 V5 safety stop: Phase 7 dependency failed: "
            + json.dumps(p7, ensure_ascii=False)
        )

    db_path = Path(args.db)
    if not db_path.exists():
        raise RuntimeError(f"Missing rules database: {db_path}")

    db = sqlite3.connect(f"file:{db_path.as_posix()}?mode=ro", uri=True)
    db.row_factory = sqlite3.Row
    errors = []
    try:
        integrity = db.execute("PRAGMA integrity_check").fetchone()[0]
        fk = db.execute("PRAGMA foreign_key_check").fetchall()
        if integrity != "ok":
            errors.append(f"integrity={integrity}")
        if fk:
            errors.append(f"foreign_keys={len(fk)}")

        tables = {
            r[0] for r in db.execute(
                "SELECT name FROM sqlite_master WHERE type='table'"
            )
        }
        required = {
            "phase8_rule_registry","phase8_rule_family_links",
            "phase8_automation_backlog","phase8_baseline_batches",
            "sections","sources"
        }
        missing = sorted(required - tables)
        if missing:
            raise RuntimeError(f"Missing V4/canonical tables: {missing}")

        counts = {
            "registry_rows": db.execute(
                "SELECT COUNT(*) FROM phase8_rule_registry"
            ).fetchone()[0],
            "structured_sections": db.execute(
                "SELECT COUNT(*) FROM phase8_rule_registry WHERE disposition='STRUCTURED_RULE_CANDIDATE'"
            ).fetchone()[0],
            "review_sections": db.execute(
                "SELECT COUNT(*) FROM phase8_rule_registry WHERE disposition='REVIEW_CONTEXT'"
            ).fetchone()[0],
            "family_links": db.execute(
                "SELECT COUNT(*) FROM phase8_rule_family_links"
            ).fetchone()[0],
            "structured_links": db.execute(
                "SELECT COUNT(*) FROM phase8_rule_family_links WHERE disposition='STRUCTURED_RULE_CANDIDATE'"
            ).fetchone()[0],
            "review_links": db.execute(
                "SELECT COUNT(*) FROM phase8_rule_family_links WHERE disposition='REVIEW_CONTEXT'"
            ).fetchone()[0],
            "backlog_rows": db.execute(
                "SELECT COUNT(*) FROM phase8_automation_backlog"
            ).fetchone()[0],
        }
        for key, expected in EXPECTED.items():
            if counts[key] != expected:
                errors.append(
                    f"baseline_count[{key}] expected={expected} actual={counts[key]}"
                )

        family_counts = {
            r[0]: r[1] for r in db.execute("""
                SELECT family,COUNT(*)
                FROM phase8_rule_family_links
                WHERE disposition='STRUCTURED_RULE_CANDIDATE'
                GROUP BY family
            """)
        }
        if family_counts != EXPECTED_STRUCTURED_FAMILY_COUNTS:
            errors.append(
                "structured_family_counts expected="
                + json.dumps(EXPECTED_STRUCTURED_FAMILY_COUNTS, sort_keys=True)
                + " actual="
                + json.dumps(family_counts, sort_keys=True)
            )

        batch = db.execute("""
            SELECT phase_status,package_version,backlog_rows
            FROM phase8_baseline_batches
            ORDER BY created_at DESC LIMIT 1
        """).fetchone()
        if not batch:
            errors.append("missing_v4_batch")
        else:
            if batch[0] != "STRUCTURED_BASELINE_APPLIED_PHASE8_OPEN":
                errors.append(f"bad_v4_phase_status={batch[0]}")
            if batch[1] != "V4":
                errors.append(f"bad_v4_package_version={batch[1]}")
            if batch[2] != 67:
                errors.append(f"bad_v4_batch_backlog={batch[2]}")

        # One exact joined row per active V4 semantic backlog item.
        joined = list(db.execute("""
            SELECT
                b.section_id,b.family,b.gap_type,b.status,b.evidence_json,
                r.source_title,r.page_start,r.page_end,r.heading,
                r.source_section_digest,
                s.body,s.revision_id,
                src.rules_version,src.current_revision_id
            FROM phase8_automation_backlog b
            JOIN phase8_rule_registry r ON r.section_id=b.section_id
            JOIN sections s ON s.id=b.section_id
            JOIN sources src ON src.id=r.source_id
            WHERE b.gap_type='semantic_extraction'
              AND b.status='PENDING_SEMANTIC_EXTRACTION'
            ORDER BY b.family,r.source_title,r.page_start,r.heading,b.section_id
        """))
        if len(joined) != 67:
            errors.append(f"joined_backlog expected=67 actual={len(joined)}")

        evidence_rows = []
        for row in joined:
            # Current-revision guard.
            if row["revision_id"] != row["current_revision_id"]:
                errors.append(f"noncurrent_section={row['section_id']}")
            if row["rules_version"] != "2024":
                errors.append(f"wrong_rules_version={row['section_id']}:{row['rules_version']}")

            body = row["body"] or ""
            evidence = evidence_matches(body)
            names = set(evidence)
            numeric = sorted(names & NUMERIC_SIGNAL_NAMES)
            mechanical = sorted(names & MECHANICAL_SIGNAL_NAMES)
            structural = sorted(names & STRUCTURE_SIGNAL_NAMES)
            cls = evidence_class(evidence)

            evidence_rows.append({
                "section_id": row["section_id"],
                "family": row["family"],
                "source_title": row["source_title"],
                "page_start": row["page_start"],
                "page_end": row["page_end"],
                "heading": row["heading"],
                "evidence_class": cls,
                "numeric_signal_count": len(numeric),
                "mechanical_signal_count": len(mechanical),
                "structure_signal_count": len(structural),
                "numeric_signal_types": numeric,
                "mechanical_signal_types": mechanical,
                "structure_signal_types": structural,
                "all_signal_types": sorted(names),
                "evidence_matches": evidence,
                "body_length": len(body),
                "body_excerpt": re.sub(r"\s+", " ", body)[:1800],
            })

        # Summaries.
        class_counts = Counter(r["evidence_class"] for r in evidence_rows)
        signal_counts = Counter()
        for r in evidence_rows:
            for name in r["all_signal_types"]:
                signal_counts[name] += 1

        family_summary = []
        for family in sorted(family_counts):
            rows = [r for r in evidence_rows if r["family"] == family]
            classes = Counter(r["evidence_class"] for r in rows)
            sig = Counter()
            for r in rows:
                for name in r["all_signal_types"]:
                    sig[name] += 1
            family_summary.append({
                "family": family,
                "backlog_rows": len(rows),
                "evidence_class_counts": dict(sorted(classes.items())),
                "signal_type_counts": dict(sorted(sig.items())),
                "rows_with_numeric_evidence": sum(
                    1 for r in rows if r["numeric_signal_count"] > 0
                ),
                "rows_with_mechanical_evidence": sum(
                    1 for r in rows if r["mechanical_signal_count"] > 0
                ),
                "rows_with_procedural_evidence": sum(
                    1 for r in rows if r["structure_signal_count"] > 0
                ),
                "rows_with_no_detected_signal": sum(
                    1 for r in rows if not r["all_signal_types"]
                ),
            })

        # Review-context sections are kept separate and never added to the 67 backlog.
        review_rows = [
            dict(r) for r in db.execute("""
                SELECT r.section_id,r.source_title,r.page_start,r.page_end,r.heading,
                       s.body
                FROM phase8_rule_registry r
                JOIN sections s ON s.id=r.section_id
                WHERE r.disposition='REVIEW_CONTEXT'
                ORDER BY r.source_title,r.page_start,r.heading,r.section_id
            """)
        ]
        review_output = []
        for row in review_rows:
            evidence = evidence_matches(row["body"] or "")
            review_output.append({
                "section_id": row["section_id"],
                "source_title": row["source_title"],
                "page_start": row["page_start"],
                "page_end": row["page_end"],
                "heading": row["heading"],
                "evidence_class": evidence_class(evidence),
                "all_signal_types": sorted(evidence),
                "evidence_matches": evidence,
                "body_excerpt": re.sub(r"\s+", " ", row["body"] or "")[:1800],
            })

        if len(review_output) != 10:
            errors.append(f"review_context_rows expected=10 actual={len(review_output)}")

        write_csv(output / "phase8_v5_backlog_semantic_evidence.csv", evidence_rows)
        write_csv(output / "phase8_v5_family_semantic_summary.csv", family_summary)
        write_csv(output / "phase8_v5_review_context_evidence.csv", review_output)

        report = {
            "package": "PHASE8_FAMILY_SEMANTICS_AUDIT_V5",
            "createdAt": now_iso(),
            "readOnly": True,
            "phase7Dependency": p7,
            "integrity": integrity,
            "foreignKeyErrors": len(fk),
            "baselineCounts": counts,
            "structuredFamilyCounts": family_counts,
            "backlogEvidenceRows": len(evidence_rows),
            "reviewContextRows": len(review_output),
            "evidenceClassCounts": dict(sorted(class_counts.items())),
            "signalTypeCounts": dict(sorted(signal_counts.items())),
            "familySummary": family_summary,
            "errors": errors,
            "phaseStatus": (
                "PHASE8_FAMILY_SEMANTICS_AUDIT_COMPLETE"
                if not errors
                else "PHASE8_FAMILY_SEMANTICS_AUDIT_FAILED"
            ),
            "next": (
                "PHASE8_BOUNDED_SEMANTIC_EXTRACTION_V6"
                if not errors
                else "STOP_AND_REVIEW"
            ),
        }
        (output / "phase8_family_semantics_audit_v5_report.json").write_text(
            json.dumps(report, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )

        summary = [
            "# Phase 8 — Family Semantics Audit V5",
            "",
            "**Mode: READ-ONLY**",
            "",
            f"- Integrity: {integrity}",
            f"- Foreign-key errors: {len(fk)}",
            f"- Active V4 semantic backlog rows: {len(evidence_rows)}",
            f"- Review-context rows: {len(review_output)}",
            f"- Errors: {len(errors)}",
            "",
            "## Important interpretation",
            "",
            "V5 detects evidence shapes only. A numeric value, DC, dice formula, table, or",
            "mechanical keyword is not automatically treated as an executable rule.",
            "V6 may structure a rule only when the source wording supports its trigger,",
            "target/scope, operation, and value without invention.",
            "",
            "## Evidence classes",
        ]
        for key, value in sorted(class_counts.items()):
            summary.append(f"- {key}: {value}")
        summary += [
            "",
            f"**Status: {report['phaseStatus']}**",
        ]
        (output / "PHASE8_FAMILY_SEMANTICS_AUDIT_V5_SUMMARY.md").write_text(
            "\n".join(summary) + "\n",
            encoding="utf-8",
        )

        print("PHASE 8 FAMILY SEMANTICS AUDIT V5 COMPLETE")
        print("READ_ONLY=YES")
        print(f"INTEGRITY={integrity}")
        print(f"FOREIGN_KEYS={len(fk)}")
        print(f"REGISTRY_ROWS={counts['registry_rows']}")
        print(f"FAMILY_LINKS={counts['family_links']}")
        print(f"AUTOMATION_BACKLOG={counts['backlog_rows']}")
        print(f"BACKLOG_EVIDENCE_ROWS={len(evidence_rows)}")
        print(f"REVIEW_CONTEXT_ROWS={len(review_output)}")
        for key, value in sorted(class_counts.items()):
            safe = re.sub(r"[^A-Z0-9]+", "_", key.upper()).strip("_")
            print(f"EVIDENCE_CLASS_{safe}={value}")
        print(f"ERRORS={len(errors)}")
        for error in errors:
            print("ERROR:", error)
        print(f"PHASE_STATUS={report['phaseStatus']}")
        print(f"NEXT={report['next']}")
        print(f"OUTPUT={output}")
        return 0 if not errors else 1
    finally:
        db.close()

if __name__ == "__main__":
    raise SystemExit(main())
