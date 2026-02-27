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
        this.liveStreamHandler = new LiveStreamHandler();
        this.vdoNinjaConnector = new VdoNinjaConnector(); // iframe mode (legacy)
        this.vdoNinjaSdkConnector = new VdoNinjaSdkConnector(); // SDK mode (recommended)

        // State
        this.isMonitoring = false;
        this.currentSource = 'none'; // 'none', 'local', 'vdo-ninja', 'vdo-ninja-sdk'
        this.vdoNinjaMode = 'sdk'; // 'sdk' or 'iframe'
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
            // Controls
            startMonitoringBtn: document.getElementById('startMonitoringBtn'),
            stopMonitoringBtn: document.getElementById('stopMonitoringBtn'),
            instantReplayLiveBtn: document.getElementById('instantReplayLiveBtn'),
            captureFrameBtn: document.getElementById('captureFrameBtn'),
            // Settings
            liveSensitivitySlider: document.getElementById('liveSensitivitySlider'),
            liveThresholdSlider: document.getElementById('liveThresholdSlider'),
            bufferSizeSlider: document.getElementById('bufferSizeSlider'),
            autoReplayToggle: document.getElementById('autoReplayToggle'),
            transparentBgLive: document.getElementById('transparentBgLive'),
            // Camera selects
            selectMainCameraBtn: document.getElementById('selectMainCameraBtn'),
            // Source selection modal
            sourceSelectionModal: document.getElementById('sourceSelectionModal'),
            closeSourceModalBtn: document.getElementById('closeSourceModalBtn'),
            selectLocalCameraBtn: document.getElementById('selectLocalCameraBtn'),
            // VDO.ninja mode toggle
            sdkModeBtn: document.getElementById('sdkModeBtn'),
            iframeModeBtn: document.getElementById('iframeModeBtn'),
            sdkModeContainer: document.getElementById('sdkModeContainer'),
            iframeModeContainer: document.getElementById('iframeModeContainer'),
            // VDO.ninja SDK mode elements
            vdoRoomName: document.getElementById('vdoRoomName'),
            connectSdkBtn: document.getElementById('connectSdkBtn'),
            // VDO.ninja iframe mode elements (legacy)
            vdoNinjaUrl: document.getElementById('vdoNinjaUrl'),
            connectVdoBtn: document.getElementById('connectVdoBtn'),
            // Shared connection status
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
        this.setupCleanupHandlers();

        // Diagnostic: Check for any existing audio/video elements or iframes
        this.checkForExistingMediaElements();

        console.log('Live Mode initialized');
    }

    /**
     * Diagnostic function to check for pre-existing media elements
     * Helps identify if audio is coming from somewhere unexpected
     */
    checkForExistingMediaElements() {
        const audioElements = document.querySelectorAll('audio');
        const videoElements = document.querySelectorAll('video');
        const iframes = document.querySelectorAll('iframe');

        console.log('=== MEDIA ELEMENTS DIAGNOSTIC ===');
        console.log('Audio elements found:', audioElements.length);
        console.log('Video elements found:', videoElements.length);
        console.log('Iframes found:', iframes.length);

        if (audioElements.length > 0) {
            audioElements.forEach((audio, idx) => {
                console.log(`Audio ${idx}:`, {
                    src: audio.src,
                    paused: audio.paused,
                    muted: audio.muted,
                    volume: audio.volume
                });
            });
        }

        if (videoElements.length > 0) {
            videoElements.forEach((video, idx) => {
                console.log(`Video ${idx}:`, {
                    id: video.id,
                    src: video.src,
                    srcObject: video.srcObject ? 'MediaStream attached' : 'None',
                    paused: video.paused,
                    muted: video.muted
                });
            });
        }

        if (iframes.length > 0) {
            iframes.forEach((iframe, idx) => {
                console.log(`Iframe ${idx}:`, {
                    id: iframe.id,
                    src: iframe.src || 'None',
                    display: iframe.style.display
                });
            });
        }

        console.log('=== END DIAGNOSTIC ===');

        // Warning if unexpected elements found
        if (iframes.length > 0 && !iframes[0].id) {
            console.warn('⚠️ Found unexpected iframe! This might be causing audio playback.');
        }
    }

    /**
     * Setup cleanup handlers for page unload/close
     * Ensures all connections and streams are properly closed
     */
    setupCleanupHandlers() {
        // Cleanup on page unload (browser close, refresh, navigate away)
        window.addEventListener('beforeunload', () => {
            console.log('Page unloading - cleaning up all connections');
            this.cleanup();
        });

        // Cleanup on visibility change (tab switch)
        document.addEventListener('visibilitychange', () => {
            if (document.hidden) {
                console.log('Page hidden - pausing monitoring if active');
            }
        });
    }

    /**
     * Complete cleanup - stop all streams and disconnect everything
     */
    cleanup() {
        console.log('Cleaning up LiveModeApp...');

        // Stop monitoring if active
        if (this.isMonitoring) {
            this.stopMonitoring();
        }

        // Disconnect VDO.ninja
        if (this.vdoNinjaConnector && this.currentSource === 'vdo-ninja') {
            console.log('Disconnecting VDO.ninja iframe');
            this.vdoNinjaConnector.disconnect();
        }

        // Stop local camera
        if (this.liveStreamHandler && this.currentSource === 'local') {
            console.log('Stopping local camera');
            this.liveStreamHandler.stopCamera();
        }

        // Stop tab capture stream
        if (this.tabCaptureStream) {
            console.log('Stopping tab capture stream');
            this.tabCaptureStream.getTracks().forEach(track => {
                track.stop();
                console.log('Stopped track:', track.kind);
            });
            this.tabCaptureStream = null;
        }

        // Dispose audio processor
        if (this.audioProcessor) {
            this.audioProcessor.dispose();
        }

        // Dispose replay controller
        if (this.replayController) {
            this.replayController.dispose();
        }

        console.log('Cleanup complete');
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

        // Replay & Review
        this.elements.instantReplayLiveBtn?.addEventListener('click', () => this.triggerInstantReplay());

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

        // VDO.ninja mode toggle
        this.elements.sdkModeBtn?.addEventListener('click', () => this.toggleVdoNinjaMode('sdk'));
        this.elements.iframeModeBtn?.addEventListener('click', () => this.toggleVdoNinjaMode('iframe'));

        // VDO.ninja SDK mode connection
        this.elements.connectSdkBtn?.addEventListener('click', () => this.connectVdoNinjaSdk());
        this.elements.vdoRoomName?.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') this.connectVdoNinjaSdk();
        });

        // VDO.ninja iframe mode connection (legacy)
        this.elements.connectVdoBtn?.addEventListener('click', () => this.connectVdoNinja());
        this.elements.vdoNinjaUrl?.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') this.connectVdoNinja();
        });

        // Close modal on overlay click
        this.elements.sourceSelectionModal?.addEventListener('click', (e) => {
            if (e.target === this.elements.sourceSelectionModal) {
                this.hideSourceSelectionModal();
            }
        });

        // DVR controls
        this.setupDvrEventListeners();
    }

    setupDvrEventListeners() {
        // Timeline slider - user drags to scrub
        // Track dragging state to prevent timeupdate from interfering
        this.isDraggingDvrSlider = false;

        this.elements.dvrTimeline?.addEventListener('mousedown', () => {
            this.isDraggingDvrSlider = true;
        });

        this.elements.dvrTimeline?.addEventListener('mouseup', () => {
            this.isDraggingDvrSlider = false;
        });

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

    /**
     * Toggle between SDK and iframe mode for VDO.ninja
     */
    toggleVdoNinjaMode(mode) {
        this.vdoNinjaMode = mode;

        if (mode === 'sdk') {
            // Show SDK mode UI
            if (this.elements.sdkModeContainer) this.elements.sdkModeContainer.style.display = 'block';
            if (this.elements.iframeModeContainer) this.elements.iframeModeContainer.style.display = 'none';

            // Update button styles
            if (this.elements.sdkModeBtn) {
                this.elements.sdkModeBtn.style.background = '#00ff41';
                this.elements.sdkModeBtn.style.color = '#000';
            }
            if (this.elements.iframeModeBtn) {
                this.elements.iframeModeBtn.style.background = '';
                this.elements.iframeModeBtn.style.color = '';
                this.elements.iframeModeBtn.classList.add('btn-secondary');
            }
        } else {
            // Show iframe mode UI
            if (this.elements.sdkModeContainer) this.elements.sdkModeContainer.style.display = 'none';
            if (this.elements.iframeModeContainer) this.elements.iframeModeContainer.style.display = 'block';

            // Update button styles
            if (this.elements.iframeModeBtn) {
                this.elements.iframeModeBtn.style.background = '#00ff41';
                this.elements.iframeModeBtn.style.color = '#000';
                this.elements.iframeModeBtn.classList.remove('btn-secondary');
            }
            if (this.elements.sdkModeBtn) {
                this.elements.sdkModeBtn.style.background = '';
                this.elements.sdkModeBtn.style.color = '';
            }
        }

        console.log('VDO.ninja mode set to:', mode);
    }

    /**
     * Connect to VDO.ninja using SDK mode (direct MediaStream access)
     */
    async connectVdoNinjaSdk() {
        const roomInput = this.elements.vdoRoomName;
        const roomName = roomInput?.value.trim();

        if (!roomName) {
            alert('Please enter a room name');
            return;
        }

        try {
            // Update modal status to connecting
            if (this.elements.connectionDot) {
                this.elements.connectionDot.className = 'connection-dot connecting';
            }
            if (this.elements.connectionStatusText) {
                this.elements.connectionStatusText.textContent = 'Connecting to room...';
            }

            // Stop local camera if active
            if (this.currentSource === 'local') {
                this.liveStreamHandler.stopCamera();
            }

            // Show the main video feed (we'll use it for SDK video)
            // Keep muted=true so the browser's autoplay policy allows the video
            // to play immediately. Audio is handled via AudioContext which does
            // not require the video element to be unmuted.
            this.elements.mainCameraFeed.style.display = 'block';
            console.log('✅ Main video feed prepared for SDK:', this.elements.mainCameraFeed.id);
            console.log('   Display:', this.elements.mainCameraFeed.style.display);
            console.log('   Dimensions:', this.elements.mainCameraFeed.offsetWidth, 'x', this.elements.mainCameraFeed.offsetHeight);

            // Initialize SDK if not already done
            await this.vdoNinjaSdkConnector.init();

            // Setup callbacks
            this.vdoNinjaSdkConnector.onConnectionChange = (connected, info) => {
                if (connected) {
                    if (this.elements.connectionDot) {
                        this.elements.connectionDot.className = 'connection-dot connected';
                    }
                    if (this.elements.connectionStatusText) {
                        this.elements.connectionStatusText.textContent = `Connected to room: ${info.room}`;
                    }
                    this.logEvent(`Connected to VDO.ninja room: ${info.room}`, 'system');
                } else {
                    if (this.elements.connectionDot) {
                        this.elements.connectionDot.className = 'connection-dot';
                    }
                    if (this.elements.connectionStatusText) {
                        this.elements.connectionStatusText.textContent = 'Disconnected';
                    }
                }
            };

            this.vdoNinjaSdkConnector.onStreamReceived = (stream) => {
                console.log('MediaStream received from VDO.ninja SDK:', stream);
                this.logEvent('VDO.ninja stream received (audio + video)', 'system');

                // Update UI
                if (this.elements.mainCameraConnectionBadge) {
                    this.elements.mainCameraConnectionBadge.style.display = 'inline-block';
                }
                if (this.elements.mainCameraConnectionText) {
                    this.elements.mainCameraConnectionText.textContent = `VDO.ninja SDK (${roomName})`;
                }

                // If monitoring is active, use this stream
                if (this.isMonitoring) {
                    this.useSdkStream(stream);
                }
            };

            this.vdoNinjaSdkConnector.onError = (error) => {
                console.error('VDO.ninja SDK error:', error);
                this.logEvent('VDO.ninja SDK error: ' + error.message, 'error');
                alert('Failed to connect: ' + error.message);
            };

            // Use the existing mainCameraFeed video element for SDK playback
            const videoElement = this.elements.mainCameraFeed;
            console.log('🔗 Connecting SDK with video element:', videoElement.id);
            console.log('   Video element tag:', videoElement.tagName);

            // Connect to the room (pass video element instead of container)
            const connected = await this.vdoNinjaSdkConnector.connect(roomName, null, videoElement);

            if (connected) {
                this.currentSource = 'vdo-ninja-sdk';
                this.updateSourceUI('vdo-ninja-sdk');
                this.hideSourceSelectionModal();
                this.logEvent(`Joining VDO.ninja room: ${roomName}. Waiting for phone to push...`, 'system');
                console.log('SDK connected. Waiting for remote peer to send tracks...');
            } else {
                throw new Error('Failed to connect to VDO.ninja room');
            }
        } catch (error) {
            console.error('Failed to connect VDO.ninja SDK:', error);
            this.logEvent('Failed to connect VDO.ninja SDK: ' + error.message, 'error');
            alert('Failed to connect: ' + error.message);

            if (this.elements.connectionDot) {
                this.elements.connectionDot.className = 'connection-dot';
            }
            if (this.elements.connectionStatusText) {
                this.elements.connectionStatusText.textContent = 'Connection failed';
            }
        }
    }

    /**
     * Use the MediaStream from SDK for audio analysis and video recording
     */
    async useSdkStream(stream) {
        console.log('Using SDK MediaStream for audio analysis and DVR recording');

        try {
            // Audio tracks → AudioProcessor for waveform/spike analysis
            const audioTracks = stream.getAudioTracks();
            if (audioTracks.length > 0) {
                const audioOnlyStream = new MediaStream(audioTracks);
                await this.audioProcessor.initializeFromStream(audioOnlyStream);
                this.logEvent('Audio analysis started from VDO.ninja SDK stream', 'system');
            }

            // Full stream (video+audio) → ReplayController for DVR recording
            this.replayController.startRecordingFromStream(stream);
            this.logEvent('DVR recording started from VDO.ninja SDK stream', 'system');

        } catch (error) {
            console.error('Failed to use SDK stream:', error);
            this.logEvent('Failed to use SDK stream: ' + error.message, 'error');
        }
    }

    /**
     * Connect to VDO.ninja using iframe mode (legacy, requires tab capture)
     */
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

            console.log('Connecting VDO.ninja to container:', videoContainer);

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

        if (sourceType === 'vdo-ninja-sdk') {
            if (badge) {
                badge.style.display = 'inline-flex';
                badge.classList.add('vdo-connected');
            }
            if (badgeText) badgeText.textContent = 'VDO.ninja SDK';
            if (liveIndicator) liveIndicator.style.display = 'flex';
        } else if (sourceType === 'vdo-ninja') {
            if (badge) {
                badge.style.display = 'inline-flex';
                badge.classList.add('vdo-connected');
            }
            if (badgeText) badgeText.textContent = 'VDO.ninja (iframe)';
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
     * Get the VDO.ninja MediaStream for recording without using screen capture.
     *
     * Strategy:
     *  1. If the SDK connector already has a stream (e.g. user also clicked
     *     "Connect via SDK"), return it immediately.
     *  2. Otherwise, parse the VDO.ninja iframe URL to extract the room/stream
     *     ID, auto-initialise the SDK connector, connect it to the same room,
     *     and wait up to 10 s for the WebRTC stream to arrive.
     *
     * @returns {Promise<MediaStream|null>}
     */
    async _getVdoNinjaStreamForRecording() {
        // 1. Reuse existing SDK stream if already connected
        const existing = this.vdoNinjaSdkConnector.getMediaStream();
        if (existing && existing.getTracks().length > 0) {
            this.logEvent('Reusing existing VDO.ninja SDK stream for recording', 'system');
            return existing;
        }

        // 2. Parse the iframe URL to find the room / stream ID
        const iframe = this.vdoNinjaConnector.getIframe();
        if (!iframe || !iframe.src) {
            this.logEvent('No VDO.ninja iframe found — cannot auto-connect SDK', 'system');
            return null;
        }

        const roomInfo = this._parseVdoNinjaUrl(iframe.src);
        if (!roomInfo) {
            this.logEvent('Could not parse room/stream ID from VDO.ninja URL: ' + iframe.src, 'system');
            return null;
        }

        this.logEvent(`Auto-connecting SDK to VDO.ninja (id: "${roomInfo.id}")...`, 'system');

        try {
            // Initialise SDK only if it hasn't been already
            if (!this.vdoNinjaSdkConnector.vdo) {
                await this.vdoNinjaSdkConnector.init();
            }

            // Connect without a video element — the iframe already handles display.
            // Passing null means no video element is created/modified.
            await this.vdoNinjaSdkConnector.connect(roomInfo.id, roomInfo.password, null);

            // Wait for the WebRTC track(s) to arrive
            const stream = await this._waitForSdkStream(10000);
            if (stream) {
                this.logEvent('✓ VDO.ninja SDK stream received for recording', 'system');
            } else {
                this.logEvent('SDK stream timed out — no tracks received within 10 s', 'system');
            }
            return stream;

        } catch (err) {
            this.logEvent('SDK auto-connect error: ' + err.message, 'error');
            return null;
        }
    }

    /**
     * Parse a VDO.ninja URL and return the room/stream identifier.
     * Handles ?view=STREAMID, ?room=ROOMNAME, and ?push=STREAMID formats.
     * @param {string} url
     * @returns {{ id: string, password: string|null }|null}
     */
    _parseVdoNinjaUrl(url) {
        try {
            const u = new URL(url);
            const p = u.searchParams;
            // view= and room= are the common viewer-side params; push= as fallback
            const id = p.get('view') || p.get('room') || p.get('push');
            const password = p.get('password') || p.get('pw') || null;
            return id ? { id, password } : null;
        } catch (e) {
            return null;
        }
    }

    /**
     * Return a promise that resolves with the first MediaStream delivered by
     * the VDO.ninja SDK connector, or null after timeoutMs.
     * @param {number} timeoutMs
     * @returns {Promise<MediaStream|null>}
     */
    _waitForSdkStream(timeoutMs = 10000) {
        return new Promise((resolve) => {
            // Check immediately — stream may have arrived already
            const existing = this.vdoNinjaSdkConnector.getMediaStream();
            if (existing && existing.getTracks().length > 0) {
                resolve(existing);
                return;
            }

            let settled = false;

            const timer = setTimeout(() => {
                if (settled) return;
                settled = true;
                this.vdoNinjaSdkConnector.onStreamReceived = null;
                resolve(null);
            }, timeoutMs);

            // Temporarily override the callback to catch the incoming stream
            this.vdoNinjaSdkConnector.onStreamReceived = (stream) => {
                if (settled) return;
                settled = true;
                clearTimeout(timer);
                this.vdoNinjaSdkConnector.onStreamReceived = null;
                resolve(stream);
            };
        });
    }

    /**
     * Capture tab audio (for VDO.ninja stream audio)
     * This captures the audio that's currently playing in the browser tab
     * @returns {Promise<MediaStream|null>} The captured stream or null if failed
     */
    /**
     * Capture tab content for audio analysis + video/audio recording.
     * Chrome requires video:true, but the video is ONLY used for DVR recording.
     * The main player always shows the VDO.ninja iframe.
     * @returns {Promise<MediaStream|null>}
     */
    async captureTab() {
        try {
            console.log('Requesting tab capture for audio analysis + DVR recording...');

            const stream = await navigator.mediaDevices.getDisplayMedia({
                video: true,
                audio: {
                    echoCancellation: false,
                    noiseSuppression: false,
                    autoGainControl: false
                },
                preferCurrentTab: true
            });

            console.log('Tab capture OK — Audio:', stream.getAudioTracks().length,
                         'Video:', stream.getVideoTracks().length);

            this.tabCaptureStream = stream;
            return stream;

        } catch (error) {
            console.error('Tab capture failed:', error);
            if (error.name === 'NotAllowedError') {
                alert('Tab capture permission denied.\n\nPlease:\n1. Select "Current Tab"\n2. Check "Share audio"\n3. Click "Share"');
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

            if (this.currentSource === 'vdo-ninja-sdk') {
                // SDK mode: use the MediaStream directly (no tab capture!)
                this.updateStatus('Using VDO.ninja SDK stream...', 'active');
                const sdkStream = this.vdoNinjaSdkConnector.getMediaStream();

                if (sdkStream && sdkStream.getAudioTracks().length > 0) {
                    await this.useSdkStream(sdkStream);
                    audioInitialized = true;
                    this.logEvent('✓ Audio analysis active from SDK stream (no tab capture!)', 'system');
                } else {
                    alert('VDO.ninja SDK stream not ready.\n\nMake sure your phone is pushing to the same room name!');
                    this.updateStatus('SDK stream not ready', 'error');
                    return;
                }
            } else if (this.currentSource === 'vdo-ninja') {
                // iframe mode: use SDK to get the actual VDO.ninja WebRTC stream
                // (avoids getDisplayMedia / screen recording entirely)
                this.updateStatus('Connecting to VDO.ninja stream...', 'active');
                this.logEvent('Getting VDO.ninja stream via SDK (no screen recording)...', 'system');

                const vdoStream = await this._getVdoNinjaStreamForRecording();

                if (vdoStream && vdoStream.getAudioTracks().length > 0) {
                    // Audio tracks → AudioProcessor for waveform/spike analysis
                    const audioOnlyStream = new MediaStream(vdoStream.getAudioTracks());
                    audioInitialized = await this.audioProcessor.initializeFromStream(audioOnlyStream);

                    // Full stream (video+audio) → ReplayController for DVR recording
                    this.replayController.startRecordingFromStream(vdoStream);
                    this.logEvent('✓ VDO.ninja stream captured directly (no screen recording)', 'system');
                } else {
                    alert('Could not get VDO.ninja stream.\n\nMake sure:\n• Your phone/camera is pushing to the same VDO.ninja URL or room\n• The stream is active before clicking Start Monitoring\n• Try using "VDO.ninja SDK" mode for more reliable stream access');
                    this.updateStatus('VDO.ninja stream unavailable', 'error');
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
     * Called when user drags the DVR timeline slider (YouTube Live style)
     */
    onDvrTimelineInput(value) {
        const maxVal = parseFloat(this.elements.dvrTimeline.max);

        // If slider is at the max (live edge), return to live
        if (value >= maxVal - 0.5) {
            this.jumpToLive();
            return;
        }

        // Enter DVR mode if not already
        if (!this.isDvrMode) {
            this.enterDvrMode();
        }

        // Seek DVR video to the slider position
        const dvrVideo = this.elements.dvrPlaybackVideo;
        if (dvrVideo && dvrVideo.duration && isFinite(dvrVideo.duration)) {
            const seekTime = (value / maxVal) * dvrVideo.duration;
            dvrVideo.currentTime = seekTime;
        }
    }

    /**
     * Enter DVR mode — overlay recorded video on top of live iframe
     */
    enterDvrMode() {
        if (this.isDvrMode) return;

        const bufferDuration = this.replayController.getDvrBufferDuration();
        if (bufferDuration < 2) {
            if (this.elements.dvrTimeline) {
                this.elements.dvrTimeline.value = this.elements.dvrTimeline.max;
            }
            return;
        }

        this.isDvrMode = true;

        const blob = this.replayController.getDvrBlob();
        if (!blob) {
            this.isDvrMode = false;
            return;
        }

        if (this.dvrBlobUrl) URL.revokeObjectURL(this.dvrBlobUrl);
        this.dvrBlobUrl = URL.createObjectURL(blob);

        const dvrVideo = this.elements.dvrPlaybackVideo;
        if (dvrVideo) {
            // Remove old event listeners if any
            this.removeDvrVideoEventListeners();

            dvrVideo.src = this.dvrBlobUrl;
            dvrVideo.style.display = 'block';
            dvrVideo.muted = false;

            // Setup event-driven UI updates (like VideoSync pattern)
            this.setupDvrVideoEventListeners();

            // Auto-play when metadata loads
            this.dvrVideoOnLoadedMetadata = () => {
                console.log('DVR video loaded, duration:', dvrVideo.duration);
                if (this.elements.dvrTotalTime) {
                    this.elements.dvrTotalTime.textContent = this.formatDvrTime(dvrVideo.duration);
                }
                dvrVideo.play().catch(e => console.error('DVR play failed:', e));
            };
            dvrVideo.addEventListener('loadedmetadata', this.dvrVideoOnLoadedMetadata);
        }

        // Hide live feed, show DVR overlay
        this.toggleLiveFeedVisibility(false);

        if (this.elements.dvrLiveBtn) this.elements.dvrLiveBtn.classList.remove('active');
        if (this.elements.dvrPlayPauseBtn) {
            this.elements.dvrPlayPauseBtn.innerHTML = '&#9646;&#9646; Pause';
        }
    }

    /**
     * Setup event listeners on DVR video element for smooth scrubbing
     * Pattern from VideoSync: event-driven updates instead of polling
     */
    setupDvrVideoEventListeners() {
        const dvrVideo = this.elements.dvrPlaybackVideo;
        if (!dvrVideo) return;

        // Timeupdate: update UI as video plays
        this.dvrVideoOnTimeUpdate = () => {
            if (!this.isDvrMode) return;
            if (dvrVideo.duration && isFinite(dvrVideo.duration)) {
                // Update current time display
                if (this.elements.dvrCurrentTime) {
                    this.elements.dvrCurrentTime.textContent = this.formatDvrTime(dvrVideo.currentTime);
                }
                // Update slider position
                if (this.elements.dvrTimeline && !this.isDraggingDvrSlider) {
                    const pct = (dvrVideo.currentTime / dvrVideo.duration) * 100;
                    this.elements.dvrTimeline.value = pct;
                }
            }
        };
        dvrVideo.addEventListener('timeupdate', this.dvrVideoOnTimeUpdate);

        // Play/Pause events
        this.dvrVideoOnPlay = () => {
            if (this.elements.dvrPlayPauseBtn) {
                this.elements.dvrPlayPauseBtn.innerHTML = '&#9646;&#9646; Pause';
            }
        };
        this.dvrVideoOnPause = () => {
            if (this.elements.dvrPlayPauseBtn) {
                this.elements.dvrPlayPauseBtn.innerHTML = '&#9654; Play';
            }
        };
        dvrVideo.addEventListener('play', this.dvrVideoOnPlay);
        dvrVideo.addEventListener('pause', this.dvrVideoOnPause);

        // Seeking events (user is scrubbing)
        this.dvrVideoOnSeeking = () => {
            console.log('DVR seeking to:', dvrVideo.currentTime);
        };
        this.dvrVideoOnSeeked = () => {
            console.log('DVR seeked, now at:', dvrVideo.currentTime);
        };
        dvrVideo.addEventListener('seeking', this.dvrVideoOnSeeking);
        dvrVideo.addEventListener('seeked', this.dvrVideoOnSeeked);

        // Ended event - go back to live or loop
        this.dvrVideoOnEnded = () => {
            console.log('DVR video ended');
            // Option 1: Return to live
            // this.jumpToLive();
            // Option 2: Pause at end
            if (this.elements.dvrPlayPauseBtn) {
                this.elements.dvrPlayPauseBtn.innerHTML = '&#9654; Play';
            }
        };
        dvrVideo.addEventListener('ended', this.dvrVideoOnEnded);
    }

    /**
     * Remove event listeners from DVR video element
     */
    removeDvrVideoEventListeners() {
        const dvrVideo = this.elements.dvrPlaybackVideo;
        if (!dvrVideo) return;

        if (this.dvrVideoOnLoadedMetadata) dvrVideo.removeEventListener('loadedmetadata', this.dvrVideoOnLoadedMetadata);
        if (this.dvrVideoOnTimeUpdate) dvrVideo.removeEventListener('timeupdate', this.dvrVideoOnTimeUpdate);
        if (this.dvrVideoOnPlay) dvrVideo.removeEventListener('play', this.dvrVideoOnPlay);
        if (this.dvrVideoOnPause) dvrVideo.removeEventListener('pause', this.dvrVideoOnPause);
        if (this.dvrVideoOnSeeking) dvrVideo.removeEventListener('seeking', this.dvrVideoOnSeeking);
        if (this.dvrVideoOnSeeked) dvrVideo.removeEventListener('seeked', this.dvrVideoOnSeeked);
        if (this.dvrVideoOnEnded) dvrVideo.removeEventListener('ended', this.dvrVideoOnEnded);
    }

    /**
     * Jump back to live edge
     */
    jumpToLive() {
        if (!this.isDvrMode) return;
        this.isDvrMode = false;

        const dvrVideo = this.elements.dvrPlaybackVideo;
        if (dvrVideo) {
            // Remove event listeners before cleaning up
            this.removeDvrVideoEventListeners();

            dvrVideo.pause();
            dvrVideo.removeAttribute('src');
            dvrVideo.load();
            dvrVideo.style.display = 'none';
        }

        if (this.dvrBlobUrl) {
            URL.revokeObjectURL(this.dvrBlobUrl);
            this.dvrBlobUrl = null;
        }

        // Show live feed again
        this.toggleLiveFeedVisibility(true);

        if (this.elements.dvrTimeline) {
            this.elements.dvrTimeline.value = this.elements.dvrTimeline.max;
        }
        if (this.elements.dvrLiveBtn) this.elements.dvrLiveBtn.classList.add('active');

        // Update current time to show live buffer duration
        const bufferDuration = this.replayController.getDvrBufferDuration();
        if (this.elements.dvrCurrentTime) {
            this.elements.dvrCurrentTime.textContent = this.formatDvrTime(bufferDuration);
        }
        if (this.elements.dvrTotalTime) {
            this.elements.dvrTotalTime.textContent = this.formatDvrTime(bufferDuration);
        }

        document.querySelectorAll('.dvr-speed-btn').forEach(b => b.classList.remove('active'));
        const btn1x = document.querySelector('.dvr-speed-btn[data-speed="1"]');
        if (btn1x) btn1x.classList.add('active');
    }

    /**
     * Toggle visibility of the live feed (iframe, SDK video, or local video)
     */
    toggleLiveFeedVisibility(show) {
        if (this.currentSource === 'vdo-ninja-sdk') {
            // SDK mode: toggle the SDK video element
            const sdkVideo = this.vdoNinjaSdkConnector.getVideoElement();
            if (sdkVideo) {
                sdkVideo.style.display = show ? 'block' : 'none';
                console.log('SDK video visibility:', show);
            }
        } else if (this.currentSource === 'vdo-ninja') {
            // iframe mode: toggle the iframe
            const iframe = this.vdoNinjaConnector.getIframe();
            if (iframe) iframe.style.display = show ? 'block' : 'none';
        } else {
            // Local camera: toggle the main video element
            this.elements.mainCameraFeed.style.display = show ? 'block' : 'none';
        }
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
        if (!this.isDvrMode) {
            this.enterDvrMode();
            return;
        }

        const dvrVideo = this.elements.dvrPlaybackVideo;
        if (dvrVideo && dvrVideo.duration) {
            dvrVideo.currentTime = Math.max(0, Math.min(dvrVideo.duration, dvrVideo.currentTime + seconds));
        }
    }

    setDvrPlaybackSpeed(speed) {
        const dvrVideo = this.elements.dvrPlaybackVideo;
        if (dvrVideo) dvrVideo.playbackRate = speed;

        if (!this.isDvrMode && speed !== 1) {
            this.enterDvrMode();
        }
    }

    /**
     * Periodically update the DVR timeline display with accurate time
     */
    startDvrTimelineUpdater() {
        // Simplified: only update live buffer info
        // DVR video time updates are now handled by event listeners
        this.dvrUpdateInterval = setInterval(() => {
            const bufferDuration = this.replayController.getDvrBufferDuration();

            // Always update total time (shows buffer size in live mode, video duration in DVR mode)
            if (!this.isDvrMode && this.elements.dvrTotalTime) {
                this.elements.dvrTotalTime.textContent = this.formatDvrTime(bufferDuration);
            }

            // In live mode, show current = total (at live edge)
            if (!this.isDvrMode) {
                if (this.elements.dvrCurrentTime) {
                    this.elements.dvrCurrentTime.textContent = this.formatDvrTime(bufferDuration);
                }
                if (this.elements.dvrTimeline) {
                    this.elements.dvrTimeline.value = this.elements.dvrTimeline.max;
                }
            }
            // DVR mode updates are handled by video element's 'timeupdate' event
        }, 250); // Update 4x/sec
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

        // Auto replay if enabled
        if (this.elements.autoReplayToggle?.checked) {
            setTimeout(() => this.triggerInstantReplay(), 500);
        }
    }

    // =========================================================================
    // Replay & Decision
    // =========================================================================

    async triggerInstantReplay() {
        const btn = document.getElementById('instantReplayLiveBtn');
        const originalBtnText = btn ? btn.textContent : '';

        try {
            this.logEvent('Preparing 30s instant replay clip...', 'system');

            if (btn) {
                btn.disabled = true;
                btn.textContent = 'SAVING CLIP...';
            }

            // Get the last 30 seconds as a WebM blob
            const clip = this.replayController.getClipBlob(30);

            if (!clip) {
                this.logEvent('No replay data available yet — keep monitoring active', 'system');
                if (btn) {
                    btn.textContent = 'NO DATA YET';
                    setTimeout(() => {
                        btn.disabled = false;
                        btn.textContent = originalBtnText;
                    }, 2000);
                }
                return;
            }

            this.logEvent(`Clip ready (${(clip.size / 1024 / 1024).toFixed(1)} MB) — saving...`, 'system');

            // 1. Trigger browser download so the user has the file locally
            const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
            const filename = `ultra-edge-replay-${ts}.webm`;
            const downloadUrl = URL.createObjectURL(clip);
            const a = document.createElement('a');
            a.href = downloadUrl;
            a.download = filename;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            setTimeout(() => URL.revokeObjectURL(downloadUrl), 5000);

            // 2. Store blob in IndexedDB so video-mode.html can pick it up
            await this._saveReplayToIndexedDB(clip);

            // 3. Open video-mode in a NEW TAB so live monitoring keeps running
            window.open('video-mode.html?from=instant-replay', '_blank');
            this.logEvent('Clip saved & opened in new tab for analysis. Live mode continues.', 'system');

            // Restore button so another replay can be triggered
            if (btn) {
                btn.textContent = 'CLIP SAVED ✓';
                setTimeout(() => {
                    btn.disabled = false;
                    btn.textContent = originalBtnText;
                }, 2500);
            }

        } catch (error) {
            console.error('Failed to create replay:', error);
            this.logEvent('Failed to create instant replay: ' + error.message, 'error');
            if (btn) {
                btn.disabled = false;
                btn.textContent = originalBtnText;
            }
        }
    }

    /**
     * Save a replay Blob into IndexedDB so video-mode.html can retrieve it
     * after page navigation.
     * @param {Blob} blob
     * @returns {Promise<void>}
     */
    _saveReplayToIndexedDB(blob) {
        return new Promise((resolve, reject) => {
            const req = indexedDB.open('ultraedge-replay', 1);
            req.onupgradeneeded = (e) => {
                e.target.result.createObjectStore('clips');
            };
            req.onsuccess = (e) => {
                const db = e.target.result;
                const tx = db.transaction('clips', 'readwrite');
                tx.objectStore('clips').put(blob, 'pending');
                tx.oncomplete = () => { db.close(); resolve(); };
                tx.onerror = (err) => { db.close(); reject(err); };
            };
            req.onerror = reject;
        });
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
