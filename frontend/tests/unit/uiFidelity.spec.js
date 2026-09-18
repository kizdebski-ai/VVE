import { mount } from '@vue/test-utils';
import { nextTick } from 'vue';
import { readFileSync } from 'fs';
import path from 'path';
import TopMenu from '@/components/TopMenu.vue';

const styleSource = readFileSync(path.resolve(__dirname, '../../src/style.css'), 'utf8');

describe('VVE-110 UI fidelity contract', () => {
  it('keeps the utility trigger reachable without hover', async () => {
    const wrapper = mount(TopMenu, { props: { role: 'teacher' } });
    const gear = wrapper.get('.gear-btn');

    expect(gear.attributes('aria-expanded')).toBe('false');
    expect(gear.attributes('aria-controls')).toBe('pilot-utility-menu');

    await gear.trigger('click');
    await nextTick();

    expect(gear.attributes('aria-expanded')).toBe('true');
    expect(wrapper.get('[data-testid="pdf-import-button"]').text()).toContain('PDF');
    expect(wrapper.get('[aria-haspopup="menu"]').attributes('aria-expanded')).toBe('false');
    wrapper.unmount();
  });

  it('opens both PDF export modes from a click or tap', async () => {
    const exported = [];
    const wrapper = mount(TopMenu, {
      props: { role: 'teacher' },
      attrs: {
        onExportPdfSingle: () => exported.push('single'),
        onExportPdfPaged: () => exported.push('paged')
      }
    });

    await wrapper.get('.gear-btn').trigger('click');
    await wrapper.get('[aria-haspopup="menu"]').trigger('click');
    await nextTick();

    expect(wrapper.get('[aria-haspopup="menu"]').attributes('aria-expanded')).toBe('true');
    await wrapper.get('[data-testid="pdf-export-paged"]').trigger('click');
    expect(exported).toEqual(['paged']);
    expect(wrapper.find('[data-testid="pdf-export-paged"]').exists()).toBe(false);
    wrapper.unmount();
  });

  it('closes the deepest menu on Escape and restores focus to the trigger', async () => {
    const wrapper = mount(TopMenu, { props: { role: 'teacher' }, attachTo: document.body });
    const gear = wrapper.get('.gear-btn');

    await gear.trigger('click');
    await wrapper.get('[aria-haspopup="menu"]').trigger('click');
    await nextTick();
    await wrapper.get('.top-menu').trigger('keydown', { key: 'Escape' });
    expect(wrapper.get('.top-menu').exists()).toBe(true);
    expect(wrapper.get('[aria-haspopup="menu"]').attributes('aria-expanded')).toBe('false');

    await wrapper.get('.top-menu').trigger('keydown', { key: 'Escape' });
    await nextTick();
    expect(wrapper.find('.top-menu').exists()).toBe(false);
    expect(document.activeElement).toBe(gear.element);
    wrapper.unmount();
  });

  it('supports arrow navigation across utility controls', async () => {
    const wrapper = mount(TopMenu, { props: { role: 'teacher' }, attachTo: document.body });
    await wrapper.get('.gear-btn').trigger('click');
    const controls = wrapper.findAll('.top-menu > .menu-btn');
    await controls[0].trigger('focus');
    await controls[0].trigger('keydown', { key: 'ArrowDown' });
    expect(document.activeElement).toBe(controls[1].element);
    wrapper.unmount();
  });

  it('exposes the material and accessibility variants required by S10', () => {
    expect(styleSource).toContain('--shadow-raised:');
    expect(styleSource).toContain('--shadow-pressed:');
    expect(styleSource).toContain('prefers-reduced-transparency');
    expect(styleSource).toContain('prefers-contrast: more');
    expect(styleSource).toContain('button:focus-visible');
  });
});
