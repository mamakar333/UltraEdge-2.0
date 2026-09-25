/**
 * Media sources: local camera / microphone and phones via VDO.ninja.
 */

// Raw microphone: every browser "voice" feature destroys transients, so turn them all off.
export const RAW_AUDIO = {
    echoCancellation: false, noiseSuppression: false, autoGainControl: false,
    channelCount: { ideal: 1 }, sampleRate: { ideal: 48000 },
    // Chrome legacy names
    googEchoCancellation: false, googNoiseSuppression: false, googAutoGainControl: false, googHighpassFilter: false,
};

export async function listDevices() {
    try {
        const d = await navigator.mediaDevices.enumerateDevices();
        return { video: d.filter(x => x.kind === 'videoinput'), audio: d.filter(x => x.kind === 'audioinput') };
    } catch { return { video: [], audio: [] }; }
}

export async function openLocalCamera(deviceId, { fps = 60, width = 1280, height = 720 } = {}) {
    return navigator.mediaDevices.getUserMedia({
        video: { deviceId: deviceId ? { exact: deviceId } : undefined, width: { ideal: width }, height: { ideal: height }, frameRate: { ideal: fps } },
        audio: false,
    });
}

export async function openLocalMic(deviceId) {
    return navigator.mediaDevices.getUserMedia({ audio: { ...RAW_AUDIO, deviceId: deviceId ? { exact: deviceId } : undefined }, video: false });
}

/** The URL the phone opens to publish its camera + mic (no voice processing, max quality). */
export function phonePushUrl(streamId, { video = true } = {}) {
    const flags = video
        ? ['webcam', 'proaudio', 'autostart']
        : ['webcam', 'videodevice=0', 'audiodevice=1', 'proaudio', 'autostart'];
    let q = `?push=${encodeURIComponent(streamId)}&${flags.join('&')}&aec=0&ag=0&dn=0&outboundaudiobitrate=256`;
    if (video) q += '&maxframerate=60&width=1280&height=720';
    q += `&label=${video ? 'UltraEdgeCam' : 'UltraEdgeMic'}`;
    return 'https://vdo.ninja/' + q;
}

export function randomStreamId() {
    const a = 'abcdefghjkmnpqrstuvwxyz23456789';
    let s = 'ue';
    for (let i = 0; i < 7; i++) s += a[Math.floor(Math.random() * a.length)];
    return s;
}

/**
 * Receive a phone's stream with the VDO.ninja SDK (direct MediaStream, no iframe,
 * no tab capture). Resolves once the requested tracks arrive.
 */
export class NinjaReceiver {
    constructor() { this.vdo = null; this.stream = new MediaStream(); this.onStatus = null; this.onTrack = null; }

    async connect(streamId, { audio = true, video = true, timeoutMs = 45000 } = {}) {
        if (typeof VDONinjaSDK === 'undefined') throw new Error('VDO.ninja SDK failed to load (check internet connection).');
        this.disconnect();
        this.stream = new MediaStream();
        this.vdo = new VDONinjaSDK({ host: 'wss://wss.vdo.ninja', salt: 'vdo.ninja' });
        const status = (s) => this.onStatus && this.onStatus(s);
        const got = new Promise((resolve) => {
            this.vdo.addEventListener('track', (e) => {
                const { track } = e.detail;
                if (this.stream.getTracks().some(t => t.id === track.id)) return;
                this.stream.addTrack(track);
                track.addEventListener('ended', () => status('track ended'));
                if (this.onTrack) this.onTrack(track, this.stream);
                const haveA = !audio || this.stream.getAudioTracks().length > 0;
                const haveV = !video || this.stream.getVideoTracks().length > 0;
                if (haveA && haveV) resolve(this.stream);
            });
        });
        this.vdo.addEventListener('disconnected', () => status('disconnected'));
        this.vdo.addEventListener('error', (e) => status('error: ' + (e.detail?.error?.message || e.detail?.error || 'unknown')));
        status('connecting to signalling server…');
        await this.vdo.connect();
        status(`waiting for phone “${streamId}”…`);
        await this.vdo.view(streamId, { audio, video });
        const timeout = new Promise((_, rej) => setTimeout(() => rej(new Error(`No stream from “${streamId}” after ${timeoutMs / 1000}s — is the phone page open and publishing?`)), timeoutMs));
        const s = await Promise.race([got, timeout]);
        status('connected');
        return s;
    }

    disconnect() {
        try { this.vdo && this.vdo.disconnect && this.vdo.disconnect(); } catch { }
        try { this.vdo && this.vdo.close && this.vdo.close(); } catch { }
        this.vdo = null;
    }
}
