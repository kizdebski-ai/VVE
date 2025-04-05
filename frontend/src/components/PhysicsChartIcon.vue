<template>
  <button class="tool-button" @click="toggleGraphMenu('physics')">
    <svg width="24" height="24" viewBox="0 0 24 24">
      <path d="M12,2L4,5V11.09C4,16.14 7.41,20.85 12,22C16.59,20.85 20,16.14 20,11.09V5L12,2Z" fill="#FF5722"/>
      <path d="M12,12L16,8M12,12L8,8M12,12V16" stroke="#FFFFFF" stroke-width="2"/>
    </svg>
  </button>
</template>

<script>
export default {
  methods: {
    toggleGraphMenu(type) {
      this.$emit('toggle-graph-menu', type);
    }
  }
}
</script>

<style scoped>
.tool-button {
  background: none;
  border: none;
  cursor: pointer;
  padding: 8px;
  margin: 0 4px;
}
.tool-button:hover {
  background-color: #f0f0f0;
  border-radius: 4px;
}
</style>
