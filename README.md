# UltraEdge

A personal snickometer for cricket: a phone camera (up to 4 angles) and a stump mic. Every
bat/ball contact is detected to the exact audio sample, and the third-umpire replay shows the
video frame by frame with the synchronised sound trace underneath.

**Live:** https://ultraedge.onrender.com (a Render static site built from this repo; see `render.yaml`)

| Page | Who uses it |
|---|---|
| `index.html` (the main address) | The laptop running the review: cameras, stump mic, detection, replays |
| `remote.html` | Umpire phones: see the laptop's screen live and control the review |

The CrickVision scoring app opens `remote.html` for the match being scored and saves
EDGE / NO EDGE verdicts against the ball.

## Run it locally

```bash
python3 serve.py        # or double-click launch.command
# open http://localhost:8001/   (camera and mic only work on localhost or https)
```

## Tests

```bash
npm test                # detector accuracy on synthetic audio
npm run test:e2e        # headless browser: live pipeline, replay, rotation, file analysis
npm run test:remote     # umpire phone view
```

## More

- [ULTRAEDGE_GUIDE.md](ULTRAEDGE_GUIDE.md): how to set it up at the ground and how detection works
- [AGENT_BRIEF.md](AGENT_BRIEF.md): code layout and data flow, for developers
