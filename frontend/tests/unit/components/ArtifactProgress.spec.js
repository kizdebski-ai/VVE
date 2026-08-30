import { mount } from '@vue/test-utils';
import ArtifactProgress from '@/components/ArtifactProgress.vue';

describe('ArtifactProgress', () => {
  it('renders Polish copy, a progress fill, and a cancellable Anuluj control', async () => {
    const wrapper = mount(ArtifactProgress, {
      props: {
        visible: true,
        message: 'Importowanie PDF… strona 1 z 2',
        current: 1,
        total: 2,
        cancellable: true
      }
    });
    expect(wrapper.get('[data-testid="artifact-progress"]').text()).toContain('Importowanie PDF');
    expect(wrapper.get('[data-testid="artifact-cancel"]').text()).toBe('Anuluj');
    await wrapper.get('[data-testid="artifact-cancel"]').trigger('click');
    expect(wrapper.emitted('cancel')).toHaveLength(1);
  });

  it('stays out of the tree when hidden', () => {
    const wrapper = mount(ArtifactProgress, { props: { visible: false, message: 'x' } });
    expect(wrapper.find('[data-testid="artifact-progress"]').exists()).toBe(false);
  });
});
