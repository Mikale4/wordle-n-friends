# Music

The game has three soundtracks of the same six themes. Players pick one under **Options → SOUNDTRACK**:

- **ElevenLabs** (the default): six tracks made with ElevenLabs Music, in `elevenlabs/`.
- **Suno**: six tracks made with Suno (v6-mini), in `suno/`.
- **Composed**: written in code and played by a small WebAudio sequencer (`js/music.js`); no files.

| Track | Plays on | Brief |
| --- | --- | --- |
| `title` | Title and log-in screens | Bright, bouncy marimba pop. C major, 118 BPM |
| `menu` | Hub, friends, messages, stats, options, leaderboard | Lo-fi jazz with electric piano and vinyl crackle. F major, 80 BPM |
| `lobby` | Online lobby and rooms | Funky and social: staccato keys, slap bass, claps, chiptune lead. G major, 108 BPM |
| `think` | Daily, Classic, Quad, Survival | Calm piano arpeggios, pad and bells. D major, 86 BPM |
| `race` | Blitz, VS CPU, online races | Driving chiptune. A minor, 136 BPM; speeds up when the clock runs low |
| `ranked` | Ranked matches | Darker and heavier synthwave. E minor, 126 BPM |

Music fades between tracks as you change screens, dips under results screens, and pauses when the tab is hidden.
Volume is under Options → MUSIC.

## How the files work

Each file in `elevenlabs/` and `suno/` is a ready-made loop: half a second of lead-in, the loop, then half a second of
the loop's start again. `tracks.json` gives each track's loop points (seconds) and a volume that brings it to about the
loudness of the composed tracks:

```json
{
  "default": "elevenlabs",
  "sets": {
    "elevenlabs": {
      "label": "ElevenLabs", "credit": "Made with ElevenLabs Music.",
      "tracks": { "race": { "file": "elevenlabs/race.mp3", "loopStart": 0.5, "loopEnd": 56.98, "gain": 0.58 } }
    }
  }
}
```

A set without a track falls back to the composed one. A plain map such as `{ "menu": "menu.mp3" }` also works and
shows up as "Your files".

The full-length originals are kept in `src/` (not committed: they're about 30 MB and the game doesn't need them).

## Adding or replacing a track

1. Generate the song (instrumental). Two minutes is plenty.
2. Turn it into a loop:

   ```bash
   python tools/loopify.py music/src/suno/race.mp3 music/suno/race.mp3 --bpm 136
   ```

   It finds the stretch of whole 4-bar phrases whose end sounds most like its start, blends the seam, sets a volume and
   prints the `tracks.json` entry. (Needs Python with numpy, and ffmpeg.) Give it the tempo you asked for; it measures
   the real one near that.
3. Paste the entry into `tracks.json`, run `python tools/bump.py`, commit and push.

Listen to the seam before you ship it: the script picks the best-matching loop it can find, but it can't hear.

## Prompts used

All made instrumental (ElevenLabs: lyrics off; Suno: lyrics left empty).

**ElevenLabs** (Music v2.5, 1:15, prompt rewriting off):

| Track | Prompt |
| --- | --- |
| `title` | Cheerful, bouncy instrumental title theme for a colourful word puzzle game: marimba melody, plucky synth bass, light pop drums, bright and welcoming. 118 BPM, C major. Steady energy from start to finish with no long intro and no fade-out, so it loops seamlessly. No vocals. |
| `menu` | Cozy lo-fi jazz hop for a game's main menu: mellow Rhodes electric piano chords, soft boom-bap drums, warm upright bass, gentle vinyl crackle. Relaxed and unobtrusive. 80 BPM, F major. Consistent groove throughout with no intro and no ending, so it loops seamlessly. No vocals. |
| `lobby` | Friendly, funky instrumental for an online game lobby where players chat and gather: staccato electric piano chords, groovy slap bass, claps, a playful chiptune lead melody. Social and upbeat. 108 BPM, G major. Steady groove from start to finish with no intro and no fade-out, so it loops seamlessly. No vocals. |
| `think` | Calm, focused background music for solving word puzzles: gentle piano arpeggios, soft warm pads, music-box bells, very light percussion. Relaxing but not sleepy. 86 BPM, D major. Even energy throughout with no build-ups and no ending, so it loops seamlessly. No vocals. |
| `race` | Fast, exciting chiptune race music for a head-to-head word game: driving square-wave bass, bright square-wave lead melody, rapid arpeggios, energetic four-on-the-floor drums. Competitive and fun. 136 BPM, A minor. Full energy from the first bar to the last with no intro and no ending, so it loops seamlessly. No vocals. |
| `ranked` | Intense, high-stakes battle music for a ranked 1v1 word game match: dark synthwave, heavy kick, pulsing sidechained bass, dramatic analog synth lead, tournament-final tension. 126 BPM, E minor. Full intensity throughout with no intro and no fade-out, so it loops seamlessly. No vocals. |

**Suno** (v6-mini, Advanced, duration 2:00, Styles field):

| Track | Styles |
| --- | --- |
| `title` | instrumental only, upbeat bouncy marimba pop, playful puzzle game title theme, bright plucky synths, light pop drums, cheerful and welcoming, 118 bpm, C major, steady energy, loopable video game music |
| `menu` | instrumental only, lo-fi jazz hop, mellow Rhodes electric piano, soft boom bap drums, warm upright bass, vinyl crackle, cozy game menu music, relaxed, 80 bpm, F major, steady groove, loopable video game music |
| `lobby` | instrumental only, funky upbeat game lobby music, staccato electric piano chords, slap bass, claps, playful chiptune lead melody, social and friendly, 108 bpm, G major, steady groove, loopable video game music |
| `think` | instrumental only, calm focused thinking music for a word puzzle game, gentle piano arpeggios, soft warm pads, music box bells, minimal percussion, relaxing, 86 bpm, D major, even energy, loopable video game music |
| `race` | instrumental only, fast energetic chiptune race music, driving square wave bass, bright square wave lead, rapid arpeggios, four-on-the-floor drums, competitive puzzle battle, 136 bpm, A minor, full energy throughout, loopable video game music |
| `ranked` | instrumental only, intense competitive puzzle battle theme, dark synthwave, heavy kick, pulsing sidechained bass, dramatic analog lead, tournament finals tension, 126 BPM, E minor, full intensity throughout, loopable video game music |

## Rights

Both sets were made on **free plans**, which don't include commercial rights: Suno's free plan is for non-commercial use
only, and ElevenLabs' free plan has no commercial licence for music. Wordle n' Friends is free with no ads, and both
sets are credited in Options. If the game ever makes money (ads, sales, paid features), re-make these tracks on a paid
plan or switch the default to the composed soundtrack. Check each service's current terms before you rely on this.
