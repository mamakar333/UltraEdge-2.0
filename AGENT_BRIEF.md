# UltraEdge 3: integration brief for another agent

> Read this first. It is written so that a coding agent that has never seen this repo can
> understand what UltraEdge is, how it works, and how to plug it into another project.
> Source of truth is the code in `js/ue/`. The user-facing guide is `ULTRAEDGE_GUIDE.md`.

## 1. What it is (30 seconds)

UltraEdge is a personal version of cricket's broadcast **UltraEdge / snickometer**.

**Inputs:**

- a **side-on camera** (phone or webcam)
- a **stump microphone** (phone or USB mic)

**Outputs:**

1. **Spike events.** Each bat/ball contact ("snick") is detected from audio, timed to the exact audio sample (under 0.1 ms error in tests).
2. **Review sessions.** A few seconds of timestamped video frames plus the matching audio. These drive a frame-by-frame replay with the audio trace drawn under each frame.
3. **Operator verdicts** ("EDGE" / "NO EDGE") and a JSON log.

It is **100 % client-side JavaScript**: browser only, no backend, no build step, ES modules.
It runs in Chrome/Edge (Safari mostly works). Phones connect through the **VDO.ninja** WebRTC SDK.

## 2. Repo map (only the parts that matter)

```
index.html                UI shell (setup modal, live view, review overlay)
css/ultraedge.css
js/ue/edge-detector.js    ★ pure DSP detector, no browser APIs (runs in Node, a Worker or an AudioWorklet)
js/ue/ue-worklet.js       AudioWorklet: runs EdgeDetector per sample and streams PCM to the main thread
js/ue/audio-engine.js     AudioContext + worklet + 60 s PCM ring buffer + clock mapping
js/ue/frame-buffer.js     last N s of video as timestamped JPEG blobs (requestVideoFrameCallback)
js/ue/review.js           ReviewPlayer (replay UI, sound, calibration, export), FrameSource classes
js/ue/sources.js          local camera/mic, VDO.ninja receiver, phone push-link builder
js/ue/waveform.js         canvas drawing helpers
js/ue/app.js              glue: up to 4 cameras, delivery grouping, file analysis, settings (localStorage "ue.*")
js/ue/broadcast.js        umpire view: composes the laptop screen (1280×1000), publishes it, runs phone commands
js/ue/link.js             StudioLink / RemoteLink over the VDO.ninja SDK (video + data channel), studioStreamId()
js/ue/host-bridge.js      CrickVision match link: saves verdicts (POST …/edge-reviews), native-app bridge
remote.html, js/ue/remote.js   umpire phone page: mirrors the studio and sends commands (no media capture)
tests/                    synthetic audio generator, detector benchmark (Node), headless e2e (Playwright)
serve.py                  no-cache local server:  python3 serve.py → http://localhost:8001/
ultraedge.html, live-mode / video-mode / ultra-edge-simple.html   forward to the main address (old links)
```

## 3. Data flow

```
camera ─► <video> ─► FrameBuffer        frames: {t, blob, w, h}       t = performance.now() ms
mic    ─► AudioEngine ─► ue-worklet ─► EdgeDetector ─► hit events     frame-accurate, mapped to perf ms
                     └─► PCM ring buffer (raw + high-passed, 60 s)
hits ──► app.js groups them into "deliveries" (hits < 1.5 s apart)
       ─► after 0.7 s post-roll: builds a Session (−1.5 s … +0.7 s) ─► ReviewPlayer
```

### Clocks (important when integrating)

- **Video frames:** `t` is `performance.now()` ms, taken from `expectedDisplayTime` (when the frame is shown on screen).
- **Audio samples:** indexed by AudioContext frame. `AudioEngine.toPerf(frame)` and `fromPerf(ms)` convert using `getOutputTimestamp()` (when the sample is played out).
- **A/V offset:** any constant error left over is removed by an offset in ms, which the user calibrates. Audio at time A lines up with video at time A + `offsetMs`. It is stored in localStorage as `ue.offsetLive` and `ue.offsetFile`.
- **File mode:** everything is in media time (ms from the start of the file) and `audioT0 = 0`.

## 4. Public APIs (stable enough to call from another project)

### 4.1 `EdgeDetector` (the core; start here for headless use)

```js
import { EdgeDetector, detectInBuffer, DEFAULT_PARAMS } from './js/ue/edge-detector.js';

// streaming
const det = new EdgeDetector(sampleRate, { sensitivity: 85 });
const hits = det.process(float32Block /*, optional Float32Array hpOut same length */);  // returns [] usually

// whole buffer (file analysis)
const hits2 = detectInBuffer(monoFloat32, sampleRate, { sensitivity: 85 });
```

These are the parameters (`DEFAULT_PARAMS`):

| Parameter | Default | Meaning |
|---|---|---|
| `sensitivity` | 85 | 0–100. Maps to how far above the noise floor a spike must be: 30 dB at 0, down to 8 dB at 100. |
| `hpfHz` | 2500 | High-pass corner, in Hz, of the signal the detector looks at. |
| `riseDb` | 12 | Minimum jump above the level 3–12 ms earlier (sharp-attack test). |
| `decayDropDb` / `maxDecayMs` | 12 dB / 30 ms | The spike must fall by 12 dB within 30 ms (short-impulse test). |
| `tailDropDb` | 16 | Median level 8–40 ms after the peak must be this far below the peak (no sustained tail). |
| `thudRatioDb` | 18 | Rejects the candidate if the band below 700 Hz jumps at the same moment and is this much louder (ball on pad). |
| `absFloorDb` | -62 | Ignore anything quieter than this, in dBFS. |
| `refractoryMs` | 25 | Minimum gap, in ms, between two reported spikes. |
| `floorTauMs` | 400 | Time constant of the noise floor, in ms. |

**Hit event** (returned by the detector). `sample` counts from the first sample this detector processed:

```js
{ sample, time /*s*/, peakDb, snrDb, riseDb, decayMs, freqHz, score /*0..1*/ }
```

`AudioEngine` adds two fields:

- `frame` = absolute AudioContext frame
- `perf` = `performance.now()` ms

Review sessions also add `t` = ms in the session's time domain.

Pure JS: this works in **Node ≥ 18**, a Web Worker or an AudioWorklet. It can be ported to Python or C line by line if the other project isn't JS.

### 4.2 `AudioEngine`

```js
const eng = new AudioEngine({ seconds: 60, params: { sensitivity: 85 } });
eng.onHit = (hit) => {...};            // hit has .frame and .perf
await eng.start(mediaStreamWithAudio); // creates AudioContext + worklet
eng.getRange(f0, f1, 'raw' | 'hp');    // Float32Array copy from the ring buffer
eng.toPerf(frame); eng.fromPerf(ms); eng.latestFrame; eng.sampleRate; eng.level;
eng.setParams({ sensitivity }); eng.setMonitor(true); await eng.stop();
```

The worklet is loaded with `new URL('./ue-worklet.js', import.meta.url)`, so keep the `js/ue/` files together.

### 4.3 `FrameBuffer`

```js
const fb = new FrameBuffer({ seconds: 20, maxWidth: 960, quality: 0.82 });
fb.attach(videoElement); fb.slice(t0, t1) /* [{t, blob, w, h}] */; fb.fps; fb.latestTime; fb.detach();
```

### 4.4 Review session and `ReviewPlayer`

A **Session** is a plain object. Build one with any audio and frames you have:

```js
{
  kind: 'live' | 'file', title,
  fs, raw: Float32Array, hp: Float32Array,   // hp: high-passed copy (use EdgeDetector.process(x, hpOut))
  audioT0,                                   // ms time of raw[0], in the same domain as frame times
  frames,                                    // FrameSource: BlobFrameSource([{t, blob}]) | VideoFrameSource(videoEl, fps) | custom
  hits: [{ t, snrDb, riseDb, freqHz, ... }], // t in the frame time domain (before offset)
  focusT, verdict                            // optional
}
```

A **FrameSource** must provide:

- `count`
- `timeOf(i)`
- `indexAt(t)`
- `frameDur`
- `async get(i)`, which returns something `drawImage` accepts
- `dispose()`

`ReviewPlayer` needs the review markup from `index.html`: `#review` and all the `#rv*` ids.

```js
const rp = new ReviewPlayer(document.getElementById('review'), { onOffsetChange(ms){}, onVerdict(session, v){} });
rp.onClose = () => {};
await rp.open(session, offsetMs);   // keys: ←/→ frame, Space play (with sound), H next spike, E/N verdict, Esc close
```

### 4.5 Sources

These are exported from `sources.js`:

- `openLocalCamera(deviceId)` / `openLocalMic(deviceId)`. The mic is opened with echo cancellation, noise suppression and auto-gain **off**, which is required, because they erase edge clicks.
- `phonePushUrl(streamId, { video })` builds the VDO.ninja push link the phone opens. It includes `&proaudio&aec=0&ag=0&dn=0&maxframerate=60`.
- `new NinjaReceiver().connect(streamId, { audio, video })` resolves to a MediaStream. It needs the SDK script `https://cdn.jsdelivr.net/gh/steveseguin/ninjasdk@latest/vdoninja-sdk.min.js` on the page.
- Chrome quirk: remote WebRTC audio only reaches Web Audio if the stream is also attached to a (muted) `<audio>` element. `app.js` does this through `keepAlive`.

### 4.6 Studio ⇄ umpire phones (remote control)

The laptop page (`index.html`) is the only place with media and logic. `StudioBroadcast` draws a 1280×1000 "program" canvas ~30×/s. It shows the review canvas while a replay is open, and the camera grid plus the live trace otherwise. The canvas is published with `canvas.captureStream()` plus the replay sound under the stream ID `studioStreamId(matchId || sessionKey)` = `uestudio` + the first 24 alphanumerics.

`remote.html?matchId=…` (or `?studio=<sessionKey>`) views that stream and talks over the data channel:

* phone → laptop `{ ue: 'cmd', cmd, ...args }`. `cmd` is one of: `hello`, `reviewLast`, `open{id}`, `close`, `step{n}`, `toggle`, `play`, `pause`, `hit{dir}`, `verdict{v, ball}`, `speed{v}`, `window{v}`, `angle{k}`, `grid{on}`, `sound{on}`, `hp{on}`, `offset{ms}`, `syncHere`, `sens{v}`, `auto{on}`, `layout{k}`.
* laptop → phones `{ ue: 'state', s }` is sent on every change and every 2 s. It includes `running`, `match`, `cams`, `layout`, `sens`, `deliveries[]` and `review` (`ReviewPlayer.state()`).
* laptop → phones `{ ue: 'event', type: 'verdict', saved, review, error }`.

`remote.html` forwards verdict events to the Android app as `ultraedge:verdict` through `window.CrickVisionBridge`. `window.ultraedgeHost.handleBack()` closes the laptop's replay. To add a control, add a `cmd` case in `app.js → remoteCommand()` and a button in `remote.js`: the app picks it up with no change.

### 4.7 Multi-camera sessions

A live session has `angles: [{ name, frames, offsetMs }]` and `angle`. `session.frames` is always the active angle's frames, so older code keeps working. `ReviewPlayer.setAngle(k)` keeps the audio time. `setGrid(true)` draws every angle at the same audio instant. Offsets are per camera: `ue.offsetLive` for camera 1, and `ue.offsetLive1…3` for the others.

## 5. Integration options (pick one)

| Option | How | When |
|---|---|---|
| **A. Embed the whole app** | `<iframe src="https://ultraedge.onrender.com/" allow="camera; microphone; autoplay">` | You want the UI as-is. It has no postMessage API yet, so add one in `app.js`, e.g. `parent.postMessage({type:'ultraedge:hit', hit}, '*')` inside `onHit` and in `finalizeDelivery`. |
| **B. Import the modules** | Copy `js/ue/` and use `AudioEngine`, `FrameBuffer`, `ReviewPlayer`, `EdgeDetector` directly, then build your own UI | You need spikes inside another web app, such as a scoring app or a streaming overlay. |
| **C. Detector only** | `import { detectInBuffer }` in Node / a Worker, or port `edge-detector.js` | Server- or batch-side analysis of recorded clips. Input is mono float PCM plus the sample rate; output is hit events. |
| **D. Offline hand-off** | Use the UI's **Export log** (JSON) and **Export replay** (WebM) | Loose coupling; the other system just ingests files. |

**Export log JSON** has this shape:

```json
{ "exported": "ISO", "offsets": { "live": 0, "file": 0 },
  "deliveries": [ { "kind": "live|file", "time": "ISO or seconds", "verdict": "EDGE|NO EDGE|null", "manual": false,
                    "spikes": [ { "snrDb": 0, "peakDb": 0, "riseDb": 0, "decayMs": 0, "freqHz": 0, "score": 0, "ms": 0 } ] } ] }
```

## 6. Constraints and gotchas

- The page must be served from **`http://localhost` or `https`**, because camera, mic and AudioWorklet need a secure context. `file://` won't work.
- **ES modules** with no bundler. If the other project bundles the code, keep `ue-worklet.js` and `edge-detector.js` as separate files served next to each other, because the worklet imports the detector.
- The **external scripts** (VDO.ninja SDK, `qrcode-generator` from jsdelivr) are only needed for phone mode.
- **Memory:** about 12 MB of audio (60 s × 2 buffers), plus the JPEG frames (about 20 s × fps × 30–80 KB).
- **Frame rate limits the visual precision, not the audio.** At 130 km/h the ball moves about 1.2 m per frame at 30 fps.
- **Detection is heuristic.** It is tuned on synthetic audio: 91–100 % of contacts found and fewer than 0.2 false alarms a minute in the benchmarks. It is **not yet tuned on real match audio.** The replay trace is what the operator judges from.
- **Settings keys** in localStorage: `ue.sens`, `ue.cfg` (v2: `{ cams:[{name, src, id, device}], mic:{src, id, device}, match }`), `ue.autoReview`, `ue.offsetLive`, `ue.offsetLive1…3`, `ue.offsetFile`, `ue.studioKey`, `ue.rot0…3` (camera rotation). Globals for debugging: `window.ultraedge` (app state) and `window.ultraedgeReview`.

## 7. Verify you didn't break it

```bash
npm test            # node tests/make-media.mjs && node tests/detector.test.mjs  → "PASS" (needs ffmpeg for Opus cases)
npm run test:e2e    # python3 tests/e2e.py (Playwright + Chromium, fake cam/mic) → "OVERALL PASS"
npm run test:remote # python3 tests/remote.e2e.py (laptop with 2 cameras + umpire phone over WebRTC) → "OVERALL PASS"
```

## 8. Status and next ideas

- **Done:**
  - live detection
  - live and manual replays with sound
  - A/V calibration
  - verdict stamps
  - WebM/PNG export
  - video-file analysis
  - one- or two-phone setups
  - no-signal, dark-picture and portrait warnings
  - up to 4 camera angles (grid and per-angle replay, per-camera sync)
  - umpire view: phones mirror and control the laptop (CrickVision app opens it per match)
  - CrickVision match link: verdicts saved against the ball
- **Open:**
  - test with real phones and real stump-mic audio
  - ball-position interpolation between frames
  - optional ML classifier on top of the hit features
