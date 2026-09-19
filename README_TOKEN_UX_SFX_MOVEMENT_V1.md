# D&D WEB VTT — Token UX + SFX + Movement v1

This bundle is based on the current uploaded source snapshot and replaces complete files only.

## What changes

- Token Chest cards can be dragged directly onto the map.
- Clicking a Token Chest card arms placement mode; the next map click places it at that grid square.
- Existing token dragging gets an explicit Pixi hit area for more reliable selection.
- Token pickup/drop/snap SFX are wired to the existing `/api/audio/manifest` backend.
- A visible `Test Token SFX` button reports whether a usable token cue is actually available.
- Token SFX can be toggled on/off locally.
- Tokens get `speedFeet` and `movementUsedFeet` state.
- Player self-movement is server-authoritative and limited by remaining movement.
- Default speed is 30 ft; each square is currently 5 ft.
- Movement is cumulative until the DM uses Reset Move / Reset All Move.
- DM movement is not budget-limited, so setup/repositioning remains easy.
- Hidden tokens are removed from player-safe state and player movement for hidden tokens is rejected server-side.
- Player token payload uses an explicit allowlist instead of blindly sending the full internal token object.

## Required token SFX filenames

Put one supported file for each cue you want under:

`F:\DND WEB VTT\assets-source\audio\tokens\`

Examples:

- `token-pickup.ogg` / `.mp3` / `.wav`
- `token-drop.ogg` / `.mp3` / `.wav`
- `token-move.ogg` / `.mp3` / `.wav`
- `token-snap.ogg` / `.mp3` / `.wav`

The frontend reads the existing manifest. No frontend rebuild is needed when only replacing/adding SFX files with the expected cue names; the manager refreshes the manifest if a cue is missing.

## Movement rule in this milestone

This is the movement-budget foundation, not the final combat turn engine.

- Player-owned visible token + Player Self-Movement ON = player may drag it.
- Server measures grid distance using the project's current 5-ft-square distance rule.
- The distance is added to `movementUsedFeet`.
- A move exceeding `speedFeet` is rejected and the client rolls the token back.
- DM can reset movement manually.
- Later, Initiative/Combat will reset movement automatically at the start of the creature's turn.

## Files

- `src/App.tsx`
- `src/App.css`
- `src/components/MapViewport.tsx`
- `src/components/MapViewport.css`
- `src/types/scene.ts`
- `src/lib/audioManager.ts` (new)
- `server/server.ts`
