/**
 * UltraEdge umpire remote (phone / CrickVision app).
 *
 * Watches the laptop's UltraEdge screen live and drives it: the laptop stays the source of truth
 * (cameras, stump mic, detection, replay buffers); this page only shows its picture and sends commands.
 *
 *   remote.html?matchId=<CrickVision match>[&api=…][&over=12.3&innings=1&batterId=…&bowlerId=…]
 *   remote.html?studio=<session key shown on the laptop>
 */
import { RemoteLink, studioStreamId } from './link.js';
import { host } from './host-bridge.js';

const $ = (id) => document.getElementById(id);
const q = new URLSearchParams(location.search);
const key = host.matchId || q.get('studio') || '';
const esc = (t) => String(t ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const ui = { state: null, link: null, connecting: false, retry: null, awaitingVerdict: null, lastStateAt: 0 };
window.ultraedgeRemote = ui;

// ---------------------------------------------------------------------------
// connection
// ---------------------------------------------------------------------------
function setConn(on, text) {
    $('conn').classList.toggle('on', on);
    $('conn').querySelector('span').textContent = text;
}

function overlay(msg, hint = '') {
    $('overlay').classList.toggle('hide', !msg);
    if (msg) { $('overlayMsg').textContent = msg; $('overlayHint').textContent = hint; }
}

async function connect() {
    if (ui.connecting) return;
    if (!key) {
        overlay('No UltraEdge session', 'Open this page from the CrickVision app (scoring screen → UltraEdge) or scan the code on the UltraEdge laptop.');
        setConn(false, 'no session');
        return;
    }
    ui.connecting = true;
    clearTimeout(ui.retry);
    if (ui.link) ui.link.disconnect();
    const link = (ui.link = new RemoteLink());
    link.addEventListener('state', (e) => { ui.lastStateAt = Date.now(); render(e.detail); });
    link.addEventListener('event', (e) => onEvent(e.detail));
    link.addEventListener('open', () => link.command('hello'));
    link.addEventListener('status', () => { if (ui.link === link) lost(); });
    setConn(false, 'connecting');
    overlay(ui.state ? 'Reconnecting to the UltraEdge laptop…' : 'Connecting to the UltraEdge laptop…',
        host.matchId ? 'The laptop must have UltraEdge open with this match linked.' : '');
    try {
        const stream = await link.connect(studioStreamId(key), { timeoutMs: 25000 });
        if (ui.link !== link) return;
        const v = $('program');
        v.srcObject = stream;
        v.play().catch(() => { });
        overlay('');
        setConn(true, 'live');
        $('btnSound').hidden = !v.muted;
        link.command('hello');
    } catch (err) {
        if (ui.link !== link) return;
        link.disconnect();
        setConn(false, 'waiting');
        overlay('Waiting for the UltraEdge laptop…', 'On the laptop: open UltraEdge, link this match (Setup sources → CrickVision match) and press Connect & start. This screen connects by itself.');
        ui.retry = setTimeout(connect, 4000);
    } finally { ui.connecting = false; }
}

function lost() {
    setConn(false, 'reconnecting');
    clearTimeout(ui.retry);
    ui.retry = setTimeout(connect, 1500);
}

// the studio sends its state every 2 s; silence means the laptop went away
setInterval(() => {
    if (ui.link && ui.link.connected && ui.lastStateAt && Date.now() - ui.lastStateAt > 9000) { ui.lastStateAt = 0; lost(); }
}, 3000);

function cmd(name, args) {
    if (!ui.link || !ui.link.command(name, args)) toast('Not connected to the laptop');
}

// ---------------------------------------------------------------------------
// rendering the studio state
// ---------------------------------------------------------------------------
function render(s) {
    ui.state = s;
    const rv = s.review || { open: false };
    $('title').textContent = s.match || (host.label ? host.label : 'Umpire view');
    $('livePanel').hidden = rv.open;
    $('reviewPanel').hidden = !rv.open;

    // live
    $('btnReviewLast').disabled = !s.running;
    $('btnReviewLast').textContent = s.running ? 'REVIEW LAST 3 s' : 'LAPTOP NOT RECORDING';
    const cams = s.cams || [];
    $('camChips').innerHTML = cams.length > 1
        ? [`<button data-k="-1" class="${s.layout < 0 ? 'on' : ''}">All cameras</button>`]
            .concat(cams.map((n, k) => `<button data-k="${k}" class="${s.layout === k ? 'on' : ''}">${k + 1} · ${esc(n)}</button>`)).join('')
        : '';
    $('camChips').querySelectorAll('button').forEach(b => b.onclick = () => cmd('layout', { k: +b.dataset.k }));
    const ds = s.deliveries || [];
    $('deliveries').innerHTML = ds.length
        ? ds.map(d => `<button data-id="${esc(d.id)}" ${d.ready ? '' : 'disabled'}><span>${esc(d.when)}${d.n > 1 ? ` ×${d.n}` : ''}${d.manual ? ' · manual' : ''}</span>` +
            (d.verdict ? `<span class="v ${d.verdict === 'EDGE' ? 'EDGE' : 'NO'}">${esc(d.verdict)}</span>` : `<span class="muted small">${d.snr != null ? d.snr + ' dB' : ''}</span>`) + '</button>').join('')
        : '<p class="muted small">Spikes from the stump mic appear here. Tap one to review it.</p>';
    $('deliveries').querySelectorAll('button[data-id]').forEach(b => b.onclick = () => cmd('open', { id: b.dataset.id }));
    if (document.activeElement !== $('sens')) { $('sens').value = s.sens; $('sensVal').textContent = s.sens; }
    $('autoReview').checked = !!s.autoReview;

    // review
    if (rv.open) {
        $('rvTitle').textContent = rv.title || 'REVIEW';
        $('rvFrame').textContent = `Frame ${rv.frame}/${rv.count} · ${rv.fps} fps`;
        const angles = rv.angles || [];
        $('angleChips').innerHTML = angles.length > 1
            ? angles.map((n, k) => `<button data-k="${k}" class="${!rv.grid && rv.angle === k ? 'on' : ''}">${k + 1} · ${esc(n)}</button>`).join('') + `<button data-grid="1" class="${rv.grid ? 'on' : ''}">Grid</button>`
            : '';
        $('angleChips').querySelectorAll('button[data-k]').forEach(b => b.onclick = () => cmd('angle', { k: +b.dataset.k }));
        const g = $('angleChips').querySelector('[data-grid]'); if (g) g.onclick = () => cmd('grid', { on: !rv.grid });
        $('rvPlay').textContent = rv.playing ? '❚❚' : '▶';
        $('rvSpeed').value = String(rv.speed);
        if (document.activeElement !== $('rvZoom')) { $('rvZoom').value = rv.windowMs; $('rvZoomVal').textContent = `${rv.windowMs} ms`; }
        $('rvInfo').textContent = rv.info || '';
        $('rvEdge').classList.toggle('chosen', rv.verdict === 'EDGE');
        $('rvNoEdge').classList.toggle('chosen', rv.verdict === 'NO EDGE');
        $('rvSoundTog').checked = !!rv.sound;
        $('rvHp').checked = !!rv.hp;
        if (document.activeElement !== $('rvOffset')) { $('rvOffset').value = rv.offsetMs; $('rvOffsetVal').textContent = `${rv.offsetMs >= 0 ? '+' : ''}${rv.offsetMs} ms`; }
        $('rvHit').disabled = !rv.hits;
    } else {
        $('rvSaved').textContent = ''; $('rvSaved').className = 'saved';
    }
}

function onEvent(m) {
    if (m.type !== 'verdict') return;
    const mine = ui.awaitingVerdict && Date.now() - ui.awaitingVerdict < 20000;
    ui.awaitingVerdict = null;
    const el = $('rvSaved');
    let text;
    if (m.saved) text = `✓ ${m.verdict === 'EDGE' ? 'EDGE' : 'NO EDGE'} saved for ball ${m.review?.overLabel || '—'}`;
    else if (m.local) text = `${m.verdict} (not linked to a CrickVision match, so it isn't saved)`;
    else text = `⚠ Verdict not saved: ${m.error || 'unknown error'}`;
    el.textContent = text;
    el.className = 'saved ' + (m.saved ? 'ok' : 'err');
    if (mine || m.saved) toast(text);
    // tell the CrickVision app (Android WebView) — same message the app already understands
    host.notify({ type: 'ultraedge:verdict', verdict: m.verdict, saved: !!m.saved, review: m.review || null, error: m.error || null, matchId: m.matchId || host.matchId || null, spikes: m.spikes || [] });
}

let toastTimer = null;
function toast(text) {
    const t = $('toast'); t.textContent = text; t.classList.add('on');
    clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('on'), 2600);
}

// ---------------------------------------------------------------------------
// controls
// ---------------------------------------------------------------------------
function bind() {
    $('btnReviewLast').onclick = () => cmd('reviewLast');
    $('sens').oninput = (e) => { $('sensVal').textContent = e.target.value; };
    $('sens').onchange = (e) => cmd('sens', { v: +e.target.value });
    $('autoReview').onchange = (e) => cmd('auto', { on: e.target.checked });
    $('rvPrev').onclick = () => cmd('step', { n: -1 });
    $('rvNext').onclick = () => cmd('step', { n: 1 });
    $('rvBack5').onclick = () => cmd('step', { n: -5 });
    $('rvFwd5').onclick = () => cmd('step', { n: 5 });
    $('rvPlay').onclick = () => cmd('toggle');
    $('rvHit').onclick = () => cmd('hit', { dir: 1 });
    $('rvSpeed').onchange = (e) => cmd('speed', { v: +e.target.value });
    $('rvZoom').oninput = (e) => { $('rvZoomVal').textContent = `${e.target.value} ms`; };
    $('rvZoom').onchange = (e) => cmd('window', { v: +e.target.value });
    $('rvSoundTog').onchange = (e) => cmd('sound', { on: e.target.checked });
    $('rvHp').onchange = (e) => cmd('hp', { on: e.target.checked });
    $('rvOffset').oninput = (e) => { const v = +e.target.value; $('rvOffsetVal').textContent = `${v >= 0 ? '+' : ''}${v} ms`; };
    $('rvOffset').onchange = (e) => cmd('offset', { ms: +e.target.value });
    $('rvSyncHere').onclick = () => cmd('syncHere');
    $('rvClose').onclick = () => cmd('close');
    const verdict = (v) => {
        ui.awaitingVerdict = Date.now();
        $('rvSaved').textContent = host.matchId ? 'Saving…' : ''; $('rvSaved').className = 'saved';
        cmd('verdict', { v, ball: host.ball.over || host.ball.inningsNumber ? host.ball : null });
    };
    $('rvEdge').onclick = () => verdict('EDGE');
    $('rvNoEdge').onclick = () => verdict('NO EDGE');
    const v = $('program');
    $('btnSound').onclick = () => { v.muted = false; v.play().catch(() => { }); $('btnSound').hidden = true; };
    v.addEventListener('volumechange', () => { $('btnSound').hidden = !v.muted; });

    // swipe across the picture to step through frames (review only)
    let sx = null, stepped = 0;
    const stage = $('stage');
    stage.addEventListener('pointerdown', (e) => { if (ui.state?.review?.open) { sx = e.clientX; stepped = 0; } });
    stage.addEventListener('pointermove', (e) => {
        if (sx === null) return;
        const want = Math.trunc((e.clientX - sx) / 22);
        if (want !== stepped) { cmd('step', { n: want - stepped }); stepped = want; }
    });
    const end = () => { sx = null; };
    stage.addEventListener('pointerup', end); stage.addEventListener('pointercancel', end); stage.addEventListener('pointerleave', end);
}

/** Android back button: close the replay on the laptop first; otherwise let the app go back. */
host.handleBack = () => {
    if (ui.state?.review?.open) { cmd('close'); return true; }
    return false;
};

bind();
window.addEventListener('load', () => {
    connect();
    host.notify({ type: 'ultraedge:ready', matchId: host.matchId || null, over: host.ball.over, mode: 'remote' });
});
