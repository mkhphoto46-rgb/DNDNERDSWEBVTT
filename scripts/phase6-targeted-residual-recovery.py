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
OUTPUT_ROOT = PROJECT_ROOT / "_phase6_targeted_residual_recovery"

ITEM_DESCRIPTOR_RE = re.compile(
    r"(?i)\b("
    r"wondrous\s+item|weapon(?:\s*\([^)]+\))?|armor(?:\s*\([^)]+\))?|"
    r"potion|ring|rod|staff|wand|scroll|ammunition|shield"
    r")\s*,?\s*"
    r"(common|uncommon|rare|very\s+rare|legendary|artifact|rarity\s+varies|varies)"
)

GENERIC_DESCRIPTOR_RE = re.compile(
    r"(?i)^(?:"
    r"wondrous\s+item|weapon(?:\s*\([^)]+\))?|armor(?:\s*\([^)]+\))?|"
    r"potion|ring|rod|staff|wand|scroll|ammunition|shield|"
    r"common|uncommon|rare|very\s+rare|legendary|artifact"
    r")(?:\b|,)"
)

NOISE_RE = re.compile(
    r"(?i)\b("
    r"chapter|actions|legendary actions|mythic actions|reactions|"
    r"challenge|proficiency bonus|languages?|habitat|treasure:|skills?|"
    r"starting equipment|crafting|prices?|rarity|effect\b|d100|d20|"
    r"npc stat blocks?|purchasing poison|going mad|recuperating|"
    r"adventures|supplies|weapons?$|armor$|funds|deities|"
    r"medium humanoid|small humanoid|large humanoid|celestial"
    r")\b"
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

def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()

def clean(v: Any) -> str:
    return re.sub(r"\s+", " ", str(v or "")).strip()

def norm(v: str) -> str:
    return re.sub(r"[^a-z0-9]+", "", (v or "").casefold())

def ocr_norm(v: str) -> str:
    s = norm(v)
    return s.translate(str.maketrans({"0":"o","1":"i","5":"s","8":"b"}))

def slug(v: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", (v or "").casefold()).strip("-")

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

def parse_json(v: str | None) -> dict[str, Any]:
    try:
        obj = json.loads(v or "{}")
        return obj if isinstance(obj, dict) else {}
    except Exception:
        return {}

def title_quality(name: str) -> tuple[bool, str]:
    n = clean(name).strip("•*-–—|")
    if not 3 <= len(n) <= 82:
        return False, "length"
    if GENERIC_DESCRIPTOR_RE.match(n):
        return False, "descriptor-not-title"
    if NOISE_RE.search(n):
        return False, "noise-heading"
    if re.search(r"\d{2,}", n):
        return False, "numeric-fragment"
    letters = sum(ch.isalpha() for ch in n)
    if letters / max(1, len(n)) < 0.72:
        return False, "low-letter-ratio"
    if len(n.split()) > 10:
        return False, "too-many-words"
    return True, "ok"

def descriptor_from_line(line: str) -> tuple[str | None, str | None, bool]:
    m = ITEM_DESCRIPTOR_RE.search(clean(line))
    if not m:
        return None, None, False
    item_type = clean(m.group(1)).title()
    rarity = clean(m.group(2)).title()
    attune = "requires attunement" in line.casefold()
    return item_type, rarity, attune

def raw_page(db: sqlite3.Connection, revision_id: str, page: int) -> str:
    row = db.execute(
        "SELECT text FROM raw_pages WHERE revision_id=? AND page_number=?",
        (revision_id, page),
    ).fetchone()
    return row["text"] if row and row["text"] else ""

def page_context(db: sqlite3.Connection, revision_id: str, page: int) -> list[tuple[int,str]]:
    result = []
    for p in range(max(1, page - 1), page + 2):
        txt = raw_page(db, revision_id, p)
        for line in txt.splitlines():
            c = clean(line)
            if c:
                result.append((p, c))
    return result

def find_best_known_match(name: str, known_names: list[tuple[str,str]]) -> tuple[float,str,str] | None:
    best = None
    for known_id, known_name in known_names:
        score = similarity(name, known_name)
        if best is None or score > best[0]:
            best = (score, known_id, known_name)
    return best

def recover_title_and_descriptor(
    lines: list[tuple[int,str]],
    candidate_name: str,
) -> tuple[str,str,str,bool,int,str] | None:
    # Strategy 1: candidate title itself appears, followed by descriptor.
    best_idx = None
    best_score = 0.0
    for i, (_, line) in enumerate(lines):
        score = similarity(candidate_name, line)
        if score > best_score:
            best_score = score
            best_idx = i

    if best_idx is not None and best_score >= 0.70:
        for j in range(best_idx + 1, min(len(lines), best_idx + 8)):
            item_type, rarity, attune = descriptor_from_line(lines[j][1])
            if item_type and rarity:
                title = lines[best_idx][1]
                ok, _ = title_quality(title)
                if ok:
                    block = " ".join(x[1] for x in lines[best_idx:min(len(lines), best_idx+35)])
                    return title,item_type,rarity,attune,lines[best_idx][0],block

    # Strategy 2: descriptor row was mistakenly used as the title. Recover
    # nearest valid heading immediately before descriptor.
    for i, (page, line) in enumerate(lines):
        item_type, rarity, attune = descriptor_from_line(line)
        if not item_type:
            continue
        for back in range(1, 6):
            k = i - back
            if k < 0:
                break
            title = lines[k][1]
            ok, _ = title_quality(title)
            if not ok:
                continue
            # Avoid prose sentences as item titles.
            if title.endswith((".",":",";")) or len(title.split()) > 8:
                continue
            block = " ".join(x[1] for x in lines[k:min(len(lines), i+30)])
            return title,item_type,rarity,attune,lines[k][0],block

    return None

def recover_poison(lines: list[tuple[int,str]], candidate_name: str) -> tuple[str,dict[str,Any],int,str] | None:
    # Find candidate heading and a nearby poison-mechanics paragraph.
    best_idx = None
    best_score = 0.0
    for i, (_, line) in enumerate(lines):
        score = similarity(candidate_name, line)
        if score > best_score:
            best_score = score
            best_idx = i

    if best_idx is None or best_score < 0.70:
        return None

    title = lines[best_idx][1]
    ok, _ = title_quality(title)
    if not ok:
        return None

    block = " ".join(x[1] for x in lines[best_idx:min(len(lines), best_idx+45)])
    low = block.casefold()
    poison_type = next((p for p in POISON_TYPES if p in low), None)
    m_save = re.search(
        r"(?i)\b(strength|dexterity|constitution|intelligence|wisdom|charisma)\s+saving throw\b",
        block,
    )
    m_dc = re.search(r"(?i)\bdc\s+(\d{1,2})\b", block)
    m_dice = re.search(r"(?i)\b(\d+d(?:4|6|8|10|12|20|100))\b", block)
    conditions = [
        c for c in CONDITIONS
        if re.search(rf"(?i)\b{re.escape(c)}(?: condition)?\b", block)
    ]
    damage_types = [
        d for d in DAMAGE_TYPES
        if re.search(rf"(?i)\b{re.escape(d)} damage\b", block)
    ]
    if not poison_type or not m_save or not m_dc or (not m_dice and not conditions):
        return None

    profile = {
        "poison_type":poison_type,
        "application_method":poison_type,
        "save_ability":m_save.group(1).title(),
        "save_dc":int(m_dc.group(1)),
        "damage_dice":m_dice.group(1) if m_dice else "",
        "damage_types":damage_types,
        "conditions":conditions,
    }
    return title,profile,lines[best_idx][0],block

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
        formula = m.group(1).replace(" ","")
    else:
        m = re.search(r"(?i)\bregains?\s+(\d+)\s+expended charges?\b", text)
        if m:
            formula = m.group(1)
    return kind, formula

def magic_profile(block: str, item_type: str, rarity: str, attune: bool) -> dict[str,Any]:
    charges = None
    m = re.search(r"(?i)\bhas\s+(\d+)\s+charges?\b", block)
    if m:
        charges = int(m.group(1))
    recharge_kind,recharge_formula = detect_recharge(block)
    save_dc = None
    m = re.search(r"(?i)\b(?:save\s+)?dc\s+(\d{1,2})\b", block)
    if m:
        save_dc = int(m.group(1))
    activation = []
    low = block.casefold()
    if "bonus action" in low: activation.append("Bonus Action")
    if "reaction" in low: activation.append("Reaction")
    if "magic action" in low: activation.append("Magic Action")
    elif re.search(r"(?i)\bas an action\b|\buse an action\b", block):
        activation.append("Action")
    conditions = [
        c for c in CONDITIONS
        if re.search(rf"(?i)\b{re.escape(c)}(?: condition)?\b", block)
    ]
    damage_types = [
        d for d in DAMAGE_TYPES
        if re.search(rf"(?i)\b{re.escape(d)} damage\b", block)
    ]
    return {
        "item_type":item_type,
        "rarity":rarity,
        "requires_attunement":attune,
        "max_charges":charges,
        "recharge_kind":recharge_kind,
        "recharge_formula":recharge_formula,
        "save_dc":save_dc,
        "activation_types":sorted(set(activation)),
        "condition_tags":conditions,
        "damage_types":damage_types,
    }

def ensure_schema(db: sqlite3.Connection) -> None:
    db.executescript("""
    CREATE TABLE IF NOT EXISTS phase6_targeted_batches(
      id TEXT PRIMARY KEY,
      created_at TEXT NOT NULL,
      source_db_sha256 TEXT NOT NULL,
      residual_before INTEGER NOT NULL,
      duplicate_repaired INTEGER NOT NULL,
      magic_items_recovered INTEGER NOT NULL,
      poisons_recovered INTEGER NOT NULL,
      noise_resolved INTEGER NOT NULL,
      residual_after INTEGER NOT NULL
    ) STRICT;

    CREATE TABLE IF NOT EXISTS phase6_targeted_resolution(
      entity_version_id TEXT PRIMARY KEY REFERENCES entity_versions(id),
      original_name TEXT NOT NULL,
      resolution_class TEXT NOT NULL,
      recovered_name TEXT,
      destination TEXT NOT NULL,
      matched_runtime_id TEXT,
      notes TEXT NOT NULL,
      batch_id TEXT NOT NULL REFERENCES phase6_targeted_batches(id)
    ) STRICT;
    """)
    db.commit()

def main() -> int:
    parser=argparse.ArgumentParser()
    parser.add_argument("--apply",action="store_true")
    parser.add_argument("--output",default=str(OUTPUT_ROOT))
    args=parser.parse_args()
    output=Path(args.output)
    output.mkdir(parents=True,exist_ok=True)

    db_hash=sha256_file(DB_PATH)
    db=sqlite3.connect(DB_PATH)
    db.row_factory=sqlite3.Row
    db.execute("PRAGMA foreign_keys=ON")
    if db.execute("PRAGMA integrity_check").fetchone()[0]!="ok":
        raise RuntimeError("SQLite integrity check failed.")

    residual=db.execute("""
        SELECT q.*,ev.source_id,s.current_revision_id,s.filename
        FROM phase6_residual_review_queue q
        JOIN entity_versions ev ON ev.id=q.entity_version_id
        JOIN sources s ON s.id=ev.source_id
        ORDER BY q.source_title,q.source_page,q.name
    """).fetchall()

    if len(residual)!=235:
        raise RuntimeError(f"Expected 235 residual rows, got {len(residual)}")

    known_names=[]
    for r in db.execute("SELECT magic_item_id,item_name FROM magic_item_registry"):
        known_names.append((r["magic_item_id"],r["item_name"]))
    for r in db.execute("SELECT book_magic_item_id,item_name FROM book_magic_item_registry"):
        known_names.append((r["book_magic_item_id"],r["item_name"]))

    duplicate_repaired=[]
    recovered_magic=[]
    recovered_poison=[]
    noise=[]
    remaining=[]

    for row in residual:
        name=clean(row["name"])

        best=find_best_known_match(name,known_names)
        if best and best[0]>=0.88:
            duplicate_repaired.append({
                "row":row,"matched_id":best[1],"matched_name":best[2],"score":best[0]
            })
            continue

        if NOISE_RE.search(name) or GENERIC_DESCRIPTOR_RE.match(name):
            # Descriptor-looking records still get one context recovery attempt
            # before being classified as noise.
            lines=page_context(db,row["current_revision_id"],int(row["source_page"] or 1))
            rec=recover_title_and_descriptor(lines,name)
            if rec:
                title,item_type,rarity,attune,page,block=rec
                best2=find_best_known_match(title,known_names)
                if best2 and best2[0]>=0.90:
                    duplicate_repaired.append({
                        "row":row,"matched_id":best2[1],"matched_name":best2[2],
                        "score":best2[0],"recovered_name":title
                    })
                else:
                    recovered_magic.append({
                        "row":row,"title":title,"page":page,
                        "profile":magic_profile(block,item_type,rarity,attune)
                    })
                continue

            noise.append({
                "row":row,
                "notes":"Generic descriptor/table/statblock/rule heading with no recoverable independent item title."
            })
            continue

        lines=page_context(db,row["current_revision_id"],int(row["source_page"] or 1))

        if row["category"]=="poison":
            prec=recover_poison(lines,name)
            if prec:
                title,profile,page,block=prec
                recovered_poison.append({
                    "row":row,"title":title,"page":page,"profile":profile
                })
                continue

        rec=recover_title_and_descriptor(lines,name)
        if rec:
            title,item_type,rarity,attune,page,block=rec
            best2=find_best_known_match(title,known_names)
            if best2 and best2[0]>=0.90:
                duplicate_repaired.append({
                    "row":row,"matched_id":best2[1],"matched_name":best2[2],
                    "score":best2[0],"recovered_name":title
                })
            else:
                recovered_magic.append({
                    "row":row,"title":title,"page":page,
                    "profile":magic_profile(block,item_type,rarity,attune)
                })
            continue

        # Source-family based obvious noise.
        if row["source_title"] in {
            "Monster Manual","Mordenkainen's Tome of Foes",
            "Volo's Guide to Monsters","Player's Handbook"
        }:
            noise.append({
                "row":row,
                "notes":"Bestiary/PHB classifier candidate with no recoverable Phase 6 descriptor/mechanics."
            })
            continue

        remaining.append({
            "row":row,
            "reason":"No high-confidence duplicate or contextual title+descriptor/mechanics recovery."
        })

    batch_id=f"phase6-targeted-{datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ')}"

    if args.apply:
        ensure_schema(db)
        db.execute("BEGIN IMMEDIATE")
        try:
            db.execute("DELETE FROM phase6_targeted_resolution")
            db.execute("""
                INSERT INTO phase6_targeted_batches(
                  id,created_at,source_db_sha256,residual_before,
                  duplicate_repaired,magic_items_recovered,poisons_recovered,
                  noise_resolved,residual_after
                ) VALUES(?,?,?,?,?,?,?,?,?)
            """,(
                batch_id,now_iso(),db_hash,len(residual),len(duplicate_repaired),
                len(recovered_magic),len(recovered_poison),len(noise),len(remaining)
            ))

            for item in duplicate_repaired:
                row=item["row"]
                db.execute("""
                    INSERT INTO phase6_targeted_resolution(
                      entity_version_id,original_name,resolution_class,recovered_name,
                      destination,matched_runtime_id,notes,batch_id
                    ) VALUES(?,?,?,?,?,?,?,?)
                """,(
                    row["entity_version_id"],row["name"],"repaired-duplicate",
                    item.get("recovered_name") or item["matched_name"],
                    "existing-phase6-registry",item["matched_id"],
                    f"High-confidence OCR-normalized match {item['score']:.3f}.",batch_id
                ))

            for item in recovered_magic:
                row=item["row"]; p=item["profile"]; title=item["title"]
                item_id=(
                    f"book-magic-item.targeted.{row['rules_version']}."
                    f"{slug(row['source_title'])[:35]}.{slug(title)[:60]}."
                    f"{item['page']}"
                )
                # Reuse existing book registry schema.
                db.execute("""
                    INSERT OR REPLACE INTO book_magic_item_registry(
                      book_magic_item_id,item_name,entity_version_id,rules_version,
                      source_id,source_title,source_page,validation_scope,batch_id,validated_at
                    ) VALUES(?,?,?,?,?,?,?,?,?,?)
                """,(
                    item_id,title,row["entity_version_id"],row["rules_version"],
                    row["source_id"],row["source_title"],item["page"],
                    "targeted-page-context-recovery",
                    db.execute("SELECT batch_id FROM phase6_residual_review_queue WHERE entity_version_id=?",
                               (row["entity_version_id"],)).fetchone()[0],
                    now_iso()
                ))
                db.execute("""
                    INSERT OR REPLACE INTO book_magic_item_engine_profiles(
                      book_magic_item_id,item_type,rarity,requires_attunement,
                      max_charges,recharge_kind,recharge_formula,save_dc,
                      activation_types_json,condition_tags_json,damage_types_json
                    ) VALUES(?,?,?,?,?,?,?,?,?,?,?)
                """,(
                    item_id,p["item_type"],p["rarity"],int(p["requires_attunement"]),
                    p["max_charges"],p["recharge_kind"],p["recharge_formula"],p["save_dc"],
                    json.dumps(p["activation_types"],ensure_ascii=False),
                    json.dumps(p["condition_tags"],ensure_ascii=False),
                    json.dumps(p["damage_types"],ensure_ascii=False)
                ))
                db.execute("""
                    INSERT INTO phase6_targeted_resolution(
                      entity_version_id,original_name,resolution_class,recovered_name,
                      destination,matched_runtime_id,notes,batch_id
                    ) VALUES(?,?,?,?,?,?,?,?)
                """,(
                    row["entity_version_id"],row["name"],"targeted-magic-item-recovery",
                    title,"book_magic_item_registry",item_id,
                    "Recovered from page context with explicit descriptor and rarity.",batch_id
                ))

            for item in recovered_poison:
                row=item["row"]; p=item["profile"]; title=item["title"]
                poison_id=(
                    f"book-poison.targeted.{row['rules_version']}."
                    f"{slug(row['source_title'])[:35]}.{slug(title)[:60]}."
                    f"{item['page']}"
                )
                db.execute("""
                    INSERT OR REPLACE INTO book_poison_registry(
                      book_poison_id,poison_name,entity_version_id,rules_version,
                      source_id,source_title,source_page,validation_scope,batch_id,validated_at
                    ) VALUES(?,?,?,?,?,?,?,?,?,?)
                """,(
                    poison_id,title,row["entity_version_id"],row["rules_version"],
                    row["source_id"],row["source_title"],item["page"],
                    "targeted-page-context-recovery",
                    db.execute("SELECT batch_id FROM phase6_residual_review_queue WHERE entity_version_id=?",
                               (row["entity_version_id"],)).fetchone()[0],
                    now_iso()
                ))
                db.execute("""
                    INSERT OR REPLACE INTO book_poison_engine_profiles(
                      book_poison_id,poison_type,application_method,save_ability,
                      save_dc,damage_dice,damage_types_json,conditions_json,
                      duration_text,onset_text
                    ) VALUES(?,?,?,?,?,?,?,?,?,?)
                """,(
                    poison_id,p["poison_type"],p["application_method"],p["save_ability"],
                    p["save_dc"],p["damage_dice"],
                    json.dumps(p["damage_types"],ensure_ascii=False),
                    json.dumps(p["conditions"],ensure_ascii=False),"",""
                ))
                db.execute("""
                    INSERT INTO phase6_targeted_resolution(
                      entity_version_id,original_name,resolution_class,recovered_name,
                      destination,matched_runtime_id,notes,batch_id
                    ) VALUES(?,?,?,?,?,?,?,?)
                """,(
                    row["entity_version_id"],row["name"],"targeted-poison-recovery",
                    title,"book_poison_registry",poison_id,
                    "Recovered from page context with poison type + save + damage/condition.",batch_id
                ))

            for item in noise:
                row=item["row"]
                db.execute("""
                    INSERT INTO phase6_targeted_resolution(
                      entity_version_id,original_name,resolution_class,recovered_name,
                      destination,matched_runtime_id,notes,batch_id
                    ) VALUES(?,?,?,?,?,?,?,?)
                """,(
                    row["entity_version_id"],row["name"],"confirmed-noise-reference",
                    None,"searchable-provenance-only",None,item["notes"],batch_id
                ))

            resolved_ids=[x["row"]["entity_version_id"] for x in duplicate_repaired+recovered_magic+recovered_poison+noise]
            for eid in resolved_ids:
                db.execute("DELETE FROM phase6_residual_review_queue WHERE entity_version_id=?",(eid,))
            db.commit()
        except Exception:
            db.rollback()
            raise

    residual_after=db.execute("SELECT COUNT(*) FROM phase6_residual_review_queue").fetchone()[0]
    resolution_count=db.execute("SELECT COUNT(*) FROM phase6_targeted_resolution").fetchone()[0]

    resolution_rows=[dict(r) for r in db.execute("""
        SELECT * FROM phase6_targeted_resolution
        ORDER BY resolution_class,original_name
    """)]
    remaining_rows=[dict(r) for r in db.execute("""
        SELECT * FROM phase6_residual_review_queue
        ORDER BY source_title,source_page,name
    """)]

    report={
        "batchId":batch_id,
        "applied":args.apply,
        "residualBefore":len(residual),
        "repairedDuplicates":len(duplicate_repaired),
        "targetedMagicItemsRecovered":len(recovered_magic),
        "targetedPoisonsRecovered":len(recovered_poison),
        "noiseResolved":len(noise),
        "targetedResolutionCount":resolution_count,
        "residualAfter":residual_after,
        "phaseStatus":"TARGETED_RECOVERY_COMPLETE_RESIDUAL_PENDING" if residual_after else "TARGETED_RECOVERY_COMPLETE",
    }
    (output/"phase6_targeted_recovery_report.json").write_text(
        json.dumps(report,ensure_ascii=False,indent=2)+"\n",encoding="utf-8"
    )

    def export(name:str,rows:list[dict[str,Any]])->None:
        (output/f"{name}.json").write_text(
            json.dumps(rows,ensure_ascii=False,indent=2)+"\n",encoding="utf-8"
        )
        fields=list(rows[0].keys()) if rows else ["empty"]
        with (output/f"{name}.csv").open("w",encoding="utf-8-sig",newline="") as f:
            w=csv.DictWriter(f,fieldnames=fields)
            w.writeheader()
            if rows:w.writerows(rows)

    export("targeted_resolution",resolution_rows)
    export("remaining_residual_review",remaining_rows)

    summary=[
        "# Phase 6 — Targeted Residual Recovery","",
        f"- Residual before: **{len(residual)}**",
        f"- OCR duplicates repaired: **{len(duplicate_repaired)}**",
        f"- Magic items recovered from page context: **{len(recovered_magic)}**",
        f"- Poisons recovered from page context: **{len(recovered_poison)}**",
        f"- Confirmed noise/reference rows: **{len(noise)}**",
        f"- Residual after: **{residual_after}**","",
        f"Status: **{report['phaseStatus']}**",
    ]
    (output/"PHASE6_TARGETED_RECOVERY_SUMMARY.md").write_text(
        "\n".join(summary)+"\n",encoding="utf-8",newline="\n"
    )

    db.close()

    print("PHASE 6 TARGETED RESIDUAL RECOVERY COMPLETE")
    print(f"APPLIED={args.apply}")
    print(f"RESIDUAL_BEFORE={len(residual)}")
    print(f"REPAIRED_DUPLICATES={len(duplicate_repaired)}")
    print(f"MAGIC_ITEMS_RECOVERED={len(recovered_magic)}")
    print(f"POISONS_RECOVERED={len(recovered_poison)}")
    print(f"NOISE_RESOLVED={len(noise)}")
    print(f"RESIDUAL_AFTER={residual_after}")
    print(f"PHASE_STATUS={report['phaseStatus']}")
    print(f"OUTPUT={output}")
    return 0

if __name__=="__main__":
    raise SystemExit(main())
