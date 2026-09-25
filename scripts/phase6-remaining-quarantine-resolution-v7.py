from __future__ import annotations
import argparse,csv,hashlib,json,sqlite3
from pathlib import Path
from datetime import datetime,timezone

PROJECT_ROOT=Path(r"F:\DND WEB VTT")
DEFAULT_DB=PROJECT_ROOT/"data"/"compendium"/"rules_knowledge.sqlite"
DEFAULT_PAYLOAD=PROJECT_ROOT/"scripts"/"phase6-v7-payload.json"
DEFAULT_OUTPUT=PROJECT_ROOT/"_phase6_remaining_quarantine_resolution_v7"

def now_iso():
    return datetime.now(timezone.utc).isoformat()

def sha256(p):
    h=hashlib.sha256()
    with Path(p).open("rb") as f:
        for c in iter(lambda:f.read(1024*1024),b""):
            h.update(c)
    return h.hexdigest()

def scalar(db,q,a=()):
    return db.execute(q,a).fetchone()[0]

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
      "v6_resolutions":scalar(db,"select count(*) from phase6_bounded_recovery_resolution"),
    }

def ensure_schema(db):
    db.executescript('''
    CREATE TABLE IF NOT EXISTS phase6_remaining_quarantine_batches(
      id TEXT PRIMARY KEY,
      created_at TEXT NOT NULL,
      source_db_sha256 TEXT NOT NULL,
      recovered_magic INTEGER NOT NULL,
      noise_resolved INTEGER NOT NULL,
      runtime_duplicates_removed INTEGER NOT NULL,
      remaining_magic_quarantine INTEGER NOT NULL,
      post_book_magic INTEGER NOT NULL,
      post_automation_backlog INTEGER NOT NULL,
      phase_status TEXT NOT NULL
    ) STRICT;
    CREATE TABLE IF NOT EXISTS phase6_remaining_quarantine_resolution(
      entity_version_id TEXT PRIMARY KEY,
      action TEXT NOT NULL,
      canonical_name TEXT,
      destination TEXT NOT NULL,
      matched_content_id TEXT,
      source_title TEXT NOT NULL,
      source_page INTEGER,
      evidence_note TEXT NOT NULL,
      batch_id TEXT NOT NULL
    ) STRICT;
    ''')

def require_preconditions(db,p):
    actual=state(db)
    for k,v in p["expected_pre_state"].items():
        if actual.get(k)!=v:
            raise RuntimeError(f"V7 precondition mismatch {k}: expected={v} actual={actual.get(k)}")
    latest=db.execute("select phase_status from phase6_bounded_recovery_batches order by created_at desc limit 1").fetchone()
    if not latest or latest[0]!="BOUNDED_QUARANTINE_RECOVERY_APPLIED_PHASE6_OPEN":
        raise RuntimeError("V7 requires successful V6.")
    seen=set()
    for group in ("recovered_magic","noise"):
        for r in p[group]:
            eid=r["entity_version_id"]
            if eid in seen:
                raise RuntimeError(f"Duplicate V7 target: {eid}")
            seen.add(eid)
            row=db.execute("select original_name,resolution_class from phase6_final_resolution where entity_version_id=? and resolution_scope='residual'",(eid,)).fetchone()
            if not row or row[0]!=r["expected_original_name"] or row[1]!="v2-magic-recovery-quarantined":
                raise RuntimeError(f"Target changed/not quarantined: {eid}")
    if len(seen)!=36:
        raise RuntimeError(f"V7 must disposition exactly 36 targets; got {len(seen)}")
    for r in p["recovered_magic"]:
        if db.execute("select 1 from book_magic_item_registry where book_magic_item_id=?",(r["book_magic_item_id"],)).fetchone():
            raise RuntimeError(f"Book magic ID already exists: {r['book_magic_item_id']}")
        if db.execute("select 1 from book_magic_item_registry where rules_version=? and lower(item_name)=lower(?)",(r["rules_version"],r["item_name"])).fetchone():
            raise RuntimeError(f"Canonical title already exists in same rules version: {r['item_name']}")
    for r in p["post_normalization_runtime_duplicates"]:
        row=db.execute("select item_name,rules_version from book_magic_item_registry where book_magic_item_id=?",(r["book_magic_item_id"],)).fetchone()
        if not row or row[0]!=r["canonical_name"] or row[1]!="2024":
            raise RuntimeError(f"Post-normalization duplicate target changed/missing: {r['book_magic_item_id']}")
        rr=db.execute("select item_name,rules_version from magic_item_registry where magic_item_id=?",(r["runtime_id"],)).fetchone()
        if not rr or rr[0]!=r["canonical_name"] or rr[1]!="2024":
            raise RuntimeError(f"Authoritative runtime duplicate target changed/missing: {r['runtime_id']}")

def write_csv(path,rows):
    rows=list(rows)
    fields=list(rows[0].keys()) if rows else ["empty"]
    with Path(path).open("w",encoding="utf-8-sig",newline="") as f:
        w=csv.DictWriter(f,fieldnames=fields,extrasaction="ignore")
        w.writeheader()
        if rows:
            w.writerows(rows)

def main():
    ap=argparse.ArgumentParser()
    ap.add_argument("--db",default=str(DEFAULT_DB))
    ap.add_argument("--payload",default=str(DEFAULT_PAYLOAD))
    ap.add_argument("--output",default=str(DEFAULT_OUTPUT))
    ap.add_argument("--apply",action="store_true")
    args=ap.parse_args()

    dbp=Path(args.db)
    out=Path(args.output)
    p=json.loads(Path(args.payload).read_text(encoding="utf-8"))
    out.mkdir(parents=True,exist_ok=True)

    db=sqlite3.connect(dbp)
    try:
        if db.execute("pragma integrity_check").fetchone()[0]!="ok":
            raise RuntimeError("SQLite integrity failed before V7")
        if db.execute("pragma foreign_key_check").fetchall():
            raise RuntimeError("Foreign-key failure before V7")
        require_preconditions(db,p)
        if not args.apply:
            print("V7 preconditions PASS (read-only).")
            return 0

        batch_id="phase6-remaining-quarantine-v7-"+datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
        now=now_iso()
        source_hash=sha256(dbp)

        db.execute("begin immediate")
        try:
            ensure_schema(db)

            # Register this batch in the existing Phase 6 parent tables before inserting
            # rows whose batch_id columns are protected by foreign keys.
            db.execute(
                "insert into phase6_book_recovery_batches(id,created_at,source_db_sha256,queue_before,duplicate_count,recovered_magic_item_count,recovered_poison_count,noise_count,residual_count) values(?,?,?,?,?,?,?,?,?)",
                (batch_id,now,source_hash,36,len(p["post_normalization_runtime_duplicates"]),len(p["recovered_magic"]),0,len(p["noise"]),0)
            )
            db.execute(
                "insert into phase6_validation_batches(id,created_at,source_db_sha256,magic_item_count,poison_count,review_count,automation_backlog_count) values(?,?,?,?,?,?,?)",
                (batch_id,now,source_hash,262,14,0,871)
            )
            db.execute(
                "insert into phase6_final_batches(id,created_at,source_db_sha256,residual_before,runtime_book_duplicates_removed,residual_runtime_duplicates,residual_book_duplicates,magic_items_recovered,poisons_recovered,noise_or_reference_resolved,residual_after,final_book_magic_count,final_book_poison_count) values(?,?,?,?,?,?,?,?,?,?,?,?,?)",
                (batch_id,now,source_hash,36,len(p["post_normalization_runtime_duplicates"]),0,0,len(p["recovered_magic"]),0,len(p["noise"]),0,333,1)
            )

            for r in p["post_normalization_runtime_duplicates"]:
                db.execute("delete from book_magic_item_engine_profiles where book_magic_item_id=?",(r["book_magic_item_id"],))
                db.execute("delete from book_magic_item_registry where book_magic_item_id=?",(r["book_magic_item_id"],))
                db.execute(
                    "update phase6_book_review_resolution set resolution_class='post-normalization-2024-runtime-duplicate',destination='magic_item_registry',matched_runtime_id=?,notes=?,batch_id=? where entity_version_id=?",
                    (r["runtime_id"],r["evidence_note"],batch_id,r["entity_version_id"])
                )
                db.execute(
                    "insert into phase6_remaining_quarantine_resolution(entity_version_id,action,canonical_name,destination,matched_content_id,source_title,source_page,evidence_note,batch_id) values(?,?,?,?,?,?,?,?,?)",
                    (r["entity_version_id"],"runtime-duplicate",r["canonical_name"],"magic_item_registry",r["runtime_id"],r["source_title"],r["source_page"],r["evidence_note"],batch_id)
                )

            for r in p["recovered_magic"]:
                db.execute(
                    "insert into book_magic_item_registry(book_magic_item_id,item_name,entity_version_id,rules_version,source_id,source_title,source_page,validation_scope,batch_id,validated_at) values(?,?,?,?,?,?,?,?,?,?)",
                    (r["book_magic_item_id"],r["item_name"],r["entity_version_id"],r["rules_version"],r["source_id"],r["source_title"],r["source_page"],
                     "v7-bounded-final-quarantine-recovery",batch_id,now)
                )
                db.execute(
                    "insert into book_magic_item_engine_profiles(book_magic_item_id,item_type,rarity,requires_attunement,max_charges,recharge_kind,recharge_formula,save_dc,activation_types_json,condition_tags_json,damage_types_json) values(?,?,?,?,NULL,NULL,NULL,NULL,'[]','[]','[]')",
                    (r["book_magic_item_id"],r["item_type"],r["rarity"],r["requires_attunement"])
                )
                db.execute(
                    "insert into phase6_automation_backlog(content_id,content_kind,capability_or_gap,status,notes,batch_id) values(?,'magic-item','gap:bounded-recovery-full-profile-review','STRUCTURED_REVIEW_TODO',?,?)",
                    (r["book_magic_item_id"],"V7 recovered identity and bounded basic descriptor profile from direct local-page evidence. Full item-specific mechanics/profile automation remains explicitly pending.",batch_id)
                )
                db.execute(
                    "update phase6_final_resolution set resolution_class='bounded-evidence-recovered-v7',recovered_name=?,destination='book_magic_item_registry',matched_content_id=?,evidence_note=?,batch_id=? where entity_version_id=? and resolution_scope='residual'",
                    (r["item_name"],r["book_magic_item_id"],r["evidence_note"],batch_id,r["entity_version_id"])
                )
                db.execute(
                    "insert into phase6_remaining_quarantine_resolution(entity_version_id,action,canonical_name,destination,matched_content_id,source_title,source_page,evidence_note,batch_id) values(?,?,?,?,?,?,?,?,?)",
                    (r["entity_version_id"],"recovered",r["item_name"],"book_magic_item_registry",r["book_magic_item_id"],r["source_title"],r["source_page"],r["evidence_note"],batch_id)
                )

            for r in p["noise"]:
                note=f"Bounded V7 disposition from local indexed source page {r['source_page']}: {r['reason']} Source/entity provenance remains searchable; this record is not promoted to the validated magic-item registry."
                db.execute(
                    "update phase6_final_resolution set resolution_class='bounded-evidence-noise-v7',recovered_name=NULL,destination='searchable-provenance-only',matched_content_id=NULL,evidence_note=?,batch_id=? where entity_version_id=? and resolution_scope='residual'",
                    (note,batch_id,r["entity_version_id"])
                )
                db.execute(
                    "insert into phase6_remaining_quarantine_resolution(entity_version_id,action,canonical_name,destination,matched_content_id,source_title,source_page,evidence_note,batch_id) values(?,?,?,?,?,?,?,?,?)",
                    (r["entity_version_id"],"noise",None,"searchable-provenance-only",None,r["source_title"],r["source_page"],note,batch_id)
                )

            post=state(db)
            expected={
              "runtime_magic":262,"runtime_poison":14,
              "book_magic":333,"book_magic_profiles":333,
              "book_poison":1,"book_poison_profiles":1,
              "residual":0,"old_queue":0,
              "automation_backlog":871,"effective_extracted":0,
              "v5_repairs":99,"v5_bad_provenance":0,
              "quarantined_magic":0,"quarantined_poison":0,
              "v6_resolutions":79
            }
            if post!=expected:
                raise RuntimeError(f"V7 post-state mismatch expected={expected} actual={post}")

            dups=db.execute(
                "select rules_version,lower(replace(replace(replace(item_name,' ',''),'-',''),'’','')),count(*) from book_magic_item_registry group by 1,2 having count(*)>1"
            ).fetchall()
            if dups:
                raise RuntimeError(f"V7 created normalized duplicate titles: {dups[:10]}")

            db.execute(
                "insert into phase6_remaining_quarantine_batches(id,created_at,source_db_sha256,recovered_magic,noise_resolved,runtime_duplicates_removed,remaining_magic_quarantine,post_book_magic,post_automation_backlog,phase_status) values(?,?,?,?,?,?,?,?,?,?)",
                (batch_id,now,source_hash,len(p["recovered_magic"]),len(p["noise"]),len(p["post_normalization_runtime_duplicates"]),0,post["book_magic"],post["automation_backlog"],"REMAINING_QUARANTINE_RESOLVED_PHASE6_FINAL_QA_REQUIRED")
            )
            db.commit()
        except Exception:
            db.rollback()
            raise

        if db.execute("pragma integrity_check").fetchone()[0]!="ok":
            raise RuntimeError("SQLite integrity failed after V7")
        if db.execute("pragma foreign_key_check").fetchall():
            raise RuntimeError("Foreign-key failure after V7")

        report={
          "applied":True,
          "batchId":batch_id,
          "recoveredMagic":len(p["recovered_magic"]),
          "noiseResolved":len(p["noise"]),
          "postNormalizationRuntimeDuplicatesRemoved":len(p["post_normalization_runtime_duplicates"]),
          "postState":state(db),
          "phaseStatus":"REMAINING_QUARANTINE_RESOLVED_PHASE6_FINAL_QA_REQUIRED",
          "next":"PHASE6_FINAL_INDEPENDENT_QA_AND_CLOSURE"
        }
        (out/"phase6_remaining_quarantine_v7_report.json").write_text(json.dumps(report,indent=2),encoding="utf-8")
        (out/"recovered_magic_items.json").write_text(json.dumps(p["recovered_magic"],ensure_ascii=False,indent=2),encoding="utf-8")
        write_csv(out/"recovered_magic_items.csv",p["recovered_magic"])
        (out/"noise_dispositions.json").write_text(json.dumps(p["noise"],ensure_ascii=False,indent=2),encoding="utf-8")
        write_csv(out/"noise_dispositions.csv",p["noise"])

        remaining=[dict(zip(["book_magic_item_id","item_name","rules_version","source_title","source_page"],x))
                   for x in db.execute("select book_magic_item_id,item_name,rules_version,source_title,source_page from book_magic_item_registry order by rules_version,source_title,source_page,item_name")]
        (out/"validated_book_magic_items_after_v7.json").write_text(json.dumps(remaining,ensure_ascii=False,indent=2),encoding="utf-8")
        write_csv(out/"validated_book_magic_items_after_v7.csv",remaining)

        st=state(db)
        summary=(
            "# Phase 6 Remaining Quarantine Resolution V7\n\n"
            f"- Magic items recovered from direct page evidence: {len(p['recovered_magic'])}\n"
            f"- Noise/table/statblock candidates resolved: {len(p['noise'])}\n"
            f"- Post-normalization 2024 runtime duplicates removed: {len(p['post_normalization_runtime_duplicates'])}\n"
            f"- Remaining magic quarantine: {st['quarantined_magic']}\n"
            f"- Book Magic Items: {st['book_magic']}\n"
            f"- Book Magic Profiles: {st['book_magic_profiles']}\n"
            f"- Book Poisons: {st['book_poison']}\n"
            f"- Automation Backlog: {st['automation_backlog']}\n"
            f"- Effective Extracted: {st['effective_extracted']}\n\n"
            "**Status: REMAINING QUARANTINE RESOLVED / PHASE 6 FINAL QA REQUIRED.**\n\n"
            "Phase 7 must not start until independent Phase 6 final QA and closure pass.\n"
        )
        (out/"PHASE6_REMAINING_QUARANTINE_V7_SUMMARY.md").write_text(summary,encoding="utf-8")

        print("PHASE 6 REMAINING QUARANTINE RESOLUTION V7 APPLIED")
        print(f"RECOVERED_MAGIC={len(p['recovered_magic'])}")
        print(f"NOISE_RESOLVED={len(p['noise'])}")
        print(f"POST_NORMALIZATION_RUNTIME_DUPLICATES_REMOVED={len(p['post_normalization_runtime_duplicates'])}")
        for k,v in st.items():
            print(f"{k.upper()}={v}")
        print("PHASE_STATUS=REMAINING_QUARANTINE_RESOLVED_PHASE6_FINAL_QA_REQUIRED")
        print("NEXT=PHASE6_FINAL_INDEPENDENT_QA_AND_CLOSURE")
        print(f"OUTPUT={out}")
        return 0
    finally:
        db.close()

if __name__=="__main__":
    raise SystemExit(main())
