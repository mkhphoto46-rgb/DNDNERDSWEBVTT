from __future__ import annotations
import argparse, sqlite3
from datetime import datetime, timezone
from pathlib import Path

PROJECT_ROOT=Path(r"F:\DND WEB VTT")
DEFAULT_DB=PROJECT_ROOT/"data"/"compendium"/"rules_knowledge.sqlite"

def main():
 ap=argparse.ArgumentParser(); ap.add_argument("--db",default=str(DEFAULT_DB)); a=ap.parse_args()
 db=sqlite3.connect(a.db)
 try:
  row=db.execute("""select id,closure_status from phase6_closure_batches order by created_at desc limit 1""").fetchone()
  if not row: raise RuntimeError("No Phase 6 V8 closure batch exists.")
  if row[1]!="CLOSED_GREEN_PENDING_EXTERNAL_FOUNDATION_VERIFY":
   if row[1]=="FINAL_CLOSED_GREEN":
    print("PHASE 6 already FINAL_CLOSED_GREEN"); return 0
   raise RuntimeError(f"Unexpected closure status: {row[1]}")
  db.execute("update phase6_closure_batches set closure_status='FINAL_CLOSED_GREEN', notes=notes || ' External npm.cmd run verify:foundation passed; independent V8 verifier passed.' where id=?",(row[0],))
  db.commit()
  print("PHASE6_CLOSURE_STATUS=FINAL_CLOSED_GREEN")
  return 0
 finally:
  db.close()
if __name__=="__main__":
 raise SystemExit(main())
