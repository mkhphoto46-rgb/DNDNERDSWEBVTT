from __future__ import annotations

import argparse
import csv
import difflib
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
OUTPUT_ROOT = PROJECT_ROOT / "_phase6_book_content_recovery"

ITEM_DESCRIPTOR_RE = re.compile(
    r"(?i)\b("
    r"wondrous\s+item|weapon(?:\s*\([^)]+\))?|armor(?:\s*\([^)]+\))?|"
    r"potion|ring|rod|staff|wand|scroll|ammunition|shield"
    r")\s*,\s*"
    r"(common|uncommon|rare|very\s+rare|legendary|artifact|rarity\s+varies|varies)"
)

POISON_TYPES = ("ingested", "inhaled", "contact", "injury")
CONDITIONS = (
    "Blinded","Charmed","Deafened","Exhaustion","Frightened","Grappled",
    "Incapacitated","Invisible","Paralyzed","Petrified","Poisoned","Prone",
    "Restrained","Stunned","Unconscious",
)
DAMAGE_TYPES = (
    "Acid","Bludgeoning","Cold","Fire","Force","Lightning","Necrotic",
    "Piercing","Poison","Psychic","Radiant","Slashing","Thunder",
)

NOISE_NAMES = {
    "actions","legendary actions","mythic actions","reactions","chapter 7 treasure",
    "adventure hook","skill","weapon","armor","magic item rarity","perks",
    "craft options","city activities","proficiencies","starting equipment",
}

def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()

def clean(value: Any) -> str:
    return re.sub(r"\s+", " ", str(value or "")).strip()

def norm(value: str) -> str:
    return re.sub(r"[^a-z0-9]+", "", (value or "").casefold())

def slug(value: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", (value or "").casefold()).strip("-")

def ocr_norm(value: str) -> str:
    s = norm(value)
    table = str.maketrans({
        "0":"o","1":"i","5":"s","8":"b",
    })
    return s.translate(table)

def similarity(a: str, b: str) -> float:
    aa, bb = ocr_norm(a), ocr_norm(b)
    if not aa or not bb:
        return 0.0
    if aa == bb:
        return 1.0
    return difflib.SequenceMatcher(None, aa, bb).ratio()

def sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()

def parse_json(value: str | None) -> dict[str, Any]:
    try:
        obj = json.loads(value or "{}")
        return obj if isinstance(obj, dict) else {}
    except Exception:
        return {}

def name_quality(name: str) -> tuple[bool, str]:
    n = clean(name)
    low = n.casefold()
    if low in NOISE_NAMES:
        return False, "generic-heading"
    if len(n) < 3 or len(n) > 80:
        return False, "length"
    if re.search(r"(?i)\b(challenge|proficiency bonus|languages|gear |habitat|treasure:|chapter|d100|d20|effect)\b", n):
        return False, "statblock-table-reference"
    if re.search(r"\d{2,}", n):
        return False, "numeric-table-fragment"
    letters = sum(ch.isalpha() for ch in n)
    if letters / max(1, len(n)) < 0.68:
        return False, "low-letter-ratio"
    words = n.split()
    if len(words) > 10:
        return False, "too-many-words"
    return True, "ok"

def detect_descriptor(raw: str) -> tuple[str | None, str | None, bool]:
    head = clean(raw[:650])
    m = ITEM_DESCRIPTOR_RE.search(head)
    if not m:
        return None, None, False
    item_type = clean(m.group(1)).title()
    rarity = clean(m.group(2)).title()
    attune = bool(re.search(r"(?i)\brequires?\s+attunement\b", head))
    return item_type, rarity, attune

def detect_recharge(text: str) -> tuple[str | None, str | None]:
    low = text.casefold()
    kind = None
    if "at dawn" in low:
        kind = "DAWN"
    elif "finish a long rest" in low:
        kind = "LONG_REST"
    elif "finish a short rest" in low:
        kind = "SHORT_REST"
    elif "daily" in low or "each day" in low:
        kind = "DAILY_OTHER"
    formula = None
    m = re.search(
        r"(?i)\bregains?\s+(\d+d(?:4|6|8|10|12|20)(?:\s*[+-]\s*\d+)?)\s+expended charges?\b",
        text,
    )
    if m:
        formula = m.group(1).replace(" ", "")
    else:
        m = re.search(r"(?i)\bregains?\s+(\d+)\s+expended charges?\b", text)
        if m:
            formula = m.group(1)
    return kind, formula

def detect_conditions(text: str) -> list[str]:
    return [
        c for c in CONDITIONS
        if re.search(rf"(?i)\b{re.escape(c)}(?: condition)?\b", text)
    ]

def detect_damage_types(text: str) -> list[str]:
    return [
        d for d in DAMAGE_TYPES
        if re.search(rf"(?i)\b{re.escape(d)} damage\b", text)
    ]

def magic_profile(raw: str, item_type: str, rarity: str, attunement: bool) -> dict[str, Any]:
    charges = None
    m = re.search(r"(?i)\bhas\s+(\d+)\s+charges?\b", raw)
    if m:
        charges = int(m.group(1))
    recharge_kind, recharge_formula = detect_recharge(raw)
    save_dc = None
    m = re.search(r"(?i)\b(?:save\s+)?dc\s+(\d{1,2})\b", raw)
    if m:
        save_dc = int(m.group(1))
    activation = []
    low = raw.casefold()
    if "bonus action" in low:
        activation.append("Bonus Action")
    if "reaction" in low:
        activation.append("Reaction")
    if "magic action" in low:
        activation.append("Magic Action")
    elif re.search(r"(?i)\bas an action\b|\buse an action\b", raw):
        activation.append("Action")
    return {
        "item_type": item_type,
        "rarity": rarity,
        "requires_attunement": attunement,
        "max_charges": charges,
        "recharge_kind": recharge_kind,
        "recharge_formula": recharge_formula,
        "save_dc": save_dc,
        "activation_types": sorted(set(activation)),
        "condition_tags": detect_conditions(raw),
        "damage_types": detect_damage_types(raw),
    }

def poison_profile(row: sqlite3.Row) -> dict[str, Any] | None:
    raw = row["raw_text"] or ""
    s = parse_json(row["structured_json"])
    low = (clean(row["subcategory"]) + " " + raw[:500]).casefold()
    poison_type = next((p for p in POISON_TYPES if p in low), None)
    if not poison_type:
        return None

    save_ability = None
    m = re.search(
        r"(?i)\b(strength|dexterity|constitution|intelligence|wisdom|charisma)\s+saving throw\b",
        raw,
    )
    if m:
        save_ability = m.group(1).title()

    save_dc = None
    m = re.search(r"(?i)\bdc\s+(\d{1,2})\b", raw)
    if m:
        save_dc = int(m.group(1))

    dice = None
    m = re.search(r"(?i)\b(\d+d(?:4|6|8|10|12|20|100))\b", raw)
    if m:
        dice = m.group(1)

    conditions = detect_conditions(raw)
    damage_types = detect_damage_types(raw)

    if save_dc is None or save_ability is None or (dice is None and not conditions):
        return None

    return {
        "poison_type": poison_type,
        "application_method": poison_type,
        "save_ability": save_ability,
        "save_dc": save_dc,
        "damage_dice": dice or "",
        "damage_types": damage_types,
        "conditions": conditions,
        "duration_text": "",
        "onset_text": "",
    }

def ensure_schema(db: sqlite3.Connection) -> None:
    db.executescript("""
    CREATE TABLE IF NOT EXISTS phase6_book_recovery_batches(
      id TEXT PRIMARY KEY,
      created_at TEXT NOT NULL,
      source_db_sha256 TEXT NOT NULL,
      queue_before INTEGER NOT NULL,
      duplicate_count INTEGER NOT NULL,
      recovered_magic_item_count INTEGER NOT NULL,
      recovered_poison_count INTEGER NOT NULL,
      noise_count INTEGER NOT NULL,
      residual_count INTEGER NOT NULL
    ) STRICT;

    CREATE TABLE IF NOT EXISTS book_magic_item_registry(
      book_magic_item_id TEXT PRIMARY KEY,
      item_name TEXT NOT NULL,
      entity_version_id TEXT NOT NULL REFERENCES entity_versions(id),
      rules_version TEXT NOT NULL,
      source_id TEXT NOT NULL REFERENCES sources(id),
      source_title TEXT NOT NULL,
      source_page INTEGER,
      validation_scope TEXT NOT NULL,
      batch_id TEXT NOT NULL REFERENCES phase6_book_recovery_batches(id),
      validated_at TEXT NOT NULL
    ) STRICT;

    CREATE TABLE IF NOT EXISTS book_magic_item_engine_profiles(
      book_magic_item_id TEXT PRIMARY KEY REFERENCES book_magic_item_registry(book_magic_item_id),
      item_type TEXT NOT NULL,
      rarity TEXT NOT NULL,
      requires_attunement INTEGER NOT NULL,
      max_charges INTEGER,
      recharge_kind TEXT,
      recharge_formula TEXT,
      save_dc INTEGER,
      activation_types_json TEXT NOT NULL,
      condition_tags_json TEXT NOT NULL,
      damage_types_json TEXT NOT NULL
    ) STRICT;

    CREATE TABLE IF NOT EXISTS book_poison_registry(
      book_poison_id TEXT PRIMARY KEY,
      poison_name TEXT NOT NULL,
      entity_version_id TEXT NOT NULL REFERENCES entity_versions(id),
      rules_version TEXT NOT NULL,
      source_id TEXT NOT NULL REFERENCES sources(id),
      source_title TEXT NOT NULL,
      source_page INTEGER,
      validation_scope TEXT NOT NULL,
      batch_id TEXT NOT NULL REFERENCES phase6_book_recovery_batches(id),
      validated_at TEXT NOT NULL
    ) STRICT;

    CREATE TABLE IF NOT EXISTS book_poison_engine_profiles(
      book_poison_id TEXT PRIMARY KEY REFERENCES book_poison_registry(book_poison_id),
      poison_type TEXT NOT NULL,
      application_method TEXT NOT NULL,
      save_ability TEXT NOT NULL,
      save_dc INTEGER NOT NULL,
      damage_dice TEXT NOT NULL,
      damage_types_json TEXT NOT NULL,
      conditions_json TEXT NOT NULL,
      duration_text TEXT NOT NULL,
      onset_text TEXT NOT NULL
    ) STRICT;

    CREATE TABLE IF NOT EXISTS phase6_book_review_resolution(
      entity_version_id TEXT PRIMARY KEY REFERENCES entity_versions(id),
      original_name TEXT NOT NULL,
      category TEXT NOT NULL,
      resolution_class TEXT NOT NULL,
      destination TEXT NOT NULL,
      matched_runtime_id TEXT,
      notes TEXT NOT NULL,
      batch_id TEXT NOT NULL REFERENCES phase6_book_recovery_batches(id)
    ) STRICT;

    CREATE TABLE IF NOT EXISTS phase6_residual_review_queue(
      entity_version_id TEXT PRIMARY KEY REFERENCES entity_versions(id),
      name TEXT NOT NULL,
      category TEXT NOT NULL,
      rules_version TEXT NOT NULL,
      source_title TEXT NOT NULL,
      source_page INTEGER,
      reason TEXT NOT NULL,
      batch_id TEXT NOT NULL REFERENCES phase6_book_recovery_batches(id)
    ) STRICT;
    """)
    db.commit()

def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--apply", action="store_true")
    parser.add_argument("--output", default=str(OUTPUT_ROOT))
    args = parser.parse_args()

    output = Path(args.output)
    output.mkdir(parents=True, exist_ok=True)

    db_hash = sha256_file(DB_PATH)
    db = sqlite3.connect(DB_PATH)
    db.row_factory = sqlite3.Row
    db.execute("PRAGMA foreign_keys=ON")

    if db.execute("PRAGMA integrity_check").fetchone()[0] != "ok":
        raise RuntimeError("SQLite integrity check failed.")

    if db.execute("SELECT COUNT(*) FROM magic_item_registry").fetchone()[0] != 262:
        raise RuntimeError("Phase 6 magic-item baseline missing.")
    if db.execute("SELECT COUNT(*) FROM poison_registry").fetchone()[0] != 14:
        raise RuntimeError("Phase 6 poison baseline missing.")

    queue = db.execute("""
        SELECT q.*, ev.raw_text, ev.structured_json, ev.subcategory, ev.source_id
        FROM phase6_content_review_queue q
        JOIN entity_versions ev ON ev.id=q.entity_version_id
        ORDER BY q.source_title,q.source_page,q.name
    """).fetchall()

    runtime_magic = [
        dict(r) for r in db.execute(
            "SELECT magic_item_id,item_name FROM magic_item_registry"
        )
    ]
    runtime_poison = [
        dict(r) for r in db.execute(
            "SELECT poison_id,poison_name FROM poison_registry"
        )
    ]

    duplicates = []
    recovered_magic = []
    recovered_poison = []
    noise = []
    residual = []

    for row in queue:
        name = clean(row["name"])
        quality_ok, quality_reason = name_quality(name)

        # Conservative fuzzy duplicate matching to validated 2024 runtime data.
        best = None
        candidates = runtime_magic if row["category"] == "magic-item" else runtime_poison
        for candidate in candidates:
            cname = candidate.get("item_name") or candidate.get("poison_name")
            score = similarity(name, cname)
            if best is None or score > best[0]:
                best = (score, candidate, cname)
        if best and best[0] >= 0.925:
            cid = best[1].get("magic_item_id") or best[1].get("poison_id")
            duplicates.append({
                "row": row,
                "matched_id": cid,
                "matched_name": best[2],
                "score": best[0],
            })
            continue

        low = name.casefold()
        raw = row["raw_text"] or ""

        # Cross-family Phase 5 routes are not promoted here without native
        # magic-item/poison evidence.
        if row["category"] not in {"magic-item", "poison"}:
            noise.append({
                "row": row,
                "resolution": "cross-family-reference",
                "destination": "searchable-provenance-only",
                "notes": "Phase 5 route has no native Phase 6 category evidence.",
            })
            continue

        if row["category"] == "magic-item":
            item_type, rarity, attunement = detect_descriptor(raw)
            if item_type and rarity:
                if quality_ok:
                    recovered_magic.append({
                        "row": row,
                        "profile": magic_profile(raw, item_type, rarity, attunement),
                    })
                else:
                    residual.append({
                        "row": row,
                        "reason": f"Valid magic-item descriptor but title needs OCR/name repair: {quality_reason}",
                    })
                continue

        if row["category"] == "poison":
            profile = poison_profile(row)
            if profile is not None and quality_ok:
                recovered_poison.append({"row": row, "profile": profile})
                continue
            if profile is not None:
                residual.append({
                    "row": row,
                    "reason": f"Valid poison mechanics but title needs repair: {quality_reason}",
                })
                continue

        # Strong noise/reference patterns.
        if (
            not quality_ok
            or low in NOISE_NAMES
            or re.search(
                r"(?i)\b(actions|legendary actions|mythic actions|challenge \d+|"
                r"proficiency bonus|languages common|gear |habitat|treasure:|"
                r"chapter \d+|adventure hook|effect\b|rarity\b.*\d|hirelings)\b",
                name,
            )
        ):
            noise.append({
                "row": row,
                "resolution": "ocr-table-statblock-reference",
                "destination": "searchable-provenance-only",
                "notes": "No reliable independent Phase 6 content block.",
            })
            continue

        residual.append({
            "row": row,
            "reason": "Plausible named candidate but no reliable descriptor/mechanical block was recovered.",
        })

    batch_id = f"phase6-book-recovery-{datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ')}"

    if args.apply:
        ensure_schema(db)
        db.execute("BEGIN IMMEDIATE")
        try:
            db.execute("DELETE FROM book_magic_item_engine_profiles")
            db.execute("DELETE FROM book_magic_item_registry")
            db.execute("DELETE FROM book_poison_engine_profiles")
            db.execute("DELETE FROM book_poison_registry")
            db.execute("DELETE FROM phase6_book_review_resolution")
            db.execute("DELETE FROM phase6_residual_review_queue")

            db.execute("""
                INSERT INTO phase6_book_recovery_batches(
                  id,created_at,source_db_sha256,queue_before,duplicate_count,
                  recovered_magic_item_count,recovered_poison_count,noise_count,residual_count
                ) VALUES(?,?,?,?,?,?,?,?,?)
            """, (
                batch_id,now_iso(),db_hash,len(queue),len(duplicates),
                len(recovered_magic),len(recovered_poison),len(noise),len(residual)
            ))

            for item in duplicates:
                row = item["row"]
                db.execute("""
                    INSERT INTO phase6_book_review_resolution(
                      entity_version_id,original_name,category,resolution_class,
                      destination,matched_runtime_id,notes,batch_id
                    ) VALUES(?,?,?,?,?,?,?,?)
                """, (
                    row["entity_version_id"],row["name"],row["category"],
                    "validated-runtime-duplicate","existing-phase6-runtime",
                    item["matched_id"],
                    f"Conservative fuzzy match {item['score']:.3f} to {item['matched_name']}.",
                    batch_id,
                ))

            for item in recovered_magic:
                row, p = item["row"], item["profile"]
                item_id = (
                    f"book-magic-item.{row['rules_version']}."
                    f"{slug(row['source_title'])[:35]}.{slug(row['name'])[:65]}."
                    f"{row['source_page'] or 0}"
                )
                db.execute("""
                    INSERT INTO book_magic_item_registry(
                      book_magic_item_id,item_name,entity_version_id,rules_version,
                      source_id,source_title,source_page,validation_scope,batch_id,validated_at
                    ) VALUES(?,?,?,?,?,?,?,?,?,?)
                """, (
                    item_id,row["name"],row["entity_version_id"],row["rules_version"],
                    row["source_id"],row["source_title"],row["source_page"],
                    "book-descriptor-validated",batch_id,now_iso(),
                ))
                db.execute("""
                    INSERT INTO book_magic_item_engine_profiles(
                      book_magic_item_id,item_type,rarity,requires_attunement,
                      max_charges,recharge_kind,recharge_formula,save_dc,
                      activation_types_json,condition_tags_json,damage_types_json
                    ) VALUES(?,?,?,?,?,?,?,?,?,?,?)
                """, (
                    item_id,p["item_type"],p["rarity"],int(p["requires_attunement"]),
                    p["max_charges"],p["recharge_kind"],p["recharge_formula"],p["save_dc"],
                    json.dumps(p["activation_types"],ensure_ascii=False),
                    json.dumps(p["condition_tags"],ensure_ascii=False),
                    json.dumps(p["damage_types"],ensure_ascii=False),
                ))
                db.execute("""
                    INSERT INTO phase6_book_review_resolution(
                      entity_version_id,original_name,category,resolution_class,
                      destination,matched_runtime_id,notes,batch_id
                    ) VALUES(?,?,?,?,?,?,?,?)
                """, (
                    row["entity_version_id"],row["name"],"magic-item",
                    "book-magic-item-recovered","book_magic_item_registry",item_id,
                    "Recovered from explicit item-type + rarity descriptor.",batch_id,
                ))

            for item in recovered_poison:
                row, p = item["row"], item["profile"]
                poison_id = (
                    f"book-poison.{row['rules_version']}."
                    f"{slug(row['source_title'])[:35]}.{slug(row['name'])[:65]}."
                    f"{row['source_page'] or 0}"
                )
                db.execute("""
                    INSERT INTO book_poison_registry(
                      book_poison_id,poison_name,entity_version_id,rules_version,
                      source_id,source_title,source_page,validation_scope,batch_id,validated_at
                    ) VALUES(?,?,?,?,?,?,?,?,?,?)
                """, (
                    poison_id,row["name"],row["entity_version_id"],row["rules_version"],
                    row["source_id"],row["source_title"],row["source_page"],
                    "book-poison-mechanics-validated",batch_id,now_iso(),
                ))
                db.execute("""
                    INSERT INTO book_poison_engine_profiles(
                      book_poison_id,poison_type,application_method,save_ability,
                      save_dc,damage_dice,damage_types_json,conditions_json,
                      duration_text,onset_text
                    ) VALUES(?,?,?,?,?,?,?,?,?,?)
                """, (
                    poison_id,p["poison_type"],p["application_method"],p["save_ability"],
                    p["save_dc"],p["damage_dice"],
                    json.dumps(p["damage_types"],ensure_ascii=False),
                    json.dumps(p["conditions"],ensure_ascii=False),
                    p["duration_text"],p["onset_text"],
                ))
                db.execute("""
                    INSERT INTO phase6_book_review_resolution(
                      entity_version_id,original_name,category,resolution_class,
                      destination,matched_runtime_id,notes,batch_id
                    ) VALUES(?,?,?,?,?,?,?,?)
                """, (
                    row["entity_version_id"],row["name"],"poison",
                    "book-poison-recovered","book_poison_registry",poison_id,
                    "Recovered from poison type + save + damage/condition mechanics.",batch_id,
                ))

            for item in noise:
                row = item["row"]
                db.execute("""
                    INSERT INTO phase6_book_review_resolution(
                      entity_version_id,original_name,category,resolution_class,
                      destination,matched_runtime_id,notes,batch_id
                    ) VALUES(?,?,?,?,?,?,?,?)
                """, (
                    row["entity_version_id"],row["name"],row["category"],
                    item["resolution"],item["destination"],None,item["notes"],batch_id,
                ))

            for item in residual:
                row = item["row"]
                db.execute("""
                    INSERT INTO phase6_residual_review_queue(
                      entity_version_id,name,category,rules_version,source_title,
                      source_page,reason,batch_id
                    ) VALUES(?,?,?,?,?,?,?,?)
                """, (
                    row["entity_version_id"],row["name"],row["category"],
                    row["rules_version"],row["source_title"],row["source_page"],
                    item["reason"],batch_id,
                ))

            db.execute("DELETE FROM phase6_content_review_queue")
            db.commit()
        except Exception:
            db.rollback()
            raise

    counts = {
        "runtime_magic_items": db.execute("SELECT COUNT(*) FROM magic_item_registry").fetchone()[0],
        "runtime_poisons": db.execute("SELECT COUNT(*) FROM poison_registry").fetchone()[0],
        "book_magic_items": db.execute("SELECT COUNT(*) FROM book_magic_item_registry").fetchone()[0],
        "book_poisons": db.execute("SELECT COUNT(*) FROM book_poison_registry").fetchone()[0],
        "resolutions": db.execute("SELECT COUNT(*) FROM phase6_book_review_resolution").fetchone()[0],
        "residual": db.execute("SELECT COUNT(*) FROM phase6_residual_review_queue").fetchone()[0],
        "old_queue": db.execute("SELECT COUNT(*) FROM phase6_content_review_queue").fetchone()[0],
    }

    resolution_rows = [dict(r) for r in db.execute("""
        SELECT * FROM phase6_book_review_resolution
        ORDER BY resolution_class,original_name
    """)]
    residual_rows = [dict(r) for r in db.execute("""
        SELECT * FROM phase6_residual_review_queue
        ORDER BY source_title,source_page,name
    """)]
    book_magic_rows = [dict(r) for r in db.execute("""
        SELECT r.*,p.item_type,p.rarity,p.requires_attunement,p.max_charges,
               p.recharge_kind,p.recharge_formula,p.save_dc
        FROM book_magic_item_registry r
        JOIN book_magic_item_engine_profiles p USING(book_magic_item_id)
        ORDER BY r.source_title,r.item_name
    """)]
    book_poison_rows = [dict(r) for r in db.execute("""
        SELECT r.*,p.poison_type,p.save_ability,p.save_dc,p.damage_dice
        FROM book_poison_registry r
        JOIN book_poison_engine_profiles p USING(book_poison_id)
        ORDER BY r.source_title,r.poison_name
    """)]

    class_counts = Counter(r["resolution_class"] for r in resolution_rows)

    report = {
        "batchId":batch_id,
        "applied":args.apply,
        "queueBefore":len(queue),
        "duplicateCount":len(duplicates),
        "recoveredBookMagicItems":counts["book_magic_items"],
        "recoveredBookPoisons":counts["book_poisons"],
        "noiseResolved":len(noise),
        "residualCount":counts["residual"],
        "resolutionCount":counts["resolutions"],
        "oldQueueAfter":counts["old_queue"],
        "runtimeMagicItemsPreserved":counts["runtime_magic_items"],
        "runtimePoisonsPreserved":counts["runtime_poisons"],
        "resolutionClassCounts":dict(class_counts),
        "phaseStatus": (
            "BOOK_RECOVERY_COMPLETE_RESIDUAL_REVIEW_PENDING"
            if counts["residual"] > 0 else
            "BOOK_RECOVERY_COMPLETE"
        ),
    }

    (output/"phase6_book_recovery_report.json").write_text(
        json.dumps(report,ensure_ascii=False,indent=2)+"\n",encoding="utf-8"
    )

    def export(name: str, rows: list[dict[str, Any]]) -> None:
        (output/f"{name}.json").write_text(
            json.dumps(rows,ensure_ascii=False,indent=2)+"\n",encoding="utf-8"
        )
        fields = list(rows[0].keys()) if rows else ["empty"]
        with (output/f"{name}.csv").open("w",encoding="utf-8-sig",newline="") as f:
            w=csv.DictWriter(f,fieldnames=fields)
            w.writeheader()
            if rows:
                w.writerows(rows)

    export("book_magic_items",book_magic_rows)
    export("book_poisons",book_poison_rows)
    export("review_resolution",resolution_rows)
    export("residual_review_queue",residual_rows)

    summary = [
        "# Phase 6 — Book Content Recovery","",
        f"- Review queue before: **{len(queue)}**",
        f"- Existing runtime duplicates resolved: **{len(duplicates)}**",
        f"- Book magic items recovered: **{counts['book_magic_items']}**",
        f"- Book poisons recovered: **{counts['book_poisons']}**",
        f"- Noise/reference records resolved: **{len(noise)}**",
        f"- Residual review queue: **{counts['residual']}**","",
        f"Status: **{report['phaseStatus']}**",
    ]
    (output/"PHASE6_BOOK_RECOVERY_SUMMARY.md").write_text(
        "\n".join(summary)+"\n",encoding="utf-8",newline="\n"
    )

    db.close()

    print("PHASE 6 BOOK CONTENT RECOVERY COMPLETE")
    print(f"APPLIED={args.apply}")
    print(f"QUEUE_BEFORE={len(queue)}")
    print(f"DUPLICATES={len(duplicates)}")
    print(f"BOOK_MAGIC_ITEMS={counts['book_magic_items']}")
    print(f"BOOK_POISONS={counts['book_poisons']}")
    print(f"NOISE_RESOLVED={len(noise)}")
    print(f"RESIDUAL={counts['residual']}")
    print(f"PHASE_STATUS={report['phaseStatus']}")
    print(f"OUTPUT={output}")
    return 0

if __name__ == "__main__":
    raise SystemExit(main())
