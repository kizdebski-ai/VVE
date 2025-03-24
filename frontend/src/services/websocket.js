/**
 * WebSocket service for collaborative whiteboard
 * Using native WebSockets with Django Channels
 */

class WebSocketService {
  constructor() {
    // WebSocket instance
    this.socket = null;

    // Connection state
    this.connected = false;
    this.connecting = false;

    // Room info (single room in this simplified version)
    this.roomId = 'default_room';

    // User identity (generated once per session)
    this.userId = this.generateUserId();
    this.username = 'User ' + Math.floor(Math.random() * 1000);

    // Event handlers
    this.messageHandlers = {};
    this.connectionHandlers = [];
    this.disconnectionHandlers = [];
    this.errorHandlers = [];

    // Debug & monitoring
    this.lastActivity = Date.now();
    this.heartbeatInterval = null;

    console.log('WebSocket Service initialized with userId:', this.userId);
  }

  /**
   * Generate a user ID
   */
  generateUserId() {
    return 'user_' + Math.random().toString(36).substr(2, 9);
  }

  /**
   * Connect to WebSocket server
   */
  connect(username = 'Anonymous') {
    if (this.connecting) {
      console.log('Already attempting to connect, please wait');
      return;
    }

    // Disconnect existing connection if any
    if (this.socket) {
      this.disconnect();
    }

    this.username = username;
    this.connecting = true;

    console.log(`Connecting to WebSocket as user: ${this.userId} (${username})`);

    try {
      // Get WebSocket URL (assumes Django is serving on the same host)
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const host = window.location.host;
      const wsUrl = `${protocol}//${host}/ws/whiteboard/${this.roomId}/`;

      console.log('WebSocket connecting to:', wsUrl);

      // Create WebSocket connection
      this.socket = new WebSocket(wsUrl);

      // Setup event handlers
      this.socket.onopen = () => {
        console.log('✅ WebSocket connected');
        this.connected = true;
        this.connecting = false;
        this.lastActivity = Date.now();

        // Start heartbeat
        this.startHeartbeat();

        // Send join message
        this.sendJoin();

        // Notify connection handlers
        this.connectionHandlers.forEach(handler => handler());
      };

      this.socket.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          this.handleMessage(data.type, data);
        } catch (error) {
          console.error('Error parsing WebSocket message:', error);
        }
      };

      this.socket.onclose = (event) => {
        console.log('WebSocket disconnected:', event.code, event.reason);
        this.connected = false;
        this.connecting = false;

        // Stop heartbeat
        this.stopHeartbeat();

        // Notify disconnection handlers
        this.disconnectionHandlers.forEach(handler => handler(event.reason));
      };

      this.socket.onerror = (error) => {
        console.error('WebSocket error:', error);
        this.errorHandlers.forEach(handler => handler(error));
      };

    } catch (error) {
      console.error('Failed to connect to WebSocket server:', error);
      this.connecting = false;
      this.errorHandlers.forEach(handler => handler(error));
    }
  }

  /**
   * Send join message when connecting
   */
  sendJoin() {
    this.send({
      type: 'join',
      userId: this.userId,
      username: this.username
    });
  }

  /**
   * Start heartbeat to keep connection alive
   */
  startHeartbeat() {
    this.stopHeartbeat(); // Clear any existing interval

    this.heartbeatInterval = setInterval(() => {
      if (this.connected) {
        // Send heartbeat message
        this.send({
          type: 'heartbeat',
          timestamp: Date.now()
        });
      }
    }, 30000); // Every 30 seconds
  }

  /**
   * Stop heartbeat interval
   */
  stopHeartbeat() {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }
  }

  /**
   * Disconnect WebSocket
   */
  disconnect() {
    this.stopHeartbeat();

    if (this.socket) {
      console.log('Disconnecting WebSocket...');
      this.socket.close();
      this.socket = null;
      this.connected = false;
      this.connecting = false;
    }
  }

  /**
   * Send message to WebSocket server
   */
  send(data) {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      console.warn('Cannot send message: WebSocket not connected');
      return false;
    }

    try {
      // Add standard fields to all messages
      const payload = {
        ...data,
        userId: this.userId,
        username: this.username,
        timestamp: Date.now()
      };

      this.socket.send(JSON.stringify(payload));
      return true;
    } catch (error) {
      console.error('Error sending WebSocket message:', error);
      return false;
    }
  }

  /**
   * Handle incoming message and dispatch to registered handlers
   */
  handleMessage(type, payload) {
    // Update activity timestamp
    this.lastActivity = Date.now();

    // Call appropriate message handlers
    if (this.messageHandlers[type]) {
      this.messageHandlers[type].forEach(handler => handler(payload));
    }
  }

  /**
   * Request full whiteboard state from server
   */
  requestFullState() {
    return this.send({
      type: 'request_state'
    });
  }

  /**
   * Send whiteboard action
   */
  sendWhiteboardAction(action, data) {
    return this.send({
      type: 'whiteboard_action',
      action,
      data
    });
  }

  /**
   * Send cursor position update
   */
  sendCursorPosition(x, y) {
    return this.send({
      type: 'cursor_position',
      x, y
    });
  }

  /**
   * Register message handler
   */
  onMessage(type, handler) {
    if (!this.messageHandlers[type]) {
      this.messageHandlers[type] = [];
    }

    this.messageHandlers[type].push(handler);
    return this; // For chaining
  }

  /**
   * Register connection handler
   */
  onConnect(handler) {
    this.connectionHandlers.push(handler);

    // Call handler immediately if already connected
    if (this.connected) {
      handler();
    }

    return this; // For chaining
  }

  /**
   * Register disconnection handler
   */
  onDisconnect(handler) {
    this.disconnectionHandlers.push(handler);
    return this; // For chaining
  }

  /**
   * Register error handler
   */
  onError(handler) {
    this.errorHandlers.push(handler);
    return this; // For chaining
  }

  /**
   * Unregister message handler
   */
  offMessage(type, handler) {
    if (this.messageHandlers[type]) {
      this.messageHandlers[type] = this.messageHandlers[type].filter(h => h !== handler);
    }
    return this; // For chaining
  }

  /**
   * Unregister connection handler
   */
  offConnect(handler) {
    this.connectionHandlers = this.connectionHandlers.filter(h => h !== handler);
    return this; // For chaining
  }

  /**
   * Unregister disconnection handler
   */
  offDisconnect(handler) {
    this.disconnectionHandlers = this.disconnectionHandlers.filter(h => h !== handler);
    return this; // For chaining
  }

  /**
   * Unregister error handler
   */
  offError(handler) {
    this.errorHandlers = this.errorHandlers.filter(h => h !== handler);
    return this; // For chaining
  }

  /**
   * Check if WebSocket is connected
   */
  isConnected() {
    return this.connected;
  }

  /**
   * Check if WebSocket is connecting
   */
  isConnecting() {
    return this.connecting;
  }

  /**
   * Get user ID
   */
  getUserId() {
    return this.userId;
  }

  /**
   * Get room ID
   */
  getRoomId() {
    return this.roomId;
  }

  /**
   * Get debug information
   */
  getDebugInfo() {
    return {
      userId: this.userId,
      username: this.username,
      connected: this.connected,
      connecting: this.connecting,
      socketState: this.socket ? this.socket.readyState : 'none',
      lastActivity: new Date(this.lastActivity).toISOString()
    };
  }
}

// Create and export singleton instance
const websocketService = new WebSocketService();
export default websocketService;