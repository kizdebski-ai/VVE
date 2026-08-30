/**
 * Input Style control — the Pilot's signature whiteboard affordance.
 * Two persistent presets (Mysz / Pióro) in a compact Soft UI segmented
 * control that does not cover the working area. Direct, interruptible,
 * and reduced-motion safe.
 */
<template>
  <div
    class="input-style-control"
    data-testid="input-style-control"
    role="radiogroup"
    aria-label="Styl wejścia"
  >
    <span class="input-style-label" id="input-style-heading">Styl wejścia</span>
    <div class="input-style-track" :class="{ 'is-pen': model === 'pen' }">
      <button
        v-for="option in options"
        :key="option.profile"
        type="button"
        class="input-style-option"
        :class="{ active: model === option.profile }"
        role="radio"
        :aria-checked="model === option.profile ? 'true' : 'false'"
        :aria-label="option.label"
        :data-profile="option.profile"
        :title="option.hint"
        @click="select(option.profile)"
      >
        {{ option.label }}
      </button>
    </div>
  </div>
</template>

<script>
import { INPUT_STYLE_LABELS } from '../board/inputStyle';

export default {
  name: 'InputStyleControl',
  props: {
    modelValue: {
      type: String,
      default: 'mouse',
      validator: (value) => value === 'mouse' || value === 'pen'
    }
  },
  emits: ['update:modelValue'],
  computed: {
    model() {
      return this.modelValue === 'pen' ? 'pen' : 'mouse';
    },
    options() {
      return [
        {
          profile: 'mouse',
          label: INPUT_STYLE_LABELS.mouse,
          hint: 'Mysz — mocne wygładzanie linii'
        },
        {
          profile: 'pen',
          label: INPUT_STYLE_LABELS.pen,
          hint: 'Pióro — zachowuje nacisk i szczegół ruchu'
        }
      ];
    }
  },
  methods: {
    select(profile) {
      if (profile === this.model) return;
      this.$emit('update:modelValue', profile);
    }
  }
};
</script>

<style scoped>
.input-style-control {
  display: flex;
  flex-direction: column;
  align-items: stretch;
  gap: 6px;
  padding: 8px 10px;
  min-width: 168px;
  background: #e8edf4;
  border-radius: 18px;
  box-shadow:
    6px 6px 14px rgba(163, 177, 198, 0.45),
    -6px -6px 14px rgba(255, 255, 255, 0.9);
  pointer-events: auto;
}

.input-style-label {
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: #64748b;
  padding: 0 4px;
}

.input-style-track {
  position: relative;
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 4px;
  padding: 4px;
  border-radius: 14px;
  background: #dfe6ef;
  box-shadow: inset 2px 2px 5px rgba(163, 177, 198, 0.55), inset -2px -2px 5px rgba(255, 255, 255, 0.8);
}

.input-style-option {
  min-height: 44px;
  min-width: 72px;
  padding: 0 12px;
  border: 0;
  border-radius: 11px;
  background: transparent;
  color: #64748b;
  font-size: 14px;
  font-weight: 700;
  cursor: pointer;
  position: relative;
  z-index: 1;
  box-shadow: none;
}

.input-style-option.active {
  background: #f4f7fb;
  color: #1e293b;
  box-shadow:
    3px 3px 8px rgba(163, 177, 198, 0.5),
    -2px -2px 6px rgba(255, 255, 255, 0.95);
}

.input-style-option:focus-visible {
  outline: 2px solid #2563eb;
  outline-offset: 2px;
}

.input-style-option:disabled {
  cursor: not-allowed;
  opacity: 0.55;
}

@media (prefers-reduced-motion: reduce) {
  .input-style-option,
  .input-style-track,
  .input-style-control {
    transition: none;
  }
}

@media (prefers-reduced-transparency: reduce) {
  .input-style-control {
    background: #e2e8f0;
    box-shadow: 0 1px 3px rgba(15, 23, 42, 0.18);
  }
}
</style>
