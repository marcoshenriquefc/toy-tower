import mongoose, { Schema, Document, Model } from 'mongoose'

export type SkinCatalogCode =
  | 'WIZARD'
  | 'DINO'
  | 'PIRATE'
  | 'DARK_MAGE'
  | 'ROBOT'

export type BlockSkinCatalogCode = 'PLASTIC' | 'WOOD' | 'DIY' | 'GOLD'

export interface IUserStats {
  matchesPlayed: number
  wins: number
  survivalBestPieces: number
}

export interface IFriendEntry {
  handle: string
  customNick: string
  email?: string
  equippedSkin: string
  equippedBlockSkin?: string
  avatarUrl?: string
}

export interface IFriendRequestEntry {
  handle: string
  customNick: string
  email: string
  equippedSkin: string
  equippedBlockSkin?: string
  avatarUrl?: string
  createdAt?: Date | string
}

export interface IUser {
  googleId: string // Único e indexado
  email: string // Único (Gmail do usuário)
  displayName: string // Nome vindo do Google (editável depois)
  customNick: string // Nick personalizável exibido no Lobby (2 a 16 caracteres)
  handle: string // Identificador único imutável (formato @nome_000 em minúsculas)
  avatarUrl: string // Foto de perfil do Google
  coins: number // Saldo de moedas vinculado à conta Gmail (Default: 0)
  equippedSkin: string // Default: 'WIZARD' (Mago Normal)
  unlockedSkins: string[] // Default: ['WIZARD'] (Demais skins só liberam ao comprar)
  equippedBlockSkin: string // Default: 'PLASTIC' (Peças de Plástico Normal)
  unlockedBlockSkins: string[] // Default: ['PLASTIC'] (Demais skins de blocos só liberam ao comprar)
  shopMigratedV1?: boolean // Controle de migração para garantir que apenas a skin padrão venha liberada inicialmente
  friends: IFriendEntry[] // Amigos que aceitaram o pedido de amizade
  friendRequestsSent: IFriendRequestEntry[] // Pedidos enviados pendentes
  friendRequestsReceived: IFriendRequestEntry[] // Pedidos recebidos pendentes
  stats: IUserStats
  createdAt: Date
  lastLoginAt: Date
}

export interface IUserDocument extends IUser, Document {}

/**
 * A skin inicial padrão de toda conta é apenas o Mago Normal ('WIZARD' / 'player_mage')
 * com as Peças de Plástico Normal ('PLASTIC' / 'default').
 * Todas as outras skins ficam bloqueadas até que o usuário as compre com moedas na Loja.
 */
export const DEFAULT_UNLOCKED_SKINS: SkinCatalogCode[] = ['WIZARD']

export const DEFAULT_UNLOCKED_BLOCK_SKINS: BlockSkinCatalogCode[] = ['PLASTIC']

export const DEFAULT_INITIAL_FRIENDS: IFriendEntry[] = []

const UserStatsSchema = new Schema<IUserStats>(
  {
    matchesPlayed: { type: Number, default: 0 },
    wins: { type: Number, default: 0 },
    survivalBestPieces: { type: Number, default: 0 },
  },
  { _id: false }
)

const FriendEntrySchema = new Schema<IFriendEntry>(
  {
    handle: { type: String, required: true, lowercase: true, trim: true },
    customNick: { type: String, required: true, trim: true },
    email: { type: String, default: '' },
    equippedSkin: { type: String, default: 'WIZARD' },
    equippedBlockSkin: { type: String, default: 'PLASTIC' },
    avatarUrl: { type: String, default: '' },
  },
  { _id: false }
)

const FriendRequestEntrySchema = new Schema<IFriendRequestEntry>(
  {
    handle: { type: String, required: true, lowercase: true, trim: true },
    customNick: { type: String, required: true, trim: true },
    email: { type: String, default: '' },
    equippedSkin: { type: String, default: 'WIZARD' },
    equippedBlockSkin: { type: String, default: 'PLASTIC' },
    avatarUrl: { type: String, default: '' },
    createdAt: { type: Date, default: () => new Date() },
  },
  { _id: false }
)

const UserSchema = new Schema<IUserDocument>(
  {
    googleId: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
    },
    displayName: {
      type: String,
      required: true,
      trim: true,
    },
    customNick: {
      type: String,
      default: 'ReiDosBlocos',
      trim: true,
    },
    handle: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      index: true,
      trim: true,
    },
    avatarUrl: {
      type: String,
      default: '',
    },
    coins: {
      type: Number,
      default: 0,
      min: 0,
    },
    equippedSkin: {
      type: String,
      default: 'WIZARD',
    },
    unlockedSkins: {
      type: [String],
      default: () => [...DEFAULT_UNLOCKED_SKINS],
    },
    equippedBlockSkin: {
      type: String,
      default: 'PLASTIC',
    },
    unlockedBlockSkins: {
      type: [String],
      default: () => [...DEFAULT_UNLOCKED_BLOCK_SKINS],
    },
    shopMigratedV1: {
      type: Boolean,
      default: true,
    },
    friends: {
      type: [FriendEntrySchema],
      default: () => [],
    },
    friendRequestsSent: {
      type: [FriendRequestEntrySchema],
      default: () => [],
    },
    friendRequestsReceived: {
      type: [FriendRequestEntrySchema],
      default: () => [],
    },
    stats: {
      type: UserStatsSchema,
      default: () => ({
        matchesPlayed: 0,
        wins: 0,
        survivalBestPieces: 0,
      }),
    },
    createdAt: {
      type: Date,
      default: () => new Date(),
    },
    lastLoginAt: {
      type: Date,
      default: () => new Date(),
    },
  },
  {
    collection: 'users',
  }
)

export const UserModel: Model<IUserDocument> =
  (mongoose.models.User as Model<IUserDocument>) ||
  mongoose.model<IUserDocument>('User', UserSchema)



