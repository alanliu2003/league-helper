<template>
  <div
    class="rounded-lg border px-4 py-3"
    :class="
      variant === 'error'
        ? 'border-[var(--lh-error)]/40 bg-[var(--lh-error)]/10'
        : 'border-[var(--lh-border)] bg-[var(--lh-surface)]'
    "
    role="alert"
  >
    <p
      class="font-medium"
      :class="variant === 'error' ? 'text-[var(--lh-error)]' : 'text-[var(--lh-text)]'"
    >
      {{ message }}
    </p>
    <NuxtLink
      v-if="showHomeLink"
      to="/"
      class="mt-2 inline-block text-sm text-[var(--lh-accent)] hover:underline"
    >
      Return to search
    </NuxtLink>
  </div>
</template>

<script setup lang="ts">
withDefaults(
  defineProps<{
    message: string;
    variant?: 'error' | 'info';
    showHomeLink?: boolean;
  }>(),
  { variant: 'error', showHomeLink: false },
);
</script>
