from __future__ import annotations
import argparse, json, re, sqlite3
from pathlib import Path

PROJECT_ROOT=Path(r"F:\DND WEB VTT")
DEFAULT_DB=PROJECT_ROOT/"data"/"compendium"/"rules_knowledge.sqlite"
DEFAULT_OUTPUT=PROJECT_ROOT/"_phase6_final_independent_qa_closure_v8"
TARGET_ID="book-magic-item.2024.dungeon-master-s-guide.potion-of-fire-breath.291"
EXPECTED={
 "runtime_magic":262,"runtime_poison":14,"book_magic":333,"book_magic_profiles":333,
 "book_poison":1,"book_poison_profiles":1,"residual":0,"old_queue":0,
 "automation_backlog":871,"effective_extracted":0
}

def scalar(db,s,args=()): return db.execute(s,args).fetchone()[0]
def norm(s): return re.sub(r"[^a-z0-9]+","",(s or "").lower().replace("’","'").replace("‘","'"))
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
  "effective_extracted":scalar(db,"select count(*) from effective_validated_entities where status='extracted'")
 }

def main():
 ap=argparse.ArgumentParser(); ap.add_argument("--db",default=str(DEFAULT_DB)); ap.add_argument("--output",default=str(DEFAULT_OUTPUT))
 a=ap.parse_args(); db=sqlite3.connect(a.db); db.row_factory=sqlite3.Row; out=Path(a.output)
 errors=[]
 try:
  integ=db.execute("pragma integrity_check").fetchone()[0]; fk=db.execute("pragma foreign_key_check").fetchall(); st=state(db)
  if integ!="ok": errors.append("integrity_check")
  if fk: errors.append(f"foreign_keys:{len(fk)}")
  if st!=EXPECTED: errors.append(f"state:{st}")

  # exact registry/profile symmetry
  symmetry=[
   scalar(db,"select count(*) from book_magic_item_registry r left join book_magic_item_engine_profiles p using(book_magic_item_id) where p.book_magic_item_id is null"),
   scalar(db,"select count(*) from book_magic_item_engine_profiles p left join book_magic_item_registry r using(book_magic_item_id) where r.book_magic_item_id is null"),
   scalar(db,"select count(*) from book_poison_registry r left join book_poison_engine_profiles p using(book_poison_id) where p.book_poison_id is null"),
   scalar(db,"select count(*) from book_poison_engine_profiles p left join book_poison_registry r using(book_poison_id) where r.book_poison_id is null")
  ]
  if any(symmetry): errors.append(f"profile_symmetry:{symmetry}")

  active={x[0] for x in db.execute("select magic_item_id from magic_item_registry")}
  active.update(x[0] for x in db.execute("select book_magic_item_id from book_magic_item_registry"))
  active.update(x[0] for x in db.execute("select poison_id from poison_registry"))
  active.update(x[0] for x in db.execute("select book_poison_id from book_poison_registry"))
  orphan=[x[0] for x in db.execute("select distinct content_id from phase6_automation_backlog") if x[0] not in active]
  if orphan: errors.append(f"orphan_backlog:{len(orphan)}")

  groups={}
  for x in db.execute("select item_name,rules_version from book_magic_item_registry"):
   groups.setdefault((x[1],norm(x[0])),0); groups[(x[1],norm(x[0]))]+=1
  dup=sum(1 for v in groups.values() if v>1)
  if dup: errors.append(f"book_duplicates:{dup}")
  rt={norm(x[0]) for x in db.execute("select item_name from magic_item_registry where rules_version='2024'")}
  overlap=sum(1 for x in db.execute("select item_name from book_magic_item_registry where rules_version='2024'") if norm(x[0]) in rt)
  if overlap: errors.append(f"runtime_overlap:{overlap}")

  badprofile=0
  for x in db.execute("select * from book_magic_item_engine_profiles"):
   d=dict(x)
   try:
    if any(not isinstance(json.loads(d[f]),list) for f in ("activation_types_json","condition_tags_json","damage_types_json")): badprofile+=1
   except: badprofile+=1
   if d["requires_attunement"] not in (0,1): badprofile+=1
   if d["max_charges"] is not None and not 1<=d["max_charges"]<=100: badprofile+=1
   if d["save_dc"] is not None and not 5<=d["save_dc"]<=30: badprofile+=1
  if badprofile: errors.append(f"magic_profile_errors:{badprofile}")

  badpoison=0
  for x in db.execute("select * from book_poison_engine_profiles"):
   d=dict(x)
   if not 5<=d["save_dc"]<=30: badpoison+=1
   try:
    if not isinstance(json.loads(d["damage_types_json"]),list) or not isinstance(json.loads(d["conditions_json"]),list): badpoison+=1
   except: badpoison+=1
  if badpoison: errors.append(f"poison_profile_errors:{badpoison}")

  rev={x["source_id"]:x["id"] for x in db.execute("select * from source_revisions")}
  evidence=0; sourceerr=0
  for x in db.execute("""select r.*,ev.name ev_name,ev.source_id ev_source,ev.rules_version ev_rules,
                         ev.source_page_start ev_start,ev.source_page_end ev_end
                         from book_magic_item_registry r join entity_versions ev on ev.id=r.entity_version_id"""):
   if x["source_id"]!=x["ev_source"] or x["rules_version"]!=x["ev_rules"]: sourceerr+=1
   rr=rev.get(x["source_id"]); pr=db.execute("select text from raw_pages where revision_id=? and page_number=?",(rr,x["source_page"])).fetchone() if rr else None
   if not pr: evidence+=1
   else:
    p=norm(pr[0])
    if not (norm(x["item_name"]) in p or (len(norm(x["ev_name"]))>=5 and norm(x["ev_name"]) in p)): evidence+=1
  if sourceerr: errors.append(f"source_errors:{sourceerr}")
  if evidence: errors.append(f"title_evidence_errors:{evidence}")

  # explicit bad-name rejection
  titlebad=0
  for x in db.execute("select item_name from book_magic_item_registry"):
   name=x[0].strip(); up=name.upper()
   if len(name)<2 or len(name)>90 or "\n" in name or "|" in name or "\t" in name: titlebad+=1; continue
   if re.search(r"\bCH\s*AP\s*TER\b|\bCHAPTER\b",up): titlebad+=1; continue
   if up in {"ACTIONS","ACTION","TREASURE","MAGIC ITEMS","MAGIC ITEM","POISONS","ELEMENTALS","SAMPLE POISONS"}: titlebad+=1; continue
   if re.match(r"^(WONDROUS ITEM|WEAPON\s*\(|ARMOR\s*\(|WAND,|ROD,|RING,|POTION,|SCROLL,|STAFF,)",up) and re.search(r"\b(COMMON|UNCOMMON|RARE|VERY RARE|LEGENDARY|ARTIFACT)\b",up) and not re.search(r"\+\d",name):
    titlebad+=1
  if titlebad: errors.append(f"title_quality_errors:{titlebad}")

  badprov=scalar(db,"select count(*) from phase6_title_normalization_resolution where evidence_note like '%{sp}%' or evidence_note like '%{new}%'")
  if badprov: errors.append(f"bad_provenance:{badprov}")

  fire=db.execute("select save_dc,activation_types_json,damage_types_json from book_magic_item_engine_profiles where book_magic_item_id=?",(TARGET_ID,)).fetchone()
  if not fire or tuple(fire)!=(13,'["Bonus Action"]','["Fire"]'): errors.append(f"fire_breath:{tuple(fire) if fire else None}")

  repair=scalar(db,"select count(*) from phase6_final_qa_repairs where content_id=?",(TARGET_ID,))
  if repair!=1: errors.append(f"repair_record:{repair}")

  closure=db.execute("""select id,closure_status,independent_qa_errors,runtime_magic,runtime_poison,book_magic,book_poison,automation_backlog
                        from phase6_closure_batches order by created_at desc limit 1""").fetchone()
  if not closure: errors.append("missing_closure_batch")
  else:
   if closure["closure_status"] not in ("CLOSED_GREEN_PENDING_EXTERNAL_FOUNDATION_VERIFY","FINAL_CLOSED_GREEN"):
    errors.append(f"closure_status:{closure['closure_status']}")
   if closure["independent_qa_errors"]!=0: errors.append("closure_internal_errors")
   if (closure["runtime_magic"],closure["runtime_poison"],closure["book_magic"],closure["book_poison"],closure["automation_backlog"])!=(262,14,333,1,871):
    errors.append("closure_counts")

  needed=["phase6_final_qa_v8_report.json","final_book_magic_items.json","final_book_magic_items.csv",
          "final_book_magic_item_profiles.json","final_book_magic_item_profiles.csv",
          "final_book_poisons.json","final_book_poisons.csv","final_book_poison_profiles.json",
          "final_book_poison_profiles.csv","final_automation_backlog.json","final_automation_backlog.csv",
          "final_qa_repairs.json","PHASE6_FINAL_QA_V8_SUMMARY.md"]
  missing=[n for n in needed if not (out/n).exists()]
  if missing: errors.append(f"missing_outputs:{missing}")

  print(f"INTEGRITY={integ}")
  print(f"FOREIGN_KEYS={'ok' if not fk else len(fk)}")
  for k,v in st.items(): print(f"{k.upper()}={v}")
  print(f"PROFILE_SYMMETRY_ERRORS={sum(symmetry)}")
  print(f"ORPHAN_BACKLOG={len(orphan)}")
  print(f"BOOK_DUPLICATE_GROUPS={dup}")
  print(f"REMAINING_2024_RUNTIME_OVERLAP={overlap}")
  print(f"MAGIC_PROFILE_ERRORS={badprofile}")
  print(f"POISON_PROFILE_ERRORS={badpoison}")
  print(f"SOURCE_LINK_ERRORS={sourceerr}")
  print(f"TITLE_EVIDENCE_ERRORS={evidence}")
  print(f"TITLE_QUALITY_ERRORS={titlebad}")
  print(f"V5_BAD_PROVENANCE={badprov}")
  print(f"ERRORS={len(errors)}")
  for e in errors: print("ERROR:",e)
  if errors: return 1
  print("OK: Independent Phase 6 V8 closure verification")
  return 0
 finally:
  db.close()

if __name__=="__main__":
 raise SystemExit(main())
