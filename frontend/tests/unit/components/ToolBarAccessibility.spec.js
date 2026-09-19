import { nextTick } from 'vue';
import { describe, expect, it, vi } from 'vitest';
import { mount } from '@vue/test-utils';

import ToolBar from '@/components/ToolBar.vue';
import ZoomPanControls from '@/components/ZoomPanControls.vue';

describe('Pilot drawing controls accessibility', () => {
  it('keeps focused properties available and reopens them by selecting the same tool', async () => {
    vi.useFakeTimers();
    const wrapper = mount(ToolBar, {
      props: { activeTool: 'pen', role: 'developer', orientation: 'vertical' },
      attachTo: document.body
    });
    const outside = document.createElement('button');
    document.body.append(outside);
    try {
      await wrapper.get('[data-tool-id="tool.pen"]').trigger('click');
      wrapper.get('input[aria-label="Grubość linii"]').element.focus();
      await wrapper.get('.properties-bar').trigger('pointerleave');
      await vi.advanceTimersByTimeAsync(2_100);
      expect(wrapper.find('.properties-bar').exists()).toBe(true);
      outside.focus();
      await vi.advanceTimersByTimeAsync(2_100);
      expect(wrapper.find('.properties-bar').exists()).toBe(false);
      await wrapper.get('[data-tool-id="tool.pen"]').trigger('click');
      expect(wrapper.find('.properties-bar').exists()).toBe(true);
    } finally {
      wrapper.unmount();
      outside.remove();
      vi.useRealTimers();
    }
  });

  it('keeps shape style and palette choices labelled and touch-sized', async () => {
    const wrapper = mount(ToolBar, {
      props: {
        activeTool: 'shapes',
        role: 'developer',
        orientation: 'vertical'
      },
      attachTo: document.body
    });

    await wrapper.get('[data-tool-id="tool.shapes"]').trigger('click');
    await nextTick();

    const menu = document.body.querySelector('.shapes-popover');
    expect(menu).toBeTruthy();

    const optionButtons = [...menu.querySelectorAll('.option-pill')];
    expect(optionButtons.length).toBeGreaterThan(0);
    expect(optionButtons.every((button) => button.type === 'button')).toBe(true);
    expect(optionButtons.every((button) => button.getAttribute('aria-pressed'))).toBe(true);
    expect(optionButtons.every((button) => button.classList.contains('option-pill'))).toBe(true);

    const swatches = [...menu.querySelectorAll('.color-swatch')];
    expect(swatches.length).toBeGreaterThan(0);
    expect(swatches.every((button) => button.type === 'button')).toBe(true);
    expect(swatches.every((button) => button.getAttribute('aria-label'))).toBe(true);
    expect(swatches.every((button) => button.classList.contains('color-swatch'))).toBe(true);
    expect(swatches.every((button) => button.querySelector('.color-swatch-dot'))).toBe(true);

    wrapper.unmount();
  });

  it('labels contextual color and width controls', async () => {
    const wrapper = mount(ToolBar, {
      props: {
        activeTool: 'pen',
        role: 'developer',
        orientation: 'vertical'
      }
    });

    await wrapper.get('.toolbar').trigger('pointerenter');
    await nextTick();

    const colorPreview = wrapper.get('.color-preview');
    expect(colorPreview.attributes('type')).toBe('button');
    expect(colorPreview.attributes('aria-label')).toContain('Wybierz kolor linii');
    expect(wrapper.get('.hidden-color-input').attributes('aria-label')).toBe('Kolor linii');

    const quickSwatches = wrapper.findAll('.quick-swatch');
    expect(quickSwatches).toHaveLength(8);
    expect(quickSwatches.every((button) => button.attributes('aria-label'))).toBe(true);
    expect(quickSwatches.every((button) => button.attributes('type') === 'button')).toBe(true);
    expect(quickSwatches.every((button) => button.find('.quick-swatch-dot').exists())).toBe(true);

    const lineWidth = wrapper.get('input[aria-label="Grubość linii"]');
    expect(lineWidth.attributes('type')).toBe('range');

    await wrapper.setProps({ activeTool: 'eraser' });
    await nextTick();
    expect(wrapper.get('input[aria-label="Rozmiar gumki"]')).toBeTruthy();

    wrapper.unmount();
  });

  it('gives zoom controls Polish names and button semantics', () => {
    const wrapper = mount(ZoomPanControls);
    const buttons = wrapper.findAll('button');

    expect(buttons.map((button) => button.attributes('aria-label'))).toEqual([
      'Pomniejsz',
      'Powiększ',
      'Resetuj widok'
    ]);
    expect(buttons.every((button) => button.attributes('type') === 'button')).toBe(true);
    expect(buttons.every((button) => button.classes().includes('zoom-btn'))).toBe(true);
  });
});
