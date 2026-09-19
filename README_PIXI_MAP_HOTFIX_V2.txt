D&D WEB VTT — Pixi Map Renderer Hotfix v2

Root issue fixed:
The campaign asset URL intentionally has no file extension:
  /campaign-assets/<campaign>/<asset-id>

PixiJS Assets normally chooses its texture loader from URL file extensions.
The old renderer therefore could fail on a perfectly valid JPG/PNG response.

This hotfix:
- Loads the map through the browser's native Image element.
- Creates the Pixi Texture from the already-loaded HTMLImageElement.
- Keeps the existing immutable HTTP/browser cache.
- Forces WebGL for broader browser compatibility.
- Adds an on-screen map render error if loading fails.
- Fixes horizontal overflow in the Grid inspector.
- Makes number inputs shrink correctly inside the right panel.

No map re-upload is required.

Files:
- src/components/MapViewport.tsx
- src/components/MapViewport.css

Apply:
1) Stop server: Ctrl+C
2) Extract this ZIP over F:\DND WEB VTT
3) npm.cmd run build
4) npm.cmd run server
5) Open http://localhost:3000
6) Re-open the campaign and press Fit.
