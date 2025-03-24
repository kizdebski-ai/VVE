<template>
  <div class="dialog-overlay" v-if="show" @click.self="closeOnBackdrop ? $emit('close') : null">
    <div class="dialog">
      <div class="dialog-header">
        <h4>{{ title }}</h4>
        <button class="close-btn" @click="$emit('close')" v-if="showCloseButton">×</button>
      </div>

      <div class="dialog-content">
        <slot></slot>
      </div>

      <div class="dialog-actions" v-if="$slots.actions">
        <slot name="actions"></slot>
      </div>
      <div class="dialog-actions" v-else-if="actions && actions.length">
        <button 
          v-for="action in actions" 
          :key="action.text"
          class="action-button"
          :class="{ 'cancel': action.cancel }"
          @click="action.handler ? action.handler() : $emit(action.event || 'action', action.value)"
        >
          {{ action.text }}
        </button>
      </div>
    </div>
  </div>
</template>

<script>
export default {
  name: 'Dialog',
  props: {
    show: {
      type: Boolean,
      default: false
    },
    title: {
      type: String,
      default: 'Dialog'
    },
    actions: {
      type: Array,
      default: () => []
    },
    closeOnBackdrop: {
      type: Boolean,
      default: true
    },
    showCloseButton: {
      type: Boolean,
      default: true
    }
  },
  mounted() {
    // Add keydown event listener for Escape key
    document.addEventListener('keydown', this.handleKeyDown);

    // Prevent body scrolling
    if (this.show) {
      document.body.style.overflow = 'hidden';
    }
  },
  beforeUnmount() {
    document.removeEventListener('keydown', this.handleKeyDown);
    document.body.style.overflow = '';
  },
  watch: {
    show(newVal) {
      // Update body overflow state when dialog visibility changes
      document.body.style.overflow = newVal ? 'hidden' : '';
    }
  },
  methods: {
    handleKeyDown(event) {
      if (this.show && event.key === 'Escape' && this.closeOnBackdrop) {
        this.$emit('close');
      }
    }
  }
}
</script>

<style scoped>
.dialog-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background-color: rgba(0, 0, 0, 0.7);
  display: flex;
  justify-content: center;
  align-items: center;
  z-index: 1000;
  animation: fadeIn 0.2s ease-out;
}

.dialog {
  background-color: #242424;
  border-radius: 8px;
  padding: 0;
  width: 90%;
  max-width: 500px;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.3);
  animation: slideUp 0.3s ease-out;
  max-height: 90vh;
  display: flex;
  flex-direction: column;
}

.dialog-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 15px 20px;
  border-bottom: 1px solid #333;
}

.dialog-header h4 {
  font-size: 18px;
  margin: 0;
  color: #fff;
}

.close-btn {
  background: none;
  border: none;
  color: #999;
  font-size: 24px;
  cursor: pointer;
  padding: 0;
  width: 24px;
  height: 24px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 4px;
}

.close-btn:hover {
  color: #fff;
  background-color: rgba(255, 255, 255, 0.1);
}

.dialog-content {
  padding: 20px;
  overflow-y: auto;
  flex: 1;
}

.dialog-actions {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
  padding: 15px 20px;
  border-top: 1px solid #333;
}

.action-button {
  padding: 8px 14px;
  background-color: #4285f4;
  color: white;
  border: none;
  border-radius: 4px;
  cursor: pointer;
  font-size: 14px;
}

.action-button:hover {
  background-color: #3367d6;
}

.action-button.cancel {
  background-color: #555;
}

.action-button.cancel:hover {
  background-color: #666;
}

@keyframes fadeIn {
  from { opacity: 0; }
  to { opacity: 1; }
}

@keyframes slideUp {
  from { transform: translateY(30px); opacity: 0; }
  to { transform: translateY(0); opacity: 1; }
}

@media (max-width: 600px) {
  .dialog {
    width: 95%;
    max-height: 95vh;
  }
}
</style>