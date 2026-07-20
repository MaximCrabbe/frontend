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

    <!-- Basic: preset bundles. The highlighted one is reverse-matched from the
         stored values; presets never leave the frontend. -->
    <div v-if="mode === 'basic'" class="d-flex flex-wrap ga-2 px-4 pb-4">
      <v-btn
        v-for="key in presetKeys"
        :key="key"
        :color="activePreset === key ? 'primary' : undefined"
        :variant="activePreset === key ? 'flat' : 'outlined'"
        @click="applyPreset(key)"
      >
        {{ $t(`settings.dsp.compressor.presets.${key}`) }}
      </v-btn>
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
</script>
