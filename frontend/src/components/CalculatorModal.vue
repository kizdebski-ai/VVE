<template>
  <DraggablePanel
    v-if="isVisible"
    :initial-x="windowWidth - 364"
    :initial-y="64"
    width="340px"
    aria-label="Kalkulator naukowy"
    @close="closeModal"
  >
    <template #header>
      <span>Kalkulator naukowy</span>
    </template>
    <Calculator :show-close="false" @close="closeModal" />
  </DraggablePanel>
</template>

<script setup>
import { ref, computed, watch } from 'vue';
import Calculator from './Calculator.vue';
import DraggablePanel from './DraggablePanel.vue';

const props = defineProps({
  isVisible: { type: Boolean, default: false }
});

const emit = defineEmits(['update:isVisible', 'close']);

const isVisible = ref(props.isVisible);
const windowWidth = computed(() => window.innerWidth);

watch(() => props.isVisible, (newVal) => {
  isVisible.value = newVal;
});

const closeModal = () => {
  isVisible.value = false;
  emit('update:isVisible', false);
  emit('close');
};

</script>

<style scoped>
:deep(.panel-body) {
  padding: 0;
}
</style>
