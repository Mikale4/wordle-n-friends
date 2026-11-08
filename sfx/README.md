# Sound effects

The game's 14 sound effects, made with **ElevenLabs Sound Effects** and played by `js/audio.js`. Players can turn
them off under **Options → SOUND EFFECTS**. If a file can't load, the game plays a small synthesized stand-in instead
(the sounds the game had before these).

| File | Plays when | Take |
| --- | --- | --- |
| `key.mp3` | you type a letter (pitch varies a little each press) | 1 |
| `del.mp3` | you delete a letter | 2 |
| `flip.mp3` | a tile turns over; pitched down for grey, as made for yellow, up for green | 4 |
| `bad.mp3` | a guess isn't in the word list | 4 |
| `solve.mp3` | a word is solved in Blitz, Survival or online, or you win a round against the CPU | 2 |
| `win.mp3` | you win a game or a match | 4 |
| `lose.mp3` | you lose a game, or nobody gets the word | 2 |
| `ok.mp3` | a button or a mode card | 2 |
| `back.mp3` | back and close buttons | 2 |
| `tick.mp3` | the countdown before an online round; each CPU guess | 3 |
| `go.mp3` | "GO!" when an online round starts | 3 |
| `ping.mp3` | a friend request, a new friend, an invite, joining a room | 1 |
| `msg.mp3` | a new message | 4 |
| `level.mp3` | you reach a new level | 1 |

Each prompt made four takes, and the take column is the one picked by ear, next to the old sound, on a test page.

## Replacing a sound

1. Generate it (ElevenLabs Sound Effects, or anything else) and download it.
2. Trim and level it:

   ```bash
   python tools/sfxprep.py ~/Downloads/new-flip.mp3 sfx/flip.mp3 --like flip
   ```

   It cuts the silence before and after the sound, so it plays the moment the game asks for it, and matches the
   loudness of the sound it replaces. (Needs Python with numpy, and ffmpeg.)
3. Run `python tools/bump.py`, commit and push. The bump also clears the copies players' browsers saved for offline play.

## Prompts used

ElevenLabs Sound Effects, model v3, prompt influence 60%, loop off, prompt improvement off, four takes per prompt.

| Sound | Length | Prompt |
| --- | --- | --- |
| `key` | 0.5 s | A single soft click of a keyboard key, short and crisp, clean game interface sound, dry, no reverb |
| `del` | 0.5 s | A soft, short, muted backspace key click, slightly lower and duller than a normal key press, clean game interface sound, dry, no reverb |
| `flip` | 0.5 s | A single quick wooden letter tile flipping over and tapping down on a table, soft and satisfying, word game interface sound, dry, no reverb |
| `bad` | 0.8 s | A short friendly error buzz, two quick low muted blips, invalid word in a casual puzzle game, not harsh, clean game UI sound, dry |
| `solve` | 1 s | A quick bright two-note success chime, light and sparkly, word solved in a casual puzzle game, clean game UI sound |
| `win` | 2 s | A cheerful short victory jingle, bright marimba and bells playing a quick rising arpeggio, word puzzle solved, casual game, clean ending |
| `lose` | 2 s | A gentle descending three-note jingle on soft marimba, a playful aww for losing a round in a casual word puzzle game, not sad, clean ending |
| `ok` | 0.5 s | A soft, pleasant interface button click with a light round pop, menu select confirmation, clean game UI sound, dry, no reverb |
| `back` | 0.5 s | A soft interface click with a short downward pitch, menu back or cancel, gentle, clean game UI sound, dry, no reverb |
| `tick` | 0.5 s | A single very short, quiet, crisp clock tick, clean game interface sound, dry, no reverb |
| `go` | 0.8 s | A bright race start beep, a single high synth tone signalling GO after a countdown, casual game, clean game UI sound |
| `ping` | 1 s | A friendly two-note notification chime, bright soft bell, new friend request alert in a casual game, clean game UI sound |
| `msg` | 0.8 s | A short soft message-received pop with a light bubbly chime, chat notification in a casual game, clean game UI sound |
| `level` | 2.5 s | A sparkling level-up fanfare, quick rising chimes and a short bright brass flourish, celebratory casual game reward sound, clean ending |

The raw takes and the test page are kept in `src/` (not committed).

## Rights

Made on ElevenLabs' **free plan**, which is for non-commercial use, with ElevenLabs credited (Options shows "Made with
ElevenLabs Sound Effects."). Wordle n' Friends is free with no ads. If the game ever makes money, re-make these on a
paid plan (or switch back to the synthesized sounds in `js/audio.js`), and check ElevenLabs' current terms first.
