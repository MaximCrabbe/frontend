<template>
  <div>
    <v-btn-toggle
      v-model="mode"
      mandatory
      density="compact"
      color="primary"
      class="ma-4"
    >
      <v-btn value="basic" size="small">
        {{ $t("settings.dsp.compressor.basic") }}
      </v-btn>
      <v-btn value="advanced" size="small">
        {{ $t("settings.dsp.compressor.advanced") }}
      </v-btn>
    </v-btn-toggle>

    <!-- Basic: preset cards, each showing its own compression curve. The active
         card is reverse-matched from the stored values; presets never leave the
         frontend. -->
    <div v-if="mode === 'basic'" class="preset-grid">
      <button
        v-for="key in presetKeys"
        :key="key"
        type="button"
        class="preset-card"
        :class="{ 'preset-card--active': activePreset === key }"
        :aria-pressed="activePreset === key"
        @click="applyPreset(key)"
      >
        <svg
          class="preset-curve"
          viewBox="0 0 100 100"
          preserveAspectRatio="none"
          aria-hidden="true"
        >
          <line class="preset-curve__unity" x1="0" y1="100" x2="100" y2="0" />
          <path class="preset-curve__fill" :d="curves[key].fill" />
          <path class="preset-curve__stroke" :d="curves[key].stroke" />
        </svg>
        <span class="preset-card__name">
          {{ $t(`settings.dsp.compressor.presets.${key}`) }}
        </span>
        <span class="preset-card__desc">
          {{ $t(`settings.dsp.compressor.presets.${key}_desc`) }}
        </span>
      </button>
    </div>

    <!-- Advanced: the six individual controls. -->
    <template v-else>
      <DSPSlider
        v-model="compressor.threshold"
        :type="{
          min: -60,
          max: 0,
          step: 0.1,
          label: $t('settings.dsp.compressor.threshold'),
          unit: 'dB',
          is_log: false,
        }"
      />
      <DSPSlider
        v-model="compressor.ratio"
        :type="{
          min: 1,
          max: 20,
          step: 0.1,
          label: $t('settings.dsp.compressor.ratio'),
          unit: ':1',
          is_log: false,
          decimals: 1,
        }"
      />
      <!-- attack/release span several orders of magnitude, so they reuse the
           wide-range log input from the PEQ frequency control. -->
      <DSPSlider
        v-model="compressor.attack"
        :type="{
          min: 0.01,
          max: 2000,
          step: 1,
          label: $t('settings.dsp.compressor.attack'),
          unit: 'ms',
          is_log: true,
        }"
      />
      <DSPSlider
        v-model="compressor.release"
        :type="{
          min: 0.01,
          max: 9000,
          step: 1,
          label: $t('settings.dsp.compressor.release'),
          unit: 'ms',
          is_log: true,
        }"
      />
      <DSPSlider
        v-model="compressor.knee"
        :type="{
          min: 0,
          max: 18,
          step: 0.1,
          label: $t('settings.dsp.compressor.knee'),
          unit: 'dB',
          is_log: false,
        }"
      />
      <DSPSlider
        v-model="compressor.makeup"
        :type="{
          min: 0,
          max: 36,
          step: 0.1,
          label: $t('settings.dsp.compressor.makeup'),
          unit: 'dB',
          is_log: false,
        }"
      />
    </template>
  </div>
</template>
<script setup lang="ts">
import { computed, ref } from "vue";
import { CompressorFilter } from "@/plugins/api/interfaces";
import DSPSlider from "./DSPSlider.vue";
import {
  COMPRESSOR_PRESETS,
  COMPRESSOR_PRESET_KEYS,
  CompressorParams,
  CompressorPresetKey,
  matchCompressorPreset,
} from "./compressorPresets";

const compressor = defineModel<CompressorFilter>({ required: true });

const presetKeys = COMPRESSOR_PRESET_KEYS;

// Which preset (if any) the stored values currently match.
const activePreset = computed(() => matchCompressorPreset(compressor.value));

// Mode is derived on mount (reverse-match), not stored in the model: a match
// opens in Basic, anything else in Advanced. Editing in Advanced diverges the
// values, so on the next reopen it comes back as Advanced.
const mode = ref<"basic" | "advanced">(
  activePreset.value ? "basic" : "advanced",
);

const applyPreset = (key: CompressorPresetKey) => {
  Object.assign(compressor.value, COMPRESSOR_PRESETS[key]);
};

// Transfer curve for each preset, over the input range in dB. Uses the standard
// soft-knee gain computer so the curve tracks the preset's threshold, ratio and
// knee.
const IN_MIN = -60;
const IN_MAX = 0;

const gainComputer = (x: number, t: number, r: number, w: number): number => {
  const d = x - t;
  if (2 * d < -w) return x;
  if (2 * d > w) return t + d / r;
  return x + ((1 / r - 1) * (d + w / 2) ** 2) / (2 * w);
};

const toXY = (inDb: number, outDb: number): [number, number] => {
  const x = ((inDb - IN_MIN) / (IN_MAX - IN_MIN)) * 100;
  const y = 100 - ((outDb - IN_MIN) / (IN_MAX - IN_MIN)) * 100;
  return [x, y];
};

const curveFor = (p: CompressorParams): { stroke: string; fill: string } => {
  const steps = 28;
  const pts: string[] = [];
  for (let i = 0; i <= steps; i++) {
    const inDb = IN_MIN + ((IN_MAX - IN_MIN) * i) / steps;
    const [x, y] = toXY(inDb, gainComputer(inDb, p.threshold, p.ratio, p.knee));
    pts.push(`${x.toFixed(2)},${y.toFixed(2)}`);
  }
  const stroke = "M" + pts.join(" L");
  // Close via the top-right corner so the fill shades the wedge down to unity.
  const fill = `${stroke} L100,0 Z`;
  return { stroke, fill };
};

const curves = Object.fromEntries(
  presetKeys.map((k) => [k, curveFor(COMPRESSOR_PRESETS[k])]),
) as Record<CompressorPresetKey, { stroke: string; fill: string }>;
</script>

<style scoped>
.preset-grid {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  padding: 4px 16px 20px;
}

.preset-card {
  flex: 1 1 148px;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 2px;
  padding: 12px 14px 14px;
  border-radius: 10px;
  border: 1px solid rgba(var(--v-theme-on-surface), 0.12);
  background: rgba(var(--v-theme-on-surface), 0.02);
  color: rgb(var(--v-theme-on-surface));
  text-align: left;
  cursor: pointer;
  transition:
    border-color 0.18s ease,
    background 0.18s ease;
}

.preset-card:hover {
  border-color: rgba(var(--v-theme-on-surface), 0.28);
  background: rgba(var(--v-theme-on-surface), 0.05);
}

.preset-card:focus-visible {
  outline: 2px solid rgb(var(--v-theme-primary));
  outline-offset: 2px;
}

.preset-card--active {
  border-color: rgb(var(--v-theme-primary));
  background: rgba(var(--v-theme-primary), 0.08);
}

.preset-curve {
  width: 100%;
  height: 60px;
  margin-bottom: 8px;
  overflow: visible;
}

.preset-curve__unity {
  stroke: rgba(var(--v-theme-on-surface), 0.22);
  stroke-width: 1;
  stroke-dasharray: 3 3;
  vector-effect: non-scaling-stroke;
}

.preset-curve__fill {
  fill: rgba(var(--v-theme-on-surface), 0.06);
}

.preset-curve__stroke {
  fill: none;
  stroke: rgba(var(--v-theme-on-surface), 0.5);
  stroke-width: 2;
  stroke-linejoin: round;
  vector-effect: non-scaling-stroke;
}

.preset-card--active .preset-curve__fill {
  fill: rgba(var(--v-theme-primary), 0.16);
}

.preset-card--active .preset-curve__stroke {
  stroke: rgb(var(--v-theme-primary));
}

.preset-card__name {
  font-size: 0.95rem;
  font-weight: 600;
  letter-spacing: 0.01em;
}

.preset-card--active .preset-card__name {
  color: rgb(var(--v-theme-primary));
}

.preset-card__desc {
  font-size: 0.78rem;
  opacity: 0.7;
}

@media (prefers-reduced-motion: reduce) {
  .preset-card {
    transition: none;
  }
}
</style>
