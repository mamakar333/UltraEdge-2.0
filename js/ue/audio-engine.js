/**
 * AudioEngine — owns the AudioContext, the UltraEdge worklet and a ring buffer
 * of the last N seconds of audio (raw + high-passed), indexed by context frame.
 *
 * Clock: every sample has a context frame F. toPerf(F) maps it to the
 * performance.now() clock (ms) using getOutputTimestamp(), i.e. the moment the
 * sample is *played out* — the same moment WebRTC/video elements display the
 * matching video frame (lip-sync domain). Remaining constant bias is removed
 * with the user calibration offset.
 */
import { DEFAULT_PARAMS } from './edge-detector.js';

export class AudioEngine {
    constructor({ seconds = 60, params = {} } = {}) {
        this.seconds = seconds;
        this.params = { ...DEFAULT_PARAMS, ...params };
        this.ctx = null;
        this.node = null;
        this.source = null;
        this.stream = null;
        this.origin = null;          // context frame of detector sample 0
        this.latestFrame = -1;       // last frame written (exclusive end)
        this.onHit = null;
        this.monitorGain = null;
        this._clockOffset = null;    // perf ms − context ms
        this.level = 0;              // recent peak (linear) for meters
    }

    get sampleRate() { return this.ctx ? this.ctx.sampleRate : 48000; }

    async start(stream) {
        await this.stop();
        const AC = window.AudioContext || window.webkitAudioContext;
        this.ctx = new AC({ latencyHint: 'interactive' });
        const fs = this.ctx.sampleRate;
        this.size = Math.round(fs * this.seconds);
        this.raw = new Float32Array(this.size);
        this.hp = new Float32Array(this.size);
        await this.ctx.audioWorklet.addModule(new URL('./ue-worklet.js', import.meta.url));
        this.node = new AudioWorkletNode(this.ctx, 'ultraedge-processor', {
            numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1],
            processorOptions: { params: this.params },
        });
        this.node.port.onmessage = (e) => this._onMessage(e.data);
        this.stream = stream;
        this.source = this.ctx.createMediaStreamSource(stream);
        this.source.connect(this.node);
        // keep the graph pulled; optional listen-through
        this.monitorGain = this.ctx.createGain();
        this.monitorGain.gain.value = 0;
        this.node.connect(this.monitorGain).connect(this.ctx.destination);
        this.monitorSource = this.source;
        if (this.ctx.state === 'suspended') await this.ctx.resume().catch(() => {});
        this._clockTimer = setInterval(() => this._updateClock(), 500);
        this._updateClock();
        return true;
    }

    async stop() {
        clearInterval(this._clockTimer);
        if (this.source) try { this.source.disconnect(); } catch { }
        if (this.node) try { this.node.disconnect(); this.node.port.onmessage = null; } catch { }
        if (this.ctx) try { await this.ctx.close(); } catch { }
        this.ctx = this.node = this.source = null;
        this.origin = null; this.latestFrame = -1; this._clockOffset = null;
    }

    setParams(p) {
        Object.assign(this.params, p);
        if (this.node) this.node.port.postMessage({ type: 'params', params: p });
    }

    /** Listen to the (raw) mic through the speakers — handy when positioning the mic. */
    setMonitor(on) {
        if (!this.ctx) return;
        if (on && !this._monitorPath) {
            this._monitorPath = this.ctx.createGain();
            this._monitorPath.gain.value = 1;
            this.source.connect(this._monitorPath).connect(this.ctx.destination);
        } else if (!on && this._monitorPath) {
            this._monitorPath.disconnect(); this._monitorPath = null;
        }
    }

    _updateClock() {
        if (!this.ctx) return;
        let off;
        if (this.ctx.getOutputTimestamp) {
            const ts = this.ctx.getOutputTimestamp();
            if (ts && ts.performanceTime > 0) off = ts.performanceTime - ts.contextTime * 1000;
        }
        if (off === undefined) off = performance.now() - this.ctx.currentTime * 1000 + (this.ctx.baseLatency || 0) * 1000;
        // smooth — the mapping only drifts slowly
        this._clockOffset = this._clockOffset === null ? off : this._clockOffset * 0.9 + off * 0.1;
    }

    /** context frame → performance.now() ms */
    toPerf(frame) {
        return frame / this.sampleRate * 1000 + (this._clockOffset ?? 0);
    }
    fromPerf(ms) {
        return Math.round((ms - (this._clockOffset ?? 0)) / 1000 * this.sampleRate);
    }

    _onMessage(m) {
        if (m.type === 'audio') {
            const n = m.raw.length;
            let w = m.start % this.size;
            let peak = 0;
            for (let i = 0; i < n; i++) {
                this.raw[w] = m.raw[i]; this.hp[w] = m.hp[i];
                const a = Math.abs(m.raw[i]); if (a > peak) peak = a;
                if (++w === this.size) w = 0;
            }
            this.latestFrame = m.start + n;
            this.level = Math.max(peak, this.level * 0.85);
        } else if (m.type === 'origin') {
            this.origin = m.frame;
        } else if (m.type === 'hit') {
            const h = m.hit;
            h.frame = (this.origin ?? 0) + h.sample;
            h.perf = this.toPerf(h.frame);
            if (this.onHit) this.onHit(h);
        }
    }

    /** Copy frames [f0, f1) out of the ring buffer (zeros where unavailable). */
    getRange(f0, f1, which = 'raw') {
        const src = which === 'hp' ? this.hp : this.raw;
        const n = Math.max(0, f1 - f0);
        const out = new Float32Array(n);
        const oldest = this.latestFrame - this.size;
        for (let i = 0; i < n; i++) {
            const f = f0 + i;
            if (f < oldest || f >= this.latestFrame || f < 0) continue;
            out[i] = src[f % this.size];
        }
        return out;
    }
}
