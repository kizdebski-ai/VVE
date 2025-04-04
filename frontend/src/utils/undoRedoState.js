import { reactive } from 'vue';

// Globalny, reaktywny stan dla undo/redo dostępny dla wszystkich komponentów
export const undoRedoState = reactive({
  canUndo: false,
  canRedo: false,
  update(canUndo, canRedo) {
    this.canUndo = !!canUndo;
    this.canRedo = !!canRedo;
    console.log(`[Global] UndoRedoState updated: canUndo=${this.canUndo}, canRedo=${this.canRedo}`);
  }
});
