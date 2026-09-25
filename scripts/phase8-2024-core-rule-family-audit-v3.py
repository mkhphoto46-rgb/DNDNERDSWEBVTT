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
DEFAULT_OUTPUT = PROJECT_ROOT / "_phase8_2024_core_rule_family_audit_v3"

EXPECTED = {
    "registered_sources": 14,
    "core_2024_section_candidates": 662,
    "broad_heading_candidates": 153,
    "curated_candidates": 70,
    "structured_candidates": 60,
    "review_context": 10,
    "residual_broad_heading_candidates": 83,
}

BROAD_HEADING_PATTERNS = {
    "exploration_travel": [
        r"\bexploration\b", r"\btravel\b", r"\bwilderness\b",
        r"\btravel pace\b", r"\bforaging\b", r"\bnavigation\b",
    ],
    "movement_environment": [
        r"\bclimbing\b", r"\bswimming\b", r"\bjumping\b", r"\bfalling\b",
        r"\bunderwater\b", r"\bweather\b", r"\benvironment\b",
    ],
    "downtime": [
        r"\bdowntime\b", r"\bbetween adventures\b", r"\btraining\b",
        r"\bresearch\b", r"\brecuperating\b",
    ],
    "crafting": [
        r"\bcrafting\b", r"\bcraft an item\b", r"\bcrafting magic items\b",
    ],
    "hazards_traps": [
        r"\bhazards?\b", r"\btraps?\b", r"\bdungeon hazards\b",
        r"\bwilderness hazards\b",
    ],
    "objects_structures": [
        r"\bobjects?\b", r"\bdamage to objects\b", r"\bstructures?\b",
    ],
    "rests_recovery_survival": [
        r"\bresting\b", r"\bshort rest\b", r"\blong rest\b",
        r"\bfood\b", r"\bwater\b", r"\bsleep\b", r"\bexhaustion\b",
    ],
    "mounts_vehicles_chases_siege": [
        r"\bmounts?\b", r"\bvehicles?\b", r"\bchases?\b",
        r"\bsiege equipment\b", r"\bsiege\b",
    ],
}

BROAD = {
    k: [re.compile(p, re.I) for p in pats]
    for k, pats in BROAD_HEADING_PATTERNS.items()
}

def rule(family, source, page_min, page_max, patterns, disposition="STRUCTURED_RULE_CANDIDATE"):
    return {
        "family": family,
        "source": source,
        "page_min": page_min,
        "page_max": page_max,
        "patterns": [re.compile(p) for p in patterns],
        "disposition": disposition,
    }

CURATED_RULES = [
    rule("exploration_core", "Dungeon Master's Guide", 37, 43, [
        r"^RUNNING EXPLORATION$",
        r"^ABILITY CHECKS IN EXPLORATION$",
        r"^ACTIONS IN EXPLORATION$",
        r"^TRAVEL$",
        r"^TRAVEL PACE$",
        r"^TRAVEL TERRAIN$",
        r"^WEATHER$",
        r"^FORAGING$",
        r"^NARRATION DURING TRAVEL$",
        r"FORAGING DC NAVIGATION DC SEARCH DC",
    ]),
    rule("exploration_encounters", "Dungeon Master's Guide", 118, 118, [
        r"^EXPLORATION ENCOUNTERS$",
    ], "REVIEW_CONTEXT"),
    rule("movement_environment", "Dungeon Master's Guide", 40, 80, [
        r"^UNDERWATER ENCOUNTER DISTANCE$",
        r"^FRIGID WATER$",
        r"^DEEP WATER$",
        r"^HAZARDS$",
        r"^EXAMPLE HAZARDS$",
    ]),
    rule("movement_environment", "Player's Handbook", 25, 26, [
        r"^FALLING OFF$",
        r"^UNDERWATER COMBAT$",
    ]),
    rule("movement_environment", "Player's Handbook", 361, 375, [
        r"^BURN I NG HAZARD$",
        r"^DEH YDRATION HAZARD$",
        r"^MAL N UTR ITION HAZARD$",
        r"^WATER NEEDS PER DAY$",
        r"^JUMPING$",
        r"^SUFFOCATION HAZARD$",
        r"^SWIMMING$",
    ]),
    rule("downtime_training", "Dungeon Master's Guide", 53, 85, [
        r"TRAINING TO GAIN LEVELS",
        r"^TRAINING$",
    ], "REVIEW_CONTEXT"),
    rule("downtime_recovery", "Dungeon Master's Guide", 65, 65, [
        r"^REST AND RECUPERATION$",
    ]),
    rule("crafting", "Player's Handbook", 232, 232, [
        r"^CRAFTING EQUIPMENT$",
    ]),
    rule("crafting", "Dungeon Master's Guide", 340, 340, [
        r"^ORDER CRAFT$",
    ], "REVIEW_CONTEXT"),
    rule("traps", "Dungeon Master's Guide", 104, 107, [
        r"^TRAPS$",
        r"^PARTS OF A TRAP$",
        r"^EXAMPLE TRAPS$",
        r"^BUILDING YOUR OWN TRAPS$",
        r"^BUILDING A TRAP$",
        r"NUISANCE TRAPS DEADLY TRAPS",
    ]),
    rule("objects", "Player's Handbook", 18, 19, [
        r"^INTERACTING WITH OBJECTS$",
        r"^FINDING HIDDEN OBJECTS$",
        r"^CARRYING OBJECTS$",
        r"^WHAT IS AN OBJECT$",
        r"^BREAKING OBJECTS$",
    ], "REVIEW_CONTEXT"),
    rule("objects", "Player's Handbook", 361, 370, [
        r"OBJECT ARMOR CLASS",
        r"OBJECT H.?T POINTS",
        r"^BREAKING OBJECTS$",
        r"^OBJECT$",
        r"ARMOR CLASS THE OBJECT ARMOR CLASS TABLE",
        r"HIT POINTS THE OBJECT HIT POINTS TABLE",
    ]),
    rule("rests_survival", "Player's Handbook", 361, 375, [
        r"^LONG REST$",
        r"^SHORT REST$",
        r"^WATER NEEDS PER DAY$",
        r"^DEH YDRATION HAZARD$",
        r"^MAL N UTR ITION HAZARD$",
        r"^SUFFOCATION HAZARD$",
    ]),
    rule("rests_survival", "Dungeon Master's Guide", 42, 72, [
        r"TRACK FOOD AND WATER CONSUMPTION",
        r"^FRIGID WATER$",
        r"^DEEP WATER$",
        r"^REST AND RECUPERATION$",
    ]),
    rule("mounts", "Player's Handbook", 25, 26, [
        r"^MOUNTING AND DISMOUNTING$",
        r"^MOUNTED COMBAT$",
        r"^CONTROLLING A MOUNT$",
    ]),
    rule("mounts_vehicles", "Player's Handbook", 228, 229, [
        r"^MOUNTS AND VEHICLES$",
        r"^MOUNTS AND OTHER ANIMALS$",
        r"^MOUNTS A N D CARGO$",
        r"TACK HARNESS AND DRAWN VEHICLES",
        r"AIRBORNE AND WATERBORNE VEHICLES",
        r"^LARGE VEHICLES$",
    ]),
    rule("chases", "Dungeon Master's Guide", 56, 58, [
        r"^CHASES$",
        r"^BEGINNING A CHASE$",
        r"^RUNNING THE CHASE$",
        r"^MAPPING THE CHASE$",
        r"DESIGNING YOUR OWN CHASE TABLES",
        r"CHASE COMPLICATIONS",
        r"^ENDING A CHASE$",
        r"URBAN CHASE COMPLICATIONS",
    ]),
    rule("siege", "Dungeon Master's Guide", 100, 100, [
        r"^SIEGE EQUIPMENT$",
    ]),
]

def now_iso():
    return datetime.now(timezone.utc).isoformat()

def norm_heading(text):
    value = str(text or "").upper()
    value = re.sub(r"[^A-Z0-9]+", " ", value)
    return re.sub(r"\s+", " ", value).strip()

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
        writer = csv.DictWriter(f, fieldnames=fields)
        writer.writeheader()
        for row in rows:
            out = {}
            for key in fields:
                value = row.get(key, "")
                if isinstance(value, (dict, list)):
                    value = json.dumps(value, ensure_ascii=False, sort_keys=True)
                out[key] = value
            writer.writerow(out)

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
        needed = {
            "phase7_monster_automation_backlog",
            "phase7_v10_resolution_log",
            "phase7_monster_quarantine",
            "phase7_v10_batches",
        }
        missing = sorted(needed - tables)
        if missing:
            return {"ok": False, "reason": f"missing Phase 7 tables: {missing}"}
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
            "backlog": backlog,
            "v10_resolution_rows": v10,
            "quarantine_rows": quarantine,
            "batch": list(batch) if batch else None,
        }
    finally:
        db.close()

def broad_heading_hits(heading):
    result = {}
    for family, regexes in BROAD.items():
        hits = sorted({
            m.group(0)
            for rx in regexes
            for m in rx.finditer(heading or "")
        }, key=str.lower)
        if hits:
            result[family] = hits
    return result

def curated_matches(source_title, page_start, heading):
    normalized = norm_heading(heading)
    page = int(page_start) if page_start is not None else -1
    matches = []
    for item in CURATED_RULES:
        if source_title != item["source"]:
            continue
        if not (item["page_min"] <= page <= item["page_max"]):
            continue
        if any(rx.search(normalized) for rx in item["patterns"]):
            matches.append({
                "family": item["family"],
                "disposition": item["disposition"],
            })
    return matches

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--output", default=str(DEFAULT_OUTPUT))
    args = ap.parse_args()
    output = Path(args.output)
    output.mkdir(parents=True, exist_ok=True)

    dependency = phase7_dependency()
    if not dependency.get("ok"):
        raise RuntimeError(
            "Phase 8 V3 safety stop: Phase 7 closure dependency failed: "
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
        if fk_errors:
            raise RuntimeError(f"rules_knowledge foreign keys={len(fk_errors)}")

        registered_sources = db.execute("SELECT COUNT(*) FROM sources").fetchone()[0]
        if registered_sources != EXPECTED["registered_sources"]:
            raise RuntimeError(
                f"Source registry drift expected={EXPECTED['registered_sources']} actual={registered_sources}"
            )

        rows = []
        sql = """
        SELECT s.id AS section_id,s.revision_id,s.heading,s.body,
               s.page_start,s.page_end,
               src.id AS source_id,src.title AS source_title,
               src.filename,src.publication_year,src.rules_version,
               src.source_kind,src.source_priority
        FROM sections s
        JOIN sources src ON src.current_revision_id=s.revision_id
        WHERE src.rules_version='2024'
          AND src.title IN ('Player''s Handbook','Dungeon Master''s Guide')
        ORDER BY src.title,s.page_start,s.id
        """
        for r in db.execute(sql):
            broad = broad_heading_hits(r["heading"] or "")
            curated = curated_matches(
                r["source_title"], r["page_start"], r["heading"] or ""
            )
            dispositions = {m["disposition"] for m in curated}
            if "STRUCTURED_RULE_CANDIDATE" in dispositions:
                final_disposition = "STRUCTURED_RULE_CANDIDATE"
            elif "REVIEW_CONTEXT" in dispositions:
                final_disposition = "REVIEW_CONTEXT"
            else:
                final_disposition = ""

            rows.append({
                "section_id": r["section_id"],
                "revision_id": r["revision_id"],
                "source_id": r["source_id"],
                "source_title": r["source_title"],
                "filename": r["filename"],
                "publication_year": r["publication_year"],
                "rules_version": r["rules_version"],
                "source_kind": r["source_kind"],
                "source_priority": r["source_priority"],
                "page_start": r["page_start"],
                "page_end": r["page_end"],
                "heading": r["heading"],
                "normalized_heading": norm_heading(r["heading"]),
                "broad_heading_hits": broad,
                "curated_matches": curated,
                "final_disposition": final_disposition,
                "body_excerpt": re.sub(r"\s+", " ", r["body"] or "")[:1600],
            })
    finally:
        db.close()

    core_count = len(rows)
    broad_rows = [r for r in rows if r["broad_heading_hits"]]
    curated_rows = [r for r in rows if r["curated_matches"]]
    structured_rows = [
        r for r in rows if r["final_disposition"] == "STRUCTURED_RULE_CANDIDATE"
    ]
    review_rows = [
        r for r in rows if r["final_disposition"] == "REVIEW_CONTEXT"
    ]
    curated_ids = {r["section_id"] for r in curated_rows}
    residual_broad = [
        r for r in broad_rows if r["section_id"] not in curated_ids
    ]

    actual = {
        "core_2024_section_candidates": core_count,
        "broad_heading_candidates": len(broad_rows),
        "curated_candidates": len(curated_rows),
        "structured_candidates": len(structured_rows),
        "review_context": len(review_rows),
        "residual_broad_heading_candidates": len(residual_broad),
    }
    for key, expected in EXPECTED.items():
        if key == "registered_sources":
            continue
        if actual[key] != expected:
            raise RuntimeError(
                f"V3 source drift {key}: expected={expected} actual={actual[key]}"
            )

    # Family links can exceed section count because one section may support multiple families.
    family_links = []
    for row in curated_rows:
        for match in row["curated_matches"]:
            family_links.append({
                "section_id": row["section_id"],
                "source_title": row["source_title"],
                "page_start": row["page_start"],
                "heading": row["heading"],
                "family": match["family"],
                "disposition": match["disposition"],
            })

    family_summary = []
    for family in sorted({x["family"] for x in family_links}):
        links = [x for x in family_links if x["family"] == family]
        section_ids = {x["section_id"] for x in links}
        family_summary.append({
            "family": family,
            "section_count": len(section_ids),
            "structured_link_count": sum(
                1 for x in links if x["disposition"] == "STRUCTURED_RULE_CANDIDATE"
            ),
            "review_link_count": sum(
                1 for x in links if x["disposition"] == "REVIEW_CONTEXT"
            ),
            "sources": sorted({x["source_title"] for x in links}),
            "pages": sorted({x["page_start"] for x in links}),
        })

    # Exact-heading duplicates inside current 2024 core sources.
    duplicate_counter = Counter()
    for row in curated_rows:
        key = (
            row["source_title"],
            row["page_start"],
            row["normalized_heading"],
        )
        duplicate_counter[key] += 1
    duplicate_rows = [
        {
            "source_title": key[0],
            "page_start": key[1],
            "normalized_heading": key[2],
            "duplicate_count": count,
        }
        for key, count in duplicate_counter.items()
        if count > 1
    ]

    write_csv(output / "phase8_v3_all_2024_core_sections.csv", rows)
    write_csv(output / "phase8_v3_broad_heading_candidates.csv", broad_rows)
    write_csv(output / "phase8_v3_structured_candidates.csv", structured_rows)
    write_csv(output / "phase8_v3_review_context.csv", review_rows)
    write_csv(output / "phase8_v3_residual_broad_heading_candidates.csv", residual_broad)
    write_csv(output / "phase8_v3_family_links.csv", family_links)
    write_csv(output / "phase8_v3_family_summary.csv", family_summary)
    write_csv(output / "phase8_v3_curated_duplicate_groups.csv", duplicate_rows)

    report = {
        "package": "PHASE8_2024_CORE_RULE_FAMILY_AUDIT_V3",
        "createdAt": now_iso(),
        "readOnly": True,
        "phase7Dependency": dependency,
        "rulesKnowledgeIntegrity": integrity,
        "rulesKnowledgeForeignKeyErrors": len(fk_errors),
        "registeredSources": registered_sources,
        **actual,
        "familyLinks": len(family_links),
        "familySummary": family_summary,
        "curatedDuplicateGroups": len(duplicate_rows),
        "blockers": [],
        "phaseStatus": "PHASE8_2024_CORE_RULE_FAMILY_AUDIT_COMPLETE",
        "next": "REVIEW_V3_AND_BUILD_PHASE8_STRUCTURED_BASELINE",
    }
    (output / "phase8_2024_core_rule_family_audit_v3_report.json").write_text(
        json.dumps(report, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )

    summary = [
        "# Phase 8 — 2024 Core Rule-Family Audit V3",
        "",
        "**Mode: READ-ONLY**",
        "",
        f"- Phase 7 dependency: PASS",
        f"- rules_knowledge integrity: {integrity}",
        f"- registered sources: {registered_sources}",
        f"- 2024 PHB/DMG sections examined: {core_count}",
        f"- broad heading candidates: {len(broad_rows)}",
        f"- curated Phase 8 candidates: {len(curated_rows)}",
        f"- structured candidates: {len(structured_rows)}",
        f"- review-context candidates: {len(review_rows)}",
        f"- residual broad/noise candidates: {len(residual_broad)}",
        f"- curated duplicate heading groups: {len(duplicate_rows)}",
        "",
        "## Scope principle",
        "",
        "V3 treats PHB 2024 and DMG 2024 current revisions as the primary structured Phase 8",
        "source surface. Spell names, magic items, monster text, setting names such as",
        "`Mount Celestia`, class feature headings, and generic keyword collisions remain outside",
        "the structured baseline unless later evidence proves they encode a Phase 8 mechanic.",
        "",
        "No database or project source is modified.",
        "",
        "**Status: PHASE8_2024_CORE_RULE_FAMILY_AUDIT_COMPLETE**",
    ]
    (output / "PHASE8_2024_CORE_RULE_FAMILY_AUDIT_V3_SUMMARY.md").write_text(
        "\n".join(summary) + "\n",
        encoding="utf-8",
    )

    print("PHASE 8 2024 CORE RULE-FAMILY AUDIT V3 COMPLETE")
    print("READ_ONLY=YES")
    print("PHASE7_DEPENDENCY=PASS")
    print(f"RULES_KNOWLEDGE_INTEGRITY={integrity}")
    print(f"RULES_KNOWLEDGE_FOREIGN_KEYS={len(fk_errors)}")
    print(f"REGISTERED_SOURCES={registered_sources}")
    print(f"CORE_2024_SECTIONS={core_count}")
    print(f"BROAD_HEADING_CANDIDATES={len(broad_rows)}")
    print(f"CURATED_CANDIDATES={len(curated_rows)}")
    print(f"STRUCTURED_CANDIDATES={len(structured_rows)}")
    print(f"REVIEW_CONTEXT={len(review_rows)}")
    print(f"RESIDUAL_BROAD_HEADING_CANDIDATES={len(residual_broad)}")
    print(f"FAMILY_LINKS={len(family_links)}")
    print(f"CURATED_DUPLICATE_GROUPS={len(duplicate_rows)}")
    print("BLOCKERS=0")
    print("PHASE_STATUS=PHASE8_2024_CORE_RULE_FAMILY_AUDIT_COMPLETE")
    print("NEXT=REVIEW_V3_AND_BUILD_PHASE8_STRUCTURED_BASELINE")
    print(f"OUTPUT={output}")
    return 0

if __name__ == "__main__":
    raise SystemExit(main())
