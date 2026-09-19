D&D WEB VTT — Cell Size Confirm Input Fix v1

Fix:
- Cell Size no longer applies on every keystroke.
- You can type values such as 70 normally.
- The new value is applied only when you press Enter or click/tap outside the field.
- Escape cancels the edit and restores the current saved value.
- Valid range remains 10–500 px.

Replaces only:
- src/App.tsx

Apply:
1) Stop server with Ctrl+C.
2) Extract this ZIP over F:\DND WEB VTT
3) Run: npm.cmd run build
4) Run: npm.cmd run server
5) Open http://localhost:3000
6) In Grid > Cell Size, type 70 and press Enter.
