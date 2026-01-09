/**
 * WaveformVisualizer Class
 * Handles real-time waveform rendering on HTML5 Canvas
 * Creates a professional oscilloscope-style visualization similar to cricket DRS Ultra Edge
 */

class WaveformVisualizer {
    constructor(canvasElement) {
        this.canvas = canvasElement;
        this.ctx = this.canvas.getContext('2d');

        // Set canvas resolution
        this.setupCanvas();

        // Visualization settings
        this.waveformColor = '#00ff41'; // Cricket DRS green
        this.backgroundColor = '#0a0a0a';
        this.gridColor = '#1a3a1a';
        this.spikeColor = '#ff3333';
        this.lineWidth = 2.5; // Slightly thicker for better visibility
        this.glowIntensity = 15; // Increased glow for sharper appearance
        this.amplification = 1.8; // Amplify waveform height for sharper spikes

        // Animation state
        this.animationId = null;
        this.isRunning = false;

        // Waveform buffer for scrolling effect
        this.waveformBuffer = [];
        this.bufferSize = 500; // Number of waveform snapshots to keep
        this.scrollSpeed = 2; // Pixels to scroll per frame

        // Spike markers
        this.spikeMarkers = [];
        this.maxSpikeMarkers = 20;

        // Visual effects
        this.showGrid = true;
        this.showGlow = true;

        // Handle window resize
        window.addEventListener('resize', () => this.setupCanvas());
    }

    /**
     * Setup canvas with proper resolution for high-DPI displays
     */
    setupCanvas() {
        const rect = this.canvas.getBoundingClientRect();
        const dpr = window.devicePixelRatio || 1;

        // Set actual canvas size (accounting for pixel ratio)
        this.canvas.width = rect.width * dpr;
        this.canvas.height = rect.height * dpr;

        // Scale context to match
        this.ctx.scale(dpr, dpr);

        // Store display dimensions
        this.width = rect.width;
        this.height = rect.height;

        console.log('Canvas initialized:', this.width, 'x', this.height);
    }

    /**
     * Start visualization
     */
    start() {
        this.isRunning = true;
        console.log('Waveform visualizer started');
    }

    /**
     * Stop visualization
     */
    stop() {
        this.isRunning = false;
        if (this.animationId) {
            cancelAnimationFrame(this.animationId);
        }
        console.log('Waveform visualizer stopped');
    }

    /**
     * Draw waveform from audio data
     * @param {Uint8Array} waveformData - Time domain audio data
     */
    draw(waveformData) {
        if (!this.isRunning) return;

        // Clear canvas
        this.clearCanvas();

        // Draw grid if enabled
        if (this.showGrid) {
            this.drawGrid();
        }

        // Draw center line
        this.drawCenterLine();

        // Draw the waveform
        this.drawWaveform(waveformData);

        // Draw spike markers
        this.drawSpikeMarkers();
    }

    /**
     * Clear the canvas
     */
    clearCanvas() {
        this.ctx.fillStyle = this.backgroundColor;
        this.ctx.fillRect(0, 0, this.width, this.height);
    }

    /**
     * Draw grid lines for oscilloscope effect
     */
    drawGrid() {
        this.ctx.strokeStyle = this.gridColor;
        this.ctx.lineWidth = 1;
        this.ctx.globalAlpha = 0.3;

        const gridSpacing = 40;

        // Vertical lines
        for (let x = 0; x < this.width; x += gridSpacing) {
            this.ctx.beginPath();
            this.ctx.moveTo(x, 0);
            this.ctx.lineTo(x, this.height);
            this.ctx.stroke();
        }

        // Horizontal lines
        for (let y = 0; y < this.height; y += gridSpacing) {
            this.ctx.beginPath();
            this.ctx.moveTo(0, y);
            this.ctx.lineTo(this.width, y);
            this.ctx.stroke();
        }

        this.ctx.globalAlpha = 1.0;
    }

    /**
     * Draw center reference line
     */
    drawCenterLine() {
        const centerY = this.height / 2;

        this.ctx.strokeStyle = this.gridColor;
        this.ctx.lineWidth = 2;
        this.ctx.globalAlpha = 0.5;

        this.ctx.beginPath();
        this.ctx.moveTo(0, centerY);
        this.ctx.lineTo(this.width, centerY);
        this.ctx.stroke();

        this.ctx.globalAlpha = 1.0;
    }

    /**
     * Draw the waveform
     * @param {Uint8Array} waveformData - Time domain audio data
     */
    drawWaveform(waveformData) {
        if (!waveformData || waveformData.length === 0) return;

        // Apply glow effect
        if (this.showGlow) {
            this.ctx.shadowBlur = this.glowIntensity;
            this.ctx.shadowColor = this.waveformColor;
        }

        this.ctx.strokeStyle = this.waveformColor;
        this.ctx.lineWidth = this.lineWidth;
        this.ctx.lineCap = 'butt'; // Sharp corners instead of round for crisper spikes
        this.ctx.lineJoin = 'miter'; // Sharp joins for better spike definition

        this.ctx.beginPath();

        const sliceWidth = this.width / waveformData.length;
        let x = 0;

        for (let i = 0; i < waveformData.length; i++) {
            // Convert byte value (0-255) to normalized value (-1 to 1)
            let v = (waveformData[i] - 128) / 128.0;

            // AMPLIFY the waveform for sharper, more visible spikes
            v = v * this.amplification;

            // Clamp to prevent overflow
            v = Math.max(-1, Math.min(1, v));

            // Map to canvas coordinates with amplification
            const y = (this.height / 2) + (v * this.height / 2);

            if (i === 0) {
                this.ctx.moveTo(x, y);
            } else {
                this.ctx.lineTo(x, y);
            }

            x += sliceWidth;
        }

        this.ctx.stroke();

        // Reset shadow
        this.ctx.shadowBlur = 0;
    }

    /**
     * Alternative scrolling waveform visualization
     * Creates a scrolling oscilloscope effect
     * @param {Uint8Array} waveformData - Time domain audio data
     */
    drawScrollingWaveform(waveformData) {
        if (!waveformData || waveformData.length === 0) return;

        // Add current waveform to buffer
        this.waveformBuffer.push(Array.from(waveformData));

        // Limit buffer size
        if (this.waveformBuffer.length > this.bufferSize) {
            this.waveformBuffer.shift();
        }

        // Clear canvas
        this.clearCanvas();

        // Draw grid
        if (this.showGrid) {
            this.drawGrid();
        }

        // Draw center line
        this.drawCenterLine();

        // Apply glow
        if (this.showGlow) {
            this.ctx.shadowBlur = this.glowIntensity;
            this.ctx.shadowColor = this.waveformColor;
        }

        this.ctx.strokeStyle = this.waveformColor;
        this.ctx.lineWidth = this.lineWidth;

        // Draw each waveform in buffer
        const sliceWidth = this.width / this.bufferSize;

        for (let bufferIndex = 0; bufferIndex < this.waveformBuffer.length; bufferIndex++) {
            const waveform = this.waveformBuffer[bufferIndex];
            const x = bufferIndex * sliceWidth;

            // Sample a few points from each waveform
            const sampleCount = 5;
            const step = Math.floor(waveform.length / sampleCount);

            for (let i = 0; i < sampleCount; i++) {
                const dataIndex = i * step;
                if (dataIndex >= waveform.length) continue;

                const v = (waveform[dataIndex] - 128) / 128.0;
                const y = (this.height / 2) + (v * this.height / 2);

                if (i === 0 && bufferIndex === 0) {
                    this.ctx.moveTo(x, y);
                } else {
                    this.ctx.lineTo(x, y);
                }
            }
        }

        this.ctx.stroke();
        this.ctx.shadowBlur = 0;

        // Draw spike markers on scrolling waveform
        this.drawSpikeMarkers();
    }

    /**
     * Add spike marker to visualization
     * @param {Object} spikeInfo - Spike information
     */
    addSpikeMarker(spikeInfo) {
        const marker = {
            x: this.width, // Start at right edge
            magnitude: spikeInfo.magnitude,
            timestamp: spikeInfo.timestamp,
            alpha: 1.0
        };

        this.spikeMarkers.push(marker);

        // Limit number of markers
        if (this.spikeMarkers.length > this.maxSpikeMarkers) {
            this.spikeMarkers.shift();
        }
    }

    /**
     * Draw spike markers on waveform
     */
    drawSpikeMarkers() {
        // For static waveform, draw markers at current position
        for (let i = this.spikeMarkers.length - 1; i >= 0; i--) {
            const marker = this.spikeMarkers[i];

            // Fade out over time
            marker.alpha -= 0.01;

            if (marker.alpha <= 0) {
                this.spikeMarkers.splice(i, 1);
                continue;
            }

            // Draw vertical line
            this.ctx.strokeStyle = this.spikeColor;
            this.ctx.lineWidth = 3;
            this.ctx.globalAlpha = marker.alpha;

            // Draw at right edge for real-time visualization
            const x = this.width - 50;

            this.ctx.beginPath();
            this.ctx.moveTo(x, 0);
            this.ctx.lineTo(x, this.height);
            this.ctx.stroke();

            // Draw magnitude indicator
            this.ctx.fillStyle = this.spikeColor;
            this.ctx.font = '12px Courier New';
            this.ctx.fillText(
                `SPIKE: ${(marker.magnitude * 100).toFixed(0)}%`,
                x + 5,
                20
            );

            this.ctx.globalAlpha = 1.0;
        }
    }

    /**
     * Toggle grid display
     * @param {boolean} enabled - Grid visibility
     */
    setGridEnabled(enabled) {
        this.showGrid = enabled;
    }

    /**
     * Toggle glow effect
     * @param {boolean} enabled - Glow visibility
     */
    setGlowEnabled(enabled) {
        this.showGlow = enabled;
    }

    /**
     * Update waveform color
     * @param {string} color - CSS color string
     */
    setWaveformColor(color) {
        this.waveformColor = color;
    }

    /**
     * Update background color
     * @param {string} color - CSS color string
     */
    setBackgroundColor(color) {
        this.backgroundColor = color;
    }

    /**
     * Clear all spike markers
     */
    clearSpikeMarkers() {
        this.spikeMarkers = [];
    }

    /**
     * Reset visualizer state
     */
    reset() {
        this.waveformBuffer = [];
        this.clearSpikeMarkers();
        this.clearCanvas();
    }

    /**
     * Draw frequency spectrum visualization
     * Alternative visualization mode
     * @param {Uint8Array} frequencyData - Frequency domain data
     */
    drawSpectrum(frequencyData) {
        if (!frequencyData || frequencyData.length === 0) return;

        this.clearCanvas();

        if (this.showGrid) {
            this.drawGrid();
        }

        const barWidth = this.width / frequencyData.length;
        let x = 0;

        for (let i = 0; i < frequencyData.length; i++) {
            const barHeight = (frequencyData[i] / 255) * this.height;

            // Gradient color based on frequency
            const hue = (i / frequencyData.length) * 120; // 0 to 120 (red to green)
            this.ctx.fillStyle = `hsl(${hue}, 100%, 50%)`;

            this.ctx.fillRect(x, this.height - barHeight, barWidth, barHeight);

            x += barWidth;
        }
    }

    /**
     * Cleanup resources
     */
    dispose() {
        this.stop();
        window.removeEventListener('resize', () => this.setupCanvas());
        console.log('Waveform visualizer disposed');
    }
}
