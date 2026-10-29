<script setup lang="ts">
import { onMounted, onUnmounted, ref, watch } from 'vue'
import { GAME_CONSTANTS, PieceType, PieceVariant } from '../types/game'
import { PIECE_CATALOG } from '../game/PieceCatalog'
import { spriteRegistry } from '../sprites/SpriteRegistry'

const props = defineProps<{
  type: PieceType
  variant: PieceVariant
  colorPaletteIndex?: number
  size?: number
}>()

const canvasRef = ref<HTMLCanvasElement | null>(null)
let unsubscribe: (() => void) | null = null

function drawPreview() {
  const canvas = canvasRef.value
  if (!canvas) return
  const ctx = canvas.getContext('2d')
  if (!ctx) return

  const w = canvas.width
  const h = canvas.height
  ctx.clearRect(0, 0, w, h)

  const def = PIECE_CATALOG[props.type]
  let minX = Infinity
  let maxX = -Infinity
  let minY = Infinity
  let maxY = -Infinity
  for (const c of def.cells) {
    minX = Math.min(minX, c.x)
    maxX = Math.max(maxX, c.x)
    minY = Math.min(minY, c.y)
    maxY = Math.max(maxY, c.y)
  }
  const centerX = (minX + maxX) / 2
  const centerY = (minY + maxY) / 2
  const centeredCells = def.cells.map((c) => ({
    x: c.x - centerX,
    y: c.y - centerY,
  }))

  const previewScale = props.variant === 'GIANT' ? 0.44 : 0.38
  const cellPx = GAME_CONSTANTS.UNIT_PX * previewScale

  ctx.save()
  ctx.translate(w / 2, h / 2)

  // Outer dark contour around the piece silhouette so it pops inside the light banner box
  ctx.fillStyle = '#0F172A'
  const pad = 2.2
  for (const c of centeredCells) {
    ctx.beginPath()
    ctx.roundRect(
      c.x * cellPx - cellPx / 2 - pad,
      c.y * cellPx - cellPx / 2 - pad,
      cellPx + pad * 2,
      cellPx + pad * 2,
      3
    )
    ctx.fill()
  }

  spriteRegistry.drawPieceCells(
    ctx,
    props.type,
    props.variant,
    centeredCells,
    previewScale,
    {
      showCenterOfMass: false,
      colorPaletteIndex: props.colorPaletteIndex,
    }
  )
  ctx.restore()
}

onMounted(() => {
  drawPreview()
  unsubscribe = spriteRegistry.onChange(drawPreview)
})

onUnmounted(() => {
  if (unsubscribe) unsubscribe()
})

watch(() => [props.type, props.variant, props.colorPaletteIndex], drawPreview)
</script>

<template>
  <canvas
    ref="canvasRef"
    :width="size || 58"
    :height="size || 48"
    class="piece-preview-canvas"
  />
</template>

<style scoped>
.piece-preview-canvas {
  display: block;
}
</style>
