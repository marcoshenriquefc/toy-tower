import { ALL_PIECE_TYPES } from './PieceCatalog'
import { PieceType, QueuedPieceSpec } from '../types/game'

/**
 * Generates a unique random match seed (e.g. `TOY-9X4K2M`) so every new match is unique.
 */
export function generateRandomMatchSeed(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  let code = ''
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
    const buf = new Uint32Array(6)
    crypto.getRandomValues(buf)
    for (let i = 0; i < 6; i++) {
      code += chars[buf[i] % chars.length]
    }
  } else {
    for (let i = 0; i < 6; i++) {
      code += chars[Math.floor(Math.random() * chars.length)]
    }
  }
  return `TOY-${code}`
}

/**
 * Hashes a string seed into a 32-bit unsigned integer for Mulberry32.
 */
export function hashSeedString(seed: string): number {
  let h = 2166136261 >>> 0
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

/**
 * Mulberry32 deterministic PRNG.
 * Guarantees every player in a multiplayer race with the same `matchSeed`
 * gets the exact same sequence of pieces and wind gusts.
 */
export function createMulberry32(seedNumber: number): () => number {
  let a = seedNumber >>> 0
  return function () {
    let t = (a += 0x6d2b79f5)
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/**
 * Deterministic 7-Bag Randomizer with support for Milestone Special Toy Pieces.
 */
export class SeededBagRandomizer {
  private prng: () => number
  private queue: QueuedPieceSpec[] = []
  public readonly matchSeed: string

  constructor(matchSeed: string) {
    this.matchSeed = matchSeed
    const numericSeed = hashSeedString(matchSeed)
    this.prng = createMulberry32(numericSeed)
    this.ensureQueueSize(14)
  }

  private lastPaletteIndex: number = -1
  private colorBag: number[] = []

  private nextColorPaletteIndex(): number {
    const colorCount = 10
    if (this.colorBag.length === 0) {
      const bag = Array.from({ length: colorCount }, (_, i) => i)
      for (let i = bag.length - 1; i > 0; i--) {
        const j = Math.floor(this.prng() * (i + 1))
        const tmp = bag[i]
        bag[i] = bag[j]
        bag[j] = tmp
      }
      if (bag[0] === this.lastPaletteIndex && bag.length > 1) {
        const swapIdx = 1 + Math.floor(this.prng() * (bag.length - 1))
        const tmp = bag[0]
        bag[0] = bag[swapIdx]
        bag[swapIdx] = tmp
      }
      this.colorBag = bag
    }
    const idx = this.colorBag.shift()!
    this.lastPaletteIndex = idx
    return idx
  }

  /**
   * Generates a new shuffled 7-bag using Fisher-Yates and the seeded PRNG.
   */
  private refillBag(): void {
    const bag: PieceType[] = [...ALL_PIECE_TYPES]
    for (let i = bag.length - 1; i > 0; i--) {
      const j = Math.floor(this.prng() * (i + 1))
      const temp = bag[i]
      bag[i] = bag[j]
      bag[j] = temp
    }

    for (const type of bag) {
      this.queue.push({
        type,
        variant: 'NORMAL',
        colorPaletteIndex: this.nextColorPaletteIndex(),
      })
    }
  }

  private ensureQueueSize(minCount: number): void {
    while (this.queue.length < minCount) {
      this.refillBag()
    }
  }

  /**
   * Pulls the next piece from the deterministic queue.
   */
  public nextPiece(): QueuedPieceSpec {
    this.ensureQueueSize(7)
    return this.queue.shift()!
  }

  /**
   * Returns a read-only copy of the upcoming `count` pieces for HUD preview.
   */
  public peekQueue(count: number = 3): QueuedPieceSpec[] {
    this.ensureQueueSize(count + 2)
    return this.queue.slice(0, count).map((item) => ({ ...item }))
  }

  /**
   * Grants a Milestone Special Toy Piece at the front of the queue
   * when crossing a 10m checkpoint (10u, 20u).
   * Uses the deterministic PRNG so all players get the same type of reward at checkpoints.
   */
  public injectCheckpointPiece(checkpointHeight: number): QueuedPieceSpec {
    const roll = this.prng()
    let special: QueuedPieceSpec

    if (roll < 0.5) {
      // Giant Piece (Duplo Mega-Bloco 2x scale, mass 16.0 — flat-base stabilizer shapes)
      const stableGiantTypes: PieceType[] = ['I', 'O', 'T', 'L', 'J']
      const typeIndex = Math.floor(this.prng() * stableGiantTypes.length)
      const type = stableGiantTypes[typeIndex]
      special = {
        type,
        variant: 'GIANT',
        colorPaletteIndex: this.nextColorPaletteIndex(),
        label: `Checkpoint ${checkpointHeight}m: Mega-Bloco "${type}" (2x)`,
      }
    } else {
      // Heavy Rubber Piece ('I' or 'O', mass 10.0, friction 2.0)
      const rubberTypes: PieceType[] = ['I', 'O']
      const type = rubberTypes[Math.floor(this.prng() * rubberTypes.length)]
      special = {
        type,
        variant: 'HEAVY_RUBBER',
        colorPaletteIndex: this.nextColorPaletteIndex(),
        label: `Checkpoint ${checkpointHeight}m: Bloco de Borracha Pesada "${type}"`,
      }
    }

    this.queue.unshift(special)
    return special
  }

  /**
   * Inserts a specific piece at the front of the queue (for testing/sandbox inspection).
   */
  public enqueueCustomPiece(spec: QueuedPieceSpec): void {
    this.queue.unshift({
      ...spec,
      colorPaletteIndex:
        spec.colorPaletteIndex !== undefined
          ? spec.colorPaletteIndex
          : this.nextColorPaletteIndex(),
    })
  }

  /**
   * Allows deterministic random numbers for wind gusts if needed.
   */
  public nextFloat(): number {
    return this.prng()
  }
}
