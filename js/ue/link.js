/**
 * Studio ⇄ remote link (laptop is the source of truth, phones mirror and control it).
 *
 *   laptop  (ultraedge.html)  ── publishes the "program" (what the laptop shows) as a WebRTC stream
 *                             ◄─ receives control commands over the same peer connection's data channel
 *   phone   (remote.html)     ── views the program, sends commands, receives the studio state
 *
 * Transport is the VDO.ninja SDK (same as the camera phones), so there is no server to run.
 * The studio stream ID is derived from the CrickVision match, so every phone on that match finds it.
 *
 * Messages (plain objects):
 *   remote → studio  { ue: 'cmd',   cmd: 'reviewLast' | 'step' | ..., ...args }
 *   studio → remote  { ue: 'state', s: {...} }   full state, on every change + heartbeat
 *   studio → remote  { ue: 'event', type: 'verdict', ... }
 */

/** Stream ID of the studio for a match (or any other session name). */
export function studioStreamId(key) {
    const k = String(key || '').toLowerCase().replace(/[^a-z0-9]/g, '');
    return k ? 'uestudio' + k.slice(0, 24) : '';
}

/** Pull the message out of whatever wrapper the SDK put around it. */
export function unwrap(payload) {
    let d = payload;
    for (let k = 0; k < 4 && d; k++) {
        if (typeof d === 'string') { try { d = JSON.parse(d); } catch { return null; } continue; }
        if (d.ue) return d;
        d = d.data ?? d.message ?? d.pipe ?? d.msg ?? null;
    }
    return d && d.ue ? d : null;
}

function makeSdk() {
    if (typeof VDONinjaSDK === 'undefined') throw new Error('VDO.ninja SDK failed to load (check the internet connection).');
    return new VDONinjaSDK({ host: 'wss://wss.vdo.ninja', salt: 'vdo.ninja' });
}

function onData(vdo, fn) {
    const h = (e) => { const m = unwrap(e.detail); if (m) fn(m, e.detail?.uuid); };
    // SDK versions differ in the event name
    vdo.addEventListener('dataReceived', h);
    vdo.addEventListener('data', h);
}

/** Laptop side: publish the program stream and talk to every connected phone. */
export class StudioLink extends EventTarget {
    constructor() { super(); this.vdo = null; this.streamId = ''; this.peers = new Set(); this.live = false; }

    async start(stream, streamId, { label = 'UltraEdge Studio' } = {}) {
        await this.stop();
        this.streamId = streamId;
        const vdo = (this.vdo = makeSdk());
        vdo.addEventListener('peerConnected', (e) => { if (e.detail?.uuid) this.peers.add(e.detail.uuid); this._emit('peers'); });
        vdo.addEventListener('dataChannelOpen', (e) => { if (e.detail?.uuid) this.peers.add(e.detail.uuid); this._emit('peers'); this._emit('join', e.detail); });
        const gone = (e) => { if (e.detail?.uuid) this.peers.delete(e.detail.uuid); this._emit('peers'); };
        vdo.addEventListener('peerDisconnected', gone);
        vdo.addEventListener('peerLeft', gone);
        vdo.addEventListener('disconnected', () => { this.live = false; this._emit('status', 'disconnected'); });
        vdo.addEventListener('error', (e) => this._emit('status', 'error: ' + (e.detail?.error?.message || e.detail?.error || 'unknown')));
        onData(vdo, (m, uuid) => {
            if (uuid) this.peers.add(uuid);
            if (m.ue === 'cmd') this.dispatchEvent(new CustomEvent('command', { detail: { ...m, from: uuid } }));
        });
        await vdo.connect();
        await vdo.publish(stream, { streamID: streamId, label });
        this.live = true;
        this._emit('status', 'live');
    }

    send(msg) {
        if (!this.vdo || !this.live) return;
        try { this.vdo.sendData(msg); } catch { /* no peers yet */ }
    }

    async stop() {
        const v = this.vdo; this.vdo = null; this.live = false; this.peers.clear();
        try { v && v.disconnect && v.disconnect(); } catch { }
        try { v && v.close && v.close(); } catch { }
    }

    _emit(type, detail) { this.dispatchEvent(new CustomEvent(type, { detail })); }
}

/** Phone side: view the studio program and control it. */
export class RemoteLink extends EventTarget {
    constructor() { super(); this.vdo = null; this.stream = new MediaStream(); this.connected = false; }

    async connect(streamId, { timeoutMs = 60000 } = {}) {
        this.disconnect();
        this.stream = new MediaStream();
        const vdo = (this.vdo = makeSdk());
        const got = new Promise((resolve) => {
            vdo.addEventListener('track', (e) => {
                const { track } = e.detail;
                if (this.stream.getTracks().some(t => t.id === track.id)) return;
                this.stream.addTrack(track);
                this._emit('track', track);
                if (track.kind === 'video') resolve(this.stream);
            });
        });
        onData(vdo, (m) => {
            if (m.ue === 'state') this._emit('state', m.s);
            else if (m.ue === 'event') this._emit('event', m);
        });
        vdo.addEventListener('dataChannelOpen', () => { this.connected = true; this._emit('open'); });
        vdo.addEventListener('disconnected', () => { this.connected = false; this._emit('status', 'disconnected'); });
        vdo.addEventListener('peerDisconnected', () => { this.connected = false; this._emit('status', 'studio left'); });
        vdo.addEventListener('error', (e) => this._emit('status', 'error: ' + (e.detail?.error?.message || e.detail?.error || 'unknown')));
        await vdo.connect();
        await vdo.view(streamId, { audio: true, video: true });
        const timeout = new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), timeoutMs));
        await Promise.race([got, timeout]);
        this.connected = true;
        return this.stream;
    }

    command(cmd, args = {}) {
        if (!this.vdo) return false;
        try { this.vdo.sendData({ ue: 'cmd', cmd, ...args }); return true; } catch { return false; }
    }

    disconnect() {
        const v = this.vdo; this.vdo = null; this.connected = false;
        try { v && v.disconnect && v.disconnect(); } catch { }
        try { v && v.close && v.close(); } catch { }
    }

    _emit(type, detail) { this.dispatchEvent(new CustomEvent(type, { detail })); }
}
