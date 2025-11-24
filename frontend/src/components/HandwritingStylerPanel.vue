<template>
  <div class="glass-panel handwriting-styler-panel">
    <div class="panel-header">
      <div class="header-title">
        <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="header-icon">
          <path d="M12 19l7-7 3 3-7 7-3-3z"></path>
          <path d="M18 13l-1.5-7.5L2 2l3.5 14.5L13 18l5-5z"></path>
          <path d="M2 2l7.586 7.586"></path>
          <circle cx="11" cy="11" r="2"></circle>
        </svg>
        <span>Handwriting Styler</span>
      </div>
      <button class="close-button" @click="$emit('close')">
        <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <line x1="18" y1="6" x2="6" y2="18"></line>
          <line x1="6" y1="6" x2="18" y2="18"></line>
        </svg>
      </button>
    </div>

    <div class="panel-content">
      <!-- Presets Grid -->
      <div class="section-label">Pen Presets</div>
      <div class="preset-grid">
        <div
          v-for="preset in presetCards"
          :key="preset.key"
          class="preset-card"
          :class="{ active: options.preset === preset.key }"
          @click="selectPreset(preset.key)"
        >
          <div class="preset-card-header">
            <span class="preset-name">{{ preset.title }}</span>
            <span class="preset-tag">{{ preset.pill }}</span>
          </div>
          <div class="canvas-wrapper">
            <canvas
              width="170"
              height="52"
              :ref="el => setCanvasRef(preset.key, el)"
            ></canvas>
          </div>
          <p class="preset-description">{{ preset.desc }}</p>
        </div>
      </div>

      <!-- Live Preview -->
      <div class="preview-section">
        <div class="preview-header">
          <div class="preview-info">
            <span class="preview-title">{{ activePresetLabel }}</span>
            <span class="preview-subtitle">Live Preview · abc123</span>
          </div>
          <div class="status-pill">Premium Strokes</div>
        </div>
        <div class="preview-canvas-container">
          <canvas width="320" height="110" ref="mainPreviewRef"></canvas>
        </div>
      </div>

      <!-- Fine Tuning Sliders -->
      <div class="fine-tune-section">
        <div class="section-header" @click="toggleAdvanced" :class="{ open: showAdvanced }">
          <span>Fine-tune Settings</span>
          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="chevron">
            <polyline points="6 9 12 15 18 9"></polyline>
          </svg>
        </div>
        
        <div class="sliders-container" v-show="showAdvanced">
          <div class="slider-row" v-for="(label, key) in sliderConfig" :key="key">
            <div class="slider-label">
              <span>{{ label }}</span>
              <span class="value-badge">{{ options[key] }}%</span>
            </div>
            <div class="slider-wrapper">
              <input 
                type="range" 
                min="0" 
                max="100" 
                :value="options[key]"
                @input="updateOption(key, $event.target.value)"
                class="styled-slider"
              >
              <div class="slider-track" :style="{ width: options[key] + '%' }"></div>
            </div>
          </div>
        </div>
      </div>

      <!-- Actions -->
      <div class="actions-grid">
        <button class="btn-secondary" @click="$emit('action', 'groupStrokes')" :disabled="hasStylizedStrokes">
          Group Strokes
        </button>
        <button class="btn-secondary" @click="$emit('action', 'applyStyleTransformation')" :disabled="!hasCharGroups || hasStylizedStrokes">
          Apply Style
        </button>
        <button class="btn-primary" @click="$emit('action', 'confirmStyleChanges')" :disabled="!hasStylizedStrokes">
          Confirm
        </button>
        <button class="btn-danger" @click="$emit('action', 'cancelStyleChanges')" :disabled="!hasStylizedStrokes">
          Cancel
        </button>
      </div>
    </div>
  </div>
</template>

<script>
import { ref, computed, onMounted, watch, nextTick } from 'vue';

export default {
  name: 'HandwritingStylerPanel',
  props: {
    options: { type: Object, required: true },
    presetCards: { type: Array, required: true },
    hasCharGroups: Boolean,
    hasStylizedStrokes: Boolean
  },
  emits: ['close', 'update:options', 'select-preset', 'set-canvas-ref', 'set-main-preview-ref', 'action'],
  setup(props, { emit }) {
    const showAdvanced = ref(true);
    const mainPreviewRef = ref(null);

    const activePresetLabel = computed(() => {
      return props.presetCards.find(p => p.key === props.options.preset)?.title || 'Custom';
    });

    const sliderConfig = {
      smoothingFactor: 'Stroke Smoothing',
      angleNormalization: 'Slant Correction',
      heightNormalization: 'Height Uniformity',
      widthNormalization: 'Width Uniformity'
    };

    const updateOption = (key, value) => {
      emit('update:options', { ...props.options, [key]: Number(value) });
    };

    const selectPreset = (key) => {
      emit('select-preset', key);
    };

    const setCanvasRef = (key, el) => {
      emit('set-canvas-ref', key, el);
    };
    
    const toggleAdvanced = () => {
      showAdvanced.value = !showAdvanced.value;
    }

    watch(mainPreviewRef, (el) => {
      if (el) emit('set-main-preview-ref', el);
    });

    return {
      showAdvanced,
      activePresetLabel,
      sliderConfig,
      updateOption,
      selectPreset,
      setCanvasRef,
      mainPreviewRef,
      toggleAdvanced
    };
  }
}
</script>

<style scoped>
.handwriting-styler-panel {
  position: absolute;
  top: 80px;
  left: 50%;
  transform: translateX(-50%);
  width: 460px;
  max-width: 95vw;
  z-index: 1010;
  display: flex;
  flex-direction: column;
  max-height: 85vh;
  overflow: hidden;
}

.panel-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 16px 20px;
  border-bottom: 1px solid rgba(0,0,0,0.05);
  background: rgba(255,255,255,0.3);
}

.header-title {
  display: flex;
  align-items: center;
  gap: 10px;
  font-weight: 600;
  font-size: 16px;
  color: var(--text-primary);
}

.header-icon {
  color: var(--accent-primary);
}

.close-button {
  background: transparent;
  border: none;
  cursor: pointer;
  color: var(--text-secondary);
  padding: 6px;
  border-radius: 50%;
  transition: all 0.2s;
}

.close-button:hover {
  background: rgba(0,0,0,0.05);
  color: var(--text-primary);
}

.panel-content {
  padding: 20px;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 24px;
}

.section-label {
  font-size: 13px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  color: var(--text-secondary);
  margin-bottom: -12px;
}

/* Preset Grid */
.preset-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 12px;
}

.preset-card {
  border: 1px solid rgba(0,0,0,0.05);
  background: rgba(255,255,255,0.4);
  border-radius: 12px;
  padding: 12px;
  cursor: pointer;
  transition: all 0.2s ease;
  position: relative;
}

.preset-card:hover {
  background: rgba(255,255,255,0.7);
  transform: translateY(-2px);
  box-shadow: 0 4px 12px rgba(0,0,0,0.05);
}

.preset-card.active {
  border-color: var(--accent-primary);
  background: rgba(255,255,255,0.8);
  box-shadow: 0 0 0 2px rgba(37, 99, 235, 0.2);
}

.preset-card-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 8px;
}

.preset-name {
  font-weight: 600;
  font-size: 14px;
  color: var(--text-primary);
}

.preset-tag {
  font-size: 10px;
  padding: 2px 6px;
  border-radius: 8px;
  background: rgba(37, 99, 235, 0.1);
  color: var(--accent-primary);
  font-weight: 600;
}

.canvas-wrapper {
  background: rgba(255,255,255,0.5);
  border-radius: 8px;
  overflow: hidden;
  margin-bottom: 8px;
  border: 1px solid rgba(0,0,0,0.05);
}

.canvas-wrapper canvas {
  display: block;
  width: 100%;
  height: auto;
}

.preset-description {
  font-size: 11px;
  color: var(--text-secondary);
  line-height: 1.4;
}

/* Preview Section */
.preview-section {
  background: linear-gradient(135deg, rgba(255,255,255,0.6), rgba(255,255,255,0.3));
  border: 1px solid rgba(255,255,255,0.8);
  border-radius: 16px;
  padding: 16px;
  box-shadow: inset 0 0 20px rgba(255,255,255,0.5);
}

.preview-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  margin-bottom: 12px;
}

.preview-info {
  display: flex;
  flex-direction: column;
}

.preview-title {
  font-weight: 700;
  font-size: 18px;
  color: var(--text-primary);
}

.preview-subtitle {
  font-size: 12px;
  color: var(--text-secondary);
}

.status-pill {
  font-size: 10px;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  background: rgba(16, 185, 129, 0.1);
  color: #10b981;
  padding: 4px 8px;
  border-radius: 6px;
  font-weight: 700;
}

.preview-canvas-container {
  background: #fff;
  border-radius: 12px;
  border: 1px solid rgba(0,0,0,0.05);
  padding: 4px;
  box-shadow: inset 0 2px 4px rgba(0,0,0,0.02);
}

.preview-canvas-container canvas {
  display: block;
  width: 100%;
  border-radius: 8px;
}

/* Fine Tune Section */
.fine-tune-section {
  border: 1px solid rgba(0,0,0,0.05);
  background: rgba(255,255,255,0.3);
  border-radius: 12px;
  overflow: hidden;
}

.section-header {
  padding: 12px 16px;
  background: rgba(255,255,255,0.4);
  cursor: pointer;
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-weight: 600;
  font-size: 14px;
  user-select: none;
  transition: background 0.2s;
}

.section-header:hover {
  background: rgba(255,255,255,0.6);
}

.chevron {
  transition: transform 0.3s ease;
  color: var(--text-secondary);
}

.section-header.open .chevron {
  transform: rotate(180deg);
}

.sliders-container {
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.slider-row {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.slider-label {
  display: flex;
  justify-content: space-between;
  font-size: 13px;
  color: var(--text-secondary);
  font-weight: 500;
}

.value-badge {
  background: rgba(0,0,0,0.05);
  padding: 2px 6px;
  border-radius: 4px;
  font-size: 11px;
  color: var(--text-primary);
  min-width: 32px;
  text-align: center;
}

/* Slider Styling (Duplicated from GridAlignPanel for isolation) */
.slider-wrapper {
  position: relative;
  height: 6px;
  background: rgba(0,0,0,0.08);
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
  width: 16px;
  height: 16px;
  border-radius: 50%;
  background: #ffffff;
  border: 2px solid var(--accent-primary);
  cursor: pointer;
  transition: transform 0.1s, box-shadow 0.2s;
  box-shadow: 0 1px 3px rgba(0,0,0,0.2);
}

.styled-slider::-webkit-slider-thumb:hover {
  transform: scale(1.15);
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

/* Actions Grid */
.actions-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px;
}

.btn-primary, .btn-secondary, .btn-danger {
  padding: 10px;
  border-radius: 8px;
  font-weight: 600;
  font-size: 13px;
  border: none;
  cursor: pointer;
  transition: all 0.2s;
}

.btn-primary {
  background: var(--accent-primary);
  color: white;
  box-shadow: 0 2px 8px rgba(37, 99, 235, 0.3);
}

.btn-primary:hover:not(:disabled) {
  background: var(--accent-hover);
  transform: translateY(-1px);
}

.btn-secondary {
  background: white;
  color: var(--text-primary);
  border: 1px solid rgba(0,0,0,0.1);
}

.btn-secondary:hover:not(:disabled) {
  background: #f8fafc;
  border-color: rgba(0,0,0,0.2);
}

.btn-danger {
  background: rgba(239, 68, 68, 0.1);
  color: #ef4444;
}

.btn-danger:hover:not(:disabled) {
  background: rgba(239, 68, 68, 0.2);
}

button:disabled {
  opacity: 0.5;
  cursor: not-allowed;
  transform: none !important;
}
</style>