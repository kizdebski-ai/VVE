<template>
  <button class="tool-button" @click="toggleGraphMenu('math')">
    <svg width="24" height="24" viewBox="0 0 24 24">
      <path d="M19,3H5C3.9,3 3,3.9 3,5V19C3,20.1 3.9,21 5,21H19C20.1,21 21,20.1 21,19V5C21,3.9 20.1,3 19,3Z" fill="#4CAF50"/>
      <path d="M12,6L8,10H16L12,6ZM12,18L16,14H8L12,18Z" fill="#FFFFFF"/>
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
