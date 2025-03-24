<template>
  <div class="zoom-controls">
    <button class="zoom-btn" @click="$emit('zoom-out')" title="Zoom Out">−</button>
    <div class="zoom-level">{{ Math.round(zoomLevel * 100) }}%</div>
    <button class="zoom-btn" @click="$emit('zoom-in')" title="Zoom In">+</button>
    <button class="zoom-btn" @click="$emit('reset-zoom')" title="Reset View">⟲</button>
  </div>
</template>

<script>
export default {
  name: 'ZoomPanControls',
  props: {
    zoomLevel: {
      type: Number,
      default: 1
    }
  }
}
</script>

<style scoped>
.zoom-controls {
  position: absolute;
  bottom: 20px;
  left: 20px;
  display: flex;
  background-color: white;
  border-radius: 20px;
  padding: 5px;
  box-shadow: 0 2px 5px rgba(0, 0, 0, 0.2);
  z-index: 10;
}

.zoom-btn {
  width: 30px;
  height: 30px;
  background: none;
  border: none;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  color: #333;
  font-weight: bold;
}

.zoom-btn:hover {
  color: #4285f4;
}

.zoom-level {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0 10px;
  font-size: 12px;
  color: #333;
}

:deep(.dark-mode) .zoom-controls {
  background-color: #333;
  color: white;
  box-shadow: 0 2px 5px rgba(0, 0, 0, 0.4);
}

:deep(.dark-mode) .zoom-btn {
  color: #f0f0f0;
}

:deep(.dark-mode) .zoom-level {
  color: #f0f0f0;
}
</style>