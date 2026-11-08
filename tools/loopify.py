"""loopify.py -- turn a generated song into a game music loop.

    python tools/loopify.py IN.mp3 OUT.mp3 --bpm 118 [--min 40] [--target 0.1]

Finds a stretch of the song that loops cleanly (a whole number of 4-bar phrases whose end sounds
like its start), blends the seam, and writes OUT.mp3 laid out as

    [0.5 s lead-in][loop ......................................][0.5 s of the loop's start again]
                   ^ loopStart                                  ^ loopEnd

so the game can loop between loopStart and loopEnd (music/tracks.json). The extra half second on
each side keeps the seam clean even if a browser shifts an MP3's timing by a few milliseconds.
Prints the JSON entry for tracks.json (file, loopStart, loopEnd, gain). The gain brings the loop to
about the loudness of the composed tracks (--target is the RMS it aims for).

Needs numpy and an ffmpeg with libmp3lame on the PATH.
"""
import argparse, json, os, subprocess, sys
import numpy as np

SR = 44100
HOP = 512
XF = 0.5                      # crossfade / lead-in / tail, seconds


def decode(path):
    p = subprocess.run(['ffmpeg', '-v', 'error', '-i', path, '-f', 'f32le', '-ac', '2', '-ar', str(SR), '-'],
                       stdout=subprocess.PIPE, check=True)
    return np.frombuffer(p.stdout, dtype=np.float32).reshape(-1, 2).copy()


def encode(x, path, kbps):
    p = subprocess.Popen(['ffmpeg', '-v', 'error', '-y', '-f', 'f32le', '-ar', str(SR), '-ac', '2', '-i', '-',
                          '-c:a', 'libmp3lame', '-b:a', '%dk' % kbps, path], stdin=subprocess.PIPE)
    p.communicate(np.clip(x, -1, 1).astype(np.float32).tobytes())
    if p.returncode:
        sys.exit('ffmpeg failed')


def frames(mono):
    n = 1 + (len(mono) - 2048) // HOP
    idx = np.arange(2048)[None, :] + HOP * np.arange(n)[:, None]
    return mono[idx] * np.hanning(2048)[None, :]


def features(mono):
    """log band energies per frame (48 log-spaced bands, 40 Hz - 16 kHz), each frame unit length"""
    spec = np.abs(np.fft.rfft(frames(mono), axis=1))
    freqs = np.fft.rfftfreq(2048, 1 / SR)
    edges = np.geomspace(40, 16000, 49)
    bands = np.stack([spec[:, (freqs >= lo) & (freqs < hi)].sum(axis=1) for lo, hi in zip(edges[:-1], edges[1:])], 1)
    f = np.log1p(bands * 10)
    f -= f.mean(axis=1, keepdims=True)
    return f / (np.linalg.norm(f, axis=1, keepdims=True) + 1e-9), spec


def onset_env(spec):
    s = np.log1p(spec * 10)
    d = np.maximum(0, np.diff(s, axis=0)).sum(axis=1)
    d = np.concatenate([[0], d])
    return d - np.convolve(d, np.ones(43) / 43, mode='same')        # remove the slow trend


def beat_period(env, bpm_hint):
    """seconds per beat, from the onset envelope's autocorrelation, looking near the hinted tempo"""
    e = env - env.mean()
    ac = np.correlate(e, e, mode='full')[len(e) - 1:]
    fps = SR / HOP
    best = None
    for mult in (1.0, 0.5, 2.0):
        lo, hi = bpm_hint * mult * 0.9, bpm_hint * mult * 1.1
        if lo < 50 or hi > 220:
            continue
        for bpm in np.arange(lo, hi, 0.05):
            lag = fps * 60 / bpm
            i = int(lag)
            v = ac[i] + (ac[i + 1] - ac[i]) * (lag - i)
            v *= 1.0 if mult == 1.0 else 0.9                      # prefer the tempo we asked for
            if best is None or v > best[0]:
                best = (v, bpm / mult)
    return 60 / best[1], best[1]


def body_range(mono):
    """first and last moments the track is at full level (skips a quiet intro and a fade-out)"""
    c = np.concatenate([[0], np.cumsum(mono.astype(np.float64) ** 2)])
    i = np.arange(0, len(mono), HOP)
    lo, hi = np.clip(i - SR // 2, 0, len(mono)), np.clip(i + SR // 2, 0, len(mono))
    rms = np.sqrt((c[hi] - c[lo]) / np.maximum(hi - lo, 1))           # 1 s moving RMS
    mid = np.median(rms[len(rms) // 5: -len(rms) // 5])
    ok = np.where(rms > 0.6 * mid)[0]
    return ok[0] * HOP / SR, ok[-1] * HOP / SR


def sim(F, a, b, w, pre):
    """how alike the music is around two moments: `pre` frames before and `w` frames after each"""
    return float(np.mean(np.sum(F[a - pre:a + w] * F[b - pre:b + w], axis=1)))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('src'); ap.add_argument('out')
    ap.add_argument('--bpm', type=float, required=True)
    ap.add_argument('--min', type=float, default=40, help='shortest loop to accept, seconds')
    ap.add_argument('--target', type=float, default=0.1, help='loop RMS the gain aims for')
    ap.add_argument('--search', type=float, default=24, help='how far into the song the loop may start, seconds')
    ap.add_argument('--kbps', type=int, default=128)
    a = ap.parse_args()

    x = decode(a.src)
    mono = x.mean(axis=1)
    F, spec = features(mono)
    fps = SR / HOP
    beat, bpm = beat_period(onset_env(spec), a.bpm)
    bar = 4 * beat
    t0, t1 = body_range(mono)
    w = int(3.0 * fps)                                          # compare 3 s after each side of the seam
    pre = int(1.5 * fps)                                        # and the 1.5 s leading into it (the blend uses that)

    s_lo = max(t0, 1.6)
    best = None
    for s_t in np.arange(s_lo, s_lo + max(2 * bar, a.search), beat / 2):   # start on any half beat early on
        s = int(s_t * fps)
        for n in range(4, 200, 4):                              # loops of 4, 8, 12 ... bars
            L = n * bar
            if s_t + L + 3.0 > t1 or L > 150:
                break
            if L < a.min:
                continue
            c = int(round(L * fps))
            # let the length drift up to 1% (tempo estimate error), keep the best match
            span = max(2, int(0.01 * L * fps))
            if s + c + span + w > len(F):
                break
            scores = [(sim(F, s, s + k, w, pre), k) for k in range(c - span, c + span + 1)]
            v, k = max(scores)
            score = v + 0.0008 * n                              # a longer loop is worth a little
            if best is None or score > best[0]:
                best = (score, v, s, k, n)
    if best is None:
        sys.exit('no loop found (track too short?)')
    _, v, s, k, n = best
    start = s * HOP
    length = k * HOP

    # sample-accurate seam: line the waveform after the loop end up with the loop start
    probe = mono[start:start + int(0.25 * SR)]
    lo = start + length - int(0.015 * SR)
    seg = mono[lo:lo + len(probe) + int(0.03 * SR)]
    cc = np.correlate(seg, probe, mode='valid')
    c2 = np.concatenate([[0], np.cumsum(seg.astype(np.float64) ** 2)])
    norm = np.sqrt(c2[len(probe):] - c2[:-len(probe)]) * np.linalg.norm(probe) + 1e-9
    length = lo + int(np.argmax(cc / norm)) - start

    xf = int(XF * SR)
    loop = x[start:start + length].copy()
    t = np.linspace(0, np.pi / 2, xf)[:, None]
    loop[-xf:] = loop[-xf:] * np.cos(t) + x[start - xf:start] * np.sin(t)   # end flows into what precedes the start
    out = np.concatenate([x[start - xf:start], loop, x[start:start + xf]])

    rms = float(np.sqrt(np.mean(loop ** 2)))
    peak = float(np.abs(loop).max())
    gain = round(min(1.0, a.target / max(rms, 1e-6)), 2)
    encode(out, a.out, a.kbps)

    info = {'file': os.path.basename(a.out), 'loopStart': round(XF, 4), 'loopEnd': round(XF + length / SR, 4), 'gain': gain}
    print(json.dumps(info))
    print('  bpm %.2f, loop %d bars = %.2f s from %.2f s (song %.1f s, full level %.1f-%.1f s), seam match %.3f, rms %.3f, peak %.2f'
          % (bpm, n, length / SR, start / SR, len(x) / SR, t0, t1, v, rms, peak), file=sys.stderr)


if __name__ == '__main__':
    main()
