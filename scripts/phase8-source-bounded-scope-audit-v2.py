from __future__ import annotations

import argparse
import csv
import json
import re
import sqlite3
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path

PROJECT_ROOT = Path(r"F:\DND WEB VTT")
RULES_DB = PROJECT_ROOT / "data" / "compendium" / "rules_knowledge.sqlite"
RULEBOOKS_DB = PROJECT_ROOT / "data" / "compendium" / "rulebooks.sqlite"
MONSTERS_DB = PROJECT_ROOT / "data" / "compendium" / "monsters.sqlite"
DEFAULT_OUTPUT = PROJECT_ROOT / "_phase8_source_bounded_scope_audit_v2"

CATEGORIES = {
    "exploration_travel": {
        "heading": [
            r"\bexploration\b", r"\btravel\b", r"\bwilderness\b",
            r"\btravel pace\b", r"\bforaging\b", r"\bnavigation\b",
        ],
        "body": [
            r"\btravel pace\b", r"\bforced march\b", r"\bforaging\b",
            r"\bnavigation\b", r"\bgetting lost\b", r"\bwilderness travel\b",
            r"\bexploration\b",
        ],
    },
    "movement_environment": {
        "heading": [
            r"\bclimbing\b", r"\bswimming\b", r"\bjumping\b", r"\bfalling\b",
            r"\bunderwater\b", r"\bweather\b", r"\benvironment\b",
        ],
        "body": [
            r"\bclimbing\b", r"\bswimming\b", r"\bjumping\b", r"\bfalling\b",
            r"\bsuffocation\b", r"\bextreme cold\b", r"\bextreme heat\b",
            r"\bstrong wind\b", r"\bfrigid water\b", r"\bhigh altitude\b",
            r"\bquicksand\b", r"\bslippery ice\b",
        ],
    },
    "downtime": {
        "heading": [
            r"\bdowntime\b", r"\bbetween adventures\b", r"\btraining\b",
            r"\bresearch\b", r"\brecuperating\b",
        ],
        "body": [
            r"\bdowntime activity\b", r"\bdowntime\b", r"\btraining\b",
            r"\bresearch\b", r"\brecuperating\b", r"\bcarousing\b",
        ],
    },
    "crafting": {
        "heading": [
            r"\bcrafting\b", r"\bcraft an item\b", r"\bcrafting magic items\b",
        ],
        "body": [
            r"\bcrafting\b", r"\bcraft an item\b", r"\bcrafting time\b",
            r"\bcrafting cost\b", r"\bmaterials? cost\b", r"\brecipe\b",
            r"\bartisan'?s tools\b",
        ],
    },
    "hazards_traps": {
        "heading": [
            r"\bhazards?\b", r"\btraps?\b", r"\bdungeon hazards\b",
            r"\bwilderness hazards\b",
        ],
        "body": [
            r"\benvironmental hazard\b", r"\bsimple trap\b", r"\bcomplex trap\b",
            r"\bhazard\b", r"\btrap\b",
        ],
    },
    "objects_structures": {
        "heading": [
            r"\bobjects?\b", r"\bdamage to objects\b", r"\bstructures?\b",
        ],
        "body": [
            r"\bobject ac\b", r"\bobject hit points?\b", r"\bdamage threshold\b",
            r"\bbreaking objects?\b", r"\bdamage to objects\b",
        ],
    },
    "rests_recovery_survival": {
        "heading": [
            r"\bresting\b", r"\bshort rest\b", r"\blong rest\b",
            r"\bfood\b", r"\bwater\b", r"\bsleep\b", r"\bexhaustion\b",
        ],
        "body": [
            r"\bshort rest\b", r"\blong rest\b", r"\bfood and water\b",
            r"\bgoing without food\b", r"\bdehydration\b", r"\bsleep\b",
            r"\bexhaustion\b",
        ],
    },
    "mounts_vehicles_chases_siege": {
        "heading": [
            r"\bmounts?\b", r"\bvehicles?\b", r"\bchases?\b",
            r"\bsiege equipment\b", r"\bsiege\b",
        ],
        "body": [
            r"\bmounted\b", r"\bmounts?\b", r"\bvehicles?\b", r"\bchases?\b",
            r"\bsiege equipment\b",
        ],
    },
}

COMPILED = {
    cat: {
        kind: [re.compile(p, re.I) for p in patterns]
        for kind, patterns in spec.items()
    }
    for cat, spec in CATEGORIES.items()
}

CLOSED_ENTITY_CATEGORIES = {
    "spell", "cantrip", "class", "subclass", "class-feature",
    "species", "background", "feat", "weapon", "armor", "equipment",
    "adventuring-gear", "tool", "pack", "magic-item", "poison", "monster",
}

LIVE_SOURCE_EXTENSIONS = {".ts", ".tsx", ".js", ".mjs", ".cjs", ".json", ".md"}

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

def match_category(heading: str, body: str):
    result = {}
    heading = heading or ""
    body = body or ""
    for cat, spec in COMPILED.items():
        heading_hits = sorted({
            m.group(0)
            for rx in spec["heading"]
            for m in rx.finditer(heading)
        }, key=str.lower)
        body_hits = sorted({
            m.group(0)
            for rx in spec["body"]
            for m in rx.finditer(body)
        }, key=str.lower)
        if heading_hits or body_hits:
            result[cat] = {
                "heading_hits": heading_hits,
                "body_hits": body_hits,
            }
    return result

def phase7_dependency():
    if not MONSTERS_DB.exists():
        return {"ok": False, "reason": "monsters.sqlite missing"}
    db = sqlite3.connect(f"file:{MONSTERS_DB.as_posix()}?mode=ro", uri=True)
    try:
        tables = {
            r[0] for r in db.execute(
                "SELECT name FROM sqlite_master WHERE type='table'"
            )
        }
        required = {
            "phase7_v10_resolution_log",
            "phase7_monster_quarantine",
            "phase7_monster_automation_backlog",
            "phase7_v10_batches",
        }
        missing = sorted(required - tables)
        if missing:
            return {"ok": False, "reason": f"missing tables: {missing}"}
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
            and batch
            and batch[0] == "FINAL_RESIDUALS_CLASSIFIED_READY_FOR_PHASE7_CLOSURE"
            and batch[1] == "V10_FIXED"
            and batch[2] == 0
        )
        return {
            "ok": bool(ok),
            "active_backlog": backlog,
            "v10_resolution_rows": v10,
            "quarantine_rows": quarantine,
            "batch": list(batch) if batch else None,
        }
    finally:
        db.close()

def read_sources(db):
    rows = []
    for r in db.execute("""
        SELECT id,source_key,title,filename,publication_year,rules_version,
               source_kind,source_priority,current_revision_id
        FROM sources
        ORDER BY source_priority DESC, publication_year DESC, title
    """):
        rows.append({
            "source_id": r[0],
            "source_key": r[1],
            "title": r[2],
            "filename": r[3],
            "publication_year": r[4],
            "rules_version": r[5],
            "source_kind": r[6],
            "source_priority": r[7],
            "current_revision_id": r[8],
        })
    return rows

def section_candidates(db):
    sql = """
    SELECT s.id,s.revision_id,s.heading,s.body,s.page_start,s.page_end,
           src.id AS source_id,src.source_key,src.title,src.filename,
           src.publication_year,src.rules_version,src.source_kind,src.source_priority
    FROM sections s
    JOIN source_revisions rev ON rev.id=s.revision_id
    JOIN sources src ON src.id=rev.source_id
    ORDER BY src.source_priority DESC,src.publication_year DESC,s.page_start,s.id
    """
    rows = []
    for r in db.execute(sql):
        heading = r[2] or ""
        body = r[3] or ""
        hits = match_category(heading, body)
        if not hits:
            continue

        heading_categories = [
            cat for cat, detail in hits.items()
            if detail["heading_hits"]
        ]
        body_categories = [
            cat for cat, detail in hits.items()
            if detail["body_hits"]
        ]

        score = 0
        score += 10 * len(heading_categories)
        score += 2 * len(body_categories)
        rv = str(r[11] or "")
        if "2024" in rv or "5.2.1" in rv:
            score += 5
        if str(r[12] or "").lower() in {"srd", "open", "open-rules"}:
            score += 3

        rows.append({
            "section_id": r[0],
            "revision_id": r[1],
            "heading": heading,
            "page_start": r[4],
            "page_end": r[5],
            "source_id": r[6],
            "source_key": r[7],
            "source_title": r[8],
            "source_filename": r[9],
            "publication_year": r[10],
            "rules_version": r[11],
            "source_kind": r[12],
            "source_priority": r[13],
            "category_hits": hits,
            "heading_category_count": len(heading_categories),
            "body_category_count": len(body_categories),
            "evidence_score": score,
            "body_excerpt": re.sub(r"\s+", " ", body)[:1200],
        })
    return rows

def entity_evidence(db):
    sql = """
    SELECT ev.id,ev.category,ev.subcategory,ev.name,ev.summary,ev.raw_text,
           ev.source_page_start,ev.source_page_end,ev.rules_version,
           src.id AS source_id,src.source_key,src.title,src.filename,
           src.publication_year,src.source_kind,src.source_priority
    FROM entity_versions ev
    JOIN sources src ON src.id=ev.source_id
    WHERE ev.status='active'
    ORDER BY src.source_priority DESC,src.publication_year DESC,ev.name
    """
    rows = []
    for r in db.execute(sql):
        category = (r[1] or "").strip().lower()
        text = " ".join([
            str(r[3] or ""),
            str(r[4] or ""),
            str(r[5] or ""),
        ])
        hits = match_category(r[3] or "", text)
        if not hits:
            continue
        rows.append({
            "entity_version_id": r[0],
            "entity_category": r[1],
            "subcategory": r[2],
            "name": r[3],
            "source_page_start": r[6],
            "source_page_end": r[7],
            "rules_version": r[8],
            "source_id": r[9],
            "source_key": r[10],
            "source_title": r[11],
            "source_filename": r[12],
            "publication_year": r[13],
            "source_kind": r[14],
            "source_priority": r[15],
            "category_hits": hits,
            "scope_class": (
                "REFERENCE_TO_CLOSED_PHASE"
                if category in CLOSED_ENTITY_CATEGORIES
                else "PHASE8_ENTITY_CANDIDATE"
            ),
            "raw_excerpt": re.sub(r"\s+", " ", str(r[5] or ""))[:900],
        })
    return rows

def live_source_evidence():
    rows = []
    for base in [PROJECT_ROOT / "src", PROJECT_ROOT / "server"]:
        if not base.exists():
            continue
        for p in base.rglob("*"):
            if not p.is_file() or p.suffix.lower() not in LIVE_SOURCE_EXTENSIONS:
                continue
            if p.stat().st_size > 3_000_000:
                continue
            try:
                text = p.read_text(encoding="utf-8", errors="ignore")
            except Exception:
                continue
            for lineno, line in enumerate(text.splitlines(), 1):
                hits = match_category("", line)
                if hits:
                    rows.append({
                        "path": str(p),
                        "line": lineno,
                        "category_hits": hits,
                        "text": line[:1200],
                    })
    return rows

def rulebooks_crosscheck():
    if not RULEBOOKS_DB.exists():
        return [], [{"status": "MISSING", "path": str(RULEBOOKS_DB)}]

    db = sqlite3.connect(f"file:{RULEBOOKS_DB.as_posix()}?mode=ro", uri=True)
    db.row_factory = sqlite3.Row
    rows = []
    info = []
    try:
        integrity = db.execute("PRAGMA integrity_check").fetchone()[0]
        tables = [
            r[0] for r in db.execute(
                "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"
            )
        ]
        info.append({
            "status": "OK",
            "path": str(RULEBOOKS_DB),
            "integrity": integrity,
            "tables": tables,
        })

        if "pages" in tables:
            cols = [r[1] for r in db.execute("PRAGMA table_info(pages)")]
            text_col = next(
                (c for c in cols if c.lower() in {"text", "content", "body"}),
                None
            )
            page_col = next(
                (c for c in cols if c.lower() in {"page_number", "page", "number"}),
                None
            )
            if text_col:
                page_expr = f'"{page_col}"' if page_col else "NULL"
                query = (
                    f'SELECT rowid, {page_expr} AS page_no, '
                    f'"{text_col}" AS body FROM pages'
                )
                for rec in db.execute(query):
                    body = rec["body"] or ""
                    hits = match_category("", body)
                    if hits:
                        rows.append({
                            "rowid": rec["rowid"],
                            "page_number": rec["page_no"],
                            "category_hits": hits,
                            "body_excerpt": re.sub(r"\s+", " ", body)[:900],
                        })
    finally:
        db.close()

    return rows, info

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--output", default=str(DEFAULT_OUTPUT))
    args = ap.parse_args()
    output = Path(args.output)
    output.mkdir(parents=True, exist_ok=True)

    dependency = phase7_dependency()
    if not dependency.get("ok"):
        raise RuntimeError(
            "Phase 8 V2 safety stop: Phase 7 closure dependency failed: "
            + json.dumps(dependency, ensure_ascii=False)
        )

    if not RULES_DB.exists():
        raise RuntimeError(f"Missing canonical rules DB: {RULES_DB}")

    db = sqlite3.connect(f"file:{RULES_DB.as_posix()}?mode=ro", uri=True)
    db.row_factory = sqlite3.Row
    try:
        integrity = db.execute("PRAGMA integrity_check").fetchone()[0]
        fk_errors = db.execute("PRAGMA foreign_key_check").fetchall()
        if integrity != "ok":
            raise RuntimeError(f"rules_knowledge integrity={integrity}")

        required = {"sources", "source_revisions", "sections", "entity_versions"}
        tables = {
            r[0] for r in db.execute(
                "SELECT name FROM sqlite_master WHERE type='table'"
            )
        }
        missing = sorted(required - tables)
        if missing:
            raise RuntimeError(f"Missing canonical tables: {missing}")

        sources = read_sources(db)
        sections = section_candidates(db)
        entities = entity_evidence(db)
    finally:
        db.close()

    live_source = live_source_evidence()
    rulebook_hits, rulebook_info = rulebooks_crosscheck()

    write_csv(output / "phase8_v2_sources.csv", sources)
    write_csv(output / "phase8_v2_section_candidates.csv", sections)
    write_csv(output / "phase8_v2_entity_evidence.csv", entities)
    write_csv(output / "phase8_v2_live_source_evidence.csv", live_source)
    write_csv(output / "phase8_v2_rulebooks_crosscheck.csv", rulebook_hits)
    write_csv(output / "phase8_v2_rulebooks_db_info.csv", rulebook_info)

    source_summary = []
    for src in sources:
        sid = src["source_id"]
        sec = [r for r in sections if r["source_id"] == sid]
        ent = [r for r in entities if r["source_id"] == sid]
        source_summary.append({
            **src,
            "section_candidate_count": len(sec),
            "heading_hit_section_count": sum(
                1 for r in sec if r["heading_category_count"] > 0
            ),
            "entity_evidence_count": len(ent),
            "phase8_entity_candidate_count": sum(
                1 for r in ent if r["scope_class"] == "PHASE8_ENTITY_CANDIDATE"
            ),
            "closed_phase_reference_count": sum(
                1 for r in ent if r["scope_class"] == "REFERENCE_TO_CLOSED_PHASE"
            ),
        })
    write_csv(output / "phase8_v2_source_partition_summary.csv", source_summary)

    category_summary = []
    for cat in CATEGORIES:
        sec = [r for r in sections if cat in r["category_hits"]]
        heading_sec = [
            r for r in sec
            if r["category_hits"][cat]["heading_hits"]
        ]
        phase8_ent = [
            r for r in entities
            if cat in r["category_hits"]
            and r["scope_class"] == "PHASE8_ENTITY_CANDIDATE"
        ]
        closed_ref = [
            r for r in entities
            if cat in r["category_hits"]
            and r["scope_class"] == "REFERENCE_TO_CLOSED_PHASE"
        ]
        category_summary.append({
            "category": cat,
            "canonical_section_candidates": len(sec),
            "heading_hit_sections": len(heading_sec),
            "phase8_entity_candidates": len(phase8_ent),
            "closed_phase_entity_references": len(closed_ref),
            "live_source_lines": sum(
                1 for r in live_source if cat in r["category_hits"]
            ),
            "rules_versions_seen": sorted({
                str(r["rules_version"])
                for r in sec if r.get("rules_version") not in (None, "")
            }),
            "source_titles_seen": sorted({
                str(r["source_title"])
                for r in sec if r.get("source_title")
            }),
        })
    write_csv(output / "phase8_v2_category_summary.csv", category_summary)

    high_conf = sorted(
        [r for r in sections if r["heading_category_count"] > 0],
        key=lambda r: (
            -r["evidence_score"],
            -(r["source_priority"] or 0),
            r["source_title"] or "",
            r["page_start"] or 0,
        )
    )
    write_csv(output / "phase8_v2_high_confidence_heading_candidates.csv", high_conf)

    duplicate_groups = Counter()
    for r in high_conf:
        cats = tuple(sorted(
            cat for cat, detail in r["category_hits"].items()
            if detail["heading_hits"]
        ))
        key = (
            str(r["source_title"] or "").strip().lower(),
            str(r["heading"] or "").strip().lower(),
            r["page_start"],
            cats,
        )
        duplicate_groups[key] += 1

    dup_rows = [
        {
            "source_title": k[0],
            "heading": k[1],
            "page_start": k[2],
            "heading_categories": list(k[3]),
            "duplicate_count": v,
        }
        for k, v in duplicate_groups.items()
        if v > 1
    ]
    write_csv(output / "phase8_v2_duplicate_heading_groups.csv", dup_rows)

    blockers = []
    if not sources:
        blockers.append("No sources registered in rules_knowledge.sqlite")
    if not sections:
        blockers.append("No canonical section candidates found")
    if not high_conf:
        blockers.append("No heading-level Phase 8 evidence found")

    report = {
        "package": "PHASE8_SOURCE_BOUNDED_SCOPE_AUDIT_V2",
        "createdAt": now_iso(),
        "readOnly": True,
        "phase7Dependency": dependency,
        "rulesKnowledgeIntegrity": integrity,
        "rulesKnowledgeForeignKeyErrors": len(fk_errors),
        "registeredSources": len(sources),
        "canonicalSectionCandidates": len(sections),
        "highConfidenceHeadingCandidates": len(high_conf),
        "entityEvidenceRows": len(entities),
        "phase8EntityCandidates": sum(
            1 for r in entities
            if r["scope_class"] == "PHASE8_ENTITY_CANDIDATE"
        ),
        "closedPhaseEntityReferences": sum(
            1 for r in entities
            if r["scope_class"] == "REFERENCE_TO_CLOSED_PHASE"
        ),
        "liveSourceEvidenceLines": len(live_source),
        "rulebooksCrosscheckRows": len(rulebook_hits),
        "duplicateHeadingGroups": len(dup_rows),
        "categorySummary": category_summary,
        "blockers": blockers,
        "phaseStatus": (
            "PHASE8_SOURCE_BOUNDED_SCOPE_AUDIT_COMPLETE"
            if not blockers
            else "PHASE8_SOURCE_BOUNDED_SCOPE_AUDIT_WITH_BLOCKERS"
        ),
        "next": "REVIEW_V2_AND_DEFINE_PHASE8_STRUCTURED_RULE_FAMILIES",
    }

    (output / "phase8_source_bounded_scope_audit_v2_report.json").write_text(
        json.dumps(report, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )

    summary = [
        "# Phase 8 — Source-Bounded Scope Audit V2",
        "",
        "**Mode: READ-ONLY**",
        "",
        "- Phase 7 dependency: PASS",
        f"- rules_knowledge integrity: {integrity}",
        f"- rules_knowledge FK errors: {len(fk_errors)}",
        f"- Registered sources: {len(sources)}",
        f"- Canonical section candidates: {len(sections)}",
        f"- High-confidence heading candidates: {len(high_conf)}",
        f"- Entity evidence rows: {len(entities)}",
        f"- Phase 8 entity candidates: {report['phase8EntityCandidates']}",
        f"- References to already-closed phases: {report['closedPhaseEntityReferences']}",
        f"- Live src/server evidence lines: {len(live_source)}",
        f"- Rulebooks cross-check rows: {len(rulebook_hits)}",
        f"- Duplicate heading groups: {len(dup_rows)}",
        f"- Blockers: {len(blockers)}",
        "",
        "## Why V2 exists",
        "",
        "V1 intentionally cast a very wide net and therefore counted FTS mirrors, backups,",
        "QA persistence copies, old audit outputs, snapshots, and already-closed rule families.",
        "V2 narrows the evidence to canonical sources and live project code, while retaining",
        "source title, publication year, rules version, page range, and heading provenance.",
        "",
        "No rule is migrated by V2.",
        "",
        f"**Status: {report['phaseStatus']}**",
    ]
    (output / "PHASE8_SOURCE_BOUNDED_SCOPE_AUDIT_V2_SUMMARY.md").write_text(
        "\n".join(summary) + "\n",
        encoding="utf-8",
    )

    print("PHASE 8 SOURCE-BOUNDED SCOPE AUDIT V2 COMPLETE")
    print("READ_ONLY=YES")
    print("PHASE7_DEPENDENCY=PASS")
    print(f"RULES_KNOWLEDGE_INTEGRITY={integrity}")
    print(f"RULES_KNOWLEDGE_FOREIGN_KEYS={len(fk_errors)}")
    print(f"REGISTERED_SOURCES={len(sources)}")
    print(f"CANONICAL_SECTION_CANDIDATES={len(sections)}")
    print(f"HIGH_CONFIDENCE_HEADING_CANDIDATES={len(high_conf)}")
    print(f"ENTITY_EVIDENCE_ROWS={len(entities)}")
    print(f"PHASE8_ENTITY_CANDIDATES={report['phase8EntityCandidates']}")
    print(f"CLOSED_PHASE_ENTITY_REFERENCES={report['closedPhaseEntityReferences']}")
    print(f"LIVE_SOURCE_EVIDENCE_LINES={len(live_source)}")
    print(f"RULEBOOKS_CROSSCHECK_ROWS={len(rulebook_hits)}")
    print(f"DUPLICATE_HEADING_GROUPS={len(dup_rows)}")
    print(f"BLOCKERS={len(blockers)}")
    print(f"PHASE_STATUS={report['phaseStatus']}")
    print("NEXT=REVIEW_V2_AND_DEFINE_PHASE8_STRUCTURED_RULE_FAMILIES")
    print(f"OUTPUT={output}")
    return 0 if not blockers else 2

if __name__ == "__main__":
    raise SystemExit(main())
