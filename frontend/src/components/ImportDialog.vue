<template>
  <Dialog 
    :show="show" 
    title="Import Whiteboard" 
    @close="$emit('close')"
    :actions="[
      { text: 'Import', handler: handleImport },
      { text: 'Cancel', event: 'close', cancel: true }
    ]"
  >
    <p class="dialog-helper">Paste the whiteboard state text:</p>
    <textarea 
      v-model="importText" 
      class="state-textarea" 
      placeholder="Paste whiteboard state here..."
      @keydown.ctrl.enter="handleImport"
    ></textarea>
  </Dialog>
</template>

<script>
import Dialog from './Dialog.vue';

export default {
  name: 'ImportDialog',
  components: {
    Dialog
  },
  props: {
    show: {
      type: Boolean,
      default: false
    }
  },
  emits: ['close', 'import'],
  data() {
    return {
      importText: ''
    };
  },
  watch: {
    show(newVal) {
      // Clear text when dialog is opened
      if (newVal) {
        this.importText = '';
      }
    }
  },
  methods: {
    handleImport() {
      this.$emit('import', this.importText);
    }
  }
}
</script>

<style scoped>
.dialog-helper {
  font-size: 14px;
  margin-bottom: 12px;
  color: #6b7280;
  font-weight: 500;
}

.state-textarea {
  width: 100%;
  height: 180px;
  padding: 12px;
  background-color: rgba(255, 255, 255, 0.5);
  color: #1f2937;
  border: 1px solid #e5e7eb;
  border-radius: 8px;
  font-family: 'Menlo', 'Monaco', 'Courier New', monospace;
  font-size: 13px;
  resize: none;
  transition: all 0.2s;
}

.state-textarea:focus {
  outline: none;
  border-color: #2563eb;
  background-color: white;
  box-shadow: 0 0 0 2px rgba(37, 99, 235, 0.1);
}
</style>