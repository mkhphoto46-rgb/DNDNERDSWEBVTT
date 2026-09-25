from __future__ import annotations
import argparse, csv, hashlib, json, re, sqlite3
from pathlib import Path
from datetime import datetime, timezone

PROJECT_ROOT=Path(r"F:\DND WEB VTT")
DEFAULT_DB=PROJECT_ROOT/"data"/"compendium"/"rules_knowledge.sqlite"
DEFAULT_OUTPUT=PROJECT_ROOT/"_phase6_bounded_quarantine_recovery_v6"
DEFAULT_PAYLOAD=PROJECT_ROOT/"scripts"/"phase6-v6-payload.json"

def now_iso():
    return datetime.now(timezone.utc).isoformat()

def sha256(path: Path):
    h=hashlib.sha256()
    with path.open("rb") as f:
        for c in iter(lambda:f.read(1024*1024),b""): h.update(c)
    return h.hexdigest()

def scalar(db,sql,args=()):
    return db.execute(sql,args).fetchone()[0]

def state(db):
    return {
      "runtime_magic":scalar(db,"select count(*) from magic_item_registry"),
      "runtime_poison":scalar(db,"select count(*) from poison_registry"),
      "book_magic":scalar(db,"select count(*) from book_magic_item_registry"),
      "book_magic_profiles":scalar(db,"select count(*) from book_magic_item_engine_profiles"),
      "book_poison":scalar(db,"select count(*) from book_poison_registry"),
      "book_poison_profiles":scalar(db,"select count(*) from book_poison_engine_profiles"),
      "residual":scalar(db,"select count(*) from phase6_residual_review_queue"),
      "old_queue":scalar(db,"select count(*) from phase6_content_review_queue"),
      "automation_backlog":scalar(db,"select count(*) from phase6_automation_backlog"),
      "effective_extracted":scalar(db,"select count(*) from effective_validated_entities where status='extracted'"),
      "v5_repairs":scalar(db,"select count(*) from phase6_title_normalization_resolution"),
      "v5_bad_provenance":scalar(db,"select count(*) from phase6_title_normalization_resolution where evidence_note like '%{sp}%' or evidence_note like '%{new}%'"),
      "quarantined_magic":scalar(db,"select count(*) from phase6_final_resolution where resolution_class='v2-magic-recovery-quarantined'"),
      "quarantined_poison":scalar(db,"select count(*) from phase6_final_resolution where resolution_class='v2-poison-recovery-quarantined'"),
    }

def ensure_schema(db):
    db.executescript("""
    CREATE TABLE IF NOT EXISTS phase6_bounded_recovery_batches(
      id TEXT PRIMARY KEY,
      created_at TEXT NOT NULL,
      source_db_sha256 TEXT NOT NULL,
      recovered_magic INTEGER NOT NULL,
      magic_runtime_duplicates INTEGER NOT NULL,
      recovered_poison INTEGER NOT NULL,
      poison_runtime_duplicates INTEGER NOT NULL,
      poison_noise INTEGER NOT NULL,
      remaining_magic_quarantine INTEGER NOT NULL,
      post_book_magic INTEGER NOT NULL,
      post_book_poison INTEGER NOT NULL,
      post_automation_backlog INTEGER NOT NULL,
      phase_status TEXT NOT NULL
    ) STRICT;
    CREATE TABLE IF NOT EXISTS phase6_bounded_recovery_resolution(
      entity_version_id TEXT PRIMARY KEY,
      category TEXT NOT NULL,
      action TEXT NOT NULL,
      canonical_name TEXT,
      destination TEXT NOT NULL,
      matched_content_id TEXT,
      source_title TEXT NOT NULL,
      source_page INTEGER,
      evidence_note TEXT NOT NULL,
      batch_id TEXT NOT NULL
    ) STRICT;
    """)

def require_preconditions(db,p):
    actual=state(db)
    for k,v in p["expected_pre_state"].items():
        if actual.get(k)!=v:
            raise RuntimeError(f"V6 precondition mismatch {k}: expected={v} actual={actual.get(k)}")
    latest=db.execute("select phase_status from phase6_title_normalization_batches order by created_at desc limit 1").fetchone()
    if not latest or latest[0]!="CANONICAL_TITLE_NORMALIZATION_APPLIED_PHASE6_OPEN":
        raise RuntimeError("V6 requires successful V5.")
    for group in ("recovered_magic","magic_runtime_duplicates","poison_runtime_duplicates"):
        for r in p[group]:
            row=db.execute("select original_name,resolution_class from phase6_final_resolution where entity_version_id=? and resolution_scope='residual'",(r["entity_version_id"],)).fetchone()
            if not row or row[0]!=r["expected_original_name"] or "quarantined" not in row[1]:
                raise RuntimeError(f"Target changed/not quarantined: {r['entity_version_id']}")
    for r in (p["recovered_poison"],p["poison_heading_noise"]):
        row=db.execute("select original_name,resolution_class from phase6_final_resolution where entity_version_id=? and resolution_scope='residual'",(r["entity_version_id"],)).fetchone()
        if not row or row[0]!=r["expected_original_name"] or "quarantined" not in row[1]:
            raise RuntimeError(f"Poison target changed/not quarantined: {r['entity_version_id']}")
    for r in p["recovered_magic"]:
        if db.execute("select 1 from book_magic_item_registry where book_magic_item_id=?",(r["book_magic_item_id"],)).fetchone():
            raise RuntimeError(f"Book magic ID already exists: {r['book_magic_item_id']}")
    rp=p["recovered_poison"]
    if db.execute("select 1 from book_poison_registry where book_poison_id=?",(rp["book_poison_id"],)).fetchone():
        raise RuntimeError(f"Book poison ID already exists: {rp['book_poison_id']}")

def write_csv(path,rows):
    rows=list(rows)
    if rows:
        fields=[]
        seen=set()
        for row in rows:
            for k in row.keys():
                if k not in seen:
                    seen.add(k); fields.append(k)
    else:
        fields=["empty"]
    with path.open("w",encoding="utf-8-sig",newline="") as f:
        w=csv.DictWriter(f,fieldnames=fields,extrasaction="ignore"); w.writeheader()
        if rows: w.writerows(rows)

def normalize_title(s):
    return re.sub(r"[^a-z0-9]+","",s.lower())

def fix_v5_provenance(db):
    rows=db.execute("select content_id,new_name,source_page from phase6_title_normalization_resolution").fetchall()
    for content_id,new_name,page in rows:
        note=f"Local indexed source page {page} identifies this as '{new_name}'; the stored title is an OCR-corrupted rendering. Only item_name was changed. Stable content ID and engine profile were preserved."
        db.execute("update phase6_title_normalization_resolution set evidence_note=? where content_id=?",(note,content_id))
    return len(rows)

def insert_resolution(db,batch_id,entity_id,category,action,name,destination,matched,source_title,source_page,note):
    db.execute("""insert into phase6_bounded_recovery_resolution
      (entity_version_id,category,action,canonical_name,destination,matched_content_id,source_title,source_page,evidence_note,batch_id)
      values(?,?,?,?,?,?,?,?,?,?)""",
      (entity_id,category,action,name,destination,matched,source_title,source_page,note,batch_id))

def main():
    ap=argparse.ArgumentParser()
    ap.add_argument("--db",default=str(DEFAULT_DB))
    ap.add_argument("--payload",default=str(DEFAULT_PAYLOAD))
    ap.add_argument("--output",default=str(DEFAULT_OUTPUT))
    ap.add_argument("--apply",action="store_true")
    a=ap.parse_args()
    dbp=Path(a.db); pp=Path(a.payload); out=Path(a.output)
    if not dbp.exists(): raise RuntimeError(f"DB not found: {dbp}")
    if not pp.exists(): raise RuntimeError(f"Payload not found: {pp}")
    p=json.loads(pp.read_text(encoding="utf-8"))
    out.mkdir(parents=True,exist_ok=True)
    db=sqlite3.connect(dbp)
    try:
        if db.execute("pragma integrity_check").fetchone()[0]!="ok":
            raise RuntimeError("SQLite integrity failed before V6.")
        require_preconditions(db,p)
        if not a.apply:
            print("V6 preconditions PASS (read-only).")
            return 0
        source_hash=sha256(dbp)
        batch_id="phase6-bounded-recovery-v6-"+datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
        now=now_iso()
        ensure_schema(db)
        db.execute("begin immediate")
        try:
            # Register this V6 batch in the existing parent batch tables so all legacy FKs remain valid.
            db.execute("""insert into phase6_book_recovery_batches
              (id,created_at,source_db_sha256,queue_before,duplicate_count,recovered_magic_item_count,recovered_poison_count,noise_count,residual_count)
              values(?,?,?,?,?,?,?,?,?)""",
              (batch_id,now,source_hash,115,44,33,1,1,36))
            db.execute("""insert into phase6_validation_batches
              (id,created_at,source_db_sha256,magic_item_count,poison_count,review_count,automation_backlog_count)
              values(?,?,?,?,?,?,?)""",
              (batch_id,now,source_hash,262,14,36,853))
            db.execute("""insert into phase6_final_batches
              (id,created_at,source_db_sha256,residual_before,runtime_book_duplicates_removed,residual_runtime_duplicates,
               residual_book_duplicates,magic_items_recovered,poisons_recovered,noise_or_reference_resolved,residual_after,
               final_book_magic_count,final_book_poison_count)
              values(?,?,?,?,?,?,?,?,?,?,?,?,?)""",
              (batch_id,now,source_hash,115,0,44,0,33,1,1,36,317,1))

            fixed=fix_v5_provenance(db)
            poison_rows=[]

            for r in p["recovered_magic"]:
                db.execute("""insert into book_magic_item_registry
                  (book_magic_item_id,item_name,entity_version_id,rules_version,source_id,source_title,source_page,validation_scope,batch_id,validated_at)
                  values(?,?,?,?,?,?,?,?,?,?)""",
                  (r["book_magic_item_id"],r["item_name"],r["entity_version_id"],r["rules_version"],r["source_id"],r["source_title"],r["source_page"],
                   "v6-bounded-evidence-recovery",batch_id,now))
                db.execute("""insert into book_magic_item_engine_profiles
                  (book_magic_item_id,item_type,rarity,requires_attunement,max_charges,recharge_kind,recharge_formula,save_dc,
                   activation_types_json,condition_tags_json,damage_types_json)
                  values(?,?,?,?,NULL,NULL,NULL,NULL,'[]','[]','[]')""",
                  (r["book_magic_item_id"],r["item_type"],r["rarity"],r["requires_attunement"]))
                db.execute("""insert into phase6_automation_backlog
                  (content_id,content_kind,capability_or_gap,status,notes,batch_id)
                  values(?, 'magic-item','gap:bounded-recovery-full-profile-review','STRUCTURED_REVIEW_TODO',?,?)""",
                  (r["book_magic_item_id"],"V6 recovered identity and bounded basic descriptor profile. Full item-specific mechanics/profile automation remains explicitly pending.",batch_id))
                db.execute("""update phase6_final_resolution
                  set resolution_class='bounded-evidence-recovered',recovered_name=?,destination='book_magic_item_registry',
                      matched_content_id=?,evidence_note=?,batch_id=?
                  where entity_version_id=? and resolution_scope='residual'""",
                  (r["item_name"],r["book_magic_item_id"],r["evidence_note"],batch_id,r["entity_version_id"]))
                insert_resolution(db,batch_id,r["entity_version_id"],"magic-item","recovered",r["item_name"],"book_magic_item_registry",
                                  r["book_magic_item_id"],r["source_title"],r["source_page"],r["evidence_note"])

            for r in p["magic_runtime_duplicates"]:
                db.execute("""update phase6_final_resolution
                  set resolution_class='bounded-2024-runtime-duplicate',recovered_name=?,destination='magic_item_registry',
                      matched_content_id=?,evidence_note=?,batch_id=?
                  where entity_version_id=? and resolution_scope='residual'""",
                  (r["canonical_name"],r["runtime_id"],r["evidence_note"],batch_id,r["entity_version_id"]))
                insert_resolution(db,batch_id,r["entity_version_id"],"magic-item","runtime-duplicate",r["canonical_name"],"magic_item_registry",
                                  r["runtime_id"],r["source_title"],r["source_page"],r["evidence_note"])

            for r in p["poison_runtime_duplicates"]:
                db.execute("""update phase6_final_resolution
                  set resolution_class='bounded-2024-runtime-duplicate',recovered_name=?,destination='poison_registry',
                      matched_content_id=?,evidence_note=?,batch_id=?
                  where entity_version_id=? and resolution_scope='residual'""",
                  (r["canonical_name"],r["runtime_id"],r["evidence_note"],batch_id,r["entity_version_id"]))
                insert_resolution(db,batch_id,r["entity_version_id"],"poison","runtime-duplicate",r["canonical_name"],"poison_registry",
                                  r["runtime_id"],r["source_title"],r["source_page"],r["evidence_note"])
                poison_rows.append(dict(r,action="runtime-duplicate"))

            rp=p["recovered_poison"]
            db.execute("""insert into book_poison_registry
              (book_poison_id,poison_name,entity_version_id,rules_version,source_id,source_title,source_page,validation_scope,batch_id,validated_at)
              values(?,?,?,?,?,?,?,?,?,?)""",
              (rp["book_poison_id"],rp["poison_name"],rp["entity_version_id"],rp["rules_version"],rp["source_id"],rp["source_title"],rp["source_page"],
               "v6-bounded-evidence-recovery",batch_id,now))
            db.execute("""insert into book_poison_engine_profiles
              (book_poison_id,poison_type,application_method,save_ability,save_dc,damage_dice,damage_types_json,conditions_json,duration_text,onset_text)
              values(?,?,?,?,?,?,?,?,?,?)""",
              (rp["book_poison_id"],rp["poison_type"],rp["application_method"],rp["save_ability"],rp["save_dc"],rp["damage_dice"],
               rp["damage_types_json"],rp["conditions_json"],rp["duration_text"],rp["onset_text"]))
            db.execute("""insert into phase6_automation_backlog
              (content_id,content_kind,capability_or_gap,status,notes,batch_id)
              values(?, 'poison','gap:book-poison-runtime-handler','AUTOMATION_TODO',?,?)""",
              (rp["book_poison_id"],"Lolth's Sting is structurally validated from local 2024 source; generic book-poison runtime handling still requires implementation/testing.",batch_id))
            db.execute("""update phase6_final_resolution
              set resolution_class='bounded-evidence-recovered',recovered_name=?,destination='book_poison_registry',
                  matched_content_id=?,evidence_note=?,batch_id=?
              where entity_version_id=? and resolution_scope='residual'""",
              (rp["poison_name"],rp["book_poison_id"],rp["evidence_note"],batch_id,rp["entity_version_id"]))
            insert_resolution(db,batch_id,rp["entity_version_id"],"poison","recovered",rp["poison_name"],"book_poison_registry",
                              rp["book_poison_id"],rp["source_title"],rp["source_page"],rp["evidence_note"])
            poison_rows.append(dict(rp,action="recovered"))

            pn=p["poison_heading_noise"]
            db.execute("""update phase6_final_resolution
              set resolution_class='bounded-heading-rule-noise',recovered_name=NULL,destination='searchable-provenance-only',
                  matched_content_id=NULL,evidence_note=?,batch_id=?
              where entity_version_id=? and resolution_scope='residual'""",
              (pn["evidence_note"],batch_id,pn["entity_version_id"]))
            insert_resolution(db,batch_id,pn["entity_version_id"],"poison","heading-rule-noise",None,"searchable-provenance-only",
                              None,"Dungeon Master's Guide",94,pn["evidence_note"])
            poison_rows.append(dict(pn,action="heading-rule-noise"))

            post=state(db)
            expected_post={"runtime_magic":262,"runtime_poison":14,"book_magic":317,"book_magic_profiles":317,"book_poison":1,"book_poison_profiles":1,
                           "residual":0,"old_queue":0,"automation_backlog":853,"effective_extracted":0,"v5_repairs":99,"v5_bad_provenance":0,
                           "quarantined_magic":p["expected_remaining_magic_quarantine"],"quarantined_poison":0}
            for k,v in expected_post.items():
                if post.get(k)!=v: raise RuntimeError(f"V6 postcondition mismatch {k}: expected={v} actual={post.get(k)}")

            seen=set()
            for rv,name in db.execute("select rules_version,item_name from book_magic_item_registry"):
                key=(rv,normalize_title(name))
                if key in seen: raise RuntimeError(f"V6 normalized duplicate book title: {key}")
                seen.add(key)

            db.execute("""insert into phase6_bounded_recovery_batches
              (id,created_at,source_db_sha256,recovered_magic,magic_runtime_duplicates,recovered_poison,poison_runtime_duplicates,
               poison_noise,remaining_magic_quarantine,post_book_magic,post_book_poison,post_automation_backlog,phase_status)
              values(?,?,?,?,?,?,?,?,?,?,?,?,?)""",
              (batch_id,now,source_hash,len(p["recovered_magic"]),len(p["magic_runtime_duplicates"]),1,len(p["poison_runtime_duplicates"]),1,
               p["expected_remaining_magic_quarantine"],post["book_magic"],post["book_poison"],post["automation_backlog"],
               "BOUNDED_QUARANTINE_RECOVERY_APPLIED_PHASE6_OPEN"))
            db.commit()
        except Exception:
            db.rollback(); raise

        if db.execute("pragma integrity_check").fetchone()[0]!="ok": raise RuntimeError("SQLite integrity failed after V6.")
        if db.execute("pragma foreign_key_check").fetchall(): raise RuntimeError("Foreign key check failed after V6.")

        report={"applied":True,"batchId":batch_id,"v5ProvenanceNotesFixed":fixed,"recoveredMagicItems":len(p["recovered_magic"]),
                "magicRuntimeDuplicatesResolved":len(p["magic_runtime_duplicates"]),"recoveredBookPoisons":1,
                "poisonRuntimeDuplicatesResolved":len(p["poison_runtime_duplicates"]),"poisonHeadingNoiseResolved":1,
                "remainingMagicQuarantine":p["expected_remaining_magic_quarantine"],"postState":state(db),
                "phaseStatus":"BOUNDED_QUARANTINE_RECOVERY_APPLIED_PHASE6_OPEN",
                "next":"REVIEW_REMAINING_36_MAGIC_QUARANTINE_AND_FINAL_QA"}
        (out/"phase6_bounded_recovery_v6_report.json").write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding="utf-8")
        write_csv(out/"recovered_magic_items.csv",p["recovered_magic"])
        write_csv(out/"resolved_magic_runtime_duplicates.csv",p["magic_runtime_duplicates"])
        write_csv(out/"poison_dispositions.csv",poison_rows)
        carried=[{"entity_version_id":r[0],"original_name":r[1],"rules_version":r[2],"source_title":r[3],"source_page":r[4],"evidence_note":r[5]}
                 for r in db.execute("""select entity_version_id,original_name,rules_version,source_title,source_page,evidence_note
                                      from phase6_final_resolution where resolution_class='v2-magic-recovery-quarantined'
                                      order by source_title,source_page,original_name""")]
        write_csv(out/"remaining_magic_quarantine.csv",carried)
        summary=f"""# Phase 6 Bounded Quarantine Recovery V6

- V5 provenance notes repaired: {fixed}
- Magic items recovered to book registry: {len(p['recovered_magic'])}
- 2024 magic duplicates resolved to authoritative runtime: {len(p['magic_runtime_duplicates'])}
- Book poison recovered: 1 (Lolth's Sting)
- 2024 poison duplicates resolved to authoritative runtime: {len(p['poison_runtime_duplicates'])}
- Poison heading/rule noise resolved: 1
- Remaining magic quarantine: {p['expected_remaining_magic_quarantine']}

## Post-state
- Runtime Magic Items: {report['postState']['runtime_magic']}
- Runtime Poisons: {report['postState']['runtime_poison']}
- Book Magic Items: {report['postState']['book_magic']}
- Book Poisons: {report['postState']['book_poison']}
- Automation Backlog: {report['postState']['automation_backlog']}
- Effective Extracted: {report['postState']['effective_extracted']}

**Status: BOUNDED QUARANTINE RECOVERY APPLIED / PHASE 6 REMAINS OPEN.**

The 36 remaining magic candidates are intentionally not promoted because their indexed entity boundaries are mixed, table-derived, statblock-derived, or otherwise unsafe.
"""
        (out/"PHASE6_BOUNDED_QUARANTINE_RECOVERY_V6_SUMMARY.md").write_text(summary,encoding="utf-8")
        print("PHASE 6 BOUNDED QUARANTINE RECOVERY V6 APPLIED")
        print(f"V5_PROVENANCE_FIXED={fixed}")
        print(f"RECOVERED_MAGIC={len(p['recovered_magic'])}")
        print(f"MAGIC_RUNTIME_DUPLICATES={len(p['magic_runtime_duplicates'])}")
        print("RECOVERED_POISON=1")
        print(f"POISON_RUNTIME_DUPLICATES={len(p['poison_runtime_duplicates'])}")
        print("POISON_NOISE=1")
        for k,v in state(db).items(): print(f"{k.upper()}={v}")
        print("PHASE_STATUS=BOUNDED_QUARANTINE_RECOVERY_APPLIED_PHASE6_OPEN")
        print("NEXT=REVIEW_REMAINING_36_MAGIC_QUARANTINE_AND_FINAL_QA")
        print(f"OUTPUT={out}")
        return 0
    finally:
        db.close()

if __name__=="__main__":
    raise SystemExit(main())
