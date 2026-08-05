<template>
  <div class="flex min-h-screen flex-col">
    <LayoutAppHeader />
    <main id="main-content" class="flex-1">
      <slot />
    </main>
    <LayoutAppFooter />
  </div>
</template>
