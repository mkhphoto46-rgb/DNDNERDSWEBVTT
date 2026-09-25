from __future__ import annotations

import json
import re
import sqlite3
import sys
import unicodedata
from pathlib import Path

PROJECT_ROOT = Path(r"F:\DND WEB VTT")
DB_PATH = PROJECT_ROOT / "data" / "compendium" / "rules_knowledge.sqlite"
MANIFEST_PATH = PROJECT_ROOT / "scripts" / "playable_catalog_manifest.json"
EXPECTED = {"classes": 25, "subclasses": 154, "species": 60, "backgrounds": 38}


def norm(value: object) -> str:
    text = str(value or "").replace("\u00ad", "")
    text = re.sub(r"(?<=\w)[\-\u2010\u2011\u2012\u2013\u2014]\s+(?=\w)", "", text)
    text = unicodedata.normalize("NFKD", text)
    text = "".join(ch for ch in text if not unicodedata.combining(ch))
    text = re.sub(r"[^a-zA-Z0-9]+", " ", text).lower()
    return re.sub(r"\s+", " ", text).strip()


def contains_evidence(normalized_haystack: str, compact_haystack: str, term: str) -> bool:
    normalized_term = norm(term)
    if normalized_term and normalized_term in normalized_haystack:
        return True
    return normalized_term.replace(" ", "") in compact_haystack


def main() -> int:
    if not DB_PATH.exists():
        raise RuntimeError(f"Rules knowledge DB missing: {DB_PATH}")
    if not MANIFEST_PATH.exists():
        raise RuntimeError(f"Playable catalog manifest missing: {MANIFEST_PATH}")

    manifest = json.loads(MANIFEST_PATH.read_text(encoding="utf-8"))
    for family, expected in EXPECTED.items():
        actual = len(manifest.get(family, []))
        if actual != expected:
            raise RuntimeError(f"Manifest count drift for {family}: expected {expected}, got {actual}")

    db = sqlite3.connect(f"file:{DB_PATH.as_posix()}?mode=ro", uri=True)
    try:
        integrity = db.execute("PRAGMA integrity_check").fetchone()[0]
        fk_errors = db.execute("PRAGMA foreign_key_check").fetchall()
        if integrity != "ok" or fk_errors:
            raise RuntimeError(f"DB integrity failed: integrity={integrity}, foreign_keys={len(fk_errors)}")

        source_text: dict[str, str] = {}
        source_text_compact: dict[str, str] = {}
        source_rows: dict[str, tuple[str, str]] = {}

        for source_key, source in manifest["sources"].items():
            row = db.execute(
                """
                SELECT id, current_revision_id
                FROM sources
                WHERE title = ? AND rules_version = ?
                ORDER BY source_priority DESC
                LIMIT 1
                """,
                (source["title"], source["rulesVersion"]),
            ).fetchone()
            if not row:
                raise RuntimeError(f"Registered source missing for {source_key}: {source['title']} [{source['rulesVersion']}]")
            source_id, revision_id = row
            sections = db.execute(
                """
                SELECT heading, body
                FROM sections
                WHERE revision_id = ?
                ORDER BY page_start, rowid
                """,
                (revision_id,),
            ).fetchall()
            combined = "\n".join(f"{heading or ''}\n{body or ''}" for heading, body in sections)
            normalized = norm(combined)
            source_text[source_key] = normalized
            source_text_compact[source_key] = normalized.replace(" ", "")
            source_rows[source_key] = (source_id, revision_id)

        failures: list[dict[str, object]] = []
        total = 0
        for family in EXPECTED:
            for option in manifest[family]:
                total += 1
                text = source_text.get(option["sourceKey"], "")
                compact_text = source_text_compact.get(option["sourceKey"], "")
                missing = [term for term in option.get("evidenceTerms", []) if not contains_evidence(text, compact_text, term)]
                if missing:
                    failures.append({
                        "family": family,
                        "id": option["id"],
                        "label": option["displayLabel"],
                        "source": option["sourceKey"],
                        "missing": missing,
                    })

        print("PLAYABLE CATALOG SOURCE EVIDENCE VERIFY")
        print(f"INTEGRITY={integrity}")
        print(f"FOREIGN_KEYS={len(fk_errors)}")
        for family, expected in EXPECTED.items():
            print(f"{family.upper()}={expected}")
        print(f"TOTAL_PLAYABLE_OPTIONS={total}")
        print(f"SOURCE_EVIDENCE_FAILURES={len(failures)}")
        if failures:
            for failure in failures[:20]:
                print("FAIL:", json.dumps(failure, ensure_ascii=False, sort_keys=True))
            return 1
        print("PLAYABLE_CATALOG_SOURCE_EVIDENCE=PASS")
        return 0
    finally:
        db.close()


if __name__ == "__main__":
    raise SystemExit(main())
