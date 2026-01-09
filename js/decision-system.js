/**
 * DecisionSystem Class
 * Analyzes Ultra Edge, Hot-Spot, and Ball Tracking data to make DRS decisions
 * Provides confidence levels and detailed breakdown
 */

class DecisionSystem {
    constructor() {
        // Decision factors
        this.ultraEdgeDetection = null;
        this.hotSpotDetection = null;
        this.ballTrackingData = null;

        // Decision result
        this.currentDecision = null;
        this.confidence = 0;

        // Thresholds
        this.confidenceThreshold = 70; // Minimum confidence for decision
        this.spikeThreshold = 0.3; // Ultra Edge spike threshold
        this.hotSpotThreshold = 0.6; // Hot-Spot detection threshold

        // Callbacks
        this.onDecisionMade = null;
        this.onAnalysisUpdate = null;
    }

    /**
     * Analyze all available data and make decision
     * @param {Object} data - Analysis data
     * @returns {Object} Decision result
     */
    analyzeDecision(data) {
        const {
            ultraEdge = null,
            hotSpot = null,
            ballTracking = null,
            timestamp = null
        } = data;

        // Store detection data
        this.ultraEdgeDetection = ultraEdge;
        this.hotSpotDetection = hotSpot;
        this.ballTrackingData = ballTracking;

        // Perform multi-factor analysis
        const analysis = {
            ultraEdge: this.analyzeUltraEdge(ultraEdge),
            hotSpot: this.analyzeHotSpot(hotSpot),
            ballTracking: this.analyzeBallTracking(ballTracking),
            timestamp: timestamp
        };

        // Calculate overall decision
        const decision = this.calculateDecision(analysis);

        // Store result
        this.currentDecision = decision;

        // Trigger callback
        if (this.onDecisionMade) {
            this.onDecisionMade(decision);
        }

        if (this.onAnalysisUpdate) {
            this.onAnalysisUpdate(analysis);
        }

        return decision;
    }

    /**
     * Analyze Ultra Edge data
     * @param {Object} ultraEdge - Ultra Edge detection data
     * @returns {Object} Analysis result
     */
    analyzeUltraEdge(ultraEdge) {
        if (!ultraEdge) {
            return {
                detected: false,
                confidence: 0,
                status: 'NO DATA',
                details: 'Ultra Edge data not available'
            };
        }

        const { magnitude, rms, timestamp } = ultraEdge;

        // Check if spike exceeds threshold
        const detected = magnitude > this.spikeThreshold;

        // Calculate confidence based on spike magnitude
        const confidence = Math.min(100, (magnitude / this.spikeThreshold) * 50);

        return {
            detected: detected,
            confidence: confidence,
            magnitude: magnitude,
            timestamp: timestamp,
            status: detected ? 'SPIKE DETECTED' : 'NO SPIKE',
            details: detected
                ? `Spike magnitude: ${(magnitude * 100).toFixed(1)}%`
                : 'No significant audio spike detected'
        };
    }

    /**
     * Analyze Hot-Spot data
     * @param {Object} hotSpot - Hot-Spot detection data
     * @returns {Object} Analysis result
     */
    analyzeHotSpot(hotSpot) {
        if (!hotSpot) {
            return {
                detected: false,
                confidence: 0,
                status: 'NO DATA',
                details: 'Hot-Spot data not available'
            };
        }

        const { heatDetected, intensity, location } = hotSpot;

        // Check if heat exceeds threshold
        const detected = heatDetected && intensity > this.hotSpotThreshold;

        // Calculate confidence
        const confidence = detected ? Math.min(100, intensity * 100) : 0;

        return {
            detected: detected,
            confidence: confidence,
            intensity: intensity,
            location: location,
            status: detected ? 'HEAT DETECTED' : 'NO HEAT',
            details: detected
                ? `Heat intensity: ${(intensity * 100).toFixed(1)}% at ${location || 'unknown'}`
                : 'No significant heat signature detected'
        };
    }

    /**
     * Analyze Ball Tracking data
     * @param {Object} ballTracking - Ball tracking data
     * @returns {Object} Analysis result
     */
    analyzeBallTracking(ballTracking) {
        if (!ballTracking) {
            return {
                detected: false,
                confidence: 0,
                status: 'NO DATA',
                details: 'Ball tracking data not available'
            };
        }

        const { impactPoint, impactAngle, trajectory } = ballTracking;

        // Check if impact was detected
        const detected = impactPoint !== null;

        // Confidence based on trajectory consistency
        const confidence = detected ? 75 : 0; // Simplified

        return {
            detected: detected,
            confidence: confidence,
            impactPoint: impactPoint,
            impactAngle: impactAngle,
            status: detected ? 'IMPACT TRACKED' : 'NO IMPACT',
            details: detected
                ? `Impact at ${impactAngle}° angle`
                : 'No ball-bat contact detected in tracking'
        };
    }

    /**
     * Calculate overall decision from all analyses
     * @param {Object} analysis - Combined analysis
     * @returns {Object} Decision result
     */
    calculateDecision(analysis) {
        const { ultraEdge, hotSpot, ballTracking } = analysis;

        // Count positive detections
        let positiveCount = 0;
        let totalConfidence = 0;
        let dataSourceCount = 0;

        if (ultraEdge.detected) {
            positiveCount++;
            totalConfidence += ultraEdge.confidence;
        }
        if (ultraEdge.confidence > 0) dataSourceCount++;

        if (hotSpot.detected) {
            positiveCount++;
            totalConfidence += hotSpot.confidence;
        }
        if (hotSpot.confidence > 0) dataSourceCount++;

        if (ballTracking.detected) {
            positiveCount++;
            totalConfidence += ballTracking.confidence;
        }
        if (ballTracking.confidence > 0) dataSourceCount++;

        // Calculate overall confidence
        const averageConfidence = dataSourceCount > 0
            ? totalConfidence / dataSourceCount
            : 0;

        // Make decision
        let decision = 'INCONCLUSIVE';
        let reasoning = '';

        if (dataSourceCount === 0) {
            decision = 'INSUFFICIENT DATA';
            reasoning = 'No detection systems provided data';
        } else if (positiveCount >= 2) {
            // At least 2 systems detected contact
            decision = 'OUT';
            reasoning = `${positiveCount} of ${dataSourceCount} systems detected contact`;
        } else if (positiveCount === 1 && averageConfidence >= this.confidenceThreshold) {
            // 1 system detected with high confidence
            decision = 'LIKELY OUT';
            reasoning = 'Single high-confidence detection';
        } else if (positiveCount === 0) {
            decision = 'NOT OUT';
            reasoning = 'No contact detected by any system';
        } else {
            decision = 'INCONCLUSIVE';
            reasoning = 'Conflicting or low-confidence data';
        }

        return {
            decision: decision,
            confidence: Math.round(averageConfidence),
            reasoning: reasoning,
            breakdown: {
                ultraEdge: ultraEdge.status,
                hotSpot: hotSpot.status,
                ballTracking: ballTracking.status
            },
            positiveDetections: positiveCount,
            dataSources: dataSourceCount,
            timestamp: analysis.timestamp || Date.now(),
            details: {
                ultraEdge: ultraEdge.details,
                hotSpot: hotSpot.details,
                ballTracking: ballTracking.details
            }
        };
    }

    /**
     * Quick decision based on spike detection alone
     * @param {Object} spikeData - Spike detection data
     * @returns {Object} Quick decision
     */
    quickDecision(spikeData) {
        const ultraEdgeAnalysis = this.analyzeUltraEdge(spikeData);

        let decision = 'REVIEW REQUIRED';

        if (ultraEdgeAnalysis.detected && ultraEdgeAnalysis.confidence >= 70) {
            decision = 'POSSIBLE EDGE';
        } else if (!ultraEdgeAnalysis.detected) {
            decision = 'NO EDGE';
        }

        return {
            decision: decision,
            confidence: ultraEdgeAnalysis.confidence,
            details: ultraEdgeAnalysis.details,
            quickAnalysis: true
        };
    }

    /**
     * Get decision history
     * @returns {Object} Current decision or null
     */
    getCurrentDecision() {
        return this.currentDecision;
    }

    /**
     * Get decision as formatted string
     * @returns {string} Formatted decision
     */
    getDecisionString() {
        if (!this.currentDecision) {
            return 'NO DECISION MADE';
        }

        const { decision, confidence } = this.currentDecision;
        return `${decision} (${confidence}% confidence)`;
    }

    /**
     * Get decision color code
     * @returns {string} Color code for UI
     */
    getDecisionColor() {
        if (!this.currentDecision) return '#999999';

        const { decision } = this.currentDecision;

        const colorMap = {
            'OUT': '#ff3333',
            'LIKELY OUT': '#ffaa00',
            'NOT OUT': '#00ff41',
            'INCONCLUSIVE': '#ffaa00',
            'INSUFFICIENT DATA': '#999999'
        };

        return colorMap[decision] || '#999999';
    }

    /**
     * Export decision report
     * @returns {Object} Complete decision report
     */
    exportReport() {
        if (!this.currentDecision) {
            return { error: 'No decision available' };
        }

        return {
            ...this.currentDecision,
            exportTime: new Date().toISOString(),
            systemVersion: '1.0.0',
            thresholds: {
                confidence: this.confidenceThreshold,
                ultraEdge: this.spikeThreshold,
                hotSpot: this.hotSpotThreshold
            }
        };
    }

    /**
     * Set confidence threshold
     * @param {number} threshold - Confidence threshold (0-100)
     */
    setConfidenceThreshold(threshold) {
        this.confidenceThreshold = Math.max(0, Math.min(100, threshold));
        console.log('Confidence threshold set to:', this.confidenceThreshold);
    }

    /**
     * Reset decision
     */
    reset() {
        this.currentDecision = null;
        this.ultraEdgeDetection = null;
        this.hotSpotDetection = null;
        this.ballTrackingData = null;
        this.confidence = 0;
        console.log('Decision system reset');
    }

    /**
     * Simulate decision (for testing)
     * @returns {Object} Simulated decision
     */
    simulateDecision() {
        // Generate random detection data
        const hasSpike = Math.random() > 0.5;
        const hasHeat = Math.random() > 0.6;
        const hasImpact = Math.random() > 0.5;

        const data = {
            ultraEdge: hasSpike ? {
                magnitude: 0.3 + Math.random() * 0.4,
                rms: 0.5,
                timestamp: Date.now()
            } : null,
            hotSpot: hasHeat ? {
                heatDetected: true,
                intensity: 0.6 + Math.random() * 0.3,
                location: 'bat edge'
            } : null,
            ballTracking: hasImpact ? {
                impactPoint: { x: 50, y: 25, z: 0 },
                impactAngle: 45 + Math.random() * 20,
                trajectory: []
            } : null
        };

        return this.analyzeDecision(data);
    }
}
