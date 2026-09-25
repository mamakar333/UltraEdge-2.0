# UltraEdge 3 — personal snickometer (phone camera + stump mic)

`ultraedge.html` is a rebuilt, focused UltraEdge system that works like the broadcast version:
a stump microphone is recorded continuously alongside a side-on camera, every bat/ball contact
is detected with sub-millisecond timing, and the third-umpire replay shows the video
**frame by frame with the synchronised audio trace underneath**, so you can see whether the
spike happens as the ball passes the bat.

The older pages (`index.html`, `live-mode.html`, `video-mode.html`) are unchanged.

## Start it

```bash
python3 serve.py            # or double-click launch.command
# open http://localhost:8001/ultraedge.html   (Chrome recommended)
```

Camera and microphone only work on `http://localhost` or `https`, so open the page on the
computer that runs the server.

## Kit and placement

| What | Where | Notes |
|---|---|---|
| **Stump mic** — phone, or a lav/USB mic into a phone or the laptop | Taped to the back of the stumps, or on the ground just behind them, pointing at the batter | Put a foam or fur windshield on it. Keep it out of the ball's line. |
| **Camera** — phone on a tripod | Side-on (square of the wicket), at bat height, 3–6 m from the popping crease, framed tight on bat and pads | Use 60 fps, lock focus and exposure, and use good light (a faster shutter gives less blur). |

Each phone opens the link (or QR code) shown in **Setup sources**. The link is a VDO.ninja push URL with
`&proaudio&aec=0&ag=0&dn=0` set. This turns off echo cancellation, auto-gain and noise suppression, which
otherwise remove the short clicks an edge makes. It also sets 60 fps and a high audio bitrate.

The setup screen supports these combinations:

* **One phone** that provides both camera and mic. This is the simplest setup, and the audio and video are already in sync.
* **Camera phone plus a second phone at the stumps.** Mic placement is better, but you must calibrate (see below).
* **Laptop camera or USB mic** for indoor nets.
* **No camera.** You get the audio trace only.

## Using it

1. **Setup sources → Connect & start.** The live UltraEdge trace scrolls on the right, and red lines mark detected spikes.
2. Each spike, or burst of spikes within 1.5 s, becomes a **delivery card**. Click a card to open the replay. You can also turn on *Auto-open replay on spike*.
3. **REVIEW LAST 3 s** (shortcut `R`) opens a replay even when nothing was detected. The third umpire always decides from the trace, not from the detector.
4. In the replay:
   * `←` / `→` step one frame (`Shift` steps 5). `Space` plays in slow motion **with sound**, slowed like tape so the pitch drops the way broadcast slo-mo does. At 1× you hear it at normal speed; untick *Sound* to mute. `H` jumps to the next spike.
   * The yellow line is the current frame. The shaded band is the time that frame covers, and red triangles mark detected spikes.
   * *Window* zooms the audio (40 ms – 2 s). *HF view* shows the high-passed signal the detector uses, with wind and thuds removed.
   * `E` / `N` stamp the broadcast-style **SPIKE — EDGE** / **NO SPIKE** graphic.
   * **Export replay** saves a WebM of the frames, the trace and the slowed sound at the chosen speed. **PNG** saves a still.
5. **Analyse video file** (or drag a file onto the page) runs the same detector and replay on a clip recorded on a phone. In a recorded file the audio and video are already in sync, so this is the **most precise workflow** (record at 60 fps).

If the camera panel shows a yellow warning, it means the picture is missing, too dark or in portrait:

* **NO VIDEO SIGNAL:** the phone screen locked, the phone slept, or you switched apps. Keep the VDO.ninja page open with the screen on.
* **Very dark:** the lens is covered, pointing at the ground, or there is too little light. Phones also drop their frame rate in low light.
* **Portrait:** turn the phone sideways.

## Calibrate A/V sync (once per setup)

WebRTC, Bluetooth and a second phone each add a fixed delay. To measure it:

1. Start live mode and clap once, or tap the bat with a ball, in view of the camera and near the mic.
2. Open the delivery, step to the frame where the hands (or bat and ball) meet, and press **Sync to this frame**.

The offset is saved separately for live mode and file mode. You can fine-tune it with the *A/V sync* slider.

## Detection (what counts as a spike)

`js/ue/edge-detector.js` runs on every sample inside an AudioWorklet:

1. A 4th-order high-pass filter at 2.5 kHz. The crack of bat on ball and the tick of a thin edge live here; voices, wind and pad thuds mostly don't.
2. A 1 ms peak envelope and a slow noise floor. The floor catches up fast after silence or a change in crowd level.
3. A candidate must be *Sensitivity*-dependent dB above the floor. It is accepted only if all of these hold:
   * a sharp attack (it rises within about 3 ms)
   * a fast decay (12 dB within 30 ms)
   * no sustained tail
   * no periodic pulse train (voiced speech)
   * not a low-frequency thud (ball on pad or ground)
4. The onset is refined to the exact sample. The refinement is robust to Opus codec pre-echo.

Offline results on synthetic cricket audio (`npm test`). "False alarms" means false detections per minute.

| Condition | Recall | False alarms | Timing error (median) |
|---|---|---|---|
| Clean stump mic | 100 % | 0 / min | 0.02 ms |
| Crowd + strong wind | 91 % | 0 / min | 0.02 ms |
| Phone over WebRTC (Opus 32 kbps) | 97 % | 0.1 / min | 0.04 ms |
| Opus 128 kbps + noise (the `&proaudio` link) | 89 % | 0 / min | 0.04 ms |

The misses are faint edges that sit less than about 10 dB above the crowd noise. Better mic placement and a windshield help more than raising the sensitivity.

## Limits to know

* **Frame rate is the limit, not the audio.** At 130 km/h the ball travels about 1.2 m between frames at 30 fps, and about 0.6 m at 60 fps. The spike time is exact to under 0.1 ms, and the replay shows *Δ to spike* in ms for each frame. Use the highest frame rate your phone can stream or record.
* Live replay frames are buffered as JPEGs for 20 s at up to 960 px wide. Deliveries keep their own frames, and the last 40 are kept.
* Real-world tuning: real stump-mic recordings have not been tested yet. If you get false spikes (for example the bat hitting the ground or a keeper's gloves), lower *Sensitivity*. If you miss faint edges, raise it and improve the mic placement.

## Files

```
ultraedge.html, css/ultraedge.css
js/ue/edge-detector.js   detector (shared by worklet, file mode and tests)
js/ue/ue-worklet.js      AudioWorklet: detection + PCM streaming
js/ue/audio-engine.js    AudioContext, 60 s ring buffer, clock mapping
js/ue/frame-buffer.js    timestamped video frames (requestVideoFrameCallback)
js/ue/review.js          frame-by-frame replay, calibration, export
js/ue/sources.js         local camera/mic, VDO.ninja receiver, phone links
js/ue/app.js             wiring + UI
tests/                   synthetic audio, detector benchmark, headless-browser e2e
```

Tests: `npm test` runs the detector benchmark (Node and ffmpeg). `npm run test:e2e` runs the whole app in headless Chromium with a fake camera and mic, including file mode, export and a mocked two-phone setup (Python Playwright).
