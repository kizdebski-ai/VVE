<template>
  <div class="glass-panel grid-align-panel">
    <div class="panel-header">
      <span>Grid Align Options</span>
      <button class="close-button" @click="$emit('close')">
        <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <line x1="18" y1="6" x2="6" y2="18"></line>
          <line x1="6" y1="6" x2="18" y2="18"></line>
        </svg>
      </button>
    </div>

    <div class="panel-content">
      <div class="control-group">
        <label class="control-label">
          <span>Snap Strength</span>
          <span class="value-badge">{{ options.snapStrength }}%</span>
        </label>
        <div class="slider-wrapper">
          <input 
            type="range" 
            min="0" 
            max="100" 
            :value="options.snapStrength"
            @input="updateOption('snapStrength', $event.target.value)"
            class="styled-slider"
          >
          <div class="slider-track" :style="{ width: options.snapStrength + '%' }"></div>
        </div>
      </div>

      <div class="control-group checkbox-group">
        <label class="checkbox-wrapper">
          <input 
            type="checkbox" 
            :checked="options.showBaselines"
            @change="updateOption('showBaselines', $event.target.checked)"
          >
          <span class="checkbox-custom"></span>
          <span class="label-text">Show Baselines</span>
        </label>
      </div>

      <button class="btn-primary full-width" @click="$emit('align')">
        Align to Grid
      </button>
    </div>
  </div>
</template>

<script>
export default {
  name: 'GridAlignPanel',
  props: {
    options: {
      type: Object,
      required: true
    }
  },
  emits: ['close', 'update:options', 'align'],
  setup(props, { emit }) {
    const updateOption = (key, value) => {
      const newOptions = { ...props.options, [key]: Number(value) || value };
      // Handle boolean specifically if needed, but 'checked' handles it.
      if (key === 'showBaselines') newOptions[key] = value;
      
      emit('update:options', newOptions);
    };

    return {
      updateOption
    };
  }
}
</script>

<style scoped>
.grid-align-panel {
  position: absolute;
  top: 80px;
  left: 50%;
  transform: translateX(-50%);
  width: 320px;
  z-index: 1010;
  display: flex;
  flex-direction: column;
  padding: 0;
  overflow: hidden;
}

.panel-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 16px 20px;
  border-bottom: 1px solid rgba(0,0,0,0.05);
  font-weight: 600;
  font-size: 16px;
  color: var(--text-primary);
}

.close-button {
  background: transparent;
  border: none;
  cursor: pointer;
  color: var(--text-secondary);
  padding: 4px;
  border-radius: 50%;
  transition: background 0.2s;
  display: flex;
  align-items: center;
  justify-content: center;
}

.close-button:hover {
  background: rgba(0,0,0,0.05);
  color: var(--text-primary);
}

.panel-content {
  padding: 20px;
  display: flex;
  flex-direction: column;
  gap: 20px;
}

.control-group {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.control-label {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: 14px;
  font-weight: 500;
  color: var(--text-secondary);
}

.value-badge {
  background: rgba(37, 99, 235, 0.1);
  color: var(--accent-primary);
  padding: 2px 8px;
  border-radius: 12px;
  font-size: 12px;
  font-weight: 600;
}

/* Custom Slider Styling */
.slider-wrapper {
  position: relative;
  height: 6px;
  background: rgba(0,0,0,0.1);
  border-radius: 3px;
  display: flex;
  align-items: center;
}

.styled-slider {
  -webkit-appearance: none;
  width: 100%;
  height: 100%;
  background: transparent;
  outline: none;
  margin: 0;
  padding: 0;
  cursor: pointer;
  z-index: 2;
}

.styled-slider::-webkit-slider-thumb {
  -webkit-appearance: none;
  appearance: none;
  width: 18px;
  height: 18px;
  border-radius: 50%;
  background: #ffffff;
  border: 2px solid var(--accent-primary);
  cursor: pointer;
  transition: transform 0.1s, box-shadow 0.2s;
  box-shadow: 0 2px 4px rgba(0,0,0,0.2);
}

.styled-slider::-webkit-slider-thumb:hover {
  transform: scale(1.1);
}

.slider-track {
  position: absolute;
  left: 0;
  top: 0;
  height: 100%;
  background: var(--accent-primary);
  border-radius: 3px;
  z-index: 1;
  pointer-events: none;
}

/* Custom Checkbox */
.checkbox-group {
  margin-top: 4px;
}

.checkbox-wrapper {
  display: flex;
  align-items: center;
  gap: 10px;
  cursor: pointer;
  user-select: none;
}

.checkbox-wrapper input {
  display: none;
}

.checkbox-custom {
  width: 20px;
  height: 20px;
  border: 2px solid rgba(0,0,0,0.2);
  border-radius: 6px;
  position: relative;
  transition: all 0.2s;
  background: rgba(255,255,255,0.5);
}

.checkbox-wrapper input:checked + .checkbox-custom {
  background: var(--accent-primary);
  border-color: var(--accent-primary);
}

.checkbox-custom::after {
  content: '';
  position: absolute;
  left: 6px;
  top: 2px;
  width: 4px;
  height: 10px;
  border: solid white;
  border-width: 0 2px 2px 0;
  transform: rotate(45deg);
  opacity: 0;
  transition: opacity 0.2s;
}

.checkbox-wrapper input:checked + .checkbox-custom::after {
  opacity: 1;
}

.label-text {
  font-size: 14px;
  color: var(--text-primary);
}

.full-width {
  width: 100%;
  margin-top: 8px;
  padding: 12px;
  font-size: 14px;
}
</style>