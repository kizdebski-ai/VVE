<template>
  <div class="color-picker-container" ref="container">
    <div class="tool-btn color-picker-btn" :title="colorName">
      <div 
        class="color-preview"
        :style="{ backgroundColor: selectedColor }"
      ></div>
      
      <!-- Hover Menu dla kolorów -->
      <div class="colors-grid">
        <div 
          v-for="(color, index) in basicColors" 
          :key="'palette-' + index"
          class="color-option"
          :style="{ backgroundColor: color }"
          :class="{ active: selectedColor === color }"
          @click="selectColor(color)"
          :title="basicColorNames[index]"
        ></div>
        
        <!-- Ostatnio użyte kolory -->
        <div 
          v-for="(color, index) in recentColors.slice(0, 4)" 
          :key="'recent-' + index"
          class="color-option"
          :style="{ backgroundColor: color }"
          :class="{ active: selectedColor === color }"
          @click="selectColor(color)"
          :title="'Ostatnio używany'"
        ></div>
        
        <!-- Kolor własny -->
        <div class="custom-color-container">
          <input 
            type="color" 
            v-model="customColor" 
            @input="selectColor(customColor)"
            class="custom-color-picker"
            title="Własny kolor"
          >
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
      recentColors: [],
      // Wszystkie kolory
      colorPalette: [
        '#000000', '#FFFFFF', '#F44336', '#4CAF50', 
        '#2196F3', '#FFEB3B', '#9C27B0', '#FF9800', 
        '#795548', '#607D8B', '#E91E63', '#00BCD4'
      ],
      colorNames: [
        'Czarny', 'Biały', 'Czerwony', 'Zielony', 
        'Niebieski', 'Żółty', 'Fioletowy', 'Pomarańczowy', 
        'Brązowy', 'Szary niebieski', 'Różowy', 'Cyjan'
      ],
      // Tylko podstawowe kolory do wyświetlenia
      basicColors: [
        '#000000', '#FFFFFF', '#F44336', '#4CAF50', 
        '#2196F3', '#FFEB3B', '#9C27B0', '#FF9800'
      ],
      basicColorNames: [
        'Czarny', 'Biały', 'Czerwony', 'Zielony', 
        'Niebieski', 'Żółty', 'Fioletowy', 'Pomarańczowy'
      ]
    }
  },
  computed: {
    colorName() {
      const index = this.colorPalette.findIndex(c => 
        c.toUpperCase() === this.selectedColor.toUpperCase()
      );
      if (index !== -1) {
        return this.colorNames[index];
      }
      return 'Własny';
    }
  },
  mounted() {
    this.loadRecentColors();
  },
  methods: {
    selectColor(color) {
      this.selectedColor = color;
      this.addToRecent(color);
      this.$emit('change', color);
      console.log('ColorPicker: Wybrano kolor', color);
      // Dodanie wpisu do historii przeglądania (nie wpływa na funkcjonalność)
      if (window.localStorage) {
        try {
          localStorage.setItem('lastSelectedColor', color);
        } catch (e) {
          console.error('Nie można zapisać koloru do localStorage:', e);
        }
      }
    },

    isHexColor(value) {
      return /^#[0-9A-F]{6}$/i.test(value);
    },

    addToRecent(color) {
      if (!color || !this.isHexColor(color)) return;

      // Dodaj kolor do niedawno używanych, jeśli nie jest już obecny
      if (!this.recentColors.includes(color)) {
        this.recentColors.unshift(color);
        if (this.recentColors.length > 4) { // Ograniczamy do 4 kolorów
          this.recentColors.pop();
        }
      } else {
        // Jeśli kolor już istnieje, przenieś go na początek listy
        const index = this.recentColors.indexOf(color);
        this.recentColors.splice(index, 1);
        this.recentColors.unshift(color);
      }

      // Zapisz do localStorage
      if (window.localStorage) {
        try {
          localStorage.setItem('recentColors', JSON.stringify(this.recentColors));
        } catch (e) {
          console.error('Nie można zapisać ostatnich kolorów:', e);
        }
      }
    },

    setCustomColor() {
      if (this.isHexColor(this.customColor)) {
        this.selectColor(this.customColor);
      } else {
        console.error('Nieprawidłowy format koloru:', this.customColor);
      }
    },

    loadRecentColors() {
      try {
        const saved = localStorage.getItem('recentColors');
        if (saved) {
          this.recentColors = JSON.parse(saved);
        }
      } catch (e) {
        console.error('Błąd wczytywania ostatnich kolorów:', e);
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
  margin: 8px 0;
  width: 100%;
}

.color-picker-btn {
  position: relative;
  width: 40px;
  height: 40px;
  margin: 0 auto;
  background-color: var(--btn-bg);
  border: none;
  border-radius: 8px;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: background-color 0.2s ease;
}

.color-picker-btn:hover {
  background-color: var(--btn-hover-bg);
}

.color-preview {
  width: 24px;
  height: 24px;
  border-radius: 50%;
  border: 2px solid var(--border-color);
  margin: 0 auto;
}

.colors-grid {
  position: absolute;
  left: 48px; /* Dla lepszego umiejscowienia */
  top: 0;
  background-color: var(--toolbar-bg);
  border-radius: 8px;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.3);
  padding: 8px;
  margin-left: 8px;
  z-index: 1000;
  display: none;
  grid-template-columns: repeat(4, 1fr);
  gap: 6px;
  width: 144px; /* Dokładnie 4 kolory w rzędzie */
  border: 1px solid var(--border-color);
}

.color-picker-btn:hover .colors-grid {
  display: grid;
}

.custom-color-container {
  width: 24px;
  height: 24px;
  border-radius: 50%;
  overflow: hidden;
  position: relative;
  background: linear-gradient(to right, red, yellow, green, cyan, blue, magenta);
  border: 2px solid var(--border-color);
}

.custom-color-picker {
  position: absolute;
  top: -5px;
  left: -5px;
  width: 34px;
  height: 34px;
  border: none;
  opacity: 0;
  cursor: pointer;
}

.color-option {
  width: 24px;
  height: 24px;
  border-radius: 50%;
  border: 2px solid transparent;
  cursor: pointer;
  transition: transform 0.2s ease;
}

.color-option:hover {
  transform: scale(1.2);
}

.color-option.active {
  border-color: white;
  box-shadow: 0 0 0 2px rgba(0, 0, 0, 0.3);
}
</style>