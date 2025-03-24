<template>
  <div class="color-picker-container" ref="container">
    <div 
      class="color-swatch"
      :style="{ backgroundColor: selectedColor }"
      @click="togglePicker"
    ></div>

    <div class="color-name">{{ colorName }}</div>

    <div v-if="showPicker" class="color-picker-dropdown">
      <div class="recent-colors">
        <h4>Recent Colors</h4>
        <div class="recent-colors-grid">
          <button 
            v-for="(color, index) in recentColors" 
            :key="'recent-' + index"
            class="color-btn"
            :style="{ backgroundColor: color }"
            :class="{ active: selectedColor === color }"
            @click="selectColor(color)"
          ></button>
        </div>
      </div>

      <div class="preset-colors">
        <h4>Preset Colors</h4>
        <div class="color-palette">
          <button 
            v-for="(color, index) in colorPalette" 
            :key="'palette-' + index"
            class="color-btn"
            :style="{ backgroundColor: color }"
            :class="{ active: selectedColor === color }"
            @click="selectColor(color)"
            :title="colorNames[index]"
          ></button>
        </div>
      </div>

      <div class="custom-color">
        <h4>Custom Color</h4>
        <div class="color-input-container">
          <input 
            type="color" 
            v-model="customColor" 
            @input="selectColor(customColor)"
            class="color-input"
          >
          <div class="color-value">
            <input 
              type="text" 
              v-model="customColor" 
              class="color-code-input"
              @input="validateHexColor"
              @keydown.enter="selectColor(customColor)"
            >
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script>
export default {
  name: 'ColorPicker',
  props: {
    value: {
      type: String,
      default: '#000000'
    }
  },
  data() {
    return {
      selectedColor: this.value,
      customColor: this.value,
      showPicker: false,
      recentColors: [],
      colorPalette: [
        '#000000', // Black
        '#FFFFFF', // White
        '#FF0000', // Red
        '#00FF00', // Green
        '#0000FF', // Blue
        '#FFFF00', // Yellow
        '#FF00FF', // Magenta
        '#00FFFF', // Cyan
        '#FFA500', // Orange
        '#800080', // Purple
        '#008000', // Dark Green
        '#A52A2A', // Brown
        '#808080', // Grey
        '#FFC0CB', // Pink
        '#1E90FF', // Dodger Blue
        '#FFD700'  // Gold
      ],
      colorNames: [
        'Black', 'White', 'Red', 'Green', 'Blue', 
        'Yellow', 'Magenta', 'Cyan', 'Orange', 'Purple',
        'Dark Green', 'Brown', 'Grey', 'Pink', 'Dodger Blue', 'Gold'
      ]
    }
  },
  computed: {
    colorName() {
      const index = this.colorPalette.indexOf(this.selectedColor.toUpperCase());
      if (index !== -1) {
        return this.colorNames[index];
      }
      return 'Custom';
    }
  },
  mounted() {
    this.loadRecentColors();
    document.addEventListener('click', this.handleClickOutside);
  },
  beforeDestroy() {
    document.removeEventListener('click', this.handleClickOutside);
  },
  methods: {
    togglePicker() {
      this.showPicker = !this.showPicker;
    },

    selectColor(color) {
      this.selectedColor = color;
      this.customColor = color;
      this.$emit('input', color);
      this.$emit('change', color);

      // Add to recent colors
      this.addToRecentColors(color);

      // Close picker after selection
      this.showPicker = false;
    },

    validateHexColor() {
      // Ensure it's a valid hex color
      const hexRegex = /^#([A-Fa-f0-9]{3}){1,2}$/;
      if (!hexRegex.test(this.customColor)) {
        // Add # if missing
        if (!this.customColor.startsWith('#')) {
          this.customColor = '#' + this.customColor;
        }

        // Truncate if too long
        if (this.customColor.length > 7) {
          this.customColor = this.customColor.substring(0, 7);
        }

        // Replace invalid characters
        this.customColor = this.customColor.replace(/[^#A-Fa-f0-9]/g, '0');
      }
    },

    addToRecentColors(color) {
      // Don't add duplicates
      if (!this.recentColors.includes(color)) {
        // Add to beginning
        this.recentColors.unshift(color);

        // Keep only the last 8
        if (this.recentColors.length > 8) {
          this.recentColors.pop();
        }

        // Save to localStorage
        localStorage.setItem('recentColors', JSON.stringify(this.recentColors));
      }
    },

    loadRecentColors() {
      try {
        const saved = localStorage.getItem('recentColors');
        if (saved) {
          this.recentColors = JSON.parse(saved);
        }
      } catch (e) {
        console.error('Error loading recent colors:', e);
      }
    },

    handleClickOutside(event) {
      if (this.showPicker && this.$refs.container && !this.$refs.container.contains(event.target)) {
        this.showPicker = false;
      }
    }
  },
  watch: {
    value(newValue) {
      this.selectedColor = newValue;
      this.customColor = newValue;
    }
  }
}
</script>

<style scoped>
.color-picker-container {
  position: relative;
  display: flex;
  align-items: center;
  gap: 8px;
}

.color-swatch {
  width: 36px;
  height: 36px;
  border: 2px solid #444;
  border-radius: 4px;
  cursor: pointer;
  transition: transform 0.2s;
}

.color-swatch:hover {
  transform: scale(1.05);
}

.color-name {
  font-size: 14px;
  color: #ccc;
  white-space: nowrap;
}

.color-picker-dropdown {
  position: absolute;
  top: 100%;
  left: 0;
  width: 220px;
  padding: 12px;
  background-color: #333;
  border-radius: 8px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
  z-index: 1000;
  margin-top: 8px;
  animation: fadeIn 0.2s ease-out;
}

.color-picker-dropdown::before {
  content: '';
  position: absolute;
  top: -6px;
  left: 14px;
  width: 12px;
  height: 12px;
  background-color: #333;
  transform: rotate(45deg);
}

@keyframes fadeIn {
  from { opacity: 0; transform: translateY(-10px); }
  to { opacity: 1; transform: translateY(0); }
}

h4 {
  margin: 0 0 8px 0;
  font-size: 12px;
  font-weight: 600;
  color: #aaa;
}

.recent-colors,
.preset-colors,
.custom-color {
  margin-bottom: 12px;
}

.recent-colors-grid,
.color-palette {
  display: grid;
  grid-template-columns: repeat(8, 1fr);
  gap: 4px;
}

.color-palette {
  grid-template-columns: repeat(8, 1fr);
}

.color-btn {
  width: 22px;
  height: 22px;
  border: 1px solid #444;
  border-radius: 4px;
  cursor: pointer;
  transition: transform 0.2s;
}

.color-btn:hover {
  transform: scale(1.1);
}

.color-btn.active {
  border: 2px solid white;
  transform: scale(1.1);
}

.color-input-container {
  display: flex;
  align-items: center;
  gap: 8px;
}

.color-input {
  width: 32px;
  height: 32px;
  border: none;
  border-radius: 4px;
  cursor: pointer;
}

.color-value {
  flex-grow: 1;
}

.color-code-input {
  width: 100%;
  padding: 6px 8px;
  background-color: #444;
  border: 1px solid #555;
  border-radius: 4px;
  color: white;
  font-family: monospace;
  font-size: 14px;
}
</style>