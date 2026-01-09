/**
 * BallTracker Class
 * Simulates ball tracking visualization with trajectory, speed, and impact analysis
 * In production, this would integrate with actual ball tracking hardware/software
 */

class BallTracker {
    constructor(canvas) {
        this.canvas = canvas;
        this.ctx = canvas ? canvas.getContext('2d') : null;

        // Ball tracking data
        this.ballPosition = { x: 0, y: 0, z: 0 };
        this.ballVelocity = { x: 0, y: 0, z: 0 };
        this.ballSpeed = 0; // km/h
        this.trajectory = [];
        this.maxTrajectoryPoints = 50;

        // Impact data
        this.impactPoint = null;
        this.impactAngle = 0;
        this.impactTime = null;

        // Visualization settings
        this.ballColor = '#ffff00'; // Yellow
        this.trajectoryColor = '#00ff41';
        this.impactColor = '#ff3333';
        this.showTrajectory = true;
        this.showPrediction = true;

        // State
        this.isTracking = false;
        this.isEnabled = true;

        // Simulation parameters (for demo/testing)
        this.simulationActive = false;
        this.simulationTime = 0;

        // Callbacks
        this.onBallDetected = null;
        this.onImpact = null;
        this.onTrackingUpdate = null;
    }

    /**
     * Start ball tracking
     */
    start() {
        this.isTracking = true;
        console.log('Ball tracking started');
    }

    /**
     * Stop ball tracking
     */
    stop() {
        this.isTracking = false;
        console.log('Ball tracking stopped');
    }

    /**
     * Update ball position (from tracking system)
     * @param {Object} position - Ball position {x, y, z}
     * @param {number} timestamp - Timestamp
     */
    updatePosition(position, timestamp) {
        if (!this.isTracking || !this.isEnabled) return;

        // Store previous position for velocity calculation
        const prevPos = { ...this.ballPosition };

        // Update position
        this.ballPosition = { ...position };

        // Calculate velocity
        if (prevPos.x !== 0 || prevPos.y !== 0) {
            this.ballVelocity = {
                x: position.x - prevPos.x,
                y: position.y - prevPos.y,
                z: position.z - prevPos.z
            };

            // Calculate speed (rough estimate)
            const speed = Math.sqrt(
                this.ballVelocity.x ** 2 +
                this.ballVelocity.y ** 2 +
                this.ballVelocity.z ** 2
            );
            this.ballSpeed = speed * 3.6; // Convert to km/h (rough estimate)
        }

        // Add to trajectory
        this.trajectory.push({
            position: { ...position },
            timestamp: timestamp,
            speed: this.ballSpeed
        });

        // Limit trajectory points
        if (this.trajectory.length > this.maxTrajectoryPoints) {
            this.trajectory.shift();
        }

        // Check for impact
        this.detectImpact(position, timestamp);

        // Trigger callback
        if (this.onTrackingUpdate) {
            this.onTrackingUpdate(this.getTrackingData());
        }

        // Render visualization
        if (this.canvas) {
            this.render();
        }
    }

    /**
     * Detect ball impact (bat contact, ground contact, etc.)
     * @param {Object} position - Current position
     * @param {number} timestamp - Timestamp
     */
    detectImpact(position, timestamp) {
        // Simple impact detection based on sudden velocity change
        if (this.trajectory.length < 2) return;

        const prev = this.trajectory[this.trajectory.length - 2];
        const current = this.trajectory[this.trajectory.length - 1];

        const velocityChange = Math.abs(current.speed - prev.speed);

        // If speed changes dramatically, assume impact
        if (velocityChange > 20) { // threshold
            this.impactPoint = { ...position };
            this.impactTime = timestamp;

            // Calculate impact angle (simplified)
            this.impactAngle = Math.atan2(
                this.ballVelocity.y,
                this.ballVelocity.x
            ) * (180 / Math.PI);

            console.log('Impact detected:', {
                point: this.impactPoint,
                angle: this.impactAngle,
                speed: this.ballSpeed
            });

            if (this.onImpact) {
                this.onImpact({
                    point: this.impactPoint,
                    angle: this.impactAngle,
                    speed: this.ballSpeed,
                    timestamp: timestamp
                });
            }
        }
    }

    /**
     * Get current tracking data
     * @returns {Object} Tracking data
     */
    getTrackingData() {
        return {
            position: this.ballPosition,
            velocity: this.ballVelocity,
            speed: this.ballSpeed.toFixed(1) + ' km/h',
            impactPoint: this.impactPoint,
            impactAngle: this.impactAngle ? this.impactAngle.toFixed(1) + '°' : '-',
            trajectory: this.trajectory.length + ' points'
        };
    }

    /**
     * Render ball tracking visualization
     */
    render() {
        if (!this.canvas || !this.ctx) return;

        const width = this.canvas.width;
        const height = this.canvas.height;

        // Clear canvas
        this.ctx.clearRect(0, 0, width, height);

        // Draw trajectory
        if (this.showTrajectory && this.trajectory.length > 1) {
            this.drawTrajectory();
        }

        // Draw current ball position
        if (this.isTracking) {
            this.drawBall();
        }

        // Draw impact point
        if (this.impactPoint) {
            this.drawImpactPoint();
        }

        // Draw prediction path
        if (this.showPrediction && this.trajectory.length > 3) {
            this.drawPrediction();
        }
    }

    /**
     * Draw ball trajectory
     */
    drawTrajectory() {
        const ctx = this.ctx;
        const width = this.canvas.width;
        const height = this.canvas.height;

        ctx.strokeStyle = this.trajectoryColor;
        ctx.lineWidth = 2;
        ctx.beginPath();

        this.trajectory.forEach((point, index) => {
            // Map 3D position to 2D canvas
            const x = (point.position.x / 100) * width;
            const y = height - (point.position.y / 100) * height;

            if (index === 0) {
                ctx.moveTo(x, y);
            } else {
                ctx.lineTo(x, y);
            }
        });

        ctx.stroke();

        // Draw trajectory points
        ctx.fillStyle = this.trajectoryColor;
        this.trajectory.forEach(point => {
            const x = (point.position.x / 100) * width;
            const y = height - (point.position.y / 100) * height;
            ctx.beginPath();
            ctx.arc(x, y, 2, 0, Math.PI * 2);
            ctx.fill();
        });
    }

    /**
     * Draw current ball
     */
    drawBall() {
        const ctx = this.ctx;
        const width = this.canvas.width;
        const height = this.canvas.height;

        const x = (this.ballPosition.x / 100) * width;
        const y = height - (this.ballPosition.y / 100) * height;

        // Draw ball
        ctx.fillStyle = this.ballColor;
        ctx.shadowBlur = 15;
        ctx.shadowColor = this.ballColor;

        ctx.beginPath();
        ctx.arc(x, y, 8, 0, Math.PI * 2);
        ctx.fill();

        ctx.shadowBlur = 0;

        // Draw speed label
        ctx.fillStyle = '#ffffff';
        ctx.font = '12px Courier New';
        ctx.fillText(`${this.ballSpeed.toFixed(0)} km/h`, x + 15, y - 10);
    }

    /**
     * Draw impact point
     */
    drawImpactPoint() {
        const ctx = this.ctx;
        const width = this.canvas.width;
        const height = this.canvas.height;

        const x = (this.impactPoint.x / 100) * width;
        const y = height - (this.impactPoint.y / 100) * height;

        // Draw impact marker
        ctx.strokeStyle = this.impactColor;
        ctx.lineWidth = 3;
        ctx.shadowBlur = 10;
        ctx.shadowColor = this.impactColor;

        // Draw X marker
        const size = 15;
        ctx.beginPath();
        ctx.moveTo(x - size, y - size);
        ctx.lineTo(x + size, y + size);
        ctx.moveTo(x + size, y - size);
        ctx.lineTo(x - size, y + size);
        ctx.stroke();

        ctx.shadowBlur = 0;

        // Draw label
        ctx.fillStyle = this.impactColor;
        ctx.font = 'bold 12px Courier New';
        ctx.fillText('IMPACT', x + 20, y);
    }

    /**
     * Draw predicted trajectory
     */
    drawPrediction() {
        if (this.trajectory.length < 3) return;

        const ctx = this.ctx;
        const width = this.canvas.width;
        const height = this.canvas.height;

        // Get last few points for prediction
        const recent = this.trajectory.slice(-3);

        // Simple linear prediction
        const lastPoint = recent[recent.length - 1];
        const avgVelocity = {
            x: recent.reduce((sum, p, i, arr) => {
                if (i === 0) return 0;
                return sum + (p.position.x - arr[i - 1].position.x);
            }, 0) / (recent.length - 1),
            y: recent.reduce((sum, p, i, arr) => {
                if (i === 0) return 0;
                return sum + (p.position.y - arr[i - 1].position.y);
            }, 0) / (recent.length - 1)
        };

        // Draw predicted path (dashed line)
        ctx.strokeStyle = this.trajectoryColor;
        ctx.setLineDash([5, 5]);
        ctx.lineWidth = 1;
        ctx.globalAlpha = 0.5;

        ctx.beginPath();
        const startX = (lastPoint.position.x / 100) * width;
        const startY = height - (lastPoint.position.y / 100) * height;
        ctx.moveTo(startX, startY);

        // Project 10 steps forward
        for (let i = 1; i <= 10; i++) {
            const predX = ((lastPoint.position.x + avgVelocity.x * i) / 100) * width;
            const predY = height - ((lastPoint.position.y + avgVelocity.y * i) / 100) * height;
            ctx.lineTo(predX, predY);
        }

        ctx.stroke();
        ctx.setLineDash([]);
        ctx.globalAlpha = 1.0;
    }

    /**
     * Start simulation (for testing/demo)
     * Simulates a ball being bowled and hit
     */
    startSimulation() {
        this.simulationActive = true;
        this.simulationTime = 0;
        this.trajectory = [];
        this.impactPoint = null;

        const simulate = () => {
            if (!this.simulationActive) return;

            this.simulationTime += 0.05; // 50ms steps
            const t = this.simulationTime;

            // Simulate ball trajectory (parabolic path)
            let x, y, z;

            if (t < 1.0) {
                // Ball approaching (before impact)
                x = 20 + t * 30;
                y = 20 + Math.sin(t * Math.PI) * 15;
                z = 0;
            } else if (t < 1.2) {
                // Impact moment
                x = 50;
                y = 25;
                z = 0;
            } else {
                // Ball departing (after impact)
                const t2 = t - 1.2;
                x = 50 + t2 * 40;
                y = 25 + t2 * 20 - (t2 * t2 * 9.8);
                z = t2 * 5;
            }

            this.updatePosition({ x, y, z }, t);

            if (t < 3.0) {
                setTimeout(simulate, 50);
            } else {
                this.simulationActive = false;
                console.log('Simulation complete');
            }
        };

        this.start();
        simulate();
    }

    /**
     * Stop simulation
     */
    stopSimulation() {
        this.simulationActive = false;
    }

    /**
     * Clear trajectory and data
     */
    clear() {
        this.trajectory = [];
        this.impactPoint = null;
        this.impactTime = null;
        this.ballPosition = { x: 0, y: 0, z: 0 };
        this.ballSpeed = 0;

        if (this.canvas) {
            this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
        }
    }

    /**
     * Enable/disable tracking
     * @param {boolean} enabled - Enable state
     */
    setEnabled(enabled) {
        this.isEnabled = enabled;
        console.log('Ball tracking', enabled ? 'enabled' : 'disabled');
    }

    /**
     * Toggle trajectory display
     * @param {boolean} show - Show trajectory
     */
    setShowTrajectory(show) {
        this.showTrajectory = show;
    }

    /**
     * Toggle prediction display
     * @param {boolean} show - Show prediction
     */
    setShowPrediction(show) {
        this.showPrediction = show;
    }

    /**
     * Dispose resources
     */
    dispose() {
        this.stop();
        this.clear();
        console.log('BallTracker disposed');
    }
}
