<template>
  <Dialog 
    :show="show" 
    title="Whiteboard State" 
    @close="$emit('close')"
    :actions="[
      { text: 'Copy to Clipboard', event: 'copy' },
      { text: 'Close', event: 'close', cancel: true }
    ]"
  >
    <p class="dialog-helper">Copy this text to save your whiteboard:</p>
    <textarea 
      ref="exportTextarea" 
      :value="exportText" 
      class="state-textarea" 
      readonly
    ></textarea>
  </Dialog>
</template>

<script>
import Dialog from './Dialog.vue';

export default {
  name: 'ExportDialog',
  components: {
    Dialog
  },
  props: {
    show: {
      type: Boolean,
      default: false
    },
    exportText: {
      type: String,
      default: ''
    }
  },
  emits: ['close', 'copy'],
  watch: {
    show(newVal) {
      // Auto-select text when dialog is opened
      if (newVal) {
        this.$nextTick(() => {
          if (this.$refs.exportTextarea) {
            this.$refs.exportTextarea.select();
          }
        });
      }
    }
  },
  methods: {
    selectText() {
      if (this.$refs.exportTextarea) {
        this.$refs.exportTextarea.select();
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