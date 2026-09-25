import { writeFileSync, mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
mkdirSync('tests/media', { recursive: true });
import { scene } from './synth.mjs';
const FS = 48000, SECS = 30;
const { x, truth } = scene(FS, SECS, 4242, { crowdDb: -50, windDb: -30 });
// 16-bit PCM WAV
const n = x.length, buf = Buffer.alloc(44 + n * 2);
buf.write('RIFF', 0); buf.writeUInt32LE(36 + n * 2, 4); buf.write('WAVE', 8); buf.write('fmt ', 12);
buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(1, 22); buf.writeUInt32LE(FS, 24);
buf.writeUInt32LE(FS * 2, 28); buf.writeUInt16LE(2, 32); buf.writeUInt16LE(16, 34); buf.write('data', 36); buf.writeUInt32LE(n * 2, 40);
for (let i = 0; i < n; i++) buf.writeInt16LE(Math.max(-32767, Math.min(32767, Math.round(x[i] * 32767))), 44 + i * 2);
writeFileSync('tests/media/scene.wav', buf);
writeFileSync('tests/media/truth.json', JSON.stringify(truth.map(t => ({ t: t.sample / FS, kind: t.kind }))));
console.log(truth.length, 'truth hits', truth.map(t => (t.sample / FS).toFixed(3)).join(' '));

// test camera: colour bars + clock, with a full-white frame exactly at every contact (for sync checks)
const en = truth.map(t => `between(t,${(t.sample / FS).toFixed(3)},${(t.sample / FS + 0.033).toFixed(3)})`).join('+');
try {
    execFileSync('ffmpeg', ['-loglevel', 'error', '-y', '-f', 'lavfi', '-i', `testsrc2=size=480x270:rate=30:duration=${SECS}`,
        '-vf', `drawbox=x=0:y=0:w=iw:h=ih:color=white@1:t=fill:enable='${en}'`, '-pix_fmt', 'yuv420p', 'tests/media/cam.y4m']);
    console.log('wrote tests/media/cam.y4m');
} catch { console.log('(ffmpeg not found — skipped cam.y4m; only needed for the browser e2e test)'); }
