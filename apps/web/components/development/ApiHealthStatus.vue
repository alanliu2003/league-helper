<template>
  <section
    class="rounded-xl border border-white/10 bg-[var(--lh-surface)]/60 p-4"
    aria-labelledby="api-health-heading"
  >
    <div class="mb-3 flex flex-wrap items-center justify-between gap-3">
      <h2 id="api-health-heading" class="text-sm font-medium text-[var(--lh-muted)]">
        Development status
      </h2>
      <button
        type="button"
        class="rounded-md border border-white/10 px-2.5 py-1 text-xs text-[var(--lh-text)] transition hover:border-white/20 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--lh-accent)] disabled:opacity-60"
        :disabled="pending"
        @click="refresh()"
      >
        {{ pending ? 'Checking…' : 'Refresh' }}
      </button>
    </div>

    <p v-if="pending" class="text-xs text-[var(--lh-muted)]" role="status">Checking API…</p>

    <div v-else-if="errorMessage" class="space-y-1">
      <p class="text-xs font-medium text-[var(--lh-bad)]">API unreachable</p>
      <p class="text-xs text-[var(--lh-muted)]">{{ errorMessage }}</p>
    </div>

    <dl v-else-if="health" class="grid gap-2 text-xs sm:grid-cols-2 lg:grid-cols-4">
      <div>
        <dt class="text-[var(--lh-muted)]">Status</dt>
        <dd class="mt-0.5 font-medium text-[var(--lh-ok)]">{{ health.status }}</dd>
      </div>
      <div>
        <dt class="text-[var(--lh-muted)]">Service</dt>
        <dd class="mt-0.5 font-medium">{{ health.service }}</dd>
      </div>
      <div v-if="health.providerMode">
        <dt class="text-[var(--lh-muted)]">Provider mode</dt>
        <dd class="mt-0.5 font-medium capitalize">{{ health.providerMode }}</dd>
      </div>
      <div v-if="health.providerConfigured !== undefined">
        <dt class="text-[var(--lh-muted)]">Riot key</dt>
        <dd class="mt-0.5 font-medium">
          {{ health.providerConfigured ? 'Configured' : 'Not configured' }}
        </dd>
      </div>
    </dl>
  </section>
</template>

<script setup lang="ts">
import { HealthResponseSchema, type HealthResponse } from '@league-helper/shared';
import { computed } from 'vue';

const config = useRuntimeConfig();
const apiBase = config.public.apiBase as string;

const { data, pending, error, refresh } = await useAsyncData('api-health-compact', async () => {
  const response = await $fetch(`${apiBase}/health`);
  return HealthResponseSchema.parse(response);
});

const health = computed<HealthResponse | null>(() => data.value ?? null);
const errorMessage = computed(() => {
  if (!error.value) {
    return null;
  }
  return error.value.message || 'Request failed';
});
</script>
