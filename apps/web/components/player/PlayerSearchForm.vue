<template>
  <form class="space-y-5" method="post" action="#" novalidate @submit.prevent="handleSubmit">
    <div class="grid gap-4 sm:grid-cols-2">
      <div class="space-y-1.5">
        <label for="gameName" class="block text-sm font-medium">Game name</label>
        <input
          id="gameName"
          v-model="gameName"
          type="text"
          name="gameName"
          autocomplete="off"
          maxlength="16"
          class="w-full rounded-lg border border-white/10 bg-[var(--lh-bg)]/80 px-3 py-2.5 text-[var(--lh-text)] placeholder:text-[var(--lh-muted)] focus-visible:border-[var(--lh-accent)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--lh-accent)]/40 disabled:opacity-60"
          placeholder="Summoner name"
          :disabled="pending"
          :aria-invalid="Boolean(fieldErrors.gameName)"
          :aria-describedby="fieldErrors.gameName ? 'gameName-error' : undefined"
          @keydown.enter="handleSubmit"
        />
        <p
          v-if="fieldErrors.gameName"
          id="gameName-error"
          class="text-xs text-[var(--lh-bad)]"
          role="alert"
        >
          {{ fieldErrors.gameName }}
        </p>
      </div>

      <div class="space-y-1.5">
        <label for="tagLine" class="block text-sm font-medium">Tag line</label>
        <div class="relative">
          <span
            class="pointer-events-none absolute inset-y-0 left-3 flex items-center text-[var(--lh-muted)]"
            aria-hidden="true"
          >
            #
          </span>
          <input
            id="tagLine"
            v-model="tagLine"
            type="text"
            name="tagLine"
            autocomplete="off"
            maxlength="5"
            class="w-full rounded-lg border border-white/10 bg-[var(--lh-bg)]/80 py-2.5 pl-7 pr-3 text-[var(--lh-text)] placeholder:text-[var(--lh-muted)] focus-visible:border-[var(--lh-accent)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--lh-accent)]/40 disabled:opacity-60"
            placeholder="TAG"
            :disabled="pending"
            :aria-invalid="Boolean(fieldErrors.tagLine)"
            :aria-describedby="fieldErrors.tagLine ? 'tagLine-error' : undefined"
            @keydown.enter="handleSubmit"
          />
        </div>
        <p
          v-if="fieldErrors.tagLine"
          id="tagLine-error"
          class="text-xs text-[var(--lh-bad)]"
          role="alert"
        >
          {{ fieldErrors.tagLine }}
        </p>
      </div>
    </div>

    <div class="grid gap-4 sm:grid-cols-2">
      <div class="space-y-1.5">
        <label for="platform" class="block text-sm font-medium">Platform</label>
        <select
          id="platform"
          v-model="platform"
          name="platform"
          class="w-full rounded-lg border border-white/10 bg-[var(--lh-bg)]/80 px-3 py-2.5 text-[var(--lh-text)] focus-visible:border-[var(--lh-accent)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--lh-accent)]/40 disabled:opacity-60"
          :disabled="pending"
        >
          <option v-for="item in platforms" :key="item.route" :value="item.route">
            {{ item.displayName }}
          </option>
        </select>
      </div>

      <div class="space-y-1.5">
        <label for="matchCount" class="block text-sm font-medium">Recent matches</label>
        <input
          id="matchCount"
          v-model.number="matchCount"
          type="number"
          name="matchCount"
          min="1"
          max="100"
          class="w-full rounded-lg border border-white/10 bg-[var(--lh-bg)]/80 px-3 py-2.5 text-[var(--lh-text)] focus-visible:border-[var(--lh-accent)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--lh-accent)]/40 disabled:opacity-60"
          :disabled="pending"
        />
        <p class="text-xs text-[var(--lh-muted)]">How many recent matches to queue (1–100).</p>
      </div>
    </div>

    <p v-if="submitError" class="text-sm text-[var(--lh-bad)]" role="alert">
      {{ submitError }}
    </p>

    <button
      type="submit"
      class="w-full rounded-lg bg-[var(--lh-accent)] px-4 py-3 text-sm font-semibold text-[#071018] transition hover:brightness-110 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--lh-accent)] disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto"
      :disabled="pending"
    >
      {{ pending ? 'Searching…' : 'Search player' }}
    </button>
  </form>
</template>

<script setup lang="ts">
import {
  listSupportedPlatforms,
  PlayerSearchRequestSchema,
  type PlatformRoute,
  type PlayerSearchRequest,
} from '@league-helper/shared';
import { reactive, ref } from 'vue';

defineProps<{
  pending?: boolean;
  submitError?: string | null;
}>();

const emit = defineEmits<{
  submit: [payload: PlayerSearchRequest];
}>();

const platforms = listSupportedPlatforms();

const gameName = ref('');
const tagLine = ref('');
const platform = ref<PlatformRoute>('na1');
const matchCount = ref(20);

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
    matchCount: matchCount.value,
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
