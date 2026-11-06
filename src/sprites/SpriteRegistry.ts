import {
  PiecePowerEffect,
  PieceType,
  PieceVariant,
  GAME_CONSTANTS,
} from '../types/game'
import type { PowerId } from '../game/PowersCatalog'
import { optionsStore, formatKeyCodeLabel } from '../services/optionsStore'

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
  castUrls?: string[]
}

export interface BlockSkinInfo {
  id: string
  name: string
  shortName: string
  emoji: string
  description: string
  accentColor: string
  pieceUrls: Partial<Record<PieceType, string>>
  previewUrl: string
  squarePreviewUrl: string
  palette: PlaceholderColorTheme[]
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

const playerCastAnimAssets = import.meta.glob<string>(
  '../../assets/sprites/player/cast/*.png',
  { eager: true, import: 'default' }
)

const blockSpriteAssets = import.meta.glob<string>(
  '../../assets/sprites/block/*.png',
  { eager: true, import: 'default' }
)

const blockSkinSpriteAssets = import.meta.glob<string>(
  '../../assets/sprites/block/skins/*/*.png',
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

const menuShopSpriteAssets = import.meta.glob<string>(
  '../../assets/sprites/menu/shop/*.png',
  { eager: true, import: 'default' }
)

const survivorMapAssets = import.meta.glob<string>(
  '../../assets/sprites/other/map/survivor/*.{png,jpg,jpeg}',
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

/**
 * 10 Natural Real-Wood Color Themes for the `wood` block skin (`assets/sprites/block/skins/wood`),
 * dynamically coloring each piece in a distinct authentic wood tone (Oak, Pine, Mahogany, Walnut,
 * Cherry, Cedar, Teak, Dark Ipê/Imbuia, Maple, Rosewood) while preserving wood grain, knots, and pegs.
 */
export const WOOD_COLOR_PALETTE: PlaceholderColorTheme[] = [
  {
    fill: '#C88A4B',
    border: '#5C3818',
    highlight: '#ECC391',
    label: 'Carvalho Dourado (Oak)',
  },
  {
    fill: '#DEB881',
    border: '#78522B',
    highlight: '#F7E1BE',
    label: 'Pinho Mel (Pine)',
  },
  {
    fill: '#A34830',
    border: '#4A190E',
    highlight: '#D17A62',
    label: 'Mogno Imperial (Mahogany)',
  },
  {
    fill: '#7A4B31',
    border: '#361D0F',
    highlight: '#AC7B5E',
    label: 'Nogueira Escura (Walnut)',
  },
  {
    fill: '#BC6039',
    border: '#572310',
    highlight: '#E59470',
    label: 'Cerejeira (Cherry)',
  },
  {
    fill: '#AD5A44',
    border: '#4D2117',
    highlight: '#D68974',
    label: 'Cedro Rosa (Cedar)',
  },
  {
    fill: '#B87E35',
    border: '#543510',
    highlight: '#E0AE68',
    label: 'Teca Âmbar (Teak)',
  },
  {
    fill: '#633F2B',
    border: '#2B180E',
    highlight: '#916850',
    label: 'Imbuia / Ipê Tabaco',
  },
  {
    fill: '#D1A26B',
    border: '#6B4B27',
    highlight: '#EECD9F',
    label: 'Bordo / Freixo (Maple)',
  },
  {
    fill: '#873B2D',
    border: '#3D150D',
    highlight: '#B8695A',
    label: 'Jacarandá (Rosewood)',
  },
]

/**
 * 10 Vibrant Bottle Cap & Circular Button Colors (`tampas e círculos dentro da arte`)
 * applied dynamically to `assets/sprites/block/skins/diy` while keeping the cardboard and brown silvertape fixed.
 */
export const DIY_COLOR_PALETTE: PlaceholderColorTheme[] = [
  {
    fill: '#EF4444',
    border: '#7F1D1D',
    highlight: '#FCA5A5',
    label: 'Papelão + Tampa Vermelha',
  },
  {
    fill: '#0095FF',
    border: '#004A8F',
    highlight: '#80CAFF',
    label: 'Papelão + Tampa Azul',
  },
  {
    fill: '#FACC15',
    border: '#854D0E',
    highlight: '#FEF08A',
    label: 'Papelão + Tampa Amarela',
  },
  {
    fill: '#22C55E',
    border: '#14532D',
    highlight: '#86EFAC',
    label: 'Papelão + Tampa Verde',
  },
  {
    fill: '#FF6D00',
    border: '#9A3412',
    highlight: '#FDBA74',
    label: 'Papelão + Tampa Laranja',
  },
  {
    fill: '#9333EA',
    border: '#4C1D95',
    highlight: '#D8B4FE',
    label: 'Papelão + Tampa Roxa',
  },
  {
    fill: '#EC4899',
    border: '#831843',
    highlight: '#F9A8D4',
    label: 'Papelão + Tampa Rosa',
  },
  {
    fill: '#06B6D4',
    border: '#155E75',
    highlight: '#A5F3FC',
    label: 'Papelão + Tampa Turquesa',
  },
  {
    fill: '#84CC16',
    border: '#365314',
    highlight: '#D9F99D',
    label: 'Papelão + Tampa Limão',
  },
  {
    fill: '#3B82F6',
    border: '#1E3A8A',
    highlight: '#93C5FD',
    label: 'Papelão + Tampa Azul Real',
  },
]

/**
 * 10 Warm 24k Gold Bullion Themes for the `gold` block skin (`assets/sprites/block/skins/gold`).
 */
export const GOLD_COLOR_PALETTE: PlaceholderColorTheme[] = [
  {
    fill: '#F59E0B',
    border: '#78350F',
    highlight: '#FEF08A',
    label: 'Ouro 24k Real',
  },
  {
    fill: '#EAB308',
    border: '#713F12',
    highlight: '#FEF9C3',
    label: 'Ouro Imperial',
  },
  {
    fill: '#FBBF24',
    border: '#78350F',
    highlight: '#FFFBEB',
    label: 'Ouro Sol Nascente',
  },
  {
    fill: '#D97706',
    border: '#652B0D',
    highlight: '#FDE68A',
    label: 'Ouro Âmbar Antigo',
  },
  {
    fill: '#FACC15',
    border: '#854D0E',
    highlight: '#FEF9C3',
    label: 'Ouro Champanhe',
  },
  {
    fill: '#F59E0B',
    border: '#78350F',
    highlight: '#FEF08A',
    label: 'Lingote Dourado',
  },
  {
    fill: '#EAB308',
    border: '#713F12',
    highlight: '#FFFBEB',
    label: 'Ouro Reluzente',
  },
  {
    fill: '#FBBF24',
    border: '#78350F',
    highlight: '#FEF08A',
    label: 'Ouro da Coroa',
  },
  {
    fill: '#D97706',
    border: '#652B0D',
    highlight: '#FDE68A',
    label: 'Ouro Nobre',
  },
  {
    fill: '#FACC15',
    border: '#854D0E',
    highlight: '#FFFBEB',
    label: 'Ouro Alquímico',
  },
]

const DEFAULT_PALETTE_BY_TYPE: Record<PieceType, number> = {
  I: 0, // Azul Vivo / Carvalho
  O: 1, // Amarelo Sol / Pinho Mel
  T: 5, // Roxo Mágico / Cedro Rosa
  L: 4, // Laranja Vibrante / Cerejeira
  J: 9, // Azul Real / Jacarandá
  S: 3, // Verde Esmeralda / Nogueira
  Z: 2, // Vermelho Vivo / Mogno
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
  private playerCastFrameImages: Map<string, Array<HTMLImageElement | null>> =
    new Map()
  private playerCastFrameUrls: Map<string, string[]> = new Map()
  private activePlayerSkinId: string = 'player_mage'
  private blockSkins: BlockSkinInfo[] = []
  private activeBlockSkinId: string = 'default'
  private blockSkinImages: Map<
    string,
    Partial<Record<PieceType, HTMLImageElement>>
  > = new Map()
  private loadedOrLoadingBlockSkins: Set<string> = new Set()
  private perBlockSkinCanvases: Map<
    string,
    Partial<Record<PieceType, HTMLCanvasElement[]>>
  > = new Map()
  private collisionUrlByType: Map<PieceType, string> = new Map()
  private collisionImageByType: Map<PieceType, HTMLImageElement> = new Map()
  private listeners: Array<() => void> = []
  private notifyScheduled: boolean = false
  private survivorSprites: {
    background: HTMLImageElement | null
    estalagmite: HTMLImageElement | null
    nuvem: HTMLImageElement | null
    smoke: HTMLImageElement | null
    raios: Array<HTMLImageElement | null>
  } = {
    background: null,
    estalagmite: null,
    nuvem: null,
    smoke: null,
    raios: [null, null, null, null],
  }

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
    if (this.notifyScheduled) return
    this.notifyScheduled = true
    const flush = () => {
      this.notifyScheduled = false
      for (const l of this.listeners) {
        l()
      }
    }
    if (typeof window !== 'undefined' && typeof window.requestAnimationFrame === 'function') {
      window.requestAnimationFrame(flush)
    } else {
      setTimeout(flush, 16)
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

    // 1. Discover Menu & Shop Sprites first (instant URL catalog for Title Screen & Menus)
    for (const [path, url] of Object.entries(menuSpriteAssets)) {
      const fileName = path.split('/').pop() || path
      const key = fileName.replace(/\.png$/i, '').toLowerCase()
      this.menuSprites[key] = url
    }

    for (const [path, url] of Object.entries(menuShopSpriteAssets)) {
      const fileName = path.split('/').pop() || path
      const key = fileName.replace(/\.png$/i, '').toLowerCase()
      this.menuSprites[key] = url
      if (!key.startsWith('shop_')) {
        this.menuSprites[`shop_${key}`] = url
      }
    }

    if (this.menuSprites.button_clean) {
      this.menuSprites.button_clean_green = this.menuSprites.button_clean
      this.menuSprites.button_clean_orange = this.menuSprites.button_clean
      this.menuSprites.button_clean_yellow = this.menuSprites.button_clean
      this.menuSprites.button_clean_purple = this.menuSprites.button_clean
      this.menuSprites.button_clean_blue = this.menuSprites.button_clean

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
        const purpleCanvas = this.createTintedBlockCanvas(btnImg, {
          fill: '#9333EA',
          border: '#1B2230',
          highlight: '#D8B4FE',
          label: 'Botão Roxo',
        })
        const blueCanvas = this.createTintedBlockCanvas(btnImg, {
          fill: '#0095FF',
          border: '#1B2230',
          highlight: '#80CAFF',
          label: 'Botão Azul',
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
        if (purpleCanvas) {
          this.menuSprites.button_clean_purple = purpleCanvas.toDataURL('image/png')
        }
        if (blueCanvas) {
          this.menuSprites.button_clean_blue = blueCanvas.toDataURL('image/png')
        }
        this.notifyListeners()
      }
      btnImg.src = this.menuSprites.button_clean
    }

    // 2. Priority Scenery & Background Sprites (bg_1.png, bg_left_2.png, bg_right_2.png, base.png, castle_roof.png, side_island.png)
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

    for (const [path, url] of Object.entries(otherSpriteAssets)) {
      const fileName = (path.split('/').pop() || '').toLowerCase()
      if (fileName === 'base.png') {
        const pedestalSlot = this.getSlot('scenery_pedestal')
        pedestalSlot.spriteUrl = url
        this.registerSprite('base_plate', url).then(() => {
          const baseSlot = this.getSlot('base_plate')
          if (baseSlot.image) {
            pedestalSlot.image = baseSlot.image
            pedestalSlot.loaded = true
            this.notifyListeners()
          }
        })
      } else if (fileName === 'castle_roof.png') {
        this.registerSprite('piece_CASTLE_ROOF', url)
      } else if (fileName === 'side_island.png') {
        this.registerSprite('side_island', url)
      }
    }

    // 3. Catalog 5-Frame Power-Casting URLs (actual Image downloads deferred until after Title Screen renders)
    const deferredCastEntries: Array<{ skinId: string; frameIdx: number; url: string }> = []
    for (const [path, url] of Object.entries(playerCastAnimAssets)) {
      const fileName = path.split('/').pop() || path
      const match = fileName.match(/^(.+)_cast_(\d+)\.png$/i)
      if (!match) continue
      const skinId = match[1].toLowerCase()
      const frameNum = parseInt(match[2], 10)
      if (frameNum < 1 || frameNum > 5) continue
      const frameIdx = frameNum - 1

      if (!this.playerCastFrameUrls.has(skinId)) {
        this.playerCastFrameUrls.set(skinId, ['', '', '', '', ''])
      }
      if (!this.playerCastFrameImages.has(skinId)) {
        this.playerCastFrameImages.set(skinId, [null, null, null, null, null])
      }
      this.playerCastFrameUrls.get(skinId)![frameIdx] = url
      deferredCastEntries.push({ skinId, frameIdx, url })
    }

    // 4. Discover & Preload Player Idle Skins (4 sprites)
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
      const castUrls = (this.playerCastFrameUrls.get(lowerId) || []).filter(
        Boolean
      )

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
        castUrls,
        order: meta ? meta.order : 99,
      })

      // Store HTMLImageElement immediately so setActivePlayerSkin never spawns duplicate Image downloads
      const preloadImg = new Image()
      preloadImg.crossOrigin = 'anonymous'
      this.playerSkinImages.set(id, preloadImg)
      preloadImg.onload = () => {
        if (this.activePlayerSkinId === id) {
          const mascotSlot = this.getSlot('mascot_floating')
          mascotSlot.spriteUrl = url
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

    // 5. Discover Block Sprites, Block Skins & Collision Masks in assets/sprites/block
    const defaultBlockUrls: Partial<Record<PieceType, string>> = {}
    for (const [path, url] of Object.entries(blockSpriteAssets)) {
      const fileName = path.split('/').pop() || ''
      const baseName = fileName.replace(/\.png$/i, '').toUpperCase()
      if (['I', 'O', 'T', 'L', 'J', 'S', 'Z'].includes(baseName)) {
        defaultBlockUrls[baseName as PieceType] = url
      }
    }

    for (const [path, url] of Object.entries(blockCollisionAssets)) {
      const fileName = path.split('/').pop() || ''
      const match = fileName.match(/^([a-zA-Z])_col+ision\.png$/i)
      if (match) {
        const typeKey = match[1].toUpperCase() as PieceType
        if (['I', 'O', 'T', 'L', 'J', 'S', 'Z'].includes(typeKey)) {
          this.collisionUrlByType.set(typeKey, url)
          const colImg = new Image()
          colImg.crossOrigin = 'anonymous'
          colImg.onload = () => {
            this.collisionImageByType.set(typeKey, colImg)
            const slot = this.slots.get(`piece_${typeKey}` as SpriteKey)
            if (slot && slot.image && !slot.hasCollisionMask) {
              slot.collisionImage = colImg
              slot.collisionBox = this.analyzeCollisionMask(colImg, slot.image)
              slot.hasCollisionMask = true
              this.notifyListeners()
            }
          }
          colImg.src = url
        }
      }
    }

    // Group extra block skins by subfolder name in assets/sprites/block/skins/<skinId>/*.png
    const skinUrlsByFolder = new Map<string, Partial<Record<PieceType, string>>>()
    for (const [path, url] of Object.entries(blockSkinSpriteAssets)) {
      const parts = path.split('/')
      const fileName = parts.pop() || ''
      const folderName = (parts.pop() || '').toLowerCase()
      if (!folderName) continue
      const baseName = fileName.replace(/\.png$/i, '').toUpperCase()
      if (!['I', 'O', 'T', 'L', 'J', 'S', 'Z'].includes(baseName)) continue
      if (!skinUrlsByFolder.has(folderName)) {
        skinUrlsByFolder.set(folderName, {})
      }
      skinUrlsByFolder.get(folderName)![baseName as PieceType] = url
    }

    const blockSkinMeta: Record<
      string,
      {
        name: string
        shortName: string
        emoji: string
        description: string
        accentColor: string
        palette: PlaceholderColorTheme[]
        order: number
      }
    > = {
      default: {
        name: '🧱 Plástico Clássico',
        shortName: 'Plástico',
        emoji: '🧱',
        description: 'Blocos de montar clássicos em 10 cores vibrantes de brinquedo',
        accentColor: '#3B82F6',
        palette: PIECE_COLOR_PALETTE,
        order: 1,
      },
      wood: {
        name: '🪵 Madeira Real',
        shortName: 'Madeira',
        emoji: '🪵',
        description:
          'Peças entalhadas com veios e nós em 10 tons dinâmicos inspirados em madeiras reais (Carvalho, Mogno, Nogueira, Pinho, Cerejeira e mais)',
        accentColor: '#C88A4B',
        palette: WOOD_COLOR_PALETTE,
        order: 2,
      },
      diy: {
        name: '📦 Papelão DIY',
        shortName: 'Papelão DIY',
        emoji: '📦',
        description:
          'Caixas sempre em cor de papelão com fitas silvertape marrom e tampas/círculos coloridos dinamicamente',
        accentColor: '#D97706',
        palette: DIY_COLOR_PALETTE,
        order: 3,
      },
      gold: {
        name: '👑 Ouro Real',
        shortName: 'Ouro',
        emoji: '👑',
        description:
          'Lingotes de ouro 24k reluzentes com charme dourado e partículas sutis de brilho',
        accentColor: '#F59E0B',
        palette: GOLD_COLOR_PALETTE,
        order: 4,
      },
    }

    const discoveredBlockSkins: Array<BlockSkinInfo & { order: number }> = [
      {
        id: 'default',
        ...blockSkinMeta.default,
        pieceUrls: defaultBlockUrls,
        previewUrl:
          defaultBlockUrls.T ||
          defaultBlockUrls.O ||
          defaultBlockUrls.J ||
          '',
        squarePreviewUrl:
          defaultBlockUrls.O ||
          defaultBlockUrls.T ||
          '',
      },
    ]

    for (const [folderId, pieceUrls] of skinUrlsByFolder.entries()) {
      const meta = blockSkinMeta[folderId]
      const fallbackLabel = folderId
        .replace(/_/g, ' ')
        .replace(/\b\w/g, (c) => c.toUpperCase())
      discoveredBlockSkins.push({
        id: folderId,
        name: meta ? meta.name : `🧱 ${fallbackLabel}`,
        shortName: meta ? meta.shortName : fallbackLabel,
        emoji: meta ? meta.emoji : '🧱',
        description: meta
          ? meta.description
          : `Skin de blocos customizada (${fallbackLabel})`,
        accentColor: meta ? meta.accentColor : '#F59E0B',
        pieceUrls,
        previewUrl:
          pieceUrls.T ||
          pieceUrls.O ||
          pieceUrls.J ||
          pieceUrls.I ||
          '',
        squarePreviewUrl:
          pieceUrls.O ||
          pieceUrls.T ||
          pieceUrls.J ||
          '',
        palette: meta ? meta.palette : PIECE_COLOR_PALETTE,
        order: meta ? meta.order : 50,
      })
    }

    discoveredBlockSkins.sort(
      (a, b) => a.order - b.order || a.name.localeCompare(b.name)
    )
    this.blockSkins = discoveredBlockSkins.map(
      ({ order: _order, ...skin }) => skin
    )

    for (const bSkin of this.blockSkins) {
      this.blockSkinImages.set(bSkin.id, {})
    }

    // Restore persisted block skin or default to 'default'
    let savedBlockSkinId: string | null = null
    try {
      savedBlockSkinId = window.localStorage.getItem('toy_tower_block_skin')
    } catch {
      savedBlockSkinId = null
    }
    const initialBlockSkin =
      (savedBlockSkinId &&
        this.blockSkins.find((s) => s.id === savedBlockSkinId)) ||
      this.blockSkins[0]
    this.activeBlockSkinId = initialBlockSkin ? initialBlockSkin.id : 'default'

    // Load active block skin (and 'default' fallback) immediately; defer secondary block skins, cast frames & Survivor Mode assets
    this.ensureBlockSkinLoaded('default')
    if (this.activeBlockSkinId !== 'default') {
      this.ensureBlockSkinLoaded(this.activeBlockSkinId)
    }

    const loadDeferredAssets = () => {
      for (const bSkin of this.blockSkins) {
        this.ensureBlockSkinLoaded(bSkin.id)
      }

      for (const { skinId, frameIdx, url } of deferredCastEntries) {
        const castImg = new Image()
        castImg.crossOrigin = 'anonymous'
        castImg.onload = () => {
          const arr = this.playerCastFrameImages.get(skinId)
          if (arr) {
            arr[frameIdx] = castImg
          }
          this.notifyListeners()
        }
        castImg.src = url
      }

      const loadSurvivorImg = (
        url: string,
        onReady: (img: HTMLImageElement) => void
      ) => {
        const img = new Image()
        img.crossOrigin = 'anonymous'
        img.onload = () => {
          onReady(img)
          this.notifyListeners()
        }
        img.src = url
      }

      for (const [path, url] of Object.entries(survivorMapAssets)) {
        const fileName = (path.split('/').pop() || '').toLowerCase()
        if (fileName === 'background.jpg' || fileName === 'background.png') {
          loadSurvivorImg(url, (img) => {
            this.survivorSprites.background = img
          })
        } else if (fileName === 'estalagmite.png') {
          loadSurvivorImg(url, (img) => {
            this.survivorSprites.estalagmite = img
          })
        } else if (fileName === 'nuvem.png') {
          loadSurvivorImg(url, (img) => {
            this.survivorSprites.nuvem = img
          })
        } else if (fileName === 'smoke.png') {
          loadSurvivorImg(url, (img) => {
            this.survivorSprites.smoke = img
          })
        } else if (fileName === 'raio 1.png' || fileName === 'raio1.png') {
          loadSurvivorImg(url, (img) => {
            this.survivorSprites.raios[0] = img
          })
        } else if (fileName === 'raio 2.png' || fileName === 'raio2.png') {
          loadSurvivorImg(url, (img) => {
            this.survivorSprites.raios[1] = img
          })
        } else if (fileName === 'raio 3.png' || fileName === 'raio3.png') {
          loadSurvivorImg(url, (img) => {
            this.survivorSprites.raios[2] = img
          })
        } else if (fileName === 'raio 4.png' || fileName === 'raio4.png') {
          loadSurvivorImg(url, (img) => {
            this.survivorSprites.raios[3] = img
          })
        }
      }
    }

    if (typeof window !== 'undefined') {
      setTimeout(loadDeferredAssets, 650)
    } else {
      loadDeferredAssets()
    }
  }

  private ensureBlockSkinLoaded(skinId: string): void {
    if (this.loadedOrLoadingBlockSkins.has(skinId)) return
    const bSkin = this.blockSkins.find((s) => s.id === skinId)
    if (!bSkin) return
    this.loadedOrLoadingBlockSkins.add(skinId)

    let imgMap = this.blockSkinImages.get(bSkin.id)
    if (!imgMap) {
      imgMap = {}
      this.blockSkinImages.set(bSkin.id, imgMap)
    }

    const createMirroredImage = (
      srcImg: HTMLImageElement,
      onReady: (mirrored: HTMLImageElement) => void
    ) => {
      const w = srcImg.naturalWidth || srcImg.width
      const h = srcImg.naturalHeight || srcImg.height
      if (!w || !h) return
      const c = document.createElement('canvas')
      c.width = w
      c.height = h
      const cctx = c.getContext('2d')
      if (!cctx) return
      cctx.translate(w, 0)
      cctx.scale(-1, 1)
      cctx.drawImage(srcImg, 0, 0, w, h)
      const mirrored = new Image()
      mirrored.crossOrigin = 'anonymous'
      mirrored.onload = () => onReady(mirrored)
      mirrored.src = c.toDataURL('image/png')
    }

    const allTypes: PieceType[] = ['I', 'O', 'T', 'L', 'J', 'S', 'Z']
    for (const t of allTypes) {
      const url = bSkin.pieceUrls[t]
      if (!url) continue
      const img = new Image()
      img.crossOrigin = 'anonymous'
      img.onload = () => {
        imgMap![t] = img
        if (t === 'T') {
          const previewCanvas =
            bSkin.id === 'diy'
              ? this.createDiyTintedBlockCanvas(img, 0)
              : bSkin.id === 'gold'
                ? this.createGoldBlockCanvas(img, 0)
                : this.createTintedBlockCanvas(
                    img,
                    bSkin.palette[0] || PIECE_COLOR_PALETTE[0]
                  )
          if (previewCanvas) {
            bSkin.previewUrl = previewCanvas.toDataURL('image/png')
            this.notifyListeners()
          }
        } else if (t === 'O') {
          const squareCanvas =
            bSkin.id === 'diy'
              ? this.createDiyTintedBlockCanvas(img, 0)
              : bSkin.id === 'gold'
                ? this.createGoldBlockCanvas(img, 0)
                : this.createTintedBlockCanvas(
                    img,
                    bSkin.palette[0] || PIECE_COLOR_PALETTE[0]
                  )
          if (squareCanvas) {
            bSkin.squarePreviewUrl = squareCanvas.toDataURL('image/png')
            this.notifyListeners()
          }
        }
        if (t === 'J' && !bSkin.pieceUrls.L) {
          createMirroredImage(img, (mirroredL) => {
            imgMap!.L = mirroredL
            if (this.activeBlockSkinId === bSkin.id) {
              this.applyBlockSkinPieceImage('L', mirroredL, url)
            }
          })
        } else if (t === 'L' && !bSkin.pieceUrls.J) {
          createMirroredImage(img, (mirroredJ) => {
            imgMap!.J = mirroredJ
            if (this.activeBlockSkinId === bSkin.id) {
              this.applyBlockSkinPieceImage('J', mirroredJ, url)
            }
          })
        }
        if (this.activeBlockSkinId === bSkin.id) {
          this.applyBlockSkinPieceImage(t, img, url)
        }
      }
      img.src = url
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
    return this.playerSkins.map((s) => ({ ...s }))
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
    const mascotSlot = this.getSlot('mascot_floating')
    if (
      this.activePlayerSkinId === skin.id &&
      mascotSlot.spriteUrl === skin.url &&
      mascotSlot.loaded
    ) {
      return
    }
    this.activePlayerSkinId = skin.id
    try {
      window.localStorage.setItem('toy_tower_player_skin', skin.id)
    } catch {
      // Ignore storage errors
    }

    mascotSlot.placeholder.label = skin.name
    mascotSlot.placeholder.fill = skin.accentColor
    mascotSlot.spriteUrl = skin.url

    const cachedImg = this.playerSkinImages.get(skin.id)
    if (cachedImg) {
      if (cachedImg.complete && cachedImg.naturalWidth > 0) {
        mascotSlot.image = cachedImg
        mascotSlot.loaded = true
        this.notifyListeners()
      }
      // If cachedImg is still downloading, its onload handler in initBundledAssets will populate mascotSlot automatically
      return
    }

    this.registerSprite('mascot_floating', skin.url)
  }

  public cycleNextPlayerSkin(delta: number = 1): PlayerSkinInfo | null {
    if (this.playerSkins.length === 0) return null
    const currentIndex = Math.max(
      0,
      this.playerSkins.findIndex((s) => s.id === this.activePlayerSkinId)
    )
    const nextIndex =
      (currentIndex + delta + this.playerSkins.length) %
      this.playerSkins.length
    const nextSkin = this.playerSkins[nextIndex]
    this.setActivePlayerSkin(nextSkin.id)
    return nextSkin
  }

  public getBlockSkins(): BlockSkinInfo[] {
    return this.blockSkins.map((s) => ({ ...s }))
  }

  public getActiveBlockSkinId(): string {
    return this.activeBlockSkinId
  }

  public getActiveBlockSkin(): BlockSkinInfo | null {
    return (
      this.blockSkins.find((s) => s.id === this.activeBlockSkinId) ||
      this.blockSkins[0] ||
      null
    )
  }

  public getActiveBlockPalette(): PlaceholderColorTheme[] {
    return this.getActiveBlockSkin()?.palette || PIECE_COLOR_PALETTE
  }

  /**
   * Returns (and caches) the 10-color pre-rendered canvases for any block skin ID (`default`, `wood`, `diy`, `gold`),
   * enabling multiplayer opponents' towers to render their own equipped block skin in real time.
   */
  public getBlockSkinMultiColorCanvases(
    skinId: string,
    pieceType: PieceType
  ): HTMLCanvasElement[] | undefined {
    const normalizedId = (skinId || '').trim().toLowerCase() || 'default'
    this.ensureBlockSkinLoaded(normalizedId)
    if (normalizedId === this.activeBlockSkinId) {
      const slot = this.slots.get(`piece_${pieceType}` as SpriteKey)
      if (slot?.multiColorCanvases && slot.multiColorCanvases.length > 0) {
        return slot.multiColorCanvases
      }
    }

    let skinMap = this.perBlockSkinCanvases.get(normalizedId)
    if (skinMap?.[pieceType]) {
      return skinMap[pieceType]
    }

    const img =
      this.blockSkinImages.get(normalizedId)?.[pieceType] ||
      this.blockSkinImages.get('default')?.[pieceType]
    if (!img || !img.complete || (img.naturalWidth === 0 && img.width === 0)) {
      return undefined
    }

    const skinInfo =
      this.blockSkins.find((s) => s.id === normalizedId) ||
      this.getActiveBlockSkin()
    const palette = skinInfo?.palette || PIECE_COLOR_PALETTE

    const canvases = palette.map((colorTheme, idx) =>
      normalizedId === 'diy'
        ? this.createDiyTintedBlockCanvas(img, idx)
        : normalizedId === 'gold'
          ? this.createGoldBlockCanvas(img, idx)
          : this.createTintedBlockCanvas(img, colorTheme)
    )

    if (!skinMap) {
      skinMap = {}
      this.perBlockSkinCanvases.set(normalizedId, skinMap)
    }
    skinMap[pieceType] = canvases
    return canvases
  }

  private applyBlockSkinPieceImage(
    pieceType: PieceType,
    spriteImg: HTMLImageElement,
    spriteUrl: string
  ): void {
    const key = `piece_${pieceType}` as SpriteKey
    const slot = this.slots.get(key)
    if (!slot) return
    const colImg =
      this.collisionImageByType.get(pieceType) || slot.collisionImage || null
    slot.spriteUrl = spriteUrl
    slot.image = spriteImg
    slot.collisionImage = colImg
    slot.loaded = true
    if (colImg) {
      slot.collisionBox = this.analyzeCollisionMask(colImg, spriteImg)
      slot.hasCollisionMask = true
    } else {
      slot.collisionBox = {
        x: 0,
        y: 0,
        width: spriteImg.naturalWidth || spriteImg.width,
        height: spriteImg.naturalHeight || spriteImg.height,
      }
      slot.hasCollisionMask = false
    }

    const activePalette = this.getActiveBlockPalette()
    if (pieceType in DEFAULT_PALETTE_BY_TYPE) {
      slot.multiColorCanvases = activePalette.map((colorTheme, idx) =>
        this.activeBlockSkinId === 'diy'
          ? this.createDiyTintedBlockCanvas(spriteImg, idx)
          : this.activeBlockSkinId === 'gold'
            ? this.createGoldBlockCanvas(spriteImg, idx)
            : this.createTintedBlockCanvas(spriteImg, colorTheme)
      )
      slot.tintedCanvas =
        slot.multiColorCanvases[DEFAULT_PALETTE_BY_TYPE[pieceType]] ||
        (this.activeBlockSkinId === 'diy'
          ? this.createDiyTintedBlockCanvas(spriteImg, 0)
          : this.activeBlockSkinId === 'gold'
            ? this.createGoldBlockCanvas(spriteImg, 0)
            : this.createTintedBlockCanvas(spriteImg, slot.placeholder))
    } else {
      slot.tintedCanvas =
        this.activeBlockSkinId === 'diy'
          ? this.createDiyTintedBlockCanvas(spriteImg, 0)
          : this.activeBlockSkinId === 'gold'
            ? this.createGoldBlockCanvas(spriteImg, 0)
            : this.createTintedBlockCanvas(spriteImg, slot.placeholder)
    }
    slot.staticBrickCanvas = this.createTintedBlockCanvas(
      spriteImg,
      {
        fill: '#475569',
        border: '#0F172A',
        highlight: '#E2E8F0',
        label: 'Bloco de Ferro (Estático)',
      },
      true
    )
    slot.iceBrickCanvas = this.createTintedBlockCanvas(
      spriteImg,
      {
        fill: '#22D3EE',
        border: '#0284C7',
        highlight: '#E0F2FE',
        label: 'Bloco de Gelo (Azul Ciano)',
      },
      true
    )
    if (key === 'piece_I' || key === 'piece_O') {
      const heavyTheme = this.getSlot('piece_HEAVY_RUBBER').placeholder
      slot.heavyRubberCanvas = this.createTintedBlockCanvas(
        spriteImg,
        heavyTheme,
        true
      )
      const heavySlot = this.getSlot('piece_HEAVY_RUBBER')
      heavySlot.loaded = true
    }
    this.notifyListeners()
  }

  public setActiveBlockSkin(skinId: string): void {
    const skin = this.blockSkins.find((s) => s.id === skinId)
    if (!skin) return

    const wasAlreadyActive = this.activeBlockSkinId === skin.id
    this.activeBlockSkinId = skin.id
    try {
      window.localStorage.setItem('toy_tower_block_skin', skin.id)
    } catch {
      // Ignore storage errors
    }

    this.ensureBlockSkinLoaded(skin.id)

    if (wasAlreadyActive) {
      // Already active and loading/loaded via ensureBlockSkinLoaded — avoid redundant canvas rebuilds
      return
    }

    const cachedMap = this.blockSkinImages.get(skin.id)
    const defaultMap = this.blockSkinImages.get('default')
    const allTypes: PieceType[] = ['I', 'O', 'T', 'L', 'J', 'S', 'Z']

    for (const t of allTypes) {
      const img = cachedMap?.[t] || defaultMap?.[t]
      const url =
        skin.pieceUrls[t] ||
        (t === 'L' ? skin.pieceUrls.J : undefined) ||
        this.blockSkins[0]?.pieceUrls[t] ||
        ''
      if (img && img.complete && (img.naturalWidth > 0 || img.width > 0)) {
        this.applyBlockSkinPieceImage(t, img, url)
      }
    }

    this.notifyListeners()
  }

  public cycleNextBlockSkin(delta: number = 1): BlockSkinInfo | null {
    if (this.blockSkins.length === 0) return null
    const currentIndex = Math.max(
      0,
      this.blockSkins.findIndex((s) => s.id === this.activeBlockSkinId)
    )
    const nextIndex =
      (currentIndex + delta + this.blockSkins.length) %
      this.blockSkins.length
    const nextSkin = this.blockSkins[nextIndex]
    this.setActiveBlockSkin(nextSkin.id)
    return nextSkin
  }

  public setDynamicTintEnabled(enabled: boolean): void {
    if (this.dynamicTintEnabled === enabled) return
    this.dynamicTintEnabled = enabled
    this.perBlockSkinCanvases.clear()
    this.rebuildAllTintedCanvases()
    this.notifyListeners()
  }

  public rebuildAllTintedCanvases(): void {
    const activePalette = this.getActiveBlockPalette()
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
          slot.multiColorCanvases = activePalette.map((colorTheme, idx) =>
            this.activeBlockSkinId === 'diy'
              ? this.createDiyTintedBlockCanvas(slot.image!, idx)
              : this.activeBlockSkinId === 'gold'
                ? this.createGoldBlockCanvas(slot.image!, idx)
                : this.createTintedBlockCanvas(slot.image!, colorTheme)
          )
          slot.tintedCanvas =
            slot.multiColorCanvases[DEFAULT_PALETTE_BY_TYPE[pieceType]] ||
            (this.activeBlockSkinId === 'diy'
              ? this.createDiyTintedBlockCanvas(slot.image, 0)
              : this.activeBlockSkinId === 'gold'
                ? this.createGoldBlockCanvas(slot.image, 0)
                : this.createTintedBlockCanvas(slot.image, slot.placeholder))
        } else {
          slot.tintedCanvas =
            this.activeBlockSkinId === 'diy'
              ? this.createDiyTintedBlockCanvas(slot.image, 0)
              : this.activeBlockSkinId === 'gold'
                ? this.createGoldBlockCanvas(slot.image, 0)
                : this.createTintedBlockCanvas(slot.image, slot.placeholder)
        }
        slot.staticBrickCanvas = this.createTintedBlockCanvas(
          slot.image,
          staticTheme,
          true
        )
        slot.iceBrickCanvas = this.createTintedBlockCanvas(
          slot.image,
          iceTheme,
          true
        )
        if (slot.key === 'piece_I' || slot.key === 'piece_O') {
          slot.heavyRubberCanvas = this.createTintedBlockCanvas(
            slot.image,
            heavyTheme,
            true
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
   * Builds a 256-entry RGB lookup table for 3-tone shading (`border -> fill -> highlight`).
   */
  private buildThreeToneLut(
    theme: PlaceholderColorTheme,
    minShadowLum: number,
    baseBodyLum: number,
    maxGlossLum: number
  ): { r: Uint8Array; g: Uint8Array; b: Uint8Array } {
    const borderRgb = hexToRgb(theme.border)
    const fillRgb = hexToRgb(theme.fill)
    const highlightRgb = hexToRgb(theme.highlight)

    const lutR = new Uint8Array(256)
    const lutG = new Uint8Array(256)
    const lutB = new Uint8Array(256)

    for (let lum = 0; lum < 256; lum++) {
      if (lum < minShadowLum) {
        const d = Math.max(0, Math.min(1, lum / minShadowLum))
        const factor = 0.24 + 0.76 * (d * d * (3 - 2 * d))
        lutR[lum] = Math.round(borderRgb.r * factor)
        lutG[lum] = Math.round(borderRgb.g * factor)
        lutB[lum] = Math.round(borderRgb.b * factor)
      } else if (lum <= baseBodyLum) {
        const t = Math.max(
          0,
          Math.min(1, (lum - minShadowLum) / (baseBodyLum - minShadowLum))
        )
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

    return { r: lutR, g: lutG, b: lutB }
  }

  /**
   * Dynamic Multi-Region Colorizer for the `diy` Cardboard Block Skin (`assets/sprites/block/skins/diy`):
   * - Keeps the entire cardboard box body (`cor de papelão`) always in a fixed, realistic cardboard color.
   * - Colors all torn adhesive tape strips (`fitinha com um marrom mais escuro`) in a darker brown shade.
   * - Dynamically colors ONLY the small protruding bottle caps and circular caps/buttons on the box (`colorido apenas as tampinhas pequenas que ficam na caixa e os círculos dentro da arte`).
   */
  private createDiyTintedBlockCanvas(
    img: HTMLImageElement,
    paletteIndex: number
  ): HTMLCanvasElement {
    const w = img.naturalWidth || img.width
    const h = img.naturalHeight || img.height
    const canvas = document.createElement('canvas')
    canvas.width = w
    canvas.height = h
    const ctx = canvas.getContext('2d')
    if (!ctx || !w || !h) return canvas

    ctx.drawImage(img, 0, 0, w, h)
    if (!this.dynamicTintEnabled) {
      return canvas
    }

    const imageData = ctx.getImageData(0, 0, w, h)
    const data = imageData.data
    const n = w * h

    const lumArr = new Uint8Array(n)
    const alphaArr = new Uint8Array(n)
    for (let i = 0; i < n; i++) {
      const p = i * 4
      lumArr[i] = ((data[p] + data[p + 1] + data[p + 2]) / 3) | 0
      alphaArr[i] = data[p + 3]
    }

    // 1. Segment large flat Cardboard faces (`isCardboard`) and Tape Strips (`tapeCompId`)
    const vis = new Uint8Array(n)
    const isCardboard = new Uint8Array(n)
    const tapeCompId = new Uint8Array(n)
    let numTapes = 0
    const queue = new Int32Array(n)

    for (let i = 0; i < n; i++) {
      if (vis[i] || alphaArr[i] < 80 || lumArr[i] < 142) continue
      let head = 0
      let tail = 0
      queue[tail++] = i
      vis[i] = 1

      let minX = w
      let maxX = 0
      let minY = h
      let maxY = 0
      let sumLum = 0

      while (head < tail) {
        const curr = queue[head++]
        const cx = curr % w
        const cy = (curr / w) | 0
        if (cx < minX) minX = cx
        if (cx > maxX) maxX = cx
        if (cy < minY) minY = cy
        if (cy > maxY) maxY = cy
        sumLum += lumArr[curr]

        if (cx > 0) {
          const next = curr - 1
          if (!vis[next] && alphaArr[next] >= 80 && lumArr[next] >= 142) {
            vis[next] = 1
            queue[tail++] = next
          }
        }
        if (cx + 1 < w) {
          const next = curr + 1
          if (!vis[next] && alphaArr[next] >= 80 && lumArr[next] >= 142) {
            vis[next] = 1
            queue[tail++] = next
          }
        }
        if (cy > 0) {
          const next = curr - w
          if (!vis[next] && alphaArr[next] >= 80 && lumArr[next] >= 142) {
            vis[next] = 1
            queue[tail++] = next
          }
        }
        if (cy + 1 < h) {
          const next = curr + w
          if (!vis[next] && alphaArr[next] >= 80 && lumArr[next] >= 142) {
            vis[next] = 1
            queue[tail++] = next
          }
        }
      }

      const bw = maxX - minX + 1
      const bh = maxY - minY + 1
      const avgLum = sumLum / tail

      if (tail >= 575) {
        for (let k = 0; k < tail; k++) {
          isCardboard[queue[k]] = 1
        }
      } else if (
        tail >= 65 &&
        tail <= 555 &&
        bw >= 7 &&
        bh >= 7 &&
        avgLum >= 165.5
      ) {
        numTapes++
        const id = numTapes
        for (let k = 0; k < tail; k++) {
          tapeCompId[queue[k]] = id
        }
      }
    }

    // Reclaim the bottom vertical tape strip on S and Z (192x137), where a 1px gap in the outline connects it to the cardboard panel
    if (w === 192 && h === 137) {
      const isS = alphaArr[20 * w + 10] < 50
      const tx0 = isS ? 15 : 152
      const tx1 = isS ? 39 : 176
      numTapes++
      const tid = numTapes
      for (let py = 112; py <= 135; py++) {
        for (let px = tx0; px <= tx1; px++) {
          const idx = py * w + px
          if (alphaArr[idx] >= 80 && lumArr[idx] >= 118) {
            tapeCompId[idx] = tid
            isCardboard[idx] = 0
          }
        }
      }
    }

    // Dilate tape strips by 2 steps into anti-aliased edge pixels (`lum >= 115`)
    for (let step = 0; step < 2; step++) {
      const nextTape = new Uint8Array(tapeCompId)
      for (let i = 0; i < n; i++) {
        const tid = tapeCompId[i]
        if (!tid) continue
        const cx = i % w
        const cy = (i / w) | 0
        if (cx > 0) {
          const nb = i - 1
          if (!nextTape[nb] && !isCardboard[nb] && alphaArr[nb] >= 80 && lumArr[nb] >= 115) {
            nextTape[nb] = tid
          }
        }
        if (cx + 1 < w) {
          const nb = i + 1
          if (!nextTape[nb] && !isCardboard[nb] && alphaArr[nb] >= 80 && lumArr[nb] >= 115) {
            nextTape[nb] = tid
          }
        }
        if (cy > 0) {
          const nb = i - w
          if (!nextTape[nb] && !isCardboard[nb] && alphaArr[nb] >= 80 && lumArr[nb] >= 115) {
            nextTape[nb] = tid
          }
        }
        if (cy + 1 < h) {
          const nb = i + w
          if (!nextTape[nb] && !isCardboard[nb] && alphaArr[nb] >= 80 && lumArr[nb] >= 115) {
            nextTape[nb] = tid
          }
        }
      }
      tapeCompId.set(nextTape)
    }

    // Dilate cardboard body by 1 step into immediate edge pixels (`lum >= 126`) without crossing black cap outlines
    {
      const nextCb = new Uint8Array(isCardboard)
      for (let i = 0; i < n; i++) {
        if (!isCardboard[i]) continue
        const cx = i % w
        const cy = (i / w) | 0
        if (cx > 0) {
          const nb = i - 1
          if (!nextCb[nb] && !tapeCompId[nb] && alphaArr[nb] >= 80 && lumArr[nb] >= 126) {
            nextCb[nb] = 1
          }
        }
        if (cx + 1 < w) {
          const nb = i + 1
          if (!nextCb[nb] && !tapeCompId[nb] && alphaArr[nb] >= 80 && lumArr[nb] >= 126) {
            nextCb[nb] = 1
          }
        }
        if (cy > 0) {
          const nb = i - w
          if (!nextCb[nb] && !tapeCompId[nb] && alphaArr[nb] >= 80 && lumArr[nb] >= 126) {
            nextCb[nb] = 1
          }
        }
        if (cy + 1 < h) {
          const nb = i + w
          if (!nextCb[nb] && !tapeCompId[nb] && alphaArr[nb] >= 80 && lumArr[nb] >= 126) {
            nextCb[nb] = 1
          }
        }
      }
      isCardboard.set(nextCb)
    }

    // 2. Segment ONLY small protruding Bottle Caps (`tampinhas pequenas que ficam na caixa`)
    //    and Circular Caps/Buttons inside the box art (`círculos dentro da arte`)
    vis.fill(0)
    const capCompId = new Uint8Array(n)
    let numCaps = 0

    for (let i = 0; i < n; i++) {
      if (
        vis[i] ||
        isCardboard[i] ||
        tapeCompId[i] !== 0 ||
        alphaArr[i] < 80 ||
        lumArr[i] < 85
      ) {
        continue
      }
      let head = 0
      let tail = 0
      queue[tail++] = i
      vis[i] = 1

      let minX = w
      let maxX = 0
      let minY = h
      let maxY = 0
      let sumLum = 0

      while (head < tail) {
        const curr = queue[head++]
        const cx = curr % w
        const cy = (curr / w) | 0
        if (cx < minX) minX = cx
        if (cx > maxX) maxX = cx
        if (cy < minY) minY = cy
        if (cy > maxY) maxY = cy
        sumLum += lumArr[curr]

        if (cx > 0) {
          const next = curr - 1
          if (
            !vis[next] &&
            !isCardboard[next] &&
            tapeCompId[next] === 0 &&
            alphaArr[next] >= 80 &&
            lumArr[next] >= 85
          ) {
            vis[next] = 1
            queue[tail++] = next
          }
        }
        if (cx + 1 < w) {
          const next = curr + 1
          if (
            !vis[next] &&
            !isCardboard[next] &&
            tapeCompId[next] === 0 &&
            alphaArr[next] >= 80 &&
            lumArr[next] >= 85
          ) {
            vis[next] = 1
            queue[tail++] = next
          }
        }
        if (cy > 0) {
          const next = curr - w
          if (
            !vis[next] &&
            !isCardboard[next] &&
            tapeCompId[next] === 0 &&
            alphaArr[next] >= 80 &&
            lumArr[next] >= 85
          ) {
            vis[next] = 1
            queue[tail++] = next
          }
        }
        if (cy + 1 < h) {
          const next = curr + w
          if (
            !vis[next] &&
            !isCardboard[next] &&
            tapeCompId[next] === 0 &&
            alphaArr[next] >= 80 &&
            lumArr[next] >= 85
          ) {
            vis[next] = 1
            queue[tail++] = next
          }
        }
      }

      const bw = maxX - minX + 1
      const bh = maxY - minY + 1
      const aspect = Math.max(bw / bh, bh / bw)
      const avgLum = sumLum / tail

      // (A) Circular caps & buttons on the front of the cardboard box
      const isFrontCircleCap =
        tail >= 120 &&
        tail <= 410 &&
        bw >= 12 &&
        bw <= 29 &&
        bh >= 12 &&
        bh <= 29 &&
        aspect <= 1.45 &&
        avgLum <= 130.5

      // (B) Small bottle caps/pegs protruding from the top edge (`minY <= 5`)
      const isTopCap =
        !(w === 200 && h === 128) &&
        minY <= 5 &&
        maxY <= 15 &&
        tail >= 24 &&
        tail <= 280 &&
        bw >= 3 &&
        bw <= 38 &&
        bh >= 3 &&
        bh <= 13 &&
        (bw >= 11 || bh >= 8) &&
        avgLum <= 148.5

      // (C) Protruding side/bottom bottle caps (J/L side serrated cap & inner caps, S/Z bottom serrated cap & side caps, T stem side caps)
      const isSideBottleCap =
        ((maxX >= w - 2 || minX <= 1) &&
          minY >= 8 &&
          maxY <= 55 &&
          bw >= 12 &&
          bw <= 18 &&
          bh >= 30 &&
          bh <= 42) ||
        (minY >= 62 &&
          maxY <= 75 &&
          bw >= 28 &&
          bw <= 36 &&
          bh >= 9 &&
          bh <= 14 &&
          avgLum <= 115) ||
        (minY >= 70 &&
          maxY <= 132 &&
          bw >= 5 &&
          bw <= 10 &&
          bh >= 14 &&
          bh <= 20 &&
          tail >= 65 &&
          tail <= 125)

      if (isFrontCircleCap || isTopCap || isSideBottleCap) {
        if (isFrontCircleCap) {
          let effMinX = minX
          let effMaxX = maxX
          let effMinY = minY
          let effMaxY = maxY
          if (w === 192 && h === 136) {
            if (bw >= 23) {
              effMaxX = maxX - 1
              effMinX = effMaxX - 20
            }
            if (bh >= 22) {
              effMinY = bh >= 24 ? minY + 1 : minY
              effMaxY = effMinY + 19
            }
          }
          const effBw = effMaxX - effMinX + 1
          const effBh = effMaxY - effMinY + 1
          const centerX = (effMinX + effMaxX) * 0.5
          const centerY = (effMinY + effMaxY) * 0.5
          const existingCid =
            capCompId[Math.round(centerY) * w + Math.round(centerX)]
          const cid = existingCid > 0 ? existingCid : ++numCaps

          const maxR = Math.min(effBw, effBh) * 0.51
          const maxRSq = maxR * maxR
          const innerRSq = Math.pow(Math.min(effBw, effBh) * 0.47, 2)
          for (let k = 0; k < tail; k++) {
            const idx = queue[k]
            const px = idx % w
            const py = (idx / w) | 0
            const dx = px - centerX
            const dy = py - centerY
            if (dx * dx + dy * dy <= maxRSq) {
              capCompId[idx] = cid
            }
          }
          for (let py = effMinY; py <= effMaxY; py++) {
            for (let px = effMinX; px <= effMaxX; px++) {
              const dx = px - centerX
              const dy = py - centerY
              if (dx * dx + dy * dy <= innerRSq) {
                const pIdx = py * w + px
                if (
                  !tapeCompId[pIdx] &&
                  alphaArr[pIdx] >= 80 &&
                  lumArr[pIdx] >= 65
                ) {
                  isCardboard[pIdx] = 0
                  capCompId[pIdx] = cid
                }
              }
            }
          }
        } else {
          numCaps++
          const cid = numCaps
          for (let k = 0; k < tail; k++) {
            capCompId[queue[k]] = cid
          }
          if (bh <= 15 && bw >= 24) {
            for (let py = minY; py <= maxY; py++) {
              for (
                let px = Math.max(0, minX - 4);
                px <= Math.min(w - 1, maxX + 4);
                px++
              ) {
                const pIdx = py * w + px
                if (
                  !isCardboard[pIdx] &&
                  !tapeCompId[pIdx] &&
                  alphaArr[pIdx] >= 80 &&
                  lumArr[pIdx] >= 65
                ) {
                  capCompId[pIdx] = cid
                }
              }
            }
          }
        }
      }
    }

    // Group the 2 top serrated bottle caps on J and L (200x128) cleanly as 2 caps above the box top line (`y = 0..2`)
    if (w === 200 && h === 128) {
      const isJ = alphaArr[100 * w + 180] < 50
      const ranges: Array<[number, number]> = isJ
        ? [
            [14, 45],
            [78, 109],
          ]
        : [
            [154, 185],
            [90, 121],
          ]
      for (const [x0, x1] of ranges) {
        numCaps++
        const cid = numCaps
        for (let py = 0; py <= 2; py++) {
          for (let px = x0; px <= x1; px++) {
            const pIdx = py * w + px
            if (alphaArr[pIdx] >= 80 && lumArr[pIdx] >= 65) {
              capCompId[pIdx] = cid
            }
          }
        }
      }
    }

    // Dilate caps by 1px into anti-aliased inner rim (`lum >= 88`) without crossing dark ink outlines
    {
      const nextCap = new Uint8Array(capCompId)
      for (let i = 0; i < n; i++) {
        const cid = capCompId[i]
        if (!cid) continue
        const cx = i % w
        const cy = (i / w) | 0
        if (w === 200 && h === 128 && cy <= 2) continue
        if (cx > 0) {
          const nb = i - 1
          if (
            !nextCap[nb] &&
            !isCardboard[nb] &&
            !tapeCompId[nb] &&
            alphaArr[nb] >= 80 &&
            lumArr[nb] >= 88
          ) {
            nextCap[nb] = cid
          }
        }
        if (cx + 1 < w) {
          const nb = i + 1
          if (
            !nextCap[nb] &&
            !isCardboard[nb] &&
            !tapeCompId[nb] &&
            alphaArr[nb] >= 80 &&
            lumArr[nb] >= 88
          ) {
            nextCap[nb] = cid
          }
        }
        if (cy > 0) {
          const nb = i - w
          if (
            !nextCap[nb] &&
            !isCardboard[nb] &&
            !tapeCompId[nb] &&
            alphaArr[nb] >= 80 &&
            lumArr[nb] >= 88
          ) {
            nextCap[nb] = cid
          }
        }
        if (cy + 1 < h) {
          const nb = i + w
          if (
            !nextCap[nb] &&
            !isCardboard[nb] &&
            !tapeCompId[nb] &&
            alphaArr[nb] >= 80 &&
            lumArr[nb] >= 88
          ) {
            nextCap[nb] = cid
          }
        }
      }
      capCompId.set(nextCap)
    }

    // 3. Build LUTs:
    //    - Fixed Kraft Cardboard LUT for the entire cardboard box body (`cor de papelão`)
    //    - Darker Brown LUT for all adhesive tape strips (`fitinha com um marrom mais escuro`)
    //    - Vibrant LUTs ONLY for the small bottle caps & circular details (`capLuts`)
    const fixedCardboardTheme: PlaceholderColorTheme = {
      border: '#66401E',
      fill: '#C8965E',
      highlight: '#EAC596',
      label: 'Papelão Kraft Fixo',
    }
    const cardboardLut = this.buildThreeToneLut(
      fixedCardboardTheme,
      96,
      156,
      190
    )

    const darkBrownTapeTheme: PlaceholderColorTheme = {
      border: '#2D180A',
      fill: '#6E4223',
      highlight: '#A47149',
      label: 'Fita Marrom Mais Escuro',
    }
    const darkBrownTapeLut = this.buildThreeToneLut(
      darkBrownTapeTheme,
      96,
      166,
      192
    )

    const capLuts: Array<{ r: Uint8Array; g: Uint8Array; b: Uint8Array }> = []
    for (let c = 0; c < numCaps; c++) {
      const accentTheme =
        DIY_COLOR_PALETTE[
          ((paletteIndex + c * 2) % DIY_COLOR_PALETTE.length +
            DIY_COLOR_PALETTE.length) %
            DIY_COLOR_PALETTE.length
        ]
      capLuts.push(this.buildThreeToneLut(accentTheme, 75, 118, 160))
    }

    // 4. Apply per-region LUT to every pixel (defaulting entire box body & corrugated tears to cardboardLut)
    for (let i = 0; i < n; i++) {
      const a = alphaArr[i]
      if (a === 0) continue
      const lum = lumArr[i]
      const p = i * 4

      let lut = cardboardLut
      const cid = capCompId[i]
      const tid = tapeCompId[i]
      if (cid > 0) {
        lut = capLuts[cid - 1]
      } else if (tid > 0) {
        lut = darkBrownTapeLut
      }

      data[p] = lut.r[lum]
      data[p + 1] = lut.g[lum]
      data[p + 2] = lut.b[lum]
    }

    ctx.putImageData(imageData, 0, 0)
    return canvas
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
   * Renders a lustrous 24k Gold Bullion block canvas for the `gold` block skin (`assets/sprites/block/skins/gold/*.png`).
   * Preserves the rich original golden artwork while adding a subtle warm metallic golden charm ("leve charme de ouro"):
   * - Soft diagonal golden-champagne sheen across the block face.
   * - Subtle specular highlight boost on bright golden bevels without altering dark cartoon ink outlines.
   */
  private createGoldBlockCanvas(
    img: HTMLImageElement,
    paletteIndex: number = 0
  ): HTMLCanvasElement {
    const w = img.naturalWidth || img.width
    const h = img.naturalHeight || img.height
    const canvas = document.createElement('canvas')
    canvas.width = w
    canvas.height = h
    const ctx = canvas.getContext('2d')
    if (!ctx || !w || !h) return canvas

    // 1. Base gold bullion sprite artwork
    ctx.drawImage(img, 0, 0, w, h)

    // 2. Subtle per-pixel specular charm on golden body & bevels (preserving dark outlines `lum < 65`)
    const imageData = ctx.getImageData(0, 0, w, h)
    const data = imageData.data
    const warmthShift = ((paletteIndex % 5) - 2) * 2.5

    for (let y = 0; y < h; y++) {
      const ny = y / h
      for (let x = 0; x < w; x++) {
        const idx = (y * w + x) * 4
        const a = data[idx + 3]
        if (a < 32) continue

        const r = data[idx]
        const g = data[idx + 1]
        const b = data[idx + 2]
        const lum = (r + g + b) / 3

        // Keep dark cartoon ink outlines untouched
        if (lum < 65) continue

        // Diagonal metallic luster wave (top-left bright champagne -> bottom-right warm amber gold)
        const nx = x / w
        const diag = (1 - (nx * 0.58 + ny * 0.42)) // 1 at top-left, 0 at bottom-right
        const sheen = Math.max(0, diag - 0.35) * 22
        const specBoost = lum > 185 ? (lum - 185) * 0.28 : 0

        data[idx] = Math.min(255, Math.max(0, Math.round(r + sheen * 1.05 + specBoost + warmthShift)))
        data[idx + 1] = Math.min(255, Math.max(0, Math.round(g + sheen * 0.88 + specBoost * 0.92 + warmthShift * 0.4)))
        data[idx + 2] = Math.min(255, Math.max(0, Math.round(b + sheen * 0.32 + specBoost * 0.65)))
      }
    }
    ctx.putImageData(imageData, 0, 0)

    return canvas
  }

  /**
   * High-contrast Luminance Colorizer (`deep contour -> border -> fill -> highlight`)
   * anchored at the exported grey block's base luminance (`160`).
   * Preserves dark ink outlines (`lum < 50`), wood grain / inner bevel shadows (`lum ~ 50..120`),
   * vibrant pure fill or warm wood body (`lum = 160`), and glossy plastic / wood grain highlights (`lum ~ 196`).
   */
  private createTintedBlockCanvas(
    img: HTMLImageElement,
    theme: PlaceholderColorTheme,
    forceRecolor: boolean = false
  ): HTMLCanvasElement {
    const w = img.naturalWidth || img.width
    const h = img.naturalHeight || img.height
    const canvas = document.createElement('canvas')
    canvas.width = w
    canvas.height = h
    const ctx = canvas.getContext('2d')
    if (!ctx) return canvas

    ctx.drawImage(img, 0, 0, w, h)
    if (!this.dynamicTintEnabled && !forceRecolor) {
      return canvas
    }

    const imageData = ctx.getImageData(0, 0, w, h)
    const data = imageData.data

    if (!forceRecolor) {
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
    }

    const lut = this.buildThreeToneLut(theme, 96, 160, 196)

    for (let i = 0; i < data.length; i += 4) {
      const a = data[i + 3]
      if (a === 0) continue
      const lum = (data[i] + data[i + 1] + data[i + 2]) / 3 | 0
      data[i] = lut.r[lum]
      data[i + 1] = lut.g[lum]
      data[i + 2] = lut.b[lum]
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
      const pieceType = key.replace('piece_', '') as PieceType
      // If this is piece_L and the active skin only provides J (e.g. wood, diy, gold), mirror J horizontally
      const activeSkin = this.getActiveBlockSkin()
      if (
        pieceType === 'L' &&
        activeSkin &&
        !activeSkin.pieceUrls.L &&
        activeSkin.pieceUrls.J
      ) {
        const w = spriteImg.naturalWidth || spriteImg.width
        const h = spriteImg.naturalHeight || spriteImg.height
        const c = document.createElement('canvas')
        c.width = w
        c.height = h
        const cctx = c.getContext('2d')
        if (cctx) {
          cctx.translate(w, 0)
          cctx.scale(-1, 1)
          cctx.drawImage(spriteImg, 0, 0, w, h)
          const mirrored = new Image()
          mirrored.onload = () => {
            this.applyBlockSkinPieceImage('L', mirrored, spriteUrl)
          }
          mirrored.src = c.toDataURL('image/png')
          if (colImg) {
            this.collisionImageByType.set('L', colImg)
          }
          return
        }
      }

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

      const activePalette = this.getActiveBlockPalette()
      if (pieceType in DEFAULT_PALETTE_BY_TYPE) {
        slot.multiColorCanvases = activePalette.map((colorTheme, idx) =>
          this.activeBlockSkinId === 'diy'
            ? this.createDiyTintedBlockCanvas(spriteImg, idx)
            : this.activeBlockSkinId === 'gold'
              ? this.createGoldBlockCanvas(spriteImg, idx)
              : this.createTintedBlockCanvas(spriteImg, colorTheme)
        )
        slot.tintedCanvas =
          slot.multiColorCanvases[DEFAULT_PALETTE_BY_TYPE[pieceType]] ||
          (this.activeBlockSkinId === 'diy'
            ? this.createDiyTintedBlockCanvas(spriteImg, 0)
            : this.activeBlockSkinId === 'gold'
              ? this.createGoldBlockCanvas(spriteImg, 0)
              : this.createTintedBlockCanvas(spriteImg, slot.placeholder))
      } else {
        slot.tintedCanvas =
          this.activeBlockSkinId === 'diy'
            ? this.createDiyTintedBlockCanvas(spriteImg, 0)
            : this.activeBlockSkinId === 'gold'
              ? this.createGoldBlockCanvas(spriteImg, 0)
              : this.createTintedBlockCanvas(spriteImg, slot.placeholder)
      }
      slot.staticBrickCanvas = this.createTintedBlockCanvas(
        spriteImg,
        {
          fill: '#475569',
          border: '#0F172A',
          highlight: '#E2E8F0',
          label: 'Bloco de Ferro (Estático)',
        },
        true
      )
      slot.iceBrickCanvas = this.createTintedBlockCanvas(
        spriteImg,
        {
          fill: '#22D3EE',
          border: '#0284C7',
          highlight: '#E0F2FE',
          label: 'Bloco de Gelo (Azul Ciano)',
        },
        true
      )
      if (key === 'piece_I' || key === 'piece_O') {
        const heavyTheme = this.getSlot('piece_HEAVY_RUBBER').placeholder
        slot.heavyRubberCanvas = this.createTintedBlockCanvas(
          spriteImg,
          heavyTheme,
          true
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
  private lerpHexColor(hexA: string, hexB: string, t: number): string {
    const clamped = Math.max(0, Math.min(1, t))
    const a = hexToRgb(hexA)
    const b = hexToRgb(hexB)
    const r = Math.round(a.r + (b.r - a.r) * clamped)
    const g = Math.round(a.g + (b.g - a.g) * clamped)
    const bl = Math.round(a.b + (b.b - a.b) * clamped)
    return `rgb(${r}, ${g}, ${bl})`
  }

  public drawTrickyTowersSceneryBackground(
    ctx: CanvasRenderingContext2D,
    canvasWidth: number,
    canvasHeight: number,
    cameraOriginX: number,
    cameraOriginY: number,
    elapsedTimeMs: number,
    windForce: number,
    parallaxFocusX: number = 0,
    endlessScore?: number,
    isSurvivalMode: boolean = false
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

    if (isSurvivalMode) {
      this.drawSurvivorSceneryBackground(
        ctx,
        canvasWidth,
        canvasHeight,
        cameraOriginY,
        cameraElevationPx,
        cameraShiftX,
        elapsedTimeMs
      )
      return
    }

    const bgMainSlot = this.getSlot('bg_main')
    const bgLeftSlot = this.getSlot('bg_left')
    const bgRightSlot = this.getSlot('bg_right')
    const hasMainBg =
      !this.forcePlaceholders && bgMainSlot.loaded && !!bgMainSlot.image
    const hasSideIslandBgs =
      !this.forcePlaceholders &&
      ((bgLeftSlot.loaded && !!bgLeftSlot.image) ||
        (bgRightSlot.loaded && !!bgRightSlot.image))

    // Resolve atmosphere colors from endlessScore:
    // 0-50: Morning Blue -> 50-150: Sunset Orange/Pink -> 150-300: Starry Night -> 300+: Outer Space
    let topSky = '#1B66C9'
    let midSky = '#3E8CE4'
    let lowSky = '#76B5F5'
    let botSky = '#AED6FC'
    let starAlpha = 0
    let spaceNebulaAlpha = 0
    let atmosphereOverlayColor: string | null = null

    if (typeof endlessScore === 'number') {
      const s = Math.max(0, endlessScore)
      const morning = ['#1B66C9', '#3E8CE4', '#76B5F5', '#AED6FC']
      const sunset = ['#D9483B', '#EE744D', '#F8A164', '#FCD392']
      const night = ['#0B1026', '#172554', '#1E3A8A', '#312E81']
      const space = ['#03030A', '#090518', '#1E0B36', '#3B0764']

      if (s < 35) {
        ;[topSky, midSky, lowSky, botSky] = morning
      } else if (s < 65) {
        const t = (s - 35) / 30
        topSky = this.lerpHexColor(morning[0], sunset[0], t)
        midSky = this.lerpHexColor(morning[1], sunset[1], t)
        lowSky = this.lerpHexColor(morning[2], sunset[2], t)
        botSky = this.lerpHexColor(morning[3], sunset[3], t)
        atmosphereOverlayColor = `rgba(244, 114, 72, ${(0.32 * t).toFixed(3)})`
      } else if (s < 135) {
        ;[topSky, midSky, lowSky, botSky] = sunset
        atmosphereOverlayColor = 'rgba(244, 114, 72, 0.34)'
      } else if (s < 165) {
        const t = (s - 135) / 30
        topSky = this.lerpHexColor(sunset[0], night[0], t)
        midSky = this.lerpHexColor(sunset[1], night[1], t)
        lowSky = this.lerpHexColor(sunset[2], night[2], t)
        botSky = this.lerpHexColor(sunset[3], night[3], t)
        starAlpha = t * 0.85
        atmosphereOverlayColor = `rgba(15, 23, 42, ${(0.34 + 0.28 * t).toFixed(3)})`
      } else if (s < 280) {
        ;[topSky, midSky, lowSky, botSky] = night
        starAlpha = 0.85
        atmosphereOverlayColor = 'rgba(15, 23, 42, 0.62)'
      } else if (s < 320) {
        const t = (s - 280) / 40
        topSky = this.lerpHexColor(night[0], space[0], t)
        midSky = this.lerpHexColor(night[1], space[1], t)
        lowSky = this.lerpHexColor(night[2], space[2], t)
        botSky = this.lerpHexColor(night[3], space[3], t)
        starAlpha = 0.85 + 0.15 * t
        spaceNebulaAlpha = t
        atmosphereOverlayColor = `rgba(9, 5, 24, ${(0.62 + 0.2 * t).toFixed(3)})`
      } else {
        ;[topSky, midSky, lowSky, botSky] = space
        starAlpha = 1
        spaceNebulaAlpha = 1
        atmosphereOverlayColor = 'rgba(9, 5, 24, 0.82)'
      }
    }

    // 1. Base Sky Gradient (seamless upper-atmosphere extension & fallback)
    const skyGrad = ctx.createLinearGradient(0, 0, 0, canvasHeight)
    skyGrad.addColorStop(0, topSky)
    skyGrad.addColorStop(0.5, midSky)
    skyGrad.addColorStop(0.85, lowSky)
    skyGrad.addColorStop(1, botSky)
    ctx.fillStyle = skyGrad
    ctx.fillRect(0, 0, canvasWidth, canvasHeight)

    // Starry Night & Outer Space procedural stars + nebula
    if (starAlpha > 0.01) {
      ctx.save()
      if (spaceNebulaAlpha > 0.01) {
        const nebGrad = ctx.createRadialGradient(
          canvasWidth * 0.62,
          canvasHeight * 0.28,
          20,
          canvasWidth * 0.62,
          canvasHeight * 0.28,
          Math.max(canvasWidth, canvasHeight) * 0.55
        )
        nebGrad.addColorStop(
          0,
          `rgba(168, 85, 247, ${(0.28 * spaceNebulaAlpha).toFixed(3)})`
        )
        nebGrad.addColorStop(
          0.5,
          `rgba(236, 72, 153, ${(0.14 * spaceNebulaAlpha).toFixed(3)})`
        )
        nebGrad.addColorStop(1, 'rgba(0, 0, 0, 0)')
        ctx.fillStyle = nebGrad
        ctx.fillRect(0, 0, canvasWidth, canvasHeight)
      }
      for (let i = 0; i < 64; i++) {
        const seedX = ((i * 137.5) % 100) / 100
        const seedY = ((i * 293.7) % 100) / 100
        const sx = seedX * canvasWidth
        const sy =
          ((seedY * canvasHeight + cameraElevationPx * 0.08) %
            (canvasHeight * 0.85))
        const twinkle =
          0.45 + 0.55 * Math.sin(elapsedTimeMs * 0.003 + i * 1.9)
        ctx.fillStyle = `rgba(255, 255, 255, ${(starAlpha * twinkle).toFixed(3)})`
        const r = i % 5 === 0 ? 2.1 : 1.3
        ctx.beginPath()
        ctx.arc(sx, sy, r, 0, Math.PI * 2)
        ctx.fill()
      }
      ctx.restore()
    }

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

      if (atmosphereOverlayColor) {
        ctx.fillStyle = atmosphereOverlayColor
        ctx.fillRect(drawX, drawY, drawW, drawH)
      }

      // If climbing high pushes top of bg_1 into view, feather its top edge into the upper sky gradient
      if (drawY > -20) {
        const featherH = 90
        const topFeather = ctx.createLinearGradient(
          0,
          Math.max(0, drawY - 10),
          0,
          drawY + featherH
        )
        topFeather.addColorStop(0, topSky)
        topFeather.addColorStop(1, 'rgba(0, 0, 0, 0)')
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
   * Renders the foreground Ocean water (or Survivor Stalagmites + Smoke) at the bottom of the world (the Abyss zone).
   */
  public drawTrickyTowersOceanForeground(
    ctx: CanvasRenderingContext2D,
    canvasWidth: number,
    canvasHeight: number,
    cameraOriginY: number,
    elapsedTimeMs: number,
    isSurvivalMode: boolean = false,
    _cameraShiftX: number = 0
  ): void {
    // In Survival Mode, all ground layers (stalagmites + smoke) are rendered in the background scenery pass
    // so that the Base Island (`base.png`) and Tower always remain in front of everything!
    if (isSurvivalMode) {
      return
    }

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

  /**
   * Computes a realistic double-strike lightning flash intensity in `[0, 1]` for periodic lightning effects.
   */
  private computeLightningFlashEnvelope(phase01: number, activeDuty: number): number {
    if (phase01 < 0 || phase01 >= activeDuty) return 0
    const t = phase01 / activeDuty // 0..1 within active strike window
    if (t < 0.14) {
      return t / 0.14
    }
    if (t < 0.32) {
      return 1.0 - ((t - 0.14) / 0.18) * 0.62
    }
    if (t < 0.48) {
      return 0.38 + ((t - 0.32) / 0.16) * 0.62
    }
    const decay = 1 - (t - 0.48) / 0.52
    return Math.max(0, decay * decay)
  }

  /**
   * Renders the Survival Mode (`SURVIVAL`) Parallax Storm Scenery (all behind the Base Island and Tower):
   * - Layer 1: `background.jpg` with slow far parallax (`0.20x` vertical, `0.12x` horizontal).
   * - Layer 2: Distant temporary sheet-lightning flashes ("brilhos temporários lá no fundo para simular raios de fundo").
   * - Layer 3: Rising glowing volcanic sparks & embers ("fagulhas") across the stormy sky.
   * - Layer 4: Two horizontally-tiled layers of `estalagmite.png` (with varied heights & horizontal flips) + `smoke.png` between them.
   * - Layer 5 (Top of screen): Compact `nuvem.png` + periodic lightning bolts (`raio 1..4.png`) following the top of the screen.
   */
  private drawSurvivorSceneryBackground(
    ctx: CanvasRenderingContext2D,
    canvasWidth: number,
    canvasHeight: number,
    cameraOriginY: number,
    cameraElevationPx: number,
    cameraShiftX: number,
    elapsedTimeMs: number
  ): void {
    // 1. Deep Stormy Purple Sky Gradient (seamless upper extension)
    const skyGrad = ctx.createLinearGradient(0, 0, 0, canvasHeight)
    skyGrad.addColorStop(0, '#140624')
    skyGrad.addColorStop(0.45, '#251042')
    skyGrad.addColorStop(0.78, '#372159')
    skyGrad.addColorStop(1, '#1A1328')
    ctx.fillStyle = skyGrad
    ctx.fillRect(0, 0, canvasWidth, canvasHeight)

    // 2. Main Survivor Background (`background.jpg` — 2752x1536) with Far Parallax
    const bgImg = this.survivorSprites.background
    if (bgImg) {
      const imgW = bgImg.naturalWidth || 2752
      const imgH = bgImg.naturalHeight || 1536
      const scale = Math.max(
        (canvasWidth * 1.06) / imgW,
        (canvasHeight * 1.06) / imgH
      )
      const drawW = imgW * scale
      const drawH = imgH * scale

      const parallaxY = cameraElevationPx * 0.2
      const parallaxX =
        cameraShiftX * 0.12 + Math.sin(elapsedTimeMs * 0.00035) * 5

      const drawX = (canvasWidth - drawW) / 2 + parallaxX
      const drawY = canvasHeight - drawH + parallaxY

      ctx.save()
      ctx.drawImage(bgImg, drawX, drawY, drawW, drawH)

      if (drawY > -20) {
        const featherH = 110
        const topFeather = ctx.createLinearGradient(
          0,
          Math.max(0, drawY - 10),
          0,
          drawY + featherH
        )
        topFeather.addColorStop(0, '#140624')
        topFeather.addColorStop(1, 'rgba(20, 6, 36, 0)')
        ctx.fillStyle = topFeather
        ctx.fillRect(0, 0, canvasWidth, drawY + featherH)
      }
      ctx.restore()
    }

    // 3. Distant Background Sheet-Lightning Glows ("brilhos temporários lá no fundo para simular raios de fundo")
    const distantCells = [
      { xRatio: 0.18, yRatio: 0.36, periodMs: 3100, offsetMs: 200, colorInner: '232, 121, 249', colorOuter: '147, 51, 234' },
      { xRatio: 0.44, yRatio: 0.52, periodMs: 3900, offsetMs: 1450, colorInner: '251, 113, 133', colorOuter: '190, 18, 60' },
      { xRatio: 0.68, yRatio: 0.42, periodMs: 2750, offsetMs: 820, colorInner: '216, 180, 254', colorOuter: '126, 34, 206' },
      { xRatio: 0.85, yRatio: 0.34, periodMs: 4400, offsetMs: 2300, colorInner: '244, 114, 182', colorOuter: '168, 85, 247' },
    ]

    ctx.save()
    ctx.globalCompositeOperation = 'screen'
    for (const cell of distantCells) {
      const phase =
        ((elapsedTimeMs + cell.offsetMs) % cell.periodMs) / cell.periodMs
      const flash = this.computeLightningFlashEnvelope(phase, 0.16)
      if (flash <= 0.01) continue

      const cx =
        canvasWidth * cell.xRatio +
        cameraShiftX * 0.15 +
        Math.sin(elapsedTimeMs * 0.001 + cell.offsetMs) * 18
      const cy =
        canvasHeight * cell.yRatio +
        (cameraElevationPx * 0.14) % (canvasHeight * 0.25)
      const radius = Math.max(canvasWidth, canvasHeight) * 0.24

      const glow = ctx.createRadialGradient(cx, cy, 4, cx, cy, radius)
      glow.addColorStop(0, `rgba(255, 245, 255, ${(flash * 0.48).toFixed(3)})`)
      glow.addColorStop(
        0.32,
        `rgba(${cell.colorInner}, ${(flash * 0.34).toFixed(3)})`
      )
      glow.addColorStop(
        0.68,
        `rgba(${cell.colorOuter}, ${(flash * 0.14).toFixed(3)})`
      )
      glow.addColorStop(1, 'rgba(0, 0, 0, 0)')

      ctx.fillStyle = glow
      ctx.fillRect(cx - radius, cy - radius, radius * 2, radius * 2)
    }
    ctx.restore()

    // 4. Far & Mid Background Fagulhas (Sparks & Embers floating up through the storm)
    this.drawSurvivorSparksLayer(
      ctx,
      canvasWidth,
      canvasHeight,
      cameraElevationPx,
      cameraShiftX,
      elapsedTimeMs,
      50,
      0.32
    )

    // 5. Ground Scenery Layers (Two Stalagmite Layers + Smoke between them, drawn BEHIND the Base Island)
    this.drawSurvivorGroundScenery(
      ctx,
      canvasWidth,
      canvasHeight,
      cameraOriginY,
      cameraElevationPx,
      cameraShiftX,
      elapsedTimeMs
    )

    // 6. Top Storm Cloud (`nuvem.png`) + Periodic Lightning Bolts (`raio 1..4.png`) following the top of the screen
    this.drawSurvivorTopCloudAndLightning(
      ctx,
      canvasWidth,
      canvasHeight,
      cameraShiftX,
      elapsedTimeMs
    )
  }

  /**
   * Renders animated glowing volcanic embers/sparks ("fagulhas") rising and drifting across the Survivor map.
   */
  private drawSurvivorSparksLayer(
    ctx: CanvasRenderingContext2D,
    canvasWidth: number,
    canvasHeight: number,
    cameraElevationPx: number,
    cameraShiftX: number,
    elapsedTimeMs: number,
    count: number,
    parallaxFactor: number
  ): void {
    const sparkColors = [
      { core: '#FF5722', halo: 'rgba(255, 59, 48, 0.55)' },
      { core: '#FF7043', halo: 'rgba(255, 107, 53, 0.50)' },
      { core: '#F43F5E', halo: 'rgba(244, 63, 94, 0.55)' },
      { core: '#EC4899', halo: 'rgba(236, 72, 153, 0.55)' },
      { core: '#C084FC', halo: 'rgba(168, 85, 247, 0.55)' },
      { core: '#E879F9', halo: 'rgba(217, 70, 239, 0.50)' },
    ]

    ctx.save()
    for (let i = 0; i < count; i++) {
      const seedA = (i * 137.508) % 100
      const seedB = (i * 293.713) % 100
      const speedY = 26 + (i % 7) * 9
      const driftX =
        this.cloudWindDriftPx * (0.45 + (i % 5) * 0.14) +
        Math.sin(elapsedTimeMs * 0.0022 + i * 1.7) * 26

      const rawX =
        (seedA / 100) * (canvasWidth + 160) +
        driftX +
        cameraShiftX * parallaxFactor
      const sx =
        (((rawX % (canvasWidth + 160)) + (canvasWidth + 160)) %
          (canvasWidth + 160)) -
        80

      const cycleH = canvasHeight + 140
      const rawY =
        canvasHeight +
        60 -
        ((elapsedTimeMs * 0.001 * speedY +
          (seedB / 100) * cycleH -
          cameraElevationPx * parallaxFactor) %
          cycleH)
      const sy = ((rawY % cycleH) + cycleH) % cycleH - 40

      const pulse =
        0.45 + 0.55 * Math.sin(elapsedTimeMs * 0.006 + i * 2.31)
      if (pulse <= 0.12) continue

      const palette = sparkColors[i % sparkColors.length]
      const rx = 1.8 + (i % 3) * 0.95
      const ry = rx * (1.7 + (i % 2) * 0.6)
      const angle =
        -0.38 + Math.sin(elapsedTimeMs * 0.0018 + i) * 0.25

      ctx.save()
      ctx.translate(sx, sy)
      ctx.rotate(angle)
      ctx.globalAlpha = Math.min(1, pulse * 0.92)

      // Outer glow
      ctx.fillStyle = palette.halo
      ctx.beginPath()
      ctx.ellipse(0, 0, rx * 2.2, ry * 1.8, 0, 0, Math.PI * 2)
      ctx.fill()

      // Bright core
      ctx.fillStyle = palette.core
      ctx.beginPath()
      ctx.ellipse(0, 0, rx, ry, 0, 0, Math.PI * 2)
      ctx.fill()
      ctx.restore()
    }
    ctx.restore()
  }

  /**
   * Renders a compact, well-proportioned top vortex cloud (`nuvem.png`) that follows the top of the screen,
   * repeating horizontally if needed on wide monitors, with periodic lightning bolts (`raio 1..4.png`).
   */
  private drawSurvivorTopCloudAndLightning(
    ctx: CanvasRenderingContext2D,
    canvasWidth: number,
    canvasHeight: number,
    cameraShiftX: number,
    elapsedTimeMs: number
  ): void {
    const nuvemImg = this.survivorSprites.nuvem
    const nuvemNatW = nuvemImg?.naturalWidth || 2752
    const nuvemNatH = nuvemImg?.naturalHeight || 352

    // Compact, pleasant height (~12.5% of viewport height, clamped between 86px and 132px)
    const cloudH = Math.min(132, Math.max(86, canvasHeight * 0.125))
    const cloudW = cloudH * (nuvemNatW / nuvemNatH)
    const centerCloudX =
      (canvasWidth - cloudW) / 2 +
      cameraShiftX * 0.14 +
      Math.sin(elapsedTimeMs * 0.0009) * 5
    const cloudY = -8 + Math.sin(elapsedTimeMs * 0.0016) * 3

    // Periodic lightning emitters positioned under the cloud
    const boltSlots = [
      {
        xOffsetFactor: -0.34,
        periodMs: 2650,
        offsetMs: 0,
        activeDuty: 0.24,
        boltIdx: 2, // raio 3
        flipX: true,
        angleRad: 0.12,
        scaleMul: 0.31,
        glowRgb: '255, 75, 110',
      },
      {
        xOffsetFactor: -0.17,
        periodMs: 3100,
        offsetMs: 950,
        activeDuty: 0.22,
        boltIdx: 0, // raio 1
        flipX: false,
        angleRad: 0.04,
        scaleMul: 0.29,
        glowRgb: '217, 70, 239',
      },
      {
        xOffsetFactor: 0.18,
        periodMs: 2450,
        offsetMs: 420,
        activeDuty: 0.25,
        boltIdx: 1, // raio 2
        flipX: false,
        angleRad: -0.05,
        scaleMul: 0.31,
        glowRgb: '244, 63, 94',
      },
      {
        xOffsetFactor: 0.35,
        periodMs: 3400,
        offsetMs: 1680,
        activeDuty: 0.22,
        boltIdx: 3, // raio 4 (rotated downward)
        flipX: false,
        angleRad: 1.24,
        scaleMul: 0.21,
        glowRgb: '168, 85, 247',
      },
    ]

    const cloudCenterX = centerCloudX + cloudW / 2
    const activeBolts: Array<{
      anchorX: number
      anchorY: number
      intensity: number
      glowRgb: string
      bW: number
      bH: number
      boltImg: HTMLImageElement
      isHorizontalBolt: boolean
      angleRad: number
      flipX: boolean
      sIdx: number
      cycleCount: number
    }> = []

    for (let sIdx = 0; sIdx < boltSlots.length; sIdx++) {
      const slot = boltSlots[sIdx]
      const cycleCount = Math.floor(
        (elapsedTimeMs + slot.offsetMs) / slot.periodMs
      )
      const phase =
        ((elapsedTimeMs + slot.offsetMs) % slot.periodMs) / slot.periodMs
      const intensity = this.computeLightningFlashEnvelope(
        phase,
        slot.activeDuty
      )
      if (intensity <= 0.02) continue

      const chosenIdx = (slot.boltIdx + cycleCount) % 4
      const boltImg =
        this.survivorSprites.raios[chosenIdx] ||
        this.survivorSprites.raios.find((r) => r !== null) ||
        null
      if (!boltImg) continue

      const anchorX =
        cloudCenterX +
        cloudW * slot.xOffsetFactor +
        Math.sin(cycleCount * 3.1 + sIdx) * 14
      // Tuck the bolt root deeper into the cloud body so it originates inside the vortex
      const anchorY = cloudY + cloudH * 0.38

      const bNatW = boltImg.naturalWidth || 480
      const bNatH = boltImg.naturalHeight || 800
      const isHorizontalBolt = bNatW > bNatH * 1.8 // raio 4 is 1518x211

      const bScale =
        (canvasHeight / 980) *
        (isHorizontalBolt ? 0.21 : slot.scaleMul * 0.92)
      const bW = bNatW * bScale
      const bH = bNatH * bScale

      activeBolts.push({
        anchorX,
        anchorY,
        intensity,
        glowRgb: slot.glowRgb,
        bW,
        bH,
        boltImg,
        isHorizontalBolt,
        angleRad: slot.angleRad,
        flipX: slot.flipX,
        sIdx,
        cycleCount,
      })

      // 1) Wide atmospheric bloom behind the bolt (blends with the dark stormy sky)
      ctx.save()
      ctx.globalCompositeOperation = 'screen'
      const haloR = Math.max(bW, bH) * 0.82
      const haloCenterY = anchorY + haloR * 0.38
      const haloGrad = ctx.createRadialGradient(
        anchorX,
        haloCenterY,
        4,
        anchorX,
        haloCenterY,
        haloR
      )
      haloGrad.addColorStop(
        0,
        `rgba(255, 235, 255, ${(intensity * 0.38).toFixed(3)})`
      )
      haloGrad.addColorStop(
        0.38,
        `rgba(${slot.glowRgb}, ${(intensity * 0.26).toFixed(3)})`
      )
      haloGrad.addColorStop(
        0.72,
        `rgba(${slot.glowRgb}, ${(intensity * 0.09).toFixed(3)})`
      )
      haloGrad.addColorStop(1, 'rgba(0, 0, 0, 0)')
      ctx.fillStyle = haloGrad
      ctx.fillRect(
        anchorX - haloR,
        haloCenterY - haloR,
        haloR * 2,
        haloR * 2
      )
      ctx.restore()

      // 2) Blended lightning bolt sprite (Screen + Lighter multi-pass to eliminate matte edges)
      ctx.save()
      ctx.translate(anchorX, anchorY)
      if (isHorizontalBolt) {
        ctx.rotate(sIdx < 2 ? 1.88 : 1.28)
      } else {
        ctx.rotate(slot.angleRad)
        if (slot.flipX || cycleCount % 2 === 1) {
          ctx.scale(-1, 1)
        }
      }

      const drawX = isHorizontalBolt ? -bW * 0.08 : -bW * 0.5
      const drawY = isHorizontalBolt ? -bH * 0.5 : -bH * 0.08

      // Pass A: Soft screen-blended plasma bloom
      ctx.globalCompositeOperation = 'screen'
      ctx.shadowColor = `rgb(${slot.glowRgb})`
      ctx.shadowBlur = 20
      ctx.globalAlpha = Math.min(1, intensity * 0.85)
      ctx.drawImage(boltImg, drawX, drawY, bW, bH)

      // Pass B: Additive core flash so the bolt merges with background clouds & sky
      ctx.globalCompositeOperation = 'lighter'
      ctx.shadowBlur = 0
      ctx.globalAlpha = Math.min(1, intensity * 0.5)
      ctx.drawImage(boltImg, drawX, drawY, bW, bH)

      ctx.restore()
    }

    // Draw `nuvem.png` centered and repeated horizontally if the screen is wider than a single cloud tile
    if (nuvemImg) {
      ctx.save()
      const stepW = cloudW * 0.94
      for (let offsetIdx = -2; offsetIdx <= 2; offsetIdx++) {
        const tileX = centerCloudX + offsetIdx * stepW
        if (tileX + cloudW < -40 || tileX > canvasWidth + 40) continue
        ctx.save()
        ctx.translate(tileX + cloudW / 2, cloudY)
        if (Math.abs(offsetIdx) % 2 === 1) {
          ctx.scale(-1, 1)
        }
        ctx.drawImage(nuvemImg, -cloudW / 2, 0, cloudW, cloudH)
        ctx.restore()
      }
      ctx.restore()
    }

    // 3) Post-cloud integration: internal cloud glow & rim-light where each active bolt exits `nuvem.png`
    for (const bolt of activeBolts) {
      ctx.save()
      ctx.globalCompositeOperation = 'screen'

      // Soft radial illumination inside the lower cloud rim
      const exitY = cloudY + cloudH * 0.68
      const rimR = Math.max(58, cloudH * 0.72)
      const rimGrad = ctx.createRadialGradient(
        bolt.anchorX,
        exitY,
        3,
        bolt.anchorX,
        exitY,
        rimR
      )
      rimGrad.addColorStop(
        0,
        `rgba(255, 240, 255, ${(bolt.intensity * 0.48).toFixed(3)})`
      )
      rimGrad.addColorStop(
        0.42,
        `rgba(${bolt.glowRgb}, ${(bolt.intensity * 0.32).toFixed(3)})`
      )
      rimGrad.addColorStop(1, 'rgba(0, 0, 0, 0)')
      ctx.fillStyle = rimGrad
      ctx.fillRect(
        bolt.anchorX - rimR,
        exitY - rimR * 0.75,
        rimR * 2,
        rimR * 1.5
      )

      // Subtle screen-blended bolt bleed over the lower cloud border so the bolt doesn't look flatly cut off
      ctx.translate(bolt.anchorX, bolt.anchorY)
      if (bolt.isHorizontalBolt) {
        ctx.rotate(bolt.sIdx < 2 ? 1.88 : 1.28)
      } else {
        ctx.rotate(bolt.angleRad)
        if (bolt.flipX || bolt.cycleCount % 2 === 1) {
          ctx.scale(-1, 1)
        }
      }
      const drawX = bolt.isHorizontalBolt ? -bolt.bW * 0.08 : -bolt.bW * 0.5
      const drawY = bolt.isHorizontalBolt ? -bolt.bH * 0.5 : -bolt.bH * 0.08
      ctx.globalAlpha = Math.min(1, bolt.intensity * 0.34)
      ctx.drawImage(bolt.boltImg, drawX, drawY, bolt.bW, bolt.bH)

      ctx.restore()
    }
  }

  /**
   * Renders the Survival Mode Ground Scenery (behind the Base Island and Tower):
   * - Back Stalagmite Layer (`estalagmite.png` Layer 1): Compact, horizontally tiled with horizontal flips and varied heights.
   * - Middle Smoke Layer (`smoke.png`): Volcanic mist & embers tiled horizontally between the two stalagmite layers.
   * - Front Stalagmite Layer (`estalagmite.png` Layer 2): Compact foreground spikes tiled horizontally with varied heights/flips.
   */
  private drawSurvivorGroundScenery(
    ctx: CanvasRenderingContext2D,
    canvasWidth: number,
    canvasHeight: number,
    cameraOriginY: number,
    cameraElevationPx: number,
    cameraShiftX: number,
    elapsedTimeMs: number
  ): void {
    const u = GAME_CONSTANTS.UNIT_PX
    const baseCameraOriginY = canvasHeight - 112
    const seaLevelScreenY = cameraOriginY + 2.8 * u

    const backLayerScreenY =
      baseCameraOriginY + 2.2 * u + cameraElevationPx * 0.52
    if (
      backLayerScreenY > canvasHeight + 260 &&
      seaLevelScreenY > canvasHeight + 260
    ) {
      return
    }

    const estImg = this.survivorSprites.estalagmite
    const smokeImg = this.survivorSprites.smoke

    const estNatW = estImg?.naturalWidth || 2752
    const estNatH = estImg?.naturalHeight || 522
    const smokeNatW = smokeImg?.naturalWidth || 2752
    const smokeNatH = smokeImg?.naturalHeight || 892

    // Compact, pleasant proportions (~14% of screen height for stalagmites, tiled horizontally)
    const frontEstH = Math.min(142, Math.max(92, canvasHeight * 0.145))
    const frontEstW = frontEstH * (estNatW / estNatH)

    const backEstH = frontEstH * 1.16
    const backEstW = backEstH * (estNatW / estNatH)

    const smokeH = Math.min(185, Math.max(120, canvasHeight * 0.19))
    const smokeW = smokeH * (smokeNatW / smokeNatH)

    ctx.save()

    // =========================================================================
    // 1. CAMADA 1 DE ESTALAGMITES (TRASEIRA — Repetida horizontalmente com Flip e Alturas Diferentes)
    // =========================================================================
    if (estImg) {
      const backParallaxX = cameraShiftX * 0.24
      const backBottomY = canvasHeight + 18 + cameraElevationPx * 0.48
      const backStepW = backEstW * 0.86
      const heightMultipliers = [1.08, 0.92, 1.15, 0.96, 1.05]

      for (let idx = -3; idx <= 3; idx++) {
        const tileCenterX =
          canvasWidth / 2 + backParallaxX + idx * backStepW
        if (
          tileCenterX + backEstW / 2 < -60 ||
          tileCenterX - backEstW / 2 > canvasWidth + 60
        ) {
          continue
        }
        const hMul =
          heightMultipliers[
            ((idx % heightMultipliers.length) + heightMultipliers.length) %
              heightMultipliers.length
          ]
        const tileH = backEstH * hMul
        const flipX = Math.abs(idx) % 2 === 0

        ctx.save()
        ctx.globalAlpha = 0.78
        ctx.translate(tileCenterX, backBottomY - tileH - 22)
        ctx.scale(flipX ? -1 : 1, 1)
        ctx.drawImage(estImg, -backEstW / 2, 0, backEstW, tileH)
        ctx.restore()
      }
    }

    // =========================================================================
    // 2. CAMADA DE SMOKE ENTRE AS ESTALAGMITES (`smoke.png` repetida horizontalmente)
    // =========================================================================
    if (smokeImg) {
      const midSmokeBottomY = canvasHeight + 16 + cameraElevationPx * 0.62
      const smokeDriftX =
        cameraShiftX * 0.34 + Math.sin(elapsedTimeMs * 0.00055) * 22
      const smokeStepW = smokeW * 0.88

      for (let idx = -3; idx <= 3; idx++) {
        const tileCenterX =
          canvasWidth / 2 + smokeDriftX + idx * smokeStepW
        if (
          tileCenterX + smokeW / 2 < -60 ||
          tileCenterX - smokeW / 2 > canvasWidth + 60
        ) {
          continue
        }
        const flipX = Math.abs(idx) % 2 === 1
        ctx.save()
        ctx.globalAlpha = 0.9
        ctx.translate(tileCenterX, midSmokeBottomY - smokeH)
        ctx.scale(flipX ? -1 : 1, 1)
        ctx.drawImage(smokeImg, -smokeW / 2, 0, smokeW, smokeH)
        ctx.restore()
      }
    }

    // Fagulhas subindo entre as camadas de estalagmites
    this.drawSurvivorSparksLayer(
      ctx,
      canvasWidth,
      canvasHeight,
      cameraElevationPx,
      cameraShiftX,
      elapsedTimeMs + 900,
      22,
      0.65
    )

    // =========================================================================
    // 3. CAMADA 2 DE ESTALAGMITES (FRONTAL — Repetida horizontalmente com Alturas Variadas e Flip)
    // =========================================================================
    if (estImg) {
      const frontParallaxX = cameraShiftX * 0.44
      const frontBottomY = canvasHeight + 22 + cameraElevationPx * 0.78
      const frontStepW = frontEstW * 0.86
      const frontHeightMuls = [1.0, 0.88, 1.06, 0.93, 1.02]

      for (let idx = -3; idx <= 3; idx++) {
        const tileCenterX =
          canvasWidth / 2 + frontParallaxX + idx * frontStepW
        if (
          tileCenterX + frontEstW / 2 < -60 ||
          tileCenterX - frontEstW / 2 > canvasWidth + 60
        ) {
          continue
        }
        const hMul =
          frontHeightMuls[
            ((idx % frontHeightMuls.length) + frontHeightMuls.length) %
              frontHeightMuls.length
          ]
        const tileH = frontEstH * hMul
        const flipX = Math.abs(idx) % 2 === 1

        ctx.save()
        ctx.translate(tileCenterX, frontBottomY - tileH)
        ctx.scale(flipX ? -1 : 1, 1)
        ctx.drawImage(estImg, -frontEstW / 2, 0, frontEstW, tileH)
        ctx.restore()
      }

      // =======================================================================
      // 4. NÉVOA RASTEIRA NA BASE DAS ESTALAGMITES (`smoke.png`)
      // =======================================================================
      if (smokeImg) {
        const baseSmokeDriftX =
          cameraShiftX * 0.5 - Math.sin(elapsedTimeMs * 0.0007) * 18
        const baseSmokeH = smokeH * 0.68
        const baseSmokeW = smokeW * 0.85
        const baseSmokeStepW = baseSmokeW * 0.86
        const baseSmokeTopY = frontBottomY - baseSmokeH * 0.72

        for (let idx = -3; idx <= 3; idx++) {
          const tileCenterX =
            canvasWidth / 2 + baseSmokeDriftX + idx * baseSmokeStepW
          if (
            tileCenterX + baseSmokeW / 2 < -60 ||
            tileCenterX - baseSmokeW / 2 > canvasWidth + 60
          ) {
            continue
          }
          ctx.save()
          ctx.globalAlpha = 0.82
          ctx.translate(tileCenterX, baseSmokeTopY)
          if (Math.abs(idx) % 2 === 1) {
            ctx.scale(-1, 1)
          }
          ctx.drawImage(smokeImg, -baseSmokeW / 2, 0, baseSmokeW, baseSmokeH)
          ctx.restore()
        }
      }
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
    elevations: readonly number[] = [0, 0, 0, 0, 0, 0, 0, 0],
    options?: {
      isPuzzleMode?: boolean
      riseUnits?: number
    }
  ): void {
    const u = GAME_CONSTANTS.UNIT_PX
    const cols = GAME_CONSTANTS.BASE_WIDTH_UNITS // 8 columns
    const height = GAME_CONSTANTS.BASE_HEIGHT_UNITS * u
    const isPuzzle =
      Boolean(options?.isPuzzleMode) ||
      elevations.some((e) => e > 2)
    const risePx = Math.max(0, (options?.riseUnits ?? 0) * u)

    ctx.save()
    ctx.translate(centerX, centerY)

    if (isPuzzle) {
      // In Puzzle Mode ("Abaixo do Laser"), draw ultra-narrow vertical wooden/stone pillar trunks
      // rising from the water directly under active columns (`elev >= 0`), without the wide 8-col house roof.
      this.drawPuzzlePillarTrunks(ctx, cols, u, height, elevations, risePx)
    } else {
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

    // 3. Draw the Modular 1x1 Green Blocks for each column (Col 0 .. Col 7) from bottom row (r = 0) up to r = maxElev
    const maxElev = Math.max(2, ...elevations)
    for (let r = 0; r <= maxElev; r++) {
      for (let col = 0; col < cols; col++) {
        const elev = elevations[col] ?? 0
        if (elev < r) continue

        const colX = (-cols / 2 + col) * u
        const blockTopY = -height / 2 - r * u
        const isTopOfColumn = r === elev
        const hasLeftNeighbor = col > 0 && (elevations[col - 1] ?? 0) >= r
        const hasRightNeighbor =
          col < cols - 1 && (elevations[col + 1] ?? 0) >= r
        const hasBottomNeighbor = r > 0 || isPuzzle

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
   * Draws narrow Tricky-Towers-style vertical wooden/stone pillar trunks rising out of the water
   * directly beneath each active column (`elev >= 0`) in Puzzle Mode.
   */
  private drawPuzzlePillarTrunks(
    ctx: CanvasRenderingContext2D,
    cols: number,
    u: number,
    height: number,
    elevations: readonly number[],
    risePx: number
  ): void {
    const trunkTopY = height / 2
    const trunkDepthPx = 5.5 * u + risePx

    for (let col = 0; col < cols; col++) {
      const elev = elevations[col] ?? -2
      if (elev < 0) continue

      const colX = (-cols / 2 + col) * u
      const hasLeft = col > 0 && (elevations[col - 1] ?? -2) >= 0
      const hasRight = col < cols - 1 && (elevations[col + 1] ?? -2) >= 0

      ctx.save()

      // Main vertical ribbed wooden/terracotta trunk body
      const trunkGrad = ctx.createLinearGradient(colX, trunkTopY, colX + u, trunkTopY)
      trunkGrad.addColorStop(0, '#9A5B32')
      trunkGrad.addColorStop(0.5, '#7C4221')
      trunkGrad.addColorStop(1, '#5C2E14')
      ctx.fillStyle = trunkGrad
      ctx.fillRect(colX, trunkTopY, u, trunkDepthPx)

      // Vertical carved wood grain ribs inside the column
      ctx.fillStyle = 'rgba(42, 18, 6, 0.26)'
      ctx.fillRect(colX + u * 0.22, trunkTopY, 3, trunkDepthPx)
      ctx.fillRect(colX + u * 0.68, trunkTopY, 3, trunkDepthPx)

      // Horizontal stone/brick ring bands every 1.0u down the trunk (shows the +0.5u rise steps clearly!)
      const numRings = Math.ceil(trunkDepthPx / u)
      for (let r = 0; r < numRings; r++) {
        const ry = trunkTopY + r * u
        // Stone collar under top grass row (r === 0)
        if (r === 0) {
          ctx.fillStyle = '#64748B'
          ctx.fillRect(colX + 1, ry, u - 2, 8)
          ctx.fillStyle = '#94A3B8'
          ctx.fillRect(colX + 2, ry + 1, u - 4, 3)
        } else {
          ctx.strokeStyle = 'rgba(24, 20, 37, 0.45)'
          ctx.lineWidth = 1.6
          ctx.beginPath()
          ctx.moveTo(colX + 1, ry)
          ctx.lineTo(colX + u - 1, ry)
          ctx.stroke()
        }
      }

      // Outer dark cartoon border on exposed left/right edges of the pillar
      ctx.strokeStyle = '#181425'
      ctx.lineWidth = 2.4
      ctx.beginPath()
      if (!hasLeft) {
        ctx.moveTo(colX + 1, trunkTopY)
        ctx.lineTo(colX + 1, trunkTopY + trunkDepthPx)
      } else {
        ctx.strokeStyle = 'rgba(24, 20, 37, 0.35)'
        ctx.lineWidth = 1.2
        ctx.moveTo(colX, trunkTopY)
        ctx.lineTo(colX, trunkTopY + trunkDepthPx)
      }
      ctx.stroke()

      ctx.strokeStyle = '#181425'
      ctx.lineWidth = 2.4
      ctx.beginPath()
      if (!hasRight) {
        ctx.moveTo(colX + u - 1, trunkTopY)
        ctx.lineTo(colX + u - 1, trunkTopY + trunkDepthPx)
      }
      ctx.stroke()

      ctx.restore()
    }
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

  private whiteSilhouetteCache: WeakMap<HTMLImageElement, HTMLCanvasElement> =
    new WeakMap()

  private getWhiteSilhouetteCanvas(
    img: HTMLImageElement
  ): HTMLCanvasElement | null {
    const cached = this.whiteSilhouetteCache.get(img)
    if (cached) return cached
    const w = img.naturalWidth || img.width
    const h = img.naturalHeight || img.height
    if (!w || !h) return null
    const offscreen = document.createElement('canvas')
    offscreen.width = w
    offscreen.height = h
    const octx = offscreen.getContext('2d')
    if (!octx) return null
    octx.drawImage(img, 0, 0, w, h)
    octx.globalCompositeOperation = 'source-in'
    octx.fillStyle = '#FFFFFF'
    octx.fillRect(0, 0, w, h)
    this.whiteSilhouetteCache.set(img, offscreen)
    return offscreen
  }

  /**
   * Returns the 5 pre-discovered cast animation frame URLs (`_cast_1.png` .. `_cast_5.png`) for a given `skinId`.
   */
  public getPlayerCastFrameUrls(skinId: string): string[] {
    return (this.playerCastFrameUrls.get(skinId.toLowerCase()) || []).filter(
      Boolean
    )
  }

  /**
   * Computes the 0-based cast animation frame index (`0..4`) from `castAnimRemainingMs`.
   * Returns `0` (resting pose holding wand/sword/staff) when idle (`castAnimRemainingMs <= 0`).
   *
   * Timeline over `castAnimDurationMs` (default `950ms`, `progress = 0 -> 1`):
   * - `0.00..0.08`: Frame 0 (`_cast_1` — anticipation / starting pose)
   * - `0.08..0.18`: Frame 1 (`_cast_2` — lifting wand low-mid)
   * - `0.18..0.28`: Frame 2 (`_cast_3` — lifting wand mid-high)
   * - `0.28..0.40`: Frame 3 (`_cast_4` — wand high, magic charging)
   * - `0.40..0.74`: Frame 4 (`_cast_5` — PEAK! Wand raised + magic sparkles/roar)
   * - `0.74..0.83`: Frame 3 (`_cast_4` — lowering wand high-mid)
   * - `0.83..0.92`: Frame 2 (`_cast_3` — lowering wand mid-low)
   * - `0.92..1.00`: Frame 1 (`_cast_2` — returning smoothly to Frame 0 idle)
   */
  public getCastFrameIndex(
    castAnimRemainingMs: number,
    castAnimDurationMs: number = 950
  ): number {
    if (!castAnimRemainingMs || castAnimRemainingMs <= 0) return 0
    const dur = Math.max(100, castAnimDurationMs)
    const progress = Math.max(0, Math.min(1, 1 - castAnimRemainingMs / dur))
    if (progress < 0.08) return 0
    if (progress < 0.18) return 1
    if (progress < 0.28) return 2
    if (progress < 0.40) return 3
    if (progress < 0.74) return 4
    if (progress < 0.83) return 3
    if (progress < 0.92) return 2
    return 1
  }

  /**
   * Renders the floating character/mascot alongside the tower's top height.
   * Uses the active Player Skin from `assets/sprites/player` (and its 5-frame wand-raising animation
   * in `assets/sprites/player/cast/` when activating a power)
   * with procedural floating bobbing, tower-facing horizontal orientation, victory dance flips,
   * white flash & 3-second invulnerability blinking when dropping a piece, expressive Wizard Shock Reaction,
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
      whiteFlashAlpha?: number
      blinkAlpha?: number
      fallReactionIntensity?: number
      isSurvivalLifeLoss?: boolean
      invulnerableRemainingMs?: number
      castAnimRemainingMs?: number
      castAnimDurationMs?: number
    }
  ): void {
    const slot = this.getSlot('mascot_floating')
    const rawFlipX = options?.scaleXFlip ?? -1
    const extraTilt = options?.extraTiltRad ?? 0
    const reaction = Math.max(0, Math.min(1, options?.fallReactionIntensity ?? 0))
    const whiteFlash = Math.max(0, Math.min(1, options?.whiteFlashAlpha ?? 0))
    const blinkAlpha = Math.max(0.15, Math.min(1, options?.blinkAlpha ?? 1))
    const invulnMs = Math.max(0, options?.invulnerableRemainingMs ?? 0)
    const castRemMs = Math.max(0, options?.castAnimRemainingMs ?? 0)
    const castDurMs = Math.max(100, options?.castAnimDurationMs ?? 950)
    const isCasting = castRemMs > 0
    const castProgress = isCasting
      ? Math.max(0, Math.min(1, 1 - castRemMs / castDurMs))
      : 0
    const castSin = isCasting ? Math.sin(castProgress * Math.PI) : 0

    // Wizard startled jump + rapid horizontal panic tremor when a piece falls!
    const jumpPhase = reaction > 0.65 ? (reaction - 0.65) / 0.35 : 0
    const reactionJumpY = -Math.sin(jumpPhase * Math.PI) * 26
    const castHopY = -castSin * 9
    const reactionShakeX =
      reaction > 0
        ? Math.sin(animTimeMs * 0.058) * 7.5 * Math.pow(reaction, 0.75)
        : 0
    const reactionTilt =
      reaction > 0
        ? Math.sin(animTimeMs * 0.042) * 0.24 * Math.pow(reaction, 0.8) +
          (rawFlipX < 0 ? 0.14 : -0.14) * jumpPhase
        : 0

    const effX = centerX + reactionShakeX
    const effY = centerY + reactionJumpY + castHopY

    const baseTiltRad = Math.sin(animTimeMs * 0.0025) * 0.04
    const tiltRad = baseTiltRad + extraTilt + reactionTilt

    const squashStretchY = (1 + jumpPhase * 0.15) * (1 + castSin * 0.035)
    const squashStretchX = (1 - jumpPhase * 0.1) * (1 + castSin * 0.02)
    const breathScaleY =
      (1 + Math.sin(animTimeMs * 0.005) * 0.02) * squashStretchY
    const breathScaleX =
      (1 - Math.sin(animTimeMs * 0.005) * 0.012) * squashStretchX

    const signedFlipX =
      Math.abs(rawFlipX) < 0.08
        ? rawFlipX >= 0
          ? 0.08
          : -0.08
        : rawFlipX

    ctx.save()
    ctx.translate(effX, effY)
    ctx.rotate(tiltRad)
    ctx.scale(breathScaleX * signedFlipX, breathScaleY)
    ctx.globalAlpha *= blinkAlpha

    if (whiteFlash > 0.02) {
      ctx.shadowColor = '#FFFFFF'
      ctx.shadowBlur = 22 * whiteFlash
    }

    const castFrames = this.playerCastFrameImages.get(
      this.activePlayerSkinId.toLowerCase()
    )
    const castFrameIdx = this.getCastFrameIndex(castRemMs, castDurMs)
    const activeCastImg = castFrames?.[castFrameIdx] || castFrames?.[0] || null

    if (
      !this.forcePlaceholders &&
      activeCastImg &&
      activeCastImg.complete &&
      activeCastImg.naturalHeight > 0
    ) {
      // 256x352 aligned cast frame where the 192x192 character box sits at (32, 158)..(224, 350)
      const targetHeight = 96
      const scale = targetHeight / 192
      const drawW = activeCastImg.naturalWidth * scale
      const drawH = activeCastImg.naturalHeight * scale
      const drawX = -drawW / 2
      const drawY = -targetHeight * 0.62 - 158 * scale
      ctx.drawImage(activeCastImg, drawX, drawY, drawW, drawH)

      if (whiteFlash > 0.01) {
        const whiteSil = this.getWhiteSilhouetteCanvas(activeCastImg)
        if (whiteSil) {
          ctx.save()
          ctx.globalAlpha = whiteFlash
          ctx.drawImage(whiteSil, drawX, drawY, drawW, drawH)
          ctx.restore()
        }
      }
    } else if (!this.forcePlaceholders && slot.loaded && slot.image) {
      // 192x192 HD sprite at 0.5x world scale = 96x96px (3x3 units, matching the 64px->32px block scale!)
      const targetHeight = 96
      const aspect =
        slot.image.naturalHeight > 0
          ? slot.image.naturalWidth / slot.image.naturalHeight
          : 1
      const drawH = targetHeight
      const drawW = Math.min(128, Math.max(48, targetHeight * aspect))
      ctx.drawImage(slot.image, -drawW / 2, -drawH * 0.62, drawW, drawH)

      if (whiteFlash > 0.01) {
        const whiteSil = this.getWhiteSilhouetteCanvas(slot.image)
        if (whiteSil) {
          ctx.save()
          ctx.globalAlpha = whiteFlash
          ctx.drawImage(whiteSil, -drawW / 2, -drawH * 0.62, drawW, drawH)
          ctx.restore()
        }
      }
    } else {
      // Fallback placeholder
      ctx.fillStyle = whiteFlash > 0.4 ? '#FFFFFF' : slot.placeholder.fill
      ctx.strokeStyle = slot.placeholder.border
      ctx.lineWidth = 2
      ctx.beginPath()
      ctx.arc(0, -14, 9, 0, Math.PI * 2)
      ctx.fill()
      ctx.stroke()

      ctx.fillStyle = whiteFlash > 0.4 ? '#FFFFFF' : '#EF4444'
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

    // Expressive Wizard Shock/Panic Reaction when a piece falls!
    if (reaction > 0.02) {
      this.drawMascotFallReactionOverlay(
        ctx,
        effX,
        effY,
        animTimeMs,
        reaction,
        Boolean(options?.isSurvivalLifeLoss)
      )
    }

    // Draw floating Power Bubbles above the character's head (unflipped so icons are always upright!)
    if (options?.selfPower || options?.attackPower) {
      this.drawMascotPowerBubbles(
        ctx,
        effX,
        effY - (reaction > 0.05 ? 18 : 0),
        animTimeMs,
        options.selfPower || null,
        options.attackPower || null
      )
    }
  }

  /**
   * Draws a specific player skin character on its floating block cloud by `skinId`
   * (used for the 2 randomly chosen side characters on `TITLE_SCREEN` and `MAIN_MENU`, and remote multiplayer lanes).
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
      whiteFlashAlpha?: number
      blinkAlpha?: number
      fallReactionIntensity?: number
      isSurvivalLifeLoss?: boolean
      invulnerableRemainingMs?: number
      castAnimRemainingMs?: number
      castAnimDurationMs?: number
    }
  ): void {
    const img =
      this.playerSkinImages.get(skinId) ||
      this.getSlot('mascot_floating').image ||
      null
    const flipX = options?.scaleXFlip ?? 1
    const targetHeight = options?.targetHeight ?? 132
    const reaction = Math.max(0, Math.min(1, options?.fallReactionIntensity ?? 0))
    const whiteFlash = Math.max(0, Math.min(1, options?.whiteFlashAlpha ?? 0))
    const blinkAlpha = Math.max(0.15, Math.min(1, options?.blinkAlpha ?? 1))
    const castRemMs = Math.max(0, options?.castAnimRemainingMs ?? 0)
    const castDurMs = Math.max(100, options?.castAnimDurationMs ?? 950)
    const isCasting = castRemMs > 0
    const castProgress = isCasting
      ? Math.max(0, Math.min(1, 1 - castRemMs / castDurMs))
      : 0
    const castSin = isCasting ? Math.sin(castProgress * Math.PI) : 0

    const jumpPhase = reaction > 0.65 ? (reaction - 0.65) / 0.35 : 0
    const reactionJumpY = -Math.sin(jumpPhase * Math.PI) * 24
    const castHopY = -castSin * 9
    const reactionShakeX =
      reaction > 0
        ? Math.sin(animTimeMs * 0.058) * 7.0 * Math.pow(reaction, 0.75)
        : 0
    const reactionTilt =
      reaction > 0
        ? Math.sin(animTimeMs * 0.042) * 0.22 * Math.pow(reaction, 0.8)
        : 0

    const effX = centerX + reactionShakeX
    const effY = centerY + reactionJumpY + castHopY

    const tiltRad = Math.sin(animTimeMs * 0.0022) * 0.035 + reactionTilt
    const breathScaleY =
      (1 + Math.sin(animTimeMs * 0.0045) * 0.018) *
      (1 + jumpPhase * 0.14) *
      (1 + castSin * 0.035)
    const breathScaleX =
      (1 - Math.sin(animTimeMs * 0.0045) * 0.012) *
      (1 - jumpPhase * 0.09) *
      (1 + castSin * 0.02)

    ctx.save()
    ctx.translate(effX, effY)
    ctx.rotate(tiltRad)
    ctx.scale(breathScaleX * flipX, breathScaleY)
    ctx.globalAlpha *= blinkAlpha

    if (whiteFlash > 0.02) {
      ctx.shadowColor = '#FFFFFF'
      ctx.shadowBlur = 20 * whiteFlash
    }

    const castFrames = this.playerCastFrameImages.get(skinId.toLowerCase())
    const castFrameIdx = this.getCastFrameIndex(castRemMs, castDurMs)
    const activeCastImg = castFrames?.[castFrameIdx] || castFrames?.[0] || null

    if (
      !this.forcePlaceholders &&
      activeCastImg &&
      activeCastImg.complete &&
      activeCastImg.naturalHeight > 0
    ) {
      const scale = targetHeight / 192
      const drawW = activeCastImg.naturalWidth * scale
      const drawH = activeCastImg.naturalHeight * scale
      const drawX = -drawW / 2
      const drawY = -targetHeight * 0.55 - 158 * scale
      ctx.drawImage(activeCastImg, drawX, drawY, drawW, drawH)

      if (whiteFlash > 0.01) {
        const whiteSil = this.getWhiteSilhouetteCanvas(activeCastImg)
        if (whiteSil) {
          ctx.save()
          ctx.globalAlpha = whiteFlash
          ctx.drawImage(whiteSil, drawX, drawY, drawW, drawH)
          ctx.restore()
        }
      }
    } else if (!this.forcePlaceholders && img && img.naturalHeight > 0) {
      const aspect = img.naturalWidth / img.naturalHeight
      const drawH = targetHeight
      const drawW = Math.min(180, Math.max(64, targetHeight * aspect))
      ctx.drawImage(img, -drawW / 2, -drawH * 0.55, drawW, drawH)

      if (whiteFlash > 0.01) {
        const whiteSil = this.getWhiteSilhouetteCanvas(img)
        if (whiteSil) {
          ctx.save()
          ctx.globalAlpha = whiteFlash
          ctx.drawImage(whiteSil, -drawW / 2, -drawH * 0.55, drawW, drawH)
          ctx.restore()
        }
      }
    } else {
      const slot = this.getSlot('mascot_floating')
      ctx.fillStyle = whiteFlash > 0.4 ? '#FFFFFF' : slot.placeholder.fill
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

    if (reaction > 0.02) {
      this.drawMascotFallReactionOverlay(
        ctx,
        effX,
        effY,
        animTimeMs,
        reaction,
        Boolean(options?.isSurvivalLifeLoss)
      )
    }
  }

  /**
   * Renders the Wizard's expressive comic shock/panic reaction above & around his head
   * when the player drops a piece:
   * - Radiating comic shock lines
   * - Flying sweat droplets
   */
  private drawMascotFallReactionOverlay(
    ctx: CanvasRenderingContext2D,
    cx: number,
    cy: number,
    animTimeMs: number,
    intensity: number,
    _isSurvivalLifeLoss: boolean
  ): void {
    const alpha = Math.min(1, intensity * 1.35)
    if (alpha <= 0.03) return

    ctx.save()
    ctx.translate(cx, cy)
    ctx.globalAlpha = alpha

    // 1. Radiating comic shock spikes around the wizard's head
    const spikePulse = Math.sin(animTimeMs * 0.045) * 4
    const angles = [-2.55, -2.1, -1.57, -1.04, -0.58]
    ctx.strokeStyle = '#FEF08A'
    ctx.lineWidth = 3
    ctx.lineCap = 'round'
    for (let i = 0; i < angles.length; i++) {
      const a = angles[i]
      const r0 = 42 + (i % 2) * 4 + spikePulse * 0.5
      const r1 = r0 + 13 + (i % 2) * 5 + spikePulse
      ctx.beginPath()
      ctx.moveTo(Math.cos(a) * r0, -18 + Math.sin(a) * r0)
      ctx.lineTo(Math.cos(a) * r1, -18 + Math.sin(a) * r1)
      ctx.stroke()
    }

    // 2. Animated flying sweat droplets ("gotinhas de suor") spraying off the wizard
    const sweatCycle = (animTimeMs * 0.0045) % 1
    const dropOffsets = [
      { dir: -1, baseX: -32, baseY: -34, phase: 0 },
      { dir: 1, baseX: 32, baseY: -36, phase: 0.35 },
      { dir: -1, baseX: -38, baseY: -16, phase: 0.68 },
    ]
    for (const d of dropOffsets) {
      const p = (sweatCycle + d.phase) % 1
      const dx = d.baseX + d.dir * p * 18
      const dy = d.baseY - Math.sin(p * Math.PI) * 10 + p * 16
      const dropAlpha = Math.sin(p * Math.PI) * alpha
      if (dropAlpha > 0.05) {
        ctx.save()
        ctx.globalAlpha = dropAlpha
        ctx.translate(dx, dy)
        ctx.rotate(d.dir * (0.35 + p * 0.4))
        ctx.fillStyle = '#38BDF8'
        ctx.strokeStyle = '#0F172A'
        ctx.lineWidth = 1.6
        ctx.beginPath()
        ctx.moveTo(0, -6)
        ctx.quadraticCurveTo(5, 1, 0, 6)
        ctx.quadraticCurveTo(-5, 1, 0, -6)
        ctx.closePath()
        ctx.fill()
        ctx.stroke()
        ctx.restore()
      }
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
   * Formats the player's currently bound key for `selfPower` or `attackPower`
   * into a compact keycap label for the miniature button badge on the magic bubble.
   */
  private getPowerBubbleKeyLabel(kind: 'GOOD' | 'CHAOS'): string {
    const action = kind === 'GOOD' ? 'selfPower' : 'attackPower'
    const fallback = kind === 'GOOD' ? 'KeyJ' : 'KeyK'
    const code = optionsStore.state.keybinds[action]?.[0] || fallback
    if (code === 'Space') return 'ESPAÇO'
    if (code === 'ArrowUp') return '↑'
    if (code === 'ArrowDown') return '↓'
    if (code === 'ArrowLeft') return '←'
    if (code === 'ArrowRight') return '→'
    if (code === 'ShiftLeft' || code === 'ShiftRight') return 'SHIFT'
    if (code === 'ControlLeft' || code === 'ControlRight') return 'CTRL'
    if (code === 'AltLeft' || code === 'AltRight') return 'ALT'
    if (code === 'Enter') return 'ENTER'
    if (code.startsWith('Key')) return code.slice(3).toUpperCase()
    if (code.startsWith('Digit')) return code.slice(5)
    return formatKeyCodeLabel(code).toUpperCase()
  }

  /**
   * Renders the floating circular Power Bubble(s) above the mascot's head,
   * matching the Tricky Towers visual style:
   * - Light / White-Lavender Bubble ("claro para poder bom") for `selfPower`
   * - Dark Red / Crimson Bubble ("vermelho escuro para caos") for `attackPower`
   * - Miniature 3D button/keycap badge indicating which button to press
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
      // Both Good Power and Chaos Power present (Multiplayer):
      // Draw the Dark Red Chaos bubble slightly lower-right first, then the Light Good bubble above-left overlapping its edge
      this.drawSinglePowerBubble(
        ctx,
        22,
        -66 + bobChaos,
        20,
        attackPower,
        'CHAOS',
        true
      )
      this.drawSinglePowerBubble(
        ctx,
        -8,
        -82 + bobGood,
        23,
        selfPower,
        'GOOD',
        true
      )
    } else if (selfPower) {
      this.drawSinglePowerBubble(
        ctx,
        -2,
        -80 + bobGood,
        24,
        selfPower,
        'GOOD',
        false
      )
    } else if (attackPower) {
      this.drawSinglePowerBubble(
        ctx,
        -2,
        -80 + bobChaos,
        24,
        attackPower,
        'CHAOS',
        false
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
    kind: 'GOOD' | 'CHAOS',
    hasBothBubbles: boolean = false
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

    // 4. Draw miniature 3D button/keycap badge on the rim of the magic bubble to indicate which button to press
    const keyLabel = this.getPowerBubbleKeyLabel(kind)
    const isWideKey = keyLabel.length > 2
    let badgeX = radius * 0.56
    let badgeY = radius * 0.68
    if (hasBothBubbles) {
      if (kind === 'GOOD') {
        badgeX = isWideKey ? -6 : -radius * 0.56
        badgeY = isWideKey ? radius * 0.86 : radius * 0.7
      } else {
        badgeX = isWideKey ? 6 : radius * 0.56
        badgeY = isWideKey ? radius * 0.86 : radius * 0.7
      }
    } else if (isWideKey) {
      badgeX = 0
      badgeY = radius * 0.88
    }
    this.drawPowerBubbleKeycapBadge(ctx, badgeX, badgeY, keyLabel, kind)

    ctx.restore()
  }

  /**
   * Draws a tactile 3D miniature keycap/button badge attached to the magic bubble rim.
   */
  private drawPowerBubbleKeycapBadge(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    label: string,
    kind: 'GOOD' | 'CHAOS'
  ): void {
    ctx.save()
    ctx.translate(x, y)

    const isWide = label.length > 2
    const fontSize = isWide ? 8.5 : 10.5
    ctx.font = `900 ${fontSize}px Inter, system-ui, sans-serif`
    const textW = ctx.measureText(label).width
    const capH = 16
    const capW = Math.max(17, Math.ceil(textW + (isWide ? 9 : 8)))
    const cornerR = 4.5
    const halfW = capW * 0.5
    const halfH = capH * 0.5

    // 1. Dark outer contour + 3D bottom shadow lip
    ctx.fillStyle = '#0E101D'
    ctx.strokeStyle = '#0E101D'
    ctx.lineWidth = 2.4
    ctx.beginPath()
    ctx.roundRect(-halfW, -halfH + 2.2, capW, capH, cornerR)
    ctx.fill()
    ctx.stroke()

    // 2. 3D Keycap lower bevel side wall
    ctx.fillStyle = kind === 'GOOD' ? '#6F79B2' : '#881337'
    ctx.beginPath()
    ctx.roundRect(-halfW, -halfH + 1.8, capW, capH - 0.5, cornerR)
    ctx.fill()

    // 3. Tactile Keycap Top Face
    const faceGrad = ctx.createLinearGradient(0, -halfH, 0, halfH - 1.5)
    if (kind === 'GOOD') {
      faceGrad.addColorStop(0, '#FFFFFF')
      faceGrad.addColorStop(0.55, '#E0E7FF')
      faceGrad.addColorStop(1, '#B4BEE6')
    } else {
      faceGrad.addColorStop(0, '#FFE4E6')
      faceGrad.addColorStop(0.55, '#FDA4AF')
      faceGrad.addColorStop(1, '#FB7185')
    }
    ctx.fillStyle = faceGrad
    ctx.strokeStyle = '#0E101D'
    ctx.lineWidth = 2.0
    ctx.beginPath()
    ctx.roundRect(-halfW, -halfH, capW, capH - 1.6, cornerR)
    ctx.fill()
    ctx.stroke()

    // 4. Crisp top specular highlight line
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.92)'
    ctx.lineWidth = 1.2
    ctx.beginPath()
    ctx.moveTo(-halfW + 3, -halfH + 1.6)
    ctx.lineTo(halfW - 3, -halfH + 1.6)
    ctx.stroke()

    // 5. Bold Key Label
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillStyle = 'rgba(255, 255, 255, 0.75)'
    ctx.fillText(label, 0, -0.1)
    ctx.fillStyle = kind === 'GOOD' ? '#1E1B4B' : '#4C0519'
    ctx.fillText(label, 0, -0.8)

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

      case 'EXTRA_LIFE': {
        // Glossy Red-Pink Extra Life Balloon with Heart Emblem & String
        ctx.strokeStyle = '#1E1B4B'
        ctx.lineWidth = 2.0
        ctx.beginPath()
        ctx.moveTo(0, 6)
        ctx.quadraticCurveTo(3, 10, -1, 14)
        ctx.stroke()

        // Balloon body
        ctx.fillStyle = '#F43F5E'
        ctx.strokeStyle = '#1E1B4B'
        ctx.lineWidth = 2.4
        ctx.beginPath()
        ctx.ellipse(0, -3, 9.5, 11, 0, 0, Math.PI * 2)
        ctx.fill()
        ctx.stroke()

        // Balloon knot at bottom
        ctx.fillStyle = '#E11D48'
        ctx.beginPath()
        ctx.moveTo(-2.5, 8)
        ctx.lineTo(2.5, 8)
        ctx.lineTo(0, 5.5)
        ctx.closePath()
        ctx.fill()
        ctx.stroke()

        // White specular shine
        ctx.fillStyle = 'rgba(255, 255, 255, 0.85)'
        ctx.beginPath()
        ctx.ellipse(-4, -6.5, 2.2, 4.0, -0.35, 0, Math.PI * 2)
        ctx.fill()

        // Mini gold '+1' heart badge in center
        ctx.fillStyle = '#FEF08A'
        ctx.font = '900 8.5px Inter, system-ui, sans-serif'
        ctx.textAlign = 'center'
        ctx.textBaseline = 'middle'
        ctx.fillText('+1♥', 1, -2)
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
      isPetrified?: boolean
      isLaserBurning?: boolean
      isCountedHighlight?: boolean
      countOrderNumber?: number
      colorPaletteIndex?: number
      blockSkinId?: string
    }
  ): void {
    const powerEffect = options?.powerEffect || 'NONE'
    const isPetrified = Boolean(options?.isPetrified)
    const slot = this.getPieceSlot(type, variant)
    const effectiveBlockSkinId =
      (options?.blockSkinId || '').trim().toLowerCase() ||
      this.activeBlockSkinId
    const effectiveBlockSkin =
      this.blockSkins.find((s) => s.id === effectiveBlockSkinId) ||
      this.getActiveBlockSkin()
    const activePalette = effectiveBlockSkin?.palette || PIECE_COLOR_PALETTE
    const paletteIdx =
      (((options?.colorPaletteIndex ?? DEFAULT_PALETTE_BY_TYPE[type] ?? 0) %
        activePalette.length) +
        activePalette.length) %
      activePalette.length
    const selectedColorTheme = activePalette[paletteIdx] || slot.placeholder
    const theme =
      isPetrified || powerEffect === 'STATIC_BRICK'
        ? {
            fill: '#64748B',
            border: '#1E293B',
            highlight: '#CBD5E1',
            label: 'Pedra Petrificada',
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
      const skinCanvases =
        effectiveBlockSkinId !== this.activeBlockSkinId
          ? this.getBlockSkinMultiColorCanvases(effectiveBlockSkinId, type)
          : slot.multiColorCanvases
      const solidColoredSource =
        skinCanvases?.[paletteIdx] ?? slot.multiColorCanvases?.[paletteIdx]
      const drawableSource: CanvasImageSource | null =
        (isPetrified || powerEffect === 'STATIC_BRICK') && slot.staticBrickCanvas
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

    // Overlay FX for active/settled Power Effects & Puzzle States
    if (!options?.isGhost) {
      if (isPetrified) {
        ctx.save()
        ctx.strokeStyle = 'rgba(30, 41, 59, 0.55)'
        ctx.lineWidth = 1.4 * scale
        for (const cell of cells) {
          const x0 = cell.x * cellPx - cellPx / 2
          const y0 = cell.y * cellPx - cellPx / 2
          ctx.beginPath()
          ctx.moveTo(x0 + 4 * scale, y0 + 6 * scale)
          ctx.lineTo(x0 + 11 * scale, y0 + 10 * scale)
          ctx.lineTo(x0 + 8 * scale, y0 + 16 * scale)
          ctx.stroke()
        }
        ctx.restore()
      }

      if (options?.isLaserBurning) {
        const pulse = 0.55 + 0.45 * Math.sin(performance.now() * 0.025)
        ctx.save()
        ctx.fillStyle = `rgba(239, 68, 68, ${(0.38 * pulse).toFixed(3)})`
        ctx.strokeStyle = `rgba(254, 240, 138, ${(0.95 * pulse).toFixed(3)})`
        ctx.lineWidth = 2.6 * scale
        ctx.shadowColor = '#EF4444'
        ctx.shadowBlur = 12 * scale
        for (const cell of cells) {
          const x0 = cell.x * cellPx - cellPx / 2
          const y0 = cell.y * cellPx - cellPx / 2
          ctx.fillRect(x0 + 1, y0 + 1, cellPx - 2, cellPx - 2)
          ctx.strokeRect(x0 + 1, y0 + 1, cellPx - 2, cellPx - 2)
        }
        ctx.restore()
      }

      if (options?.isCountedHighlight) {
        ctx.save()
        ctx.fillStyle = 'rgba(250, 204, 21, 0.28)'
        ctx.strokeStyle = '#FEF08A'
        ctx.lineWidth = 2.4 * scale
        ctx.shadowColor = '#FACC15'
        ctx.shadowBlur = 10 * scale
        for (const cell of cells) {
          const x0 = cell.x * cellPx - cellPx / 2
          const y0 = cell.y * cellPx - cellPx / 2
          ctx.fillRect(x0 + 1, y0 + 1, cellPx - 2, cellPx - 2)
          ctx.strokeRect(x0 + 1, y0 + 1, cellPx - 2, cellPx - 2)
        }
        ctx.restore()
      }

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

      if (
        effectiveBlockSkinId === 'gold' &&
        !isPetrified &&
        powerEffect !== 'STATIC_BRICK' &&
        powerEffect !== 'SLICK_BRICK' &&
        powerEffect !== 'CASTLE_ROOF' &&
        variant !== 'HEAVY_RUBBER'
      ) {
        this.drawGoldPieceCharmAndSparkles(
          ctx,
          type,
          cells,
          cellPx,
          scale,
          minX,
          minY,
          boxW,
          boxH,
          paletteIdx
        )
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

  /**
   * Renders a subtle golden luster charm ("um leve charme de ouro") and very sparse, delicate
   * appearing/disappearing sparkle glints ("pouquíssimas partículas de brilho que aparecem e somem")
   * exclusively for the `gold` block skin (`assets/sprites/block/skins/gold`).
   */
  private drawGoldPieceCharmAndSparkles(
    ctx: CanvasRenderingContext2D,
    type: PieceType,
    cells: Array<{ x: number; y: number }>,
    cellPx: number,
    scale: number,
    minX: number,
    minY: number,
    boxW: number,
    boxH: number,
    paletteIdx: number
  ): void {
    if (cells.length === 0) return
    const now = performance.now()
    const typeSeed =
      type.charCodeAt(0) * 197 + ((paletteIdx + 1) * 439)

    ctx.save()

    // 1. Leve Charme de Ouro: subtle warm golden shimmer sweeping gently across the ingot cells
    const shimmerPhase = (Math.sin(now * 0.0018 + typeSeed * 0.13) + 1) * 0.5
    ctx.globalCompositeOperation = 'screen'
    const sheenGrad = ctx.createLinearGradient(
      minX + boxW * (0.15 * shimmerPhase),
      minY,
      minX + boxW * (0.65 + 0.35 * shimmerPhase),
      minY + boxH
    )
    sheenGrad.addColorStop(0, 'rgba(254, 240, 138, 0.03)')
    sheenGrad.addColorStop(0.45, 'rgba(255, 251, 235, 0.11)')
    sheenGrad.addColorStop(0.55, 'rgba(253, 224, 71, 0.08)')
    sheenGrad.addColorStop(1, 'rgba(245, 158, 11, 0.02)')
    ctx.fillStyle = sheenGrad

    const inset = Math.max(2, 3.5 * scale)
    for (const cell of cells) {
      const x0 = cell.x * cellPx - cellPx / 2 + inset
      const y0 = cell.y * cellPx - cellPx / 2 + inset
      const cw = Math.max(2, cellPx - inset * 2)
      ctx.beginPath()
      ctx.roundRect(x0, y0, cw, cw, 3 * scale)
      ctx.fill()
    }

    // 2. Pouquíssimas partículas de brilho que aparecem e somem:
    // At most 2 candidate glint slots per piece, with long cycle periods (4.3s & 5.7s) and a short 23% active duty window
    // so most of the time 0 or 1 delicate golden sparkle is gently fading in and out.
    const candidateSlots = [
      {
        cellIndex: typeSeed % cells.length,
        ox: -0.22,
        oy: -0.22,
        periodMs: 4300,
        offsetMs: (typeSeed * 613) % 4300,
        duty: 0.23,
        sizeFactor: 1.0,
      },
      {
        cellIndex: (typeSeed + 2) % cells.length,
        ox: 0.21,
        oy: -0.16,
        periodMs: 5700,
        offsetMs: ((typeSeed + 7) * 911) % 5700,
        duty: 0.21,
        sizeFactor: 0.82,
      },
    ]

    ctx.globalCompositeOperation = 'source-over'
    for (const slot of candidateSlots) {
      const cyclePos =
        ((now + slot.offsetMs) % slot.periodMs) / slot.periodMs
      if (cyclePos >= slot.duty) continue

      // Smooth 0 -> 1 -> 0 fade-in and fade-out envelope
      const t = cyclePos / slot.duty
      const env = Math.sin(t * Math.PI)
      if (env <= 0.02) continue

      const targetCell = cells[slot.cellIndex] || cells[0]
      const driftY = (0.5 - t) * 3.2 * scale
      const sx = targetCell.x * cellPx + slot.ox * cellPx
      const sy = targetCell.y * cellPx + slot.oy * cellPx + driftY
      const arm = (3.4 + 2.8 * env) * scale * slot.sizeFactor
      const waist = Math.max(0.7, arm * 0.24)

      // Soft warm golden radial halo
      const haloR = arm * 1.9
      const halo = ctx.createRadialGradient(sx, sy, 0, sx, sy, haloR)
      halo.addColorStop(0, `rgba(255, 251, 235, ${(0.65 * env).toFixed(3)})`)
      halo.addColorStop(0.45, `rgba(253, 224, 71, ${(0.36 * env).toFixed(3)})`)
      halo.addColorStop(1, 'rgba(245, 158, 11, 0)')
      ctx.fillStyle = halo
      ctx.beginPath()
      ctx.arc(sx, sy, haloR, 0, Math.PI * 2)
      ctx.fill()

      // Crisp 4-point golden-white star glint
      ctx.save()
      ctx.translate(sx, sy)
      ctx.rotate((t - 0.5) * 0.35)
      ctx.fillStyle = `rgba(255, 251, 235, ${(0.94 * env).toFixed(3)})`
      ctx.strokeStyle = `rgba(250, 204, 21, ${(0.78 * env).toFixed(3)})`
      ctx.lineWidth = Math.max(0.6, 0.9 * scale)
      ctx.beginPath()
      ctx.moveTo(0, -arm)
      ctx.quadraticCurveTo(waist * 0.45, -waist * 0.45, arm, 0)
      ctx.quadraticCurveTo(waist * 0.45, waist * 0.45, 0, arm)
      ctx.quadraticCurveTo(-waist * 0.45, waist * 0.45, -arm, 0)
      ctx.quadraticCurveTo(-waist * 0.45, -waist * 0.45, 0, -arm)
      ctx.closePath()
      ctx.fill()
      ctx.stroke()
      ctx.restore()
    }

    ctx.restore()
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

