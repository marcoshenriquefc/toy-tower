import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { connectMongoDB, ensureEnvLoaded } from './db'
import {
  DEFAULT_INITIAL_FRIENDS,
  DEFAULT_UNLOCKED_SKINS,
  IFriendEntry,
  IFriendRequestEntry,
  IUser,
  UserModel,
} from './models/User'

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
const LOCAL_DB_FILE = path.resolve(process.cwd(), 'server', '.data', 'users.json')

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
 * - If not found (1st login): creates a new `User` with default skins and stats.
 * - If found: updates `lastLoginAt` (and `displayName` / `avatarUrl` if changed) and returns the saved account.
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
        equippedSkin: 'WIZARD',
        unlockedSkins: [...DEFAULT_UNLOCKED_SKINS],
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
      if (!doc.unlockedSkins || doc.unlockedSkins.length === 0) {
        doc.unlockedSkins = [...DEFAULT_UNLOCKED_SKINS]
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
      equippedSkin: 'WIZARD',
      unlockedSkins: [...DEFAULT_UNLOCKED_SKINS],
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
      unlockedSkins:
        current.unlockedSkins && current.unlockedSkins.length > 0
          ? current.unlockedSkins
          : [...DEFAULT_UNLOCKED_SKINS],
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
    return {
      user: doc ? sanitizeUser(doc.toObject()) : null,
      dbMode: 'mongodb',
    }
  }

  const users = readLocalUsers()
  const found = users.find((u) => u.googleId === googleId) || null
  return {
    user: found ? sanitizeUser(found) : null,
    dbMode: 'local-fallback',
  }
}

export async function updateUserEquippedSkin(
  googleId: string,
  equippedSkin: string
): Promise<IUser | null> {
  const dbMode = await connectMongoDB()
  if (dbMode === 'mongodb') {
    const doc = await UserModel.findOneAndUpdate(
      { googleId },
      { $set: { equippedSkin } },
      { new: true }
    )
    if (doc && doc.handle) {
      await UserModel.updateMany(
        { 'friends.handle': doc.handle.toLowerCase() },
        { $set: { 'friends.$.equippedSkin': equippedSkin } }
      )
    }
    return doc ? sanitizeUser(doc.toObject()) : null
  }

  const users = readLocalUsers()
  const idx = users.findIndex((u) => u.googleId === googleId)
  if (idx === -1) return null
  users[idx].equippedSkin = equippedSkin
  const myHandle = (users[idx].handle || '').toLowerCase()
  for (const u of users) {
    if (Array.isArray(u.friends)) {
      for (const f of u.friends) {
        if (f.handle.toLowerCase() === myHandle) {
          f.equippedSkin = equippedSkin
        }
      }
    }
  }
  writeLocalUsers(users)
  return sanitizeUser(users[idx])
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
      avatarUrl: me.avatarUrl || '',
      createdAt: new Date(),
    }

    const targetProfile: IFriendRequestEntry = {
      handle: targetHandle,
      customNick:
        target.customNick || deriveDefaultCustomNick(target.displayName),
      email: target.email,
      equippedSkin: target.equippedSkin || 'WIZARD',
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
    avatarUrl: me.avatarUrl || '',
    createdAt: new Date(),
  }

  const targetProfile: IFriendRequestEntry = {
    handle: targetHandle,
    customNick:
      target.customNick || deriveDefaultCustomNick(target.displayName),
    email: target.email,
    equippedSkin: target.equippedSkin || 'WIZARD',
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
        avatarUrl: String(r.avatarUrl || ''),
      })
    }
  }
  const rawReceived = Array.isArray(raw.friendRequestsReceived)
    ? raw.friendRequestsReceived.filter((r) => r && r.handle)
    : []
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
    equippedSkin: String(raw.equippedSkin || 'WIZARD'),
    unlockedSkins: Array.isArray(raw.unlockedSkins)
      ? raw.unlockedSkins.map(String)
      : [...DEFAULT_UNLOCKED_SKINS],
    friends: mergedFriends.map((f) => ({
      handle: String(f.handle).toLowerCase(),
      customNick: String(f.customNick),
      email: String(f.email || ''),
      equippedSkin: String(f.equippedSkin || 'WIZARD'),
      avatarUrl: String(f.avatarUrl || ''),
    })),
    friendRequestsSent: rawSent.map((r) => ({
      handle: String(r.handle).toLowerCase(),
      customNick: String(r.customNick),
      email: String(r.email || ''),
      equippedSkin: String(r.equippedSkin || 'WIZARD'),
      avatarUrl: String(r.avatarUrl || ''),
      createdAt: r.createdAt || new Date(),
    })),
    friendRequestsReceived: rawReceived.map((r) => ({
      handle: String(r.handle).toLowerCase(),
      customNick: String(r.customNick),
      email: String(r.email || ''),
      equippedSkin: String(r.equippedSkin || 'WIZARD'),
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
  return new Promise((resolve, reject) => {
    let raw = ''
    req.on('data', (chunk) => {
      raw += chunk
      if (raw.length > 1_000_000) {
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
 * Unified HTTP request handler for `/api/auth/*` routes.
 * Used both by the Vite dev/preview server middleware and standalone Node server.
 */
export async function handleAuthApiRequest(
  req: IncomingMessage,
  res: ServerResponse
): Promise<boolean> {
  const url = (req.url || '').split('?')[0]
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

    // 4. PATCH /api/auth/skin — Sync equippedSkin to MongoDB
    if (req.method === 'PATCH' && url === '/api/auth/skin') {
      const token = extractRequestToken(req)
      const verified = token ? verifySessionJwt(token) : null
      if (!verified) {
        sendJson(res, 401, { ok: false, error: 'Não autenticado.' })
        return true
      }

      const body = await readJsonBody(req)
      const equippedSkin =
        typeof body.equippedSkin === 'string' ? body.equippedSkin.trim() : ''
      if (!equippedSkin) {
        sendJson(res, 400, { ok: false, error: 'Skin inválida.' })
        return true
      }

      const updated = await updateUserEquippedSkin(
        verified.googleId,
        equippedSkin
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
