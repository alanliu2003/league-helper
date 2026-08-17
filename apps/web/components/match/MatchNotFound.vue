<template>
  <div class="lh-surface-raised px-6 py-12 text-center" role="status">
    <h1 class="font-display text-2xl text-[var(--lh-text)]">Match not found</h1>
    <p class="mx-auto mt-3 max-w-md text-sm text-[var(--lh-text-secondary)]">
      That match id is missing or invalid. Open a match from a player’s recent games.
    </p>
    <NuxtLink to="/" class="mt-6 inline-block text-sm text-[var(--lh-accent)] hover:underline">
      Return to search
    </NuxtLink>
  </div>
</template>
