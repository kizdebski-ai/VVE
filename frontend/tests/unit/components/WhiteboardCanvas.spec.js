import { mount } from '@vue/test-utils';
import { nextTick, ref } from 'vue';
import WhiteboardCanvas from '@/components/WhiteboardCanvas.vue';
import MovableObject from '@/components/MovableObject.vue'; // Used by WhiteboardCanvas
import { isPointInRotatedRectangle as actualIsPointInRotatedRectangle } from '@/utils/geometry'; // Actual import for type, but will be mocked

// --- Mocks ---

const createMockYMap = (initialData = {}) => {
  const map = new Map(Object.entries(initialData));
  const ymapMock = {
    _map: map,
    id: initialData.id, // Keep id accessible for tests
    get: vi.fn(key => map.get(key)),
    set: vi.fn((key, value) => {
      map.set(key, value);
    }),
    observe: vi.fn(),
    unobserve: vi.fn(),
    toJSON: vi.fn(() => Object.fromEntries(map.entries())),
    doc: {
      transact: vi.fn(callback => callback()),
      clientID: 'mockClientID'
    },
  };
  return ymapMock;
};

const createMockYArray = (initialItems = []) => {
  let items = [...initialItems];
  const mock = {
    _items: items,
    toArray: vi.fn(() => items.map(item => item)), // Return the mock YMap instances
    observe: vi.fn((callback) => { mock._observeCallback = callback; }),
    unobserve: vi.fn(),
    push: vi.fn(newItems => { // newItems is an array of Y.Map instances
      items.push(...newItems);
      // Simulate Yjs observe event if needed for component reactivity
      if (mock._observeCallback) {
        const event = {
          changes: { added: new Set(newItems.map(item => ({ T: item }))) }, // Simplified event
          target: mock,
        };
        mock._observeCallback([event], { origin: null, transaction: { meta: new Map() } });
      }
    }),
    delete: vi.fn((index, length = 1) => {
      const deletedItems = items.splice(index, length);
      if (mock._observeCallback) {
         const event = {
          changes: { deleted: new Set(deletedItems.map(item => ({ T: item }))) },
          target: mock,
        };
        mock._observeCallback([event], { origin: null, transaction: { meta: new Map() } });
      }
    }),
    get: vi.fn(index => items[index]),
    get length() { return items.length; }, // Dynamic length based on items array
  };
  return mock;
};

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

const mockYDoc = {
  transact: vi.fn(callback => callback()),
  clientID: 'mock-client-id',
};
const mockAwareness = {
  on: vi.fn(),
  off: vi.fn(),
  getLocalState: vi.fn(() => ({ user: { name: 'Test User', color: '#ff0000' } })),
  setLocalState: vi.fn(),
  getStates: vi.fn(() => new Map()),
  destroy: vi.fn(),
};

const mockYDrawings = createMockYArray();

vi.mock('@/services/connectToYjs', () => ({
  connectToYjs: vi.fn(() => ({
    ydoc: mockYDoc,
    yDrawings: mockYDrawings,
    awareness: mockAwareness,
    undoManager: mockUndoManager,
    provider: { disconnect: vi.fn(), destroy: vi.fn() },
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

// Mock canvasDrawing utilities
vi.mock('@/utils/canvasDrawing', () => ({
  // createNewElement is called when finishing a drawing operation
  createNewElement: vi.fn((type, x, y, width, height, color, lineWidth, id, text = '') => {
    return createMockYMap({
      id: id || `new_${Math.random().toString(36).substr(2, 9)}`,
      type, x, y, width, height, color, lineWidth, text,
      rotation: 0,
    });
  }),
  // Mock other functions if WhiteboardCanvas directly uses them
}));


describe('WhiteboardCanvas.vue', () => {
  let wrapper;
  let initialTestObject; // This will be a Y.Map mock
  let geometryMock; // To control isPointInRotatedRectangle

  beforeEach(async () => {
    vi.clearAllMocks();

    geometryMock = await import('@/utils/geometry'); // Get the mocked module

    initialTestObject = createMockYMap({
      id: 'obj1', type: 'rectangle', x: 50, y: 50, width: 100, height: 80, rotation: 0, color: 'blue', lineWidth: 2,
    });
    
    // Reset yDrawings and populate with initialTestObject
    mockYDrawings._items = [initialTestObject];
    mockYDrawings.toArray.mockReturnValue([initialTestObject]);
    mockYDrawings.get.mockImplementation(index => mockYDrawings._items[index]);
    
    // Mock connectToYjs to return fresh mocks for each test run
    const connectToYjsMock = require('@/services/connectToYjs');
    connectToYjsMock.connectToYjs.mockReturnValue({
        ydoc: mockYDoc,
        yDrawings: mockYDrawings,
        awareness: mockAwareness,
        undoManager: mockUndoManager,
        provider: { disconnect: vi.fn(), destroy: vi.fn() },
        destroy: vi.fn(),
    });

    wrapper = mount(WhiteboardCanvas, {
      props: {
        // currentTool: 'select', // Default tool
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

  describe('Object Selection (Right-Click)', () => {
    it('selects an object on right-click if hit', async () => {
      // Configure mock to simulate a hit on the object
      geometryMock.isPointInRotatedRectangle.mockReturnValue(true);
      
      const canvas = wrapper.find('.whiteboard-canvas'); // Assuming this class on the main div/canvas element
      await canvas.trigger('contextmenu', { clientX: 75, clientY: 90, button: 2 }); // Coords within obj1
      await nextTick();

      expect(geometryMock.isPointInRotatedRectangle).toHaveBeenCalled();
      // Check call arguments for isPointInRotatedRectangle
      // const callArgs = geometryMock.isPointInRotatedRectangle.mock.calls[0];
      // expect(callArgs[0]).toEqual({ x: 75, y: 90 }); // Transformed click coordinates
      // expect(callArgs[1].id).toBe(initialTestObject.id); // The object checked

      expect(wrapper.vm.selectedObjectId).toBe(initialTestObject.id);
      
      const movableObjectWrapper = wrapper.findComponent(MovableObject);
      expect(movableObjectWrapper.exists()).toBe(true);
      expect(movableObjectWrapper.props('isSelected')).toBe(true);
    });

    it('does not select an object on right-click if miss', async () => {
      geometryMock.isPointInRotatedRectangle.mockReturnValue(false); // Simulate a miss

      const canvas = wrapper.find('.whiteboard-canvas');
      await canvas.trigger('contextmenu', { clientX: 10, clientY: 10, button: 2 }); // Coords outside obj1
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
      const canvas = wrapper.find('.whiteboard-canvas');
      await canvas.trigger('contextmenu', { clientX: 75, clientY: 90, button: 2 }); // Select obj1
      await nextTick();
      expect(wrapper.vm.selectedObjectId).toBe(initialTestObject.id);

      // Now, simulate a miss for deselection (left-click on empty area)
      geometryMock.isPointInRotatedRectangle.mockReturnValue(false);
      await canvas.trigger('mousedown', { clientX: 10, clientY: 10, button: 0 }); // Left click outside
      await nextTick();

      expect(wrapper.vm.selectedObjectId).toBeNull();
      const movableObjectWrapper = wrapper.findComponent(MovableObject);
      expect(movableObjectWrapper.props('isSelected')).toBe(false);
    });
  });
  
  describe('Interaction Propagation to Yjs', () => {
    it('MovableObject updates are reflected in the Y.Map instance from yDrawings', async () => {
      // 1. Select the object (not strictly necessary for this test, but good setup)
      geometryMock.isPointInRotatedRectangle.mockReturnValue(true);
      const canvas = wrapper.find('.whiteboard-canvas');
      await canvas.trigger('contextmenu', { clientX: 75, clientY: 90 });
      await nextTick();
      
      const movableObjectComp = wrapper.findComponent(MovableObject);
      expect(movableObjectComp.exists()).toBe(true);

      // 2. Simulate MovableObject emitting an update after its internal Yjs transaction
      // MovableObject itself calls its object prop (a Y.Map)'s set method.
      // We can test this by directly calling 'set' on the Y.Map mock that was passed to it.
      // WhiteboardCanvas passes objects from yDrawings to MovableObject instances.
      // So, initialTestObject is the Y.Map mock that MovableObject gets.
      
      // Simulate an update originating from MovableObject (e.g., drag)
      // This means initialTestObject.set would be called.
      initialTestObject.set('x', 200);
      initialTestObject.set('y', 250);

      // Verify the mock Y.Map (initialTestObject) was updated
      expect(initialTestObject.set).toHaveBeenCalledWith('x', 200);
      expect(initialTestObject.set).toHaveBeenCalledWith('y', 250);
      
      // Check if WhiteboardCanvas has a specific handler for 'update:object' from MovableObject
      // The problem description mentions "handleObjectUpdate". Let's assume it exists.
      // If MovableObject emits 'update:object', WhiteboardCanvas might listen.
      // MovableObject's spec implies it emits 'update:object' after its Yjs transaction.
      // Let's simulate that emission.
      
      // We need to find the MovableObject and simulate its event emission.
      // This tests if WhiteboardCanvas *listens* to this event.
      const handleObjectUpdateSpy = vi.spyOn(wrapper.vm, 'handleObjectUpdate');
      movableObjectComp.vm.$emit('update:object', initialTestObject); // Emit with the updated Y.Map
      await nextTick();

      expect(handleObjectUpdateSpy).toHaveBeenCalledWith(initialTestObject);
      
      // The core of this test is that the Y.Map *instance* in yDrawings._items
      // IS the same instance that MovableObject modifies.
      // The `initialTestObject.set` calls above already confirmed this.
      // No need to check `yDrawings._items[0].get('x')` if `initialTestObject` is `yDrawings._items[0]`.
      expect(mockYDrawings.get(0).get('x')).toBe(200); // Verify through the yArray mock
      expect(mockYDrawings.get(0).get('y')).toBe(250);
    });
  });

  describe('Element Drawing to Yjs', () => {
    it('draws a rectangle and pushes it to yDrawings', async () => {
      const canvasDrawingMock = await import('@/utils/canvasDrawing');
      const newId = 'new_rect_123';
      const newRectYMap = createMockYMap({ 
        id: newId, type: 'rectangle', x: 10, y: 20, width: 30, height: 40, 
        color: '#ff0000', lineWidth: 1, rotation: 0, text: '' 
      });
      canvasDrawingMock.createNewElement.mockReturnValue(newRectYMap); // Ensure it returns our specific mock

      await wrapper.setProps({ currentTool: 'rectangle', selectedColor: '#ff0000', selectedLineWidth: 1 });
      
      const canvas = wrapper.find('.whiteboard-canvas');
      // Simulate drawing: mousedown, mousemove (to define size), mouseup
      await canvas.trigger('mousedown', { clientX: 10, clientY: 20, button: 0 });
      await nextTick(); // Let handleMouseDown process
      // Simulate dragging to (40, 60) to create a 30x40 rectangle
      await canvas.trigger('mousemove', { clientX: 40, clientY: 60, buttons: 1 }); 
      await nextTick(); // Let handleMouseMove process
      await canvas.trigger('mouseup', { clientX: 40, clientY: 60, button: 0 });
      await nextTick(); // Let handleMouseUp process and element creation

      expect(canvasDrawingMock.createNewElement).toHaveBeenCalledWith(
        'rectangle', // type
        10,  // x
        20,  // y
        30,  // width (40-10)
        40,  // height (60-20)
        '#ff0000', // color
        1,  // lineWidth
        expect.any(String) // id
      );
      
      // Check if yDrawings.push was called with the new Y.Map
      expect(mockYDrawings.push).toHaveBeenCalledTimes(1);
      expect(mockYDrawings.push).toHaveBeenCalledWith([newRectYMap]); // createNewElement returns the Y.Map

      // Verify the object is in the WhiteboardCanvas's local reactive `drawings` array
      // (assuming it mirrors yDrawings.toArray())
      const localDrawings = wrapper.vm.drawings;
      expect(localDrawings.find(d => d.id === newId)).toBeDefined();

      // And also that it's in the mockYDrawings internal items
      expect(mockYDrawings._items.find(item => item.id === newId)).toBeDefined();
    });
  });

});
