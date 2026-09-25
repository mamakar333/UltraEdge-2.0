/**
 * Waveform drawing helpers (broadcast "snicko" look).
 */

export const COLORS = {
    bg: '#05080d',
    grid: 'rgba(120,160,200,0.10)',
    gridStrong: 'rgba(120,160,200,0.22)',
    trace: '#e8f6ff',
    traceGlow: 'rgba(90,200,255,0.55)',
    hit: '#ff2d3d',
    cursor: '#ffd21a',
    frameBand: 'rgba(255,210,26,0.12)',
    text: '#9fb3c8',
};

/**
 * Draw audio samples between times [t0, t1] (ms) into rect.
 * @param samples Float32Array, sample 0 is at time audioT0 (ms), rate fs
 */
export function drawTrace(ctx, rect, samples, fs, audioT0, t0, t1, { gain = 1, color = COLORS.trace, glow = true } = {}) {
    const { x, y, w, h } = rect;
    const mid = y + h / 2, half = h / 2 - 2;
    const s0 = (t0 - audioT0) / 1000 * fs, s1 = (t1 - audioT0) / 1000 * fs;
    const spp = (s1 - s0) / w; // samples per pixel
    ctx.save();
    ctx.beginPath(); ctx.rect(x, y, w, h); ctx.clip();
    ctx.strokeStyle = color; ctx.fillStyle = color;
    if (glow) { ctx.shadowColor = COLORS.traceGlow; ctx.shadowBlur = 6; }
    ctx.lineWidth = 1.25;
    const N = samples.length;
    if (spp > 1.5) {
        // min/max per column
        ctx.beginPath();
        for (let px = 0; px < w; px++) {
            const a = Math.floor(s0 + px * spp), b = Math.floor(s0 + (px + 1) * spp);
            let mn = 0, mx = 0;
            for (let i = Math.max(0, a); i < Math.min(N, b); i++) { const v = samples[i]; if (v < mn) mn = v; if (v > mx) mx = v; }
            const yTop = mid - Math.min(1, mx * gain) * half, yBot = mid - Math.max(-1, mn * gain) * half;
            ctx.moveTo(x + px + 0.5, yTop); ctx.lineTo(x + px + 0.5, Math.max(yBot, yTop + 1));
        }
        ctx.stroke();
    } else {
        ctx.beginPath();
        const first = Math.max(0, Math.floor(s0)), last = Math.min(N - 1, Math.ceil(s1));
        for (let i = first; i <= last; i++) {
            const px = x + (i - s0) / (s1 - s0) * w;
            const py = mid - Math.max(-1, Math.min(1, samples[i] * gain)) * half;
            if (i === first) ctx.moveTo(px, py); else ctx.lineTo(px, py);
        }
        ctx.stroke();
    }
    ctx.restore();
}

export function drawGrid(ctx, rect, t0, t1, { stepMs = null, labels = true } = {}) {
    const { x, y, w, h } = rect;
    ctx.save();
    ctx.fillStyle = COLORS.bg; ctx.fillRect(x, y, w, h);
    const span = t1 - t0;
    const step = stepMs || niceStep(span / 8);
    ctx.strokeStyle = COLORS.grid; ctx.lineWidth = 1;
    ctx.font = '11px ui-monospace, Menlo, monospace'; ctx.fillStyle = COLORS.text;
    for (let t = Math.ceil(t0 / step) * step; t <= t1; t += step) {
        const px = Math.round(x + (t - t0) / span * w) + 0.5;
        ctx.beginPath(); ctx.moveTo(px, y); ctx.lineTo(px, y + h); ctx.stroke();
    }
    ctx.strokeStyle = COLORS.gridStrong;
    ctx.beginPath(); ctx.moveTo(x, y + h / 2 + 0.5); ctx.lineTo(x + w, y + h / 2 + 0.5); ctx.stroke();
    ctx.restore();
    return step;
}

export function niceStep(raw) {
    const p = Math.pow(10, Math.floor(Math.log10(raw)));
    for (const m of [1, 2, 5, 10]) if (m * p >= raw) return m * p;
    return 10 * p;
}

export function peakAbs(samples, a = 0, b = samples.length) {
    let m = 0;
    for (let i = Math.max(0, a); i < Math.min(samples.length, b); i++) { const v = Math.abs(samples[i]); if (v > m) m = v; }
    return m;
}
