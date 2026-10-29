import {
  PiecePowerEffect,
  PieceType,
  PieceVariant,
  GAME_CONSTANTS,
} from '../types/game'
import type { PowerId } from '../game/PowersCatalog'

export type SpriteKey =
  | 'piece_I'
  | 'piece_O'
  | 'piece_T'
  | 'piece_L'
  | 'piece_J'
  | 'piece_S'
  | 'piece_Z'
  | 'piece_HEAVY_RUBBER'
  | 'piece_CASTLE_ROOF'
  | 'mascot_floating'
  | 'base_plate'
  | 'side_island'
  | 'scenery_pedestal'
  | 'scenery_islands'
  | 'scenery_clouds'
  | 'scenery_ocean'
  | 'bg_main'
  | 'bg_left'
  | 'bg_right'

export interface PlaceholderColorTheme {
  fill: string
  border: string
  highlight: string
  label: string
}

export interface SpriteCollisionBox {
  x: number
  y: number
  width: number
  height: number
  /** Active (col, row) cells detected inside the collision mask */
  occupiedCells?: Array<{ col: number; row: number }>
}

export interface SpriteSlot {
  key: SpriteKey
  name: string
  expectedSizeDescription: string
  spriteUrl: string | null
  collisionUrl?: string | null
  image: HTMLImageElement | null
  collisionImage?: HTMLImageElement | null
  tintedCanvas?: HTMLCanvasElement | null
  /** Pre-rendered multi-colored canvases (one per multi-color palette index 0..7) where each Lego sub-brick has its own color */
  multiColorCanvases?: HTMLCanvasElement[]
  heavyRubberCanvas?: HTMLCanvasElement | null
  staticBrickCanvas?: HTMLCanvasElement | null
  iceBrickCanvas?: HTMLCanvasElement | null
  collisionBox?: SpriteCollisionBox | null
  hasCollisionMask?: boolean
  loaded: boolean
  placeholder: PlaceholderColorTheme
}

export interface PlayerSkinInfo {
  id: string
  name: string
  shortName: string
  emoji: string
  description: string
  accentColor: string
  fileName: string
  url: string
}

interface CloudPlaceholder {
  x: number
  heightUnits: number
  width: number
  height: number
  speedFactor: number
  /** 0 = Far distance (behind side islands), 1 = Mid distance, 2 = Near background */
  layer: 0 | 1 | 2
  flipX?: boolean
}

// Auto-discover sprites in assets/sprites/ via Vite glob import
const playerSkinAssets = import.meta.glob<string>(
  '../../assets/sprites/player/*.png',
  { eager: true, import: 'default' }
)

const blockSpriteAssets = import.meta.glob<string>(
  '../../assets/sprites/block/*.png',
  { eager: true, import: 'default' }
)

const blockCollisionAssets = import.meta.glob<string>(
  '../../assets/sprites/block/colision/*.png',
  { eager: true, import: 'default' }
)

const otherSpriteAssets = import.meta.glob<string>(
  '../../assets/sprites/other/*.png',
  { eager: true, import: 'default' }
)

const backgroundSpriteAssets = import.meta.glob<string>(
  '../../assets/sprites/other/background/*.png',
  { eager: true, import: 'default' }
)

const menuSpriteAssets = import.meta.glob<string>(
  '../../assets/sprites/menu/*.png',
  { eager: true, import: 'default' }
)

function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const clean = hex.replace('#', '').trim()
  const num = parseInt(clean, 16)
  return {
    r: (num >> 16) & 255,
    g: (num >> 8) & 255,
    b: num & 255,
  }
}

/**
 * Vibrant Toy-Brick (ABS Plastic) individual sub-brick color themes.
 */
const TOY_BRICK_COLORS: Record<string, PlaceholderColorTheme> = {
  BLUE: {
    fill: '#0095FF',
    border: '#004A8F',
    highlight: '#80CAFF',
    label: 'Azul Vivo',
  },
  YELLOW: {
    fill: '#FFD000',
    border: '#997300',
    highlight: '#FFF08A',
    label: 'Amarelo Sol',
  },
  RED: {
    fill: '#EF4444',
    border: '#7F1D1D',
    highlight: '#FCA5A5',
    label: 'Vermelho Vivo',
  },
  GREEN: {
    fill: '#22C55E',
    border: '#14532D',
    highlight: '#86EFAC',
    label: 'Verde Esmeralda',
  },
  ORANGE: {
    fill: '#FF6D00',
    border: '#9A3412',
    highlight: '#FDBA74',
    label: 'Laranja Vibrante',
  },
  PURPLE: {
    fill: '#9333EA',
    border: '#4C1D95',
    highlight: '#D8B4FE',
    label: 'Roxo Mágico',
  },
  PINK: {
    fill: '#EC4899',
    border: '#831843',
    highlight: '#F9A8D4',
    label: 'Rosa Chiclete',
  },
  TEAL: {
    fill: '#06B6D4',
    border: '#155E75',
    highlight: '#A5F3FC',
    label: 'Turquesa',
  },
  LIME: {
    fill: '#84CC16',
    border: '#365314',
    highlight: '#D9F99D',
    label: 'Verde Limão',
  },
  INDIGO: {
    fill: '#3B82F6',
    border: '#1E3A8A',
    highlight: '#93C5FD',
    label: 'Azul Real',
  },
}

/**
 * 10 Vibrant Solid Toy-Brick Colors so any piece shape (`I, O, T, L, J, S, Z`) can be painted
 * in any of the 10 colors (1 solid color per piece, with each spawned piece having a different color).
 */
export const PIECE_COLOR_PALETTE: PlaceholderColorTheme[] = [
  TOY_BRICK_COLORS.BLUE,
  TOY_BRICK_COLORS.YELLOW,
  TOY_BRICK_COLORS.RED,
  TOY_BRICK_COLORS.GREEN,
  TOY_BRICK_COLORS.ORANGE,
  TOY_BRICK_COLORS.PURPLE,
  TOY_BRICK_COLORS.PINK,
  TOY_BRICK_COLORS.TEAL,
  TOY_BRICK_COLORS.LIME,
  TOY_BRICK_COLORS.INDIGO,
]

const DEFAULT_PALETTE_BY_TYPE: Record<PieceType, number> = {
  I: 0, // Azul Vivo
  O: 1, // Amarelo Sol
  T: 5, // Roxo Mágico
  L: 4, // Laranja Vibrante
  J: 9, // Azul Real
  S: 3, // Verde Esmeralda
  Z: 2, // Vermelho Vivo
}

/**
 * Central Sprite Registry, Collision Mask Analyzer & Dynamic Grayscale Colorizer.
 */
export class SpriteRegistry {
  private slots: Map<SpriteKey, SpriteSlot> = new Map()
  public forcePlaceholders: boolean = false
  public dynamicTintEnabled: boolean = true
  private clouds: CloudPlaceholder[] = []
  private lastCloudTimeMs: number = 0
  private cloudWindDriftPx: number = 0
  private currentCloudWindVel: number = 6.5
  private playerSkins: PlayerSkinInfo[] = []
  private playerSkinImages: Map<string, HTMLImageElement> = new Map()
  private activePlayerSkinId: string = 'player_mage'
  private listeners: Array<() => void> = []

  constructor() {
    this.initDefaultSlots()
    this.initClouds()
    this.initBundledAssets()
  }

  public onChange(listener: () => void): () => void {
    this.listeners.push(listener)
    return () => {
      this.listeners = this.listeners.filter((l) => l !== listener)
    }
  }

  private notifyListeners(): void {
    for (const l of this.listeners) {
      l()
    }
  }

  private initClouds(): void {
    const presets: CloudPlaceholder[] = [
      // Low-to-mid sky clouds (immediately visible in the blue sky from the start of the match)
      { x: -520, heightUnits: 10, width: 135, height: 34, speedFactor: 0.34, layer: 0, flipX: true },
      { x: 240,  heightUnits: 12, width: 145, height: 36, speedFactor: 0.38, layer: 0 },
      { x: -290, heightUnits: 13, width: 185, height: 44, speedFactor: 0.62, layer: 1 },
      { x: 440,  heightUnits: 14, width: 175, height: 42, speedFactor: 0.68, layer: 1, flipX: true },
      { x: -80,  heightUnits: 16, width: 230, height: 54, speedFactor: 0.95, layer: 2 },
      { x: -610, heightUnits: 17, width: 125, height: 32, speedFactor: 0.32, layer: 0 },
      { x: 560,  heightUnits: 18, width: 215, height: 50, speedFactor: 0.90, layer: 2, flipX: true },

      // Mid-to-high altitude clouds (revealed as the tower climbs toward 30m)
      { x: -380, heightUnits: 21, width: 150, height: 38, speedFactor: 0.40, layer: 0, flipX: true },
      { x: 160,  heightUnits: 22, width: 195, height: 46, speedFactor: 0.65, layer: 1 },
      { x: -180, heightUnits: 25, width: 255, height: 58, speedFactor: 1.00, layer: 2, flipX: true },
      { x: 460,  heightUnits: 27, width: 140, height: 35, speedFactor: 0.36, layer: 0 },
      { x: -490, heightUnits: 29, width: 205, height: 48, speedFactor: 0.72, layer: 1 },
      { x: 290,  heightUnits: 31, width: 245, height: 56, speedFactor: 0.92, layer: 2 },
      { x: -90,  heightUnits: 34, width: 160, height: 40, speedFactor: 0.42, layer: 0, flipX: true },
      { x: 380,  heightUnits: 36, width: 200, height: 48, speedFactor: 0.66, layer: 1, flipX: true },
      { x: -340, heightUnits: 39, width: 260, height: 60, speedFactor: 0.98, layer: 2 },
    ]
    this.clouds = presets
  }

  private initDefaultSlots(): void {
    const definitions: SpriteSlot[] = [
      {
        key: 'piece_I',
        name: 'Peça "I" (A Viga Longa — Azul)',
        expectedSizeDescription: '256x64px (Colisão Total 4x1)',
        spriteUrl: null,
        image: null,
        loaded: false,
        placeholder: {
          fill: '#0095FF',
          border: '#004A8F',
          highlight: '#80CAFF',
          label: 'Azul Sólido',
        },
      },
      {
        key: 'piece_O',
        name: 'Peça "O" (O Bloco 2x2 — Amarelo)',
        expectedSizeDescription: '128x135px (Colisão 128x128 + Pinos)',
        spriteUrl: null,
        image: null,
        loaded: false,
        placeholder: {
          fill: '#FFD000',
          border: '#997300',
          highlight: '#FFF08A',
          label: 'Amarelo Sólido',
        },
      },
      {
        key: 'piece_T',
        name: 'Peça "T" (O Conector em T — Roxo)',
        expectedSizeDescription: '192x136px (Colisão 192x128 + Pinos)',
        spriteUrl: null,
        image: null,
        loaded: false,
        placeholder: {
          fill: '#9333EA',
          border: '#4C1D95',
          highlight: '#D8B4FE',
          label: 'Roxo Sólido',
        },
      },
      {
        key: 'piece_L',
        name: 'Peça "L" (A Cantoneira Direita — Laranja)',
        expectedSizeDescription: '200x128px (Colisão 192x128 + Pinos)',
        spriteUrl: null,
        image: null,
        loaded: false,
        placeholder: {
          fill: '#FF6D00',
          border: '#9A3412',
          highlight: '#FDBA74',
          label: 'Laranja Sólido',
        },
      },
      {
        key: 'piece_J',
        name: 'Peça "J" (A Cantoneira Esquerda — Azul Escuro)',
        expectedSizeDescription: '200x128px (Colisão 192x128 + Pinos)',
        spriteUrl: null,
        image: null,
        loaded: false,
        placeholder: {
          fill: '#2563EB',
          border: '#1E3A8A',
          highlight: '#93C5FD',
          label: 'Azul Escuro Sólido',
        },
      },
      {
        key: 'piece_S',
        name: 'Peça "S" (O Degrau Direito — Verde Claro)',
        expectedSizeDescription: '192x137px (Colisão 192x128 + Pinos)',
        spriteUrl: null,
        image: null,
        loaded: false,
        placeholder: {
          fill: '#22C55E',
          border: '#14532D',
          highlight: '#86EFAC',
          label: 'Verde Claro Sólido',
        },
      },
      {
        key: 'piece_Z',
        name: 'Peça "Z" (O Degrau Esquerdo — Vermelho Vivo)',
        expectedSizeDescription: '192x137px (Colisão 192x128 + Pinos)',
        spriteUrl: null,
        image: null,
        loaded: false,
        placeholder: {
          fill: '#EF4444',
          border: '#7F1D1D',
          highlight: '#FCA5A5',
          label: 'Vermelho Vivo Sólido',
        },
      },
      {
        key: 'piece_HEAVY_RUBBER',
        name: 'Peça Especial (Borracha Pesada / Chumbo)',
        expectedSizeDescription: 'Usa Sprite I/O colorido em Chumbo',
        spriteUrl: null,
        image: null,
        loaded: false,
        placeholder: {
          fill: '#4B5563',
          border: '#1F2937',
          highlight: '#9CA3AF',
          label: 'Cinza Chumbo Sólido',
        },
      },
      {
        key: 'piece_CASTLE_ROOF',
        name: '🏰 Telhado de Castelo (Peça Final de Vitória 3x3)',
        expectedSizeDescription: '192x192px (Base 3x3 unidades c/ Ameias e Bandeira)',
        spriteUrl: null,
        image: null,
        loaded: true,
        placeholder: {
          fill: '#DC2626',
          border: '#450A0A',
          highlight: '#FCA5A5',
          label: 'Telhado Castelo Real (3x3)',
        },
      },
      {
        key: 'mascot_floating',
        name: 'Player / Mascote Flutuante (Skin Atual)',
        expectedSizeDescription: '192x192px (assets/sprites/player)',
        spriteUrl: null,
        image: null,
        loaded: false,
        placeholder: {
          fill: '#2563EB',
          border: '#1E1B4B',
          highlight: '#FFFFFF',
          label: 'Mago (player_mage)',
        },
      },
      {
        key: 'base_plate',
        name: 'Placa Base Fixa Verde (6x1 unidades)',
        expectedSizeDescription: '192x32px (6x1 unidades @ 32px)',
        spriteUrl: null,
        image: null,
        loaded: false,
        placeholder: {
          fill: '#16A34A',
          border: '#052E16',
          highlight: '#4ADE80',
          label: 'Verde Placa Base',
        },
      },
      {
        key: 'side_island',
        name: 'Poder 4: Ilha Flutuante Lateral (2.5x1.5 unidades)',
        expectedSizeDescription: '80x48px (2.5x1.5 unidades @ 32px)',
        spriteUrl: null,
        image: null,
        loaded: false,
        placeholder: {
          fill: '#22C55E',
          border: '#052E16',
          highlight: '#86EFAC',
          label: 'Ilha Auxiliar 2.5x1.5',
        },
      },
      {
        key: 'scenery_pedestal',
        name: 'Cenário: Casinha / Pedestal da Base (Tricky Towers)',
        expectedSizeDescription: '208x96px (Abaixo da Placa Base)',
        spriteUrl: null,
        image: null,
        loaded: false,
        placeholder: {
          fill: '#E15B7E',
          border: '#3B234A',
          highlight: '#F48FB1',
          label: 'Pedestal Placeholder',
        },
      },
      {
        key: 'scenery_islands',
        name: 'Cenário: Ilhas e Colinas Laterais',
        expectedSizeDescription: 'Camada Parallax Lateral',
        spriteUrl: null,
        image: null,
        loaded: false,
        placeholder: {
          fill: '#60C679',
          border: '#3D7A5A',
          highlight: '#9AE682',
          label: 'Ilhas Placeholder',
        },
      },
      {
        key: 'scenery_clouds',
        name: 'Cenário: Nuvens Estilizadas',
        expectedSizeDescription: 'Sprites de Nuvens (Camadas)',
        spriteUrl: null,
        image: null,
        loaded: false,
        placeholder: {
          fill: '#EBF3FF',
          border: '#8AAEE8',
          highlight: '#FFFFFF',
          label: 'Nuvens Placeholder',
        },
      },
      {
        key: 'scenery_ocean',
        name: 'Cenário: Oceano / Nível do Mar (Abismo)',
        expectedSizeDescription: 'Faixa Horizontal Inferior',
        spriteUrl: null,
        image: null,
        loaded: false,
        placeholder: {
          fill: '#4E6BBF',
          border: '#364C96',
          highlight: '#7B99E8',
          label: 'Oceano Placeholder',
        },
      },
      {
        key: 'bg_main',
        name: 'Cenário Parallax: Fundo Principal (bg_1.png)',
        expectedSizeDescription: '2752x1536px (Céu, Nuvens e Mar — Camada Distante)',
        spriteUrl: null,
        image: null,
        loaded: false,
        placeholder: {
          fill: '#3B82F6',
          border: '#1D4ED8',
          highlight: '#93C5FD',
          label: 'Fundo Principal (bg_1)',
        },
      },
      {
        key: 'bg_left',
        name: 'Cenário Parallax: Ilha Esquerda (bg_left_2.png)',
        expectedSizeDescription: '551x702px (Transparência + Tom Azulado de Profundidade)',
        spriteUrl: null,
        image: null,
        loaded: false,
        placeholder: {
          fill: '#60A5FA',
          border: '#2563EB',
          highlight: '#BFDBFE',
          label: 'Ilha Esq. Parallax (bg_left_2)',
        },
      },
      {
        key: 'bg_right',
        name: 'Cenário Parallax: Ilha Direita (bg_right_2.png)',
        expectedSizeDescription: '667x729px (Transparência + Tom Azulado de Profundidade)',
        spriteUrl: null,
        image: null,
        loaded: false,
        placeholder: {
          fill: '#60A5FA',
          border: '#2563EB',
          highlight: '#BFDBFE',
          label: 'Ilha Dir. Parallax (bg_right_2)',
        },
      },
    ]

    for (const def of definitions) {
      this.slots.set(def.key, def)
    }
  }

  /**
   * Automatically loads all player skins from `assets/sprites/player`
   * and all block sprites + collision masks from `assets/sprites/block`.
   */
  private initBundledAssets(): void {
    // 1. Discover & Catalog Player Skins in assets/sprites/player/*.png
    const skinCatalogMeta: Record<
      string,
      {
        name: string
        shortName: string
        emoji: string
        description: string
        accentColor: string
        order: number
      }
    > = {
      player_mage: {
        name: '🧙‍♂️ Mago Estelar',
        shortName: 'Mago',
        emoji: '🧙‍♂️',
        description: 'Mestre das torres mágicas e feitiços de equilíbrio',
        accentColor: '#818CF8',
        order: 1,
      },
      player_dino: {
        name: '🦖 Dino Explorador',
        shortName: 'Dino',
        emoji: '🦖',
        description: 'Explorador jurássico com chapéu de safári e osso da sorte',
        accentColor: '#4ADE80',
        order: 2,
      },
      player_pirate: {
        name: '🏴‍☠️ Capitão Pirata',
        shortName: 'Pirata',
        emoji: '🏴‍☠️',
        description: 'Corsário dos mares flutuantes com sabre afiado',
        accentColor: '#F87171',
        order: 3,
      },
      player_shadow: {
        name: '🧪 Mago das Sombras',
        shortName: 'Sombra',
        emoji: '🧪',
        description: 'Alquimista sombrio com poções arcanas esmeralda',
        accentColor: '#C084FC',
        order: 4,
      },
    }

    const discoveredSkins: Array<PlayerSkinInfo & { order: number }> = []

    for (const [path, url] of Object.entries(playerSkinAssets)) {
      const fileName = path.split('/').pop() || path
      const id = fileName.replace(/\.png$/i, '')
      const lowerId = id.toLowerCase()
      const meta = skinCatalogMeta[lowerId]
      const fallbackLabel = id
        .replace(/^player_/i, '')
        .replace(/_/g, ' ')
        .replace(/\b\w/g, (c) => c.toUpperCase())

      discoveredSkins.push({
        id,
        name: meta ? meta.name : `✨ ${fallbackLabel}`,
        shortName: meta ? meta.shortName : fallbackLabel,
        emoji: meta ? meta.emoji : '✨',
        description: meta
          ? meta.description
          : `Skin customizada (${fileName})`,
        accentColor: meta ? meta.accentColor : '#38BDF8',
        fileName,
        url,
        order: meta ? meta.order : 99,
      })

      // Preload HTMLImageElement for instant zero-flicker skin switching
      const preloadImg = new Image()
      preloadImg.crossOrigin = 'anonymous'
      preloadImg.onload = () => {
        this.playerSkinImages.set(id, preloadImg)
        if (this.activePlayerSkinId === id) {
          const mascotSlot = this.getSlot('mascot_floating')
          mascotSlot.image = preloadImg
          mascotSlot.loaded = true
          this.notifyListeners()
        }
      }
      preloadImg.src = url
    }

    discoveredSkins.sort((a, b) => a.order - b.order || a.name.localeCompare(b.name))
    this.playerSkins = discoveredSkins.map(({ order: _order, ...skin }) => skin)

    // Restore persisted skin or default to player_mage
    let savedSkinId: string | null = null
    try {
      savedSkinId = window.localStorage.getItem('toy_tower_player_skin')
    } catch {
      savedSkinId = null
    }

    const initialSkin =
      (savedSkinId && this.playerSkins.find((s) => s.id === savedSkinId)) ||
      this.playerSkins.find((s) => s.id.toLowerCase() === 'player_mage') ||
      this.playerSkins[0]

    if (initialSkin) {
      this.setActivePlayerSkin(initialSkin.id)
    }

    // 2. Discover Block Sprites & Collision Masks in assets/sprites/block
    const blockUrlByType = new Map<PieceType, string>()
    for (const [path, url] of Object.entries(blockSpriteAssets)) {
      const fileName = path.split('/').pop() || ''
      const baseName = fileName.replace(/\.png$/i, '').toUpperCase()
      if (['I', 'O', 'T', 'L', 'J', 'S', 'Z'].includes(baseName)) {
        blockUrlByType.set(baseName as PieceType, url)
      }
    }

    const collisionUrlByType = new Map<PieceType, string>()
    for (const [path, url] of Object.entries(blockCollisionAssets)) {
      const fileName = path.split('/').pop() || ''
      const match = fileName.match(/^([a-zA-Z])_col+ision\.png$/i)
      if (match) {
        const typeKey = match[1].toUpperCase() as PieceType
        if (['I', 'O', 'T', 'L', 'J', 'S', 'Z'].includes(typeKey)) {
          collisionUrlByType.set(typeKey, url)
        }
      }
    }

    const allTypes: PieceType[] = ['I', 'O', 'T', 'L', 'J', 'S', 'Z']
    for (const t of allTypes) {
      const spriteUrl = blockUrlByType.get(t)
      const colUrl = collisionUrlByType.get(t) || null
      if (spriteUrl) {
        this.registerBlockWithCollision(`piece_${t}` as SpriteKey, spriteUrl, colUrl)
      }
    }

    // 3. Discover Special Sprites in assets/sprites/other (e.g. base.png, castle_roof.png, side_island.png)
    for (const [path, url] of Object.entries(otherSpriteAssets)) {
      const fileName = (path.split('/').pop() || '').toLowerCase()
      if (fileName === 'base.png') {
        this.registerSprite('base_plate', url)
        this.registerSprite('scenery_pedestal', url)
      } else if (fileName === 'castle_roof.png') {
        this.registerSprite('piece_CASTLE_ROOF', url)
      } else if (fileName === 'side_island.png') {
        this.registerSprite('side_island', url)
      }
    }

    // 4. Discover Parallax Background Sprites in assets/sprites/other/background (bg_1.png, bg_left_2.png, bg_right_2.png)
    for (const [path, url] of Object.entries(backgroundSpriteAssets)) {
      const fileName = (path.split('/').pop() || '').toLowerCase()
      if (fileName === 'bg_1.png') {
        this.registerSprite('bg_main', url)
      } else if (fileName.startsWith('bg_left')) {
        this.registerSprite('bg_left', url)
      } else if (fileName.startsWith('bg_right')) {
        this.registerSprite('bg_right', url)
      }
    }

    // 5. Discover Menu Sprites in assets/sprites/menu (logo.png, screen_local.png, screen_multiplayer.png, screen_skins.png, screen_option.png, button_clean.png, etc.)
    for (const [path, url] of Object.entries(menuSpriteAssets)) {
      const fileName = path.split('/').pop() || path
      const key = fileName.replace(/\.png$/i, '').toLowerCase()
      this.menuSprites[key] = url
    }

    if (this.menuSprites.button_clean) {
      this.menuSprites.button_clean_green = this.menuSprites.button_clean
      this.menuSprites.button_clean_orange = this.menuSprites.button_clean
      this.menuSprites.button_clean_yellow = this.menuSprites.button_clean

      const btnImg = new Image()
      btnImg.crossOrigin = 'anonymous'
      btnImg.onload = () => {
        const greenCanvas = this.createTintedBlockCanvas(btnImg, {
          fill: '#55A838',
          border: '#1B2230',
          highlight: '#92E870',
          label: 'Botão Verde',
        })
        const orangeCanvas = this.createTintedBlockCanvas(btnImg, {
          fill: '#F97316',
          border: '#1B2230',
          highlight: '#FDBA74',
          label: 'Botão Laranja',
        })
        const yellowCanvas = this.createTintedBlockCanvas(btnImg, {
          fill: '#F59E0B',
          border: '#1B2230',
          highlight: '#FDE047',
          label: 'Botão Amarelo',
        })
        if (greenCanvas) {
          this.menuSprites.button_clean_green = greenCanvas.toDataURL('image/png')
        }
        if (orangeCanvas) {
          this.menuSprites.button_clean_orange = orangeCanvas.toDataURL('image/png')
        }
        if (yellowCanvas) {
          this.menuSprites.button_clean_yellow = yellowCanvas.toDataURL('image/png')
        }
        this.notifyListeners()
      }
      btnImg.src = this.menuSprites.button_clean
    }
  }

  private menuSprites: Record<string, string> = {}

  public getMenuSprites(): Record<string, string> {
    return this.menuSprites
  }

  /**
   * Picks 2 distinct random player skin IDs from the available skins in `assets/sprites/player`.
   */
  public pickTwoRandomPlayerSkins(): [string, string] {
    const skins = this.playerSkins
    if (skins.length === 0) return ['player_mage', 'player_dino']
    if (skins.length === 1) return [skins[0].id, skins[0].id]
    const indices = skins.map((_, idx) => idx)
    for (let i = indices.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1))
      const tmp = indices[i]
      indices[i] = indices[j]
      indices[j] = tmp
    }
    return [skins[indices[0]].id, skins[indices[1]].id]
  }

  public getPlayerSkins(): PlayerSkinInfo[] {
    return this.playerSkins
  }

  public getActivePlayerSkinId(): string {
    return this.activePlayerSkinId
  }

  public getActivePlayerSkin(): PlayerSkinInfo | null {
    return (
      this.playerSkins.find((s) => s.id === this.activePlayerSkinId) ||
      this.playerSkins[0] ||
      null
    )
  }

  public setActivePlayerSkin(skinId: string): void {
    const skin = this.playerSkins.find((s) => s.id === skinId)
    if (!skin) return
    this.activePlayerSkinId = skin.id
    try {
      window.localStorage.setItem('toy_tower_player_skin', skin.id)
    } catch {
      // Ignore storage errors
    }

    const mascotSlot = this.getSlot('mascot_floating')
    mascotSlot.placeholder.label = skin.name
    mascotSlot.placeholder.fill = skin.accentColor

    const cachedImg = this.playerSkinImages.get(skin.id)
    if (cachedImg && cachedImg.complete && cachedImg.naturalWidth > 0) {
      mascotSlot.image = cachedImg
      mascotSlot.loaded = true
      this.notifyListeners()
    } else {
      this.registerSprite('mascot_floating', skin.url)
    }
  }

  public cycleNextPlayerSkin(): PlayerSkinInfo | null {
    if (this.playerSkins.length === 0) return null
    const currentIndex = this.playerSkins.findIndex(
      (s) => s.id === this.activePlayerSkinId
    )
    const nextIndex = (currentIndex + 1) % this.playerSkins.length
    const nextSkin = this.playerSkins[nextIndex]
    this.setActivePlayerSkin(nextSkin.id)
    return nextSkin
  }

  public setDynamicTintEnabled(enabled: boolean): void {
    this.dynamicTintEnabled = enabled
    this.rebuildAllTintedCanvases()
    this.notifyListeners()
  }

  public rebuildAllTintedCanvases(): void {
    const heavyTheme = this.getSlot('piece_HEAVY_RUBBER').placeholder
    const staticTheme: PlaceholderColorTheme = {
      fill: '#475569',
      border: '#0F172A',
      highlight: '#E2E8F0',
      label: 'Bloco de Ferro (Estático)',
    }
    const iceTheme: PlaceholderColorTheme = {
      fill: '#22D3EE',
      border: '#0284C7',
      highlight: '#E0F2FE',
      label: 'Bloco de Gelo (Azul Ciano)',
    }
    for (const slot of this.slots.values()) {
      if (
        slot.key.startsWith('piece_') &&
        slot.key !== 'piece_CASTLE_ROOF' &&
        slot.image
      ) {
        const pieceType = slot.key.replace('piece_', '') as PieceType
        if (pieceType in DEFAULT_PALETTE_BY_TYPE) {
          slot.multiColorCanvases = PIECE_COLOR_PALETTE.map((colorTheme) =>
            this.createTintedBlockCanvas(slot.image!, colorTheme)
          )
          slot.tintedCanvas =
            slot.multiColorCanvases[DEFAULT_PALETTE_BY_TYPE[pieceType]] ||
            this.createTintedBlockCanvas(slot.image, slot.placeholder)
        } else {
          slot.tintedCanvas = this.createTintedBlockCanvas(
            slot.image,
            slot.placeholder
          )
        }
        slot.staticBrickCanvas = this.createTintedBlockCanvas(
          slot.image,
          staticTheme
        )
        slot.iceBrickCanvas = this.createTintedBlockCanvas(
          slot.image,
          iceTheme
        )
        if (slot.key === 'piece_I' || slot.key === 'piece_O') {
          slot.heavyRubberCanvas = this.createTintedBlockCanvas(
            slot.image,
            heavyTheme
          )
        }
      } else if (
        (slot.key === 'bg_left' || slot.key === 'bg_right') &&
        slot.image
      ) {
        slot.tintedCanvas = this.createBluishDepthCanvas(slot.image)
      }
    }
  }

  /**
   * Creates an offscreen canvas for side background islands (`bg_left_2.png` and `bg_right_2.png`)
   * with a light bluish atmospheric tint (`camada leve de tom azulado`) strictly over the sprite's
   * pixels while preserving the original PNG transparency and smooth bottom alpha fade.
   */
  private createBluishDepthCanvas(img: HTMLImageElement): HTMLCanvasElement {
    const w = img.naturalWidth || img.width
    const h = img.naturalHeight || img.height
    const canvas = document.createElement('canvas')
    canvas.width = w
    canvas.height = h
    const ctx = canvas.getContext('2d')
    if (!ctx) return canvas

    // 1. Base island artwork
    ctx.drawImage(img, 0, 0, w, h)

    // 2. Subtle color-mode shift toward sky-blue for aerial perspective
    ctx.globalCompositeOperation = 'color'
    ctx.fillStyle = 'rgba(56, 152, 248, 0.20)'
    ctx.fillRect(0, 0, w, h)

    // 3. Light bluish atmospheric glaze (stronger near the misty horizon base)
    ctx.globalCompositeOperation = 'source-atop'
    const blueHazeGrad = ctx.createLinearGradient(0, 0, 0, h)
    blueHazeGrad.addColorStop(0, 'rgba(88, 168, 252, 0.16)')
    blueHazeGrad.addColorStop(0.65, 'rgba(105, 182, 255, 0.22)')
    blueHazeGrad.addColorStop(1, 'rgba(135, 202, 255, 0.30)')
    ctx.fillStyle = blueHazeGrad
    ctx.fillRect(0, 0, w, h)

    // 4. Restore exact original per-pixel alpha mask (including soft bottom fade)
    ctx.globalCompositeOperation = 'destination-in'
    ctx.drawImage(img, 0, 0, w, h)

    ctx.globalCompositeOperation = 'source-over'
    return canvas
  }

  /**
   * High-contrast 3-Point Luminance Colorizer (`border -> fill -> highlight`)
   * anchored at the exported grey block's base luminance (`160`).
   * Preserves dark contours (`lum ~ 96`), inner bevel shadows (`lum ~ 130`),
   * vibrant pure fill (`lum = 160`), and glossy plastic highlights (`lum ~ 195`).
   */
  private createTintedBlockCanvas(
    img: HTMLImageElement,
    theme: PlaceholderColorTheme
  ): HTMLCanvasElement {
    const w = img.naturalWidth || img.width
    const h = img.naturalHeight || img.height
    const canvas = document.createElement('canvas')
    canvas.width = w
    canvas.height = h
    const ctx = canvas.getContext('2d')
    if (!ctx) return canvas

    ctx.drawImage(img, 0, 0, w, h)
    if (!this.dynamicTintEnabled) {
      return canvas
    }

    const imageData = ctx.getImageData(0, 0, w, h)
    const data = imageData.data

    // Check if the sprite is grayscale (if the user uploads a pre-colored image, keep its colors)
    let satSum = 0
    let opaqueCount = 0
    for (let i = 0; i < data.length; i += 16) {
      const a = data[i + 3]
      if (a > 128) {
        const r = data[i]
        const g = data[i + 1]
        const b = data[i + 2]
        satSum += Math.max(r, g, b) - Math.min(r, g, b)
        opaqueCount++
      }
    }
    const avgSat = opaqueCount > 0 ? satSum / opaqueCount : 0
    if (avgSat > 22) {
      return canvas
    }

    const borderRgb = hexToRgb(theme.border)
    const fillRgb = hexToRgb(theme.fill)
    const highlightRgb = hexToRgb(theme.highlight)

    // Precompute 256-entry LUT for ultra-fast pixel remapping
    const lutR = new Uint8Array(256)
    const lutG = new Uint8Array(256)
    const lutB = new Uint8Array(256)

    const minShadowLum = 96
    const baseBodyLum = 160
    const maxGlossLum = 196

    for (let lum = 0; lum < 256; lum++) {
      if (lum <= baseBodyLum) {
        const t = Math.max(
          0,
          Math.min(1, (lum - minShadowLum) / (baseBodyLum - minShadowLum))
        )
        // Smoothstep blend from border shade to vibrant fill color
        const smoothT = t * t * (3 - 2 * t)
        lutR[lum] = Math.round(borderRgb.r + (fillRgb.r - borderRgb.r) * smoothT)
        lutG[lum] = Math.round(borderRgb.g + (fillRgb.g - borderRgb.g) * smoothT)
        lutB[lum] = Math.round(borderRgb.b + (fillRgb.b - borderRgb.b) * smoothT)
      } else {
        const t = Math.max(
          0,
          Math.min(1, (lum - baseBodyLum) / (maxGlossLum - baseBodyLum))
        )
        lutR[lum] = Math.round(fillRgb.r + (highlightRgb.r - fillRgb.r) * t)
        lutG[lum] = Math.round(fillRgb.g + (highlightRgb.g - fillRgb.g) * t)
        lutB[lum] = Math.round(fillRgb.b + (highlightRgb.b - fillRgb.b) * t)
      }
    }

    for (let i = 0; i < data.length; i += 4) {
      const a = data[i + 3]
      if (a === 0) continue
      const lum = (data[i] + data[i + 1] + data[i + 2]) / 3 | 0
      data[i] = lutR[lum]
      data[i + 1] = lutG[lum]
      data[i + 2] = lutB[lum]
    }

    ctx.putImageData(imageData, 0, 0)
    return canvas
  }

  /**
   * Scans the `NOMEDAPEÇA_COLISION.png` image to find the exact physical collision rectangle
   * inside the sprite image (excluding decorative pins/studs outside the mask),
   * and detects which grid cells are occupied.
   */
  private analyzeCollisionMask(
    colImg: HTMLImageElement,
    spriteImg: HTMLImageElement
  ): SpriteCollisionBox {
    const w = colImg.naturalWidth || spriteImg.naturalWidth
    const h = colImg.naturalHeight || spriteImg.naturalHeight
    const canvas = document.createElement('canvas')
    canvas.width = w
    canvas.height = h
    const ctx = canvas.getContext('2d')
    if (!ctx) {
      return { x: 0, y: 0, width: w, height: h }
    }

    ctx.drawImage(colImg, 0, 0, w, h)
    const data = ctx.getImageData(0, 0, w, h).data

    let minX = w
    let minY = h
    let maxX = -1
    let maxY = -1

    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const idx = (y * w + x) * 4
        const alpha = data[idx + 3]
        if (alpha > 20) {
          if (x < minX) minX = x
          if (y < minY) minY = y
          if (x > maxX) maxX = x
          if (y > maxY) maxY = y
        }
      }
    }

    if (maxX < minX || maxY < minY) {
      return { x: 0, y: 0, width: w, height: h }
    }

    const boxW = maxX - minX + 1
    const boxH = maxY - minY + 1

    // Sample 64px (or proportional) grid cells inside the collision box
    const unitPx = Math.round(Math.min(boxW, boxH) >= 120 ? 64 : 32)
    const cols = Math.max(1, Math.round(boxW / unitPx))
    const rows = Math.max(1, Math.round(boxH / unitPx))
    const occupiedCells: Array<{ col: number; row: number }> = []

    const cellW = boxW / cols
    const cellH = boxH / rows
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const sampleX = Math.min(w - 1, Math.floor(minX + (c + 0.5) * cellW))
        const sampleY = Math.min(h - 1, Math.floor(minY + (r + 0.5) * cellH))
        const alpha = data[(sampleY * w + sampleX) * 4 + 3]
        if (alpha > 128) {
          occupiedCells.push({ col: c, row: r })
        }
      }
    }

    return {
      x: minX,
      y: minY,
      width: boxW,
      height: boxH,
      occupiedCells,
    }
  }

  public registerBlockWithCollision(
    key: SpriteKey,
    spriteUrl: string,
    collisionUrl: string | null
  ): Promise<void> {
    const slot = this.slots.get(key)
    if (!slot) return Promise.resolve()

    slot.spriteUrl = spriteUrl
    slot.collisionUrl = collisionUrl
    slot.loaded = false

    const loadImg = (url: string): Promise<HTMLImageElement> =>
      new Promise((resolve, reject) => {
        const img = new Image()
        img.onload = () => resolve(img)
        img.onerror = reject
        img.src = url
      })

    return Promise.all([
      loadImg(spriteUrl),
      collisionUrl ? loadImg(collisionUrl).catch(() => null) : Promise.resolve(null),
    ]).then(([spriteImg, colImg]) => {
      slot.image = spriteImg
      slot.collisionImage = colImg
      slot.loaded = true

      if (colImg) {
        slot.collisionBox = this.analyzeCollisionMask(colImg, spriteImg)
        slot.hasCollisionMask = true
      } else {
        // Pieces without a collision file use their entire image space as collision
        slot.collisionBox = {
          x: 0,
          y: 0,
          width: spriteImg.naturalWidth || spriteImg.width,
          height: spriteImg.naturalHeight || spriteImg.height,
        }
        slot.hasCollisionMask = false
      }

      const pieceType = key.replace('piece_', '') as PieceType
      if (pieceType in DEFAULT_PALETTE_BY_TYPE) {
        slot.multiColorCanvases = PIECE_COLOR_PALETTE.map((colorTheme) =>
          this.createTintedBlockCanvas(spriteImg, colorTheme)
        )
        slot.tintedCanvas =
          slot.multiColorCanvases[DEFAULT_PALETTE_BY_TYPE[pieceType]] ||
          this.createTintedBlockCanvas(spriteImg, slot.placeholder)
      } else {
        slot.tintedCanvas = this.createTintedBlockCanvas(
          spriteImg,
          slot.placeholder
        )
      }
      slot.staticBrickCanvas = this.createTintedBlockCanvas(spriteImg, {
        fill: '#475569',
        border: '#0F172A',
        highlight: '#E2E8F0',
        label: 'Bloco de Ferro (Estático)',
      })
      slot.iceBrickCanvas = this.createTintedBlockCanvas(spriteImg, {
        fill: '#22D3EE',
        border: '#0284C7',
        highlight: '#E0F2FE',
        label: 'Bloco de Gelo (Azul Ciano)',
      })
      if (key === 'piece_I' || key === 'piece_O') {
        const heavyTheme = this.getSlot('piece_HEAVY_RUBBER').placeholder
        slot.heavyRubberCanvas = this.createTintedBlockCanvas(
          spriteImg,
          heavyTheme
        )
        // Mark piece_HEAVY_RUBBER slot as loaded since it uses I/O tinted in gunmetal
        const heavySlot = this.getSlot('piece_HEAVY_RUBBER')
        heavySlot.loaded = true
      }

      this.notifyListeners()
    })
  }

  public getSlot(key: SpriteKey): SpriteSlot {
    return this.slots.get(key)!
  }

  public getAllSlots(): SpriteSlot[] {
    return Array.from(this.slots.values())
  }

  public getPieceSlot(type: PieceType, variant: PieceVariant): SpriteSlot {
    if (variant === 'HEAVY_RUBBER') {
      const heavySlot = this.getSlot('piece_HEAVY_RUBBER')
      if (heavySlot.image) {
        return heavySlot
      }
      // Fallback to the shape's own slot ('piece_I' or 'piece_O') which holds heavyRubberCanvas
      return this.getSlot(`piece_${type}` as SpriteKey)
    }
    return this.getSlot(`piece_${type}` as SpriteKey)
  }

  public registerSprite(key: SpriteKey, url: string): Promise<void> {
    const slot = this.slots.get(key)
    if (!slot) return Promise.resolve()

    slot.spriteUrl = url
    slot.loaded = false

    return new Promise((resolve, reject) => {
      const img = new Image()
      img.onload = () => {
        slot.image = img
        slot.loaded = true
        this.forcePlaceholders = false

        if (key === 'piece_CASTLE_ROOF') {
          slot.collisionBox = this.analyzeCollisionMask(img, img)
          slot.hasCollisionMask = false
        } else if (key === 'bg_left' || key === 'bg_right') {
          slot.tintedCanvas = this.createBluishDepthCanvas(img)
        } else if (key.startsWith('piece_')) {
          if (!slot.collisionImage) {
            slot.collisionBox = {
              x: 0,
              y: 0,
              width: img.naturalWidth || img.width,
              height: img.naturalHeight || img.height,
            }
            slot.hasCollisionMask = false
          }
          slot.tintedCanvas = this.createTintedBlockCanvas(
            img,
            slot.placeholder
          )
          slot.staticBrickCanvas = this.createTintedBlockCanvas(img, {
            fill: '#475569',
            border: '#0F172A',
            highlight: '#E2E8F0',
            label: 'Bloco de Ferro (Estático)',
          })
          slot.iceBrickCanvas = this.createTintedBlockCanvas(img, {
            fill: '#22D3EE',
            border: '#0284C7',
            highlight: '#E0F2FE',
            label: 'Bloco de Gelo (Azul Ciano)',
          })
        }

        this.notifyListeners()
        resolve()
      }
      img.onerror = (err) => {
        console.warn(`[SpriteRegistry] Failed to load sprite for ${key} at ${url}`, err)
        reject(err)
      }
      img.src = url
    })
  }

  public clearSprite(key: SpriteKey): void {
    const slot = this.slots.get(key)
    if (!slot) return
    slot.spriteUrl = null
    slot.image = null
    slot.tintedCanvas = null
    slot.heavyRubberCanvas = null
    slot.loaded = false
    this.notifyListeners()
  }

  /**
   * Renders the full-screen multi-layer Parallax Background Scenery:
   * - Layer 1 (Far Background — `bg_1.png`): Main sky, horizon clouds & ocean with slow vertical/horizontal parallax (`0.22x`).
   * - Layer 2 (Far Dynamic Clouds — `layer === 0`): Distant small soft clouds drifting slowly with the wind behind the side islands.
   * - Layer 3 (Mid-Back Islands — `bg_left_2.png` & `bg_right_2.png`): Compact left and right islands anchored at the horizon line
   *   with intermediate parallax (`0.46x`), partial transparency (`alpha = 0.78`), and a light bluish tint.
   * - Layer 4 (Mid & Near Dynamic Clouds — `layer === 1` & `layer === 2`): Layered dynamic clouds at different distances and heights
   *   moving slowly in the direction of the wind.
   */
  public drawTrickyTowersSceneryBackground(
    ctx: CanvasRenderingContext2D,
    canvasWidth: number,
    canvasHeight: number,
    cameraOriginX: number,
    cameraOriginY: number,
    elapsedTimeMs: number,
    windForce: number,
    parallaxFocusX: number = 0
  ): void {
    const u = GAME_CONSTANTS.UNIT_PX
    const baseCameraOriginY = canvasHeight - 112
    const cameraElevationPx = Math.max(0, cameraOriginY - baseCameraOriginY)
    const cameraShiftX = cameraOriginX - canvasWidth / 2 + parallaxFocusX

    // Update continuous slow cloud drift in the direction of the wind
    const rawDtMs =
      elapsedTimeMs >= this.lastCloudTimeMs
        ? elapsedTimeMs - this.lastCloudTimeMs
        : 16.67
    this.lastCloudTimeMs = elapsedTimeMs
    const dtSec = Math.max(0, Math.min(0.1, rawDtMs / 1000))
    const targetWindVel =
      Math.abs(windForce) > 0.02 ? windForce * 34 : 6.5
    this.currentCloudWindVel +=
      (targetWindVel - this.currentCloudWindVel) * Math.min(1, dtSec * 2.5)
    this.cloudWindDriftPx += this.currentCloudWindVel * dtSec

    const bgMainSlot = this.getSlot('bg_main')
    const bgLeftSlot = this.getSlot('bg_left')
    const bgRightSlot = this.getSlot('bg_right')
    const hasMainBg =
      !this.forcePlaceholders && bgMainSlot.loaded && !!bgMainSlot.image
    const hasSideIslandBgs =
      !this.forcePlaceholders &&
      ((bgLeftSlot.loaded && !!bgLeftSlot.image) ||
        (bgRightSlot.loaded && !!bgRightSlot.image))

    // 1. Base Sky Gradient (seamless upper-atmosphere extension & fallback)
    const skyGrad = ctx.createLinearGradient(0, 0, 0, canvasHeight)
    skyGrad.addColorStop(0, '#1B66C9')
    skyGrad.addColorStop(0.5, '#3E8CE4')
    skyGrad.addColorStop(0.85, '#76B5F5')
    skyGrad.addColorStop(1, '#AED6FC')
    ctx.fillStyle = skyGrad
    ctx.fillRect(0, 0, canvasWidth, canvasHeight)

    let bg1DrawH = canvasHeight

    // 2. Layer 1: Main Background (`bg_1.png`) with Far Parallax (0.22x vertical, 0.14x horizontal)
    if (hasMainBg && bgMainSlot.image) {
      const img = bgMainSlot.image
      const imgW = img.naturalWidth || 2752
      const imgH = img.naturalHeight || 1536

      // Scale so bg_1.png fits viewport with slight margin for horizontal & vertical parallax
      const scale = Math.max(
        (canvasWidth * 1.05) / imgW,
        (canvasHeight * 1.05) / imgH
      )
      const drawW = imgW * scale
      const drawH = imgH * scale
      bg1DrawH = drawH

      const bg1ParallaxY = cameraElevationPx * 0.22
      const bg1ParallaxX =
        cameraShiftX * 0.14 + Math.sin(elapsedTimeMs * 0.00035) * 4

      const drawX = (canvasWidth - drawW) / 2 + bg1ParallaxX
      const drawY = canvasHeight - drawH + bg1ParallaxY

      ctx.save()
      ctx.drawImage(img, drawX, drawY, drawW, drawH)

      // If climbing high pushes top of bg_1 into view, feather its top edge into the upper sky gradient
      if (drawY > -20) {
        const featherH = 90
        const topFeather = ctx.createLinearGradient(
          0,
          Math.max(0, drawY - 10),
          0,
          drawY + featherH
        )
        topFeather.addColorStop(0, '#1B66C9')
        topFeather.addColorStop(1, 'rgba(27, 102, 201, 0)')
        ctx.fillStyle = topFeather
        ctx.fillRect(0, 0, canvasWidth, drawY + featherH)
      }
      ctx.restore()
    } else {
      const seaLevelScreenY = cameraOriginY + 2.8 * u
      ctx.save()
      ctx.fillStyle = 'rgba(218, 231, 255, 0.45)'
      this.drawCloudBankSilhouette(ctx, canvasWidth, seaLevelScreenY - 40)
      ctx.restore()
    }

    // 3. Layer 2a: Far-Distance Dynamic Clouds (`layer === 0`, drawn behind the side islands)
    this.renderCloudLayerGroup(
      ctx,
      canvasWidth,
      canvasHeight,
      cameraOriginX,
      baseCameraOriginY,
      cameraElevationPx,
      cameraShiftX,
      0
    )

    // 4. Layer 2b: Side Background Islands (`bg_left_2.png` & `bg_right_2.png`)
    // Scaled smaller and anchored at the horizon line (top of the sea) matching the reference screenshot,
    // with intermediate parallax (0.46x vertical, 0.30x horizontal), transparency (`alpha = 0.78`), and light bluish tint!
    if (hasSideIslandBgs) {
      const islandParallaxY = cameraElevationPx * 0.46
      const islandParallaxX =
        cameraShiftX * 0.3 + Math.sin(elapsedTimeMs * 0.00065) * 3.5

      // Compact scale matching the reference image (~16.5% of screen width, ~44% of screen height)
      const islandScale = Math.max(
        0.24,
        Math.min(
          0.55,
          Math.min((canvasWidth * 0.165) / 580, (canvasHeight * 0.44) / 715)
        )
      )

      // Anchor the bottom fade of the islands right on the horizon line (where sky/clouds meet the top of the sea in bg_1.png)
      const baseHorizonY = canvasHeight - bg1DrawH * 0.215
      const baseIslandBottomY = baseHorizonY + islandParallaxY

      ctx.save()
      ctx.globalAlpha = 0.78

      if (bgLeftSlot.loaded && bgLeftSlot.image) {
        const leftSource = bgLeftSlot.tintedCanvas || bgLeftSlot.image
        const lw = (bgLeftSlot.image.naturalWidth || 551) * islandScale
        const lh = (bgLeftSlot.image.naturalHeight || 702) * islandScale
        const lx = Math.min(0, -lw * 0.12 + islandParallaxX)
        const ly = baseIslandBottomY - lh

        if (ly < canvasHeight + 40 && ly + lh > -40) {
          ctx.drawImage(leftSource, lx, ly, lw, lh)
        }
      }

      if (bgRightSlot.loaded && bgRightSlot.image) {
        const rightSource = bgRightSlot.tintedCanvas || bgRightSlot.image
        const rw = (bgRightSlot.image.naturalWidth || 667) * islandScale
        const rh = (bgRightSlot.image.naturalHeight || 729) * islandScale
        const rx = Math.max(
          canvasWidth - rw,
          canvasWidth - rw * 0.88 + islandParallaxX
        )
        const ry = baseIslandBottomY - rh

        if (ry < canvasHeight + 40 && ry + rh > -40) {
          ctx.drawImage(rightSource, rx, ry, rw, rh)
        }
      }

      ctx.restore()
    } else {
      const seaLevelScreenY = cameraOriginY + 2.8 * u
      this.drawSideIslandsPlaceholder(ctx, canvasWidth, seaLevelScreenY)
    }

    // 5. Layer 3: Mid-Distance (`layer === 1`) & Near-Background (`layer === 2`) Dynamic Clouds
    this.renderCloudLayerGroup(
      ctx,
      canvasWidth,
      canvasHeight,
      cameraOriginX,
      baseCameraOriginY,
      cameraElevationPx,
      cameraShiftX,
      1
    )
    this.renderCloudLayerGroup(
      ctx,
      canvasWidth,
      canvasHeight,
      cameraOriginX,
      baseCameraOriginY,
      cameraElevationPx,
      cameraShiftX,
      2
    )
  }

  /**
   * Renders a specific depth layer (`0 = Far`, `1 = Mid`, `2 = Near`) of dynamic background clouds
   * that drift slowly in the direction of the wind with distinct vertical/horizontal parallax and opacity.
   */
  private renderCloudLayerGroup(
    ctx: CanvasRenderingContext2D,
    canvasWidth: number,
    canvasHeight: number,
    cameraOriginX: number,
    baseCameraOriginY: number,
    cameraElevationPx: number,
    cameraShiftX: number,
    targetLayer: 0 | 1 | 2
  ): void {
    const u = GAME_CONSTANTS.UNIT_PX
    const wrapWidth = Math.max(1500, canvasWidth + 460)

    const parallaxY =
      targetLayer === 0 ? 0.28 : targetLayer === 1 ? 0.52 : 0.76
    const parallaxXFactor =
      targetLayer === 0 ? 0.18 : targetLayer === 1 ? 0.36 : 0.56
    const alpha =
      targetLayer === 0 ? 0.38 : targetLayer === 1 ? 0.58 : 0.78
    const fill =
      targetLayer === 0
        ? '#D8ECFF'
        : targetLayer === 1
          ? '#EAF4FF'
          : '#F8FBFF'
    const shade =
      targetLayer === 0
        ? '#B3D6FA'
        : targetLayer === 1
          ? '#C2DDFB'
          : '#D0E6FD'

    ctx.save()
    for (const c of this.clouds) {
      if (c.layer !== targetLayer) continue

      const screenY =
        baseCameraOriginY - c.heightUnits * u + cameraElevationPx * parallaxY
      if (screenY < -100 || screenY > canvasHeight + 100) continue

      const rawX =
        cameraOriginX +
        c.x +
        this.cloudWindDriftPx * c.speedFactor +
        cameraShiftX * parallaxXFactor
      const wrappedX =
        ((((rawX + wrapWidth / 2) % wrapWidth) + wrapWidth) % wrapWidth) -
        wrapWidth / 2 +
        canvasWidth / 2

      this.drawStylizedCloudPlaceholder(
        ctx,
        wrappedX,
        screenY,
        c.width,
        c.height,
        {
          fill,
          border: shade,
          highlight: '#FFFFFF',
          label: 'Cloud',
        },
        alpha,
        Boolean(c.flipX)
      )
    }
    ctx.restore()
  }

  /**
   * Renders the foreground Ocean water at the bottom of the world (the Abyss zone).
   */
  public drawTrickyTowersOceanForeground(
    ctx: CanvasRenderingContext2D,
    canvasWidth: number,
    canvasHeight: number,
    cameraOriginY: number,
    elapsedTimeMs: number
  ): void {
    const u = GAME_CONSTANTS.UNIT_PX
    const seaLevelScreenY = cameraOriginY + 2.8 * u
    if (seaLevelScreenY > canvasHeight + 40) return

    const oceanSlot = this.getSlot('scenery_ocean')
    const waterHeight = Math.max(200, canvasHeight - seaLevelScreenY + 100)

    if (!this.forcePlaceholders && oceanSlot.loaded && oceanSlot.image) {
      ctx.drawImage(oceanSlot.image, 0, seaLevelScreenY, canvasWidth, waterHeight)
      return
    }

    // When bg_1.png (`bg_main`) is loaded, it already contains the illustrated ocean waves at the bottom
    const bgMainSlot = this.getSlot('bg_main')
    if (!this.forcePlaceholders && bgMainSlot.loaded && bgMainSlot.image) {
      return
    }

    ctx.save()
    const oceanGrad = ctx.createLinearGradient(
      0,
      seaLevelScreenY,
      0,
      seaLevelScreenY + waterHeight
    )
    oceanGrad.addColorStop(0, oceanSlot.placeholder.fill)
    oceanGrad.addColorStop(1, oceanSlot.placeholder.border)
    ctx.fillStyle = oceanGrad
    ctx.fillRect(0, seaLevelScreenY, canvasWidth, waterHeight)

    ctx.fillStyle = oceanSlot.placeholder.highlight
    ctx.fillRect(0, seaLevelScreenY, canvasWidth, 3)

    ctx.fillStyle = 'rgba(175, 204, 255, 0.25)'
    const waveShift = Math.sin(elapsedTimeMs * 0.002) * 18
    for (let i = 0; i < 6; i++) {
      const wy = seaLevelScreenY + 14 + i * 16
      const wx = (i * 230 + waveShift) % canvasWidth
      ctx.fillRect(wx, wy, 140, 3)
      ctx.fillRect((wx + canvasWidth * 0.5) % canvasWidth, wy + 6, 95, 2)
    }
    ctx.restore()
  }

  private drawCloudBankSilhouette(
    ctx: CanvasRenderingContext2D,
    canvasWidth: number,
    baseY: number
  ): void {
    ctx.beginPath()
    ctx.moveTo(0, baseY + 60)
    const step = Math.max(120, canvasWidth / 8)
    for (let x = 0; x <= canvasWidth + step; x += step) {
      const h = 45 + Math.sin(x * 0.015) * 28 + Math.cos(x * 0.008) * 20
      ctx.arc(x, baseY - h * 0.3, h, Math.PI, 0, false)
    }
    ctx.lineTo(canvasWidth, baseY + 60)
    ctx.closePath()
    ctx.fill()
  }

  private drawStylizedCloudPlaceholder(
    ctx: CanvasRenderingContext2D,
    centerX: number,
    bottomY: number,
    w: number,
    h: number,
    theme: PlaceholderColorTheme,
    alpha: number,
    flipX: boolean = false
  ): void {
    const cloudSlot = this.getSlot('scenery_clouds')
    ctx.save()
    ctx.translate(centerX, bottomY)
    if (flipX) {
      ctx.scale(-1, 1)
    }
    ctx.globalAlpha = alpha
    const x0 = -w / 2

    if (!this.forcePlaceholders && cloudSlot.loaded && cloudSlot.image) {
      ctx.drawImage(cloudSlot.image, x0, -h, w, h)
      ctx.restore()
      return
    }

    // Soft borderless sky cloud matching bg_1.png's illustrated cloud aesthetic
    ctx.fillStyle = theme.fill

    ctx.beginPath()
    ctx.moveTo(x0 + 16, 0)
    ctx.lineTo(x0 + w - 16, 0)
    ctx.quadraticCurveTo(x0 + w, 0, x0 + w, -14)
    ctx.quadraticCurveTo(x0 + w - 8, -h * 0.65, x0 + w * 0.72, -h * 0.62)
    ctx.quadraticCurveTo(x0 + w * 0.55, -h * 1.08, x0 + w * 0.36, -h * 0.78)
    ctx.quadraticCurveTo(x0 + w * 0.15, -h * 0.85, x0 + 12, -h * 0.42)
    ctx.quadraticCurveTo(x0, -14, x0 + 16, 0)
    ctx.closePath()
    ctx.fill()

    // Subtle soft sky-blue bottom shading inside the cloud
    ctx.fillStyle = theme.border
    ctx.globalAlpha = alpha * 0.35
    ctx.beginPath()
    ctx.roundRect(x0 + 14, -6, w - 28, 4, 2)
    ctx.fill()
    ctx.restore()
  }

  private drawSideIslandsPlaceholder(
    ctx: CanvasRenderingContext2D,
    canvasWidth: number,
    seaLevelY: number
  ): void {
    const slot = this.getSlot('scenery_islands')
    if (!this.forcePlaceholders && slot.loaded && slot.image) {
      ctx.drawImage(slot.image, 0, seaLevelY - 220, canvasWidth, 220)
      return
    }

    ctx.save()
    this.drawIslandCluster(ctx, 0, seaLevelY, 270, 185, 1, slot.placeholder)
    this.drawIslandCluster(ctx, canvasWidth, seaLevelY, 290, 205, -1, slot.placeholder)
    ctx.restore()
  }

  private drawIslandCluster(
    ctx: CanvasRenderingContext2D,
    edgeX: number,
    seaLevelY: number,
    width: number,
    height: number,
    dir: 1 | -1,
    theme: PlaceholderColorTheme
  ): void {
    ctx.save()
    ctx.translate(edgeX, seaLevelY)
    ctx.scale(dir, 1)

    ctx.fillStyle = '#6A7BB8'
    ctx.beginPath()
    ctx.moveTo(0, 0)
    ctx.lineTo(0, -height)
    ctx.quadraticCurveTo(width * 0.45, -height * 0.95, width * 0.72, -height * 0.42)
    ctx.quadraticCurveTo(width * 0.95, -height * 0.25, width, 0)
    ctx.closePath()
    ctx.fill()

    ctx.fillStyle = theme.fill
    ctx.strokeStyle = theme.border
    ctx.lineWidth = 2.5
    ctx.beginPath()
    ctx.moveTo(0, 0)
    ctx.lineTo(0, -height * 0.78)
    ctx.quadraticCurveTo(width * 0.22, -height * 0.85, width * 0.35, -height * 0.56)
    ctx.quadraticCurveTo(width * 0.55, -height * 0.65, width * 0.68, -height * 0.32)
    ctx.quadraticCurveTo(width * 0.86, -height * 0.35, width * 0.92, 0)
    ctx.closePath()
    ctx.fill()
    ctx.stroke()

    ctx.fillStyle = theme.highlight
    ctx.beginPath()
    ctx.arc(width * 0.14, -height * 0.58, 34, Math.PI * 0.9, Math.PI * 2.1)
    ctx.arc(width * 0.42, -height * 0.4, 28, Math.PI * 0.9, Math.PI * 2.1)
    ctx.arc(width * 0.68, -height * 0.2, 22, Math.PI * 0.9, Math.PI * 2.1)
    ctx.fill()

    ctx.restore()
  }

  private drawDistantSideTowerPlaceholder(
    ctx: CanvasRenderingContext2D,
    centerX: number,
    baseTopY: number
  ): void {
    const u = GAME_CONSTANTS.UNIT_PX
    ctx.save()
    ctx.translate(centerX, baseTopY)

    this.drawPedestalBody(ctx, 0, u, 0.88)

    ctx.fillStyle = '#15803D'
    ctx.strokeStyle = '#052E16'
    ctx.lineWidth = 2
    const bw = 5 * u
    ctx.fillRect(-bw / 2, 0, bw, u * 0.85)
    ctx.strokeRect(-bw / 2, 0, bw, u * 0.85)

    const stoneBlocks = [
      { x: -2, y: -1, w: 2, h: 1 },
      { x: 0, y: -1, w: 2, h: 1 },
      { x: -1.5, y: -2, w: 1, h: 2 },
      { x: -0.5, y: -2, w: 2, h: 1 },
      { x: -0.5, y: -3, w: 1, h: 2 },
      { x: 0.5, y: -3, w: 1, h: 1 },
    ]
    ctx.fillStyle = '#7E8CA8'
    ctx.strokeStyle = '#334155'
    ctx.lineWidth = 1.5
    for (const b of stoneBlocks) {
      ctx.fillRect(b.x * u, b.y * u, b.w * u, b.h * u)
      ctx.strokeRect(b.x * u, b.y * u, b.w * u, b.h * u)
    }

    ctx.restore()
  }

  /**
   * Renders the Modular Base Platform:
   * 1. Foundation (`assets/sprites/other/base.png` — Cottage with striped roof & green Lego bushes) aligned so its
   *    flat upper roof edge spans the 8 columns (`[-4u, +4u]`).
   * 2. Modular 8-Column Green Unit Blocks (`elevations[0..7]`):
   *    - `elev = -1`: 1x1 pit/fossa in the first green row exposing the cottage roof below.
   *    - `elev = 0`: normal 1x1 green base block at `Y = [0 .. +1u]`.
   *    - `elev = 1, 2`: +1 or +2 extra 1x1 green blocks stacked vertically on that column (`Y = [-1u .. 0]`, `[-2u .. -1u]`).
   */
  public drawBasePlate(
    ctx: CanvasRenderingContext2D,
    centerX: number,
    centerY: number,
    elevations: readonly number[] = [0, 0, 0, 0, 0, 0, 0, 0]
  ): void {
    const u = GAME_CONSTANTS.UNIT_PX
    const cols = GAME_CONSTANTS.BASE_WIDTH_UNITS // 8 columns
    const height = GAME_CONSTANTS.BASE_HEIGHT_UNITS * u

    ctx.save()
    ctx.translate(centerX, centerY)

    // 1. Draw the Cottage Foundation (`base.png`) under each contiguous active segment (`elev >= -1`)
    // Supports full 8-column bases, narrower 6/4-column platforms, and split twin islands (`elev === -2` is open void).
    let segStart = -1
    for (let col = 0; col <= cols; col++) {
      const isActive = col < cols && (elevations[col] ?? 0) >= -1
      if (isActive && segStart === -1) {
        segStart = col
      } else if (!isActive && segStart !== -1) {
        const segEnd = col - 1
        const spanCols = segEnd - segStart + 1
        const segCenterX = (-cols / 2 + (segStart + segEnd + 1) * 0.5) * u
        this.drawPedestalBody(ctx, segCenterX, height / 2 - 2, 1.0, spanCols)
        segStart = -1
      }
    }

    // 2. Draw recessed shadow / roof lip in any column with a 1x1 pit (`elev === -1`)
    for (let col = 0; col < cols; col++) {
      const elev = elevations[col] ?? 0
      if (elev === -1) {
        const colX = (-cols / 2 + col) * u
        const pitFloorY = height / 2
        ctx.save()
        ctx.fillStyle = 'rgba(15, 23, 42, 0.28)'
        ctx.fillRect(colX + 2, -height / 2 + 4, u - 4, height - 4)
        // Subtle roof-top studs at the bottom of the pit
        ctx.fillStyle = '#E15B7E'
        ctx.strokeStyle = '#231528'
        ctx.lineWidth = 1.6
        for (const offset of [0.28, 0.72]) {
          const sx = colX + u * offset - 3.5
          ctx.fillRect(sx, pitFloorY - 4, 7, 4)
          ctx.strokeRect(sx, pitFloorY - 4, 7, 4)
        }
        ctx.restore()
      }
    }

    // 3. Draw the Modular 1x1 Green Blocks for each column (Col 0 .. Col 7) from bottom row (r = 0) up to r = elev
    for (let r = 0; r <= 2; r++) {
      for (let col = 0; col < cols; col++) {
        const elev = elevations[col] ?? 0
        if (elev < r) continue

        const colX = (-cols / 2 + col) * u
        const blockTopY = -height / 2 - r * u
        const isTopOfColumn = r === elev
        const hasLeftNeighbor = col > 0 && (elevations[col - 1] ?? 0) >= r
        const hasRightNeighbor =
          col < cols - 1 && (elevations[col + 1] ?? 0) >= r
        const hasBottomNeighbor = r > 0

        this.drawModularGreenUnitBlock(
          ctx,
          colX,
          blockTopY,
          u,
          isTopOfColumn,
          hasLeftNeighbor,
          hasRightNeighbor,
          hasBottomNeighbor
        )
      }
    }

    ctx.restore()
  }

  /**
   * Draws a single 1x1 Modular Green Block (`32x32px`) styled to match the green Lego bushes
   * in `assets/sprites/other/base.png` (emerald gradient, 2x2 embossed front circles, top studs, and dark outline).
   */
  private drawModularGreenUnitBlock(
    ctx: CanvasRenderingContext2D,
    x0: number,
    y0: number,
    size: number,
    isTopOfColumn: boolean,
    hasLeftNeighbor: boolean,
    hasRightNeighbor: boolean,
    hasBottomNeighbor: boolean
  ): void {
    ctx.save()

    // 1. Top Lego Studs / Pins (drawn only on the topmost block of the column)
    if (isTopOfColumn) {
      const studW = 7.6
      const studH = 4.6
      for (const offsetRatio of [0.29, 0.71]) {
        const sx = x0 + size * offsetRatio - studW / 2
        const sy = y0 - studH + 0.5

        ctx.fillStyle = '#22AD50'
        ctx.strokeStyle = '#181425'
        ctx.lineWidth = 2.0
        ctx.beginPath()
        ctx.roundRect(sx, sy, studW, studH, [2.2, 2.2, 0.5, 0.5])
        ctx.fill()
        ctx.stroke()

        // Specular top highlight on stud
        ctx.fillStyle = '#6EE798'
        ctx.fillRect(sx + 1.5, sy + 1, studW - 3, 1.4)
      }
    }

    // 2. Main 1x1 Emerald Green Block Body (matching the bushes in base.png)
    const bodyGrad = ctx.createLinearGradient(x0, y0, x0, y0 + size)
    bodyGrad.addColorStop(0, '#29BE5B')
    bodyGrad.addColorStop(0.55, '#1DA349')
    bodyGrad.addColorStop(1, '#147D36')

    const rTL = !hasLeftNeighbor && isTopOfColumn ? 3.5 : 0
    const rTR = !hasRightNeighbor && isTopOfColumn ? 3.5 : 0
    const rBL = !hasLeftNeighbor && !hasBottomNeighbor ? 2.5 : 0
    const rBR = !hasRightNeighbor && !hasBottomNeighbor ? 2.5 : 0

    ctx.fillStyle = bodyGrad
    ctx.beginPath()
    ctx.roundRect(x0, y0, size, size, [rTL, rTR, rBR, rBL])
    ctx.fill()

    // Top glossy bevel highlight
    ctx.fillStyle = '#6EE798'
    ctx.globalAlpha = isTopOfColumn ? 0.45 : 0.22
    ctx.fillRect(x0 + 2, y0 + 1.5, size - 4, 3.2)
    ctx.globalAlpha = 1.0

    // Bottom inner shadow bevel
    ctx.fillStyle = '#0C5222'
    ctx.globalAlpha = 0.35
    ctx.fillRect(x0 + 1, y0 + size - 3.2, size - 2, 2.5)
    ctx.globalAlpha = 1.0

    // 3. Subtle 2x2 embossed circular Lego dots on the front face (matching the bushes in base.png!)
    const dotRadius = 2.8
    const dotPositions = [
      { dx: 0.3, dy: 0.33 },
      { dx: 0.7, dy: 0.33 },
      { dx: 0.3, dy: 0.7 },
      { dx: 0.7, dy: 0.7 },
    ]
    for (const dp of dotPositions) {
      const cx = x0 + size * dp.dx
      const cy = y0 + size * dp.dy

      ctx.fillStyle = '#188E3E'
      ctx.strokeStyle = '#0E4F22'
      ctx.lineWidth = 1.2
      ctx.beginPath()
      ctx.arc(cx, cy, dotRadius, 0, Math.PI * 2)
      ctx.fill()
      ctx.stroke()

      ctx.fillStyle = '#5CE085'
      ctx.globalAlpha = 0.55
      ctx.beginPath()
      ctx.arc(cx - 0.6, cy - 0.6, dotRadius * 0.45, 0, Math.PI * 2)
      ctx.fill()
      ctx.globalAlpha = 1.0
    }

    // 4. Internal seam line on right/bottom when adjacent to another green block, and bold outer contour on exposed edges
    ctx.strokeStyle = 'rgba(12, 46, 23, 0.42)'
    ctx.lineWidth = 1.2
    ctx.beginPath()
    if (hasRightNeighbor) {
      ctx.moveTo(x0 + size, y0 + 1)
      ctx.lineTo(x0 + size, y0 + size - 1)
    }
    if (hasBottomNeighbor) {
      ctx.moveTo(x0 + 1, y0 + size)
      ctx.lineTo(x0 + size - 1, y0 + size)
    }
    ctx.stroke()

    ctx.strokeStyle = '#181425'
    ctx.lineWidth = 2.2
    ctx.lineCap = 'round'
    ctx.beginPath()
    if (isTopOfColumn) {
      ctx.moveTo(x0, y0 + 0.8)
      ctx.lineTo(x0 + size, y0 + 0.8)
    }
    if (!hasBottomNeighbor) {
      ctx.moveTo(x0, y0 + size - 0.8)
      ctx.lineTo(x0 + size, y0 + size - 0.8)
    }
    if (!hasLeftNeighbor) {
      ctx.moveTo(x0 + 0.8, y0)
      ctx.lineTo(x0 + 0.8, y0 + size)
    }
    if (!hasRightNeighbor) {
      ctx.moveTo(x0 + size - 0.8, y0)
      ctx.lineTo(x0 + size - 0.8, y0 + size)
    }
    ctx.stroke()

    ctx.restore()
  }

  /**
   * Renders Positive Power 4: `SIDE_ISLAND` ("Ilha Auxiliar / Suporte Flutuante — 2.5 x 1.5 unidades").
   * - Top: Green studded Lego baseplate (2.5u wide = 2 full blocks + 1 half-block, with 5 studs at 0.5u intervals).
   * - Body: Chamfered/rounded toy-brick outrigger hull with purple magic crystal band matching the main pedestal.
   * - Bottom: Floating cloud/thrusters keeping the island suspended in the sky.
   * - Spawn Animation: Scales smoothly from 0% to 100% over 0.2s (`spawnProgress` in `[0, 1]`).
   */
  public drawSideIsland(
    ctx: CanvasRenderingContext2D,
    centerX: number,
    centerY: number,
    widthPx: number,
    heightPx: number,
    side: 'LEFT' | 'RIGHT',
    spawnProgress: number = 1.0,
    animTimeMs: number = 0
  ): void {
    const u = GAME_CONSTANTS.UNIT_PX
    const slot = this.getSlot('side_island')

    // Smooth elastic scale-in during the 0.2s (200ms) spawn animation
    const t = Math.max(0, Math.min(1, spawnProgress))
    const scaleAnim =
      t < 1
        ? 1 + 1.8 * Math.pow(t - 1, 3) + 0.8 * Math.pow(t - 1, 2)
        : 1.0
    if (scaleAnim <= 0.02) return

    const x0 = -widthPx / 2
    const y0 = -heightPx / 2
    const topPlateH = Math.round(u * 0.52)
    const hullTopY = y0 + topPlateH
    const hullH = heightPx - topPlateH

    ctx.save()
    ctx.translate(centerX, centerY)
    ctx.scale(scaleAnim, scaleAnim)

    // 1. Floating Cloud / Thruster Puffs underneath the island
    const puffPulse = Math.sin(animTimeMs * 0.006 + (side === 'LEFT' ? 0 : 1.8)) * 2.5
    ctx.save()
    ctx.fillStyle = '#E0F2FE'
    ctx.strokeStyle = '#38BDF8'
    ctx.lineWidth = 1.8
    ctx.beginPath()
    ctx.arc(-widthPx * 0.24, y0 + heightPx + 2 + puffPulse * 0.5, 11, 0, Math.PI * 2)
    ctx.arc(0, y0 + heightPx + 5 + puffPulse, 14, 0, Math.PI * 2)
    ctx.arc(widthPx * 0.24, y0 + heightPx + 2 - puffPulse * 0.5, 11, 0, Math.PI * 2)
    ctx.fill()
    ctx.stroke()

    ctx.fillStyle = '#FFFFFF'
    ctx.beginPath()
    ctx.arc(0, y0 + heightPx + 3 + puffPulse * 0.7, 9, 0, Math.PI * 2)
    ctx.fill()
    ctx.restore()

    if (!this.forcePlaceholders && slot.loaded && slot.image) {
      ctx.drawImage(slot.image, x0, y0, widthPx, heightPx)
      ctx.restore()
      return
    }

    // 2. Top Lego Studs / Pins (5 studs across 2.5 units = every 0.5u)
    ctx.fillStyle = '#16A34A'
    ctx.strokeStyle = '#052E16'
    ctx.lineWidth = 1.6
    const studCount = 5
    const studStep = widthPx / studCount
    const studW = 9
    const studH = 4.5
    for (let i = 0; i < studCount; i++) {
      const sx = x0 + studStep * (i + 0.5) - studW / 2
      ctx.fillRect(sx, y0 - studH, studW, studH)
      ctx.strokeRect(sx, y0 - studH, studW, studH)
    }

    // 3. Chamfered / Rounded Outrigger Base Hull (below the green top plate)
    const bevel = 12
    ctx.fillStyle = '#475569'
    ctx.strokeStyle = '#0F172A'
    ctx.lineWidth = 2.2
    ctx.beginPath()
    ctx.moveTo(x0 + 2, hullTopY)
    ctx.lineTo(x0 + widthPx - 2, hullTopY)
    ctx.lineTo(x0 + widthPx - 5, hullTopY + hullH - bevel)
    ctx.quadraticCurveTo(
      x0 + widthPx - 7,
      hullTopY + hullH,
      x0 + widthPx - 2 - bevel,
      hullTopY + hullH
    )
    ctx.lineTo(x0 + 2 + bevel, hullTopY + hullH)
    ctx.quadraticCurveTo(
      x0 + 7,
      hullTopY + hullH,
      x0 + 5,
      hullTopY + hullH - bevel
    )
    ctx.closePath()
    ctx.fill()
    ctx.stroke()

    // Magic purple/pink pedestal band inside hull (matching main pedestal style)
    ctx.fillStyle = '#9D4EDD'
    ctx.strokeStyle = '#1E1B4B'
    ctx.lineWidth = 1.5
    ctx.fillRect(x0 + 10, hullTopY + 5, widthPx - 20, hullH * 0.44)
    ctx.strokeRect(x0 + 10, hullTopY + 5, widthPx - 20, hullH * 0.44)

    // Glowing cyan energy core dot in center of outrigger hull
    ctx.fillStyle = '#38BDF8'
    ctx.beginPath()
    ctx.arc(0, hullTopY + hullH * 0.27, 4.5, 0, Math.PI * 2)
    ctx.fill()
    ctx.stroke()

    // 4. Green Top Baseplate (2.5 units wide: 2 full blocks + 0.5u half-block)
    const theme = slot.placeholder
    ctx.fillStyle = theme.fill
    ctx.fillRect(x0, y0, widthPx, topPlateH)

    // Highlight strip on top edge
    ctx.fillStyle = theme.highlight
    ctx.globalAlpha = 0.38
    ctx.fillRect(x0 + 2, y0 + 2, widthPx - 4, 4)
    ctx.globalAlpha = 1.0

    // Sub-grid dividers (1.0u, 2.0u, and 0.5u half-block marker on the outer edge)
    ctx.strokeStyle = theme.border
    ctx.globalAlpha = 0.5
    ctx.lineWidth = 1.2
    for (const unitOffset of [0.5, 1.0, 1.5, 2.0]) {
      const gx = x0 + unitOffset * u
      const isFullUnit = Math.abs(unitOffset - Math.round(unitOffset)) < 0.01
      ctx.beginPath()
      ctx.moveTo(gx, y0 + 1)
      ctx.lineTo(gx, y0 + (isFullUnit ? topPlateH - 1 : topPlateH * 0.55))
      ctx.stroke()
    }
    ctx.globalAlpha = 1.0

    // Crisp outer border of the green top plate
    ctx.strokeStyle = theme.border
    ctx.lineWidth = 2.2
    ctx.strokeRect(x0 + 1, y0 + 1, widthPx - 2, topPlateH - 1)

    // Sensor ring highlight while in the 0.2s safe push-out spawn phase
    if (t < 1.0) {
      ctx.strokeStyle = 'rgba(56, 189, 248, 0.85)'
      ctx.lineWidth = 2.5
      ctx.setLineDash([5, 4])
      ctx.strokeRect(x0 - 3, y0 - 3, widthPx + 6, heightPx + 6)
      ctx.setLineDash([])
    }

    ctx.restore()
  }

  private drawPedestalBody(
    ctx: CanvasRenderingContext2D,
    x: number,
    topY: number,
    scale: number,
    spanColumns: number = GAME_CONSTANTS.BASE_WIDTH_UNITS
  ): void {
    const u = GAME_CONSTANTS.UNIT_PX * scale
    const pedSlot = this.getSlot('scenery_pedestal')
    const baseSlot = this.getSlot('base_plate')
    const img =
      (!this.forcePlaceholders && pedSlot.loaded && pedSlot.image) ||
      (!this.forcePlaceholders && baseSlot.loaded && baseSlot.image) ||
      null

    if (img) {
      // `assets/sprites/other/base.png` is 511x133px; its top flat roof edge spans x=32..472 (440px, center=252).
      // Scale horizontally to match `spanColumns * u`, keeping the vertical scale consistent with the 8-unit cottage height.
      const imgW = img.naturalWidth || 511
      const imgH = img.naturalHeight || 133
      const roofTopSpanSrcPx = imgW === 511 ? 440 : imgW * 0.861
      const roofCenterSrcX = imgW === 511 ? 252 : imgW * 0.493
      const baseRoofWidthPx = GAME_CONSTANTS.BASE_WIDTH_UNITS * u
      const targetRoofWidthPx = spanColumns * u
      const imgScaleY = baseRoofWidthPx / roofTopSpanSrcPx
      const imgScaleX = targetRoofWidthPx / roofTopSpanSrcPx
      const drawW = imgW * imgScaleX
      const drawH = imgH * imgScaleY
      const drawX = x - roofCenterSrcX * imgScaleX
      ctx.drawImage(img, drawX, topY, drawW, drawH)
      return
    }

    const w = Math.max(1.5, spanColumns - 0.4) * u
    const h = 2.2 * u
    const x0 = x - w / 2

    ctx.save()
    ctx.fillStyle = '#475569'
    ctx.strokeStyle = '#1E293B'
    ctx.lineWidth = 2
    ctx.fillRect(x0 - 8, topY + h * 0.65, w + 16, h * 0.4)
    ctx.strokeRect(x0 - 8, topY + h * 0.65, w + 16, h * 0.4)

    ctx.fillStyle = '#9D4EDD'
    ctx.fillRect(x0 + 6, topY + h * 0.25, w - 12, h * 0.55)
    ctx.strokeRect(x0 + 6, topY + h * 0.25, w - 12, h * 0.55)

    ctx.fillStyle = pedSlot.placeholder.fill
    ctx.beginPath()
    ctx.moveTo(x0 - 4, topY)
    ctx.lineTo(x0 + w + 4, topY)
    ctx.lineTo(x0 + w + 10, topY + h * 0.38)
    ctx.lineTo(x0 - 10, topY + h * 0.38)
    ctx.closePath()
    ctx.fill()
    ctx.stroke()

    ctx.fillStyle = '#7C2D12'
    ctx.fillRect(x - 10 * scale, topY + h * 0.46, 20 * scale, h * 0.34)
    ctx.strokeRect(x - 10 * scale, topY + h * 0.46, 20 * scale, h * 0.34)

    ctx.fillStyle = '#22C55E'
    ctx.beginPath()
    ctx.arc(x0 - 4, topY + h * 0.85, 11 * scale, 0, Math.PI * 2)
    ctx.arc(x0 + w + 4, topY + h * 0.85, 11 * scale, 0, Math.PI * 2)
    ctx.fill()
    ctx.stroke()

    ctx.restore()
  }

  /**
   * Renders the floating character/mascot alongside the tower's top height.
   * Uses the active Player Skin from `assets/sprites/player` (e.g. `player_mage.png`)
   * with procedural floating bobbing, tower-facing horizontal orientation, victory dance flips,
   * and Tricky Towers-style floating Power Bubbles above its head:
   * - Light Bubble ("balão claro"): Good Power (`selfPower`, Positive)
   * - Dark Red Bubble ("balão vermelho escuro"): Chaos Power (`attackPower`, Negative)
   */
  public drawFloatingMascot(
    ctx: CanvasRenderingContext2D,
    centerX: number,
    centerY: number,
    animTimeMs: number,
    options?: {
      scaleXFlip?: number
      extraTiltRad?: number
      selfPower?: PowerId | null
      attackPower?: PowerId | null
    }
  ): void {
    const slot = this.getSlot('mascot_floating')
    const rawFlipX = options?.scaleXFlip ?? -1
    const extraTilt = options?.extraTiltRad ?? 0

    const baseTiltRad = Math.sin(animTimeMs * 0.0025) * 0.04
    const tiltRad = baseTiltRad + extraTilt

    const breathScaleY = 1 + Math.sin(animTimeMs * 0.005) * 0.02
    const breathScaleX = 1 - Math.sin(animTimeMs * 0.005) * 0.012

    const signedFlipX =
      Math.abs(rawFlipX) < 0.08
        ? (rawFlipX >= 0 ? 0.08 : -0.08)
        : rawFlipX

    ctx.save()
    ctx.translate(centerX, centerY)
    ctx.rotate(tiltRad)
    ctx.scale(breathScaleX * signedFlipX, breathScaleY)

    if (!this.forcePlaceholders && slot.loaded && slot.image) {
      // 192x192 HD sprite at 0.5x world scale = 96x96px (3x3 units, matching the 64px->32px block scale!)
      const targetHeight = 96
      const aspect =
        slot.image.naturalHeight > 0
          ? slot.image.naturalWidth / slot.image.naturalHeight
          : 1
      const drawH = targetHeight
      const drawW = Math.min(128, Math.max(48, targetHeight * aspect))
      ctx.drawImage(slot.image, -drawW / 2, -drawH * 0.62, drawW, drawH)
    } else {
      // Fallback placeholder
      ctx.fillStyle = slot.placeholder.fill
      ctx.strokeStyle = slot.placeholder.border
      ctx.lineWidth = 2
      ctx.beginPath()
      ctx.arc(0, -14, 9, 0, Math.PI * 2)
      ctx.fill()
      ctx.stroke()

      ctx.fillStyle = '#EF4444'
      ctx.beginPath()
      ctx.arc(3, -26, 3.5, 0, Math.PI * 2)
      ctx.fill()
      ctx.stroke()

      ctx.fillStyle = slot.placeholder.highlight
      ctx.beginPath()
      ctx.roundRect(-22, -8, 44, 15, 8)
      ctx.fill()
      ctx.stroke()
    }

    ctx.restore()

    // Draw floating Power Bubbles above the character's head (unflipped so icons are always upright!)
    if (options?.selfPower || options?.attackPower) {
      this.drawMascotPowerBubbles(
        ctx,
        centerX,
        centerY,
        animTimeMs,
        options.selfPower || null,
        options.attackPower || null
      )
    }
  }

  /**
   * Draws a specific player skin character on its floating block cloud by `skinId`
   * (used for the 2 randomly chosen side characters on `TITLE_SCREEN` and `MAIN_MENU`).
   */
  public drawMenuMascotBySkinId(
    ctx: CanvasRenderingContext2D,
    skinId: string,
    centerX: number,
    centerY: number,
    animTimeMs: number,
    options?: {
      scaleXFlip?: 1 | -1
      targetHeight?: number
    }
  ): void {
    const img =
      this.playerSkinImages.get(skinId) ||
      this.getSlot('mascot_floating').image ||
      null
    const flipX = options?.scaleXFlip ?? 1
    const targetHeight = options?.targetHeight ?? 132

    const tiltRad = Math.sin(animTimeMs * 0.0022) * 0.035
    const breathScaleY = 1 + Math.sin(animTimeMs * 0.0045) * 0.018
    const breathScaleX = 1 - Math.sin(animTimeMs * 0.0045) * 0.012

    ctx.save()
    ctx.translate(centerX, centerY)
    ctx.rotate(tiltRad)
    ctx.scale(breathScaleX * flipX, breathScaleY)

    if (!this.forcePlaceholders && img && img.naturalHeight > 0) {
      const aspect = img.naturalWidth / img.naturalHeight
      const drawH = targetHeight
      const drawW = Math.min(180, Math.max(64, targetHeight * aspect))
      ctx.drawImage(img, -drawW / 2, -drawH * 0.55, drawW, drawH)
    } else {
      const slot = this.getSlot('mascot_floating')
      ctx.fillStyle = slot.placeholder.fill
      ctx.strokeStyle = slot.placeholder.border
      ctx.lineWidth = 2.5
      ctx.beginPath()
      ctx.arc(0, -18, 14, 0, Math.PI * 2)
      ctx.fill()
      ctx.stroke()

      ctx.fillStyle = slot.placeholder.highlight
      ctx.beginPath()
      ctx.roundRect(-28, -6, 56, 18, 8)
      ctx.fill()
      ctx.stroke()
    }

    ctx.restore()
  }

  /**
   * Renders the persistent background and canvas elements shared by `TITLE_SCREEN` (Menu 1)
   * and `MAIN_MENU` (Menu 2):
   * - Full-screen parallax sky, dynamic wind clouds, and lateral tree hills (`drawTrickyTowersSceneryBackground`)
   * - 2 randomly chosen distinct floating characters on the left & right sides with continuous sinusoidal motion:
   *   `yOffset = Math.sin(time * 2) * 10`, `xOffset = Math.cos(time * 1.2) * 5`
   * - Central swaying tower anchored at the base (`angle = Math.sin(time * 1.8) * 0.04` rad) during `TITLE_SCREEN`
   *   (smoothly fading out via `options.towerAlpha` in `300ms` when transitioning to `MAIN_MENU`)
   * - Foreground animated ocean water (`drawTrickyTowersOceanForeground`)
   */
  public drawMenuScene(
    ctx: CanvasRenderingContext2D,
    canvasWidth: number,
    canvasHeight: number,
    animTimeMs: number,
    options: {
      leftSkinId: string
      rightSkinId: string
      towerAlpha: number
      showSideMascots?: boolean
    }
  ): void {
    const u = GAME_CONSTANTS.UNIT_PX
    const originX = canvasWidth / 2
    const originY = canvasHeight - 112
    const timeSec = animTimeMs / 1000

    // 1. Base Scenery (Sky, dynamic wind clouds, lateral tree hills)
    this.drawTrickyTowersSceneryBackground(
      ctx,
      canvasWidth,
      canvasHeight,
      originX,
      originY,
      animTimeMs,
      0.22,
      0
    )

    // 2. Central Tower with Pendulum Sway (Active in TITLE_SCREEN, fades 1 -> 0 in 300ms for MAIN_MENU)
    if (options.towerAlpha > 0.005) {
      ctx.save()
      ctx.globalAlpha = Math.max(0, Math.min(1, options.towerAlpha))
      ctx.translate(originX, originY)

      // Fixed Base Foundation (`base.png` + 8-column flat green row)
      this.drawBasePlate(ctx, 0, u / 2, [0, 0, 0, 0, 0, 0, 0, 0])

      // Pendulum sway rotation anchored at the top surface of the base:
      // angle = Math.sin(time * 1.8) * 0.04 radians (~2.5 degrees)
      const swayAngle = Math.sin(timeSec * 1.8) * 0.04
      ctx.save()
      ctx.rotate(swayAngle)

      const showcaseBlocks: Array<{
        type: PieceType
        tx: number
        ty: number
        paletteIdx: number
        cells: Array<{ x: number; y: number }>
        powerEffect?: PiecePowerEffect
      }> = [
        // Tier 1 (resting on base y = 0)
        {
          type: 'I',
          tx: -1.5 * u,
          ty: -0.5 * u,
          paletteIdx: 0,
          cells: [
            { x: -1.5, y: 0 },
            { x: -0.5, y: 0 },
            { x: 0.5, y: 0 },
            { x: 1.5, y: 0 },
          ],
        },
        {
          type: 'O',
          tx: 1.5 * u,
          ty: -1.0 * u,
          paletteIdx: 1,
          cells: [
            { x: -0.5, y: -0.5 },
            { x: 0.5, y: -0.5 },
            { x: -0.5, y: 0.5 },
            { x: 0.5, y: 0.5 },
          ],
        },
        // Tier 2
        {
          type: 'L',
          tx: -1.5 * u,
          ty: -2.0 * u,
          paletteIdx: 3,
          cells: [
            { x: -1, y: 0 },
            { x: 0, y: 0 },
            { x: 1, y: 0 },
            { x: -1, y: 1 },
          ],
        },
        {
          type: 'T',
          tx: 0.5 * u,
          ty: -2.5 * u,
          paletteIdx: 2,
          cells: [
            { x: -1, y: 0 },
            { x: 0, y: 0 },
            { x: 1, y: 0 },
            { x: 0, y: 1 },
          ],
        },
        // Tier 3
        {
          type: 'Z',
          tx: -1.0 * u,
          ty: -3.5 * u,
          paletteIdx: 6,
          cells: [
            { x: -1, y: 0 },
            { x: 0, y: 0 },
            { x: 0, y: 1 },
            { x: 1, y: 1 },
          ],
        },
        {
          type: 'J',
          tx: 1.5 * u,
          ty: -3.5 * u,
          paletteIdx: 4,
          cells: [
            { x: -1, y: 0 },
            { x: 0, y: 0 },
            { x: 1, y: 0 },
            { x: 1, y: 1 },
          ],
        },
        // Tier 4
        {
          type: 'I',
          tx: 0,
          ty: -4.5 * u,
          paletteIdx: 5,
          cells: [
            { x: -1.5, y: 0 },
            { x: -0.5, y: 0 },
            { x: 0.5, y: 0 },
            { x: 1.5, y: 0 },
          ],
        },
        // Tier 5
        {
          type: 'O',
          tx: -1.0 * u,
          ty: -5.5 * u,
          paletteIdx: 1,
          cells: [
            { x: -0.5, y: -0.5 },
            { x: 0.5, y: -0.5 },
            { x: -0.5, y: 0.5 },
            { x: 0.5, y: 0.5 },
          ],
        },
        {
          type: 'S',
          tx: 1.0 * u,
          ty: -6.0 * u,
          paletteIdx: 5,
          cells: [
            { x: 0, y: 0 },
            { x: 1, y: 0 },
            { x: -1, y: 1 },
            { x: 0, y: 1 },
          ],
        },
        // Castle Roof Crown on top of the swaying tower
        {
          type: 'O',
          tx: 0,
          ty: -8.0 * u,
          paletteIdx: 0,
          powerEffect: 'CASTLE_ROOF',
          cells: [
            { x: -1, y: -1 },
            { x: 0, y: -1 },
            { x: 1, y: -1 },
            { x: -1, y: 0 },
            { x: 0, y: 0 },
            { x: 1, y: 0 },
            { x: -1, y: 1 },
            { x: 0, y: 1 },
            { x: 1, y: 1 },
          ],
        },
      ]

      for (const blk of showcaseBlocks) {
        ctx.save()
        ctx.translate(blk.tx, blk.ty)
        this.drawPieceCells(ctx, blk.type, 'NORMAL', blk.cells, 1.0, {
          colorPaletteIndex: blk.paletteIdx,
          powerEffect: blk.powerEffect,
        })
        ctx.restore()
      }

      ctx.restore()
      ctx.restore()
    }

    // 3. Persistent Floating Side Characters (1 on Left, 1 on Right)
    if (options.showSideMascots !== false) {
      const yOffsetLeft = Math.sin(timeSec * 2) * 10
      const xOffsetLeft = Math.cos(timeSec * 1.2) * 5

      const yOffsetRight = Math.sin(timeSec * 2 + 1.1) * 10
      const xOffsetRight = Math.cos(timeSec * 1.2 + 1.1) * 5

      const leftBaseX = Math.max(115, Math.min(canvasWidth * 0.16, canvasWidth / 2 - 350))
      const rightBaseX = Math.min(
        canvasWidth - 115,
        Math.max(canvasWidth * 0.84, canvasWidth / 2 + 350)
      )
      const sideBaseY = Math.max(210, Math.min(canvasHeight - 230, canvasHeight * 0.52))

      this.drawMenuMascotBySkinId(
        ctx,
        options.leftSkinId,
        leftBaseX + xOffsetLeft,
        sideBaseY + yOffsetLeft,
        animTimeMs,
        { scaleXFlip: 1, targetHeight: 132 }
      )

      this.drawMenuMascotBySkinId(
        ctx,
        options.rightSkinId,
        rightBaseX + xOffsetRight,
        sideBaseY + yOffsetRight,
        animTimeMs,
        { scaleXFlip: -1, targetHeight: 132 }
      )
    }

    // 4. Foreground Ocean Water Strip
    this.drawTrickyTowersOceanForeground(
      ctx,
      canvasWidth,
      canvasHeight,
      originY,
      animTimeMs
    )
  }

  /**
   * Renders the floating circular Power Bubble(s) above the mascot's head,
   * matching the Tricky Towers visual style:
   * - Light / White-Lavender Bubble ("claro para poder bom") for `selfPower`
   * - Dark Red / Crimson Bubble ("vermelho escuro para caos") for `attackPower`
   */
  private drawMascotPowerBubbles(
    ctx: CanvasRenderingContext2D,
    centerX: number,
    centerY: number,
    animTimeMs: number,
    selfPower: PowerId | null,
    attackPower: PowerId | null
  ): void {
    const bobGood = Math.sin(animTimeMs * 0.0055) * 2.8
    const bobChaos = Math.cos(animTimeMs * 0.0055 + 0.9) * 2.8

    ctx.save()
    ctx.translate(centerX, centerY)

    if (selfPower && attackPower) {
      // Both Good Power and Chaos Power present:
      // Draw the Dark Red Chaos bubble slightly lower-right first, then the Light Good bubble above-left overlapping its edge
      this.drawSinglePowerBubble(
        ctx,
        22,
        -66 + bobChaos,
        20,
        attackPower,
        'CHAOS'
      )
      this.drawSinglePowerBubble(
        ctx,
        -8,
        -82 + bobGood,
        23,
        selfPower,
        'GOOD'
      )
    } else if (selfPower) {
      this.drawSinglePowerBubble(
        ctx,
        -2,
        -80 + bobGood,
        24,
        selfPower,
        'GOOD'
      )
    } else if (attackPower) {
      this.drawSinglePowerBubble(
        ctx,
        -2,
        -80 + bobChaos,
        24,
        attackPower,
        'CHAOS'
      )
    }

    ctx.restore()
  }

  private drawSinglePowerBubble(
    ctx: CanvasRenderingContext2D,
    bx: number,
    by: number,
    radius: number,
    powerId: PowerId,
    kind: 'GOOD' | 'CHAOS'
  ): void {
    ctx.save()
    ctx.translate(bx, by)

    if (kind === 'GOOD') {
      // 1. Balão Claro para Poder Bom (White -> Soft Ice-Lavender -> Periwinkle rim + Bold Dark Outline)
      const grad = ctx.createRadialGradient(
        -radius * 0.22,
        -radius * 0.22,
        radius * 0.08,
        0,
        0,
        radius
      )
      grad.addColorStop(0, '#FFFFFF')
      grad.addColorStop(0.58, '#EEF2FF')
      grad.addColorStop(0.85, '#C7D2FE')
      grad.addColorStop(1, '#A5B4FC')

      ctx.fillStyle = grad
      ctx.strokeStyle = '#1E1B4B'
      ctx.lineWidth = 3.2
      ctx.beginPath()
      ctx.arc(0, 0, radius, 0, Math.PI * 2)
      ctx.fill()
      ctx.stroke()

      // Soft inner white gloss arc at top-left
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.9)'
      ctx.lineWidth = 2.2
      ctx.lineCap = 'round'
      ctx.beginPath()
      ctx.arc(0, 0, radius - 4.2, Math.PI * 1.08, Math.PI * 1.58)
      ctx.stroke()
    } else {
      // 2. Balão Vermelho Escuro para Caos (Deep Dark Red / Crimson outer ring + inner concentric orb)
      const outerGrad = ctx.createRadialGradient(
        -radius * 0.2,
        -radius * 0.2,
        radius * 0.1,
        0,
        0,
        radius
      )
      outerGrad.addColorStop(0, '#BE123C')
      outerGrad.addColorStop(0.7, '#881337')
      outerGrad.addColorStop(1, '#4C0519')

      ctx.fillStyle = outerGrad
      ctx.strokeStyle = '#1E1B4B'
      ctx.lineWidth = 3.2
      ctx.beginPath()
      ctx.arc(0, 0, radius, 0, Math.PI * 2)
      ctx.fill()
      ctx.stroke()

      // Concentric inner dark-red medallion circle (matching the reference image!)
      const innerR = radius * 0.72
      const innerGrad = ctx.createRadialGradient(
        -innerR * 0.25,
        -innerR * 0.25,
        innerR * 0.08,
        0,
        0,
        innerR
      )
      innerGrad.addColorStop(0, '#F43F5E')
      innerGrad.addColorStop(0.62, '#9F1239')
      innerGrad.addColorStop(1, '#6B0F2B')

      ctx.fillStyle = innerGrad
      ctx.strokeStyle = '#4C0519'
      ctx.lineWidth = 2.0
      ctx.beginPath()
      ctx.arc(0, 0, innerR, 0, Math.PI * 2)
      ctx.fill()
      ctx.stroke()

      // Glossy highlight dot on the top-left of the inner dark-red orb
      ctx.strokeStyle = 'rgba(255, 228, 230, 0.85)'
      ctx.lineWidth = 2.0
      ctx.lineCap = 'round'
      ctx.beginPath()
      ctx.arc(0, 0, innerR - 3.2, Math.PI * 1.12, Math.PI * 1.52)
      ctx.stroke()
    }

    // 3. Draw the custom cartoon vector icon for the power inside the bubble
    this.drawPowerBubbleVectorIcon(ctx, powerId, radius / 23)

    ctx.restore()
  }

  /**
   * Draws a crisp, cel-shaded cartoon vector icon inside the floating character's power bubble.
   */
  private drawPowerBubbleVectorIcon(
    ctx: CanvasRenderingContext2D,
    powerId: PowerId,
    scale: number = 1.0
  ): void {
    ctx.save()
    ctx.scale(scale, scale)
    ctx.lineJoin = 'round'
    ctx.lineCap = 'round'

    switch (powerId) {
      case 'SUPER_GLUE': {
        // Glossy Cyan/White Glue Droplet + Vine Bud
        ctx.fillStyle = '#38BDF8'
        ctx.strokeStyle = '#1E1B4B'
        ctx.lineWidth = 2.4
        ctx.beginPath()
        ctx.moveTo(0, -11)
        ctx.bezierCurveTo(7, -3, 9, 3, 9, 6)
        ctx.arc(0, 5, 9, 0, Math.PI, false)
        ctx.bezierCurveTo(-9, 3, -7, -3, 0, -11)
        ctx.closePath()
        ctx.fill()
        ctx.stroke()

        // White inner glue core highlight
        ctx.fillStyle = '#FFFFFF'
        ctx.beginPath()
        ctx.ellipse(-3, 4, 2.2, 4.2, -0.25, 0, Math.PI * 2)
        ctx.fill()
        break
      }

      case 'STATIC_BRICK': {
        // Indestructible Metallic Grey Anchor Brick with rivets
        ctx.fillStyle = '#94A3B8'
        ctx.strokeStyle = '#1E1B4B'
        ctx.lineWidth = 2.4
        ctx.beginPath()
        ctx.roundRect(-11, -7, 22, 15, 3)
        ctx.fill()
        ctx.stroke()

        // Top Lego studs
        ctx.fillStyle = '#CBD5E1'
        ctx.fillRect(-7, -11, 5, 4)
        ctx.strokeRect(-7, -11, 5, 4)
        ctx.fillRect(2, -11, 5, 4)
        ctx.strokeRect(2, -11, 5, 4)

        // Metallic corner bolts
        ctx.fillStyle = '#F8FAFC'
        for (const [rx, ry] of [
          [-7, -3],
          [7, -3],
          [-7, 4],
          [7, 4],
        ]) {
          ctx.beginPath()
          ctx.arc(rx, ry, 1.5, 0, Math.PI * 2)
          ctx.fill()
        }
        break
      }

      case 'BRICK_REMOVER': {
        // Iconic Orange Brick Separator Lever Tool
        ctx.rotate(-0.28)
        ctx.fillStyle = '#FF6D00'
        ctx.strokeStyle = '#1E1B4B'
        ctx.lineWidth = 2.4
        ctx.beginPath()
        ctx.moveTo(-12, 2)
        ctx.lineTo(-3, -6)
        ctx.lineTo(11, -6)
        ctx.lineTo(11, 4)
        ctx.lineTo(-2, 4)
        ctx.lineTo(-12, 7)
        ctx.closePath()
        ctx.fill()
        ctx.stroke()

        // Top stud socket on separator
        ctx.fillStyle = '#FDBA74'
        ctx.fillRect(2, -9, 6, 3)
        ctx.strokeRect(2, -9, 6, 3)
        break
      }

      case 'SIDE_ISLAND': {
        // Mini Floating Side Island (Green studded top plate + purple hull + cloud puff)
        ctx.fillStyle = '#E0F2FE'
        ctx.strokeStyle = '#1E1B4B'
        ctx.lineWidth = 2.0
        ctx.beginPath()
        ctx.arc(-5, 8, 4.5, 0, Math.PI * 2)
        ctx.arc(0, 9, 5.5, 0, Math.PI * 2)
        ctx.arc(5, 8, 4.5, 0, Math.PI * 2)
        ctx.fill()
        ctx.stroke()

        // Purple/slate hull
        ctx.fillStyle = '#9D4EDD'
        ctx.beginPath()
        ctx.roundRect(-10, -1, 20, 8, 3)
        ctx.fill()
        ctx.stroke()

        // Green top plate with studs
        ctx.fillStyle = '#22C55E'
        ctx.fillRect(-12, -6, 24, 6)
        ctx.strokeRect(-12, -6, 24, 6)
        ctx.fillRect(-8, -9, 4, 3)
        ctx.strokeRect(-8, -9, 4, 3)
        ctx.fillRect(-2, -9, 4, 3)
        ctx.strokeRect(-2, -9, 4, 3)
        ctx.fillRect(4, -9, 4, 3)
        ctx.strokeRect(4, -9, 4, 3)
        break
      }

      case 'TURBO_DROP': {
        // Classic Tricky Towers Jagged Lightning Bolt (matching the reference image!)
        ctx.fillStyle = '#FEF08A'
        ctx.strokeStyle = '#1E1B4B'
        ctx.lineWidth = 2.5
        ctx.beginPath()
        ctx.moveTo(3, -12)
        ctx.lineTo(-7, 1)
        ctx.lineTo(0, 1)
        ctx.lineTo(-4, 12)
        ctx.lineTo(8, -2)
        ctx.lineTo(1, -2)
        ctx.closePath()
        ctx.fill()
        ctx.stroke()
        break
      }

      case 'GIANT_PIECE': {
        // Giant 2x Heavy Toy Block ("2X")
        ctx.fillStyle = '#FACC15'
        ctx.strokeStyle = '#1E1B4B'
        ctx.lineWidth = 2.3
        ctx.beginPath()
        ctx.roundRect(-10, -7, 20, 16, 3)
        ctx.fill()
        ctx.stroke()

        ctx.fillRect(-7, -10, 5, 3)
        ctx.strokeRect(-7, -10, 5, 3)
        ctx.fillRect(2, -10, 5, 3)
        ctx.strokeRect(2, -10, 5, 3)

        ctx.fillStyle = '#1E1B4B'
        ctx.font = '900 9px Inter, system-ui, sans-serif'
        ctx.textAlign = 'center'
        ctx.textBaseline = 'middle'
        ctx.fillText('2X', 0, 1.5)
        break
      }

      case 'SLICK_BRICK': {
        // Translucent Cyan-Blue Ice Cube with diagonal frost shine
        ctx.fillStyle = 'rgba(34, 211, 238, 0.85)'
        ctx.strokeStyle = '#0369A1'
        ctx.lineWidth = 2.2
        ctx.beginPath()
        ctx.roundRect(-9, -9, 18, 18, 3.5)
        ctx.fill()
        ctx.stroke()

        // Diagonal white ice glints
        ctx.strokeStyle = '#FFFFFF'
        ctx.lineWidth = 2.0
        ctx.beginPath()
        ctx.moveTo(-5, -3)
        ctx.lineTo(-2, -6)
        ctx.moveTo(-4, 4)
        ctx.lineTo(4, -4)
        ctx.stroke()
        break
      }

      case 'LOCK_ROTATE': {
        // Cartoon Padlock blocking rotation
        ctx.strokeStyle = '#1E1B4B'
        ctx.lineWidth = 2.6
        ctx.beginPath()
        ctx.arc(0, -4, 5.5, Math.PI, 0, false)
        ctx.stroke()

        ctx.fillStyle = '#FDE047'
        ctx.lineWidth = 2.3
        ctx.beginPath()
        ctx.roundRect(-8, -3, 16, 13, 3)
        ctx.fill()
        ctx.stroke()

        ctx.fillStyle = '#1E1B4B'
        ctx.beginPath()
        ctx.arc(0, 3, 2, 0, Math.PI * 2)
        ctx.fill()
        break
      }

      case 'BLIND_MANUAL': {
        // Dense Fog Cloud (Nuvem Fog) icon
        ctx.fillStyle = '#E2E8F0'
        ctx.strokeStyle = '#1E1B4B'
        ctx.lineWidth = 2.2
        ctx.beginPath()
        ctx.arc(-5, 1, 5.5, 0, Math.PI * 2)
        ctx.arc(1, -3, 6.5, 0, Math.PI * 2)
        ctx.arc(6.5, 1, 5, 0, Math.PI * 2)
        ctx.fill()
        ctx.stroke()

        // Wavy mist lines below the cloud
        ctx.strokeStyle = '#F8FAFC'
        ctx.lineWidth = 2.0
        ctx.beginPath()
        ctx.moveTo(-8, 7)
        ctx.lineTo(7, 7)
        ctx.moveTo(-5, 10.5)
        ctx.lineTo(5, 10.5)
        ctx.stroke()
        break
      }
    }

    ctx.restore()
  }

  /**
   * Renders a piece in its local coordinate space.
   * Aligns the sprite's `*_colision.png` bounding box 1:1 with the physics collider `[minX, minY, boxW, boxH]`,
   * allowing decorative Lego studs/pins outside the collision mask to overhang naturally.
   */
  public drawPieceCells(
    ctx: CanvasRenderingContext2D,
    type: PieceType,
    variant: PieceVariant,
    cells: Array<{ x: number; y: number }>,
    scale: number,
    options?: {
      isSnapped?: boolean
      isSleeping?: boolean
      isGhost?: boolean
      showCenterOfMass?: boolean
      powerEffect?: PiecePowerEffect
      isStaticAnchor?: boolean
      isGlued?: boolean
      colorPaletteIndex?: number
    }
  ): void {
    const powerEffect = options?.powerEffect || 'NONE'
    const slot = this.getPieceSlot(type, variant)
    const paletteIdx =
      (((options?.colorPaletteIndex ?? DEFAULT_PALETTE_BY_TYPE[type] ?? 0) %
        PIECE_COLOR_PALETTE.length) +
        PIECE_COLOR_PALETTE.length) %
      PIECE_COLOR_PALETTE.length
    const selectedColorTheme = PIECE_COLOR_PALETTE[paletteIdx] || slot.placeholder
    const theme =
      powerEffect === 'STATIC_BRICK'
        ? {
            fill: '#475569',
            border: '#0F172A',
            highlight: '#E2E8F0',
            label: 'Bloco de Ferro',
          }
        : powerEffect === 'SLICK_BRICK'
          ? {
              fill: '#22D3EE',
              border: '#0284C7',
              highlight: '#E0F2FE',
              label: 'Bloco de Gelo',
            }
          : variant === 'HEAVY_RUBBER'
            ? this.getSlot('piece_HEAVY_RUBBER').placeholder
            : selectedColorTheme
    const cellPx = GAME_CONSTANTS.UNIT_PX * scale

    let minX = Infinity
    let minY = Infinity
    let maxX = -Infinity
    let maxY = -Infinity

    for (const cell of cells) {
      const x0 = cell.x * cellPx - cellPx / 2
      const y0 = cell.y * cellPx - cellPx / 2
      minX = Math.min(minX, x0)
      minY = Math.min(minY, y0)
      maxX = Math.max(maxX, x0 + cellPx)
      maxY = Math.max(maxY, y0 + cellPx)
    }

    const boxW = maxX - minX
    const boxH = maxY - minY

    const hasNeighbor = (
      cell: { x: number; y: number },
      dx: number,
      dy: number
    ) => {
      return cells.some(
        (other) =>
          Math.abs(other.x - (cell.x + dx)) < 0.05 &&
          Math.abs(other.y - (cell.y + dy)) < 0.05
      )
    }

    // Climax Victory Piece: CASTLE_ROOF (3x3 Toy-Brick Castle Turret Roof with Battlements & Red Flag)
    if (powerEffect === 'CASTLE_ROOF') {
      this.drawCastleRoofPiece(ctx, minX, minY, maxX, maxY, cellPx, scale)
    } else {
      const solidColoredSource = slot.multiColorCanvases?.[paletteIdx]
      const drawableSource: CanvasImageSource | null =
        powerEffect === 'STATIC_BRICK' && slot.staticBrickCanvas
          ? slot.staticBrickCanvas
          : powerEffect === 'SLICK_BRICK' && slot.iceBrickCanvas
            ? slot.iceBrickCanvas
            : variant === 'HEAVY_RUBBER' && slot.heavyRubberCanvas
              ? slot.heavyRubberCanvas
              : solidColoredSource || slot.tintedCanvas || slot.image

      ctx.save()
      if (powerEffect === 'SLICK_BRICK' && !options?.isGhost) {
        // Ice Effect (`SLICK_BRICK`): colors the piece itself cyan-blue like ice and makes it slightly more transparent!
        ctx.globalAlpha *= 0.65
      }

      if (!this.forcePlaceholders && slot.loaded && slot.image && drawableSource) {
        const imgW = slot.image.naturalWidth || slot.image.width
        const imgH = slot.image.naturalHeight || slot.image.height
        const colBox = slot.collisionBox || {
          x: 0,
          y: 0,
          width: imgW,
          height: imgH,
        }

        const scaleX = boxW / colBox.width
        const scaleY = boxH / colBox.height
        const drawX = minX - colBox.x * scaleX
        const drawY = minY - colBox.y * scaleY
        const drawW = imgW * scaleX
        const drawH = imgH * scaleY

        ctx.drawImage(drawableSource, drawX, drawY, drawW, drawH)
      } else {
        for (const cell of cells) {
          const x0 = cell.x * cellPx - cellPx / 2
          const y0 = cell.y * cellPx - cellPx / 2

          ctx.fillStyle = theme.fill
          ctx.fillRect(x0, y0, cellPx, cellPx)

          ctx.fillStyle = theme.highlight
          ctx.globalAlpha = 0.22
          ctx.fillRect(x0 + 2, y0 + 2, cellPx - 4, 3 * scale)
          ctx.globalAlpha = 1.0

          ctx.strokeStyle = theme.border
          ctx.globalAlpha = 0.35
          ctx.lineWidth = 1
          ctx.strokeRect(x0 + 0.5, y0 + 0.5, cellPx - 1, cellPx - 1)
          ctx.globalAlpha = 1.0
        }

        ctx.strokeStyle = options?.isSnapped ? '#FFFFFF' : theme.border
        ctx.lineWidth = options?.isSnapped ? 2.2 : 2.0
        ctx.beginPath()

        for (const cell of cells) {
          const x0 = cell.x * cellPx - cellPx / 2
          const y0 = cell.y * cellPx - cellPx / 2
          const x1 = x0 + cellPx
          const y1 = y0 + cellPx

          if (!hasNeighbor(cell, 0, -1)) {
            ctx.moveTo(x0, y0 + 0.8)
            ctx.lineTo(x1, y0 + 0.8)
          }
          if (!hasNeighbor(cell, 0, 1)) {
            ctx.moveTo(x0, y1 - 0.8)
            ctx.lineTo(x1, y1 - 0.8)
          }
          if (!hasNeighbor(cell, -1, 0)) {
            ctx.moveTo(x0 + 0.8, y0)
            ctx.lineTo(x0 + 0.8, y1)
          }
          if (!hasNeighbor(cell, 1, 0)) {
            ctx.moveTo(x1 - 0.8, y0)
            ctx.lineTo(x1 - 0.8, y1)
          }
        }
        ctx.stroke()
      }
      ctx.restore()
    }

    // Overlay FX for active/settled Power Effects
    if (!options?.isGhost) {
      if (powerEffect === 'SUPER_GLUE' || options?.isGlued) {
        this.drawPieceSuperGlueDecoration(
          ctx,
          cells,
          cellPx,
          scale,
          hasNeighbor,
          powerEffect === 'SUPER_GLUE'
        )
      }

      if (powerEffect === 'STATIC_BRICK' || options?.isStaticAnchor) {
        ctx.save()
        ctx.strokeStyle = options?.isStaticAnchor ? '#F8FAFC' : '#94A3B8'
        ctx.lineWidth = 2
        // Metallic bolts at cell corners
        ctx.fillStyle = '#E2E8F0'
        for (const cell of cells) {
          const cx = cell.x * cellPx
          const cy = cell.y * cellPx
          ctx.beginPath()
          ctx.arc(cx, cy, 3 * scale, 0, Math.PI * 2)
          ctx.fill()
          ctx.stroke()
        }
        ctx.restore()
      }

      if (powerEffect === 'SLICK_BRICK') {
        ctx.save()
        ctx.strokeStyle = 'rgba(224, 242, 254, 0.72)'
        ctx.lineWidth = 1.8 * scale
        ctx.lineCap = 'round'
        for (const cell of cells) {
          const x0 = cell.x * cellPx - cellPx / 2
          const y0 = cell.y * cellPx - cellPx / 2
          ctx.beginPath()
          ctx.moveTo(x0 + 5 * scale, y0 + 11 * scale)
          ctx.lineTo(x0 + 11 * scale, y0 + 5 * scale)
          ctx.moveTo(x0 + 9 * scale, y0 + 15 * scale)
          ctx.lineTo(x0 + 15 * scale, y0 + 9 * scale)
          ctx.stroke()
        }
        ctx.restore()
      }

      if (powerEffect === 'LOCK_ROTATE') {
        ctx.save()
        ctx.font = `bold ${Math.round(14 * scale)}px Inter, system-ui, sans-serif`
        ctx.textAlign = 'center'
        ctx.textBaseline = 'middle'
        ctx.fillText('🔒', 0, 0)
        ctx.restore()
      }

      if (powerEffect === 'TURBO_DROP') {
        ctx.save()
        ctx.strokeStyle = '#EF4444'
        ctx.lineWidth = 2
        ctx.strokeRect(minX + 1, minY + 1, boxW - 2, boxH - 2)
        ctx.restore()
      }
    }

    if (options?.showCenterOfMass) {
      ctx.fillStyle = 'rgba(255, 255, 255, 0.85)'
      ctx.beginPath()
      ctx.arc(0, 0, 2.5, 0, Math.PI * 2)
      ctx.fill()
      ctx.strokeStyle = 'rgba(0, 0, 0, 0.65)'
      ctx.lineWidth = 1
      ctx.stroke()
    }
  }

  private pieceGlowMaskCanvas: HTMLCanvasElement | null = null

  /**
   * Renders a lateral barrier glow strictly masked to the piece's own per-pixel silhouette
   * ("efeito de glow na lateral da peça com uma máscara"):
   * 1. Draws the rotated piece onto an offscreen mask canvas (`pieceGlowMaskCanvas`) to capture its exact
   *    PNG/cell alpha mask (including pins/studs and rounded corners).
   * 2. Uses `globalCompositeOperation = 'source-in'` in world-aligned horizontal space so a lateral
   *    gradient from the piece's left and/or right outer edge inward is clipped 100% to the piece's mask.
   * 3. Composites the masked glow onto `ctx` with both an outer/inner bloom (`screen` + `shadowBlur`)
   *    and a crisp inner lateral rim highlight.
   */
  public drawPieceLateralBarrierGlow(
    ctx: CanvasRenderingContext2D,
    type: PieceType,
    variant: PieceVariant,
    cells: Array<{ x: number; y: number }>,
    scale: number,
    angleRad: number,
    options: {
      leftGlow: number
      rightGlow: number
      mode: 'CONTROL' | 'DANGER'
      powerEffect?: PiecePowerEffect
    }
  ): void {
    const leftGlow = Math.max(0, Math.min(1, options.leftGlow))
    const rightGlow = Math.max(0, Math.min(1, options.rightGlow))
    if (leftGlow <= 0.01 && rightGlow <= 0.01) return

    const maskSize = 320
    const cx = maskSize / 2
    const cy = maskSize / 2

    if (!this.pieceGlowMaskCanvas) {
      this.pieceGlowMaskCanvas = document.createElement('canvas')
      this.pieceGlowMaskCanvas.width = maskSize
      this.pieceGlowMaskCanvas.height = maskSize
    }
    const mctx = this.pieceGlowMaskCanvas.getContext('2d')
    if (!mctx) return

    const cellPx = GAME_CONSTANTS.UNIT_PX * scale
    const cos = Math.cos(angleRad)
    const sin = Math.sin(angleRad)

    let worldMinX = Infinity
    let worldMaxX = -Infinity
    const corners = [
      { dx: -0.5, dy: -0.5 },
      { dx: 0.5, dy: -0.5 },
      { dx: 0.5, dy: 0.5 },
      { dx: -0.5, dy: 0.5 },
    ]
    for (const c of cells) {
      for (const corner of corners) {
        const lx = (c.x + corner.dx) * cellPx
        const ly = (c.y + corner.dy) * cellPx
        const rx = lx * cos - ly * sin
        if (rx < worldMinX) worldMinX = rx
        if (rx > worldMaxX) worldMaxX = rx
      }
    }

    const pieceWidthPx = Math.max(cellPx, worldMaxX - worldMinX)
    const glowSpanPx = Math.min(
      pieceWidthPx * 0.9,
      Math.max(28 * scale, pieceWidthPx * 0.62)
    )

    const applySideMaskPass = (side: 'LEFT' | 'RIGHT', intensity: number) => {
      mctx.clearRect(0, 0, maskSize, maskSize)

      // 1. Draw the rotated piece to establish the exact per-pixel alpha mask
      mctx.save()
      mctx.globalCompositeOperation = 'source-over'
      mctx.translate(cx, cy)
      mctx.rotate(angleRad)
      this.drawPieceCells(mctx, type, variant, cells, scale, {
        powerEffect: options.powerEffect,
        showCenterOfMass: false,
      })
      mctx.restore()

      // 2. Apply the world-aligned lateral barrier gradient masked by 'source-in'
      mctx.save()
      mctx.globalCompositeOperation = 'source-in'

      const edgeX =
        side === 'LEFT' ? cx + worldMinX - 2 : cx + worldMaxX + 2
      const innerX =
        side === 'LEFT' ? edgeX + glowSpanPx : edgeX - glowSpanPx

      const grad = mctx.createLinearGradient(edgeX, 0, innerX, 0)
      if (options.mode === 'DANGER') {
        grad.addColorStop(0.0, `rgba(255, 255, 255, ${(0.98 * intensity).toFixed(3)})`)
        grad.addColorStop(0.16, `rgba(254, 215, 170, ${(0.94 * intensity).toFixed(3)})`)
        grad.addColorStop(0.42, `rgba(251, 146, 60, ${(0.78 * intensity).toFixed(3)})`)
        grad.addColorStop(0.72, `rgba(239, 68, 68, ${(0.34 * intensity).toFixed(3)})`)
        grad.addColorStop(1.0, 'rgba(239, 68, 68, 0)')
      } else {
        grad.addColorStop(0.0, `rgba(255, 255, 255, ${(0.98 * intensity).toFixed(3)})`)
        grad.addColorStop(0.16, `rgba(224, 242, 254, ${(0.94 * intensity).toFixed(3)})`)
        grad.addColorStop(0.42, `rgba(56, 189, 248, ${(0.78 * intensity).toFixed(3)})`)
        grad.addColorStop(0.72, `rgba(14, 165, 233, ${(0.32 * intensity).toFixed(3)})`)
        grad.addColorStop(1.0, 'rgba(14, 165, 233, 0)')
      }

      mctx.fillStyle = grad
      mctx.fillRect(0, 0, maskSize, maskSize)
      mctx.restore()

      // 3. Draw the masked lateral glow onto the main canvas (centered at (0, 0) of the piece in world alignment)
      ctx.save()
      ctx.globalCompositeOperation = 'screen'
      ctx.shadowColor =
        options.mode === 'DANGER' ? '#FB923C' : '#38BDF8'
      ctx.shadowBlur = 12 * intensity
      ctx.drawImage(this.pieceGlowMaskCanvas!, -cx, -cy)
      ctx.restore()

      ctx.save()
      ctx.globalCompositeOperation = 'source-over'
      ctx.drawImage(this.pieceGlowMaskCanvas!, -cx, -cy)
      ctx.restore()
    }

    if (leftGlow > 0.01) {
      applySideMaskPass('LEFT', leftGlow)
    }
    if (rightGlow > 0.01) {
      applySideMaskPass('RIGHT', rightGlow)
    }
  }

  /**
   * Renders the 3x3 Toy-Brick Castle Roof Victory Piece (`CASTLE_ROOF`):
   * - Base: 3 units wide (stone-grey ABS bricks with battlements / ameias, studs, and arched castle window)
   * - Middle: 2 units wide stepped crimson toy-brick pyramid roof with studs
   * - Top: 1 unit wide turret peak + golden finial + waving red flag at the summit
   */
  private drawCastleRoofPiece(
    ctx: CanvasRenderingContext2D,
    minX: number,
    minY: number,
    maxX: number,
    maxY: number,
    cellPx: number,
    scale: number
  ): void {
    const roofSlot = this.getSlot('piece_CASTLE_ROOF')
    const boxW = maxX - minX
    const boxH = maxY - minY

    ctx.save()

    // Render bundled or uploaded castle_roof.png aligned flush with the 3-unit stone base
    if (!this.forcePlaceholders && roofSlot.image) {
      const imgW = roofSlot.image.naturalWidth || roofSlot.image.width
      const imgH = roofSlot.image.naturalHeight || roofSlot.image.height
      const colBox = roofSlot.collisionBox || {
        x: 0,
        y: 0,
        width: imgW,
        height: imgH,
      }
      const destW = boxW
      const destH =
        colBox.width > 0 ? boxW * (colBox.height / colBox.width) : boxH
      const destX = minX
      const destY = maxY - destH

      ctx.drawImage(
        roofSlot.image,
        colBox.x,
        colBox.y,
        colBox.width,
        colBox.height,
        destX,
        destY,
        destW,
        destH
      )
      ctx.restore()
      return
    }

    const drawStud = (
      cx: number,
      topY: number,
      w: number,
      h: number,
      fill: string,
      border: string
    ) => {
      ctx.fillStyle = fill
      ctx.strokeStyle = border
      ctx.lineWidth = 1.6
      ctx.fillRect(cx - w / 2, topY - h, w, h)
      ctx.strokeRect(cx - w / 2, topY - h, w, h)
    }

    // 1. BOTTOM TIER (Row 3: 3 units wide castle wall + battlements / ameias)
    const row3Top = maxY - cellPx
    const row3H = cellPx

    // Outer battlements (ameias) studs on left & right merlons
    const studW = 8 * scale
    const studH = 4 * scale
    drawStud(minX + cellPx * 0.3, row3Top, studW, studH, '#CBD5E1', '#1E293B')
    drawStud(minX + cellPx * 0.7, row3Top, studW, studH, '#CBD5E1', '#1E293B')
    drawStud(maxX - cellPx * 0.7, row3Top, studW, studH, '#CBD5E1', '#1E293B')
    drawStud(maxX - cellPx * 0.3, row3Top, studW, studH, '#CBD5E1', '#1E293B')

    // Main 3x1 stone-grey castle wall block
    ctx.fillStyle = '#E2E8F0'
    ctx.strokeStyle = '#1E293B'
    ctx.lineWidth = 2.2
    ctx.fillRect(minX, row3Top, boxW, row3H)

    // Top gloss highlight on stone wall
    ctx.fillStyle = '#F8FAFC'
    ctx.fillRect(minX + 2, row3Top + 2, boxW - 4, 4 * scale)

    // Battlement crenelations (ameias cutouts / darker recesses between merlons)
    ctx.fillStyle = '#64748B'
    const crenelW = 10 * scale
    const crenelH = 7 * scale
    ctx.fillRect(minX + cellPx - crenelW / 2, row3Top + 1, crenelW, crenelH)
    ctx.strokeRect(minX + cellPx - crenelW / 2, row3Top + 1, crenelW, crenelH)
    ctx.fillRect(maxX - cellPx - crenelW / 2, row3Top + 1, crenelW, crenelH)
    ctx.strokeRect(maxX - cellPx - crenelW / 2, row3Top + 1, crenelW, crenelH)

    // Vertical brick seams on the 3-unit base
    ctx.strokeStyle = 'rgba(30, 41, 59, 0.35)'
    ctx.lineWidth = 1.2
    ctx.beginPath()
    ctx.moveTo(minX + cellPx, row3Top + crenelH)
    ctx.lineTo(minX + cellPx, maxY)
    ctx.moveTo(minX + cellPx * 2, row3Top + crenelH)
    ctx.lineTo(minX + cellPx * 2, maxY)
    ctx.stroke()

    // Golden royal trim band near the bottom of the castle base
    ctx.fillStyle = '#FACC15'
    ctx.fillRect(minX + 2, maxY - 6 * scale, boxW - 4, 4 * scale)

    // Arched medieval window/gate in the center of the base
    const archW = 14 * scale
    const archH = 18 * scale
    ctx.fillStyle = '#1E293B'
    ctx.beginPath()
    ctx.arc(0, maxY - archH + archW / 2, archW / 2, Math.PI, 0, false)
    ctx.lineTo(archW / 2, maxY - 2)
    ctx.lineTo(-archW / 2, maxY - 2)
    ctx.closePath()
    ctx.fill()

    // Crisp outer border for Row 3
    ctx.strokeStyle = '#0F172A'
    ctx.lineWidth = 2.2
    ctx.strokeRect(minX + 1, row3Top + 1, boxW - 2, row3H - 2)

    // 2. MIDDLE TIER (Row 2: 2 units wide stepped crimson toy-brick roof)
    const row2W = cellPx * 2
    const row2H = cellPx * 0.92
    const row2Left = -row2W / 2
    const row2Top = row3Top - row2H

    // Studs on the outer shoulders of Row 2
    drawStud(row2Left + cellPx * 0.28, row2Top, studW, studH, '#EF4444', '#450A0A')
    drawStud(row2Left + row2W - cellPx * 0.28, row2Top, studW, studH, '#EF4444', '#450A0A')

    // Sloped/stepped crimson toy brick body
    ctx.fillStyle = '#DC2626'
    ctx.strokeStyle = '#450A0A'
    ctx.lineWidth = 2.2
    ctx.fillRect(row2Left, row2Top, row2W, row2H)

    // Gloss highlight & center brick seam
    ctx.fillStyle = '#FCA5A5'
    ctx.globalAlpha = 0.35
    ctx.fillRect(row2Left + 2, row2Top + 2, row2W - 4, 4 * scale)
    ctx.globalAlpha = 1.0

    ctx.strokeStyle = 'rgba(69, 10, 10, 0.4)'
    ctx.lineWidth = 1.2
    ctx.beginPath()
    ctx.moveTo(0, row2Top)
    ctx.lineTo(0, row3Top)
    ctx.stroke()

    ctx.strokeStyle = '#450A0A'
    ctx.lineWidth = 2.2
    ctx.strokeRect(row2Left + 1, row2Top + 1, row2W - 2, row2H - 1)

    // 3. TOP TIER (Row 1: 1 unit wide turret peak + golden finial + waving red flag)
    const row1W = cellPx * 1.05
    const row1H = cellPx * 0.62
    const row1Left = -row1W / 2
    const row1Top = row2Top - row1H

    drawStud(-7 * scale, row1Top, studW * 0.85, studH, '#EF4444', '#450A0A')
    drawStud(7 * scale, row1Top, studW * 0.85, studH, '#EF4444', '#450A0A')

    ctx.fillStyle = '#B91C1C'
    ctx.strokeStyle = '#450A0A'
    ctx.lineWidth = 2.2
    ctx.fillRect(row1Left, row1Top, row1W, row1H)

    ctx.fillStyle = '#FACC15'
    ctx.fillRect(row1Left + 2, row1Top + 2, row1W - 4, 3.5 * scale)
    ctx.strokeRect(row1Left + 1, row1Top + 1, row1W - 2, row1H - 1)

    // 4. FLAGPOLE & WAVING RED PENNANT FLAG AT THE SUMMIT
    const poleBaseY = row1Top - studH
    const poleTopY = minY + 2 * scale
    ctx.strokeStyle = '#F8FAFC'
    ctx.lineWidth = 3 * scale
    ctx.beginPath()
    ctx.moveTo(0, poleBaseY)
    ctx.lineTo(0, poleTopY)
    ctx.stroke()

    ctx.strokeStyle = '#1E293B'
    ctx.lineWidth = 1.2
    ctx.strokeRect(-1.5 * scale, poleTopY, 3 * scale, poleBaseY - poleTopY)

    // Waving crimson pennant flag pointing right with golden border
    const wave = Math.sin(performance.now() * 0.008) * (2.5 * scale)
    ctx.fillStyle = '#EF4444'
    ctx.strokeStyle = '#FACC15'
    ctx.lineWidth = 1.8
    ctx.beginPath()
    ctx.moveTo(1.5 * scale, poleTopY + 1 * scale)
    ctx.quadraticCurveTo(
      14 * scale,
      poleTopY + 3 * scale + wave,
      26 * scale,
      poleTopY + 8 * scale + wave * 0.6
    )
    ctx.quadraticCurveTo(
      14 * scale,
      poleTopY + 13 * scale + wave,
      1.5 * scale,
      poleTopY + 16 * scale
    )
    ctx.closePath()
    ctx.fill()
    ctx.stroke()

    // Golden finial ball at top of flagpole
    ctx.fillStyle = '#FACC15'
    ctx.strokeStyle = '#713F12'
    ctx.lineWidth = 1.5
    ctx.beginPath()
    ctx.arc(0, poleTopY, 3.8 * scale, 0, Math.PI * 2)
    ctx.fill()
    ctx.stroke()

    ctx.restore()
  }

  /**
   * Renders organic Tricky Towers-style Super Glue decoration on a piece:
   * 1. Glossy dripping glue puddles along top-exposed cell edges (like the dripping patches in the reference image).
   * 2. Wavy S-curved glue tendrils ("vinhas de cola") with lateral glue droplets crawling across the piece's cells.
   */
  private drawPieceSuperGlueDecoration(
    ctx: CanvasRenderingContext2D,
    cells: Array<{ x: number; y: number }>,
    cellPx: number,
    scale: number,
    hasNeighbor: (cell: { x: number; y: number }, dx: number, dy: number) => boolean,
    isSourceGluePiece: boolean
  ): void {
    ctx.save()

    // 1. Dripping glue puddles on top-exposed cell edges
    let cellIdx = 0
    for (const cell of cells) {
      cellIdx++
      if (!hasNeighbor(cell, 0, -1)) {
        // If it's a secondary neighbor piece that got glued (`!isSourceGluePiece`), only draw drips on every other top cell
        // (and TowerInstance also draws targeted drip caps right where the glue vines landed!)
        if (!isSourceGluePiece && cellIdx % 2 === 0) continue
        const x0 = cell.x * cellPx - cellPx / 2
        const y0 = cell.y * cellPx - cellPx / 2
        this.drawGlueDripCap(ctx, x0, y0, cellPx, scale, cellIdx * 1.7)
      }
    }

    // 2. If this piece itself is the SUPER_GLUE source piece, draw internal crawling glue vines across its cells
    // so even while falling in the air (or sitting on the tower) it has visible glue tendrils!
    if (isSourceGluePiece && cells.length >= 2) {
      const maxPairs = Math.min(2, cells.length - 1)
      for (let i = 0; i < maxPairs; i++) {
        const cA = cells[i]
        const cB = cells[i + 1]
        const ax = cA.x * cellPx
        const ay = cA.y * cellPx
        const bx = cB.x * cellPx
        const by = cB.y * cellPx
        const dx = bx - ax
        const dy = by - ay
        const len = Math.hypot(dx, dy) || 1
        const nx = -dy / len
        const ny = dx / len
        const amp = (i % 2 === 0 ? 1 : -1) * 8.5 * scale

        const p0 = {
          x: ax - (dx / len) * 4 * scale + nx * 2 * scale,
          y: ay - (dy / len) * 4 * scale + ny * 2 * scale,
        }
        const p3 = {
          x: bx + (dx / len) * 4 * scale - nx * 2 * scale,
          y: by + (dy / len) * 4 * scale - ny * 2 * scale,
        }
        const cp1 = {
          x: ax + dx * 0.33 + nx * amp,
          y: ay + dy * 0.33 + ny * amp,
        }
        const cp2 = {
          x: ax + dx * 0.68 - nx * amp * 0.9,
          y: ay + dy * 0.68 - ny * amp * 0.9,
        }

        this.drawGlueVineTendril(ctx, p0, cp1, cp2, p3, {
          scale: scale * 0.92,
          progress: 1,
          seed: i + 1,
          beadCount: 3,
        })
      }
    }

    ctx.restore()
  }

  /**
   * Draws a thick, cartoon-outlined dripping glue cap along the top edge of a block cell
   * (matching the dripping patches on the horizontal block in the reference image, styled as glossy white/cyan glue).
   */
  public drawGlueDripCap(
    ctx: CanvasRenderingContext2D,
    x0: number,
    y0: number,
    width: number,
    scale: number,
    seedOffset: number = 0
  ): void {
    const pad = 1.5 * scale
    const left = x0 + pad
    const right = x0 + width - pad
    const w = right - left
    if (w <= 4) return

    const d1 = (6.5 + Math.sin(seedOffset + 0.5) * 2.2) * scale
    const d2 = (10.5 + Math.cos(seedOffset + 1.4) * 2.5) * scale
    const d3 = (7.2 + Math.sin(seedOffset + 2.7) * 2.0) * scale
    const valley1 = 4.2 * scale
    const valley2 = 4.6 * scale

    const traceDripPath = () => {
      ctx.beginPath()
      ctx.moveTo(left, y0 + 2 * scale)
      ctx.quadraticCurveTo(left, y0, left + 3 * scale, y0)
      ctx.lineTo(right - 3 * scale, y0)
      ctx.quadraticCurveTo(right, y0, right, y0 + 2 * scale)
      // Right lobe drop
      ctx.lineTo(right, y0 + d3 * 0.65)
      ctx.quadraticCurveTo(
        left + w * 0.84,
        y0 + d3 * 1.15,
        left + w * 0.7,
        y0 + valley2
      )
      // Center deep drip lobe
      ctx.quadraticCurveTo(
        left + w * 0.52,
        y0 + d2 * 1.22,
        left + w * 0.34,
        y0 + valley1
      )
      // Left drip lobe
      ctx.quadraticCurveTo(
        left + w * 0.16,
        y0 + d1 * 1.15,
        left,
        y0 + d1 * 0.6
      )
      ctx.closePath()
    }

    ctx.save()
    traceDripPath()
    // Soft cyan-white glue fill
    const grad = ctx.createLinearGradient(0, y0, 0, y0 + 12 * scale)
    grad.addColorStop(0, '#FFFFFF')
    grad.addColorStop(0.55, '#E0F2FE')
    grad.addColorStop(1, '#7DD3FC')
    ctx.fillStyle = grad
    ctx.fill()

    // Bold dark cartoon outline (matching Tricky Towers art style)
    ctx.strokeStyle = '#0F172A'
    ctx.lineWidth = 2.0 * scale
    ctx.lineJoin = 'round'
    ctx.stroke()

    // Top specular white gloss bar
    ctx.fillStyle = '#FFFFFF'
    ctx.fillRect(
      left + 2.5 * scale,
      y0 + 1.2 * scale,
      Math.max(2, w - 5 * scale),
      2.2 * scale
    )
    ctx.restore()
  }

  /**
   * Draws an organic, wavy S-curved Glue Vine Tendril ("Vinha de Cola") from `p0` to `p3`
   * with alternating lateral glue droplets/buds along the stem (matching the vine leaves in the reference screenshot,
   * rendered as viscous white/cyan toy glue with a bold dark cartoon outline).
   */
  public drawGlueVineTendril(
    ctx: CanvasRenderingContext2D,
    p0: { x: number; y: number },
    cp1: { x: number; y: number },
    cp2: { x: number; y: number },
    p3: { x: number; y: number },
    options?: {
      scale?: number
      progress?: number
      seed?: number
      beadCount?: number
    }
  ): void {
    const scale = options?.scale ?? 1.0
    const progress = Math.max(0, Math.min(1, options?.progress ?? 1.0))
    if (progress <= 0.02) return

    const seed = options?.seed ?? 1
    const beadCount = options?.beadCount ?? 4

    // Subdivide cubic Bezier [0, progress] via De Casteljau so the vine spreads smoothly from p0 to p3
    const lerpPt = (
      a: { x: number; y: number },
      b: { x: number; y: number },
      t: number
    ) => ({
      x: a.x + (b.x - a.x) * t,
      y: a.y + (b.y - a.y) * t,
    })

    const q0 = p0
    const q1 = lerpPt(p0, cp1, progress)
    const m1 = lerpPt(cp1, cp2, progress)
    const q2 = lerpPt(q1, m1, progress)
    const r2 = lerpPt(cp2, p3, progress)
    const n2 = lerpPt(m1, r2, progress)
    const q3 = lerpPt(q2, n2, progress)

    // Helper to evaluate point & tangent on the FULL curve at parameter t in [0, 1]
    const evalBezierPoint = (t: number) => {
      const u = 1 - t
      const b0 = u * u * u
      const b1 = 3 * u * u * t
      const b2 = 3 * u * t * t
      const b3 = t * t * t
      return {
        x: b0 * p0.x + b1 * cp1.x + b2 * cp2.x + b3 * p3.x,
        y: b0 * p0.y + b1 * cp1.y + b2 * cp2.y + b3 * p3.y,
      }
    }

    const evalBezierTangent = (t: number) => {
      const u = 1 - t
      const d0 = 3 * u * u
      const d1 = 6 * u * t
      const d2 = 3 * t * t
      const tx =
        d0 * (cp1.x - p0.x) + d1 * (cp2.x - cp1.x) + d2 * (p3.x - cp2.x)
      const ty =
        d0 * (cp1.y - p0.y) + d1 * (cp2.y - cp1.y) + d2 * (p3.y - cp2.y)
      const len = Math.hypot(tx, ty) || 1
      return { x: tx / len, y: ty / len }
    }

    ctx.save()
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'

    // 1. Anchor glue puddle blobs at root (q0) and spreading tip (q3)
    const drawAnchorPuddle = (pt: { x: number; y: number }, rad: number) => {
      ctx.fillStyle = '#E0F2FE'
      ctx.strokeStyle = '#0F172A'
      ctx.lineWidth = 2.2 * scale
      ctx.beginPath()
      ctx.arc(pt.x, pt.y, rad, 0, Math.PI * 2)
      ctx.arc(pt.x - rad * 0.65, pt.y + rad * 0.35, rad * 0.68, 0, Math.PI * 2)
      ctx.arc(pt.x + rad * 0.65, pt.y - rad * 0.25, rad * 0.62, 0, Math.PI * 2)
      ctx.fill()
      ctx.stroke()

      ctx.fillStyle = '#FFFFFF'
      ctx.beginPath()
      ctx.arc(pt.x - rad * 0.2, pt.y - rad * 0.25, rad * 0.42, 0, Math.PI * 2)
      ctx.fill()
    }

    drawAnchorPuddle(q0, 3.8 * scale)
    if (progress > 0.25) {
      drawAnchorPuddle(q3, 3.4 * scale * Math.min(1, progress * 1.1))
    }

    // 2. Lateral Glue Droplets / Buds ("Gotas/Brotos Laterais de Cola" along the vine stem, like the leaves in the image)
    for (let i = 0; i < beadCount; i++) {
      const t = (i + 0.85) / (beadCount + 0.7)
      if (t > progress - 0.04) continue

      const popScale = Math.min(1, (progress - t) * 5.5) * scale
      const pt = evalBezierPoint(t)
      const tan = evalBezierTangent(t)
      const side = (i + Math.round(seed)) % 2 === 0 ? 1 : -1
      const nx = -tan.y * side
      const ny = tan.x * side

      // Position the lateral glue bud sticking out from the side of the vine stem
      const offsetDist = 4.6 * popScale
      const bx = pt.x + nx * offsetDist + tan.x * (1.2 * popScale)
      const by = pt.y + ny * offsetDist + tan.y * (1.2 * popScale)
      const budAngle = Math.atan2(tan.y, tan.x) + side * 0.95

      ctx.save()
      ctx.translate(bx, by)
      ctx.rotate(budAngle)

      // Dark cartoon outline around lateral glue droplet
      ctx.fillStyle = '#0F172A'
      ctx.beginPath()
      ctx.ellipse(0, 0, 5.2 * popScale, 3.3 * popScale, 0, 0, Math.PI * 2)
      ctx.fill()

      // Cyan-shaded glue base
      ctx.fillStyle = '#7DD3FC'
      ctx.beginPath()
      ctx.ellipse(0, 0.3 * popScale, 3.5 * popScale, 1.9 * popScale, 0, 0, Math.PI * 2)
      ctx.fill()

      // Creamy white glue body
      ctx.fillStyle = '#F0F9FF'
      ctx.beginPath()
      ctx.ellipse(-0.2 * popScale, -0.2 * popScale, 3.3 * popScale, 1.7 * popScale, 0, 0, Math.PI * 2)
      ctx.fill()

      // Glossy white highlight dot on the bud
      ctx.fillStyle = '#FFFFFF'
      ctx.beginPath()
      ctx.ellipse(-0.9 * popScale, -0.5 * popScale, 1.5 * popScale, 0.75 * popScale, 0, 0, Math.PI * 2)
      ctx.fill()

      ctx.restore()
    }

    // 3. Main Wavy S-Curved Glue Stem (4-pass cartoon cel-shaded stroke)
    const traceStem = (offsetY: number = 0) => {
      ctx.beginPath()
      ctx.moveTo(q0.x, q0.y + offsetY)
      ctx.bezierCurveTo(
        q1.x,
        q1.y + offsetY,
        q2.x,
        q2.y + offsetY,
        q3.x,
        q3.y + offsetY
      )
    }

    // Pass A: Bold dark cartoon outline (#0F172A)
    traceStem(0)
    ctx.strokeStyle = '#0F172A'
    ctx.lineWidth = 8.2 * scale
    ctx.stroke()

    // Pass B: Soft cyan glue shadow underside (#7DD3FC)
    traceStem(0.8 * scale)
    ctx.strokeStyle = '#7DD3FC'
    ctx.lineWidth = 4.8 * scale
    ctx.stroke()

    // Pass C: Creamy white glue core (#F0F9FF)
    traceStem(0)
    ctx.strokeStyle = '#F0F9FF'
    ctx.lineWidth = 3.8 * scale
    ctx.stroke()

    // Pass D: Pure white specular shine along upper edge (#FFFFFF)
    traceStem(-0.7 * scale)
    ctx.strokeStyle = '#FFFFFF'
    ctx.lineWidth = 1.5 * scale
    ctx.stroke()

    ctx.restore()
  }
}

export const spriteRegistry = new SpriteRegistry()

