"""sfxprep.py -- turn a generated sound effect into one of the game's sounds.

    python tools/sfxprep.py IN OUT.mp3 --like key        (or --rms 0.05)

Trims the silence before and after the sound (keeping 3 ms before it and 30 ms after, so it starts the moment
the game asks for it), fades the ends, sets its loudness and writes a 128 kbps MP3. --like NAME matches the
loudness (the loudest 50 ms) of the synthesized sound the game used to play for NAME; the table below has those
levels, measured before the effects' master volume. Needs numpy and an ffmpeg with libmp3lame on the PATH.
"""
import argparse, subprocess, sys
import numpy as np

SR = 44100
LIKE = {'key': 0.027, 'del': 0.0251, 'flip': 0.0519, 'bad': 0.0532, 'win': 0.1011, 'lose': 0.1258, 'ok': 0.0529,
        'back': 0.0431, 'ping': 0.0842, 'msg': 0.0662, 'level': 0.1035, 'tick': 0.013, 'go': 0.1097, 'solve': 0.0858}


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


def loudest(mono, win=0.05):
    w = int(win * SR)
    if len(mono) < w:
        return float(np.sqrt(np.mean(mono ** 2)))
    c = np.concatenate([[0], np.cumsum(mono.astype(np.float64) ** 2)])
    return float(np.sqrt((c[w:] - c[:-w]) / w).max())


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('src'); ap.add_argument('out')
    g = ap.add_mutually_exclusive_group(required=True)
    g.add_argument('--like', choices=sorted(LIKE), help='match the level of this sound')
    g.add_argument('--rms', type=float, help='the level to aim for (loudest 50 ms RMS)')
    ap.add_argument('--kbps', type=int, default=128)
    a = ap.parse_args()

    x = decode(a.src)
    m = np.abs(x).max(axis=1)
    pk = float(m.max())
    if pk < 0.01:
        sys.exit('the file is silent')
    on = max(0, int(np.argmax(m > pk * 10 ** (-40 / 20))) - int(0.003 * SR))              # 40 dB under the peak
    off = min(len(m), len(m) - int(np.argmax(m[::-1] > pk * 10 ** (-50 / 20))) + int(0.03 * SR))
    y = x[on:off].copy()
    fi = min(int(0.002 * SR), len(y) // 4)
    if on > 0 and fi:
        y[:fi] *= np.linspace(0, 1, fi)[:, None]
    fo = min(int((0.06 if len(y) > SR else 0.025) * SR), len(y) // 3)
    y[-fo:] *= np.linspace(1, 0, fo)[:, None] ** 2
    target = LIKE[a.like] if a.like else a.rms
    gain = min(target / max(loudest(y.mean(axis=1)), 1e-6), 0.95 / pk)
    y *= gain
    encode(y, a.out, a.kbps)
    print('%s: %.3f s (trimmed %.3f s from the start), gain %.2f' % (a.out, len(y) / SR, on / SR, gain))


if __name__ == '__main__':
    main()
