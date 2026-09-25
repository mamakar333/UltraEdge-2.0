// Test double for the VDO.ninja SDK: "phones" are Chromium's fake camera/mic.
window.VDONinjaSDK = class extends EventTarget {
    constructor(opts) { super(); this.opts = opts; window.__ninjaMock = (window.__ninjaMock || 0) + 1; }
    async connect() { this.dispatchEvent(new CustomEvent('connected')); }
    async view(streamID, { audio = true, video = true } = {}) {
        const s = await navigator.mediaDevices.getUserMedia({
            audio: audio ? { echoCancellation: false, noiseSuppression: false, autoGainControl: false } : false, video: !!video });
        setTimeout(() => s.getTracks().forEach(track => this.dispatchEvent(new CustomEvent('track', { detail: { track, streamID } }))), 300);
    }
    disconnect() { }
};
window.qrcode = () => ({ addData() { }, make() { }, createSvgTag() { return '<svg class="mockqr" width="10" height="10"></svg>'; } });
