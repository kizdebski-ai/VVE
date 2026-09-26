import { ref, reactive } from 'vue';
import { useKeyboardShortcuts } from '@/composables/useKeyboardShortcuts';

const keyEvent = (key, overrides = {}) => ({
  key,
  code: overrides.code || '',
  target: { tagName: 'DIV', isContentEditable: false },
  ctrlKey: false,
  metaKey: false,
  altKey: false,
  shiftKey: false,
  preventDefault: vi.fn(),
  ...overrides
});

describe('lesson object keyboard shortcuts', () => {
  const createShortcuts = () => {
    const setTool = vi.fn();
    const deleteSelection = vi.fn(() => true);
    const shortcuts = useKeyboardShortcuts({
      currentTool: ref('select'),
      inlineTextEditor: reactive({ visible: false }),
      spacePanActive: ref(false),
      activeConfigPanel: ref(null),
      pinchGesture: ref(null),
      getActiveFeature: () => null,
      mathRecognizerModule: ref(null),
      zoomIn: vi.fn(),
      zoomOut: vi.fn(),
      resetZoom: vi.fn(),
      setTool,
      cancelActiveDrawing: vi.fn(() => false),
      closeConfigPanel: vi.fn(),
      undo: vi.fn(),
      redo: vi.fn(),
      updateCursor: vi.fn(),
      resetSpacePanState: vi.fn(),
      endTouchGesture: vi.fn(),
      applyMathAnswer: vi.fn(),
      selectPenPreset: vi.fn(),
      deleteSelection
    });
    return { ...shortcuts, setTool, deleteSelection };
  };

  it('selects the visible shape and line tools', () => {
    const { handleKeyDown, setTool } = createShortcuts();
    handleKeyDown(keyEvent('s'));
    handleKeyDown(keyEvent('L'));
    expect(setTool).toHaveBeenNthCalledWith(1, 'shapes');
    expect(setTool).toHaveBeenNthCalledWith(2, 'lines');
  });

  it('deletes only through the session-backed selection callback', () => {
    const { handleKeyDown, deleteSelection } = createShortcuts();
    const event = keyEvent('Delete');
    handleKeyDown(event);
    expect(deleteSelection).toHaveBeenCalledOnce();
    expect(event.preventDefault).toHaveBeenCalledOnce();
  });

  it('does not intercept typing fields', () => {
    const { handleKeyDown, setTool, deleteSelection } = createShortcuts();
    handleKeyDown(keyEvent('s', { target: { tagName: 'INPUT', isContentEditable: false } }));
    handleKeyDown(keyEvent('Delete', { target: { tagName: 'TEXTAREA', isContentEditable: false } }));
    expect(setTool).not.toHaveBeenCalled();
    expect(deleteSelection).not.toHaveBeenCalled();
  });
});
