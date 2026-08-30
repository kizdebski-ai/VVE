import { mount } from '@vue/test-utils';
import { nextTick } from 'vue';
import InputStyleControl from '@/components/InputStyleControl.vue';

describe('InputStyleControl', () => {
  it('exposes Mysz and Pióro with a visible selected state and keyboard focus', async () => {
    const wrapper = mount(InputStyleControl, { props: { modelValue: 'mouse' } });
    const group = wrapper.get('[data-testid="input-style-control"]');
    expect(group.attributes('role')).toBe('radiogroup');
    expect(group.attributes('aria-label')).toBe('Styl wejścia');

    const mysz = wrapper.get('[data-profile="mouse"]');
    const pioro = wrapper.get('[data-profile="pen"]');
    expect(mysz.text()).toBe('Mysz');
    expect(pioro.text()).toBe('Pióro');
    expect(mysz.attributes('aria-checked')).toBe('true');
    expect(pioro.attributes('aria-checked')).toBe('false');

    await pioro.trigger('click');
    expect(wrapper.emitted('update:modelValue')?.[0]).toEqual(['pen']);

    await wrapper.setProps({ modelValue: 'pen' });
    await nextTick();
    expect(wrapper.get('[data-profile="pen"]').attributes('aria-checked')).toBe('true');
    expect(wrapper.get('[data-profile="mouse"]').attributes('aria-checked')).toBe('false');
    wrapper.unmount();
  });
});
