# D&D WEB VTT — Flexible Music Library

Put music under:

```text
F:\DND WEB VTT\assets-source\music
```

Every first-level folder is treated as a collection or environment. You can
rename the generated folders, add new folders, and nest more folders inside
them. Track names are derived from filenames and can be changed without editing
code.

Suggested starting collections:

```text
ambient
battle
boss
city
dungeon
forest
mystery
tavern
travel
```

Supported formats:

```text
MP3, OGG, OPUS, WAV, FLAC, M4A
```

The server scans the library whenever the API is requested, so adding music
does not require a rebuild or database import.

```text
http://localhost:3000/api/music/library
```

The planned scene audio controls will store track IDs and playback settings in
campaign state. They will include scene assignment, shuffle, loop, crossfade,
independent music/ambience volume, DM preview, and optional player sync.
