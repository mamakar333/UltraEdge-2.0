/**
 * VDO.ninja SDK Connector
 * Uses VDO.ninja JavaScript SDK for direct MediaStream access (no iframe)
 * Phone pushes to room, laptop receives stream via WebRTC
 *
 * Setup:
 * - Phone: https://vdo.ninja/?push=ROOMNAME&label=StumpMic
 * - Laptop: Uses this SDK to join ROOMNAME and receive MediaStream
 */

class VdoNinjaSdkConnector {
    constructor() {
        this.vdo = null;
        this.isConnected = false;
        this.roomName = null;
        this.password = null;
        this.mediaStream = null; // Combined MediaStream with all tracks
        this.videoElement = null; // Video element for playback
        this.videoElementCreated = false; // Track if we created the video element

        // Callbacks
        this.onConnectionChange = null;
        this.onError = null;
        this.onStreamReceived = null;
        this.onTrackReceived = null;
    }

    /**
     * Initialize the VDO.ninja SDK
     * Must be called before connect()
     */
    async init() {
        try {
            // Check if SDK is loaded
            if (typeof VDONinjaSDK === 'undefined') {
                throw new Error('VDO.ninja SDK not loaded. Include: <script src="https://cdn.jsdelivr.net/gh/steveseguin/ninjasdk@latest/vdoninja-sdk.min.js"></script>');
            }

            // Create SDK instance.
            // salt:"vdo.ninja" is REQUIRED — it sets the SRTP encryption key
            // used by the vdo.ninja website. Without it the media is encrypted
            // with a different key and no audio/video comes through.
            this.vdo = new VDONinjaSDK({
                host: 'wss://wss.vdo.ninja',
                salt: 'vdo.ninja',
            });

            // Setup event listeners
            this.setupEventListeners();

            console.log('VDO.ninja SDK initialized');
            return true;
        } catch (error) {
            console.error('Failed to initialize VDO.ninja SDK:', error);
            if (this.onError) {
                this.onError(error);
            }
            return false;
        }
    }

    /**
     * Setup SDK event listeners
     */
    setupEventListeners() {
        // Connected to signaling server
        this.vdo.addEventListener('connected', (event) => {
            console.log('Connected to VDO.ninja signaling server');
        });

        // Received a media track from remote peer
        this.vdo.addEventListener('track', (event) => {
            const { track, uuid, streamID } = event.detail;
            console.log(`Received ${track.kind} track from ${streamID || uuid}`);

            // Create MediaStream if it doesn't exist
            if (!this.mediaStream) {
                this.mediaStream = new MediaStream();
                console.log('Created new MediaStream for received tracks');
            }

            // Add track to the MediaStream
            this.mediaStream.addTrack(track);
            console.log(`MediaStream now has ${this.mediaStream.getAudioTracks().length} audio, ${this.mediaStream.getVideoTracks().length} video tracks`);

            // Update the video element's srcObject on every track so the
            // display is always up-to-date (video element was set BEFORE join)
            if (this.videoElement) {
                this.videoElement.srcObject = this.mediaStream;
                this.videoElement.play().catch(e => console.log('Autoplay info:', e.message));
                console.log(`✅ srcObject updated on ${this.videoElement.id} (${this.mediaStream.getTracks().length} tracks)`);
            } else {
                console.warn('⚠️ No video element assigned — cannot display stream');
            }

            // Per-track callback
            if (this.onTrackReceived) {
                this.onTrackReceived(track, this.mediaStream);
            }

            // Fire onStreamReceived as soon as we have an audio track so that
            // AudioProcessor / DVR recording can start without waiting for video.
            // Guard with a flag so it only fires once per connection.
            if (!this._streamReceivedFired && this.mediaStream.getAudioTracks().length > 0) {
                this._streamReceivedFired = true;
                console.log('Stream ready (audio present) — firing onStreamReceived');
                if (this.onStreamReceived) {
                    this.onStreamReceived(this.mediaStream);
                }
            }
        });

        // Data message received (optional)
        this.vdo.addEventListener('data', (event) => {
            const { data, uuid } = event.detail;
            console.log('Data received from', uuid, ':', data);
        });

        // Error occurred
        this.vdo.addEventListener('error', (event) => {
            console.error('VDO.ninja SDK error:', event.detail.error);
            if (this.onError) {
                this.onError(event.detail.error);
            }
        });

        // Connection closed
        this.vdo.addEventListener('closed', (event) => {
            console.log('VDO.ninja connection closed');
            this.isConnected = false;
            if (this.onConnectionChange) {
                this.onConnectionChange(false, { reason: 'closed' });
            }
        });
    }

    /**
     * Connect to a VDO.ninja room
     * @param {string} roomName - Room name (must match what phone is pushing to)
     * @param {string} password - Optional room password
     * @param {HTMLElement} videoElementOrContainer - Existing video element or container to create one in
     */
    async connect(roomName, password = null, videoElementOrContainer = null) {
        try {
            if (!this.vdo) {
                throw new Error('SDK not initialized. Call init() first.');
            }

            this.roomName = roomName;
            this.password = password;
            this._streamReceivedFired = false; // reset for new connection

            // ── Fix: set up the video element BEFORE joining the room ──────────
            // Tracks can arrive very quickly after joinRoom(); if we set
            // videoElement afterwards we miss them and srcObject is never set.
            if (videoElementOrContainer) {
                if (videoElementOrContainer.tagName === 'VIDEO') {
                    this.videoElement = videoElementOrContainer;
                    this.videoElement.autoplay = true;
                    this.videoElement.playsInline = true;
                    // Keep muted so the browser's autoplay policy allows the
                    // video to play. Audio is processed separately via
                    // AudioContext (which does NOT require unmuted video).
                    this.videoElement.muted = true;
                    this.videoElementCreated = false;
                    console.log('Video element ready (before join):', this.videoElement.id);
                } else {
                    this.videoElement = document.createElement('video');
                    this.videoElement.id = 'vdoNinjaSdkVideo';
                    this.videoElement.className = 'camera-video';
                    this.videoElement.autoplay = true;
                    this.videoElement.playsInline = true;
                    this.videoElement.muted = true;
                    this.videoElement.controls = false;
                    this.videoElement.style.display = 'block';
                    this.videoElement.style.width = '100%';
                    this.videoElement.style.height = '100%';
                    this.videoElement.style.objectFit = 'contain';
                    this.videoElement.style.backgroundColor = '#000';
                    this.videoElement.style.position = 'relative';
                    this.videoElement.style.zIndex = '1';
                    videoElementOrContainer.appendChild(this.videoElement);
                    this.videoElementCreated = true;
                    console.log('Created video element in container (before join)');
                }
            }
            // ──────────────────────────────────────────────────────────────────

            console.log(`Connecting to VDO.ninja stream: ${roomName}`);

            // Connect to the VDO.ninja signaling server
            await this.vdo.connect();
            console.log('Connected to VDO.ninja signaling server');

            // view(streamID) is the correct SDK method for receiving a stream
            // that was published with ?push=STREAMID on the vdo.ninja website.
            // The "room name" the user types in IS the stream ID.
            const viewOptions = {};
            if (password) viewOptions.password = password;
            await this.vdo.view(roomName, viewOptions);
            console.log(`Viewing stream: ${roomName}`);

            this.isConnected = true;

            if (this.onConnectionChange) {
                this.onConnectionChange(true, { room: roomName });
            }

            console.log('Waiting for tracks from publisher...');

            return true;
        } catch (error) {
            console.error('Failed to connect to VDO.ninja room:', error);
            this.isConnected = false;
            if (this.onError) {
                this.onError(error);
            }
            return false;
        }
    }

    /**
     * Disconnect from the room and cleanup
     */
    disconnect() {
        console.log('Disconnecting from VDO.ninja...');

        // Stop all tracks in the MediaStream
        if (this.mediaStream) {
            this.mediaStream.getTracks().forEach(track => {
                track.stop();
                console.log(`Stopped ${track.kind} track`);
            });
            this.mediaStream = null;
        }

        // Clean up video element
        if (this.videoElement) {
            this.videoElement.srcObject = null;
            // Only remove if we created it (don't remove existing mainCameraFeed)
            if (this.videoElementCreated) {
                this.videoElement.remove();
                console.log('Removed SDK video element');
            } else {
                console.log('Cleared srcObject from existing video element');
            }
            this.videoElement = null;
            this.videoElementCreated = false;
        }

        // Close SDK connection
        if (this.vdo) {
            this.vdo.close();
        }

        this.isConnected = false;
        this.roomName = null;
        this.password = null;

        if (this.onConnectionChange) {
            this.onConnectionChange(false, {});
        }

        console.log('VDO.ninja SDK disconnected and cleaned up');
    }

    /**
     * Get the combined MediaStream (audio + video)
     */
    getMediaStream() {
        return this.mediaStream;
    }

    /**
     * Get the video element
     */
    getVideoElement() {
        return this.videoElement;
    }

    /**
     * Check if connected
     */
    isConnectedToRoom() {
        return this.isConnected && this.mediaStream !== null;
    }

    /**
     * Dispose and cleanup
     */
    dispose() {
        this.disconnect();
        this.vdo = null;
    }
}
