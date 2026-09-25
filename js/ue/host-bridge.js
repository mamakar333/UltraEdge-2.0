/**
 * UltraEdge ⇄ CrickVision (optional).
 *
 * When UltraEdge is linked to a CrickVision match, every EDGE / NO EDGE verdict is saved against a ball
 * of that match (POST {api}/scoring/matches/:matchId/edge-reviews). The link comes from the URL
 *   ultraedge.html?matchId=<uuid>[&api=https://…/api/v1]
 * or from the match entered in Setup sources (studio), or from the umpire phone's URL (remote.html).
 *
 * It also forwards events to a native host (Android WebView: window.CrickVisionBridge.postMessage(json))
 * or to a parent frame. Event types: ultraedge:ready, ultraedge:hit, ultraedge:delivery, ultraedge:verdict.
 *
 * Without a match UltraEdge works exactly as stand-alone.
 */
const q = new URLSearchParams(location.search);

export const CV_API_DEFAULT = 'https://crickvision-api.onrender.com/api/v1';

const num = (v) => (v === null || v === undefined || v === '' || isNaN(+v) ? null : +v);
const round = (v, d = 1) => (typeof v === 'number' && isFinite(v) ? Math.round(v * 10 ** d) / 10 ** d : 0);

/** "12.3" for the n-th legal ball of an innings (1-based); null before the first ball. */
export function overLabel(legalBalls) {
    return legalBalls > 0 ? `${Math.floor((legalBalls - 1) / 6)}.${((legalBalls - 1) % 6) + 1}` : null;
}

/** Match ID from a CrickVision link (…/match/<uuid>, ?matchId=<uuid>) or a bare ID. */
export function parseMatchRef(text) {
    const s = String(text || '').trim();
    if (!s) return '';
    const m = s.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
    if (m) return m[0].toLowerCase();
    try { const u = new URL(s); return u.searchParams.get('matchId') || u.pathname.split('/').filter(Boolean).pop() || ''; } catch { }
    return s.replace(/\s+/g, '');
}

export const host = {
    matchId: q.get('matchId') || '',
    embedded: q.get('embed') === 'crickvision',
    /** ball context passed by the app (umpire phone): the ball under review */
    ball: {
        over: q.get('over') || null,
        inningsNumber: num(q.get('innings')),
        batterId: q.get('batterId') || null,
        bowlerId: q.get('bowlerId') || null,
    },
    label: q.get('label') || '',
    api: (q.get('api') || (/crickvision/i.test(location.hostname) ? '/api/v1' : CV_API_DEFAULT)).replace(/\/$/, ''),
    lastSaved: null,

    setMatch(id) { this.matchId = parseMatchRef(id); },

    /** Send an event to whatever is hosting this page (native app and/or parent frame). */
    notify(msg) {
        try { if (window.CrickVisionBridge && window.CrickVisionBridge.postMessage) window.CrickVisionBridge.postMessage(JSON.stringify(msg)); } catch (e) { /* ignore */ }
        try { if (window.parent && window.parent !== window) window.parent.postMessage(msg, '*'); } catch (e) { /* ignore */ }
    },

    spikeSummary(h) {
        return { snrDb: round(h.snrDb), peakDb: round(h.peakDb), riseDb: round(h.riseDb), decayMs: round(h.decayMs),
            freqHz: Math.round(h.freqHz || 0), score: round(h.score, 3) };
    },

    hit(h) { this.notify({ type: 'ultraedge:hit', hit: this.spikeSummary(h) }); },
    delivery(d) { this.notify({ type: 'ultraedge:delivery', id: d.id, spikes: (d.hits || []).map((h) => this.spikeSummary(h)) }); },

    async getJson(path) {
        const res = await fetch(`${this.api}${path}`);
        const body = await res.json();
        if (!body.success) throw new Error(body.error || `HTTP ${res.status}`);
        return body.data;
    },

    /** Teams and score of the linked match, for labels. */
    async matchInfo() {
        if (!this.matchId) return null;
        const s = await this.getJson(`/scoring/matches/${encodeURIComponent(this.matchId)}/state`);
        const m = s.match || {};
        const cur = s.current;
        return {
            title: `${m.teamAShortName || m.teamAName || 'Team A'} v ${m.teamBShortName || m.teamBName || 'Team B'}`,
            score: cur ? `${cur.battingTeamName || ''} ${cur.runs}/${cur.wickets} (${cur.overs})` : (m.result || ''),
            state: s,
        };
    },

    /**
     * The ball a verdict belongs to when the caller doesn't say. Same rule as the CrickVision app: while
     * the scorer waits to record a ball it is that (upcoming) ball with the current striker and bowler,
     * otherwise the last ball bowled (the server then fills in who faced / bowled it).
     */
    async ballContext() {
        try {
            const s = (await this.matchInfo()).state;
            const cur = s.current, last = (s.innings || [])[s.innings.length - 1];
            const inningsNumber = cur?.inningsNumber ?? last?.inningsNumber ?? null;
            const legal = cur?.legalBalls ?? last?.legalBalls ?? 0;
            if (s.phase === 'READY' && cur && !cur.isCompleted) {
                return { over: overLabel(legal + 1), inningsNumber, batterId: cur.striker?.playerId || null, bowlerId: cur.bowler?.playerId || null };
            }
            return { over: overLabel(legal), inningsNumber, batterId: null, bowlerId: null };
        } catch { return {}; }
    },

    /**
     * Save a verdict for a delivery (re-verdicting the same delivery updates the saved review).
     * ball: optional { over, inningsNumber, batterId, bowlerId } (from the umpire's phone).
     */
    async verdict(d, verdict, ball = null) {
        let b = ball && (ball.over || ball.inningsNumber) ? ball : (this.ball.over ? this.ball : null);
        let review = null, error = null;
        const payload = {
            verdict, manual: !!d.manual, clientRef: d.id,
            spikes: (d.hits || []).map((h) => this.spikeSummary(h)),
        };
        if (this.matchId) {
            try {
                if (!b) b = await this.ballContext();
                Object.assign(payload, {
                    over: b.over || undefined, inningsNumber: b.inningsNumber || undefined,
                    batterId: b.batterId || undefined, bowlerId: b.bowlerId || undefined,
                });
                const res = await fetch(`${this.api}/scoring/matches/${encodeURIComponent(this.matchId)}/edge-reviews`, {
                    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
                });
                const body = await res.json();
                if (body.success) review = body.data; else error = body.error || `HTTP ${res.status}`;
            } catch (e) { error = e.message || 'Network error'; }
        }
        this.lastSaved = review;
        const msg = { type: 'ultraedge:verdict', verdict, saved: !!review, review, error, matchId: this.matchId || null, spikes: payload.spikes };
        this.notify(msg);
        return msg;
    },
};

window.ultraedgeHost = host;
