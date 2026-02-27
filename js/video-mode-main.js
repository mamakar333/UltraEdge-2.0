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
        this.videoAnalyzer = null;

        // AI Components
        this.aiAudioClassifier = new AIAudioClassifier();
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
            // Settings
            sensitivitySlider: document.getElementById('sensitivitySlider'),
            thresholdSlider: document.getElementById('thresholdSlider'),
            // Buttons
            instantReplayBtn: document.getElementById('instantReplayBtn'),
            exportJSONBtn: document.getElementById('exportJSONBtn')
        };

        this.video = this.elements.mainVideo;

        // Setup event listeners
        this.setupEventListeners();

        console.log('Video Mode initialized');

        // If arriving from live-mode instant replay, auto-load the saved clip
        const params = new URLSearchParams(window.location.search);
        if (params.get('from') === 'instant-replay') {
            this._loadReplayFromIndexedDB();
        }
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

    /**
     * Load a video directly from a Blob (used when arriving from live-mode
     * instant replay). Mirrors loadVideo() but accepts a Blob instead of File.
     * @param {Blob} blob
     */
    async loadVideoFromBlob(blob) {
        try {
            // Show player container FIRST so the video element is in the DOM and
            // visible — some browsers refuse to fire loadedmetadata on hidden elements
            this.elements.videoUploadSection.style.display = 'none';
            this.elements.videoPlayerContainer.style.display = 'block';

            const url = URL.createObjectURL(blob);
            this.video.src = url;
            this.video.load(); // explicitly kick off loading

            this.updateStatus('Loading instant replay clip...');

            // Wait for metadata with a guard against already-loaded and errors
            if (this.video.readyState < 1 /* HAVE_METADATA */) {
                await new Promise((resolve, reject) => {
                    const cleanup = () => {
                        this.video.removeEventListener('loadedmetadata', onMeta);
                        this.video.removeEventListener('error', onErr);
                    };
                    const onMeta = () => { cleanup(); resolve(); };
                    const onErr = () => { cleanup(); reject(new Error('Video failed to load')); };
                    this.video.addEventListener('loadedmetadata', onMeta, { once: true });
                    this.video.addEventListener('error', onErr, { once: true });
                });
            }

            await this.initializeComponents();

            this.videoLoaded = true;
            this.updateStatus('Instant replay loaded — Ready for analysis');

            // Auto-play the clip
            try {
                await this.video.play();
                const icon = document.getElementById('playPauseIcon');
                if (icon) icon.textContent = '⏸';
            } catch (e) {
                // Browser may block autoplay — user can click play manually
                console.log('Autoplay blocked, click play to start:', e.message);
            }

            console.log('Instant replay blob loaded:', (blob.size / 1024 / 1024).toFixed(1), 'MB');
        } catch (error) {
            console.error('Failed to load replay blob:', error);
            this.updateStatus('Failed to load replay — please try again');
        }
    }

    /**
     * Read the pending replay Blob from IndexedDB (stored by live-mode) and
     * load it into the player. Clears the entry after reading so a page
     * refresh doesn't re-load the same clip.
     */
    _loadReplayFromIndexedDB() {
        const openReq = indexedDB.open('ultraedge-replay', 1);

        openReq.onupgradeneeded = (e) => {
            // Create the store if this is the first time video-mode opens the DB
            e.target.result.createObjectStore('clips');
        };

        openReq.onsuccess = async (e) => {
            const db = e.target.result;
            try {
                const tx = db.transaction('clips', 'readwrite');
                const store = tx.objectStore('clips');
                const getReq = store.get('pending');

                getReq.onsuccess = async () => {
                    const blob = getReq.result;
                    // Delete immediately so a refresh doesn't reload it
                    store.delete('pending');
                    db.close();

                    if (blob) {
                        await this.loadVideoFromBlob(blob);
                    } else {
                        console.warn('Arrived with ?from=instant-replay but no clip found in IndexedDB');
                    }
                };

                getReq.onerror = () => db.close();
            } catch (err) {
                console.error('IndexedDB read error:', err);
                db.close();
            }
        };

        openReq.onerror = (e) => {
            console.error('Failed to open IndexedDB:', e);
        };
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
        this.videoAnalyzer = new VideoAnalyzer(this.video);

        // Initialize AI audio classifier
        this.updateStatus('Loading AI models...');
        const audioModelLoaded = await this.aiAudioClassifier.loadModel();

        if (audioModelLoaded) {
            this.aiEnabled = true;
            this.updateStatus('AI models loaded successfully');
            console.log('AI Enhancement: ACTIVE');
            this.updateAIStatusDisplay();
        } else {
            this.updateStatus('AI models not available - using traditional detection');
            console.log('AI Enhancement: DISABLED (models not found)');
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

    exportAnalysis() {
        const data = {
            exportTime: new Date().toISOString(),
            videoInfo: {
                duration: this.video.duration,
                currentTime: this.video.currentTime
            },
            spikes: this.spikeDetector.exportToJSON()
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
     * Toggle AI enhancement
     */
    toggleAI(enabled) {
        this.aiEnabled = enabled;
        if (this.aiAudioClassifier) {
            this.aiAudioClassifier.setEnabled(enabled);
        }
        console.log('AI Enhancement:', enabled ? 'ENABLED' : 'DISABLED');
    }

    /**
     * Update AI status display in UI
     */
    updateAIStatusDisplay() {
        const audioStatus = document.getElementById('aiAudioStatus');
        if (audioStatus) {
            const s = this.aiAudioClassifier ? this.aiAudioClassifier.getStatus() : null;
            if (s && s.modelLoaded) {
                audioStatus.textContent = '✓ Ready';
                audioStatus.style.color = '#00ff41';
            } else {
                audioStatus.textContent = '✗ Not Available';
                audioStatus.style.color = '#ff3333';
            }
        }

        const trainingCount = document.getElementById('aiTrainingCount');
        if (trainingCount && this.aiTrainingPipeline) {
            trainingCount.textContent = this.aiTrainingPipeline.getStats()?.totalSamples || 0;
        }

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
