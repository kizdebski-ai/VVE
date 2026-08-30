import { mount } from '@vue/test-utils';
import { nextTick, ref } from 'vue';
import * as Y from 'yjs';
import WhiteboardCanvas from '@/components/WhiteboardCanvas.vue';
import MovableObject from '@/components/MovableObject.vue';
import { connectToYjs } from '@/services/connectToYjs'; // mocked below

// --- Mocks ---

// The document layer is REAL Yjs (a fresh Y.Doc per test) so the component's
// observe/observeDeep/transaction behavior runs exactly as in production;
// only the network provider is replaced by the connectToYjs mock.
const mockUndoManager = {
  canUndo: ref(false),
  canRedo: ref(false),
  undo: vi.fn(),
  redo: vi.fn(),
  on: vi.fn(),
  off: vi.fn(),
  destroy: vi.fn(),
  stopCapturing: vi.fn(),
};

const mockAwareness = {
  on: vi.fn(),
  off: vi.fn(),
  clientID: 42,
  getLocalState: vi.fn(() => ({ user: { name: 'Test User', color: '#ff0000' } })),
  setLocalState: vi.fn(),
  setLocalStateField: vi.fn(),
  getStates: vi.fn(() => new Map()),
  destroy: vi.fn(),
};

let mockYDoc;
let mockYDrawings;

vi.mock('@/services/connectToYjs', () => ({
  connectToYjs: vi.fn(() => ({
    ydoc: mockYDoc,
    yDrawings: mockYDrawings,
    awareness: mockAwareness,
    undoManager: mockUndoManager,
    provider: { disconnect: vi.fn(), destroy: vi.fn() },
    disconnect: vi.fn(),
    destroy: vi.fn(),
  })),
}));

// Mock geometry utility
// isPointInRotatedRectangle is crucial for selection
vi.mock('@/utils/geometry', async (importOriginal) => {
  const actual = await importOriginal(); // To get other functions if any
  return {
    ...actual,
    isPointInRotatedRectangle: vi.fn(), // Mock this specific function
  };
});

// happy-dom has no canvas 2d implementation; provide a permissive stub so
// WhiteboardCanvas.initCanvas and the render helpers can run.
const createFake2dContext = () => {
  const target = {};
  const ctx = new Proxy(target, {
    get(obj, prop) {
      if (prop === 'canvas') return { width: 800, height: 600, style: {} };
      if (!(prop in obj)) {
        obj[prop] = () => ctx;
      }
      return obj[prop];
    },
    set() {
      return true;
    }
  });
  return ctx;
};

describe('WhiteboardCanvas.vue', () => {
  let wrapper;
  let initialTestObject; // A real Y.Map inside the real Y.Doc
  let geometryMock; // To control isPointInRotatedRectangle

  beforeEach(async () => {
    vi.clearAllMocks();

    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(createFake2dContext());

    geometryMock = await import('@/utils/geometry'); // Get the mocked module

    mockYDoc = new Y.Doc();
    mockYDrawings = mockYDoc.getArray('drawings');
    mockYDoc.transact(() => {
      initialTestObject = new Y.Map();
      initialTestObject.set('id', 'obj1');
      initialTestObject.set('type', 'rectangle');
      initialTestObject.set('x', 50);
      initialTestObject.set('y', 50);
      initialTestObject.set('width', 100);
      initialTestObject.set('height', 80);
      initialTestObject.set('rotation', 0);
      initialTestObject.set('color', 'blue');
      initialTestObject.set('lineWidth', 2);
      mockYDrawings.push([initialTestObject]);
    });

    // Mock connectToYjs to return fresh mocks for each test run
    connectToYjs.mockReturnValue({
        ydoc: mockYDoc,
        yDrawings: mockYDrawings,
        awareness: mockAwareness,
        undoManager: mockUndoManager,
        provider: { disconnect: vi.fn(), destroy: vi.fn() },
        disconnect: vi.fn(),
        destroy: vi.fn(),
    });

    wrapper = mount(WhiteboardCanvas, {
      props: {
        roomId: 'test-room',
      },
      global: {
        // Stubs can be used, but for interaction, sometimes real children are better
        // stubs: { MovableObject: true }
      },
    });
    await nextTick(); // Wait for component mount and yjs connection
  });

  afterEach(() => {
    if (wrapper) {
      wrapper.unmount();
    }
  });

  describe('Object Selection (right mouse button)', () => {
    it('selects an object on right-button mousedown if hit', async () => {
      // Configure mock to simulate a hit on the object
      geometryMock.isPointInRotatedRectangle.mockReturnValue(true);

      const canvas = wrapper.find('.whiteboard-canvas.draw-layer');
      await canvas.trigger('mousedown', { clientX: 75, clientY: 90, button: 2 });
      await nextTick();

      expect(geometryMock.isPointInRotatedRectangle).toHaveBeenCalled();
      expect(wrapper.vm.selectedObjectId).toBe(initialTestObject.get('id'));

      const movableObjectWrapper = wrapper.findComponent(MovableObject);
      expect(movableObjectWrapper.exists()).toBe(true);
      expect(movableObjectWrapper.props('isSelected')).toBe(true);
    });

    it('does not select an object on right-button mousedown if miss', async () => {
      geometryMock.isPointInRotatedRectangle.mockReturnValue(false); // Simulate a miss

      const canvas = wrapper.find('.whiteboard-canvas.draw-layer');
      await canvas.trigger('mousedown', { clientX: 10, clientY: 10, button: 2 });
      await nextTick();

      expect(geometryMock.isPointInRotatedRectangle).toHaveBeenCalled();
      expect(wrapper.vm.selectedObjectId).toBeNull();

      const movableObjectWrapper = wrapper.findComponent(MovableObject);
      // If it was previously selected, it should now be deselected. If nothing was selected, it remains not selected.
      if (movableObjectWrapper.exists()) {
        expect(movableObjectWrapper.props('isSelected')).toBe(false);
      }
    });
  });

  describe('Deselection', () => {
    it('deselects the currently selected object on left-click on empty canvas area', async () => {
      // First, select an object
      geometryMock.isPointInRotatedRectangle.mockReturnValue(true);
      const canvas = wrapper.find('.whiteboard-canvas.draw-layer');
      await canvas.trigger('mousedown', { clientX: 75, clientY: 90, button: 2 }); // Select obj1
      await nextTick();
      expect(wrapper.vm.selectedObjectId).toBe(initialTestObject.get('id'));

      // Switch to the select tool, then left-click on empty space (miss)
      wrapper.vm.setTool('select');
      geometryMock.isPointInRotatedRectangle.mockReturnValue(false);
      await canvas.trigger('mousedown', { clientX: 10, clientY: 10, button: 0 }); // Left click outside
      await nextTick();

      expect(wrapper.vm.selectedObjectId).toBeNull();
      const movableObjectWrapper = wrapper.findComponent(MovableObject);
      if (movableObjectWrapper.exists()) {
        expect(movableObjectWrapper.props('isSelected')).toBe(false);
      }
    });
  });

  describe('Interaction propagation through WhiteboardSession', () => {
    it('turns a MovableObject transform intent into one canonical document command', async () => {
      geometryMock.isPointInRotatedRectangle.mockReturnValue(true);
      const canvas = wrapper.find('.whiteboard-canvas.draw-layer');
      await canvas.trigger('mousedown', { clientX: 75, clientY: 90, button: 2 });
      await nextTick();

      const movableObjectComp = wrapper.findComponent(MovableObject);
      expect(movableObjectComp.exists()).toBe(true);

      // MovableObject remains a rendering adapter over the live entry, but it
      // sends finished gestures back to WhiteboardCanvas instead of writing.
      expect(movableObjectComp.props('object')).toBe(initialTestObject);

      await movableObjectComp.vm.$emit('commit-transform', {
        kind: 'move', id: 'obj1', x: 200, y: 250
      });
      await nextTick();
      expect(mockYDrawings.get(0).get('x')).toBe(200);
      expect(mockYDrawings.get(0).get('y')).toBe(250);

      // MovableObject requests selection through WhiteboardCanvas wiring.
      await movableObjectComp.vm.$emit('request-select', initialTestObject.get('id'));
      await nextTick();
      expect(wrapper.vm.selectedObjectId).toBe(initialTestObject.get('id'));
    });
  });

  describe('Canonical element drawing', () => {
    it('draws a rectangle through WhiteboardSession', async () => {
      // The real element factory (canvasTools.createNewElement) creates the
      // preview; mouseup sends an add command to WhiteboardSession.
      wrapper.vm.setTool('shapes');
      await nextTick();

      const canvas = wrapper.find('.whiteboard-canvas.draw-layer');
      // Simulate drawing: mousedown, mousemove (to define size), mouseup
      await canvas.trigger('mousedown', { clientX: 10, clientY: 20, button: 0 });
      await nextTick(); // Let handleMouseDown process
      // Simulate dragging to (40, 60) to create a 30x40 rectangle
      await canvas.trigger('mousemove', { clientX: 40, clientY: 60, buttons: 1 });
      await nextTick(); // Let handleMouseMove process
      await canvas.trigger('mouseup', { clientX: 40, clientY: 60, button: 0 });
      await nextTick(); // Let handleMouseUp process and element creation

      // The committed element lives in the real yDrawings array.
      const elements = mockYDrawings.toArray();
      expect(elements).toHaveLength(2);
      const pushedElement = elements[1];
      expect(pushedElement).toBeInstanceOf(Y.Map);
      expect(pushedElement.get('type')).toBe('rectangle');
      // Bounding box of start (10,20) -> end (40,60)
      expect(pushedElement.get('x')).toBe(10);
      expect(pushedElement.get('y')).toBe(20);
      expect(pushedElement.get('width')).toBe(30);
      expect(pushedElement.get('height')).toBe(40);
      expect(pushedElement.get('id')).toEqual(expect.any(String));
    });

    it('adds a canonical mathematical graph at the viewport and deletes it through selection', async () => {
      expect(wrapper.vm.addElementFromPanel({
        type: 'mathFunctionPlot',
        width: 400,
        height: 300,
        expression: 'x^2',
        xRange: [-10, 10],
        color: '#2563eb',
        lineWidth: 3
      })).toBe(true);
      await nextTick();

      const graph = mockYDrawings.get(1);
      expect(graph.get('type')).toBe('mathFunctionPlot');
      expect(graph.get('x')).toEqual(expect.any(Number));
      expect(graph.get('y')).toEqual(expect.any(Number));
      expect(graph.has('position')).toBe(false);

      wrapper.vm.selectObject(graph.get('id'));
      expect(wrapper.vm.deleteSelectedObject()).toBe(true);
      expect(mockYDrawings.toArray().some((object) => object.get('id') === graph.get('id'))).toBe(false);
    });

    it('publishes the exclusive panel state owned by WhiteboardSession', async () => {
      expect(wrapper.vm.toggleLessonPanel('calculator')).toBe('calculator');
      expect(wrapper.vm.toggleLessonPanel('mathGraph')).toBe('mathGraph');
      expect(wrapper.vm.toggleLessonPanel('mathGraph')).toBeNull();
      expect(wrapper.emitted('update:lesson-panel')).toEqual([
        ['calculator'],
        ['mathGraph'],
        [null]
      ]);
    });
  });

  describe('Acknowledged collaboration read-only gate', () => {
    it('blocks mutations until synchronization-complete and returns to read-only on disconnect', async () => {
      wrapper.unmount();
      let connectionOptions;
      let editable = false;
      connectToYjs.mockImplementation((_roomId, options) => {
        connectionOptions = options;
        return {
          ydoc: mockYDoc,
          yDrawings: mockYDrawings,
          awareness: mockAwareness,
          disconnect: vi.fn(),
          isEditable: () => editable,
        };
      });

      wrapper = mount(WhiteboardCanvas, {
        props: { roomId: 'managed-board', wsToken: 'managed-token', role: 'student' },
      });
      await nextTick();

      expect(wrapper.find('[data-testid="collaboration-read-only"]').exists()).toBe(true);
      const before = mockYDrawings.length;
      wrapper.vm.clearCanvas({ skipConfirm: true });
      expect(mockYDrawings.length).toBe(before);

      editable = true;
      connectionOptions.onStatus('connected');
      await nextTick();
      expect(wrapper.find('[data-testid="collaboration-read-only"]').exists()).toBe(false);

      editable = false;
      connectionOptions.onStatus('disconnected');
      await nextTick();
      expect(wrapper.find('[data-testid="collaboration-read-only"]').exists()).toBe(true);
    });
  });

});
