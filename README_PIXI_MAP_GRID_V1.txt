D&D WEB VTT — Pixi Map Camera + Square Grid Foundation v1

Files replaced/added:
- src/App.tsx
- src/App.css
- src/components/MapViewport.tsx
- src/lib/mapCamera.ts
- src/types/scene.ts

This milestone adds:
- PixiJS map rendering
- free pan at every zoom level
- mouse-wheel zoom centered on the cursor
- Fit and 100% camera controls
- double-click to Fit
- square grid overlay
- per-map cell size / X offset / Y offset / opacity
- persisted grid calibration
- grid shared with players through activeMap
- camera remains local to each browser
- DM d20 remains private/local; no Socket.IO dice event is sent

Architecture lock for future tokens:
Map, grid, tokens, fog, walls and lights will all live in the same Pixi world coordinate system.
The camera transforms the world container, not the individual objects.
Therefore tokens stay pinned to grid/map coordinates while zooming and panning.

Apply:
1) Stop the server with Ctrl+C.
2) Extract this ZIP over F:\DND WEB VTT
3) Run: npm.cmd run build
4) Run: npm.cmd run server
5) DM: http://localhost:3000
6) Player LAN: http://192.168.0.3:3000
