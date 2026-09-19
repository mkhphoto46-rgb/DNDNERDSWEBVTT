# D&D WEB VTT — Remote Play Launcher v1.1

This fixes the SHA256 pin in the previous Remote Play v1 launcher.

The previous launcher downloaded:
- cloudflared 2026.9.1
- Windows amd64 executable

but compared it against the checksum from an older cloudflared release.

Correct pinned SHA256 for:
`cloudflared-windows-amd64.exe` version `2026.9.1`

`2837888cc0f5d58f15b6dc478376de90b4d3ba5241c7947455d1e0a0df429712`

## Files replaced

- `F:\DND WEB VTT\Start-Remote-VTT.ps1`
- `F:\DND WEB VTT\Start-Remote-VTT.cmd`

No server, database, map, token, or campaign files are changed.

## Install

Extract this ZIP into:

`F:\DND WEB VTT`

with overwrite enabled.

Then run:

`F:\DND WEB VTT\Start-Remote-VTT.cmd`

or:

```powershell
Set-Location "F:\DND WEB VTT"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File ".\Start-Remote-VTT.ps1"
```

Expected behavior:
1. cloudflared downloads.
2. SHA256 verification succeeds.
3. VTT server starts if needed.
4. A public `https://...trycloudflare.com` URL is printed.
