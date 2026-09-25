"""Build the additive, source-versioned D&D VTT Rules Knowledge database.

Safety model
------------
* Source PDFs are read-only.
* data/compendium/rulebooks.sqlite is NEVER modified.
* data/compendium/rules_knowledge.sqlite is additive/versioned:
  - unchanged source revision -> reused
  - changed source -> new revision
  - old revisions remain
* Structured SRD 5.2.1 data is seeded as VALIDATED records.
* PDF-derived records are EXTRACTED candidates, never engine-authoritative by default.
* 2024 official core books have the highest source priority.
* Older books remain searchable and can fill gaps where a newer validated canonical record
  does not exist.

This script creates a searchable staging/knowledge layer. It does not pretend that OCR or
heuristic extraction is semantically perfect.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import sqlite3
import sys
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterable

from pypdf import PdfReader

PROJECT_ROOT = Path(__file__).resolve().parents[1]
BOOKS_ROOT = PROJECT_ROOT / "content-sources" / "books"
MANIFEST_PATH = PROJECT_ROOT / "content-sources" / "rulebooks.json"
DATA_ROOT = PROJECT_ROOT / "data" / "compendium"
DB_PATH = DATA_ROOT / "rules_knowledge.sqlite"
REPORT_PATH = DATA_ROOT / "rules-knowledge-report.json"

MIN_TEXT = 24
SRD_PRIORITY = 480

CATEGORY_CATALOG = [
    ("spell", "Spells", "Spell stat blocks and spell rules"),
    ("cantrip", "Cantrips", "Level-0 spells"),
    ("class", "Classes", "Class definitions and class progression"),
    ("subclass", "Subclasses", "Subclass definitions and progression"),
    ("class-feature", "Class Features", "Class and subclass features"),
    ("feat", "Feats", "Origin, general, fighting style, epic boon, and other feats"),
    ("species", "Species", "Species traits and species rules"),
    ("background", "Backgrounds", "Background mechanics"),
    ("action", "Actions", "Actions a creature can take"),
    ("bonus-action", "Bonus Actions", "Bonus Action rules and abilities"),
    ("reaction", "Reactions", "Reaction rules and abilities"),
    ("action-economy", "Action Economy", "Action, Bonus Action, Reaction, free interaction, and turn economy"),
    ("condition", "Conditions", "Rules conditions"),
    ("weapon", "Weapons", "Weapons and weapon rules"),
    ("armor", "Armor", "Armor and shields"),
    ("equipment", "Equipment", "Adventuring gear, tools, objects, mounts, vehicles, and equipment"),
    ("pack", "Packs / Backpacks", "Equipment packs and their contents"),
    ("magic-item", "Magic Items", "Magic item records and magic item rules"),
    ("poison", "Poisons", "Poisons and poison rules"),
    ("vision", "Vision", "Vision, light, darkness, senses, and line of sight"),
    ("movement", "Movement", "Speed, movement, difficult terrain, jumping, climbing, swimming, flying, crawling"),
    ("short-rest", "Short Rest", "Short Rest rules and recovery"),
    ("long-rest", "Long Rest", "Long Rest rules and recovery"),
    ("rest", "Rest", "General rest rules"),
    ("combat-rule", "Combat Rules", "Combat procedures and combat rules"),
    ("spellcasting-rule", "Spellcasting Rules", "General spellcasting rules"),
    ("monster", "Monsters", "Creature/stat-block candidates and monster rules"),
    ("monster-rule", "Monster Rules", "Rules for monsters and monster features"),
    ("exploration-rule", "Exploration", "Exploration rules"),
    ("downtime-rule", "Downtime", "Downtime rules"),
    ("crafting", "Crafting", "Crafting rules"),
    ("hazard", "Hazards / Traps", "Hazards, traps, and environmental dangers"),
    ("object-rule", "Objects", "Object rules"),
    ("rule", "General Rules", "General rule sections not yet assigned to a narrower category"),
    ("reference", "Reference / Tables", "Reference material and tables"),
]

CLASS_NAMES = {
    "barbarian","bard","cleric","druid","fighter","monk","paladin","ranger",
    "rogue","sorcerer","warlock","wizard"
}
SPECIES_NAMES = {
    "aasimar","dragonborn","dwarf","elf","gnome","goliath","halfling","human","orc","tiefling"
}
CONDITION_NAMES = {
    "blinded","charmed","deafened","exhaustion","frightened","grappled","incapacitated",
    "invisible","paralyzed","petrified","poisoned","prone","restrained","stunned","unconscious"
}
ACTION_NAMES = {
    "attack":"action","dash":"action","disengage":"action","dodge":"action","help":"action",
    "hide":"action","influence":"action","magic":"action","ready":"action","search":"action",
    "study":"action","utilize":"action"
}

SPELL_FIELD_RE = re.compile(
    r"(?im)^(Casting Time|Range|Components|Duration)\s*:\s*(.+?)\s*$"
)
MAGIC_ITEM_RE = re.compile(
    r"(?i)\b(common|uncommon|rare|very rare|legendary|artifact)\b"
)
ATTUNEMENT_RE = re.compile(r"(?i)\brequires attunement\b")
LEVEL_RE = re.compile(r"(?i)\blevel\s+(\d{1,2})\b")
CR_RE = re.compile(r"(?i)\bchallenge\s+(?:rating\s+)?([0-9/]+)")

@dataclass
class OcrRuntime:
    fitz: Any
    np: Any
    engine: Any
    dpi: int

def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()

def sha256_bytes(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()

def sha256_file(path: Path) -> str:
    hasher = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            hasher.update(chunk)
    return hasher.hexdigest()

def stable_id(prefix: str, value: str) -> str:
    return f"{prefix}-{hashlib.sha256(value.encode('utf-8')).hexdigest()[:20]}"

def normalize_space(value: str) -> str:
    return re.sub(r"[ \t]+", " ", value.replace("\x00", " ")).strip()

def normalize_text(value: str) -> str:
    return "\n".join(
        line for raw in value.splitlines()
        if (line := normalize_space(raw))
    )

def canonical_name(value: str) -> str:
    value = value.casefold()
    value = re.sub(r"[^a-z0-9]+", "-", value)
    return value.strip("-") or "unnamed"

def load_manifest() -> list[dict[str, Any]]:
    raw = json.loads(MANIFEST_PATH.read_text(encoding="utf-8"))
    if not isinstance(raw, list):
        raise RuntimeError("rulebooks.json must be a JSON array.")
    seen: set[str] = set()
    for row in raw:
        filename = str(row.get("filename", "")).strip()
        if not filename:
            raise RuntimeError("Every rulebook manifest record requires filename.")
        key = filename.casefold()
        if key in seen:
            raise RuntimeError(f"Duplicate manifest filename: {filename}")
        seen.add(key)
        version = str(row.get("rulesVersion", "")).strip()
        if version not in {"2014", "2024"}:
            raise RuntimeError(f"Invalid rulesVersion for {filename}: {version}")
        priority = int(row.get("sourcePriority", 0))
        if version == "2024" and priority < 400:
            raise RuntimeError(f"2024 source priority is too low for {filename}.")
    return raw

def validate_physical_corpus(manifest: list[dict[str, Any]]) -> list[tuple[Path, dict[str, Any]]]:
    physical = {p.name.casefold(): p for p in BOOKS_ROOT.glob("*.pdf")}
    wanted = {str(row["filename"]).casefold(): row for row in manifest}
    missing = [row["filename"] for key, row in wanted.items() if key not in physical]
    extra = [p.name for key, p in physical.items() if key not in wanted]
    if missing or extra:
        details = []
        if missing:
            details.append("Manifest entries missing physical PDF:\n  - " + "\n  - ".join(missing))
        if extra:
            details.append("Physical PDFs not registered:\n  - " + "\n  - ".join(extra))
        raise RuntimeError("\n\n".join(details))
    return [(physical[str(row["filename"]).casefold()], row) for row in manifest]

def create_schema(db: sqlite3.Connection) -> None:
    db.executescript("""
    PRAGMA foreign_keys=ON;
    PRAGMA journal_mode=WAL;
    PRAGMA synchronous=NORMAL;

    CREATE TABLE IF NOT EXISTS schema_meta(
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    ) STRICT;

    CREATE TABLE IF NOT EXISTS category_catalog(
      id TEXT PRIMARY KEY,
      label TEXT NOT NULL,
      description TEXT NOT NULL
    ) STRICT;

    CREATE TABLE IF NOT EXISTS sources(
      id TEXT PRIMARY KEY,
      source_key TEXT NOT NULL UNIQUE,
      title TEXT NOT NULL,
      filename TEXT NOT NULL,
      publication_year INTEGER,
      rules_version TEXT NOT NULL,
      source_kind TEXT NOT NULL,
      source_priority INTEGER NOT NULL,
      current_revision_id TEXT
    ) STRICT;

    CREATE TABLE IF NOT EXISTS source_revisions(
      id TEXT PRIMARY KEY,
      source_id TEXT NOT NULL REFERENCES sources(id),
      sha256 TEXT NOT NULL,
      file_size INTEGER NOT NULL,
      modified_ns INTEGER NOT NULL,
      extraction_mode TEXT NOT NULL,
      indexed_at TEXT NOT NULL,
      UNIQUE(source_id, sha256)
    ) STRICT;

    CREATE TABLE IF NOT EXISTS raw_pages(
      id INTEGER PRIMARY KEY,
      revision_id TEXT NOT NULL REFERENCES source_revisions(id),
      page_number INTEGER NOT NULL,
      text TEXT NOT NULL,
      extraction_method TEXT NOT NULL,
      text_sha256 TEXT NOT NULL,
      UNIQUE(revision_id, page_number)
    ) STRICT;

    CREATE VIRTUAL TABLE IF NOT EXISTS raw_pages_fts USING fts5(
      text,
      revision_id UNINDEXED,
      page_number UNINDEXED,
      tokenize='porter unicode61'
    );

    CREATE TABLE IF NOT EXISTS sections(
      id TEXT PRIMARY KEY,
      revision_id TEXT NOT NULL REFERENCES source_revisions(id),
      heading TEXT NOT NULL,
      body TEXT NOT NULL,
      page_start INTEGER NOT NULL,
      page_end INTEGER NOT NULL,
      section_sha256 TEXT NOT NULL,
      UNIQUE(revision_id, section_sha256)
    ) STRICT;

    CREATE TABLE IF NOT EXISTS canonical_entities(
      id TEXT PRIMARY KEY,
      canonical_key TEXT NOT NULL UNIQUE,
      category TEXT NOT NULL REFERENCES category_catalog(id),
      name TEXT NOT NULL
    ) STRICT;

    CREATE TABLE IF NOT EXISTS entity_versions(
      id TEXT PRIMARY KEY,
      canonical_id TEXT NOT NULL REFERENCES canonical_entities(id),
      source_id TEXT NOT NULL REFERENCES sources(id),
      revision_id TEXT NOT NULL REFERENCES source_revisions(id),
      source_record_key TEXT NOT NULL,
      category TEXT NOT NULL REFERENCES category_catalog(id),
      subcategory TEXT NOT NULL DEFAULT '',
      name TEXT NOT NULL,
      summary TEXT NOT NULL DEFAULT '',
      structured_json TEXT NOT NULL DEFAULT '{}',
      raw_text TEXT NOT NULL DEFAULT '',
      source_page_start INTEGER,
      source_page_end INTEGER,
      rules_version TEXT NOT NULL,
      source_priority INTEGER NOT NULL,
      status TEXT NOT NULL,
      confidence REAL NOT NULL,
      content_sha256 TEXT NOT NULL,
      created_at TEXT NOT NULL,
      UNIQUE(revision_id, source_record_key, content_sha256)
    ) STRICT;

    CREATE INDEX IF NOT EXISTS idx_entity_versions_category ON entity_versions(category);
    CREATE INDEX IF NOT EXISTS idx_entity_versions_source ON entity_versions(source_id);
    CREATE INDEX IF NOT EXISTS idx_entity_versions_canonical ON entity_versions(canonical_id);
    CREATE INDEX IF NOT EXISTS idx_entity_versions_status ON entity_versions(status);

    CREATE VIRTUAL TABLE IF NOT EXISTS entity_fts USING fts5(
      name,
      summary,
      raw_text,
      category UNINDEXED,
      entity_version_id UNINDEXED,
      tokenize='porter unicode61'
    );

    DROP VIEW IF EXISTS current_entity_versions;
    CREATE VIEW current_entity_versions AS
      SELECT ev.*
      FROM entity_versions ev
      JOIN sources s ON s.id = ev.source_id
      WHERE ev.revision_id = s.current_revision_id;

    DROP VIEW IF EXISTS effective_validated_entities;
    CREATE VIEW effective_validated_entities AS
    WITH ranked AS (
      SELECT
        ev.*,
        ROW_NUMBER() OVER (
          PARTITION BY ev.canonical_id
          ORDER BY
            CASE ev.status
              WHEN 'tested' THEN 60
              WHEN 'automated' THEN 50
              WHEN 'engine-ready' THEN 40
              WHEN 'validated' THEN 30
              ELSE 0
            END DESC,
            ev.source_priority DESC,
            CASE ev.rules_version WHEN '2024' THEN 1 ELSE 0 END DESC,
            ev.created_at DESC
        ) AS rank_no
      FROM current_entity_versions ev
      WHERE ev.status IN ('validated','engine-ready','automated','tested')
    )
    SELECT * FROM ranked WHERE rank_no = 1;
    """)

    db.execute("INSERT OR REPLACE INTO schema_meta(key,value) VALUES('schema_version','2')")
    for category_id, label, description in CATEGORY_CATALOG:
        db.execute(
            "INSERT OR REPLACE INTO category_catalog(id,label,description) VALUES(?,?,?)",
            (category_id, label, description),
        )
    db.commit()

def create_ocr_runtime(dpi: int) -> OcrRuntime:
    try:
        import pymupdf as fitz
        import numpy as np
        from rapidocr import RapidOCR
    except Exception as exc:
        raise RuntimeError(
            "OCR dependencies are missing. Run SETUP_AND_BUILD_RULES_KNOWLEDGE_V2.ps1."
        ) from exc
    return OcrRuntime(
        fitz=fitz,
        np=np,
        engine=RapidOCR(params={"Global.log_level": "warning"}),
        dpi=dpi,
    )

def ocr_page(runtime: OcrRuntime, document: Any, page_index: int) -> str:
    page = document.load_page(page_index)
    scale = max(1.0, runtime.dpi / 72.0)
    pix = page.get_pixmap(
        matrix=runtime.fitz.Matrix(scale, scale),
        colorspace=runtime.fitz.csRGB,
        alpha=False,
    )
    image = runtime.np.frombuffer(pix.samples, dtype=runtime.np.uint8).reshape(
        pix.height, pix.width, pix.n
    )
    if pix.n > 3:
        image = image[:, :, :3]
    result = runtime.engine(image)
    if result is None or result.txts is None:
        return ""
    return normalize_text("\n".join(str(x) for x in result.txts if str(x).strip()))

def extract_pdf_pages(path: Path, mode: str, dpi: int) -> list[tuple[int, str, str]]:
    reader = PdfReader(str(path))
    native: list[tuple[int, str, str]] = []
    native_nonempty = 0
    for page_no, page in enumerate(reader.pages, 1):
        try:
            text = normalize_text(page.extract_text() or "")
        except Exception:
            text = ""
        if len(text) >= MIN_TEXT:
            native_nonempty += 1
        native.append((page_no, text, "native"))

    needs_ocr = mode == "ocr" or (mode == "auto" and native_nonempty == 0)
    if not needs_ocr:
        return native

    runtime = create_ocr_runtime(dpi)
    document = runtime.fitz.open(str(path))
    try:
        output: list[tuple[int, str, str]] = []
        for page_index in range(document.page_count):
            page_no = page_index + 1
            text = ocr_page(runtime, document, page_index)
            output.append((page_no, text, "ocr"))
            if page_no % 25 == 0 or page_no == document.page_count:
                print(f"  OCR {path.name}: {page_no}/{document.page_count}")
        return output
    finally:
        document.close()

def heading_like(line: str) -> bool:
    line = normalize_space(line)
    if not line or len(line) > 90:
        return False
    if line.endswith((".", ";", ",")):
        return False
    words = line.split()
    if not (1 <= len(words) <= 14):
        return False
    if re.match(r"(?i)^(chapter|appendix|part)\s+[0-9ivx]+", line):
        return True
    key = line.casefold()
    if key in CLASS_NAMES | SPECIES_NAMES | CONDITION_NAMES | set(ACTION_NAMES):
        return True
    if key in {"short rest","long rest","movement","vision","actions","bonus actions","reactions","spellcasting"}:
        return True
    alpha_words = [w for w in words if re.search(r"[A-Za-z]", w)]
    if not alpha_words:
        return False
    titled = sum(1 for w in alpha_words if w[0].isupper() or w.isupper())
    return titled / len(alpha_words) >= 0.72

def toc_like(text: str) -> bool:
    lines = [normalize_space(x) for x in text.splitlines() if normalize_space(x)]
    if len(lines) < 6:
        return False
    dotted = sum(bool(re.search(r"\.{3,}\s*\d+\s*$", x)) for x in lines)
    page_end = sum(bool(re.search(r"\s\d{1,3}\s*$", x)) for x in lines)
    return dotted >= 3 or page_end / max(1, len(lines)) > 0.55

def page_sections(page_no: int, text: str) -> list[tuple[str, str, int, int]]:
    if len(text) < MIN_TEXT or toc_like(text):
        return []
    lines = [normalize_space(x) for x in text.splitlines() if normalize_space(x)]
    if not lines:
        return []
    sections: list[tuple[str, str, int, int]] = []
    heading = f"Page {page_no}"
    body: list[str] = []
    for line in lines:
        if heading_like(line) and body:
            section_body = "\n".join(body).strip()
            if len(section_body) >= MIN_TEXT:
                sections.append((heading, section_body, page_no, page_no))
            heading = line
            body = []
        elif heading_like(line) and not body and heading.startswith("Page "):
            heading = line
        else:
            body.append(line)
    section_body = "\n".join(body).strip()
    if len(section_body) >= MIN_TEXT:
        sections.append((heading, section_body, page_no, page_no))
    return sections

def labeled_fields(text: str) -> dict[str, str]:
    return {
        match.group(1).casefold().replace(" ", "_"): normalize_space(match.group(2))
        for match in SPELL_FIELD_RE.finditer(text)
    }

def classify(heading: str, body: str) -> tuple[str, str, float, dict[str, Any]]:
    h = heading.casefold().strip()
    t = f"{heading}\n{body}"
    low = t.casefold()
    fields: dict[str, Any] = {}

    spell_fields = labeled_fields(t)
    if len(spell_fields) >= 3:
        level_line = next(
            (x for x in t.splitlines()[:6] if re.search(r"(?i)\b(cantrip|[1-9](?:st|nd|rd|th)[- ]level)\b", x)),
            "",
        )
        category = "cantrip" if "cantrip" in level_line.casefold() else "spell"
        fields.update(spell_fields)
        fields["level_line"] = normalize_space(level_line)
        return category, "", 0.96, fields

    if h in ACTION_NAMES:
        fields["action_name"] = heading
        return ACTION_NAMES[h], "core-action", 0.96, fields

    if h == "short rest" or re.search(r"(?i)\bshort rest\b", heading):
        return "short-rest", "", 0.97, fields
    if h == "long rest" or re.search(r"(?i)\blong rest\b", heading):
        return "long-rest", "", 0.97, fields

    if h in CONDITION_NAMES:
        return "condition", "", 0.98, fields

    if h in CLASS_NAMES:
        return "class", "", 0.96, fields

    if h in SPECIES_NAMES:
        return "species", "", 0.95, fields

    if re.search(r"(?i)\b(subclass|subclasses)\b", low) and len(heading.split()) <= 10:
        return "subclass", "", 0.78, fields
    if re.search(r"(?i)^(path of|college of|circle of|oath of|school of|way of|warrior of)\b", heading):
        return "subclass", "", 0.86, fields
    if re.search(r"(?i)\bpatron\b", heading) and len(heading.split()) <= 8:
        return "subclass", "", 0.78, fields

    if re.search(r"(?i)\bbackground\b", low) and any(k in low for k in ("ability scores","skill proficien","origin feat","equipment")):
        return "background", "", 0.88, fields

    if re.search(r"(?i)\bfeat\b", low) and ("prerequisite" in low or "repeatable" in low):
        prereq = re.search(r"(?im)^prerequisite\s*:\s*(.+)$", t)
        if prereq:
            fields["prerequisite"] = normalize_space(prereq.group(1))
        return "feat", "", 0.86, fields

    rarity = MAGIC_ITEM_RE.search(t)
    magic_kind = re.search(r"(?i)\b(wondrous item|potion|ring|rod|staff|wand|scroll|weapon|armor)\b", t[:500])
    if rarity and magic_kind:
        fields["rarity"] = rarity.group(1).title()
        fields["attunement"] = bool(ATTUNEMENT_RE.search(t))
        return "magic-item", magic_kind.group(1).casefold(), 0.90, fields

    if re.search(r"(?i)\bbonus action\b", heading):
        return "bonus-action", "", 0.91, fields
    if re.search(r"(?i)\breaction\b", heading):
        return "reaction", "", 0.91, fields
    if h == "actions" or re.search(r"(?i)\baction economy\b", heading):
        return "action-economy", "", 0.91, fields

    if any(x in low for x in ("darkvision","blindsight","truesight","line of sight","obscured","bright light","dim light")):
        return "vision", "", 0.76, fields

    if any(x in low for x in ("difficult terrain","climbing","swimming","flying speed","crawl","jumping","movement and position")):
        return "movement", "", 0.74, fields

    if "spellcasting" in h or ("casting a spell" in low and len(body) > 80):
        return "spellcasting-rule", "", 0.82, fields

    if any(x in low for x in ("initiative","attack roll","damage roll","combat encounter","surprise")):
        return "combat-rule", "", 0.68, fields

    if "class feature" in low or ("level" in low and any(c in low for c in CLASS_NAMES)):
        match = LEVEL_RE.search(t)
        if match:
            fields["level"] = int(match.group(1))
        return "class-feature", "", 0.70, fields

    if "armor class" in low and any(x in low for x in ("light armor","medium armor","heavy armor","shield")):
        return "armor", "", 0.70, fields

    if any(x in low for x in ("weapon mastery","weapon property","martial weapon","simple weapon")):
        return "weapon", "", 0.70, fields

    if any(x in low for x in ("equipment pack","adventuring gear","tool proficiency")):
        return "pack" if "pack" in low else "equipment", "", 0.66, fields

    if "poison" in low and any(x in low for x in ("ingested","injury","inhaled","contact")):
        return "poison", "", 0.75, fields

    if any(x in low for x in ("trap","hazard","environmental hazard")):
        return "hazard", "", 0.64, fields

    if "crafting" in low:
        return "crafting", "", 0.72, fields

    if "downtime" in low:
        return "downtime-rule", "", 0.72, fields

    if any(x in low for x in ("exploration","travel pace","marching order","foraging")):
        return "exploration-rule", "", 0.68, fields

    if "short rest" in low and "long rest" in low:
        return "rest", "", 0.70, fields

    # Basic monster stat-block fingerprint.
    if all(x in low for x in ("armor class","hit points","speed")) and re.search(r"(?i)\bSTR\b.*\bDEX\b.*\bCON\b", t, re.S):
        cr = CR_RE.search(t)
        if cr:
            fields["challenge_rating"] = cr.group(1)
        return "monster", "", 0.80, fields

    return "rule", "", 0.45, fields

def compact_summary(body: str, max_len: int = 280) -> str:
    flat = re.sub(r"\s+", " ", body).strip()
    return flat if len(flat) <= max_len else flat[: max_len - 1].rstrip() + "…"

def upsert_source(
    db: sqlite3.Connection,
    source_key: str,
    title: str,
    filename: str,
    publication_year: int | None,
    rules_version: str,
    source_kind: str,
    source_priority: int,
) -> str:
    source_id = stable_id("source", source_key)
    db.execute("""
      INSERT INTO sources(
        id,source_key,title,filename,publication_year,rules_version,source_kind,source_priority,current_revision_id
      ) VALUES(?,?,?,?,?,?,?,?,NULL)
      ON CONFLICT(source_key) DO UPDATE SET
        title=excluded.title,
        filename=excluded.filename,
        publication_year=excluded.publication_year,
        rules_version=excluded.rules_version,
        source_kind=excluded.source_kind,
        source_priority=excluded.source_priority
    """, (source_id,source_key,title,filename,publication_year,rules_version,source_kind,source_priority))
    return source_id

def revision_for_file(
    db: sqlite3.Connection,
    source_id: str,
    digest: str,
    file_size: int,
    modified_ns: int,
    extraction_mode: str,
) -> tuple[str, bool]:
    existing = db.execute(
        "SELECT id FROM source_revisions WHERE source_id=? AND sha256=?",
        (source_id,digest),
    ).fetchone()
    if existing:
        revision_id = str(existing[0])
        db.execute("UPDATE sources SET current_revision_id=? WHERE id=?", (revision_id, source_id))
        db.commit()
        return revision_id, False
    revision_id = stable_id("revision", f"{source_id}:{digest}")
    db.execute("""
      INSERT INTO source_revisions(id,source_id,sha256,file_size,modified_ns,extraction_mode,indexed_at)
      VALUES(?,?,?,?,?,?,?)
    """, (revision_id,source_id,digest,file_size,modified_ns,extraction_mode,now_iso()))
    db.execute("UPDATE sources SET current_revision_id=? WHERE id=?", (revision_id, source_id))
    db.commit()
    return revision_id, True

def insert_entity(
    db: sqlite3.Connection,
    *,
    source_id: str,
    revision_id: str,
    source_record_key: str,
    category: str,
    subcategory: str,
    name: str,
    summary: str,
    structured: dict[str, Any],
    raw_text: str,
    page_start: int | None,
    page_end: int | None,
    rules_version: str,
    source_priority: int,
    status: str,
    confidence: float,
) -> None:
    canonical_key = f"{category}:{canonical_name(name)}"
    canonical_id = stable_id("canonical", canonical_key)
    db.execute("""
      INSERT INTO canonical_entities(id,canonical_key,category,name)
      VALUES(?,?,?,?)
      ON CONFLICT(canonical_key) DO UPDATE SET
        category=excluded.category,
        name=CASE WHEN length(excluded.name) > length(canonical_entities.name) THEN excluded.name ELSE canonical_entities.name END
    """, (canonical_id,canonical_key,category,name))

    material = json.dumps(
        {
            "category":category,"subcategory":subcategory,"name":name,"summary":summary,
            "structured":structured,"raw_text":raw_text,
            "page_start":page_start,"page_end":page_end,
            "rules_version":rules_version,"status":status,
        },
        ensure_ascii=False,
        sort_keys=True,
    )
    content_hash = sha256_bytes(material.encode("utf-8"))
    entity_id = stable_id("entity", f"{revision_id}:{source_record_key}:{content_hash}")
    before = db.total_changes
    db.execute("""
      INSERT OR IGNORE INTO entity_versions(
        id,canonical_id,source_id,revision_id,source_record_key,category,subcategory,name,summary,
        structured_json,raw_text,source_page_start,source_page_end,rules_version,source_priority,
        status,confidence,content_sha256,created_at
      ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    """, (
        entity_id,canonical_id,source_id,revision_id,source_record_key,category,subcategory,name,summary,
        json.dumps(structured,ensure_ascii=False,sort_keys=True),raw_text,page_start,page_end,rules_version,
        source_priority,status,float(confidence),content_hash,now_iso()
    ))
    if db.total_changes > before:
        rowid = db.execute("SELECT rowid FROM entity_versions WHERE id=?", (entity_id,)).fetchone()[0]
        db.execute("""
          INSERT INTO entity_fts(rowid,name,summary,raw_text,category,entity_version_id)
          VALUES(?,?,?,?,?,?)
        """, (rowid,name,summary,raw_text,category,entity_id))

def ingest_book(
    db: sqlite3.Connection,
    pdf_path: Path,
    meta: dict[str, Any],
    dpi: int,
) -> dict[str, Any]:
    digest = sha256_file(pdf_path)
    stat = pdf_path.stat()
    source_key = f"book:{pdf_path.name.casefold()}"
    source_id = upsert_source(
        db, source_key, str(meta["title"]), pdf_path.name, int(meta["publicationYear"]),
        str(meta["rulesVersion"]), str(meta.get("sourceKind","official-rulebook")),
        int(meta["sourcePriority"]),
    )
    revision_id, is_new = revision_for_file(
        db, source_id, digest, stat.st_size, stat.st_mtime_ns, str(meta.get("textExtraction","auto"))
    )
    if not is_new:
        counts = db.execute(
            "SELECT COUNT(*) FROM raw_pages WHERE revision_id=?", (revision_id,)
        ).fetchone()[0]
        entities = db.execute(
            "SELECT COUNT(*) FROM entity_versions WHERE revision_id=?", (revision_id,)
        ).fetchone()[0]
        print(f"[REUSE] {pdf_path.name}: revision already indexed.")
        return {"filename":pdf_path.name,"revisionId":revision_id,"reused":True,"pages":counts,"entities":entities}

    print(f"[INGEST] {pdf_path.name}")
    pages = extract_pdf_pages(pdf_path, str(meta.get("textExtraction","auto")), dpi)
    searchable = 0
    section_count = 0
    entity_count = 0

    for page_no, text, method in pages:
        if len(text) < MIN_TEXT:
            continue
        searchable += 1
        text_hash = sha256_bytes(text.encode("utf-8"))
        cursor = db.execute("""
          INSERT INTO raw_pages(revision_id,page_number,text,extraction_method,text_sha256)
          VALUES(?,?,?,?,?)
        """, (revision_id,page_no,text,method,text_hash))
        db.execute("""
          INSERT INTO raw_pages_fts(rowid,text,revision_id,page_number)
          VALUES(?,?,?,?)
        """, (cursor.lastrowid,text,revision_id,page_no))

        for heading, body, page_start, page_end in page_sections(page_no, text):
            section_material = f"{heading}\n{body}"
            section_hash = sha256_bytes(section_material.encode("utf-8"))
            section_id = stable_id("section", f"{revision_id}:{section_hash}")
            db.execute("""
              INSERT OR IGNORE INTO sections(id,revision_id,heading,body,page_start,page_end,section_sha256)
              VALUES(?,?,?,?,?,?,?)
            """, (section_id,revision_id,heading,body,page_start,page_end,section_hash))
            section_count += 1

            category, subcategory, confidence, fields = classify(heading, body)
            if category == "rule" and confidence < 0.50 and len(body) < 160:
                continue
            name = heading if not heading.startswith("Page ") else compact_summary(body, 70)
            source_record_key = f"page:{page_start}:section:{section_hash[:12]}"
            before = db.total_changes
            insert_entity(
                db,
                source_id=source_id,
                revision_id=revision_id,
                source_record_key=source_record_key,
                category=category,
                subcategory=subcategory,
                name=name,
                summary=compact_summary(body),
                structured=fields,
                raw_text=body,
                page_start=page_start,
                page_end=page_end,
                rules_version=str(meta["rulesVersion"]),
                source_priority=int(meta["sourcePriority"]),
                status="extracted",
                confidence=confidence,
            )
            if db.total_changes > before:
                entity_count += 1

    db.commit()
    if searchable == 0:
        raise RuntimeError(f"{pdf_path.name} produced zero searchable pages.")
    return {
        "filename":pdf_path.name,
        "revisionId":revision_id,
        "reused":False,
        "pages":searchable,
        "sections":section_count,
        "entities":entity_count,
    }

def parse_ts_json_array(path: Path, const_name: str) -> list[dict[str, Any]]:
    text = path.read_text(encoding="utf-8-sig")
    marker = f"export const {const_name}"
    pos = text.find(marker)
    if pos < 0:
        return []
    start = text.find("[", text.find("=", pos))
    if start < 0:
        return []
    return json.JSONDecoder().raw_decode(text[start:])[0]

def seed_srd(db: sqlite3.Connection) -> dict[str, Any]:
    data_root = PROJECT_ROOT / "src" / "data"
    files = [
        ("srdSpells.generated.ts","SRD_SPELLS"),
        ("srdClassFeatures.generated.ts","SRD_CLASS_FEATURES"),
        ("srdFeats.generated.ts","SRD_FEATS"),
        ("srdEquipment.generated.ts","SRD_EQUIPMENT"),
        ("srdMagicItems.generated.ts","SRD_MAGIC_ITEMS"),
        ("srdBackgrounds.generated.ts","SRD_BACKGROUNDS"),
        ("srdPoisons.generated.ts","SRD_POISONS"),
    ]
    digest_hasher = hashlib.sha256()
    for filename,_ in files:
        digest_hasher.update((data_root / filename).read_bytes())
    digest = digest_hasher.hexdigest()

    source_id = upsert_source(
        db, "srd:5.2.1", "SRD 5.2.1", "generated structured data",
        2024, "2024", "open-srd", SRD_PRIORITY
    )
    revision_id, is_new = revision_for_file(
        db, source_id, digest, sum((data_root/f).stat().st_size for f,_ in files), 0, "structured"
    )
    if not is_new:
        count = db.execute("SELECT COUNT(*) FROM entity_versions WHERE revision_id=?", (revision_id,)).fetchone()[0]
        print(f"[REUSE] SRD 5.2.1 structured revision ({count} records).")
        return {"reused":True,"entities":count}

    records = {name:parse_ts_json_array(data_root/file, name) for file,name in files}
    inserted = 0

    for spell in records["SRD_SPELLS"]:
        cat = "cantrip" if int(spell.get("level",0)) == 0 else "spell"
        structured = {
            "level":spell.get("level"),"school":spell.get("school"),"castingTime":spell.get("castingTime"),
            "range":spell.get("range"),"components":spell.get("components"),"duration":spell.get("duration"),
            "concentration":spell.get("concentration"),"ritual":spell.get("ritual"),"classes":spell.get("classes"),
        }
        insert_entity(
            db,source_id=source_id,revision_id=revision_id,source_record_key=f"spell:{spell['id']}",
            category=cat,subcategory=str(spell.get("school","")),name=str(spell["name"]),
            summary=f"Level {spell.get('level',0)} {spell.get('school','')}".strip(),
            structured=structured,raw_text=str(spell.get("description","")),page_start=None,page_end=None,
            rules_version="2024",source_priority=SRD_PRIORITY,status="validated",confidence=1.0
        ); inserted += 1

    for feature in records["SRD_CLASS_FEATURES"]:
        insert_entity(
            db,source_id=source_id,revision_id=revision_id,source_record_key=f"class-feature:{feature['id']}",
            category="class-feature",subcategory=str(feature.get("className","")),name=str(feature["name"]),
            summary=f"{feature.get('className','')} · Level {feature.get('level','')}",
            structured={"class":feature.get("className"),"level":feature.get("level")},
            raw_text=str(feature.get("description","")),page_start=None,page_end=None,rules_version="2024",
            source_priority=SRD_PRIORITY,status="validated",confidence=1.0
        ); inserted += 1

    for feat in records["SRD_FEATS"]:
        insert_entity(
            db,source_id=source_id,revision_id=revision_id,source_record_key=f"feat:{feat['id']}",
            category="feat",subcategory=str(feat.get("type","")),name=str(feat["name"]),
            summary=str(feat.get("prerequisite") or feat.get("type") or ""),
            structured={"type":feat.get("type"),"prerequisite":feat.get("prerequisite"),"repeatable":feat.get("repeatable")},
            raw_text=str(feat.get("description","")),page_start=None,page_end=None,rules_version="2024",
            source_priority=SRD_PRIORITY,status="validated",confidence=1.0
        ); inserted += 1

    for item in records["SRD_EQUIPMENT"]:
        cats = " ".join(item.get("categories",[])).casefold()
        if item.get("contents") or "pack" in cats:
            cat = "pack"
        elif "armor" in cats or "shield" in cats:
            cat = "armor"
        elif "weapon" in cats:
            cat = "weapon"
        else:
            cat = "equipment"
        insert_entity(
            db,source_id=source_id,revision_id=revision_id,source_record_key=f"equipment:{item['id']}",
            category=cat,subcategory=" · ".join(item.get("categories",[])),name=str(item["name"]),
            summary=" · ".join(x for x in [str(item.get("cost","")), f"{item.get('weight')} lb." if item.get("weight") else ""] if x),
            structured={k:item.get(k) for k in (
                "cost","weight","damageDice","damageType","rangeNormal","rangeLong","properties","mastery",
                "armorClass","dexBonus","dexBonusCap","strengthMinimum","stealthDisadvantage","contents"
            )},
            raw_text=str(item.get("description","")),page_start=None,page_end=None,rules_version="2024",
            source_priority=SRD_PRIORITY,status="validated",confidence=1.0
        ); inserted += 1

    for item in records["SRD_MAGIC_ITEMS"]:
        insert_entity(
            db,source_id=source_id,revision_id=revision_id,source_record_key=f"magic-item:{item['id']}",
            category="magic-item",subcategory=str(item.get("category","")),name=str(item["name"]),
            summary=" · ".join(x for x in [str(item.get("rarity","")), "Attunement" if item.get("attunement") else ""] if x),
            structured={"category":item.get("category"),"rarity":item.get("rarity"),"attunement":item.get("attunement")},
            raw_text=str(item.get("description","")),page_start=None,page_end=None,rules_version="2024",
            source_priority=SRD_PRIORITY,status="validated",confidence=1.0
        ); inserted += 1

    for background in records["SRD_BACKGROUNDS"]:
        insert_entity(
            db,source_id=source_id,revision_id=revision_id,source_record_key=f"background:{background['id']}",
            category="background",subcategory="",name=str(background["name"]),
            summary=str(background.get("feat","")),
            structured={
                "abilityScores":background.get("abilityScores"),"feat":background.get("feat"),
                "proficiencies":background.get("proficiencies"),"equipment":background.get("equipment"),
            },
            raw_text="\n".join(background.get("equipment",[])),page_start=None,page_end=None,rules_version="2024",
            source_priority=SRD_PRIORITY,status="validated",confidence=1.0
        ); inserted += 1

    for poison in records["SRD_POISONS"]:
        insert_entity(
            db,source_id=source_id,revision_id=revision_id,source_record_key=f"poison:{poison['id']}",
            category="poison",subcategory=str(poison.get("type","")),name=str(poison["name"]),
            summary=f"{poison.get('type','')} · {poison.get('costGp','')} gp",
            structured={"type":poison.get("type"),"costGp":poison.get("costGp")},
            raw_text=str(poison.get("description","")),page_start=None,page_end=None,rules_version="2024",
            source_priority=SRD_PRIORITY,status="validated",confidence=1.0
        ); inserted += 1

    db.commit()
    print(f"[SEED] SRD 5.2.1: {inserted} validated structured records.")
    return {"reused":False,"entities":inserted}

def self_test() -> None:
    samples = [
        ("Fire Bolt","Evocation Cantrip\nCasting Time: Action\nRange: 120 feet\nComponents: V, S\nDuration: Instantaneous\nA mote of fire.", "cantrip"),
        ("Long Rest","A Long Rest is a period of extended downtime.", "long-rest"),
        ("Short Rest","A Short Rest is a period of downtime.", "short-rest"),
        ("Blinded","A blinded creature can't see.", "condition"),
        ("Dash","When you take the Dash action, you gain extra movement.", "action"),
        ("Vision and Light","Bright light, dim light, darkness, and Darkvision determine what you can see.", "vision"),
        ("Boots of Example","Wondrous item, rare (requires attunement)\nThese magical boots...", "magic-item"),
    ]
    for heading, body, expected in samples:
        category, _, _, _ = classify(heading, body)
        if category != expected:
            raise AssertionError(f"{heading}: expected {expected}, got {category}")
    print("SELF TEST PASSED")

def build_report(db: sqlite3.Connection, book_results: list[dict[str, Any]], srd: dict[str, Any]) -> dict[str, Any]:
    source_count = db.execute("SELECT COUNT(*) FROM sources").fetchone()[0]
    current_entities = db.execute("SELECT COUNT(*) FROM current_entity_versions").fetchone()[0]
    validated = db.execute("SELECT COUNT(*) FROM current_entity_versions WHERE status='validated'").fetchone()[0]
    extracted = db.execute("SELECT COUNT(*) FROM current_entity_versions WHERE status='extracted'").fetchone()[0]
    categories = [
        {"category":row[0],"count":row[1]}
        for row in db.execute("""
          SELECT category,COUNT(*) FROM current_entity_versions
          GROUP BY category ORDER BY COUNT(*) DESC,category
        """)
    ]
    sources = [
        {
            "title":row[0],"filename":row[1],"rulesVersion":row[2],"priority":row[3],
            "currentRevisionId":row[4],
        }
        for row in db.execute("""
          SELECT title,filename,rules_version,source_priority,current_revision_id
          FROM sources ORDER BY source_priority DESC,title
        """)
    ]
    return {
        "schemaVersion":2,
        "database":str(DB_PATH),
        "sourceCount":source_count,
        "currentEntityCount":current_entities,
        "validatedEntityCount":validated,
        "extractedCandidateCount":extracted,
        "categories":categories,
        "sources":sources,
        "books":book_results,
        "srd":srd,
        "policy":{
            "2024OfficialCorePriority":500,
            "srd521Priority":SRD_PRIORITY,
            "pdfCandidatesAreAuthoritative":False,
            "effectiveView":"effective_validated_entities",
            "oldRevisionsDeleted":False,
        },
    }

def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--ocr-dpi",type=int,default=170)
    parser.add_argument("--self-test",action="store_true")
    args = parser.parse_args()

    if args.self_test:
        self_test()
        return 0

    manifest = load_manifest()
    corpus = validate_physical_corpus(manifest)
    DATA_ROOT.mkdir(parents=True,exist_ok=True)

    db = sqlite3.connect(DB_PATH)
    db.row_factory = sqlite3.Row
    try:
        create_schema(db)
        srd_result = seed_srd(db)
        book_results = []
        for pdf,meta in corpus:
            result = ingest_book(db,pdf,meta,args.ocr_dpi)
            book_results.append(result)
        report = build_report(db,book_results,srd_result)
        REPORT_PATH.write_text(json.dumps(report,ensure_ascii=False,indent=2)+"\n",encoding="utf-8")
        print("")
        print(f"RULES KNOWLEDGE READY: {report['sourceCount']} sources, {report['currentEntityCount']} current structured/searchable records")
        print(f"Validated: {report['validatedEntityCount']} | Extracted candidates: {report['extractedCandidateCount']}")
        print(DB_PATH)
        print(REPORT_PATH)
    finally:
        db.close()
    return 0

if __name__ == "__main__":
    raise SystemExit(main())
