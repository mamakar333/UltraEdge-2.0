/**
 * Live Mode Main Controller
 * Orchestrates all components for live stream monitoring
 */

class LiveModeApp {
    constructor() {
        // Core components
        this.audioProcessor = new AudioProcessor();
        this.spikeDetector = new SpikeDetector();
        this.waveformVisualizer = null;
        this.replayController = new ReplayController();
        this.ballTracker = null;
        this.decisionSystem = new DecisionSystem();
        this.hotSpotOverlay = null;
        this.liveStreamHandler = new LiveStreamHandler();
        this.multiCameraSync = new MultiCameraSync();

        // State
        this.isMonitoring = false;
        this.eventLog = [];

        this.init();
    }

    async init() {
        // Get UI elements
        this.elements = {
            // Video feeds
            mainCameraFeed: document.getElementById('mainCameraFeed'),
            camera1Feed: document.getElementById('camera1Feed'),
            camera2Feed: document.getElementById('camera2Feed'),
            camera3Feed: document.getElementById('camera3Feed'),
            // Canvases
            liveWaveformCanvas: document.getElementById('liveWaveformCanvas'),
            liveHotspotCanvas: document.getElementById('liveHotspotCanvas'),
            ballTrackingViz: document.getElementById('ballTrackingViz'),
            // Controls
            startMonitoringBtn: document.getElementById('startMonitoringBtn'),
            stopMonitoringBtn: document.getElementById('stopMonitoringBtn'),
            instantReplayLiveBtn: document.getElementById('instantReplayLiveBtn'),
            reviewDecisionBtn: document.getElementById('reviewDecisionBtn'),
            // Settings
            liveSensitivitySlider: document.getElementById('liveSensitivitySlider'),
            liveThresholdSlider: document.getElementById('liveThresholdSlider'),
            bufferSizeSlider: document.getElementById('bufferSizeSlider'),
            autoReplayToggle: document.getElementById('autoReplayToggle'),
            transparentBgLive: document.getElementById('transparentBgLive'),
            // Toggles
            hotspotToggle: document.getElementById('hotspotToggle'),
            ballTrackingToggle: document.getElementById('ballTrackingToggle'),
            // Camera selects
            selectMainCameraBtn: document.getElementById('selectMainCameraBtn'),
            // Event log
            eventLog: document.getElementById('eventLog'),
            spikeHistoryList: document.getElementById('spikeHistoryList')
        };

        this.setupEventListeners();
        this.initializeVisualizers();

        console.log('Live Mode initialized');
    }

    setupEventListeners() {
        // Start/Stop monitoring
        this.elements.startMonitoringBtn?.addEventListener('click', () => this.startMonitoring());
        this.elements.stopMonitoringBtn?.addEventListener('click', () => this.stopMonitoring());

        // Settings
        this.elements.liveSensitivitySlider?.addEventListener('input', (e) => {
            document.getElementById('liveSensitivity').textContent = e.target.value;
            this.spikeDetector.setSensitivity(parseInt(e.target.value));
        });

        this.elements.liveThresholdSlider?.addEventListener('input', (e) => {
            document.getElementById('liveThreshold').textContent = parseFloat(e.target.value).toFixed(2);
            this.spikeDetector.setThreshold(parseFloat(e.target.value));
        });

        this.elements.bufferSizeSlider?.addEventListener('input', (e) => {
            document.getElementById('bufferSize').textContent = e.target.value;
            this.replayController.setBufferSize(parseInt(e.target.value));
        });

        // Transparent background
        this.elements.transparentBgLive?.addEventListener('change', (e) => {
            if (e.target.checked) {
                document.body.classList.add('transparent');
            } else {
                document.body.classList.remove('transparent');
            }
        });

        // Toggles
        this.elements.hotspotToggle?.addEventListener('change', (e) => {
            if (this.hotSpotOverlay) {
                this.hotSpotOverlay.setEnabled(e.target.checked);
            }
        });

        this.elements.ballTrackingToggle?.addEventListener('change', (e) => {
            if (this.ballTracker) {
                this.ballTracker.setEnabled(e.target.checked);
            }
        });

        // Replay
        this.elements.instantReplayLiveBtn?.addEventListener('click', () => this.triggerInstantReplay());
        this.elements.reviewDecisionBtn?.addEventListener('click', () => this.reviewDecision());

        // Camera selection
        this.elements.selectMainCameraBtn?.addEventListener('click', () => this.selectCamera('main'));
    }

    initializeVisualizers() {
        // Initialize components
        this.waveformVisualizer = new WaveformVisualizer(this.elements.liveWaveformCanvas);
        this.hotSpotOverlay = new HotSpotOverlay(this.elements.liveHotspotCanvas);
        this.ballTracker = new BallTracker(this.elements.ballTrackingViz);

        this.hotSpotOverlay.initialize();

        console.log('Visualizers initialized');
    }

    async startMonitoring() {
        try {
            this.updateStatus('Initializing...', 'active');

            // Start camera
            const cameraStarted = await this.liveStreamHandler.startCamera(
                this.elements.mainCameraFeed
            );

            if (!cameraStarted) {
                this.updateStatus('Failed to start camera', 'error');
                return;
            }

            // Initialize audio processor
            const audioInitialized = await this.audioProcessor.initialize();

            if (!audioInitialized) {
                this.updateStatus('Failed to initialize audio', 'error');
                return;
            }

            // Setup callbacks
            this.audioProcessor.onAudioData = (data) => {
                // Update waveform
                this.waveformVisualizer.draw(data.waveform);

                // Detect spikes
                const spike = this.spikeDetector.detectSpike(data);
                if (spike) {
                    this.handleLiveSpike(spike);
                }
            };

            this.audioProcessor.onLevelUpdate = (level) => {
                const fill = document.getElementById('audioLevelFill');
                if (fill) {
                    fill.style.width = `${Math.min(100, level * 100)}%`;
                }
            };

            // Start processing
            this.audioProcessor.start();
            this.waveformVisualizer.start();

            // Start replay buffer recording
            this.replayController.startRecording(this.elements.mainCameraFeed);

            // Update UI
            this.isMonitoring = true;
            this.elements.startMonitoringBtn.disabled = true;
            this.elements.stopMonitoringBtn.disabled = false;
            this.elements.instantReplayLiveBtn.disabled = false;
            this.elements.reviewDecisionBtn.disabled = false;

            document.querySelector('.main-container').classList.add('monitoring');

            this.updateStatus('LIVE MONITORING', 'active');
            this.logEvent('Monitoring started', 'system');

            // Start timestamp counter
            this.startTimestampCounter();

            console.log('Live monitoring started');
        } catch (error) {
            console.error('Failed to start monitoring:', error);
            this.updateStatus('Error starting monitoring', 'error');
            alert('Failed to start monitoring: ' + error.message);
        }
    }

    stopMonitoring() {
        this.audioProcessor.stop();
        this.waveformVisualizer.stop();
        this.liveStreamHandler.stopCamera();
        this.replayController.stopRecording();

        this.isMonitoring = false;
        this.elements.startMonitoringBtn.disabled = false;
        this.elements.stopMonitoringBtn.disabled = true;
        this.elements.instantReplayLiveBtn.disabled = true;
        this.elements.reviewDecisionBtn.disabled = true;

        document.querySelector('.main-container').classList.remove('monitoring');

        this.updateStatus('Stopped', '');
        this.logEvent('Monitoring stopped', 'system');
        this.stopTimestampCounter();

        console.log('Live monitoring stopped');
    }

    handleLiveSpike(spike) {
        console.log('Live spike detected:', spike);

        // Update counter
        const count = this.spikeDetector.getSpikeCount();
        document.getElementById('liveSpikesCount').textContent = count;

        // Add to spike list
        this.addSpikeToHistory(spike);

        // Visualize spike line
        const spikeLine = document.getElementById('spikeLine');
        if (spikeLine) {
            spikeLine.style.display = 'block';
            setTimeout(() => {
                spikeLine.style.display = 'none';
            }, 1000);
        }

        // Log event
        this.logEvent(`Spike detected: ${(spike.magnitude * 100).toFixed(1)}%`, 'spike');

        // Update last spike time
        document.getElementById('lastSpikeTime').textContent = spike.formattedTime;

        // Auto replay if enabled
        if (this.elements.autoReplayToggle?.checked) {
            setTimeout(() => this.triggerInstantReplay(), 500);
        }

        // Simulate hot-spot if enabled
        if (this.elements.hotspotToggle?.checked) {
            this.hotSpotOverlay.simulateHeat('bat');
            this.hotSpotOverlay.render();
        }

        // Simulate ball tracking if enabled
        if (this.elements.ballTrackingToggle?.checked && !this.ballTracker.simulationActive) {
            this.ballTracker.startSimulation();
        }
    }

    addSpikeToHistory(spike) {
        const list = this.elements.spikeHistoryList;
        if (!list) return;

        const noSpikes = list.querySelector('.no-spikes');
        if (noSpikes) noSpikes.remove();

        const item = document.createElement('div');
        item.className = 'spike-item';
        item.innerHTML = `
            <div style="font-weight: bold; color: #00ff41;">${spike.formattedTime}</div>
            <div>Magnitude: ${(spike.magnitude * 100).toFixed(1)}%</div>
        `;

        list.insertBefore(item, list.firstChild);

        // Limit to 10 items
        while (list.children.length > 10) {
            list.removeChild(list.lastChild);
        }
    }

    async triggerInstantReplay() {
        try {
            const replay = await this.replayController.getInstantReplay();

            if (!replay) {
                alert('No replay data available. Buffer may be empty.');
                return;
            }

            // Show replay overlay
            const replayOverlay = document.getElementById('replayOverlay');
            const replayVideo = document.getElementById('replayVideo');

            if (replayOverlay && replayVideo) {
                replayVideo.src = URL.createObjectURL(replay);
                replayOverlay.style.display = 'flex';

                // Close replay
                document.getElementById('closeReplayBtn')?.addEventListener('click', () => {
                    replayOverlay.style.display = 'none';
                    URL.revokeObjectURL(replayVideo.src);
                }, { once: true });

                // Slow motion
                document.getElementById('playSlowMotionBtn')?.addEventListener('click', () => {
                    replayVideo.playbackRate = 0.25;
                    replayVideo.play();
                }, { once: true });

                this.logEvent('Instant replay triggered', 'system');
            }
        } catch (error) {
            console.error('Failed to create replay:', error);
            alert('Failed to create instant replay');
        }
    }

    reviewDecision() {
        const latestSpike = this.spikeDetector.getSpikeHistory().slice(-1)[0];
        const hotspotData = this.hotSpotOverlay.getDetectionData();
        const ballTrackingData = this.ballTracker ? this.ballTracker.getTrackingData() : null;

        const decision = this.decisionSystem.analyzeDecision({
            ultraEdge: latestSpike,
            hotSpot: hotspotData,
            ballTracking: ballTrackingData
        });

        // Update decision panel
        document.getElementById('liveUltraEdge').textContent = decision.breakdown.ultraEdge;
        document.getElementById('liveHotspot').textContent = decision.breakdown.hotSpot;
        document.getElementById('liveBallTrack').textContent = decision.breakdown.ballTracking;

        const decisionStatus = document.querySelector('#liveDecisionDisplay .decision-status');
        if (decisionStatus) {
            decisionStatus.textContent = decision.decision;
            decisionStatus.style.color = this.decisionSystem.getDecisionColor();
        }

        // Update confidence bar
        const confidenceFill = document.getElementById('confidenceFill');
        const confidenceText = document.getElementById('confidenceText');
        if (confidenceFill && confidenceText) {
            confidenceFill.style.width = `${decision.confidence}%`;
            confidenceText.textContent = `${decision.confidence}%`;
        }

        this.logEvent(`Decision: ${decision.decision} (${decision.confidence}%)`, 'decision');
    }

    logEvent(message, type = 'info') {
        this.eventLog.push({
            message: message,
            type: type,
            timestamp: new Date().toISOString()
        });

        const log = this.elements.eventLog;
        if (!log) return;

        const noEvents = log.querySelector('.no-events');
        if (noEvents) noEvents.remove();

        const item = document.createElement('div');
        item.className = 'event-item';
        item.innerHTML = `
            <div style="color: ${type === 'spike' ? '#ff3333' : '#00ff41'};">
                ${new Date().toLocaleTimeString()}: ${message}
            </div>
        `;

        log.insertBefore(item, log.firstChild);

        // Limit to 20 events
        while (log.children.length > 20) {
            log.removeChild(log.lastChild);
        }
    }

    async selectCamera(cameraType) {
        const devices = await this.liveStreamHandler.getAvailableDevices();
        // In production, show a device selection dialog
        console.log('Available cameras:', devices.video);
        alert(`${devices.video.length} camera(s) available. Advanced selection coming soon!`);
    }

    updateStatus(message, className = '') {
        const status = document.getElementById('systemStatusLive');
        if (status) {
            status.textContent = message;
            status.className = 'status-value';
            if (className) {
                status.classList.add(`status-${className}`);
            }
        }
    }

    startTimestampCounter() {
        const startTime = Date.now();

        this.timestampInterval = setInterval(() => {
            const elapsed = (Date.now() - startTime) / 1000;
            const hours = Math.floor(elapsed / 3600);
            const minutes = Math.floor((elapsed % 3600) / 60);
            const seconds = Math.floor(elapsed % 60);
            const ms = Math.floor((elapsed % 1) * 1000);

            const formatted = `${this.pad(hours)}:${this.pad(minutes)}:${this.pad(seconds)}.${this.pad(ms, 3)}`;
            document.getElementById('currentTime').textContent = formatted;
        }, 100);
    }

    stopTimestampCounter() {
        if (this.timestampInterval) {
            clearInterval(this.timestampInterval);
        }
    }

    pad(num, size = 2) {
        let s = String(num);
        while (s.length < size) s = '0' + s;
        return s;
    }
}

// Initialize app when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
    window.liveModeApp = new LiveModeApp();
});
