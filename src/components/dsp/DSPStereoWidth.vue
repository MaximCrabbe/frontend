<template>
  <v-card flat color="transparent">
    <v-card-text>
      <div class="d-flex justify-end mt-2 mb-1 px-1">
        <span class="text-medium-emphasis">{{ model.width.toFixed(2) }}</span>
      </div>
      <v-slider
        v-model="model.width"
        :min="0"
        :max="2"
        :step="0.05"
        :ticks="scaleMarks"
        show-ticks="always"
        tick-size="3"
        hide-details
        color="primary"
        class="px-1 pb-6"
      />

      <v-alert
        type="info"
        variant="tonal"
        density="compact"
        class="mt-4"
        :text="$t('settings.dsp.stereo_width.help')"
      />
      <v-alert
        v-if="model.width > 1"
        type="warning"
        variant="tonal"
        density="compact"
        class="mt-2"
        :text="$t('settings.dsp.stereo_width.clip_hint')"
      />
    </v-card-text>
  </v-card>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { $t } from "@/plugins/i18n";
import { StereoWidthFilter } from "@/plugins/api/interfaces";

const model = defineModel<StereoWidthFilter>({ required: true });

const scaleMarks = computed<Record<number, string>>(() => ({
  0: $t("settings.dsp.stereo_width.scale.mono"),
  1: $t("settings.dsp.stereo_width.scale.original"),
  2: $t("settings.dsp.stereo_width.scale.wide"),
}));
</script>
