from __future__ import annotations
import argparse, hashlib, json, re, sqlite3
from datetime import datetime, timezone
from pathlib import Path

PROJECT_ROOT = Path(r"F:\DND WEB VTT")
RULES_DB = PROJECT_ROOT / "data" / "compendium" / "rules_knowledge.sqlite"
MONSTERS_DB = PROJECT_ROOT / "data" / "compendium" / "monsters.sqlite"
DEFAULT_OUTPUT = PROJECT_ROOT / "_phase8_structured_baseline_v4"

SECTION_MANIFEST = json.loads(r"""[{"disposition": "STRUCTURED_RULE_CANDIDATE", "heading": "Step 3: Track Food and Water Consumption. Each", "normalized_heading": "STEP 3 TRACK FOOD AND WATER CONSUMPTION EACH", "page_end": 42, "page_start": 42, "revision_id": "revision-4c0e493f88dc4a1d523f", "section_id": "section-02563c8bf0f2bf8503ac", "source_id": "source-2b38fffec79555019571", "source_title": "Dungeon Master's Guide"}, {"disposition": "STRUCTURED_RULE_CANDIDATE", "heading": "JUMPING", "normalized_heading": "JUMPING", "page_end": 369, "page_start": 369, "revision_id": "revision-e8c808a476318c7b2fff", "section_id": "section-04a7e6567a913e51d17c", "source_id": "source-10c684705ead6e0b898e", "source_title": "Player's Handbook"}, {"disposition": "REVIEW_CONTEXT", "heading": "FINDING HIDDEN OBJECTS", "normalized_heading": "FINDING HIDDEN OBJECTS", "page_end": 19, "page_start": 19, "revision_id": "revision-e8c808a476318c7b2fff", "section_id": "section-063918988da5011258d7", "source_id": "source-10c684705ead6e0b898e", "source_title": "Player's Handbook"}, {"disposition": "STRUCTURED_RULE_CANDIDATE", "heading": "FALLING OFF", "normalized_heading": "FALLING OFF", "page_end": 26, "page_start": 26, "revision_id": "revision-e8c808a476318c7b2fff", "section_id": "section-0993721bc99cd5b3dbfe", "source_id": "source-10c684705ead6e0b898e", "source_title": "Player's Handbook"}, {"disposition": "STRUCTURED_RULE_CANDIDATE", "heading": "TRAVEL PACE", "normalized_heading": "TRAVEL PACE", "page_end": 42, "page_start": 42, "revision_id": "revision-4c0e493f88dc4a1d523f", "section_id": "section-127c94c77fe26033adb8", "source_id": "source-2b38fffec79555019571", "source_title": "Dungeon Master's Guide"}, {"disposition": "REVIEW_CONTEXT", "heading": "TRAINING TO GAIN LEVELS", "normalized_heading": "TRAINING TO GAIN LEVELS", "page_end": 53, "page_start": 53, "revision_id": "revision-4c0e493f88dc4a1d523f", "section_id": "section-14f56350abab96acde32", "source_id": "source-2b38fffec79555019571", "source_title": "Dungeon Master's Guide"}, {"disposition": "STRUCTURED_RULE_CANDIDATE", "heading": "TACK, HARNESS, AND DRAWN VEHICLES", "normalized_heading": "TACK HARNESS AND DRAWN VEHICLES", "page_end": 229, "page_start": 229, "revision_id": "revision-e8c808a476318c7b2fff", "section_id": "section-1871550c024642346dc4", "source_id": "source-10c684705ead6e0b898e", "source_title": "Player's Handbook"}, {"disposition": "STRUCTURED_RULE_CANDIDATE", "heading": "Armor Class. The Object Armor Class table sug­", "normalized_heading": "ARMOR CLASS THE OBJECT ARMOR CLASS TABLE SUG", "page_end": 361, "page_start": 361, "revision_id": "revision-e8c808a476318c7b2fff", "section_id": "section-1936d78c2873028016db", "source_id": "source-10c684705ead6e0b898e", "source_title": "Player's Handbook"}, {"disposition": "STRUCTURED_RULE_CANDIDATE", "heading": "OBJECT", "normalized_heading": "OBJECT", "page_end": 370, "page_start": 370, "revision_id": "revision-e8c808a476318c7b2fff", "section_id": "section-195a32afee2cafdcae56", "source_id": "source-10c684705ead6e0b898e", "source_title": "Player's Handbook"}, {"disposition": "STRUCTURED_RULE_CANDIDATE", "heading": "MAPPING THE CHASE", "normalized_heading": "MAPPING THE CHASE", "page_end": 57, "page_start": 57, "revision_id": "revision-4c0e493f88dc4a1d523f", "section_id": "section-1ad497635af1670f3eb7", "source_id": "source-2b38fffec79555019571", "source_title": "Dungeon Master's Guide"}, {"disposition": "STRUCTURED_RULE_CANDIDATE", "heading": "BREAKING OBJECTS", "normalized_heading": "BREAKING OBJECTS", "page_end": 361, "page_start": 361, "revision_id": "revision-e8c808a476318c7b2fff", "section_id": "section-1c1488c1b660b1acf1f7", "source_id": "source-10c684705ead6e0b898e", "source_title": "Player's Handbook"}, {"disposition": "STRUCTURED_RULE_CANDIDATE", "heading": "AIRBORNE AND WATERBORNE VEHICLES", "normalized_heading": "AIRBORNE AND WATERBORNE VEHICLES", "page_end": 229, "page_start": 229, "revision_id": "revision-e8c808a476318c7b2fff", "section_id": "section-1f001a390810bda406dc", "source_id": "source-10c684705ead6e0b898e", "source_title": "Player's Handbook"}, {"disposition": "STRUCTURED_RULE_CANDIDATE", "heading": "LONG REST", "normalized_heading": "LONG REST", "page_end": 369, "page_start": 369, "revision_id": "revision-e8c808a476318c7b2fff", "section_id": "section-21052f7e1f9f615a5dda", "source_id": "source-10c684705ead6e0b898e", "source_title": "Player's Handbook"}, {"disposition": "STRUCTURED_RULE_CANDIDATE", "heading": "DESIGNING YOUR OWN CHASE TABLES", "normalized_heading": "DESIGNING YOUR OWN CHASE TABLES", "page_end": 57, "page_start": 57, "revision_id": "revision-4c0e493f88dc4a1d523f", "section_id": "section-257ae7db566c22bf85f6", "source_id": "source-2b38fffec79555019571", "source_title": "Dungeon Master's Guide"}, {"disposition": "REVIEW_CONTEXT", "heading": "CARRYING OBJECTS", "normalized_heading": "CARRYING OBJECTS", "page_end": 19, "page_start": 19, "revision_id": "revision-e8c808a476318c7b2fff", "section_id": "section-27d717f65b34acfbbecd", "source_id": "source-10c684705ead6e0b898e", "source_title": "Player's Handbook"}, {"disposition": "REVIEW_CONTEXT", "heading": "EXPLORATION ENCOUNTERS", "normalized_heading": "EXPLORATION ENCOUNTERS", "page_end": 118, "page_start": 118, "revision_id": "revision-4c0e493f88dc4a1d523f", "section_id": "section-28430d2c8ddcb19f4eef", "source_id": "source-2b38fffec79555019571", "source_title": "Dungeon Master's Guide"}, {"disposition": "STRUCTURED_RULE_CANDIDATE", "heading": "OBJECT HtT POINTS", "normalized_heading": "OBJECT HTT POINTS", "page_end": 361, "page_start": 361, "revision_id": "revision-e8c808a476318c7b2fff", "section_id": "section-3089ab6ab1461f5d2f1c", "source_id": "source-10c684705ead6e0b898e", "source_title": "Player's Handbook"}, {"disposition": "STRUCTURED_RULE_CANDIDATE", "heading": "WeatHER", "normalized_heading": "WEATHER", "page_end": 42, "page_start": 42, "revision_id": "revision-4c0e493f88dc4a1d523f", "section_id": "section-393f2a328d3fbafbf7d2", "source_id": "source-2b38fffec79555019571", "source_title": "Dungeon Master's Guide"}, {"disposition": "STRUCTURED_RULE_CANDIDATE", "heading": "MOUNTING AND DISMOUNTING", "normalized_heading": "MOUNTING AND DISMOUNTING", "page_end": 25, "page_start": 25, "revision_id": "revision-e8c808a476318c7b2fff", "section_id": "section-3aec2603331079fe64bf", "source_id": "source-10c684705ead6e0b898e", "source_title": "Player's Handbook"}, {"disposition": "STRUCTURED_RULE_CANDIDATE", "heading": "FRIGID WATER", "normalized_heading": "FRIGID WATER", "page_end": 72, "page_start": 72, "revision_id": "revision-4c0e493f88dc4a1d523f", "section_id": "section-3d7869d410f4e79873c5", "source_id": "source-2b38fffec79555019571", "source_title": "Dungeon Master's Guide"}, {"disposition": "STRUCTURED_RULE_CANDIDATE", "heading": "Hit Points. The Object Hit Points table suggests Hit", "normalized_heading": "HIT POINTS THE OBJECT HIT POINTS TABLE SUGGESTS HIT", "page_end": 361, "page_start": 361, "revision_id": "revision-e8c808a476318c7b2fff", "section_id": "section-40a29c51e1447b4474ca", "source_id": "source-10c684705ead6e0b898e", "source_title": "Player's Handbook"}, {"disposition": "STRUCTURED_RULE_CANDIDATE", "heading": "MAL N UTR ITION [HAZARD]", "normalized_heading": "MAL N UTR ITION HAZARD", "page_end": 370, "page_start": 370, "revision_id": "revision-e8c808a476318c7b2fff", "section_id": "section-412fa7c05aeb11849da8", "source_id": "source-10c684705ead6e0b898e", "source_title": "Player's Handbook"}, {"disposition": "STRUCTURED_RULE_CANDIDATE", "heading": "SHORT REST", "normalized_heading": "SHORT REST", "page_end": 372, "page_start": 372, "revision_id": "revision-e8c808a476318c7b2fff", "section_id": "section-41899f05db5b94a5745d", "source_id": "source-10c684705ead6e0b898e", "source_title": "Player's Handbook"}, {"disposition": "STRUCTURED_RULE_CANDIDATE", "heading": "SIEGE EQUIPMENT", "normalized_heading": "SIEGE EQUIPMENT", "page_end": 100, "page_start": 100, "revision_id": "revision-4c0e493f88dc4a1d523f", "section_id": "section-459a3717b779aa98f21a", "source_id": "source-2b38fffec79555019571", "source_title": "Dungeon Master's Guide"}, {"disposition": "STRUCTURED_RULE_CANDIDATE", "heading": "LARGE VEHICLES", "normalized_heading": "LARGE VEHICLES", "page_end": 229, "page_start": 229, "revision_id": "revision-e8c808a476318c7b2fff", "section_id": "section-46feed1fd017e0fe50b3", "source_id": "source-10c684705ead6e0b898e", "source_title": "Player's Handbook"}, {"disposition": "STRUCTURED_RULE_CANDIDATE", "heading": "ABILITY CHECKS IN EXPLORATION", "normalized_heading": "ABILITY CHECKS IN EXPLORATION", "page_end": 38, "page_start": 38, "revision_id": "revision-4c0e493f88dc4a1d523f", "section_id": "section-472d9b5f2d5ed0d85b89", "source_id": "source-2b38fffec79555019571", "source_title": "Dungeon Master's Guide"}, {"disposition": "STRUCTURED_RULE_CANDIDATE", "heading": "WATER NEEDS PER DAY", "normalized_heading": "WATER NEEDS PER DAY", "page_end": 364, "page_start": 364, "revision_id": "revision-e8c808a476318c7b2fff", "section_id": "section-549569c07337a9543920", "source_id": "source-10c684705ead6e0b898e", "source_title": "Player's Handbook"}, {"disposition": "STRUCTURED_RULE_CANDIDATE", "heading": "CHASES", "normalized_heading": "CHASES", "page_end": 56, "page_start": 56, "revision_id": "revision-4c0e493f88dc4a1d523f", "section_id": "section-57a8dc8ac7e9f05855e5", "source_id": "source-2b38fffec79555019571", "source_title": "Dungeon Master's Guide"}, {"disposition": "STRUCTURED_RULE_CANDIDATE", "heading": "CHASE COMPLICATIONS", "normalized_heading": "CHASE COMPLICATIONS", "page_end": 57, "page_start": 57, "revision_id": "revision-4c0e493f88dc4a1d523f", "section_id": "section-57f6333a867c247543fc", "source_id": "source-2b38fffec79555019571", "source_title": "Dungeon Master's Guide"}, {"disposition": "STRUCTURED_RULE_CANDIDATE", "heading": "BUILDING YOUR OWN TRAPS", "normalized_heading": "BUILDING YOUR OWN TRAPS", "page_end": 107, "page_start": 107, "revision_id": "revision-4c0e493f88dc4a1d523f", "section_id": "section-580b04552eb7dd8d13c0", "source_id": "source-2b38fffec79555019571", "source_title": "Dungeon Master's Guide"}, {"disposition": "STRUCTURED_RULE_CANDIDATE", "heading": "TRAVEL", "normalized_heading": "TRAVEL", "page_end": 40, "page_start": 40, "revision_id": "revision-4c0e493f88dc4a1d523f", "section_id": "section-5e5ae21dcfd085f8c2ae", "source_id": "source-2b38fffec79555019571", "source_title": "Dungeon Master's Guide"}, {"disposition": "STRUCTURED_RULE_CANDIDATE", "heading": "MOUNTS AND VEHICLES", "normalized_heading": "MOUNTS AND VEHICLES", "page_end": 228, "page_start": 228, "revision_id": "revision-e8c808a476318c7b2fff", "section_id": "section-61f6f62b8728cce77809", "source_id": "source-10c684705ead6e0b898e", "source_title": "Player's Handbook"}, {"disposition": "STRUCTURED_RULE_CANDIDATE", "heading": "BUILDING A TRAP", "normalized_heading": "BUILDING A TRAP", "page_end": 107, "page_start": 107, "revision_id": "revision-4c0e493f88dc4a1d523f", "section_id": "section-662d96b58301e9cb4cd7", "source_id": "source-2b38fffec79555019571", "source_title": "Dungeon Master's Guide"}, {"disposition": "STRUCTURED_RULE_CANDIDATE", "heading": "BEGINNING A CHASE", "normalized_heading": "BEGINNING A CHASE", "page_end": 56, "page_start": 56, "revision_id": "revision-4c0e493f88dc4a1d523f", "section_id": "section-6e5949e2738b56465baa", "source_id": "source-2b38fffec79555019571", "source_title": "Dungeon Master's Guide"}, {"disposition": "STRUCTURED_RULE_CANDIDATE", "heading": "HAZARDS", "normalized_heading": "HAZARDS", "page_end": 80, "page_start": 80, "revision_id": "revision-4c0e493f88dc4a1d523f", "section_id": "section-78ec22e53eef2a05456a", "source_id": "source-2b38fffec79555019571", "source_title": "Dungeon Master's Guide"}, {"disposition": "REVIEW_CONTEXT", "heading": "WHAT Is AN OBJECT?", "normalized_heading": "WHAT IS AN OBJECT", "page_end": 19, "page_start": 19, "revision_id": "revision-e8c808a476318c7b2fff", "section_id": "section-794489b88bf959844ce9", "source_id": "source-10c684705ead6e0b898e", "source_title": "Player's Handbook"}, {"disposition": "STRUCTURED_RULE_CANDIDATE", "heading": "MOUNTED COMBAT", "normalized_heading": "MOUNTED COMBAT", "page_end": 25, "page_start": 25, "revision_id": "revision-e8c808a476318c7b2fff", "section_id": "section-7b093022f10e3224ca23", "source_id": "source-10c684705ead6e0b898e", "source_title": "Player's Handbook"}, {"disposition": "STRUCTURED_RULE_CANDIDATE", "heading": "CONTROLLING A MOUNT", "normalized_heading": "CONTROLLING A MOUNT", "page_end": 25, "page_start": 25, "revision_id": "revision-e8c808a476318c7b2fff", "section_id": "section-8a4e472c2d66ef2cfe88", "source_id": "source-10c684705ead6e0b898e", "source_title": "Player's Handbook"}, {"disposition": "REVIEW_CONTEXT", "heading": "TRAINING", "normalized_heading": "TRAINING", "page_end": 85, "page_start": 85, "revision_id": "revision-4c0e493f88dc4a1d523f", "section_id": "section-8b88be75461a5d44a837", "source_id": "source-2b38fffec79555019571", "source_title": "Dungeon Master's Guide"}, {"disposition": "STRUCTURED_RULE_CANDIDATE", "heading": "TRAPS", "normalized_heading": "TRAPS", "page_end": 104, "page_start": 104, "revision_id": "revision-4c0e493f88dc4a1d523f", "section_id": "section-8f4d2f0beb277e2ad762", "source_id": "source-2b38fffec79555019571", "source_title": "Dungeon Master's Guide"}, {"disposition": "STRUCTURED_RULE_CANDIDATE", "heading": "DEH YDRATION [HAZARD]", "normalized_heading": "DEH YDRATION HAZARD", "page_end": 364, "page_start": 364, "revision_id": "revision-e8c808a476318c7b2fff", "section_id": "section-9249652fb6c073d6fe84", "source_id": "source-10c684705ead6e0b898e", "source_title": "Player's Handbook"}, {"disposition": "STRUCTURED_RULE_CANDIDATE", "heading": "CRAFTING EQUIPMENT", "normalized_heading": "CRAFTING EQUIPMENT", "page_end": 232, "page_start": 232, "revision_id": "revision-e8c808a476318c7b2fff", "section_id": "section-97b6e3397e19f681ef0b", "source_id": "source-10c684705ead6e0b898e", "source_title": "Player's Handbook"}, {"disposition": "STRUCTURED_RULE_CANDIDATE", "heading": "ACTIONS IN EXPLORATION", "normalized_heading": "ACTIONS IN EXPLORATION", "page_end": 38, "page_start": 38, "revision_id": "revision-4c0e493f88dc4a1d523f", "section_id": "section-97e1ae67fefb09fe1409", "source_id": "source-2b38fffec79555019571", "source_title": "Dungeon Master's Guide"}, {"disposition": "STRUCTURED_RULE_CANDIDATE", "heading": "PARTS OF A TRAP", "normalized_heading": "PARTS OF A TRAP", "page_end": 104, "page_start": 104, "revision_id": "revision-4c0e493f88dc4a1d523f", "section_id": "section-97ed2547a6d79f63f4a0", "source_id": "source-2b38fffec79555019571", "source_title": "Dungeon Master's Guide"}, {"disposition": "STRUCTURED_RULE_CANDIDATE", "heading": "MOUNTS AND OTHER ANIMALS", "normalized_heading": "MOUNTS AND OTHER ANIMALS", "page_end": 228, "page_start": 228, "revision_id": "revision-e8c808a476318c7b2fff", "section_id": "section-a47d167c26ddf6bfdeca", "source_id": "source-10c684705ead6e0b898e", "source_title": "Player's Handbook"}, {"disposition": "REVIEW_CONTEXT", "heading": "Order: Craft", "normalized_heading": "ORDER CRAFT", "page_end": 340, "page_start": 340, "revision_id": "revision-4c0e493f88dc4a1d523f", "section_id": "section-ab8908b8fe71d7c6ee46", "source_id": "source-2b38fffec79555019571", "source_title": "Dungeon Master's Guide"}, {"disposition": "STRUCTURED_RULE_CANDIDATE", "heading": "Nuisance Traps Deadly Traps", "normalized_heading": "NUISANCE TRAPS DEADLY TRAPS", "page_end": 107, "page_start": 107, "revision_id": "revision-4c0e493f88dc4a1d523f", "section_id": "section-adc1a76d4987084319ee", "source_id": "source-2b38fffec79555019571", "source_title": "Dungeon Master's Guide"}, {"disposition": "REVIEW_CONTEXT", "heading": "VARIANT: TRAINING TO GAIN LEVELS", "normalized_heading": "VARIANT TRAINING TO GAIN LEVELS", "page_end": 53, "page_start": 53, "revision_id": "revision-4c0e493f88dc4a1d523f", "section_id": "section-b30ae77cfe542b7edccf", "source_id": "source-2b38fffec79555019571", "source_title": "Dungeon Master's Guide"}, {"disposition": "STRUCTURED_RULE_CANDIDATE", "heading": "URBAN CHASE COMPLICATIONS", "normalized_heading": "URBAN CHASE COMPLICATIONS", "page_end": 58, "page_start": 58, "revision_id": "revision-4c0e493f88dc4a1d523f", "section_id": "section-b4a39292f3fcf78c7e11", "source_id": "source-2b38fffec79555019571", "source_title": "Dungeon Master's Guide"}, {"disposition": "STRUCTURED_RULE_CANDIDATE", "heading": "MOUNTS A N D CARGO", "normalized_heading": "MOUNTS A N D CARGO", "page_end": 228, "page_start": 228, "revision_id": "revision-e8c808a476318c7b2fff", "section_id": "section-b4cad2f2ec25de40f871", "source_id": "source-10c684705ead6e0b898e", "source_title": "Player's Handbook"}, {"disposition": "STRUCTURED_RULE_CANDIDATE", "heading": "DEEP WATER", "normalized_heading": "DEEP WATER", "page_end": 72, "page_start": 72, "revision_id": "revision-4c0e493f88dc4a1d523f", "section_id": "section-c001f16d32b9f5224095", "source_id": "source-2b38fffec79555019571", "source_title": "Dungeon Master's Guide"}, {"disposition": "STRUCTURED_RULE_CANDIDATE", "heading": "WEATHER", "normalized_heading": "WEATHER", "page_end": 42, "page_start": 42, "revision_id": "revision-4c0e493f88dc4a1d523f", "section_id": "section-c010858faa63341faa34", "source_id": "source-2b38fffec79555019571", "source_title": "Dungeon Master's Guide"}, {"disposition": "STRUCTURED_RULE_CANDIDATE", "heading": "NARRATION DURING TRAVEL", "normalized_heading": "NARRATION DURING TRAVEL", "page_end": 43, "page_start": 43, "revision_id": "revision-4c0e493f88dc4a1d523f", "section_id": "section-c4c728f8f61c948e3281", "source_id": "source-2b38fffec79555019571", "source_title": "Dungeon Master's Guide"}, {"disposition": "STRUCTURED_RULE_CANDIDATE", "heading": "Foraging", "normalized_heading": "FORAGING", "page_end": 43, "page_start": 43, "revision_id": "revision-4c0e493f88dc4a1d523f", "section_id": "section-c8cd4e678452955dc424", "source_id": "source-2b38fffec79555019571", "source_title": "Dungeon Master's Guide"}, {"disposition": "STRUCTURED_RULE_CANDIDATE", "heading": "TRAVEL TERRAIN", "normalized_heading": "TRAVEL TERRAIN", "page_end": 42, "page_start": 42, "revision_id": "revision-4c0e493f88dc4a1d523f", "section_id": "section-cdd8bff610c74a4f232d", "source_id": "source-2b38fffec79555019571", "source_title": "Dungeon Master's Guide"}, {"disposition": "STRUCTURED_RULE_CANDIDATE", "heading": "REST AND RECUPERATION", "normalized_heading": "REST AND RECUPERATION", "page_end": 65, "page_start": 65, "revision_id": "revision-4c0e493f88dc4a1d523f", "section_id": "section-ce8b704bf99b4a6116c8", "source_id": "source-2b38fffec79555019571", "source_title": "Dungeon Master's Guide"}, {"disposition": "STRUCTURED_RULE_CANDIDATE", "heading": "RUNNING EXPLORATION", "normalized_heading": "RUNNING EXPLORATION", "page_end": 37, "page_start": 37, "revision_id": "revision-4c0e493f88dc4a1d523f", "section_id": "section-d4cf68e532c72da2fbe8", "source_id": "source-2b38fffec79555019571", "source_title": "Dungeon Master's Guide"}, {"disposition": "STRUCTURED_RULE_CANDIDATE", "heading": "EXAMPLE TRAPS", "normalized_heading": "EXAMPLE TRAPS", "page_end": 104, "page_start": 104, "revision_id": "revision-4c0e493f88dc4a1d523f", "section_id": "section-d72fb436f2f8888e6092", "source_id": "source-2b38fffec79555019571", "source_title": "Dungeon Master's Guide"}, {"disposition": "STRUCTURED_RULE_CANDIDATE", "heading": "UNDERWATER COMBAT", "normalized_heading": "UNDERWATER COMBAT", "page_end": 26, "page_start": 26, "revision_id": "revision-e8c808a476318c7b2fff", "section_id": "section-d966b66e4eaaa808d146", "source_id": "source-10c684705ead6e0b898e", "source_title": "Player's Handbook"}, {"disposition": "STRUCTURED_RULE_CANDIDATE", "heading": "Foraging DC Navigation DC Search DC", "normalized_heading": "FORAGING DC NAVIGATION DC SEARCH DC", "page_end": 42, "page_start": 42, "revision_id": "revision-4c0e493f88dc4a1d523f", "section_id": "section-e533dcbaa9aee5e61655", "source_id": "source-2b38fffec79555019571", "source_title": "Dungeon Master's Guide"}, {"disposition": "STRUCTURED_RULE_CANDIDATE", "heading": "SUFFOCATION [HAZARD]", "normalized_heading": "SUFFOCATION HAZARD", "page_end": 375, "page_start": 375, "revision_id": "revision-e8c808a476318c7b2fff", "section_id": "section-ea2212ba492b1873d356", "source_id": "source-10c684705ead6e0b898e", "source_title": "Player's Handbook"}, {"disposition": "STRUCTURED_RULE_CANDIDATE", "heading": "OBJECT ARMOR CLASS", "normalized_heading": "OBJECT ARMOR CLASS", "page_end": 361, "page_start": 361, "revision_id": "revision-e8c808a476318c7b2fff", "section_id": "section-ebe4a11ec4f8f3666d98", "source_id": "source-10c684705ead6e0b898e", "source_title": "Player's Handbook"}, {"disposition": "REVIEW_CONTEXT", "heading": "BREAKING OBJECTS", "normalized_heading": "BREAKING OBJECTS", "page_end": 19, "page_start": 19, "revision_id": "revision-e8c808a476318c7b2fff", "section_id": "section-ec6b4d23e5fa5a9f98c9", "source_id": "source-10c684705ead6e0b898e", "source_title": "Player's Handbook"}, {"disposition": "STRUCTURED_RULE_CANDIDATE", "heading": "EXAMPLE HAZARDS", "normalized_heading": "EXAMPLE HAZARDS", "page_end": 80, "page_start": 80, "revision_id": "revision-4c0e493f88dc4a1d523f", "section_id": "section-f1431280f1bbe56243ca", "source_id": "source-2b38fffec79555019571", "source_title": "Dungeon Master's Guide"}, {"disposition": "STRUCTURED_RULE_CANDIDATE", "heading": "BURN I NG [HAZARD]", "normalized_heading": "BURN I NG HAZARD", "page_end": 361, "page_start": 361, "revision_id": "revision-e8c808a476318c7b2fff", "section_id": "section-f2e6009ab9387d4a4f6c", "source_id": "source-10c684705ead6e0b898e", "source_title": "Player's Handbook"}, {"disposition": "STRUCTURED_RULE_CANDIDATE", "heading": "UNDERWATER ENCOUNTER DISTANCE", "normalized_heading": "UNDERWATER ENCOUNTER DISTANCE", "page_end": 40, "page_start": 40, "revision_id": "revision-4c0e493f88dc4a1d523f", "section_id": "section-f4a8684bba0596504ef1", "source_id": "source-2b38fffec79555019571", "source_title": "Dungeon Master's Guide"}, {"disposition": "STRUCTURED_RULE_CANDIDATE", "heading": "RUNNING THE CHASE", "normalized_heading": "RUNNING THE CHASE", "page_end": 56, "page_start": 56, "revision_id": "revision-4c0e493f88dc4a1d523f", "section_id": "section-f6a9902e2c8d366ae4b1", "source_id": "source-2b38fffec79555019571", "source_title": "Dungeon Master's Guide"}, {"disposition": "STRUCTURED_RULE_CANDIDATE", "heading": "SWIMMING", "normalized_heading": "SWIMMING", "page_end": 375, "page_start": 375, "revision_id": "revision-e8c808a476318c7b2fff", "section_id": "section-f906fff259a79fb509dc", "source_id": "source-10c684705ead6e0b898e", "source_title": "Player's Handbook"}, {"disposition": "STRUCTURED_RULE_CANDIDATE", "heading": "ENDING A CHASE", "normalized_heading": "ENDING A CHASE", "page_end": 57, "page_start": 57, "revision_id": "revision-4c0e493f88dc4a1d523f", "section_id": "section-fb54091ef8cca4be8140", "source_id": "source-2b38fffec79555019571", "source_title": "Dungeon Master's Guide"}, {"disposition": "REVIEW_CONTEXT", "heading": "INTERACTING WITH OBJECTS", "normalized_heading": "INTERACTING WITH OBJECTS", "page_end": 18, "page_start": 18, "revision_id": "revision-e8c808a476318c7b2fff", "section_id": "section-fb9bcb5accde1efdd282", "source_id": "source-10c684705ead6e0b898e", "source_title": "Player's Handbook"}]""")
LINK_MANIFEST = json.loads(r"""[{"disposition": "STRUCTURED_RULE_CANDIDATE", "family": "rests_survival", "section_id": "section-02563c8bf0f2bf8503ac"}, {"disposition": "STRUCTURED_RULE_CANDIDATE", "family": "movement_environment", "section_id": "section-04a7e6567a913e51d17c"}, {"disposition": "REVIEW_CONTEXT", "family": "objects", "section_id": "section-063918988da5011258d7"}, {"disposition": "STRUCTURED_RULE_CANDIDATE", "family": "movement_environment", "section_id": "section-0993721bc99cd5b3dbfe"}, {"disposition": "STRUCTURED_RULE_CANDIDATE", "family": "exploration_core", "section_id": "section-127c94c77fe26033adb8"}, {"disposition": "REVIEW_CONTEXT", "family": "downtime_training", "section_id": "section-14f56350abab96acde32"}, {"disposition": "STRUCTURED_RULE_CANDIDATE", "family": "mounts_vehicles", "section_id": "section-1871550c024642346dc4"}, {"disposition": "STRUCTURED_RULE_CANDIDATE", "family": "objects", "section_id": "section-1936d78c2873028016db"}, {"disposition": "STRUCTURED_RULE_CANDIDATE", "family": "objects", "section_id": "section-195a32afee2cafdcae56"}, {"disposition": "STRUCTURED_RULE_CANDIDATE", "family": "chases", "section_id": "section-1ad497635af1670f3eb7"}, {"disposition": "STRUCTURED_RULE_CANDIDATE", "family": "objects", "section_id": "section-1c1488c1b660b1acf1f7"}, {"disposition": "STRUCTURED_RULE_CANDIDATE", "family": "mounts_vehicles", "section_id": "section-1f001a390810bda406dc"}, {"disposition": "STRUCTURED_RULE_CANDIDATE", "family": "rests_survival", "section_id": "section-21052f7e1f9f615a5dda"}, {"disposition": "STRUCTURED_RULE_CANDIDATE", "family": "chases", "section_id": "section-257ae7db566c22bf85f6"}, {"disposition": "REVIEW_CONTEXT", "family": "objects", "section_id": "section-27d717f65b34acfbbecd"}, {"disposition": "REVIEW_CONTEXT", "family": "exploration_encounters", "section_id": "section-28430d2c8ddcb19f4eef"}, {"disposition": "STRUCTURED_RULE_CANDIDATE", "family": "objects", "section_id": "section-3089ab6ab1461f5d2f1c"}, {"disposition": "STRUCTURED_RULE_CANDIDATE", "family": "exploration_core", "section_id": "section-393f2a328d3fbafbf7d2"}, {"disposition": "STRUCTURED_RULE_CANDIDATE", "family": "mounts", "section_id": "section-3aec2603331079fe64bf"}, {"disposition": "STRUCTURED_RULE_CANDIDATE", "family": "movement_environment", "section_id": "section-3d7869d410f4e79873c5"}, {"disposition": "STRUCTURED_RULE_CANDIDATE", "family": "rests_survival", "section_id": "section-3d7869d410f4e79873c5"}, {"disposition": "STRUCTURED_RULE_CANDIDATE", "family": "objects", "section_id": "section-40a29c51e1447b4474ca"}, {"disposition": "STRUCTURED_RULE_CANDIDATE", "family": "movement_environment", "section_id": "section-412fa7c05aeb11849da8"}, {"disposition": "STRUCTURED_RULE_CANDIDATE", "family": "rests_survival", "section_id": "section-412fa7c05aeb11849da8"}, {"disposition": "STRUCTURED_RULE_CANDIDATE", "family": "rests_survival", "section_id": "section-41899f05db5b94a5745d"}, {"disposition": "STRUCTURED_RULE_CANDIDATE", "family": "siege", "section_id": "section-459a3717b779aa98f21a"}, {"disposition": "STRUCTURED_RULE_CANDIDATE", "family": "mounts_vehicles", "section_id": "section-46feed1fd017e0fe50b3"}, {"disposition": "STRUCTURED_RULE_CANDIDATE", "family": "exploration_core", "section_id": "section-472d9b5f2d5ed0d85b89"}, {"disposition": "STRUCTURED_RULE_CANDIDATE", "family": "movement_environment", "section_id": "section-549569c07337a9543920"}, {"disposition": "STRUCTURED_RULE_CANDIDATE", "family": "rests_survival", "section_id": "section-549569c07337a9543920"}, {"disposition": "STRUCTURED_RULE_CANDIDATE", "family": "chases", "section_id": "section-57a8dc8ac7e9f05855e5"}, {"disposition": "STRUCTURED_RULE_CANDIDATE", "family": "chases", "section_id": "section-57f6333a867c247543fc"}, {"disposition": "STRUCTURED_RULE_CANDIDATE", "family": "traps", "section_id": "section-580b04552eb7dd8d13c0"}, {"disposition": "STRUCTURED_RULE_CANDIDATE", "family": "exploration_core", "section_id": "section-5e5ae21dcfd085f8c2ae"}, {"disposition": "STRUCTURED_RULE_CANDIDATE", "family": "mounts_vehicles", "section_id": "section-61f6f62b8728cce77809"}, {"disposition": "STRUCTURED_RULE_CANDIDATE", "family": "traps", "section_id": "section-662d96b58301e9cb4cd7"}, {"disposition": "STRUCTURED_RULE_CANDIDATE", "family": "chases", "section_id": "section-6e5949e2738b56465baa"}, {"disposition": "STRUCTURED_RULE_CANDIDATE", "family": "movement_environment", "section_id": "section-78ec22e53eef2a05456a"}, {"disposition": "REVIEW_CONTEXT", "family": "objects", "section_id": "section-794489b88bf959844ce9"}, {"disposition": "STRUCTURED_RULE_CANDIDATE", "family": "mounts", "section_id": "section-7b093022f10e3224ca23"}, {"disposition": "STRUCTURED_RULE_CANDIDATE", "family": "mounts", "section_id": "section-8a4e472c2d66ef2cfe88"}, {"disposition": "REVIEW_CONTEXT", "family": "downtime_training", "section_id": "section-8b88be75461a5d44a837"}, {"disposition": "STRUCTURED_RULE_CANDIDATE", "family": "traps", "section_id": "section-8f4d2f0beb277e2ad762"}, {"disposition": "STRUCTURED_RULE_CANDIDATE", "family": "movement_environment", "section_id": "section-9249652fb6c073d6fe84"}, {"disposition": "STRUCTURED_RULE_CANDIDATE", "family": "rests_survival", "section_id": "section-9249652fb6c073d6fe84"}, {"disposition": "STRUCTURED_RULE_CANDIDATE", "family": "crafting", "section_id": "section-97b6e3397e19f681ef0b"}, {"disposition": "STRUCTURED_RULE_CANDIDATE", "family": "exploration_core", "section_id": "section-97e1ae67fefb09fe1409"}, {"disposition": "STRUCTURED_RULE_CANDIDATE", "family": "traps", "section_id": "section-97ed2547a6d79f63f4a0"}, {"disposition": "STRUCTURED_RULE_CANDIDATE", "family": "mounts_vehicles", "section_id": "section-a47d167c26ddf6bfdeca"}, {"disposition": "REVIEW_CONTEXT", "family": "crafting", "section_id": "section-ab8908b8fe71d7c6ee46"}, {"disposition": "STRUCTURED_RULE_CANDIDATE", "family": "traps", "section_id": "section-adc1a76d4987084319ee"}, {"disposition": "REVIEW_CONTEXT", "family": "downtime_training", "section_id": "section-b30ae77cfe542b7edccf"}, {"disposition": "STRUCTURED_RULE_CANDIDATE", "family": "chases", "section_id": "section-b4a39292f3fcf78c7e11"}, {"disposition": "STRUCTURED_RULE_CANDIDATE", "family": "mounts_vehicles", "section_id": "section-b4cad2f2ec25de40f871"}, {"disposition": "STRUCTURED_RULE_CANDIDATE", "family": "movement_environment", "section_id": "section-c001f16d32b9f5224095"}, {"disposition": "STRUCTURED_RULE_CANDIDATE", "family": "rests_survival", "section_id": "section-c001f16d32b9f5224095"}, {"disposition": "STRUCTURED_RULE_CANDIDATE", "family": "exploration_core", "section_id": "section-c010858faa63341faa34"}, {"disposition": "STRUCTURED_RULE_CANDIDATE", "family": "exploration_core", "section_id": "section-c4c728f8f61c948e3281"}, {"disposition": "STRUCTURED_RULE_CANDIDATE", "family": "exploration_core", "section_id": "section-c8cd4e678452955dc424"}, {"disposition": "STRUCTURED_RULE_CANDIDATE", "family": "exploration_core", "section_id": "section-cdd8bff610c74a4f232d"}, {"disposition": "STRUCTURED_RULE_CANDIDATE", "family": "downtime_recovery", "section_id": "section-ce8b704bf99b4a6116c8"}, {"disposition": "STRUCTURED_RULE_CANDIDATE", "family": "rests_survival", "section_id": "section-ce8b704bf99b4a6116c8"}, {"disposition": "STRUCTURED_RULE_CANDIDATE", "family": "exploration_core", "section_id": "section-d4cf68e532c72da2fbe8"}, {"disposition": "STRUCTURED_RULE_CANDIDATE", "family": "traps", "section_id": "section-d72fb436f2f8888e6092"}, {"disposition": "STRUCTURED_RULE_CANDIDATE", "family": "movement_environment", "section_id": "section-d966b66e4eaaa808d146"}, {"disposition": "STRUCTURED_RULE_CANDIDATE", "family": "exploration_core", "section_id": "section-e533dcbaa9aee5e61655"}, {"disposition": "STRUCTURED_RULE_CANDIDATE", "family": "movement_environment", "section_id": "section-ea2212ba492b1873d356"}, {"disposition": "STRUCTURED_RULE_CANDIDATE", "family": "rests_survival", "section_id": "section-ea2212ba492b1873d356"}, {"disposition": "STRUCTURED_RULE_CANDIDATE", "family": "objects", "section_id": "section-ebe4a11ec4f8f3666d98"}, {"disposition": "REVIEW_CONTEXT", "family": "objects", "section_id": "section-ec6b4d23e5fa5a9f98c9"}, {"disposition": "STRUCTURED_RULE_CANDIDATE", "family": "movement_environment", "section_id": "section-f1431280f1bbe56243ca"}, {"disposition": "STRUCTURED_RULE_CANDIDATE", "family": "movement_environment", "section_id": "section-f2e6009ab9387d4a4f6c"}, {"disposition": "STRUCTURED_RULE_CANDIDATE", "family": "movement_environment", "section_id": "section-f4a8684bba0596504ef1"}, {"disposition": "STRUCTURED_RULE_CANDIDATE", "family": "chases", "section_id": "section-f6a9902e2c8d366ae4b1"}, {"disposition": "STRUCTURED_RULE_CANDIDATE", "family": "movement_environment", "section_id": "section-f906fff259a79fb509dc"}, {"disposition": "STRUCTURED_RULE_CANDIDATE", "family": "chases", "section_id": "section-fb54091ef8cca4be8140"}, {"disposition": "REVIEW_CONTEXT", "family": "objects", "section_id": "section-fb9bcb5accde1efdd282"}]""")
EXPECTED_FAMILY_COUNTS = json.loads(r"""{"chases": 8, "crafting": 1, "downtime_recovery": 1, "exploration_core": 11, "mounts": 3, "mounts_vehicles": 6, "movement_environment": 14, "objects": 6, "rests_survival": 10, "siege": 1, "traps": 6}""")

EXPECTED = {
    "registered_sources": 14,
    "all_current_2024_phb_dmg_sections": 5616,
    "registry_rows": 70,
    "structured_sections": 60,
    "review_sections": 10,
    "family_links": 77,
    "structured_links": 67,
    "review_links": 10,
    "backlog_rows": 67,
}

SOURCE_TABLES = ["sources","source_revisions","sections","entity_versions"]

def now_iso():
    return datetime.now(timezone.utc).isoformat()

def cjson(v):
    return json.dumps(v, ensure_ascii=False, sort_keys=True, separators=(",", ":"))

def norm_heading(text):
    value = str(text or "").upper()
    value = re.sub(r"[^A-Z0-9]+", " ", value)
    return re.sub(r"\s+", " ", value).strip()

def logical_digest(db, table):
    cols = [r[1] for r in db.execute(f'PRAGMA table_info("{table}")')]
    if not cols:
        raise RuntimeError(f"Missing source table for digest: {table}")
    select_cols = ", ".join(f'"{c}"' for c in cols)
    h = hashlib.sha256()
    for row in db.execute(f'SELECT {select_cols} FROM "{table}" ORDER BY rowid'):
        h.update(cjson(list(row)).encode("utf-8"))
        h.update(b"\n")
    return h.hexdigest()

def phase7_dependency():
    if not MONSTERS_DB.exists():
        raise RuntimeError("Phase 7 dependency DB missing.")
    db = sqlite3.connect(f"file:{MONSTERS_DB.as_posix()}?mode=ro", uri=True)
    try:
        backlog = db.execute("SELECT COUNT(*) FROM phase7_monster_automation_backlog").fetchone()[0]
        v10 = db.execute("SELECT COUNT(*) FROM phase7_v10_resolution_log").fetchone()[0]
        q = db.execute("SELECT COUNT(*) FROM phase7_monster_quarantine").fetchone()[0]
        batch = db.execute("""
            SELECT phase_status,package_version,backlog_after
            FROM phase7_v10_batches ORDER BY created_at DESC LIMIT 1
        """).fetchone()
        if not (
            backlog == 0 and v10 == 1454 and q == 742 and batch
            and batch[0] == "FINAL_RESIDUALS_CLASSIFIED_READY_FOR_PHASE7_CLOSURE"
            and batch[1] == "V10_FIXED" and batch[2] == 0
        ):
            raise RuntimeError("Phase 7 closure dependency failed.")
    finally:
        db.close()

def preconditions(db):
    integrity = db.execute("PRAGMA integrity_check").fetchone()[0]
    fk = db.execute("PRAGMA foreign_key_check").fetchall()
    if integrity != "ok":
        raise RuntimeError(f"rules_knowledge integrity={integrity}")
    if fk:
        raise RuntimeError(f"rules_knowledge foreign_keys={len(fk)}")

    tables = {r[0] for r in db.execute("SELECT name FROM sqlite_master WHERE type='table'")}
    required = set(SOURCE_TABLES)
    missing = sorted(required - tables)
    if missing:
        raise RuntimeError(f"Missing canonical tables: {missing}")

    phase8_tables = {
        "phase8_rule_registry","phase8_rule_family_links",
        "phase8_automation_backlog","phase8_baseline_batches"
    }
    existing = sorted(phase8_tables & tables)
    if existing:
        raise RuntimeError(f"Phase 8 V4 already appears applied; existing={existing}")

    sources = db.execute("SELECT COUNT(*) FROM sources").fetchone()[0]
    if sources != EXPECTED["registered_sources"]:
        raise RuntimeError(f"Source registry drift expected=14 actual={sources}")

    current_core = db.execute("""
        SELECT COUNT(*)
        FROM sections s
        JOIN sources src ON src.current_revision_id=s.revision_id
        WHERE src.rules_version='2024'
          AND src.title IN ('Player''s Handbook','Dungeon Master''s Guide')
    """).fetchone()[0]
    if current_core != EXPECTED["all_current_2024_phb_dmg_sections"]:
        raise RuntimeError(
            f"Current PHB/DMG section drift expected=5616 actual={current_core}"
        )

    # Verify every exact V3 curated section against the live canonical source.
    for item in SECTION_MANIFEST:
        row = db.execute("""
            SELECT s.revision_id,src.id,src.title,s.page_start,s.page_end,s.heading
            FROM sections s
            JOIN sources src ON src.id=?
            WHERE s.id=? AND s.revision_id=? AND src.current_revision_id=s.revision_id
        """, (item["source_id"], item["section_id"], item["revision_id"])).fetchone()
        if not row:
            raise RuntimeError(f"Missing/current-revision drift for section {item['section_id']}")
        actual = {
            "revision_id": row[0],
            "source_id": row[1],
            "source_title": row[2],
            "page_start": row[3],
            "page_end": row[4],
            "normalized_heading": norm_heading(row[5]),
        }
        expected = {
            "revision_id": item["revision_id"],
            "source_id": item["source_id"],
            "source_title": item["source_title"],
            "page_start": item["page_start"],
            "page_end": item["page_end"],
            "normalized_heading": item["normalized_heading"],
        }
        if actual != expected:
            raise RuntimeError(
                "Exact V3 evidence drift for "
                + item["section_id"] + ": "
                + cjson({"expected": expected, "actual": actual})
            )

def section_digest(db, section_id):
    row = db.execute("""
        SELECT s.id,s.revision_id,s.heading,s.body,s.page_start,s.page_end,
               src.id,src.title,src.rules_version,src.current_revision_id
        FROM sections s
        JOIN sources src ON src.current_revision_id=s.revision_id
        WHERE s.id=?
    """, (section_id,)).fetchone()
    if not row:
        raise RuntimeError(f"Missing section for digest: {section_id}")
    return hashlib.sha256(cjson(list(row)).encode("utf-8")).hexdigest()

def apply(db, output):
    phase7_dependency()
    preconditions(db)

    source_before = {t: logical_digest(db,t) for t in SOURCE_TABLES}

    db.executescript("""
    CREATE TABLE phase8_rule_registry (
        section_id TEXT PRIMARY KEY,
        revision_id TEXT NOT NULL,
        source_id TEXT NOT NULL,
        source_title TEXT NOT NULL,
        page_start INTEGER,
        page_end INTEGER,
        heading TEXT NOT NULL,
        normalized_heading TEXT NOT NULL,
        disposition TEXT NOT NULL CHECK(disposition IN ('STRUCTURED_RULE_CANDIDATE','REVIEW_CONTEXT')),
        rules_version TEXT NOT NULL,
        source_section_digest TEXT NOT NULL,
        created_at TEXT NOT NULL,
        FOREIGN KEY(section_id) REFERENCES sections(id),
        FOREIGN KEY(revision_id) REFERENCES source_revisions(id),
        FOREIGN KEY(source_id) REFERENCES sources(id)
    );

    CREATE TABLE phase8_rule_family_links (
        section_id TEXT NOT NULL,
        family TEXT NOT NULL,
        disposition TEXT NOT NULL CHECK(disposition IN ('STRUCTURED_RULE_CANDIDATE','REVIEW_CONTEXT')),
        created_at TEXT NOT NULL,
        PRIMARY KEY(section_id,family),
        FOREIGN KEY(section_id) REFERENCES phase8_rule_registry(section_id)
    );

    CREATE TABLE phase8_automation_backlog (
        section_id TEXT NOT NULL,
        family TEXT NOT NULL,
        gap_type TEXT NOT NULL,
        status TEXT NOT NULL,
        evidence_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        PRIMARY KEY(section_id,family,gap_type),
        FOREIGN KEY(section_id,family) REFERENCES phase8_rule_family_links(section_id,family)
    );

    CREATE TABLE phase8_baseline_batches (
        id TEXT PRIMARY KEY,
        created_at TEXT NOT NULL,
        registry_rows INTEGER NOT NULL,
        structured_sections INTEGER NOT NULL,
        review_sections INTEGER NOT NULL,
        family_links INTEGER NOT NULL,
        structured_links INTEGER NOT NULL,
        review_links INTEGER NOT NULL,
        backlog_rows INTEGER NOT NULL,
        sources_digest TEXT NOT NULL,
        source_revisions_digest TEXT NOT NULL,
        sections_digest TEXT NOT NULL,
        entity_versions_digest TEXT NOT NULL,
        phase_status TEXT NOT NULL,
        package_version TEXT NOT NULL
    );
    """)

    for item in SECTION_MANIFEST:
        db.execute("""
            INSERT INTO phase8_rule_registry
            (section_id,revision_id,source_id,source_title,page_start,page_end,
             heading,normalized_heading,disposition,rules_version,
             source_section_digest,created_at)
            VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
        """, (
            item["section_id"],item["revision_id"],item["source_id"],item["source_title"],
            item["page_start"],item["page_end"],item["heading"],item["normalized_heading"],
            item["disposition"],"2024",section_digest(db,item["section_id"]),now_iso()
        ))

    for link in LINK_MANIFEST:
        db.execute("""
            INSERT INTO phase8_rule_family_links
            (section_id,family,disposition,created_at)
            VALUES (?,?,?,?)
        """, (
            link["section_id"],link["family"],link["disposition"],now_iso()
        ))
        if link["disposition"] == "STRUCTURED_RULE_CANDIDATE":
            row = next(x for x in SECTION_MANIFEST if x["section_id"] == link["section_id"])
            evidence = {
                "source_title": row["source_title"],
                "page_start": row["page_start"],
                "page_end": row["page_end"],
                "heading": row["heading"],
                "normalized_heading": row["normalized_heading"],
                "family": link["family"],
                "v3_disposition": link["disposition"],
            }
            db.execute("""
                INSERT INTO phase8_automation_backlog
                (section_id,family,gap_type,status,evidence_json,created_at)
                VALUES (?,?,?,?,?,?)
            """, (
                link["section_id"],link["family"],
                "semantic_extraction","PENDING_SEMANTIC_EXTRACTION",
                cjson(evidence),now_iso()
            ))

    counts = {
        "registry_rows": db.execute("SELECT COUNT(*) FROM phase8_rule_registry").fetchone()[0],
        "structured_sections": db.execute(
            "SELECT COUNT(*) FROM phase8_rule_registry WHERE disposition='STRUCTURED_RULE_CANDIDATE'"
        ).fetchone()[0],
        "review_sections": db.execute(
            "SELECT COUNT(*) FROM phase8_rule_registry WHERE disposition='REVIEW_CONTEXT'"
        ).fetchone()[0],
        "family_links": db.execute("SELECT COUNT(*) FROM phase8_rule_family_links").fetchone()[0],
        "structured_links": db.execute(
            "SELECT COUNT(*) FROM phase8_rule_family_links WHERE disposition='STRUCTURED_RULE_CANDIDATE'"
        ).fetchone()[0],
        "review_links": db.execute(
            "SELECT COUNT(*) FROM phase8_rule_family_links WHERE disposition='REVIEW_CONTEXT'"
        ).fetchone()[0],
        "backlog_rows": db.execute("SELECT COUNT(*) FROM phase8_automation_backlog").fetchone()[0],
    }
    for k,v in counts.items():
        if v != EXPECTED[k]:
            raise RuntimeError(f"V4 count mismatch {k} expected={EXPECTED[k]} actual={v}")

    actual_family = {
        r[0]: r[1] for r in db.execute("""
            SELECT family,COUNT(*) FROM phase8_rule_family_links
            WHERE disposition='STRUCTURED_RULE_CANDIDATE'
            GROUP BY family
        """)
    }
    if actual_family != EXPECTED_FAMILY_COUNTS:
        raise RuntimeError(
            "Structured family-count drift expected="
            + cjson(EXPECTED_FAMILY_COUNTS) + " actual=" + cjson(actual_family)
        )

    source_after = {t: logical_digest(db,t) for t in SOURCE_TABLES}
    if source_before != source_after:
        raise RuntimeError("Canonical source tables changed during V4.")

    batch_id = "phase8-v4-" + datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    db.execute("""
        INSERT INTO phase8_baseline_batches
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    """, (
        batch_id,now_iso(),
        counts["registry_rows"],counts["structured_sections"],counts["review_sections"],
        counts["family_links"],counts["structured_links"],counts["review_links"],
        counts["backlog_rows"],
        source_after["sources"],source_after["source_revisions"],
        source_after["sections"],source_after["entity_versions"],
        "STRUCTURED_BASELINE_APPLIED_PHASE8_OPEN","V4"
    ))

    fk = db.execute("PRAGMA foreign_key_check").fetchall()
    if fk:
        raise RuntimeError(f"V4 introduced foreign-key errors={len(fk)}")

    output.mkdir(parents=True, exist_ok=True)
    report = {
        "package":"PHASE8_STRUCTURED_BASELINE_V4",
        "readOnly":False,
        "registryRows":counts["registry_rows"],
        "structuredSections":counts["structured_sections"],
        "reviewSections":counts["review_sections"],
        "familyLinks":counts["family_links"],
        "structuredLinks":counts["structured_links"],
        "reviewLinks":counts["review_links"],
        "automationBacklog":counts["backlog_rows"],
        "structuredFamilyCounts":actual_family,
        "sourceTablesUnchanged":True,
        "phaseStatus":"STRUCTURED_BASELINE_APPLIED_PHASE8_OPEN",
        "next":"PHASE8_FAMILY_SEMANTICS_AUDIT_V5",
    }
    (output/"phase8_structured_baseline_v4_report.json").write_text(
        json.dumps(report,ensure_ascii=False,indent=2),encoding="utf-8"
    )
    (output/"PHASE8_STRUCTURED_BASELINE_V4_SUMMARY.md").write_text(
        "# Phase 8 Structured Baseline V4\n\n"
        f"- Registry rows: {counts['registry_rows']}\n"
        f"- Structured sections: {counts['structured_sections']}\n"
        f"- Review-context sections: {counts['review_sections']}\n"
        f"- Family links: {counts['family_links']}\n"
        f"- Structured family links: {counts['structured_links']}\n"
        f"- Review links: {counts['review_links']}\n"
        f"- Active semantic-extraction backlog: {counts['backlog_rows']}\n\n"
        "No Phase 8 rule semantics were invented by V4. The backlog explicitly marks "
        "the exact V3 source-family links that still require evidence-bounded semantic extraction.\n\n"
        "**Status: STRUCTURED_BASELINE_APPLIED_PHASE8_OPEN**\n",
        encoding="utf-8"
    )
    return report

def main():
    ap=argparse.ArgumentParser()
    ap.add_argument("--db",default=str(RULES_DB))
    ap.add_argument("--output",default=str(DEFAULT_OUTPUT))
    ap.add_argument("--apply",action="store_true")
    args=ap.parse_args()
    db=sqlite3.connect(args.db,timeout=10)
    db.execute("PRAGMA foreign_keys=ON")
    try:
        phase7_dependency()
        preconditions(db)
        if not args.apply:
            print("PHASE8_V4_PRECHECK=PASS")
            return 0
        db.execute("BEGIN IMMEDIATE")
        try:
            report=apply(db,Path(args.output))
            db.commit()
        except Exception:
            db.rollback()
            raise
        integrity=db.execute("PRAGMA integrity_check").fetchone()[0]
        fk=db.execute("PRAGMA foreign_key_check").fetchall()
        if integrity!="ok" or fk:
            raise RuntimeError(f"Post-V4 DB check failed integrity={integrity} fk={len(fk)}")
        print("PHASE 8 STRUCTURED BASELINE V4 APPLIED")
        print(f"REGISTRY_ROWS={report['registryRows']}")
        print(f"STRUCTURED_SECTIONS={report['structuredSections']}")
        print(f"REVIEW_SECTIONS={report['reviewSections']}")
        print(f"FAMILY_LINKS={report['familyLinks']}")
        print(f"STRUCTURED_LINKS={report['structuredLinks']}")
        print(f"REVIEW_LINKS={report['reviewLinks']}")
        print(f"AUTOMATION_BACKLOG={report['automationBacklog']}")
        print("SOURCE_TABLES_UNCHANGED=YES")
        print("INTEGRITY=ok")
        print("FOREIGN_KEYS=0")
        print("PHASE_STATUS=STRUCTURED_BASELINE_APPLIED_PHASE8_OPEN")
        print("NEXT=PHASE8_FAMILY_SEMANTICS_AUDIT_V5")
        print(f"OUTPUT={args.output}")
        return 0
    finally:
        db.close()

if __name__=="__main__":
    raise SystemExit(main())
