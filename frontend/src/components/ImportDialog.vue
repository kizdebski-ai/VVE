<template>
  <Dialog 
    :show="show" 
    title="Import Whiteboard" 
    @close="$emit('close')"
    :actions="[
      { text: 'Import', event: 'import' },
      { text: 'Cancel', event: 'close', cancel: true }
    ]"
  >
    <p class="dialog-helper">Paste the whiteboard state text:</p>
    <textarea 
      v-model="importText" 
      class="state-textarea" 
      placeholder="Paste whiteboard state here..."
      @keydown.ctrl.enter="$emit('import', importText)"
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
  }
}
</script>

<style scoped>
.dialog-helper {
  font-size: 14px;
  margin-bottom: 12px;
  color: #aaa;
}

.state-textarea {
  width: 100%;
  height: 180px;
  padding: 10px;
  background-color: #333;
  color: #fff;
  border: 1px solid #555;
  border-radius: 4px;
  font-family: monospace;
  resize: none;
}
</style>