<template>
  <div class="lh-surface-raised px-6 py-12 text-center" role="status">
    <h1 class="font-display text-2xl text-[var(--lh-text)]">Champion not found</h1>
    <p class="mx-auto mt-3 max-w-md text-sm text-[var(--lh-text-secondary)]">
      That champion key is not in the static directory. Use a canonical champion key such as
      <span class="text-[var(--lh-text)]">Ahri</span> — numeric IDs are not valid routes.
    </p>
    <NuxtLink
      to="/champions"
      class="mt-6 inline-block text-sm text-[var(--lh-accent)] hover:underline"
    >
      Back to champions
    </NuxtLink>
  </div>
</template>
