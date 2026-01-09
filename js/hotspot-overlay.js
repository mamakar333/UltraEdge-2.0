/**
 * HotSpotOverlay Class
 * Simulates thermal imaging (Hot-Spot) overlay for contact detection
 * Visualizes heat signatures on bat/pad contact
 */

class HotSpotOverlay {
    constructor(canvas) {
        this.canvas = canvas;
        this.ctx = canvas ? canvas.getContext('2d') : null;

        // Heat map data
        this.heatMap = [];
        this.maxHeatPoints = 100;

        // Detection state
        this.heatDetected = false;
        this.maxIntensity = 0;
        this.detectionLocation = null;

        // Visual settings
        this.enabled = false;
        this.colorScheme = 'thermal'; // 'thermal' or 'grayscale'

        // Heat decay
        this.heatDecayRate = 0.95;

        // Callbacks
        this.onHeatDetected = null;
    }

    /**
     * Initialize hot-spot system
     */
    initialize() {
        if (!this.canvas) {
            console.warn('No canvas provided for HotSpot');
            return false;
        }

        console.log('HotSpot overlay initialized');
        return true;
    }

    /**
     * Add heat point (simulates thermal detection)
     * @param {number} x - X coordinate
     * @param {number} y - Y coordinate
     * @param {number} intensity - Heat intensity (0-1)
     */
    addHeatPoint(x, y, intensity = 0.8) {
        this.heatMap.push({
            x: x,
            y: y,
            intensity: intensity,
            timestamp: Date.now(),
            radius: 20 + Math.random() * 10
        });

        // Limit heat points
        if (this.heatMap.length > this.maxHeatPoints) {
            this.heatMap.shift();
        }

        // Update detection
        if (intensity > 0.6) {
            this.heatDetected = true;
            this.maxIntensity = Math.max(this.maxIntensity, intensity);
            this.detectionLocation = { x, y };

            if (this.onHeatDetected) {
                this.onHeatDetected({
                    heatDetected: true,
                    intensity: intensity,
                    location: `(${x.toFixed(0)}, ${y.toFixed(0)})`
                });
            }
        }
    }

    /**
     * Analyze frame for heat signatures
     * @param {ImageData} frameData - Video frame data
     * @param {Object} targetRegion - Region to analyze
     */
    analyzeFrame(frameData, targetRegion = null) {
        if (!this.enabled || !frameData) return;

        // Simplified heat detection
        // In production, this would use IR camera data or ML-based detection

        // Simulate random heat detection for demo
        if (Math.random() > 0.95) { // 5% chance per frame
            const width = frameData.width;
            const height = frameData.height;

            const x = targetRegion
                ? targetRegion.x + Math.random() * targetRegion.width
                : Math.random() * width;

            const y = targetRegion
                ? targetRegion.y + Math.random() * targetRegion.height
                : Math.random() * height;

            this.addHeatPoint(x, y, 0.6 + Math.random() * 0.4);
        }
    }

    /**
     * Render hot-spot overlay
     */
    render() {
        if (!this.canvas || !this.ctx || !this.enabled) return;

        const width = this.canvas.width;
        const height = this.canvas.height;

        // Clear canvas
        this.ctx.clearRect(0, 0, width, height);

        // Apply heat decay
        this.heatMap.forEach(point => {
            point.intensity *= this.heatDecayRate;
        });

        // Remove faded points
        this.heatMap = this.heatMap.filter(point => point.intensity > 0.05);

        // Draw heat points
        this.heatMap.forEach(point => {
            this.drawHeatPoint(point);
        });

        // Draw detection indicator
        if (this.heatDetected && this.detectionLocation) {
            this.drawDetectionIndicator();
        }
    }

    /**
     * Draw individual heat point
     * @param {Object} point - Heat point data
     */
    drawHeatPoint(point) {
        const ctx = this.ctx;
        const { x, y, intensity, radius } = point;

        // Create radial gradient for heat effect
        const gradient = ctx.createRadialGradient(x, y, 0, x, y, radius);

        if (this.colorScheme === 'thermal') {
            // Thermal color scheme (blue -> red)
            const color = this.intensityToThermalColor(intensity);
            gradient.addColorStop(0, `rgba(${color.r}, ${color.g}, ${color.b}, ${intensity})`);
            gradient.addColorStop(0.5, `rgba(${color.r}, ${color.g}, ${color.b}, ${intensity * 0.5})`);
            gradient.addColorStop(1, `rgba(${color.r}, ${color.g}, ${color.b}, 0)`);
        } else {
            // Grayscale
            const brightness = Math.floor(intensity * 255);
            gradient.addColorStop(0, `rgba(${brightness}, ${brightness}, ${brightness}, ${intensity})`);
            gradient.addColorStop(1, `rgba(${brightness}, ${brightness}, ${brightness}, 0)`);
        }

        ctx.fillStyle = gradient;
        ctx.beginPath();
        ctx.arc(x, y, radius, 0, Math.PI * 2);
        ctx.fill();
    }

    /**
     * Convert intensity to thermal color
     * @param {number} intensity - Heat intensity (0-1)
     * @returns {Object} RGB color object
     */
    intensityToThermalColor(intensity) {
        // Thermal color map: blue (cold) -> green -> yellow -> red (hot)
        let r, g, b;

        if (intensity < 0.25) {
            // Blue to cyan
            const t = intensity / 0.25;
            r = 0;
            g = Math.floor(t * 255);
            b = 255;
        } else if (intensity < 0.5) {
            // Cyan to green
            const t = (intensity - 0.25) / 0.25;
            r = 0;
            g = 255;
            b = Math.floor((1 - t) * 255);
        } else if (intensity < 0.75) {
            // Green to yellow
            const t = (intensity - 0.5) / 0.25;
            r = Math.floor(t * 255);
            g = 255;
            b = 0;
        } else {
            // Yellow to red
            const t = (intensity - 0.75) / 0.25;
            r = 255;
            g = Math.floor((1 - t) * 255);
            b = 0;
        }

        return { r, g, b };
    }

    /**
     * Draw detection indicator
     */
    drawDetectionIndicator() {
        const ctx = this.ctx;
        const { x, y } = this.detectionLocation;

        // Draw pulsing circle
        const pulseRadius = 30 + Math.sin(Date.now() / 200) * 5;

        ctx.strokeStyle = '#ff3333';
        ctx.lineWidth = 3;
        ctx.setLineDash([5, 5]);

        ctx.beginPath();
        ctx.arc(x, y, pulseRadius, 0, Math.PI * 2);
        ctx.stroke();

        ctx.setLineDash([]);

        // Draw label
        ctx.fillStyle = '#ff3333';
        ctx.font = 'bold 14px Courier New';
        ctx.shadowBlur = 5;
        ctx.shadowColor = '#ff3333';
        ctx.fillText('HEAT DETECTED', x + 40, y);
        ctx.shadowBlur = 0;
    }

    /**
     * Simulate heat signature (for testing)
     * @param {string} location - Location ('bat', 'pad', 'glove')
     */
    simulateHeat(location = 'bat') {
        if (!this.enabled) {
            console.warn('HotSpot not enabled');
            return;
        }

        const width = this.canvas.width;
        const height = this.canvas.height;

        // Define regions for different locations
        const regions = {
            bat: { x: width * 0.5, y: height * 0.5 },
            pad: { x: width * 0.3, y: height * 0.7 },
            glove: { x: width * 0.6, y: height * 0.3 }
        };

        const pos = regions[location] || regions.bat;

        // Add multiple heat points for realistic effect
        for (let i = 0; i < 5; i++) {
            const offsetX = (Math.random() - 0.5) * 40;
            const offsetY = (Math.random() - 0.5) * 40;

            this.addHeatPoint(
                pos.x + offsetX,
                pos.y + offsetY,
                0.7 + Math.random() * 0.3
            );
        }

        console.log('Heat signature simulated at:', location);
    }

    /**
     * Get detection data
     * @returns {Object} Detection data
     */
    getDetectionData() {
        return {
            heatDetected: this.heatDetected,
            intensity: this.maxIntensity,
            location: this.detectionLocation
                ? `(${this.detectionLocation.x.toFixed(0)}, ${this.detectionLocation.y.toFixed(0)})`
                : null,
            activePoints: this.heatMap.length
        };
    }

    /**
     * Clear heat map
     */
    clear() {
        this.heatMap = [];
        this.heatDetected = false;
        this.maxIntensity = 0;
        this.detectionLocation = null;

        if (this.canvas) {
            this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
        }
    }

    /**
     * Enable/disable hot-spot
     * @param {boolean} enabled - Enable state
     */
    setEnabled(enabled) {
        this.enabled = enabled;

        if (!enabled) {
            this.clear();
        }

        console.log('HotSpot', enabled ? 'enabled' : 'disabled');
    }

    /**
     * Set color scheme
     * @param {string} scheme - 'thermal' or 'grayscale'
     */
    setColorScheme(scheme) {
        this.colorScheme = scheme;
    }

    /**
     * Dispose resources
     */
    dispose() {
        this.clear();
        console.log('HotSpot overlay disposed');
    }
}
