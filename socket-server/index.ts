import crypto from 'node:crypto'
import fs from 'node:fs'
import http, { type IncomingMessage, type ServerResponse } from 'node:http'
import path from 'node:path'
import mongoose, { type Document, type Model, Schema } from 'mongoose'
import { Server as SocketIOServer, type Socket } from 'socket.io'

// ============================================================================
// 1. ENVIRONMENT & GLOBAL MONGOOSE CONNECTION CACHE (global._mongooseCache)
// ============================================================================

export interface MongooseGlobalCache {
  conn: typeof mongoose | null
  promise: Promise<typeof mongoose> | null
}

declare global {
  // eslint-disable-next-line no-var
  var _mongooseCache: MongooseGlobalCache | undefined
}

const globalCache: MongooseGlobalCache = globalThis._mongooseCache ?? {
  conn: null,
  promise: null,
}

if (!globalThis._mongooseCache) {
  globalThis._mongooseCache = globalCache
}

function loadEnvIfPresent(): void {
  const candidates = [
    path.resolve(process.cwd(), '.env'),
    path.resolve(process.cwd(), '..', '.env'),
  ]
  for (const envPath of candidates) {
    if (!fs.existsSync(envPath)) continue
    try {
      const raw = fs.readFileSync(envPath, 'utf-8')
      for (const line of raw.split(/\r?\n/)) {
        const trimmed = line.trim()
        if (!trimmed || trimmed.startsWith('#')) continue
        const eqIdx = trimmed.indexOf('=')
        if (eqIdx <= 0) continue
        const key = trimmed.slice(0, eqIdx).trim()
        let val = trimmed.slice(eqIdx + 1).trim()
        if (
          (val.startsWith('"') && val.endsWith('"')) ||
          (val.startsWith("'") && val.endsWith("'"))
        ) {
          val = val.slice(1, -1)
        }
        if (val && !process.env[key]) {
          process.env[key] = val
        }
      }
    } catch {
      // Ignore .env parse errors
    }
  }
}

loadEnvIfPresent()

export async function connectMongoDB(): Promise<typeof mongoose | null> {
  if (globalCache.conn && mongoose.connection.readyState === 1) {
    return globalCache.conn
  }

  const uri = (process.env.MONGODB_URI || '').trim()
  if (!uri || uri.includes('<usuario>') || uri.includes('<senha>')) {
    console.warn('[Render Socket Server] MONGODB_URI not configured.')
    return null
  }

  if (!globalCache.promise) {
    globalCache.promise = mongoose.connect(uri, {
      bufferCommands: false,
      maxPoolSize: 10,
      serverSelectionTimeoutMS: 5000,
      socketTimeoutMS: 45000,
    })
  }

  try {
    globalCache.conn = await globalCache.promise
    return globalCache.conn
  } catch (err) {
    globalCache.promise = null
    globalCache.conn = null
    console.error('[Render Socket Server] MongoDB connection error:', err)
    return null
  }
}

// ============================================================================
// 2. MONGODB USER SCHEMA (SHARED COLLECTION WITH VERCEL API)
// ============================================================================

export interface IFriendEntry {
  handle: string
  customNick: string
  email?: string
  equippedSkin: string
}

export interface IFriendRequestEntry {
  handle: string
  customNick: string
  email?: string
  equippedSkin: string
  requestedAt: Date
}

export interface IUser {
  googleId: string
  email: string
  displayName: string
  customNick: string
  handle: string
  avatarUrl: string
  equippedSkin: string
  unlockedSkins: string[]
  friends: IFriendEntry[]
  friendRequestsSent: IFriendRequestEntry[]
  friendRequestsReceived: IFriendRequestEntry[]
  stats: {
    matchesPlayed: number
    wins: number
    survivalBestPieces: number
  }
  createdAt: Date
  lastLoginAt: Date
}

export interface IUserDocument extends IUser, Document {}

const FriendEntrySchema = new Schema<IFriendEntry>(
  {
    handle: { type: String, required: true, trim: true, lowercase: true },
    customNick: { type: String, required: true, trim: true },
    email: { type: String, required: false, lowercase: true, trim: true },
    equippedSkin: { type: String, default: 'WIZARD' },
  },
  { _id: false }
)

const FriendRequestEntrySchema = new Schema<IFriendRequestEntry>(
  {
    handle: { type: String, required: true, trim: true, lowercase: true },
    customNick: { type: String, required: true, trim: true },
    email: { type: String, required: false, lowercase: true, trim: true },
    equippedSkin: { type: String, default: 'WIZARD' },
    requestedAt: { type: Date, default: () => new Date() },
  },
  { _id: false }
)

const UserSchema = new Schema<IUserDocument>(
  {
    googleId: { type: String, required: true, unique: true, index: true },
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
    },
    displayName: { type: String, required: true, trim: true },
    customNick: { type: String, default: 'ReiDosBlocos', trim: true },
    handle: {
      type: String,
      default: '@lucas_042',
      trim: true,
      lowercase: true,
      index: true,
    },
    avatarUrl: { type: String, default: '' },
    equippedSkin: { type: String, default: 'WIZARD' },
    unlockedSkins: { type: [String], default: ['WIZARD'] },
    friends: { type: [FriendEntrySchema], default: [] },
    friendRequestsSent: { type: [FriendRequestEntrySchema], default: [] },
    friendRequestsReceived: { type: [FriendRequestEntrySchema], default: [] },
    stats: {
      matchesPlayed: { type: Number, default: 0 },
      wins: { type: Number, default: 0 },
      survivalBestPieces: { type: Number, default: 0 },
    },
    createdAt: { type: Date, default: () => new Date() },
    lastLoginAt: { type: Date, default: () => new Date() },
  },
  {
    collection: 'users',
    versionKey: false,
  }
)

const UserModel: Model<IUserDocument> =
  (mongoose.models.User as Model<IUserDocument>) ||
  mongoose.model<IUserDocument>('User', UserSchema)

// ============================================================================
// 3. JWT VERIFICATION (SHARED JWT_SECRET WITH VERCEL)
// ============================================================================

const SESSION_COOKIE_NAME = 'toy_tower_session'

function getJwtSecret(): string {
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

function extractSocketToken(socket: Socket): string | null {
  // 1. Handshake auth token from socket.io-client (`socket.handshake.auth.token`)
  if (
    typeof socket.handshake.auth?.token === 'string' &&
    socket.handshake.auth.token.trim()
  ) {
    return socket.handshake.auth.token.trim()
  }
  // 2. Authorization Bearer header fallback
  const authHeader = socket.handshake.headers?.authorization
  if (typeof authHeader === 'string' && authHeader.startsWith('Bearer ')) {
    return authHeader.slice(7).trim()
  }
  // 3. Cookie fallback
  const cookies = parseCookies(socket.handshake.headers?.cookie)
  return cookies[SESSION_COOKIE_NAME] || null
}

// ============================================================================
// 4. STRICT CORS CONFIGURATION (FRONTEND_URL + LOCALHOST DEV)
// ============================================================================

export function getAllowedOrigins(): string[] {
  const configured = (process.env.FRONTEND_URL || '')
    .split(',')
    .map((u) => u.trim().replace(/\/+$/, ''))
    .filter(Boolean)

  const devOrigins = [
    'http://localhost:3000',
    'http://localhost:5173',
    'http://127.0.0.1:3000',
    'http://127.0.0.1:5173',
  ]

  return Array.from(new Set([...configured, ...devOrigins]))
}

export function isOriginAllowed(origin?: string): boolean {
  if (!origin) return true
  const normalized = origin.trim().replace(/\/+$/, '')
  const allowed = getAllowedOrigins()
  if (allowed.includes(normalized)) return true
  if (
    normalized.endsWith('.vercel.app') &&
    allowed.some((o) => o.endsWith('.vercel.app'))
  ) {
    return true
  }
  return false
}

// ============================================================================
// 5. ROOMS, SOCIAL & 20HZ MATCH SYNC STATE
// ============================================================================

export type RoomGameMode = 'RACE' | 'SURVIVAL'
export type RoomSelectableGameMode = 'RACE' | 'SURVIVAL' | 'RANDOM'
export type RoomVictoryCondition = 'SINGLE_WIN' | 'CUP_6' | 'CUP_12'

const CUP_RANK_POINTS: readonly [number, number, number, number] = [3, 2, 1, 0]

function getCupTargetPoints(condition: RoomVictoryCondition): number {
  if (condition === 'SINGLE_WIN') return 3
  if (condition === 'CUP_12') return 12
  return 6
}

interface RoomSlotPlayerDTO {
  socketId: string
  googleId: string
  handle: string
  customNick: string
  avatarUrl: string
  equippedSkin: string
  isHost: boolean
  isReady: boolean
  slotIndex: number
  cupPoints?: number
  lastPointsEarned?: number
}

interface RoomStateDTO {
  roomId: string
  hostHandle: string
  status: 'LOBBY' | 'COUNTDOWN' | 'PLAYING' | 'FINISHED'
  countdownSeconds: number | null
  pieceSeed: string | null
  selectedGameMode: RoomSelectableGameMode
  activeGameMode: RoomGameMode
  victoryCondition: RoomVictoryCondition
  cupTargetPoints: number
  roundNumber: number
  slots: Array<RoomSlotPlayerDTO | null>
}

interface InternalRoom {
  roomId: string
  hostHandle: string
  status: 'LOBBY' | 'COUNTDOWN' | 'PLAYING' | 'FINISHED'
  countdownSeconds: number | null
  countdownTimer: ReturnType<typeof setInterval> | null
  pieceSeed: string | null
  selectedGameMode: RoomSelectableGameMode
  activeGameMode: RoomGameMode
  victoryCondition: RoomVictoryCondition
  cupTargetPoints: number
  roundNumber: number
  eliminationCounter: number
  survivalClimaxWinnerHandle: string | null
  survivalClimaxTimer: ReturnType<typeof setTimeout> | null
  slots: [
    RoomSlotPlayerDTO | null,
    RoomSlotPlayerDTO | null,
    RoomSlotPlayerDTO | null,
    RoomSlotPlayerDTO | null,
  ]
  matchStateByHandle: Map<
    string,
    {
      towerHeight: number
      lives: number
      isEliminated: boolean
      eliminationOrder: number
    }
  >
}

interface ConnectedSession {
  socketId: string
  googleId: string
  email: string
  handle: string
  customNick: string
  equippedSkin: string
  avatarUrl: string
  roomId: string | null
}

const sessionsBySocketId = new Map<string, ConnectedSession>()
const socketIdsByHandle = new Map<string, Set<string>>()
const roomsById = new Map<string, InternalRoom>()

function normalizeHandle(raw: string): string {
  const cleaned = raw.trim().toLowerCase()
  return cleaned.startsWith('@') ? cleaned : `@${cleaned}`
}

function generateRoomId(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  let code = 'SALA-'
  for (let i = 0; i < 4; i++) {
    code += chars[Math.floor(Math.random() * chars.length)]
  }
  return code
}

function generatePieceSeed(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  let seed = 'TOY-'
  for (let i = 0; i < 6; i++) {
    seed += chars[Math.floor(Math.random() * chars.length)]
  }
  return seed
}

function isHandleOnline(handle: string): boolean {
  const set = socketIdsByHandle.get(normalizeHandle(handle))
  return Boolean(set && set.size > 0)
}

function emitToHandle(
  io: SocketIOServer,
  handle: string,
  event: string,
  payload: unknown
): void {
  const set = socketIdsByHandle.get(normalizeHandle(handle))
  if (!set) return
  for (const sid of set) {
    io.to(sid).emit(event, payload)
  }
}

function serializeRoom(room: InternalRoom): RoomStateDTO {
  return {
    roomId: room.roomId,
    hostHandle: room.hostHandle,
    status: room.status,
    countdownSeconds: room.countdownSeconds,
    pieceSeed: room.pieceSeed,
    selectedGameMode: room.selectedGameMode,
    activeGameMode: room.activeGameMode,
    victoryCondition: room.victoryCondition,
    cupTargetPoints: room.cupTargetPoints,
    roundNumber: room.roundNumber,
    slots: room.slots.map((s) => (s ? { ...s } : null)),
  }
}

function broadcastRoomState(io: SocketIOServer, room: InternalRoom): void {
  io.to(room.roomId).emit('room:state_updated', serializeRoom(room))
}

function abortRoomCountdown(io: SocketIOServer, room: InternalRoom): void {
  if (room.countdownTimer) {
    clearInterval(room.countdownTimer)
    room.countdownTimer = null
  }
  const wasCounting =
    room.status === 'COUNTDOWN' || room.countdownSeconds !== null
  room.countdownSeconds = null
  if (room.status === 'COUNTDOWN') {
    room.status = 'LOBBY'
  }
  if (wasCounting) {
    io.to(room.roomId).emit('room:countdown_aborted', { roomId: room.roomId })
  }
}

function checkAndStartRoomCountdown(
  io: SocketIOServer,
  room: InternalRoom
): void {
  const occupied = room.slots.filter(
    (s): s is RoomSlotPlayerDTO => s !== null
  )
  const allReady =
    occupied.length >= 1 && occupied.every((s) => s.isReady === true)

  if (!allReady) {
    abortRoomCountdown(io, room)
    broadcastRoomState(io, room)
    return
  }

  if (room.countdownTimer) return

  room.status = 'COUNTDOWN'
  room.countdownSeconds = 3
  broadcastRoomState(io, room)
  io.to(room.roomId).emit('room:countdown_tick', {
    roomId: room.roomId,
    secondsRemaining: 3,
  })

  room.countdownTimer = setInterval(() => {
    const currentOccupied = room.slots.filter(
      (s): s is RoomSlotPlayerDTO => s !== null
    )
    if (
      currentOccupied.length < 1 ||
      !currentOccupied.every((s) => s.isReady)
    ) {
      abortRoomCountdown(io, room)
      broadcastRoomState(io, room)
      return
    }

    if (room.countdownSeconds === null) {
      abortRoomCountdown(io, room)
      return
    }

    room.countdownSeconds -= 1
    if (room.countdownSeconds > 0) {
      broadcastRoomState(io, room)
      io.to(room.roomId).emit('room:countdown_tick', {
        roomId: room.roomId,
        secondsRemaining: room.countdownSeconds,
      })
      return
    }

    // Countdown reached 0 -> Start Match with shared pieceSeed!
    if (room.countdownTimer) {
      clearInterval(room.countdownTimer)
      room.countdownTimer = null
    }
    room.countdownSeconds = null
    room.status = 'PLAYING'
    room.roundNumber = 1
    room.eliminationCounter = 0
    room.survivalClimaxWinnerHandle = null
    clearSurvivalClimaxTimer(room)
    room.cupTargetPoints = getCupTargetPoints(room.victoryCondition)
    room.pieceSeed = generatePieceSeed()
    room.activeGameMode =
      room.selectedGameMode === 'RANDOM'
        ? Math.random() < 0.5
          ? 'RACE'
          : 'SURVIVAL'
        : room.selectedGameMode

    room.matchStateByHandle.clear()
    for (const p of currentOccupied) {
      p.cupPoints = 0
      p.lastPointsEarned = 0
      room.matchStateByHandle.set(p.handle, {
        towerHeight: 0,
        lives: 3,
        isEliminated: false,
        eliminationOrder: 0,
      })
    }

    broadcastRoomState(io, room)
    io.to(room.roomId).emit('match:start', {
      roomId: room.roomId,
      pieceSeed: room.pieceSeed,
      gameMode: room.activeGameMode,
      selectedGameMode: room.selectedGameMode,
      victoryCondition: room.victoryCondition,
      cupTargetPoints: room.cupTargetPoints,
      roundNumber: room.roundNumber,
      startedAt: new Date().toISOString(),
      players: currentOccupied.map((p) => ({
        handle: p.handle,
        customNick: p.customNick,
        equippedSkin: p.equippedSkin,
        slotIndex: p.slotIndex,
        isHost: p.isHost,
        cupPoints: p.cupPoints ?? 0,
        lastPointsEarned: p.lastPointsEarned ?? 0,
      })),
    })
  }, 1000)
}

function clearSurvivalClimaxTimer(room: InternalRoom): void {
  if (room.survivalClimaxTimer) {
    clearTimeout(room.survivalClimaxTimer)
    room.survivalClimaxTimer = null
  }
}

async function concludeMultiplayerRound(
  io: SocketIOServer,
  room: InternalRoom,
  winnerHandle: string,
  elapsedTimeMs: number,
  clientEliminationOrders?: Record<string, number>,
  soloEliminated = false
): Promise<void> {
  if (room.status === 'FINISHED') return
  clearSurvivalClimaxTimer(room)
  room.survivalClimaxWinnerHandle = null
  room.status = 'FINISHED'

  const presentPlayers = room.slots.filter(
    (s): s is RoomSlotPlayerDTO => s !== null
  )
  const winnerPlayer =
    presentPlayers.find((p) => p.handle === winnerHandle) || presentPlayers[0]
  if (!winnerPlayer) return

  if (clientEliminationOrders) {
    for (const p of presentPlayers) {
      const st = room.matchStateByHandle.get(p.handle)
      if (st && st.lives <= 0 && st.eliminationOrder === 0) {
        const clientOrder =
          clientEliminationOrders[p.handle.toLowerCase()] ??
          clientEliminationOrders[p.handle]
        if (typeof clientOrder === 'number' && clientOrder > 0) {
          st.eliminationOrder = clientOrder
        }
      }
    }
  }

  const sorted = [...presentPlayers].sort((a, b) => {
    if (a.handle === winnerPlayer.handle) return -1
    if (b.handle === winnerPlayer.handle) return 1
    const stA = room.matchStateByHandle.get(a.handle)
    const stB = room.matchStateByHandle.get(b.handle)
    if (room.activeGameMode === 'SURVIVAL') {
      const aAlive = (stA?.lives ?? 3) > 0 && !stA?.isEliminated ? 1 : 0
      const bAlive = (stB?.lives ?? 3) > 0 && !stB?.isEliminated ? 1 : 0
      if (bAlive !== aAlive) return bAlive - aAlive
      if (aAlive === 0 && bAlive === 0) {
        const aOrder = stA?.eliminationOrder || 0
        const bOrder = stB?.eliminationOrder || 0
        if (aOrder !== bOrder) return bOrder - aOrder
      }
      if ((stB?.lives ?? 3) !== (stA?.lives ?? 3)) {
        return (stB?.lives ?? 3) - (stA?.lives ?? 3)
      }
    }
    return (stB?.towerHeight ?? 0) - (stA?.towerHeight ?? 0)
  })

  const cupTargetPoints = getCupTargetPoints(room.victoryCondition)
  room.cupTargetPoints = cupTargetPoints

  const winnerState = room.matchStateByHandle.get(winnerPlayer.handle)
  const isSoloEliminated =
    soloEliminated ||
    (presentPlayers.length === 1 &&
      ((winnerState?.lives ?? 3) <= 0 || Boolean(winnerState?.isEliminated)))

  const podium = sorted.map((p, idx) => {
    const st = room.matchStateByHandle.get(p.handle)
    const rank = isSoloEliminated ? 4 : idx + 1
    const pointsEarned = isSoloEliminated ? 0 : (CUP_RANK_POINTS[idx] ?? 0)
    const previousCupPoints = p.cupPoints ?? 0
    const nextCupPoints = Math.min(
      cupTargetPoints,
      previousCupPoints + pointsEarned
    )
    p.lastPointsEarned = pointsEarned
    p.cupPoints = nextCupPoints

    return {
      rank,
      userId: p.handle,
      handle: p.handle,
      customNick: p.customNick,
      equippedSkin: p.equippedSkin,
      slotIndex: p.slotIndex,
      towerHeight: st?.towerHeight ?? 0,
      lives: st?.lives ?? 3,
      eliminationOrder: st?.eliminationOrder ?? 0,
      pointsEarned,
      previousCupPoints,
      cupPoints: nextCupPoints,
      cupTargetPoints,
      isEliminated: st?.isEliminated ?? false,
      isWinner: !isSoloEliminated && p.handle === winnerPlayer.handle,
      isCupWinner: !isSoloEliminated && nextCupPoints >= cupTargetPoints,
    }
  })

  const isSingleWin = room.victoryCondition === 'SINGLE_WIN'
  const cupChampions = podium.filter((p) => (p.cupPoints ?? 0) >= cupTargetPoints)
  const isCupFinished =
    !isSoloEliminated && (isSingleWin || cupChampions.length > 0)

  let cupWinnerEntry = podium[0]
  if (isCupFinished && !isSingleWin && cupChampions.length > 0) {
    cupWinnerEntry = [...cupChampions].sort((a, b) => {
      if ((b.cupPoints ?? 0) !== (a.cupPoints ?? 0)) {
        return (b.cupPoints ?? 0) - (a.cupPoints ?? 0)
      }
      return a.rank - b.rank
    })[0]
  }

  for (const entry of podium) {
    entry.isCupWinner =
      isCupFinished && entry.handle === cupWinnerEntry?.handle
  }

  broadcastRoomState(io, room)
  io.to(room.roomId).emit('match:game_over', {
    roomId: room.roomId,
    gameMode: room.activeGameMode,
    selectedGameMode: room.selectedGameMode,
    victoryCondition: room.victoryCondition,
    cupTargetPoints,
    roundNumber: room.roundNumber,
    isCupFinished,
    roundWinnerHandle: winnerPlayer.handle,
    roundWinnerNick: winnerPlayer.customNick,
    roundWinnerSkin: winnerPlayer.equippedSkin,
    winnerId: cupWinnerEntry?.handle || winnerPlayer.handle,
    winnerHandle: cupWinnerEntry?.handle || winnerPlayer.handle,
    winnerNick: cupWinnerEntry?.customNick || winnerPlayer.customNick,
    winnerCustomNick: cupWinnerEntry?.customNick || winnerPlayer.customNick,
    winnerSkin: cupWinnerEntry?.equippedSkin || winnerPlayer.equippedSkin,
    reason: 'GOAL_REACHED',
    elapsedTimeMs,
    podium,
  })

  if (isCupFinished) {
    try {
      await connectMongoDB()
      for (const p of presentPlayers) {
        await UserModel.updateOne(
          { googleId: p.googleId },
          {
            $inc: {
              'stats.matchesPlayed': 1,
              'stats.wins': p.handle === (cupWinnerEntry?.handle || winnerPlayer.handle) ? 1 : 0,
            },
          }
        )
      }
    } catch {
      // Ignore stat update errors
    }
  }
}

function checkSurvivalLastPlayerStanding(
  io: SocketIOServer,
  room: InternalRoom
): void {
  if (room.status !== 'PLAYING') {
    return
  }

  const presentPlayers = room.slots.filter(
    (s): s is RoomSlotPlayerDTO => s !== null
  )
  if (presentPlayers.length === 0) return

  const alive = presentPlayers.filter((p) => {
    const st = room.matchStateByHandle.get(p.handle)
    return (st?.lives ?? 3) > 0 && !st?.isEliminated
  })

  if (presentPlayers.length === 1) {
    if (alive.length === 0 && presentPlayers[0]) {
      void concludeMultiplayerRound(
        io,
        room,
        presentPlayers[0].handle,
        0,
        undefined,
        true
      )
    }
    return
  }

  if (room.activeGameMode !== 'SURVIVAL') {
    return
  }

  if (alive.length > 1) return

  const winnerPlayer =
    alive[0] ||
    [...presentPlayers].sort((a, b) => {
      const stA = room.matchStateByHandle.get(a.handle)
      const stB = room.matchStateByHandle.get(b.handle)
      if ((stB?.lives ?? 0) !== (stA?.lives ?? 0)) {
        return (stB?.lives ?? 0) - (stA?.lives ?? 0)
      }
      if ((stB?.eliminationOrder ?? 0) !== (stA?.eliminationOrder ?? 0)) {
        return (stB?.eliminationOrder ?? 0) - (stA?.eliminationOrder ?? 0)
      }
      return (stB?.towerHeight ?? 0) - (stA?.towerHeight ?? 0)
    })[0]
  if (!winnerPlayer) return

  if (room.survivalClimaxWinnerHandle === winnerPlayer.handle) {
    return
  }

  room.survivalClimaxWinnerHandle = winnerPlayer.handle
  io.to(room.roomId).emit('match:survival_climax', {
    roomId: room.roomId,
    winnerHandle: winnerPlayer.handle,
    winnerCustomNick: winnerPlayer.customNick,
    winnerSkin: winnerPlayer.equippedSkin,
  })

  clearSurvivalClimaxTimer(room)
  room.survivalClimaxTimer = setTimeout(() => {
    if (room.status === 'PLAYING') {
      void concludeMultiplayerRound(io, room, winnerPlayer.handle, 0)
    }
  }, 15000)
}

function removePlayerFromRoom(
  io: SocketIOServer,
  socket: Socket,
  session: ConnectedSession
): void {
  if (!session.roomId) return
  const room = roomsById.get(session.roomId)
  socket.leave(session.roomId)
  session.roomId = null
  if (!room) return

  const idx = room.slots.findIndex((s) => s?.handle === session.handle)
  if (idx >= 0) {
    room.slots[idx] = null
  }

  abortRoomCountdown(io, room)

  const remaining = room.slots.filter(
    (s): s is RoomSlotPlayerDTO => s !== null
  )
  if (remaining.length === 0) {
    roomsById.delete(room.roomId)
    return
  }

  if (!remaining.some((s) => s.isHost)) {
    remaining[0].isHost = true
    room.hostHandle = remaining[0].handle
  }

  broadcastRoomState(io, room)
}

async function notifyFriendsPresence(
  io: SocketIOServer,
  user: IUser
): Promise<void> {
  const myHandle = normalizeHandle(user.handle)
  const myFriends = Array.isArray(user.friends) ? user.friends : []
  const onlineHandles = myFriends
    .map((f) => normalizeHandle(f.handle))
    .filter((h) => isHandleOnline(h))

  emitToHandle(io, myHandle, 'friends:online_list', {
    handles: onlineHandles,
  })

  for (const f of myFriends) {
    const fHandle = normalizeHandle(f.handle)
    if (isHandleOnline(fHandle)) {
      emitToHandle(io, fHandle, 'friend:status_changed', {
        handle: myHandle,
        customNick: user.customNick,
        online: isHandleOnline(myHandle),
      })
    }
  }
}

// ============================================================================
// 6. HTTP SERVER (/health ANTI-SLEEP) + SOCKET.IO SERVER INITIALIZATION
// ============================================================================

const httpServer = http.createServer(
  (req: IncomingMessage, res: ServerResponse) => {
    const origin = req.headers.origin
    const allowedOrigin =
      origin && isOriginAllowed(origin)
        ? origin
        : getAllowedOrigins()[0] || '*'

    res.setHeader('Access-Control-Allow-Origin', allowedOrigin)
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
    res.setHeader(
      'Access-Control-Allow-Headers',
      'Content-Type, Authorization'
    )
    res.setHeader('Access-Control-Allow-Credentials', 'true')

    if (req.method === 'OPTIONS') {
      res.writeHead(204)
      res.end()
      return
    }

    const url = (req.url || '').split('?')[0]
    if (req.method === 'GET' && (url === '/health' || url === '/')) {
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' })
      res.end(
        JSON.stringify({
          status: 'ok',
          uptime: process.uptime(),
        })
      )
      return
    }

    res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' })
    res.end(JSON.stringify({ status: 'not_found' }))
  }
)

const io = new SocketIOServer(httpServer, {
  cors: {
    origin: (origin, callback) => {
      if (isOriginAllowed(origin)) {
        callback(null, true)
      } else {
        callback(new Error(`Origin ${origin} not allowed by CORS`))
      }
    },
    methods: ['GET', 'POST'],
    credentials: true,
  },
  path: '/socket.io',
})

// Handshake Authentication (`io.use(...)`): validates JWT generated by Vercel login
io.use(async (socket, next) => {
  try {
    const token = extractSocketToken(socket)
    if (!token) {
      return next(
        new Error('AUTH_REQUIRED: Token JWT não fornecido no handshake.')
      )
    }

    const verified = verifySessionJwt(token)
    if (!verified) {
      return next(
        new Error('AUTH_INVALID: Token JWT inválido ou expirado.')
      )
    }

    await connectMongoDB()
    const userDoc = await UserModel.findOne({
      googleId: verified.googleId,
    }).lean<IUser>()

    if (!userDoc) {
      return next(
        new Error('USER_NOT_FOUND: Conta não encontrada no MongoDB.')
      )
    }

    socket.data.user = userDoc
    next()
  } catch (err) {
    next(
      err instanceof Error
        ? err
        : new Error('AUTH_ERROR: Erro interno ao validar handshake JWT.')
    )
  }
})

io.on('connection', async (socket) => {
  const user = socket.data.user as IUser | undefined
  if (!user) {
    socket.disconnect(true)
    return
  }

  const myHandle = normalizeHandle(user.handle)
  const session: ConnectedSession = {
    socketId: socket.id,
    googleId: user.googleId,
    email: user.email,
    handle: myHandle,
    customNick: user.customNick,
    equippedSkin: user.equippedSkin,
    avatarUrl: user.avatarUrl || '',
    roomId: null,
  }

  sessionsBySocketId.set(socket.id, session)
  let setForHandle = socketIdsByHandle.get(myHandle)
  if (!setForHandle) {
    setForHandle = new Set()
    socketIdsByHandle.set(myHandle, setForHandle)
  }
  setForHandle.add(socket.id)

  socket.emit('auth:user_updated', user)
  void notifyFriendsPresence(io, user)

  // --------------------------------------------------------------------------
  // PARTE 1: AMIGOS E PERFIL EM TEMPO REAL
  // --------------------------------------------------------------------------

  socket.on(
    'friend:send_request',
    async (
      payload: { query?: string },
      ack?: (res: {
        ok: boolean
        error?: string
        target?: IFriendEntry
        autoAccepted?: boolean
      }) => void
    ) => {
      try {
        await connectMongoDB()
        const rawQuery = String(payload?.query || '')
          .trim()
          .toLowerCase()
        if (!rawQuery) {
          throw new Error('Informe @nome_000 ou email.')
        }

        const senderDoc = await UserModel.findOne({
          googleId: session.googleId,
        })
        if (!senderDoc) throw new Error('Sua conta não foi localizada.')

        const isEmail = rawQuery.includes('@') && !rawQuery.startsWith('@')
        const targetDoc = await UserModel.findOne(
          isEmail
            ? { email: rawQuery }
            : { handle: normalizeHandle(rawQuery) }
        )

        if (!targetDoc) {
          throw new Error('Jogador não encontrado')
        }
        if (targetDoc.googleId === senderDoc.googleId) {
          throw new Error('Você não pode adicionar a si mesmo.')
        }

        const targetHandle = normalizeHandle(targetDoc.handle)
        if (
          senderDoc.friends.some(
            (f) => normalizeHandle(f.handle) === targetHandle
          )
        ) {
          throw new Error(`${targetDoc.customNick} já está na sua lista de amigos.`)
        }

        const senderProfile: IFriendRequestEntry = {
          handle: normalizeHandle(senderDoc.handle),
          customNick: senderDoc.customNick,
          email: senderDoc.email,
          equippedSkin: senderDoc.equippedSkin,
          requestedAt: new Date(),
        }
        const targetProfile: IFriendEntry = {
          handle: targetHandle,
          customNick: targetDoc.customNick,
          email: targetDoc.email,
          equippedSkin: targetDoc.equippedSkin,
        }

        if (
          !senderDoc.friendRequestsSent.some(
            (r) => normalizeHandle(r.handle) === targetHandle
          )
        ) {
          senderDoc.friendRequestsSent.push({
            ...targetProfile,
            requestedAt: new Date(),
          })
        }
        if (
          !targetDoc.friendRequestsReceived.some(
            (r) => normalizeHandle(r.handle) === senderProfile.handle
          )
        ) {
          targetDoc.friendRequestsReceived.push(senderProfile)
        }

        await senderDoc.save()
        await targetDoc.save()

        emitToHandle(io, session.handle, 'auth:user_updated', senderDoc.toObject())
        if (isHandleOnline(targetHandle)) {
          emitToHandle(io, targetHandle, 'auth:user_updated', targetDoc.toObject())
          emitToHandle(io, targetHandle, 'friend:request_received', senderProfile)
        }

        ack?.({
          ok: true,
          target: targetProfile,
          autoAccepted: false,
        })
      } catch (err) {
        ack?.({
          ok: false,
          error:
            err instanceof Error ? err.message : 'Jogador não encontrado',
        })
      }
    }
  )

  socket.on(
    'friend:respond_request',
    async (
      payload: { senderHandle?: string; accept?: boolean },
      ack?: (res: {
        ok: boolean
        error?: string
        acceptedFriend?: IFriendEntry
      }) => void
    ) => {
      try {
        await connectMongoDB()
        const senderH = normalizeHandle(String(payload?.senderHandle || ''))
        const accept = Boolean(payload?.accept)

        const recipientDoc = await UserModel.findOne({
          googleId: session.googleId,
        })
        const senderDoc = await UserModel.findOne({ handle: senderH })
        if (!recipientDoc || !senderDoc) {
          throw new Error('Jogador não encontrado.')
        }

        recipientDoc.friendRequestsReceived =
          recipientDoc.friendRequestsReceived.filter(
            (r) => normalizeHandle(r.handle) !== senderH
          )
        senderDoc.friendRequestsSent = senderDoc.friendRequestsSent.filter(
          (r) => normalizeHandle(r.handle) !== session.handle
        )

        let acceptedFriend: IFriendEntry | undefined
        if (accept) {
          acceptedFriend = {
            handle: senderH,
            customNick: senderDoc.customNick,
            email: senderDoc.email,
            equippedSkin: senderDoc.equippedSkin,
          }
          if (
            !recipientDoc.friends.some(
              (f) => normalizeHandle(f.handle) === senderH
            )
          ) {
            recipientDoc.friends.push(acceptedFriend)
          }
          if (
            !senderDoc.friends.some(
              (f) => normalizeHandle(f.handle) === session.handle
            )
          ) {
            senderDoc.friends.push({
              handle: session.handle,
              customNick: recipientDoc.customNick,
              email: recipientDoc.email,
              equippedSkin: recipientDoc.equippedSkin,
            })
          }
        }

        await recipientDoc.save()
        await senderDoc.save()

        const recipientObj = recipientDoc.toObject()
        const senderObj = senderDoc.toObject()

        emitToHandle(io, session.handle, 'auth:user_updated', recipientObj)
        await notifyFriendsPresence(io, recipientObj)

        if (isHandleOnline(senderH)) {
          emitToHandle(io, senderH, 'auth:user_updated', senderObj)
          await notifyFriendsPresence(io, senderObj)
          if (accept) {
            emitToHandle(io, senderH, 'friend:request_accepted', {
              handle: session.handle,
              customNick: session.customNick,
              equippedSkin: session.equippedSkin,
            })
          }
        }

        ack?.({ ok: true, acceptedFriend })
      } catch (err) {
        ack?.({
          ok: false,
          error:
            err instanceof Error
              ? err.message
              : 'Erro ao responder pedido de amizade.',
        })
      }
    }
  )

  socket.on(
    'profile:update_nick',
    async (
      payload: { customNick?: string },
      ack?: (res: { ok: boolean; error?: string; user?: IUser }) => void
    ) => {
      try {
        const cleaned = String(payload?.customNick || '').trim()
        if (cleaned.length < 2 || cleaned.length > 16) {
          throw new Error('O apelido deve ter entre 2 e 16 caracteres.')
        }
        await connectMongoDB()
        const updated = await UserModel.findOneAndUpdate(
          { googleId: session.googleId },
          { $set: { customNick: cleaned } },
          { new: true }
        ).lean<IUser>()

        if (!updated) throw new Error('Usuário não encontrado.')
        session.customNick = updated.customNick
        emitToHandle(io, session.handle, 'auth:user_updated', updated)
        await notifyFriendsPresence(io, updated)

        if (session.roomId) {
          const room = roomsById.get(session.roomId)
          if (room) {
            const slot = room.slots.find((s) => s?.handle === session.handle)
            if (slot) {
              slot.customNick = updated.customNick
              broadcastRoomState(io, room)
            }
          }
        }

        ack?.({ ok: true, user: updated })
      } catch (err) {
        ack?.({
          ok: false,
          error:
            err instanceof Error ? err.message : 'Erro ao atualizar apelido.',
        })
      }
    }
  )

  socket.on(
    'profile:update_skin',
    async (payload: { equippedSkin?: string }) => {
      const skin = String(payload?.equippedSkin || '').trim()
      if (!skin) return
      await connectMongoDB()
      const updated = await UserModel.findOneAndUpdate(
        { googleId: session.googleId },
        { $set: { equippedSkin: skin } },
        { new: true }
      ).lean<IUser>()
      if (!updated) return
      session.equippedSkin = updated.equippedSkin
      emitToHandle(io, session.handle, 'auth:user_updated', updated)
      if (session.roomId) {
        const room = roomsById.get(session.roomId)
        if (room) {
          const slot = room.slots.find((s) => s?.handle === session.handle)
          if (slot) {
            slot.equippedSkin = updated.equippedSkin
            broadcastRoomState(io, room)
          }
        }
      }
    }
  )

  // --------------------------------------------------------------------------
  // PARTE 2: SALA DE 4 SLOTS, CONVITES E PRONTO (READY)
  // --------------------------------------------------------------------------

  function safeAck<T>(maybeFn1: unknown, maybeFn2: unknown, data: T): void {
    if (typeof maybeFn2 === 'function') {
      ;(maybeFn2 as (res: T) => void)(data)
    } else if (typeof maybeFn1 === 'function') {
      ;(maybeFn1 as (res: T) => void)(data)
    }
  }

  socket.on(
    'room:enter_lobby',
    (
      payloadOrAck?: unknown,
      maybeAck?: (res: { ok: boolean; room: RoomStateDTO }) => void
    ) => {
      const reqOpts =
        payloadOrAck && typeof payloadOrAck === 'object'
          ? (payloadOrAck as {
              selectedGameMode?: RoomSelectableGameMode
              victoryCondition?: RoomVictoryCondition
            })
          : undefined

      const initialMode: RoomSelectableGameMode =
        reqOpts?.selectedGameMode === 'SURVIVAL' ||
        reqOpts?.selectedGameMode === 'RANDOM'
          ? reqOpts.selectedGameMode
          : 'RACE'

      const initialVictory: RoomVictoryCondition =
        reqOpts?.victoryCondition === 'SINGLE_WIN' ||
        reqOpts?.victoryCondition === 'CUP_12'
          ? reqOpts.victoryCondition
          : 'CUP_6'

      if (session.roomId) {
        const existing = roomsById.get(session.roomId)
        if (existing) {
          const occupiedCount = existing.slots.filter((s) => s !== null).length
          const isHostOrSolo =
            existing.hostHandle.toLowerCase() ===
              session.handle.toLowerCase() || occupiedCount <= 1

          const mySlot = existing.slots.find(
            (s) => s?.handle.toLowerCase() === session.handle.toLowerCase()
          )
          if (mySlot) {
            mySlot.isReady = false
          }

          if (isHostOrSolo) {
            abortRoomCountdown(io, existing)
            clearSurvivalClimaxTimer(existing)
            existing.status = 'LOBBY'
            if (reqOpts?.selectedGameMode) {
              existing.selectedGameMode = initialMode
              if (initialMode !== 'RANDOM') {
                existing.activeGameMode = initialMode
              }
            }
            if (reqOpts?.victoryCondition) {
              existing.victoryCondition = initialVictory
              existing.cupTargetPoints = getCupTargetPoints(initialVictory)
            }
          }
          const dto = serializeRoom(existing)
          broadcastRoomState(io, existing)
          safeAck(payloadOrAck, maybeAck, { ok: true, room: dto })
          return
        }
      }

      let roomId = generateRoomId()
      while (roomsById.has(roomId)) {
        roomId = generateRoomId()
      }

      const hostSlot: RoomSlotPlayerDTO = {
        socketId: socket.id,
        googleId: session.googleId,
        handle: session.handle,
        customNick: session.customNick,
        avatarUrl: session.avatarUrl,
        equippedSkin: session.equippedSkin,
        isHost: true,
        isReady: false,
        slotIndex: 0,
        cupPoints: 0,
        lastPointsEarned: 0,
      }

      const room: InternalRoom = {
        roomId,
        hostHandle: session.handle,
        status: 'LOBBY',
        countdownSeconds: null,
        countdownTimer: null,
        pieceSeed: null,
        selectedGameMode: initialMode,
        activeGameMode: initialMode === 'SURVIVAL' ? 'SURVIVAL' : 'RACE',
        victoryCondition: initialVictory,
        cupTargetPoints: getCupTargetPoints(initialVictory),
        roundNumber: 1,
        eliminationCounter: 0,
        survivalClimaxWinnerHandle: null,
        survivalClimaxTimer: null,
        slots: [hostSlot, null, null, null],
        matchStateByHandle: new Map(),
      }

      roomsById.set(roomId, room)
      session.roomId = roomId
      socket.join(roomId)

      const dto = serializeRoom(room)
      socket.emit('room:state_updated', dto)
      safeAck(payloadOrAck, maybeAck, { ok: true, room: dto })
    }
  )

  socket.on(
    'room:set_game_mode',
    (
      payload: { gameMode?: RoomSelectableGameMode },
      ack?: (res: { ok: boolean; error?: string; room?: RoomStateDTO }) => void
    ) => {
      if (!session.roomId) {
        safeAck(payload, ack, { ok: false, error: 'Você não está em uma sala.' })
        return
      }
      const room = roomsById.get(session.roomId)
      if (!room) {
        safeAck(payload, ack, { ok: false, error: 'Sala não encontrada.' })
        return
      }
      const occupiedCount = room.slots.filter((s) => s !== null).length
      if (room.status === 'PLAYING' && occupiedCount > 1) {
        safeAck(payload, ack, {
          ok: false,
          error: 'Não é possível mudar o modo com a partida em andamento.',
        })
        return
      }
      if (room.status === 'PLAYING' && occupiedCount <= 1) {
        clearSurvivalClimaxTimer(room)
        room.status = 'LOBBY'
      }
      const requested = payload?.gameMode
      const nextMode: RoomSelectableGameMode =
        requested === 'SURVIVAL' || requested === 'RANDOM' ? requested : 'RACE'
      room.selectedGameMode = nextMode
      if (nextMode !== 'RANDOM') {
        room.activeGameMode = nextMode
      }
      broadcastRoomState(io, room)
      safeAck(payload, ack, { ok: true, room: serializeRoom(room) })
    }
  )

  socket.on(
    'room:set_victory_condition',
    (
      payload: { victoryCondition?: RoomVictoryCondition },
      ack?: (res: { ok: boolean; error?: string; room?: RoomStateDTO }) => void
    ) => {
      if (!session.roomId) {
        safeAck(payload, ack, { ok: false, error: 'Você não está em uma sala.' })
        return
      }
      const room = roomsById.get(session.roomId)
      if (!room) {
        safeAck(payload, ack, { ok: false, error: 'Sala não encontrada.' })
        return
      }
      const occupiedCount = room.slots.filter((s) => s !== null).length
      if (room.status === 'PLAYING' && occupiedCount > 1) {
        safeAck(payload, ack, {
          ok: false,
          error: 'Não é possível mudar a condição de vitória durante a partida.',
        })
        return
      }
      if (room.status === 'PLAYING' && occupiedCount <= 1) {
        clearSurvivalClimaxTimer(room)
        room.status = 'LOBBY'
      }
      const requested = payload?.victoryCondition
      const nextCondition: RoomVictoryCondition =
        requested === 'SINGLE_WIN' || requested === 'CUP_12'
          ? requested
          : 'CUP_6'
      room.victoryCondition = nextCondition
      room.cupTargetPoints = getCupTargetPoints(nextCondition)
      broadcastRoomState(io, room)
      safeAck(payload, ack, { ok: true, room: serializeRoom(room) })
    }
  )

  socket.on(
    'room:invite_friend',
    (
      payload: { friendHandle?: string; preferredSlotIndex?: number },
      ack?: (res: { ok: boolean; error?: string }) => void
    ) => {
      if (!session.roomId) {
        ack?.({ ok: false, error: 'Você não está em uma sala.' })
        return
      }
      const room = roomsById.get(session.roomId)
      if (!room) {
        ack?.({ ok: false, error: 'Sala não encontrada.' })
        return
      }
      const friendH = normalizeHandle(String(payload?.friendHandle || ''))
      if (!isHandleOnline(friendH)) {
        ack?.({ ok: false, error: 'Este amigo está OFFLINE no momento.' })
        return
      }

      emitToHandle(io, friendH, 'room:invite_received', {
        roomId: room.roomId,
        hostHandle: session.handle,
        hostCustomNick: session.customNick,
        hostSkin: session.equippedSkin,
        preferredSlotIndex: payload?.preferredSlotIndex,
        invitedAt: new Date().toISOString(),
      })

      ack?.({ ok: true })
    }
  )

  socket.on(
    'room:accept_invite',
    (
      payload: { roomId?: string; preferredSlotIndex?: number },
      ack?: (res: {
        ok: boolean
        room?: RoomStateDTO
        error?: string
      }) => void
    ) => {
      const targetRoomId = String(payload?.roomId || '').trim()
      const room = roomsById.get(targetRoomId)
      if (!room || room.status === 'PLAYING') {
        ack?.({
          ok: false,
          error: 'A sala não está mais disponível ou já iniciou a partida.',
        })
        return
      }

      if (session.roomId && session.roomId !== targetRoomId) {
        removePlayerFromRoom(io, socket, session)
      }

      let slotIdx = room.slots.findIndex((s) => s?.handle === session.handle)
      if (slotIdx === -1) {
        const pref = payload?.preferredSlotIndex
        if (
          typeof pref === 'number' &&
          pref >= 0 &&
          pref < 4 &&
          room.slots[pref] === null
        ) {
          slotIdx = pref
        } else {
          slotIdx = room.slots.findIndex((s) => s === null)
        }
      }

      if (slotIdx === -1) {
        ack?.({ ok: false, error: 'A sala está cheia (4/4 jogadores).' })
        return
      }

      room.slots[slotIdx] = {
        socketId: socket.id,
        googleId: session.googleId,
        handle: session.handle,
        customNick: session.customNick,
        avatarUrl: session.avatarUrl,
        equippedSkin: session.equippedSkin,
        isHost: room.hostHandle === session.handle,
        isReady: false,
        slotIndex: slotIdx,
      }

      session.roomId = room.roomId
      socket.join(room.roomId)
      abortRoomCountdown(io, room)
      broadcastRoomState(io, room)
      ack?.({ ok: true, room: serializeRoom(room) })
    }
  )

  socket.on('room:decline_invite', (payload: { roomId?: string }) => {
    const room = roomsById.get(String(payload?.roomId || ''))
    if (!room) return
    emitToHandle(io, room.hostHandle, 'room:invite_declined', {
      handle: session.handle,
      customNick: session.customNick,
    })
  })

  socket.on(
    'room:toggle_ready',
    (
      payload: {
        isReady?: boolean
        selectedGameMode?: RoomSelectableGameMode
        victoryCondition?: RoomVictoryCondition
      },
      ack?: (res: { ok: boolean; room?: RoomStateDTO; error?: string }) => void
    ) => {
      if (!session.roomId) {
        safeAck(payload, ack, { ok: false, error: 'Você não está em uma sala.' })
        return
      }
      const room = roomsById.get(session.roomId)
      if (!room) {
        safeAck(payload, ack, { ok: false, error: 'Sala não encontrada.' })
        return
      }

      // Only the player themselves can toggle their own Ready status
      const mySlot = room.slots.find((s) => s?.handle === session.handle)
      if (!mySlot) {
        safeAck(payload, ack, { ok: false, error: 'Slot não encontrado na sala.' })
        return
      }

      const occupiedCount = room.slots.filter((s) => s !== null).length
      const isHostOrSolo =
        room.hostHandle.toLowerCase() === session.handle.toLowerCase() ||
        occupiedCount <= 1

      if (payload && typeof payload === 'object' && isHostOrSolo) {
        if (
          payload.selectedGameMode === 'RACE' ||
          payload.selectedGameMode === 'SURVIVAL' ||
          payload.selectedGameMode === 'RANDOM'
        ) {
          room.selectedGameMode = payload.selectedGameMode
          if (payload.selectedGameMode !== 'RANDOM') {
            room.activeGameMode = payload.selectedGameMode
          }
        }
        if (
          payload.victoryCondition === 'SINGLE_WIN' ||
          payload.victoryCondition === 'CUP_6' ||
          payload.victoryCondition === 'CUP_12'
        ) {
          room.victoryCondition = payload.victoryCondition
          room.cupTargetPoints = getCupTargetPoints(payload.victoryCondition)
        }
      }

      if (room.status === 'PLAYING' && occupiedCount <= 1) {
        clearSurvivalClimaxTimer(room)
        room.status = 'LOBBY'
      }

      mySlot.isReady =
        typeof payload?.isReady === 'boolean'
          ? payload.isReady
          : !mySlot.isReady

      checkAndStartRoomCountdown(io, room)
      safeAck(payload, ack, { ok: true, room: serializeRoom(room) })
    }
  )

  socket.on('room:leave', () => {
    removePlayerFromRoom(io, socket, session)
  })

  // --------------------------------------------------------------------------
  // PARTE 3: PARTIDA ONLINE EM TEMPO REAL (20HZ SYNC + PODERES + PÓDIO)
  // --------------------------------------------------------------------------

  socket.on('match:sync_state', (payload: Record<string, unknown>) => {
    if (!session.roomId) return
    const room = roomsById.get(session.roomId)
    if (!room) return

    const mySlot = room.slots.find((s) => s?.handle === session.handle)
    const towerHeight = Number(payload?.towerHeight || 0)
    const lives = Number(payload?.lives ?? 3)
    const isEliminated = Boolean(payload?.isEliminated) || lives <= 0
    const prev = room.matchStateByHandle.get(session.handle)
    let eliminationOrder = prev?.eliminationOrder ?? 0
    if (lives <= 0 && eliminationOrder === 0) {
      room.eliminationCounter += 1
      eliminationOrder = room.eliminationCounter
    }

    room.matchStateByHandle.set(session.handle, {
      towerHeight,
      lives,
      isEliminated,
      eliminationOrder,
    })

    if (lives <= 0) {
      checkSurvivalLastPlayerStanding(io, room)
    }

    socket.to(room.roomId).emit('match:player_state_updated', {
      handle: session.handle,
      customNick: session.customNick,
      equippedSkin: session.equippedSkin,
      slotIndex: mySlot?.slotIndex ?? 0,
      activePiece: payload?.activePiece ?? null,
      settledBlocks: payload?.settledBlocks ?? [],
      towerHeight,
      lives,
      mana: Number(payload?.mana || 0),
      activeDebuffs: Array.isArray(payload?.activeDebuffs)
        ? payload.activeDebuffs
        : [],
      blindManualRemainingMs: Number(payload?.blindManualRemainingMs || 0),
      fogAnchorX: Number(payload?.fogAnchorX || 0),
      fogAnchorY: Number(payload?.fogAnchorY ?? 2.2),
      islands: Array.isArray(payload?.islands) ? payload.islands : [],
      isEliminated,
      eliminationOrder,
      updatedAt: Date.now(),
    })
  })

  socket.on(
    'match:piece_settled',
    (payload: { towerHeight?: number; pieceCount?: number }) => {
      if (!session.roomId) return
      socket.to(session.roomId).emit('match:piece_settled', {
        handle: session.handle,
        towerHeight: Number(payload?.towerHeight || 0),
        pieceCount: Number(payload?.pieceCount || 0),
      })
    }
  )

  socket.on('match:life_lost', (payload: { lives?: number }) => {
    if (!session.roomId) return
    const room = roomsById.get(session.roomId)
    const lives = Number(payload?.lives ?? 0)
    let eliminationOrder = 0
    if (room) {
      const prev = room.matchStateByHandle.get(session.handle)
      eliminationOrder = prev?.eliminationOrder ?? 0
      if (lives <= 0 && eliminationOrder === 0) {
        room.eliminationCounter += 1
        eliminationOrder = room.eliminationCounter
      }
      room.matchStateByHandle.set(session.handle, {
        towerHeight: prev?.towerHeight ?? 0,
        lives,
        isEliminated: lives <= 0,
        eliminationOrder,
      })
    }
    socket.to(session.roomId).emit('match:life_lost', {
      handle: session.handle,
      lives,
      isEliminated: lives <= 0,
      eliminationOrder,
    })
    if (room && lives <= 0) {
      checkSurvivalLastPlayerStanding(io, room)
    }
  })

  socket.on('match:use_positive_power', (payload: { powerType?: string }) => {
    if (!session.roomId) return
    const room = roomsById.get(session.roomId)
    if (!room) return
    const mySlot = room.slots.find((s) => s?.handle === session.handle)
    io.to(room.roomId).emit('match:apply_power_vfx', {
      casterHandle: session.handle,
      casterNick: session.customNick,
      casterSlotIndex: mySlot?.slotIndex ?? 0,
      category: 'POSITIVE',
      powerType: String(payload?.powerType || ''),
      targetHandles: [session.handle],
    })
  })

  socket.on(
    'match:use_negative_power',
    (payload: { powerType?: string; targetId?: string }) => {
      if (!session.roomId) return
      const room = roomsById.get(session.roomId)
      if (!room) return
      const mySlot = room.slots.find((s) => s?.handle === session.handle)
      const opponents = room.slots
        .filter(
          (s): s is RoomSlotPlayerDTO =>
            s !== null && s.handle !== session.handle
        )
        .map((s) => s.handle)

      const targetHandles = payload?.targetId
        ? [normalizeHandle(payload.targetId)]
        : opponents

      io.to(room.roomId).emit('match:apply_power_vfx', {
        casterHandle: session.handle,
        casterNick: session.customNick,
        casterSlotIndex: mySlot?.slotIndex ?? 0,
        category: 'NEGATIVE',
        powerType: String(payload?.powerType || ''),
        targetHandles,
      })
    }
  )

  socket.on(
    'match:claim_victory',
    async (payload: {
      towerHeight?: number
      elapsedTimeMs?: number
      eliminationOrderByHandle?: Record<string, number>
    }) => {
      if (!session.roomId) return
      const room = roomsById.get(session.roomId)
      if (!room || room.status === 'FINISHED') return

      const prev = room.matchStateByHandle.get(session.handle)
      const winHeight = Number(payload?.towerHeight ?? prev?.towerHeight ?? 30)
      room.matchStateByHandle.set(session.handle, {
        towerHeight: winHeight,
        lives: Math.max(1, prev?.lives ?? 3),
        isEliminated: false,
        eliminationOrder: 0,
      })

      await concludeMultiplayerRound(
        io,
        room,
        session.handle,
        Number(payload?.elapsedTimeMs || 0),
        payload?.eliminationOrderByHandle
      )
    }
  )

  socket.on('match:next_cup_round', () => {
    if (!session.roomId) return
    const room = roomsById.get(session.roomId)
    if (!room) return
    const presentPlayers = room.slots.filter(
      (s): s is RoomSlotPlayerDTO => s !== null
    )
    if (room.status !== 'FINISHED' && presentPlayers.length > 1) return

    const cupTargetPoints = getCupTargetPoints(room.victoryCondition)
    const hasCupWinner = presentPlayers.some(
      (s) => (s.cupPoints ?? 0) >= cupTargetPoints
    )
    if (hasCupWinner) return

    clearSurvivalClimaxTimer(room)
    room.survivalClimaxWinnerHandle = null
    room.eliminationCounter = 0
    room.status = 'PLAYING'
    room.roundNumber += 1
    room.cupTargetPoints = cupTargetPoints
    room.pieceSeed = generatePieceSeed()
    room.activeGameMode =
      room.selectedGameMode === 'RANDOM'
        ? Math.random() < 0.5
          ? 'RACE'
          : 'SURVIVAL'
        : room.selectedGameMode

    room.matchStateByHandle.clear()
    for (const p of presentPlayers) {
      p.lastPointsEarned = 0
      room.matchStateByHandle.set(p.handle, {
        towerHeight: 0,
        lives: 3,
        isEliminated: false,
        eliminationOrder: 0,
      })
    }

    broadcastRoomState(io, room)
    io.to(room.roomId).emit('match:start', {
      roomId: room.roomId,
      pieceSeed: room.pieceSeed,
      gameMode: room.activeGameMode,
      selectedGameMode: room.selectedGameMode,
      victoryCondition: room.victoryCondition,
      cupTargetPoints: room.cupTargetPoints,
      roundNumber: room.roundNumber,
      startedAt: new Date().toISOString(),
      players: presentPlayers.map((p) => ({
        handle: p.handle,
        customNick: p.customNick,
        equippedSkin: p.equippedSkin,
        slotIndex: p.slotIndex,
        isHost: p.isHost,
        cupPoints: p.cupPoints ?? 0,
        lastPointsEarned: 0,
      })),
    })
  })

  socket.on('match:return_to_lobby', () => {
    if (!session.roomId) return
    const room = roomsById.get(session.roomId)
    if (!room) return

    clearSurvivalClimaxTimer(room)
    room.survivalClimaxWinnerHandle = null
    room.eliminationCounter = 0
    room.status = 'LOBBY'
    room.countdownSeconds = null
    room.pieceSeed = null
    room.roundNumber = 1
    for (const s of room.slots) {
      if (s) {
        s.isReady = false
        s.cupPoints = 0
        s.lastPointsEarned = 0
      }
    }

    const dto = serializeRoom(room)
    io.to(room.roomId).emit('match:return_to_lobby', {
      roomId: room.roomId,
      room: dto,
    })
    io.to(room.roomId).emit('room:state_updated', dto)
  })

  socket.on('disconnect', async () => {
    removePlayerFromRoom(io, socket, session)
    sessionsBySocketId.delete(socket.id)

    const set = socketIdsByHandle.get(session.handle)
    if (set) {
      set.delete(socket.id)
      if (set.size === 0) {
        socketIdsByHandle.delete(session.handle)
      }
    }

    await notifyFriendsPresence(io, user)
  })
})

const PORT = Number(process.env.PORT || 4000)
httpServer.listen(PORT, () => {
  console.log(
    `[Toy Tower Socket.io Server] Listening on port ${PORT} (Health check: GET /health)`
  )
})
