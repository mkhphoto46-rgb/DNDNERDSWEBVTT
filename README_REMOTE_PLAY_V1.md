# D&D WEB VTT — Remote Play v1

## Purpose

Allows players on another Internet connection or in another country to join the DM-hosted VTT in Chrome.

This version uses a Cloudflare **Quick Tunnel** for immediate remote testing.

## Security fix included

Before this patch, the server determined DM access only from the TCP remote address.

A local tunnel process connects to the VTT through localhost, so without a fix a tunneled request could look like a localhost request to the Node server.

This bundle changes DM trust rules so that:

- Direct `http://localhost:3000` access on the DM computer remains DM.
- Requests forwarded through Cloudflare are never treated as localhost DM requests.
- Local-only HTTP API routes remain local-only.
- Socket.IO DM role remains localhost-only.
- Remote users are routed through the existing Player join flow and still need the campaign Join Code.

## Files included

- `.gitignore`
- `server/server.ts`
- `Start-Remote-VTT.ps1`
- `Start-Remote-VTT.cmd`

The Cloudflare executable is NOT included.
The launcher downloads the official Windows x64 binary on first run and verifies its pinned SHA256.

Pinned cloudflared:
- Version: `2026.9.1`
- SHA256: `8635da433b6df8194746e88ed9d2589566c20e38bfc2a80e431a348b7c765841`

## Install

Extract the ZIP into:

`F:\DND WEB VTT`

Then run:

```powershell
Set-Location "F:\DND WEB VTT"
npm.cmd test
npm.cmd run build
```

If both succeed:

```powershell
npm.cmd run server
```

Verify local DM still works:

`http://localhost:3000`

Stop the manually started server after that test if desired.

## Start remote play

Easiest:

Double-click:

`F:\DND WEB VTT\Start-Remote-VTT.cmd`

Or from PowerShell:

```powershell
Set-Location "F:\DND WEB VTT"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File ".\Start-Remote-VTT.ps1"
```

The launcher:

1. Downloads `cloudflared` on first run.
2. Verifies its SHA256.
3. Starts the VTT server automatically if it is not already running.
4. Starts a secure outbound tunnel to `http://localhost:3000`.
5. Prints a public HTTPS address similar to:

`https://random-words.trycloudflare.com`

Send that URL and the campaign Join Code to players.

## Player

Remote player:

1. Opens the HTTPS `trycloudflare.com` address in Chrome.
2. Enters player name.
3. Enters campaign Join Code.
4. Joins normally.

No player-side installation is required.

## DM

The DM should always use:

`http://localhost:3000`

Do not use the public tunnel URL as the DM.

## Quick Tunnel limitations

This is for immediate remote testing / private game sessions.

- Public URL is random and changes when the tunnel restarts.
- No uptime SLA.
- Current Cloudflare Quick Tunnel limit is 200 in-flight requests.
- Quick Tunnels do not support SSE.
- Cloudflare Tunnel does support WebSockets, which is what Socket.IO can use for realtime gameplay.

A later milestone can replace this with a named/stable tunnel if a stable hostname is wanted.
