<template>
  <div class="lobby-container">
    <div class="lobby-card">
      <div class="logo-section">
        <div class="logo-icon">
          <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect>
            <line x1="9" y1="3" x2="9" y2="21"></line>
          </svg>
        </div>
        <h1>WhiteVue</h1>
      </div>
      
      <p class="tagline">Real-time Collaborative Whiteboard</p>

      <div class="actions-section">
        <button class="btn-primary" @click="createRoom" :disabled="loading">
          <span v-if="loading" class="spinner"></span>
          <svg v-else xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>
          Create New Room
        </button>

        <div class="divider">
          <span>OR JOIN EXISTING</span>
        </div>

        <div class="join-section">
          <input 
            v-model="roomIdInput" 
            type="text" 
            placeholder="Enter Room ID" 
            @keyup.enter="joinRoom"
          />
          <button class="btn-secondary" @click="joinRoom" :disabled="!roomIdInput">
            Join
          </button>
        </div>
      </div>

      <div class="rooms-section">
        <div class="tabs">
          <button :class="{ active: activeTab === 'active' }" @click="activeTab = 'active'">Active Rooms</button>
          <button :class="{ active: activeTab === 'recent' }" @click="activeTab = 'recent'">Recent</button>
        </div>

        <div v-if="activeTab === 'active'" class="room-list">
          <div v-if="loadingRooms" class="loading-state">Loading rooms...</div>
          <div v-else-if="activeRooms.length === 0" class="empty-state">No active rooms found.</div>
          <div 
            v-for="room in activeRooms" 
            :key="room.roomId" 
            class="room-item" 
            @click="$emit('join', room.roomId)"
          >
            <div class="room-info">
              <span class="room-name">{{ room.displayName || room.roomId }}</span>
              <span class="room-meta">Created {{ formatDate(room.createdAt) }}</span>
            </div>
            <div class="room-status">
              <span class="online-badge" v-if="room.onlineCount > 0">
                <span class="dot"></span> {{ room.onlineCount }} Online
              </span>
            </div>
          </div>
        </div>

        <div v-if="activeTab === 'recent'" class="room-list">
          <div v-if="recentRooms.length === 0" class="empty-state">No recent history.</div>
          <div 
            v-for="room in recentRooms" 
            :key="room.id" 
            class="room-item" 
            @click="$emit('join', room.id)"
          >
            <div class="room-info">
              <span class="room-name">{{ room.id }}</span>
              <span class="room-meta">Last visited {{ formatDate(room.lastVisited) }}</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script>
import { ref, onMounted, computed } from 'vue';
import axios from 'axios';

const API_URL = import.meta.env.VITE_BACKEND_URL || 'http://localhost:8000';

export default {
  name: 'Lobby',
  emits: ['join'],
  setup(props, { emit }) {
    const roomIdInput = ref('');
    const recentRooms = ref([]);
    const activeRooms = ref([]);
    const loading = ref(false);
    const loadingRooms = ref(false);
    const activeTab = ref('active');

    const fetchRooms = async () => {
      loadingRooms.value = true;
      try {
        const response = await axios.get(`${API_URL}/api/rooms`);
        activeRooms.value = response.data.rooms || [];
      } catch (error) {
        console.error('Failed to fetch rooms:', error);
      } finally {
        loadingRooms.value = false;
      }
    };

    onMounted(() => {
      try {
        const stored = localStorage.getItem('whitevue_recent_rooms');
        if (stored) {
          recentRooms.value = JSON.parse(stored);
        }
      } catch (e) {
        console.error('Failed to load recent rooms', e);
      }
      fetchRooms();
      // Poll for room updates every 10 seconds
      setInterval(fetchRooms, 10000);
    });

    const createRoom = async () => {
      loading.value = true;
      try {
        const response = await axios.post(`${API_URL}/api/rooms`, {
          displayName: `Room ${Math.floor(Math.random() * 1000)}`
        });
        const newRoom = response.data;
        emit('join', newRoom.roomId);
      } catch (error) {
        console.error('Failed to create room:', error);
        // Fallback to client-side ID generation if server fails
        const newId = `board_${Math.random().toString(36).substr(2, 9)}`;
        emit('join', newId);
      } finally {
        loading.value = false;
      }
    };

    const joinRoom = () => {
      if (roomIdInput.value.trim()) {
        emit('join', roomIdInput.value.trim());
      }
    };

    const formatDate = (timestamp) => {
      if (!timestamp) return '';
      const date = new Date(timestamp);
      const now = new Date();
      const diff = now - date;
      
      if (diff < 60000) return 'Just now';
      if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
      if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
      return date.toLocaleDateString();
    };

    return {
      roomIdInput,
      recentRooms,
      activeRooms,
      loading,
      loadingRooms,
      activeTab,
      createRoom,
      joinRoom,
      formatDate
    };
  }
}
</script>

<style scoped>
.lobby-container {
  display: flex;
  justify-content: center;
  align-items: center;
  min-height: 100vh;
  background: radial-gradient(circle at top left, #2b32b2, #1488cc);
  font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
  padding: 20px;
}

.lobby-card {
  background: rgba(255, 255, 255, 0.95);
  backdrop-filter: blur(20px);
  padding: 40px;
  border-radius: 24px;
  box-shadow: 0 20px 60px rgba(0, 0, 0, 0.2);
  width: 100%;
  max-width: 480px;
  display: flex;
  flex-direction: column;
  gap: 24px;
}

.logo-section {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 12px;
}

.logo-icon {
  background: linear-gradient(135deg, #4285f4, #34a853);
  padding: 8px;
  border-radius: 12px;
  display: flex;
  box-shadow: 0 4px 12px rgba(66, 133, 244, 0.3);
}

.logo-section h1 {
  font-size: 32px;
  font-weight: 800;
  background: linear-gradient(135deg, #2c3e50 0%, #3498db 100%);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  margin: 0;
}

.tagline {
  text-align: center;
  color: #7f8c8d;
  font-size: 16px;
  margin-top: -10px;
}

.actions-section {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.btn-primary {
  width: 100%;
  padding: 16px;
  background: linear-gradient(135deg, #4285f4, #3367d6);
  color: white;
  border: none;
  border-radius: 16px;
  font-size: 18px;
  font-weight: 600;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 10px;
  transition: all 0.2s ease;
  box-shadow: 0 4px 12px rgba(66, 133, 244, 0.3);
}

.btn-primary:hover:not(:disabled) {
  transform: translateY(-2px);
  box-shadow: 0 6px 16px rgba(66, 133, 244, 0.4);
}

.btn-primary:disabled {
  opacity: 0.7;
  cursor: wait;
}

.divider {
  display: flex;
  align-items: center;
  text-align: center;
  color: #95a5a6;
  font-size: 12px;
  font-weight: 600;
  letter-spacing: 1px;
}

.divider::before,
.divider::after {
  content: '';
  flex: 1;
  border-bottom: 1px solid #e0e0e0;
}

.divider span {
  padding: 0 10px;
}

.join-section {
  display: flex;
  gap: 12px;
}

input {
  flex: 1;
  padding: 14px 16px;
  border: 2px solid #f1f3f4;
  border-radius: 14px;
  font-size: 16px;
  outline: none;
  transition: all 0.2s;
  background: #f8f9fa;
}

input:focus {
  border-color: #4285f4;
  background: white;
  box-shadow: 0 0 0 4px rgba(66, 133, 244, 0.1);
}

.btn-secondary {
  padding: 0 24px;
  background: #f1f3f4;
  color: #2c3e50;
  border: none;
  border-radius: 14px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.2s;
}

.btn-secondary:hover:not(:disabled) {
  background: #e8eaed;
  color: #1a73e8;
}

.rooms-section {
  margin-top: 10px;
  display: flex;
  flex-direction: column;
  gap: 16px;
  flex: 1;
  min-height: 0; /* For scrolling */
}

.tabs {
  display: flex;
  gap: 20px;
  border-bottom: 1px solid #eee;
  padding-bottom: 10px;
}

.tabs button {
  background: none;
  border: none;
  font-size: 14px;
  font-weight: 600;
  color: #95a5a6;
  cursor: pointer;
  padding: 4px 0;
  position: relative;
}

.tabs button.active {
  color: #4285f4;
}

.tabs button.active::after {
  content: '';
  position: absolute;
  bottom: -11px;
  left: 0;
  width: 100%;
  height: 2px;
  background: #4285f4;
}

.room-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
  max-height: 240px;
  overflow-y: auto;
  padding-right: 4px;
}

.room-list::-webkit-scrollbar {
  width: 6px;
}

.room-list::-webkit-scrollbar-thumb {
  background: #ddd;
  border-radius: 3px;
}

.room-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 16px;
  background: white;
  border: 1px solid #eee;
  border-radius: 16px;
  cursor: pointer;
  transition: all 0.2s;
}

.room-item:hover {
  border-color: #4285f4;
  transform: translateX(4px);
  box-shadow: 0 4px 12px rgba(0,0,0,0.05);
}

.room-info {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.room-name {
  font-weight: 600;
  color: #2c3e50;
}

.room-meta {
  font-size: 12px;
  color: #95a5a6;
}

.online-badge {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  font-weight: 600;
  color: #27ae60;
  background: rgba(39, 174, 96, 0.1);
  padding: 4px 8px;
  border-radius: 20px;
}

.dot {
  width: 6px;
  height: 6px;
  background: #27ae60;
  border-radius: 50%;
}

.empty-state, .loading-state {
  text-align: center;
  color: #95a5a6;
  padding: 20px;
  font-size: 14px;
}

.spinner {
  width: 16px;
  height: 16px;
  border: 2px solid rgba(255,255,255,0.3);
  border-radius: 50%;
  border-top-color: white;
  animation: spin 1s linear infinite;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}
</style>
