/**
 * UltraEdge 3 — app controller.
 *
 *   phone/computer camera ──► <video> ──► FrameBuffer (timestamped JPEG frames)
 *   stump mic (phone/USB) ──► AudioEngine ──► worklet: EdgeDetector + PCM ring buffer
 *                                   │
 *                                spike ──► delivery ──► ReviewPlayer (frame-by-frame + trace)
 */
import { AudioEngine } from './audio-engine.js';
import { FrameBuffer } from './frame-buffer.js';
import { ReviewPlayer, BlobFrameSource, VideoFrameSource, download } from './review.js';
import { drawTrace, drawGrid, COLORS } from './waveform.js';
import { EdgeDetector } from './edge-detector.js';
import * as src from './sources.js';

const $ = (id) => document.getElementById(id);
const store = {
    get(k, d) { try { const v = localStorage.getItem('ue.' + k); return v === null ? d : JSON.parse(v); } catch { return d; } },
    set(k, v) { try { localStorage.setItem('ue.' + k, JSON.stringify(v)); } catch { } },
};

const PRE_MS = 1500, POST_MS = 700, GROUP_MS = 1500;

const app = {
    engine: new AudioEngine({ seconds: 60, params: { sensitivity: store.get('sens', 85) } }),
    frames: new FrameBuffer({ seconds: 20, maxWidth: 960 }),
    receivers: [],
    streams: [],
    keepAlive: [],
    running: false,
    deliveries: [],
    liveHits: [],
    offsets: { live: store.get('offsetLive', 0), file: store.get('offsetFile', 0) },
    scopeGain: 8,
};
window.ultraedge = app; // handy for debugging from the console

// ---------------------------------------------------------------------------
// Review player
// ---------------------------------------------------------------------------
const review = new ReviewPlayer($('review'), {
    onOffsetChange: (ms) => {
        const kind = review.session?.kind || 'live';
        app.offsets[kind] = ms;
        store.set(kind === 'file' ? 'offsetFile' : 'offsetLive', ms);
        status(`A/V sync offset (${kind}) set to ${ms} ms`);
    },
    onVerdict: (session) => { const d = app.deliveries.find(d => d.session === session || d.id === session.deliveryId); if (d) { d.verdict = session.verdict; renderHits(); } },
});

window.ultraedgeReview = review;
// Coming back from a replay: make sure the live picture is running again
review.onClose = () => {
    const v = $('liveVideo');
    if (app.running && v.srcObject && v.paused) v.play().catch(() => { });
};

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
function status(msg) { $('status').textContent = msg; }

function setState(label, on) {
    $('pillState').classList.toggle('on', on);
    $('pillState').querySelector('span').textContent = label;
}

async function stopAll() {
    app.running = false;
    app.frames.detach();
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
}

async function startLive(cfg) {
    await stopAll();
    const msg = (m) => { $('setupMsg').textContent = m; status(m); };
    let videoStream = null, audioStream = null;

    const receiver = (id, opts) => {
        const r = new src.NinjaReceiver();
        r.onStatus = (s) => msg(`Phone ${id}: ${s}`);
        app.receivers.push(r);
        return r.connect(id, opts);
    };

    if (cfg.vsrc === 'phone') {
        const wantAudio = cfg.asrc === 'same';
        videoStream = await receiver(cfg.camId, { video: true, audio: wantAudio });
        if (wantAudio) audioStream = new MediaStream(videoStream.getAudioTracks());
    } else if (cfg.vsrc === 'local') {
        msg('Opening camera…');
        videoStream = await src.openLocalCamera(cfg.camDevice);
        app.streams.push(videoStream);
    }

    if (!audioStream) {
        if (cfg.asrc === 'phone2') {
            audioStream = await receiver(cfg.micId, { video: false, audio: true });
        } else {
            // 'local', or 'same' with a local/no camera → computer microphone
            msg('Opening microphone…');
            audioStream = await src.openLocalMic(cfg.asrc === 'local' ? cfg.micDevice : undefined);
            app.streams.push(audioStream);
        }
    }
    if (!audioStream || !audioStream.getAudioTracks().length) throw new Error('No audio track — UltraEdge needs a microphone.');

    // Chrome only feeds remote WebRTC audio into Web Audio if it is also attached to a media element
    if (app.receivers.length) {
        const a = new Audio(); a.muted = true; a.srcObject = audioStream; a.play().catch(() => { });
        app.keepAlive.push(a);
    }

    if (videoStream && videoStream.getVideoTracks().length) {
        const v = $('liveVideo');
        v.srcObject = new MediaStream(videoStream.getVideoTracks());
        await v.play().catch(() => { });
        app.frames.clear();
        app.frames.attach(v);
        $('videoEmpty').classList.add('hide');
        $('liveBadge').classList.add('on');
    } else {
        $('videoEmpty').classList.add('hide');
    }

    await app.engine.start(audioStream);
    app.engine.onHit = onHit;
    app.engine.setMonitor($('listen').checked);
    app.running = true;
    app.cfg = cfg;
    $('btnReviewLast').disabled = false;
    $('btnStop').hidden = false;
    setState('LIVE', true);
    msg(`Live. Audio ${app.engine.sampleRate} Hz` + (videoStream ? '' : ' (no camera)'));
}

function onHit(h) {
    app.liveHits.push(h);
    if (app.liveHits.length > 500) app.liveHits.shift();
    const f = $('spikeFlash'); f.classList.add('on'); setTimeout(() => f.classList.remove('on'), 120);

    let d = app.deliveries[0];
    if (!d || d.kind !== 'live' || d.session || h.perf - d.lastPerf > GROUP_MS) {
        d = { id: 'd' + Date.now(), kind: 'live', hits: [], firstPerf: h.perf, lastPerf: h.perf, wall: new Date(), session: null, verdict: null };
        app.deliveries.unshift(d);
        if (app.deliveries.length > 40) { const old = app.deliveries.pop(); old.session?.frames.dispose?.(); if (old.thumb) URL.revokeObjectURL(old.thumb); }
    }
    d.hits.push(h);
    d.lastPerf = h.perf;
    clearTimeout(d.timer);
    d.timer = setTimeout(() => finalizeDelivery(d), POST_MS + 300);
    renderHits();
}

/** Build a review session from the live buffers for [t0, t1] (audio clock, ms). */
function buildLiveSession(t0, t1, hits, title) {
    const e = app.engine, off = app.offsets.live;
    const f0 = Math.max(0, e.fromPerf(t0 - 400)), f1 = Math.min(e.latestFrame, e.fromPerf(t1 + 400));
    const raw = e.getRange(f0, f1, 'raw'), hp = e.getRange(f0, f1, 'hp');
    const vf = app.frames.slice(t0 + off - 40, t1 + off + 40);
    const frames = vf.length >= 2 ? new BlobFrameSource(vf) : new BlankFrameSource(t0 + off, t1 + off);
    return {
        kind: 'live', title, fs: e.sampleRate, raw, hp, audioT0: e.toPerf(f0), frames,
        hits: hits.map(h => ({ ...h, t: h.perf })), focusT: hits.length ? hits[0].perf + off : undefined,
    };
}

function finalizeDelivery(d) {
    const s = buildLiveSession(d.firstPerf - PRE_MS, d.lastPerf + POST_MS, d.hits, `SPIKE · ${d.wall.toLocaleTimeString()}`);
    s.deliveryId = d.id;
    d.session = s;
    if (s.frames instanceof BlobFrameSource) {
        const fr = s.frames.frames[s.frames.indexAt(d.firstPerf + app.offsets.live)];
        if (fr && fr.blob) d.thumb = URL.createObjectURL(fr.blob);
    }
    renderHits();
    if ($('autoReview').checked && !review.isOpen) review.open(s, app.offsets.live);
}

function reviewLast() {
    if (!app.running) return;
    const e = app.engine;
    const audioEnd = e.toPerf(e.latestFrame);
    const videoEnd = app.frames.frames.length ? app.frames.latestTime - app.offsets.live : audioEnd;
    const t1 = Math.min(audioEnd, videoEnd) - 30, t0 = t1 - 3000;
    const hits = app.liveHits.filter(h => h.perf >= t0 && h.perf <= t1);
    const s = buildLiveSession(t0, t1, hits, 'MANUAL REVIEW · LAST 3 s');
    if (!hits.length) s.focusT = t1 + app.offsets.live - 500;
    const d = { id: 'm' + Date.now(), kind: 'live', hits, firstPerf: t0, lastPerf: t1, wall: new Date(), session: s, manual: true };
    s.deliveryId = d.id;
    if (s.frames instanceof BlobFrameSource) { const fr = s.frames.frames[s.frames.indexAt(s.focusT ?? t1)]; if (fr?.blob) d.thumb = URL.createObjectURL(fr.blob); }
    app.deliveries.unshift(d);
    renderHits();
    review.open(s, app.offsets.live);
}

// ---------------------------------------------------------------------------
// Deliveries list
// ---------------------------------------------------------------------------
function renderHits() {
    const box = $('hits');
    if (!app.deliveries.length) { box.innerHTML = '<p class="muted small pad">Spikes appear here. Click one to open the frame-by-frame UltraEdge replay.</p>'; return; }
    box.innerHTML = '';
    for (const d of app.deliveries) {
        const el = document.createElement('div');
        el.className = 'hit' + (d.session ? '' : ' pending');
        const best = d.hits.reduce((b, h) => (!b || h.snrDb > b.snrDb) ? h : b, null);
        const when = d.kind === 'file' ? `${(d.firstT / 1000).toFixed(2)} s` : d.wall.toLocaleTimeString();
        const v = d.verdict ? `<span class="v ${d.verdict === 'EDGE' ? 'EDGE' : 'NO'}">${d.verdict}</span>` : `<span>${d.manual ? 'manual' : (best ? best.snrDb + ' dB' : '')}</span>`;
        el.innerHTML = (d.thumb ? `<img src="${d.thumb}" alt="">` : `<div class="noimg"></div>`) +
            `<div class="meta"><span>${when}${d.hits.length > 1 ? ` ×${d.hits.length}` : ''}</span>${v}</div>`;
        el.onclick = () => openDelivery(d);
        box.appendChild(el);
    }
}

function openDelivery(d) {
    if (d.kind === 'file') { app.fileSession.focusT = d.firstT + app.offsets.file; app.fileSession.deliveryId = d.id; app.fileSession.verdict = d.verdict; review.open(app.fileSession, app.offsets.file); return; }
    if (!d.session) { clearTimeout(d.timer); finalizeDelivery(d); }
    review.open(d.session, app.offsets.live);
}

// ---------------------------------------------------------------------------
// Live scope
// ---------------------------------------------------------------------------
const scope = $('scope'), sctx = scope.getContext('2d');
function drawScope() {
    requestAnimationFrame(drawScope);
    const W = scope.width, H = scope.height, e = app.engine;
    const rect = { x: 0, y: 0, w: W, h: H };
    if (!app.running || e.latestFrame < 0) {
        drawGrid(sctx, rect, 0, 2000, { stepMs: 100 });
        sctx.fillStyle = COLORS.text; sctx.font = '16px Inter, sans-serif'; sctx.textAlign = 'center';
        sctx.fillText(app.running ? 'waiting for audio…' : 'not running', W / 2, H / 2 - 12); sctx.textAlign = 'left';
        return;
    }
    const fs = e.sampleRate, end = e.latestFrame, start = end - Math.round(fs * 2);
    const data = e.getRange(start, end, $('scopeHp').checked ? 'hp' : 'raw');
    let pk = 0; for (let i = 0; i < data.length; i += 4) { const a = Math.abs(data[i]); if (a > pk) pk = a; }
    const target = 0.85 / Math.max(pk, 0.004);
    app.scopeGain = target < app.scopeGain ? target : app.scopeGain + (target - app.scopeGain) * 0.01;
    const t0 = e.toPerf(start), t1 = e.toPerf(end);
    drawGrid(sctx, rect, t0, t1, { stepMs: 100 });
    drawTrace(sctx, rect, data, fs, t0, t0, t1, { gain: app.scopeGain });
    sctx.fillStyle = COLORS.hit;
    for (const h of app.liveHits) {
        if (h.frame < start) continue;
        const x = (h.frame - start) / (end - start) * W;
        sctx.fillRect(x - 1, 0, 3, H);
    }
    const db = 20 * Math.log10(Math.max(e.level, 1e-5));
    $('meterFill').style.width = `${Math.max(0, Math.min(100, (db + 60) / 60 * 100))}%`;
}
requestAnimationFrame(drawScope);

// Video health: tell the user *why* the picture looks empty (phone slept, lens covered, too dark…)
const lumaCanvas = document.createElement('canvas'); lumaCanvas.width = 32; lumaCanvas.height = 18;
const lumaCtx = lumaCanvas.getContext('2d', { willReadFrequently: true });
let lastFrameCount = 0, stalledSince = 0;
setInterval(() => {
    const v = $('liveVideo'), warn = $('videoWarn');
    let msg = '';
    if (app.running && v.srcObject) {
        const track = v.srcObject.getVideoTracks()[0];
        const n = app.frames.frames.length ? app.frames.latestTime : 0;
        const stalled = n === lastFrameCount;
        lastFrameCount = n;
        stalledSince = stalled ? (stalledSince || performance.now()) : 0;
        if (v.paused) v.play().catch(() => { });
        if (track && track.readyState === 'ended') msg = 'Camera feed ended — reconnect in Setup sources.';
        else if ((track && track.muted) || (stalledSince && performance.now() - stalledSince > 1500))
            msg = 'NO VIDEO SIGNAL — is the camera phone locked, asleep or showing another app? Keep the VDO.ninja page open with the screen on.';
        else if (v.videoWidth) {
            try {
                lumaCtx.drawImage(v, 0, 0, 32, 18);
                const px = lumaCtx.getImageData(0, 0, 32, 18).data;
                let sum = 0; for (let i = 0; i < px.length; i += 4) sum += 0.2126 * px[i] + 0.7152 * px[i + 1] + 0.0722 * px[i + 2];
                const luma = sum / (px.length / 4);
                if (luma < 22) msg = `Picture is very dark (brightness ${luma.toFixed(0)}/255) — lens covered, pointing at the ground, or too little light?`;
            } catch { }
            if (!msg && v.videoHeight > v.videoWidth) msg = 'Portrait video — turn the camera phone sideways (landscape) for a side-on view of the bat.';
        }
    }
    warn.textContent = msg;
    warn.classList.toggle('on', !!msg);
}, 1000);

setInterval(() => {
    const v = $('liveVideo'), fb = app.frames;
    if (app.running && v.videoWidth) {
        $('pillVideo').textContent = `VIDEO ${v.videoWidth}×${v.videoHeight} · ${fb.fps} fps`;
        $('videoInfo').textContent = `${v.videoWidth}×${v.videoHeight} @ ${fb.fps} fps · ${fb.memoryMB.toFixed(0)} MB buffered`;
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
        const det = new EdgeDetector(fs, { sensitivity: +$('sens').value });
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
// Setup modal
// ---------------------------------------------------------------------------
function cfgFromForm() {
    return {
        vsrc: document.querySelector('input[name=vsrc]:checked').value,
        asrc: document.querySelector('input[name=asrc]:checked').value,
        camDevice: $('camSelect').value || undefined,
        micDevice: $('micSelect').value || undefined,
        camId: $('camId').value.trim(),
        micId: $('micId').value.trim(),
    };
}

function renderQr(el, url) {
    if (typeof qrcode === 'undefined') { el.innerHTML = '<span class="muted small">(QR library offline — copy the link)</span>'; return; }
    const q = qrcode(0, 'M'); q.addData(url); q.make();
    el.innerHTML = q.createSvgTag({ cellSize: 4, margin: 2, scalable: true });
}

function refreshSetup() {
    const c = cfgFromForm();
    const camPhone = c.vsrc === 'phone';
    const micPhone = c.asrc === 'phone2';
    $('phoneCam').classList.toggle('hide', !camPhone);
    $('phoneMic').classList.toggle('hide', !micPhone);
    $('phoneCol').style.opacity = camPhone || micPhone ? 1 : 0.35;
    $('camSelect').disabled = c.vsrc !== 'local';
    $('micSelect').disabled = c.asrc !== 'local';
    const lc = src.phonePushUrl(c.camId || 'x', { video: true });
    const lm = src.phonePushUrl(c.micId || 'x', { video: false });
    $('linkCam').textContent = lc; $('linkMic').textContent = lm;
    if (camPhone) renderQr($('qrCam'), lc);
    if (micPhone) renderQr($('qrMic'), lm);
    store.set('cfg', c);
}

async function openSetup() {
    $('setup').classList.add('open');
    const devs = await src.listDevices();
    const fill = (sel, list, kind) => {
        const prev = sel.value;
        sel.innerHTML = list.map((d, i) => `<option value="${d.deviceId}">${d.label || `${kind} ${i + 1}`}</option>`).join('') || `<option value="">default ${kind.toLowerCase()}</option>`;
        if (prev) sel.value = prev;
    };
    fill($('camSelect'), devs.video, 'Camera');
    fill($('micSelect'), devs.audio, 'Microphone');
    const c = store.get('cfg', null);
    if (c) {
        document.querySelector(`input[name=vsrc][value=${c.vsrc}]`)?.click();
        document.querySelector(`input[name=asrc][value=${c.asrc}]`)?.click();
        if (c.camDevice) $('camSelect').value = c.camDevice;
        if (c.micDevice) $('micSelect').value = c.micDevice;
    }
    refreshSetup();
}

function init() {
    $('camId').value = store.get('cfg', {})?.camId || src.randomStreamId();
    $('micId').value = store.get('cfg', {})?.micId || src.randomStreamId();
    document.querySelectorAll('input[name=vsrc], input[name=asrc]').forEach(r => r.addEventListener('change', refreshSetup));
    $('camId').addEventListener('input', refreshSetup);
    $('micId').addEventListener('input', refreshSetup);
    $('camSelect').addEventListener('change', refreshSetup);
    $('micSelect').addEventListener('change', refreshSetup);
    document.querySelectorAll('[data-copy]').forEach(b => b.onclick = () => {
        navigator.clipboard?.writeText($(b.dataset.copy).textContent).then(() => { b.textContent = 'Copied'; setTimeout(() => b.textContent = 'Copy', 1200); });
    });
    $('btnSetup').onclick = openSetup;
    $('btnSetup2').onclick = openSetup;
    $('setupClose').onclick = () => $('setup').classList.remove('open');
    $('btnStart').onclick = async () => {
        const b = $('btnStart'); b.disabled = true;
        try {
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
    $('sens').oninput = (e) => {
        const v = +e.target.value; $('sensVal').textContent = v;
        app.engine.setParams({ sensitivity: v }); store.set('sens', v);
    };
    $('sens').value = store.get('sens', 85); $('sensVal').textContent = $('sens').value;
    $('autoReview').checked = store.get('autoReview', false);
    $('autoReview').onchange = (e) => store.set('autoReview', e.target.checked);
    $('listen').onchange = (e) => app.engine.setMonitor(e.target.checked);
    $('btnClear').onclick = () => { app.deliveries = []; app.liveHits = []; renderHits(); };
    $('btnExportLog').onclick = () => {
        const log = app.deliveries.map(d => ({
            kind: d.kind, time: d.kind === 'file' ? d.firstT / 1000 : d.wall.toISOString(), verdict: d.verdict || null, manual: !!d.manual,
            spikes: d.hits.map(({ snrDb, peakDb, riseDb, decayMs, freqHz, score, t, perf }) => ({ snrDb, peakDb, riseDb, decayMs, freqHz, score, ms: t ?? perf })),
        }));
        download(new Blob([JSON.stringify({ exported: new Date().toISOString(), offsets: app.offsets, deliveries: log }, null, 2)], { type: 'application/json' }), `ultraedge-log-${Date.now()}.json`);
    };
    $('btnFile').onclick = () => $('fileInput').click();
    $('fileInput').onchange = (e) => { const f = e.target.files[0]; if (f) analyseFile(f); e.target.value = ''; };
    let dragN = 0;
    window.addEventListener('dragenter', (e) => { e.preventDefault(); dragN++; $('drop').classList.add('on'); });
    window.addEventListener('dragleave', () => { if (--dragN <= 0) { dragN = 0; $('drop').classList.remove('on'); } });
    window.addEventListener('dragover', (e) => e.preventDefault());
    window.addEventListener('drop', (e) => { e.preventDefault(); dragN = 0; $('drop').classList.remove('on'); const f = e.dataTransfer.files[0]; if (f) analyseFile(f); });
    window.addEventListener('keydown', (e) => {
        if (review.isOpen || e.target.tagName === 'INPUT') return;
        if (e.key === 'r' || e.key === 'R') reviewLast();
    });
    if (!window.isSecureContext) status('⚠ Open this page via http://localhost (or https) — browsers block camera/mic on other origins.');
    renderHits();
}
init();
