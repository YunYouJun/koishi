<template>
  <img class="k-image" :src="normalizeUrl(src)" @click="handleClick"/>
</template>

<script lang="ts" setup>

import { shared } from './utils'
import { config } from '@koishijs/client'

const props = defineProps<{ src: string }>()

function normalizeUrl(url: string) {
  return url
  // return config.endpoint + '/assets/' + encodeURIComponent(url)
}

function handleClick(ev: MouseEvent) {
  ev.preventDefault()
  if (ev.metaKey) return window.open(props.src, '_blank')
  shared.overlayImage = ev.target as HTMLImageElement
}

</script>
