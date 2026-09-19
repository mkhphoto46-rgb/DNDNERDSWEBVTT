D&D WEB VTT — Production UI Shell v1

This package replaces the old React frontend only.
It does not replace or delete the diagnostic /dev/connect page.

Files:
- src/App.tsx
- src/App.css
- src/index.css
- src/lib/socket.ts
- public/assets/ui/ornament.svg

After extracting over F:\DND WEB VTT:

1) Stop the local server with Ctrl+C.
2) Run:
   npm.cmd run build
3) Run:
   npm.cmd run server
4) DM opens:
   http://localhost:3000
5) Player opens:
   http://192.168.0.3:3000

The player now receives a Join screen and enters the tabletop directly after joining.
The active map is shown automatically.

The /dev/connect page remains available only for diagnostics.
