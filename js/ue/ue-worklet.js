/**
 * UltraEdge AudioWorklet
 *  - runs EdgeDetector on every sample (no requestAnimationFrame sampling,
 *    nothing missed when the tab is busy or in the background)
 *  - streams raw + high-passed PCM to the main thread in small blocks
 *  - sample index == AudioContext frame (currentFrame), so every sample and
 *    every detected hit has an exact position on the context clock
 */
import { EdgeDetector } from './edge-detector.js';

const BLOCK = 1024; // samples per message (~21 ms @ 48 kHz)

class UltraEdgeProcessor extends AudioWorkletProcessor {
    constructor(options) {
        super();
        const p = (options && options.processorOptions) || {};
        this.det = new EdgeDetector(sampleRate, p.params || {});
        this.raw = new Float32Array(BLOCK);
        this.hp = new Float32Array(BLOCK);
        this.fill = 0;
        this.blockStart = -1;
        this.tmpHp = new Float32Array(128);
        this.mono = new Float32Array(128);
        this.expected = -1;
        this.port.onmessage = (e) => {
            if (e.data && e.data.type === 'params') this.det.setParams(e.data.params);
        };
    }

    process(inputs) {
        const input = inputs[0];
        const n = 128;
        const mono = this.mono;
        if (!input || input.length === 0 || !input[0]) {
            mono.fill(0);
        } else if (input.length === 1) {
            mono.set(input[0]);
        } else {
            // average channels (stereo phones / USB interfaces)
            const c = input.length;
            for (let i = 0; i < n; i++) { let s = 0; for (let ch = 0; ch < c; ch++) s += input[ch][i]; mono[i] = s / c; }
        }

        const frame = currentFrame; // global in AudioWorkletGlobalScope
        if (this.expected !== -1 && frame !== this.expected) {
            // a glitch/skip in the render clock: flush the partial block so indices stay exact
            this._flush();
        }
        this.expected = frame + n;

        const hits = this.det.process(mono, this.tmpHp);
        for (const h of hits) this.port.postMessage({ type: 'hit', hit: h });

        // detector sample index 0 == first frame we ever processed
        if (this.det.frameOrigin === undefined) {
            this.det.frameOrigin = frame;
            this.port.postMessage({ type: 'origin', frame, sampleRate });
        }

        let i = 0;
        while (i < n) {
            if (this.fill === 0) this.blockStart = frame + i;
            const k = Math.min(n - i, BLOCK - this.fill);
            this.raw.set(mono.subarray(i, i + k), this.fill);
            this.hp.set(this.tmpHp.subarray(i, i + k), this.fill);
            this.fill += k; i += k;
            if (this.fill === BLOCK) this._flush();
        }
        return true;
    }

    _flush() {
        if (this.fill === 0) return;
        const raw = this.raw.slice(0, this.fill), hp = this.hp.slice(0, this.fill);
        this.port.postMessage({ type: 'audio', start: this.blockStart, raw, hp }, [raw.buffer, hp.buffer]);
        this.fill = 0;
    }
}

registerProcessor('ultraedge-processor', UltraEdgeProcessor);
