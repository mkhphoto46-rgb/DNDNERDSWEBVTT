# D&D WEB VTT — Audio Asset Drop Folder

Place audio files under:

```text
F:\DND WEB VTT\assets-source\audio
```

Keep the generated category folders and use the cue names exactly. Supported
formats are `.ogg`, `.mp3`, and `.wav`. If more than one format exists for the
same cue, the server prefers OGG, then MP3, then WAV.

The server discovers files automatically at startup and on every manifest
request. No rebuild, database import, or code change is required after adding a
sound file. Restarting the local server is also unnecessary.

The availability manifest is available locally at:

```text
http://localhost:3000/api/audio/manifest
```

Missing files remain optional and never prevent the VTT from starting.
