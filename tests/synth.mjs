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

// ---------------------------------------------------------------------------
// Harder distractors (a talking room, a TV, appeals) for the voice filter.

/** Speech closer to the real thing: plosive bursts are as sharp as an edge (1–4 ms, broadband, loud),
 *  aspiration is weak, and voicing (the vowel) starts 10–80 ms after the burst. */
export function realSpeech(fs, r, dur = U(r, 0.8, 2.5), amp = U(r, 0.1, 0.6)) {
    const len = Math.round(fs * dur), x = new Float32Array(len);
    let pos = 0;
    while (pos < len - fs * 0.12) {
        const kind = r();
        if (kind < 0.55) {                       // plosive t / k / p / ch
            pos += Math.round(fs * U(r, 0.03, 0.07));                 // closure (silence)
            const bl = Math.round(fs * U(r, 0.001, 0.004));
            const burstA = U(r, 0.6, 1.4);
            const b = new Float32Array(bl + Math.round(fs * 0.02));
            for (let i = 0; i < b.length; i++) b[i] = gauss(r) * (i < bl ? burstA : burstA * 0.15 * Math.exp(-(i - bl) / fs / 0.006));
            onePoleHP(b, fs, U(r, 1500, 3500));
            for (let i = 0; i < b.length && pos + i < len; i++) x[pos + i] += b[i];
            pos += bl + Math.round(fs * U(r, 0.01, 0.08));              // voice onset time
        } else if (kind < 0.75) {                // fricative s / sh / f
            const fl = Math.round(fs * U(r, 0.05, 0.14)), ramp = Math.round(fs * U(r, 0.004, 0.015));
            const n = new Float32Array(fl); for (let i = 0; i < fl; i++) n[i] = gauss(r);
            onePoleHP(n, fs, U(r, 2500, 5000));
            for (let i = 0; i < fl && pos + i < len; i++) { const e = Math.min(1, i / ramp, (fl - i) / ramp); x[pos + i] += n[i] * e * 0.5; }
            pos += fl;
        }
        pos += vowel(fs, r, x, pos, len, U(r, 0.08, 0.28));
        pos += Math.round(fs * U(r, 0.0, 0.1));
    }
    return norm(x, amp);
}

function vowel(fs, r, x, pos, len, secs, f0 = U(r, 90, 260), gain = 0.3) {
    const sl = Math.round(fs * secs);
    const F1 = U(r, 300, 850), F2 = U(r, 900, 2500), F3 = U(r, 2400, 3400);
    const ramp = Math.round(fs * U(r, 0.008, 0.03)), vib = U(r, 0, 0.04);
    let ph = 0;
    for (let i = 0; i < sl && pos + i < len; i++) {
        const t = i / fs, e = Math.min(1, i / ramp, (sl - i) / ramp);
        const f = f0 * (1 + vib * Math.sin(2 * Math.PI * 5 * t) - 0.1 * t);
        ph += 2 * Math.PI * f / fs;
        let v = 0;
        for (let h = 1; h * f < 7500; h++) {
            const fh = h * f;
            const g = 1 / (1 + ((fh - F1) / 120) ** 2) + 0.5 / (1 + ((fh - F2) / 180) ** 2) + 0.3 / (1 + ((fh - F3) / 250) ** 2);
            v += g * Math.sin(h * ph) / Math.sqrt(h);
        }
        x[pos + i] += v * e * gain;
    }
    return sl;
}

/** A fielder's appeal ("HOWZAT!"): loud, breathy /h/ then long shouted vowels. */
export function appeal(fs, r, amp = U(r, 0.4, 0.95)) {
    const len = Math.round(fs * U(r, 0.7, 1.2)), x = new Float32Array(len);
    let pos = 0;
    const hl = Math.round(fs * U(r, 0.03, 0.08));
    for (let i = 0; i < hl; i++) x[i] += gauss(r) * 0.25 * (i / hl);
    pos += hl;
    pos += vowel(fs, r, x, pos, len, U(r, 0.2, 0.35), U(r, 180, 380), 0.45);
    // "z/t" — a sharp stop in the middle
    pos += Math.round(fs * 0.04);
    for (let i = 0; i < Math.round(fs * 0.003) && pos + i < len; i++) x[pos + i] += gauss(r) * 1.2;
    pos += Math.round(fs * 0.02);
    vowel(fs, r, x, pos, len, U(r, 0.25, 0.45), U(r, 200, 420), 0.45);
    return norm(x, amp);
}

/** Hand clap: broadband slap (mid and high frequencies) with a short room tail. */
export function clap(fs, r, amp = U(r, 0.2, 0.7)) {
    const len = Math.round(fs * 0.25), x = new Float32Array(len);
    const bl = Math.round(fs * U(r, 0.002, 0.006)), tail = U(r, 0.02, 0.07);
    for (let i = 0; i < len; i++) x[i] = gauss(r) * (i < bl ? 1 : 0.35 * Math.exp(-(i - bl) / fs / tail));
    const lp = x.slice(); onePoleLP(lp, fs, 1800);
    for (let i = 0; i < len; i++) x[i] = 0.6 * x[i] + 1.4 * lp[i];      // claps are strong around 1–2 kHz
    return norm(x, amp);
}

/** TV / music: plucked and struck notes with harmonics (sharp attacks, tonal decays). */
export function music(fs, r, dur = U(r, 1.5, 3.5), amp = U(r, 0.05, 0.3)) {
    const len = Math.round(fs * dur), x = new Float32Array(len);
    let t = 0;
    while (t < dur - 0.2) {
        const at = Math.round(t * fs), f0 = 110 * Math.pow(2, Math.floor(U(r, 0, 30)) / 12), tau = U(r, 0.15, 0.6);
        const nl = Math.min(len - at, Math.round(fs * tau * 4));
        for (let i = 0; i < nl; i++) {
            const tt = i / fs; let v = 0;
            for (let h = 1; h <= 8 && h * f0 < 9000; h++) v += Math.exp(-tt * h / tau) * Math.sin(2 * Math.PI * h * f0 * tt) / h;
            x[at + i] += v * Math.min(1, i / (fs * 0.001));
        }
        t += U(r, 0.12, 0.5);
    }
    return norm(x, amp);
}

/** A room like the one at home: people talking, TV music, claps and appeals among real contacts. */
export function hardScene(fs, seconds, seed, opts = {}) {
    const r = rng(seed);
    const len = Math.round(fs * seconds);
    const x = noiseBed(fs, len, r, { crowdDb: -50, windDb: -40, ...opts });
    const truth = [], distractors = [];
    let t = 0.8;
    while (t < seconds - 1.5) {
        const k = r(), at = Math.round(t * fs);
        if (k < 0.12) { mixAt(x, batHit(fs, r), at); truth.push({ sample: at, kind: 'bat' }); }
        else if (k < 0.24) {
            // edge, then the appeal 0.15–0.6 s later (must still count the edge)
            mixAt(x, edgeHit(fs, r, U(r, 0.04, 0.1)), at); truth.push({ sample: at, kind: 'edge' });
            if (r() < 0.6) { const a = appeal(fs, r), d = at + Math.round(fs * U(r, 0.15, 0.6)); mixAt(x, a, d); distractors.push({ sample: d, kind: 'appeal', len: a.length }); t += 0.6 + a.length / fs; }
        }
        else if (k < 0.62) { const s = realSpeech(fs, r); mixAt(x, s, at); distractors.push({ sample: at, kind: 'speech', len: s.length }); t += s.length / fs; }
        else if (k < 0.72) { const a = appeal(fs, r); mixAt(x, a, at); distractors.push({ sample: at, kind: 'appeal', len: a.length }); t += a.length / fs; }
        else if (k < 0.82) { mixAt(x, clap(fs, r), at); distractors.push({ sample: at, kind: 'clap', len: Math.round(fs * 0.25) }); }
        else if (k < 0.92) { const m = music(fs, r); mixAt(x, m, at); distractors.push({ sample: at, kind: 'tv-music', len: m.length }); t += m.length / fs; }
        else { mixAt(x, thud(fs, r), at); distractors.push({ sample: at, kind: 'thud' }); }
        t += U(r, 0.4, 1.0);
    }
    for (let i = 0; i < len; i++) x[i] = Math.max(-1, Math.min(1, x[i]));
    return { x, truth, distractors };
}
