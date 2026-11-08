/* build_words.js -- makes js/words.js (the answer and guess lists) from SCOWL, the open word list by Kevin Atkinson.

   Usage (once, or whenever the rules below change):
     npm install --prefix <some scratch folder> wordlist-english
     node tools/build_words.js <that folder>/node_modules/wordlist-english

   GUESSES (any of these is a real word you may type): every lower-case, letters-only word of 4 to 7 letters in SCOWL
   size 70 and below, in American, British, Canadian and Australian spelling.
   ANSWERS (the words you're asked to find): the common ones only -- SCOWL size 35 and below (American and shared
   spelling), without most plain inflections (CATS, BAKED, BAKING, LATEST: their base words are answers already),
   and without a short list of words nobody wants as a puzzle answer.

   The lists are packed into one string per length (every word the same length, so no separators) and the guess list
   leaves out the answers (the game puts them back together). The SCOWL notice is in WORDS-LICENSE.txt. */
'use strict';
const fs = require('fs'), path = require('path');
const src = process.argv[2];
if (!src || !fs.existsSync(path.join(src, 'english-words-10.json'))) { console.error('usage: node tools/build_words.js <path to node_modules/wordlist-english>'); process.exit(1); }
const load = (dialect, lv) => { const f = path.join(src, dialect + '-words-' + lv + '.json'); return fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : []; };
const LENS = [4, 5, 6, 7];
const ok = w => /^[a-z]+$/.test(w) && LENS.includes(w.length);

const valid = new Set();
for (const d of ['english', 'american', 'british', 'canadian', 'australian']) for (const lv of [10, 20, 35, 40, 50, 55, 60, 70]) for (const w of load(d, lv)) if (ok(w)) valid.add(w);
// every word of any length (for "is the stem a word?")
const any = new Set();
for (const d of ['english', 'american']) for (const lv of [10, 20, 35, 40, 50, 55, 60, 70]) for (const w of load(d, lv)) if (/^[a-z]+$/.test(w)) any.add(w);

// never answers (they stay valid guesses)
const NOPE = new Set(('bitch bitches whore whores sluts slutty slut penis vagina rapes raped rapist nigga nigger negro fagot faggot fags dyke dykes homo homos spick spics kikes kike chink chinks gooks wanks wanker twats prick pricks pussy titty titties boobs boob cocks dicks dildo dildos horny porno porn semen sperm anus anal orgy orgasm nazis nazi crap crappy shit shits shitty piss pissed fucks fucked fucker damned damns arses arse butts turds turd farts fart craps poops poop pubes pubic boner boners bigot bigots retard retards spaz spazz tits balls vaginae vaginas penises clitoris scrotum testes sadism sadist').split(' '));

function inflected(w) {
  const has = s => s.length >= 3 && any.has(s);
  if (w.endsWith('s') && !w.endsWith('ss') && !w.endsWith('us') && !w.endsWith('is')) {
    if (has(w.slice(0, -1))) return true;                                                // cats, bakes
    if (w.endsWith('es') && has(w.slice(0, -2))) return true;                           // boxes, wishes
    if (w.endsWith('ies') && has(w.slice(0, -3) + 'y')) return true;                    // cities
    if (w.endsWith('ves') && (has(w.slice(0, -3) + 'f') || has(w.slice(0, -3) + 'fe'))) return true;   // knives
  }
  if (w.endsWith('ed')) {
    const b = w.slice(0, -2);
    if (has(b) || has(b + 'e') || has(w.slice(0, -1))) return true;                     // walked, baked
    if (b.length >= 3 && b[b.length - 1] === b[b.length - 2] && has(b.slice(0, -1))) return true;   // stopped
    if (w.endsWith('ied') && has(w.slice(0, -3) + 'y')) return true;                    // cried
  }
  if (w.endsWith('ing')) {
    const b = w.slice(0, -3);
    if (has(b) || has(b + 'e')) return true;
    if (b.length >= 3 && b[b.length - 1] === b[b.length - 2] && has(b.slice(0, -1))) return true;
  }
  if (w.endsWith('est')) { const b = w.slice(0, -3); if (has(b) || has(b + 'e') || (w.endsWith('iest') && has(w.slice(0, -4) + 'y'))) return true; }
  // comparatives: COLDER, CLOSER, JUMPIER (an -er word whose -est also exists; WATER and WORKER stay)
  if (w.endsWith('er') && any.has(w.slice(0, -2) + 'est')) return true;
  return false;
}

const answers = {}; const guesses = {};
for (const n of LENS) { answers[n] = new Set(); guesses[n] = []; }
for (const d of ['english', 'american']) for (const lv of [10, 20, 35]) for (const w of load(d, lv)) if (ok(w) && !NOPE.has(w) && !inflected(w)) answers[w.length].add(w);
for (const w of valid) if (!answers[w.length].has(w)) guesses[w.length].push(w);

const pack = arr => arr.slice().sort().join('');
const A = {}, V = {};
for (const n of LENS) { A[n] = pack([...answers[n]]); V[n] = pack(guesses[n]); }
const head = '/* words.js -- made by tools/build_words.js from SCOWL (Spell Checker Oriented Word Lists), Copyright 2000-2016 by\n' +
  '   Kevin Atkinson and others; the full notice is in WORDS-LICENSE.txt. Do not edit by hand.\n' +
  '   A[n]: the answers of n letters, V[n]: every other word of n letters you may guess; each is one packed string. */\n';
const out = head + 'window.WORDS = ' + JSON.stringify({ A, V }) + ';\n';
fs.writeFileSync(path.join(__dirname, '..', 'js', 'words.js'), out);
for (const n of LENS) console.log(n + ' letters: ' + answers[n].size + ' answers, ' + (answers[n].size + guesses[n].length) + ' valid');
console.log('js/words.js: ' + (out.length / 1024).toFixed(0) + ' KB');
fs.copyFileSync(path.join(src, 'Copyright'), path.join(__dirname, '..', 'WORDS-LICENSE.txt'));
