import { describe, expect, it } from 'vitest';
import { mount } from '@vue/test-utils';
import ArtifactReady from '@/components/ArtifactReady.vue';

describe('ArtifactReady', () => {
  it('offers a fresh user action for the finished PDF and can dismiss it', async () => {
    const wrapper = mount(ArtifactReady, {
      props: { visible: true, message: 'PDF gotowy' }
    });

    expect(wrapper.get('[data-testid="artifact-ready"]').text()).toContain('PDF gotowy');
    await wrapper.get('[data-testid="artifact-ready-deliver"]').trigger('click');
    await wrapper.get('[data-testid="artifact-ready-dismiss"]').trigger('click');

    expect(wrapper.emitted('deliver')).toHaveLength(1);
    expect(wrapper.emitted('dismiss')).toHaveLength(1);
  });
});
