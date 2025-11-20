import { ref } from 'vue';

const activeMathInputRef = ref<HTMLTextAreaElement | HTMLInputElement | null>(null);

export function useMathInputRegistry() {
  const registerActiveMathInput = (
    element: HTMLTextAreaElement | HTMLInputElement | null,
  ) => {
    activeMathInputRef.value = element;
  };

  return {
    activeMathInputRef,
    registerActiveMathInput,
  };
}
