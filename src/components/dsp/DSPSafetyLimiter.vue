<template>
  <DSPSlider
    v-model="limiter.ceiling"
    :type="{
      min: -24,
      max: 0,
      step: 0.1,
      label: $t('settings.dsp.safety_limiter.ceiling'),
      unit: 'dB',
      is_log: false,
    }"
  />
</template>
<script setup lang="ts">
import { SafetyLimiterFilter } from "@/plugins/api/interfaces";
import DSPSlider from "./DSPSlider.vue";

const limiter = defineModel<SafetyLimiterFilter>({ required: true });
</script>
