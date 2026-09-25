# D&D WEB VTT UI Source Snapshot Tool

This tool creates a clean source ZIP from the live project at:

`F:\DND WEB VTT`

Output:

`F:\DND_WEB_VTT_UI_CURRENT_SOURCE.zip`

Included:
- `src/`
- `server/`
- `package.json`
- `package-lock.json`
- `.gitignore`
- `index.html`
- `tsconfig*.json`
- `vite.config.*`
- root Markdown files

Excluded intentionally:
- `node_modules/`
- `dist/`
- `data/`
- `.git/`
- `assets-source/`
- campaign runtime files

## Easiest way

Double-click:

`Create_UI_Source_Snapshot.cmd`

or run the `.ps1` in PowerShell.

When it finishes, send this file to the next ChatGPT conversation:

`F:\DND_WEB_VTT_UI_CURRENT_SOURCE.zip`
