from __future__ import annotations
import argparse, json, re, sqlite3
from pathlib import Path

PROJECT_ROOT=Path(r"F:\DND WEB VTT")
DEFAULT_DB=PROJECT_ROOT/"data"/"compendium"/"rules_knowledge.sqlite"
DEFAULT_OUTPUT=PROJECT_ROOT/"_phase6_bounded_quarantine_recovery_v6"

EXPECTED={"runtime_magic":262,"runtime_poison":14,"book_magic":317,"book_magic_profiles":317,"book_poison":1,"book_poison_profiles":1,
          "residual":0,"old_queue":0,"automation_backlog":853,"effective_extracted":0,"v5_repairs":99,"v5_bad_provenance":0,
          "quarantined_magic":36,"quarantined_poison":0}

def scalar(db,sql): return db.execute(sql).fetchone()[0]
def state(db):
    return {"runtime_magic":scalar(db,"select count(*) from magic_item_registry"),"runtime_poison":scalar(db,"select count(*) from poison_registry"),
            "book_magic":scalar(db,"select count(*) from book_magic_item_registry"),"book_magic_profiles":scalar(db,"select count(*) from book_magic_item_engine_profiles"),
            "book_poison":scalar(db,"select count(*) from book_poison_registry"),"book_poison_profiles":scalar(db,"select count(*) from book_poison_engine_profiles"),
            "residual":scalar(db,"select count(*) from phase6_residual_review_queue"),"old_queue":scalar(db,"select count(*) from phase6_content_review_queue"),
            "automation_backlog":scalar(db,"select count(*) from phase6_automation_backlog"),
            "effective_extracted":scalar(db,"select count(*) from effective_validated_entities where status='extracted'"),
            "v5_repairs":scalar(db,"select count(*) from phase6_title_normalization_resolution"),
            "v5_bad_provenance":scalar(db,"select count(*) from phase6_title_normalization_resolution where evidence_note like '%{sp}%' or evidence_note like '%{new}%'"),
            "quarantined_magic":scalar(db,"select count(*) from phase6_final_resolution where resolution_class='v2-magic-recovery-quarantined'"),
            "quarantined_poison":scalar(db,"select count(*) from phase6_final_resolution where resolution_class='v2-poison-recovery-quarantined'")}

def norm(s): return re.sub(r"[^a-z0-9]+","",s.lower())

def main():
    ap=argparse.ArgumentParser(); ap.add_argument("--db",default=str(DEFAULT_DB)); ap.add_argument("--output",default=str(DEFAULT_OUTPUT))
    a=ap.parse_args(); db=sqlite3.connect(a.db); out=Path(a.output)
    try:
        errors=[]; integ=db.execute("pragma integrity_check").fetchone()[0]; fk=db.execute("pragma foreign_key_check").fetchall(); st=state(db)
        if integ!="ok": errors.append("integrity_check failed")
        if fk: errors.append(f"foreign_key_check rows={len(fk)}")
        if st!=EXPECTED: errors.append(f"state mismatch expected={EXPECTED} actual={st}")
        batch=db.execute("""select recovered_magic,magic_runtime_duplicates,recovered_poison,poison_runtime_duplicates,poison_noise,
                                  remaining_magic_quarantine,phase_status from phase6_bounded_recovery_batches order by created_at desc limit 1""").fetchone()
        exp=(33,35,1,9,1,36,"BOUNDED_QUARANTINE_RECOVERY_APPLIED_PHASE6_OPEN")
        if not batch or tuple(batch)!=exp: errors.append(f"V6 batch mismatch expected={exp} actual={tuple(batch) if batch else None}")
        rc=scalar(db,"select count(*) from phase6_bounded_recovery_resolution")
        if rc!=79: errors.append(f"V6 resolution count expected 79 actual {rc}")
        lolth=db.execute("""select r.poison_name,p.poison_type,p.application_method,p.save_ability,p.save_dc,p.damage_dice,p.conditions_json
                            from book_poison_registry r join book_poison_engine_profiles p on p.book_poison_id=r.book_poison_id
                            where r.book_poison_id='book-poison.2024.dungeon-masters-guide.lolths-sting.95'""").fetchone()
        if not lolth: errors.append("Lolth's Sting missing")
        else:
            if tuple(lolth[:6])!=("Lolth's Sting","Injury","Injury","Constitution",15,""): errors.append(f"Lolth profile mismatch {tuple(lolth)}")
            try:
                if json.loads(lolth[6])!=["Poisoned","Unconscious"]: errors.append("Lolth conditions mismatch")
            except Exception as e: errors.append(f"Lolth conditions JSON invalid {e}")
        if scalar(db,"select count(*) from phase6_automation_backlog where capability_or_gap='gap:bounded-recovery-full-profile-review'")!=33:
            errors.append("V6 magic backlog count mismatch")
        if scalar(db,"select count(*) from phase6_automation_backlog where capability_or_gap='gap:book-poison-runtime-handler'")!=1:
            errors.append("V6 poison backlog count mismatch")
        seen=set()
        for rv,name in db.execute("select rules_version,item_name from book_magic_item_registry"):
            key=(rv,norm(name))
            if key in seen: errors.append(f"normalized duplicate book title {key}")
            seen.add(key)
        for n in ["phase6_bounded_recovery_v6_report.json","recovered_magic_items.csv","resolved_magic_runtime_duplicates.csv",
                  "poison_dispositions.csv","remaining_magic_quarantine.csv","PHASE6_BOUNDED_QUARANTINE_RECOVERY_V6_SUMMARY.md"]:
            if not (out/n).exists(): errors.append(f"missing output {n}")
        print(f"INTEGRITY={integ}"); print(f"FOREIGN_KEYS={'ok' if not fk else len(fk)}")
        for k,v in st.items(): print(f"{k.upper()}={v}")
        print(f"V6_RESOLUTIONS={rc}"); print(f"ERRORS={len(errors)}")
        for e in errors: print("ERROR:",e)
        print("PHASE_STATUS=BOUNDED_QUARANTINE_RECOVERY_APPLIED_PHASE6_OPEN")
        print("NEXT=REVIEW_REMAINING_36_MAGIC_QUARANTINE_AND_FINAL_QA")
        if errors: return 1
        print("OK: Independent Phase 6 V6 database verification")
        return 0
    finally:
        db.close()

if __name__=="__main__":
    raise SystemExit(main())
