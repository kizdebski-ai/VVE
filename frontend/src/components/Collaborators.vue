<template>
  <div class="collaborators">
    <div class="collaborator-count">
      <div class="count-badge">{{ activeUsers.length + 1 }}</div>
      <span>Online</span>
    </div>

    <div class="avatars">
      <!-- Current user avatar -->
      <div class="avatar current-user" :style="{ backgroundColor: getUserColor(currentUserId) }">
        {{ getInitials(username) }}
        <div class="status-indicator"></div>
      </div>

      <!-- Other users avatars -->
      <div 
        v-for="user in activeUsers" 
        :key="user.userId"
        class="avatar"
        :style="{ backgroundColor: getUserColor(user.userId) }"
        :title="user.username"
      >
        {{ getInitials(user.username) }}
        <div class="status-indicator"></div>
      </div>
    </div>

    <!-- Cursors for other users -->
    <div v-for="cursor in cursors" :key="cursor.userId" class="cursor" :style="cursorStyle(cursor)">
      <div class="cursor-pointer" :style="{ backgroundColor: getUserColor(cursor.userId) }"></div>
      <div class="cursor-label" :style="{ backgroundColor: getUserColor(cursor.userId) }">
        {{ cursor.username }}
      </div>
    </div>
  </div>
</template>

<script>
export default {
  name: 'Collaborators',
  props: {
    activeUsers: {
      type: Array,
      default: () => []
    },
    currentUserId: {
      type: String,
      required: true
    },
    username: {
      type: String,
      default: 'You'
    },
    cursors: {
      type: Array,
      default: () => []
    }
  },
  methods: {
    getInitials(name) {
      if (!name) return '?';

      // Split the name and get first letter of each part
      return name
        .split(' ')
        .map(part => part[0])
        .join('')
        .toUpperCase()
        .substring(0, 2);
    },

    getUserColor(userId) {
      if (!userId) return '#555';

      // Generate a consistent color based on user ID
      const colors = [
        '#4285F4', // Google Blue
        '#EA4335', // Google Red
        '#FBBC05', // Google Yellow
        '#34A853', // Google Green
        '#FF9900', // Orange
        '#9C27B0', // Purple
        '#00ACC1', // Cyan
        '#FF5722', // Deep Orange
        '#3F51B5', // Indigo
        '#2196F3', // Light Blue
        '#009688', // Teal
        '#CDDC39', // Lime
      ];

      // Simple hash function to convert userId to an index
      const hash = userId.split('').reduce((acc, char) => {
        return acc + char.charCodeAt(0);
      }, 0);

      return colors[hash % colors.length];
    },

    cursorStyle(cursor) {
      return {
        left: `${cursor.x}px`,
        top: `${cursor.y}px`
      };
    }
  }
}
</script>

<style scoped>
.collaborators {
  position: absolute;
  top: 15px;
  left: 15px;
  z-index: 1000;
  display: flex;
  align-items: center;
  pointer-events: none;
}

.collaborator-count {
  display: flex;
  align-items: center;
  background-color: rgba(0, 0, 0, 0.5);
  padding: 5px 10px;
  border-radius: 20px;
  margin-right: 10px;
  font-size: 12px;
  color: white;
  pointer-events: auto;
}

.count-badge {
  background-color: #4285F4;
  color: white;
  border-radius: 50%;
  width: 20px;
  height: 20px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 12px;
  font-weight: bold;
  margin-right: 5px;
}

.avatars {
  display: flex;
  align-items: center;
}

.avatar {
  width: 32px;
  height: 32px;
  border-radius: 50%;
  background-color: #555;
  color: white;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 12px;
  font-weight: bold;
  position: relative;
  margin-right: -8px;
  border: 2px solid #1e1e1e;
  pointer-events: auto;
}

.avatar.current-user {
  margin-right: 5px;
}

.status-indicator {
  position: absolute;
  bottom: 0;
  right: 0;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background-color: #4CAF50;
  border: 1px solid white;
}

.cursor {
  position: absolute;
  pointer-events: none;
  transition: all 0.1s ease;
  z-index: 1000;
}

.cursor-pointer {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  position: absolute;
  transform: translate(-50%, -50%);
}

.cursor-label {
  position: absolute;
  left: 10px;
  top: -20px;
  background-color: #555;
  color: white;
  padding: 2px 6px;
  border-radius: 3px;
  font-size: 12px;
  white-space: nowrap;
  opacity: 0.8;
}
</style>