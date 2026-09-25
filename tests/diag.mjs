import { EdgeDetector } from '../js/ue/edge-detector.js';
import { scene } from './synth.mjs';
import { execFileSync } from 'node:child_process';
function opus(x, kbps) { const buf = Buffer.from(x.buffer, x.byteOffset, x.byteLength); const ogg = execFileSync('ffmpeg', ['-loglevel','error','-f','f32le','-ar','48000','-ac','1','-i','-','-c:a','libopus','-b:a',`${kbps}k`,'-f','ogg','-'], { input: buf, maxBuffer: 1<<28 }); const raw = execFileSync('ffmpeg', ['-loglevel','error','-i','-','-f','f32le','-ar','48000','-ac','1','-'], { input: ogg, maxBuffer: 1<<28 }); return new Float32Array(raw.buffer, raw.byteOffset, raw.byteLength/4).slice(0, x.length); }
const FS = 48000;
const cond = process.argv[2] === 'noisy' ? { crowdDb: -42, windDb: -18 } : {};
const det = new EdgeDetector(FS, {}); det.debug = true;
const out = [];
const miss = [], fps = [];
for (let s = 0; s < (+process.env.NS || 4); s++) {
    const d = new EdgeDetector(FS, { sensitivity: +(process.argv[3] || 60) }); d.debug = true;
    let { x, truth, distractors } = scene(FS, 20, 1000 + s, cond); if (process.argv[4]) x = opus(x, +process.argv[4]);
    const ev = [];
    for (let i = 0; i < x.length; i += 4096) ev.push(...d.process(x.subarray(i, i + 4096)));
    for (const t of truth) {
        const e = ev.find(e => Math.abs(e.sample - t.sample) < 150);
        if (!e) {
            const rj = d.rejected.filter(r => Math.abs(r.tick * 48 - t.sample) < 300);
            miss.push({ kind: t.kind, rej: rj, floor: d.floorDb.toFixed(1) });
        }
    }
    for (const e of ev) if (!truth.some(t => Math.abs(e.sample - t.sample) < 150)) {
        const dd = distractors.find(dd => e.sample >= dd.sample - 150 && e.sample <= dd.sample + (dd.len || 7200));
        { const nt = truth.reduce((b, t) => Math.abs(t.sample - e.sample) < Math.abs(b.sample - e.sample) ? t : b); fps.push({ kind: dd?.kind, ...e, off: dd ? ((e.sample - dd.sample) / 48).toFixed(0) : null, nearestTruthMs: ((e.sample - nt.sample) / 48).toFixed(1), nk: nt.kind }); }
    }
}
console.log('MISSES'); miss.forEach(m => console.log(JSON.stringify(m)));
console.log('FPS'); fps.forEach(m => console.log(JSON.stringify(m)));
