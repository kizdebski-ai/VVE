import { shallowMount } from '@vue/test-utils';
import { nextTick } from 'vue';
import MovableObject from '@/components/MovableObject.vue';

// Mock Y.Map
const createMockYMap = (initialData = {}) => {
  const map = new Map(Object.entries(initialData));
  return {
    _map: map,
    get: vi.fn(key => map.get(key)),
    set: vi.fn((key, value) => {
      map.set(key, value);
    }),
    observe: vi.fn(),
    unobserve: vi.fn(),
    doc: {
      transact: vi.fn((callback) => callback())
    }
  };
};

describe('MovableObject.vue', () => {
  let mockObject;
  let defaultProps;
  let wrapper;

  const initialObjectData = {
    id: 'obj1',
    type: 'rectangle',
    x: 100,
    y: 150,
    width: 200,
    height: 100,
    rotation: 0, // Initial rotation in degrees
    color: 'blue',
    text: 'Hello'
  };

  const createComponent = (props) => {
    return shallowMount(MovableObject, {
      propsData: props,
      global: {
        stubs: {
          // Stub any child components if necessary
        }
      }
    });
  };

  beforeEach(() => {
    mockObject = createMockYMap({ ...initialObjectData });
    defaultProps = {
      object: mockObject,
      isSelected: false,
      zoomLevel: 1,
      panOffset: { x: 0, y: 0 },
    };
  });

  afterEach(() => {
    if (wrapper) {
      wrapper.unmount();
    }
    vi.clearAllMocks();
    // Clean up global event listeners added by the component during interactions
    const vm = wrapper?.vm;
    if (vm) {
        // Assuming these are the names of the handlers stored on the Vue instance
        document.removeEventListener('mousemove', vm.handleDragMove);
        document.removeEventListener('mouseup', vm.handleDragEnd);
        document.removeEventListener('mousemove', vm.handleResize);
        document.removeEventListener('mouseup', vm.handleResizeEnd);
        document.removeEventListener('mousemove', vm.handleRotate);
        document.removeEventListener('mouseup', vm.handleRotateEnd);
    }
  });

  describe('Rendering based on isSelected', () => {
    it('should have "is-selected" class and handles when isSelected is true', async () => {
      wrapper = createComponent({ ...defaultProps, isSelected: true });
      await nextTick();
      expect(wrapper.classes()).toContain('is-selected');
      expect(wrapper.find('.rotation-handle').exists()).toBe(true);
      expect(wrapper.findAll('.resize-handle').length).toBeGreaterThan(0);
    });

    it('should not have "is-selected" class or handles when isSelected is false', async () => {
      wrapper = createComponent({ ...defaultProps, isSelected: false });
      await nextTick();
      expect(wrapper.classes()).not.toContain('is-selected');
      expect(wrapper.find('.rotation-handle').exists()).toBe(false);
      expect(wrapper.findAll('.resize-handle').length).toBe(0);
    });
  });

  describe('Selection Request', () => {
    it('emits "request-select" with object id on mousedown on .object-content when not selected', async () => {
      wrapper = createComponent({ ...defaultProps, isSelected: false });
      const contentArea = wrapper.find('.object-content');
      await contentArea.trigger('mousedown');
      expect(wrapper.emitted('request-select')).toBeTruthy();
      expect(wrapper.emitted('request-select')[0]).toEqual([initialObjectData.id]);
    });

    it('does not emit "request-select" on mousedown on .object-content when already selected', async () => {
      wrapper = createComponent({ ...defaultProps, isSelected: true });
      const contentArea = wrapper.find('.object-content');
      await contentArea.trigger('mousedown');
      expect(wrapper.emitted('request-select')).toBeFalsy();
    });
  });

  describe('Drag (Move) Functionality', () => {
    it('updates object position on drag and emits update:object', async () => {
      wrapper = createComponent({ ...defaultProps, isSelected: true });
      const contentArea = wrapper.find('.object-content');
      const startX = 50;
      const startY = 60;
      const deltaX = 20;
      const deltaY = 30;

      await contentArea.trigger('mousedown', { clientX: startX, clientY: startY, button: 0 });
      const mousemoveEvent = new MouseEvent('mousemove', { clientX: startX + deltaX, clientY: startY + deltaY, buttons: 1 });
      document.dispatchEvent(mousemoveEvent);
      await nextTick();

      expect(mockObject.doc.transact).toHaveBeenCalled();
      expect(mockObject.set).toHaveBeenCalledWith('x', initialObjectData.x + deltaX);
      expect(mockObject.set).toHaveBeenCalledWith('y', initialObjectData.y + deltaY);
      expect(wrapper.emitted('update:object')).toBeTruthy();

      const mouseupEvent = new MouseEvent('mouseup', { button: 0 });
      document.dispatchEvent(mouseupEvent);
      await nextTick();
    });

    it('updates object position correctly with zoom', async () => {
      const zoomLevel = 2;
      wrapper = createComponent({ ...defaultProps, isSelected: true, zoomLevel, panOffset: {x: 0, y: 0} });
      const contentArea = wrapper.find('.object-content');
      const startScreenX = 50;
      const startScreenY = 60;
      const deltaScreenX = 40;
      const deltaScreenY = 60;

      await contentArea.trigger('mousedown', { clientX: startScreenX, clientY: startScreenY, button: 0 });
      const mousemoveEvent = new MouseEvent('mousemove', { clientX: startScreenX + deltaScreenX, clientY: startScreenY + deltaScreenY, buttons: 1 });
      document.dispatchEvent(mousemoveEvent);
      await nextTick();

      const deltaWorldX = deltaScreenX / zoomLevel;
      const deltaWorldY = deltaScreenY / zoomLevel;

      expect(mockObject.doc.transact).toHaveBeenCalled();
      expect(mockObject.set).toHaveBeenCalledWith('x', initialObjectData.x + deltaWorldX);
      expect(mockObject.set).toHaveBeenCalledWith('y', initialObjectData.y + deltaWorldY);
      expect(wrapper.emitted('update:object')).toBeTruthy();

      const mouseupEvent = new MouseEvent('mouseup', { button: 0 });
      document.dispatchEvent(mouseupEvent);
      await nextTick();
    });
  });

  describe('Resize Functionality (south-east handle)', () => {
    it('updates object dimensions on resize (se handle) and emits update:object', async () => {
      wrapper = createComponent({ ...defaultProps, isSelected: true });
      const seHandle = wrapper.find('.resize-handle.se'); // Assumes specific class for SE handle
      if (!seHandle.exists()) {
        console.warn("SE resize handle (.resize-handle.se) not found. This test may not be accurate.");
        // Fallback or skip if handle is critical
        const genericHandle = wrapper.find('.resize-handle');
        if(!genericHandle.exists())  throw new Error("No resize handle found");
         // This test will run on a generic handle if SE is not found.
      }
      const targetHandle = seHandle.exists() ? seHandle : wrapper.find('.resize-handle');

      const startX = 300; 
      const startY = 250; 
      const deltaX = 20;
      const deltaY = 15;

      await targetHandle.trigger('mousedown', { clientX: startX, clientY: startY, button: 0 });
      const mousemoveEvent = new MouseEvent('mousemove', { clientX: startX + deltaX, clientY: startY + deltaY, buttons: 1 });
      document.dispatchEvent(mousemoveEvent);
      await nextTick();

      expect(mockObject.doc.transact).toHaveBeenCalled();
      expect(mockObject.set).toHaveBeenCalledWith('width', initialObjectData.width + deltaX);
      expect(mockObject.set).toHaveBeenCalledWith('height', initialObjectData.height + deltaY);
      expect(wrapper.emitted('update:object')).toBeTruthy();

      const mouseupEvent = new MouseEvent('mouseup', { button: 0 });
      document.dispatchEvent(mouseupEvent);
      await nextTick();
    });

    it('updates object dimensions correctly with zoom (se handle)', async () => {
      const zoomLevel = 2;
      wrapper = createComponent({ ...defaultProps, isSelected: true, zoomLevel });
      const seHandle = wrapper.find('.resize-handle.se');
       if (!seHandle.exists()) {
         console.warn("SE resize handle (.resize-handle.se) not found for zoom test. This test may not be accurate.");
         const genericHandle = wrapper.find('.resize-handle');
         if(!genericHandle.exists())  throw new Error("No resize handle found for zoom test");
      }
      const targetHandle = seHandle.exists() ? seHandle : wrapper.find('.resize-handle');


      const startScreenX = 300; 
      const startScreenY = 250;
      const deltaScreenX = 40;
      const deltaScreenY = 30;

      await targetHandle.trigger('mousedown', { clientX: startScreenX, clientY: startScreenY, button: 0 });
      const mousemoveEvent = new MouseEvent('mousemove', { clientX: startScreenX + deltaScreenX, clientY: startScreenY + deltaScreenY, buttons: 1 });
      document.dispatchEvent(mousemoveEvent);
      await nextTick();

      const deltaWorldX = deltaScreenX / zoomLevel;
      const deltaWorldY = deltaScreenY / zoomLevel;

      expect(mockObject.doc.transact).toHaveBeenCalled();
      expect(mockObject.set).toHaveBeenCalledWith('width', initialObjectData.width + deltaWorldX);
      expect(mockObject.set).toHaveBeenCalledWith('height', initialObjectData.height + deltaWorldY);
      expect(wrapper.emitted('update:object')).toBeTruthy();

      const mouseupEvent = new MouseEvent('mouseup', { button: 0 });
      document.dispatchEvent(mouseupEvent);
      await nextTick();
    });
  });

  describe('Rotation Functionality', () => {
    it('updates object rotation on drag of rotation handle and emits update:object', async () => {
      const zoomLevel = 1;
      const panOffset = { x: 0, y: 0 };
      wrapper = createComponent({ ...defaultProps, isSelected: true, zoomLevel, panOffset });
      const rotationHandle = wrapper.find('.rotation-handle');
      expect(rotationHandle.exists()).toBe(true); // Ensure handle is there

      // Object center in world coordinates
      const objectCenterX = initialObjectData.x + initialObjectData.width / 2;
      const objectCenterY = initialObjectData.y + initialObjectData.height / 2;

      // Screen coordinates of the object center
      const objectCenterScreenX = objectCenterX * zoomLevel - panOffset.x;
      const objectCenterScreenY = objectCenterY * zoomLevel - panOffset.y;
      
      // Simulate mousedown somewhere relative to the object to start rotation
      // For simplicity, let's assume mousedown is directly above the center (initial angle -90 deg or 270 deg)
      const startMouseScreenX = objectCenterScreenX;
      const startMouseScreenY = objectCenterScreenY - 50; // Some distance above the center

      await rotationHandle.trigger('mousedown', { clientX: startMouseScreenX, clientY: startMouseScreenY, button: 0 });
      
      // Simulate mousemove to a new position, e.g., to the right of the center (angle 0 deg)
      const endMouseScreenX = objectCenterScreenX + 50;
      const endMouseScreenY = objectCenterScreenY;

      const mousemoveEvent = new MouseEvent('mousemove', { clientX: endMouseScreenX, clientY: endMouseScreenY, buttons: 1 });
      document.dispatchEvent(mousemoveEvent);
      await nextTick();

      // Calculate expected angle based on (endMouseScreenX, endMouseScreenY) relative to objectCenterScreen
      // The component's internal logic for angle calculation needs to be matched here.
      // Typically: Math.atan2(mouseY - centerY, mouseX - centerX) * (180 / Math.PI)
      // The component might adjust this (e.g. add 90 degrees, or handle coordinate system)
      const deltaY = endMouseScreenY - objectCenterScreenY;
      const deltaX = endMouseScreenX - objectCenterScreenX;
      let expectedAngle = Math.atan2(deltaY, deltaX) * (180 / Math.PI);
      // The component might have a specific way of calculating/normalizing this angle.
      // For example, if it adds an offset or if the initial rotation handle position matters.
      // This calculation assumes the angle is measured from the positive X-axis.
      // If the component's `handleRotate` method uses a different reference, this needs adjustment.
      // We are testing that SOME angle is set. The exact value depends on internal comp logic.
      // Let's assume the component calculates this angle and sets it.

      expect(mockObject.doc.transact).toHaveBeenCalled();
      // We expect 'rotation' to be called. The exact value might be tricky to assert without knowing
      // the component's precise rotation calculation logic (e.g. initial angle of handle, offsets).
      // For this test, we'll check it's called with a number.
      expect(mockObject.set).toHaveBeenCalledWith('rotation', expect.any(Number));
      
      // More precise check if we know the component's strategy:
      // For mouse at (center+50, center), angle is 0 degrees.
      // If the component's initial handle position implies an offset, that would be added/subtracted.
      // For now, let's assume the computed angle based on mouse vector from center is what's set.
      // If initialObjectData.rotation was non-zero, that would also factor in.
      // The `MovableObject` might calculate deltaRotation from start of drag.
      // For simplicity, this test assumes it sets the absolute calculated angle.
      // A common implementation sets the angle directly based on the vector from center to mouse.
      // For (objectCenterScreenX + 50, objectCenterScreenY) relative to (objectCenterScreenX, objectCenterScreenY)
      // angle is indeed 0 degrees.

      // Let's refine the expected angle to be close to 0 for this specific mouse move.
      // The arguments to transact and set are: (key, value, ...other Yjs args)
      const rotationCall = mockObject.set.mock.calls.find(call => call[0] === 'rotation');
      expect(rotationCall).toBeDefined();
      if (rotationCall) {
         expect(rotationCall[1]).toBeCloseTo(0); // Angle should be close to 0 degrees for this mouse position
      }

      expect(wrapper.emitted('update:object')).toBeTruthy();

      const mouseupEvent = new MouseEvent('mouseup', { button: 0 });
      document.dispatchEvent(mouseupEvent);
      await nextTick();
    });
  });
});
