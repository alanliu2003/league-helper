<template>
  <p class="px-3 pb-1 text-sm text-[var(--lh-muted)]">
    <span class="font-medium text-[var(--lh-text-secondary)]">Why?</span>
    {{ text }}
  </p>
</template>

<script setup lang="ts">
defineProps<{
  text: string;
}>();
</script>
