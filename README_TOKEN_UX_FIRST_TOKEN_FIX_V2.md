# D&D WEB VTT — Token UX First-Token Fix v2

This hotfix is based on `DND_VTT_Token_UX_SFX_Movement_v1`.

## Fixes

- A newly placed first token exits PLACE TOKEN mode immediately instead of waiting for the state save request.
- Prevents an HTML drag from accidentally firing a follow-up click that re-arms PLACE TOKEN mode.
- Keeps the DM in Select mode after placement so the new token can be moved immediately.
- If persistence fails, the local state rolls back instead of leaving an unsaved ghost token.

## File replaced

`F:\DND WEB VTT\src\App.tsx`

## Expected behavior

1. Drag one portrait from Token Chest onto the map.
2. The very first token should immediately be movable in Select mode.
3. It should not require placing a second token.
4. Clicking a portrait still arms click-to-place mode normally.

## Movement rule reminder

- DM: unrestricted movement for all tokens.
- Player: movement only when Player Self-Movement is ON, the token is visible, and Owner is that player.
- Player movement budget is server-enforced from `speedFeet` / `movementUsedFeet`.
