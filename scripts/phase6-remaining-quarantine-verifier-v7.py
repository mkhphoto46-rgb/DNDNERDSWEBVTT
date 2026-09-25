from __future__ import annotations
import argparse,sqlite3
from pathlib import Path

PROJECT_ROOT=Path(r"F:\DND WEB VTT")
DEFAULT_DB=PROJECT_ROOT/"data"/"compendium"/"rules_knowledge.sqlite"
DEFAULT_OUTPUT=PROJECT_ROOT/"_phase6_remaining_quarantine_resolution_v7"

def scalar(db,q):
    return db.execute(q).fetchone()[0]

def main():
    ap=argparse.ArgumentParser()
    ap.add_argument("--db",default=str(DEFAULT_DB))
    ap.add_argument("--output",default=str(DEFAULT_OUTPUT))
    args=ap.parse_args()
    db=sqlite3.connect(args.db)
    out=Path(args.output)
    try:
        errors=[]
        integ=db.execute("pragma integrity_check").fetchone()[0]
        fk=db.execute("pragma foreign_key_check").fetchall()
        vals={
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
            "quarantined_magic":scalar(db,"select count(*) from phase6_final_resolution where resolution_class='v2-magic-recovery-quarantined'"),
            "quarantined_poison":scalar(db,"select count(*) from phase6_final_resolution where resolution_class='v2-poison-recovery-quarantined'"),
            "v7_resolutions":scalar(db,"select count(*) from phase6_remaining_quarantine_resolution"),
        }
        expected={
            "runtime_magic":262,"runtime_poison":14,
            "book_magic":333,"book_magic_profiles":333,
            "book_poison":1,"book_poison_profiles":1,
            "residual":0,"old_queue":0,
            "automation_backlog":871,"effective_extracted":0,
            "quarantined_magic":0,"quarantined_poison":0,
            "v7_resolutions":38
        }
        if integ!="ok":
            errors.append("integrity_check != ok")
        if fk:
            errors.append(f"foreign key failures={len(fk)}")
        if vals!=expected:
            errors.append(f"state mismatch expected={expected} actual={vals}")

        batch=db.execute(
            "select recovered_magic,noise_resolved,runtime_duplicates_removed,remaining_magic_quarantine,phase_status "
            "from phase6_remaining_quarantine_batches order by created_at desc limit 1"
        ).fetchone()
        if not batch or tuple(batch)!=(18,18,2,0,"REMAINING_QUARANTINE_RESOLVED_PHASE6_FINAL_QA_REQUIRED"):
            errors.append(f"bad/missing V7 batch: {batch}")

        obvious_sql=(
            "select item_name from book_magic_item_registry where "
            "upper(item_name) in ('ACTIONS','ACTI ONS','RAR ITY','WUXIA WEAPON NAM ES','OFFENSIVE AND DEFENSIVE USES','PART I I EQUIPME NT') "
            "or upper(item_name) like '%HABITAR ANY%' "
            "or upper(item_name) like '%SKILLS PERCEPTION%' "
            "or upper(item_name) like '%SMALL OR MEDIUM CELESTIAL%' "
            "or upper(item_name) like '%MEDIUM HUMANOID%' "
            "or upper(item_name) like 'POTION % RARITY%' limit 20"
        )
        obvious=db.execute(obvious_sql).fetchall()
        if obvious:
            errors.append(f"obvious noise in validated registry: {obvious}")

        dup_sql=(
            "select rules_version,lower(replace(replace(replace(item_name,' ',''),'-',''),'’','')),count(*) "
            "from book_magic_item_registry group by 1,2 having count(*)>1 limit 20"
        )
        dups=db.execute(dup_sql).fetchall()
        if dups:
            errors.append(f"normalized duplicate titles: {dups}")

        overlap_sql=(
            "select b.item_name from book_magic_item_registry b join magic_item_registry r "
            "on lower(replace(replace(b.item_name,' ',''),'-',''))=lower(replace(replace(r.item_name,' ',''),'-','')) "
            "where b.rules_version='2024' limit 20"
        )
        overlaps=db.execute(overlap_sql).fetchall()
        if overlaps:
            errors.append(f"2024 runtime overlap: {overlaps}")

        needed=[
            "phase6_remaining_quarantine_v7_report.json",
            "recovered_magic_items.json","recovered_magic_items.csv",
            "noise_dispositions.json","noise_dispositions.csv",
            "validated_book_magic_items_after_v7.json","validated_book_magic_items_after_v7.csv",
            "PHASE6_REMAINING_QUARANTINE_V7_SUMMARY.md"
        ]
        for n in needed:
            if not (out/n).exists():
                errors.append("missing output "+n)

        print(f"INTEGRITY={integ}")
        print(f"FOREIGN_KEYS={'ok' if not fk else len(fk)}")
        for k,v in vals.items():
            print(f"{k.upper()}={v}")
        print(f"ERRORS={len(errors)}")
        for e in errors:
            print("ERROR:",e)
        print("PHASE_STATUS=REMAINING_QUARANTINE_RESOLVED_PHASE6_FINAL_QA_REQUIRED")
        print("NEXT=PHASE6_FINAL_INDEPENDENT_QA_AND_CLOSURE")
        if errors:
            return 1
        print("OK: Independent Phase 6 V7 database verification")
        return 0
    finally:
        db.close()

if __name__=="__main__":
    raise SystemExit(main())
