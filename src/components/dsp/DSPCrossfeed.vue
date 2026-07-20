<template>
  <v-card flat color="transparent">
    <v-card-text>
      <!-- On/off is the per-filter toggle in the toolbar, not a preset. -->
      <div class="segmented" role="radiogroup">
        <button
          v-for="preset in presets"
          :key="preset.id"
          type="button"
          role="radio"
          class="segmented__item"
          :class="{ 'segmented__item--active': activePreset === preset.id }"
          :aria-checked="activePreset === preset.id"
          @click="select(preset)"
        >
          <component :is="preset.icon" :size="22" :stroke-width="2.25" />
          <span>{{ $t(`settings.dsp.crossfeed.presets.${preset.id}`) }}</span>
        </button>
      </div>

      <v-alert
        type="info"
        variant="tonal"
        density="compact"
        class="mt-8"
        :text="$t('settings.dsp.crossfeed.help')"
      />
    </v-card-text>
  </v-card>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { SignalLow, SignalMedium, SignalHigh } from "@lucide/vue";
import { $t } from "@/plugins/i18n";
import { CrossfeedFilter } from "@/plugins/api/interfaces";
import { CROSSFEED_PRESETS, type CrossfeedPreset } from "./crossfeedPresets";

const model = defineModel<CrossfeedFilter>({ required: true });

const icons: Record<CrossfeedPreset["id"], unknown> = {
  low: SignalLow,
  medium: SignalMedium,
  high: SignalHigh,
};
const presets = CROSSFEED_PRESETS.map((preset) => ({
  ...preset,
  icon: icons[preset.id],
}));

// Preset matching the stored strength, if any.
const activePreset = computed<CrossfeedPreset["id"] | undefined>(
  () => CROSSFEED_PRESETS.find((p) => p.strength === model.value.strength)?.id,
);

// Selecting a level also enables the filter.
const select = (preset: CrossfeedPreset) => {
  model.value.strength = preset.strength;
  model.value.enabled = true;
};
</script>

<style scoped>
.segmented {
  display: flex;
  border: 1px solid rgba(var(--v-theme-on-surface), 0.16);
  border-radius: 10px;
  overflow: hidden;
  container-type: inline-size;
}

.segmented__item {
  flex: 1 1 0;
  min-width: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 12px 8px;
  border-left: 1px solid rgba(var(--v-theme-on-surface), 0.16);
  background: transparent;
  color: rgba(var(--v-theme-on-surface), 0.72);
  font-size: 1rem;
  font-weight: 500;
  line-height: 1;
  cursor: pointer;
  transition:
    background 0.18s ease,
    color 0.18s ease;
}

.segmented__item:first-child {
  border-left: 0;
}

.segmented__item:hover {
  background: rgba(var(--v-theme-on-surface), 0.05);
}

.segmented__item:focus-visible {
  outline: 2px solid rgb(var(--v-theme-primary));
  outline-offset: -2px;
}

.segmented__item--active {
  background: rgba(var(--v-theme-primary), 0.14);
  color: rgb(var(--v-theme-primary));
}

.segmented__item :deep(svg) {
  display: block;
  flex: 0 0 auto;
}

.segmented__item span {
  min-width: 0;
  white-space: nowrap;
}

/* Stack icon over label when the control is too narrow for one line. */
@container (max-width: 360px) {
  .segmented__item {
    flex-direction: column;
    gap: 4px;
    padding: 10px 4px;
  }
}

@media (prefers-reduced-motion: reduce) {
  .segmented__item {
    transition: none;
  }
}
</style>
