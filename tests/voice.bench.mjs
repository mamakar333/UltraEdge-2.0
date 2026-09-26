// Talking-room benchmark: real contacts vs speech, appeals, claps, TV music.
// Usage: node tests/voice.bench.mjs [--n=20] [--sens=85] [--voice=0|1] [--v]
import { detectInBuffer } from '../js/ue/edge-detector.js';
import { hardScene } from './synth.mjs';

const args = Object.fromEntries(process.argv.slice(2).map(a => a.replace(/^--/, '').split('=')).map(([k, v]) => [k, v ?? true]));
const FS = 48000, N = +(args.n || 20), SECS = 30;
const params = args.p ? JSON.parse(args.p) : {};
if (args.sens) params.sensitivity = +args.sens;
if (args.voice !== undefined) params.voiceFilter = args.voice !== '0';

export function runBench(p = params, n = N, verbose = !!args.v) {
    const byKind = {}, fpKinds = {}, reasons = {};
    let fp = 0;
    for (let s = 0; s < n; s++) {
        const { x, truth, distractors } = hardScene(FS, SECS, 5000 + s);
        const ev = detectInBuffer(x, FS, p);
        const TOL = Math.round(FS * 0.003), used = new Set();
        for (const t of truth) {
            byKind[t.kind] ??= { n: 0, hit: 0 }; byKind[t.kind].n++;
            const i = ev.findIndex((e, j) => !used.has(j) && Math.abs(e.sample - t.sample) <= TOL);
            if (i >= 0) { used.add(i); byKind[t.kind].hit++; }
            else if (verbose) console.log('   missed', t.kind, s, (t.sample / FS).toFixed(3));
        }
        ev.forEach((e, j) => {
            if (used.has(j)) return;
            fp++;
            const d = distractors.find(d => e.sample >= d.sample - TOL && e.sample <= d.sample + (d.len || FS * 0.15));
            const k = d ? d.kind : 'other';
            fpKinds[k] = (fpKinds[k] || 0) + 1;
        });
    }
    const tot = Object.values(byKind).reduce((a, b) => ({ n: a.n + b.n, hit: a.hit + b.hit }), { n: 0, hit: 0 });
    return { recall: tot.hit / tot.n, byKind, fpPerMin: fp / (n * SECS / 60), fpKinds };
}

if (import.meta.url === `file://${process.argv[1]}`) {
    const r = runBench();
    for (const [k, v] of Object.entries(r.byKind)) console.log(`  recall ${k.padEnd(6)} ${(100 * v.hit / v.n).toFixed(1).padStart(5)}%  (${v.hit}/${v.n})`);
    console.log(`  overall recall ${(100 * r.recall).toFixed(1)}%   false alarms ${r.fpPerMin.toFixed(2)}/min  ${JSON.stringify(r.fpKinds)}`);
}
