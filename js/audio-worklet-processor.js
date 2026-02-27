/**
 * VoiceSuppressionProcessor — AudioWorkletProcessor
 *
 * Implements a dual-follower transient gate to discriminate bat-ball impact
 * sounds from sustained human voice.
 *
 * Core algorithm — Fast/Slow RMS envelope tracking:
 *
 *   fast_rms tracks rapid amplitude changes (ms-scale transients).
 *   slow_rms tracks the long-term sustained energy (voice, crowd hum).
 *
 *   transient_ratio = fast_rms / slow_rms
 *
 *   When a bat-ball crack arrives it is a very short, very loud impulse.
 *   fast_rms spikes well above slow_rms → transient_ratio >> 1.
 *
 *   Voice is a quasi-steady signal; both followers track it similarly
 *   → transient_ratio stays near 1.
 *
 *   Gate logic:
 *     ratio >= OPEN_THRESHOLD  → transient detected, gate = 1.0 (full pass)
 *     ratio >= SOFT_THRESHOLD  → partial open,        gate = interpolated
 *     ratio <  SOFT_THRESHOLD  → sustained / voice,   gate = FLOOR (-26 dB)
 *
 *   After a transient the gate holds open for HOLD_QUANTA processor cycles
 *   (~30 ms) so the natural ring/decay of the bat-ball sound is preserved.
 *
 * Time constants (at 48 kHz, 128-sample quanta ≈ 2.67 ms each):
 *   Fast  α = 0.82  →  τ ≈ 13 ms   (catches sharp transients)
 *   Slow  α = 0.988 →  τ ≈ 180 ms  (tracks sustained voice/crowd)
 */

class VoiceSuppressionProcessor extends AudioWorkletProcessor {
    constructor() {
        super();

        // Exponential-moving-average coefficients (per 128-sample quantum)
        this.FAST_ALPHA = 0.82;   // fast envelope — sensitive to transients
        this.SLOW_ALPHA = 0.988;  // slow envelope — tracks sustained sounds

        // Gate thresholds (fast/slow RMS ratio)
        this.OPEN_THRESHOLD = 2.8;  // fully open  — confident bat-ball
        this.SOFT_THRESHOLD = 1.6;  // soft open   — possible transient
        this.GATE_FLOOR     = 0.05; // -26 dB      — suppressed (voice region)

        // Post-transient hold to preserve natural decay of bat-ball ring
        this.HOLD_QUANTA  = 11;    // ≈ 30 ms hold after gate opens
        this.holdCounter  = 0;

        // RMS followers (initialised to tiny non-zero to avoid div-by-zero)
        this.fastRms = 1e-5;
        this.slowRms = 1e-5;
    }

    process(inputs, outputs) {
        const input  = inputs[0];
        const output = outputs[0];
        if (!input[0] || !output[0]) return true;

        const inp = input[0];
        const out = output[0];
        const n   = inp.length; // always 128 samples

        // ── 1. Compute RMS of this quantum ───────────────────────────────────
        let sumSq = 0;
        for (let i = 0; i < n; i++) sumSq += inp[i] * inp[i];
        const rms = Math.sqrt(sumSq / n) + 1e-10;

        // ── 2. Update fast and slow followers ─────────────────────────────────
        this.fastRms = this.FAST_ALPHA * this.fastRms + (1 - this.FAST_ALPHA) * rms;
        this.slowRms = this.SLOW_ALPHA * this.slowRms + (1 - this.SLOW_ALPHA) * rms;

        // ── 3. Compute transient ratio ────────────────────────────────────────
        const ratio = this.fastRms / this.slowRms;

        // ── 4. Determine gate gain ────────────────────────────────────────────
        let gain;
        if (ratio >= this.OPEN_THRESHOLD) {
            // Clear bat-ball transient — open gate fully
            this.holdCounter = this.HOLD_QUANTA;
            gain = 1.0;
        } else if (this.holdCounter > 0) {
            // Hold open; gentle fade over the hold window
            gain = 0.25 + 0.75 * (this.holdCounter / this.HOLD_QUANTA);
            this.holdCounter--;
        } else if (ratio >= this.SOFT_THRESHOLD) {
            // Weak transient — partial open, linearly interpolated
            gain = this.GATE_FLOOR +
                   (1.0 - this.GATE_FLOOR) *
                   ((ratio - this.SOFT_THRESHOLD) /
                    (this.OPEN_THRESHOLD - this.SOFT_THRESHOLD));
        } else {
            // Sustained signal (voice, crowd hum) — suppress
            gain = this.GATE_FLOOR;
        }

        // ── 5. Apply gain to all samples in this quantum ──────────────────────
        for (let i = 0; i < n; i++) {
            out[i] = inp[i] * gain;
        }

        return true; // keep processor alive
    }
}

registerProcessor('voice-suppressor', VoiceSuppressionProcessor);
