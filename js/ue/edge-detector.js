/**
 * EdgeDetector — sample-accurate bat/ball contact ("snick") detector.
 *
 * Pure DSP, no browser APIs: runs inside the AudioWorklet (live), on the main
 * thread (video-file analysis) and in Node (offline test-suite).
 *
 * How it works (same idea as a broadcast snickometer operator's eye):
 *   1. 4th-order high-pass (default 1.8 kHz) removes voices' fundamentals,
 *      wind rumble, footsteps and most of the low "thud" of ball-on-pad.
 *   2. The high-passed signal is reduced to a 1 ms peak envelope.
 *   3. A slow, log-domain noise floor tracks the background (crowd, wind…).
 *   4. A candidate starts when the envelope jumps `snrDb` above the floor.
 *   5. The candidate is confirmed only if it is a genuine *impulse*:
 *        - rise:  ≥ riseDb louder than the 3–10 ms before it (sharp attack)
 *        - decay: falls by decayDropDb within maxDecayMs (short, no sustain)
 *      Speech plosives / claps-with-reverb / scraping sounds fail one of these.
 *   6. The exact onset sample is refined from a sample ring buffer, so the
 *      reported time is accurate to ~0.1 ms regardless of the 1 ms envelope.
 */

class Biquad {
    constructor() { this.b0 = 1; this.b1 = 0; this.b2 = 0; this.a1 = 0; this.a2 = 0; this.z1 = 0; this.z2 = 0; }
    highpass(fs, f0, q) {
        const w0 = 2 * Math.PI * f0 / fs, c = Math.cos(w0), s = Math.sin(w0), alpha = s / (2 * q);
        const a0 = 1 + alpha;
        this.b0 = ((1 + c) / 2) / a0; this.b1 = (-(1 + c)) / a0; this.b2 = ((1 + c) / 2) / a0;
        this.a1 = (-2 * c) / a0; this.a2 = (1 - alpha) / a0;
        return this;
    }
    lowpass(fs, f0, q) {
        const w0 = 2 * Math.PI * f0 / fs, c = Math.cos(w0), s = Math.sin(w0), alpha = s / (2 * q);
        const a0 = 1 + alpha;
        this.b0 = ((1 - c) / 2) / a0; this.b1 = (1 - c) / a0; this.b2 = ((1 - c) / 2) / a0;
        this.a1 = (-2 * c) / a0; this.a2 = (1 - alpha) / a0;
        return this;
    }
    step(x) { // transposed direct form II
        const y = this.b0 * x + this.z1;
        this.z1 = this.b1 * x - this.a1 * y + this.z2;
        this.z2 = this.b2 * x - this.a2 * y;
        return y;
    }
}

const DB = (a) => 20 * Math.log10(Math.max(a, 1e-7));

export const DEFAULT_PARAMS = {
    sensitivity: 85,     // 0..100 (maps to snrDb)
    hpfHz: 2500,         // high-pass corner for detection
    riseDb: 12,          // required jump vs. 3–10 ms before onset
    decayDropDb: 12,     // must fall this much below peak …
    maxDecayMs: 30,      // … within this time
    absFloorDb: -62,     // ignore anything quieter than this (dBFS)
    refractoryMs: 25,    // min gap between two reported contacts
    tailDropDb: 16,      // median level 8–40 ms after peak must be this far below peak
    thudRatioDb: 18,     // reject if low band (<700 Hz) jumps and dwarfs the HF band by this much
    floorTauMs: 400,     // noise-floor time constant (rise); falls 4× faster
};

export class EdgeDetector {
    constructor(sampleRate, params = {}) {
        this.fs = sampleRate;
        this.tick = Math.max(8, Math.round(sampleRate / 1000)); // samples per 1 ms
        this.params = { ...DEFAULT_PARAMS };
        this.hp1 = new Biquad(); this.hp2 = new Biquad(); this.lp = new Biquad();
        this.setParams(params);

        // 1 ms envelope history (dB)
        this.envSize = 512;
        this.env = new Float32Array(this.envSize).fill(-140);
        this.lowEnv = new Float32Array(this.envSize).fill(-140);
        this.lowPeak = 0;
        this.tickCount = 0;           // number of completed ticks
        this.tickPeak = 0; this.tickFill = 0;

        // high-passed sample history for onset refinement
        this.ringSize = 1 << 13;      // ~170 ms @ 48k
        this.ring = new Float32Array(this.ringSize);
        this.sampleCount = 0;         // absolute index of next sample

        this.floorDb = null;          // noise floor (dB)
        this.warmupTicks = 250;
        this.cands = [];              // candidates being evaluated
        this.freezeUntilTick = 0;
        this.nextAllowedTick = 0;
        this.debug = false;
        this.rejected = [];
    }

    setParams(p = {}) {
        Object.assign(this.params, p);
        const s = Math.min(100, Math.max(0, this.params.sensitivity));
        this.snrDb = 30 - (s / 100) * 22;          // 30 dB (0%) … 8 dB (100%)
        this.hp1.highpass(this.fs, this.params.hpfHz, 0.5412);  // Butterworth 4th order
        this.hp2.highpass(this.fs, this.params.hpfHz, 1.3066);
        this.lp.lowpass(this.fs, 700, 0.7071);
        this.floorAlphaUp = 1 / Math.max(1, this.params.floorTauMs);
        this.floorAlphaDown = 1 / Math.max(1, this.params.floorTauMs / 4);
    }

    lowAt(t) { return this.lowEnv[((t % this.envSize) + this.envSize) % this.envSize]; }
    envAt(t) { return this.env[((t % this.envSize) + this.envSize) % this.envSize]; }

    /**
     * Process a block. `hpOut` (optional) receives the high-passed signal.
     * Returns an array of confirmed contact events (usually empty).
     */
    process(input, hpOut = null) {
        const events = [];
        const n = input.length;
        for (let i = 0; i < n; i++) {
            const y = this.hp2.step(this.hp1.step(input[i]));
            if (hpOut) hpOut[i] = y;
            this.ring[this.sampleCount & (this.ringSize - 1)] = y;
            this.sampleCount++;
            const a = y < 0 ? -y : y;
            if (a > this.tickPeak) this.tickPeak = a;
            const l = this.lp.step(input[i]), la = l < 0 ? -l : l;
            if (la > this.lowPeak) this.lowPeak = la;
            if (++this.tickFill === this.tick) {
                this.lowEnv[this.tickCount % this.envSize] = DB(this.lowPeak);
                this._onTick(DB(this.tickPeak), events);
                this.tickPeak = 0; this.tickFill = 0; this.lowPeak = 0;
            }
        }
        return events;
    }

    _onTick(eDb, events) {
        const k = this.tickCount;
        this.env[k % this.envSize] = eDb;
        this.tickCount++;

        // --- noise floor ---------------------------------------------------
        if (this.floorDb === null) this.floorDb = eDb;
        if (this.floorDb < -96) this.floorDb = -96; // digital silence: keep SNR figures meaningful
        // (never gated on pending candidates: that deadlocks if the floor starts too low)
        if (k >= this.freezeUntilTick) {
            // sustained level well above the floor for >60 ms (not a hit): catch up fast
            this.aboveRun = eDb > this.floorDb + 6 ? (this.aboveRun || 0) + 1 : Math.max(0, (this.aboveRun || 0) - 2);
            const up = this.aboveRun > 60 ? 1 / 30 : this.floorAlphaUp;
            const a = eDb > this.floorDb ? up : this.floorAlphaDown;
            // cap how much a single loud tick can drag the floor up
            const d = Math.min(eDb - this.floorDb, 20);
            this.floorDb += a * d;
        }
        if (k < this.warmupTicks) return;

        const P = this.params;
        // --- candidate start (overlapping candidates allowed, so a noise blip
        //     that is being evaluated can never mask a real contact) ----------
        const last = this.cands[this.cands.length - 1];
        if (k >= this.nextAllowedTick && (!last || k - last.k0 >= 3) &&
            eDb - this.floorDb >= this.snrDb && eDb >= P.absFloorDb) {
            this.cands.push({ k0: k, floorDb: this.floorDb, evalAt: k + 4 + Math.max(40, Math.ceil(P.maxDecayMs)) + 2 });
        }
        // --- candidate evaluation -------------------------------------------
        while (this.cands.length && k >= this.cands[0].evalAt) {
            const c = this.cands.shift();
            if (c.k0 < this.nextAllowedTick) continue;   // swallowed by an accepted hit
            const ev = this._evaluate(c, k);
            if (ev) events.push(ev);
        }
    }

    _evaluate(c, k) {
        const P = this.params;
        // peak within first 4 ms
        let pk = c.k0, peakDb = this.envAt(c.k0);
        for (let t = c.k0 + 1; t <= c.k0 + 4; t++) { const v = this.envAt(t); if (v > peakDb) { peakDb = v; pk = t; } }
        // level just before the onset (3–12 ms earlier), 75th percentile
        const pre = [];
        for (let t = c.k0 - 12; t <= c.k0 - 3; t++) pre.push(this.envAt(t));
        pre.sort((a, b) => a - b);
        const preDb = pre[Math.floor(pre.length * 0.75)];
        const riseDb = peakDb - Math.max(preDb, c.floorDb);
        const snrDb = peakDb - c.floorDb;
        // quiet hits can't rise/decay more than they stand above the floor
        const needRise = Math.max(6, Math.min(P.riseDb, snrDb - 5));
        const needDrop = Math.max(6, Math.min(P.decayDropDb, snrDb - 4));
        // decay time
        let decayMs = Infinity;
        for (let t = pk + 1; t <= pk + Math.ceil(P.maxDecayMs) + 1 && t < this.tickCount; t++) {
            if (this.envAt(t) <= peakDb - needDrop) { decayMs = t - pk; break; }
        }
        // periodicity: voiced speech / rattles give a train of similar peaks
        let similar = 0;
        for (let t = c.k0 - 45; t <= pk + 45; t++) {
            if (t >= c.k0 - 2 && t <= pk + 2) continue;
            const v = this.envAt(t);
            if (v >= peakDb - 6 && v >= this.envAt(t - 1) && v > this.envAt(t + 1)) similar++;
        }
        // tail: median envelope 8–40 ms after the peak (a crack dies away; speech/scrapes don't)
        const tail = [];
        for (let t = pk + 8; t <= pk + 40 && t < this.tickCount; t++) tail.push(this.envAt(t));
        tail.sort((a, b) => a - b);
        const tailDb = tail.length ? tail[tail.length >> 1] : -140;
        const tailOk = tailDb <= peakDb - P.tailDropDb || tailDb <= c.floorDb + 6;
        // thud test: low band jumps at the same moment and is far louder than the HF band
        let lowPk = -140, lowPre = -140;
        for (let t = c.k0 - 1; t <= c.k0 + 6; t++) lowPk = Math.max(lowPk, this.lowAt(t));
        for (let t = c.k0 - 10; t <= c.k0 - 3; t++) lowPre = Math.max(lowPre, this.lowAt(t));
        const isThud = lowPk - lowPre > 6 && lowPk - peakDb > P.thudRatioDb;

        let reason = null;
        if (riseDb < needRise) reason = 'slow-attack';
        else if (similar >= 3) reason = 'periodic';
        else if (decayMs > P.maxDecayMs) reason = 'sustained';
        else if (!tailOk) reason = 'tail';
        else if (isThud) reason = 'thud';

        if (reason) {
            if (this.debug) this.rejected.push({ tick: c.k0, reason, riseDb, decayMs, snrDb, tailDb: tailDb - peakDb, low: lowPk - peakDb });
            return null;
        }
        this.freezeUntilTick = k + 20;
        this.nextAllowedTick = Math.max(pk + (isFinite(decayMs) ? decayMs : 0), c.k0 + P.refractoryMs);

        // --- refine onset to sample accuracy ---------------------------------
        const peakAmp = Math.pow(10, peakDb / 20);
        const floorAmp = Math.pow(10, c.floorDb / 20);
        // 0.4×peak: robust against codec (Opus) pre-echo smearing energy before the hit
        const thr = Math.max(0.4 * peakAmp, 2.5 * floorAmp);
        const startS = (c.k0 - 2) * this.tick;
        const endS = (pk + 1) * this.tick;
        let onset = c.k0 * this.tick;
        const oldest = this.sampleCount - this.ringSize;
        for (let s = Math.max(startS, oldest); s < endS; s++) {
            const v = this.ring[s & (this.ringSize - 1)];
            if ((v < 0 ? -v : v) >= thr) { onset = s; break; }
        }
        // dominant frequency estimate: zero crossings over 4 ms after onset
        let zc = 0; const zl = 4 * this.tick;
        let prev = this.ring[onset & (this.ringSize - 1)];
        for (let s = onset + 1; s < onset + zl && s < this.sampleCount; s++) {
            const v = this.ring[s & (this.ringSize - 1)];
            if ((v >= 0) !== (prev >= 0)) zc++;
            prev = v;
        }
        const freqHz = zc * this.fs / (2 * zl);
        const score = Math.max(0, Math.min(1,
            0.5 + (snrDb - this.snrDb) / 30 + (riseDb - P.riseDb) / 60 - (decayMs / P.maxDecayMs) * 0.15));

        return {
            sample: onset,
            time: onset / this.fs,
            peakDb: +peakDb.toFixed(1),
            snrDb: +snrDb.toFixed(1),
            riseDb: +riseDb.toFixed(1),
            decayMs,
            freqHz: Math.round(freqHz),
            score: +score.toFixed(2),
        };
    }
}

/** Convenience: run the detector over a whole buffer (file analysis). */
export function detectInBuffer(samples, sampleRate, params = {}, blockSize = 4096) {
    const det = new EdgeDetector(sampleRate, params);
    const out = [];
    for (let i = 0; i < samples.length; i += blockSize) {
        out.push(...det.process(samples.subarray(i, Math.min(samples.length, i + blockSize))));
    }
    // flush tail so a hit in the last 40 ms is still evaluated
    // (mirror the last 60 ms so the padding itself doesn't create a click)
    const padLen = Math.min(samples.length, Math.round(sampleRate * 0.06));
    const pad = new Float32Array(padLen);
    for (let i = 0; i < padLen; i++) pad[i] = samples[samples.length - 1 - i] * (1 - i / padLen);
    out.push(...det.process(pad));
    return out.filter(e => e.sample < samples.length - Math.round(sampleRate * 0.002));
}
