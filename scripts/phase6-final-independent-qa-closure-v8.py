from __future__ import annotations
import argparse, csv, hashlib, json, re, sqlite3
from datetime import datetime, timezone
from pathlib import Path

PROJECT_ROOT = Path(r"F:\DND WEB VTT")
DEFAULT_DB = PROJECT_ROOT / "data" / "compendium" / "rules_knowledge.sqlite"
DEFAULT_OUTPUT = PROJECT_ROOT / "_phase6_final_independent_qa_closure_v8"
TARGET_ID = "book-magic-item.2024.dungeon-master-s-guide.potion-of-fire-breath.291"

EXPECTED_PRE = {
    "runtime_magic": 262,
    "runtime_poison": 14,
    "book_magic": 333,
    "book_magic_profiles": 333,
    "book_poison": 1,
    "book_poison_profiles": 1,
    "residual": 0,
    "old_queue": 0,
    "automation_backlog": 871,
    "effective_extracted": 0,
}

def now_iso():
    return datetime.now(timezone.utc).isoformat()

def sha256(path: Path):
    h=hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda:f.read(1024*1024),b""):
            h.update(chunk)
    return h.hexdigest()

def scalar(db, sql, args=()):
    return db.execute(sql,args).fetchone()[0]

def state(db):
    return {
        "runtime_magic": scalar(db,"select count(*) from magic_item_registry"),
        "runtime_poison": scalar(db,"select count(*) from poison_registry"),
        "book_magic": scalar(db,"select count(*) from book_magic_item_registry"),
        "book_magic_profiles": scalar(db,"select count(*) from book_magic_item_engine_profiles"),
        "book_poison": scalar(db,"select count(*) from book_poison_registry"),
        "book_poison_profiles": scalar(db,"select count(*) from book_poison_engine_profiles"),
        "residual": scalar(db,"select count(*) from phase6_residual_review_queue"),
        "old_queue": scalar(db,"select count(*) from phase6_content_review_queue"),
        "automation_backlog": scalar(db,"select count(*) from phase6_automation_backlog"),
        "effective_extracted": scalar(db,"select count(*) from effective_validated_entities where status='extracted'"),
    }

def norm_title(s):
    s=(s or "").lower().replace("’","'").replace("‘","'")
    return re.sub(r"[^a-z0-9]+","",s)

def ensure_schema(db):
    db.executescript("""
    CREATE TABLE IF NOT EXISTS phase6_final_qa_repairs(
      content_id TEXT PRIMARY KEY,
      repair_kind TEXT NOT NULL,
      before_json TEXT NOT NULL,
      after_json TEXT NOT NULL,
      evidence_note TEXT NOT NULL,
      batch_id TEXT NOT NULL,
      repaired_at TEXT NOT NULL
    ) STRICT;

    CREATE TABLE IF NOT EXISTS phase6_closure_batches(
      id TEXT PRIMARY KEY,
      created_at TEXT NOT NULL,
      source_db_sha256 TEXT NOT NULL,
      runtime_magic INTEGER NOT NULL,
      runtime_poison INTEGER NOT NULL,
      book_magic INTEGER NOT NULL,
      book_poison INTEGER NOT NULL,
      automation_backlog INTEGER NOT NULL,
      independent_qa_errors INTEGER NOT NULL,
      foundation_required INTEGER NOT NULL,
      closure_status TEXT NOT NULL,
      notes TEXT NOT NULL
    ) STRICT;
    """)

def verify_preconditions(db):
    st=state(db)
    if st != EXPECTED_PRE:
        raise RuntimeError(f"V8 precondition state mismatch. expected={EXPECTED_PRE} actual={st}")

    v7=db.execute("""select phase_status,remaining_magic_quarantine,post_book_magic,post_automation_backlog
                     from phase6_remaining_quarantine_batches order by created_at desc limit 1""").fetchone()
    expected_v7=("REMAINING_QUARANTINE_RESOLVED_PHASE6_FINAL_QA_REQUIRED",0,333,871)
    if not v7 or tuple(v7)!=expected_v7:
        raise RuntimeError(f"V8 requires exact successful V7 state. expected={expected_v7} got={tuple(v7) if v7 else None}")

    # Exact target before-state
    row=db.execute("""select save_dc,activation_types_json,damage_types_json
                      from book_magic_item_engine_profiles where book_magic_item_id=?""",(TARGET_ID,)).fetchone()
    if not row:
        raise RuntimeError("2024 Potion of Fire Breath profile missing.")
    if row[0] != 1 or row[1] != "[]" or row[2] != '["Fire"]':
        raise RuntimeError(f"Potion of Fire Breath precondition changed unexpectedly: {tuple(row)}")

    # Local evidence only: 2014 source corroborates DC 13; 2024 source explicitly says Bonus Action.
    r2014=db.execute("""select r.book_magic_item_id,p.save_dc,ev.raw_text
                        from book_magic_item_registry r
                        join book_magic_item_engine_profiles p using(book_magic_item_id)
                        join entity_versions ev on ev.id=r.entity_version_id
                        where r.rules_version='2014' and lower(r.item_name)=lower('POTION OF FIRE BREATH')
                        limit 1""").fetchone()
    if not r2014 or r2014[1] != 13 or not re.search(r"\bDC\s*13\b",r2014[2],re.I):
        raise RuntimeError("Local 2014 Potion of Fire Breath DC 13 corroboration is missing.")
    r2024=db.execute("""select ev.raw_text
                        from book_magic_item_registry r
                        join entity_versions ev on ev.id=r.entity_version_id
                        where r.book_magic_item_id=?""",(TARGET_ID,)).fetchone()
    if not r2024 or not re.search(r"\bBonus\s+Action\b",r2024[0],re.I):
        raise RuntimeError("Local 2024 Potion of Fire Breath Bonus Action evidence is missing.")
    if not re.search(r"\bDC\s*1\b",r2024[0],re.I):
        raise RuntimeError("Expected local 2024 OCR artifact 'DC 1' is no longer present; safety stop.")

def full_qa(db):
    errors=[]
    metrics={}
    integ=db.execute("pragma integrity_check").fetchone()[0]
    fk=db.execute("pragma foreign_key_check").fetchall()
    metrics["integrity"]=integ
    metrics["foreign_key_errors"]=len(fk)
    if integ!="ok": errors.append("SQLite integrity_check failed.")
    if fk: errors.append(f"foreign_key_check returned {len(fk)} rows.")

    st=state(db)
    metrics["state"]=st
    if st != EXPECTED_PRE:
        errors.append(f"Final state mismatch: {st}")

    # 1:1 registry/profile
    mm=scalar(db,"""select count(*) from book_magic_item_registry r
                    left join book_magic_item_engine_profiles p using(book_magic_item_id)
                    where p.book_magic_item_id is null""")
    mo=scalar(db,"""select count(*) from book_magic_item_engine_profiles p
                    left join book_magic_item_registry r using(book_magic_item_id)
                    where r.book_magic_item_id is null""")
    pm=scalar(db,"""select count(*) from book_poison_registry r
                    left join book_poison_engine_profiles p using(book_poison_id)
                    where p.book_poison_id is null""")
    po=scalar(db,"""select count(*) from book_poison_engine_profiles p
                    left join book_poison_registry r using(book_poison_id)
                    where r.book_poison_id is null""")
    metrics.update({"magic_missing_profiles":mm,"magic_orphan_profiles":mo,
                    "poison_missing_profiles":pm,"poison_orphan_profiles":po})
    if any((mm,mo,pm,po)): errors.append("Registry/profile 1:1 integrity failed.")

    # Backlog must point to active content only.
    active=set(x[0] for x in db.execute("select magic_item_id from magic_item_registry"))
    active.update(x[0] for x in db.execute("select book_magic_item_id from book_magic_item_registry"))
    active.update(x[0] for x in db.execute("select poison_id from poison_registry"))
    active.update(x[0] for x in db.execute("select book_poison_id from book_poison_registry"))
    orphan_backlog=[x[0] for x in db.execute("select distinct content_id from phase6_automation_backlog") if x[0] not in active]
    metrics["orphan_backlog"]=len(orphan_backlog)
    if orphan_backlog: errors.append(f"Automation backlog has {len(orphan_backlog)} orphan content IDs.")

    # Normalized duplicates and 2024 runtime overlap.
    groups={}
    for r in db.execute("select book_magic_item_id,item_name,rules_version from book_magic_item_registry"):
        k=(r[2],norm_title(r[1]))
        groups.setdefault(k,[]).append((r[0],r[1]))
    dup=[v for v in groups.values() if len(v)>1]
    metrics["book_normalized_duplicate_groups"]=len(dup)
    if dup: errors.append(f"Book registry has {len(dup)} normalized duplicate groups.")

    rt2024={norm_title(x[0]) for x in db.execute("select item_name from magic_item_registry where rules_version='2024'")}
    overlap=[x[0] for x in db.execute("select item_name from book_magic_item_registry where rules_version='2024'")
             if norm_title(x[0]) in rt2024]
    metrics["remaining_2024_runtime_overlap"]=len(overlap)
    if overlap: errors.append(f"Book registry still overlaps authoritative 2024 runtime registry: {len(overlap)} rows.")

    # Profile syntax / numeric safety.
    profile_errors=[]
    for r in db.execute("select * from book_magic_item_engine_profiles"):
        x=dict(r)
        for f in ("activation_types_json","condition_tags_json","damage_types_json"):
            try:
                v=json.loads(x[f])
                if not isinstance(v,list):
                    profile_errors.append((x["book_magic_item_id"],f,"not-array"))
            except Exception:
                profile_errors.append((x["book_magic_item_id"],f,"bad-json"))
        if x["requires_attunement"] not in (0,1):
            profile_errors.append((x["book_magic_item_id"],"requires_attunement",x["requires_attunement"]))
        if x["max_charges"] is not None and not (1 <= x["max_charges"] <= 100):
            profile_errors.append((x["book_magic_item_id"],"max_charges",x["max_charges"]))
        if x["save_dc"] is not None and not (5 <= x["save_dc"] <= 30):
            profile_errors.append((x["book_magic_item_id"],"save_dc",x["save_dc"]))
    metrics["magic_profile_errors"]=len(profile_errors)
    if profile_errors: errors.append(f"Magic item profile validation failed: {profile_errors[:10]}")

    poison_profile_errors=[]
    for r in db.execute("select * from book_poison_engine_profiles"):
        x=dict(r)
        if not (5 <= x["save_dc"] <= 30):
            poison_profile_errors.append((x["book_poison_id"],"save_dc",x["save_dc"]))
        for f in ("damage_types_json","conditions_json"):
            try:
                v=json.loads(x[f])
                if not isinstance(v,list):
                    poison_profile_errors.append((x["book_poison_id"],f,"not-array"))
            except Exception:
                poison_profile_errors.append((x["book_poison_id"],f,"bad-json"))
    metrics["poison_profile_errors"]=len(poison_profile_errors)
    if poison_profile_errors: errors.append(f"Poison profile validation failed: {poison_profile_errors[:10]}")

    # Source / entity / page evidence.
    rev_by={x["source_id"]:x["id"] for x in db.execute("select * from source_revisions")}
    source_errors=[]
    title_evidence_errors=[]
    rows=db.execute("""select r.*,ev.name ev_name,ev.source_id ev_source,ev.rules_version ev_rules,
                       ev.source_page_start ev_start,ev.source_page_end ev_end
                       from book_magic_item_registry r join entity_versions ev on ev.id=r.entity_version_id""").fetchall()
    for x in rows:
        if x["source_id"] != x["ev_source"] or x["rules_version"] != x["ev_rules"]:
            source_errors.append((x["book_magic_item_id"],"source/rules mismatch"))
        if x["source_page"] is not None and x["ev_start"] is not None:
            end=x["ev_end"] if x["ev_end"] is not None else x["ev_start"]
            if not (x["ev_start"] <= x["source_page"] <= end):
                source_errors.append((x["book_magic_item_id"],"page mismatch"))
        rev=rev_by.get(x["source_id"])
        pr=db.execute("select text from raw_pages where revision_id=? and page_number=?",(rev,x["source_page"])).fetchone() if rev else None
        if not pr:
            title_evidence_errors.append((x["book_magic_item_id"],"missing source page"))
        else:
            page_norm=norm_title(pr[0])
            current=norm_title(x["item_name"])
            original=norm_title(x["ev_name"])
            if not ((current and current in page_norm) or (original and len(original)>=5 and original in page_norm)):
                title_evidence_errors.append((x["book_magic_item_id"],"title not evidenced on source page"))
    metrics["source_link_errors"]=len(source_errors)
    metrics["title_evidence_errors"]=len(title_evidence_errors)
    if source_errors: errors.append(f"Source/entity consistency failed: {source_errors[:10]}")
    if title_evidence_errors: errors.append(f"Source-page title evidence failed: {title_evidence_errors[:10]}")

    # Poison source evidence.
    poison_evidence_errors=[]
    for x in db.execute("""select r.*,ev.name ev_name,ev.source_id ev_source,ev.rules_version ev_rules
                           from book_poison_registry r join entity_versions ev on ev.id=r.entity_version_id"""):
        rev=rev_by.get(x["source_id"])
        pr=db.execute("select text from raw_pages where revision_id=? and page_number=?",(rev,x["source_page"])).fetchone() if rev else None
        if not pr:
            poison_evidence_errors.append((x["book_poison_id"],"missing source page"))
        else:
            p=norm_title(pr[0])
            if not (norm_title(x["poison_name"]) in p or norm_title(x["ev_name"]) in p):
                poison_evidence_errors.append((x["book_poison_id"],"name not evidenced"))
    metrics["poison_evidence_errors"]=len(poison_evidence_errors)
    if poison_evidence_errors: errors.append(f"Poison source evidence failed: {poison_evidence_errors}")

    # Explicit title-quality rejection independent from historical validators.
    title_errors=[]
    for x in db.execute("select book_magic_item_id,item_name from book_magic_item_registry"):
        item_id,name=x[0],x[1].strip()
        up=name.upper()
        reasons=[]
        if len(name)<2 or len(name)>90: reasons.append("length")
        if "\n" in name or "|" in name or "\t" in name: reasons.append("format")
        if re.search(r"\bCH\s*AP\s*TER\b|\bCHAPTER\b",up): reasons.append("chapter-heading")
        if up in {"ACTIONS","ACTION","TREASURE","MAGIC ITEMS","MAGIC ITEM","POISONS","ELEMENTALS","SAMPLE POISONS"}:
            reasons.append("heading")
        if re.search(r"\b(?:LEVER|TABLE|STATBLOCK)\b",up) and len(name.split())<=5:
            reasons.append("table/statblock-heading")
        # descriptor-only pattern: item category + rarity but no distinctive title
        if re.match(r"^(WONDROUS ITEM|WEAPON\s*\(|ARMOR\s*\(|WAND,|ROD,|RING,|POTION,|SCROLL,|STAFF,)",up):
            if re.search(r"\b(COMMON|UNCOMMON|RARE|VERY RARE|LEGENDARY|ARTIFACT)\b",up) and not re.search(r"\+\d",name):
                reasons.append("descriptor-as-title")
        if reasons: title_errors.append((item_id,name,reasons))
    metrics["title_quality_errors"]=len(title_errors)
    if title_errors: errors.append(f"Title-quality validation failed: {title_errors[:10]}")

    # Historical provenance and quarantine lifecycle.
    badprov=scalar(db,"""select count(*) from phase6_title_normalization_resolution
                         where evidence_note like '%{sp}%' or evidence_note like '%{new}%'""")
    metrics["v5_bad_provenance"]=badprov
    if badprov: errors.append(f"V5 provenance placeholders remain: {badprov}")

    v6=db.execute("""select phase_status,remaining_magic_quarantine from phase6_bounded_recovery_batches
                     order by created_at desc limit 1""").fetchone()
    v7=db.execute("""select phase_status,remaining_magic_quarantine,post_book_magic,post_automation_backlog
                     from phase6_remaining_quarantine_batches order by created_at desc limit 1""").fetchone()
    expected_v6=("BOUNDED_QUARANTINE_RECOVERY_APPLIED_PHASE6_OPEN",36)
    expected_v7=("REMAINING_QUARANTINE_RESOLVED_PHASE6_FINAL_QA_REQUIRED",0,333,871)
    if not v6 or tuple(v6)!=expected_v6: errors.append(f"V6 lifecycle state mismatch: {tuple(v6) if v6 else None}")
    if not v7 or tuple(v7)!=expected_v7: errors.append(f"V7 lifecycle state mismatch: {tuple(v7) if v7 else None}")

    # Final targeted repair must be present.
    fire=db.execute("""select save_dc,activation_types_json,damage_types_json
                       from book_magic_item_engine_profiles where book_magic_item_id=?""",(TARGET_ID,)).fetchone()
    expected_fire=(13,'["Bonus Action"]','["Fire"]')
    metrics["potion_fire_breath_profile"]=tuple(fire) if fire else None
    if not fire or tuple(fire)!=expected_fire:
        errors.append(f"Potion of Fire Breath final repair missing: {tuple(fire) if fire else None}")

    return errors,metrics

def export_table_json_csv(db, sql, fields, json_path, csv_path):
    rows=[dict(x) for x in db.execute(sql)]
    json_path.write_text(json.dumps(rows,ensure_ascii=False,indent=2),encoding="utf-8")
    with csv_path.open("w",encoding="utf-8-sig",newline="") as f:
        w=csv.DictWriter(f,fieldnames=fields)
        w.writeheader()
        for row in rows: w.writerow({k:row.get(k) for k in fields})
    return len(rows)

def main():
    ap=argparse.ArgumentParser()
    ap.add_argument("--db",default=str(DEFAULT_DB))
    ap.add_argument("--output",default=str(DEFAULT_OUTPUT))
    ap.add_argument("--apply",action="store_true")
    args=ap.parse_args()
    db_path=Path(args.db); out=Path(args.output)
    if not db_path.exists(): raise RuntimeError(f"DB not found: {db_path}")
    out.mkdir(parents=True,exist_ok=True)
    source_hash=sha256(db_path)
    db=sqlite3.connect(db_path)
    db.row_factory=sqlite3.Row
    try:
        verify_preconditions(db)
        if not args.apply:
            print("V8 preconditions PASS (read-only).")
            return 0

        batch_id="phase6-closure-v8-"+datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
        before=dict(db.execute("select * from book_magic_item_engine_profiles where book_magic_item_id=?",(TARGET_ID,)).fetchone())
        db.execute("BEGIN IMMEDIATE")
        try:
            ensure_schema(db)
            db.execute("""update book_magic_item_engine_profiles
                          set save_dc=13,activation_types_json='["Bonus Action"]'
                          where book_magic_item_id=?""",(TARGET_ID,))
            after=dict(db.execute("select * from book_magic_item_engine_profiles where book_magic_item_id=?",(TARGET_ID,)).fetchone())
            evidence=("Local-only evidence repair: the 2024 indexed item text explicitly uses a Bonus Action but OCR renders "
                      "the save as 'DC 1'. The indexed 2014 version of the same item explicitly records DC 13 and its "
                      "engine profile is DC 13. Restore the dropped OCR digit to DC 13; no outside source used.")
            db.execute("""insert or replace into phase6_final_qa_repairs
                          (content_id,repair_kind,before_json,after_json,evidence_note,batch_id,repaired_at)
                          values(?,?,?,?,?,?,?)""",
                       (TARGET_ID,"evidence-backed-ocr-profile-repair",
                        json.dumps(before,ensure_ascii=False,sort_keys=True),
                        json.dumps(after,ensure_ascii=False,sort_keys=True),
                        evidence,batch_id,now_iso()))

            errors,metrics=full_qa(db)
            if errors:
                raise RuntimeError("Independent Phase 6 final QA failed:\n- "+"\n- ".join(errors))

            db.execute("""insert into phase6_closure_batches
                          (id,created_at,source_db_sha256,runtime_magic,runtime_poison,book_magic,book_poison,
                           automation_backlog,independent_qa_errors,foundation_required,closure_status,notes)
                          values(?,?,?,?,?,?,?,?,?,?,?,?)""",
                       (batch_id,now_iso(),source_hash,
                        metrics["state"]["runtime_magic"],metrics["state"]["runtime_poison"],
                        metrics["state"]["book_magic"],metrics["state"]["book_poison"],
                        metrics["state"]["automation_backlog"],0,1,"CLOSED_GREEN_PENDING_EXTERNAL_FOUNDATION_VERIFY",
                        "Structured Phase 6 QA passed inside DB transaction. Closure becomes FINAL_CLOSED_GREEN only after wrapper runs npm.cmd run verify:foundation and independent verifier."))
            db.commit()
        except Exception:
            db.rollback()
            raise

        errors,metrics=full_qa(db)
        if errors:
            raise RuntimeError("Post-commit independent QA failed:\n- "+"\n- ".join(errors))

        report={
            "applied":True,
            "batchId":batch_id,
            "sourceDbSha256":source_hash,
            "targetedRepairs":1,
            "repairTarget":TARGET_ID,
            "independentQaErrors":0,
            "metrics":metrics,
            "closureStatus":"CLOSED_GREEN_PENDING_EXTERNAL_FOUNDATION_VERIFY",
            "automationBacklogExplicit":metrics["state"]["automation_backlog"],
            "next":"RUN_EXTERNAL_FOUNDATION_VERIFY_THEN_FINALIZE_CLOSURE"
        }
        (out/"phase6_final_qa_v8_report.json").write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding="utf-8")

        # Exports for human inspection / handoff.
        magic_fields=["book_magic_item_id","item_name","entity_version_id","rules_version","source_id","source_title","source_page","validation_scope","batch_id","validated_at"]
        profile_fields=["book_magic_item_id","item_type","rarity","requires_attunement","max_charges","recharge_kind","recharge_formula","save_dc","activation_types_json","condition_tags_json","damage_types_json"]
        poison_fields=["book_poison_id","poison_name","entity_version_id","rules_version","source_id","source_title","source_page","validation_scope","batch_id","validated_at"]
        poison_profile_fields=["book_poison_id","poison_type","application_method","save_ability","save_dc","damage_dice","damage_types_json","conditions_json","duration_text","onset_text"]
        export_table_json_csv(db,"select * from book_magic_item_registry order by rules_version,source_title,source_page,item_name",magic_fields,out/"final_book_magic_items.json",out/"final_book_magic_items.csv")
        export_table_json_csv(db,"select * from book_magic_item_engine_profiles order by book_magic_item_id",profile_fields,out/"final_book_magic_item_profiles.json",out/"final_book_magic_item_profiles.csv")
        export_table_json_csv(db,"select * from book_poison_registry order by rules_version,source_title,source_page,poison_name",poison_fields,out/"final_book_poisons.json",out/"final_book_poisons.csv")
        export_table_json_csv(db,"select * from book_poison_engine_profiles order by book_poison_id",poison_profile_fields,out/"final_book_poison_profiles.json",out/"final_book_poison_profiles.csv")

        backlog_fields=["content_id","content_kind","capability_or_gap","status","notes","batch_id"]
        export_table_json_csv(db,"select * from phase6_automation_backlog order by content_kind,content_id,capability_or_gap",backlog_fields,out/"final_automation_backlog.json",out/"final_automation_backlog.csv")

        repair=[dict(x) for x in db.execute("select * from phase6_final_qa_repairs where batch_id=?",(batch_id,))]
        (out/"final_qa_repairs.json").write_text(json.dumps(repair,ensure_ascii=False,indent=2),encoding="utf-8")

        summary=f"""# Phase 6 Final Independent QA / Closure V8

- SQLite integrity: {metrics['integrity']}
- Foreign-key errors: {metrics['foreign_key_errors']}
- Runtime Magic Items: {metrics['state']['runtime_magic']}
- Runtime Poisons: {metrics['state']['runtime_poison']}
- Book Magic Items: {metrics['state']['book_magic']}
- Book Magic Profiles: {metrics['state']['book_magic_profiles']}
- Book Poisons: {metrics['state']['book_poison']}
- Book Poison Profiles: {metrics['state']['book_poison_profiles']}
- Residual Queue: {metrics['state']['residual']}
- Old Review Queue: {metrics['state']['old_queue']}
- Automation Backlog: {metrics['state']['automation_backlog']} (explicitly tracked; allowed)
- Effective Extracted Leakage: {metrics['state']['effective_extracted']}
- Missing/Orphan Book Profiles: {metrics['magic_missing_profiles'] + metrics['magic_orphan_profiles']}
- Orphan Automation Backlog IDs: {metrics['orphan_backlog']}
- Normalized Book Duplicate Groups: {metrics['book_normalized_duplicate_groups']}
- Remaining 2024 Runtime Overlap: {metrics['remaining_2024_runtime_overlap']}
- Magic Profile Errors: {metrics['magic_profile_errors']}
- Poison Profile Errors: {metrics['poison_profile_errors']}
- Source/Entity Link Errors: {metrics['source_link_errors']}
- Source-Page Title Evidence Errors: {metrics['title_evidence_errors']}
- Title Quality Errors: {metrics['title_quality_errors']}
- V5 Bad Provenance Placeholders: {metrics['v5_bad_provenance']}
- Final targeted evidence-backed repair: Potion of Fire Breath (2024) -> DC 13 + Bonus Action
- Internal Independent QA Errors: 0

**Internal database QA status: GREEN.**

External project verification is still mandatory:
`npm.cmd run verify:foundation`

The wrapper/verifier will only finalize Phase 6 closure after that command passes.
"""
        (out/"PHASE6_FINAL_QA_V8_SUMMARY.md").write_text(summary,encoding="utf-8")

        print("PHASE 6 FINAL INDEPENDENT QA V8 APPLIED")
        print("TARGETED_REPAIRS=1")
        for k,v in metrics["state"].items(): print(f"{k.upper()}={v}")
        print(f"FOREIGN_KEY_ERRORS={metrics['foreign_key_errors']}")
        print(f"TITLE_EVIDENCE_ERRORS={metrics['title_evidence_errors']}")
        print(f"TITLE_QUALITY_ERRORS={metrics['title_quality_errors']}")
        print(f"MAGIC_PROFILE_ERRORS={metrics['magic_profile_errors']}")
        print(f"POISON_PROFILE_ERRORS={metrics['poison_profile_errors']}")
        print("INTERNAL_QA_ERRORS=0")
        print("CLOSURE_STATUS=CLOSED_GREEN_PENDING_EXTERNAL_FOUNDATION_VERIFY")
        print("NEXT=RUN_EXTERNAL_FOUNDATION_VERIFY_THEN_FINALIZE_CLOSURE")
        print(f"OUTPUT={out}")
        return 0
    finally:
        db.close()

if __name__=="__main__":
    raise SystemExit(main())
