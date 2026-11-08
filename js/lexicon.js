/* lexicon.js -- the big dictionary (js/dict.js, ~79,000 words of 2-15 letters) for Runecasters and Wordwright,
   loaded the first time a game needs it.

     await Lex.load()     fetches js/dict.js (once) and builds the word graph; safe to call again
     Lex.ready            true once loaded
     Lex.has(word)        is it a word (lower case)
     Lex.root             the words as a graph of letters: node.e is true where a word ends, node.k[letter] is the
                          next node. It's a trie with identical endings shared (a DAWG), so it stays small; the CPU
                          players walk it to find words.
     Lex.make(words)      the same for any list ({ has, root }), for tests
*/
(function () {
  'use strict';
  const G = typeof window !== 'undefined' ? window : self;
  const ver = (() => { try { const m = String(document.currentScript.src).match(/[?&]v=(\w+)/); return m ? m[1] : ''; } catch (e) { return ''; } })();

  function make(words) {
    const root = { e: false, k: {} };
    for (const w of words) { let n = root; for (const ch of w) n = n.k[ch] || (n.k[ch] = { e: false, k: {} }); n.e = true; }
    const reg = new Map();
    const canon = n => {                                          // share identical subtrees, bottom up
      let sig = n.e ? '1' : '0';
      for (const c of Object.keys(n.k).sort()) { n.k[c] = canon(n.k[c]); sig += c + n.k[c].id; }
      let m = reg.get(sig);
      if (!m) { n.id = reg.size; reg.set(sig, n); m = n; }
      return m;
    };
    const top = canon(root);
    const has = w => { let n = top; for (let i = 0; i < w.length; i++) { n = n.k[w[i]]; if (!n) return false; } return n.e; };
    return { has, root: top, nodes: reg.size };
  }

  function unpack(D) {
    const out = [];
    for (const n in D) { const s = D[n], L = +n; for (let i = 0; i < s.length; i += L) out.push(s.substr(i, L)); }
    return out;
  }

  let loading = null;
  const Lex = G.Lex = {
    ready: false, root: null, count: 0,
    has: () => false,
    make,
    load() {
      if (Lex.ready) return Promise.resolve();
      if (loading) return loading;
      const build = () => { const words = unpack(G.DICT); const L = make(words); Lex.root = L.root; Lex.has = L.has; Lex.count = words.length; Lex.ready = true; };
      if (G.DICT) { build(); return Promise.resolve(); }
      loading = new Promise((res, rej) => {
        const s = document.createElement('script');
        s.src = 'js/dict.js' + (ver ? '?v=' + ver : ''); s.async = true;
        s.onload = () => { try { build(); res(); } catch (e) { rej(e); } };
        s.onerror = () => { loading = null; rej(new Error('Couldn\'t load the dictionary. Check your connection and try again.')); };
        document.head.append(s);
      });
      return loading;
    },
  };
})();
