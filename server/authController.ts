import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { connectMongoDB, ensureEnvLoaded } from './db.js'
import {
  DEFAULT_INITIAL_FRIENDS,
  DEFAULT_UNLOCKED_BLOCK_SKINS,
  DEFAULT_UNLOCKED_SKINS,
  IFriendEntry,
  IFriendRequestEntry,
  IUser,
  UserModel,
} from './models/User.js'
import {
  BLOCK_SKINS_SHOP_CATALOG,
  normalizeBlockSkinCode,
  normalizePlayerSkinCode,
  PLAYER_SKINS_SHOP_CATALOG,
  type ShopSkinCatalogItem,
} from './models/ShopOrder.js'
import { handleShopApiRequest } from './shopController.js'

export { connectMongoDB }

export interface GoogleProfilePayload {
  googleId: string
  email: string
  displayName: string
  avatarUrl: string
}

function deriveDefaultHandle(email: string, googleId: string): string {
  const localPart = (email.split('@')[0] || 'lucas')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')
    .slice(0, 10) || 'lucas'
  let hash = 0
  for (let i = 0; i < googleId.length; i++) {
    hash = (hash * 31 + googleId.charCodeAt(i)) >>> 0
  }
  const num = String((hash % 900) + 100).padStart(3, '0')
  return `@${localPart}_${num}`
}

function deriveDefaultCustomNick(displayName: string): string {
  const cleaned = (displayName || '').trim()
  if (
    !cleaned ||
    cleaned === 'Construtor Toy Tower' ||
    cleaned === 'Jogador Toy Tower'
  ) {
    return 'ReiDosBlocos'
  }
  return cleaned.replace(/\s+/g, '').slice(0, 16) || 'ReiDosBlocos'
}

const SESSION_COOKIE_NAME = 'toy_tower_session'
const LOCAL_DB_FILE = process.env.VERCEL
  ? path.join(os.tmpdir(), 'toy-tower-users.json')
  : path.resolve(process.cwd(), 'server', '.data', 'users.json')

export function getConfiguredGoogleClientId(): string {
  ensureEnvLoaded()
  return (
    process.env.GOOGLE_CLIENT_ID ||
    process.env.VITE_GOOGLE_CLIENT_ID ||
    ''
  ).trim()
}

function readLocalUsers(): IUser[] {
  try {
    if (!fs.existsSync(LOCAL_DB_FILE)) return []
    const raw = fs.readFileSync(LOCAL_DB_FILE, 'utf-8')
    const parsed = JSON.parse(raw) as IUser[]
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function writeLocalUsers(users: IUser[]): void {
  try {
    const dir = path.dirname(LOCAL_DB_FILE)
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true })
    }
    fs.writeFileSync(LOCAL_DB_FILE, JSON.stringify(users, null, 2), 'utf-8')
  } catch (err) {
    console.error('[ToyTower Auth] Failed to write local user store:', err)
  }
}

/**
 * Upsert ("Find or Create") logic for a Google OAuth 2.0 user:
 * - Searches by `{ googleId }` or `{ email }`.
 * - If not found (1st login): creates a new `User` with default skins ('WIZARD' + 'PLASTIC'), 0 coins, and stats.
 * - If found: updates `lastLoginAt` (and `displayName` / `avatarUrl` if changed) and migrates legacy pre-shop skin unlocks if needed.
 */
export async function upsertGoogleUser(profile: GoogleProfilePayload): Promise<{
  user: IUser
  isNewUser: boolean
  dbMode: 'mongodb' | 'local-fallback'
}> {
  const dbMode = await connectMongoDB()
  const now = new Date()

  if (dbMode === 'mongodb') {
    let doc = await UserModel.findOne({
      $or: [
        { googleId: profile.googleId },
        { email: profile.email.toLowerCase() },
      ],
    })

    let isNewUser = false
    if (!doc) {
      isNewUser = true
      doc = await UserModel.create({
        googleId: profile.googleId,
        email: profile.email.toLowerCase(),
        displayName: profile.displayName,
        customNick: deriveDefaultCustomNick(profile.displayName),
        handle: deriveDefaultHandle(profile.email, profile.googleId).toLowerCase(),
        avatarUrl: profile.avatarUrl,
        coins: 0,
        equippedSkin: 'WIZARD',
        unlockedSkins: [...DEFAULT_UNLOCKED_SKINS],
        equippedBlockSkin: 'PLASTIC',
        unlockedBlockSkins: [...DEFAULT_UNLOCKED_BLOCK_SKINS],
        shopMigratedV1: true,
        friends: [],
        friendRequestsSent: [],
        friendRequestsReceived: [],
        stats: {
          matchesPlayed: 0,
          wins: 0,
          survivalBestPieces: 0,
        },
        createdAt: now,
        lastLoginAt: now,
      })
    } else {
      doc.googleId = profile.googleId
      doc.lastLoginAt = now
      if (profile.displayName) doc.displayName = profile.displayName
      if (!doc.customNick) {
        doc.customNick = deriveDefaultCustomNick(doc.displayName)
      }
      if (!doc.handle) {
        doc.handle = deriveDefaultHandle(doc.email, doc.googleId).toLowerCase()
      } else {
        doc.handle = doc.handle.toLowerCase()
      }
      if (profile.avatarUrl) doc.avatarUrl = profile.avatarUrl
      if (typeof doc.coins !== 'number' || Number.isNaN(doc.coins)) {
        doc.coins = 0
      }

      // Migrate pre-shop accounts so only the default Mage ('WIZARD') + Plastic ('PLASTIC') are unlocked initially
      if (!doc.shopMigratedV1) {
        doc.unlockedSkins = [...DEFAULT_UNLOCKED_SKINS]
        doc.equippedSkin = 'WIZARD'
        doc.unlockedBlockSkins = [...DEFAULT_UNLOCKED_BLOCK_SKINS]
        doc.equippedBlockSkin = 'PLASTIC'
        doc.shopMigratedV1 = true
      } else {
        if (!doc.unlockedSkins || doc.unlockedSkins.length === 0) {
          doc.unlockedSkins = [...DEFAULT_UNLOCKED_SKINS]
        } else if (!doc.unlockedSkins.includes('WIZARD')) {
          doc.unlockedSkins = ['WIZARD', ...doc.unlockedSkins]
        }
        if (
          !doc.unlockedBlockSkins ||
          doc.unlockedBlockSkins.length === 0
        ) {
          doc.unlockedBlockSkins = [...DEFAULT_UNLOCKED_BLOCK_SKINS]
        } else if (!doc.unlockedBlockSkins.includes('PLASTIC')) {
          doc.unlockedBlockSkins = ['PLASTIC', ...doc.unlockedBlockSkins]
        }
        if (!doc.unlockedSkins.includes(doc.equippedSkin || 'WIZARD')) {
          doc.equippedSkin = 'WIZARD'
        }
        if (
          !doc.unlockedBlockSkins.includes(
            doc.equippedBlockSkin || 'PLASTIC'
          )
        ) {
          doc.equippedBlockSkin = 'PLASTIC'
        }
      }

      if (!Array.isArray(doc.friends)) {
        doc.friends = []
      }
      if (!Array.isArray(doc.friendRequestsSent)) {
        doc.friendRequestsSent = []
      }
      if (!Array.isArray(doc.friendRequestsReceived)) {
        doc.friendRequestsReceived = []
      }
      await doc.save()
    }

    return {
      user: sanitizeUser(doc.toObject()),
      isNewUser,
      dbMode: 'mongodb',
    }
  }

  // Local JSON store fallback (identical IUser schema & Find-or-Create behavior)
  const users = readLocalUsers()
  const existingIdx = users.findIndex(
    (u) =>
      u.googleId === profile.googleId ||
      u.email.toLowerCase() === profile.email.toLowerCase()
  )

  let isNewUser = false
  let record: IUser

  if (existingIdx === -1) {
    isNewUser = true
    record = {
      googleId: profile.googleId,
      email: profile.email.toLowerCase(),
      displayName: profile.displayName,
      customNick: deriveDefaultCustomNick(profile.displayName),
      handle: deriveDefaultHandle(profile.email, profile.googleId).toLowerCase(),
      avatarUrl: profile.avatarUrl,
      coins: 0,
      equippedSkin: 'WIZARD',
      unlockedSkins: [...DEFAULT_UNLOCKED_SKINS],
      equippedBlockSkin: 'PLASTIC',
      unlockedBlockSkins: [...DEFAULT_UNLOCKED_BLOCK_SKINS],
      shopMigratedV1: true,
      friends: [],
      friendRequestsSent: [],
      friendRequestsReceived: [],
      stats: {
        matchesPlayed: 0,
        wins: 0,
        survivalBestPieces: 0,
      },
      createdAt: now,
      lastLoginAt: now,
    }
    users.push(record)
  } else {
    const current = users[existingIdx]
    const migrated = Boolean(current.shopMigratedV1)
    const nextUnlockedSkins = migrated
      ? Array.from(
          new Set(['WIZARD', ...(current.unlockedSkins || DEFAULT_UNLOCKED_SKINS)])
        )
      : [...DEFAULT_UNLOCKED_SKINS]
    const nextUnlockedBlockSkins = migrated
      ? Array.from(
          new Set([
            'PLASTIC',
            ...(current.unlockedBlockSkins || DEFAULT_UNLOCKED_BLOCK_SKINS),
          ])
        )
      : [...DEFAULT_UNLOCKED_BLOCK_SKINS]
    const nextEquippedSkin =
      migrated && nextUnlockedSkins.includes(current.equippedSkin || 'WIZARD')
        ? current.equippedSkin
        : 'WIZARD'
    const nextEquippedBlockSkin =
      migrated &&
      nextUnlockedBlockSkins.includes(current.equippedBlockSkin || 'PLASTIC')
        ? current.equippedBlockSkin
        : 'PLASTIC'

    record = {
      ...current,
      googleId: profile.googleId,
      displayName: profile.displayName || current.displayName,
      customNick:
        current.customNick ||
        deriveDefaultCustomNick(profile.displayName || current.displayName),
      handle: (
        current.handle ||
        deriveDefaultHandle(current.email, profile.googleId)
      ).toLowerCase(),
      avatarUrl: profile.avatarUrl || current.avatarUrl,
      coins: Math.max(0, Math.floor(Number(current.coins ?? 0))),
      equippedSkin: nextEquippedSkin,
      unlockedSkins: nextUnlockedSkins,
      equippedBlockSkin: nextEquippedBlockSkin,
      unlockedBlockSkins: nextUnlockedBlockSkins,
      shopMigratedV1: true,
      friends: Array.isArray(current.friends) ? current.friends : [],
      friendRequestsSent: Array.isArray(current.friendRequestsSent)
        ? current.friendRequestsSent
        : [],
      friendRequestsReceived: Array.isArray(current.friendRequestsReceived)
        ? current.friendRequestsReceived
        : [],
      lastLoginAt: now,
    }
    users[existingIdx] = record
  }

  writeLocalUsers(users)
  return {
    user: sanitizeUser(record),
    isNewUser,
    dbMode: 'local-fallback',
  }
}

export async function findUserByGoogleId(googleId: string): Promise<{
  user: IUser | null
  dbMode: 'mongodb' | 'local-fallback'
}> {
  const dbMode = await connectMongoDB()
  if (dbMode === 'mongodb') {
    const doc = await UserModel.findOne({ googleId })
    if (doc && !doc.shopMigratedV1) {
      doc.unlockedSkins = [...DEFAULT_UNLOCKED_SKINS]
      doc.equippedSkin = 'WIZARD'
      doc.unlockedBlockSkins = [...DEFAULT_UNLOCKED_BLOCK_SKINS]
      doc.equippedBlockSkin = 'PLASTIC'
      doc.shopMigratedV1 = true
      await doc.save()
    }
    return {
      user: doc ? sanitizeUser(doc.toObject()) : null,
      dbMode: 'mongodb',
    }
  }

  const users = readLocalUsers()
  const idx = users.findIndex((u) => u.googleId === googleId)
  if (idx !== -1 && !users[idx].shopMigratedV1) {
    users[idx].unlockedSkins = [...DEFAULT_UNLOCKED_SKINS]
    users[idx].equippedSkin = 'WIZARD'
    users[idx].unlockedBlockSkins = [...DEFAULT_UNLOCKED_BLOCK_SKINS]
    users[idx].equippedBlockSkin = 'PLASTIC'
    users[idx].shopMigratedV1 = true
    writeLocalUsers(users)
  }
  const found = idx !== -1 ? users[idx] : null
  return {
    user: found ? sanitizeUser(found) : null,
    dbMode: 'local-fallback',
  }
}

/**
 * Equipa a Skin do Personagem (`equippedSkin`) e/ou a Skin dos Blocos (`equippedBlockSkin`),
 * validando obrigatoriamente se a skin já foi comprada/liberada na conta Gmail do usuário!
 */
export async function updateUserEquippedSkin(
  googleId: string,
  equippedSkinInput?: string,
  equippedBlockSkinInput?: string
): Promise<IUser | null> {
  const dbMode = await connectMongoDB()
  if (dbMode === 'mongodb') {
    const doc = await UserModel.findOne({ googleId })
    if (!doc) return null

    const unlockedPlayer = new Set<string>([
      'WIZARD',
      ...(Array.isArray(doc.unlockedSkins) ? doc.unlockedSkins : []),
    ])
    const unlockedBlock = new Set<string>([
      'PLASTIC',
      ...(Array.isArray(doc.unlockedBlockSkins) ? doc.unlockedBlockSkins : []),
    ])

    let nextPlayerSkin = doc.equippedSkin || 'WIZARD'
    if (equippedSkinInput && equippedSkinInput.trim()) {
      const normalized = normalizePlayerSkinCode(equippedSkinInput)
      if (!unlockedPlayer.has(normalized)) {
        throw new Error(
          'Esta skin de personagem está bloqueada! Compre-a com moedas na Loja para liberar na sua conta.'
        )
      }
      nextPlayerSkin = normalized
    }

    let nextBlockSkin = doc.equippedBlockSkin || 'PLASTIC'
    if (equippedBlockSkinInput && equippedBlockSkinInput.trim()) {
      const normalizedBlock = normalizeBlockSkinCode(equippedBlockSkinInput)
      if (!unlockedBlock.has(normalizedBlock)) {
        throw new Error(
          'Esta skin de blocos está bloqueada! Compre-a com moedas na Loja para liberar na sua conta.'
        )
      }
      nextBlockSkin = normalizedBlock
    }

    doc.equippedSkin = nextPlayerSkin
    doc.equippedBlockSkin = nextBlockSkin
    await doc.save()

    if (doc.handle) {
      await UserModel.updateMany(
        { 'friends.handle': doc.handle.toLowerCase() },
        {
          $set: {
            'friends.$.equippedSkin': nextPlayerSkin,
            'friends.$.equippedBlockSkin': nextBlockSkin,
          },
        }
      )
    }
    return sanitizeUser(doc.toObject())
  }

  const users = readLocalUsers()
  const idx = users.findIndex((u) => u.googleId === googleId)
  if (idx === -1) return null

  const me = users[idx]
  const unlockedPlayer = new Set<string>([
    'WIZARD',
    ...(Array.isArray(me.unlockedSkins) ? me.unlockedSkins : []),
  ])
  const unlockedBlock = new Set<string>([
    'PLASTIC',
    ...(Array.isArray(me.unlockedBlockSkins) ? me.unlockedBlockSkins : []),
  ])

  let nextPlayerSkin = me.equippedSkin || 'WIZARD'
  if (equippedSkinInput && equippedSkinInput.trim()) {
    const normalized = normalizePlayerSkinCode(equippedSkinInput)
    if (!unlockedPlayer.has(normalized)) {
      throw new Error(
        'Esta skin de personagem está bloqueada! Compre-a com moedas na Loja para liberar na sua conta.'
      )
    }
    nextPlayerSkin = normalized
  }

  let nextBlockSkin = me.equippedBlockSkin || 'PLASTIC'
  if (equippedBlockSkinInput && equippedBlockSkinInput.trim()) {
    const normalizedBlock = normalizeBlockSkinCode(equippedBlockSkinInput)
    if (!unlockedBlock.has(normalizedBlock)) {
      throw new Error(
        'Esta skin de blocos está bloqueada! Compre-a com moedas na Loja para liberar na sua conta.'
      )
    }
    nextBlockSkin = normalizedBlock
  }

  me.equippedSkin = nextPlayerSkin
  me.equippedBlockSkin = nextBlockSkin

  const myHandle = (me.handle || '').toLowerCase()
  for (const u of users) {
    if (Array.isArray(u.friends)) {
      for (const f of u.friends) {
        if (f.handle.toLowerCase() === myHandle) {
          f.equippedSkin = nextPlayerSkin
          f.equippedBlockSkin = nextBlockSkin
        }
      }
    }
  }
  writeLocalUsers(users)
  return sanitizeUser(me)
}

/**
 * Credita moedas diretamente na conta Gmail (`googleId` / `email`) do usuário após pagamento aprovado no Mercado Pago.
 */
export async function creditUserCoins(
  googleId: string,
  email: string,
  coinsDelta: number
): Promise<IUser | null> {
  const safeDelta = Math.max(0, Math.floor(Number(coinsDelta) || 0))
  if (safeDelta <= 0) {
    const { user } = await findUserByGoogleId(googleId)
    return user
  }

  const dbMode = await connectMongoDB()
  if (dbMode === 'mongodb') {
    const doc = await UserModel.findOneAndUpdate(
      {
        $or: [
          { googleId },
          ...(email ? [{ email: email.toLowerCase() }] : []),
        ],
      },
      { $inc: { coins: safeDelta } },
      { new: true }
    )
    return doc ? sanitizeUser(doc.toObject()) : null
  }

  const users = readLocalUsers()
  const idx = users.findIndex(
    (u) =>
      u.googleId === googleId ||
      (email && u.email.toLowerCase() === email.toLowerCase())
  )
  if (idx === -1) return null
  users[idx].coins = Math.max(0, Math.floor(Number(users[idx].coins ?? 0))) + safeDelta
  writeLocalUsers(users)
  return sanitizeUser(users[idx])
}

/**
 * Compra uma Skin (de Personagem ou de Blocos) utilizando as moedas vinculadas à conta Gmail do usuário.
 * A skin passa a ficar permanentemente liberada para aquela conta (`unlockedSkins` / `unlockedBlockSkins`).
 */
export async function purchaseSkinWithCoins(
  googleId: string,
  params: {
    category: 'PLAYER' | 'BLOCK'
    skinCode: string
    autoEquip?: boolean
  }
): Promise<{
  user: IUser
  purchasedSkin: ShopSkinCatalogItem
}> {
  const category = params.category === 'BLOCK' ? 'BLOCK' : 'PLAYER'
  const autoEquip = params.autoEquip !== false

  const catalog =
    category === 'BLOCK' ? BLOCK_SKINS_SHOP_CATALOG : PLAYER_SKINS_SHOP_CATALOG
  const normalizedCode =
    category === 'BLOCK'
      ? normalizeBlockSkinCode(params.skinCode)
      : normalizePlayerSkinCode(params.skinCode)

  const skinItem = catalog.find(
    (item) =>
      item.code.toUpperCase() === normalizedCode.toUpperCase() ||
      item.spriteId.toLowerCase() === params.skinCode.trim().toLowerCase()
  )
  if (!skinItem) {
    throw new Error('Skin não encontrada no catálogo da Loja.')
  }

  const dbMode = await connectMongoDB()
  if (dbMode === 'mongodb') {
    const doc = await UserModel.findOne({ googleId })
    if (!doc) {
      throw new Error('Conta de usuário não encontrada.')
    }

    const currentCoins = Math.max(0, Math.floor(Number(doc.coins ?? 0)))
    const unlockedList =
      category === 'BLOCK'
        ? Array.from(
            new Set([
              'PLASTIC',
              ...(Array.isArray(doc.unlockedBlockSkins)
                ? doc.unlockedBlockSkins
                : []),
            ])
          )
        : Array.from(
            new Set([
              'WIZARD',
              ...(Array.isArray(doc.unlockedSkins) ? doc.unlockedSkins : []),
            ])
          )

    if (unlockedList.includes(skinItem.code)) {
      throw new Error('Você já possui esta skin liberada na sua conta!')
    }

    if (currentCoins < skinItem.priceCoins) {
      throw new Error(
        `Moedas insuficientes! Você possui ${currentCoins} moedas e "${skinItem.name}" custa ${skinItem.priceCoins} moedas.`
      )
    }

    doc.coins = currentCoins - skinItem.priceCoins
    if (category === 'BLOCK') {
      doc.unlockedBlockSkins = [...unlockedList, skinItem.code]
      if (autoEquip) {
        doc.equippedBlockSkin = skinItem.code
      }
    } else {
      doc.unlockedSkins = [...unlockedList, skinItem.code]
      if (autoEquip) {
        doc.equippedSkin = skinItem.code
      }
    }
    doc.shopMigratedV1 = true
    await doc.save()

    if (autoEquip && doc.handle) {
      await UserModel.updateMany(
        { 'friends.handle': doc.handle.toLowerCase() },
        {
          $set: {
            'friends.$.equippedSkin': doc.equippedSkin || 'WIZARD',
            'friends.$.equippedBlockSkin': doc.equippedBlockSkin || 'PLASTIC',
          },
        }
      )
    }

    return {
      user: sanitizeUser(doc.toObject()),
      purchasedSkin: skinItem,
    }
  }

  const users = readLocalUsers()
  const idx = users.findIndex((u) => u.googleId === googleId)
  if (idx === -1) {
    throw new Error('Conta de usuário não encontrada.')
  }

  const me = users[idx]
  const currentCoins = Math.max(0, Math.floor(Number(me.coins ?? 0)))
  const unlockedList =
    category === 'BLOCK'
      ? Array.from(
          new Set([
            'PLASTIC',
            ...(Array.isArray(me.unlockedBlockSkins)
              ? me.unlockedBlockSkins
              : []),
          ])
        )
      : Array.from(
          new Set([
            'WIZARD',
            ...(Array.isArray(me.unlockedSkins) ? me.unlockedSkins : []),
          ])
        )

  if (unlockedList.includes(skinItem.code)) {
    throw new Error('Você já possui esta skin liberada na sua conta!')
  }

  if (currentCoins < skinItem.priceCoins) {
    throw new Error(
      `Moedas insuficientes! Você possui ${currentCoins} moedas e "${skinItem.name}" custa ${skinItem.priceCoins} moedas.`
    )
  }

  me.coins = currentCoins - skinItem.priceCoins
  if (category === 'BLOCK') {
    me.unlockedBlockSkins = [...unlockedList, skinItem.code]
    if (autoEquip) {
      me.equippedBlockSkin = skinItem.code
    }
  } else {
    me.unlockedSkins = [...unlockedList, skinItem.code]
    if (autoEquip) {
      me.equippedSkin = skinItem.code
    }
  }
  me.shopMigratedV1 = true

  if (autoEquip) {
    const myHandle = (me.handle || '').toLowerCase()
    for (const u of users) {
      if (Array.isArray(u.friends)) {
        for (const f of u.friends) {
          if (f.handle.toLowerCase() === myHandle) {
            f.equippedSkin = me.equippedSkin || 'WIZARD'
            f.equippedBlockSkin = me.equippedBlockSkin || 'PLASTIC'
          }
        }
      }
    }
  }

  writeLocalUsers(users)
  return {
    user: sanitizeUser(me),
    purchasedSkin: skinItem,
  }
}

/**
 * Updates the player's customizable nickname (`customNick`, 2 to 16 chars)
 * while keeping `email` and `handle` (`@nome_000`) strictly immutable.
 */
export async function updateUserCustomNick(
  googleId: string,
  rawNick: string
): Promise<IUser | null> {
  const cleaned = rawNick.trim().replace(/\s+/g, ' ')
  if (cleaned.length < 2 || cleaned.length > 16) {
    throw new Error('O Nick deve ter entre 2 e 16 caracteres.')
  }

  const dbMode = await connectMongoDB()
  if (dbMode === 'mongodb') {
    const doc = await UserModel.findOneAndUpdate(
      { googleId },
      { $set: { customNick: cleaned } },
      { returnDocument: 'after' }
    )
    if (doc && doc.handle) {
      await UserModel.updateMany(
        { 'friends.handle': doc.handle.toLowerCase() },
        { $set: { 'friends.$.customNick': cleaned } }
      )
    }
    return doc ? sanitizeUser(doc.toObject()) : null
  }

  const users = readLocalUsers()
  const idx = users.findIndex((u) => u.googleId === googleId)
  if (idx === -1) return null
  users[idx].customNick = cleaned
  const myHandle = (users[idx].handle || '').toLowerCase()
  for (const u of users) {
    if (Array.isArray(u.friends)) {
      for (const f of u.friends) {
        if (f.handle.toLowerCase() === myHandle) {
          f.customNick = cleaned
        }
      }
    }
  }
  writeLocalUsers(users)
  return sanitizeUser(users[idx])
}

/**
 * PARTE 1: Busca por `email` ou `handle` (`@nome_000`, case-insensitive) no MongoDB/local DB
 * e envia um Pedido de Amizade (`friendRequestsSent` no remetente e `friendRequestsReceived` no destinatário).
 * - Se não existir: retorna erro `"Jogador não encontrado"`.
 * - Se for o próprio usuário ou já forem amigos: retorna aviso correspondente.
 */
export async function sendFriendRequest(
  senderGoogleId: string,
  rawQuery: string
): Promise<{
  senderUser: IUser
  targetUser: IUser
  senderProfile: IFriendRequestEntry
  targetProfile: IFriendRequestEntry
  autoAccepted: boolean
}> {
  const query = rawQuery.trim().toLowerCase()
  if (!query) {
    throw new Error('Informe um @nome_000 ou email válido.')
  }

  const candidateHandle = query.startsWith('@') ? query : `@${query}`
  const escapedHandle = candidateHandle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const escapedEmail = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

  const dbMode = await connectMongoDB()

  if (dbMode === 'mongodb') {
    const me = await UserModel.findOne({ googleId: senderGoogleId })
    if (!me) throw new Error('Sua conta não foi encontrada.')

    const target = await UserModel.findOne({
      $or: [
        { handle: new RegExp(`^${escapedHandle}$`, 'i') },
        { email: new RegExp(`^${escapedEmail}$`, 'i') },
      ],
    })

    if (!target) {
      throw new Error('Jogador não encontrado')
    }

    const myHandle = (
      me.handle || deriveDefaultHandle(me.email, me.googleId)
    ).toLowerCase()
    const targetHandle = (
      target.handle || deriveDefaultHandle(target.email, target.googleId)
    ).toLowerCase()

    if (target.googleId === me.googleId || targetHandle === myHandle) {
      throw new Error('Você não pode enviar pedido de amizade para si mesmo.')
    }

    const meFriends = Array.isArray(me.friends) ? me.friends : []
    if (meFriends.some((f) => f.handle.toLowerCase() === targetHandle)) {
      throw new Error('Vocês já são amigos!')
    }

    const meSent = Array.isArray(me.friendRequestsSent)
      ? me.friendRequestsSent
      : []

    const senderProfile: IFriendRequestEntry = {
      handle: myHandle,
      customNick: me.customNick || deriveDefaultCustomNick(me.displayName),
      email: me.email,
      equippedSkin: me.equippedSkin || 'WIZARD',
      equippedBlockSkin: me.equippedBlockSkin || 'PLASTIC',
      avatarUrl: me.avatarUrl || '',
      createdAt: new Date(),
    }

    const targetProfile: IFriendRequestEntry = {
      handle: targetHandle,
      customNick:
        target.customNick || deriveDefaultCustomNick(target.displayName),
      email: target.email,
      equippedSkin: target.equippedSkin || 'WIZARD',
      equippedBlockSkin: target.equippedBlockSkin || 'PLASTIC',
      avatarUrl: target.avatarUrl || '',
      createdAt: new Date(),
    }

    // Check if the target had already sent a friend request to me -> auto-accept!
    const meReceived = Array.isArray(me.friendRequestsReceived)
      ? me.friendRequestsReceived
      : []
    const hadReverseRequest = meReceived.some(
      (r) => r.handle.toLowerCase() === targetHandle
    )

    if (hadReverseRequest) {
      me.friendRequestsReceived = meReceived.filter(
        (r) => r.handle.toLowerCase() !== targetHandle
      )
      target.friendRequestsSent = (target.friendRequestsSent || []).filter(
        (r) => r.handle.toLowerCase() !== myHandle
      )
      me.friends = [
        {
          handle: targetProfile.handle,
          customNick: targetProfile.customNick,
          email: targetProfile.email,
          equippedSkin: targetProfile.equippedSkin,
          equippedBlockSkin: targetProfile.equippedBlockSkin || 'PLASTIC',
          avatarUrl: targetProfile.avatarUrl,
        },
        ...meFriends,
      ]
      target.friends = [
        {
          handle: senderProfile.handle,
          customNick: senderProfile.customNick,
          email: senderProfile.email,
          equippedSkin: senderProfile.equippedSkin,
          equippedBlockSkin: senderProfile.equippedBlockSkin || 'PLASTIC',
          avatarUrl: senderProfile.avatarUrl,
        },
        ...(target.friends || []).filter(
          (f) => f.handle.toLowerCase() !== myHandle
        ),
      ]
      await me.save()
      await target.save()
      return {
        senderUser: sanitizeUser(me.toObject()),
        targetUser: sanitizeUser(target.toObject()),
        senderProfile,
        targetProfile,
        autoAccepted: true,
      }
    }

    me.friendRequestsSent = [
      targetProfile,
      ...meSent.filter((r) => r.handle.toLowerCase() !== targetHandle),
    ]
    me.friends = [
      {
        handle: targetProfile.handle,
        customNick: targetProfile.customNick,
        email: targetProfile.email,
        equippedSkin: targetProfile.equippedSkin,
        equippedBlockSkin: targetProfile.equippedBlockSkin || 'PLASTIC',
        avatarUrl: targetProfile.avatarUrl,
      },
      ...meFriends.filter((f) => f.handle.toLowerCase() !== targetHandle),
    ]
    const targetReceived = Array.isArray(target.friendRequestsReceived)
      ? target.friendRequestsReceived.filter(
          (r) => r.handle.toLowerCase() !== myHandle
        )
      : []
    target.friendRequestsReceived = [senderProfile, ...targetReceived]

    await me.save()
    await target.save()

    return {
      senderUser: sanitizeUser(me.toObject()),
      targetUser: sanitizeUser(target.toObject()),
      senderProfile,
      targetProfile,
      autoAccepted: false,
    }
  }

  // Local DB fallback
  const users = readLocalUsers()
  const meIdx = users.findIndex((u) => u.googleId === senderGoogleId)
  if (meIdx === -1) throw new Error('Sua conta não foi encontrada.')

  const targetIdx = users.findIndex((u) => {
    const uHandle = (
      u.handle || deriveDefaultHandle(u.email, u.googleId)
    ).toLowerCase()
    const uEmail = (u.email || '').toLowerCase()
    return uHandle === candidateHandle || uEmail === query
  })

  if (targetIdx === -1) {
    throw new Error('Jogador não encontrado')
  }

  if (targetIdx === meIdx) {
    throw new Error('Você não pode enviar pedido de amizade para si mesmo.')
  }

  const me = users[meIdx]
  const target = users[targetIdx]

  const myHandle = (
    me.handle || deriveDefaultHandle(me.email, me.googleId)
  ).toLowerCase()
  const targetHandle = (
    target.handle || deriveDefaultHandle(target.email, target.googleId)
  ).toLowerCase()

  const meFriends = Array.isArray(me.friends)
    ? me.friends.filter(
        (f) =>
          !LEGACY_MOCK_FRIEND_EMAILS.has(String(f.email || '').toLowerCase())
      )
    : []
  if (meFriends.some((f) => f.handle.toLowerCase() === targetHandle)) {
    throw new Error('Vocês já são amigos!')
  }

  const meSent = Array.isArray(me.friendRequestsSent)
    ? me.friendRequestsSent
    : []

  const senderProfile: IFriendRequestEntry = {
    handle: myHandle,
    customNick: me.customNick || deriveDefaultCustomNick(me.displayName),
    email: me.email,
    equippedSkin: me.equippedSkin || 'WIZARD',
    equippedBlockSkin: me.equippedBlockSkin || 'PLASTIC',
    avatarUrl: me.avatarUrl || '',
    createdAt: new Date(),
  }

  const targetProfile: IFriendRequestEntry = {
    handle: targetHandle,
    customNick:
      target.customNick || deriveDefaultCustomNick(target.displayName),
    email: target.email,
    equippedSkin: target.equippedSkin || 'WIZARD',
    equippedBlockSkin: target.equippedBlockSkin || 'PLASTIC',
    avatarUrl: target.avatarUrl || '',
    createdAt: new Date(),
  }

  const meReceived = Array.isArray(me.friendRequestsReceived)
    ? me.friendRequestsReceived
    : []
  const hadReverseRequest = meReceived.some(
    (r) => r.handle.toLowerCase() === targetHandle
  )

  if (hadReverseRequest) {
    me.friendRequestsReceived = meReceived.filter(
      (r) => r.handle.toLowerCase() !== targetHandle
    )
    target.friendRequestsSent = (target.friendRequestsSent || []).filter(
      (r) => r.handle.toLowerCase() !== myHandle
    )
    me.friends = [
      {
        handle: targetProfile.handle,
        customNick: targetProfile.customNick,
        email: targetProfile.email,
        equippedSkin: targetProfile.equippedSkin,
        equippedBlockSkin: targetProfile.equippedBlockSkin || 'PLASTIC',
        avatarUrl: targetProfile.avatarUrl,
      },
      ...meFriends,
    ]
    const targetFriends = Array.isArray(target.friends)
      ? target.friends.filter(
          (f) =>
            f.handle.toLowerCase() !== myHandle &&
            !LEGACY_MOCK_FRIEND_EMAILS.has(String(f.email || '').toLowerCase())
        )
      : []
    target.friends = [
      {
        handle: senderProfile.handle,
        customNick: senderProfile.customNick,
        email: senderProfile.email,
        equippedSkin: senderProfile.equippedSkin,
        equippedBlockSkin: senderProfile.equippedBlockSkin || 'PLASTIC',
        avatarUrl: senderProfile.avatarUrl,
      },
      ...targetFriends,
    ]
    writeLocalUsers(users)
    return {
      senderUser: sanitizeUser(me),
      targetUser: sanitizeUser(target),
      senderProfile,
      targetProfile,
      autoAccepted: true,
    }
  }

  me.friendRequestsSent = [
    targetProfile,
    ...meSent.filter((r) => r.handle.toLowerCase() !== targetHandle),
  ]
  me.friends = [
    {
      handle: targetProfile.handle,
      customNick: targetProfile.customNick,
      email: targetProfile.email,
      equippedSkin: targetProfile.equippedSkin,
      equippedBlockSkin: targetProfile.equippedBlockSkin || 'PLASTIC',
      avatarUrl: targetProfile.avatarUrl,
    },
    ...meFriends.filter((f) => f.handle.toLowerCase() !== targetHandle),
  ]
  target.friendRequestsReceived = [
    senderProfile,
    ...(target.friendRequestsReceived || []).filter(
      (r) => r.handle.toLowerCase() !== myHandle
    ),
  ]

  writeLocalUsers(users)
  return {
    senderUser: sanitizeUser(me),
    targetUser: sanitizeUser(target),
    senderProfile,
    targetProfile,
    autoAccepted: false,
  }
}

/**
 * PARTE 1.3: Aceita ou recusa um pedido de amizade recebido (`friendRequestsReceived`).
 * Ao aceitar, ambos os jogadores são adicionados ao array `friends` um do outro no MongoDB.
 */
export async function respondToFriendRequest(
  recipientGoogleId: string,
  rawSenderHandle: string,
  accept: boolean
): Promise<{
  recipientUser: IUser
  senderUser: IUser | null
  accepted: boolean
}> {
  const senderHandle = rawSenderHandle.trim().toLowerCase()
  if (!senderHandle) {
    throw new Error('Identificador (@handle) do remetente inválido.')
  }

  const dbMode = await connectMongoDB()
  if (dbMode === 'mongodb') {
    const me = await UserModel.findOne({ googleId: recipientGoogleId })
    if (!me) throw new Error('Usuário não encontrado.')

    const myHandle = (
      me.handle || deriveDefaultHandle(me.email, me.googleId)
    ).toLowerCase()
    const sender = await UserModel.findOne({
      handle: new RegExp(
        `^${senderHandle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`,
        'i'
      ),
    })

    me.friendRequestsReceived = (me.friendRequestsReceived || []).filter(
      (r) => r.handle.toLowerCase() !== senderHandle
    )

    if (sender) {
      sender.friendRequestsSent = (sender.friendRequestsSent || []).filter(
        (r) => r.handle.toLowerCase() !== myHandle
      )
    }

    if (accept && sender) {
      const meFriends = (me.friends || []).filter(
        (f) => f.handle.toLowerCase() !== senderHandle
      )
      me.friends = [
        {
          handle: senderHandle,
          customNick:
            sender.customNick || deriveDefaultCustomNick(sender.displayName),
          email: sender.email,
          equippedSkin: sender.equippedSkin || 'WIZARD',
          equippedBlockSkin: sender.equippedBlockSkin || 'PLASTIC',
          avatarUrl: sender.avatarUrl || '',
        },
        ...meFriends,
      ]

      const senderFriends = (sender.friends || []).filter(
        (f) => f.handle.toLowerCase() !== myHandle
      )
      sender.friends = [
        {
          handle: myHandle,
          customNick: me.customNick || deriveDefaultCustomNick(me.displayName),
          email: me.email,
          equippedSkin: me.equippedSkin || 'WIZARD',
          equippedBlockSkin: me.equippedBlockSkin || 'PLASTIC',
          avatarUrl: me.avatarUrl || '',
        },
        ...senderFriends,
      ]
    }

    await me.save()
    if (sender) await sender.save()

    return {
      recipientUser: sanitizeUser(me.toObject()),
      senderUser: sender ? sanitizeUser(sender.toObject()) : null,
      accepted: accept,
    }
  }

  const users = readLocalUsers()
  const meIdx = users.findIndex((u) => u.googleId === recipientGoogleId)
  if (meIdx === -1) throw new Error('Usuário não encontrado.')

  const me = users[meIdx]
  const myHandle = (
    me.handle || deriveDefaultHandle(me.email, me.googleId)
  ).toLowerCase()
  const senderIdx = users.findIndex(
    (u) =>
      (u.handle || deriveDefaultHandle(u.email, u.googleId)).toLowerCase() ===
      senderHandle
  )
  const sender = senderIdx !== -1 ? users[senderIdx] : null

  me.friendRequestsReceived = (me.friendRequestsReceived || []).filter(
    (r) => r.handle.toLowerCase() !== senderHandle
  )
  if (sender) {
    sender.friendRequestsSent = (sender.friendRequestsSent || []).filter(
      (r) => r.handle.toLowerCase() !== myHandle
    )
  }

  if (accept && sender) {
    const meFriends = (me.friends || []).filter(
      (f) =>
        f.handle.toLowerCase() !== senderHandle &&
        !LEGACY_MOCK_FRIEND_EMAILS.has(String(f.email || '').toLowerCase())
    )
    me.friends = [
      {
        handle: senderHandle,
        customNick:
          sender.customNick || deriveDefaultCustomNick(sender.displayName),
        email: sender.email,
        equippedSkin: sender.equippedSkin || 'WIZARD',
        equippedBlockSkin: sender.equippedBlockSkin || 'PLASTIC',
        avatarUrl: sender.avatarUrl || '',
      },
      ...meFriends,
    ]

    const senderFriends = (sender.friends || []).filter(
      (f) =>
        f.handle.toLowerCase() !== myHandle &&
        !LEGACY_MOCK_FRIEND_EMAILS.has(String(f.email || '').toLowerCase())
    )
    sender.friends = [
      {
        handle: myHandle,
        customNick: me.customNick || deriveDefaultCustomNick(me.displayName),
        email: me.email,
        equippedSkin: me.equippedSkin || 'WIZARD',
        equippedBlockSkin: me.equippedBlockSkin || 'PLASTIC',
        avatarUrl: me.avatarUrl || '',
      },
      ...senderFriends,
    ]
  }

  writeLocalUsers(users)
  return {
    recipientUser: sanitizeUser(me),
    senderUser: sender ? sanitizeUser(sender) : null,
    accepted: accept,
  }
}

/**
 * PARTE 3.5: Atualiza as estatísticas no MongoDB / local DB ao final de uma partida multiplayer.
 */
export async function recordMatchStats(
  winnerHandle: string,
  participantHandles: string[]
): Promise<void> {
  const normalizedWinner = winnerHandle.trim().toLowerCase()
  const normalizedAll = participantHandles.map((h) => h.trim().toLowerCase())

  const dbMode = await connectMongoDB()
  if (dbMode === 'mongodb') {
    await UserModel.updateMany(
      { handle: { $in: normalizedAll } },
      { $inc: { 'stats.matchesPlayed': 1 } }
    )
    if (normalizedWinner) {
      await UserModel.updateOne(
        { handle: normalizedWinner },
        { $inc: { 'stats.wins': 1 } }
      )
    }
    return
  }

  const users = readLocalUsers()
  let changed = false
  for (const u of users) {
    const h = (
      u.handle || deriveDefaultHandle(u.email, u.googleId)
    ).toLowerCase()
    if (normalizedAll.includes(h)) {
      u.stats = {
        matchesPlayed: Number(u.stats?.matchesPlayed ?? 0) + 1,
        wins:
          Number(u.stats?.wins ?? 0) + (h === normalizedWinner ? 1 : 0),
        survivalBestPieces: Number(u.stats?.survivalBestPieces ?? 0),
      }
      changed = true
    }
  }
  if (changed) {
    writeLocalUsers(users)
  }
}

/**
 * Atualiza o recorde pessoal (`stats.survivalBestPieces`) do jogador no MongoDB / local DB
 * quando o SCORE do Modo Infinito / Abismo ultrapassa o PERSONAL BEST anterior.
 */
export async function updateUserPersonalBest(
  googleId: string,
  bestScore: number
): Promise<IUser | null> {
  const safeScore = Math.max(0, Math.floor(Number(bestScore) || 0))
  const dbMode = await connectMongoDB()
  if (dbMode === 'mongodb') {
    const doc = await UserModel.findOneAndUpdate(
      { googleId },
      { $max: { 'stats.survivalBestPieces': safeScore } },
      { new: true }
    )
    return doc ? sanitizeUser(doc.toObject()) : null
  }

  const users = readLocalUsers()
  const idx = users.findIndex((u) => u.googleId === googleId)
  if (idx === -1) return null
  const currentBest = Number(users[idx].stats?.survivalBestPieces ?? 0)
  users[idx].stats = {
    matchesPlayed: Number(users[idx].stats?.matchesPlayed ?? 0),
    wins: Number(users[idx].stats?.wins ?? 0),
    survivalBestPieces: Math.max(currentBest, safeScore),
  }
  writeLocalUsers(users)
  return sanitizeUser(users[idx])
}

const LEGACY_MOCK_FRIEND_EMAILS = new Set([
  'capitao.brink@gmail.com',
  'robotico.toy@gmail.com',
  'mago.toy@gmail.com',
  'dino.rex@gmail.com',
])

function sanitizeUser(raw: IUser): IUser {
  const email = String(raw.email || '').toLowerCase()
  const googleId = String(raw.googleId || '')
  const displayName = String(raw.displayName || 'ReiDosBlocos')
  const rawFriends = Array.isArray(raw.friends)
    ? raw.friends.filter(
        (f) =>
          f &&
          f.handle &&
          !LEGACY_MOCK_FRIEND_EMAILS.has(String(f.email || '').toLowerCase())
      )
    : []
  const rawSent = Array.isArray(raw.friendRequestsSent)
    ? raw.friendRequestsSent.filter((r) => r && r.handle)
    : []
  const seenFriendHandles = new Set(
    rawFriends.map((f) => String(f.handle).toLowerCase())
  )
  const mergedFriends = [...rawFriends]
  for (const r of rawSent) {
    const h = String(r.handle).toLowerCase()
    if (!seenFriendHandles.has(h)) {
      seenFriendHandles.add(h)
      mergedFriends.push({
        handle: h,
        customNick: String(r.customNick || h),
        email: String(r.email || ''),
        equippedSkin: String(r.equippedSkin || 'WIZARD'),
        equippedBlockSkin: String(r.equippedBlockSkin || 'PLASTIC'),
        avatarUrl: String(r.avatarUrl || ''),
      })
    }
  }
  const rawReceived = Array.isArray(raw.friendRequestsReceived)
    ? raw.friendRequestsReceived.filter((r) => r && r.handle)
    : []

  const unlockedSkins = Array.from(
    new Set([
      'WIZARD',
      ...(Array.isArray(raw.unlockedSkins)
        ? raw.unlockedSkins.map((s) => normalizePlayerSkinCode(String(s)))
        : DEFAULT_UNLOCKED_SKINS),
    ])
  )
  const unlockedBlockSkins = Array.from(
    new Set([
      'PLASTIC',
      ...(Array.isArray(raw.unlockedBlockSkins)
        ? raw.unlockedBlockSkins.map((s) => normalizeBlockSkinCode(String(s)))
        : DEFAULT_UNLOCKED_BLOCK_SKINS),
    ])
  )
  const rawEquippedSkin = normalizePlayerSkinCode(
    String(raw.equippedSkin || 'WIZARD')
  )
  const equippedSkin = unlockedSkins.includes(rawEquippedSkin)
    ? rawEquippedSkin
    : 'WIZARD'

  const rawEquippedBlockSkin = normalizeBlockSkinCode(
    String(raw.equippedBlockSkin || 'PLASTIC')
  )
  const equippedBlockSkin = unlockedBlockSkins.includes(rawEquippedBlockSkin)
    ? rawEquippedBlockSkin
    : 'PLASTIC'

  return {
    googleId,
    email,
    displayName,
    customNick: String(
      raw.customNick || deriveDefaultCustomNick(displayName)
    ),
    handle: String(
      raw.handle || deriveDefaultHandle(email, googleId)
    ).toLowerCase(),
    avatarUrl: String(raw.avatarUrl || ''),
    coins: Math.max(0, Math.floor(Number(raw.coins ?? 0))),
    equippedSkin,
    unlockedSkins,
    equippedBlockSkin,
    unlockedBlockSkins,
    shopMigratedV1: true,
    friends: mergedFriends.map((f) => ({
      handle: String(f.handle).toLowerCase(),
      customNick: String(f.customNick),
      email: String(f.email || ''),
      equippedSkin: String(f.equippedSkin || 'WIZARD'),
      equippedBlockSkin: String(f.equippedBlockSkin || 'PLASTIC'),
      avatarUrl: String(f.avatarUrl || ''),
    })),
    friendRequestsSent: rawSent.map((r) => ({
      handle: String(r.handle).toLowerCase(),
      customNick: String(r.customNick),
      email: String(r.email || ''),
      equippedSkin: String(r.equippedSkin || 'WIZARD'),
      equippedBlockSkin: String(r.equippedBlockSkin || 'PLASTIC'),
      avatarUrl: String(r.avatarUrl || ''),
      createdAt: r.createdAt || new Date(),
    })),
    friendRequestsReceived: rawReceived.map((r) => ({
      handle: String(r.handle).toLowerCase(),
      customNick: String(r.customNick),
      email: String(r.email || ''),
      equippedSkin: String(r.equippedSkin || 'WIZARD'),
      equippedBlockSkin: String(r.equippedBlockSkin || 'PLASTIC'),
      avatarUrl: String(r.avatarUrl || ''),
      createdAt: r.createdAt || new Date(),
    })),
    stats: {
      matchesPlayed: Number(raw.stats?.matchesPlayed ?? 0),
      wins: Number(raw.stats?.wins ?? 0),
      survivalBestPieces: Number(raw.stats?.survivalBestPieces ?? 0),
    },
    createdAt: new Date(raw.createdAt || Date.now()),
    lastLoginAt: new Date(raw.lastLoginAt || Date.now()),
  }
}

/**
 * Verifies a Google OAuth 2.0 `id_token`, `access_token`, or authorization `code`
 * with Google's official endpoints (`oauth2.googleapis.com` / `googleapis.com/oauth2/v3/userinfo`).
 */
/**
 * Verifies a Google OAuth 2.0 `id_token`, `access_token`, or authorization `code`
 * directly with Google's official endpoints (`oauth2.googleapis.com` / `googleapis.com/oauth2/v3/userinfo`).
 */
export async function verifyGoogleCredential(body: {
  idToken?: string
  accessToken?: string
  code?: string
  redirectUri?: string
}): Promise<GoogleProfilePayload> {
  ensureEnvLoaded()
  const configuredClientId = getConfiguredGoogleClientId()

  // 1. Exchange OAuth 2.0 Authorization Code (official Google Identity Services code client or redirect flow)
  if (body.code) {
    const clientSecret = (process.env.GOOGLE_CLIENT_SECRET || '').trim()
    if (!configuredClientId || !clientSecret) {
      throw new Error(
        'GOOGLE_CLIENT_ID ou GOOGLE_CLIENT_SECRET não configurados no .env.'
      )
    }
    const redirectUri = body.redirectUri?.trim() || 'postmessage'
    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code: body.code,
        client_id: configuredClientId,
        client_secret: clientSecret,
        redirect_uri: redirectUri,
        grant_type: 'authorization_code',
      }).toString(),
    })
    if (!tokenRes.ok) {
      const errBody = await tokenRes.text().catch(() => '')
      throw new Error(
        `Falha ao validar código de autorização junto ao Google OAuth 2.0 (${tokenRes.status}): ${errBody}`
      )
    }
    const tokenData = (await tokenRes.json()) as {
      id_token?: string
      access_token?: string
    }
    if (!tokenData.access_token && !tokenData.id_token) {
      throw new Error('O Google não retornou access_token ou id_token.')
    }
    return verifyGoogleCredential({
      accessToken: tokenData.access_token,
      idToken: tokenData.id_token,
    })
  }

  // 2. Verify Google OAuth 2.0 Access Token (via official Google UserInfo & TokenInfo endpoints)
  if (body.accessToken) {
    if (
      configuredClientId &&
      !configuredClientId.startsWith('seu-client-id')
    ) {
      const tokenInfoRes = await fetch(
        `https://oauth2.googleapis.com/tokeninfo?access_token=${encodeURIComponent(body.accessToken)}`
      )
      if (!tokenInfoRes.ok) {
        throw new Error('Access token do Google inválido ou expirado.')
      }
      const tokenInfo = (await tokenInfoRes.json()) as Record<string, string>
      if (
        tokenInfo.aud &&
        tokenInfo.aud !== configuredClientId &&
        tokenInfo.azp !== configuredClientId
      ) {
        throw new Error(
          'O Access Token não pertence ao GOOGLE_CLIENT_ID configurado.'
        )
      }
    }

    const res = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
      headers: {
        Authorization: `Bearer ${body.accessToken}`,
      },
    })
    if (!res.ok) {
      throw new Error('Não foi possível obter os dados da conta Google.')
    }
    const data = (await res.json()) as Record<string, string>
    if (!data.sub || !data.email) {
      throw new Error('A conta Google não retornou ID (sub) ou e-mail válido.')
    }
    return {
      googleId: data.sub,
      email: data.email,
      displayName: data.name || data.given_name || data.email.split('@')[0],
      avatarUrl: data.picture || '',
    }
  }

  // 3. Verify Google ID Token (JWT from Google Identity Services)
  if (body.idToken) {
    const res = await fetch(
      `https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(body.idToken)}`
    )
    if (!res.ok) {
      throw new Error('Token do Google inválido ou expirado (id_token).')
    }
    const data = (await res.json()) as Record<string, string>
    if (
      configuredClientId &&
      !configuredClientId.startsWith('seu-client-id') &&
      data.aud !== configuredClientId
    ) {
      throw new Error('O Client ID do token não corresponde ao GOOGLE_CLIENT_ID.')
    }
    return {
      googleId: data.sub,
      email: data.email,
      displayName: data.name || data.given_name || data.email.split('@')[0],
      avatarUrl: data.picture || '',
    }
  }

  throw new Error(
    'Nenhuma credencial oficial do Google (code, accessToken ou idToken) foi fornecida.'
  )
}

function isLegacyFakeGoogleId(googleId: string, email?: string): boolean {
  if (!googleId) return true
  if (googleId.startsWith('google_') || googleId.startsWith('dev_')) return true
  if (email && email.toLowerCase() === 'jogador.toytower@gmail.com') return true
  return false
}

// ============================================================================
// JWT SESSION SIGNING & VERIFICATION (HS256) + HTTP-ONLY COOKIE HELPERS
// ============================================================================

function getJwtSecret(): string {
  ensureEnvLoaded()
  return (
    process.env.JWT_SECRET || 'chave-secreta-super-segura-toy-tower-dev-2026'
  )
}

function base64UrlEncode(input: string | Buffer): string {
  return Buffer.from(input)
    .toString('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
}

function base64UrlDecode(input: string): string {
  const pad = 4 - (input.length % 4)
  const normalized =
    input.replace(/-/g, '+').replace(/_/g, '/') +
    (pad < 4 ? '='.repeat(pad) : '')
  return Buffer.from(normalized, 'base64').toString('utf-8')
}

export function signSessionJwt(payload: {
  googleId: string
  email: string
}): string {
  const header = base64UrlEncode(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))
  const nowSec = Math.floor(Date.now() / 1000)
  const body = base64UrlEncode(
    JSON.stringify({
      sub: payload.googleId,
      email: payload.email,
      iat: nowSec,
      exp: nowSec + 60 * 60 * 24 * 7, // 7 days
    })
  )
  const signature = crypto
    .createHmac('sha256', getJwtSecret())
    .update(`${header}.${body}`)
    .digest()
  return `${header}.${body}.${base64UrlEncode(signature)}`
}

export function verifySessionJwt(
  token: string
): { googleId: string; email: string } | null {
  try {
    const parts = token.split('.')
    if (parts.length !== 3) return null
    const [header, body, sig] = parts
    const expectedSig = base64UrlEncode(
      crypto
        .createHmac('sha256', getJwtSecret())
        .update(`${header}.${body}`)
        .digest()
    )
    if (sig !== expectedSig) return null
    const decoded = JSON.parse(base64UrlDecode(body)) as {
      sub?: string
      email?: string
      exp?: number
    }
    if (!decoded.sub || !decoded.email) return null
    if (decoded.exp && Math.floor(Date.now() / 1000) > decoded.exp) {
      return null
    }
    return { googleId: decoded.sub, email: decoded.email }
  } catch {
    return null
  }
}

function parseCookies(cookieHeader?: string): Record<string, string> {
  const out: Record<string, string> = {}
  if (!cookieHeader) return out
  for (const pair of cookieHeader.split(';')) {
    const idx = pair.indexOf('=')
    if (idx > 0) {
      const k = pair.slice(0, idx).trim()
      const v = pair.slice(idx + 1).trim()
      out[k] = decodeURIComponent(v)
    }
  }
  return out
}

function readJsonBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  const vercelReq = req as IncomingMessage & {
    body?: unknown
  }

  // Vercel Serverless Functions pre-parse `req.body` before invoking the handler.
  if (vercelReq.body !== undefined && vercelReq.body !== null) {
    if (Buffer.isBuffer(vercelReq.body)) {
      const str = vercelReq.body.toString('utf-8').trim()
      return Promise.resolve(
        str ? (JSON.parse(str) as Record<string, unknown>) : {}
      )
    }
    if (typeof vercelReq.body === 'string') {
      const str = vercelReq.body.trim()
      return Promise.resolve(
        str ? (JSON.parse(str) as Record<string, unknown>) : {}
      )
    }
    if (typeof vercelReq.body === 'object') {
      return Promise.resolve(vercelReq.body as Record<string, unknown>)
    }
  }

  // If the stream already ended (e.g. empty body on serverless), resolve immediately
  if (req.readableEnded) {
    return Promise.resolve({})
  }

  return new Promise((resolve, reject) => {
    let raw = ''
    req.on('data', (chunk) => {
      raw += chunk
      if (raw.length > 300 * 1024 * 1024) {
        reject(new Error('Payload too large'))
      }
    })
    req.on('end', () => {
      if (!raw.trim()) {
        resolve({})
        return
      }
      try {
        resolve(JSON.parse(raw) as Record<string, unknown>)
      } catch (err) {
        reject(err)
      }
    })
    req.on('error', reject)
  })
}

function sendJson(
  res: ServerResponse,
  statusCode: number,
  data: unknown,
  extraHeaders?: Record<string, string>
): void {
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    ...extraHeaders,
  })
  res.end(JSON.stringify(data))
}

export function extractRequestToken(req: IncomingMessage): string | null {
  const authHeader = req.headers.authorization
  if (authHeader && authHeader.startsWith('Bearer ')) {
    return authHeader.slice(7).trim()
  }
  const cookies = parseCookies(req.headers.cookie)
  return cookies[SESSION_COOKIE_NAME] || null
}

/**
 * Resolves the canonical `/api/auth/<subpath>` route across both Vite local dev
 * and Vercel Serverless rewrites (`?route=...`, `?path=...`, or `req.query.route`).
 */
function resolveCanonicalAuthUrl(req: IncomingMessage): string {
  const rawUrl = req.url || ''
  const [pathname, search = ''] = rawUrl.split('?')

  const vercelReq = req as IncomingMessage & {
    query?: Record<string, string | string[] | undefined>
  }

  const params = new URLSearchParams(search)
  const queryRoute =
    vercelReq.query?.route ??
    vercelReq.query?.path ??
    params.get('route') ??
    params.get('path')

  const normalizedQueryRoute = Array.isArray(queryRoute)
    ? queryRoute.join('/')
    : (queryRoute || '').trim().replace(/^\/+/, '')

  if (
    normalizedQueryRoute &&
    (pathname === '/api/auth' ||
      pathname === '/api/auth/' ||
      pathname.includes('[...route]'))
  ) {
    return `/api/auth/${normalizedQueryRoute}`.replace(/\/+$/, '')
  }

  return pathname.replace(/\/+$/, '')
}

/**
 * Unified HTTP request handler for `/api/auth/*` routes.
 * Used by Vercel Serverless Functions, Vite dev/preview server middleware, and Node HTTP server.
 */
export async function handleAuthApiRequest(
  req: IncomingMessage,
  res: ServerResponse
): Promise<boolean> {
  const shopHandled = await handleShopApiRequest(req, res)
  if (shopHandled) {
    return true
  }

  const url = resolveCanonicalAuthUrl(req)
  if (!url.startsWith('/api/auth')) {
    return false
  }

  try {
    // 0. GET /api/auth/config — Returns live Google Client ID from .env
    if (req.method === 'GET' && url === '/api/auth/config') {
      const googleClientId = getConfiguredGoogleClientId()
      sendJson(res, 200, {
        ok: true,
        googleClientId,
      })
      return true
    }

    // 1. POST /api/auth/google — Validate Official Google OAuth 2.0 & Upsert User in MongoDB
    if (req.method === 'POST' && url === '/api/auth/google') {
      const body = await readJsonBody(req)
      const profile = await verifyGoogleCredential({
        idToken: typeof body.idToken === 'string' ? body.idToken : undefined,
        accessToken:
          typeof body.accessToken === 'string' ? body.accessToken : undefined,
        code: typeof body.code === 'string' ? body.code : undefined,
        redirectUri:
          typeof body.redirectUri === 'string' ? body.redirectUri : undefined,
      })

      const { user, isNewUser, dbMode } = await upsertGoogleUser(profile)
      const token = signSessionJwt({
        googleId: user.googleId,
        email: user.email,
      })

      const cookieValue = `${SESSION_COOKIE_NAME}=${encodeURIComponent(token)}; HttpOnly; Path=/; Max-Age=${60 * 60 * 24 * 7}; SameSite=Lax`

      sendJson(
        res,
        200,
        {
          ok: true,
          isNewUser,
          token,
          user,
          dbMode,
        },
        {
          'Set-Cookie': cookieValue,
        }
      )
      return true
    }

    // 2. GET /api/auth/me — Restore active session from HTTP-Only Cookie or JWT Bearer
    if (req.method === 'GET' && url === '/api/auth/me') {
      const googleClientId = getConfiguredGoogleClientId()
      const token = extractRequestToken(req)
      if (!token) {
        sendJson(res, 200, { ok: false, user: null, googleClientId })
        return true
      }

      const verified = verifySessionJwt(token)
      if (
        !verified ||
        isLegacyFakeGoogleId(verified.googleId, verified.email)
      ) {
        const expiredCookie = `${SESSION_COOKIE_NAME}=; HttpOnly; Path=/; Max-Age=0; SameSite=Lax`
        sendJson(
          res,
          200,
          { ok: false, user: null, googleClientId },
          { 'Set-Cookie': expiredCookie }
        )
        return true
      }

      const { user, dbMode } = await findUserByGoogleId(verified.googleId)
      sendJson(res, 200, {
        ok: Boolean(user),
        user,
        token: user ? token : null,
        dbMode,
        googleClientId,
      })
      return true
    }

    // 3. POST /api/auth/logout — Clear HTTP-Only session cookie
    if (req.method === 'POST' && url === '/api/auth/logout') {
      const expiredCookie = `${SESSION_COOKIE_NAME}=; HttpOnly; Path=/; Max-Age=0; SameSite=Lax`
      sendJson(
        res,
        200,
        { ok: true },
        {
          'Set-Cookie': expiredCookie,
        }
      )
      return true
    }

    // 4. PATCH /api/auth/skin — Sync equippedSkin & equippedBlockSkin to MongoDB
    if (req.method === 'PATCH' && url === '/api/auth/skin') {
      const token = extractRequestToken(req)
      const verified = token ? verifySessionJwt(token) : null
      if (!verified) {
        sendJson(res, 401, { ok: false, error: 'Não autenticado.' })
        return true
      }

      const body = await readJsonBody(req)
      const equippedSkin =
        typeof body.equippedSkin === 'string' && body.equippedSkin.trim()
          ? body.equippedSkin.trim()
          : undefined
      const equippedBlockSkin =
        typeof body.equippedBlockSkin === 'string' &&
        body.equippedBlockSkin.trim()
          ? body.equippedBlockSkin.trim()
          : undefined

      if (!equippedSkin && !equippedBlockSkin) {
        sendJson(res, 400, { ok: false, error: 'Skin inválida.' })
        return true
      }

      const updated = await updateUserEquippedSkin(
        verified.googleId,
        equippedSkin,
        equippedBlockSkin
      )
      sendJson(res, 200, { ok: Boolean(updated), user: updated })
      return true
    }

    // 5. PATCH /api/auth/nick — Update customizable customNick (2 to 16 chars)
    if (req.method === 'PATCH' && url === '/api/auth/nick') {
      const token = extractRequestToken(req)
      const verified = token ? verifySessionJwt(token) : null
      if (!verified) {
        sendJson(res, 401, { ok: false, error: 'Não autenticado.' })
        return true
      }

      const body = await readJsonBody(req)
      const customNick =
        typeof body.customNick === 'string' ? body.customNick.trim() : ''
      const updated = await updateUserCustomNick(verified.googleId, customNick)
      sendJson(res, 200, { ok: Boolean(updated), user: updated })
      return true
    }

    // 6. POST /api/auth/friends or /api/auth/friends/request — Send friend request by @handle or email
    if (
      req.method === 'POST' &&
      (url === '/api/auth/friends' || url === '/api/auth/friends/request')
    ) {
      const token = extractRequestToken(req)
      const verified = token ? verifySessionJwt(token) : null
      if (!verified) {
        sendJson(res, 401, { ok: false, error: 'Não autenticado.' })
        return true
      }

      const body = await readJsonBody(req)
      const query = typeof body.query === 'string' ? body.query.trim() : ''
      if (!query) {
        sendJson(res, 400, {
          ok: false,
          error: 'Informe @nome_000 ou email para adicionar.',
        })
        return true
      }

      const result = await sendFriendRequest(verified.googleId, query)
      sendJson(res, 200, {
        ok: true,
        user: result.senderUser,
        targetProfile: result.targetProfile,
        autoAccepted: result.autoAccepted,
      })
      return true
    }

    // 7. POST /api/auth/friends/respond — Accept or decline a received friend request
    if (req.method === 'POST' && url === '/api/auth/friends/respond') {
      const token = extractRequestToken(req)
      const verified = token ? verifySessionJwt(token) : null
      if (!verified) {
        sendJson(res, 401, { ok: false, error: 'Não autenticado.' })
        return true
      }

      const body = await readJsonBody(req)
      const senderHandle =
        typeof body.senderHandle === 'string' ? body.senderHandle.trim() : ''
      const accept = Boolean(body.accept)

      const result = await respondToFriendRequest(
        verified.googleId,
        senderHandle,
        accept
      )
      sendJson(res, 200, {
        ok: true,
        user: result.recipientUser,
        accepted: result.accepted,
      })
      return true
    }

    // 8. PATCH /api/auth/stats — Persist PERSONAL BEST (stats.survivalBestPieces) in MongoDB
    if (req.method === 'PATCH' && url === '/api/auth/stats') {
      const token = extractRequestToken(req)
      const verified = token ? verifySessionJwt(token) : null
      if (!verified) {
        sendJson(res, 401, { ok: false, error: 'Não autenticado.' })
        return true
      }

      const body = await readJsonBody(req)
      const survivalBestPieces = Math.max(
        0,
        Math.floor(Number(body.survivalBestPieces ?? body.personalBest ?? 0))
      )
      const updated = await updateUserPersonalBest(
        verified.googleId,
        survivalBestPieces
      )
      sendJson(res, 200, { ok: Boolean(updated), user: updated })
      return true
    }

    sendJson(res, 404, { ok: false, error: 'Rota de autenticação não encontrada.' })
    return true
  } catch (err) {
    console.error('[ToyTower Auth API Error]:', err)
    sendJson(res, 400, {
      ok: false,
      error:
        err instanceof Error
          ? err.message
          : 'Erro interno na autenticação com o Google.',
    })
    return true
  }
}
