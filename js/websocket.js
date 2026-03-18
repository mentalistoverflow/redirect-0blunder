/**
 * WebSocket client — connects to backend for real-time game updates.
 */

class WebSocketClient {
    constructor() {
        this.ws = null;
        this.listeners = new Map();
        this.reconnectDelay = 2000;
        this.maxReconnectDelay = 30000;
        this._reconnecting = false;
    }

    async connect() {
        // Guard: close any existing connection first
        if (this.ws) {
            if (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING) {
                return; // Already connected or connecting
            }
            this.ws.onclose = null;
            this.ws.onerror = null;
            this.ws = null;
        }

        const backendUrl = window.__CHESS_LEARN_BACKEND_URL || '';
        let url;
        if (backendUrl) {
            // Direct WS to backend (for Vercel deploy where WS can't go through rewrites)
            // Fetch a short-lived token via the Vercel proxy (cookie auth works there)
            let token = '';
            try {
                const resp = await fetch('/api/live/ws-token', {
                    credentials: 'include',
                    headers: { 'X-Requested-With': 'XMLHttpRequest' }
                });
                if (resp.ok) {
                    const data = await resp.json();
                    token = data.token || '';
                }
            } catch (e) {
                console.warn('Failed to fetch WS token:', e);
            }
            const wsBase = backendUrl.replace(/^http/, 'ws');
            url = `${wsBase}/api/live/ws${token ? '?token=' + encodeURIComponent(token) : ''}`;
        } else {
            const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
            url = `${proto}//${location.host}/api/live/ws`;
        }

        try {
            this.ws = new WebSocket(url);
        } catch (e) {
            console.error('WebSocket connection failed:', e);
            this._scheduleReconnect();
            return;
        }

        this.ws.onopen = () => {
            console.log('WebSocket connected');
            this.reconnectDelay = 2000;
            this._emit('connected', {});
        };

        this.ws.onmessage = (event) => {
            try {
                const data = JSON.parse(event.data);
                this._emit(data.type, data);
                this._emit('message', data);
            } catch (e) {
                console.warn('Invalid WebSocket message:', event.data);
            }
        };

        this.ws.onclose = () => {
            console.log('WebSocket disconnected');
            this._emit('disconnected', {});
            this._scheduleReconnect();
        };

        this.ws.onerror = (err) => {
            console.error('WebSocket error:', err);
        };
    }

    send(data) {
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            this.ws.send(JSON.stringify(data));
        }
    }

    on(event, callback) {
        if (!this.listeners.has(event)) {
            this.listeners.set(event, []);
        }
        this.listeners.get(event).push(callback);
    }

    off(event, callback) {
        const cbs = this.listeners.get(event);
        if (cbs) {
            this.listeners.set(event, cbs.filter(cb => cb !== callback));
        }
    }

    _emit(event, data) {
        const cbs = this.listeners.get(event) || [];
        for (const cb of cbs) {
            try {
                cb(data);
            } catch (e) {
                console.error(`WebSocket listener error (${event}):`, e);
            }
        }
    }

    _scheduleReconnect() {
        if (this._reconnecting) return;
        this._reconnecting = true;
        setTimeout(() => {
            this._reconnecting = false;
            this.connect();
        }, this.reconnectDelay);
        this.reconnectDelay = Math.min(this.reconnectDelay * 1.5, this.maxReconnectDelay);
    }

    disconnect() {
        if (this.ws) {
            this.ws.onclose = null;
            this.ws.close();
            this.ws = null;
        }
    }
}

// Singleton
export const wsClient = new WebSocketClient();
