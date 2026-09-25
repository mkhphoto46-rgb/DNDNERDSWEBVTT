from __future__ import annotations

import argparse
import csv
import json
import os
import re
import sqlite3
from collections import Counter, defaultdict
from datetime import datetime, timezone
from pathlib import Path

PROJECT_ROOT = Path(r"F:\DND WEB VTT")
DEFAULT_OUTPUT = PROJECT_ROOT / "_phase8_exploration_downtime_misc_audit_v1"

CATEGORY_PATTERNS = {
    "exploration_travel": [
        r"\bexploration\b", r"\btravel pace\b", r"\boverland\b", r"\btravel\b",
        r"\bmarch(?:ing)?\b", r"\bforag(?:e|ing)\b", r"\bnavigat(?:e|ion)\b",
        r"\bgetting lost\b", r"\bdifficult terrain\b",
    ],
    "movement_environment": [
        r"\bclimb(?:ing)?\b", r"\bswim(?:ming)?\b", r"\bjump(?:ing)?\b",
        r"\bfall(?:ing)?\b", r"\bsuffocat(?:e|ing|ion)\b",
        r"\bunderwater\b", r"\bhigh altitude\b", r"\bextreme cold\b",
        r"\bextreme heat\b", r"\bstrong wind\b", r"\bslippery ice\b",
        r"\bfrigid water\b", r"\bquicksand\b",
    ],
    "downtime": [
        r"\bdowntime\b", r"\bcarous(?:e|ing)\b", r"\bresearch\b",
        r"\btraining\b", r"\brecuperat(?:e|ing|ion)\b",
        r"\bworking\b", r"\bwork activity\b",
    ],
    "crafting": [
        r"\bcraft(?:ing|ed)?\b", r"\bcrafting time\b", r"\bcrafting cost\b",
        r"\bartisan'?s tools\b", r"\btool proficiency\b",
        r"\bmaterials?\b", r"\brecipe\b",
    ],
    "hazards_traps": [
        r"\bhazard\b", r"\btrap\b", r"\bcomplex trap\b", r"\bsimple trap\b",
        r"\benvironmental hazard\b", r"\bdanger\b",
    ],
    "objects_structures": [
        r"\bobject(?:s)?\b", r"\bobject ac\b", r"\bobject hit points?\b",
        r"\bdamage threshold\b", r"\bbreaking objects?\b",
        r"\bstructure(?:s)?\b",
    ],
    "rests_recovery": [
        r"\bshort rest\b", r"\blong rest\b", r"\bresting\b",
        r"\bexhaustion\b", r"\bfood\b", r"\bwater\b", r"\bsleep\b",
    ],
    "misc_world_rules": [
        r"\bmounted combat\b", r"\bmounts?\b", r"\bvehicles?\b",
        r"\bchase\b", r"\bsiege\b", r"\bimprovised damage\b",
        r"\bcover\b", r"\bvisibility\b", r"\blight\b", r"\bdarkness\b",
    ],
}

COMPILED = {
    cat: [re.compile(p, re.I) for p in pats]
    for cat, pats in CATEGORY_PATTERNS.items()
}

TEXT_EXTENSIONS = {
    ".ts", ".tsx", ".js", ".mjs", ".cjs", ".json", ".md", ".txt", ".csv"
}
SKIP_DIRS = {
    "node_modules", "dist", ".git", "_hotfix_backups",
    "PHASE7_STRUCTURED_MONSTER_BASELINE_V2_FIXED",
    "PHASE7_EVIDENCE_BOUNDED_MONSTER_RULES_AUDIT_V3",
    "PHASE7_STRICT_ACTION_SEMANTICS_V4",
    "PHASE7_SAVE_AOE_OPTIONAL_SEMANTICS_AUDIT_V5",
    "PHASE7_STRICT_SAVE_AOE_OPTIONAL_RESOLUTION_V6",
    "PHASE7_STRICT_SAVE_AOE_OPTIONAL_RESOLUTION_V6_FIXED",
    "PHASE7_SPELLCASTING_RECHARGE_USAGE_RULE_DERIVATION_AUDIT_V7",
    "PHASE7_BOUNDED_SPELLCASTING_RULE_DERIVATION_V8",
    "PHASE7_FINAL_RESIDUAL_MONSTER_SEMANTICS_AUDIT_V9",
    "PHASE7_FINAL_RESIDUAL_CLASSIFICATION_V10",
    "PHASE7_FINAL_RESIDUAL_CLASSIFICATION_V10_FIXED",
    "PHASE7_FINAL_CLOSURE_VERIFY_V11",
}

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

def classify_text(text: str):
    hits = {}
    for cat, regexes in COMPILED.items():
        matched = []
        for rx in regexes:
            m = rx.search(text)
            if m:
                matched.append(m.group(0))
        if matched:
            hits[cat] = sorted(set(matched), key=str.lower)
    return hits

def sqlite_files(root: Path):
    found = []
    data_root = root / "data"
    if data_root.exists():
        for p in data_root.rglob("*.sqlite"):
            if p.is_file():
                found.append(p)
    return sorted(set(found))

def safe_table_name(name: str):
    return '"' + name.replace('"', '""') + '"'

def inspect_sqlite(db_path: Path):
    rows = []
    row_hits = []
    try:
        db = sqlite3.connect(f"file:{db_path.as_posix()}?mode=ro", uri=True)
        db.row_factory = sqlite3.Row
    except Exception as exc:
        return [{
            "database": str(db_path),
            "table": "",
            "row_count": "",
            "columns": [],
            "schema_category_hits": {},
            "error": str(exc),
        }], []

    try:
        integrity = db.execute("PRAGMA integrity_check").fetchone()[0]
        tables = [
            r[0] for r in db.execute(
                "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"
            )
        ]
        for table in tables:
            cols = [r[1] for r in db.execute(
                f"PRAGMA table_info({safe_table_name(table)})"
            )]
            try:
                count = db.execute(
                    f"SELECT COUNT(*) FROM {safe_table_name(table)}"
                ).fetchone()[0]
            except Exception:
                count = None

            schema_text = f"{table} {' '.join(cols)}"
            schema_hits = classify_text(schema_text)
            rows.append({
                "database": str(db_path),
                "integrity": integrity,
                "table": table,
                "row_count": count,
                "columns": cols,
                "schema_category_hits": schema_hits,
                "candidate_table": bool(schema_hits),
                "error": "",
            })

            # Sample/search rows only for text-bearing columns and moderate tables.
            text_cols = []
            for col_info in db.execute(f"PRAGMA table_info({safe_table_name(table)})"):
                col_name = col_info[1]
                declared = (col_info[2] or "").upper()
                if "CHAR" in declared or "TEXT" in declared or declared == "":
                    text_cols.append(col_name)

            if not text_cols or count is None or count == 0:
                continue

            # Bound cost but do not silently ignore large rule tables:
            # search first 5000 rows ordered by rowid if possible.
            quoted_cols = ", ".join(safe_table_name(c) for c in text_cols)
            query = f"SELECT rowid AS __rowid__, {quoted_cols} FROM {safe_table_name(table)} LIMIT 5000"
            try:
                for record in db.execute(query):
                    parts = []
                    for col in text_cols:
                        val = record[col]
                        if val is not None:
                            parts.append(f"{col}={val}")
                    joined = "\n".join(parts)
                    hits = classify_text(joined)
                    if hits:
                        row_hits.append({
                            "database": str(db_path),
                            "table": table,
                            "rowid": record["__rowid__"],
                            "category_hits": hits,
                            "text_excerpt": joined[:4000],
                        })
            except Exception:
                pass
    finally:
        db.close()
    return rows, row_hits

def scan_project_text(root: Path):
    rows = []
    seen = set()
    for base in [root / "server", root / "src", root / "data", root]:
        if not base.exists():
            continue
        for p in base.rglob("*"):
            if not p.is_file() or p.suffix.lower() not in TEXT_EXTENSIONS:
                continue
            try:
                rel = p.relative_to(root)
            except Exception:
                continue
            if any(part in SKIP_DIRS for part in rel.parts):
                continue
            if p.stat().st_size > 5_000_000:
                continue
            key = str(p.resolve()).lower()
            if key in seen:
                continue
            seen.add(key)
            try:
                text = p.read_text(encoding="utf-8", errors="ignore")
            except Exception:
                continue

            for lineno, line in enumerate(text.splitlines(), 1):
                hits = classify_text(line)
                if hits:
                    rows.append({
                        "path": str(p),
                        "line": lineno,
                        "category_hits": hits,
                        "text": line[:1500],
                    })
    return rows

def phase7_dependency_check(root: Path):
    # Validate the immutable Phase 7 closure state before auditing Phase 8.
    monster_candidates = list((root / "data").rglob("monsters.sqlite"))
    if not monster_candidates:
        return {"ok": False, "reason": "monsters.sqlite not found under project data"}
    db_path = monster_candidates[0]
    db = sqlite3.connect(f"file:{db_path.as_posix()}?mode=ro", uri=True)
    try:
        tables = {
            r[0] for r in db.execute(
                "SELECT name FROM sqlite_master WHERE type='table'"
            )
        }
        required = {
            "phase7_v10_resolution_log",
            "phase7_monster_quarantine",
            "phase7_v10_batches",
            "phase7_monster_automation_backlog",
        }
        missing = sorted(required - tables)
        if missing:
            return {"ok": False, "reason": f"missing Phase 7 closure tables: {missing}"}

        backlog = db.execute(
            "SELECT COUNT(*) FROM phase7_monster_automation_backlog"
        ).fetchone()[0]
        v10 = db.execute(
            "SELECT COUNT(*) FROM phase7_v10_resolution_log"
        ).fetchone()[0]
        quarantine = db.execute(
            "SELECT COUNT(*) FROM phase7_monster_quarantine"
        ).fetchone()[0]
        batch = db.execute("""
            SELECT phase_status,package_version,backlog_after
            FROM phase7_v10_batches
            ORDER BY created_at DESC LIMIT 1
        """).fetchone()
        ok = (
            backlog == 0
            and v10 == 1454
            and quarantine == 742
            and batch is not None
            and batch[0] == "FINAL_RESIDUALS_CLASSIFIED_READY_FOR_PHASE7_CLOSURE"
            and batch[1] == "V10_FIXED"
            and batch[2] == 0
        )
        return {
            "ok": ok,
            "database": str(db_path),
            "active_backlog": backlog,
            "v10_resolution_rows": v10,
            "quarantine_rows": quarantine,
            "batch_phase_status": batch[0] if batch else None,
            "batch_package_version": batch[1] if batch else None,
            "batch_backlog_after": batch[2] if batch else None,
        }
    finally:
        db.close()

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--output", default=str(DEFAULT_OUTPUT))
    args = ap.parse_args()

    output = Path(args.output)
    output.mkdir(parents=True, exist_ok=True)

    dependency = phase7_dependency_check(PROJECT_ROOT)
    if not dependency.get("ok"):
        raise RuntimeError(
            "Phase 8 safety stop: Phase 7 closure dependency failed: "
            + json.dumps(dependency, ensure_ascii=False)
        )

    all_schema_rows = []
    all_row_hits = []
    db_paths = sqlite_files(PROJECT_ROOT)
    for db_path in db_paths:
        schema_rows, row_hits = inspect_sqlite(db_path)
        all_schema_rows.extend(schema_rows)
        all_row_hits.extend(row_hits)

    source_hits = scan_project_text(PROJECT_ROOT)

    write_csv(output / "phase8_sqlite_schema_inventory.csv", all_schema_rows)
    write_csv(output / "phase8_sqlite_row_evidence.csv", all_row_hits)
    write_csv(output / "phase8_project_source_evidence.csv", source_hits)

    # Aggregate categories.
    category_summary = []
    for cat in CATEGORY_PATTERNS:
        schema_count = sum(
            1 for r in all_schema_rows
            if cat in (r.get("schema_category_hits") or {})
        )
        row_count = sum(
            1 for r in all_row_hits
            if cat in (r.get("category_hits") or {})
        )
        source_count = sum(
            1 for r in source_hits
            if cat in (r.get("category_hits") or {})
        )
        candidate_dbs = sorted({
            r["database"] for r in all_row_hits
            if cat in (r.get("category_hits") or {})
        })
        category_summary.append({
            "category": cat,
            "schema_candidate_tables": schema_count,
            "sqlite_evidence_rows": row_count,
            "project_source_evidence_lines": source_count,
            "sqlite_databases_with_evidence": candidate_dbs,
        })
    write_csv(output / "phase8_category_summary.csv", category_summary)

    candidate_tables = [
        r for r in all_schema_rows if r.get("candidate_table")
    ]
    write_csv(output / "phase8_candidate_tables.csv", candidate_tables)

    # Candidate row groups by category/table/database.
    grouped = Counter()
    for row in all_row_hits:
        for cat in row["category_hits"]:
            grouped[(cat, row["database"], row["table"])] += 1
    grouped_rows = [
        {
            "category": key[0],
            "database": key[1],
            "table": key[2],
            "evidence_rows": count,
        }
        for key, count in sorted(
            grouped.items(),
            key=lambda kv: (kv[0][0], -kv[1], kv[0][1], kv[0][2])
        )
    ]
    write_csv(output / "phase8_evidence_by_table.csv", grouped_rows)

    blockers = []
    if not db_paths:
        blockers.append("No SQLite databases found under F:\\DND WEB VTT\\data")
    if not all_row_hits and not source_hits:
        blockers.append("No Phase 8 keyword evidence found in SQLite rows or project source.")

    report = {
        "package": "PHASE8_EXPLORATION_DOWNTIME_MISC_AUDIT_V1",
        "createdAt": now_iso(),
        "readOnly": True,
        "phase7Dependency": dependency,
        "sqliteDatabasesScanned": len(db_paths),
        "sqliteTablesInventoried": len(all_schema_rows),
        "candidateTables": len(candidate_tables),
        "sqliteEvidenceRows": len(all_row_hits),
        "projectSourceEvidenceLines": len(source_hits),
        "categorySummary": category_summary,
        "blockers": blockers,
        "phaseStatus": (
            "PHASE8_BASELINE_AUDIT_COMPLETE_READ_ONLY"
            if not blockers
            else "PHASE8_BASELINE_AUDIT_COMPLETE_WITH_BLOCKERS"
        ),
        "next": "REVIEW_PHASE8_EVIDENCE_AND_DEFINE_STRUCTURED_SCOPE",
    }
    (output / "phase8_exploration_downtime_misc_audit_v1_report.json").write_text(
        json.dumps(report, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )

    summary_lines = [
        "# Phase 8 — Exploration / Downtime / Crafting / Hazards / Objects / Misc Audit V1",
        "",
        "**Mode: READ-ONLY**",
        "",
        f"- Phase 7 dependency: {'PASS' if dependency.get('ok') else 'FAIL'}",
        f"- SQLite databases scanned: {len(db_paths)}",
        f"- SQLite tables inventoried: {len(all_schema_rows)}",
        f"- Candidate tables: {len(candidate_tables)}",
        f"- SQLite evidence rows: {len(all_row_hits)}",
        f"- Project source evidence lines: {len(source_hits)}",
        f"- Blockers: {len(blockers)}",
        "",
        "## Category evidence",
        "",
    ]
    for row in category_summary:
        summary_lines.append(
            f"- **{row['category']}** — "
            f"schema tables: {row['schema_candidate_tables']}; "
            f"SQLite rows: {row['sqlite_evidence_rows']}; "
            f"source lines: {row['project_source_evidence_lines']}"
        )
    summary_lines += [
        "",
        "## Important",
        "",
        "This audit does not decide that a keyword hit is a complete rule.",
        "It is only the evidence inventory used to define the structured Phase 8 scope.",
        "Previously-closed Phase 1–7 mechanics must not be duplicated simply because",
        "their terminology appears in exploration or miscellaneous text.",
        "",
        f"**Status: {report['phaseStatus']}**",
    ]
    (output / "PHASE8_EXPLORATION_DOWNTIME_MISC_AUDIT_V1_SUMMARY.md").write_text(
        "\n".join(summary_lines) + "\n",
        encoding="utf-8",
    )

    print("PHASE 8 EXPLORATION/DOWNTIME/MISC BASELINE AUDIT V1 COMPLETE")
    print("READ_ONLY=YES")
    print("PHASE7_DEPENDENCY=PASS")
    print(f"SQLITE_DATABASES_SCANNED={len(db_paths)}")
    print(f"SQLITE_TABLES_INVENTORIED={len(all_schema_rows)}")
    print(f"CANDIDATE_TABLES={len(candidate_tables)}")
    print(f"SQLITE_EVIDENCE_ROWS={len(all_row_hits)}")
    print(f"PROJECT_SOURCE_EVIDENCE_LINES={len(source_hits)}")
    print(f"BLOCKERS={len(blockers)}")
    for row in category_summary:
        key = row["category"].upper()
        print(
            f"CATEGORY_{key}=schema:{row['schema_candidate_tables']},"
            f"sqlite_rows:{row['sqlite_evidence_rows']},"
            f"source_lines:{row['project_source_evidence_lines']}"
        )
    print(f"PHASE_STATUS={report['phaseStatus']}")
    print("NEXT=REVIEW_PHASE8_EVIDENCE_AND_DEFINE_STRUCTURED_SCOPE")
    print(f"OUTPUT={output}")
    return 0 if not blockers else 2

if __name__ == "__main__":
    raise SystemExit(main())
