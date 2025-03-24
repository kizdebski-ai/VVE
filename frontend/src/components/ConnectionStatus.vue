<template>
  <div class="connection-status" :class="statusClass" @click="toggleDetails">
    <div class="indicator" :class="statusClass"></div>
    <div class="status-text">{{ statusText }}</div>

    <div v-if="showDetails" class="connection-details">
      <div class="detail-item">
        <span class="label">Room:</span> 
        <span class="value">{{ roomId || 'None' }}</span>
      </div>
      <div class="detail-item">
        <span class="label">User ID:</span> 
        <span class="value">{{ userId }}</span>
      </div>
      <div class="detail-item">
        <span class="label">Socket ID:</span> 
        <span class="value">{{ socketId || 'None' }}</span>
      </div>
      <div class="detail-item">
        <span class="label">Users Online:</span> 
        <span class="value">{{ activeUsersCount }}</span>
      </div>
      <div class="detail-item">
        <span class="label">Connection:</span>
        <span class="value">{{ statusText }}</span>
      </div>
      <button 
        v-if="canReconnect" 
        @click="handleReconnect" 
        class="reconnect-btn"
      >
        Reconnect
      </button>
    </div>
  </div>
</template>

<script>
import websocketService from '../services/websocket.js';

export default {
  name: 'ConnectionStatus',
  props: {
    roomId: {
      type: String,
      default: null
    },
    activeUsersCount: {
      type: Number,
      default: 0
    }
  },
  data() {
    return {
      connected: false,
      connecting: false,
      showDetails: false,
      userId: websocketService.getUserId(),
      socketId: null
    };
  },
  computed: {
    statusClass() {
      if (this.connected) return 'connected';
      if (this.connecting) return 'connecting';
      return 'disconnected';
    },
    statusText() {
      if (this.connected) return 'Connected';
      if (this.connecting) return 'Connecting...';
      return 'Disconnected';
    },
    canReconnect() {
      return !this.connected && !this.connecting && this.roomId;
    }
  },
  mounted() {
    // Initial status
    this.connected = websocketService.isConnected();
    this.connecting = websocketService.isConnecting();
    this.updateSocketInfo();

    // Update socket info every second
    this.infoInterval = setInterval(() => {
      this.updateSocketInfo();
    }, 1000);

    // Listen for connection changes
    websocketService.onConnect(() => {
      this.connected = true;
      this.connecting = false;
      this.updateSocketInfo();
    });

    websocketService.onDisconnect(() => {
      this.connected = false;
      this.connecting = false;
      this.socketId = null;
    });
  },
  beforeUnmount() {
    // Clean up listeners
    websocketService.offConnect(() => {});
    websocketService.offDisconnect(() => {});

    if (this.infoInterval) {
      clearInterval(this.infoInterval);
    }
  },
  methods: {
    updateSocketInfo() {
      const info = websocketService.getDebugInfo();
      if (info) {
        this.socketId = info.socketId;
      }
    },
    toggleDetails() {
      this.showDetails = !this.showDetails;
    },
    handleReconnect() {
      if (this.roomId) {
        this.connecting = true;
        websocketService.connect(this.roomId);
      }
    }
  }
};
</script>

<style scoped>
.connection-status {
  position: fixed;
  bottom: 10px;
  left: 10px;
  display: flex;
  align-items: center;
  padding: 6px 12px;
  border-radius: 20px;
  background-color: #333;
  color: white;
  font-size: 12px;
  z-index: 1000;
  cursor: pointer;
  user-select: none;
  transition: all 0.3s ease;
  box-shadow: 0 2px 5px rgba(0, 0, 0, 0.2);
}

.connection-status:hover {
  background-color: #444;
}

.connection-status.connected {
  background-color: #333;
}

.connection-status.connecting {
  background-color: #f39c12;
  color: #333;
}

.connection-status.disconnected {
  background-color: #e74c3c;
}

.indicator {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  margin-right: 8px;
}

.indicator.connected {
  background-color: #2ecc71;
  box-shadow: 0 0 5px #2ecc71;
}

.indicator.connecting {
  background-color: #f39c12;
  animation: pulse 1.5s infinite;
}

.indicator.disconnected {
  background-color: #e74c3c;
}

.status-text {
  font-weight: 500;
}

.connection-details {
  position: absolute;
  bottom: calc(100% + 10px);
  left: 0;
  width: 200px;
  background-color: #333;
  border-radius: 8px;
  padding: 12px;
  box-shadow: 0 3px 8px rgba(0, 0, 0, 0.3);
  z-index: 1001;
}

.detail-item {
  margin-bottom: 8px;
  display: flex;
  justify-content: space-between;
}

.label {
  color: #999;
}

.value {
  color: white;
  font-weight: 500;
  max-width: 120px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.reconnect-btn {
  width: 100%;
  padding: 6px;
  margin-top: 8px;
  background-color: #2980b9;
  border: none;
  border-radius: 4px;
  color: white;
  font-size: 12px;
  cursor: pointer;
}

.reconnect-btn:hover {
  background-color: #3498db;
}

@keyframes pulse {
  0% {
    opacity: 0.5;
    transform: scale(1);
  }
  50% {
    opacity: 1;
    transform: scale(1.2);
  }
  100% {
    opacity: 0.5;
    transform: scale(1);
  }
}
</style>