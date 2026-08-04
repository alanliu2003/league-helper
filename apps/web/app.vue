<template>
  <div class="min-h-screen flex flex-col">
    <NuxtPage />
    <footer
      class="mt-auto border-t border-white/10 px-6 py-6 text-xs leading-relaxed text-[var(--lh-muted)]"
    >
      {{ legalNotice }}
    </footer>
  </div>
</template>

<script setup lang="ts">
import { RIOT_LEGAL_NOTICE } from '@league-helper/shared';

const legalNotice = RIOT_LEGAL_NOTICE;
</script>
