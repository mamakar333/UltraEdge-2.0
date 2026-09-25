"""End-to-end test of the studio (laptop) ⇄ umpire phone link, multi-camera replay and CrickVision verdicts.

  laptop  ultraedge.html?matchId=…  two cameras (fake phones) + stump mic → publishes its screen
  phone   remote.html?matchId=…     (what the CrickVision app opens) watches it and drives it

VDO.ninja is replaced by tests/mock/vdoninja-mock.js (real WebRTC between the two pages, signalled over a
BroadcastChannel). The CrickVision API is mocked with Playwright routes.
Run from the repo root:  python3 tests/remote.e2e.py
"""
import json, os, subprocess, sys, time
from playwright.sync_api import sync_playwright

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
MEDIA = os.path.join(ROOT, 'tests', 'media')
OUT = os.environ.get('E2E_OUT', os.path.join(ROOT, 'tests', 'out'))
os.makedirs(OUT, exist_ok=True)
PORT = 8766
MATCH = '11111111-2222-3333-4444-555555555555'
API = 'https://crickvision-api.onrender.com/api/v1'
srv = subprocess.Popen([sys.executable, '-m', 'http.server', str(PORT)], cwd=ROOT, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
time.sleep(0.8)
errors = []
posts = []
ok = True
def check(cond, msg):
    global ok
    print(('PASS ' if cond else 'FAIL ') + msg)
    ok = ok and bool(cond)

STATE = {'match': {'id': MATCH, 'teamAName': 'India', 'teamAShortName': 'IND', 'teamBName': 'Australia', 'teamBShortName': 'AUS'},
         'phase': 'READY', 'innings': [],
         'current': {'inningsNumber': 1, 'battingTeamName': 'India', 'runs': 80, 'wickets': 2, 'overs': '2.2', 'legalBalls': 14,
                     'isCompleted': False, 'striker': {'playerId': 'bat-1'}, 'bowler': {'playerId': 'bowl-1'}}}

def api(route):
    req = route.request
    if req.method == 'OPTIONS':
        return route.fulfill(status=204, headers={'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': '*'})
    if req.method == 'GET' and req.url.endswith(f'/scoring/matches/{MATCH}/state'):
        body = {'success': True, 'data': STATE}
    elif req.method == 'POST' and req.url.endswith(f'/scoring/matches/{MATCH}/edge-reviews'):
        b = json.loads(req.post_data or '{}'); posts.append(b)
        body = {'success': True, 'data': {'id': 'rev-%d' % len(posts), 'overLabel': b.get('over') or '2.2', 'verdict': 'EDGE' if b['verdict'] == 'EDGE' else 'NO_EDGE'}}
    else:
        body = {'success': False, 'error': 'not mocked'}
    route.fulfill(status=200, content_type='application/json', headers={'Access-Control-Allow-Origin': '*'}, body=json.dumps(body))

mock = open(os.path.join(ROOT, 'tests', 'mock', 'vdoninja-mock.js')).read()
def prep(page, name):
    page.on('console', lambda m: errors.append(f'{name}: {m.text}') if m.type == 'error' else None)
    page.on('pageerror', lambda e: errors.append(f'{name} PAGEERROR {e}'))
    page.route('**/vdoninja-sdk.min.js', lambda r: r.fulfill(body=mock, content_type='text/javascript'))
    page.route('**/qrcode.min.js', lambda r: r.fulfill(body='', content_type='text/javascript'))
    page.route(API + '/**', api)

def wait(page, js, what, timeout=20000):
    try:
        page.wait_for_function(js, timeout=timeout)
        return True
    except Exception:
        print('   timed out waiting for', what)
        return False

try:
    with sync_playwright() as p:
        b = p.chromium.launch(args=[
            '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream',
            f'--use-file-for-fake-audio-capture={MEDIA}/scene.wav',
            f'--use-file-for-fake-video-capture={MEDIA}/cam.y4m',
            '--autoplay-policy=no-user-gesture-required',
            '--disable-features=WebRtcHideLocalIpsWithMdns',
        ])
        ctx = b.new_context(viewport={'width': 1440, 'height': 950}, permissions=['camera', 'microphone'])

        # ------------------------------------------------------------------ laptop
        lap = ctx.new_page(); prep(lap, 'laptop')
        lap.goto(f'http://localhost:{PORT}/ultraedge.html?matchId={MATCH}')
        wait(lap, "document.getElementById('cvBanner') && document.getElementById('cvBanner').textContent.includes('IND v AUS')", 'match banner')
        check('IND v AUS' in (lap.text_content('#cvBanner') or ''), 'laptop linked to the CrickVision match from the URL (banner shows IND v AUS)')
        lap.click('#btnSetup'); lap.wait_for_timeout(400)
        check(lap.input_value('#matchRef') == MATCH, 'match ID filled in Setup sources')
        lap.click('#btnAddCam'); lap.wait_for_timeout(200)
        lap.fill('.cam-row:nth-child(2) .cam-name-in', 'Front-on')
        check(lap.locator('.cam-row').count() == 2, 'second camera row added')
        check(lap.evaluate("!!document.getElementById('linkCam') && !!document.getElementById('linkCam1')"), 'phone links + QR shown for both camera phones')
        check(lap.evaluate("!!document.querySelector('#qrCam svg') && !!document.querySelector('#qrCam1 svg')"), 'QR codes rendered for camera 1 and camera 2')
        for _ in range(2): lap.click('#btnAddCam')
        check(lap.locator('.cam-row').count() == 4 and lap.is_disabled('#btnAddCam'), 'up to 4 cameras (add button disabled at 4)')
        lap.click('.cam-row:nth-child(4) button.x'); lap.click('.cam-row:nth-child(3) button.x')
        lap.screenshot(path=f'{OUT}/r01-setup-multicam.png')
        lap.click('#btnStart')
        wait(lap, 'window.ultraedge.running === true', 'live', 30000)
        check(lap.evaluate('window.ultraedge.cams.length') == 2, 'two cameras live')
        wait(lap, 'window.ultraedge.broadcast.live', 'umpire view', 15000)
        check(lap.evaluate('window.ultraedge.broadcast.live'), 'umpire view started automatically (match linked)')
        lap.wait_for_timeout(6000)
        lap.screenshot(path=f'{OUT}/r02-laptop-live-2cams.png')
        st = lap.evaluate('() => window.ultraedge.cams.map(c => ({ name: c.name, fps: c.frames.fps, n: c.frames.frames.length }))')
        print('   cameras:', st)
        check(all(c['fps'] >= 15 and c['n'] > 50 for c in st), 'both cameras buffering frames for replay')

        # ------------------------------------------------------------------ umpire phone
        ph = ctx.new_page(); prep(ph, 'phone')
        ph.set_viewport_size({'width': 412, 'height': 915})
        ph.add_init_script("window.__msgs=[]; window.CrickVisionBridge={postMessage:(m)=>window.__msgs.push(JSON.parse(m))};")
        ph.goto(f'http://localhost:{PORT}/remote.html?matchId={MATCH}&embed=crickvision&over=2.3&innings=1&batterId=bat-9&bowlerId=bowl-9&label=Kohli%20v%20Starc')
        check(wait(ph, "window.ultraedgeRemote.state && document.getElementById('program').videoWidth > 0", 'program video', 30000), 'phone receives the laptop screen live (WebRTC)')
        check(any(m['type'] == 'ultraedge:ready' for m in ph.evaluate('window.__msgs')), 'app told the page is ready')
        vw = ph.evaluate("[document.getElementById('program').videoWidth, document.getElementById('program').videoHeight]")
        check(vw[1] > 0 and abs(vw[0] / vw[1] - 1.28) < 0.02, f'program has the laptop layout (1280×1000 aspect; WebRTC picks the resolution: {vw})')
        check('IND v AUS' in ph.text_content('#title'), 'phone header shows the match')
        wait(lap, 'window.ultraedge.broadcast.viewers >= 1', 'viewer count')
        check('1 phone' in lap.text_content('#pillUmpire'), f"laptop shows the connected umpire phone ({lap.text_content('#pillUmpire')})")
        bright = ph.evaluate('''() => { const v = document.getElementById('program'); const c = document.createElement('canvas'); c.width = 64; c.height = 50;
            const g = c.getContext('2d'); g.drawImage(v, 0, 0, 64, 50); const d = g.getImageData(0, 0, 64, 36).data; let s = 0; for (let i = 0; i < d.length; i += 4) s += d[i] + d[i+1] + d[i+2]; return s / (d.length / 4) / 3; }''')
        check(bright > 8, f'phone picture shows the cameras (mean brightness {bright:.0f})')
        ph.screenshot(path=f'{OUT}/r03-phone-live.png')

        # camera layout from the phone
        ph.click('#camChips button[data-k="1"]')
        check(wait(lap, 'window.ultraedge.liveLayout === 1', 'layout'), 'phone switches the laptop to camera 2 full-screen')
        ph.click('#camChips button[data-k="-1"]')
        check(wait(lap, 'window.ultraedge.liveLayout === -1', 'layout all'), 'phone switches back to all cameras')
        # sensitivity from the phone
        ph.evaluate("(() => { const s = document.getElementById('sens'); s.value = 80; s.dispatchEvent(new Event('change')); })()")
        check(wait(lap, "document.getElementById('sens').value === '80'", 'sens'), 'phone changes detection sensitivity on the laptop')

        # review from the phone
        ph.click('#btnReviewLast')
        check(wait(lap, 'window.ultraedgeReview.isOpen', 'review open'), 'phone opens REVIEW LAST 3 s on the laptop')
        check(wait(ph, "!document.getElementById('reviewPanel').hidden", 'phone review panel'), 'phone shows the replay controls')
        s = lap.evaluate('() => { const s = window.ultraedgeReview.session; return { angles: s.angles.map(a => ({ name: a.name, n: a.frames.count })), angle: window.ultraedgeReview.angle } }')
        print('   replay angles:', s)
        check(len(s['angles']) == 2 and all(a['n'] > 30 for a in s['angles']), 'replay has both camera angles with frames')
        f0 = lap.evaluate('window.ultraedgeReview.i')
        ph.click('#rvNext'); ph.click('#rvNext')
        check(wait(lap, f'window.ultraedgeReview.i === {f0 + 2}', 'step'), 'phone steps frames on the laptop (+2)')
        ph.click('#rvBack5')
        check(wait(lap, f'window.ultraedgeReview.i === {max(0, f0 - 3)}', 'step back'), 'phone steps back 5 frames')
        ph.click('#angleChips button[data-k="1"]')
        check(wait(lap, 'window.ultraedgeReview.angle === 1', 'angle'), 'phone switches the replay to camera 2')
        ph.click('#angleChips button[data-grid]')
        check(wait(lap, 'window.ultraedgeReview.grid === true', 'grid'), 'phone shows all angles in a grid')
        ph.select_option('#rvSpeed', '0.5')
        check(wait(lap, 'window.ultraedgeReview.speed === 0.5', 'speed'), 'phone sets replay speed 1/2×')
        ph.click('#rvPlay')
        check(wait(lap, 'window.ultraedgeReview.playing', 'play'), 'phone plays the replay (slow motion with sound on the laptop)')
        lap.wait_for_timeout(800)
        check(lap.evaluate('!!window.ultraedgeReview._src'), 'replay sound running (also sent to the phone)')
        ph.click('#rvPlay')
        check(wait(lap, '!window.ultraedgeReview.playing', 'pause'), 'phone pauses the replay')
        check(wait(ph, "document.getElementById('rvFrame').textContent.startsWith('Frame')", 'frame label'), 'phone shows frame counter from the laptop')
        ph.screenshot(path=f'{OUT}/r04-phone-review-grid.png')
        lap.screenshot(path=f'{OUT}/r05-laptop-review-grid.png')
        ph.click('#angleChips button[data-k="0"]')
        wait(lap, 'window.ultraedgeReview.angle === 0 && !window.ultraedgeReview.grid', 'angle 0')

        # verdict from the phone → saved to CrickVision with the ball the app passed
        ph.click('#rvEdge')
        check(wait(ph, "document.getElementById('rvSaved').textContent.includes('saved for ball 2.3')", 'saved text'), 'phone shows "EDGE saved for ball 2.3"')
        check(len(posts) == 1 and posts[0]['verdict'] == 'EDGE' and posts[0]['over'] == '2.3' and posts[0]['batterId'] == 'bat-9' and posts[0]['bowlerId'] == 'bowl-9',
              f'laptop saved the verdict to the CrickVision API with the ball from the app ({posts[:1]})')
        v = [m for m in ph.evaluate('window.__msgs') if m['type'] == 'ultraedge:verdict']
        check(len(v) == 1 and v[0]['saved'] and v[0]['review']['overLabel'] == '2.3', 'CrickVision app told the verdict was saved (bridge)')
        check(lap.evaluate(f"window.ultraedge.deliveries.find(d => d.id === '{posts[0]['clientRef']}').verdict") == 'EDGE', 'delivery on the laptop marked EDGE')
        # verdict given on the laptop keyboard: ball from the match state (next ball 2.3, current striker/bowler)
        lap.keyboard.press('n')
        t_end = time.time() + 10
        while len(posts) < 2 and time.time() < t_end: lap.wait_for_timeout(200)
        check(len(posts) == 2 and posts[1]['verdict'] == 'NO EDGE' and posts[1]['over'] == '2.3' and posts[1]['batterId'] == 'bat-1'
              and posts[1]['clientRef'] == posts[0]['clientRef'], f'laptop verdict saved for the ball from the match state, same review updated ({posts[1:2]})')
        check(wait(ph, "document.getElementById('rvNoEdge').classList.contains('chosen')", 'chosen'), 'phone shows the laptop operator\'s verdict')

        # Android back button: closes the replay on the laptop first, then lets the app go back
        check(ph.evaluate('window.ultraedgeHost.handleBack()') is True, 'back button handled by the page while a replay is open')
        check(wait(lap, '!window.ultraedgeReview.isOpen', 'closed'), 'back closes the replay on the laptop')
        check(wait(ph, "!document.getElementById('livePanel').hidden", 'live panel'), 'phone back to live controls')
        check(ph.evaluate('window.ultraedgeHost.handleBack()') is False, 'back with no replay open is left to the app')

        # delivery list: a detected spike opens from the phone
        wait(ph, "document.querySelectorAll('#deliveries button[data-id]:not([disabled])').length > 1", 'deliveries', 20000)
        ph.click('#deliveries button[data-id]:not([disabled]) >> nth=1')
        check(wait(lap, 'window.ultraedgeReview.isOpen', 'delivery open'), 'phone opens a detected delivery on the laptop')
        ph.click('#rvClose')
        wait(lap, '!window.ultraedgeReview.isOpen', 'closed')

        # laptop restarts (page reload): the phone reconnects by itself
        lap.reload()
        wait(lap, "document.getElementById('cvBanner')", 'banner after reload')
        lap.click('#btnSetup'); lap.wait_for_timeout(300); lap.click('#btnStart')
        wait(lap, 'window.ultraedge.running && window.ultraedge.broadcast.live', 'live again', 30000)
        check(wait(ph, "document.getElementById('conn').classList.contains('on') && window.ultraedgeRemote.state && window.ultraedgeRemote.state.running", 'reconnect', 40000),
              'phone reconnects on its own after the laptop restarts')
        ph.screenshot(path=f'{OUT}/r06-phone-reconnected.png')
        b.close()
finally:
    srv.terminate()

bad = [e for e in errors if 'favicon' not in e and 'ERR_' not in e and 'fonts.g' not in e]
check(not bad, f'no page errors ({bad[:6]})')
print('\nOVERALL', 'PASS' if ok else 'FAIL')
sys.exit(0 if ok else 1)
