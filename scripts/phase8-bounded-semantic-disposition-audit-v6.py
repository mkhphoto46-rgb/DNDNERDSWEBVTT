from __future__ import annotations
import argparse,csv,hashlib,json,re,sqlite3
from collections import Counter,defaultdict
from datetime import datetime,timezone
from pathlib import Path

PROJECT_ROOT=Path(r"F:\DND WEB VTT")
RULES_DB=PROJECT_ROOT/"data"/"compendium"/"rules_knowledge.sqlite"
MONSTERS_DB=PROJECT_ROOT/"data"/"compendium"/"monsters.sqlite"
DEFAULT_OUTPUT=PROJECT_ROOT/"_phase8_bounded_semantic_disposition_audit_v6"

MANIFEST=json.loads(r"""[{"disposition": "REFERENCE_CONTEXT_ONLY", "expected_v5_evidence_class": "PROCEDURAL_EVIDENCE_ONLY", "family": "chases", "heading": "MAPPING THE CHASE", "page_start": 57, "reason": "GUIDANCE_OR_CONTEXT_NOT_STANDALONE_AUTOMATION", "section_id": "section-1ad497635af1670f3eb7", "semantic_key": "", "source_title": "Dungeon Master's Guide"}, {"disposition": "REFERENCE_CONTEXT_ONLY", "expected_v5_evidence_class": "NARRATIVE_OR_TABLE_CONTEXT_ONLY", "family": "chases", "heading": "DESIGNING YOUR OWN CHASE TABLES", "page_start": 57, "reason": "GUIDANCE_OR_CONTEXT_NOT_STANDALONE_AUTOMATION", "section_id": "section-257ae7db566c22bf85f6", "semantic_key": "", "source_title": "Dungeon Master's Guide"}, {"disposition": "REFERENCE_CONTEXT_ONLY", "expected_v5_evidence_class": "MECHANICAL_EVIDENCE_ONLY", "family": "chases", "heading": "CHASES", "page_start": 56, "reason": "GUIDANCE_OR_CONTEXT_NOT_STANDALONE_AUTOMATION", "section_id": "section-57a8dc8ac7e9f05855e5", "semantic_key": "", "source_title": "Dungeon Master's Guide"}, {"disposition": "STRICT_SEMANTIC_CANDIDATE", "expected_v5_evidence_class": "NUMERIC_PLUS_PROCEDURAL_EVIDENCE", "family": "chases", "heading": "CHASE COMPLICATIONS", "page_start": 57, "reason": "SOURCE_TEXT_SUPPORTS_BOUNDED_DETERMINISTIC_PROFILE", "section_id": "section-57f6333a867c247543fc", "semantic_key": "chase.complication_roll", "source_title": "Dungeon Master's Guide"}, {"disposition": "STRICT_SEMANTIC_CANDIDATE", "expected_v5_evidence_class": "MECHANICAL_PLUS_PROCEDURAL_EVIDENCE", "family": "chases", "heading": "BEGINNING A CHASE", "page_start": 56, "reason": "SOURCE_TEXT_SUPPORTS_BOUNDED_DETERMINISTIC_PROFILE", "section_id": "section-6e5949e2738b56465baa", "semantic_key": "chase.begin", "source_title": "Dungeon Master's Guide"}, {"disposition": "QUARANTINE_REVIEW_REQUIRED", "expected_v5_evidence_class": "NUMERIC_PLUS_MECHANICAL_EVIDENCE", "family": "chases", "heading": "URBAN CHASE COMPLICATIONS", "page_start": 58, "reason": "TABLE_OR_OCR_DEPENDENT", "section_id": "section-b4a39292f3fcf78c7e11", "semantic_key": "", "source_title": "Dungeon Master's Guide"}, {"disposition": "REFERENCE_CONTEXT_ONLY", "expected_v5_evidence_class": "NARRATIVE_OR_TABLE_CONTEXT_ONLY", "family": "chases", "heading": "RUNNING THE CHASE", "page_start": 56, "reason": "GUIDANCE_OR_CONTEXT_NOT_STANDALONE_AUTOMATION", "section_id": "section-f6a9902e2c8d366ae4b1", "semantic_key": "", "source_title": "Dungeon Master's Guide"}, {"disposition": "QUARANTINE_REVIEW_REQUIRED", "expected_v5_evidence_class": "PROCEDURAL_EVIDENCE_ONLY", "family": "chases", "heading": "ENDING A CHASE", "page_start": 57, "reason": "TABLE_DEPENDENT_PROCEDURE", "section_id": "section-fb54091ef8cca4be8140", "semantic_key": "", "source_title": "Dungeon Master's Guide"}, {"disposition": "QUARANTINE_REVIEW_REQUIRED", "expected_v5_evidence_class": "NARRATIVE_OR_TABLE_CONTEXT_ONLY", "family": "crafting", "heading": "CRAFTING EQUIPMENT", "page_start": 232, "reason": "SECTION_CONTAINER_OR_SUBRULES_NOT_CAPTURED", "section_id": "section-97b6e3397e19f681ef0b", "semantic_key": "", "source_title": "Player's Handbook"}, {"disposition": "STRICT_SEMANTIC_CANDIDATE", "expected_v5_evidence_class": "NUMERIC_PLUS_MECHANICAL_EVIDENCE", "family": "downtime_recovery", "heading": "REST AND RECUPERATION", "page_start": 65, "reason": "SOURCE_TEXT_SUPPORTS_BOUNDED_DETERMINISTIC_PROFILE", "section_id": "section-ce8b704bf99b4a6116c8", "semantic_key": "recovery.recuperation", "source_title": "Dungeon Master's Guide"}, {"disposition": "STRICT_SEMANTIC_CANDIDATE", "expected_v5_evidence_class": "NUMERIC_PLUS_MECHANICAL_EVIDENCE", "family": "exploration_core", "heading": "TRAVEL PACE", "page_start": 42, "reason": "SOURCE_TEXT_SUPPORTS_BOUNDED_DETERMINISTIC_PROFILE", "section_id": "section-127c94c77fe26033adb8", "semantic_key": "travel.pace_extended", "source_title": "Dungeon Master's Guide"}, {"disposition": "QUARANTINE_REVIEW_REQUIRED", "expected_v5_evidence_class": "NUMERIC_EVIDENCE_ONLY", "family": "exploration_core", "heading": "WeatHER", "page_start": 42, "reason": "TABLE_OR_OCR_DEPENDENT", "section_id": "section-393f2a328d3fbafbf7d2", "semantic_key": "", "source_title": "Dungeon Master's Guide"}, {"disposition": "REFERENCE_CONTEXT_ONLY", "expected_v5_evidence_class": "MECHANICAL_PLUS_PROCEDURAL_EVIDENCE", "family": "exploration_core", "heading": "ABILITY CHECKS IN EXPLORATION", "page_start": 38, "reason": "GUIDANCE_OR_CONTEXT_NOT_STANDALONE_AUTOMATION", "section_id": "section-472d9b5f2d5ed0d85b89", "semantic_key": "", "source_title": "Dungeon Master's Guide"}, {"disposition": "REFERENCE_CONTEXT_ONLY", "expected_v5_evidence_class": "NARRATIVE_OR_TABLE_CONTEXT_ONLY", "family": "exploration_core", "heading": "TRAVEL", "page_start": 40, "reason": "GUIDANCE_OR_CONTEXT_NOT_STANDALONE_AUTOMATION", "section_id": "section-5e5ae21dcfd085f8c2ae", "semantic_key": "", "source_title": "Dungeon Master's Guide"}, {"disposition": "REFERENCE_CONTEXT_ONLY", "expected_v5_evidence_class": "NUMERIC_PLUS_MECHANICAL_EVIDENCE", "family": "exploration_core", "heading": "ACTIONS IN EXPLORATION", "page_start": 38, "reason": "GUIDANCE_OR_CONTEXT_NOT_STANDALONE_AUTOMATION", "section_id": "section-97e1ae67fefb09fe1409", "semantic_key": "", "source_title": "Dungeon Master's Guide"}, {"disposition": "QUARANTINE_REVIEW_REQUIRED", "expected_v5_evidence_class": "NUMERIC_PLUS_PROCEDURAL_EVIDENCE", "family": "exploration_core", "heading": "WEATHER", "page_start": 42, "reason": "TABLE_OR_OCR_DEPENDENT", "section_id": "section-c010858faa63341faa34", "semantic_key": "", "source_title": "Dungeon Master's Guide"}, {"disposition": "REFERENCE_CONTEXT_ONLY", "expected_v5_evidence_class": "NARRATIVE_OR_TABLE_CONTEXT_ONLY", "family": "exploration_core", "heading": "NARRATION DURING TRAVEL", "page_start": 43, "reason": "GUIDANCE_OR_CONTEXT_NOT_STANDALONE_AUTOMATION", "section_id": "section-c4c728f8f61c948e3281", "semantic_key": "", "source_title": "Dungeon Master's Guide"}, {"disposition": "QUARANTINE_REVIEW_REQUIRED", "expected_v5_evidence_class": "NARRATIVE_OR_TABLE_CONTEXT_ONLY", "family": "exploration_core", "heading": "Foraging", "page_start": 43, "reason": "TABLE_OR_OCR_DEPENDENT", "section_id": "section-c8cd4e678452955dc424", "semantic_key": "", "source_title": "Dungeon Master's Guide"}, {"disposition": "QUARANTINE_REVIEW_REQUIRED", "expected_v5_evidence_class": "NUMERIC_EVIDENCE_ONLY", "family": "exploration_core", "heading": "TRAVEL TERRAIN", "page_start": 42, "reason": "REQUIRES_CASE_SPECIFIC_REVIEW", "section_id": "section-cdd8bff610c74a4f232d", "semantic_key": "", "source_title": "Dungeon Master's Guide"}, {"disposition": "REFERENCE_CONTEXT_ONLY", "expected_v5_evidence_class": "NARRATIVE_OR_TABLE_CONTEXT_ONLY", "family": "exploration_core", "heading": "RUNNING EXPLORATION", "page_start": 37, "reason": "GUIDANCE_OR_CONTEXT_NOT_STANDALONE_AUTOMATION", "section_id": "section-d4cf68e532c72da2fbe8", "semantic_key": "", "source_title": "Dungeon Master's Guide"}, {"disposition": "QUARANTINE_REVIEW_REQUIRED", "expected_v5_evidence_class": "NARRATIVE_OR_TABLE_CONTEXT_ONLY", "family": "exploration_core", "heading": "Foraging DC Navigation DC Search DC", "page_start": 42, "reason": "REQUIRES_CASE_SPECIFIC_REVIEW", "section_id": "section-e533dcbaa9aee5e61655", "semantic_key": "", "source_title": "Dungeon Master's Guide"}, {"disposition": "STRICT_SEMANTIC_CANDIDATE", "expected_v5_evidence_class": "NUMERIC_PLUS_MECHANICAL_EVIDENCE", "family": "mounts", "heading": "MOUNTING AND DISMOUNTING", "page_start": 25, "reason": "SOURCE_TEXT_SUPPORTS_BOUNDED_DETERMINISTIC_PROFILE", "section_id": "section-3aec2603331079fe64bf", "semantic_key": "mount.mount_dismount", "source_title": "Player's Handbook"}, {"disposition": "REFERENCE_CONTEXT_ONLY", "expected_v5_evidence_class": "NARRATIVE_OR_TABLE_CONTEXT_ONLY", "family": "mounts", "heading": "MOUNTED COMBAT", "page_start": 25, "reason": "GUIDANCE_OR_CONTEXT_NOT_STANDALONE_AUTOMATION", "section_id": "section-7b093022f10e3224ca23", "semantic_key": "", "source_title": "Player's Handbook"}, {"disposition": "STRICT_SEMANTIC_CANDIDATE", "expected_v5_evidence_class": "MECHANICAL_PLUS_PROCEDURAL_EVIDENCE", "family": "mounts", "heading": "CONTROLLING A MOUNT", "page_start": 25, "reason": "SOURCE_TEXT_SUPPORTS_BOUNDED_DETERMINISTIC_PROFILE", "section_id": "section-8a4e472c2d66ef2cfe88", "semantic_key": "mount.control", "source_title": "Player's Handbook"}, {"disposition": "REFERENCE_CONTEXT_ONLY", "expected_v5_evidence_class": "NUMERIC_PLUS_PROCEDURAL_EVIDENCE", "family": "mounts_vehicles", "heading": "TACK, HARNESS, AND DRAWN VEHICLES", "page_start": 229, "reason": "REFERENCE_OR_CLOSED_PHASE_CONTENT", "section_id": "section-1871550c024642346dc4", "semantic_key": "", "source_title": "Player's Handbook"}, {"disposition": "QUARANTINE_REVIEW_REQUIRED", "expected_v5_evidence_class": "NUMERIC_PLUS_PROCEDURAL_EVIDENCE", "family": "mounts_vehicles", "heading": "AIRBORNE AND WATERBORNE VEHICLES", "page_start": 229, "reason": "TABLE_OR_OCR_DEPENDENT", "section_id": "section-1f001a390810bda406dc", "semantic_key": "", "source_title": "Player's Handbook"}, {"disposition": "QUARANTINE_REVIEW_REQUIRED", "expected_v5_evidence_class": "PROCEDURAL_EVIDENCE_ONLY", "family": "mounts_vehicles", "heading": "LARGE VEHICLES", "page_start": 229, "reason": "TABLE_OR_OCR_DEPENDENT", "section_id": "section-46feed1fd017e0fe50b3", "semantic_key": "", "source_title": "Player's Handbook"}, {"disposition": "REFERENCE_CONTEXT_ONLY", "expected_v5_evidence_class": "MECHANICAL_PLUS_PROCEDURAL_EVIDENCE", "family": "mounts_vehicles", "heading": "MOUNTS AND VEHICLES", "page_start": 228, "reason": "GUIDANCE_OR_CONTEXT_NOT_STANDALONE_AUTOMATION", "section_id": "section-61f6f62b8728cce77809", "semantic_key": "", "source_title": "Player's Handbook"}, {"disposition": "REFERENCE_CONTEXT_ONLY", "expected_v5_evidence_class": "NUMERIC_EVIDENCE_ONLY", "family": "mounts_vehicles", "heading": "MOUNTS AND OTHER ANIMALS", "page_start": 228, "reason": "REFERENCE_OR_CLOSED_PHASE_CONTENT", "section_id": "section-a47d167c26ddf6bfdeca", "semantic_key": "", "source_title": "Player's Handbook"}, {"disposition": "STRICT_SEMANTIC_CANDIDATE", "expected_v5_evidence_class": "NUMERIC_PLUS_PROCEDURAL_EVIDENCE", "family": "mounts_vehicles", "heading": "MOUNTS A N D CARGO", "page_start": 228, "reason": "SOURCE_TEXT_SUPPORTS_BOUNDED_DETERMINISTIC_PROFILE", "section_id": "section-b4cad2f2ec25de40f871", "semantic_key": "vehicle.cargo_capacity", "source_title": "Player's Handbook"}, {"disposition": "REFERENCE_CONTEXT_ONLY", "expected_v5_evidence_class": "PROCEDURAL_EVIDENCE_ONLY", "family": "movement_environment", "heading": "JUMPING", "page_start": 369, "reason": "REFERENCE_OR_CLOSED_PHASE_CONTENT", "section_id": "section-04a7e6567a913e51d17c", "semantic_key": "", "source_title": "Player's Handbook"}, {"disposition": "STRICT_SEMANTIC_CANDIDATE", "expected_v5_evidence_class": "NUMERIC_PLUS_MECHANICAL_EVIDENCE", "family": "movement_environment", "heading": "FALLING OFF", "page_start": 26, "reason": "SOURCE_TEXT_SUPPORTS_BOUNDED_DETERMINISTIC_PROFILE", "section_id": "section-0993721bc99cd5b3dbfe", "semantic_key": "mount.falling_off", "source_title": "Player's Handbook"}, {"disposition": "STRICT_SEMANTIC_CANDIDATE", "expected_v5_evidence_class": "NUMERIC_PLUS_MECHANICAL_EVIDENCE", "family": "movement_environment", "heading": "FRIGID WATER", "page_start": 72, "reason": "SOURCE_TEXT_SUPPORTS_BOUNDED_DETERMINISTIC_PROFILE", "section_id": "section-3d7869d410f4e79873c5", "semantic_key": "environment.frigid_water", "source_title": "Dungeon Master's Guide"}, {"disposition": "STRICT_SEMANTIC_CANDIDATE", "expected_v5_evidence_class": "NUMERIC_PLUS_MECHANICAL_EVIDENCE", "family": "movement_environment", "heading": "MAL N UTR ITION [HAZARD]", "page_start": 370, "reason": "SOURCE_TEXT_SUPPORTS_BOUNDED_DETERMINISTIC_PROFILE", "section_id": "section-412fa7c05aeb11849da8", "semantic_key": "hazard.malnutrition", "source_title": "Player's Handbook"}, {"disposition": "STRICT_SEMANTIC_CANDIDATE", "expected_v5_evidence_class": "NARRATIVE_OR_TABLE_CONTEXT_ONLY", "family": "movement_environment", "heading": "WATER NEEDS PER DAY", "page_start": 364, "reason": "SOURCE_TEXT_SUPPORTS_BOUNDED_DETERMINISTIC_PROFILE", "section_id": "section-549569c07337a9543920", "semantic_key": "survival.water_needs", "source_title": "Player's Handbook"}, {"disposition": "REFERENCE_CONTEXT_ONLY", "expected_v5_evidence_class": "NARRATIVE_OR_TABLE_CONTEXT_ONLY", "family": "movement_environment", "heading": "HAZARDS", "page_start": 80, "reason": "GUIDANCE_OR_CONTEXT_NOT_STANDALONE_AUTOMATION", "section_id": "section-78ec22e53eef2a05456a", "semantic_key": "", "source_title": "Dungeon Master's Guide"}, {"disposition": "STRICT_SEMANTIC_CANDIDATE", "expected_v5_evidence_class": "NUMERIC_PLUS_MECHANICAL_EVIDENCE", "family": "movement_environment", "heading": "DEH YDRATION [HAZARD]", "page_start": 364, "reason": "SOURCE_TEXT_SUPPORTS_BOUNDED_DETERMINISTIC_PROFILE", "section_id": "section-9249652fb6c073d6fe84", "semantic_key": "hazard.dehydration", "source_title": "Player's Handbook"}, {"disposition": "STRICT_SEMANTIC_CANDIDATE", "expected_v5_evidence_class": "NUMERIC_PLUS_MECHANICAL_EVIDENCE", "family": "movement_environment", "heading": "DEEP WATER", "page_start": 72, "reason": "SOURCE_TEXT_SUPPORTS_BOUNDED_DETERMINISTIC_PROFILE", "section_id": "section-c001f16d32b9f5224095", "semantic_key": "environment.deep_water", "source_title": "Dungeon Master's Guide"}, {"disposition": "QUARANTINE_REVIEW_REQUIRED", "expected_v5_evidence_class": "NARRATIVE_OR_TABLE_CONTEXT_ONLY", "family": "movement_environment", "heading": "UNDERWATER COMBAT", "page_start": 26, "reason": "SECTION_CONTAINER_OR_SUBRULES_NOT_CAPTURED", "section_id": "section-d966b66e4eaaa808d146", "semantic_key": "", "source_title": "Player's Handbook"}, {"disposition": "STRICT_SEMANTIC_CANDIDATE", "expected_v5_evidence_class": "MECHANICAL_PLUS_PROCEDURAL_EVIDENCE", "family": "movement_environment", "heading": "SUFFOCATION [HAZARD]", "page_start": 375, "reason": "SOURCE_TEXT_SUPPORTS_BOUNDED_DETERMINISTIC_PROFILE", "section_id": "section-ea2212ba492b1873d356", "semantic_key": "hazard.suffocation", "source_title": "Player's Handbook"}, {"disposition": "REFERENCE_CONTEXT_ONLY", "expected_v5_evidence_class": "NARRATIVE_OR_TABLE_CONTEXT_ONLY", "family": "movement_environment", "heading": "EXAMPLE HAZARDS", "page_start": 80, "reason": "GUIDANCE_OR_CONTEXT_NOT_STANDALONE_AUTOMATION", "section_id": "section-f1431280f1bbe56243ca", "semantic_key": "", "source_title": "Dungeon Master's Guide"}, {"disposition": "STRICT_SEMANTIC_CANDIDATE", "expected_v5_evidence_class": "MECHANICAL_PLUS_PROCEDURAL_EVIDENCE", "family": "movement_environment", "heading": "BURN I NG [HAZARD]", "page_start": 361, "reason": "SOURCE_TEXT_SUPPORTS_BOUNDED_DETERMINISTIC_PROFILE", "section_id": "section-f2e6009ab9387d4a4f6c", "semantic_key": "hazard.burning", "source_title": "Player's Handbook"}, {"disposition": "STRICT_SEMANTIC_CANDIDATE", "expected_v5_evidence_class": "NUMERIC_EVIDENCE_ONLY", "family": "movement_environment", "heading": "UNDERWATER ENCOUNTER DISTANCE", "page_start": 40, "reason": "SOURCE_TEXT_SUPPORTS_BOUNDED_DETERMINISTIC_PROFILE", "section_id": "section-f4a8684bba0596504ef1", "semantic_key": "environment.underwater_encounter_distance", "source_title": "Dungeon Master's Guide"}, {"disposition": "STRICT_SEMANTIC_CANDIDATE", "expected_v5_evidence_class": "NUMERIC_PLUS_MECHANICAL_EVIDENCE", "family": "movement_environment", "heading": "SWIMMING", "page_start": 375, "reason": "SOURCE_TEXT_SUPPORTS_BOUNDED_DETERMINISTIC_PROFILE", "section_id": "section-f906fff259a79fb509dc", "semantic_key": "movement.swimming", "source_title": "Player's Handbook"}, {"disposition": "REFERENCE_CONTEXT_ONLY", "expected_v5_evidence_class": "NARRATIVE_OR_TABLE_CONTEXT_ONLY", "family": "objects", "heading": "Armor Class. The Object Armor Class table sug­", "page_start": 361, "reason": "DEFINITION_OR_GUIDANCE_NOT_STANDALONE_AUTOMATION", "section_id": "section-1936d78c2873028016db", "semantic_key": "", "source_title": "Player's Handbook"}, {"disposition": "REFERENCE_CONTEXT_ONLY", "expected_v5_evidence_class": "NARRATIVE_OR_TABLE_CONTEXT_ONLY", "family": "objects", "heading": "OBJECT", "page_start": 370, "reason": "DEFINITION_OR_GUIDANCE_NOT_STANDALONE_AUTOMATION", "section_id": "section-195a32afee2cafdcae56", "semantic_key": "", "source_title": "Player's Handbook"}, {"disposition": "REFERENCE_CONTEXT_ONLY", "expected_v5_evidence_class": "PROCEDURAL_EVIDENCE_ONLY", "family": "objects", "heading": "BREAKING OBJECTS", "page_start": 361, "reason": "DEFINITION_OR_GUIDANCE_NOT_STANDALONE_AUTOMATION", "section_id": "section-1c1488c1b660b1acf1f7", "semantic_key": "", "source_title": "Player's Handbook"}, {"disposition": "QUARANTINE_REVIEW_REQUIRED", "expected_v5_evidence_class": "NUMERIC_PLUS_MECHANICAL_EVIDENCE", "family": "objects", "heading": "OBJECT HtT POINTS", "page_start": 361, "reason": "TABLE_OR_OCR_DEPENDENT", "section_id": "section-3089ab6ab1461f5d2f1c", "semantic_key": "", "source_title": "Player's Handbook"}, {"disposition": "REFERENCE_CONTEXT_ONLY", "expected_v5_evidence_class": "MECHANICAL_EVIDENCE_ONLY", "family": "objects", "heading": "Hit Points. The Object Hit Points table suggests Hit", "page_start": 361, "reason": "DEFINITION_OR_GUIDANCE_NOT_STANDALONE_AUTOMATION", "section_id": "section-40a29c51e1447b4474ca", "semantic_key": "", "source_title": "Player's Handbook"}, {"disposition": "QUARANTINE_REVIEW_REQUIRED", "expected_v5_evidence_class": "NARRATIVE_OR_TABLE_CONTEXT_ONLY", "family": "objects", "heading": "OBJECT ARMOR CLASS", "page_start": 361, "reason": "TABLE_OR_OCR_DEPENDENT", "section_id": "section-ebe4a11ec4f8f3666d98", "semantic_key": "", "source_title": "Player's Handbook"}, {"disposition": "REFERENCE_CONTEXT_ONLY", "expected_v5_evidence_class": "PROCEDURAL_EVIDENCE_ONLY", "family": "rests_survival", "heading": "Step 3: Track Food and Water Consumption. Each", "page_start": 42, "reason": "GUIDANCE_OR_CONTEXT_NOT_STANDALONE_AUTOMATION", "section_id": "section-02563c8bf0f2bf8503ac", "semantic_key": "", "source_title": "Dungeon Master's Guide"}, {"disposition": "STRICT_SEMANTIC_CANDIDATE", "expected_v5_evidence_class": "NUMERIC_PLUS_MECHANICAL_EVIDENCE", "family": "rests_survival", "heading": "LONG REST", "page_start": 369, "reason": "SOURCE_TEXT_SUPPORTS_BOUNDED_DETERMINISTIC_PROFILE", "section_id": "section-21052f7e1f9f615a5dda", "semantic_key": "rest.long", "source_title": "Player's Handbook"}, {"disposition": "STRICT_SEMANTIC_CANDIDATE", "expected_v5_evidence_class": "NUMERIC_PLUS_MECHANICAL_EVIDENCE", "family": "rests_survival", "heading": "FRIGID WATER", "page_start": 72, "reason": "SOURCE_TEXT_SUPPORTS_BOUNDED_DETERMINISTIC_PROFILE", "section_id": "section-3d7869d410f4e79873c5", "semantic_key": "environment.frigid_water", "source_title": "Dungeon Master's Guide"}, {"disposition": "STRICT_SEMANTIC_CANDIDATE", "expected_v5_evidence_class": "NUMERIC_PLUS_MECHANICAL_EVIDENCE", "family": "rests_survival", "heading": "MAL N UTR ITION [HAZARD]", "page_start": 370, "reason": "SOURCE_TEXT_SUPPORTS_BOUNDED_DETERMINISTIC_PROFILE", "section_id": "section-412fa7c05aeb11849da8", "semantic_key": "hazard.malnutrition", "source_title": "Player's Handbook"}, {"disposition": "STRICT_SEMANTIC_CANDIDATE", "expected_v5_evidence_class": "MECHANICAL_PLUS_PROCEDURAL_EVIDENCE", "family": "rests_survival", "heading": "SHORT REST", "page_start": 372, "reason": "SOURCE_TEXT_SUPPORTS_BOUNDED_DETERMINISTIC_PROFILE", "section_id": "section-41899f05db5b94a5745d", "semantic_key": "rest.short", "source_title": "Player's Handbook"}, {"disposition": "STRICT_SEMANTIC_CANDIDATE", "expected_v5_evidence_class": "NARRATIVE_OR_TABLE_CONTEXT_ONLY", "family": "rests_survival", "heading": "WATER NEEDS PER DAY", "page_start": 364, "reason": "SOURCE_TEXT_SUPPORTS_BOUNDED_DETERMINISTIC_PROFILE", "section_id": "section-549569c07337a9543920", "semantic_key": "survival.water_needs", "source_title": "Player's Handbook"}, {"disposition": "STRICT_SEMANTIC_CANDIDATE", "expected_v5_evidence_class": "NUMERIC_PLUS_MECHANICAL_EVIDENCE", "family": "rests_survival", "heading": "DEH YDRATION [HAZARD]", "page_start": 364, "reason": "SOURCE_TEXT_SUPPORTS_BOUNDED_DETERMINISTIC_PROFILE", "section_id": "section-9249652fb6c073d6fe84", "semantic_key": "hazard.dehydration", "source_title": "Player's Handbook"}, {"disposition": "STRICT_SEMANTIC_CANDIDATE", "expected_v5_evidence_class": "NUMERIC_PLUS_MECHANICAL_EVIDENCE", "family": "rests_survival", "heading": "DEEP WATER", "page_start": 72, "reason": "SOURCE_TEXT_SUPPORTS_BOUNDED_DETERMINISTIC_PROFILE", "section_id": "section-c001f16d32b9f5224095", "semantic_key": "environment.deep_water", "source_title": "Dungeon Master's Guide"}, {"disposition": "STRICT_SEMANTIC_CANDIDATE", "expected_v5_evidence_class": "NUMERIC_PLUS_MECHANICAL_EVIDENCE", "family": "rests_survival", "heading": "REST AND RECUPERATION", "page_start": 65, "reason": "SOURCE_TEXT_SUPPORTS_BOUNDED_DETERMINISTIC_PROFILE", "section_id": "section-ce8b704bf99b4a6116c8", "semantic_key": "recovery.recuperation", "source_title": "Dungeon Master's Guide"}, {"disposition": "STRICT_SEMANTIC_CANDIDATE", "expected_v5_evidence_class": "MECHANICAL_PLUS_PROCEDURAL_EVIDENCE", "family": "rests_survival", "heading": "SUFFOCATION [HAZARD]", "page_start": 375, "reason": "SOURCE_TEXT_SUPPORTS_BOUNDED_DETERMINISTIC_PROFILE", "section_id": "section-ea2212ba492b1873d356", "semantic_key": "hazard.suffocation", "source_title": "Player's Handbook"}, {"disposition": "REFERENCE_CONTEXT_ONLY", "expected_v5_evidence_class": "MECHANICAL_EVIDENCE_ONLY", "family": "siege", "heading": "SIEGE EQUIPMENT", "page_start": 100, "reason": "SECTION_INTRO_WITHOUT_EXECUTABLE_SEMANTICS", "section_id": "section-459a3717b779aa98f21a", "semantic_key": "", "source_title": "Dungeon Master's Guide"}, {"disposition": "QUARANTINE_REVIEW_REQUIRED", "expected_v5_evidence_class": "MECHANICAL_PLUS_PROCEDURAL_EVIDENCE", "family": "traps", "heading": "BUILDING YOUR OWN TRAPS", "page_start": 107, "reason": "TABLE_OR_OCR_DEPENDENT", "section_id": "section-580b04552eb7dd8d13c0", "semantic_key": "", "source_title": "Dungeon Master's Guide"}, {"disposition": "QUARANTINE_REVIEW_REQUIRED", "expected_v5_evidence_class": "NUMERIC_PLUS_MECHANICAL_EVIDENCE", "family": "traps", "heading": "BUILDING A TRAP", "page_start": 107, "reason": "TABLE_OR_OCR_DEPENDENT", "section_id": "section-662d96b58301e9cb4cd7", "semantic_key": "", "source_title": "Dungeon Master's Guide"}, {"disposition": "REFERENCE_CONTEXT_ONLY", "expected_v5_evidence_class": "NARRATIVE_OR_TABLE_CONTEXT_ONLY", "family": "traps", "heading": "TRAPS", "page_start": 104, "reason": "GUIDANCE_OR_CONTEXT_NOT_STANDALONE_AUTOMATION", "section_id": "section-8f4d2f0beb277e2ad762", "semantic_key": "", "source_title": "Dungeon Master's Guide"}, {"disposition": "REFERENCE_CONTEXT_ONLY", "expected_v5_evidence_class": "MECHANICAL_PLUS_PROCEDURAL_EVIDENCE", "family": "traps", "heading": "PARTS OF A TRAP", "page_start": 104, "reason": "GUIDANCE_OR_CONTEXT_NOT_STANDALONE_AUTOMATION", "section_id": "section-97ed2547a6d79f63f4a0", "semantic_key": "", "source_title": "Dungeon Master's Guide"}, {"disposition": "QUARANTINE_REVIEW_REQUIRED", "expected_v5_evidence_class": "NUMERIC_PLUS_MECHANICAL_EVIDENCE", "family": "traps", "heading": "Nuisance Traps Deadly Traps", "page_start": 107, "reason": "TABLE_OR_OCR_DEPENDENT", "section_id": "section-adc1a76d4987084319ee", "semantic_key": "", "source_title": "Dungeon Master's Guide"}, {"disposition": "REFERENCE_CONTEXT_ONLY", "expected_v5_evidence_class": "NARRATIVE_OR_TABLE_CONTEXT_ONLY", "family": "traps", "heading": "EXAMPLE TRAPS", "page_start": 104, "reason": "GUIDANCE_OR_CONTEXT_NOT_STANDALONE_AUTOMATION", "section_id": "section-d72fb436f2f8888e6092", "semantic_key": "", "source_title": "Dungeon Master's Guide"}]""")

EXPECTED={
 "registry":70,"links":77,"backlog":67,
 "strict":26,"reference":25,"quarantine":16
}

SIGNALS={
 "dc_fixed":re.compile(r"\bDC\s*\d+\b",re.I),
 "dice_formula":re.compile(r"(?<![A-Za-z0-9])(?:\d+d\d+(?:\s*[+-]\s*\d+)?|d\d+)(?![A-Za-z0-9])",re.I),
 "distance":re.compile(r"\b\d+(?:\.\d+)?\s*(?:feet|foot|ft\.?|miles?|yards?)\b",re.I),
 "time_quantity":re.compile(r"\b\d+(?:\.\d+)?\s*(?:rounds?|minutes?|hours?|days?|weeks?)\b",re.I),
 "currency":re.compile(r"\b\d+(?:,\d{3})*(?:\.\d+)?\s*(?:CP|SP|EP|GP|PP)\b",re.I),
 "weight":re.compile(r"\b\d+(?:,\d{3})*(?:\.\d+)?\s*(?:pounds?|lb\.?)\b",re.I),
 "percentage":re.compile(r"\b\d+(?:\.\d+)?\s*%"),
 "multiplier":re.compile(r"\b(?:twice|half|double|triple|times)\b",re.I),
 "ability_check":re.compile(r"\b(?:ability check|Strength check|Dexterity check|Constitution check|Intelligence check|Wisdom check|Charisma check)\b",re.I),
 "saving_throw":re.compile(r"\b(?:saving throw|save)\b",re.I),
 "attack_roll":re.compile(r"\battack roll\b",re.I),
 "action_economy":re.compile(r"\b(?:Action|Bonus Action|Reaction)\b"),
 "speed_movement":re.compile(r"\b(?:Speed|movement|move|Travel Pace)\b",re.I),
 "rest_reference":re.compile(r"\b(?:Short Rest|Long Rest|rest)\b",re.I),
 "condition_reference":re.compile(r"\b(?:Exhaustion|Prone|Grappled|Restrained|Unconscious|Incapacitated)\b",re.I),
 "damage_reference":re.compile(r"\b(?:damage|Hit Points?|HP)\b",re.I),
 "table_reference":re.compile(r"\btable\b",re.I),
 "procedure_trigger":re.compile(r"\b(?:when|whenever|if|until|at the start|at the end|each time|per day|per hour)\b",re.I),
}
NUM={"dc_fixed","dice_formula","distance","time_quantity","currency","weight","percentage","multiplier"}
MECH={"ability_check","saving_throw","attack_roll","action_economy","speed_movement","rest_reference","condition_reference","damage_reference"}
STRUCT={"table_reference","procedure_trigger"}

def cjson(v): return json.dumps(v,ensure_ascii=False,sort_keys=True,separators=(",",":"))

def section_digest(db,section_id):
    row=db.execute("""
      SELECT s.id,s.revision_id,s.heading,s.body,s.page_start,s.page_end,
             src.id,src.title,src.rules_version,src.current_revision_id
      FROM sections s
      JOIN phase8_rule_registry r ON r.section_id=s.id
      JOIN sources src ON src.id=r.source_id
      WHERE s.id=?
    """,(section_id,)).fetchone()
    if not row: raise RuntimeError(f"Missing section {section_id}")
    return hashlib.sha256(cjson(list(row)).encode("utf-8")).hexdigest()

def evidence_class(text):
    names={name for name,rx in SIGNALS.items() if rx.search(text or "")}
    n=names&NUM;m=names&MECH;s=names&STRUCT
    if n and m:return "NUMERIC_PLUS_MECHANICAL_EVIDENCE"
    if n and s:return "NUMERIC_PLUS_PROCEDURAL_EVIDENCE"
    if n:return "NUMERIC_EVIDENCE_ONLY"
    if m and s:return "MECHANICAL_PLUS_PROCEDURAL_EVIDENCE"
    if m:return "MECHANICAL_EVIDENCE_ONLY"
    if s:return "PROCEDURAL_EVIDENCE_ONLY"
    return "NARRATIVE_OR_TABLE_CONTEXT_ONLY"

def write_csv(path,rows):
    if not rows:
        path.write_text("empty\n",encoding="utf-8-sig");return
    fields=[]
    for r in rows:
        for k in r:
            if k not in fields:fields.append(k)
    with path.open("w",encoding="utf-8-sig",newline="") as f:
        w=csv.DictWriter(f,fieldnames=fields);w.writeheader()
        for r in rows:w.writerow(r)

def main():
    ap=argparse.ArgumentParser()
    ap.add_argument("--db",default=str(RULES_DB))
    ap.add_argument("--output",default=str(DEFAULT_OUTPUT))
    args=ap.parse_args()
    out=Path(args.output);out.mkdir(parents=True,exist_ok=True)
    db=sqlite3.connect(f"file:{Path(args.db).as_posix()}?mode=ro",uri=True)
    db.row_factory=sqlite3.Row
    errors=[]
    try:
        integrity=db.execute("PRAGMA integrity_check").fetchone()[0]
        fk=db.execute("PRAGMA foreign_key_check").fetchall()
        if integrity!="ok":errors.append(f"integrity={integrity}")
        if fk:errors.append(f"foreign_keys={len(fk)}")

        counts={
          "registry":db.execute("SELECT COUNT(*) FROM phase8_rule_registry").fetchone()[0],
          "links":db.execute("SELECT COUNT(*) FROM phase8_rule_family_links").fetchone()[0],
          "backlog":db.execute("SELECT COUNT(*) FROM phase8_automation_backlog").fetchone()[0],
        }
        for k in ("registry","links","backlog"):
            if counts[k]!=EXPECTED[k]:errors.append(f"{k} expected={EXPECTED[k]} actual={counts[k]}")

        batch=db.execute("""
          SELECT phase_status,package_version,backlog_rows
          FROM phase8_baseline_batches ORDER BY created_at DESC LIMIT 1
        """).fetchone()
        if not batch or tuple(batch)!=("STRUCTURED_BASELINE_APPLIED_PHASE8_OPEN","V4",67):
            errors.append(f"bad_v4_batch={tuple(batch) if batch else None}")

        live_pairs={(r[0],r[1]) for r in db.execute("""
          SELECT section_id,family FROM phase8_automation_backlog
          WHERE gap_type='semantic_extraction' AND status='PENDING_SEMANTIC_EXTRACTION'
        """)}
        expected_pairs={(x["section_id"],x["family"]) for x in MANIFEST}
        if live_pairs!=expected_pairs:
            errors.append(f"backlog_pair_drift missing={len(expected_pairs-live_pairs)} extra={len(live_pairs-expected_pairs)}")

        rows=[]
        for item in MANIFEST:
            row=db.execute("""
              SELECT r.source_title,r.page_start,r.heading,r.source_section_digest,
                     s.body,l.disposition
              FROM phase8_rule_registry r
              JOIN sections s ON s.id=r.section_id
              JOIN phase8_rule_family_links l ON l.section_id=r.section_id AND l.family=?
              WHERE r.section_id=?
            """,(item["family"],item["section_id"])).fetchone()
            if not row:
                errors.append(f"missing_manifest_row={item['family']}:{item['section_id']}")
                continue
            if row["source_title"]!=item["source_title"] or row["page_start"]!=item["page_start"] or row["heading"]!=item["heading"]:
                errors.append(f"source_identity_drift={item['family']}:{item['section_id']}")
            if row["disposition"]!="STRUCTURED_RULE_CANDIDATE":
                errors.append(f"unexpected_v4_link_disposition={item['family']}:{item['section_id']}:{row['disposition']}")
            digest=section_digest(db,item["section_id"])
            if digest!=row["source_section_digest"]:
                errors.append(f"section_digest_drift={item['section_id']}")
            ev=evidence_class(row["body"] or "")
            if ev!=item["expected_v5_evidence_class"]:
                errors.append(
                  f"v5_evidence_class_drift={item['family']}:{item['section_id']} expected={item['expected_v5_evidence_class']} actual={ev}"
                )
            rows.append({
              **item,
              "live_evidence_class":ev,
              "digest_match":"YES" if digest==row["source_section_digest"] else "NO",
              "body_excerpt":re.sub(r"\s+"," ",row["body"] or "")[:1600],
            })

        disp=Counter(r["disposition"] for r in rows)
        if disp.get("STRICT_SEMANTIC_CANDIDATE",0)!=26:errors.append("strict_count_drift")
        if disp.get("REFERENCE_CONTEXT_ONLY",0)!=25:errors.append("reference_count_drift")
        if disp.get("QUARANTINE_REVIEW_REQUIRED",0)!=16:errors.append("quarantine_count_drift")

        family_summary=[]
        for family in sorted({r["family"] for r in rows}):
            fr=[r for r in rows if r["family"]==family]
            c=Counter(r["disposition"] for r in fr)
            family_summary.append({
              "family":family,
              "total":len(fr),
              "strict":c.get("STRICT_SEMANTIC_CANDIDATE",0),
              "reference":c.get("REFERENCE_CONTEXT_ONLY",0),
              "quarantine_review":c.get("QUARANTINE_REVIEW_REQUIRED",0),
            })

        strict_rows=[r for r in rows if r["disposition"]=="STRICT_SEMANTIC_CANDIDATE"]
        ref_rows=[r for r in rows if r["disposition"]=="REFERENCE_CONTEXT_ONLY"]
        q_rows=[r for r in rows if r["disposition"]=="QUARANTINE_REVIEW_REQUIRED"]
        write_csv(out/"phase8_v6_strict_semantic_candidates.csv",strict_rows)
        write_csv(out/"phase8_v6_reference_context_only.csv",ref_rows)
        write_csv(out/"phase8_v6_quarantine_review_required.csv",q_rows)
        write_csv(out/"phase8_v6_family_disposition_summary.csv",family_summary)

        report={
          "package":"PHASE8_BOUNDED_SEMANTIC_DISPOSITION_AUDIT_V6",
          "createdAt":datetime.now(timezone.utc).isoformat(),
          "readOnly":True,
          "integrity":integrity,
          "foreignKeyErrors":len(fk),
          "v4BaselineCounts":counts,
          "dispositions":dict(sorted(disp.items())),
          "familySummary":family_summary,
          "strictSemanticCandidates":26,
          "referenceContextOnly":25,
          "quarantineReviewRequired":16,
          "errors":errors,
          "phaseStatus":"PHASE8_BOUNDED_SEMANTIC_DISPOSITION_AUDIT_COMPLETE" if not errors else "PHASE8_V6_AUDIT_FAILED",
          "next":"PHASE8_STRICT_SEMANTIC_RESOLUTION_V7" if not errors else "STOP_AND_REVIEW",
        }
        (out/"phase8_bounded_semantic_disposition_audit_v6_report.json").write_text(
          json.dumps(report,ensure_ascii=False,indent=2),encoding="utf-8"
        )
        (out/"PHASE8_BOUNDED_SEMANTIC_DISPOSITION_AUDIT_V6_SUMMARY.md").write_text(
          "# Phase 8 — Bounded Semantic Disposition Audit V6\n\n"
          "**Mode: READ-ONLY**\n\n"
          f"- Strict semantic candidates: {disp.get('STRICT_SEMANTIC_CANDIDATE',0)}\n"
          f"- Reference/context only: {disp.get('REFERENCE_CONTEXT_ONLY',0)}\n"
          f"- Quarantine/review required: {disp.get('QUARANTINE_REVIEW_REQUIRED',0)}\n"
          f"- Errors: {len(errors)}\n\n"
          "V6 does not write semantics. It freezes the bounded disposition plan for the exact 67 V4 backlog links.\n\n"
          f"**Status: {report['phaseStatus']}**\n",
          encoding="utf-8"
        )

        print("PHASE 8 BOUNDED SEMANTIC DISPOSITION AUDIT V6 COMPLETE")
        print("READ_ONLY=YES")
        print(f"INTEGRITY={integrity}")
        print(f"FOREIGN_KEYS={len(fk)}")
        print(f"V4_REGISTRY_ROWS={counts['registry']}")
        print(f"V4_FAMILY_LINKS={counts['links']}")
        print(f"V4_AUTOMATION_BACKLOG={counts['backlog']}")
        print(f"STRICT_SEMANTIC_CANDIDATES={disp.get('STRICT_SEMANTIC_CANDIDATE',0)}")
        print(f"REFERENCE_CONTEXT_ONLY={disp.get('REFERENCE_CONTEXT_ONLY',0)}")
        print(f"QUARANTINE_REVIEW_REQUIRED={disp.get('QUARANTINE_REVIEW_REQUIRED',0)}")
        print(f"CLASSIFIED_TOTAL={sum(disp.values())}")
        print(f"ERRORS={len(errors)}")
        for e in errors:print("ERROR:",e)
        print(f"PHASE_STATUS={report['phaseStatus']}")
        print(f"NEXT={report['next']}")
        print(f"OUTPUT={out}")
        return 0 if not errors else 1
    finally:
        db.close()

if __name__=="__main__":
    raise SystemExit(main())
