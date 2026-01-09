/**
 * Main Application Controller
 * Orchestrates all components and handles UI interactions
 */

class UltraEdgeApp {
    constructor() {
        // Core components
        this.audioProcessor = null;
        this.spikeDetector = null;
        this.waveformVisualizer = null;

        // UI elements
        this.elements = {
            startBtn: document.getElementById('startBtn'),
            stopBtn: document.getElementById('stopBtn'),
            sensitivitySlider: document.getElementById('sensitivitySlider'),
            sensitivityValue: document.getElementById('sensitivityValue'),
            thresholdSlider: document.getElementById('thresholdSlider'),
            thresholdValue: document.getElementById('thresholdValue'),
            transparentBg: document.getElementById('transparentBg'),
            levelMeterFill: document.getElementById('levelMeterFill'),
            spikeCount: document.getElementById('spikeCount'),
            status: document.getElementById('status'),
            sampleRate: document.getElementById('sampleRate'),
            timestamp: document.getElementById('timestamp'),
            spikeList: document.getElementById('spikeList'),
            exportBtn: document.getElementById('exportBtn'),
            canvas: document.getElementById('waveformCanvas')
        };

        // Application state
        this.isRunning = false;
        this.startTime = 0;
        this.timestampInterval = null;

        // Initialize application
        this.init();
    }

    /**
     * Initialize application
     */
    async init() {
        console.log('Initializing Ultra Edge Cricket Detection System...');

        // Initialize components
        this.audioProcessor = new AudioProcessor();
        this.spikeDetector = new SpikeDetector();
        this.waveformVisualizer = new WaveformVisualizer(this.elements.canvas);

        // Setup event listeners
        this.setupEventListeners();

        // Setup callbacks
        this.setupCallbacks();

        // Load saved settings
        this.loadSettings();

        // Update status
        this.updateStatus('Ready - Click START to begin monitoring');

        console.log('Ultra Edge initialized successfully');
    }

    /**
     * Setup UI event listeners
     */
    setupEventListeners() {
        // Start button
        this.elements.startBtn.addEventListener('click', () => this.start());

        // Stop button
        this.elements.stopBtn.addEventListener('click', () => this.stop());

        // Sensitivity slider
        this.elements.sensitivitySlider.addEventListener('input', (e) => {
            const value = parseInt(e.target.value);
            this.elements.sensitivityValue.textContent = value;
            this.spikeDetector.setSensitivity(value);
            this.saveSettings();
        });

        // Threshold slider
        this.elements.thresholdSlider.addEventListener('input', (e) => {
            const value = parseFloat(e.target.value);
            this.elements.thresholdValue.textContent = value.toFixed(2);
            this.spikeDetector.setThreshold(value);
            this.saveSettings();
        });

        // Transparent background toggle
        this.elements.transparentBg.addEventListener('change', (e) => {
            if (e.target.checked) {
                document.body.classList.add('transparent');
            } else {
                document.body.classList.remove('transparent');
            }
            this.saveSettings();
        });

        // Export button
        this.elements.exportBtn.addEventListener('click', () => this.exportData());

        // Keyboard shortcuts
        document.addEventListener('keydown', (e) => {
            // Space to start/stop
            if (e.code === 'Space' && !e.target.matches('input')) {
                e.preventDefault();
                if (this.isRunning) {
                    this.stop();
                } else {
                    this.start();
                }
            }
            // 'C' to clear history
            if (e.code === 'KeyC' && e.ctrlKey) {
                e.preventDefault();
                this.clearHistory();
            }
        });
    }

    /**
     * Setup component callbacks
     */
    setupCallbacks() {
        // Audio processor callbacks
        this.audioProcessor.onAudioData = (audioData) => {
            // Update visualizer
            this.waveformVisualizer.draw(audioData.waveform);

            // Check for spikes
            this.spikeDetector.detectSpike(audioData);
        };

        this.audioProcessor.onLevelUpdate = (level) => {
            this.updateLevelMeter(level);
        };

        // Spike detector callback
        this.spikeDetector.onSpikeDetected = (spikeInfo) => {
            this.handleSpikeDetected(spikeInfo);
        };
    }

    /**
     * Start monitoring
     */
    async start() {
        try {
            this.updateStatus('Initializing audio...');
            this.elements.startBtn.disabled = true;

            // Initialize audio processor if not already done
            const initialized = await this.audioProcessor.initialize();

            if (!initialized) {
                this.updateStatus('Failed to initialize audio');
                this.elements.startBtn.disabled = false;
                return;
            }

            // Start components
            this.audioProcessor.start();
            this.waveformVisualizer.start();
            this.spikeDetector.setEnabled(true);

            // Update UI
            this.isRunning = true;
            this.elements.startBtn.disabled = true;
            this.elements.stopBtn.disabled = false;
            this.elements.exportBtn.disabled = false;
            document.querySelector('.container').classList.add('monitoring');

            // Display sample rate
            this.elements.sampleRate.textContent =
                `${this.audioProcessor.getSampleRate()} Hz`;

            // Start timestamp counter
            this.startTime = this.audioProcessor.getCurrentTime();
            this.startTimestampCounter();

            this.updateStatus('MONITORING ACTIVE');

            console.log('Monitoring started');
        } catch (error) {
            console.error('Failed to start monitoring:', error);
            this.updateStatus('Error: ' + error.message);
            this.elements.startBtn.disabled = false;
        }
    }

    /**
     * Stop monitoring
     */
    stop() {
        // Stop components
        this.audioProcessor.stop();
        this.waveformVisualizer.stop();
        this.spikeDetector.setEnabled(false);

        // Update UI
        this.isRunning = false;
        this.elements.startBtn.disabled = false;
        this.elements.stopBtn.disabled = true;
        document.querySelector('.container').classList.remove('monitoring');

        // Stop timestamp counter
        this.stopTimestampCounter();

        this.updateStatus('Stopped');

        console.log('Monitoring stopped');
    }

    /**
     * Handle spike detection
     * @param {Object} spikeInfo - Spike information
     */
    handleSpikeDetected(spikeInfo) {
        console.log('Spike detected:', spikeInfo);

        // Update spike count
        this.elements.spikeCount.textContent = this.spikeDetector.getSpikeCount();

        // Add visual marker
        this.waveformVisualizer.addSpikeMarker(spikeInfo);

        // Update spike list
        this.addSpikeToList(spikeInfo);

        // Flash effect on canvas
        this.flashCanvas();
    }

    /**
     * Add spike to history list
     * @param {Object} spikeInfo - Spike information
     */
    addSpikeToList(spikeInfo) {
        const list = this.elements.spikeList;

        // Remove "no spikes" message if present
        const noSpikesMsg = list.querySelector('.no-spikes');
        if (noSpikesMsg) {
            noSpikesMsg.remove();
        }

        // Create spike item
        const item = document.createElement('div');
        item.className = 'spike-item';
        item.innerHTML = `
            <span class="spike-item-time">${spikeInfo.formattedTime}</span>
            <span class="spike-item-magnitude">
                Magnitude: ${(spikeInfo.magnitude * 100).toFixed(1)}%
            </span>
        `;

        // Add to top of list
        list.insertBefore(item, list.firstChild);

        // Limit number of displayed items
        const maxDisplayItems = 10;
        while (list.children.length > maxDisplayItems) {
            list.removeChild(list.lastChild);
        }
    }

    /**
     * Update level meter display
     * @param {number} level - Audio level (0-1)
     */
    updateLevelMeter(level) {
        const percentage = Math.min(100, level * 100);
        this.elements.levelMeterFill.style.width = `${percentage}%`;
    }

    /**
     * Update status display
     * @param {string} message - Status message
     */
    updateStatus(message) {
        this.elements.status.textContent = message;
    }

    /**
     * Start timestamp counter
     */
    startTimestampCounter() {
        this.stopTimestampCounter(); // Clear any existing interval

        this.timestampInterval = setInterval(() => {
            const elapsed = this.audioProcessor.getCurrentTime() - this.startTime;
            this.elements.timestamp.textContent = this.formatTime(elapsed);
        }, 100); // Update every 100ms
    }

    /**
     * Stop timestamp counter
     */
    stopTimestampCounter() {
        if (this.timestampInterval) {
            clearInterval(this.timestampInterval);
            this.timestampInterval = null;
        }
    }

    /**
     * Format time to HH:MM:SS.mmm
     * @param {number} seconds - Time in seconds
     * @returns {string} Formatted time
     */
    formatTime(seconds) {
        const hours = Math.floor(seconds / 3600);
        const minutes = Math.floor((seconds % 3600) / 60);
        const secs = Math.floor(seconds % 60);
        const ms = Math.floor((seconds % 1) * 1000);

        return `${this.pad(hours)}:${this.pad(minutes)}:${this.pad(secs)}.${this.pad(ms, 3)}`;
    }

    /**
     * Pad number with zeros
     * @param {number} num - Number to pad
     * @param {number} size - Target size
     * @returns {string} Padded string
     */
    pad(num, size = 2) {
        let s = String(num);
        while (s.length < size) s = '0' + s;
        return s;
    }

    /**
     * Flash canvas on spike detection
     */
    flashCanvas() {
        const container = document.querySelector('.waveform-container');
        container.style.borderColor = '#ff3333';
        container.style.boxShadow = '0 0 30px rgba(255, 51, 51, 0.8)';

        setTimeout(() => {
            container.style.borderColor = '#00ff41';
            container.style.boxShadow = 'inset 0 0 30px rgba(0, 255, 65, 0.1)';
        }, 200);
    }

    /**
     * Clear spike history
     */
    clearHistory() {
        if (!confirm('Clear all spike history?')) return;

        this.spikeDetector.clearHistory();
        this.waveformVisualizer.clearSpikeMarkers();

        // Reset UI
        this.elements.spikeCount.textContent = '0';
        this.elements.spikeList.innerHTML = '<p class="no-spikes">No spikes detected yet...</p>';

        this.updateStatus('History cleared');
    }

    /**
     * Export spike data to JSON file
     */
    exportData() {
        const jsonData = this.spikeDetector.exportToJSON();
        const blob = new Blob([jsonData], { type: 'application/json' });
        const url = URL.createObjectURL(blob);

        const a = document.createElement('a');
        a.href = url;
        a.download = `ultra-edge-spikes-${Date.now()}.json`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);

        this.updateStatus('Data exported successfully');
    }

    /**
     * Save settings to localStorage
     */
    saveSettings() {
        const settings = {
            sensitivity: parseInt(this.elements.sensitivitySlider.value),
            threshold: parseFloat(this.elements.thresholdSlider.value),
            transparentBg: this.elements.transparentBg.checked
        };

        localStorage.setItem('ultraEdgeSettings', JSON.stringify(settings));
    }

    /**
     * Load settings from localStorage
     */
    loadSettings() {
        const savedSettings = localStorage.getItem('ultraEdgeSettings');

        if (savedSettings) {
            try {
                const settings = JSON.parse(savedSettings);

                // Apply sensitivity
                if (settings.sensitivity !== undefined) {
                    this.elements.sensitivitySlider.value = settings.sensitivity;
                    this.elements.sensitivityValue.textContent = settings.sensitivity;
                    this.spikeDetector.setSensitivity(settings.sensitivity);
                }

                // Apply threshold
                if (settings.threshold !== undefined) {
                    this.elements.thresholdSlider.value = settings.threshold;
                    this.elements.thresholdValue.textContent = settings.threshold.toFixed(2);
                    this.spikeDetector.setThreshold(settings.threshold);
                }

                // Apply transparent background
                if (settings.transparentBg) {
                    this.elements.transparentBg.checked = true;
                    document.body.classList.add('transparent');
                }

                console.log('Settings loaded from localStorage');
            } catch (error) {
                console.error('Failed to load settings:', error);
            }
        }
    }

    /**
     * Cleanup on application close
     */
    dispose() {
        this.stop();
        this.stopTimestampCounter();

        if (this.audioProcessor) {
            this.audioProcessor.dispose();
        }

        if (this.waveformVisualizer) {
            this.waveformVisualizer.dispose();
        }

        console.log('Application disposed');
    }
}

// Initialize application when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
    window.ultraEdgeApp = new UltraEdgeApp();

    // Cleanup on page unload
    window.addEventListener('beforeunload', () => {
        if (window.ultraEdgeApp) {
            window.ultraEdgeApp.dispose();
        }
    });

    console.log('Ultra Edge Cricket Detection System - Ready');
    console.log('Press START MONITORING to begin');
    console.log('Keyboard shortcuts:');
    console.log('  - Space: Start/Stop monitoring');
    console.log('  - Ctrl+C: Clear history');
});
