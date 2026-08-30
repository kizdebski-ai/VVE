import { mount } from '@vue/test-utils';
import { nextTick } from 'vue';

import Calculator from '@/components/Calculator.vue';
import DraggablePanel from '@/components/DraggablePanel.vue';
import MathGraphPanel from '@/components/MathGraphPanel.vue';
import PhysicsGraphPanel from '@/components/PhysicsGraphPanel.vue';

describe('VVE-106 lesson tool panels', () => {
  it('emits only a validated canonical mathematical graph', async () => {
    const wrapper = mount(MathGraphPanel);

    await wrapper.get('#math-min-x').setValue('10');
    await wrapper.get('#math-max-x').setValue('-10');
    await wrapper.get('form').trigger('submit');
    expect(wrapper.get('[role="alert"]').text()).toContain('mniejszy');
    expect(wrapper.emitted('plot-function')).toBeUndefined();

    await wrapper.get('#math-expression').setValue('sin(x)');
    await wrapper.get('#math-min-x').setValue('-8');
    await wrapper.get('#math-max-x').setValue('8');
    await wrapper.get('form').trigger('submit');

    const object = wrapper.emitted('plot-function')[0][0];
    expect(object).toEqual({
      type: 'mathFunctionPlot',
      expression: 'sin(x)',
      color: '#2563eb',
      xRange: [-8, 8],
      width: 400,
      height: 300,
      lineWidth: 3
    });
    expect(object).not.toHaveProperty('position');
    wrapper.unmount();
  });

  it('reports the invalid physical-data row and emits canonical points with axis labels', async () => {
    const wrapper = mount(PhysicsGraphPanel);

    await wrapper.get('#physics-data').setValue('0,0\nniepoprawny');
    await wrapper.get('form').trigger('submit');
    expect(wrapper.get('[role="alert"]').text()).toContain('Wiersz 2');
    expect(wrapper.emitted('plot-data')).toBeUndefined();

    await wrapper.get('#physics-data').setValue('0,0\n1,9.8\n2,19.6');
    await wrapper.get('#physics-x-label').setValue('czas');
    await wrapper.get('#physics-y-label').setValue('prędkość');
    await wrapper.get('form').trigger('submit');

    const object = wrapper.emitted('plot-data')[0][0];
    expect(object).toMatchObject({
      type: 'physicsDataPlot',
      points: [{ x: 0, y: 0 }, { x: 1, y: 9.8 }, { x: 2, y: 19.6 }],
      xLabel: 'czas',
      yLabel: 'prędkość',
      width: 400,
      height: 300
    });
    expect(object).not.toHaveProperty('xData');
    expect(object).not.toHaveProperty('yData');
    expect(object).not.toHaveProperty('position');
    wrapper.unmount();
  });

  it('calculates from buttons, reports Polish errors, and supports Escape close', async () => {
    const wrapper = mount(Calculator, { props: { showClose: false } });

    await wrapper.get('.two').trigger('click');
    await wrapper.get('.add').trigger('click');
    await wrapper.get('.three').trigger('click');
    await wrapper.get('.btn-equal').trigger('click');
    expect(wrapper.get('.result').text()).toBe('5');
    expect(wrapper.get('.copy-result').text()).toContain('Kopiuj wynik');

    await wrapper.get('.ac').trigger('click');
    await wrapper.get('.divide').trigger('click');
    await wrapper.get('.btn-equal').trigger('click');
    expect(wrapper.get('.result').text()).toContain('Błąd');

    await wrapper.get('.calculator').trigger('keydown', { key: 'Escape' });
    expect(wrapper.emitted('close')).toHaveLength(1);
    wrapper.unmount();
  });

  it('clamps a newly opened and dragged panel inside the viewport', async () => {
    const widthDescriptor = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetWidth');
    const heightDescriptor = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetHeight');
    Object.defineProperty(HTMLElement.prototype, 'offsetWidth', { configurable: true, get: () => 320 });
    Object.defineProperty(HTMLElement.prototype, 'offsetHeight', { configurable: true, get: () => 240 });
    const previousWidth = window.innerWidth;
    const previousHeight = window.innerHeight;
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 768 });
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 1024 });
    const host = document.createElement('div');
    document.body.appendChild(host);

    try {
      const wrapper = mount(DraggablePanel, {
        props: { initialX: 2_000, initialY: 2_000, width: '380px', ariaLabel: 'Test' },
        slots: { default: '<button>Akcja</button>' },
        attachTo: host
      });
      await nextTick();
      await nextTick();
      expect(parseFloat(wrapper.attributes('style').match(/left:\s*([^;]+)/)[1])).toBeLessThanOrEqual(436);
      expect(parseFloat(wrapper.attributes('style').match(/top:\s*([^;]+)/)[1])).toBeLessThanOrEqual(772);
      expect(document.activeElement?.textContent).toContain('Akcja');
      wrapper.unmount();
    } finally {
      if (widthDescriptor) Object.defineProperty(HTMLElement.prototype, 'offsetWidth', widthDescriptor);
      else delete HTMLElement.prototype.offsetWidth;
      if (heightDescriptor) Object.defineProperty(HTMLElement.prototype, 'offsetHeight', heightDescriptor);
      else delete HTMLElement.prototype.offsetHeight;
      Object.defineProperty(window, 'innerWidth', { configurable: true, value: previousWidth });
      Object.defineProperty(window, 'innerHeight', { configurable: true, value: previousHeight });
      host.remove();
    }
  });
});
