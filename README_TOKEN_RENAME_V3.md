# D&D WEB VTT — Token Rename v3

## What this changes

The DM can now rename every placed token independently from the Tokens inspector.

- A `Name` field is shown with Size / Speed / Owner / Visible controls.
- Type the new name, then press **Enter** or click outside the field to save it.
- Press **Escape** to cancel and restore the current name.
- Empty names are rejected.
- Maximum token name length is 80 characters.
- The rename is saved in campaign state, so it persists after reload/restart.
- Renaming a placed token does **not** rename the source portrait in the Token Chest.
  This lets two tokens created from the same portrait have different names.

## Complete files replaced

- `F:\DND WEB VTT\src\App.tsx`
- `F:\DND WEB VTT\src\App.css`

No server/database schema change is required because `SceneToken.name` already exists
and the current campaign-state persistence system already saves token properties.
