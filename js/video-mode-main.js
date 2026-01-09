/**
 * Video Mode Main Controller
 * Orchestrates all components for video analysis mode
 */

class VideoModeApp {
    constructor() {
        // Core components
        this.videoSync = null;
        this.audioProcessor = new AudioProcessor();
        this.spikeDetector = new SpikeDetector();
        this.waveformVisualizer = null;
        this.replayController = new ReplayController();
        this.ballTracker = null;
        this.decisionSystem = new DecisionSystem();
        this.hotSpotOverlay = null;
        this.videoAnalyzer = null;

        // AI Components
        this.aiAudioClassifier = new AIAudioClassifier();
        this.aiBallTracker = null; // Initialized when canvas is available
        this.aiTrainingPipeline = new AITrainingPipeline();
        this.aiEnabled = false;

        // UI Elements
        this.elements = {};
        this.video = null;

        // State
        this.videoLoaded = false;
        this.isAnalyzing = false;

        this.init();
    }

    async init() {
        // Get UI elements
        this.elements = {
            uploadArea: document.getElementById('uploadArea'),
            videoFileInput: document.getElementById('videoFileInput'),
            videoUploadSection: document.getElementById('videoUploadSection'),
            videoPlayerContainer: document.getElementById('videoPlayerContainer'),
            mainVideo: document.getElementById('mainVideo'),
            // Controls
            playPauseBtn: document.getElementById('playPauseBtn'),
            frameBackBtn: document.getElementById('frameBackBtn'),
            frameForwardBtn: document.getElementById('frameForwardBtn'),
            playbackSpeed: document.getElementById('playbackSpeed'),
            videoSeeker: document.getElementById('videoSeeker'),
            // Canvases
            waveformCanvas: document.getElementById('waveformCanvas'),
            hotspotCanvas: document.getElementById('hotspotCanvas'),
            ballTrackingOverlay: document.getElementById('ballTrackingOverlay'),
            // Settings
            sensitivitySlider: document.getElementById('sensitivitySlider'),
            thresholdSlider: document.getElementById('thresholdSlider'),
            // Buttons
            analyzeDecisionBtn: document.getElementById('analyzeDecisionBtn'),
            instantReplayBtn: document.getElementById('instantReplayBtn'),
            exportJSONBtn: document.getElementById('exportJSONBtn')
        };

        this.video = this.elements.mainVideo;

        // Setup event listeners
        this.setupEventListeners();

        console.log('Video Mode initialized');
    }

    setupEventListeners() {
        // File upload
        this.elements.videoFileInput.addEventListener('change', (e) => this.handleVideoUpload(e));
        this.elements.uploadArea.addEventListener('click', () => {
            this.elements.videoFileInput.click();
        });

        // Drag and drop
        this.elements.uploadArea.addEventListener('dragover', (e) => {
            e.preventDefault();
            e.stopPropagation();
        });

        this.elements.uploadArea.addEventListener('drop', (e) => {
            e.preventDefault();
            e.stopPropagation();
            const files = e.dataTransfer.files;
            if (files.length > 0) {
                this.loadVideo(files[0]);
            }
        });

        // Video controls
        if (this.elements.playPauseBtn) {
            this.elements.playPauseBtn.addEventListener('click', () => this.togglePlayPause());
        }

        if (this.elements.frameBackBtn) {
            this.elements.frameBackBtn.addEventListener('click', () => this.stepBackward());
        }

        if (this.elements.frameForwardBtn) {
            this.elements.frameForwardBtn.addEventListener('click', () => this.stepForward());
        }

        if (this.elements.playbackSpeed) {
            this.elements.playbackSpeed.addEventListener('change', (e) => {
                if (this.videoSync) {
                    this.videoSync.setPlaybackRate(parseFloat(e.target.value));
                }
            });
        }

        // Seeker - CRITICAL: Continuous waveform update during drag
        if (this.elements.videoSeeker) {
            let isScrubbing = false;
            let scrubRAF = null;

            // Start scrubbing - begin continuous updates
            const startScrub = () => {
                isScrubbing = true;

                const updateLoop = () => {
                    if (!isScrubbing) return;

                    // Update waveform at current video position
                    if (this.video && this.video.duration && this.videoSync && this.videoSync.offlineAudioBuffer) {
                        this.videoSync.extractWaveformAtTime(this.video.currentTime);
                    }

                    scrubRAF = requestAnimationFrame(updateLoop);
                };

                updateLoop();
            };

            // Stop scrubbing - end continuous updates
            const stopScrub = () => {
                isScrubbing = false;
                if (scrubRAF) {
                    cancelAnimationFrame(scrubRAF);
                    scrubRAF = null;
                }
            };

            // Listen for scrub start
            this.elements.videoSeeker.addEventListener('mousedown', startScrub);
            this.elements.videoSeeker.addEventListener('touchstart', startScrub);

            // Listen for scrub end
            this.elements.videoSeeker.addEventListener('mouseup', stopScrub);
            this.elements.videoSeeker.addEventListener('touchend', stopScrub);
            document.addEventListener('mouseup', stopScrub); // Catch release outside slider

            // Update video position as slider moves
            this.elements.videoSeeker.addEventListener('input', (e) => {
                if (this.video && this.video.duration) {
                    const time = (e.target.value / 100) * this.video.duration;
                    this.video.currentTime = time;

                    // Also update immediately (in addition to continuous loop)
                    if (this.videoSync && this.videoSync.offlineAudioBuffer) {
                        this.videoSync.extractWaveformAtTime(time);
                    }
                }
            });
        }

        // Update seeker position as video plays
        if (this.video) {
            this.video.addEventListener('timeupdate', () => {
                if (this.video.duration && this.elements.videoSeeker) {
                    const percentage = (this.video.currentTime / this.video.duration) * 100;
                    this.elements.videoSeeker.value = percentage;

                    // Update time display
                    document.getElementById('videoCurrentTime').textContent =
                        this.formatVideoTime(this.video.currentTime);
                    document.getElementById('videoDuration').textContent =
                        this.formatVideoTime(this.video.duration);
                }
            });
        }

        // Settings
        if (this.elements.sensitivitySlider) {
            this.elements.sensitivitySlider.addEventListener('input', (e) => {
                document.getElementById('sensitivityValue').textContent = e.target.value;
                this.spikeDetector.setSensitivity(parseInt(e.target.value));
            });
        }

        if (this.elements.thresholdSlider) {
            this.elements.thresholdSlider.addEventListener('input', (e) => {
                document.getElementById('thresholdValue').textContent = parseFloat(e.target.value).toFixed(2);
                this.spikeDetector.setThreshold(parseFloat(e.target.value));
            });
        }

        // Decision button
        if (this.elements.analyzeDecisionBtn) {
            this.elements.analyzeDecisionBtn.addEventListener('click', () => this.analyzeDecision());
        }

        // Export
        if (this.elements.exportJSONBtn) {
            this.elements.exportJSONBtn.addEventListener('click', () => this.exportAnalysis());
        }
    }

    async handleVideoUpload(event) {
        const file = event.target.files[0];
        if (file) {
            await this.loadVideo(file);
        }
    }

    async loadVideo(file) {
        try {
            const url = URL.createObjectURL(file);
            this.video.src = url;

            // Wait for video to load
            await new Promise((resolve) => {
                this.video.addEventListener('loadedmetadata', resolve, { once: true });
            });

            // Hide upload, show player
            this.elements.videoUploadSection.style.display = 'none';
            this.elements.videoPlayerContainer.style.display = 'block';

            // Initialize components
            await this.initializeComponents();

            this.videoLoaded = true;
            this.updateStatus('Video loaded - Ready for analysis');

            console.log('Video loaded:', file.name);
        } catch (error) {
            console.error('Failed to load video:', error);
            alert('Failed to load video file');
        }
    }

    async initializeComponents() {
        // Show loading message
        this.updateStatus('Initializing audio system...');

        // Initialize VideoSync
        this.videoSync = new VideoSync(this.video);

        this.updateStatus('Decoding video audio for scrubbing...');
        await this.videoSync.initialize();

        // Initialize visualizers
        this.waveformVisualizer = new WaveformVisualizer(this.elements.waveformCanvas);
        this.ballTracker = new BallTracker(this.elements.ballTrackingOverlay);
        this.hotSpotOverlay = new HotSpotOverlay(this.elements.hotspotCanvas);
        this.videoAnalyzer = new VideoAnalyzer(this.video);

        // Initialize AI components
        this.updateStatus('Loading AI models...');
        this.aiBallTracker = new AIBallTracker(this.elements.ballTrackingOverlay);

        // Try to load AI models (fail gracefully if models not available)
        const audioModelLoaded = await this.aiAudioClassifier.loadModel();
        const ballModelLoaded = await this.aiBallTracker.loadModel();

        if (audioModelLoaded || ballModelLoaded) {
            this.aiEnabled = true;
            this.updateStatus('AI models loaded successfully');
            console.log('AI Enhancement: ACTIVE');

            // Update AI status displays
            this.updateAIStatusDisplay();
        } else {
            this.updateStatus('AI models not available - using traditional detection');
            console.log('AI Enhancement: DISABLED (models not found)');

            // Update AI status displays
            this.updateAIStatusDisplay();
        }

        // Setup callbacks
        this.videoSync.onAudioData = async (data) => {
            // Always update waveform visualization
            this.waveformVisualizer.draw(data.waveform);

            // Only detect spikes during playback, not during scrubbing
            if (!data.isScrubbing) {
                // Try AI detection first
                let spike = null;

                if (this.aiEnabled && this.aiAudioClassifier.isModelLoaded) {
                    const aiDetection = await this.aiAudioClassifier.detectContact(data);
                    if (aiDetection) {
                        spike = {
                            ...aiDetection,
                            magnitude: aiDetection.confidence,
                            formattedTime: this.formatVideoTime(aiDetection.timestamp)
                        };
                        console.log('AI detected:', spike.type, `(${Math.round(spike.confidence * 100)}%)`);
                    }
                }

                // Fallback to traditional detection if AI didn't detect anything
                if (!spike) {
                    spike = this.spikeDetector.detectSpike(data);
                }

                if (spike) {
                    this.handleSpikeDetected(spike);
                }
            }
        };

        this.videoSync.onFrameUpdate = (frame, total) => {
            document.getElementById('frameNumber').textContent = frame;
            document.getElementById('totalFrames').textContent = total;
        };

        this.waveformVisualizer.start();
        this.hotSpotOverlay.initialize();

        // Start AI ball tracking if enabled
        if (this.aiEnabled && this.aiBallTracker.isModelLoaded) {
            this.startAIBallTracking();
        }

        console.log('Components initialized');
    }

    togglePlayPause() {
        if (!this.video) return;

        if (this.video.paused) {
            this.video.play();
            document.getElementById('playPauseIcon').textContent = '⏸';
        } else {
            this.video.pause();
            document.getElementById('playPauseIcon').textContent = '▶';
        }
    }

    stepBackward() {
        if (this.videoSync) {
            this.videoSync.stepBackward();
        }
    }

    stepForward() {
        if (this.videoSync) {
            this.videoSync.stepForward();
        }
    }

    handleSpikeDetected(spike) {
        console.log('Spike detected in video:', spike);

        // Add to spike list
        this.addSpikeToList(spike);

        // Update counter
        document.getElementById('spikeCount').textContent = this.spikeDetector.getSpikeCount();

        // Visualize
        this.waveformVisualizer.addSpikeMarker(spike);

        // Simulate hot-spot if enabled
        if (document.getElementById('hotspotEnabled')?.checked) {
            this.hotSpotOverlay.simulateHeat('bat');
        }
    }

    addSpikeToList(spike) {
        const list = document.getElementById('spikeList');
        if (!list) return;

        const noData = list.querySelector('.no-data');
        if (noData) noData.remove();

        const item = document.createElement('div');
        item.className = 'spike-item';
        item.innerHTML = `
            <div>${spike.formattedTime}</div>
            <div>Magnitude: ${(spike.magnitude * 100).toFixed(1)}%</div>
        `;

        list.insertBefore(item, list.firstChild);
    }

    analyzeDecision() {
        const latestSpike = this.spikeDetector.getSpikeHistory().slice(-1)[0];
        const hotspotData = this.hotSpotOverlay.getDetectionData();
        const ballTrackingData = this.ballTracker ? this.ballTracker.getTrackingData() : null;

        const decision = this.decisionSystem.analyzeDecision({
            ultraEdge: latestSpike,
            hotSpot: hotspotData,
            ballTracking: ballTrackingData
        });

        // Display decision
        this.displayDecision(decision);
    }

    displayDecision(decision) {
        document.getElementById('ultraEdgeStatus').textContent = decision.breakdown.ultraEdge;
        document.getElementById('hotspotStatus').textContent = decision.breakdown.hotSpot;
        document.getElementById('trackingStatus').textContent = decision.breakdown.ballTracking;

        const finalDecision = document.getElementById('finalDecision');
        finalDecision.textContent = decision.decision;
        finalDecision.className = 'final-decision';

        if (decision.decision.includes('OUT')) {
            finalDecision.classList.add('out');
        } else if (decision.decision === 'NOT OUT') {
            finalDecision.classList.add('not-out');
        }

        // Show overlay
        const overlay = document.getElementById('decisionOverlay');
        if (overlay) {
            overlay.style.display = 'flex';
            document.getElementById('decisionResult').textContent = decision.decision;
            document.getElementById('decisionConfidence').textContent = `Confidence: ${decision.confidence}%`;

            setTimeout(() => {
                overlay.style.display = 'none';
            }, 3000);
        }
    }

    exportAnalysis() {
        const data = {
            exportTime: new Date().toISOString(),
            videoInfo: {
                duration: this.video.duration,
                currentTime: this.video.currentTime
            },
            spikes: this.spikeDetector.exportToJSON(),
            decision: this.decisionSystem.exportReport()
        };

        const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);

        const a = document.createElement('a');
        a.href = url;
        a.download = `ultra-edge-analysis-${Date.now()}.json`;
        a.click();

        URL.revokeObjectURL(url);
    }

    updateStatus(message) {
        const status = document.getElementById('systemStatus');
        if (status) status.textContent = message;
    }

    formatVideoTime(seconds) {
        if (!seconds || isNaN(seconds)) return '00:00';

        const mins = Math.floor(seconds / 60);
        const secs = Math.floor(seconds % 60);

        return `${this.pad(mins)}:${this.pad(secs)}`;
    }

    pad(num, size = 2) {
        let s = String(num);
        while (s.length < size) s = '0' + s;
        return s;
    }

    /**
     * Start AI-powered ball tracking
     */
    startAIBallTracking() {
        if (!this.aiBallTracker || !this.aiBallTracker.isModelLoaded) return;

        console.log('Starting AI ball tracking...');

        const trackBall = async () => {
            if (this.video.paused) {
                requestAnimationFrame(trackBall);
                return;
            }

            // Detect ball in current frame
            const detections = await this.aiBallTracker.detectBall(this.video);

            // Update tracking state
            this.aiBallTracker.updateTracking(detections, this.video.currentTime);

            // Render tracking visualization
            this.aiBallTracker.render(this.video);

            // Continue tracking
            requestAnimationFrame(trackBall);
        };

        trackBall();
    }

    /**
     * Toggle AI enhancement
     */
    toggleAI(enabled) {
        this.aiEnabled = enabled;

        if (this.aiAudioClassifier) {
            this.aiAudioClassifier.setEnabled(enabled);
        }

        if (this.aiBallTracker) {
            this.aiBallTracker.setEnabled(enabled);
        }

        console.log('AI Enhancement:', enabled ? 'ENABLED' : 'DISABLED');
    }

    /**
     * Get AI status for display
     */
    getAIStatus() {
        return {
            enabled: this.aiEnabled,
            audioClassifier: this.aiAudioClassifier ? this.aiAudioClassifier.getStatus() : null,
            ballTracker: this.aiBallTracker ? this.aiBallTracker.getStatus() : null,
            trainingPipeline: this.aiTrainingPipeline ? this.aiTrainingPipeline.getStats() : null
        };
    }

    /**
     * Update AI status display in UI
     */
    updateAIStatusDisplay() {
        const status = this.getAIStatus();

        // Update audio classifier status
        const audioStatus = document.getElementById('aiAudioStatus');
        if (audioStatus) {
            if (status.audioClassifier && status.audioClassifier.modelLoaded) {
                audioStatus.textContent = '✓ Ready';
                audioStatus.style.color = '#00ff41';
            } else {
                audioStatus.textContent = '✗ Not Available';
                audioStatus.style.color = '#ff3333';
            }
        }

        // Update ball tracker status
        const ballStatus = document.getElementById('aiBallStatus');
        if (ballStatus) {
            if (status.ballTracker && status.ballTracker.modelLoaded) {
                ballStatus.textContent = '✓ Ready';
                ballStatus.style.color = '#00ff41';
            } else {
                ballStatus.textContent = '✗ Not Available';
                ballStatus.style.color = '#ff3333';
            }
        }

        // Update training sample count
        const trainingCount = document.getElementById('aiTrainingCount');
        if (trainingCount && status.trainingPipeline) {
            trainingCount.textContent = status.trainingPipeline.totalSamples || 0;
        }

        // Auto-enable AI if models are loaded
        const aiCheckbox = document.getElementById('aiEnabled');
        if (aiCheckbox && this.aiEnabled) {
            aiCheckbox.checked = true;
        }
    }
}

// Initialize app when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
    window.videoModeApp = new VideoModeApp();
});
