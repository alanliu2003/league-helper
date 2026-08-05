<template>
  <section aria-labelledby="mastery-heading" class="space-y-5">
    <h2 id="mastery-heading" class="font-display text-xl">Champion mastery</h2>

    <p
      v-if="mastery.length === 0"
      class="rounded-lg border border-dashed px-4 py-6 text-sm text-[var(--lh-muted)]"
      style="border-color: var(--lh-border)"
    >
      No mastery data yet. Refresh the profile to pull champion mastery from Riot.
    </p>

    <template v-else>
      <div
        class="grid gap-4 md:grid-cols-2 lg:grid-cols-3"
        :class="featured.length === 1 ? 'grid-cols-1' : ''"
      >
        <FeaturedMasteryCard
          v-for="(entry, index) in featured"
          :key="entry.id"
          :entry="entry"
          :rank="index + 1"
          :lazy="index > 0"
        />
      </div>

      <ol v-if="rest.length > 0" class="space-y-2" aria-label="Additional mastery">
        <MasteryRow
          v-for="(entry, index) in rest"
          :key="entry.id"
          :entry="entry"
          :rank="featured.length + index + 1"
        />
      </ol>
    </template>
  </section>
</template>

<script setup lang="ts">
import type { PublicMasterySummary } from '@league-helper/shared';
import { computed } from 'vue';
import FeaturedMasteryCard from '~/components/player/FeaturedMasteryCard.vue';
import MasteryRow from '~/components/player/MasteryRow.vue';

const props = defineProps<{
  mastery: PublicMasterySummary[];
}>();

const featured = computed(() => props.mastery.slice(0, 3));
const rest = computed(() => props.mastery.slice(3));
</script>

<style scoped>
@media (max-width: 639px) {
  .grid {
    display: flex;
    overflow-x: auto;
    scroll-snap-type: x mandatory;
    -webkit-overflow-scrolling: touch;
    gap: 1rem;
    padding-bottom: 0.5rem;
  }

  .grid > :deep(*) {
    flex: 0 0 85%;
    scroll-snap-align: start;
  }
}
</style>
