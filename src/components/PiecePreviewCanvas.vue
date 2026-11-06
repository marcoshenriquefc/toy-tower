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

  const baseScale = props.variant === 'GIANT' ? 0.44 : 0.38
  const sizeFactor = props.size && props.size > 64 ? props.size / 54 : 1
  const previewScale = baseScale * sizeFactor
  const cellPx = GAME_CONSTANTS.UNIT_PX * previewScale

  ctx.save()
  ctx.translate(w / 2, h / 2)

  // Outer dark contour around the piece silhouette so it pops inside the light banner box
  ctx.fillStyle = '#0F172A'
  const pad = 2.2 * Math.max(1, sizeFactor * 0.85)
  for (const c of centeredCells) {
    ctx.beginPath()
    ctx.roundRect(
      c.x * cellPx - cellPx / 2 - pad,
      c.y * cellPx - cellPx / 2 - pad,
      cellPx + pad * 2,
      cellPx + pad * 2,
      3 * Math.max(1, sizeFactor * 0.8)
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

let animFrameId: number | null = null
let lastFrameMs = 0

function syncGoldPreviewLoop() {
  if (spriteRegistry.getActiveBlockSkinId() === 'gold') {
    if (animFrameId === null) {
      const tick = (now: number) => {
        if (spriteRegistry.getActiveBlockSkinId() !== 'gold') {
          animFrameId = null
          return
        }
        if (now - lastFrameMs >= 33) {
          lastFrameMs = now
          drawPreview()
        }
        animFrameId = requestAnimationFrame(tick)
      }
      animFrameId = requestAnimationFrame(tick)
    }
  } else if (animFrameId !== null) {
    cancelAnimationFrame(animFrameId)
    animFrameId = null
  }
}

onMounted(() => {
  drawPreview()
  syncGoldPreviewLoop()
  unsubscribe = spriteRegistry.onChange(() => {
    drawPreview()
    syncGoldPreviewLoop()
  })
})

onUnmounted(() => {
  if (unsubscribe) unsubscribe()
  if (animFrameId !== null) {
    cancelAnimationFrame(animFrameId)
    animFrameId = null
  }
})

watch(
  () => [props.type, props.variant, props.colorPaletteIndex, props.size],
  () => {
    drawPreview()
    syncGoldPreviewLoop()
  }
)
</script>

<template>
  <canvas
    ref="canvasRef"
    :width="size || 58"
    :height="size ? Math.round(size * 0.82) : 48"
    class="piece-preview-canvas"
  />
</template>

<style scoped>
.piece-preview-canvas {
  display: block;
}
</style>
