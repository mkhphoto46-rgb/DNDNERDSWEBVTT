# D&D WEB VTT — M0.5 Token Instance Foundation v6

## Why this exists

The same JPEG/PNG portrait in the Token Chest is a reusable **Token Asset**.
Every time it is placed on the map, the VTT must create a completely new
**Token Instance** with its own unique ID and fresh gameplay state.

You do NOT upload Skeleton.jpg four times to get four skeletons.

Correct workflow:

Skeleton.jpg (uploaded once)
→ Skeleton instance A
→ Skeleton instance B
→ Skeleton instance C
→ Skeleton instance D

Each instance starts independently with:
- Speed: 30 ft
- Movement Used: 0 ft
- Level: 1
- Size: 1 square
- Owner: DM
- Visible: true
- Unique token instance ID

Changing or removing one instance does not change the others and does not
change the reusable portrait in the Token Chest.

## Important UI clarification

The old label `Move 0/30 ft` was ambiguous.

`0` was movement **used**, not token speed.

The token list now says explicitly:

`Speed 30 ft • Used 0 ft • Left 30 ft`

This makes the three values impossible to confuse.

## Legacy state repair

If an older saved token contains an invalid speed of `0`, client hydration
repairs that invalid value to the current default of 30 ft. Negative movement
used values are repaired to 0.

## New tests

`src/lib/tokenInstances.test.ts` verifies:
- multiple instances from one portrait get different IDs
- both start at Speed 30 / Used 0
- changing one instance does not affect another
- invalid legacy zero-speed state is repaired
- movement summary correctly separates speed / used / remaining

## Files

Complete replacement:
- `F:\DND WEB VTT\src\App.tsx`

New complete files:
- `F:\DND WEB VTT\src\lib\tokenInstances.ts`
- `F:\DND WEB VTT\src\lib\tokenInstances.test.ts`

No database schema change is required.

## DM movement note

At the current pre-combat stage, moving a token as DM does not consume its
movement budget. Player-owned movement is server-limited when Player
Self-Movement is enabled.

That is intentional for scene setup right now. M2 (Initiative / Turns /
Movement) should introduce normal combat movement tracking for the active
combatant plus an explicit DM override, so enemy movement can be tracked
during combat without removing the DM's emergency control.
