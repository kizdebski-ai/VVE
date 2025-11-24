<template>
  <div class="collaborators-container">
    <!-- Debug Panel (Optional) -->
    <div v-if="debugMode" class="debug-panel">
      <h4>Awareness States ({{ awarenessStates.size }})</h4>
      <div v-for="[clientId, state] in awarenessStates" :key="clientId" class="debug-user">
        <div>Client ID: {{ clientId }} {{ clientId === localClientId ? '(You)' : '' }}</div>
        <div v-if="state.user">User: {{ state.user.name }} (Color: {{ state.user.color || getUserColor(clientId) }})</div>
        <div v-if="state.cursor">Cursor: x={{ state.cursor.x?.toFixed(0) }}, y={{ state.cursor.y?.toFixed(0) }}</div>
      </div>
    </div>

    <!-- Remote Cursors -->
    <div
      v-for="[clientId, state] in remoteAwarenessStates"
      :key="clientId"
      class="remote-cursor"
      :style="getCursorStyle(state.cursor)"
    >
      <div class="cursor-pointer" :style="{ backgroundColor: state.user?.color || getUserColor(clientId) }"></div>
      <div class="cursor-label" :style="{ backgroundColor: state.user?.color || getUserColor(clientId) }">
        {{ state.user?.name || '...' }}
      </div>
    </div>

    <!-- Active User Avatars (Top Right) -->
    <div class="active-users">
       <!-- Your Avatar -->
       <div
        class="user-avatar current-user"
        :style="{ backgroundColor: localUser?.color || getUserColor(localClientId || 'local') }"
        :title="localUser?.name || 'You'"
      >
        {{ getInitials(localUser?.name || 'You') }}
      </div>
       <!-- Remote Users' Avatars -->
      <div
        v-for="[clientId, state] in remoteAwarenessStates"
        :key="clientId"
        class="user-avatar"
        :style="{ backgroundColor: state.user?.color || getUserColor(clientId) }"
        :title="state.user?.name || '...'"
      >
        {{ getInitials(state.user?.name || '?') }}
      </div>
    </div>
  </div>
</template>

<script>
import { ref, computed, onMounted, onBeforeUnmount, watch } from 'vue';

export default {
  name: 'Collaborators',
  props: {
    awareness: { // Yjs awareness instance
      type: Object,
      required: true
    },
    zoomLevel: {
      type: Number,
      default: 1
    },
    panOffset: { // Pan offset {x, y} in screen coordinates
      type: Object,
      default: () => ({ x: 0, y: 0 })
    },
    localClientId: { // Optional: Pass local client ID for identification
      type: Number,
      default: null
    }
  },
  setup(props) {
    const awarenessStates = ref(new Map());
    const debugMode = ref(false); // Local debug state for this component

    // --- Computed Properties ---

    // Filtered awareness states excluding the local client and those without user info
    const remoteAwarenessStates = computed(() => {
      const remoteStates = new Map();
      awarenessStates.value.forEach((state, clientId) => {
        if (clientId !== props.localClientId && state.user) { // Ensure user info exists
          remoteStates.set(clientId, state);
        }
      });
      return remoteStates;
    });

     // Get local user state
    const localUser = computed(() => {
        return props.localClientId ? awarenessStates.value.get(props.localClientId)?.user : null;
    });


    // --- Methods ---

    const handleAwarenessChange = (changes) => {
      // Update the local ref with the latest states from awareness
      if (props.awareness) {
        awarenessStates.value = new Map(props.awareness.getStates());
        // console.log('Awareness changed:', awarenessStates.value);
      }
    };

    // Convert world coordinates (from awareness) to screen coordinates
    const worldToScreen = (worldCoords) => {
      if (!worldCoords) return { left: '-9999px', top: '-9999px' }; // Hide if no coords
      const screenX = worldCoords.x * props.zoomLevel + props.panOffset.x;
      const screenY = worldCoords.y * props.zoomLevel + props.panOffset.y;
      return {
        left: `${screenX}px`,
        top: `${screenY}px`,
      };
    };

    const getCursorStyle = (cursorState) => {
      const position = worldToScreen(cursorState);
      return {
        ...position,
        // Add other styles if needed, e.g., opacity based on activity
        opacity: cursorState ? 1 : 0, // Show only if cursor state exists
        transition: 'transform 0.1s linear, opacity 0.2s ease', // Smooth transitions
        transform: 'translate(-2px, -2px)', // Offset slightly so tip is at cursor
        pointerEvents: 'none',
        zIndex: 2000,
      };
    };

    // Generate a deterministic color from client ID
    const getUserColor = (clientId) => {
      if (!clientId) return '#CCCCCC'; // Default grey
      let hash = 0;
      const idString = String(clientId); // Ensure it's a string
      for (let i = 0; i < idString.length; i++) {
        hash = idString.charCodeAt(i) + ((hash << 5) - hash);
      }
      const h = hash % 360;
      return `hsl(${h}, 65%, 55%)`; // Slightly adjusted saturation/lightness
    };

    const getInitials = (name) => {
      if (!name) return '?';
      return name
        .split(/[\s_-]+/) // Split by space, underscore, hyphen
        .map(part => part[0])
        .filter(initial => !!initial) // Remove empty initials
        .join('')
        .toUpperCase()
        .substring(0, 2);
    };

    const toggleDebug = (enabled) => {
      debugMode.value = enabled !== undefined ? enabled : !debugMode.value;
    };

    // --- Lifecycle Hooks ---

    onMounted(() => {
      if (props.awareness) {
        // Set initial state
        handleAwarenessChange();
        // Listen for changes
        props.awareness.on('change', handleAwarenessChange);
      } else {
        console.error("Collaborators: Awareness prop is missing!");
      }
    });

    onBeforeUnmount(() => {
      if (props.awareness) {
        props.awareness.off('change', handleAwarenessChange);
      }
    });

    // Watch for awareness prop changes (e.g., if parent re-initializes Yjs)
    watch(() => props.awareness, (newAwareness, oldAwareness) => {
      if (oldAwareness) {
        oldAwareness.off('change', handleAwarenessChange);
      }
      if (newAwareness) {
        handleAwarenessChange(); // Update with new state
        newAwareness.on('change', handleAwarenessChange);
      } else {
         awarenessStates.value = new Map(); // Clear states if awareness is removed
      }
    });

    return {
      awarenessStates,
      remoteAwarenessStates,
      localUser,
      debugMode,
      getUserColor,
      getInitials,
      getCursorStyle,
      toggleDebug,
    };
  }
}
</script>

<style scoped>
.collaborators-container {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  pointer-events: none; /* Container doesn't block interactions */
  overflow: hidden; /* Prevent scrollbars if cursors go off-screen */
}

/* Remote Cursor Style */
.remote-cursor {
  position: absolute;
  /* Styles applied dynamically via getCursorStyle */
}

.cursor-pointer {
  width: 12px; /* Slightly larger pointer */
  height: 12px;
  border-radius: 50%;
  background-color: inherit; /* Color set by parent style */
  position: absolute;
  /* transform: translate(-50%, -50%); Center on the calculated position */
  box-shadow: 0 0 0 1.5px rgba(255, 255, 255, 0.8); /* White border */
  /* animation: cursorPulse 1.5s infinite ease-in-out; */
}

.cursor-label {
  position: absolute;
  top: 15px; /* Position below the pointer */
  left: 50%;
  transform: translateX(-50%); /* Center the label */
  padding: 2px 6px;
  border-radius: 3px;
  background-color: inherit; /* Color set by parent style */
  color: white;
  font-size: 11px;
  font-weight: 500;
  white-space: nowrap;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.2);
}

/* Active Users Avatars */
.active-users {
  position: absolute;
  top: 10px; /* Above toolbar */
  left: 80px; /* To the right of toolbar */
  display: flex;
  flex-direction: row; /* Stack rightwards */
  gap: 6px; /* Small gap between avatars */
  pointer-events: auto; /* Allow interaction like tooltips */
  z-index: 1010; /* Above canvas, below toolbar/modals */
}

.user-avatar {
  width: 24px; /* Reduced from 30px */
  height: 24px; /* Reduced from 30px */
  border-radius: 50%;
  background-color: grey; /* Default color */
  color: white;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 10px; /* Reduced from 12px */
  font-weight: bold;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.3);
  border: 1.5px solid white; /* White border */
  transition: transform 0.2s ease;
  cursor: default; /* Indicate non-interactive */
}

.user-avatar:hover {
   transform: scale(1.1); /* Slight zoom on hover */
   z-index: 1011; /* Bring hovered avatar to front */
}

.current-user {
  /* Slightly different style for the local user's avatar */
   border-color: #a0ffa0; /* Greenish border for self */
}

/* Debug Panel */
.debug-panel {
  position: absolute;
  bottom: 10px;
  left: 10px;
  background-color: rgba(0, 0, 0, 0.75);
  color: #eee;
  padding: 8px;
  border-radius: 4px;
  font-size: 11px;
  line-height: 1.4;
  max-width: 250px;
  max-height: 300px;
  overflow: auto;
  pointer-events: auto; /* Allow scrolling */
  z-index: 2100;
  border: 1px solid #555;
}

.debug-panel h4 {
  margin: 0 0 5px 0;
  color: #66ccff;
  font-size: 12px;
  border-bottom: 1px solid #555;
  padding-bottom: 3px;
}

.debug-user {
  margin-bottom: 4px;
  padding-bottom: 4px;
  border-bottom: 1px dotted #444;
}
.debug-user:last-child {
  border-bottom: none;
  margin-bottom: 0;
}

/* Optional Pulse Animation */
/* @keyframes cursorPulse {
  0%, 100% { transform: scale(1); opacity: 1; }
  50% { transform: scale(1.2); opacity: 0.7; }
} */
</style>
