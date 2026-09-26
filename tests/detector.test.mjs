// Offline evaluation of EdgeDetector on synthetic cricket audio.
// Usage: node tests/detector.test.mjs [--quick] [--sens=60]
import { execFileSync } from 'node:child_process';
import { detectInBuffer } from '../js/ue/edge-detector.js';
import { scene } from './synth.mjs';

const args = Object.fromEntries(process.argv.slice(2).map(a => a.replace(/^--/, '').split('=')).map(([k, v]) => [k, v ?? true]));
const FS = 48000;
const N = args.quick ? 8 : 24, SECS = 20;
const params = args.p ? JSON.parse(args.p) : {}; if (args.sens) params.sensitivity = +args.sens; if (args.hpf) params.hpfHz = +args.hpf;

function opus(x, kbps) {
    const buf = Buffer.from(x.buffer, x.byteOffset, x.byteLength);
    const ogg = execFileSync('ffmpeg', ['-loglevel', 'error', '-f', 'f32le', '-ar', '48000', '-ac', '1', '-i', '-', '-c:a', 'libopus', '-b:a', `${kbps}k`, '-f', 'ogg', '-'], { input: buf, maxBuffer: 1 << 28 });
    const raw = execFileSync('ffmpeg', ['-loglevel', 'error', '-i', '-', '-f', 'f32le', '-ar', '48000', '-ac', '1', '-'], { input: ogg, maxBuffer: 1 << 28 });
    const y = new Float32Array(raw.buffer, raw.byteOffset, raw.byteLength / 4);
    return y.slice(0, x.length);
}

const conditions = [
    { name: 'clean mic', opts: {} },
    { name: 'noisy (crowd -42dB, strong wind)', opts: { crowdDb: -42, windDb: -18 } },
    { name: 'phone/WebRTC opus 32 kbps', opts: {}, codec: 32 },
    { name: 'opus 32k + noisy (default WebRTC bitrate)', opts: { crowdDb: -42, windDb: -18 }, codec: 32, minRecall: 0.75 },
    { name: 'opus 128k + noisy (VDO.ninja &proaudio)', opts: { crowdDb: -42, windDb: -18 }, codec: 128, minRecall: 0.88 },
    { name: 'clean @ 44.1 kHz', opts: {}, fs: 44100 },
    { name: 'starts with 2 s digital silence (floor must recover)', opts: { crowdDb: -42, windDb: -18 }, lead: 2 },
];

let allOk = true;
for (const c of conditions) {
    const byKind = {}; let fp = 0; const fpKinds = {}; const errs = [];
    for (let s = 0; s < N; s++) {
        const fs = c.fs || FS;
        let { x, truth, distractors } = scene(fs, SECS, 1000 + s, c.opts);
        if (c.lead) {
            const L = Math.round(fs * c.lead), y = new Float32Array(x.length + L); y.set(x, L); x = y;
            truth = truth.map(t => ({ ...t, sample: t.sample + L })); distractors = distractors.map(d => ({ ...d, sample: d.sample + L }));
        }
        if (c.codec) x = opus(x, c.codec);
        const ev = detectInBuffer(x, fs, params);
        const TOL = Math.round(fs * 0.003);
        const used = new Set();
        for (const t of truth) {
            byKind[t.kind] ??= { n: 0, hit: 0 };
            byKind[t.kind].n++;
            const i = ev.findIndex((e, j) => !used.has(j) && Math.abs(e.sample - t.sample) <= TOL);
            if (i >= 0) { used.add(i); byKind[t.kind].hit++; errs.push((ev[i].sample - t.sample) / fs * 1000); }
        }
        ev.forEach((e, j) => {
            if (used.has(j)) return;
            fp++;
            const d = distractors.find(d => e.sample >= d.sample - TOL && e.sample <= d.sample + (d.len || FS * 0.15));
            const k = d ? d.kind : 'other';
            if (args.v && !d) { const nt = truth.reduce((b, t) => Math.abs(t.sample - e.sample) < Math.abs(b.sample - e.sample) ? t : b); console.log('   other FP', c.name, s, JSON.stringify(e), 'nearest truth ms', ((e.sample - nt.sample) / 48).toFixed(2), nt.kind); }
            fpKinds[k] = (fpKinds[k] || 0) + 1;
        });
    }
    const minutes = N * SECS / 60;
    const tot = Object.values(byKind).reduce((a, b) => ({ n: a.n + b.n, hit: a.hit + b.hit }), { n: 0, hit: 0 });
    errs.sort((a, b) => a - b);
    const med = errs[Math.floor(errs.length / 2)] ?? NaN, p95 = errs.map(Math.abs).sort((a, b) => a - b)[Math.floor(errs.length * 0.95)] ?? NaN;
    console.log(`\n== ${c.name} ==`);
    for (const [k, v] of Object.entries(byKind)) console.log(`  recall ${k.padEnd(9)} ${(100 * v.hit / v.n).toFixed(1).padStart(5)}%  (${v.hit}/${v.n})`);
    console.log(`  overall recall ${(100 * tot.hit / tot.n).toFixed(1)}%   false alarms ${(fp / minutes).toFixed(2)}/min  ${JSON.stringify(fpKinds)}`);
    console.log(`  timing error: median ${med.toFixed(2)} ms, |p95| ${p95.toFixed(2)} ms`);
    const recall = tot.hit / tot.n, fpm = fp / minutes;
    if (recall < (c.minRecall || 0.9) || fpm > 1.0 || Math.abs(med) > 1.0) allOk = false;
}
console.log(allOk ? '\nPASS' : '\nFAIL (targets: recall ≥ 90%, ≤ 1 false alarm/min, |median timing| ≤ 1 ms)');
process.exit(allOk ? 0 : 1);
