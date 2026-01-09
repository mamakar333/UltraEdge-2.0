/**
 * MultiCameraSync Class - Synchronizes multiple camera feeds
 */
class MultiCameraSync {
    constructor() {
        this.cameras = new Map();
        this.syncOffsets = new Map();
        this.masterCamera = null;
    }

    addCamera(id, videoElement) {
        this.cameras.set(id, {
            element: videoElement,
            syncOffset: 0,
            isActive: false
        });

        if (!this.masterCamera) {
            this.masterCamera = id;
        }

        console.log(`Camera ${id} added`);
    }

    removeCamera(id) {
        this.cameras.delete(id);
        this.syncOffsets.delete(id);
    }

    setSyncOffset(cameraId, offsetMs) {
        if (this.cameras.has(cameraId)) {
            const camera = this.cameras.get(cameraId);
            camera.syncOffset = offsetMs;
            this.syncOffsets.set(cameraId, offsetMs);
            console.log(`Camera ${cameraId} offset: ${offsetMs}ms`);
        }
    }

    syncToMaster() {
        if (!this.masterCamera) return;

        const master = this.cameras.get(this.masterCamera);
        if (!master) return;

        const masterTime = master.element.currentTime;

        this.cameras.forEach((camera, id) => {
            if (id !== this.masterCamera && camera.element) {
                const targetTime = masterTime + (camera.syncOffset / 1000);
                if (Math.abs(camera.element.currentTime - targetTime) > 0.1) {
                    camera.element.currentTime = targetTime;
                }
            }
        });
    }

    getMaxOffset() {
        let max = 0;
        this.syncOffsets.forEach(offset => {
            max = Math.max(max, Math.abs(offset));
        });
        return max;
    }

    getCameraSyncStatus(id) {
        const camera = this.cameras.get(id);
        if (!camera) return { synced: false };

        return {
            synced: camera.isActive,
            offset: camera.syncOffset
        };
    }

    dispose() {
        this.cameras.clear();
        this.syncOffsets.clear();
    }
}
