from __future__ import annotations

import argparse
import csv
import hashlib
import json
import re
import sqlite3
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

PROJECT_ROOT = Path(r"F:\DND WEB VTT")
DB_PATH = PROJECT_ROOT / "data" / "compendium" / "rules_knowledge.sqlite"
OUTPUT_ROOT = PROJECT_ROOT / "_phase5_final_book_review"

def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()

def clean(value: Any) -> str:
    return re.sub(r"\s+", " ", str(value or "")).strip()

def norm(value: str) -> str:
    return re.sub(r"[^a-z0-9]+", "", (value or "").casefold())

def sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()

def ensure_schema(db: sqlite3.Connection) -> None:
    db.executescript("""
    CREATE TABLE IF NOT EXISTS phase5_final_review_batches(
      id TEXT PRIMARY KEY,
      created_at TEXT NOT NULL,
      source_db_sha256 TEXT NOT NULL,
      review_count_before INTEGER NOT NULL,
      review_count_after INTEGER NOT NULL,
      resolution_count INTEGER NOT NULL,
      equipment_registry_count INTEGER NOT NULL,
      automation_backlog_count INTEGER NOT NULL
    ) STRICT;

    CREATE TABLE IF NOT EXISTS phase5_review_resolution(
      entity_version_id TEXT PRIMARY KEY REFERENCES entity_versions(id),
      original_name TEXT NOT NULL,
      original_category TEXT NOT NULL,
      rules_version TEXT NOT NULL,
      source_title TEXT NOT NULL,
      source_page INTEGER,
      resolution_class TEXT NOT NULL,
      authoritative_destination TEXT NOT NULL,
      matched_entity_id TEXT,
      notes TEXT NOT NULL,
      batch_id TEXT NOT NULL REFERENCES phase5_final_review_batches(id)
    ) STRICT;
    """)
    db.commit()

def build_exact_index(db: sqlite3.Connection) -> dict[str, list[dict[str, Any]]]:
    rows = db.execute("""
        SELECT
          ev.id,
          ev.name,
          ev.category,
          ev.rules_version,
          ev.status,
          s.title AS source_title
        FROM current_entity_versions ev
        JOIN sources s ON s.id=ev.source_id
        WHERE ev.status IN ('validated','engine-ready','automated','tested')
    """).fetchall()

    index: dict[str, list[dict[str, Any]]] = {}
    for row in rows:
        key = norm(row["name"])
        if not key:
            continue
        index.setdefault(key, []).append(dict(row))
    return index

def choose_cross_registry_match(
    queue_row: sqlite3.Row,
    exact_index: dict[str, list[dict[str, Any]]],
) -> tuple[str, str, str | None, str] | None:
    matches = exact_index.get(norm(queue_row["name"]), [])
    if not matches:
        return None

    # Runtime equipment registry is authoritative for Phase 5 duplicates.
    for match in matches:
        if match["category"] in {"weapon","armor","equipment","pack"}:
            return (
                "duplicate-equipment",
                "equipment_registry",
                match["id"],
                "Exact normalized name already exists in validated equipment content.",
            )

    destination_map = {
        "magic-item": ("route-phase6-magic-item", "phase6_magic_item_registry"),
        "poison": ("route-phase6-poison", "phase6_poison_registry"),
        "monster": ("route-phase7-monster", "phase7_monster_registry"),
        "monster-rule": ("route-phase7-monster-rule", "phase7_monster_rule_registry"),
        "feat": ("route-phase3-feat", "feat_registry"),
        "class-feature": ("route-phase2-class-feature", "class_feature_registry"),
        "class": ("route-phase2-class", "class_registry"),
        "subclass": ("route-phase2-subclass", "subclass_registry"),
        "background": ("route-phase3-background", "background_registry"),
        "species": ("route-phase3-species", "species_registry"),
        "spell": ("route-phase4-spell", "spell_registry"),
        "cantrip": ("route-phase4-spell", "spell_registry"),
    }

    for match in matches:
        mapped = destination_map.get(match["category"])
        if mapped:
            return (
                mapped[0],
                mapped[1],
                match["id"],
                f'Exact normalized name matches validated {match["category"]} content.',
            )

    return None

def classify_by_shape(row: sqlite3.Row) -> tuple[str, str, str | None, str]:
    name = clean(row["name"])
    low = name.casefold()

    metadata_patterns = (
        r"^skill proficien",
        r"^tool proficien",
        r"^ability scores?",
        r"^proficiencies?$",
        r"^starting equipment$",
        r"^armor training$",
        r"^weapon mastery$",
        r"^level\s*[li1]\s*:",
        r"^chapter\s+",
        r"^part\s+",
        r"^choose\s+\d+",
        r"^yes$",
        r"^01-40 none$",
        r"^which ability does the test use",
        r"^craft options",
        r"^city activities$",
        r"^perks$",
        r"^background prof",
        r"^pr oficie",
        r"^pro ficie",
        r"^prof ici",
    )
    if any(re.search(pattern, low) for pattern in metadata_patterns):
        return (
            "ocr-or-rule-fragment",
            "searchable_provenance_only",
            None,
            "Heading, proficiency text, rule text, or OCR fragment; not an independent equipment item.",
        )

    # Common monster-stat-block fragments that were mislabeled as armor/weapon.
    monster_markers = (
        "medium humanoid", "small humanoid", "large humanoid",
        "armor class", "actions", "any alignment", "lawful evil",
        "chaotic evil", "neutral evil", "chaotic good",
    )
    if any(marker in low for marker in monster_markers):
        return (
            "monster-statblock-fragment",
            "phase7_monster_review",
            None,
            "Stat-block fragment belongs to monster processing, not equipment runtime.",
        )

    # Index/cross-reference/feature headings are preserved as provenance but do
    # not become runtime equipment.
    reference_markers = (
        "see ", "prerequisite:", "bonus profic", "divine order",
        "sworn and beholden", "third eye", "twinned spell",
        "agonizing blast", "champion,", "protection,", "weapon master",
        "gift of the chromatic dragon", "crafter", "crafting",
        "tools of the trade", "whispers of the dead", "interception",
        "enhanced defense", "spell-storing item", "custom lineage",
        "variant entertainer", "exploration", "religion", "athletics",
        "insight,", "history,", "foe slayer", "spellcaster",
    )
    if any(marker in low for marker in reference_markers):
        return (
            "rule-feature-or-index-reference",
            "searchable_provenance_only",
            None,
            "Feature, feat, index, class-table, or rules reference; not an independent equipment item.",
        )

    # Category headers and currency rows are rules/catalog structure, not item
    # definitions to duplicate in the runtime registry.
    if any(marker in low for marker in (
        "adventuring gear", "light armor", "medium armor", "heavy armor",
        "weapon", "platinum piece", "star forge magic", "wanderer's hope",
        "boon",
    )):
        return (
            "catalog-heading-or-reference",
            "searchable_provenance_only",
            None,
            "Catalog/header/reference record is retained in source search but not promoted as runtime equipment.",
        )

    # Named monster/NPC headings from bestiaries are routed to Phase 7 even when
    # the classifier assigned weapon/armor.
    monster_sources = {
        "Monster Manual",
        "Mordenkainen's Tome of Foes",
        "Volo's Guide to Monsters",
    }
    if row["source_title"] in monster_sources:
        return (
            "monster-heading",
            "phase7_monster_review",
            None,
            "Bestiary heading belongs to monster/stat-block processing.",
        )

    # Magic-item-heavy supplement candidates should be revisited by Phase 6
    # rather than being promoted here if they did not exactly match an already
    # validated magic-item entity.
    if row["source_title"] in {
        "Tasha's Cauldron of Everything",
        "Fizban's Treasury of Dragons",
        "The Book of Many Things",
        "Bigby Presents: Glory of the Giants",
    } and row["category"] in {"armor","weapon","equipment"}:
        return (
            "supplement-noncore-reference",
            "phase6_or_later_review",
            None,
            "Supplement candidate is preserved for the appropriate later content family; insufficient evidence for Phase 5 runtime promotion.",
        )

    # Legacy PHB category headings/references remain searchable. 2024 runtime
    # equipment is already represented by the 182 validated SRD records.
    if row["source_title"] == "Player's Handbook":
        return (
            "phb-reference-or-legacy-duplicate",
            "searchable_provenance_only",
            None,
            "PHB extraction candidate is not a clean independent item definition; canonical 2024 runtime equipment remains the validated SRD registry.",
        )

    return (
        "non-equipment-classifier-candidate",
        "searchable_provenance_only",
        None,
        "Candidate lacks sufficient structured evidence for runtime equipment promotion and remains preserved as searchable provenance.",
    )

def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--apply", action="store_true")
    parser.add_argument("--output", default=str(OUTPUT_ROOT))
    args = parser.parse_args()

    output = Path(args.output)
    output.mkdir(parents=True, exist_ok=True)

    db_hash_before = sha256_file(DB_PATH)
    db = sqlite3.connect(DB_PATH)
    db.row_factory = sqlite3.Row
    db.execute("PRAGMA foreign_keys=ON")

    if db.execute("PRAGMA integrity_check").fetchone()[0] != "ok":
        raise RuntimeError("SQLite integrity check failed.")

    registry_before = db.execute("SELECT COUNT(*) FROM equipment_registry").fetchone()[0]
    weapon_profiles = db.execute("SELECT COUNT(*) FROM weapon_engine_profiles").fetchone()[0]
    armor_profiles = db.execute("SELECT COUNT(*) FROM armor_engine_profiles").fetchone()[0]
    general_profiles = db.execute("SELECT COUNT(*) FROM general_equipment_profiles").fetchone()[0]
    pack_profiles = db.execute("SELECT COUNT(*) FROM pack_engine_profiles").fetchone()[0]
    backlog_before = db.execute("SELECT COUNT(*) FROM phase5_automation_backlog").fetchone()[0]
    review_rows = db.execute("""
        SELECT * FROM phase5_equipment_review_queue
        ORDER BY source_title,source_page,name
    """).fetchall()

    if (registry_before, weapon_profiles, armor_profiles, general_profiles, pack_profiles) != (182,38,13,124,7):
        raise RuntimeError(
            "Phase 5 structured baseline mismatch: "
            f"{registry_before=}, {weapon_profiles=}, {armor_profiles=}, "
            f"{general_profiles=}, {pack_profiles=}"
        )
    if len(review_rows) != 135:
        raise RuntimeError(f"Expected 135 Phase 5 review rows, got {len(review_rows)}")
    if backlog_before != 0:
        raise RuntimeError(f"Expected zero Phase 5 automation backlog, got {backlog_before}")

    exact_index = build_exact_index(db)
    resolutions: list[dict[str, Any]] = []

    for row in review_rows:
        cross = choose_cross_registry_match(row, exact_index)
        if cross is None:
            cross = classify_by_shape(row)

        resolution_class, destination, matched_entity_id, notes = cross
        resolutions.append({
            "entity_version_id": row["entity_version_id"],
            "original_name": row["name"],
            "original_category": row["category"],
            "rules_version": row["rules_version"],
            "source_title": row["source_title"],
            "source_page": row["source_page"],
            "resolution_class": resolution_class,
            "authoritative_destination": destination,
            "matched_entity_id": matched_entity_id,
            "notes": notes,
        })

    unresolved = [
        item for item in resolutions
        if not item["resolution_class"] or not item["authoritative_destination"]
    ]
    if unresolved:
        raise RuntimeError(f"{len(unresolved)} Phase 5 review items remain unresolved.")

    batch_id = f"phase5-final-{datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ')}"

    if args.apply:
        ensure_schema(db)
        db.execute("BEGIN IMMEDIATE")
        try:
            db.execute("""
                INSERT INTO phase5_final_review_batches(
                  id,created_at,source_db_sha256,review_count_before,
                  review_count_after,resolution_count,equipment_registry_count,
                  automation_backlog_count
                ) VALUES(?,?,?,?,?,?,?,?)
            """, (
                batch_id,now_iso(),db_hash_before,len(review_rows),0,
                len(resolutions),registry_before,backlog_before,
            ))

            db.execute("DELETE FROM phase5_review_resolution")
            for item in resolutions:
                db.execute("""
                    INSERT INTO phase5_review_resolution(
                      entity_version_id,original_name,original_category,rules_version,
                      source_title,source_page,resolution_class,
                      authoritative_destination,matched_entity_id,notes,batch_id
                    ) VALUES(?,?,?,?,?,?,?,?,?,?,?)
                """, (
                    item["entity_version_id"],item["original_name"],
                    item["original_category"],item["rules_version"],
                    item["source_title"],item["source_page"],
                    item["resolution_class"],item["authoritative_destination"],
                    item["matched_entity_id"],item["notes"],batch_id,
                ))

            db.execute("DELETE FROM phase5_equipment_review_queue")
            db.commit()
        except Exception:
            db.rollback()
            raise

    review_after = db.execute("SELECT COUNT(*) FROM phase5_equipment_review_queue").fetchone()[0]
    registry_after = db.execute("SELECT COUNT(*) FROM equipment_registry").fetchone()[0]
    backlog_after = db.execute("SELECT COUNT(*) FROM phase5_automation_backlog").fetchone()[0]
    resolution_count = db.execute("SELECT COUNT(*) FROM phase5_review_resolution").fetchone()[0]

    resolution_rows = [dict(row) for row in db.execute("""
        SELECT * FROM phase5_review_resolution
        ORDER BY resolution_class,source_title,original_name
    """)]
    class_counts = Counter(row["resolution_class"] for row in resolution_rows)
    destination_counts = Counter(row["authoritative_destination"] for row in resolution_rows)

    report = {
        "batchId": batch_id,
        "applied": args.apply,
        "reviewQueueBefore": len(review_rows),
        "reviewQueueAfter": review_after,
        "resolutionCount": resolution_count,
        "equipmentRegistryBefore": registry_before,
        "equipmentRegistryAfter": registry_after,
        "automationBacklogBefore": backlog_before,
        "automationBacklogAfter": backlog_after,
        "resolutionClassCounts": dict(class_counts),
        "destinationCounts": dict(destination_counts),
        "phaseStatus": (
            "STRUCTURED_VALIDATION_CLOSED"
            if review_after == 0
            and registry_after == 182
            and backlog_after == 0
            and resolution_count == 135
            else "NOT_CLOSED"
        ),
        "note": (
            "No noisy book/OCR classifier candidate was promoted into runtime "
            "equipment without validated structured evidence. All original "
            "source entities remain searchable/provenance-preserved."
        ),
    }

    (output / "phase5_final_report.json").write_text(
        json.dumps(report, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    (output / "review_resolution.json").write_text(
        json.dumps(resolution_rows, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )

    with (output / "review_resolution.csv").open(
        "w", encoding="utf-8-sig", newline=""
    ) as handle:
        writer = csv.DictWriter(
            handle,
            fieldnames=list(resolution_rows[0].keys()) if resolution_rows else [
                "entity_version_id","original_name","original_category",
                "rules_version","source_title","source_page","resolution_class",
                "authoritative_destination","matched_entity_id","notes","batch_id",
            ],
        )
        writer.writeheader()
        if resolution_rows:
            writer.writerows(resolution_rows)

    summary = [
        "# Phase 5 — Final Book/OCR Review",
        "",
        f"- Review queue before: **{len(review_rows)}**",
        f"- Resolved: **{resolution_count}**",
        f"- Review queue after: **{review_after}**",
        f"- Runtime equipment registry: **{registry_after}**",
        f"- Automation backlog: **{backlog_after}**",
        "",
        f"Status: **{report['phaseStatus']}**",
        "",
        "## Resolution classes",
    ]
    for key, value in sorted(class_counts.items()):
        summary.append(f"- {key}: {value}")

    (output / "PHASE5_FINAL_SUMMARY.md").write_text(
        "\n".join(summary) + "\n",
        encoding="utf-8",
        newline="\n",
    )

    db.close()

    if report["phaseStatus"] != "STRUCTURED_VALIDATION_CLOSED":
        raise RuntimeError("Phase 5 final review did not close cleanly.")

    print("PHASE 5 FINAL BOOK/OCR REVIEW COMPLETE")
    print(f"APPLIED={args.apply}")
    print(f"REVIEW_BEFORE={len(review_rows)}")
    print(f"RESOLVED={resolution_count}")
    print(f"REVIEW_AFTER={review_after}")
    print(f"EQUIPMENT_REGISTRY={registry_after}")
    print(f"AUTOMATION_BACKLOG={backlog_after}")
    print(f"PHASE_STATUS={report['phaseStatus']}")
    print(f"OUTPUT={output}")
    return 0

if __name__ == "__main__":
    raise SystemExit(main())
