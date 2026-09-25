"""End-to-end test in headless Chromium with fake camera + fake microphone.
Run from repo root:  python3 tests/e2e.py
"""
import json, os, subprocess, sys, time
from playwright.sync_api import sync_playwright

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
MEDIA = os.path.join(ROOT, 'tests', 'media')
OUT = os.environ.get('E2E_OUT', os.path.join(ROOT, 'tests', 'out'))
os.makedirs(OUT, exist_ok=True)
PORT = 8765
srv = subprocess.Popen([sys.executable, '-m', 'http.server', str(PORT)], cwd=ROOT, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
time.sleep(0.8)
errors, logs = [], []
ok = True
def check(cond, msg):
    global ok
    print(('PASS ' if cond else 'FAIL ') + msg)
    ok = ok and cond

try:
    with sync_playwright() as p:
        b = p.chromium.launch(args=[
            '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream',
            f'--use-file-for-fake-audio-capture={MEDIA}/scene.wav',
            f'--use-file-for-fake-video-capture={MEDIA}/cam.y4m',
            '--autoplay-policy=no-user-gesture-required',
        ])
        ctx = b.new_context(viewport={'width': 1440, 'height': 950}, permissions=['camera', 'microphone'])
        pg = ctx.new_page()
        pg.on('console', lambda m: (logs.append(f'{m.type}: {m.text}'), errors.append(m.text) if m.type == 'error' else None))
        pg.on('pageerror', lambda e: errors.append('PAGEERROR ' + str(e)))
        pg.goto(f'http://localhost:{PORT}/ultraedge.html')
        pg.wait_for_timeout(1500)
        pg.screenshot(path=f'{OUT}/01-idle.png')

        pg.click('#btnSetup')
        pg.wait_for_timeout(500)
        pg.check('input[name=vsrc][value=local]')
        pg.check('input[name=asrc][value=local]')
        pg.screenshot(path=f'{OUT}/02-setup.png')
        pg.click('#btnStart')
        pg.wait_for_function('window.ultraedge.running === true', timeout=15000)
        t_start = time.time()
        pg.wait_for_timeout(16000)
        pg.screenshot(path=f'{OUT}/03-live.png')

        st = pg.evaluate('''() => { const a = window.ultraedge; return {
            fs: a.engine.sampleRate, hits: a.liveHits.map(h => ({perf: h.perf, snr: h.snrDb, frame: h.frame})),
            frames: a.frames.frames.length, fps: a.frames.fps, dropped: a.frames.dropped, deliveries: a.deliveries.length,
            latest: a.engine.latestFrame, origin: a.engine.origin } }''')
        print(json.dumps({k: v for k, v in st.items() if k != 'hits'}))
        hits = st['hits']
        check(st['fps'] >= 20, f"video frames buffered at {st['fps']} fps ({st['frames']} frames)")
        check(len(hits) >= 5, f'{len(hits)} live spikes detected in ~16 s')
        # compare spacing of detected hits with ground truth spacing (fake mic loops the wav from an unknown start)
        truth = [t['t'] * 1000 for t in json.load(open(f'{MEDIA}/truth.json'))]
        if len(hits) >= 2:
            d_det = [round(hits[i+1]['frame'] - hits[i]['frame']) / st['fs'] * 1000 for i in range(len(hits) - 1)]
            d_tru = [truth[i+1] - truth[i] for i in range(len(truth) - 1)] + [30000 - truth[-1] + truth[0]]
            matched = 0
            for d in d_det:
                if any(abs(d - x) < 2.0 for x in d_tru): matched += 1
            print('   detected intervals', [round(x,1) for x in d_det]); print('   truth intervals', [round(x,1) for x in d_tru])
            check(matched >= len(d_det) - 1, f'inter-spike intervals match ground truth within 2 ms ({matched}/{len(d_det)})')

        # open the latest finalized delivery
        pg.wait_for_function('window.ultraedge.deliveries.some(d => d.session)', timeout=5000)
        pg.click('.hit:not(.pending)')
        pg.wait_for_timeout(800)
        pg.screenshot(path=f'{OUT}/04-review.png')
        check(pg.evaluate("document.getElementById('review').classList.contains('open')"), 'review opens from delivery card')
        info = pg.evaluate("document.getElementById('rvInfo').textContent")
        print('   rvInfo:', info)
        # step around and find the white flash frame nearest the spike -> A/V offset measurement
        res = pg.evaluate('''async () => {
            const a = window.ultraedge; const rp = document.getElementById('review');
            const d = a.deliveries.find(d => d.session && d.hits.length);
            const s = d.session; const fr = s.frames;
            const c = document.createElement('canvas'); c.width = 16; c.height = 9; const g = c.getContext('2d');
            let best = null;
            for (let i = 0; i < fr.count; i++) {
                const img = await fr.get(i); g.drawImage(img, 0, 0, 16, 9);
                const px = g.getImageData(0, 0, 16, 9).data; let sum = 0; for (let k = 0; k < px.length; k += 4) sum += px[k];
                const bright = sum / (px.length / 4);
                if (bright > 235) { const dt = fr.timeOf(i) - s.hits[0].t; if (!best || Math.abs(dt) < Math.abs(best)) best = dt; }
            }
            return { flashMinusSpikeMs: best, frameDur: fr.frameDur, n: fr.count };
        }''')
        print('   sync probe:', res)
        check(res['flashMinusSpikeMs'] is not None, 'flash frame found near spike (fake devices are not mutually synced; this measures offset)')

        pg.keyboard.press('ArrowRight'); pg.keyboard.press('ArrowRight'); pg.wait_for_timeout(200)
        pg.keyboard.press('e'); pg.wait_for_timeout(300)
        pg.screenshot(path=f'{OUT}/05-review-verdict.png')
        pg.keyboard.press('Escape')
        pg.wait_for_timeout(300)
        # export a replay clip (speed 1x to keep the test short)
        pg.click('.hit:not(.pending)'); pg.wait_for_timeout(500)
        pg.select_option('#rvSpeed', '1')
        with pg.expect_download(timeout=30000) as dl:
            pg.click('#rvExport')
        path = f'{OUT}/replay-export.webm'; dl.value.save_as(path)
        probe = subprocess.run(['ffprobe', '-v', 'error', '-count_frames', '-select_streams', 'v:0', '-show_entries', 'stream=nb_read_frames,width,height', '-of', 'csv=p=0', path], capture_output=True, text=True).stdout.strip()
        check(os.path.getsize(path) > 20000 and probe != '', f'replay export produced a playable WebM ({os.path.getsize(path)//1024} KB, ffprobe: {probe})')
        pg.keyboard.press('Escape'); pg.wait_for_timeout(300)
        pg.click('#btnReviewLast'); pg.wait_for_timeout(800)
        check(pg.evaluate("document.getElementById('review').classList.contains('open')"), 'manual REVIEW LAST 3 s opens')
        pg.screenshot(path=f'{OUT}/06-manual.png')
        # replay must play sound: press play at 1x, check an audio source runs and picture follows the audio clock
        pg.select_option('#rvSpeed', '1')
        pg.click('#rvPlay'); pg.wait_for_timeout(1200)
        au = pg.evaluate('''() => { const r = window.ultraedgeReview; return { src: !!r._src, clock: r._audioClock, ctx: r.audioCtx && r.audioCtx.state, t: r.audioCtx && r.audioCtx.currentTime, i: r.i } }''')
        print('   replay audio:', au)
        check(au['src'] and au['clock'] and au['ctx'] == 'running' and au['t'] > 0.5, 'replay plays sound (audio source running, picture locked to audio clock)')
        pg.click('#rvPlay')
        check(pg.evaluate('!window.ultraedgeReview._src'), 'pause stops the replay sound')
        pg.keyboard.press('Escape')
        pg.wait_for_timeout(1200)
        lv = pg.evaluate('''async () => { const v = document.getElementById('liveVideo'); const t0 = v.currentTime; await new Promise(r => setTimeout(r, 700));
            const r = v.getBoundingClientRect(); return { paused: v.paused, adv: v.currentTime - t0, w: r.width, h: r.height, vis: getComputedStyle(v).display } }''')
        print('   live video after closing replay:', lv)
        check(not lv['paused'] and lv['adv'] > 0.3 and lv['h'] > 100 and lv['h'] <= lv['w'], 'live video keeps playing and stays in its 16:9 box after closing the replay')

        # file analysis path
        pg.click('#btnStop'); pg.wait_for_timeout(500)
        subprocess.run(['ffmpeg', '-loglevel', 'error', '-y', '-i', f'{MEDIA}/cam.y4m', '-i', f'{MEDIA}/scene.wav', '-t', '12', '-c:v', 'libvpx', '-b:v', '1M', '-c:a', 'libopus', '-b:a', '128k', f'{OUT}/match.webm'], check=True)
        pg.set_input_files('#fileInput', f'{OUT}/match.webm')
        pg.wait_for_function("document.getElementById('review').classList.contains('open')", timeout=30000)
        pg.wait_for_timeout(1500)
        pg.screenshot(path=f'{OUT}/07-file-review.png')
        fr = pg.evaluate('''() => { const s = window.ultraedge.fileSession; return { hits: s.hits.map(h => +(h.t/1000).toFixed(4)), fps: s.frames.fps } }''')
        print('   file:', fr)
        exp = [t / 1000 for t in truth if t < 12000]
        found = sum(1 for e in exp if any(abs(h - e) < 0.004 for h in fr['hits']))
        check(found >= len(exp) - 1 and fr['fps'] == 30, f'file mode: {found}/{len(exp)} ground-truth spikes found (±4 ms), fps={fr["fps"]}')
        # in a file audio & video are intrinsically synced -> flash frame should coincide with spike
        res2 = pg.evaluate('''async () => {
            const s = window.ultraedge.fileSession, fr = s.frames;
            const c = document.createElement('canvas'); c.width = 16; c.height = 9; const g = c.getContext('2d');
            const out = [];
            for (const h of s.hits.slice(0, 4)) {
                let m = 0;
                for (const di of [0, 1]) { const i = fr.indexAt(h.t) + di; const img = await fr.get(i); g.drawImage(img, 0, 0, 16, 9);
                const px = g.getImageData(0, 0, 16, 9).data; let sum = 0; for (let k = 0; k < px.length; k += 4) sum += px[k];
                m = Math.max(m, Math.round(sum / (px.length / 4))); }
                out.push(m);
            }
            return out;
        }''')
        print('   brightness of frame at each spike:', res2)
        check(sum(1 for v in res2 if v > 200) == len(res2), 'file mode: spike lands on the flash frame (or the one before: contact inside its exposure)')
        # ---- phone path (VDO.ninja SDK replaced by a mock that serves fake devices) ----
        pg2 = ctx.new_page()
        pg2.on('console', lambda m: errors.append(m.text) if m.type == 'error' else None)
        pg2.on('pageerror', lambda e: errors.append('PAGEERROR ' + str(e)))
        mock = open(os.path.join(ROOT, 'tests', 'mock', 'vdoninja-mock.js')).read()
        pg2.route('**/vdoninja-sdk.min.js', lambda r: r.fulfill(body=mock, content_type='text/javascript'))
        pg2.route('**/qrcode.min.js', lambda r: r.fulfill(body='', content_type='text/javascript'))
        pg2.goto(f'http://localhost:{PORT}/ultraedge.html'); pg2.wait_for_timeout(1000)
        pg2.click('#btnSetup'); pg2.wait_for_timeout(300)
        pg2.check('input[name=vsrc][value=phone]'); pg2.check('input[name=asrc][value=phone2]')
        pg2.wait_for_timeout(300)
        link = pg2.evaluate("document.getElementById('linkCam').textContent")
        check('push=' in link and 'proaudio' in link and 'aec=0' in link, f'phone push link generated: {link}')
        check(pg2.evaluate("!!document.querySelector('#qrCam svg')"), 'QR code rendered for camera phone')
        pg2.screenshot(path=f'{OUT}/08-setup-phone.png')
        pg2.click('#btnStart')
        pg2.wait_for_function('window.ultraedge.running === true', timeout=15000)
        pg2.wait_for_timeout(9000)
        st2 = pg2.evaluate('() => ({ mocks: window.__ninjaMock, hits: window.ultraedge.liveHits.length, fps: window.ultraedge.frames.fps, keep: window.ultraedge.keepAlive.length })')
        print('   phone path:', st2)
        check(st2['mocks'] == 2 and st2['hits'] >= 3 and st2['fps'] >= 20 and st2['keep'] == 1, 'two-phone path: camera phone video + stump-mic phone audio, spikes detected')
        pg2.screenshot(path=f'{OUT}/09-phone-live.png')
        b.close()
finally:
    srv.terminate()

bad = [e for e in errors if 'favicon' not in e and 'vdoninja' not in e.lower() and 'qrcode' not in e.lower() and 'ERR_' not in e]
check(not bad, f'no console errors ({bad[:5]})')
print('\nOVERALL', 'PASS' if ok else 'FAIL')
sys.exit(0 if ok else 1)
