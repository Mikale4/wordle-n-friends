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

Tests (word engine, scoring, CPU bots, rank maths):

```bash
node tools/test.js
```

## Screens

**Title → Log in / New player → Hub.** Accounts live in the browser (salted SHA-256 passwords, as in Knock//Back). Each
account also gets an online identity: two P-256 key pairs made by WebCrypto at sign-up. Your player ID is a hash of the
signing key, and your **friend code** is `Name#TAG` (the TAG is the first four characters of that ID).

**The hub** has every mode, your rank and level, friends online, and the Friends / Messages buttons (with unread counts)
that sit in the top bar of every screen. If you step out of an online room, a banner takes you back to it.

## Modes

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
  invites are encrypted. In a room, the other players can see your IP address, as in any peer-to-peer game.
- Accounts, friends lists and message history are stored per browser. A new device means a new account (a new ID).
- Free public brokers can drop retained messages; an offline message is best effort.

## Files

| File | What it does |
| --- | --- |
| `index.html` | the page; loads everything |
| `js/util.js` | DOM, storage, seeded random, text cleaning |
| `js/audio.js`, `js/music.js` | sound effects, and the soundtrack (the composed tracks, or the recorded sets in `music/`) |
| `music/` | the ElevenLabs and Suno loops, `tracks.json` (their loop points), prompts and notes |
| `js/words.js` | the answer and guess lists (generated, ~215 KB) |
| `js/engine.js` | scoring, hard mode, games of 1–4 boards, the Daily word, the CPU solver |
| `js/auth.js` | accounts, saves, the per-account key pairs |
| `js/net.js` | the MQTT relay: presence, profiles, lobby chat, inbox, room list; signing and encryption |
| `js/social.js` | friends, messages, player cards, challenges and invites |
| `js/rank.js` | rating, tiers, levels, the leaderboard |
| `js/board.js` | the boards, keyboard and mini progress boards |
| `js/play.js` | the solo modes |
| `js/online.js` | the lobby, rooms, quick / ranked match, the online match |
| `js/menu.js` | title, login, hub, options, stats, shared UI |
| `js/main.js` | screens and keyboard routing |
| `css/style.css` | all styles (dark and light themes, high-contrast tiles) |
| `sw.js`, `manifest.webmanifest`, `icons/` | installable app and offline solo play |
| `tools/` | dev server, version stamp, word-list builder, icon maker, tests, song-to-loop cutter (`loopify.py`) |

## Word lists

From SCOWL (Spell Checker Oriented Word Lists) by Kevin Atkinson and others, via the `wordlist-english` npm package; the
notice is in `WORDS-LICENSE.txt`. Answers are the common words (SCOWL size 35 and below) without most plain inflections;
any word up to size 70 is a valid guess. To rebuild:

```bash
npm install --prefix ../wl-tmp wordlist-english
node tools/build_words.js ../wl-tmp/node_modules/wordlist-english
```
