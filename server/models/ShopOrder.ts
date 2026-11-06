import mongoose, { Schema, Document, Model } from 'mongoose'
import type { BlockSkinCatalogCode, SkinCatalogCode } from './User.js'

export type PaymentMethodType = 'PIX' | 'CARD'

export type ShopOrderStatus =
  | 'PENDING'
  | 'APPROVED'
  | 'REJECTED'
  | 'CANCELLED'
  | 'EXPIRED'

export interface CoinPackageCatalogItem {
  id: string
  title: string
  subtitle: string
  coins: number
  bonusCoins: number
  totalCoins: number
  priceBrl: number
  badge?: string
  popular?: boolean
}

export interface ShopSkinCatalogItem {
  code: string // Código no banco (ex: 'WIZARD', 'DINO', 'PLASTIC', 'WOOD')
  spriteId: string // ID no SpriteRegistry do frontend (ex: 'player_mage', 'default', 'wood')
  category: 'PLAYER' | 'BLOCK'
  name: string
  description: string
  priceCoins: number
  isDefaultUnlocked: boolean
}

export const COIN_PACKAGES_CATALOG: CoinPackageCatalogItem[] = [
  {
    id: 'PACK_150',
    title: 'PUNHADO DE MOEDAS',
    subtitle: '150 Moedas',
    coins: 150,
    bonusCoins: 0,
    totalCoins: 150,
    priceBrl: 4.9,
  },
  {
    id: 'PACK_500',
    title: 'SACO DE MOEDAS',
    subtitle: '500 Moedas',
    coins: 500,
    bonusCoins: 0,
    totalCoins: 500,
    priceBrl: 14.9,
  },
  {
    id: 'PACK_1200',
    title: 'BAÚ PEQUENO',
    subtitle: '+120 BÔNUS',
    coins: 1200,
    bonusCoins: 120,
    totalCoins: 1200,
    priceBrl: 29.9,
    badge: 'MAIS POPULAR',
    popular: true,
  },
  {
    id: 'PACK_3000',
    title: 'BAÚ GRANDE',
    subtitle: '+450 BÔNUS',
    coins: 3000,
    bonusCoins: 450,
    totalCoins: 3000,
    priceBrl: 59.9,
  },
  {
    id: 'PACK_6000',
    title: 'CAIXA FORTE',
    subtitle: '+1.000 BÔNUS',
    coins: 6000,
    bonusCoins: 1000,
    totalCoins: 6000,
    priceBrl: 99.9,
    badge: 'MELHOR PREÇO',
  },
  {
    id: 'PACK_15000',
    title: 'FORTUNA DO ABISMO',
    subtitle: '+3.000 BÔNUS',
    coins: 15000,
    bonusCoins: 3000,
    totalCoins: 15000,
    priceBrl: 199.9,
    badge: 'MUITO OURO!',
  },
]

export const PLAYER_SKINS_SHOP_CATALOG: ShopSkinCatalogItem[] = [
  {
    code: 'WIZARD',
    spriteId: 'player_mage',
    category: 'PLAYER',
    name: '🧙‍♂️ Mago Estelar (Padrão)',
    description: 'Skin inicial padrão do Mago Normal.',
    priceCoins: 0,
    isDefaultUnlocked: true,
  },
  {
    code: 'DINO',
    spriteId: 'player_dino',
    category: 'PLAYER',
    name: '🦖 Dino Explorador',
    description: 'Explorador jurássico com chapéu de safári e osso da sorte.',
    priceCoins: 250,
    isDefaultUnlocked: false,
  },
  {
    code: 'PIRATE',
    spriteId: 'player_pirate',
    category: 'PLAYER',
    name: '🏴‍☠️ Capitão Pirata',
    description: 'Corsário dos mares flutuantes com sabre afiado.',
    priceCoins: 300,
    isDefaultUnlocked: false,
  },
  {
    code: 'DARK_MAGE',
    spriteId: 'player_shadow',
    category: 'PLAYER',
    name: '🧪 Mago das Sombras',
    description: 'Alquimista sombrio com poções arcanas esmeralda.',
    priceCoins: 450,
    isDefaultUnlocked: false,
  },
]

export const BLOCK_SKINS_SHOP_CATALOG: ShopSkinCatalogItem[] = [
  {
    code: 'PLASTIC',
    spriteId: 'default',
    category: 'BLOCK',
    name: '🧱 Plástico Clássico (Padrão)',
    description: 'Peças de plástico normal em 10 cores vibrantes.',
    priceCoins: 0,
    isDefaultUnlocked: true,
  },
  {
    code: 'WOOD',
    spriteId: 'wood',
    category: 'BLOCK',
    name: '🪵 Madeira Real',
    description: 'Peças entalhadas com veios e nós em 10 tons de madeiras nobres.',
    priceCoins: 300,
    isDefaultUnlocked: false,
  },
  {
    code: 'DIY',
    spriteId: 'diy',
    category: 'BLOCK',
    name: '📦 Papelão DIY',
    description: 'Caixas de papelão com fita silvertape e tampinhas coloridas.',
    priceCoins: 400,
    isDefaultUnlocked: false,
  },
  {
    code: 'GOLD',
    spriteId: 'gold',
    category: 'BLOCK',
    name: '👑 Ouro Real',
    description: 'Lingotes de ouro 24k reluzentes com charme dourado e partículas sutis de brilho.',
    priceCoins: 600,
    isDefaultUnlocked: false,
  },
]

export function normalizePlayerSkinCode(raw: string): SkinCatalogCode {
  const clean = (raw || '').trim().toUpperCase()
  if (clean === 'DINO' || clean === 'PLAYER_DINO') return 'DINO'
  if (clean === 'PIRATE' || clean === 'PLAYER_PIRATE') return 'PIRATE'
  if (
    clean === 'DARK_MAGE' ||
    clean === 'SHADOW' ||
    clean === 'PLAYER_SHADOW'
  ) {
    return 'DARK_MAGE'
  }
  if (clean === 'ROBOT' || clean === 'PLAYER_ROBOT') return 'ROBOT'
  return 'WIZARD'
}

export function normalizeBlockSkinCode(raw: string): BlockSkinCatalogCode {
  const clean = (raw || '').trim().toUpperCase()
  if (clean === 'WOOD' || clean === 'BLOCK_WOOD') return 'WOOD'
  if (clean === 'DIY' || clean === 'BLOCK_DIY' || clean === 'CARDBOARD') {
    return 'DIY'
  }
  if (clean === 'GOLD' || clean === 'BLOCK_GOLD' || clean === 'OURO') {
    return 'GOLD'
  }
  return 'PLASTIC'
}

export interface IShopOrder {
  orderId: string // ID único do pedido no Toy Tower (ex: ORD-...)
  googleId: string // Vinculado ao Google ID do usuário
  email: string // Vinculado ao Gmail do usuário
  handle: string // @handle do usuário
  packageId: string // ID do pacote de moedas (ex: PACK_POPULAR)
  packageTitle: string // Nome do pacote
  coinsAmount: number // Total de moedas a creditar na aprovação
  priceBrl: number // Valor em R$
  paymentMethod: PaymentMethodType // 'PIX' | 'CARD'
  status: ShopOrderStatus // 'PENDING' | 'APPROVED' | 'REJECTED' | 'CANCELLED' | 'EXPIRED'
  provider: 'MERCADO_PAGO' | 'MERCADO_PAGO_SANDBOX'
  mpPaymentId?: string // ID do pagamento no Mercado Pago (/v1/payments)
  mpPreferenceId?: string // ID da preferência no Mercado Pago (/checkout/preferences)
  pixQrCode?: string // Código PIX Copia e Cola
  pixQrCodeBase64?: string // Imagem QR Code Base64
  ticketUrl?: string // Link externo do boleto/ticket PIX no Mercado Pago
  checkoutUrl?: string // Link do Checkout do Mercado Pago (Cartão ou PIX)
  coinsCredited: boolean // Garantia de idempotência para nunca creditar 2x o mesmo pedido
  createdAt: Date
  updatedAt: Date
  approvedAt?: Date | null
}

export interface IShopOrderDocument extends IShopOrder, Document {}

const ShopOrderSchema = new Schema<IShopOrderDocument>(
  {
    orderId: {
      type: String,
      required: true,
      unique: true,
      index: true,
      trim: true,
    },
    googleId: {
      type: String,
      required: true,
      index: true,
      trim: true,
    },
    email: {
      type: String,
      required: true,
      lowercase: true,
      index: true,
      trim: true,
    },
    handle: {
      type: String,
      required: true,
      lowercase: true,
      trim: true,
    },
    packageId: {
      type: String,
      required: true,
      trim: true,
    },
    packageTitle: {
      type: String,
      required: true,
      trim: true,
    },
    coinsAmount: {
      type: Number,
      required: true,
      min: 1,
    },
    priceBrl: {
      type: Number,
      required: true,
      min: 0.01,
    },
    paymentMethod: {
      type: String,
      enum: ['PIX', 'CARD'],
      required: true,
    },
    status: {
      type: String,
      enum: ['PENDING', 'APPROVED', 'REJECTED', 'CANCELLED', 'EXPIRED'],
      default: 'PENDING',
      index: true,
    },
    provider: {
      type: String,
      enum: ['MERCADO_PAGO', 'MERCADO_PAGO_SANDBOX'],
      default: 'MERCADO_PAGO',
    },
    mpPaymentId: {
      type: String,
      default: '',
      index: true,
    },
    mpPreferenceId: {
      type: String,
      default: '',
    },
    pixQrCode: {
      type: String,
      default: '',
    },
    pixQrCodeBase64: {
      type: String,
      default: '',
    },
    ticketUrl: {
      type: String,
      default: '',
    },
    checkoutUrl: {
      type: String,
      default: '',
    },
    coinsCredited: {
      type: Boolean,
      default: false,
    },
    createdAt: {
      type: Date,
      default: () => new Date(),
    },
    updatedAt: {
      type: Date,
      default: () => new Date(),
    },
    approvedAt: {
      type: Date,
      default: null,
    },
  },
  {
    collection: 'shop_orders',
  }
)

export const ShopOrderModel: Model<IShopOrderDocument> =
  (mongoose.models.ShopOrder as Model<IShopOrderDocument>) ||
  mongoose.model<IShopOrderDocument>('ShopOrder', ShopOrderSchema)
