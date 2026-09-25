// Synthetic cricket-audio generator for offline detector testing.
// Every generator returns a Float32Array added into the scene at a position.

export function rng(seed) {
    let s = seed >>> 0;
    return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
}
const U = (r, a, b) => a + (b - a) * r();
function gauss(r) { let u = 0, v = 0; while (u === 0) u = r(); v = r(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); }

function onePoleLP(x, fs, fc) { const a = Math.exp(-2 * Math.PI * fc / fs); let y = 0; for (let i = 0; i < x.length; i++) { y = (1 - a) * x[i] + a * y; x[i] = y; } return x; }
function onePoleHP(x, fs, fc) { const a = Math.exp(-2 * Math.PI * fc / fs); let y = 0, px = 0; for (let i = 0; i < x.length; i++) { y = a * (y + x[i] - px); px = x[i]; x[i] = y; } return x; }

// Damped modal "crack": bat/ball contact (middle) — very fast attack.
export function batHit(fs, r, amp = U(r, 0.25, 0.8)) {
    const len = Math.round(fs * 0.06), x = new Float32Array(len);
    const modes = 5 + Math.floor(r() * 4);
    for (let m = 0; m < modes; m++) {
        const f = U(r, 700, 6000), tau = U(r, 0.002, 0.010), ph = r() * 6.28, a = U(r, 0.3, 1);
        for (let i = 0; i < len; i++) { const t = i / fs; x[i] += a * Math.exp(-t / tau) * Math.sin(2 * Math.PI * f * t + ph); }
    }
    // broadband click (first ~0.7 ms)
    const cl = Math.round(fs * 0.0007);
    for (let i = 0; i < cl; i++) x[i] += gauss(r) * 1.5 * (1 - i / cl);
    return norm(x, amp);
}

// Faint edge/nick: thin, high-pitched, very short, quiet.
export function edgeHit(fs, r, amp = U(r, 0.02, 0.08)) {
    const len = Math.round(fs * 0.03), x = new Float32Array(len);
    for (let m = 0; m < 3; m++) {
        const f = U(r, 2500, 8000), tau = U(r, 0.0015, 0.005), ph = r() * 6.28;
        for (let i = 0; i < len; i++) { const t = i / fs; x[i] += Math.exp(-t / tau) * Math.sin(2 * Math.PI * f * t + ph); }
    }
    const cl = Math.round(fs * 0.0004);
    for (let i = 0; i < cl; i++) x[i] += gauss(r) * (1 - i / cl);
    return norm(x, amp);
}

// Ball on pad / ball bouncing / bat grounding softly — low-frequency thud.
export function thud(fs, r, amp = U(r, 0.3, 0.9)) {
    const len = Math.round(fs * 0.12), x = new Float32Array(len);
    const f = U(r, 90, 450), tau = U(r, 0.015, 0.04);
    const atk = Math.round(fs * U(r, 0.002, 0.006));
    for (let i = 0; i < len; i++) { const t = i / fs; const e = i < atk ? i / atk : Math.exp(-(i - atk) / fs / tau); x[i] = e * Math.sin(2 * Math.PI * f * t); }
    // a little slap noise, strongly low-passed
    const n = new Float32Array(len); for (let i = 0; i < Math.round(fs * 0.01); i++) n[i] = gauss(r) * 0.15 * Math.exp(-i / fs / 0.003);
    onePoleLP(n, fs, 700); for (let i = 0; i < len; i++) x[i] += n[i];
    return norm(x, amp);
}

// Speech: a syllable string with voiced vowels, fricatives and plosive bursts.
export function speech(fs, r, dur = U(r, 0.6, 2.0), amp = U(r, 0.1, 0.5)) {
    const len = Math.round(fs * dur), x = new Float32Array(len);
    let pos = 0;
    while (pos < len - fs * 0.1) {
        const kind = r();
        const sl = Math.round(fs * U(r, 0.12, 0.3));
        // optional consonant before vowel
        if (kind < 0.35) { // plosive t/k/p: silence gap, burst, aspiration
            pos += Math.round(fs * U(r, 0.02, 0.05));
            const bl = Math.round(fs * U(r, 0.003, 0.008)), al = Math.round(fs * U(r, 0.03, 0.08));
            const burstA = U(r, 0.4, 1.0), aspA = U(r, 0.25, 0.6);
            for (let i = 0; i < bl + al && pos + i < len; i++) {
                const e = i < bl ? burstA : aspA * (1 - (i - bl) / al * 0.5);
                x[pos + i] += gauss(r) * e * 0.5;
            }
            pos += bl + al;
        } else if (kind < 0.6) { // fricative s/sh
            const fl = Math.round(fs * U(r, 0.06, 0.15)), ramp = Math.round(fs * 0.012);
            const n = new Float32Array(fl); for (let i = 0; i < fl; i++) n[i] = gauss(r);
            onePoleHP(n, fs, 3500);
            for (let i = 0; i < fl && pos + i < len; i++) { const e = Math.min(1, i / ramp, (fl - i) / ramp); x[pos + i] += n[i] * e * 0.4; }
            pos += fl;
        }
        // vowel
        const f0 = U(r, 95, 240), F1 = U(r, 300, 800), F2 = U(r, 900, 2500), F3 = U(r, 2400, 3300);
        const ramp = Math.round(fs * U(r, 0.015, 0.04));
        for (let i = 0; i < sl && pos + i < len; i++) {
            const t = i / fs; const e = Math.min(1, i / ramp, (sl - i) / ramp);
            let v = 0;
            for (let h = 1; h * f0 < 7000; h++) {
                const fh = h * f0;
                const g = 1 / (1 + ((fh - F1) / 120) ** 2) + 0.5 / (1 + ((fh - F2) / 180) ** 2) + 0.25 / (1 + ((fh - F3) / 250) ** 2);
                v += g * Math.sin(2 * Math.PI * fh * t) / Math.sqrt(h);
            }
            x[pos + i] += v * e * 0.3;
        }
        pos += sl + Math.round(fs * U(r, 0.0, 0.08));
    }
    return norm(x, amp);
}

export function noiseBed(fs, len, r, { crowdDb = -48, windDb = -30 } = {}) {
    const x = new Float32Array(len);
    // pinkish crowd: sum of LP noise
    const w = new Float32Array(len); for (let i = 0; i < len; i++) w[i] = gauss(r);
    const b = [0, 0, 0];
    const crowdA = Math.pow(10, crowdDb / 20);
    for (let i = 0; i < len; i++) {
        b[0] = 0.99765 * b[0] + w[i] * 0.0990460; b[1] = 0.96300 * b[1] + w[i] * 0.2965164; b[2] = 0.57000 * b[2] + w[i] * 1.0526913;
        const swell = 1 + 0.5 * Math.sin(2 * Math.PI * 0.3 * i / fs);
        x[i] = (b[0] + b[1] + b[2] + w[i] * 0.1848) * 0.25 * crowdA * swell;
    }
    // wind: low-passed noise with gusts
    const wn = new Float32Array(len); for (let i = 0; i < len; i++) wn[i] = gauss(r);
    onePoleLP(wn, fs, 120); onePoleLP(wn, fs, 120);
    const windA = Math.pow(10, windDb / 20) * 20;
    for (let i = 0; i < len; i++) x[i] += wn[i] * windA * (0.5 + 0.5 * Math.sin(2 * Math.PI * 0.2 * i / fs + 1));
    return x;
}

function norm(x, amp) { const f = Math.min(240, x.length >> 2); for (let i = 0; i < f; i++) x[x.length - 1 - i] *= i / f; let m = 0; for (const v of x) m = Math.max(m, Math.abs(v)); const g = amp / (m || 1); for (let i = 0; i < x.length; i++) x[i] *= g; return x; }
export function mixAt(dst, src, at) { for (let i = 0; i < src.length && at + i < dst.length; i++) dst[at + i] += src[i]; }

/** Build a scene with ground-truth contacts and distractors. */
export function scene(fs, seconds, seed, opts = {}) {
    const r = rng(seed);
    const len = Math.round(fs * seconds);
    const x = noiseBed(fs, len, r, opts);
    const truth = [], distractors = [];
    let t = 0.8;
    while (t < seconds - 0.8) {
        const k = r();
        const at = Math.round(t * fs);
        if (k < 0.25) { mixAt(x, batHit(fs, r), at); truth.push({ sample: at, kind: 'bat' }); }
        else if (k < 0.45) { mixAt(x, edgeHit(fs, r, opts.edgeAmp ? opts.edgeAmp(r) : undefined), at); truth.push({ sample: at, kind: 'edge' }); }
        else if (k < 0.55) { // edge then pad 15–60 ms later (classic caught-behind vs LBW confusion)
            mixAt(x, edgeHit(fs, r), at); truth.push({ sample: at, kind: 'edge+pad' });
            mixAt(x, thud(fs, r), at + Math.round(fs * U(r, 0.015, 0.06))); distractors.push({ sample: at, kind: 'pad-after-edge' });
        }
        else if (k < 0.72) { mixAt(x, thud(fs, r), at); distractors.push({ sample: at, kind: 'thud' }); }
        else { const s = speech(fs, r); mixAt(x, s, at); distractors.push({ sample: at, kind: 'speech', len: s.length }); t += s.length / fs; }
        t += U(r, 0.5, 1.2);
    }
    for (let i = 0; i < len; i++) x[i] = Math.max(-1, Math.min(1, x[i]));
    return { x, truth, distractors };
}
