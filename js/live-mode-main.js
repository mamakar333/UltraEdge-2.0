/**
 * Live Mode Main Controller
 * Orchestrates all components for live stream monitoring
 * Supports VDO.ninja remote streams and local camera sources
 * Features: Tab audio capture, DVR scrubbing, slow motion playback
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
        this.vdoNinjaConnector = new VdoNinjaConnector();

        // State
        this.isMonitoring = false;
        this.currentSource = 'none'; // 'none', 'local', 'vdo-ninja'
        this.eventLog = [];

        // DVR state
        this.isDvrMode = false; // true = showing buffered playback, false = live
        this.dvrBlobUrl = null;
        this.dvrUpdateInterval = null;

        // Tab audio capture stream (for VDO.ninja audio)
        this.tabCaptureStream = null;

        this.init();
    }

    async init() {
        console.log('LiveModeApp init() called');

        // Get UI elements
        this.elements = {
            // Video feeds
            mainCameraFeed: document.getElementById('mainCameraFeed'),
            dvrPlaybackVideo: document.getElementById('dvrPlaybackVideo'),
            // Canvases
            liveWaveformCanvas: document.getElementById('liveWaveformCanvas'),
            liveHotspotCanvas: document.getElementById('liveHotspotCanvas'),
            ballTrackingViz: document.getElementById('ballTrackingViz'),
            // Controls
            startMonitoringBtn: document.getElementById('startMonitoringBtn'),
            stopMonitoringBtn: document.getElementById('stopMonitoringBtn'),
            instantReplayLiveBtn: document.getElementById('instantReplayLiveBtn'),
            reviewDecisionBtn: document.getElementById('reviewDecisionBtn'),
            captureFrameBtn: document.getElementById('captureFrameBtn'),
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
            // Source selection modal
            sourceSelectionModal: document.getElementById('sourceSelectionModal'),
            closeSourceModalBtn: document.getElementById('closeSourceModalBtn'),
            selectLocalCameraBtn: document.getElementById('selectLocalCameraBtn'),
            vdoNinjaUrl: document.getElementById('vdoNinjaUrl'),
            connectVdoBtn: document.getElementById('connectVdoBtn'),
            connectionDot: document.getElementById('connectionDot'),
            connectionStatusText: document.getElementById('connectionStatusText'),
            // Connection badge in feed header
            mainCameraConnectionBadge: document.getElementById('mainCameraConnectionBadge'),
            mainCameraConnectionText: document.getElementById('mainCameraConnectionText'),
            // DVR controls
            dvrControls: document.getElementById('dvrControls'),
            dvrTimeline: document.getElementById('dvrTimeline'),
            dvrCurrentTime: document.getElementById('dvrCurrentTime'),
            dvrTotalTime: document.getElementById('dvrTotalTime'),
            dvrLiveBtn: document.getElementById('dvrLiveBtn'),
            dvrPlayPauseBtn: document.getElementById('dvrPlayPauseBtn'),
            dvrStepBackBtn: document.getElementById('dvrStepBackBtn'),
            dvrStepFwdBtn: document.getElementById('dvrStepFwdBtn'),
            // Status bar (event log & spike history are commented out in HTML)
            eventLog: document.getElementById('eventLog'),
            spikeHistoryList: document.getElementById('spikeHistoryList')
        };

        console.log('Elements:', this.elements.selectMainCameraBtn ? 'Found' : 'NOT FOUND');

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
            const size = parseInt(e.target.value);
            this.replayController.setBufferSize(size);
            this.audioProcessor.setRollingBufferDuration(size);
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

        // Replay & Review
        this.elements.instantReplayLiveBtn?.addEventListener('click', () => this.triggerInstantReplay());
        this.elements.reviewDecisionBtn?.addEventListener('click', () => this.reviewDecision());

        // Capture frame
        this.elements.captureFrameBtn?.addEventListener('click', () => this.captureFrame());

        // Camera selection - opens source modal
        console.log('Setting up selectMainCameraBtn listener, element:', this.elements.selectMainCameraBtn);
        this.elements.selectMainCameraBtn?.addEventListener('click', () => {
            console.log('Select Source button clicked!');
            this.selectCamera('main');
        });

        // Source selection modal
        this.elements.closeSourceModalBtn?.addEventListener('click', () => this.hideSourceSelectionModal());
        this.elements.selectLocalCameraBtn?.addEventListener('click', () => this.selectLocalCamera());
        this.elements.connectVdoBtn?.addEventListener('click', () => this.connectVdoNinja());

        // Close modal on overlay click
        this.elements.sourceSelectionModal?.addEventListener('click', (e) => {
            if (e.target === this.elements.sourceSelectionModal) {
                this.hideSourceSelectionModal();
            }
        });

        // Allow Enter key to connect VDO.ninja
        this.elements.vdoNinjaUrl?.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') this.connectVdoNinja();
        });

        // DVR controls
        this.setupDvrEventListeners();
    }

    setupDvrEventListeners() {
        // Timeline slider - user drags to scrub
        this.elements.dvrTimeline?.addEventListener('input', (e) => {
            this.onDvrTimelineInput(parseFloat(e.target.value));
        });

        // LIVE button
        this.elements.dvrLiveBtn?.addEventListener('click', () => this.jumpToLive());

        // Play/Pause
        this.elements.dvrPlayPauseBtn?.addEventListener('click', () => this.toggleDvrPlayPause());

        // Step back/forward
        this.elements.dvrStepBackBtn?.addEventListener('click', () => this.dvrStep(-5));
        this.elements.dvrStepFwdBtn?.addEventListener('click', () => this.dvrStep(5));

        // Speed buttons
        document.querySelectorAll('.dvr-speed-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const speed = parseFloat(e.target.dataset.speed);
                this.setDvrPlaybackSpeed(speed);
                // Update active state
                document.querySelectorAll('.dvr-speed-btn').forEach(b => b.classList.remove('active'));
                e.target.classList.add('active');
            });
        });
    }

    initializeVisualizers() {
        this.waveformVisualizer = new WaveformVisualizer(this.elements.liveWaveformCanvas);
        this.hotSpotOverlay = new HotSpotOverlay(this.elements.liveHotspotCanvas);
        this.ballTracker = new BallTracker(this.elements.ballTrackingViz);

        this.hotSpotOverlay.initialize();

        console.log('Visualizers initialized');
    }

    // =========================================================================
    // Source Selection
    // =========================================================================

    selectCamera(cameraType) {
        if (cameraType === 'main') {
            this.showSourceSelectionModal();
        }
    }

    showSourceSelectionModal() {
        console.log('showSourceSelectionModal() called');
        const modal = this.elements.sourceSelectionModal;
        console.log('Modal element:', modal);
        if (modal) {
            modal.style.display = 'flex';
            this.updateModalConnectionStatus();
        } else {
            console.error('Source selection modal not found!');
        }
    }

    hideSourceSelectionModal() {
        const modal = this.elements.sourceSelectionModal;
        if (modal) {
            modal.style.display = 'none';
        }
    }

    updateModalConnectionStatus() {
        const dot = this.elements.connectionDot;
        const text = this.elements.connectionStatusText;
        if (!dot || !text) return;

        dot.className = 'connection-dot';

        if (this.currentSource === 'vdo-ninja' && this.vdoNinjaConnector.isConnected) {
            dot.classList.add('connected');
            text.textContent = 'Connected to VDO.ninja';
        } else if (this.currentSource === 'local' && this.liveStreamHandler.isActive()) {
            dot.classList.add('connected');
            text.textContent = 'Local Camera Active';
        } else {
            text.textContent = 'Not Connected';
        }
    }

    async selectLocalCamera() {
        try {
            // Disconnect VDO.ninja if active
            if (this.currentSource === 'vdo-ninja') {
                this.vdoNinjaConnector.disconnect();
                this.elements.mainCameraFeed.style.display = 'block';
            }

            const cameraStarted = await this.liveStreamHandler.startCamera(this.elements.mainCameraFeed);
            if (cameraStarted) {
                this.currentSource = 'local';
                this.updateSourceUI('local');
                this.hideSourceSelectionModal();
                this.logEvent('Local camera connected', 'system');
            }
        } catch (error) {
            console.error('Failed to select local camera:', error);
            this.logEvent('Failed to connect local camera', 'error');
        }
    }

    async connectVdoNinja() {
        const urlInput = this.elements.vdoNinjaUrl;
        const url = urlInput?.value.trim();

        if (!url) {
            alert('Please enter a VDO.ninja URL');
            return;
        }

        if (!url.includes('vdo.ninja')) {
            alert('Please enter a valid VDO.ninja URL (e.g., https://vdo.ninja/?view=STREAM_ID)');
            return;
        }

        try {
            // Update modal status to connecting
            if (this.elements.connectionDot) {
                this.elements.connectionDot.className = 'connection-dot connecting';
            }
            if (this.elements.connectionStatusText) {
                this.elements.connectionStatusText.textContent = 'Connecting...';
            }

            // Stop local camera if active
            if (this.currentSource === 'local') {
                this.liveStreamHandler.stopCamera();
            }

            // Hide the <video> element, show iframe instead
            this.elements.mainCameraFeed.style.display = 'none';

            // Get the video-container div
            const videoContainer = this.elements.mainCameraFeed.parentElement;

            // Setup callbacks
            this.vdoNinjaConnector.onConnectionChange = (connected, info) => {
                if (connected) {
                    this.currentSource = 'vdo-ninja';
                    this.updateSourceUI('vdo-ninja');
                    this.logEvent('VDO.ninja stream connected', 'system');

                    // Request the MediaStream from VDO.ninja
                    setTimeout(() => {
                        this.vdoNinjaConnector.requestStream();
                    }, 1000);

                    // Show LIVE indicator
                    const liveIndicator = document.getElementById('liveIndicator');
                    if (liveIndicator) liveIndicator.style.display = 'flex';
                } else {
                    this.currentSource = 'none';
                    this.updateSourceUI('none');
                    this.logEvent('VDO.ninja stream disconnected', 'system');
                }
                this.updateModalConnectionStatus();
            };

            // Callback when VDO.ninja sends us the MediaStream
            this.vdoNinjaConnector.onStreamReceived = (stream) => {
                console.log('VDO.ninja MediaStream received!', stream);
                this.logEvent('VDO.ninja MediaStream received with audio', 'system');
            };

            this.vdoNinjaConnector.onError = (error) => {
                this.logEvent('VDO.ninja error: ' + error.message, 'error');
                if (this.elements.connectionDot) {
                    this.elements.connectionDot.className = 'connection-dot error';
                }
                if (this.elements.connectionStatusText) {
                    this.elements.connectionStatusText.textContent = 'Connection Error';
                }
            };

            // Connect
            this.vdoNinjaConnector.connect(url, videoContainer);
            this.hideSourceSelectionModal();

        } catch (error) {
            console.error('Failed to connect VDO.ninja:', error);
            alert('Failed to connect to VDO.ninja: ' + error.message);
        }
    }

    updateSourceUI(sourceType) {
        const badge = this.elements.mainCameraConnectionBadge;
        const badgeText = this.elements.mainCameraConnectionText;
        const activeCameras = document.getElementById('activeCameras');
        const liveIndicator = document.getElementById('liveIndicator');

        if (sourceType === 'vdo-ninja') {
            if (badge) {
                badge.style.display = 'inline-flex';
                badge.classList.add('vdo-connected');
            }
            if (badgeText) badgeText.textContent = 'VDO.ninja';
            if (liveIndicator) liveIndicator.style.display = 'flex';
        } else if (sourceType === 'local') {
            if (badge) {
                badge.style.display = 'inline-flex';
                badge.classList.remove('vdo-connected');
            }
            if (badgeText) badgeText.textContent = 'Local';
            if (liveIndicator) liveIndicator.style.display = 'flex';
        } else {
            if (badge) badge.style.display = 'none';
            if (liveIndicator) liveIndicator.style.display = 'none';
        }

        if (activeCameras) {
            const count = (sourceType !== 'none') ? 1 : 0;
            activeCameras.textContent = `${count}/4`;
        }
    }

    // =========================================================================
    // Monitoring
    // =========================================================================

    /**
     * Capture tab audio (for VDO.ninja stream audio)
     * This captures the audio that's currently playing in the browser tab
     * @returns {Promise<MediaStream|null>} The captured stream or null if failed
     */
    async captureTabAudio() {
        try {
            console.log('Requesting tab audio capture...');

            const stream = await navigator.mediaDevices.getDisplayMedia({
                video: true,  // Required by Chrome, we'll use for DVR too
                audio: {
                    echoCancellation: false,
                    noiseSuppression: false,
                    autoGainControl: false
                },
                preferCurrentTab: true  // Pre-select current tab
            });

            console.log('Tab capture successful!');
            console.log('Audio tracks:', stream.getAudioTracks().length);
            console.log('Video tracks:', stream.getVideoTracks().length);

            this.tabCaptureStream = stream;
            return stream;

        } catch (error) {
            console.error('Tab capture failed:', error);
            if (error.name === 'NotAllowedError') {
                alert('Tab capture permission denied.\n\nTo capture VDO.ninja audio, please:\n1. Click "Current Tab"\n2. Check "Share audio"\n3. Click "Share"');
            }
            return null;
        }
    }

    /**
     * Wait for VDO.ninja stream to become available with timeout
     * @param {number} timeoutMs - Timeout in milliseconds
     * @returns {Promise<MediaStream|null>} The MediaStream or null if timeout
     */
    async waitForVdoNinjaStream(timeoutMs = 10000) {
        const startTime = Date.now();
        const checkInterval = 200; // Check every 200ms

        while (Date.now() - startTime < timeoutMs) {
            const stream = this.vdoNinjaConnector.getMediaStream();

            if (stream) {
                // Stream found!
                const hasAudio = stream.getAudioTracks().length > 0;
                const hasVideo = stream.getVideoTracks().length > 0;
                console.log(`VDO.ninja stream found after ${Date.now() - startTime}ms - Audio: ${hasAudio}, Video: ${hasVideo}`);
                return stream;
            }

            // Wait before checking again
            await new Promise(resolve => setTimeout(resolve, checkInterval));
        }

        // Timeout - stream not available
        console.warn(`VDO.ninja stream not available after ${timeoutMs}ms timeout`);
        return null;
    }

    async startMonitoring() {
        try {
            this.updateStatus('Initializing...', 'active');

            // Require a source to be selected before monitoring
            if (this.currentSource === 'none') {
                alert('Please select a video source first.\n\nClick "SELECT SOURCE" to choose:\n• Local Camera (your device camera)\n• VDO.ninja (remote stream from phone/camera)');
                this.updateStatus('No source selected', 'error');
                return;
            }

            let audioInitialized = false;

            if (this.currentSource === 'vdo-ninja') {
                // For VDO.ninja: Capture the tab audio (the audio you're hearing)
                this.updateStatus('Requesting tab audio capture...', 'active');
                this.logEvent('Capturing tab audio (VDO.ninja stream audio)...', 'system');

                const tabStream = await this.captureTabAudio();

                if (tabStream && tabStream.getAudioTracks().length > 0) {
                    // Success! Use the captured tab audio for spike detection
                    audioInitialized = await this.audioProcessor.initializeFromStream(tabStream);
                    // Also use it for DVR recording (video + audio recorded, but not displayed)
                    this.replayController.startRecordingFromStream(tabStream);
                    this.logEvent('✓ Using Saramonic mic audio (via tab capture)', 'system');
                    console.log('Tab capture: Recording video+audio for DVR, using audio for spike detection');
                    console.log('Display: VDO.ninja iframe remains visible (tab capture NOT displayed)');
                } else {
                    // Tab capture failed
                    alert('Failed to capture tab audio.\n\nYou need to:\n1. Allow tab sharing\n2. Make sure "Share audio" is checked\n\nPlease try again.');
                    this.updateStatus('Tab capture failed', 'error');
                    return;
                }
            } else if (this.currentSource === 'local') {
                // For local camera: use microphone audio
                audioInitialized = await this.audioProcessor.initialize();
            } else {
                alert('Unknown source type. Please select a source again.');
                this.updateStatus('Invalid source', 'error');
                return;
            }

            if (!audioInitialized) {
                this.updateStatus('Failed to initialize audio', 'error');
                return;
            }

            // Setup audio data callbacks
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
            if (this.currentSource === 'local') {
                this.replayController.startRecording(this.elements.mainCameraFeed);
            }
            // For VDO.ninja, DVR recording already started above if stream is available

            // Show DVR controls
            if (this.elements.dvrControls) {
                this.elements.dvrControls.style.display = 'block';
            }

            // Ensure DVR playback video is hidden (only VDO.ninja iframe or camera should be visible)
            if (this.elements.dvrPlaybackVideo) {
                this.elements.dvrPlaybackVideo.style.setProperty('display', 'none', 'important');
                console.log('DVR playback video hidden - showing live feed only');
            }

            // Update UI
            this.isMonitoring = true;
            this.elements.startMonitoringBtn.disabled = true;
            this.elements.stopMonitoringBtn.disabled = false;
            this.elements.instantReplayLiveBtn.disabled = false;
            this.elements.reviewDecisionBtn.disabled = false;
            if (this.elements.captureFrameBtn) this.elements.captureFrameBtn.disabled = false;

            document.querySelector('.main-container').classList.add('monitoring');

            this.updateStatus('LIVE MONITORING', 'active');
            this.logEvent('Monitoring started', 'system');

            const vdoStream = this.vdoNinjaConnector.getMediaStream();
            const audioSource = this.currentSource === 'vdo-ninja' && vdoStream ?
                'VDO.ninja stream (direct)' :
                (this.currentSource === 'vdo-ninja' ? 'microphone (VDO.ninja stream pending)' : 'microphone');
            this.logEvent(`Audio source: ${audioSource} (${this.audioProcessor.getSampleRate()}Hz)`, 'system');

            // Start timestamp counter & buffer status updater
            this.startTimestampCounter();
            this.startBufferStatusUpdater();
            this.startDvrTimelineUpdater();

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

        // Stop tab capture stream if active (VDO.ninja audio)
        if (this.tabCaptureStream) {
            this.tabCaptureStream.getTracks().forEach(track => track.stop());
            this.tabCaptureStream = null;
            console.log('Tab capture stream stopped');
        }

        // Only stop local camera if that's the source — VDO.ninja stays connected
        if (this.currentSource === 'local') {
            this.liveStreamHandler.stopCamera();
            this.currentSource = 'none';
            this.updateSourceUI('none');
        }

        this.replayController.stopRecording();

        // Exit DVR mode if active
        if (this.isDvrMode) {
            this.jumpToLive();
        }

        // Hide DVR controls
        if (this.elements.dvrControls) {
            this.elements.dvrControls.style.display = 'none';
        }

        this.isMonitoring = false;
        this.elements.startMonitoringBtn.disabled = false;
        this.elements.stopMonitoringBtn.disabled = true;
        this.elements.instantReplayLiveBtn.disabled = true;
        this.elements.reviewDecisionBtn.disabled = true;
        if (this.elements.captureFrameBtn) this.elements.captureFrameBtn.disabled = true;

        document.querySelector('.main-container').classList.remove('monitoring');

        this.updateStatus('Stopped', '');
        this.logEvent('Monitoring stopped', 'system');
        this.stopTimestampCounter();
        this.stopBufferStatusUpdater();
        this.stopDvrTimelineUpdater();

        console.log('Live monitoring stopped');
    }

    // =========================================================================
    // DVR Scrubbing & Slow Motion
    // =========================================================================

    /**
     * Called when user drags the DVR timeline slider
     */
    onDvrTimelineInput(value) {
        const maxVal = parseFloat(this.elements.dvrTimeline.max);

        // If slider is at the max (live edge), return to live
        if (value >= maxVal - 0.5) {
            this.jumpToLive();
            return;
        }

        // Enter DVR mode
        if (!this.isDvrMode) {
            this.enterDvrMode();
        }

        // Seek DVR video to the position
        const dvrVideo = this.elements.dvrPlaybackVideo;
        if (dvrVideo && dvrVideo.duration && isFinite(dvrVideo.duration)) {
            const seekTime = (value / maxVal) * dvrVideo.duration;
            dvrVideo.currentTime = seekTime;
        }
    }

    /**
     * Enter DVR mode — swap from live iframe/video to buffered playback
     */
    enterDvrMode() {
        if (this.isDvrMode) return;
        this.isDvrMode = true;

        // Create blob from DVR buffer
        const blob = this.replayController.getDvrBlob();
        if (!blob) {
            console.warn('No DVR data available');
            return;
        }

        // Revoke previous URL
        if (this.dvrBlobUrl) {
            URL.revokeObjectURL(this.dvrBlobUrl);
        }
        this.dvrBlobUrl = URL.createObjectURL(blob);

        const dvrVideo = this.elements.dvrPlaybackVideo;
        if (dvrVideo) {
            dvrVideo.src = this.dvrBlobUrl;
            dvrVideo.style.setProperty('display', 'block', 'important'); // Override CSS !important
            dvrVideo.muted = false;
            dvrVideo.play();
        }

        // Hide live feed (iframe or local video)
        if (this.currentSource === 'vdo-ninja') {
            const iframe = this.vdoNinjaConnector.getIframe();
            if (iframe) {
                iframe.style.display = 'none';
                console.log('DVR mode: Hiding VDO.ninja iframe, showing DVR playback');
            }
        } else {
            this.elements.mainCameraFeed.style.display = 'none';
        }

        // Update LIVE button
        if (this.elements.dvrLiveBtn) {
            this.elements.dvrLiveBtn.classList.remove('active');
        }

        // Update play/pause button
        if (this.elements.dvrPlayPauseBtn) {
            this.elements.dvrPlayPauseBtn.innerHTML = '&#9646;&#9646; Pause';
        }

        this.logEvent('DVR scrubbing activated', 'system');
    }

    /**
     * Jump back to live edge
     */
    jumpToLive() {
        if (!this.isDvrMode) return;
        this.isDvrMode = false;

        const dvrVideo = this.elements.dvrPlaybackVideo;
        if (dvrVideo) {
            dvrVideo.pause();
            dvrVideo.src = '';
            dvrVideo.style.setProperty('display', 'none', 'important'); // Force hidden
        }

        if (this.dvrBlobUrl) {
            URL.revokeObjectURL(this.dvrBlobUrl);
            this.dvrBlobUrl = null;
        }

        // Show live feed again
        if (this.currentSource === 'vdo-ninja') {
            const iframe = this.vdoNinjaConnector.getIframe();
            if (iframe) {
                iframe.style.display = 'block';
                console.log('LIVE mode: Showing VDO.ninja iframe, DVR playback hidden');
            }
        } else {
            this.elements.mainCameraFeed.style.display = 'block';
        }

        // Reset slider to max
        if (this.elements.dvrTimeline) {
            this.elements.dvrTimeline.value = this.elements.dvrTimeline.max;
        }

        // Update LIVE button
        if (this.elements.dvrLiveBtn) {
            this.elements.dvrLiveBtn.classList.add('active');
        }

        // Reset speed buttons to 1x
        document.querySelectorAll('.dvr-speed-btn').forEach(b => b.classList.remove('active'));
        const btn1x = document.querySelector('.dvr-speed-btn[data-speed="1"]');
        if (btn1x) btn1x.classList.add('active');

        this.logEvent('Returned to LIVE', 'system');
    }

    toggleDvrPlayPause() {
        const dvrVideo = this.elements.dvrPlaybackVideo;
        if (!dvrVideo || !this.isDvrMode) return;

        if (dvrVideo.paused) {
            dvrVideo.play();
            if (this.elements.dvrPlayPauseBtn) {
                this.elements.dvrPlayPauseBtn.innerHTML = '&#9646;&#9646; Pause';
            }
        } else {
            dvrVideo.pause();
            if (this.elements.dvrPlayPauseBtn) {
                this.elements.dvrPlayPauseBtn.innerHTML = '&#9654; Play';
            }
        }
    }

    dvrStep(seconds) {
        const dvrVideo = this.elements.dvrPlaybackVideo;

        if (!this.isDvrMode) {
            // If in live mode and stepping back, enter DVR mode first
            this.enterDvrMode();
            if (!dvrVideo) return;

            // Wait for video metadata to load then seek
            dvrVideo.addEventListener('loadedmetadata', () => {
                dvrVideo.currentTime = Math.max(0, dvrVideo.duration + seconds);
            }, { once: true });
            return;
        }

        if (dvrVideo && dvrVideo.duration) {
            dvrVideo.currentTime = Math.max(0, Math.min(dvrVideo.duration, dvrVideo.currentTime + seconds));
        }
    }

    setDvrPlaybackSpeed(speed) {
        const dvrVideo = this.elements.dvrPlaybackVideo;
        if (dvrVideo) {
            dvrVideo.playbackRate = speed;
        }

        // If not in DVR mode yet but user selected a speed, enter DVR
        if (!this.isDvrMode && speed !== 1) {
            this.enterDvrMode();
        }
    }

    /**
     * Periodically update the DVR timeline display
     */
    startDvrTimelineUpdater() {
        this.dvrUpdateInterval = setInterval(() => {
            const bufferDuration = this.replayController.getDvrBufferDuration();

            // Update total time display
            if (this.elements.dvrTotalTime) {
                this.elements.dvrTotalTime.textContent = this.formatDvrTime(bufferDuration);
            }

            if (this.isDvrMode) {
                // In DVR mode, update current time from video position
                const dvrVideo = this.elements.dvrPlaybackVideo;
                if (dvrVideo && dvrVideo.duration && isFinite(dvrVideo.duration)) {
                    if (this.elements.dvrCurrentTime) {
                        this.elements.dvrCurrentTime.textContent = this.formatDvrTime(dvrVideo.currentTime);
                    }
                    // Update slider position
                    if (this.elements.dvrTimeline) {
                        const pct = (dvrVideo.currentTime / dvrVideo.duration) * 100;
                        this.elements.dvrTimeline.value = pct;
                    }
                }
            } else {
                // In live mode, current time = total time (live edge)
                if (this.elements.dvrCurrentTime) {
                    this.elements.dvrCurrentTime.textContent = this.formatDvrTime(bufferDuration);
                }
                if (this.elements.dvrTimeline) {
                    this.elements.dvrTimeline.value = this.elements.dvrTimeline.max;
                }
            }
        }, 500);
    }

    stopDvrTimelineUpdater() {
        if (this.dvrUpdateInterval) {
            clearInterval(this.dvrUpdateInterval);
            this.dvrUpdateInterval = null;
        }
    }

    formatDvrTime(seconds) {
        if (!seconds || !isFinite(seconds)) return '00:00';
        const m = Math.floor(seconds / 60);
        const s = Math.floor(seconds % 60);
        return `${this.pad(m)}:${this.pad(s)}`;
    }

    // =========================================================================
    // Spike Detection & Handling
    // =========================================================================

    handleLiveSpike(spike) {
        console.log('Live spike detected:', spike);

        // Extract +/- 100ms audio window around the spike from rolling buffer
        const spikeWindow = this.audioProcessor.getAudioWindowAroundTimestamp(
            spike.timestamp,
            0.1
        );
        spike.audioWindow = spikeWindow;

        // Mark spike in replay buffer
        this.replayController.markSpike(spike.timestamp, {
            magnitude: spike.magnitude,
            rms: spike.rms
        });

        // Update counter
        const count = this.spikeDetector.getSpikeCount();
        document.getElementById('liveSpikesCount').textContent = count;

        // Visualize spike line
        const spikeLine = document.getElementById('spikeLine');
        if (spikeLine) {
            spikeLine.style.display = 'block';
            setTimeout(() => {
                spikeLine.style.display = 'none';
            }, 1000);
        }

        // Log event with window info
        const windowInfo = spikeWindow.empty ? '' : ` (window: ${spikeWindow.sampleCount} samples)`;
        this.logEvent(`Spike detected: ${(spike.magnitude * 100).toFixed(1)}%${windowInfo}`, 'spike');

        // Update last spike time
        document.getElementById('lastSpikeTime').textContent = spike.formattedTime;

        // Update ball speed display with simulated data based on spike magnitude
        const ballSpeedDisplay = document.getElementById('ballSpeedDisplay');
        if (ballSpeedDisplay) {
            const speed = Math.floor(80 + spike.magnitude * 80); // 80-160 km/h range
            ballSpeedDisplay.querySelector('span').textContent = `${speed} km/h`;
        }

        // Update impact zone display
        const impactZoneDisplay = document.getElementById('impactZoneDisplay');
        if (impactZoneDisplay) {
            const zones = ['Middle', 'Edge', 'Top Edge', 'Bottom Edge', 'Pad'];
            const zone = zones[Math.floor(Math.random() * zones.length)];
            impactZoneDisplay.querySelector('span').textContent = zone;
        }

        // Update Ultra Edge indicator in decision panel
        document.getElementById('liveUltraEdge').textContent = 'DETECTED';
        document.getElementById('liveUltraEdge').style.color = '#ff3333';

        // Auto replay if enabled
        if (this.elements.autoReplayToggle?.checked) {
            setTimeout(() => this.triggerInstantReplay(), 500);
        }

        // Simulate hot-spot if enabled
        if (this.elements.hotspotToggle?.checked) {
            this.hotSpotOverlay.simulateHeat('bat');
            this.hotSpotOverlay.render();
            document.getElementById('liveHotspot').textContent = 'CONTACT';
            document.getElementById('liveHotspot').style.color = '#ff3333';
        }

        // Simulate ball tracking if enabled
        if (this.elements.ballTrackingToggle?.checked && !this.ballTracker.simulationActive) {
            this.ballTracker.startSimulation();
            document.getElementById('liveBallTrack').textContent = 'IMPACT';
            document.getElementById('liveBallTrack').style.color = '#ffaa00';
        }
    }

    // =========================================================================
    // Replay & Decision
    // =========================================================================

    async triggerInstantReplay() {
        try {
            const replay = await this.replayController.getInstantReplay();

            if (!replay) {
                this.logEvent('No replay data available - buffer may be empty', 'system');
                return;
            }

            // Show replay overlay
            const replayOverlay = document.getElementById('replayOverlay');
            const replayVideo = document.getElementById('replayVideo');

            if (replayOverlay && replayVideo) {
                replayVideo.src = URL.createObjectURL(replay);
                replayOverlay.style.display = 'flex';
                replayVideo.playbackRate = 1;
                replayVideo.play();

                // Close replay
                document.getElementById('closeReplayBtn')?.addEventListener('click', () => {
                    replayOverlay.style.display = 'none';
                    replayVideo.pause();
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
            this.logEvent('Failed to create instant replay', 'error');
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

    captureFrame() {
        try {
            if (this.currentSource === 'local') {
                const video = this.elements.mainCameraFeed;
                if (!video.videoWidth) {
                    this.logEvent('No video data to capture', 'system');
                    return;
                }
                const canvas = document.createElement('canvas');
                canvas.width = video.videoWidth;
                canvas.height = video.videoHeight;
                const ctx = canvas.getContext('2d');
                ctx.drawImage(video, 0, 0);

                const link = document.createElement('a');
                link.download = `ultra-edge-frame-${Date.now()}.png`;
                link.href = canvas.toDataURL('image/png');
                link.click();

                this.logEvent('Frame captured and saved', 'system');
            } else {
                this.logEvent('Frame capture only available for local camera source', 'system');
            }
        } catch (error) {
            console.error('Failed to capture frame:', error);
            this.logEvent('Frame capture failed', 'error');
        }
    }

    // =========================================================================
    // Event Log (gracefully handles missing DOM elements)
    // =========================================================================

    logEvent(message, type = 'info') {
        this.eventLog.push({
            message: message,
            type: type,
            timestamp: new Date().toISOString()
        });

        // Log to console since event log panel is hidden
        const prefix = type === 'spike' ? '[SPIKE]' : type === 'error' ? '[ERROR]' : '[INFO]';
        console.log(`${prefix} ${message}`);

        const log = this.elements.eventLog;
        if (!log) return;

        const noEvents = log.querySelector('.no-events');
        if (noEvents) noEvents.remove();

        const item = document.createElement('div');
        item.className = 'event-item';
        const colorMap = { spike: '#ff3333', error: '#ff3333', decision: '#ffaa00' };
        const color = colorMap[type] || '#00ff41';
        item.innerHTML = `
            <div style="color: ${color};">
                ${new Date().toLocaleTimeString()}: ${message}
            </div>
        `;

        log.insertBefore(item, log.firstChild);

        // Limit to 20 events
        while (log.children.length > 20) {
            log.removeChild(log.lastChild);
        }
    }

    // =========================================================================
    // Status & Timers
    // =========================================================================

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

    startBufferStatusUpdater() {
        this.bufferStatusInterval = setInterval(() => {
            const bufferDuration = this.audioProcessor.getRollingBufferDuration();
            const bufferStatus = document.getElementById('bufferStatus');
            if (bufferStatus) {
                bufferStatus.textContent = `${bufferDuration.toFixed(0)}s`;
            }

            // Update FPS display
            const fpsDisplay = document.getElementById('liveFps');
            if (fpsDisplay) {
                fpsDisplay.textContent = '60';
            }
        }, 1000);
    }

    stopBufferStatusUpdater() {
        if (this.bufferStatusInterval) {
            clearInterval(this.bufferStatusInterval);
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
