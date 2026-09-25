from __future__ import annotations

import argparse
import csv
import hashlib
import json
import sqlite3
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

DEFAULT_PROJECT_ROOT = Path(r"F:\DND WEB VTT")
DEFAULT_DB = DEFAULT_PROJECT_ROOT / "data" / "compendium" / "rules_knowledge.sqlite"
DEFAULT_OUTPUT = DEFAULT_PROJECT_ROOT / "_phase6_evidence_alignment_v4"

EXPECTED_PRE = {
    "runtime_magic": 262,
    "runtime_poison": 14,
    "book_magic": 303,
    "book_poison": 0,
    "residual": 0,
    "old_queue": 0,
    "automation_backlog": 819,
    "effective_extracted": 0,
}

EXPECTED_POST = {
    "runtime_magic": 262,
    "runtime_poison": 14,
    "book_magic": 284,
    "book_poison": 0,
    "residual": 0,
    "old_queue": 0,
    "automation_backlog": 819,
    "effective_extracted": 0,
}

# These 2024 book rows are evidence-confirmed OCR/title aliases of existing
# authoritative SRD 5.2.1 runtime records. They must not remain duplicated in
# the validated 2024 book registry.
RUNTIME_DUPLICATES = {
    "book-magic-item.2024.dungeon-master-s-guide.copper-acid-white-cold.258": (
        "Copper Acid White Cold", "magic-item.dragon-slayer", "Dragon Slayer",
        "Source page 258 shows 'Copper Acid White Cold' is a Dragon Resistance table row immediately before the DRAGON SLAYER item block."
    ),
    "book-magic-item.2024.dungeon-master-s-guide.luck-blape.279": (
        "Luck BLapE", "magic-item.luck-blade", "Luck Blade",
        "Source page 279 shows this OCR title is LUCK BLADE; authoritative 2024 runtime record already exists."
    ),
    "book-magic-item.2024.dungeon-master-s-guide.luck-buaoe.279": (
        "Luck Buaoe", "magic-item.javelin-of-lightning", "Javelin of Lightning",
        "Source page 279 shows this section body begins JAVELIN OF LIGHTNING; the OCR heading is an illustration-label fragment."
    ),
    "book-magic-item.2024.dungeon-master-s-guide.serair-boaso.311": (
        "Serair Boaso", "magic-item.staff-of-fire", "Staff of Fire",
        "Source page 311 shows this section body begins STAFF OF FIRE; the OCR heading is not the item title."
    ),
    "book-magic-item.2024.dungeon-master-s-guide.wand-of-macic-missrles.324": (
        "WAND OF Macic MIssrLes", "magic-item.wand-of-magic-missiles", "Wand of Magic Missiles",
        "OCR-corrupted title matches the authoritative 2024 Wand of Magic Missiles record."
    ),
    "book-magic-item.2024.dungeon-master-s-guide.cusic-gate.251": (
        "Cusic GaTE", "magic-item.cubic-gate", "Cubic Gate",
        "OCR-corrupted title matches the authoritative 2024 Cubic Gate record."
    ),
    "book-magic-item.2024.dungeon-master-s-guide.tron-flask.278": (
        "TRON FLASK", "magic-item.iron-flask", "Iron Flask",
        "OCR-corrupted title matches the authoritative 2024 Iron Flask record."
    ),
    "book-magic-item.2024.dungeon-master-s-guide.talisman-of-purs-goop.318": (
        "TALISMAN OF Purs Goop", "magic-item.talisman-of-pure-good", "Talisman of Pure Good",
        "OCR-corrupted title matches the authoritative 2024 Talisman of Pure Good record."
    ),
    "book-magic-item.2024.dungeon-master-s-guide.rino-of-taree-wishes.300": (
        "Rino oF Taree WISHES", "magic-item.ring-of-three-wishes", "Ring of Three Wishes",
        "OCR-corrupted title matches the authoritative 2024 Ring of Three Wishes record."
    ),
    "book-magic-item.2024.dungeon-master-s-guide.sun-blape.316": (
        "Sun BLapE", "magic-item.sun-blade", "Sun Blade",
        "OCR-corrupted title matches the authoritative 2024 Sun Blade record."
    ),
    "book-magic-item.2024.dungeon-master-s-guide.ficurine-or-wonprous-power.265": (
        "Ficurine or Wonprous PowER", "magic-item.figurine-of-wondrous-power", "Figurine of Wondrous Power",
        "OCR-corrupted title matches the authoritative 2024 Figurine of Wondrous Power record."
    ),
    "book-magic-item.2024.dungeon-master-s-guide.dracon-scale-malt.258": (
        "Dracon ScaLe Malt", "magic-item.dragon-scale-mail", "Dragon Scale Mail",
        "OCR-corrupted title matches the authoritative 2024 Dragon Scale Mail record."
    ),
    "book-magic-item.2024.dungeon-master-s-guide.starr-of-striking.313": (
        "Starr OF STRIKING", "magic-item.staff-of-striking", "Staff of Striking",
        "OCR-corrupted title matches the authoritative 2024 Staff of Striking record."
    ),
    "book-magic-item.2024.dungeon-master-s-guide.srarr-of-swarming-insects.313": (
        "Srarr OF SWARMING INSECTS", "magic-item.staff-of-swarming-insects", "Staff of Swarming Insects",
        "OCR-corrupted title matches the authoritative 2024 Staff of Swarming Insects record."
    ),
    "book-magic-item.2024.dungeon-master-s-guide.starr-of-healing.312": (
        "Starr OF HEALING", "magic-item.staff-of-healing", "Staff of Healing",
        "OCR-corrupted title matches the authoritative 2024 Staff of Healing record."
    ),
    "book-magic-item.2024.dungeon-master-s-guide.well-or-many-wortps.328": (
        "WELL or Many Wortps", "magic-item.well-of-many-worlds", "Well of Many Worlds",
        "OCR-corrupted title matches the authoritative 2024 Well of Many Worlds record."
    ),
    "book-magic-item.2024.dungeon-master-s-guide.rio-of-dyrnnt-summoning.296": (
        "Rio oF Dyrnnt SUMMONING", "magic-item.ring-of-djinni-summoning", "Ring of Djinni Summoning",
        "OCR-corrupted title matches the authoritative 2024 Ring of Djinni Summoning record."
    ),
    "book-magic-item.2024.dungeon-master-s-guide.wincep-boors.329": (
        "Wincep Boors", "magic-item.winged-boots", "Winged Boots",
        "OCR-corrupted title matches the authoritative 2024 Winged Boots record."
    ),
    "book-magic-item.2024.dungeon-master-s-guide.foupinc-boat.267": (
        "Foupinc Boat", "magic-item.folding-boat", "Folding Boat",
        "OCR-corrupted title matches the authoritative 2024 Folding Boat record."
    ),
}

# Exact legacy/book rows whose source page/section evidence identifies a real
# item title different from the current OCR heading. IDs stay stable to avoid
# needless referential churn; item_name and only evidence-supported profile
# fields are corrected.
TITLE_REPAIRS = {
    "book-magic-item.2014.dungeon-master-s-guide.amu-let-of-proof-agai-nst-de-tec-tion.151": (
        "AMU LET OF PROOF AGAI NST DE TEC TION", "Amulet of Proof against Detection and Location",
        "Source page 151 continues the title on the next line as 'AND LOCA TION' before the Wondrous Item descriptor."
    ),
    "book-magic-item.2014.dungeon-master-s-guide.emerald.169": (
        "Emerald", "Elixir of Health",
        "Source page 169 shows Emerald is the final row of the Elemental Gem table; the section body begins ELIXIR OF HEAL TH followed by Potion, rare."
    ),
    "book-magic-item.2014.dungeon-master-s-guide.ojinni-summoning.191": (
        "OJINNI SUMMONING", "Ring of Djinni Summoning",
        "Source page 191 shows the section body begins RIN G OF DJINNI SUMMON ING followed by Ring, legendary."
    ),
    "book-magic-item.2014.dungeon-master-s-guide.regeneration.193": (
        "REGENERATION", "Ring of Resistance",
        "Source page 193 shows REGENERATION is an illustration-label fragment; section body begins RING OF RES ISTANCE followed by Ring, rare."
    ),
    "book-magic-item.2014.dungeon-master-s-guide.water-walking.194": (
        "WATER WALKING", "Ring of Spell Turning",
        "Source page 194 section body is the Ring of Spell Turning description (legendary, attunement); WATER WALKING is a nearby illustration-label fragment."
    ),
    "book-magic-item.2014.dungeon-master-s-guide.shield-of-mi-ssile.201": (
        "SHIELD OF MI SSILE", "Shield, +1, +2, or +3",
        "Source page 201 shows the current section body is Armor (shield), uncommon (+1), rare (+2), or very rare (+3), not Shield of Missile Attraction."
    ),
    "book-magic-item.2014.dungeon-master-s-guide.tr-id-ent-of-war-ning.214": (
        "TR ID ENT OF WAR NING", "Weapon, +1, +2, or +3",
        "Source page 214 section body begins WEAPON, +1, +2, OR +3 and its tiered rarity descriptor; the OCR heading is an illustration-label fragment."
    ),
    "book-magic-item.2014.dungeon-master-s-guide.mant-a-rav.160": (
        "MANT A RAV", "Crystal Ball",
        "Source page 160 section body is the Crystal Ball entry: Wondrous item, very rare or legendary, Scrying save DC 17. MANT A RAV is a nearby illustration-label fragment."
    ),
    "book-magic-item.2014.dungeon-master-s-guide.ogre-power.172": (
        "OGRE PowER", "Gauntlets of Ogre Power",
        "Source page 172 section body is the Gauntlets of Ogre Power entry: Wondrous item, uncommon, Strength 19."
    ),
    "book-magic-item.2014.the-book-of-many-things.attunement.68": (
        "Attunement)", "Feywrought Armor",
        "Source page 68 shows FEYWROUGHT ARMOR in the interleaved column immediately with the Armor (Light, Medium, or Heavy), Rare (Requires Attunement) descriptor and its 3-charge text."
    ),
    "book-magic-item.2014.the-book-of-many-things.runic-focus.69": (
        "RuNic Focus", "Sword of the Planes",
        "Source page 69 shows RuNic Focus is an illustration-label fragment; section body begins SWORD OF THE PLANES followed by Weapon (Any Sword), Legendary (Requires Attunement)."
    ),
    "book-magic-item.2014.xanathar-s-guide-to-everything.annows.140": (
        "Annows", "Tankard of Sobriety",
        "Source page 140 shows Annows is a fragment from UNBREAKABLE ARROWS; section body begins TANKARD OF SOBRIETY followed by Wondrous item, common."
    ),
    "book-magic-item.2014.xanathar-s-guide-to-everything.aemor-0e-gleaming.137": (
        "AEMOR 0E GLEAMING", "Armor of Gleaming",
        "Source page 137 descriptor/body identify Armor of Gleaming; title is OCR-corrupted."
    ),
    "book-magic-item.2014.mordenkainen-s-tome-of-foes.m-ac-ic-item-greate-r-silver-sword.90": (
        "GREATE R SILVER SWORD", "Greater Silver Sword",
        "Source page 90 title is OCR-spaced; V3 already removed the generic MAGIC ITEM prefix."
    ),
    "book-magic-item.2014.mordenkainen-s-tome-of-foes.m-ag-ic-item-infe-rnal-t-ack.168": (
        "INFE RNAL T ACK", "Infernal Tack",
        "Source page 168 title is OCR-spaced; V3 already removed the generic MAGIC ITEM prefix."
    ),
    "book-magic-item.2014.the-book-of-many-things.hammer-of-runic-focus.68": (
        "HaMmer OF RUNIc Focus", "Hammer of Runic Focus",
        "Source page 68 title is OCR/case-corrupted but unambiguously identifies Hammer of Runic Focus."
    ),
}

# Evidence-supported profile patches. Only listed fields are changed; every
# other field is preserved. JSON values are stored as serialized JSON strings.
PROFILE_PATCHES: dict[str, dict[str, Any]] = {
    "book-magic-item.2014.dungeon-master-s-guide.shield-of-mi-ssile.201": {
        "item_type": "Armor (Shield)",
        "rarity": "Uncommon (+1), Rare (+2), Very Rare (+3)",
        "requires_attunement": 0,
    },
    "book-magic-item.2014.dungeon-master-s-guide.tr-id-ent-of-war-ning.214": {
        "item_type": "Weapon (Any)",
        "rarity": "Uncommon (+1), Rare (+2), Very Rare (+3)",
        "requires_attunement": 0,
    },
    "book-magic-item.2014.the-book-of-many-things.attunement.68": {
        "item_type": "Armor (Light, Medium, Or Heavy)",
        "rarity": "Rare",
        "requires_attunement": 1,
        "max_charges": 3,
        "recharge_kind": "DAWN",
        "recharge_formula": "1d3",
        "save_dc": 15,
        "activation_types_json": json.dumps(["Action"]),
        "condition_tags_json": json.dumps([]),
        "damage_types_json": json.dumps([]),
    },
    "book-magic-item.2014.the-book-of-many-things.runic-focus.69": {
        "item_type": "Weapon (Any Sword)",
        "rarity": "Legendary",
        "requires_attunement": 1,
        "max_charges": None,
        "recharge_kind": None,
        "recharge_formula": None,
        "save_dc": None,
        "activation_types_json": json.dumps(["Action"]),
        "condition_tags_json": json.dumps([]),
        "damage_types_json": json.dumps([]),
    },
    "book-magic-item.2014.the-book-of-many-things.hammer-of-runic-focus.68": {
        "item_type": "Weapon (Warhammer)",
        "rarity": "Very Rare",
        "requires_attunement": 1,
        "max_charges": 3,
        "recharge_kind": "DAWN",
        "recharge_formula": "1d3",
        "save_dc": None,
        "activation_types_json": json.dumps(["Bonus Action"]),
        "condition_tags_json": json.dumps([]),
        "damage_types_json": json.dumps([]),
    },
    "book-magic-item.2014.the-book-of-many-things.gloomwrought-armor.68": {
        "item_type": "Armor (Light, Medium, Or Heavy)",
        "rarity": "Rare",
        "requires_attunement": 1,
        "max_charges": 3,
        "recharge_kind": "DAWN",
        "recharge_formula": "1d3",
        "save_dc": 15,
        "condition_tags_json": json.dumps([]),
        "damage_types_json": json.dumps([]),
    },
    "book-magic-item.2014.the-book-of-many-things.weapon-any-ammunition-uncommon.68": {
        "item_type": "Weapon (Whip)",
        "rarity": "Rare",
        "requires_attunement": 0,
        "damage_types_json": json.dumps([]),
    },
    "book-magic-item.2014.the-book-of-many-things.forcebreaker-weapon.68": {
        "item_type": "Weapon (Any Weapon that Deals Bludgeoning Damage)",
        "rarity": "Very Rare",
        "requires_attunement": 0,
    },
    "book-magic-item.2014.the-book-of-many-things.shield-of-the-tortoise.68": {
        "item_type": "Armor (Shield)",
        "rarity": "Uncommon",
        "requires_attunement": 1,
        "max_charges": None,
        "recharge_kind": None,
        "recharge_formula": None,
        "save_dc": None,
    },
    "book-magic-item.2024.dungeon-master-s-guide.cast-off-armor.247": {
        "item_type": "Armor (Any Light, Medium, Or Heavy)",
        "rarity": "Common",
        "requires_attunement": 0,
        "max_charges": None,
        "recharge_kind": None,
        "recharge_formula": None,
        "save_dc": None,
        "activation_types_json": json.dumps(["Magic Action"]),
        "condition_tags_json": json.dumps([]),
        "damage_types_json": json.dumps([]),
    },
}

# Known unresolved extraction risks that remain after V4. They are reported,
# not silently promoted or deleted. Phase 6 therefore remains OPEN.
KNOWN_REMAINING_RISKS = [
    {
        "source": "The Book of Many Things",
        "page": 68,
        "issue": "Two-column interleaving contains additional item blocks (for example Clockwork Armor and Dried Leech) that are not safely reconstructable from the current section segmentation without a dedicated bounded recovery pass.",
    },
    {
        "source": "Multiple legacy books",
        "page": None,
        "issue": "Several surviving titles remain cosmetic OCR variants (spacing/case/character substitutions). They are recognizable item titles but still require a later canonical-title normalization pass before final closure.",
    },
]


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


def q1(db: sqlite3.Connection, sql: str, params: tuple[Any, ...] = ()) -> int:
    row = db.execute(sql, params).fetchone()
    return int(row[0]) if row else 0


def state(db: sqlite3.Connection) -> dict[str, int]:
    return {
        "runtime_magic": q1(db, "SELECT COUNT(*) FROM magic_item_registry"),
        "runtime_poison": q1(db, "SELECT COUNT(*) FROM poison_registry"),
        "book_magic": q1(db, "SELECT COUNT(*) FROM book_magic_item_registry"),
        "book_poison": q1(db, "SELECT COUNT(*) FROM book_poison_registry"),
        "residual": q1(db, "SELECT COUNT(*) FROM phase6_residual_review_queue"),
        "old_queue": q1(db, "SELECT COUNT(*) FROM phase6_content_review_queue"),
        "automation_backlog": q1(db, "SELECT COUNT(*) FROM phase6_automation_backlog"),
        "effective_extracted": q1(db, "SELECT COUNT(*) FROM effective_validated_entities WHERE status='extracted'"),
    }


def require_state(actual: dict[str, int], expected: dict[str, int], label: str) -> None:
    bad = {k: (expected[k], actual.get(k)) for k in expected if actual.get(k) != expected[k]}
    if bad:
        lines = [f"{k}: expected {exp}, got {got}" for k, (exp, got) in bad.items()]
        raise RuntimeError(f"{label} state mismatch:\n" + "\n".join(lines))


def write_json(path: Path, data: Any) -> None:
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def write_csv(path: Path, rows: list[dict[str, Any]]) -> None:
    fields = list(rows[0].keys()) if rows else ["empty"]
    with path.open("w", encoding="utf-8-sig", newline="") as f:
        w = csv.DictWriter(f, fieldnames=fields)
        w.writeheader()
        if rows:
            w.writerows(rows)


def ensure_schema(db: sqlite3.Connection) -> None:
    db.executescript(
        """
        CREATE TABLE IF NOT EXISTS phase6_evidence_alignment_batches(
          id TEXT PRIMARY KEY,
          created_at TEXT NOT NULL,
          source_db_sha256 TEXT NOT NULL,
          runtime_duplicates_removed INTEGER NOT NULL,
          title_repairs INTEGER NOT NULL,
          profile_repairs INTEGER NOT NULL,
          post_book_magic_count INTEGER NOT NULL,
          post_automation_backlog INTEGER NOT NULL,
          phase_status TEXT NOT NULL
        ) STRICT;

        CREATE TABLE IF NOT EXISTS phase6_evidence_alignment_resolution(
          content_id TEXT NOT NULL,
          entity_version_id TEXT,
          action TEXT NOT NULL,
          old_name TEXT,
          new_name TEXT,
          matched_runtime_id TEXT,
          evidence_note TEXT NOT NULL,
          batch_id TEXT NOT NULL,
          PRIMARY KEY(content_id, action)
        ) STRICT;
        """
    )


def verify_preconditions(db: sqlite3.Connection) -> None:
    require_state(state(db), EXPECTED_PRE, "V4 precondition")
    latest = db.execute(
        "SELECT quality_status FROM phase6_quality_repair_batches ORDER BY created_at DESC LIMIT 1"
    ).fetchone()
    if not latest or latest[0] != "SAFE_BASELINE_RESTORED_PHASE6_REOPENED":
        raise RuntimeError("V4 requires the V3 safe baseline as its input state.")

    for content_id, (old_name, runtime_id, runtime_name, _note) in RUNTIME_DUPLICATES.items():
        row = db.execute(
            "SELECT item_name,rules_version FROM book_magic_item_registry WHERE book_magic_item_id=?",
            (content_id,),
        ).fetchone()
        if not row or row[0] != old_name or row[1] != "2024":
            raise RuntimeError(f"Runtime-duplicate precondition failed for {content_id}")
        rt = db.execute(
            "SELECT item_name,rules_version FROM magic_item_registry WHERE magic_item_id=?",
            (runtime_id,),
        ).fetchone()
        if not rt or rt[0] != runtime_name or rt[1] != "2024":
            raise RuntimeError(f"Runtime target precondition failed for {runtime_id}")

    for content_id, (old_name, _new_name, _note) in TITLE_REPAIRS.items():
        row = db.execute(
            "SELECT item_name FROM book_magic_item_registry WHERE book_magic_item_id=?",
            (content_id,),
        ).fetchone()
        if not row or row[0] != old_name:
            raise RuntimeError(f"Title-repair precondition failed for {content_id}: {row[0] if row else 'missing'}")

    for content_id in PROFILE_PATCHES:
        row = db.execute(
            "SELECT 1 FROM book_magic_item_engine_profiles WHERE book_magic_item_id=?",
            (content_id,),
        ).fetchone()
        if not row:
            raise RuntimeError(f"Profile-repair target missing: {content_id}")


def apply(db: sqlite3.Connection, batch_id: str, source_hash: str) -> tuple[list[dict[str, Any]], list[dict[str, Any]], list[dict[str, Any]]]:
    removed: list[dict[str, Any]] = []
    renamed: list[dict[str, Any]] = []
    profile_changes: list[dict[str, Any]] = []

    ensure_schema(db)

    # Remove evidence-confirmed 2024 duplicates of authoritative runtime rows.
    for content_id, (old_name, runtime_id, runtime_name, note) in RUNTIME_DUPLICATES.items():
        row = db.execute(
            "SELECT entity_version_id,source_title,source_page,rules_version FROM book_magic_item_registry WHERE book_magic_item_id=?",
            (content_id,),
        ).fetchone()
        entity_version_id = row[0]
        db.execute("DELETE FROM book_magic_item_engine_profiles WHERE book_magic_item_id=?", (content_id,))
        db.execute("DELETE FROM phase6_automation_backlog WHERE content_id=?", (content_id,))
        db.execute("DELETE FROM book_magic_item_registry WHERE book_magic_item_id=?", (content_id,))
        db.execute(
            """
            INSERT OR REPLACE INTO phase6_evidence_alignment_resolution
            (content_id,entity_version_id,action,old_name,new_name,matched_runtime_id,evidence_note,batch_id)
            VALUES(?,?,?,?,?,?,?,?)
            """,
            (content_id, entity_version_id, "2024-runtime-duplicate-removed", old_name, runtime_name, runtime_id, note, batch_id),
        )
        removed.append({
            "content_id": content_id,
            "old_name": old_name,
            "runtime_id": runtime_id,
            "runtime_name": runtime_name,
            "source_title": row[1],
            "source_page": row[2],
            "evidence": note,
        })

    # Repair evidence-confirmed legacy/book titles, preserving stable content IDs.
    for content_id, (old_name, new_name, note) in TITLE_REPAIRS.items():
        row = db.execute(
            "SELECT entity_version_id,source_title,source_page,rules_version FROM book_magic_item_registry WHERE book_magic_item_id=?",
            (content_id,),
        ).fetchone()
        db.execute(
            "UPDATE book_magic_item_registry SET item_name=? WHERE book_magic_item_id=?",
            (new_name, content_id),
        )
        db.execute(
            """
            INSERT OR REPLACE INTO phase6_evidence_alignment_resolution
            (content_id,entity_version_id,action,old_name,new_name,matched_runtime_id,evidence_note,batch_id)
            VALUES(?,?,?,?,?,?,?,?)
            """,
            (content_id, row[0], "title-evidence-repair", old_name, new_name, None, note, batch_id),
        )
        renamed.append({
            "content_id": content_id,
            "old_name": old_name,
            "new_name": new_name,
            "source_title": row[1],
            "source_page": row[2],
            "evidence": note,
        })

    # Repair only fields supported by local source-page evidence.
    for content_id, patch in PROFILE_PATCHES.items():
        before = dict(db.execute(
            "SELECT * FROM book_magic_item_engine_profiles WHERE book_magic_item_id=?", (content_id,)
        ).fetchone())
        cols = list(patch.keys())
        sql = "UPDATE book_magic_item_engine_profiles SET " + ",".join(f"{c}=?" for c in cols) + " WHERE book_magic_item_id=?"
        db.execute(sql, tuple(patch[c] for c in cols) + (content_id,))
        after = dict(db.execute(
            "SELECT * FROM book_magic_item_engine_profiles WHERE book_magic_item_id=?", (content_id,)
        ).fetchone())
        changed = {k: {"before": before.get(k), "after": after.get(k)} for k in cols if before.get(k) != after.get(k)}
        profile_changes.append({"content_id": content_id, "changed_fields": changed})
        if changed:
            reg = db.execute(
                "SELECT entity_version_id,item_name FROM book_magic_item_registry WHERE book_magic_item_id=?", (content_id,)
            ).fetchone()
            db.execute(
                """
                INSERT OR REPLACE INTO phase6_evidence_alignment_resolution
                (content_id,entity_version_id,action,old_name,new_name,matched_runtime_id,evidence_note,batch_id)
                VALUES(?,?,?,?,?,?,?,?)
                """,
                (content_id, reg[0] if reg else None, "profile-evidence-repair", reg[1] if reg else None,
                 reg[1] if reg else None, None, "Profile fields corrected only where exact local source text supports the change.", batch_id),
            )

    post = state(db)
    require_state(post, EXPECTED_POST, "V4 postcondition")

    db.execute(
        """
        INSERT INTO phase6_evidence_alignment_batches
        (id,created_at,source_db_sha256,runtime_duplicates_removed,title_repairs,profile_repairs,
         post_book_magic_count,post_automation_backlog,phase_status)
        VALUES(?,?,?,?,?,?,?,?,?)
        """,
        (batch_id, now_iso(), source_hash, len(removed), len(renamed), sum(1 for x in profile_changes if x["changed_fields"]),
         post["book_magic"], post["automation_backlog"], "EVIDENCE_ALIGNMENT_APPLIED_PHASE6_OPEN"),
    )

    return removed, renamed, profile_changes


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--db", default=str(DEFAULT_DB))
    ap.add_argument("--output", default=str(DEFAULT_OUTPUT))
    ap.add_argument("--apply", action="store_true")
    args = ap.parse_args()

    db_path = Path(args.db)
    output = Path(args.output)
    output.mkdir(parents=True, exist_ok=True)
    if not db_path.exists():
        raise RuntimeError(f"Database not found: {db_path}")

    source_hash = sha256_file(db_path)
    db = sqlite3.connect(db_path)
    db.row_factory = sqlite3.Row
    try:
        integrity = db.execute("PRAGMA integrity_check").fetchone()[0]
        if integrity != "ok":
            raise RuntimeError(f"SQLite integrity failed before V4: {integrity}")
        verify_preconditions(db)

        batch_id = "phase6-evidence-alignment-v4-" + datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
        if not args.apply:
            report = {
                "applied": False,
                "preState": state(db),
                "plannedRuntimeDuplicateRemovals": len(RUNTIME_DUPLICATES),
                "plannedTitleRepairs": len(TITLE_REPAIRS),
                "plannedProfilePatches": len(PROFILE_PATCHES),
                "phaseStatus": "DRY_RUN_ONLY",
            }
            write_json(output / "phase6_evidence_alignment_v4_dry_run.json", report)
            print(json.dumps(report, indent=2))
            return 0

        with db:
            removed, renamed, profile_changes = apply(db, batch_id, source_hash)

        post = state(db)
        report = {
            "applied": True,
            "batchId": batch_id,
            "sourceDbSha256": source_hash,
            "postState": post,
            "runtimeDuplicatesRemoved": len(removed),
            "titleRepairs": len(renamed),
            "profileRepairsWithChanges": sum(1 for x in profile_changes if x["changed_fields"]),
            "phaseStatus": "EVIDENCE_ALIGNMENT_APPLIED_PHASE6_OPEN",
            "next": "Run independent V4 verification, then continue with bounded recovery/canonical-title cleanup before Phase 6 closure.",
        }
        write_json(output / "phase6_evidence_alignment_v4_report.json", report)
        write_json(output / "removed_2024_runtime_duplicates.json", removed)
        write_csv(output / "removed_2024_runtime_duplicates.csv", removed)
        write_json(output / "title_repairs.json", renamed)
        write_csv(output / "title_repairs.csv", renamed)
        write_json(output / "profile_repairs.json", profile_changes)
        write_json(output / "known_remaining_risks.json", KNOWN_REMAINING_RISKS)

        remaining = [dict(r) for r in db.execute(
            "SELECT book_magic_item_id,item_name,rules_version,source_title,source_page,validation_scope FROM book_magic_item_registry ORDER BY source_title,source_page,item_name"
        )]
        write_json(output / "remaining_validated_book_magic_items.json", remaining)
        write_csv(output / "remaining_validated_book_magic_items.csv", remaining)

        summary = f"""# Phase 6 Evidence Alignment V4 Summary\n\n- Runtime Magic Items: {post['runtime_magic']}\n- Runtime Poisons: {post['runtime_poison']}\n- Book Magic Items: {post['book_magic']}\n- Book Poisons: {post['book_poison']}\n- Automation Backlog: {post['automation_backlog']}\n- 2024 runtime duplicates removed: {len(removed)}\n- Evidence-confirmed title repairs: {len(renamed)}\n- Profile repairs with actual field changes: {sum(1 for x in profile_changes if x['changed_fields'])}\n- Residual queue: {post['residual']}\n- Old review queue: {post['old_queue']}\n- Extracted in effective runtime: {post['effective_extracted']}\n\n**Status: EVIDENCE ALIGNMENT APPLIED / PHASE 6 REMAINS OPEN.**\n\nV4 intentionally does not close Phase 6. Remaining OCR normalization and bounded recovery risks are tracked in `known_remaining_risks.json`.\n"""
        (output / "PHASE6_EVIDENCE_ALIGNMENT_V4_SUMMARY.md").write_text(summary, encoding="utf-8")

        print("PHASE 6 EVIDENCE ALIGNMENT V4 APPLIED")
        print(f"RUNTIME_DUPLICATES_REMOVED={len(removed)}")
        print(f"TITLE_REPAIRS={len(renamed)}")
        print(f"PROFILE_REPAIRS={sum(1 for x in profile_changes if x['changed_fields'])}")
        print(f"BOOK_MAGIC_ITEMS={post['book_magic']}")
        print(f"BOOK_POISONS={post['book_poison']}")
        print(f"AUTOMATION_BACKLOG={post['automation_backlog']}")
        print("PHASE_STATUS=EVIDENCE_ALIGNMENT_APPLIED_PHASE6_OPEN")
        print(f"OUTPUT={output}")
        return 0
    finally:
        db.close()


if __name__ == "__main__":
    raise SystemExit(main())
