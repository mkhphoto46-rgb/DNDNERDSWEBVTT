"""Build a local full-text index from user-owned rulebook PDFs.

The source PDFs and generated database remain under git-ignored local folders.
"""

from __future__ import annotations

import hashlib
import json
import re
import sqlite3
import sys
from pathlib import Path

from pypdf import PdfReader


PROJECT_ROOT = Path(__file__).resolve().parents[1]
BOOKS_ROOT = PROJECT_ROOT / "content-sources" / "books"
OUTPUT_ROOT = PROJECT_ROOT / "data" / "compendium"
DATABASE_PATH = OUTPUT_ROOT / "rulebooks.sqlite"
TEMP_DATABASE_PATH = OUTPUT_ROOT / "rulebooks.sqlite.tmp"
MANIFEST_PATH = PROJECT_ROOT / "content-sources" / "rulebooks.json"


def normalized_text(value: str) -> str:
    lines = []
    for raw_line in value.replace("\x00", " ").splitlines():
        line = re.sub(r"[ \t]+", " ", raw_line).strip()
        if line:
            lines.append(line)
    return "\n".join(lines)


def title_from_filename(path: Path) -> tuple[int | None, str]:
    stem = path.stem
    year_match = re.match(r"^(20\d{2})[-_ ]+", stem)
    year = int(year_match.group(1)) if year_match else None
    title = stem[year_match.end():] if year_match else stem
    title = re.sub(r"[-_]+", " ", title)
    title = re.sub(r"\s+", " ", title).strip()
    return year, title


def book_id(path: Path) -> str:
    digest = hashlib.sha256(path.name.lower().encode("utf-8")).hexdigest()[:12]
    return f"book-{digest}"


def prepare_database(connection: sqlite3.Connection) -> None:
    connection.executescript(
        """
        PRAGMA journal_mode = DELETE;
        PRAGMA synchronous = NORMAL;

        CREATE TABLE books (
          id TEXT PRIMARY KEY,
          title TEXT NOT NULL,
          year INTEGER,
          rules_version TEXT NOT NULL,
          filename TEXT NOT NULL,
          page_count INTEGER NOT NULL,
          indexed_page_count INTEGER NOT NULL,
          file_size INTEGER NOT NULL,
          modified_ns INTEGER NOT NULL
        ) STRICT;

        CREATE TABLE pages (
          id INTEGER PRIMARY KEY,
          book_id TEXT NOT NULL REFERENCES books(id) ON DELETE CASCADE,
          page_number INTEGER NOT NULL,
          text TEXT NOT NULL,
          UNIQUE(book_id, page_number)
        ) STRICT;

        CREATE VIRTUAL TABLE pages_fts USING fts5(
          text,
          book_id UNINDEXED,
          page_number UNINDEXED,
          tokenize = 'porter unicode61'
        );

        CREATE INDEX idx_rulebook_pages_book_page
          ON pages(book_id, page_number);
        """
    )


def main() -> int:
    manifest_records = json.loads(MANIFEST_PATH.read_text(encoding="utf-8")) if MANIFEST_PATH.exists() else []
    manifest = {
        str(record.get("filename", "")).lower(): record
        for record in manifest_records
        if isinstance(record, dict) and record.get("filename")
    }
    files = [
        path
        for path in sorted(BOOKS_ROOT.glob("*.pdf"), key=lambda value: value.name.lower())
        if not bool(manifest.get(path.name.lower(), {}).get("ignore", False))
    ]
    if not files:
        print(f"No PDF files found in {BOOKS_ROOT}", file=sys.stderr)
        return 1

    OUTPUT_ROOT.mkdir(parents=True, exist_ok=True)
    if TEMP_DATABASE_PATH.exists():
        TEMP_DATABASE_PATH.unlink()

    connection = sqlite3.connect(TEMP_DATABASE_PATH)
    prepare_database(connection)

    total_pages = 0
    indexed_pages = 0
    try:
        for pdf_path in files:
            if not pdf_path.exists():
                print(f"Skipped file removed during indexing: {pdf_path.name}", file=sys.stderr)
                continue
            reader = PdfReader(str(pdf_path))
            fallback_year, fallback_title = title_from_filename(pdf_path)
            metadata = manifest.get(pdf_path.name.lower(), {})
            year = int(metadata.get("publicationYear", fallback_year)) if metadata.get("publicationYear", fallback_year) else None
            title = str(metadata.get("title", fallback_title)).strip() or fallback_title
            rules_version = str(metadata.get("rulesVersion", fallback_year or "unknown"))
            source_id = book_id(pdf_path)
            stat = pdf_path.stat()
            book_indexed_pages = 0

            for page_number, page in enumerate(reader.pages, start=1):
                text = normalized_text(page.extract_text() or "")
                total_pages += 1
                if not text:
                    continue
                cursor = connection.execute(
                    "INSERT INTO pages(book_id, page_number, text) VALUES (?, ?, ?)",
                    (source_id, page_number, text),
                )
                connection.execute(
                    "INSERT INTO pages_fts(rowid, text, book_id, page_number) VALUES (?, ?, ?, ?)",
                    (cursor.lastrowid, text, source_id, page_number),
                )
                book_indexed_pages += 1
                indexed_pages += 1

            connection.execute(
                """
                INSERT INTO books(
                  id, title, year, rules_version, filename, page_count, indexed_page_count,
                  file_size, modified_ns
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    source_id,
                    title,
                    year,
                    rules_version,
                    pdf_path.name,
                    len(reader.pages),
                    book_indexed_pages,
                    stat.st_size,
                    stat.st_mtime_ns,
                ),
            )
            connection.commit()
            print(f"Indexed {pdf_path.name}: {book_indexed_pages}/{len(reader.pages)} pages")
    finally:
        connection.close()

    if DATABASE_PATH.exists():
        DATABASE_PATH.unlink()
    TEMP_DATABASE_PATH.replace(DATABASE_PATH)
    print(f"Rulebook index ready: {len(files)} books, {indexed_pages}/{total_pages} searchable pages")
    print(DATABASE_PATH)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
