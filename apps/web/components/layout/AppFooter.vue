<template>
  <footer
    class="mt-auto border-t px-5 py-6 text-xs leading-relaxed"
    style="border-color: var(--lh-border); color: var(--lh-muted)"
  >
    <div class="lh-container">
      {{ legalNotice }}
    </div>
  </footer>
</template>

<script setup lang="ts">
import { RIOT_LEGAL_NOTICE } from '@league-helper/shared';

const legalNotice = RIOT_LEGAL_NOTICE;
</script>
