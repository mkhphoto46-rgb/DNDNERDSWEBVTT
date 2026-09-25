from __future__ import annotations

import argparse
import json
import sqlite3
from pathlib import Path

DEFAULT_DB = Path(r"F:\DND WEB VTT\data\compendium\rules_knowledge.sqlite")

EXPECTED = {
    "runtime_magic": 262,
    "runtime_poison": 14,
    "book_magic": 284,
    "book_poison": 0,
    "residual": 0,
    "old_queue": 0,
    "automation_backlog": 819,
    "effective_extracted": 0,
    "effective_magic": 546,
    "effective_poison": 14,
}

REMOVED_IDS = [
    "book-magic-item.2024.dungeon-master-s-guide.copper-acid-white-cold.258",
    "book-magic-item.2024.dungeon-master-s-guide.luck-blape.279",
    "book-magic-item.2024.dungeon-master-s-guide.luck-buaoe.279",
    "book-magic-item.2024.dungeon-master-s-guide.serair-boaso.311",
    "book-magic-item.2024.dungeon-master-s-guide.wand-of-macic-missrles.324",
    "book-magic-item.2024.dungeon-master-s-guide.cusic-gate.251",
    "book-magic-item.2024.dungeon-master-s-guide.tron-flask.278",
    "book-magic-item.2024.dungeon-master-s-guide.talisman-of-purs-goop.318",
    "book-magic-item.2024.dungeon-master-s-guide.rino-of-taree-wishes.300",
    "book-magic-item.2024.dungeon-master-s-guide.sun-blape.316",
    "book-magic-item.2024.dungeon-master-s-guide.ficurine-or-wonprous-power.265",
    "book-magic-item.2024.dungeon-master-s-guide.dracon-scale-malt.258",
    "book-magic-item.2024.dungeon-master-s-guide.starr-of-striking.313",
    "book-magic-item.2024.dungeon-master-s-guide.srarr-of-swarming-insects.313",
    "book-magic-item.2024.dungeon-master-s-guide.starr-of-healing.312",
    "book-magic-item.2024.dungeon-master-s-guide.well-or-many-wortps.328",
    "book-magic-item.2024.dungeon-master-s-guide.rio-of-dyrnnt-summoning.296",
    "book-magic-item.2024.dungeon-master-s-guide.wincep-boors.329",
    "book-magic-item.2024.dungeon-master-s-guide.foupinc-boat.267",
]

EXPECTED_NAMES = {
    "book-magic-item.2014.dungeon-master-s-guide.amu-let-of-proof-agai-nst-de-tec-tion.151": "Amulet of Proof against Detection and Location",
    "book-magic-item.2014.dungeon-master-s-guide.emerald.169": "Elixir of Health",
    "book-magic-item.2014.dungeon-master-s-guide.ojinni-summoning.191": "Ring of Djinni Summoning",
    "book-magic-item.2014.dungeon-master-s-guide.regeneration.193": "Ring of Resistance",
    "book-magic-item.2014.dungeon-master-s-guide.water-walking.194": "Ring of Spell Turning",
    "book-magic-item.2014.dungeon-master-s-guide.shield-of-mi-ssile.201": "Shield, +1, +2, or +3",
    "book-magic-item.2014.dungeon-master-s-guide.tr-id-ent-of-war-ning.214": "Weapon, +1, +2, or +3",
    "book-magic-item.2014.dungeon-master-s-guide.mant-a-rav.160": "Crystal Ball",
    "book-magic-item.2014.dungeon-master-s-guide.ogre-power.172": "Gauntlets of Ogre Power",
    "book-magic-item.2014.the-book-of-many-things.attunement.68": "Feywrought Armor",
    "book-magic-item.2014.the-book-of-many-things.runic-focus.69": "Sword of the Planes",
    "book-magic-item.2014.xanathar-s-guide-to-everything.annows.140": "Tankard of Sobriety",
    "book-magic-item.2014.xanathar-s-guide-to-everything.aemor-0e-gleaming.137": "Armor of Gleaming",
    "book-magic-item.2014.mordenkainen-s-tome-of-foes.m-ac-ic-item-greate-r-silver-sword.90": "Greater Silver Sword",
    "book-magic-item.2014.mordenkainen-s-tome-of-foes.m-ag-ic-item-infe-rnal-t-ack.168": "Infernal Tack",
    "book-magic-item.2014.the-book-of-many-things.hammer-of-runic-focus.68": "Hammer of Runic Focus",
}


def q1(db, sql, params=()):
    row = db.execute(sql, params).fetchone()
    return int(row[0]) if row else 0


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--db", default=str(DEFAULT_DB))
    args = ap.parse_args()

    db = sqlite3.connect(args.db)
    db.row_factory = sqlite3.Row
    errors = []
    try:
        integrity = db.execute("PRAGMA integrity_check").fetchone()[0]
        if integrity != "ok": errors.append(f"integrity={integrity}")
        fk = list(db.execute("PRAGMA foreign_key_check"))
        if fk: errors.append(f"foreign_key_check={len(fk)}")

        got = {
            "runtime_magic": q1(db, "SELECT COUNT(*) FROM magic_item_registry"),
            "runtime_poison": q1(db, "SELECT COUNT(*) FROM poison_registry"),
            "book_magic": q1(db, "SELECT COUNT(*) FROM book_magic_item_registry"),
            "book_poison": q1(db, "SELECT COUNT(*) FROM book_poison_registry"),
            "residual": q1(db, "SELECT COUNT(*) FROM phase6_residual_review_queue"),
            "old_queue": q1(db, "SELECT COUNT(*) FROM phase6_content_review_queue"),
            "automation_backlog": q1(db, "SELECT COUNT(*) FROM phase6_automation_backlog"),
            "effective_extracted": q1(db, "SELECT COUNT(*) FROM effective_validated_entities WHERE status='extracted'"),
            "effective_magic": q1(db, "SELECT COUNT(*) FROM effective_phase6_magic_items"),
            "effective_poison": q1(db, "SELECT COUNT(*) FROM effective_phase6_poisons"),
        }
        for k,v in EXPECTED.items():
            if got[k] != v: errors.append(f"{k}: expected {v}, got {got[k]}")

        if q1(db, "SELECT COUNT(*) FROM book_magic_item_engine_profiles") != 284:
            errors.append("book magic engine profile count != 284")

        for content_id in REMOVED_IDS:
            if q1(db, "SELECT COUNT(*) FROM book_magic_item_registry WHERE book_magic_item_id=?", (content_id,)) != 0:
                errors.append(f"runtime duplicate still in book registry: {content_id}")
            if q1(db, "SELECT COUNT(*) FROM book_magic_item_engine_profiles WHERE book_magic_item_id=?", (content_id,)) != 0:
                errors.append(f"runtime duplicate profile still present: {content_id}")

        for content_id, name in EXPECTED_NAMES.items():
            row = db.execute("SELECT item_name FROM book_magic_item_registry WHERE book_magic_item_id=?", (content_id,)).fetchone()
            if not row or row[0] != name:
                errors.append(f"title repair mismatch {content_id}: expected {name!r}, got {row[0] if row else None!r}")

        # Specific profile contamination checks.
        checks = [
            ("book-magic-item.2024.dungeon-master-s-guide.cast-off-armor.247", "requires_attunement", 0),
            ("book-magic-item.2024.dungeon-master-s-guide.cast-off-armor.247", "recharge_kind", None),
            ("book-magic-item.2014.the-book-of-many-things.attunement.68", "requires_attunement", 1),
            ("book-magic-item.2014.the-book-of-many-things.attunement.68", "max_charges", 3),
            ("book-magic-item.2014.the-book-of-many-things.runic-focus.69", "requires_attunement", 1),
            ("book-magic-item.2014.the-book-of-many-things.hammer-of-runic-focus.68", "requires_attunement", 1),
            ("book-magic-item.2014.the-book-of-many-things.hammer-of-runic-focus.68", "max_charges", 3),
            ("book-magic-item.2014.the-book-of-many-things.shield-of-the-tortoise.68", "recharge_kind", None),
        ]
        for content_id, col, expected in checks:
            row = db.execute(f"SELECT {col} FROM book_magic_item_engine_profiles WHERE book_magic_item_id=?", (content_id,)).fetchone()
            if not row or row[0] != expected:
                errors.append(f"profile mismatch {content_id}.{col}: expected {expected!r}, got {row[0] if row else None!r}")

        force = db.execute("SELECT item_type FROM book_magic_item_engine_profiles WHERE book_magic_item_id='book-magic-item.2014.the-book-of-many-things.forcebreaker-weapon.68'").fetchone()
        if not force or force[0] != "Weapon (Any Weapon that Deals Bludgeoning Damage)":
            errors.append("Forcebreaker Weapon item_type still contaminated")

        grasp = db.execute("SELECT damage_types_json FROM book_magic_item_engine_profiles WHERE book_magic_item_id='book-magic-item.2014.the-book-of-many-things.weapon-any-ammunition-uncommon.68'").fetchone()
        if not grasp or json.loads(grasp[0]) != []:
            errors.append("Grasping Whip still contains contaminated damage type")

        batch = db.execute("SELECT * FROM phase6_evidence_alignment_batches ORDER BY created_at DESC LIMIT 1").fetchone()
        if not batch:
            errors.append("missing V4 batch row")
        else:
            if batch["runtime_duplicates_removed"] != 19: errors.append("V4 batch runtime duplicate count != 19")
            if batch["title_repairs"] != 16: errors.append("V4 batch title repair count != 16")
            if batch["phase_status"] != "EVIDENCE_ALIGNMENT_APPLIED_PHASE6_OPEN": errors.append("unexpected V4 phase status")

        print("INTEGRITY=" + integrity)
        for k,v in got.items(): print(f"{k.upper()}={v}")
        v4_dup_res = q1(db, "SELECT COUNT(*) FROM phase6_evidence_alignment_resolution WHERE action='2024-runtime-duplicate-removed'")
        v4_title_res = q1(db, "SELECT COUNT(*) FROM phase6_evidence_alignment_resolution WHERE action='title-evidence-repair'")
        print(f"V4_RUNTIME_DUPLICATE_RESOLUTIONS={v4_dup_res}")
        print(f"V4_TITLE_REPAIR_RESOLUTIONS={v4_title_res}")
        print(f"ERRORS={len(errors)}")
        if errors:
            for e in errors: print("ERROR: " + e)
            raise SystemExit(4)
        print("PHASE_STATUS=EVIDENCE_ALIGNMENT_APPLIED_PHASE6_OPEN")
        print("NEXT=BOUNDED_RECOVERY_AND_CANONICAL_TITLE_NORMALIZATION")
    finally:
        db.close()


if __name__ == "__main__":
    main()
