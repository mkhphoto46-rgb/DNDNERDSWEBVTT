# D&D WEB VTT — Token Identity, Player Colors, Map Rename & Hover Card v4

## Scope

This update builds on the currently working token placement / drag / movement / rename system.

### Added

1. **Player colors**
   - Every player gets a stable default color derived from the player's ID.
   - DM can change a connected player's color from the PARTY tab.
   - Changing a player's color updates all tokens currently owned by that player.
   - Assigning a token to a player automatically changes the token ring to that player's current color.

2. **Enemy / NPC token colors**
   - Every token has its own `Token Color` setting.
   - DM can use the color picker to put any number of enemy/NPC tokens into the same color group.
   - Unowned tokens default to the existing brass/gold color unless DM changes them.

3. **Token level**
   - Every token has a Level field.
   - New tokens start at Level 1.
   - Existing tokens without a stored level safely display as Level 1.
   - Current editable range: 1–30.

4. **Hover information for everyone**
   - Hovering a visible token on the battle map shows:
     - Token Name
     - Level
     - Movement used / movement speed
   - This works for DM and players.
   - Hidden tokens are still not sent to player clients.

5. **Map rename**
   - DM can rename every map from the MAPS tab.
   - Enter or blur saves.
   - Escape cancels.
   - The custom name is persistent in campaign state.
   - Renaming the currently active map also changes the large map title above the battlefield.
   - Activating the map later preserves the custom display name.

## Full replacement files

- `F:\DND WEB VTT\src\App.tsx`
- `F:\DND WEB VTT\src\App.css`
- `F:\DND WEB VTT\src\components\MapViewport.tsx`
- `F:\DND WEB VTT\src\components\MapViewport.css`
- `F:\DND WEB VTT\src\types\scene.ts`
- `F:\DND WEB VTT\server\server.ts`

## Data model additions

`SceneToken` now includes:

```ts
color: string
level: number
```

Campaign state now also uses:

```ts
mapNames?: Record<string, string>
playerColors?: Record<string, string>
```

No SQLite schema migration is required because these values live inside the existing campaign state document.

## Security

The player-safe server payload continues to filter hidden tokens. The new `color` and `level` fields are explicitly allowlisted and sanitized before being sent to players.

## Expected test

1. Open PARTY as DM and change Player A to blue.
2. Assign a token to Player A. Its ring should become blue.
3. Change Player A to green. All owned tokens should become green.
4. Set two unowned enemy tokens to the same red color.
5. Set one token Level to 7.
6. Hover it as DM: name, Level 7, movement should appear.
7. Join from a player browser and hover the same visible token: same hover card should appear.
8. In MAPS rename the current map.
9. The large title over the map should change and stay changed after refresh/restart.
