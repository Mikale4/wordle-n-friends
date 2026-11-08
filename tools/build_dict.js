/* build_dict.js -- makes js/dict.js, the dictionary Runecasters and Wordwright check words against, from SCOWL.

   Usage (once, or whenever the rules below change):
     npm install --prefix <some scratch folder> wordlist-english
     node tools/build_dict.js <that folder>/node_modules/wordlist-english

   WORDS: every lower-case, letters-only word of 2 to 15 letters in SCOWL size 60 and below, in American, British,
   Canadian and Australian spelling; minus letter plurals ("cs", "ts") and the slurs and swears the Wordle answer
   list leaves out (tools/build_words.js), so neither a player nor a CPU can put them on a board.
   Packed one string per length (every word the same length, so no separators), sorted. */
'use strict';
const fs = require('fs'), path = require('path');
const src = process.argv[2];
if (!src || !fs.existsSync(path.join(src, 'english-words-10.json'))) { console.error('usage: node tools/build_dict.js <path to node_modules/wordlist-english>'); process.exit(1); }
const load = (dialect, lv) => { const f = path.join(src, dialect + '-words-' + lv + '.json'); return fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : []; };
const LEVELS = [10, 20, 35, 40, 50, 55, 60];
const NOPE = new Set(('cs gs ks ls ms rs ts es bitch bitches bitchy whore whores sluts slutty slut rapes raped rapist nigga nigger niggers negro negroes fagot faggot faggots fag fags dyke dykes spick spics kikes kike chink chinks gook gooks ' +
  'wank wanks wanked wanking wanker wankers twat twats cunt cunts retard retards spaz spazz fuck fucks fucked fucker fuckers fucking shit shits shitty shite ' +
  'piss pissed pisses pissing crap craps crapped crappy arse arses arsehole arseholes asshole assholes bollock bollocks tits titty titties boob boobs boner boners dildo dildos porn porno porny jizz turd turds fart farts farted farting').split(' '));

const words = new Set();
for (const d of ['english', 'american', 'british', 'canadian', 'australian']) for (const lv of LEVELS) for (const w of load(d, lv)) if (/^[a-z]{2,15}$/.test(w) && !NOPE.has(w)) words.add(w);
/* a few short words from SCOWL's bigger lists that word games live on: without them a Wordwright rack holding Q, J or X
   has nowhere to go (QI is the Q without a U). Added only if SCOWL has them. */
const EXTRA = 'ai ja jo ka ki qi xi xu qadi qadis'.split(' ');
const big = new Set(); for (const d of ['english', 'american', 'british']) for (const lv of [70, 80, 95]) for (const w of load(d, lv)) big.add(w);
for (const w of EXTRA) if (big.has(w)) words.add(w);
const D = {};
for (const w of words) (D[w.length] = D[w.length] || []).push(w);
for (const n in D) D[n] = D[n].sort().join('');
const head = '/* dict.js -- made by tools/build_dict.js from SCOWL (Spell Checker Oriented Word Lists), Copyright 2000-2016 by\n' +
  '   Kevin Atkinson and others; the full notice is in WORDS-LICENSE.txt. Do not edit by hand.\n' +
  '   DICT[n]: every word of n letters, sorted, packed into one string. Loaded by js/lexicon.js when a game needs it. */\n';
const out = head + 'window.DICT = ' + JSON.stringify(D) + ';\n';
fs.writeFileSync(path.join(__dirname, '..', 'js', 'dict.js'), out);
console.log(words.size + ' words; js/dict.js: ' + (out.length / 1024).toFixed(0) + ' KB');
