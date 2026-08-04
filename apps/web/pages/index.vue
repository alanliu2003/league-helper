<template>
  <main class="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-8 px-6 py-16">
    <header class="space-y-3">
      <p class="text-sm uppercase tracking-[0.2em] text-[var(--lh-accent)]">Connectivity check</p>
      <h1 class="text-4xl font-semibold tracking-tight sm:text-5xl">{{ productName }}</h1>
      <p class="max-w-xl text-[var(--lh-muted)]">
        Frontend scaffold is live. This page calls the Nest API
        <code class="text-[var(--lh-text)]">GET /health</code>
        endpoint to confirm browser → API connectivity.
      </p>
    </header>

    <section class="rounded-2xl border border-white/10 bg-[var(--lh-surface)]/80 p-6 backdrop-blur">
      <div class="mb-4 flex items-center justify-between gap-4">
        <h2 class="text-lg font-medium">API health</h2>
        <button
          type="button"
          class="rounded-lg bg-[var(--lh-accent)] px-3 py-1.5 text-sm font-medium text-[#071018] transition hover:brightness-110 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--lh-accent)] disabled:opacity-60"
          :disabled="pending"
          @click="refresh()"
        >
          {{ pending ? 'Checking…' : 'Refresh' }}
        </button>
      </div>

      <p v-if="pending" class="text-sm text-[var(--lh-muted)]">Loading health status…</p>

      <div v-else-if="errorMessage" class="space-y-2">
        <p class="text-sm font-medium text-[var(--lh-bad)]">Unable to reach API</p>
        <p class="text-sm text-[var(--lh-muted)]">{{ errorMessage }}</p>
        <p class="text-xs text-[var(--lh-muted)]">
          Expected API base:
          <code>{{ apiBase }}</code>
        </p>
      </div>

      <dl v-else-if="health" class="grid gap-3 text-sm sm:grid-cols-3">
        <div>
          <dt class="text-[var(--lh-muted)]">Status</dt>
          <dd class="mt-1 font-medium text-[var(--lh-ok)]">{{ health.status }}</dd>
        </div>
        <div>
          <dt class="text-[var(--lh-muted)]">Service</dt>
          <dd class="mt-1 font-medium">{{ health.service }}</dd>
        </div>
        <div>
          <dt class="text-[var(--lh-muted)]">Timestamp (UTC)</dt>
          <dd class="mt-1 font-medium">{{ health.timestamp }}</dd>
        </div>
      </dl>
    </section>
  </main>
</template>

<script setup lang="ts">
import { HealthResponseSchema, type HealthResponse } from '@league-helper/shared';
import { computed } from 'vue';

const config = useRuntimeConfig();
const productName = config.public.productName;
const apiBase = config.public.apiBase;

const { data, pending, error, refresh } = await useAsyncData('api-health', async () => {
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
