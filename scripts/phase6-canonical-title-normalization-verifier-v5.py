from __future__ import annotations
import argparse, hashlib, json, sqlite3
from pathlib import Path

DEFAULT_PROJECT_ROOT=Path(r"F:\DND WEB VTT")
DEFAULT_DB=DEFAULT_PROJECT_ROOT/"data"/"compendium"/"rules_knowledge.sqlite"
DEFAULT_OUTPUT=DEFAULT_PROJECT_ROOT/"_phase6_canonical_title_normalization_v5"

EXPECTED={
 "runtime_magic":262,"runtime_poison":14,"book_magic":284,"book_poison":0,
 "residual":0,"old_queue":0,"automation_backlog":819,"effective_extracted":0
}

def state(db):
 q=lambda s:db.execute(s).fetchone()[0]
 return {
  "runtime_magic":q("SELECT COUNT(*) FROM magic_item_registry"),
  "runtime_poison":q("SELECT COUNT(*) FROM poison_registry"),
  "book_magic":q("SELECT COUNT(*) FROM book_magic_item_registry"),
  "book_poison":q("SELECT COUNT(*) FROM book_poison_registry"),
  "residual":q("SELECT COUNT(*) FROM phase6_residual_review_queue"),
  "old_queue":q("SELECT COUNT(*) FROM phase6_content_review_queue"),
  "automation_backlog":q("SELECT COUNT(*) FROM phase6_automation_backlog"),
  "effective_extracted":q("SELECT COUNT(*) FROM effective_validated_entities WHERE status='extracted'"),
 }

def main():
 ap=argparse.ArgumentParser(); ap.add_argument("--db",default=str(DEFAULT_DB)); ap.add_argument("--output",default=str(DEFAULT_OUTPUT))
 a=ap.parse_args(); dbp=Path(a.db); out=Path(a.output)
 db=sqlite3.connect(dbp)
 try:
  errors=[]
  integ=db.execute("PRAGMA integrity_check").fetchone()[0]
  fk=db.execute("PRAGMA foreign_key_check").fetchall()
  st=state(db)
  if integ!="ok": errors.append("integrity_check != ok")
  if fk: errors.append(f"foreign_key_check returned {len(fk)} rows")
  if st!=EXPECTED: errors.append(f"state mismatch expected={EXPECTED} actual={st}")
  batch=db.execute("""SELECT repairs,profile_digest_before,profile_digest_after,backlog_digest_before,backlog_digest_after,phase_status
                      FROM phase6_title_normalization_batches ORDER BY created_at DESC LIMIT 1""").fetchone()
  if not batch: errors.append("missing V5 batch")
  else:
   if batch[0]!=99: errors.append(f"repair count={batch[0]} expected=99")
   if batch[1]!=batch[2]: errors.append("engine profile digest changed")
   if batch[3]!=batch[4]: errors.append("automation backlog digest changed")
   if batch[5]!="CANONICAL_TITLE_NORMALIZATION_APPLIED_PHASE6_OPEN": errors.append(f"bad phase status {batch[5]}")
  rc=db.execute("SELECT COUNT(*) FROM phase6_title_normalization_resolution").fetchone()[0]
  if rc<99: errors.append(f"normalization resolution count={rc} expected>=99")
  # Explicit independent rejection of known old OCR titles from V5.
  old=db.execute("""SELECT COUNT(*) FROM book_magic_item_registry r
                    JOIN phase6_title_normalization_resolution x ON x.content_id=r.book_magic_item_id
                    WHERE r.item_name=x.old_name AND x.old_name<>x.new_name""").fetchone()[0]
  if old: errors.append(f"{old} V5 old OCR titles still active")
  bad=db.execute("""SELECT item_name FROM book_magic_item_registry
                    WHERE upper(item_name) LIKE '%CHAPTER %'
                       OR upper(item_name)='ACTIONS'
                       OR upper(item_name) LIKE '%ATTUNEMENT)%'
                    LIMIT 20""").fetchall()
  if bad: errors.append(f"obvious heading/prose titles remain: {bad}")
  dup=db.execute("""SELECT rules_version,lower(replace(replace(replace(item_name,' ',''),'-',''),'’','')),COUNT(*)
                    FROM book_magic_item_registry GROUP BY 1,2 HAVING COUNT(*)>1 LIMIT 20""").fetchall()
  if dup: errors.append(f"normalized duplicate titles: {dup}")
  needed=["phase6_title_normalization_v5_report.json","title_normalizations.json","title_normalizations.csv",
          "remaining_validated_book_magic_items.json","remaining_validated_book_magic_items.csv",
          "PHASE6_CANONICAL_TITLE_NORMALIZATION_V5_SUMMARY.md"]
  for n in needed:
   if not (out/n).exists(): errors.append(f"missing output {n}")
  print(f"INTEGRITY={integ}")
  print(f"FOREIGN_KEYS={'ok' if not fk else len(fk)}")
  for k,v in st.items(): print(f"{k.upper()}={v}")
  print(f"V5_TITLE_REPAIRS={batch[0] if batch else 0}")
  print(f"V5_RESOLUTIONS={rc}")
  print(f"ERRORS={len(errors)}")
  for e in errors: print("ERROR:",e)
  print("PHASE_STATUS=CANONICAL_TITLE_NORMALIZATION_APPLIED_PHASE6_OPEN")
  print("NEXT=BOUNDED_QUARANTINE_RECOVERY")
  if errors: return 1
  print("OK: Independent Phase 6 V5 database verification")
  return 0
 finally: db.close()
if __name__=="__main__":
 raise SystemExit(main())
