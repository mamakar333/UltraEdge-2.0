// Test double for the VDO.ninja SDK.
//  - Camera / mic "phones": Chromium's fake camera + microphone (view() of any other stream ID).
//  - UltraEdge studio ⇄ umpire remote (stream IDs starting "uestudio"): a real WebRTC peer connection
//    between the two pages, signalled over a BroadcastChannel, with a data channel for commands/state.
(() => {
const bc = new BroadcastChannel('ninja-mock-signal');
const rid = () => Math.random().toString(36).slice(2, 10);
const instances = new Set();
bc.onmessage = (e) => instances.forEach(i => i._signal(e.data));

window.VDONinjaSDK = class extends EventTarget {
    constructor(opts) {
        super(); this.opts = opts; this.uuid = rid(); this.pcs = new Map(); this.dcs = new Map(); this.published = null;
        window.__ninjaMock = (window.__ninjaMock || 0) + 1;
        instances.add(this);
    }
    async connect() { this.dispatchEvent(new CustomEvent('connected')); }

    // ---------------- publisher (studio) ----------------
    async publish(stream, { streamID } = {}) {
        this.published = { stream, streamID };
        bc.postMessage({ t: 'published', streamID, from: this.uuid });
    }

    async _offerTo(peer) {
        if (this.pcs.has(peer)) return;
        const pc = new RTCPeerConnection();
        this.pcs.set(peer, pc);
        this.published.stream.getTracks().forEach(t => pc.addTrack(t, this.published.stream));
        const dc = pc.createDataChannel('ninja');
        this._wireDc(dc, peer);
        pc.onicecandidate = (e) => e.candidate && bc.postMessage({ t: 'ice', to: peer, from: this.uuid, c: e.candidate.toJSON() });
        pc.onconnectionstatechange = () => { if (['failed', 'closed', 'disconnected'].includes(pc.connectionState)) this._drop(peer); };
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        bc.postMessage({ t: 'offer', to: peer, from: this.uuid, sdp: pc.localDescription.toJSON() });
        this.dispatchEvent(new CustomEvent('peerConnected', { detail: { uuid: peer, streamID: this.published.streamID } }));
    }

    // ---------------- viewer ----------------
    async view(streamID, { audio = true, video = true } = {}) {
        if (!String(streamID).startsWith('uestudio')) {
            const s = await navigator.mediaDevices.getUserMedia({
                audio: audio ? { echoCancellation: false, noiseSuppression: false, autoGainControl: false } : false, video: !!video });
            setTimeout(() => s.getTracks().forEach(track => this.dispatchEvent(new CustomEvent('track', { detail: { track, streamID } }))), 300);
            return;
        }
        this.viewing = streamID;
        const ask = () => { if (this.viewing && !this.pcs.size) bc.postMessage({ t: 'want', streamID, from: this.uuid }); };
        ask();
        this._askTimer = setInterval(ask, 1000);
    }

    async _answer(m) {
        clearInterval(this._askTimer);
        const pc = new RTCPeerConnection();
        this.pcs.set(m.from, pc);
        pc.ontrack = (e) => this.dispatchEvent(new CustomEvent('track', { detail: { track: e.track, streamID: this.viewing, uuid: m.from } }));
        pc.ondatachannel = (e) => this._wireDc(e.channel, m.from);
        pc.onicecandidate = (e) => e.candidate && bc.postMessage({ t: 'ice', to: m.from, from: this.uuid, c: e.candidate.toJSON() });
        pc.onconnectionstatechange = () => { if (['failed', 'closed', 'disconnected'].includes(pc.connectionState)) { this._drop(m.from); this.dispatchEvent(new CustomEvent('peerDisconnected', { detail: { uuid: m.from } })); } };
        await pc.setRemoteDescription(m.sdp);
        const ans = await pc.createAnswer();
        await pc.setLocalDescription(ans);
        bc.postMessage({ t: 'answer', to: m.from, from: this.uuid, sdp: pc.localDescription.toJSON() });
    }

    _wireDc(dc, peer) {
        this.dcs.set(peer, dc);
        dc.onopen = () => this.dispatchEvent(new CustomEvent('dataChannelOpen', { detail: { uuid: peer } }));
        dc.onmessage = (e) => { let d; try { d = JSON.parse(e.data); } catch { d = e.data; } this.dispatchEvent(new CustomEvent('dataReceived', { detail: { data: d, uuid: peer } })); };
        dc.onclose = () => this.dcs.delete(peer);
    }

    _drop(peer) { const pc = this.pcs.get(peer); this.pcs.delete(peer); this.dcs.delete(peer); try { pc && pc.close(); } catch { } }

    async _signal(m) {
        if (m.to && m.to !== this.uuid) return;
        if (m.t === 'want' && this.published && this.published.streamID === m.streamID) await this._offerTo(m.from);
        else if (m.t === 'offer' && this.viewing) await this._answer(m);
        else if (m.t === 'answer') { const pc = this.pcs.get(m.from); if (pc) await pc.setRemoteDescription(m.sdp); }
        else if (m.t === 'ice') { const pc = this.pcs.get(m.from); if (pc) { try { await pc.addIceCandidate(m.c); } catch { } } }
    }

    sendData(data) {
        const s = JSON.stringify(data);
        let n = 0;
        this.dcs.forEach(dc => { if (dc.readyState === 'open') { dc.send(s); n++; } });
        return n;
    }

    disconnect() {
        clearInterval(this._askTimer); this.viewing = null; this.published = null;
        [...this.pcs.keys()].forEach(p => this._drop(p));
        instances.delete(this);
    }
};
window.qrcode = () => ({ addData() { }, make() { }, createSvgTag() { return '<svg class="mockqr" width="10" height="10"></svg>'; } });
})();
