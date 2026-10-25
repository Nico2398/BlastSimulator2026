# History — dev-audio

This file records why the rules in the `dev-audio` skill exist.

## What ships

Fair weather is close to silent and the diesel bed follows only nearby running machines because a constant background hiss or drone was the first thing a player complained about.

## Module map and data flow

- `AudioManager` has no mute API: `setMuted`, `isMuted` and `suspend` were removed because nothing called them.
- Startup cost: the heavy recipes (the synth wind, rain, machinery and thunder, 70 to 105 ms each in Chromium) were replaced by recordings, leaving blast_snap as the heaviest render. Not re-measured in a browser since.
- `ui_denied` is the only refusal sound: `ui_error` was removed, nothing played it.
