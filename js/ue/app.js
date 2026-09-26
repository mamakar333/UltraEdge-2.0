/**
 * UltraEdge 3 — app controller (the "studio": this computer is the source of truth).
 *
 *   up to 4 cameras (phones / webcams) ──► <video> ──► FrameBuffer each (timestamped JPEG frames)
 *   stump mic (phone/USB) ──► AudioEngine ──► worklet: EdgeDetector + PCM ring buffer
 *                                   │
 *                                spike ──► delivery ──► ReviewPlayer (frame-by-frame + trace, every angle)
 *
 *   Umpire view: the screen is published live (StudioBroadcast); umpire phones (remote.html) watch it
 *   and send commands. Verdicts are saved to the linked CrickVision match (host-bridge.js).
 */
import { AudioEngine } from './audio-engine.js';
import { FrameBuffer } from './frame-buffer.js';
import { ReviewPlayer, BlobFrameSource, VideoFrameSource, download } from './review.js';
import { drawTrace, drawGrid, COLORS } from './waveform.js';
import { EdgeDetector } from './edge-detector.js';
import * as src from './sources.js';
import { host, parseMatchRef, CV_API_DEFAULT } from './host-bridge.js';
import { StudioBroadcast } from './broadcast.js';
import { studioStreamId, STUDIO_FEED } from './link.js';

const $ = (id) => document.getElementById(id);
const store = {
    get(k, d) { try { const v = localStorage.getItem('ue.' + k); return v === null ? d : JSON.parse(v); } catch { return d; } },
    set(k, v) { try { localStorage.setItem('ue.' + k, JSON.stringify(v)); } catch { } },
};
const esc = (t) => String(t ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const PRE_MS = 1500, POST_MS = 700, GROUP_MS = 1500;
export const MAX_CAMS = 4;
const CAM_NAMES = ['Side-on', 'Front-on', 'Behind the stumps', 'Wide'];

const app = {
    engine: new AudioEngine({ seconds: 60, params: { sensitivity: store.get('sens', 85), voiceFilter: store.get('voiceFilter', true) } }),
    cams: [],              // [{ name, video, tile, frames: FrameBuffer }]
    receivers: [],
    streams: [],
    keepAlive: [],
    running: false,
    deliveries: [],
    liveHits: [],
    offsets: {
        live: store.get('offsetLive', 0),          // camera 1 (kept under the old key)
        file: store.get('offsetFile', 0),
        cams: [0, 1, 2, 3].map(k => (k ? store.get('offsetLive' + k, 0) : 0)),
    },
    scopeGain: 8,
    liveLayout: -1,        // -1 = all cameras, k = camera k large
    matchTitle: '',
    sessionKey: store.get('studioKey', null) || ('s' + Math.random().toString(36).slice(2, 10)),
};
store.set('studioKey', app.sessionKey);
const idleFrames = new FrameBuffer({ seconds: 1 });
/** camera 1's frame buffer (kept for scripts and tests written for a single camera) */
Object.defineProperty(app, 'frames', { get: () => (app.cams[0] ? app.cams[0].frames : idleFrames) });
window.ultraedge = app; // handy for debugging from the console

const camOffset = (k) => (k === 0 ? app.offsets.live : app.offsets.cams[k] || 0);
function setCamOffset(k, ms) {
    if (k === 0) { app.offsets.live = ms; store.set('offsetLive', ms); } else { app.offsets.cams[k] = ms; store.set('offsetLive' + k, ms); }
}

// ---------------------------------------------------------------------------
// Review player
// ---------------------------------------------------------------------------
let pendingBall = null;   // ball context sent by an umpire phone with its verdict
const review = new ReviewPlayer($('review'), {
    onOffsetChange: (ms, angle) => {
        const kind = review.session?.kind || 'live';
        if (kind === 'file') { app.offsets.file = ms; store.set('offsetFile', ms); }
        else setCamOffset(angle || 0, ms);
        status(`A/V sync offset (${kind === 'file' ? 'file' : (app.cams[angle || 0]?.name || 'camera')}) set to ${ms} ms`);
    },
    onVerdict: (session, v) => {
        const d = app.deliveries.find(d => d.session === session || d.id === session.deliveryId);
        if (d) { d.verdict = session.verdict; renderHits(); }
        const ball = pendingBall; pendingBall = null;
        saveVerdict(d || { id: session.deliveryId || ('r' + Date.now()), hits: session.hits, manual: true }, v, ball);
    },
});

window.ultraedgeReview = review;
// Coming back from a replay: make sure the live picture is running again
review.onClose = () => {
    for (const c of app.cams) if (app.running && c.video.srcObject && c.video.paused) c.video.play().catch(() => { });
};

async function saveVerdict(d, v, ball) {
    if (!host.matchId) { broadcast.event('verdict', { verdict: v, saved: false, review: null, error: null, local: true }); return; }
    status(`Saving ${v} to the CrickVision match…`);
    const r = await host.verdict(d, v, ball);
    status(r.saved ? `✓ ${v} saved for ball ${r.review?.overLabel || '—'}` : `⚠ Verdict not saved: ${r.error}`);
    broadcast.event('verdict', r);
    broadcast.pushState(true);
}

class BlankFrameSource {
    constructor(t0, t1, fps = 60) {
        this.t0 = t0; this.frameDur = 1000 / fps;
        this.n = Math.max(2, Math.ceil((t1 - t0) / this.frameDur));
        this.c = document.createElement('canvas'); this.c.width = 1280; this.c.height = 720;
        const g = this.c.getContext('2d');
        g.fillStyle = '#05080d'; g.fillRect(0, 0, 1280, 720);
        g.fillStyle = '#34465c'; g.font = 'bold 48px "Barlow Condensed", sans-serif'; g.textAlign = 'center';
        g.fillText('AUDIO ONLY', 640, 370);
    }
    get count() { return this.n; }
    timeOf(i) { return this.t0 + i * this.frameDur; }
    indexAt(t) { return Math.max(0, Math.min(this.n - 1, Math.floor((t - this.t0) / this.frameDur))); }
    async get() { return this.c; }
}

// ---------------------------------------------------------------------------
// Live pipeline
// ---------------------------------------------------------------------------
function status(msg) { $('status').textContent = msg; schedulePush(); }

function setState(label, on) {
    $('pillState').classList.toggle('on', on);
    $('pillState').querySelector('span').textContent = label;
}

function renderCamGrid() {
    const g = $('camGrid'), n = Math.max(1, app.cams.length);
    const focus = app.liveLayout >= 0 && app.liveLayout < app.cams.length && app.cams.length > 1;
    g.className = `cam-grid n${Math.min(n, 4)}${focus ? ' focus' : ''}`;
    g.querySelectorAll('.cam-tile').forEach((t) => {
        const k = +t.dataset.k;
        t.classList.toggle('main', focus && k === app.liveLayout);
        const name = t.querySelector('.cam-name');
        name.hidden = app.cams.length < 2;
        if (app.cams[k]) name.textContent = `${k + 1} · ${app.cams[k].name}`;
    });
    // tile sizes changed: re-fit rotated videos
    requestAnimationFrame(() => app.cams.forEach(c => c && c.rotation && fitRotatedVideo(c)));
    schedulePush();
}

function setLayout(k) {
    app.liveLayout = (k >= 0 && k < app.cams.length && app.cams.length > 1) ? k : -1;
    renderCamGrid();
}

function addCam(k, name, videoStream) {
    let tile = $('camGrid').querySelector(`.cam-tile[data-k="${k}"]`);
    if (!tile) {
        tile = document.createElement('div');
        tile.className = 'cam-tile'; tile.dataset.k = k;
        tile.innerHTML = '<video autoplay playsinline muted></video><span class="cam-name" hidden></span>';
        $('camGrid').appendChild(tile);
    }
    tile.onclick = () => setLayout(app.liveLayout === k ? -1 : k);
    const v = tile.querySelector('video');
    const frames = new FrameBuffer({ seconds: 20, maxWidth: 960 });
    const cam = { name, video: v, tile, frames, rotation: 0 };
    app.cams[k] = cam;
    // ⟳ straightens a sideways picture (remembered per camera slot)
    let rb = tile.querySelector('.cam-rotate');
    if (!rb) {
        rb = document.createElement('button');
        rb.className = 'cam-rotate'; rb.type = 'button';
        rb.title = 'Rotate this camera 90°'; rb.setAttribute('aria-label', `Rotate camera ${k + 1}`);
        rb.textContent = '⟳';
        tile.appendChild(rb);
    }
    rb.onclick = (e) => { e.stopPropagation(); setRotation(cam, k, (cam.rotation + 90) % 360); };
    setRotation(cam, k, store.get(`rot${k}`, 0), false);
    v.srcObject = new MediaStream(videoStream.getVideoTracks());
    v.play().catch(() => { });
    frames.attach(v);
    return cam;
}

/** Rotate a camera's live view, its recorded frames and the umpire broadcast. */
function setRotation(cam, k, deg, save = true) {
    cam.rotation = ((+deg || 0) % 360 + 360) % 360;
    cam.frames.rotation = cam.rotation;
    if (save) { store.set(`rot${k}`, cam.rotation); cam.frames.clear(); }   // don't mix old and new orientation in a replay
    fitRotatedVideo(cam);
    const rb = cam.tile.querySelector('.cam-rotate');
    if (rb) rb.dataset.deg = cam.rotation;
    schedulePush();
}

/** CSS rotation for the live <video>: 90°/270° need the element's box swapped to fill the tile. */
function fitRotatedVideo(cam) {
    const v = cam.video, t = cam.tile, rot = cam.rotation || 0;
    if (!rot) { v.style.cssText = ''; return; }
    const side = rot === 90 || rot === 270;
    const W = t.clientWidth, H = t.clientHeight;
    v.style.cssText = `position:absolute;left:50%;top:50%;object-fit:contain;` +
        `width:${side ? H : W}px;height:${side ? W : H}px;transform:translate(-50%,-50%) rotate(${rot}deg);`;
}
if (typeof ResizeObserver !== 'undefined') {
    new ResizeObserver(() => app.cams.forEach(c => c && c.rotation && fitRotatedVideo(c))).observe($('camGrid'));
}

async function stopAll() {
    app.running = false;
    for (const c of app.cams) { c.frames.detach(); c.video.srcObject = null; }
    $('camGrid').querySelectorAll('.cam-tile:not([data-k="0"])').forEach(t => t.remove());
    $('camGrid').querySelectorAll('.cam-rotate').forEach(b => b.remove());
    $('liveVideo').style.cssText = '';
    app.cams = [];
    app.liveLayout = -1;
    renderCamGrid();
    await app.engine.stop();
    for (const r of app.receivers) r.disconnect();
    for (const s of app.streams) s.getTracks().forEach(t => t.stop());
    for (const el of app.keepAlive) { el.srcObject = null; }
    app.receivers = []; app.streams = []; app.keepAlive = [];
    $('liveVideo').srcObject = null;
    $('liveBadge').classList.remove('on');
    $('btnReviewLast').disabled = true;
    $('btnStop').hidden = true;
    setState('IDLE', false);
    schedulePush();
}

async function startLive(cfg) {
    await stopAll();
    const msg = (m) => { $('setupMsg').textContent = m; status(m); };
    let audioStream = null;

    const receiver = (id, opts, who) => {
        const r = new src.NinjaReceiver();
        r.onStatus = (s) => msg(`${who} (${id}): ${s}`);
        app.receivers.push(r);
        return r.connect(id, opts);
    };

    const cams = cfg.cams.filter(c => c.src !== 'off').slice(0, MAX_CAMS);
    const micFromCam1 = cfg.mic.src === 'cam' && cams[0] && cams[0].src === 'phone';
    // connect all cameras at once (phones take a few seconds each)
    const videoStreams = await Promise.all(cams.map(async (c, k) => {
        if (c.src === 'phone') {
            const wantAudio = k === 0 && micFromCam1;
            const s = await receiver(c.id, { video: true, audio: wantAudio }, `Camera ${k + 1}`);
            if (wantAudio) audioStream = new MediaStream(s.getAudioTracks());
            return s;
        }
        msg(`Opening camera ${k + 1}…`);
        const s = await src.openLocalCamera(c.device || undefined);
        app.streams.push(s);
        return s;
    }));

    if (!audioStream) {
        if (cfg.mic.src === 'phone') {
            audioStream = await receiver(cfg.mic.id, { video: false, audio: true }, 'Stump mic');
        } else {
            // 'local', or 'cam' without a camera phone → computer microphone
            msg('Opening microphone…');
            audioStream = await src.openLocalMic(cfg.mic.src === 'local' ? (cfg.mic.device || undefined) : undefined);
            app.streams.push(audioStream);
        }
    }
    if (!audioStream || !audioStream.getAudioTracks().length) throw new Error('No audio track — UltraEdge needs a microphone.');

    // Chrome only feeds remote WebRTC audio into Web Audio if it is also attached to a media element
    if (app.receivers.length) {
        const a = new Audio(); a.muted = true; a.srcObject = audioStream; a.play().catch(() => { });
        app.keepAlive.push(a);
    }

    videoStreams.forEach((vs, k) => { if (vs && vs.getVideoTracks().length) addCam(k, cams[k].name || CAM_NAMES[k], vs); });
    app.cams = app.cams.filter(Boolean);
    // fewer seconds per camera with many cameras: keeps memory in check
    if (app.cams.length > 2) app.cams.forEach(c => { c.frames.seconds = 12; });
    renderCamGrid();
    $('videoEmpty').classList.add('hide');
    $('liveBadge').classList.toggle('on', app.cams.length > 0);

    await app.engine.start(audioStream);
    app.engine.onHit = onHit;
    app.engine.setMonitor($('listen').checked);
    app.running = true;
    app.cfg = cfg;
    $('btnReviewLast').disabled = false;
    $('btnStop').hidden = false;
    setState('LIVE', true);
    msg(`Live. Audio ${app.engine.sampleRate} Hz · ${app.cams.length ? app.cams.length + ' camera' + (app.cams.length > 1 ? 's' : '') : 'no camera'}`);
    // umpire phones can watch straight away (no match link needed)
    if (!broadcast.live) startUmpire().catch(() => { });
}

function onHit(h) {
    app.liveHits.push(h);
    if (app.liveHits.length > 500) app.liveHits.shift();
    const f = $('spikeFlash'); f.classList.add('on'); setTimeout(() => f.classList.remove('on'), 120);
    app.lastHitAt = performance.now();
    host.hit(h);

    let d = app.deliveries[0];
    if (!d || d.kind !== 'live' || d.session || h.perf - d.lastPerf > GROUP_MS) {
        d = { id: 'd' + Date.now(), kind: 'live', hits: [], firstPerf: h.perf, lastPerf: h.perf, wall: new Date(), session: null, verdict: null };
        app.deliveries.unshift(d);
        if (app.deliveries.length > 40) { const old = app.deliveries.pop(); disposeSession(old.session); if (old.thumb) URL.revokeObjectURL(old.thumb); }
    }
    d.hits.push(h);
    d.lastPerf = h.perf;
    clearTimeout(d.timer);
    d.timer = setTimeout(() => finalizeDelivery(d), POST_MS + 300);
    renderHits();
}

function disposeSession(s) {
    if (!s || s === review.session) return;
    if (s.angles) s.angles.forEach(a => a.frames.dispose?.()); else s.frames?.dispose?.();
}

/** Build a review session from the live buffers for [t0, t1] (audio clock, ms): every camera angle. */
function buildLiveSession(t0, t1, hits, title) {
    const e = app.engine;
    const f0 = Math.max(0, e.fromPerf(t0 - 400)), f1 = Math.min(e.latestFrame, e.fromPerf(t1 + 400));
    const raw = e.getRange(f0, f1, 'raw'), hp = e.getRange(f0, f1, 'hp');
    let angles = app.cams.map((c, k) => {
        const off = camOffset(k);
        const vf = c.frames.slice(t0 + off - 40, t1 + off + 40);
        return { name: c.name, offsetMs: off, frames: vf.length >= 2 ? new BlobFrameSource(vf) : new BlankFrameSource(t0 + off, t1 + off) };
    });
    if (!angles.length) angles = [{ name: 'Audio', offsetMs: camOffset(0), frames: new BlankFrameSource(t0 + camOffset(0), t1 + camOffset(0)) }];
    const angle = app.liveLayout >= 0 && app.liveLayout < angles.length ? app.liveLayout : 0;
    const off = angles[angle].offsetMs;
    return {
        kind: 'live', title, fs: e.sampleRate, raw, hp, audioT0: e.toPerf(f0), angles, angle, frames: angles[angle].frames,
        hits: hits.map(h => ({ ...h, t: h.perf })), focusT: hits.length ? hits[0].perf + off : undefined,
    };
}

function thumbFor(d, s, t) {
    if (s.frames instanceof BlobFrameSource) {
        const fr = s.frames.frames[s.frames.indexAt(t)];
        if (fr && fr.blob) d.thumb = URL.createObjectURL(fr.blob);
    }
}

function finalizeDelivery(d) {
    const s = buildLiveSession(d.firstPerf - PRE_MS, d.lastPerf + POST_MS, d.hits, `SPIKE · ${d.wall.toLocaleTimeString()}`);
    s.deliveryId = d.id;
    d.session = s;
    thumbFor(d, s, d.firstPerf + s.angles[s.angle].offsetMs);
    renderHits();
    host.delivery(d);
    if ($('autoReview').checked && !review.isOpen) review.open(s, s.angles[s.angle].offsetMs);
}

function reviewLast() {
    if (!app.running) return;
    const e = app.engine;
    const audioEnd = e.toPerf(e.latestFrame);
    // the end of the clip is limited by the camera that is furthest behind
    let t1 = audioEnd;
    app.cams.forEach((c, k) => { if (c.frames.frames.length) t1 = Math.min(t1, c.frames.latestTime - camOffset(k)); });
    t1 -= 30;
    const t0 = t1 - 3000;
    const hits = app.liveHits.filter(h => h.perf >= t0 && h.perf <= t1);
    const s = buildLiveSession(t0, t1, hits, 'MANUAL REVIEW · LAST 3 s');
    const off = s.angles[s.angle].offsetMs;
    if (!hits.length) s.focusT = t1 + off - 500;
    const d = { id: 'm' + Date.now(), kind: 'live', hits, firstPerf: t0, lastPerf: t1, wall: new Date(), session: s, manual: true };
    s.deliveryId = d.id;
    thumbFor(d, s, s.focusT ?? t1);
    app.deliveries.unshift(d);
    renderHits();
    review.open(s, off);
}

// ---------------------------------------------------------------------------
// Deliveries list
// ---------------------------------------------------------------------------
function deliveryLabel(d) {
    return d.kind === 'file' ? `${(d.firstT / 1000).toFixed(2)} s` : d.wall.toLocaleTimeString();
}

function renderHits() {
    const box = $('hits');
    schedulePush();
    if (!app.deliveries.length) { box.innerHTML = '<p class="muted small pad">Spikes appear here. Click one to open the frame-by-frame UltraEdge replay.</p>'; return; }
    box.innerHTML = '';
    for (const d of app.deliveries) {
        const el = document.createElement('div');
        el.className = 'hit' + (d.session ? '' : ' pending');
        const best = d.hits.reduce((b, h) => (!b || h.snrDb > b.snrDb) ? h : b, null);
        const v = d.verdict ? `<span class="v ${d.verdict === 'EDGE' ? 'EDGE' : 'NO'}">${d.verdict}</span>` : `<span>${d.manual ? 'manual' : (best ? best.snrDb + ' dB' : '')}</span>`;
        el.innerHTML = (d.thumb ? `<img src="${d.thumb}" alt="">` : `<div class="noimg"></div>`) +
            `<div class="meta"><span>${deliveryLabel(d)}${d.hits.length > 1 ? ` ×${d.hits.length}` : ''}</span>${v}</div>`;
        el.onclick = () => openDelivery(d);
        box.appendChild(el);
    }
}

function openDelivery(d) {
    if (d.kind === 'file') { app.fileSession.focusT = d.firstT + app.offsets.file; app.fileSession.deliveryId = d.id; app.fileSession.verdict = d.verdict; review.open(app.fileSession, app.offsets.file); return; }
    if (!d.session) { clearTimeout(d.timer); finalizeDelivery(d); }
    review.open(d.session, d.session.angles ? d.session.angles[d.session.angle || 0].offsetMs : app.offsets.live);
}

// ---------------------------------------------------------------------------
// Live scope
// ---------------------------------------------------------------------------
/** The scrolling live UltraEdge trace (last 2 s) into any canvas rect. */
function drawScopeInto(ctx, rect, { updateGain = false, hp = $('scopeHp').checked } = {}) {
    const e = app.engine, W = rect.w, H = rect.h;
    if (!app.running || e.latestFrame < 0) {
        drawGrid(ctx, rect, 0, 2000, { stepMs: 100 });
        ctx.fillStyle = COLORS.text; ctx.font = `${Math.round(H / 26 + 8)}px Inter, sans-serif`; ctx.textAlign = 'center';
        ctx.fillText(app.running ? 'waiting for audio…' : 'not running', rect.x + W / 2, rect.y + H / 2 - 12); ctx.textAlign = 'left';
        return;
    }
    const fs = e.sampleRate, end = e.latestFrame, start = end - Math.round(fs * 2);
    const data = e.getRange(start, end, hp ? 'hp' : 'raw');
    if (updateGain) {
        let pk = 0; for (let i = 0; i < data.length; i += 4) { const a = Math.abs(data[i]); if (a > pk) pk = a; }
        const target = 0.85 / Math.max(pk, 0.004);
        app.scopeGain = target < app.scopeGain ? target : app.scopeGain + (target - app.scopeGain) * 0.01;
    }
    const t0 = e.toPerf(start), t1 = e.toPerf(end);
    drawGrid(ctx, rect, t0, t1, { stepMs: 100 });
    drawTrace(ctx, rect, data, fs, t0, t0, t1, { gain: app.scopeGain });
    ctx.fillStyle = COLORS.hit;
    for (const h of app.liveHits) {
        if (h.frame < start) continue;
        const x = rect.x + (h.frame - start) / (end - start) * W;
        ctx.fillRect(x - 1, rect.y, 3, H);
    }
}

const scope = $('scope'), sctx = scope.getContext('2d');
function drawScope() {
    requestAnimationFrame(drawScope);
    drawScopeInto(sctx, { x: 0, y: 0, w: scope.width, h: scope.height }, { updateGain: true });
    if (app.running) {
        const db = 20 * Math.log10(Math.max(app.engine.level, 1e-5));
        $('meterFill').style.width = `${Math.max(0, Math.min(100, (db + 60) / 60 * 100))}%`;
    }
}
requestAnimationFrame(drawScope);

// Video health: tell the user *why* the picture looks empty (phone slept, lens covered, too dark…)
const lumaCanvas = document.createElement('canvas'); lumaCanvas.width = 32; lumaCanvas.height = 18;
const lumaCtx = lumaCanvas.getContext('2d', { willReadFrequently: true });
const health = new Map();   // cam → { last, stalledSince }
setInterval(() => {
    const warn = $('videoWarn');
    let msg = '';
    app.cams.forEach((c, k) => {
        if (msg || !app.running) return;
        const v = c.video, who = app.cams.length > 1 ? `Camera ${k + 1} (${c.name}): ` : '';
        if (!v.srcObject) return;
        const h = health.get(c) || { last: 0, stalledSince: 0 };
        const track = v.srcObject.getVideoTracks()[0];
        const n = c.frames.frames.length ? c.frames.latestTime : 0;
        const stalled = n === h.last;
        h.last = n;
        h.stalledSince = stalled ? (h.stalledSince || performance.now()) : 0;
        health.set(c, h);
        if (v.paused) v.play().catch(() => { });
        if (track && track.readyState === 'ended') msg = who + 'Camera feed ended — reconnect in Setup sources.';
        else if ((track && track.muted) || (h.stalledSince && performance.now() - h.stalledSince > 1500))
            msg = who + 'NO VIDEO SIGNAL — is the camera phone locked, asleep or showing another app? Keep the VDO.ninja page open with the screen on.';
        else if (v.videoWidth) {
            try {
                lumaCtx.drawImage(v, 0, 0, 32, 18);
                const px = lumaCtx.getImageData(0, 0, 32, 18).data;
                let sum = 0; for (let i = 0; i < px.length; i += 4) sum += 0.2126 * px[i] + 0.7152 * px[i + 1] + 0.0722 * px[i + 2];
                const luma = sum / (px.length / 4);
                if (luma < 22) msg = who + `Picture is very dark (brightness ${luma.toFixed(0)}/255) — lens covered, pointing at the ground, or too little light?`;
            } catch { }
            const side = c.rotation === 90 || c.rotation === 270;
            const portrait = side ? v.videoWidth > v.videoHeight : v.videoHeight > v.videoWidth;
            if (!msg && portrait) msg = who + 'Picture is upright/portrait. If the phone is held sideways, tap ⟳ on the video to straighten it; otherwise turn the phone sideways for a side-on view of the bat.';
        }
    });
    warn.textContent = msg;
    warn.classList.toggle('on', !!msg);
}, 1000);

setInterval(() => {
    const c0 = app.cams[0], fb = app.frames;
    if (app.running && c0 && c0.video.videoWidth) {
        const v = c0.video, more = app.cams.length > 1 ? ` · ${app.cams.length} cameras` : '';
        $('pillVideo').textContent = `VIDEO ${v.videoWidth}×${v.videoHeight} · ${fb.fps} fps${more}`;
        $('videoInfo').textContent = `${v.videoWidth}×${v.videoHeight} @ ${fb.fps} fps · ${app.cams.reduce((m, c) => m + c.frames.memoryMB, 0).toFixed(0)} MB buffered${more}`;
    } else if (!app.running) $('pillVideo').textContent = 'VIDEO —';
    $('pillAudio').textContent = app.running ? `AUDIO ${app.engine.sampleRate / 1000} kHz` : 'AUDIO —';
    $('pillBuf').textContent = app.running ? `REPLAY BUFFER ${Math.min(fb.seconds, fb.frames.length / Math.max(1, fb.fps)).toFixed(0)} s` : 'BUFFER —';
}, 500);

// ---------------------------------------------------------------------------
// File analysis
// ---------------------------------------------------------------------------
async function estimateFps(video) {
    if (!('requestVideoFrameCallback' in HTMLVideoElement.prototype)) return 30;
    return new Promise((resolve) => {
        const times = [];
        let done = false;
        const finish = () => {
            if (done) return; done = true;
            video.pause(); video.currentTime = 0;
            const d = [];
            for (let i = 1; i < times.length; i++) d.push(times[i] - times[i - 1]);
            d.sort((a, b) => a - b);
            const med = d.length ? d[d.length >> 1] : 0;
            const fps = med > 0 ? 1 / med : 30;
            const common = [24, 25, 30, 48, 50, 60, 90, 120, 240];
            resolve(common.reduce((b, c) => Math.abs(c - fps) < Math.abs(b - fps) ? c : b, 30));
        };
        const cb = (now, m) => { times.push(m.mediaTime); if (times.length >= 16) finish(); else video.requestVideoFrameCallback(cb); };
        video.requestVideoFrameCallback(cb);
        video.muted = true;
        video.play().catch(finish);
        setTimeout(finish, 3000);
    });
}

async function analyseFile(file) {
    try {
        status(`Loading ${file.name}…`);
        const url = URL.createObjectURL(file);
        const video = document.createElement('video');
        video.muted = true; video.playsInline = true; video.preload = 'auto'; video.src = url;
        await new Promise((res, rej) => { video.onloadeddata = res; video.onerror = () => rej(new Error('This browser cannot play that file.')); });
        status('Decoding audio…');
        const buf = await file.arrayBuffer();
        const ac = new (window.AudioContext || window.webkitAudioContext)();
        const ab = await ac.decodeAudioData(buf);
        ac.close();
        const fs = ab.sampleRate, n = ab.length;
        const mono = new Float32Array(n);
        for (let c = 0; c < ab.numberOfChannels; c++) { const d = ab.getChannelData(c); for (let i = 0; i < n; i++) mono[i] += d[i] / ab.numberOfChannels; }
        status('Detecting spikes…');
        const det = new EdgeDetector(fs, { sensitivity: +$('sens').value, voiceFilter: $('ignoreVoice').checked });
        const hp = new Float32Array(n);
        const hits = [];
        for (let i = 0; i < n; i += 8192) {
            const end = Math.min(n, i + 8192);
            hits.push(...det.process(mono.subarray(i, end), hp.subarray(i, end)));
        }
        hits.push(...det.process(new Float32Array(Math.round(fs * 0.06))).filter(h => h.sample < n - fs * 0.002));
        let frames;
        if (video.videoWidth) {
            status('Measuring frame rate…');
            const fps = await estimateFps(video);
            frames = new VideoFrameSource(video, fps);
        } else frames = new BlankFrameSource(0, n / fs * 1000);
        const hitsT = hits.map(h => ({ ...h, t: h.sample / fs * 1000 }));
        app.fileSession = { kind: 'file', title: file.name.toUpperCase(), fs, raw: mono, hp, audioT0: 0, frames, hits: hitsT };
        // deliveries from file hits
        app.deliveries = app.deliveries.filter(d => d.kind !== 'file');
        let cur = null;
        const fileDs = [];
        for (const h of hitsT) {
            if (!cur || h.t - cur.lastT > GROUP_MS) { cur = { id: 'f' + h.sample, kind: 'file', hits: [], firstT: h.t, lastT: h.t, session: app.fileSession }; fileDs.push(cur); }
            cur.hits.push(h); cur.lastT = h.t;
        }
        app.deliveries.unshift(...fileDs.reverse());
        renderHits();
        status(`${file.name}: ${hits.length} spike(s) in ${(n / fs).toFixed(1)} s · ${frames.fps ? frames.fps + ' fps' : 'audio only'}`);
        app.fileSession.focusT = hitsT.length ? hitsT[0].t + app.offsets.file : 0;
        review.open(app.fileSession, app.offsets.file);
    } catch (err) {
        console.error(err);
        status('File analysis failed: ' + err.message);
        alert('Could not analyse that file: ' + err.message);
    }
}

// ---------------------------------------------------------------------------
// Umpire view: publish this screen, let umpire phones drive it
// ---------------------------------------------------------------------------
function fitDraw(ctx, img, x, y, w, h, rotation = 0) {
    const iw0 = img.videoWidth || img.width, ih0 = img.videoHeight || img.height;
    if (!iw0 || !ih0) return false;
    const rot = ((rotation % 360) + 360) % 360, side = rot === 90 || rot === 270;
    const iw = side ? ih0 : iw0, ih = side ? iw0 : ih0;          // size as shown
    const sc = Math.min(w / iw, h / ih), dw = iw * sc, dh = ih * sc;
    if (!rot) { ctx.drawImage(img, x + (w - dw) / 2, y + (h - dh) / 2, dw, dh); return true; }
    ctx.save();
    ctx.translate(x + w / 2, y + h / 2);
    ctx.rotate(rot * Math.PI / 180);
    const sw = side ? dh : dw, sh = side ? dw : dh;
    ctx.drawImage(img, -sw / 2, -sh / 2, sw, sh);
    ctx.restore();
    return true;
}

function badge(ctx, text, x, y, bg, fg = '#fff', size = 22, alignRight = false) {
    ctx.font = `bold ${size}px "Barlow Condensed", "Arial Narrow", sans-serif`;
    const w = ctx.measureText(text).width + size;
    const bx = alignRight ? x - w : x;
    ctx.fillStyle = bg; ctx.fillRect(bx, y, w, size * 1.45);
    ctx.fillStyle = fg; ctx.fillText(text, bx + size / 2, y + size * 1.08);
}

/** What the umpire phones see while no replay is open: the camera(s) + the live trace. */
function drawProgramLive(ctx, r) {
    const VH = Math.round(r.h * 0.72), SH = r.h - VH;
    ctx.fillStyle = '#000'; ctx.fillRect(r.x, r.y, r.w, VH);
    const cams = app.cams;
    if (cams.length) {
        const show = app.liveLayout >= 0 && app.liveLayout < cams.length ? [app.liveLayout] : cams.map((_, k) => k);
        const n = show.length, cols = n <= 2 ? n : 2, rows = Math.ceil(n / cols), cw = r.w / cols, ch = VH / rows;
        show.forEach((k, i) => {
            const x = r.x + (i % cols) * cw, y = r.y + Math.floor(i / cols) * ch;
            fitDraw(ctx, cams[k].video, x + 1, y + 1, cw - 2, ch - 2, cams[k].rotation || 0);
            if (cams.length > 1) badge(ctx, `${k + 1} · ${cams[k].name}`, x + 10, y + ch - 42, k === app.liveLayout ? '#ffd21a' : 'rgba(0,0,0,0.6)', k === app.liveLayout ? '#000' : '#fff', 20);
        });
    } else {
        ctx.fillStyle = '#34465c'; ctx.font = 'bold 54px "Barlow Condensed", sans-serif'; ctx.textAlign = 'center';
        ctx.fillText(app.running ? 'AUDIO ONLY' : 'ULTRAEDGE — WAITING FOR THE OPERATOR', r.x + r.w / 2, r.y + VH / 2);
        ctx.font = '24px Inter, sans-serif';
        if (!app.running) ctx.fillText('Cameras and the stump mic are set up on the laptop', r.x + r.w / 2, r.y + VH / 2 + 44);
        ctx.textAlign = 'left';
    }
    drawScopeInto(ctx, { x: r.x, y: r.y + VH, w: r.w, h: SH });
    if (app.running) badge(ctx, 'LIVE', r.x + 14, r.y + 14, '#ff2d3d');
    if (app.lastHitAt && performance.now() - app.lastHitAt < 600) badge(ctx, 'SPIKE', r.x + r.w - 14, r.y + 14, '#ff2d3d', '#fff', 34, true);
    if (app.matchTitle) badge(ctx, app.matchTitle, r.x + r.w - 14, r.y + VH - 46, 'rgba(0,0,0,0.6)', '#fff', 20, true);
}

/** Everything a phone needs to draw its controls. */
function studioState() {
    return {
        v: 1,
        running: app.running,
        match: app.matchTitle || '',
        matchId: host.matchId || null,
        cams: app.cams.map(c => c.name),
        layout: app.liveLayout,
        sens: +$('sens').value,
        autoReview: $('autoReview').checked,
        voiceFilter: $('ignoreVoice').checked,
        hp: $('scopeHp').checked,
        status: $('status').textContent,
        deliveries: app.deliveries.slice(0, 12).map(d => {
            const best = d.hits.reduce((b, h) => (!b || h.snrDb > b.snrDb) ? h : b, null);
            return { id: d.id, when: deliveryLabel(d), n: d.hits.length, snr: best ? best.snrDb : null, verdict: d.verdict || null, manual: !!d.manual, ready: !!d.session || d.kind === 'file', open: review.isOpen && review.session === d.session };
        }),
        review: review.state(),
        lastSaved: host.lastSaved ? { over: host.lastSaved.overLabel, verdict: host.lastSaved.verdict } : null,
    };
}

/** A command from an umpire phone: the same actions as the buttons here. */
async function remoteCommand(m) {
    const clampStep = (n) => Math.max(-30, Math.min(30, Math.round(+n || 0)));
    switch (m.cmd) {
        case 'hello':
            // an umpire phone opened from a CrickVision match: verdicts go to that match
            if (m.matchId && !host.matchId) await adoptMatch(m.matchId, m.api);
            break;
        case 'reviewLast': reviewLast(); break;
        case 'open': { const d = app.deliveries.find(x => x.id === m.id); if (d) openDelivery(d); break; }
        case 'close': if (review.isOpen) review.close(); break;
        case 'step': review.step(clampStep(m.n)); break;
        case 'toggle': review.togglePlay(); break;
        case 'play': if (!review.playing) review.togglePlay(); break;
        case 'pause': if (review.playing) review.togglePlay(); break;
        case 'hit': review.jumpToHit(m.dir < 0 ? -1 : 1); break;
        case 'verdict':
            if (!review.isOpen) break;
            if (m.matchId && m.matchId !== host.matchId) await adoptMatch(m.matchId, m.api);
            pendingBall = m.ball && typeof m.ball === 'object' ? m.ball : null;
            review.setVerdict(m.v === 'EDGE' ? 'EDGE' : 'NO EDGE');
            break;
        case 'speed': review.setSpeed(m.v); break;
        case 'window': review.setWindow(m.v); break;
        case 'angle': review.grid = false; review.setAngle(+m.k || 0); review._renderAngles(); review.render(); break;
        case 'grid': review.setGrid(!!m.on); break;
        case 'sound': review.setSound(!!m.on); break;
        case 'hp': review.setHp(!!m.on); break;
        case 'offset': review.setOffset(Math.max(-300, Math.min(300, +m.ms || 0)), true); break;
        case 'syncHere': review.syncHere(); break;
        case 'sens': { const v = Math.max(0, Math.min(100, Math.round(+m.v))); $('sens').value = v; $('sens').oninput({ target: $('sens') }); break; }
        case 'auto': $('autoReview').checked = !!m.on; store.set('autoReview', !!m.on); break;
        case 'voice': $('ignoreVoice').checked = !!m.on; $('ignoreVoice').onchange({ target: $('ignoreVoice') }); break;
        case 'layout': setLayout(+m.k); break;
        default: console.warn('unknown remote command', m.cmd);
    }
    schedulePush();
}

const broadcast = new StudioBroadcast({ review, drawLive: drawProgramLive, getState: studioState, onCommand: remoteCommand });
app.broadcast = broadcast;
let pushQueued = false;
function schedulePush() {
    if (pushQueued || !broadcast.live) return;
    pushQueued = true;
    setTimeout(() => { pushQueued = false; broadcast.pushState(); }, 120);
}
review.onChange = schedulePush;

/** One feed for every umpire phone, whatever match it was opened from (?studio=<name> for a separate one). */
const STUDIO = new URLSearchParams(location.search).get('studio') || STUDIO_FEED;
function studioKey() { return STUDIO; }

/** The link an umpire opens (the CrickVision app opens the same page for the match automatically). */
function remoteUrl() {
    const u = new URL('remote.html', location.href);
    if (STUDIO !== STUDIO_FEED) u.searchParams.set('studio', STUDIO);
    if (host.matchId) {
        u.searchParams.set('matchId', host.matchId);
        const api = new URL(host.api, location.href).href.replace(/\/$/, '');
        if (api !== CV_API_DEFAULT) u.searchParams.set('api', api);
    }
    return u.href;
}

async function startUmpire() {
    await broadcast.start(studioStreamId(studioKey()), 'UltraEdge Studio');
}

function renderUmpire() {
    const live = broadcast.live, n = broadcast.viewers;
    const pill = $('pillUmpire');
    pill.classList.toggle('on', live);
    pill.textContent = live ? `UMPIRE VIEW · ${n} phone${n === 1 ? '' : 's'}` : (broadcast.status.startsWith('error') ? 'UMPIRE VIEW ⚠' : 'UMPIRE VIEW —');
    $('umpireState').textContent = live ? `Live — ${n} umpire phone${n === 1 ? '' : 's'} connected` : (broadcast.status === 'off' ? 'Off' : broadcast.status);
    $('btnUmpireToggle').textContent = live ? 'Stop umpire view' : 'Start umpire view';
    const url = remoteUrl();
    $('linkUmpire').textContent = url;
    $('umpireHow').innerHTML = host.matchId
        ? `Linked to CrickVision match <b>${esc(app.matchTitle || host.matchId)}</b>: in the CrickVision app, open the match's scoring screen and tap <b>UltraEdge</b>. Or scan:`
        : 'Umpire phones connect by themselves: in the CrickVision app open any live match\'s scoring screen and tap <b>UltraEdge</b> (verdicts are saved to that match). Or scan:';
    if ($('umpireSheet').classList.contains('open')) renderQr($('qrUmpire'), url);
}
broadcast.addEventListener('change', renderUmpire);

// ---------------------------------------------------------------------------
// Setup modal
// ---------------------------------------------------------------------------
function defaultCfg() {
    return { v: 2, cams: [{ name: CAM_NAMES[0], src: 'phone', id: src.randomStreamId(), device: '' }], mic: { src: 'cam', id: src.randomStreamId(), device: '' }, match: '' };
}

/** Saved setup (older single-camera settings are carried over). */
function loadCfg() {
    const c = store.get('cfg', null);
    if (!c) return defaultCfg();
    if (c.v === 2 && Array.isArray(c.cams) && c.cams.length) return c;
    return {
        v: 2,
        cams: [{ name: CAM_NAMES[0], src: c.vsrc === 'none' ? 'off' : (c.vsrc === 'local' ? 'local' : 'phone'), id: c.camId || src.randomStreamId(), device: c.camDevice || '' }],
        mic: { src: { same: 'cam', phone2: 'phone', local: 'local' }[c.asrc] || 'cam', id: c.micId || src.randomStreamId(), device: c.micDevice || '' },
        match: '',
    };
}

const form = loadCfg();
app.form = form;
let devices = { video: [], audio: [] };

function cfgFromForm() { return JSON.parse(JSON.stringify(form)); }

function renderQr(el, url) {
    if (typeof qrcode === 'undefined') { el.innerHTML = '<span class="muted small">(QR library offline — copy the link)</span>'; return; }
    const q = qrcode(0, 'M'); q.addData(url); q.make();
    el.innerHTML = q.createSvgTag({ cellSize: 4, margin: 2, scalable: true });
}

function renderCamRows() {
    const box = $('camRows');
    box.innerHTML = '';
    form.cams.forEach((c, k) => {
        const row = document.createElement('div');
        row.className = 'cam-row';
        const opts = [`<option value="phone">Phone camera (via VDO.ninja)</option>`]
            .concat(devices.video.map((d, i) => `<option value="local:${esc(d.deviceId)}">This computer: ${esc(d.label || 'Camera ' + (i + 1))}</option>`))
            .concat(devices.video.length ? [] : ['<option value="local:">This computer\'s camera</option>'])
            .concat(['<option value="off">Off (audio only)</option>']);
        row.innerHTML = `<span class="num">${k + 1}</span><input class="cam-name-in" value="${esc(c.name)}" placeholder="${CAM_NAMES[k]}" aria-label="Camera ${k + 1} name">` +
            `<select class="cam-src" aria-label="Camera ${k + 1} source">${opts.join('')}</select>` +
            (k ? `<button class="x" title="Remove camera">✕</button>` : '<span></span>');
        const sel = row.querySelector('.cam-src');
        sel.value = c.src === 'local' ? `local:${c.device || ''}` : c.src;
        if (!sel.value) sel.value = c.src === 'local' ? (sel.querySelector('option[value^="local:"]')?.value || 'phone') : 'phone';
        sel.onchange = () => {
            const v = sel.value;
            if (v.startsWith('local:')) { c.src = 'local'; c.device = v.slice(6); } else { c.src = v; }
            refreshSetup();
        };
        row.querySelector('.cam-name-in').oninput = (e) => { c.name = e.target.value.trim() || CAM_NAMES[k]; refreshSetup(false); };
        const rm = row.querySelector('button.x');
        if (rm) rm.onclick = () => { form.cams.splice(k, 1); renderCamRows(); refreshSetup(); };
        box.appendChild(row);
    });
    $('btnAddCam').disabled = form.cams.length >= MAX_CAMS;
}

function phoneBox(id, title, streamId, url, qrId, linkId, idInputId) {
    return `<div class="phone"><div class="phone-h">${esc(title)} · stream ID <input id="${idInputId}" class="id" value="${esc(streamId)}"></div>` +
        `<div class="qr" id="${qrId}"></div><div class="link"><code id="${linkId}">${esc(url)}</code><button class="btn tiny" data-copy="${linkId}">Copy</button></div></div>`;
}

function renderPhoneLinks() {
    const box = $('phoneLinks');
    const parts = [];
    form.cams.forEach((c, k) => {
        if (c.src !== 'phone') return;
        const sfx = k ? String(k) : '';
        const micToo = k === 0 && form.mic.src === 'cam';
        parts.push(phoneBox(k, `Camera ${k + 1} phone (${c.name})${micToo ? ' + stump mic' : ''}`, c.id, src.phonePushUrl(c.id || 'x', { video: true }), `qrCam${sfx}`, `linkCam${sfx}`, `camId${sfx}`));
    });
    if (form.mic.src === 'phone') parts.push(phoneBox('m', 'Stump-mic phone', form.mic.id, src.phonePushUrl(form.mic.id || 'x', { video: false }), 'qrMic', 'linkMic', 'micId'));
    box.innerHTML = parts.join('') || '<p class="muted small">No phones needed: this computer\'s camera and microphone are used.</p>';
    $('phoneCol').style.opacity = parts.length ? 1 : 0.5;
    form.cams.forEach((c, k) => {
        const sfx = k ? String(k) : '';
        const inp = $(`camId${sfx}`); if (!inp) return;
        inp.oninput = () => { c.id = inp.value.trim(); $(`linkCam${sfx}`).textContent = src.phonePushUrl(c.id || 'x', { video: true }); renderQr($(`qrCam${sfx}`), $(`linkCam${sfx}`).textContent); store.set('cfg', form); };
        renderQr($(`qrCam${sfx}`), $(`linkCam${sfx}`).textContent);
    });
    const mi = $('micId');
    if (mi) {
        mi.oninput = () => { form.mic.id = mi.value.trim(); $('linkMic').textContent = src.phonePushUrl(form.mic.id || 'x', { video: false }); renderQr($('qrMic'), $('linkMic').textContent); store.set('cfg', form); };
        renderQr($('qrMic'), $('linkMic').textContent);
    }
    bindCopy(box);
}

function refreshSetup(rerenderLinks = true) {
    $('micSelect').disabled = form.mic.src !== 'local';
    const cam1Phone = form.cams[0] && form.cams[0].src === 'phone';
    $('micSrc').querySelector('option[value=cam]').disabled = !cam1Phone;
    if (!cam1Phone && form.mic.src === 'cam') { form.mic.src = 'local'; $('micSrc').value = 'local'; $('micSelect').disabled = false; }
    if (rerenderLinks) renderPhoneLinks();
    store.set('cfg', form);
}

async function openSetup() {
    $('setup').classList.add('open');
    devices = await src.listDevices();
    const sel = $('micSelect');
    sel.innerHTML = devices.audio.map((d, i) => `<option value="${esc(d.deviceId)}">${esc(d.label || `Microphone ${i + 1}`)}</option>`).join('') || '<option value="">default microphone</option>';
    if (form.mic.device) sel.value = form.mic.device;
    $('micSrc').value = form.mic.src;
    $('matchRef').value = host.matchId || form.match || '';
    renderCamRows();
    refreshSetup();
}

/** Link the match an umpire phone was opened from (it's the match being scored). */
async function adoptMatch(id, api) {
    if (api && /^https:\/\//.test(api)) host.api = String(api).replace(/\/$/, '');
    $('matchRef').value = id;
    host.setMatch(id);                       // verdicts go there at once…
    linkMatch(id).then(() => status(`Linked to the umpire's match: ${app.matchTitle || id}`)).catch(() => { });   // …title loads in the background
}

async function linkMatch(ref) {
    host.setMatch(ref);
    form.match = host.matchId;
    store.set('cfg', form);
    app.matchTitle = '';
    const info = $('matchInfo');
    const banner = $('cvBanner');
    if (!host.matchId) {
        info.textContent = 'Link a match to save every verdict to its scorecard. Umpire phones on that match then see and control this screen.';
        if (banner) banner.remove();
        renderUmpire(); schedulePush();
        return;
    }
    info.textContent = 'Looking up the match…';
    try {
        const m = await host.matchInfo();
        app.matchTitle = m.title;
        info.innerHTML = `✓ <b>${esc(m.title)}</b> ${esc(m.score)} — verdicts are saved to this match and its umpires can open this screen from the app.`;
    } catch (err) {
        info.textContent = `⚠ Could not load that match (${err.message}). Verdicts will still be sent to it.`;
    }
    let b = $('cvBanner');
    if (!b) { b = document.createElement('div'); b.id = 'cvBanner'; b.className = 'cv-banner'; document.querySelector('.top').after(b); }
    b.textContent = `CrickVision · ${app.matchTitle || host.matchId} · verdicts are saved to this match`;
    renderUmpire(); schedulePush();
}

function bindCopy(root = document) {
    root.querySelectorAll('[data-copy]').forEach(b => b.onclick = () => {
        navigator.clipboard?.writeText($(b.dataset.copy).textContent).then(() => { b.textContent = 'Copied'; setTimeout(() => b.textContent = 'Copy', 1200); });
    });
}

function init() {
    $('btnAddCam').onclick = () => {
        if (form.cams.length >= MAX_CAMS) return;
        form.cams.push({ name: CAM_NAMES[form.cams.length], src: 'phone', id: src.randomStreamId(), device: '' });
        renderCamRows(); refreshSetup();
    };
    $('micSrc').onchange = (e) => { form.mic.src = e.target.value; refreshSetup(); };
    $('micSelect').onchange = (e) => { form.mic.device = e.target.value; refreshSetup(false); };
    $('matchRef').onchange = (e) => linkMatch(e.target.value);
    bindCopy();
    $('btnSetup').onclick = openSetup;
    $('btnSetup2').onclick = openSetup;
    $('setupClose').onclick = () => $('setup').classList.remove('open');
    $('btnStart').onclick = async () => {
        const b = $('btnStart'); b.disabled = true;
        try {
            if (($('matchRef').value || '') !== (host.matchId || '')) await linkMatch($('matchRef').value);
            await startLive(cfgFromForm());
            $('setup').classList.remove('open');
        } catch (err) {
            console.error(err);
            $('setupMsg').textContent = '⚠ ' + err.message;
            status('Start failed: ' + err.message);
            await stopAll();
        } finally { b.disabled = false; }
    };
    $('btnStop').onclick = () => { stopAll(); status('Stopped.'); };
    $('btnReviewLast').onclick = reviewLast;
    $('btnUmpire').onclick = () => { $('umpireSheet').classList.add('open'); renderUmpire(); };
    $('umpireClose').onclick = () => $('umpireSheet').classList.remove('open');
    $('btnUmpireToggle').onclick = async () => {
        const b = $('btnUmpireToggle'); b.disabled = true;
        try { if (broadcast.live) broadcast.stop(); else await startUmpire(); }
        catch (err) { $('umpireState').textContent = '⚠ ' + err.message; }
        finally { b.disabled = false; renderUmpire(); }
    };
    $('sens').oninput = (e) => {
        const v = +e.target.value; $('sensVal').textContent = v;
        app.engine.setParams({ sensitivity: v }); store.set('sens', v); schedulePush();
    };
    $('sens').value = store.get('sens', 85); $('sensVal').textContent = $('sens').value;
    $('autoReview').checked = store.get('autoReview', false);
    $('autoReview').onchange = (e) => { store.set('autoReview', e.target.checked); schedulePush(); };
    $('ignoreVoice').checked = store.get('voiceFilter', true);
    $('ignoreVoice').onchange = (e) => {
        app.engine.setParams({ voiceFilter: e.target.checked }); store.set('voiceFilter', e.target.checked); schedulePush();
    };
    $('listen').onchange = (e) => app.engine.setMonitor(e.target.checked);
    $('btnClear').onclick = () => { app.deliveries = []; app.liveHits = []; renderHits(); };
    $('btnExportLog').onclick = () => {
        const log = app.deliveries.map(d => ({
            kind: d.kind, time: d.kind === 'file' ? d.firstT / 1000 : d.wall.toISOString(), verdict: d.verdict || null, manual: !!d.manual,
            spikes: d.hits.map(({ snrDb, peakDb, riseDb, decayMs, freqHz, score, t, perf }) => ({ snrDb, peakDb, riseDb, decayMs, freqHz, score, ms: t ?? perf })),
        }));
        download(new Blob([JSON.stringify({ exported: new Date().toISOString(), match: host.matchId || null, offsets: app.offsets, deliveries: log }, null, 2)], { type: 'application/json' }), `ultraedge-log-${Date.now()}.json`);
    };
    $('btnFile').onclick = () => $('fileInput').click();
    $('fileInput').onchange = (e) => { const f = e.target.files[0]; if (f) analyseFile(f); e.target.value = ''; };
    let dragN = 0;
    window.addEventListener('dragenter', (e) => { e.preventDefault(); dragN++; $('drop').classList.add('on'); });
    window.addEventListener('dragleave', () => { if (--dragN <= 0) { dragN = 0; $('drop').classList.remove('on'); } });
    window.addEventListener('dragover', (e) => e.preventDefault());
    window.addEventListener('drop', (e) => { e.preventDefault(); dragN = 0; $('drop').classList.remove('on'); const f = e.dataTransfer.files[0]; if (f) analyseFile(f); });
    window.addEventListener('keydown', (e) => {
        if (review.isOpen || e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return;
        if (e.key === 'r' || e.key === 'R') reviewLast();
        else if (e.key >= '1' && e.key <= '4') setLayout(+e.key - 1 === app.liveLayout ? -1 : +e.key - 1);
        else if (e.key === '0') setLayout(-1);
    });
    if (!window.isSecureContext) status('⚠ Open this page via http://localhost (or https) — browsers block camera/mic on other origins.');
    renderHits();
    renderUmpire();
    // a match from the link (?matchId=…) or the last session
    const m = new URLSearchParams(location.search).get('matchId') || form.match;
    if (m) linkMatch(m);
}
init();
