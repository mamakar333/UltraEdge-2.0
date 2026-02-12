/**
 * VdoNinjaConnector Class
 * Manages VDO.ninja iframe integration for remote stream viewing
 * Uses iframe with postMessage API for control
 */
class VdoNinjaConnector {
    constructor() {
        this.iframe = null;
        this.isConnected = false;
        this.streamUrl = null;
        this.apiId = null;
        this.container = null;
        this.mediaStream = null; // Store the MediaStream from VDO.ninja

        // Callbacks
        this.onConnectionChange = null;
        this.onError = null;
        this.onStreamReceived = null; // New callback for when we receive the MediaStream
    }

    /**
     * Connect to a VDO.ninja stream URL
     * @param {string} url - VDO.ninja URL (e.g., https://vdo.ninja/?view=STREAM_ID)
     * @param {HTMLElement} container - Container element to place the iframe in
     */
    connect(url, container) {
        try {
            // Disconnect existing connection
            if (this.iframe) {
                this.disconnect();
            }

            this.container = container;
            this.apiId = 'ultraedge_' + Date.now();

            // Append required params for clean output and API control
            let cleanUrl = url;
            if (!cleanUrl.includes('cleanoutput')) {
                cleanUrl += (cleanUrl.includes('?') ? '&' : '?') + 'cleanoutput';
            }
            if (!cleanUrl.includes('api=')) {
                cleanUrl += '&api=' + this.apiId;
            }
            // Ensure audio plays in the iframe (needed for tab capture to hear it)
            if (!cleanUrl.includes('volume=')) {
                cleanUrl += '&volume=100';
            }

            this.streamUrl = cleanUrl;

            // Create iframe
            this.iframe = document.createElement('iframe');
            this.iframe.id = 'vdoNinjaFrame';
            this.iframe.className = 'vdo-ninja-iframe';
            this.iframe.src = cleanUrl;
            this.iframe.allow = 'autoplay; camera; microphone; display-capture; fullscreen';
            this.iframe.setAttribute('allowfullscreen', '');

            // Insert iframe into container
            container.appendChild(this.iframe);

            // Ensure iframe is visible
            this.iframe.style.display = 'block';
            this.iframe.style.width = '100%';
            this.iframe.style.minHeight = '400px';

            console.log('VDO.ninja iframe created and appended to container');

            // Listen for iframe load
            this.iframe.addEventListener('load', () => {
                this.isConnected = true;
                console.log('VDO.ninja iframe loaded successfully:', cleanUrl);
                console.log('Iframe dimensions:', this.iframe.offsetWidth, 'x', this.iframe.offsetHeight);

                if (this.onConnectionChange) {
                    this.onConnectionChange(true, { url: cleanUrl, apiId: this.apiId });
                }
            });

            // Listen for iframe errors
            this.iframe.addEventListener('error', (e) => {
                console.error('VDO.ninja iframe error:', e);
                if (this.onError) {
                    this.onError(new Error('Failed to load VDO.ninja stream'));
                }
            });

            // Listen for postMessage events from VDO.ninja
            window.addEventListener('message', this._handleMessage.bind(this));

            console.log('VDO.ninja connecting to:', cleanUrl);
        } catch (error) {
            console.error('Failed to connect VDO.ninja:', error);
            if (this.onError) {
                this.onError(error);
            }
        }
    }

    /**
     * Handle postMessage events from VDO.ninja iframe
     */
    _handleMessage(event) {
        // Only process messages from VDO.ninja
        if (!event.data || typeof event.data !== 'object') return;

        console.log('VDO.ninja message received:', event.data);

        // Check for MediaStream (VDO.ninja sends this via IFrame API)
        if (event.data.action === 'gotTracks') {
            console.log('Received MediaStream tracks from VDO.ninja');
            this.isConnected = true;

            // Get the stream from the event
            if (event.data.stream) {
                this.mediaStream = event.data.stream;
                console.log('MediaStream audio tracks:', this.mediaStream.getAudioTracks().length);
                console.log('MediaStream video tracks:', this.mediaStream.getVideoTracks().length);

                if (this.onStreamReceived) {
                    this.onStreamReceived(this.mediaStream);
                }
            }

            if (this.onConnectionChange) {
                this.onConnectionChange(true, event.data);
            }
        } else if (event.data.action === 'stream-connected') {
            this.isConnected = true;
            if (this.onConnectionChange) {
                this.onConnectionChange(true, event.data);
            }
        } else if (event.data.action === 'stream-disconnected') {
            this.isConnected = false;
            this.mediaStream = null;
            if (this.onConnectionChange) {
                this.onConnectionChange(false, event.data);
            }
        }
    }

    /**
     * Disconnect and remove the iframe
     */
    disconnect() {
        if (this.iframe) {
            this.iframe.remove();
            this.iframe = null;
        }

        window.removeEventListener('message', this._handleMessage);

        this.isConnected = false;
        this.streamUrl = null;
        this.apiId = null;

        if (this.onConnectionChange) {
            this.onConnectionChange(false, {});
        }

        console.log('VDO.ninja disconnected');
    }

    /**
     * Get the iframe element
     */
    getIframe() {
        return this.iframe;
    }

    /**
     * Get the MediaStream received from VDO.ninja
     * If IFrame API didn't provide stream, try capturing from iframe's video element
     */
    getMediaStream() {
        // Return cached stream if available
        if (this.mediaStream) {
            return this.mediaStream;
        }

        // Fallback: Try to capture stream from iframe's video element
        // Note: This only works if iframe is same-origin or has proper CORS headers
        try {
            if (this.iframe && this.iframe.contentDocument) {
                const video = this.iframe.contentDocument.querySelector('video');
                if (video && video.srcObject) {
                    console.log('Fallback: Captured MediaStream from iframe video element');
                    this.mediaStream = video.srcObject;
                    return this.mediaStream;
                }
            }
        } catch (e) {
            // Cross-origin error - expected for VDO.ninja
            console.log('Cannot access iframe video element (cross-origin)', e.message);
        }

        return null;
    }

    /**
     * Request MediaStream from VDO.ninja iframe
     * Note: VDO.ninja IFrame API has limited cross-origin support
     * This may not work depending on the VDO.ninja URL configuration
     */
    requestStream() {
        if (this.iframe && this.iframe.contentWindow) {
            console.log('Requesting stream from VDO.ninja iframe using IFrame API');
            console.log('Note: Cross-origin restrictions may prevent stream access');

            // Try multiple postMessage formats that VDO.ninja might support
            try {
                // Method 1: Standard IFrame API request
                this.iframe.contentWindow.postMessage({
                    action: 'getMediaStream',
                    target: this.apiId
                }, '*');

                // Method 2: Request tracks specifically
                this.iframe.contentWindow.postMessage({
                    action: 'getTracks',
                    target: this.apiId
                }, '*');

                // Method 3: Request stream ID
                this.iframe.contentWindow.postMessage({
                    request: 'getStreamId',
                    target: this.apiId
                }, '*');
            } catch (e) {
                console.error('Failed to request stream from VDO.ninja:', e);
            }
        } else {
            console.warn('VDO.ninja iframe not ready for stream request');
        }
    }

    /**
     * Dispose and cleanup
     */
    dispose() {
        this.disconnect();
    }
}
