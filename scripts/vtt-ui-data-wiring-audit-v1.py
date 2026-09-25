
from __future__ import annotations

import argparse
import csv
import hashlib
import json
import os
import re
import shutil
import sqlite3
from collections import Counter
from pathlib import Path

PROJECT_ROOT = Path(r"F:\DND WEB VTT")
DEFAULT_OUTPUT = PROJECT_ROOT / "_vtt_ui_data_wiring_audit_v1"

SCAN_ROOTS = [
    PROJECT_ROOT / "src",
    PROJECT_ROOT / "server",
    PROJECT_ROOT / "scripts",
]

ALLOWED_EXTENSIONS = {
    ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs",
    ".json", ".css", ".scss", ".md",
}

EXCLUDED_DIR_NAMES = {
    "node_modules", "dist", "build", ".git", ".vite", ".cache",
    "_hotfix_backups",
}

EXCLUDED_PREFIXES = (
    "_phase", "_stage", "_current", "_content", "_platform",
    "_backup", "_snapshot", "_audit",
)

KEYWORDS = {
    "character_catalog": [
        "character catalog", "charactercatalog", "class", "subclass",
        "species", "race", "background", "feat",
    ],
    "spells": ["spell", "cantrip", "prepared spells", "known spells"],
    "items_equipment": [
        "weapon", "armor", "equipment", "adventuring gear",
        "magic item", "poison", "inventory",
    ],
    "monsters": [
        "monster", "stat block", "challenge rating", "compendium actor",
    ],
    "rules_compendium": [
        "compendium", "rules library", "rules knowledge", "rules_knowledge",
        "semantic profile", "phase8",
    ],
    "server_api": [
        "/api/", "router.", "app.get", "app.post", "app.patch", "app.put",
        "app.delete", "express", "fetch(", "axios", "websocket", "socket",
    ],
    "sqlite_data_access": [
        "sqlite", "better-sqlite", "rules_knowledge.sqlite", "monsters.sqlite",
        "data/compendium", r"data\compendium",
    ],
    "ui_components": [
        "react", "tsx", "component", "modal", "panel", "drawer",
        "character builder", "compendium", "select", "option",
    ],
}

DB_NAMES = [
    "rules_knowledge.sqlite",
    "monsters.sqlite",
    "rulebooks.sqlite",
]

RELEVANT_TABLE_PATTERNS = (
    "phase1", "phase2", "phase3", "phase4", "phase5", "phase6", "phase7", "phase8",
    "class", "subclass", "species", "race", "background", "feat", "spell",
    "weapon", "armor", "equipment", "item", "poison", "monster", "rule",
    "canonical", "entity", "section", "source",
)

def sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()

def should_skip_dir(path: Path) -> bool:
    name = path.name.lower()
    if name in EXCLUDED_DIR_NAMES:
        return True
    return any(name.startswith(prefix) for prefix in EXCLUDED_PREFIXES)

def safe_read_text(path: Path) -> str | None:
    try:
        return path.read_text(encoding="utf-8")
    except UnicodeDecodeError:
        try:
            return path.read_text(encoding="utf-8-sig")
        except Exception:
            return None
    except Exception:
        return None

def keyword_hits(text: str):
    lower = text.lower()
    hits = {}
    for category, words in KEYWORDS.items():
        matched = [word for word in words if word.lower() in lower]
        if matched:
            hits[category] = matched
    return hits

def extract_endpoints(text: str):
    endpoints = []

    server_route = re.compile(
        r"(?:app|router)\.(get|post|put|patch|delete)\s*\(\s*[\"']([^\"']+)[\"']",
        re.I,
    )
    client_fetch = re.compile(
        r"fetch\s*\(\s*[\"'`]([^\"'`]+)[\"'`]",
        re.I,
    )

    for m in server_route.finditer(text):
        endpoints.append({
            "kind": "server_route",
            "method": m.group(1).upper(),
            "path": m.group(2),
        })

    for m in client_fetch.finditer(text):
        endpoints.append({
            "kind": "client_fetch",
            "method": "",
            "path": m.group(1),
        })

    return endpoints

def extract_imports(text: str):
    results = set()

    static_import = re.compile(r"from\s+[\"']([^\"']+)[\"']")
    dynamic_import = re.compile(r"import\s*\(\s*[\"']([^\"']+)[\"']\s*\)")

    for m in static_import.finditer(text):
        results.add(m.group(1))
    for m in dynamic_import.finditer(text):
        results.add(m.group(1))

    return sorted(results)

def write_csv(path: Path, rows):
    rows = list(rows)
    if not rows:
        path.write_text("empty\n", encoding="utf-8-sig")
        return

    fields = []
    for row in rows:
        for key in row:
            if key not in fields:
                fields.append(key)

    with path.open("w", encoding="utf-8-sig", newline="") as f:
        w = csv.DictWriter(f, fieldnames=fields)
        w.writeheader()
        for row in rows:
            out = {}
            for key in fields:
                value = row.get(key, "")
                if isinstance(value, (list, dict)):
                    value = json.dumps(value, ensure_ascii=False, sort_keys=True)
                out[key] = value
            w.writerow(out)

def inspect_db(db_path: Path):
    result = {
        "path": str(db_path),
        "exists": db_path.exists(),
        "integrity": None,
        "foreign_keys": None,
        "tables": [],
        "relevant_tables": [],
    }

    if not db_path.exists():
        return result

    db = sqlite3.connect(f"file:{db_path.as_posix()}?mode=ro", uri=True)
    try:
        result["integrity"] = db.execute("PRAGMA integrity_check").fetchone()[0]
        result["foreign_keys"] = len(db.execute("PRAGMA foreign_key_check").fetchall())

        tables = [
            r[0] for r in db.execute(
                "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"
            )
        ]
        result["tables"] = tables

        for table in tables:
            lower = table.lower()
            if any(p in lower for p in RELEVANT_TABLE_PATTERNS):
                try:
                    count = db.execute(f'SELECT COUNT(*) FROM "{table}"').fetchone()[0]
                except Exception:
                    count = None

                columns = [
                    {
                        "name": r[1],
                        "type": r[2],
                        "notnull": r[3],
                        "pk": r[5],
                    }
                    for r in db.execute(f'PRAGMA table_info("{table}")')
                ]

                result["relevant_tables"].append({
                    "table": table,
                    "row_count": count,
                    "columns": columns,
                })
    finally:
        db.close()

    return result

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--output", default=str(DEFAULT_OUTPUT))
    args = ap.parse_args()

    output = Path(args.output)

    if not PROJECT_ROOT.exists():
        raise RuntimeError(f"Project root missing: {PROJECT_ROOT}")

    if output.exists():
        shutil.rmtree(output)

    output.mkdir(parents=True)
    snapshot_root = output / "snapshot"
    snapshot_root.mkdir()

    package_json = PROJECT_ROOT / "package.json"
    package_info = {}

    if package_json.exists():
        try:
            package_info = json.loads(package_json.read_text(encoding="utf-8"))
        except Exception as exc:
            package_info = {"error": str(exc)}

    scanned = 0
    matched = 0
    file_rows = []
    endpoint_rows = []
    import_rows = []
    category_counts = Counter()

    for scan_root in SCAN_ROOTS:
        if not scan_root.exists():
            continue

        for current, dirnames, filenames in os.walk(scan_root):
            current_path = Path(current)

            dirnames[:] = [
                d for d in dirnames
                if not should_skip_dir(current_path / d)
            ]

            for filename in filenames:
                path = current_path / filename

                if path.suffix.lower() not in ALLOWED_EXTENSIONS:
                    continue

                if path.name.lower().startswith(".env"):
                    continue

                scanned += 1
                text = safe_read_text(path)

                if text is None:
                    continue

                hits = keyword_hits(text)
                if not hits:
                    continue

                matched += 1
                rel = path.relative_to(PROJECT_ROOT)

                for category in hits:
                    category_counts[category] += 1

                file_rows.append({
                    "relative_path": str(rel),
                    "extension": path.suffix.lower(),
                    "size_bytes": path.stat().st_size,
                    "sha256": sha256_file(path),
                    "categories": sorted(hits),
                    "matched_terms": hits,
                })

                for ep in extract_endpoints(text):
                    endpoint_rows.append({
                        "relative_path": str(rel),
                        **ep,
                    })

                for imp in extract_imports(text):
                    import_rows.append({
                        "relative_path": str(rel),
                        "import": imp,
                    })

                dest = snapshot_root / rel
                dest.parent.mkdir(parents=True, exist_ok=True)
                shutil.copy2(path, dest)

    for key_file in [
        PROJECT_ROOT / "package.json",
        PROJECT_ROOT / "tsconfig.json",
        PROJECT_ROOT / "tsconfig.server.json",
        PROJECT_ROOT / "vite.config.ts",
        PROJECT_ROOT / "vite.config.js",
    ]:
        if key_file.exists() and key_file.is_file():
            rel = key_file.relative_to(PROJECT_ROOT)
            dest = snapshot_root / rel
            dest.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(key_file, dest)

    db_results = []
    compendium_dir = PROJECT_ROOT / "data" / "compendium"

    for name in DB_NAMES:
        db_results.append(inspect_db(compendium_dir / name))

    db_table_rows = []
    for db in db_results:
        for entry in db.get("relevant_tables", []):
            db_table_rows.append({
                "database": Path(db["path"]).name,
                "table": entry["table"],
                "row_count": entry["row_count"],
                "columns": [c["name"] for c in entry["columns"]],
            })

    report = {
        "package": "VTT_UI_DATA_WIRING_AUDIT_V1",
        "readOnly": True,
        "projectRoot": str(PROJECT_ROOT),
        "filesScanned": scanned,
        "matchedSourceFiles": matched,
        "categoryCounts": dict(sorted(category_counts.items())),
        "packageScripts": package_info.get("scripts", {}),
        "dependencies": sorted((package_info.get("dependencies") or {}).keys()),
        "devDependencies": sorted((package_info.get("devDependencies") or {}).keys()),
        "databases": db_results,
        "endpointCount": len(endpoint_rows),
        "importRows": len(import_rows),
    }

    (output / "vtt_ui_data_wiring_audit_v1_report.json").write_text(
        json.dumps(report, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )

    write_csv(output / "vtt_ui_data_wiring_source_files.csv", file_rows)
    write_csv(output / "vtt_ui_data_wiring_endpoints.csv", endpoint_rows)
    write_csv(output / "vtt_ui_data_wiring_imports.csv", import_rows)
    write_csv(output / "vtt_ui_data_wiring_db_tables.csv", db_table_rows)

    summary = [
        "# Ghost Theory — VTT UI Data Wiring Audit V1",
        "",
        "**Mode: READ-ONLY**",
        "",
        f"- Project root: `{PROJECT_ROOT}`",
        f"- Source files scanned: {scanned}",
        f"- Relevant source files copied: {matched}",
        f"- Endpoint references found: {len(endpoint_rows)}",
        "",
        "## Purpose",
        "",
        "Capture the live DB → server → client/UI wiring before integration.",
        "This prevents duplicate catalogs and avoids patching obsolete files.",
        "",
        "## Database checks",
    ]

    for db in db_results:
        summary.append(
            f"- `{Path(db['path']).name}`: exists={db['exists']}, "
            f"integrity={db['integrity']}, FK errors={db['foreign_keys']}"
        )

    summary += [
        "",
        "## Safety",
        "",
        "- No project source is modified.",
        "- No database is modified.",
        "- `.env` files are excluded.",
        "- `node_modules`, build output, backups, and old audit/snapshot folders are excluded.",
        "",
        "## Next",
        "",
        "Use this output to build the first real SQLite → Server API → React integration package.",
    ]

    (output / "VTT_UI_DATA_WIRING_AUDIT_V1_SUMMARY.md").write_text(
        "\n".join(summary) + "\n",
        encoding="utf-8",
    )

    print("VTT UI DATA WIRING AUDIT V1 COMPLETE")
    print("READ_ONLY=YES")
    print(f"FILES_SCANNED={scanned}")
    print(f"MATCHED_SOURCE_FILES={matched}")
    print(f"ENDPOINT_REFERENCES={len(endpoint_rows)}")

    for db in db_results:
        name = Path(db["path"]).name.upper().replace(".", "_")
        print(f"DB_{name}_EXISTS={str(db['exists']).upper()}")
        if db["exists"]:
            print(f"DB_{name}_INTEGRITY={db['integrity']}")
            print(f"DB_{name}_FOREIGN_KEYS={db['foreign_keys']}")

    print("AUDIT_STATUS=PASS")
    print(f"OUTPUT={output}")
    return 0

if __name__ == "__main__":
    raise SystemExit(main())
