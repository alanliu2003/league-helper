<template>
  <form
    class="flex flex-wrap items-end gap-2"
    method="post"
    action="#"
    novalidate
    @submit.prevent="handleSubmit"
  >
    <div class="min-w-[7rem] flex-1">
      <label :for="`${idPrefix}-gameName`" class="sr-only">Game name</label>
      <input
        :id="`${idPrefix}-gameName`"
        v-model="gameName"
        type="text"
        name="gameName"
        autocomplete="off"
        maxlength="16"
        class="lh-input py-2 text-sm"
        placeholder="Game name"
        :disabled="props.pending"
        :aria-invalid="Boolean(fieldErrors.gameName)"
        @keydown.enter="handleSubmit"
      />
    </div>

    <div class="w-24">
      <label :for="`${idPrefix}-tagLine`" class="sr-only">Tag line</label>
      <div class="relative">
        <span
          class="pointer-events-none absolute inset-y-0 left-2.5 flex items-center text-[var(--lh-muted)]"
          aria-hidden="true"
        >
          #
        </span>
        <input
          :id="`${idPrefix}-tagLine`"
          v-model="tagLine"
          type="text"
          name="tagLine"
          autocomplete="off"
          maxlength="5"
          class="lh-input py-2 pl-6 text-sm"
          placeholder="TAG"
          :disabled="props.pending"
          :aria-invalid="Boolean(fieldErrors.tagLine)"
          @keydown.enter="handleSubmit"
        />
      </div>
    </div>

    <div class="w-28">
      <label :for="`${idPrefix}-platform`" class="sr-only">Platform</label>
      <select
        :id="`${idPrefix}-platform`"
        v-model="platform"
        name="platform"
        class="lh-input py-2 text-sm"
        :disabled="props.pending"
      >
        <option v-for="item in platforms" :key="item.route" :value="item.route">
          {{ item.displayName }}
        </option>
      </select>
    </div>

    <button
      type="submit"
      class="lh-btn-primary shrink-0 px-3 py-2 text-sm"
      :disabled="props.pending"
      :aria-label="props.pending ? 'Searching' : 'Header player search'"
    >
      {{ props.pending ? '…' : 'Search' }}
    </button>

    <p
      v-if="fieldErrors.gameName || fieldErrors.tagLine || props.submitError"
      class="w-full text-xs text-[var(--lh-error)]"
      role="alert"
    >
      {{ fieldErrors.gameName ?? fieldErrors.tagLine ?? props.submitError }}
    </p>
  </form>
</template>

<script setup lang="ts">
import {
  listSupportedPlatforms,
  PlayerSearchRequestSchema,
  type PlatformRoute,
  type PlayerSearchRequest,
} from '@league-helper/shared';
import { reactive, ref, computed } from 'vue';

const props = withDefaults(
  defineProps<{
    pending?: boolean;
    submitError?: string | null;
    idPrefix?: string;
  }>(),
  { idPrefix: 'global-search' },
);

const emit = defineEmits<{
  submit: [payload: PlayerSearchRequest];
}>();

const idPrefix = computed(() => props.idPrefix);
const platforms = listSupportedPlatforms();

const gameName = ref('');
const tagLine = ref('');
const platform = ref<PlatformRoute>('na1');

const fieldErrors = reactive<{ gameName?: string; tagLine?: string }>({});

function clearFieldErrors(): void {
  fieldErrors.gameName = undefined;
  fieldErrors.tagLine = undefined;
}

function handleSubmit(): void {
  clearFieldErrors();

  const trimmedGameName = gameName.value.trim();
  const trimmedTagLine = tagLine.value.trim();

  if (!trimmedGameName) {
    fieldErrors.gameName = 'Game name is required.';
  }
  if (!trimmedTagLine) {
    fieldErrors.tagLine = 'Tag line is required.';
  }
  if (fieldErrors.gameName || fieldErrors.tagLine) {
    return;
  }

  const result = PlayerSearchRequestSchema.safeParse({
    gameName: gameName.value,
    tagLine: tagLine.value,
    platform: platform.value,
    matchCount: 20,
  });

  if (!result.success) {
    for (const issue of result.error.issues) {
      const field = issue.path[0];
      if (field === 'gameName' || field === 'tagLine') {
        fieldErrors[field] = issue.message;
      }
    }
    if (!fieldErrors.gameName && !fieldErrors.tagLine) {
      fieldErrors.gameName = 'Invalid search request.';
    }
    return;
  }

  emit('submit', result.data);
}
</script>
