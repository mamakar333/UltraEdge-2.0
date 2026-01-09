/**
 * AI Ball Tracker
 * Uses computer vision and deep learning for accurate ball detection and tracking
 * Trained on international cricket videos from multiple camera angles
 */

class AIBallTracker {
    constructor(canvas) {
        this.canvas = canvas;
        this.ctx = canvas ? canvas.getContext('2d') : null;

        this.model = null;
        this.isModelLoaded = false;
        this.isEnabled = true;

        // Detection parameters
        this.inputSize = 416; // YOLO-style input size
        this.confidenceThreshold = 0.5;
        this.iouThreshold = 0.4;

        // Tracking state
        this.detections = [];
        this.trackingHistory = [];
        this.currentPosition = null;
        this.predictedTrajectory = [];

        // Physics model for trajectory prediction
        this.gravity = 9.81; // m/s²
        this.pixelsPerMeter = 10; // Calibration factor

        // Ball characteristics
        this.ballRadius = 3.6; // Cricket ball radius in cm
        this.dragCoefficient = 0.5;

        // Trajectory smoothing
        this.smoothingWindow = 5;

        console.log('AI Ball Tracker initialized');
    }

    /**
     * Load pre-trained ball detection model
     */
    async loadModel(modelPath = '/models/cricket-ball-detector/model.json') {
        try {
            console.log('Loading AI ball detection model...');

            if (typeof tf === 'undefined') {
                console.error('TensorFlow.js not loaded');
                this.isEnabled = false;
                return false;
            }

            // Load YOLO-style object detection model
            this.model = await tf.loadGraphModel(modelPath);

            console.log('Ball detection model loaded successfully');
            this.isModelLoaded = true;

            return true;
        } catch (error) {
            console.warn('Failed to load ball detection model:', error);
            console.log('Falling back to traditional ball tracking');
            this.isEnabled = false;
            return false;
        }
    }

    /**
     * Detect ball in video frame using AI
     * @param {HTMLVideoElement} video - Video element
     * @returns {Array} Ball detections with bounding boxes
     */
    async detectBall(video) {
        if (!this.isModelLoaded || !this.isEnabled) {
            return [];
        }

        try {
            // Capture current video frame
            const frameTensor = tf.browser.fromPixels(video);

            // Resize to model input size
            const resized = tf.image.resizeBilinear(frameTensor, [this.inputSize, this.inputSize]);

            // Normalize pixel values to [0, 1]
            const normalized = resized.div(255.0);

            // Add batch dimension
            const batched = normalized.expandDims(0);

            // Run detection
            const predictions = await this.model.executeAsync(batched);

            // Process predictions
            const detections = await this.processPredictions(predictions, video.videoWidth, video.videoHeight);

            // Clean up tensors
            frameTensor.dispose();
            resized.dispose();
            normalized.dispose();
            batched.dispose();
            if (Array.isArray(predictions)) {
                predictions.forEach(t => t.dispose());
            } else {
                predictions.dispose();
            }

            return detections;
        } catch (error) {
            console.error('Error during ball detection:', error);
            return [];
        }
    }

    /**
     * Process model predictions into ball detections
     * @param {tf.Tensor} predictions - Model output
     * @param {number} originalWidth - Original frame width
     * @param {number} originalHeight - Original frame height
     * @returns {Array} Processed detections
     */
    async processPredictions(predictions, originalWidth, originalHeight) {
        // Extract prediction data
        let boxes, scores, classes;

        if (Array.isArray(predictions)) {
            // YOLO-style output: [boxes, scores, classes]
            boxes = await predictions[0].array();
            scores = await predictions[1].array();
            classes = await predictions[2].array();
        } else {
            // Single tensor output
            const data = await predictions.array();
            boxes = data[0];
            scores = data[1];
            classes = data[2];
        }

        const detections = [];

        // Filter by confidence threshold
        for (let i = 0; i < scores[0].length; i++) {
            if (scores[0][i] > this.confidenceThreshold) {
                // Class 0 is cricket ball in our trained model
                if (classes[0][i] === 0) {
                    const box = boxes[0][i];

                    detections.push({
                        x: box[1] * originalWidth,
                        y: box[0] * originalHeight,
                        width: (box[3] - box[1]) * originalWidth,
                        height: (box[2] - box[0]) * originalHeight,
                        confidence: scores[0][i],
                        centerX: ((box[1] + box[3]) / 2) * originalWidth,
                        centerY: ((box[0] + box[2]) / 2) * originalHeight
                    });
                }
            }
        }

        // Apply NMS (Non-Maximum Suppression)
        return this.applyNMS(detections);
    }

    /**
     * Apply Non-Maximum Suppression to filter overlapping detections
     */
    applyNMS(detections) {
        if (detections.length === 0) return [];

        // Sort by confidence
        detections.sort((a, b) => b.confidence - a.confidence);

        const filtered = [];
        const suppressed = new Set();

        for (let i = 0; i < detections.length; i++) {
            if (suppressed.has(i)) continue;

            filtered.push(detections[i]);

            for (let j = i + 1; j < detections.length; j++) {
                if (suppressed.has(j)) continue;

                const iou = this.calculateIOU(detections[i], detections[j]);
                if (iou > this.iouThreshold) {
                    suppressed.add(j);
                }
            }
        }

        return filtered;
    }

    /**
     * Calculate Intersection over Union (IOU)
     */
    calculateIOU(box1, box2) {
        const x1 = Math.max(box1.x, box2.x);
        const y1 = Math.max(box1.y, box2.y);
        const x2 = Math.min(box1.x + box1.width, box2.x + box2.width);
        const y2 = Math.min(box1.y + box1.height, box2.y + box2.height);

        const intersection = Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
        const area1 = box1.width * box1.height;
        const area2 = box2.width * box2.height;
        const union = area1 + area2 - intersection;

        return intersection / union;
    }

    /**
     * Update tracking with new detection
     */
    updateTracking(detections, timestamp) {
        if (detections.length === 0) {
            return;
        }

        // Take the highest confidence detection
        const detection = detections[0];

        this.currentPosition = {
            x: detection.centerX,
            y: detection.centerY,
            timestamp: timestamp,
            confidence: detection.confidence
        };

        this.trackingHistory.push(this.currentPosition);

        // Limit history size
        if (this.trackingHistory.length > 100) {
            this.trackingHistory.shift();
        }

        // Predict trajectory
        this.predictTrajectory();
    }

    /**
     * Predict ball trajectory using physics model
     */
    predictTrajectory() {
        if (this.trackingHistory.length < 3) {
            return;
        }

        // Get recent positions for velocity estimation
        const recent = this.trackingHistory.slice(-this.smoothingWindow);

        // Estimate velocity using linear regression
        const velocity = this.estimateVelocity(recent);

        // Predict future positions using physics
        this.predictedTrajectory = [];
        const steps = 20;
        const dt = 0.033; // 30fps

        let x = this.currentPosition.x;
        let y = this.currentPosition.y;
        let vx = velocity.vx;
        let vy = velocity.vy;

        for (let i = 0; i < steps; i++) {
            // Apply gravity
            vy += (this.gravity * this.pixelsPerMeter * dt);

            // Apply drag (simplified)
            const speed = Math.sqrt(vx * vx + vy * vy);
            const drag = this.dragCoefficient * speed * 0.01;
            vx *= (1 - drag);
            vy *= (1 - drag);

            // Update position
            x += vx * dt;
            y += vy * dt;

            this.predictedTrajectory.push({ x, y });
        }
    }

    /**
     * Estimate velocity from position history
     */
    estimateVelocity(positions) {
        if (positions.length < 2) {
            return { vx: 0, vy: 0 };
        }

        let sumVx = 0;
        let sumVy = 0;
        const count = positions.length - 1;

        for (let i = 1; i < positions.length; i++) {
            const dt = positions[i].timestamp - positions[i - 1].timestamp;
            if (dt > 0) {
                sumVx += (positions[i].x - positions[i - 1].x) / dt;
                sumVy += (positions[i].y - positions[i - 1].y) / dt;
            }
        }

        return {
            vx: sumVx / count,
            vy: sumVy / count
        };
    }

    /**
     * Calculate ball speed in km/h
     */
    calculateSpeed() {
        if (this.trackingHistory.length < 2) {
            return 0;
        }

        const recent = this.trackingHistory.slice(-5);
        const velocity = this.estimateVelocity(recent);

        // Convert pixels/second to km/h
        const speedPixelsPerSec = Math.sqrt(velocity.vx * velocity.vx + velocity.vy * velocity.vy);
        const speedMetersPerSec = speedPixelsPerSec / this.pixelsPerMeter;
        const speedKmPerHour = speedMetersPerSec * 3.6;

        return Math.round(speedKmPerHour);
    }

    /**
     * Detect bat-ball impact from trajectory analysis
     */
    detectImpact() {
        if (this.trackingHistory.length < 10) {
            return null;
        }

        const recent = this.trackingHistory.slice(-10);

        // Look for sudden change in velocity direction
        let maxDeflection = 0;
        let impactIndex = -1;

        for (let i = 2; i < recent.length - 2; i++) {
            const v1 = this.estimateVelocity(recent.slice(i - 2, i));
            const v2 = this.estimateVelocity(recent.slice(i, i + 2));

            // Calculate angle change
            const angle1 = Math.atan2(v1.vy, v1.vx);
            const angle2 = Math.atan2(v2.vy, v2.vx);
            let angleDiff = Math.abs(angle2 - angle1);

            if (angleDiff > Math.PI) {
                angleDiff = 2 * Math.PI - angleDiff;
            }

            if (angleDiff > maxDeflection) {
                maxDeflection = angleDiff;
                impactIndex = i;
            }
        }

        // If deflection is significant, it's likely an impact
        if (maxDeflection > Math.PI / 4) { // 45 degrees
            return {
                position: recent[impactIndex],
                deflectionAngle: maxDeflection * (180 / Math.PI),
                timestamp: recent[impactIndex].timestamp,
                isImpact: true
            };
        }

        return null;
    }

    /**
     * Render tracking visualization
     */
    render(video) {
        if (!this.ctx || !this.canvas) return;

        // Clear canvas
        this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);

        // Draw tracking history (ball trail)
        if (this.trackingHistory.length > 1) {
            this.ctx.strokeStyle = '#00ff41';
            this.ctx.lineWidth = 2;
            this.ctx.beginPath();

            for (let i = 0; i < this.trackingHistory.length; i++) {
                const pos = this.trackingHistory[i];
                if (i === 0) {
                    this.ctx.moveTo(pos.x, pos.y);
                } else {
                    this.ctx.lineTo(pos.x, pos.y);
                }
            }

            this.ctx.stroke();
        }

        // Draw current ball position
        if (this.currentPosition) {
            this.ctx.fillStyle = '#ff3333';
            this.ctx.beginPath();
            this.ctx.arc(this.currentPosition.x, this.currentPosition.y, 8, 0, Math.PI * 2);
            this.ctx.fill();

            // Draw confidence
            this.ctx.fillStyle = '#00ff41';
            this.ctx.font = '12px monospace';
            this.ctx.fillText(
                `${Math.round(this.currentPosition.confidence * 100)}%`,
                this.currentPosition.x + 10,
                this.currentPosition.y - 10
            );
        }

        // Draw predicted trajectory
        if (this.predictedTrajectory.length > 0) {
            this.ctx.strokeStyle = '#ffaa00';
            this.ctx.lineWidth = 2;
            this.ctx.setLineDash([5, 5]);
            this.ctx.beginPath();

            for (let i = 0; i < this.predictedTrajectory.length; i++) {
                const pos = this.predictedTrajectory[i];
                if (i === 0) {
                    this.ctx.moveTo(pos.x, pos.y);
                } else {
                    this.ctx.lineTo(pos.x, pos.y);
                }
            }

            this.ctx.stroke();
            this.ctx.setLineDash([]);
        }

        // Draw speed
        const speed = this.calculateSpeed();
        if (speed > 0) {
            this.ctx.fillStyle = '#00ff41';
            this.ctx.font = 'bold 16px monospace';
            this.ctx.fillText(`${speed} km/h`, 20, 30);
        }
    }

    /**
     * Get tracking data for decision system
     */
    getTrackingData() {
        const impact = this.detectImpact();

        return {
            currentPosition: this.currentPosition,
            speed: this.calculateSpeed(),
            trajectory: this.trackingHistory.map(p => ({ x: p.x, y: p.y })),
            predictedPath: this.predictedTrajectory,
            impact: impact,
            isTracking: this.trackingHistory.length > 0,
            confidence: this.currentPosition ? this.currentPosition.confidence : 0
        };
    }

    /**
     * Reset tracking
     */
    reset() {
        this.trackingHistory = [];
        this.currentPosition = null;
        this.predictedTrajectory = [];
    }

    /**
     * Set enabled state
     */
    setEnabled(enabled) {
        this.isEnabled = enabled && this.isModelLoaded;
    }

    /**
     * Get tracker status
     */
    getStatus() {
        return {
            modelLoaded: this.isModelLoaded,
            enabled: this.isEnabled,
            tracking: this.trackingHistory.length > 0,
            detections: this.trackingHistory.length,
            currentSpeed: this.calculateSpeed()
        };
    }
}
