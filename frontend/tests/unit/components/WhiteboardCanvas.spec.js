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
const createFake2dContext = (canvas) => {
  const target = {};
  const ctx = new Proxy(target, {
    get(obj, prop) {
      if (prop === 'canvas') return canvas;
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

    // VVE-107: connectToRoom adopts server resource limits before connecting.
    // Resolve instantly so the mount flow reaches the mocked connectToYjs.
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      json: async () => ({ maxWebsocketPayloadBytes: 10 * 1024 * 1024 })
    })));

    const contexts = new WeakMap();
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(function () {
      if (!contexts.has(this)) contexts.set(this, createFake2dContext(this));
      return contexts.get(this);
    });

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
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  describe('Object Selection (right mouse button)', () => {
    it('selects an object on right-button pointerdown if hit', async () => {
      // Configure mock to simulate a hit on the object
      geometryMock.isPointInRotatedRectangle.mockReturnValue(true);

      const canvas = wrapper.find('.whiteboard-canvas.draw-layer');
      await canvas.trigger('pointerdown', { clientX: 75, clientY: 90, button: 2, pointerId: 1, pointerType: 'mouse', isPrimary: true, buttons: 2, pressure: 0 });
      await nextTick();

      expect(geometryMock.isPointInRotatedRectangle).toHaveBeenCalled();
      expect(wrapper.vm.selectedObjectId).toBe(initialTestObject.get('id'));

      const movableObjectWrapper = wrapper.findComponent(MovableObject);
      expect(movableObjectWrapper.exists()).toBe(true);
      expect(movableObjectWrapper.props('isSelected')).toBe(true);
    });

    it('does not select an object on right-button pointerdown if miss', async () => {
      geometryMock.isPointInRotatedRectangle.mockReturnValue(false); // Simulate a miss

      const canvas = wrapper.find('.whiteboard-canvas.draw-layer');
      await canvas.trigger('pointerdown', { clientX: 10, clientY: 10, button: 2, pointerId: 1, pointerType: 'mouse', isPrimary: true, buttons: 2, pressure: 0 });
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
      await canvas.trigger('pointerdown', { clientX: 75, clientY: 90, button: 2, pointerId: 1, pointerType: 'mouse', isPrimary: true, buttons: 2, pressure: 0 }); // Select obj1
      await nextTick();
      expect(wrapper.vm.selectedObjectId).toBe(initialTestObject.get('id'));

      // Switch to the select tool, then left-click on empty space (miss)
      wrapper.vm.setTool('select');
      geometryMock.isPointInRotatedRectangle.mockReturnValue(false);
      await canvas.trigger('pointerdown', { clientX: 10, clientY: 10, button: 0, pointerId: 1, pointerType: 'mouse', isPrimary: true, buttons: 1, pressure: 0.5 }); // Left click outside
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
      await canvas.trigger('pointerdown', { clientX: 75, clientY: 90, button: 2, pointerId: 1, pointerType: 'mouse', isPrimary: true, buttons: 2, pressure: 0 });
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
      // Simulate drawing: pointerdown, pointermove (to define size), pointerup
      await canvas.trigger('pointerdown', { clientX: 10, clientY: 20, button: 0, pointerId: 1, pointerType: 'mouse', isPrimary: true, buttons: 1, pressure: 0.5 });
      await nextTick(); // Let handlePointerDown process
      // Simulate dragging to (40, 60) to create a 30x40 rectangle
      await canvas.trigger('pointermove', { clientX: 40, clientY: 60, buttons: 1, pointerId: 1, pointerType: 'mouse', isPrimary: true, pressure: 0.5 });
      await nextTick(); // Let handlePointerMove process
      await canvas.trigger('pointerup', { clientX: 40, clientY: 60, button: 0, pointerId: 1, pointerType: 'mouse', isPrimary: true, buttons: 0, pressure: 0 });
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

    it('commits the raw pointer-up endpoint while preserving pen pressure', async () => {
      wrapper.vm.setTool('pen');
      await nextTick();

      const canvas = wrapper.find('.whiteboard-canvas.draw-layer');
      await canvas.trigger('pointerdown', {
        clientX: 180,
        clientY: 250,
        button: 0,
        pointerId: 11,
        pointerType: 'pen',
        isPrimary: true,
        buttons: 1,
        pressure: 0.22
      });
      await canvas.trigger('pointermove', {
        clientX: 300,
        clientY: 290,
        pointerId: 11,
        pointerType: 'pen',
        isPrimary: true,
        buttons: 1,
        pressure: 0.48
      });
      await canvas.trigger('pointerup', {
        clientX: 470,
        clientY: 330,
        button: 0,
        pointerId: 11,
        pointerType: 'pen',
        isPrimary: true,
        buttons: 0,
        pressure: 0.87
      });
      await nextTick();

      const elements = mockYDrawings.toArray();
      const stroke = elements[elements.length - 1];
      expect(stroke.get('type')).toBe('pen');
      expect(stroke.get('points').at(-1)).toMatchObject({ x: 470, y: 330, p: 0.87 });
      expect(stroke.get('rawPoints').at(-1)).toMatchObject({ x: 470, y: 330, p: 0.87 });
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
      // connectToRoom now awaits server resource-limit adoption before connecting
      await new Promise((resolve) => setTimeout(resolve, 0));
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

    it('shows Polish restart copy while the server is draining', async () => {
      wrapper.unmount();
      let connectionOptions;
      connectToYjs.mockImplementation((_roomId, options) => {
        connectionOptions = options;
        return {
          ydoc: mockYDoc,
          yDrawings: mockYDrawings,
          awareness: mockAwareness,
          disconnect: vi.fn(),
          isEditable: () => false,
        };
      });
      wrapper = mount(WhiteboardCanvas, {
        props: { roomId: 'managed-board', wsToken: 'managed-token', role: 'student' },
      });
      // The component awaits the resource-limits lookup (graceful fallback)
      // before dialling connectToYjs; flush those microtasks first.
      await vi.waitFor(() => {
        if (!connectionOptions) throw new Error('connectToYjs has not been called yet');
      });
      await nextTick();
      connectionOptions.onStatus('draining');
      await nextTick();
      expect(wrapper.find('[data-testid="connection-loading"]').text()).toContain(
        'Serwer jest restartowany'
      );
      expect(wrapper.find('[data-testid="collaboration-read-only"]').text()).toContain(
        'Twoja praca zostanie przywrócona'
      );
    });
  });

  describe('Pointer Event pipeline', () => {
    it('exposes Pointer Event handlers and not mouse/touch drawing handlers', () => {
      expect(typeof wrapper.vm.handlePointerDown).toBe('function');
      expect(wrapper.vm.handleMouseDown).toBeUndefined();
      expect(wrapper.vm.handleTouchStart).toBeUndefined();
    });

    it('cancels an in-progress stroke on pointercancel instead of committing', async () => {
      wrapper.vm.setTool('pen');
      await nextTick();
      const canvas = wrapper.find('.whiteboard-canvas.draw-layer');
      const before = mockYDrawings.length;
      await canvas.trigger('pointerdown', {
        clientX: 20, clientY: 20, button: 0, pointerId: 9,
        pointerType: 'pen', isPrimary: true, buttons: 1, pressure: 0.4
      });
      await canvas.trigger('pointermove', {
        clientX: 48, clientY: 36, pointerId: 9,
        pointerType: 'pen', isPrimary: true, buttons: 1, pressure: 0.6
      });
      await canvas.trigger('pointercancel', {
        clientX: 48, clientY: 36, pointerId: 9,
        pointerType: 'pen', isPrimary: true, buttons: 0, pressure: 0
      });
      await nextTick();
      expect(mockYDrawings.length).toBe(before);
      expect(wrapper.vm.isDrawing).toBe(false);
    });

    it('does not count denied input as a paint sample', async () => {
      await wrapper.setProps({ wsToken: 'read-only-token' });
      wrapper.vm.setTool('pen');
      const canvas = wrapper.find('.whiteboard-canvas.draw-layer');
      await canvas.trigger('pointerdown', {
        clientX: 20, clientY: 20, button: 0, pointerId: 12,
        pointerType: 'pen', isPrimary: true, buttons: 1, pressure: 0.4
      });
      await new Promise((resolve) => setTimeout(resolve, 25));
      expect(wrapper.vm.inputPaintSampleCount).toBe(0);
    });

    it('counts an accepted preview only after a frame renders it', async () => {
      wrapper.vm.setTool('pen');
      const canvas = wrapper.find('.whiteboard-canvas.draw-layer');
      await canvas.trigger('pointerdown', {
        clientX: 20, clientY: 20, button: 0, pointerId: 13,
        pointerType: 'pen', isPrimary: true, buttons: 1, pressure: 0.4
      });
      await canvas.trigger('pointermove', {
        clientX: 48, clientY: 36, pointerId: 13,
        pointerType: 'pen', isPrimary: true, buttons: 1, pressure: 0.6
      });
      await vi.waitFor(() => expect(wrapper.vm.inputPaintSampleCount).toBeGreaterThan(0));
    });

    it('drops a queued sample when the stroke is cancelled before its frame', async () => {
      wrapper.vm.setTool('pen');
      const canvas = wrapper.find('.whiteboard-canvas.draw-layer');
      await canvas.trigger('pointerdown', {
        clientX: 20, clientY: 20, button: 0, pointerId: 14,
        pointerType: 'pen', isPrimary: true, buttons: 1, pressure: 0.4
      });
      await canvas.trigger('pointercancel', {
        clientX: 20, clientY: 20, pointerId: 14,
        pointerType: 'pen', isPrimary: true, buttons: 0, pressure: 0
      });
      await new Promise((resolve) => setTimeout(resolve, 25));
      expect(wrapper.vm.inputPaintSampleCount).toBe(0);
    });
  });
  describe('ArtifactPipeline overlay', () => {
    it('keeps progress hidden until import starts and exposes importArtifactFile', () => {
      expect(wrapper.find('[data-testid="artifact-progress"]').exists()).toBe(false);
      expect(typeof wrapper.vm.importArtifactFile).toBe('function');
      expect(typeof wrapper.vm.exportBoardAsPdf).toBe('function');
    });
  });

});
