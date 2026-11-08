# Wordle n' Friends

Guess the word, race your friends, climb the ranks. A browser game (plain HTML/CSS/JS, no build step) that runs as a
static site, like Knock//Back: put it on GitHub Pages and it works, including online play.

## Run it

```bash
python tools/serve.py
```

Then open http://localhost:8777. (In Claude Code, the `wordle-n-friends` preview in `.claude/launch.json` does the same.)

Before deploying a new version, stamp the files so browsers fetch the new ones:

```bash
python tools/bump.py
```

Tests (word engine, scoring, CPU bots, rank maths; then each of the other games):

```bash
node tools/test.js
node tools/test_runes.js
node tools/test_wright.js
node tools/test_chess.js
```

## Screens

**Title → Log in / New player → the game picker.** Accounts live in the browser (salted SHA-256 passwords, as in
Knock//Back). Each account also gets an online identity: two P-256 key pairs made by WebCrypto at sign-up. Your player ID
is a hash of the signing key, and your **friend code** is `Name#TAG` (the TAG is the first four characters of that ID).

**The game picker** has the four games: **Wordle** big in the middle, **Runecasters** and **Wordwright** either side,
**Chess** below; plus the online lobby, friends, leaderboard and stats. Wordle opens its hub; each of the others opens
its own menu: a game against CPU players (1–3 or 5 of them, Easy / Normal / Hard, and the game's settings), or online
(quick match, host a room, challenge a friend who's online).

**The Wordle hub** has every Wordle mode, your rank and level, friends online, and the Friends / Messages buttons (with
unread counts) that sit in the top bar of every screen. If you step out of an online room, a banner takes you back to it.

## The other games

They're our own games, in the same genres as some well-known ones, with their own names, rules details and look.

| Game | What it is | Players |
| --- | --- | --- |
| Runecasters | A 5×5 grid of letter tiles: trace words through neighbouring tiles (diagonals count) for points, with rune tiles that multiply, and mana to reshuffle, transmute a tile or scry a strong word. Rounds; most points wins. Solo is a score attack. | 1–6 |
| Wordwright | A crossword tile game on a 15×15 board: build crossing words from a rack of seven tiles, on premium squares of our own layout. | 2–4 |
| Chess | Chess, with every rule (castling, en passant, promotion, the draw rules), optional clocks, and a CPU that searches in a background worker. | 2 |

Each game is one module (`js/runes.js`, `js/wright.js`, `js/chess.js`) following the contract at the top of
`js/games.js`: pure rules over plain data (setup, view, move, turn, timers, result, a CPU move) plus a screen.
`js/match.js` runs any of them against CPU players on your device, or on an online room's host. Runecasters and
Wordwright check words against a bigger dictionary than Wordle's (`js/dict.js`, ~79,000 words of 2–15 letters from
SCOWL, built by `tools/build_dict.js`), loaded only when one of them is opened (`js/lexicon.js`).

**Online**, the room's host runs the rules for everyone and sends each player their own view after every move (in
Wordwright, nobody else's game ever sees your rack or the bag). Rooms show which game they're for; the lobby's NEW ROOM
form, quick match and challenges all let you pick the game. A player who leaves forfeits a two-player game; in bigger
games their turns are skipped.

## Wordle modes

| Mode | Rules |
| --- | --- |
| Daily | One 5-letter word a day, the same for everyone. Streaks, guess spread, shareable result. Resumes if you reload. |
| Classic | Endless words of 4, 5, 6 or 7 letters (6, 6, 7, 8 guesses). |
| Quad | Four words at once, nine guesses; the keyboard shows each board's colours in its quarters. |
| Blitz | Three minutes, as many words as you can. The clock starts on your first guess. |
| Survival | A pool of 10 guesses; each solve refunds 5; six at most per word. |
| VS CPU | Race a computer player (Easy / Normal / Hard) to the same word, first to two rounds. |
| Online | Rooms of up to eight (Race, Blitz or Quad) and 1v1 Ranked. |

Hard mode (Options): hits stay in place and near letters must be reused. Online rooms set it per room.

## Music

Six themes: **title** (bouncy marimba pop), **menu** (lo-fi jazz), **lobby** (funky), **think** (calm piano for Daily,
Classic, Quad and Survival), **race** (driving chiptune for Blitz, VS CPU and online races, speeding up when the clock
runs low) and **ranked** (darker and heavier). Each comes in three versions, picked under Options → SOUNDTRACK:
**ElevenLabs** (the default) and **Suno**, made with those tools and cut into seamless loops (`music/elevenlabs/`,
`music/suno/`), and **Composed**, written in code and played by a small WebAudio sequencer (`js/music.js`). Music
cross-fades between screens, dips under results, and pauses when the tab is hidden; volume is under Options → MUSIC.
[music/README.md](music/README.md) has the prompts, how to add or replace a track (`tools/loopify.py` turns a song into
a loop), and a note on rights: both sets were made on free plans, which are for non-commercial use.

## Sound effects

Fourteen short clips made with ElevenLabs Sound Effects (`sfx/`): typing, tile flips (pitched for grey, yellow and
green), wins, losses, buttons, countdowns, notifications and level-ups. They can be turned off under Options → SOUND
EFFECTS. [sfx/README.md](sfx/README.md) has the prompts and how to replace one (`tools/sfxprep.py` trims and levels
a new clip). Same rights note as the music: free plan, non-commercial.

## Online (set up like Knock//Back)

There is no server of ours. Two pieces, both free and public, the same ones Knock//Back uses:

- **Two public MQTT brokers** (EMQX and HiveMQ) carry the social layer. Everything posted is signed with the player's key;
  anything unsigned, or claiming to be someone it isn't, is dropped. Topics under `wordle-n-friends/1/`:
  - `pres/<id>` presence (online now, what you're doing, your public room). Retained, refreshed every 25 s, wiped by the
    broker's last will when your browser goes away.
  - `prof/<id>` profile: name, rating, record, level, public keys. Kept; powers the leaderboard, friend search and "last seen".
  - `chat/<id>` your last few lobby-chat lines (two hours), kept so newcomers see the conversation.
  - `in/<id>/<msg>` your inbox: friend requests, messages, challenges, invites. Messages, challenges and invites are
    **encrypted to you** (ECDH + AES-GCM). Kept until your game reads them, then cleared, so a message to someone offline
    waits for them (as long as the free broker keeps it).
  - `rooms/<code>` the room list, exactly as in Knock//Back: each host keeps a retained note about its room, refreshed
    every 10 s, removed by its last will.
- **PeerJS (WebRTC)** links the browsers in a room directly. The host's game holds the hidden words and checks every
  guess, so no other player's game knows the answer until the round ends; everyone sees each other's progress as
  colours only.
- **The relay fallback** (`js/relay.js`). A direct link can't get through some home routers and most mobile networks,
  and the free relay servers WebRTC used to fall back on (PeerJS's own) have shut down. So if the direct link hasn't
  opened after 4 seconds (or fails), the room's messages go over the two MQTT brokers instead, under
  `rl/<code>/`, encrypted between the two games with a fresh ECDH key pair per link (AES-GCM), numbered so they
  arrive in order. Joining that way takes about 6 seconds. To test it on one computer, set
  `localStorage['wnf.relay'] = '"always"'` in the joining tab.

**The lobby**: Quick Match, Ranked Match, Host a room, Join by code, the room list, lobby chat, and everyone online
(friends first). Click anyone for their player card: add friend, message, **challenge** (a private two-player room opens
and they get an encrypted invite to accept), join their public room, block.

**Rooms** (like Knock//Back's): public or private (password), listed or code-only, locked, 2–8 players, typed or
quick-only chat, auto-start, kick / block / mute, sit out, watch matches you're not in. Rules: mode, word length, rounds
(1/3/5/10), time limit, hard mode. Scoring per round:
- Race: solve it for 100, +20 per guess you didn't need, +60/40/20 for the 1st/2nd/3rd to solve.
- Quad: 50 a board; finish all four for the race bonus too.
- Blitz: every word solved in the time, 50 + 10 per guess you didn't need.

**Ranked**: 1v1, three 5-letter Race rounds, fixed rules, matched by rating. Elo with K = 40 for your first 10 ranked
matches, then 24. Leaving a ranked match early is a loss. Tiers: Bronze (<950), Silver (950), Gold (1100), Platinum (1250),
Diamond (1400), each III/II/I, then Master (1550) and Legend (1700). Everyone starts at 1000 (Silver II).

**Friends**: add by `Name#TAG`, from the lobby, or from a player card; requests wait in the inbox until they're online.
Friends show online status and activity, and can be messaged, challenged, invited to your room, or joined.

**Messages**: one conversation per player, end-to-end encrypted. One tick = sent, two = their game has it. Options:
messages from everyone or friends only; swear filter.

### What to know about trust and privacy

- Like Knock//Back, the game trusts each player's own browser. Ratings on the leaderboard are what each player's game
  reports (signed, so nobody can post as someone else, but a determined cheater could edit their own save). The room host's
  game knows the words.
- Anything posted in the open on the brokers is public: names, ratings, statuses, lobby chat. Messages, challenges and
  invites are encrypted. In a room, the other players can see your IP address, as in any peer-to-peer game. A
  relayed room's messages pass through the public brokers encrypted, but nothing checks who answered first, so a
  determined attacker on the broker could sit in the middle of a relayed link (as with the trust note above).
- Accounts, friends lists and message history are stored per browser. A new device means a new account (a new ID).
- Free public brokers can drop retained messages; an offline message is best effort.

## Files

| File | What it does |
| --- | --- |
| `index.html` | the page; loads everything |
| `js/util.js` | DOM, storage, seeded random, text cleaning |
| `js/audio.js`, `js/music.js` | the sound effects (the clips in `sfx/`), and the soundtrack (the composed tracks, or the recorded sets in `music/`) |
| `sfx/` | the ElevenLabs sound effects, prompts and notes |
| `music/` | the ElevenLabs and Suno loops, `tracks.json` (their loop points), prompts and notes |
| `js/words.js` | the answer and guess lists (generated, ~215 KB) |
| `js/engine.js` | scoring, hard mode, games of 1–4 boards, the Daily word, the CPU solver |
| `js/auth.js` | accounts, saves, the per-account key pairs |
| `js/net.js` | the MQTT relay: presence, profiles, lobby chat, inbox, room list; signing and encryption |
| `js/social.js` | friends, messages, player cards, challenges and invites |
| `js/rank.js` | rating, tiers, levels, the leaderboard |
| `js/board.js` | the boards, keyboard and mini progress boards |
| `js/play.js` | the solo modes |
| `js/online.js` | the lobby, rooms (for any of the four games), quick / ranked match, the online match |
| `js/games.js` | the contract the other games follow, and their list |
| `js/match.js` | runs the other games: vs CPU on your device, or on a room's host; their game screen, results, stats and XP |
| `js/arcade.js` | the game picker, and each of the other games' menus |
| `js/runes.js`, `js/wright.js`, `js/chess.js` (+ `js/chess-ai.js`) | Runecasters, Wordwright and Chess: rules, CPU players, screens (styles in `css/`) |
| `js/lexicon.js`, `js/dict.js` | the big dictionary for Runecasters and Wordwright, loaded when first needed |
| `js/relay.js` | the fallback link for rooms, over the MQTT brokers, when a direct link can't get through |
| `js/menu.js` | title, login, the Wordle hub, options, stats, shared UI |
| `js/main.js` | screens and keyboard routing |
| `css/style.css` | all styles (dark and light themes, high-contrast tiles) |
| `sw.js`, `manifest.webmanifest`, `icons/` | installable app and offline solo play |
| `tools/` | dev server, version stamp, word-list and dictionary builders, icon maker, tests, song-to-loop cutter (`loopify.py`), sound-effect trimmer (`sfxprep.py`) |

## Word lists

From SCOWL (Spell Checker Oriented Word Lists) by Kevin Atkinson and others, via the `wordlist-english` npm package; the
notice is in `WORDS-LICENSE.txt`. Answers are the common words (SCOWL size 35 and below) without most plain inflections;
any word up to size 70 is a valid guess. To rebuild:

```bash
npm install --prefix ../wl-tmp wordlist-english
node tools/build_words.js ../wl-tmp/node_modules/wordlist-english
node tools/build_dict.js ../wl-tmp/node_modules/wordlist-english
```

The second builds `js/dict.js` for Runecasters and Wordwright: every word of 2–15 letters up to SCOWL size 60, without
letter plurals and slurs.
