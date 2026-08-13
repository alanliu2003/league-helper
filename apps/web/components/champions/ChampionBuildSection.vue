<template>
  <section :aria-labelledby="headingId" class="space-y-3">
    <div>
      <h3 :id="headingId" class="font-display text-lg">{{ title }}</h3>
      <p v-if="description" class="mt-1 text-sm text-[var(--lh-muted)]">{{ description }}</p>
    </div>
    <p v-if="emptyText" class="text-sm text-[var(--lh-muted)]" role="status">{{ emptyText }}</p>
    <ul v-else class="space-y-3">
      <slot />
    </ul>
  </section>
</template>

<script setup lang="ts">
defineProps<{
  headingId: string;
  title: string;
  description?: string;
  emptyText?: string | null;
}>();
</script>
