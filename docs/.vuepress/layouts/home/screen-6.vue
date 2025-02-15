<template>
  <div class="screen screen-6">
    <div class="navigation">
      <div class="item guide" v-for="item in getSidebarItems('/guide/')" :key="item.link || item.text">
        <sidebar-item :item="item"></sidebar-item>
      </div>
      <template v-if="width >= 1200 && height >= 800">
        <div class="item api" v-for="item in getSidebarItems('/api/')" :key="item.link || item.text">
          <sidebar-item :item="item"></sidebar-item>
        </div>
      </template>
    </div>
  </div>

  <footer>
    MIT Licensed | Copyright © 2019-2022 Shigma
  </footer>
</template>

<script lang="ts" setup>

import { useWindowSize } from '@vueuse/core'
import { useThemeLocaleData, resolveArraySidebarItems } from '@vuepress/theme-default/lib/client/composables'
import SidebarItem from '@vuepress/theme-default/lib/client/components/SidebarItem.vue'

defineEmits(['scroll-screen'])

const { width, height } = useWindowSize()

function getSidebarItems(route: string) {
  const config = useThemeLocaleData().value
  return resolveArraySidebarItems(config.sidebar[route].filter(item => item.isGroup), 1)
}

</script>

<style lang="scss">

.screen-6 {
  --nav-padding: 4rem;
  --max-height: calc(100vh - var(--navbar-height) - 10rem);

  padding: 2rem 0 2rem var(--nav-padding);
  overflow-x: auto;
  display: flex;
  flex-direction: column;
  height: var(--max-height);

  @media (max-width: 960px) {
    --nav-padding: 2rem;
  }
}

.navigation {
  margin: auto;
  display: flex;
  flex-direction: column;
  flex-wrap: wrap;
  gap: 1rem 0;
  align-content: space-evenly;
  height: min-content;
  width: 100%;
  max-height: var(--max-height);
  transition: border-color var(--t-color);

  @media (max-width: 1200px) {
    max-height: min(var(--max-height), 600px);
    align-content: stretch;
  }

  .item {
    width: 14rem;
    &:last-child {
      padding-right: var(--nav-padding);
    }
  }

  li {
    list-style-type: none;
  }

  ul {
    padding: 0;
    margin: 0;
  }
}

.home footer {
  flex-shrink: 0;
  padding: calc(2.5rem - 1px);
  line-height: 1rem;
  text-align: center;
}

</style>
