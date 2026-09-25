from __future__ import annotations
import argparse, csv, hashlib, json, sqlite3
from datetime import datetime, timezone
from pathlib import Path

DEFAULT_PROJECT_ROOT = Path(r"F:\DND WEB VTT")
DEFAULT_DB = DEFAULT_PROJECT_ROOT / "data" / "compendium" / "rules_knowledge.sqlite"
DEFAULT_OUTPUT = DEFAULT_PROJECT_ROOT / "_phase6_canonical_title_normalization_v5"

EXPECTED = {
    "runtime_magic": 262,
    "runtime_poison": 14,
    "book_magic": 284,
    "book_poison": 0,
    "residual": 0,
    "old_queue": 0,
    "automation_backlog": 819,
    "effective_extracted": 0,
}

REPAIRS = [
  {
    "content_id": "book-magic-item.2014.dungeon-master-s-guide.cap-of-water-brea-thin-g.158",
    "old_name": "CAP OF WATER BREA THIN G",
    "new_name": "Cap of Water Breathing",
    "rules_version": "2014",
    "source_title": "Dungeon Master's Guide",
    "source_page": 158,
    "evidence_note": "Local indexed source page {sp} identifies this as '{new}'; the stored title is an OCR-corrupted rendering. Only item_name is changed. Stable content ID and engine profile are preserved."
  },
  {
    "content_id": "book-magic-item.2014.dungeon-master-s-guide.cl-oak-of-invisibil-ity.159",
    "old_name": "CL OAK OF INVISIBIL ITY",
    "new_name": "Cloak of Invisibility",
    "rules_version": "2014",
    "source_title": "Dungeon Master's Guide",
    "source_page": 159,
    "evidence_note": "Local indexed source page {sp} identifies this as '{new}'; the stored title is an OCR-corrupted rendering. Only item_name is changed. Stable content ID and engine profile are preserved."
  },
  {
    "content_id": "book-magic-item.2014.dungeon-master-s-guide.daern-s-ins-tant-fortre-ss.161",
    "old_name": "DAERN' S INS TANT FORTRE SS",
    "new_name": "Daern's Instant Fortress",
    "rules_version": "2014",
    "source_title": "Dungeon Master's Guide",
    "source_page": 161,
    "evidence_note": "Local indexed source page {sp} identifies this as '{new}'; the stored title is an OCR-corrupted rendering. Only item_name is changed. Stable content ID and engine profile are preserved."
  },
  {
    "content_id": "book-magic-item.2014.dungeon-master-s-guide.dri-ftglobe.167",
    "old_name": "DRI FTGLOBE",
    "new_name": "Driftglobe",
    "rules_version": "2014",
    "source_title": "Dungeon Master's Guide",
    "source_page": 167,
    "evidence_note": "Local indexed source page {sp} identifies this as '{new}'; the stored title is an OCR-corrupted rendering. Only item_name is changed. Stable content ID and engine profile are preserved."
  },
  {
    "content_id": "book-magic-item.2014.dungeon-master-s-guide.ef-reet-i-chain.168",
    "old_name": "EF REET I CHAIN",
    "new_name": "Efreeti Chain",
    "rules_version": "2014",
    "source_title": "Dungeon Master's Guide",
    "source_page": 168,
    "evidence_note": "Local indexed source page {sp} identifies this as '{new}'; the stored title is an OCR-corrupted rendering. Only item_name is changed. Stable content ID and engine profile are preserved."
  },
  {
    "content_id": "book-magic-item.2014.dungeon-master-s-guide.gloves-of-thie-very.173",
    "old_name": "GLOVES OF THIE VERY",
    "new_name": "Gloves of Thievery",
    "rules_version": "2014",
    "source_title": "Dungeon Master's Guide",
    "source_page": 173,
    "evidence_note": "Local indexed source page {sp} identifies this as '{new}'; the stored title is an OCR-corrupted rendering. Only item_name is changed. Stable content ID and engine profile are preserved."
  },
  {
    "content_id": "book-magic-item.2014.dungeon-master-s-guide.reward-s-hand-y-have-rsack.175",
    "old_name": "REWARD'S HAND Y HAVE RSACK",
    "new_name": "Heward's Handy Haversack",
    "rules_version": "2014",
    "source_title": "Dungeon Master's Guide",
    "source_page": 175,
    "evidence_note": "Local indexed source page {sp} identifies this as '{new}'; the stored title is an OCR-corrupted rendering. Only item_name is changed. Stable content ID and engine profile are preserved."
  },
  {
    "content_id": "book-magic-item.2014.dungeon-master-s-guide.im-movable-ron.176",
    "old_name": "IM MOVABLE Ron",
    "new_name": "Immovable Rod",
    "rules_version": "2014",
    "source_title": "Dungeon Master's Guide",
    "source_page": 176,
    "evidence_note": "Local indexed source page {sp} identifies this as '{new}'; the stored title is an OCR-corrupted rendering. Only item_name is changed. Stable content ID and engine profile are preserved."
  },
  {
    "content_id": "book-magic-item.2014.dungeon-master-s-guide.instrum-ent-of-the-bards.177",
    "old_name": "INSTRUM ENT OF THE BARDS",
    "new_name": "Instrument of the Bards",
    "rules_version": "2014",
    "source_title": "Dungeon Master's Guide",
    "source_page": 177,
    "evidence_note": "Local indexed source page {sp} identifies this as '{new}'; the stored title is an OCR-corrupted rendering. Only item_name is changed. Stable content ID and engine profile are preserved."
  },
  {
    "content_id": "book-magic-item.2014.dungeon-master-s-guide.iron-bands-of-bil-arr-o.178",
    "old_name": "IRON BANDS OF BIL ARR O",
    "new_name": "Iron Bands of Bilarro",
    "rules_version": "2014",
    "source_title": "Dungeon Master's Guide",
    "source_page": 178,
    "evidence_note": "Local indexed source page {sp} identifies this as '{new}'; the stored title is an OCR-corrupted rendering. Only item_name is changed. Stable content ID and engine profile are preserved."
  },
  {
    "content_id": "book-magic-item.2014.dungeon-master-s-guide.keog-htom-s-oi-ntment.180",
    "old_name": "KEOG HTOM 'S OI NTMENT",
    "new_name": "Keoghtom's Ointment",
    "rules_version": "2014",
    "source_title": "Dungeon Master's Guide",
    "source_page": 180,
    "evidence_note": "Local indexed source page {sp} identifies this as '{new}'; the stored title is an OCR-corrupted rendering. Only item_name is changed. Stable content ID and engine profile are preserved."
  },
  {
    "content_id": "book-magic-item.2014.dungeon-master-s-guide.mariner-s-armor.182",
    "old_name": "MARINER 'S ARMOR",
    "new_name": "Mariner's Armor",
    "rules_version": "2014",
    "source_title": "Dungeon Master's Guide",
    "source_page": 182,
    "evidence_note": "Local indexed source page {sp} identifies this as '{new}'; the stored title is an OCR-corrupted rendering. Only item_name is changed. Stable content ID and engine profile are preserved."
  },
  {
    "content_id": "book-magic-item.2014.dungeon-master-s-guide.nolzur-s-marve-lous-pi-gments.184",
    "old_name": "NOLZUR's MARVE LOUS PI GMENTS",
    "new_name": "Nolzur's Marvelous Pigments",
    "rules_version": "2014",
    "source_title": "Dungeon Master's Guide",
    "source_page": 184,
    "evidence_note": "Local indexed source page {sp} identifies this as '{new}'; the stored title is an OCR-corrupted rendering. Only item_name is changed. Stable content ID and engine profile are preserved."
  },
  {
    "content_id": "book-magic-item.2014.dungeon-master-s-guide.quaal-s-feather-token.189",
    "old_name": "QuAAL's FEATHER TOKEN",
    "new_name": "Quaal's Feather Token",
    "rules_version": "2014",
    "source_title": "Dungeon Master's Guide",
    "source_page": 189,
    "evidence_note": "Local indexed source page {sp} identifies this as '{new}'; the stored title is an OCR-corrupted rendering. Only item_name is changed. Stable content ID and engine profile are preserved."
  },
  {
    "content_id": "book-magic-item.2014.dungeon-master-s-guide.quiver-of-eh-lonna.190",
    "old_name": "QUIVER OF EH LONNA",
    "new_name": "Quiver of Ehlonna",
    "rules_version": "2014",
    "source_title": "Dungeon Master's Guide",
    "source_page": 190,
    "evidence_note": "Local indexed source page {sp} identifies this as '{new}'; the stored title is an OCR-corrupted rendering. Only item_name is changed. Stable content ID and engine profile are preserved."
  },
  {
    "content_id": "book-magic-item.2014.dungeon-master-s-guide.ron-of-resurrect-ion.198",
    "old_name": "Ron OF RESURRECT ION",
    "new_name": "Rod of Resurrection",
    "rules_version": "2014",
    "source_title": "Dungeon Master's Guide",
    "source_page": 198,
    "evidence_note": "Local indexed source page {sp} identifies this as '{new}'; the stored title is an OCR-corrupted rendering. Only item_name is changed. Stable content ID and engine profile are preserved."
  },
  {
    "content_id": "book-magic-item.2014.dungeon-master-s-guide.ron-of-secu-rit-y.198",
    "old_name": "Ron OF SECU RIT Y",
    "new_name": "Rod of Security",
    "rules_version": "2014",
    "source_title": "Dungeon Master's Guide",
    "source_page": 198,
    "evidence_note": "Local indexed source page {sp} identifies this as '{new}'; the stored title is an OCR-corrupted rendering. Only item_name is changed. Stable content ID and engine profile are preserved."
  },
  {
    "content_id": "book-magic-item.2014.dungeon-master-s-guide.ron-of-the-pact-keeper.198",
    "old_name": "Ron OF THE PACT KEEPER",
    "new_name": "Rod of the Pact Keeper",
    "rules_version": "2014",
    "source_title": "Dungeon Master's Guide",
    "source_page": 198,
    "evidence_note": "Local indexed source page {sp} identifies this as '{new}'; the stored title is an OCR-corrupted rendering. Only item_name is changed. Stable content ID and engine profile are preserved."
  },
  {
    "content_id": "book-magic-item.2014.dungeon-master-s-guide.scr-oll-of-protection.200",
    "old_name": "SCR OLL OF PROTECTION",
    "new_name": "Scroll of Protection",
    "rules_version": "2014",
    "source_title": "Dungeon Master's Guide",
    "source_page": 200,
    "evidence_note": "Local indexed source page {sp} identifies this as '{new}'; the stored title is an OCR-corrupted rendering. Only item_name is changed. Stable content ID and engine profile are preserved."
  },
  {
    "content_id": "book-magic-item.2014.dungeon-master-s-guide.sentinel-shi-eld.200",
    "old_name": "SENTINEL SHI ELD",
    "new_name": "Sentinel Shield",
    "rules_version": "2014",
    "source_title": "Dungeon Master's Guide",
    "source_page": 200,
    "evidence_note": "Local indexed source page {sp} identifies this as '{new}'; the stored title is an OCR-corrupted rendering. Only item_name is changed. Stable content ID and engine profile are preserved."
  },
  {
    "content_id": "book-magic-item.2014.dungeon-master-s-guide.sword-of-vengea-nce.207",
    "old_name": "SWORD OF VENGEA NCE",
    "new_name": "Sword of Vengeance",
    "rules_version": "2014",
    "source_title": "Dungeon Master's Guide",
    "source_page": 207,
    "evidence_note": "Local indexed source page {sp} identifies this as '{new}'; the stored title is an OCR-corrupted rendering. Only item_name is changed. Stable content ID and engine profile are preserved."
  },
  {
    "content_id": "book-magic-item.2014.dungeon-master-s-guide.bo-ok-of-exal-ted-deeds.223",
    "old_name": "BO OK OF EXAL TED DEEDS",
    "new_name": "Book of Exalted Deeds",
    "rules_version": "2014",
    "source_title": "Dungeon Master's Guide",
    "source_page": 223,
    "evidence_note": "Local indexed source page {sp} identifies this as '{new}'; the stored title is an OCR-corrupted rendering. Only item_name is changed. Stable content ID and engine profile are preserved."
  },
  {
    "content_id": "book-magic-item.2014.dungeon-master-s-guide.orb-of-dr-agon-kind.226",
    "old_name": "ORB OF DR AGON KIND",
    "new_name": "Orb of Dragonkind",
    "rules_version": "2014",
    "source_title": "Dungeon Master's Guide",
    "source_page": 226,
    "evidence_note": "Local indexed source page {sp} identifies this as '{new}'; the stored title is an OCR-corrupted rendering. Only item_name is changed. Stable content ID and engine profile are preserved."
  },
  {
    "content_id": "book-magic-item.2014.dungeon-master-s-guide.wand-of-0rcus.228",
    "old_name": "WAND OF 0RCUS",
    "new_name": "Wand of Orcus",
    "rules_version": "2014",
    "source_title": "Dungeon Master's Guide",
    "source_page": 228,
    "evidence_note": "Local indexed source page {sp} identifies this as '{new}'; the stored title is an OCR-corrupted rendering. Only item_name is changed. Stable content ID and engine profile are preserved."
  },
  {
    "content_id": "book-magic-item.2014.dungeon-master-s-guide.moon-blade.218",
    "old_name": "MOON BLADE",
    "new_name": "Moonblade",
    "rules_version": "2014",
    "source_title": "Dungeon Master's Guide",
    "source_page": 218,
    "evidence_note": "Local indexed source page {sp} identifies this as '{new}'; the stored title is an OCR-corrupted rendering. Only item_name is changed. Stable content ID and engine profile are preserved."
  },
  {
    "content_id": "book-magic-item.2014.tasha-s-cauldron-of-everything.alc-hemic-al-co-mp-endium.120",
    "old_name": "ALC HEMIC AL CO MP ENDIUM",
    "new_name": "Alchemical Compendium",
    "rules_version": "2014",
    "source_title": "Tasha's Cauldron of Everything",
    "source_page": 120,
    "evidence_note": "Local indexed source page {sp} identifies this as '{new}'; the stored title is an OCR-corrupted rendering. Only item_name is changed. Stable content ID and engine profile are preserved."
  },
  {
    "content_id": "book-magic-item.2014.tasha-s-cauldron-of-everything.amu-let-of-the-de-vout.120",
    "old_name": "AMU LET OF THE DE VOUT",
    "new_name": "Amulet of the Devout",
    "rules_version": "2014",
    "source_title": "Tasha's Cauldron of Everything",
    "source_page": 120,
    "evidence_note": "Local indexed source page {sp} identifies this as '{new}'; the stored title is an OCR-corrupted rendering. Only item_name is changed. Stable content ID and engine profile are preserved."
  },
  {
    "content_id": "book-magic-item.2014.tasha-s-cauldron-of-everything.arca-ne-grimoire.121",
    "old_name": "ARCA NE GRIMOIRE",
    "new_name": "Arcane Grimoire",
    "rules_version": "2014",
    "source_title": "Tasha's Cauldron of Everything",
    "source_page": 121,
    "evidence_note": "Local indexed source page {sp} identifies this as '{new}'; the stored title is an OCR-corrupted rendering. Only item_name is changed. Stable content ID and engine profile are preserved."
  },
  {
    "content_id": "book-magic-item.2014.tasha-s-cauldron-of-everything.astr-omancy-arch-ive.121",
    "old_name": "ASTR OMANCY ARCH IVE",
    "new_name": "Astromancy Archive",
    "rules_version": "2014",
    "source_title": "Tasha's Cauldron of Everything",
    "source_page": 121,
    "evidence_note": "Local indexed source page {sp} identifies this as '{new}'; the stored title is an OCR-corrupted rendering. Only item_name is changed. Stable content ID and engine profile are preserved."
  },
  {
    "content_id": "book-magic-item.2014.tasha-s-cauldron-of-everything.atlas-of-en-dless-horizons.121",
    "old_name": "ATLAS OF EN DLESS HORIZONS",
    "new_name": "Atlas of Endless Horizons",
    "rules_version": "2014",
    "source_title": "Tasha's Cauldron of Everything",
    "source_page": 121,
    "evidence_note": "Local indexed source page {sp} identifies this as '{new}'; the stored title is an OCR-corrupted rendering. Only item_name is changed. Stable content ID and engine profile are preserved."
  },
  {
    "content_id": "book-magic-item.2014.tasha-s-cauldron-of-everything.baba-yaga-s-mortar-and-pe-stle.122",
    "old_name": "BABA YAGA'S MORTAR AND PE STLE",
    "new_name": "Baba Yaga's Mortar and Pestle",
    "rules_version": "2014",
    "source_title": "Tasha's Cauldron of Everything",
    "source_page": 122,
    "evidence_note": "Local indexed source page {sp} identifies this as '{new}'; the stored title is an OCR-corrupted rendering. Only item_name is changed. Stable content ID and engine profile are preserved."
  },
  {
    "content_id": "book-magic-item.2014.tasha-s-cauldron-of-everything.blood-wel-l-vial.123",
    "old_name": "BLOOD WEL L VIAL",
    "new_name": "Bloodwell Vial",
    "rules_version": "2014",
    "source_title": "Tasha's Cauldron of Everything",
    "source_page": 123,
    "evidence_note": "Local indexed source page {sp} identifies this as '{new}'; the stored title is an OCR-corrupted rendering. Only item_name is changed. Stable content ID and engine profile are preserved."
  },
  {
    "content_id": "book-magic-item.2014.tasha-s-cauldron-of-everything.cauldron-of-rebir-th.123",
    "old_name": "CAULDRON OF REBIR TH",
    "new_name": "Cauldron of Rebirth",
    "rules_version": "2014",
    "source_title": "Tasha's Cauldron of Everything",
    "source_page": 123,
    "evidence_note": "Local indexed source page {sp} identifies this as '{new}'; the stored title is an OCR-corrupted rendering. Only item_name is changed. Stable content ID and engine profile are preserved."
  },
  {
    "content_id": "book-magic-item.2014.tasha-s-cauldron-of-everything.cr-ook-of-rao.124",
    "old_name": "CR OOK OF RAO",
    "new_name": "Crook of Rao",
    "rules_version": "2014",
    "source_title": "Tasha's Cauldron of Everything",
    "source_page": 124,
    "evidence_note": "Local indexed source page {sp} identifies this as '{new}'; the stored title is an OCR-corrupted rendering. Only item_name is changed. Stable content ID and engine profile are preserved."
  },
  {
    "content_id": "book-magic-item.2014.tasha-s-cauldron-of-everything.crystalli-ne-chr-onicl-e.125",
    "old_name": "CRYSTALLI NE CHR ONICL E",
    "new_name": "Crystalline Chronicle",
    "rules_version": "2014",
    "source_title": "Tasha's Cauldron of Everything",
    "source_page": 125,
    "evidence_note": "Local indexed source page {sp} identifies this as '{new}'; the stored title is an OCR-corrupted rendering. Only item_name is changed. Stable content ID and engine profile are preserved."
  },
  {
    "content_id": "book-magic-item.2014.tasha-s-cauldron-of-everything.demo-nomicon-of-lgg-wilv.126",
    "old_name": "DEMO NOMICON OF lGG WILV",
    "new_name": "Demonomicon of Iggwilv",
    "rules_version": "2014",
    "source_title": "Tasha's Cauldron of Everything",
    "source_page": 126,
    "evidence_note": "Local indexed source page {sp} identifies this as '{new}'; the stored title is an OCR-corrupted rendering. Only item_name is changed. Stable content ID and engine profile are preserved."
  },
  {
    "content_id": "book-magic-item.2014.tasha-s-cauldron-of-everything.devotee-s-ce-nser.127",
    "old_name": "DEVOTEE'S CE NSER",
    "new_name": "Devotee's Censer",
    "rules_version": "2014",
    "source_title": "Tasha's Cauldron of Everything",
    "source_page": 127,
    "evidence_note": "Local indexed source page {sp} identifies this as '{new}'; the stored title is an OCR-corrupted rendering. Only item_name is changed. Stable content ID and engine profile are preserved."
  },
  {
    "content_id": "book-magic-item.2014.tasha-s-cauldron-of-everything.dupl-ic-itous-manuscrip-t.127",
    "old_name": "DUPL IC ITOUS MANUSCRIP T",
    "new_name": "Duplicitous Manuscript",
    "rules_version": "2014",
    "source_title": "Tasha's Cauldron of Everything",
    "source_page": 127,
    "evidence_note": "Local indexed source page {sp} identifies this as '{new}'; the stored title is an OCR-corrupted rendering. Only item_name is changed. Stable content ID and engine profile are preserved."
  },
  {
    "content_id": "book-magic-item.2014.tasha-s-cauldron-of-everything.eleme-ntal-es-sence-shard.128",
    "old_name": "ELEME NTAL ES SENCE SHARD",
    "new_name": "Elemental Essence Shard",
    "rules_version": "2014",
    "source_title": "Tasha's Cauldron of Everything",
    "source_page": 128,
    "evidence_note": "Local indexed source page {sp} identifies this as '{new}'; the stored title is an OCR-corrupted rendering. Only item_name is changed. Stable content ID and engine profile are preserved."
  },
  {
    "content_id": "book-magic-item.2014.tasha-s-cauldron-of-everything.feyw-ild-shard.128",
    "old_name": "FEYW ILD SHARD",
    "new_name": "Feywild Shard",
    "rules_version": "2014",
    "source_title": "Tasha's Cauldron of Everything",
    "source_page": 128,
    "evidence_note": "Local indexed source page {sp} identifies this as '{new}'; the stored title is an OCR-corrupted rendering. Only item_name is changed. Stable content ID and engine profile are preserved."
  },
  {
    "content_id": "book-magic-item.2014.tasha-s-cauldron-of-everything.ful-min-atin-g-treatise.129",
    "old_name": "FUL MIN ATIN G TREATISE",
    "new_name": "Fulminating Treatise",
    "rules_version": "2014",
    "source_title": "Tasha's Cauldron of Everything",
    "source_page": 129,
    "evidence_note": "Local indexed source page {sp} identifies this as '{new}'; the stored title is an OCR-corrupted rendering. Only item_name is changed. Stable content ID and engine profile are preserved."
  },
  {
    "content_id": "book-magic-item.2014.tasha-s-cauldron-of-everything.hear-t-weaver-s-primer.129",
    "old_name": "HEAR T WEAVER 'S PRIMER",
    "new_name": "Heart Weaver's Primer",
    "rules_version": "2014",
    "source_title": "Tasha's Cauldron of Everything",
    "source_page": 129,
    "evidence_note": "Local indexed source page {sp} identifies this as '{new}'; the stored title is an OCR-corrupted rendering. Only item_name is changed. Stable content ID and engine profile are preserved."
  },
  {
    "content_id": "book-magic-item.2014.tasha-s-cauldron-of-everything.libram-of-souls-and-fle-sh.130",
    "old_name": "LIBRAM OF SOULS AND FLE SH",
    "new_name": "Libram of Souls and Flesh",
    "rules_version": "2014",
    "source_title": "Tasha's Cauldron of Everything",
    "source_page": 130,
    "evidence_note": "Local indexed source page {sp} identifies this as '{new}'; the stored title is an OCR-corrupted rendering. Only item_name is changed. Stable content ID and engine profile are preserved."
  },
  {
    "content_id": "book-magic-item.2014.tasha-s-cauldron-of-everything.luba-s-tarokka-of-souls.130",
    "old_name": "LUBA'S TAROKKA OF SOULS",
    "new_name": "Luba's Tarokka of Souls",
    "rules_version": "2014",
    "source_title": "Tasha's Cauldron of Everything",
    "source_page": 130,
    "evidence_note": "Local indexed source page {sp} identifies this as '{new}'; the stored title is an OCR-corrupted rendering. Only item_name is changed. Stable content ID and engine profile are preserved."
  },
  {
    "content_id": "book-magic-item.2014.tasha-s-cauldron-of-everything.mi-ghty-se-rvant-of-leuk-0.132",
    "old_name": "MI GHTY SE RVANT OF LEUK -0",
    "new_name": "Mighty Servant of Leuk-o",
    "rules_version": "2014",
    "source_title": "Tasha's Cauldron of Everything",
    "source_page": 132,
    "evidence_note": "Local indexed source page {sp} identifies this as '{new}'; the stored title is an OCR-corrupted rendering. Only item_name is changed. Stable content ID and engine profile are preserved."
  },
  {
    "content_id": "book-magic-item.2014.tasha-s-cauldron-of-everything.moon-sickle.134",
    "old_name": "MOON SICKLE",
    "new_name": "Moon Sickle",
    "rules_version": "2014",
    "source_title": "Tasha's Cauldron of Everything",
    "source_page": 134,
    "evidence_note": "Local indexed source page {sp} identifies this as '{new}'; the stored title is an OCR-corrupted rendering. Only item_name is changed. Stable content ID and engine profile are preserved."
  },
  {
    "content_id": "book-magic-item.2014.tasha-s-cauldron-of-everything.outer-ess-ence-shard.134",
    "old_name": "OUTER ESS ENCE SHARD",
    "new_name": "Outer Essence Shard",
    "rules_version": "2014",
    "source_title": "Tasha's Cauldron of Everything",
    "source_page": 134,
    "evidence_note": "Local indexed source page {sp} identifies this as '{new}'; the stored title is an OCR-corrupted rendering. Only item_name is changed. Stable content ID and engine profile are preserved."
  },
  {
    "content_id": "book-magic-item.2014.tasha-s-cauldron-of-everything.plan-ecaller-1s-co-dex.135",
    "old_name": "PLAN ECALLER 1S CO DEX",
    "new_name": "Planecaller's Codex",
    "rules_version": "2014",
    "source_title": "Tasha's Cauldron of Everything",
    "source_page": 135,
    "evidence_note": "Local indexed source page {sp} identifies this as '{new}'; the stored title is an OCR-corrupted rendering. Only item_name is changed. Stable content ID and engine profile are preserved."
  },
  {
    "content_id": "book-magic-item.2014.tasha-s-cauldron-of-everything.prosth-etic-limb.135",
    "old_name": "PROSTH ETIC LIMB",
    "new_name": "Prosthetic Limb",
    "rules_version": "2014",
    "source_title": "Tasha's Cauldron of Everything",
    "source_page": 135,
    "evidence_note": "Local indexed source page {sp} identifies this as '{new}'; the stored title is an OCR-corrupted rendering. Only item_name is changed. Stable content ID and engine profile are preserved."
  },
  {
    "content_id": "book-magic-item.2014.tasha-s-cauldron-of-everything.reveler-s-co-ncer-tin-a.135",
    "old_name": "REVELER'S CO NCER TIN A",
    "new_name": "Reveler's Concertina",
    "rules_version": "2014",
    "source_title": "Tasha's Cauldron of Everything",
    "source_page": 135,
    "evidence_note": "Local indexed source page {sp} identifies this as '{new}'; the stored title is an OCR-corrupted rendering. Only item_name is changed. Stable content ID and engine profile are preserved."
  },
  {
    "content_id": "book-magic-item.2014.tasha-s-cauldron-of-everything.rh-yth-m-maker-s-drum.135",
    "old_name": "RH YTH M-MAKER 'S DRUM",
    "new_name": "Rhythm-Maker's Drum",
    "rules_version": "2014",
    "source_title": "Tasha's Cauldron of Everything",
    "source_page": 135,
    "evidence_note": "Local indexed source page {sp} identifies this as '{new}'; the stored title is an OCR-corrupted rendering. Only item_name is changed. Stable content ID and engine profile are preserved."
  },
  {
    "content_id": "book-magic-item.2014.xanathar-s-guide-to-everything.bootsor-falsetracks.137",
    "old_name": "BOOTSor FALSETRACKS",
    "new_name": "Boots of False Tracks",
    "rules_version": "2014",
    "source_title": "Xanathar's Guide to Everything",
    "source_page": 137,
    "evidence_note": "Local indexed source page {sp} identifies this as '{new}'; the stored title is an OCR-corrupted rendering. Only item_name is changed. Stable content ID and engine profile are preserved."
  },
  {
    "content_id": "book-magic-item.2014.xanathar-s-guide-to-everything.candle-ofthe-deep.137",
    "old_name": "CANDLE OFTHE DEEP",
    "new_name": "Candle of the Deep",
    "rules_version": "2014",
    "source_title": "Xanathar's Guide to Everything",
    "source_page": 137,
    "evidence_note": "Local indexed source page {sp} identifies this as '{new}'; the stored title is an OCR-corrupted rendering. Only item_name is changed. Stable content ID and engine profile are preserved."
  },
  {
    "content_id": "book-magic-item.2014.xanathar-s-guide-to-everything.cast-off-armor.137",
    "old_name": "CAST—OFF ARMOR",
    "new_name": "Cast-Off Armor",
    "rules_version": "2014",
    "source_title": "Xanathar's Guide to Everything",
    "source_page": 137,
    "evidence_note": "Local indexed source page {sp} identifies this as '{new}'; the stored title is an OCR-corrupted rendering. Only item_name is changed. Stable content ID and engine profile are preserved."
  },
  {
    "content_id": "book-magic-item.2014.xanathar-s-guide-to-everything.cloak-or-many-fashions.137",
    "old_name": "CLOAK or MANY FASHIONS",
    "new_name": "Cloak of Many Fashions",
    "rules_version": "2014",
    "source_title": "Xanathar's Guide to Everything",
    "source_page": 137,
    "evidence_note": "Local indexed source page {sp} identifies this as '{new}'; the stored title is an OCR-corrupted rendering. Only item_name is changed. Stable content ID and engine profile are preserved."
  },
  {
    "content_id": "book-magic-item.2014.xanathar-s-guide-to-everything.dark-shardamulet.138",
    "old_name": "DARK SHARDAMULET",
    "new_name": "Dark Shard Amulet",
    "rules_version": "2014",
    "source_title": "Xanathar's Guide to Everything",
    "source_page": 138,
    "evidence_note": "Local indexed source page {sp} identifies this as '{new}'; the stored title is an OCR-corrupted rendering. Only item_name is changed. Stable content ID and engine profile are preserved."
  },
  {
    "content_id": "book-magic-item.2014.xanathar-s-guide-to-everything.ersatzeye.138",
    "old_name": "ERSATZEYE",
    "new_name": "Ersatz Eye",
    "rules_version": "2014",
    "source_title": "Xanathar's Guide to Everything",
    "source_page": 138,
    "evidence_note": "Local indexed source page {sp} identifies this as '{new}'; the stored title is an OCR-corrupted rendering. Only item_name is changed. Stable content ID and engine profile are preserved."
  },
  {
    "content_id": "book-magic-item.2014.xanathar-s-guide-to-everything.hat-ofwizardry.138",
    "old_name": "HAT OFWIZARDRY",
    "new_name": "Hat of Wizardry",
    "rules_version": "2014",
    "source_title": "Xanathar's Guide to Everything",
    "source_page": 138,
    "evidence_note": "Local indexed source page {sp} identifies this as '{new}'; the stored title is an OCR-corrupted rendering. Only item_name is changed. Stable content ID and engine profile are preserved."
  },
  {
    "content_id": "book-magic-item.2014.xanathar-s-guide-to-everything.instrumentof-illusions.138",
    "old_name": "INSTRUMENTOF ILLUSIONS",
    "new_name": "Instrument of Illusions",
    "rules_version": "2014",
    "source_title": "Xanathar's Guide to Everything",
    "source_page": 138,
    "evidence_note": "Local indexed source page {sp} identifies this as '{new}'; the stored title is an OCR-corrupted rendering. Only item_name is changed. Stable content ID and engine profile are preserved."
  },
  {
    "content_id": "book-magic-item.2014.xanathar-s-guide-to-everything.instrumentof-sgribing.139",
    "old_name": "INSTRUMENTOF SGRIBING",
    "new_name": "Instrument of Scribing",
    "rules_version": "2014",
    "source_title": "Xanathar's Guide to Everything",
    "source_page": 139,
    "evidence_note": "Local indexed source page {sp} identifies this as '{new}'; the stored title is an OCR-corrupted rendering. Only item_name is changed. Stable content ID and engine profile are preserved."
  },
  {
    "content_id": "book-magic-item.2014.xanathar-s-guide-to-everything.moon-touched-sword.139",
    "old_name": "MOON—TOUCHED SWORD",
    "new_name": "Moon-Touched Sword",
    "rules_version": "2014",
    "source_title": "Xanathar's Guide to Everything",
    "source_page": 139,
    "evidence_note": "Local indexed source page {sp} identifies this as '{new}'; the stored title is an OCR-corrupted rendering. Only item_name is changed. Stable content ID and engine profile are preserved."
  },
  {
    "content_id": "book-magic-item.2014.xanathar-s-guide-to-everything.orb-of-time.139",
    "old_name": "ORB OF TiME",
    "new_name": "Orb of Time",
    "rules_version": "2014",
    "source_title": "Xanathar's Guide to Everything",
    "source_page": 139,
    "evidence_note": "Local indexed source page {sp} identifies this as '{new}'; the stored title is an OCR-corrupted rendering. Only item_name is changed. Stable content ID and engine profile are preserved."
  },
  {
    "content_id": "book-magic-item.2014.xanathar-s-guide-to-everything.wallopingamm-unition.140",
    "old_name": "WALLOPINGAMM UNITION",
    "new_name": "Walloping Ammunition",
    "rules_version": "2014",
    "source_title": "Xanathar's Guide to Everything",
    "source_page": 140,
    "evidence_note": "Local indexed source page {sp} identifies this as '{new}'; the stored title is an OCR-corrupted rendering. Only item_name is changed. Stable content ID and engine profile are preserved."
  },
  {
    "content_id": "book-magic-item.2024.dungeon-master-s-guide.axe-of-the-dwarvish-lorps.235",
    "old_name": "AXE OF THE DwarvisH Lorps",
    "new_name": "Axe of the Dwarvish Lords",
    "rules_version": "2024",
    "source_title": "Dungeon Master's Guide",
    "source_page": 235,
    "evidence_note": "Local indexed source page {sp} identifies this as '{new}'; the stored title is an OCR-corrupted rendering. Only item_name is changed. Stable content ID and engine profile are preserved."
  },
  {
    "content_id": "book-magic-item.2024.dungeon-master-s-guide.basa-yaoa-s-dancing-broom.236",
    "old_name": "Basa Yaoa's DANCING BROOM",
    "new_name": "Baba Yaga's Dancing Broom",
    "rules_version": "2024",
    "source_title": "Dungeon Master's Guide",
    "source_page": 236,
    "evidence_note": "Local indexed source page {sp} identifies this as '{new}'; the stored title is an OCR-corrupted rendering. Only item_name is changed. Stable content ID and engine profile are preserved."
  },
  {
    "content_id": "book-magic-item.2024.dungeon-master-s-guide.boors-of-false-tracks.243",
    "old_name": "Boors OF FALSE TRACKS",
    "new_name": "Boots of False Tracks",
    "rules_version": "2024",
    "source_title": "Dungeon Master's Guide",
    "source_page": 243,
    "evidence_note": "Local indexed source page {sp} identifies this as '{new}'; the stored title is an OCR-corrupted rendering. Only item_name is changed. Stable content ID and engine profile are preserved."
  },
  {
    "content_id": "book-magic-item.2024.dungeon-master-s-guide.cap-of-water-breathing.246",
    "old_name": "Cap OF WATER BREATHING",
    "new_name": "Cap of Water Breathing",
    "rules_version": "2024",
    "source_title": "Dungeon Master's Guide",
    "source_page": 246,
    "evidence_note": "Local indexed source page {sp} identifies this as '{new}'; the stored title is an OCR-corrupted rendering. Only item_name is changed. Stable content ID and engine profile are preserved."
  },
  {
    "content_id": "book-magic-item.2024.dungeon-master-s-guide.cuarzatan-s-diz.247",
    "old_name": "Cuarzatan’s Diz",
    "new_name": "Charlatan's Die",
    "rules_version": "2024",
    "source_title": "Dungeon Master's Guide",
    "source_page": 247,
    "evidence_note": "Local indexed source page {sp} identifies this as '{new}'; the stored title is an OCR-corrupted rendering. Only item_name is changed. Stable content ID and engine profile are preserved."
  },
  {
    "content_id": "book-magic-item.2024.dungeon-master-s-guide.cuse-of-summoning.251",
    "old_name": "Cuse OF SUMMONING",
    "new_name": "Cube of Summoning",
    "rules_version": "2024",
    "source_title": "Dungeon Master's Guide",
    "source_page": 251,
    "evidence_note": "Local indexed source page {sp} identifies this as '{new}'; the stored title is an OCR-corrupted rendering. Only item_name is changed. Stable content ID and engine profile are preserved."
  },
  {
    "content_id": "book-magic-item.2024.dungeon-master-s-guide.deck-of-many-things.254",
    "old_name": "DECK oF Many THINGS",
    "new_name": "Deck of Many Things",
    "rules_version": "2024",
    "source_title": "Dungeon Master's Guide",
    "source_page": 254,
    "evidence_note": "Local indexed source page {sp} identifies this as '{new}'; the stored title is an OCR-corrupted rendering. Only item_name is changed. Stable content ID and engine profile are preserved."
  },
  {
    "content_id": "book-magic-item.2024.dungeon-master-s-guide.dreap-helm.258",
    "old_name": "Dreap HELM",
    "new_name": "Dread Helm",
    "rules_version": "2024",
    "source_title": "Dungeon Master's Guide",
    "source_page": 258,
    "evidence_note": "Local indexed source page {sp} identifies this as '{new}'; the stored title is an OCR-corrupted rendering. Only item_name is changed. Stable content ID and engine profile are preserved."
  },
  {
    "content_id": "book-magic-item.2024.dungeon-master-s-guide.ear-horn-of-hearing.260",
    "old_name": "EAR Horn OF HEARING",
    "new_name": "Ear Horn of Hearing",
    "rules_version": "2024",
    "source_title": "Dungeon Master's Guide",
    "source_page": 260,
    "evidence_note": "Local indexed source page {sp} identifies this as '{new}'; the stored title is an OCR-corrupted rendering. Only item_name is changed. Stable content ID and engine profile are preserved."
  },
  {
    "content_id": "book-magic-item.2024.dungeon-master-s-guide.eneercy-bow.261",
    "old_name": "EneERcy Bow",
    "new_name": "Energy Bow",
    "rules_version": "2024",
    "source_title": "Dungeon Master's Guide",
    "source_page": 261,
    "evidence_note": "Local indexed source page {sp} identifies this as '{new}'; the stored title is an OCR-corrupted rendering. Only item_name is changed. Stable content ID and engine profile are preserved."
  },
  {
    "content_id": "book-magic-item.2024.dungeon-master-s-guide.evoxir-of-health.261",
    "old_name": "Evoxir OF HEALTH",
    "new_name": "Elixir of Health",
    "rules_version": "2024",
    "source_title": "Dungeon Master's Guide",
    "source_page": 261,
    "evidence_note": "Local indexed source page {sp} identifies this as '{new}'; the stored title is an OCR-corrupted rendering. Only item_name is changed. Stable content ID and engine profile are preserved."
  },
  {
    "content_id": "book-magic-item.2024.dungeon-master-s-guide.ersatz-eve.263",
    "old_name": "Ersatz EVE",
    "new_name": "Ersatz Eye",
    "rules_version": "2024",
    "source_title": "Dungeon Master's Guide",
    "source_page": 263,
    "evidence_note": "Local indexed source page {sp} identifies this as '{new}'; the stored title is an OCR-corrupted rendering. Only item_name is changed. Stable content ID and engine profile are preserved."
  },
  {
    "content_id": "book-magic-item.2024.dungeon-master-s-guide.har-of-many-srells.270",
    "old_name": "Har oF Many SrELLs",
    "new_name": "Hat of Many Spells",
    "rules_version": "2024",
    "source_title": "Dungeon Master's Guide",
    "source_page": 270,
    "evidence_note": "Local indexed source page {sp} identifies this as '{new}'; the stored title is an OCR-corrupted rendering. Only item_name is changed. Stable content ID and engine profile are preserved."
  },
  {
    "content_id": "book-magic-item.2024.dungeon-master-s-guide.hewarp-s-hanpy-spice-poucy.273",
    "old_name": "Hewarp's Hanpy Spice Poucy",
    "new_name": "Heward's Handy Spice Pouch",
    "rules_version": "2024",
    "source_title": "Dungeon Master's Guide",
    "source_page": 273,
    "evidence_note": "Local indexed source page {sp} identifies this as '{new}'; the stored title is an OCR-corrupted rendering. Only item_name is changed. Stable content ID and engine profile are preserved."
  },
  {
    "content_id": "book-magic-item.2024.dungeon-master-s-guide.horn-or-silent-alarm.274",
    "old_name": "Horn or SILENT ALARM",
    "new_name": "Horn of Silent Alarm",
    "rules_version": "2024",
    "source_title": "Dungeon Master's Guide",
    "source_page": 274,
    "evidence_note": "Local indexed source page {sp} identifies this as '{new}'; the stored title is an OCR-corrupted rendering. Only item_name is changed. Stable content ID and engine profile are preserved."
  },
  {
    "content_id": "book-magic-item.2024.dungeon-master-s-guide.lute-or-thunderous-thumping.279",
    "old_name": "Lute or THUNDEROUS THUMPING",
    "new_name": "Lute of Thunderous Thumping",
    "rules_version": "2024",
    "source_title": "Dungeon Master's Guide",
    "source_page": 279,
    "evidence_note": "Local indexed source page {sp} identifies this as '{new}'; the stored title is an OCR-corrupted rendering. Only item_name is changed. Stable content ID and engine profile are preserved."
  },
  {
    "content_id": "book-magic-item.2024.dungeon-master-s-guide.manat-or-boptty-health.281",
    "old_name": "Manat or Boptty HEALTH",
    "new_name": "Manual of Bodily Health",
    "rules_version": "2024",
    "source_title": "Dungeon Master's Guide",
    "source_page": 281,
    "evidence_note": "Local indexed source page {sp} identifies this as '{new}'; the stored title is an OCR-corrupted rendering. Only item_name is changed. Stable content ID and engine profile are preserved."
  },
  {
    "content_id": "book-magic-item.2024.dungeon-master-s-guide.nouzur-s-marvelous-pigments.285",
    "old_name": "Nouzur's MARVELOUS PIGMENTS",
    "new_name": "Nolzur's Marvelous Pigments",
    "rules_version": "2024",
    "source_title": "Dungeon Master's Guide",
    "source_page": 285,
    "evidence_note": "Local indexed source page {sp} identifies this as '{new}'; the stored title is an OCR-corrupted rendering. Only item_name is changed. Stable content ID and engine profile are preserved."
  },
  {
    "content_id": "book-magic-item.2024.dungeon-master-s-guide.ors-of-dragonkind.287",
    "old_name": "Ors OF DRAGONKIND",
    "new_name": "Orb of Dragonkind",
    "rules_version": "2024",
    "source_title": "Dungeon Master's Guide",
    "source_page": 287,
    "evidence_note": "Local indexed source page {sp} identifies this as '{new}'; the stored title is an OCR-corrupted rendering. Only item_name is changed. Stable content ID and engine profile are preserved."
  },
  {
    "content_id": "book-magic-item.2024.dungeon-master-s-guide.prpe-of-smoke-monsters.289",
    "old_name": "Prpe of SMOKE MONSTERS",
    "new_name": "Pipe of Smoke Monsters",
    "rules_version": "2024",
    "source_title": "Dungeon Master's Guide",
    "source_page": 289,
    "evidence_note": "Local indexed source page {sp} identifies this as '{new}'; the stored title is an OCR-corrupted rendering. Only item_name is changed. Stable content ID and engine profile are preserved."
  },
  {
    "content_id": "book-magic-item.2024.dungeon-master-s-guide.potion-of-comprehension.291",
    "old_name": "PoTION OF COMPREHENSION",
    "new_name": "Potion of Comprehension",
    "rules_version": "2024",
    "source_title": "Dungeon Master's Guide",
    "source_page": 291,
    "evidence_note": "Local indexed source page {sp} identifies this as '{new}'; the stored title is an OCR-corrupted rendering. Only item_name is changed. Stable content ID and engine profile are preserved."
  },
  {
    "content_id": "book-magic-item.2024.dungeon-master-s-guide.prosthetic-limb.294",
    "old_name": "ProstHETic LimB",
    "new_name": "Prosthetic Limb",
    "rules_version": "2024",
    "source_title": "Dungeon Master's Guide",
    "source_page": 294,
    "evidence_note": "Local indexed source page {sp} identifies this as '{new}'; the stored title is an OCR-corrupted rendering. Only item_name is changed. Stable content ID and engine profile are preserved."
  },
  {
    "content_id": "book-magic-item.2024.dungeon-master-s-guide.quaau-s-feather-token.294",
    "old_name": "Quaau's FEATHER TOKEN",
    "new_name": "Quaal's Feather Token",
    "rules_version": "2024",
    "source_title": "Dungeon Master's Guide",
    "source_page": 294,
    "evidence_note": "Local indexed source page {sp} identifies this as '{new}'; the stored title is an OCR-corrupted rendering. Only item_name is changed. Stable content ID and engine profile are preserved."
  },
  {
    "content_id": "book-magic-item.2024.dungeon-master-s-guide.riva-coin.300",
    "old_name": "Riva Coin",
    "new_name": "Rival Coin",
    "rules_version": "2024",
    "source_title": "Dungeon Master's Guide",
    "source_page": 300,
    "evidence_note": "Local indexed source page {sp} identifies this as '{new}'; the stored title is an OCR-corrupted rendering. Only item_name is changed. Stable content ID and engine profile are preserved."
  },
  {
    "content_id": "book-magic-item.2024.dungeon-master-s-guide.rop-of-resurrection.305",
    "old_name": "Rop OF RESURRECTION",
    "new_name": "Rod of Resurrection",
    "rules_version": "2024",
    "source_title": "Dungeon Master's Guide",
    "source_page": 305,
    "evidence_note": "Local indexed source page {sp} identifies this as '{new}'; the stored title is an OCR-corrupted rendering. Only item_name is changed. Stable content ID and engine profile are preserved."
  },
  {
    "content_id": "book-magic-item.2024.dungeon-master-s-guide.rop-of-the-pact-keeper.305",
    "old_name": "Rop oF THE Pact KEEPER",
    "new_name": "Rod of the Pact Keeper",
    "rules_version": "2024",
    "source_title": "Dungeon Master's Guide",
    "source_page": 305,
    "evidence_note": "Local indexed source page {sp} identifies this as '{new}'; the stored title is an OCR-corrupted rendering. Only item_name is changed. Stable content ID and engine profile are preserved."
  },
  {
    "content_id": "book-magic-item.2024.dungeon-master-s-guide.ruby-of-the-war-mace.306",
    "old_name": "Ruby OF THE WAR MacE",
    "new_name": "Ruby of the War Mage",
    "rules_version": "2024",
    "source_title": "Dungeon Master's Guide",
    "source_page": 306,
    "evidence_note": "Local indexed source page {sp} identifies this as '{new}'; the stored title is an OCR-corrupted rendering. Only item_name is changed. Stable content ID and engine profile are preserved."
  },
  {
    "content_id": "book-magic-item.2024.dungeon-master-s-guide.scroll-of-titan-summoning.307",
    "old_name": "ScROLL OF TITAN SUMMONING",
    "new_name": "Scroll of Titan Summoning",
    "rules_version": "2024",
    "source_title": "Dungeon Master's Guide",
    "source_page": 307,
    "evidence_note": "Local indexed source page {sp} identifies this as '{new}'; the stored title is an OCR-corrupted rendering. Only item_name is changed. Stable content ID and engine profile are preserved."
  },
  {
    "content_id": "book-magic-item.2024.dungeon-master-s-guide.sprrit-boarp.310",
    "old_name": "Sprrit Boarp",
    "new_name": "Spirit Board",
    "rules_version": "2024",
    "source_title": "Dungeon Master's Guide",
    "source_page": 310,
    "evidence_note": "Local indexed source page {sp} identifies this as '{new}'; the stored title is an OCR-corrupted rendering. Only item_name is changed. Stable content ID and engine profile are preserved."
  },
  {
    "content_id": "book-magic-item.2024.dungeon-master-s-guide.sworp-of-answering.317",
    "old_name": "Sworp OF ANSWERING",
    "new_name": "Sword of Answering",
    "rules_version": "2024",
    "source_title": "Dungeon Master's Guide",
    "source_page": 317,
    "evidence_note": "Local indexed source page {sp} identifies this as '{new}'; the stored title is an OCR-corrupted rendering. Only item_name is changed. Stable content ID and engine profile are preserved."
  },
  {
    "content_id": "book-magic-item.2024.dungeon-master-s-guide.sworp-of-vengeance.318",
    "old_name": "Sworp OF VENGEANCE",
    "new_name": "Sword of Vengeance",
    "rules_version": "2024",
    "source_title": "Dungeon Master's Guide",
    "source_page": 318,
    "evidence_note": "Local indexed source page {sp} identifies this as '{new}'; the stored title is an OCR-corrupted rendering. Only item_name is changed. Stable content ID and engine profile are preserved."
  },
  {
    "content_id": "book-magic-item.2024.dungeon-master-s-guide.sworp-of-lire-stealing.318",
    "old_name": "Sworp oF Lire STEALING",
    "new_name": "Sword of Life Stealing",
    "rules_version": "2024",
    "source_title": "Dungeon Master's Guide",
    "source_page": 318,
    "evidence_note": "Local indexed source page {sp} identifies this as '{new}'; the stored title is an OCR-corrupted rendering. Only item_name is changed. Stable content ID and engine profile are preserved."
  },
  {
    "content_id": "book-magic-item.2024.dungeon-master-s-guide.tentacle-rop.320",
    "old_name": "TENTACLE Rop",
    "new_name": "Tentacle Rod",
    "rules_version": "2024",
    "source_title": "Dungeon Master's Guide",
    "source_page": 320,
    "evidence_note": "Local indexed source page {sp} identifies this as '{new}'; the stored title is an OCR-corrupted rendering. Only item_name is changed. Stable content ID and engine profile are preserved."
  },
  {
    "content_id": "book-magic-item.2024.dungeon-master-s-guide.thunderous-greatclub.320",
    "old_name": "‘THUNDEROUS GREATCLUB",
    "new_name": "Thunderous Greatclub",
    "rules_version": "2024",
    "source_title": "Dungeon Master's Guide",
    "source_page": 320,
    "evidence_note": "Local indexed source page {sp} identifies this as '{new}'; the stored title is an OCR-corrupted rendering. Only item_name is changed. Stable content ID and engine profile are preserved."
  },
  {
    "content_id": "book-magic-item.2024.dungeon-master-s-guide.tome-of-the-stilled-tongue.321",
    "old_name": "ToME OF THE STILLED TONGUE",
    "new_name": "Tome of the Stilled Tongue",
    "rules_version": "2024",
    "source_title": "Dungeon Master's Guide",
    "source_page": 321,
    "evidence_note": "Local indexed source page {sp} identifies this as '{new}'; the stored title is an OCR-corrupted rendering. Only item_name is changed. Stable content ID and engine profile are preserved."
  },
  {
    "content_id": "book-magic-item.2024.dungeon-master-s-guide.wraps-of-unarmed-power.329",
    "old_name": "Wraps OF UNARMED POWER",
    "new_name": "Wraps of Unarmed Power",
    "rules_version": "2024",
    "source_title": "Dungeon Master's Guide",
    "source_page": 329,
    "evidence_note": "Local indexed source page {sp} identifies this as '{new}'; the stored title is an OCR-corrupted rendering. Only item_name is changed. Stable content ID and engine profile are preserved."
  }
]

def now_iso():
    return datetime.now(timezone.utc).isoformat()

def sha256(path: Path) -> str:
    h=hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda:f.read(1024*1024), b""):
            h.update(chunk)
    return h.hexdigest()

def state(db):
    q=lambda sql: db.execute(sql).fetchone()[0]
    return {
        "runtime_magic": q("SELECT COUNT(*) FROM magic_item_registry"),
        "runtime_poison": q("SELECT COUNT(*) FROM poison_registry"),
        "book_magic": q("SELECT COUNT(*) FROM book_magic_item_registry"),
        "book_poison": q("SELECT COUNT(*) FROM book_poison_registry"),
        "residual": q("SELECT COUNT(*) FROM phase6_residual_review_queue"),
        "old_queue": q("SELECT COUNT(*) FROM phase6_content_review_queue"),
        "automation_backlog": q("SELECT COUNT(*) FROM phase6_automation_backlog"),
        "effective_extracted": q("""SELECT COUNT(*) FROM effective_validated_entities WHERE status='extracted'"""),
    }

def require_state(actual, expected, label):
    if actual != expected:
        raise RuntimeError(f"{label} state mismatch. expected={expected} actual={actual}")

def table_digest(db, table, order_by):
    cols=[r[1] for r in db.execute(f"PRAGMA table_info({table})")]
    rows=db.execute(f"SELECT * FROM {table} ORDER BY {order_by}").fetchall()
    blob=json.dumps({"columns":cols,"rows":[list(r) for r in rows]}, ensure_ascii=False, separators=(",",":"), default=str)
    return hashlib.sha256(blob.encode("utf-8")).hexdigest()

def ensure_schema(db):
    db.executescript("""
    CREATE TABLE IF NOT EXISTS phase6_title_normalization_batches(
      id TEXT PRIMARY KEY,
      created_at TEXT NOT NULL,
      source_db_sha256 TEXT NOT NULL,
      repairs INTEGER NOT NULL,
      profile_digest_before TEXT NOT NULL,
      profile_digest_after TEXT NOT NULL,
      backlog_digest_before TEXT NOT NULL,
      backlog_digest_after TEXT NOT NULL,
      post_book_magic_count INTEGER NOT NULL,
      phase_status TEXT NOT NULL
    ) STRICT;
    CREATE TABLE IF NOT EXISTS phase6_title_normalization_resolution(
      content_id TEXT PRIMARY KEY,
      entity_version_id TEXT,
      old_name TEXT NOT NULL,
      new_name TEXT NOT NULL,
      rules_version TEXT NOT NULL,
      source_title TEXT NOT NULL,
      source_page INTEGER,
      evidence_note TEXT NOT NULL,
      batch_id TEXT NOT NULL
    ) STRICT;
    """)

def verify_preconditions(db):
    require_state(state(db), EXPECTED, "V5 precondition")
    latest=db.execute("SELECT phase_status FROM phase6_evidence_alignment_batches ORDER BY created_at DESC LIMIT 1").fetchone()
    if not latest or latest[0] != "EVIDENCE_ALIGNMENT_APPLIED_PHASE6_OPEN":
        raise RuntimeError("V5 requires successful V4 evidence alignment first.")
    for r in REPAIRS:
        row=db.execute("""SELECT item_name,rules_version,source_title,source_page
                          FROM book_magic_item_registry WHERE book_magic_item_id=?""",(r["content_id"],)).fetchone()
        if not row:
            raise RuntimeError(f"Missing target: {r['content_id']}")
        got=[row[0],row[1],row[2],row[3]]
        exp=[r["old_name"],r["rules_version"],r["source_title"],r["source_page"]]
        if got != exp:
            raise RuntimeError(f"Precondition mismatch for {r['content_id']}: expected={exp} got={got}")
    target_ids={r["content_id"] for r in REPAIRS}
    if len(target_ids) != len(REPAIRS):
        raise RuntimeError("Duplicate V5 repair IDs in payload.")

def apply(db, batch_id, source_hash):
    ensure_schema(db)
    profile_before=table_digest(db,"book_magic_item_engine_profiles","book_magic_item_id")
    backlog_before=table_digest(db,"phase6_automation_backlog","content_id,content_kind,capability_or_gap")
    rows=[]
    for r in REPAIRS:
        ev=db.execute("SELECT entity_version_id FROM book_magic_item_registry WHERE book_magic_item_id=?",(r["content_id"],)).fetchone()[0]
        db.execute("UPDATE book_magic_item_registry SET item_name=? WHERE book_magic_item_id=?",(r["new_name"],r["content_id"]))
        db.execute("""INSERT OR REPLACE INTO phase6_title_normalization_resolution
          (content_id,entity_version_id,old_name,new_name,rules_version,source_title,source_page,evidence_note,batch_id)
          VALUES(?,?,?,?,?,?,?,?,?)""",
          (r["content_id"],ev,r["old_name"],r["new_name"],r["rules_version"],r["source_title"],r["source_page"],r["evidence_note"],batch_id))
        rows.append(dict(r))
    post=state(db)
    require_state(post, EXPECTED, "V5 postcondition")
    profile_after=table_digest(db,"book_magic_item_engine_profiles","book_magic_item_id")
    backlog_after=table_digest(db,"phase6_automation_backlog","content_id,content_kind,capability_or_gap")
    if profile_before != profile_after:
        raise RuntimeError("Safety failure: V5 changed book magic-item engine profiles.")
    if backlog_before != backlog_after:
        raise RuntimeError("Safety failure: V5 changed Phase 6 automation backlog.")
    # no canonical-title duplicates within a rules version
    dup=db.execute("""SELECT rules_version, lower(replace(replace(replace(item_name,' ',''),'-',''),'’','')) k, COUNT(*)
                      FROM book_magic_item_registry
                      GROUP BY rules_version,k HAVING COUNT(*)>1""").fetchall()
    if dup:
        raise RuntimeError(f"V5 created normalized title duplicates: {dup[:10]}")
    db.execute("""INSERT INTO phase6_title_normalization_batches
      (id,created_at,source_db_sha256,repairs,profile_digest_before,profile_digest_after,
       backlog_digest_before,backlog_digest_after,post_book_magic_count,phase_status)
      VALUES(?,?,?,?,?,?,?,?,?,?)""",
      (batch_id,now_iso(),source_hash,len(rows),profile_before,profile_after,backlog_before,backlog_after,
       post["book_magic"],"CANONICAL_TITLE_NORMALIZATION_APPLIED_PHASE6_OPEN"))
    return rows,post,profile_before,profile_after,backlog_before,backlog_after

def write_csv(path, rows):
    fields=list(rows[0].keys()) if rows else ["empty"]
    with path.open("w",encoding="utf-8-sig",newline="") as f:
        w=csv.DictWriter(f,fieldnames=fields); w.writeheader()
        if rows: w.writerows(rows)

def main():
    ap=argparse.ArgumentParser()
    ap.add_argument("--db",default=str(DEFAULT_DB))
    ap.add_argument("--output",default=str(DEFAULT_OUTPUT))
    ap.add_argument("--apply",action="store_true")
    args=ap.parse_args()
    db_path=Path(args.db); out=Path(args.output)
    if not db_path.exists(): raise RuntimeError(f"DB not found: {db_path}")
    out.mkdir(parents=True,exist_ok=True)
    source_hash=sha256(db_path)
    db=sqlite3.connect(db_path)
    db.row_factory=sqlite3.Row
    try:
        if db.execute("PRAGMA integrity_check").fetchone()[0] != "ok":
            raise RuntimeError("SQLite integrity_check failed before V5.")
        verify_preconditions(db)
        if not args.apply:
            print("V5 preconditions PASS (read-only).")
            return 0
        batch_id="phase6-title-normalization-v5-"+datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
        db.execute("BEGIN IMMEDIATE")
        try:
            rows,post,pb,pa,bb,ba=apply(db,batch_id,source_hash)
            db.commit()
        except Exception:
            db.rollback(); raise
        if db.execute("PRAGMA integrity_check").fetchone()[0] != "ok":
            raise RuntimeError("SQLite integrity_check failed after V5.")
        report={
            "applied":True,"batchId":batch_id,"sourceDbSha256":source_hash,
            "titleRepairs":len(rows),"postState":post,
            "profilesUnchanged":pb==pa,"automationBacklogUnchanged":bb==ba,
            "phaseStatus":"CANONICAL_TITLE_NORMALIZATION_APPLIED_PHASE6_OPEN",
            "next":"BOUNDED_QUARANTINE_RECOVERY"
        }
        (out/"phase6_title_normalization_v5_report.json").write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding="utf-8")
        (out/"title_normalizations.json").write_text(json.dumps(rows,ensure_ascii=False,indent=2),encoding="utf-8")
        write_csv(out/"title_normalizations.csv",rows)
        remaining=[dict(r) for r in db.execute("""SELECT book_magic_item_id,item_name,rules_version,source_title,source_page,validation_scope
                                                  FROM book_magic_item_registry ORDER BY rules_version,source_title,source_page,item_name""")]
        (out/"remaining_validated_book_magic_items.json").write_text(json.dumps(remaining,ensure_ascii=False,indent=2),encoding="utf-8")
        write_csv(out/"remaining_validated_book_magic_items.csv",remaining)
        summary=f"""# Phase 6 Canonical Title Normalization V5 Summary

- Canonical OCR title repairs: {len(rows)}
- Runtime Magic Items: {post['runtime_magic']}
- Runtime Poisons: {post['runtime_poison']}
- Book Magic Items: {post['book_magic']}
- Book Poisons: {post['book_poison']}
- Residual Queue: {post['residual']}
- Old Review Queue: {post['old_queue']}
- Automation Backlog: {post['automation_backlog']}
- Extracted in Effective Runtime: {post['effective_extracted']}
- Engine profiles unchanged: YES
- Automation backlog unchanged: YES

**Status: CANONICAL TITLE NORMALIZATION APPLIED / PHASE 6 REMAINS OPEN.**

Next step: evidence-bounded recovery of quarantined Phase 6 candidates. No broad heuristic promotion is permitted.
"""
        (out/"PHASE6_CANONICAL_TITLE_NORMALIZATION_V5_SUMMARY.md").write_text(summary,encoding="utf-8")
        print("PHASE 6 CANONICAL TITLE NORMALIZATION V5 APPLIED")
        print(f"TITLE_REPAIRS={len(rows)}")
        for k,v in post.items(): print(f"{k.upper()}={v}")
        print("PROFILES_UNCHANGED=YES")
        print("AUTOMATION_BACKLOG_UNCHANGED=YES")
        print("PHASE_STATUS=CANONICAL_TITLE_NORMALIZATION_APPLIED_PHASE6_OPEN")
        print("NEXT=BOUNDED_QUARANTINE_RECOVERY")
        print(f"OUTPUT={out}")
        return 0
    finally:
        db.close()
if __name__=="__main__":
    raise SystemExit(main())
