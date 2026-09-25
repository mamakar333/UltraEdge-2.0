/**
 * ReviewPlayer — the "third umpire" UltraEdge replay screen.
 *
 * Shows one video frame at a time with the synchronised audio trace underneath,
 * centred on that frame (like the broadcast graphic). Step frame-by-frame, play
 * in slow motion, zoom the audio window, calibrate A/V offset and export the
 * replay (video + waveform) as a WebM.
 */
import { COLORS, drawTrace, drawGrid, peakAbs } from './waveform.js';

// ---------------------------------------------------------------------------
// Frame sources
// ---------------------------------------------------------------------------
export class BlobFrameSource {
    constructor(frames) {
        this.frames = frames;             // [{t, blob, w, h}]
        this.cache = new Map();
        const d = [];
        for (let i = 1; i < frames.length; i++) d.push(frames[i].t - frames[i - 1].t);
        d.sort((a, b) => a - b);
        this.frameDur = d.length ? d[d.length >> 1] : 33.3;
    }
    get count() { return this.frames.length; }
    timeOf(i) { return this.frames[i].t; }
    indexAt(t) {
        let lo = 0, hi = this.frames.length - 1;
        while (lo < hi) { const m = (lo + hi + 1) >> 1; if (this.frames[m].t <= t) lo = m; else hi = m - 1; }
        return lo;
    }
    async get(i) {
        if (this.cache.has(i)) return this.cache.get(i);
        const bmp = await createImageBitmap(this.frames[i].blob);
        this.cache.set(i, bmp);
        if (this.cache.size > 120) { const k = this.cache.keys().next().value; this.cache.get(k).close?.(); this.cache.delete(k); }
        return bmp;
    }
    dispose() { for (const b of this.cache.values()) b.close?.(); this.cache.clear(); }
}

export class VideoFrameSource {
    constructor(video, fps) {
        this.video = video; this.fps = fps || 30;
        this.frameDur = 1000 / this.fps;
        this.n = Math.max(1, Math.floor(video.duration * this.fps));
    }
    get count() { return this.n; }
    timeOf(i) { return i * this.frameDur; }
    indexAt(t) { return Math.max(0, Math.min(this.n - 1, Math.round(t / this.frameDur))); }
    async get(i) {
        const v = this.video;
        const target = (i + 0.5) / this.fps; // middle of the frame avoids boundary rounding
        if (Math.abs(v.currentTime - target) > 1e-4) {
            await new Promise((res) => {
                const done = () => { v.removeEventListener('seeked', done); res(); };
                v.addEventListener('seeked', done);
                v.currentTime = target;
            });
        }
        return v;
    }
    dispose() { }
}

// ---------------------------------------------------------------------------
export class ReviewPlayer {
    constructor(root, { onOffsetChange, onVerdict } = {}) {
        this.root = root;
        this.$ = (id) => root.querySelector('#' + id);
        this.canvas = this.$('rvCanvas');
        this.ctx = this.canvas.getContext('2d');
        this.ov = this.$('rvOverview');
        this.ovCtx = this.ov.getContext('2d');
        this.onOffsetChange = onOffsetChange;
        this.onVerdict = onVerdict;
        this.session = null;
        this.i = 0;
        this.windowMs = 300;
        this.gainUser = 1;
        this.useHp = true;
        this.offsetMs = 0;
        this.speed = 0.25;
        this.playing = false;
        this.sound = true;
        this.audioCtx = null;
        this._src = null;
        this.onClose = null;
        this._bind();
    }

    _bind() {
        const $ = this.$;
        $('rvPrev').onclick = () => this.step(-1);
        $('rvNext').onclick = () => this.step(1);
        $('rvPlay').onclick = () => this.togglePlay();
        $('rvHit').onclick = () => this.jumpToHit(1);
        $('rvClose').onclick = () => this.close();
        $('rvSpeed').onchange = (e) => { this.speed = +e.target.value; if (this.playing) this._restartPlayback(); };
        $('rvSound').onchange = (e) => { this.sound = e.target.checked; if (this.playing) this._restartPlayback(); };
        $('rvZoom').oninput = (e) => { this.windowMs = +e.target.value; $('rvZoomVal').textContent = `${this.windowMs} ms`; this.render(); };
        $('rvGain').oninput = (e) => { this.gainUser = Math.pow(2, +e.target.value); this.render(); };
        $('rvFilter').onchange = (e) => { this.useHp = e.target.checked; this._autoGain(); this.render(); this.renderOverview(); };
        $('rvOffset').oninput = (e) => this.setOffset(+e.target.value, true);
        $('rvSyncHere').onclick = () => this.syncHere();
        $('rvExport').onclick = () => this.exportVideo();
        $('rvSnapshot').onclick = () => this.snapshot();
        $('rvEdge').onclick = () => this.setVerdict('EDGE');
        $('rvNoEdge').onclick = () => this.setVerdict('NO EDGE');
        this.ov.addEventListener('pointerdown', (e) => this._ovSeek(e));
        this.ov.addEventListener('pointermove', (e) => { if (e.buttons) this._ovSeek(e); });
        this._key = (e) => {
            if (!this.isOpen || e.target.tagName === 'INPUT' && e.target.type !== 'range') return;
            const k = e.key;
            if (k === 'ArrowRight' || k === '.') { this.step(e.shiftKey ? 5 : 1); e.preventDefault(); }
            else if (k === 'ArrowLeft' || k === ',') { this.step(e.shiftKey ? -5 : -1); e.preventDefault(); }
            else if (k === ' ') { this.togglePlay(); e.preventDefault(); }
            else if (k === 'h' || k === 'H') this.jumpToHit(e.shiftKey ? -1 : 1);
            else if (k === 'Escape') this.close();
            else if (k === 'e' || k === 'E') this.setVerdict('EDGE');
            else if (k === 'n' || k === 'N') this.setVerdict('NO EDGE');
            else if (k === '+' || k === '=') { this.windowMs = Math.max(40, this.windowMs / 1.5 | 0); this._syncZoom(); }
            else if (k === '-') { this.windowMs = Math.min(3000, this.windowMs * 1.5 | 0); this._syncZoom(); }
        };
        window.addEventListener('keydown', this._key);
    }

    _syncZoom() { this.$('rvZoom').value = this.windowMs; this.$('rvZoomVal').textContent = `${this.windowMs} ms`; this.render(); }

    get isOpen() { return this.root.classList.contains('open'); }

    /**
     * session: { title, fs, raw, hp, audioT0, frames (FrameSource), hits:[{t,...}], focusT, verdict }
     */
    async open(session, offsetMs = 0) {
        this._pause();
        if (this.session && this.session !== session) this.session.frames.dispose?.();
        this.session = session;
        this.offsetMs = offsetMs;
        this.$('rvOffset').value = offsetMs;
        this.$('rvOffsetVal').textContent = `${offsetMs >= 0 ? '+' : ''}${offsetMs} ms`;
        this.$('rvTitle').textContent = session.title || 'ULTRAEDGE REVIEW';
        this.root.classList.add('open');
        this._autoGain();
        const focus = session.focusT ?? (session.hits[0] ? session.hits[0].t + offsetMs : session.frames.timeOf(0));
        this.i = session.frames.indexAt(focus);
        this.renderOverview();
        await this.render();
    }

    close() {
        this._pause();
        this.root.classList.remove('open');
        if (this.onClose) this.onClose();
    }

    _autoGain() {
        const s = this.session; if (!s) return;
        // scale to the spikes themselves (not to a loud shout elsewhere in the clip)
        const data = this.useHp ? s.hp : s.raw;
        let pk = 0;
        for (const h of s.hits) {
            const c = Math.round((h.t - s.audioT0) / 1000 * s.fs), w = Math.round(s.fs * 0.05);
            pk = Math.max(pk, peakAbs(data, c - w, c + w));
        }
        if (!pk) pk = peakAbs(data);
        this.autoGain = pk > 0 ? 0.9 / pk : 1;
    }

    setOffset(ms, fromUser) {
        this.offsetMs = Math.round(ms);
        this.$('rvOffset').value = this.offsetMs;
        this.$('rvOffsetVal').textContent = `${this.offsetMs >= 0 ? '+' : ''}${this.offsetMs} ms`;
        if (fromUser && this.onOffsetChange) this.onOffsetChange(this.offsetMs);
        this.render(); this.renderOverview();
    }

    /** Clap/bat-tap calibration: the current frame shows the contact → align nearest hit to it. */
    syncHere() {
        const s = this.session; if (!s || !s.hits.length) return;
        const ft = s.frames.timeOf(this.i) + s.frames.frameDur / 2;
        let best = s.hits[0];
        for (const h of s.hits) if (Math.abs(h.t + this.offsetMs - ft) < Math.abs(best.t + this.offsetMs - ft)) best = h;
        this.setOffset(ft - best.t, true);
    }

    setVerdict(v) {
        if (!this.session) return;
        this.session.verdict = v;
        if (this.onVerdict) this.onVerdict(this.session, v);
        this.render();
    }

    step(d) {
        const s = this.session; if (!s) return;
        this._pause();
        this.i = Math.max(0, Math.min(s.frames.count - 1, this.i + d));
        this.render(); this.renderOverview();
    }

    jumpToHit(dir) {
        const s = this.session; if (!s || !s.hits.length) return;
        this._pause();
        const cur = s.frames.timeOf(this.i);
        const ts = s.hits.map(h => h.t + this.offsetMs).sort((a, b) => a - b);
        let t = dir > 0 ? ts.find(x => x > cur + s.frames.frameDur) : [...ts].reverse().find(x => x < cur - 1);
        if (t === undefined) t = dir > 0 ? ts[0] : ts[ts.length - 1];
        this.i = s.frames.indexAt(t);
        this.render(); this.renderOverview();
    }

    togglePlay() {
        if (this.playing) this._pause(); else this._play();
    }

    _pause() {
        this.playing = false;
        this._stopAudio();
        const b = this.$('rvPlay'); if (b) b.textContent = '▶ PLAY';
    }

    _play() {
        const s = this.session; if (!s) return;
        this.playing = true;
        this.$('rvPlay').textContent = '❚❚ PAUSE';
        // restart from the beginning if we're parked on the last frame
        if (this.i >= s.frames.count - 1) this.i = 0;
        this._restartPlayback();
        const run = (this._run = (this._run || 0) + 1);
        const tick = async () => {
            if (!this.playing || !this.isOpen || run !== this._run) return;
            const clipT = this._clipTimeNow();
            const endT = s.frames.timeOf(s.frames.count - 1) + s.frames.frameDur;
            if (clipT >= endT) {            // loop the replay
                this.i = 0; this._restartPlayback();
            } else {
                const ni = s.frames.indexAt(clipT);
                if (ni !== this.i) { this.i = ni; await this.render(); this.renderOverview(); }
            }
            requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
    }

    /** (Re)start the clock — and the sound — from the current frame at the current speed. */
    _restartPlayback() {
        const s = this.session;
        this._stopAudio();
        this._clipT0 = s.frames.timeOf(this.i);
        this._wall0 = performance.now();
        this._audioClock = false;
        if (!this.sound) return;
        try {
            if (!this.audioCtx) this.audioCtx = new (window.AudioContext || window.webkitAudioContext)();
            const ctx = this.audioCtx;
            if (ctx.state === 'suspended') ctx.resume();
            if (!s._abuf) {
                s._abuf = ctx.createBuffer(1, s.raw.length, s.fs);
                s._abuf.copyToChannel(s.raw, 0);
            }
            const src = ctx.createBufferSource();
            src.buffer = s._abuf;
            src.playbackRate.value = this.speed;   // tape-style slow motion (pitch drops like a broadcast slo-mo)
            const g = ctx.createGain(); g.gain.value = 1;
            src.connect(g).connect(ctx.destination);
            // audio sample that belongs with this frame: video time − A/V offset
            const posSec = (this._clipT0 - this.offsetMs - s.audioT0) / 1000;
            const when = ctx.currentTime + 0.03;
            if (posSec >= 0) src.start(when, posSec);
            else src.start(when - posSec / this.speed, 0);
            this._src = src;
            this._ctx0 = when;
            this._latency = (ctx.outputLatency || 0) + (ctx.baseLatency || 0);
            this._audioClock = true;
        } catch (err) {
            console.warn('Replay audio unavailable:', err);
        }
    }

    _stopAudio() {
        if (this._src) { try { this._src.stop(); } catch { } this._src.disconnect(); this._src = null; }
    }

    /** Current clip time (ms). Driven by the audio clock when sound is on, so picture and sound stay locked. */
    _clipTimeNow() {
        if (this._audioClock && this.audioCtx) {
            const el = Math.max(0, this.audioCtx.currentTime - this._ctx0 - this._latency);
            return this._clipT0 + el * 1000 * this.speed;
        }
        return this._clipT0 + (performance.now() - this._wall0) * this.speed;
    }

    _ovSeek(e) {
        const s = this.session; if (!s) return;
        this._pause();
        const r = this.ov.getBoundingClientRect();
        const f = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width));
        const t0 = s.frames.timeOf(0), t1 = s.frames.timeOf(s.frames.count - 1);
        this.i = s.frames.indexAt(t0 + f * (t1 - t0));
        this.render(); this.renderOverview();
    }

    // -----------------------------------------------------------------------
    async render() {
        const s = this.session; if (!s) return;
        const token = (this._tok = (this._tok || 0) + 1);
        const img = await s.frames.get(this.i);
        if (token !== this._tok) return; // a newer render started
        this.drawComposite(img);
    }

    drawComposite(img) {
        const s = this.session, ctx = this.ctx;
        const W = this.canvas.width, H = this.canvas.height;
        const VH = Math.round(H * 0.72), SH = H - VH;
        ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, H);
        // --- video frame (letterboxed) ---
        const iw = img.videoWidth || img.width, ih = img.videoHeight || img.height;
        const sc = Math.min(W / iw, VH / ih);
        const dw = iw * sc, dh = ih * sc;
        ctx.drawImage(img, (W - dw) / 2, (VH - dh) / 2, dw, dh);

        const ft = s.frames.timeOf(this.i), fd = s.frames.frameDur;
        const center = ft + fd / 2;
        const t0 = center - this.windowMs / 2, t1 = center + this.windowMs / 2;
        const rect = { x: 0, y: VH, w: W, h: SH };
        drawGrid(ctx, rect, t0, t1);
        // frame exposure band + cursor
        const xOf = (t) => (t - t0) / (t1 - t0) * W;
        ctx.fillStyle = COLORS.frameBand;
        ctx.fillRect(xOf(ft), VH, Math.max(2, xOf(ft + fd) - xOf(ft)), SH);
        // trace
        drawTrace(ctx, rect, this.useHp ? s.hp : s.raw, s.fs, s.audioT0 + this.offsetMs, t0, t1, { gain: this.autoGain * this.gainUser });
        // hits
        let spikeNow = null;
        for (const h of s.hits) {
            const ht = h.t + this.offsetMs;
            if (ht >= ft - 0.5 && ht < ft + fd + 0.5) spikeNow = h;
            if (ht < t0 || ht > t1) continue;
            const x = xOf(ht);
            ctx.fillStyle = COLORS.hit;
            ctx.beginPath(); ctx.moveTo(x - 7, VH + 2); ctx.lineTo(x + 7, VH + 2); ctx.lineTo(x, VH + 14); ctx.fill();
        }
        ctx.strokeStyle = COLORS.cursor; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(xOf(center), VH); ctx.lineTo(xOf(center), H); ctx.stroke();

        // --- graphics ---
        ctx.font = 'bold 22px "Barlow Condensed", "Arial Narrow", sans-serif';
        const label = 'ULTRAEDGE';
        ctx.fillStyle = spikeNow ? COLORS.hit : 'rgba(0,0,0,0.65)';
        ctx.fillRect(16, VH - 44, ctx.measureText(label).width + 28, 34);
        ctx.fillStyle = '#fff'; ctx.fillText(label, 30, VH - 20);
        if (s.verdict) {
            const txt = s.verdict === 'EDGE' ? 'SPIKE — EDGE' : 'NO SPIKE';
            ctx.font = 'bold 30px "Barlow Condensed", "Arial Narrow", sans-serif';
            const tw = ctx.measureText(txt).width + 40;
            ctx.fillStyle = s.verdict === 'EDGE' ? COLORS.hit : '#1f9d55';
            ctx.fillRect(W - tw - 16, VH - 52, tw, 42);
            ctx.fillStyle = '#fff'; ctx.fillText(txt, W - tw + 4, VH - 21);
        }
        ctx.font = '13px ui-monospace, Menlo, monospace';
        ctx.fillStyle = 'rgba(200,220,240,0.8)';
        const ref = s.hits.length ? s.hits.reduce((b, h) => Math.abs(h.t + this.offsetMs - center) < Math.abs(b.t + this.offsetMs - center) ? h : b) : null;
        const rel = ref ? center - (ref.t + this.offsetMs) : null;
        ctx.fillText(`FRAME ${this.i + 1}/${s.frames.count}   ${(1000 / fd).toFixed(0)} fps   window ${this.windowMs} ms` +
            (rel !== null ? `   Δ to spike ${rel >= 0 ? '+' : ''}${rel.toFixed(1)} ms` : ''), 12, H - 10);
        this.$('rvInfo').textContent = spikeNow
            ? `Spike in this frame — ${spikeNow.snrDb ?? '?'} dB above noise, rise ${spikeNow.riseDb ?? '?'} dB, ~${spikeNow.freqHz ?? '?'} Hz`
            : (rel !== null ? `Nearest spike ${Math.abs(rel).toFixed(1)} ms ${rel > 0 ? 'before' : 'after'} this frame` : 'No spike detected in this clip — judge by the trace');
    }

    renderOverview() {
        const s = this.session; if (!s) return;
        const c = this.ovCtx, W = this.ov.width, H = this.ov.height;
        const t0 = s.frames.timeOf(0), t1 = s.frames.timeOf(s.frames.count - 1) + s.frames.frameDur;
        drawGrid(c, { x: 0, y: 0, w: W, h: H }, t0, t1, { stepMs: 100 });
        drawTrace(c, { x: 0, y: 0, w: W, h: H }, this.useHp ? s.hp : s.raw, s.fs, s.audioT0 + this.offsetMs, t0, t1, { gain: this.autoGain, glow: false, color: '#8fd3ff' });
        c.fillStyle = COLORS.hit;
        for (const h of s.hits) { const x = (h.t + this.offsetMs - t0) / (t1 - t0) * W; c.fillRect(x - 1, 0, 3, H); }
        const ft = s.frames.timeOf(this.i);
        const x0 = (ft + s.frames.frameDur / 2 - this.windowMs / 2 - t0) / (t1 - t0) * W;
        c.strokeStyle = COLORS.cursor; c.lineWidth = 1.5;
        c.strokeRect(x0, 1, this.windowMs / (t1 - t0) * W, H - 2);
    }

    snapshot() {
        this.canvas.toBlob((b) => download(b, `ultraedge-frame-${Date.now()}.png`), 'image/png');
    }

    async exportVideo() {
        const s = this.session; if (!s || this._exporting) return;
        if (typeof MediaRecorder === 'undefined' || !this.canvas.captureStream) { alert('Video export is not supported in this browser.'); return; }
        this._exporting = true;
        const btn = this.$('rvExport'); const label = btn.textContent;
        const wasPlaying = this.playing; this._pause();
        const stream = this.canvas.captureStream(30);
        const outFps = 30, startI = this.i;
        const tStart = s.frames.timeOf(0), tEnd = s.frames.timeOf(s.frames.count - 1) + s.frames.frameDur;
        const total = (tEnd - tStart) / this.speed;               // wall-clock ms of the export
        // soundtrack: the same tape-style slowed audio you hear in the player
        let src = null;
        if (this.sound) {
            try {
                if (!this.audioCtx) this.audioCtx = new (window.AudioContext || window.webkitAudioContext)();
                const ctx = this.audioCtx; if (ctx.state === 'suspended') await ctx.resume();
                if (!s._abuf) { s._abuf = ctx.createBuffer(1, s.raw.length, s.fs); s._abuf.copyToChannel(s.raw, 0); }
                const dest = ctx.createMediaStreamDestination();
                src = ctx.createBufferSource(); src.buffer = s._abuf; src.playbackRate.value = this.speed;
                src.connect(dest);
                dest.stream.getAudioTracks().forEach(t => stream.addTrack(t));
                src._pos = (tStart - this.offsetMs - s.audioT0) / 1000;
            } catch (err) { console.warn('export audio unavailable', err); src = null; }
        }
        const mime = (src ? ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm', 'video/mp4']
                          : ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm', 'video/mp4']).find(m => MediaRecorder.isTypeSupported(m));
        const rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 6e6 });
        const chunks = [];
        rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
        const stopped = new Promise(r => rec.onstop = r);
        this.i = s.frames.indexAt(tStart); await this.render();
        rec.start(250);
        // hold on the first frame while the encoders spin up, repainting so the canvas track keeps producing frames
        for (let k = 0; k < 6; k++) { await new Promise(r => setTimeout(r, 100)); await this.render(); }
        const t0 = performance.now();
        if (src) {
            const ctx = this.audioCtx;
            if (src._pos >= 0) src.start(ctx.currentTime, src._pos); else src.start(ctx.currentTime - src._pos / this.speed, 0);
        }
        // pictures follow the wall clock, so they stay in step with the recorded sound
        for (let el = 0; el <= total; el = performance.now() - t0) {
            const ni = s.frames.indexAt(tStart + el * this.speed);
            this.i = ni; await this.render();   // repaint every tick: constant frame rate in the file
            btn.textContent = `EXPORTING ${Math.round(100 * el / total)}%`;
            await new Promise(r => setTimeout(r, 1000 / outFps / 2));
        }
        for (let k = 0; k < 3; k++) { await new Promise(r => setTimeout(r, 100)); await this.render(); } // short hold on the last frame
        if (src) { try { src.stop(); } catch { } src.disconnect(); }
        rec.stop(); await stopped;
        stream.getTracks().forEach(t => t.stop());
        download(new Blob(chunks, { type: mime }), `ultraedge-replay-${Date.now()}.${mime.includes('mp4') ? 'mp4' : 'webm'}`);
        btn.textContent = label; this.i = startI; this.render(); this._exporting = false;
        if (wasPlaying) this.togglePlay();
    }
}

export function download(blob, name) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 10000);
}
