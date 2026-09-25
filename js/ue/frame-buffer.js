/**
 * FrameBuffer — keeps the last N seconds of video as timestamped JPEG frames.
 *
 * Uses requestVideoFrameCallback so each stored frame carries the exact time it
 * was presented (performance.now() clock, same clock AudioEngine maps to), which
 * makes frame-accurate, audio-synchronised replay possible.
 */
export class FrameBuffer {
    constructor({ seconds = 20, maxWidth = 960, quality = 0.82 } = {}) {
        this.seconds = seconds;
        this.maxWidth = maxWidth;
        this.quality = quality;
        this.frames = [];          // {t, blob, w, h}
        this.video = null;
        this.running = false;
        this.fps = 0;
        this.dropped = 0;
        this._inflight = 0;
        this._fpsWin = [];
    }

    attach(video) {
        this.detach();
        this.video = video;
        this.running = true;
        if (!('requestVideoFrameCallback' in HTMLVideoElement.prototype)) {
            console.warn('requestVideoFrameCallback not supported — falling back to rAF timing');
            this._rafLoop();
        } else {
            this._handle = video.requestVideoFrameCallback((n, m) => this._onFrame(n, m));
        }
    }

    detach() {
        this.running = false;
        if (this.video && this._handle && this.video.cancelVideoFrameCallback) this.video.cancelVideoFrameCallback(this._handle);
        cancelAnimationFrame(this._raf);
        this.video = null;
    }

    clear() { this.frames = []; }

    _rafLoop() {
        let lastTime = -1;
        const loop = (now) => {
            if (!this.running) return;
            const v = this.video;
            if (v && v.readyState >= 2 && v.currentTime !== lastTime) { lastTime = v.currentTime; this._grab(now); }
            this._raf = requestAnimationFrame(loop);
        };
        this._raf = requestAnimationFrame(loop);
    }

    _onFrame(now, meta) {
        if (!this.running) return;
        // expectedDisplayTime = when this frame hits the screen (lip-sync domain)
        const t = meta.expectedDisplayTime || meta.presentationTime || now;
        this._grab(t);
        this._handle = this.video.requestVideoFrameCallback((n, m) => this._onFrame(n, m));
    }

    _grab(t) {
        const v = this.video;
        if (!v || !v.videoWidth) return;
        // fps estimate
        this._fpsWin.push(t);
        while (this._fpsWin.length && t - this._fpsWin[0] > 1000) this._fpsWin.shift();
        this.fps = this._fpsWin.length;

        if (this._inflight > 6) { this.dropped++; return; }  // encoder can't keep up
        const scale = Math.min(1, this.maxWidth / v.videoWidth);
        const w = Math.round(v.videoWidth * scale), h = Math.round(v.videoHeight * scale);
        if (!this._canvas || this._canvas.width !== w || this._canvas.height !== h) {
            this._canvas = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(w, h) : Object.assign(document.createElement('canvas'), { width: w, height: h });
            this._ctx = this._canvas.getContext('2d', { alpha: false });
        }
        this._ctx.drawImage(v, 0, 0, w, h);
        const entry = { t, blob: null, w, h };
        this.frames.push(entry);
        this._inflight++;
        const done = (blob) => { entry.blob = blob; this._inflight--; };
        if (this._canvas.convertToBlob) {
            this._canvas.convertToBlob({ type: 'image/jpeg', quality: this.quality }).then(done, () => { this._inflight--; });
        } else {
            this._canvas.toBlob(done, 'image/jpeg', this.quality);
        }
        const cutoff = t - this.seconds * 1000;
        while (this.frames.length && this.frames[0].t < cutoff) this.frames.shift();
    }

    /** Frames whose time is within [t0, t1] (ms, performance clock). */
    slice(t0, t1) {
        return this.frames.filter(f => f.t >= t0 && f.t <= t1 && f.blob);
    }

    get latestTime() { return this.frames.length ? this.frames[this.frames.length - 1].t : 0; }
    get memoryMB() { let b = 0; for (const f of this.frames) if (f.blob) b += f.blob.size; return b / 1048576; }
}
