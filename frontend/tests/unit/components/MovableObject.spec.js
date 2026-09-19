import { shallowMount } from '@vue/test-utils';
import { nextTick } from 'vue';
import MovableObject from '@/components/MovableObject.vue';

// The component consumes Pointer Events and emits one canonical transform
// intent on pointer-up. It never mutates the shared document itself.
const dispatchPointer = (target, type, coords) => {
  const event = new PointerEvent(type, { bubbles: true, cancelable: true, ...coords });
  target.dispatchEvent(event);
  return event;
};

// Mock Y.Map
const createMockYMap = (initialData = {}) => {
  const map = new Map(Object.entries(initialData));
  return {
    _map: map,
    get: vi.fn(key => map.get(key)),
    set: vi.fn((key, value) => {
      map.set(key, value);
    }),
    toJSON: vi.fn(() => Object.fromEntries(map.entries())),
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
    it('emits "request-select" with object id on pointerdown on .object-content when not selected', async () => {
      wrapper = createComponent({ ...defaultProps, isSelected: false });
      const contentArea = wrapper.find('.object-content');
      await contentArea.trigger('pointerdown', { clientX: 10, clientY: 10, button: 0 });
      expect(wrapper.emitted('request-select')).toBeTruthy();
      expect(wrapper.emitted('request-select')[0]).toEqual([initialObjectData.id]);
    });

    it('does not emit "request-select" on pointerdown on .object-content when already selected', async () => {
      wrapper = createComponent({ ...defaultProps, isSelected: true });
      const contentArea = wrapper.find('.object-content');
      await contentArea.trigger('pointerdown', { clientX: 10, clientY: 10, button: 0 });
      expect(wrapper.emitted('request-select')).toBeFalsy();
    });
  });

  describe('Drag (Move) Functionality', () => {
    it('previews a drag and emits one move intent on pointerup', async () => {
      wrapper = createComponent({ ...defaultProps, isSelected: true });
      const contentArea = wrapper.find('.object-content');
      const startX = 50;
      const startY = 60;
      const deltaX = 20;
      const deltaY = 30;

      await contentArea.trigger('pointerdown', { clientX: startX, clientY: startY, button: 0 });
      dispatchPointer(document, 'pointermove', { clientX: startX + deltaX, clientY: startY + deltaY, buttons: 1 });
      await nextTick();

      // Local move feedback is emitted immediately...
      expect(wrapper.emitted('update:object')).toBeTruthy();

      // ...and the session command is emitted once the drag ends.
      dispatchPointer(document, 'pointerup', { button: 0 });
      await nextTick();

      expect(wrapper.emitted('commit-transform')).toEqual([[{
        kind: 'move',
        id: initialObjectData.id,
        x: initialObjectData.x + deltaX,
        y: initialObjectData.y + deltaY,
      }]]);
      expect(mockObject.doc.transact).not.toHaveBeenCalled();
      expect(mockObject.set).not.toHaveBeenCalled();
    });

    it('updates object position correctly with zoom', async () => {
      const zoomLevel = 2;
      wrapper = createComponent({ ...defaultProps, isSelected: true, zoomLevel, panOffset: {x: 0, y: 0} });
      const contentArea = wrapper.find('.object-content');
      const startScreenX = 50;
      const startScreenY = 60;
      const deltaScreenX = 40;
      const deltaScreenY = 60;

      await contentArea.trigger('pointerdown', { clientX: startScreenX, clientY: startScreenY, button: 0 });
      dispatchPointer(document, 'pointermove', { clientX: startScreenX + deltaScreenX, clientY: startScreenY + deltaScreenY, buttons: 1 });
      await nextTick();

      dispatchPointer(document, 'pointerup', { button: 0 });
      await nextTick();

      const deltaWorldX = deltaScreenX / zoomLevel;
      const deltaWorldY = deltaScreenY / zoomLevel;

      expect(wrapper.emitted('commit-transform')).toEqual([[{
        kind: 'move',
        id: initialObjectData.id,
        x: initialObjectData.x + deltaWorldX,
        y: initialObjectData.y + deltaWorldY,
      }]]);
      expect(mockObject.doc.transact).not.toHaveBeenCalled();
      expect(mockObject.set).not.toHaveBeenCalled();
      expect(wrapper.emitted('update:object')).toBeTruthy();
    });
  });

  describe('Resize Functionality (south-east handle)', () => {
    it('updates object dimensions on resize (se handle) and commits on pointerup', async () => {
      wrapper = createComponent({ ...defaultProps, isSelected: true });
      const targetHandle = wrapper.find('.resize-handle.se-handle');
      if (!targetHandle.exists()) throw new Error('SE resize handle (.resize-handle.se-handle) not found');

      const startX = 300;
      const startY = 250;
      const deltaX = 20;
      const deltaY = 15;

      await targetHandle.trigger('pointerdown', { clientX: startX, clientY: startY, button: 0 });
      dispatchPointer(document, 'pointermove', { clientX: startX + deltaX, clientY: startY + deltaY, buttons: 1 });
      await nextTick();
      dispatchPointer(document, 'pointerup', { button: 0 });
      await nextTick();

      expect(wrapper.emitted('commit-transform')).toEqual([[expect.objectContaining({
        kind: 'resize',
        id: initialObjectData.id,
        width: initialObjectData.width + deltaX,
        height: initialObjectData.height + deltaY,
      })]]);
      expect(mockObject.doc.transact).not.toHaveBeenCalled();
      expect(mockObject.set).not.toHaveBeenCalled();
      expect(wrapper.emitted('update:object')).toBeTruthy();
    });

    it('updates object dimensions correctly with zoom (se handle)', async () => {
      const zoomLevel = 2;
      wrapper = createComponent({ ...defaultProps, isSelected: true, zoomLevel });
      const targetHandle = wrapper.find('.resize-handle.se-handle');
      if (!targetHandle.exists()) throw new Error('SE resize handle (.resize-handle.se-handle) not found for zoom test');

      const startScreenX = 300;
      const startScreenY = 250;
      const deltaScreenX = 40;
      const deltaScreenY = 30;

      await targetHandle.trigger('pointerdown', { clientX: startScreenX, clientY: startScreenY, button: 0 });
      dispatchPointer(document, 'pointermove', { clientX: startScreenX + deltaScreenX, clientY: startScreenY + deltaScreenY, buttons: 1 });
      await nextTick();
      dispatchPointer(document, 'pointerup', { button: 0 });
      await nextTick();

      const deltaWorldX = deltaScreenX / zoomLevel;
      const deltaWorldY = deltaScreenY / zoomLevel;

      expect(wrapper.emitted('commit-transform')).toEqual([[expect.objectContaining({
        kind: 'resize',
        id: initialObjectData.id,
        width: initialObjectData.width + deltaWorldX,
        height: initialObjectData.height + deltaWorldY,
      })]]);
      expect(mockObject.doc.transact).not.toHaveBeenCalled();
      expect(mockObject.set).not.toHaveBeenCalled();
      expect(wrapper.emitted('update:object')).toBeTruthy();
    });
  });

  describe('Rotation Functionality', () => {
    it('updates object rotation on drag of rotation handle and commits on pointerup', async () => {
      const zoomLevel = 1;
      const panOffset = { x: 0, y: 0 };
      wrapper = createComponent({ ...defaultProps, isSelected: true, zoomLevel, panOffset });
      const rotationHandle = wrapper.find('.rotation-handle');
      expect(rotationHandle.exists()).toBe(true); // Ensure handle is there

      // Object center in screen coordinates
      const objectCenterScreenX = (initialObjectData.x + initialObjectData.width / 2) * zoomLevel - panOffset.x;
      const objectCenterScreenY = (initialObjectData.y + initialObjectData.height / 2) * zoomLevel - panOffset.y;

      // Start dragging directly above the center (-90deg), rotate to the right of the center (0deg):
      // the committed rotation delta is +90 degrees.
      const startMouseScreenX = objectCenterScreenX;
      const startMouseScreenY = objectCenterScreenY - 50;
      const endMouseScreenX = objectCenterScreenX + 50;
      const endMouseScreenY = objectCenterScreenY;

      await rotationHandle.trigger('pointerdown', { clientX: startMouseScreenX, clientY: startMouseScreenY, button: 0 });
      dispatchPointer(document, 'pointermove', { clientX: endMouseScreenX, clientY: endMouseScreenY, buttons: 1 });
      await nextTick();
      dispatchPointer(document, 'pointerup', { button: 0 });
      await nextTick();

      const rotation = wrapper.emitted('commit-transform')?.[0]?.[0];
      expect(rotation).toMatchObject({ kind: 'rotate', id: initialObjectData.id });
      expect(rotation.rotation).toBeCloseTo(90, 0);
      expect(mockObject.doc.transact).not.toHaveBeenCalled();
      expect(mockObject.set).not.toHaveBeenCalled();
      expect(wrapper.emitted('update:object')).toBeTruthy();
    });

    it('keeps the opposite world edge fixed when resizing a rotated object', async () => {
      mockObject = createMockYMap({ ...initialObjectData, rotation: 90 });
      wrapper = createComponent({ ...defaultProps, object: mockObject, isSelected: true });
      const targetHandle = wrapper.find('.resize-handle.w-handle');

      await targetHandle.trigger('pointerdown', { clientX: 300, clientY: 250, button: 0 });
      // At 90 degrees, moving the west handle down by 20px shrinks local
      // width by 20px. The east edge must remain at its original world point.
      dispatchPointer(document, 'pointermove', { clientX: 300, clientY: 270, buttons: 1 });
      await nextTick();
      dispatchPointer(document, 'pointerup', { button: 0 });
      await nextTick();

      expect(wrapper.emitted('commit-transform')).toEqual([[expect.objectContaining({
        kind: 'resize',
        id: initialObjectData.id,
        x: 110,
        y: 160,
        width: 180,
        height: 100,
      })]]);
    });
  });

  describe('Gesture cancellation and pointer identity', () => {
    const dragSetup = async () => {
      wrapper = createComponent({ ...defaultProps, isSelected: true });
      const contentArea = wrapper.find('.object-content');
      await contentArea.trigger('pointerdown', {
        clientX: 50, clientY: 60, button: 0, pointerId: 5, pointerType: 'touch', isPrimary: true, buttons: 1
      });
      dispatchPointer(document, 'pointermove', { clientX: 70, clientY: 90, buttons: 1, pointerId: 5 });
      await nextTick();
      return contentArea;
    };

    it('moves a touch-type pointer drag and commits one move intent on pointerup', async () => {
      await dragSetup();
      dispatchPointer(document, 'pointerup', { button: 0, pointerId: 5 });
      await nextTick();

      expect(wrapper.emitted('commit-transform')).toEqual([[{
        kind: 'move',
        id: initialObjectData.id,
        x: initialObjectData.x + 20,
        y: initialObjectData.y + 30,
      }]]);
    });

    it('pointercancel ends the drag without committing a transform and detaches listeners', async () => {
      const contentArea = await dragSetup();
      const updatesBeforeCancel = (wrapper.emitted('update:object') || []).length;

      dispatchPointer(document, 'pointercancel', { pointerId: 5 });
      await nextTick();

      // No transform command and no partial state: the preview reset restores
      // the original position from the document.
      expect(wrapper.emitted('commit-transform')).toBeFalsy();
      expect(wrapper.emitted('interaction-end')).toEqual([[initialObjectData.id]]);
      const restoration = wrapper.emitted('update:object')[wrapper.emitted('update:object').length - 1][0];
      expect(restoration).toMatchObject({ x: initialObjectData.x, y: initialObjectData.y });

      // Listeners are cleaned up: later moves for the same gesture are inert.
      dispatchPointer(document, 'pointermove', { clientX: 200, clientY: 260, buttons: 1, pointerId: 5 });
      await nextTick();
      expect(wrapper.emitted('commit-transform')).toBeFalsy();
      expect((wrapper.emitted('update:object') || []).length).toBe(updatesBeforeCancel + 1);
    });

    it('window blur cancels an in-progress drag without committing', async () => {
      await dragSetup();

      window.dispatchEvent(new Event('blur'));
      await nextTick();

      expect(wrapper.emitted('commit-transform')).toBeFalsy();
      expect(wrapper.emitted('interaction-end')).toEqual([[initialObjectData.id]]);

      dispatchPointer(document, 'pointerup', { button: 0, pointerId: 5 });
      await nextTick();
      expect(wrapper.emitted('commit-transform')).toBeFalsy();
    });

    it('pointercancel during a resize gesture does not emit a resize commit', async () => {
      wrapper = createComponent({ ...defaultProps, isSelected: true });
      const handle = wrapper.findAll('.resize-handle').at(-1);
      await handle.trigger('pointerdown', {
        clientX: 300, clientY: 250, button: 0, pointerId: 9, pointerType: 'pen', isPrimary: true, buttons: 1
      });
      dispatchPointer(document, 'pointermove', { clientX: 340, clientY: 290, buttons: 1, pointerId: 9 });
      await nextTick();

      dispatchPointer(document, 'pointercancel', { pointerId: 9 });
      await nextTick();

      expect(wrapper.emitted('commit-transform')).toBeFalsy();
      expect(wrapper.emitted('interaction-end')).toEqual([[initialObjectData.id]]);
    });
  });
});
