/**
 * Studio broadcast: the laptop is the source of truth; umpire phones see exactly what it shows.
 *
 * A "program" canvas is composed ~30 times a second from what the laptop is showing:
 *   - live:   the camera(s) with the scrolling UltraEdge trace underneath
 *   - review: the frame-by-frame replay canvas (frame + synced trace + verdict graphic)
 * It is published as a WebRTC stream (with the replay's slow-motion sound) through StudioLink.
 * Commands from phones are handed to the app; the app's state is sent back on every change.
 */
import { StudioLink } from './link.js';

/** A timer that keeps ticking when the tab is in the background (worker timers are not throttled as hard). */
function workerTicker(ms, fn) {
    try {
        const code = `let h=null;onmessage=(e)=>{clearInterval(h);if(e.data>0)h=setInterval(()=>postMessage(0),e.data)}`;
        const url = URL.createObjectURL(new Blob([code], { type: 'text/javascript' }));
        const w = new Worker(url);
        w.onmessage = fn; w.postMessage(ms);
        return () => { w.postMessage(0); w.terminate(); URL.revokeObjectURL(url); };
    } catch {
        const h = setInterval(fn, ms);
        return () => clearInterval(h);
    }
}

export class StudioBroadcast extends EventTarget {
    /**
     * @param {object} o
     * @param {ReviewPlayer} o.review
     * @param {(ctx, rect) => void} o.drawLive     paints the live view into rect
     * @param {() => object} o.getState            plain state for the phones
     * @param {(cmd) => any} o.onCommand           runs a phone command
     */
    constructor({ review, drawLive, getState, onCommand, width = 1280, height = 1000, fps = 30 }) {
        super();
        this.review = review; this.drawLive = drawLive; this.getState = getState; this.onCommand = onCommand;
        this.fps = fps;
        this.canvas = document.createElement('canvas');
        this.canvas.width = width; this.canvas.height = height;
        this.ctx = this.canvas.getContext('2d');
        this.link = new StudioLink();
        this.streamId = '';
        this.status = 'off';
        this._stopTick = null;
        this._stateTimer = null;
        this._lastState = '';
        this.link.addEventListener('command', (e) => this._command(e.detail));
        this.link.addEventListener('peers', () => { this.compose(); this._emit(); this.pushState(true); });
        this.link.addEventListener('join', () => this.pushState(true));
        this.link.addEventListener('status', (e) => { this.status = e.detail; this._emit(); });
    }

    get live() { return this.link.live; }
    get viewers() { return this.link.peers.size; }

    async start(streamId, label) {
        this.stop();
        this.streamId = streamId;
        this.status = 'starting';
        this._emit();
        this.compose();
        // full frame rate only while an umpire phone watches; otherwise 1 frame/s keeps the stream alive
        // without costing the laptop the video capture it needs for replays
        let idle = 0;
        this._stopTick = workerTicker(Math.round(1000 / this.fps), () => {
            if (this.viewers === 0 && (idle++ % this.fps) !== 0) return;
            this.compose();
        });
        const stream = this.canvas.captureStream(this.fps);
        // an umpire needs sharp frames more than a smooth frame rate when the network is tight
        stream.getVideoTracks().forEach(t => { try { t.contentHint = 'detail'; } catch { } });
        // replay sound goes to the phones too (tape-style slow motion, same as on the laptop)
        try {
            const ac = this.review.ensureAudio();
            const dest = ac.createMediaStreamDestination();
            const g = ac.createGain(); g.gain.value = 1; g.connect(dest);
            this.review.extraOut = g;
            dest.stream.getAudioTracks().forEach(t => stream.addTrack(t));
        } catch (err) { console.warn('program audio unavailable', err); }
        this.stream = stream;
        try {
            await this.link.start(stream, streamId, { label });
        } catch (err) {
            this.status = 'error: ' + err.message;
            this._emit();
            throw err;
        }
        this._stateTimer = setInterval(() => this.pushState(true), 2000);   // heartbeat for late joiners
        this.pushState(true);
    }

    stop() {
        if (this._stopTick) this._stopTick();
        this._stopTick = null;
        clearInterval(this._stateTimer);
        this.link.stop();
        if (this.stream) this.stream.getVideoTracks().forEach(t => t.stop());
        this.stream = null;
        this.review.extraOut = null;
        this.status = 'off';
        this._emit();
    }

    /** Paint the program frame. */
    compose() {
        const c = this.ctx, W = this.canvas.width, H = this.canvas.height;
        c.fillStyle = '#05080d'; c.fillRect(0, 0, W, H);
        if (this.review.isOpen) {
            const src = this.review.canvas;
            const sc = Math.min(W / src.width, H / src.height);
            const dw = src.width * sc, dh = src.height * sc;
            c.drawImage(src, (W - dw) / 2, (H - dh) / 2, dw, dh);
        } else {
            try { this.drawLive(c, { x: 0, y: 0, w: W, h: H }); } catch (err) { console.warn(err); }
        }
    }

    /** Send the state to the phones (only when it changed, unless forced). */
    pushState(force = false) {
        if (!this.link.live) return;
        let s;
        try { s = this.getState(); } catch (err) { console.warn(err); return; }
        const json = JSON.stringify(s);
        if (!force && json === this._lastState) return;
        this._lastState = json;
        this.link.send({ ue: 'state', s });
    }

    /** Tell the phones about something that happened (a saved verdict …). */
    event(type, detail) { this.link.send({ ...detail, ue: 'event', type }); }

    async _command(m) {
        try { await this.onCommand(m); } catch (err) { console.warn('remote command failed', m, err); }
        this.pushState(true);
    }

    _emit() { this.dispatchEvent(new CustomEvent('change')); }
}
