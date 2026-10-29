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
}

interface RoomStateDTO {
  roomId: string
  hostHandle: string
  status: 'LOBBY' | 'COUNTDOWN' | 'PLAYING' | 'FINISHED'
  countdownSeconds: number | null
  pieceSeed: string | null
  slots: Array<RoomSlotPlayerDTO | null>
}

interface InternalRoom {
  roomId: string
  hostHandle: string
  status: 'LOBBY' | 'COUNTDOWN' | 'PLAYING' | 'FINISHED'
  countdownSeconds: number | null
  countdownTimer: ReturnType<typeof setInterval> | null
  pieceSeed: string | null
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
    occupied.length >= 2 && occupied.every((s) => s.isReady === true)

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
      currentOccupied.length < 2 ||
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
    room.pieceSeed = generatePieceSeed()
    room.matchStateByHandle.clear()
    for (const p of currentOccupied) {
      room.matchStateByHandle.set(p.handle, {
        towerHeight: 0,
        lives: 3,
        isEliminated: false,
      })
    }

    broadcastRoomState(io, room)
    io.to(room.roomId).emit('match:start', {
      roomId: room.roomId,
      pieceSeed: room.pieceSeed,
      startedAt: new Date().toISOString(),
      players: currentOccupied.map((p) => ({
        handle: p.handle,
        customNick: p.customNick,
        equippedSkin: p.equippedSkin,
        slotIndex: p.slotIndex,
        isHost: p.isHost,
      })),
    })
  }, 1000)
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
  await notifyFriendsPresence(io, user)

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

  socket.on(
    'room:enter_lobby',
    (ack?: (res: { ok: boolean; room: RoomStateDTO }) => void) => {
      if (session.roomId) {
        const existing = roomsById.get(session.roomId)
        if (existing) {
          const dto = serializeRoom(existing)
          socket.emit('room:state_updated', dto)
          ack?.({ ok: true, room: dto })
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
      }

      const room: InternalRoom = {
        roomId,
        hostHandle: session.handle,
        status: 'LOBBY',
        countdownSeconds: null,
        countdownTimer: null,
        pieceSeed: null,
        slots: [hostSlot, null, null, null],
        matchStateByHandle: new Map(),
      }

      roomsById.set(roomId, room)
      session.roomId = roomId
      socket.join(roomId)

      const dto = serializeRoom(room)
      socket.emit('room:state_updated', dto)
      ack?.({ ok: true, room: dto })
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
      payload: { isReady?: boolean },
      ack?: (res: { ok: boolean; room?: RoomStateDTO; error?: string }) => void
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

      // Only the player themselves can toggle their own Ready status
      const mySlot = room.slots.find((s) => s?.handle === session.handle)
      if (!mySlot) {
        ack?.({ ok: false, error: 'Slot não encontrado na sala.' })
        return
      }

      mySlot.isReady =
        typeof payload?.isReady === 'boolean'
          ? payload.isReady
          : !mySlot.isReady

      checkAndStartRoomCountdown(io, room)
      ack?.({ ok: true, room: serializeRoom(room) })
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
    const isEliminated = Boolean(payload?.isEliminated)

    room.matchStateByHandle.set(session.handle, {
      towerHeight,
      lives,
      isEliminated,
    })

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
      isEliminated,
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
    const lives = Number(payload?.lives ?? 0)
    socket.to(session.roomId).emit('match:life_lost', {
      handle: session.handle,
      lives,
      isEliminated: lives <= 0,
    })
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
    async (payload: { towerHeight?: number; elapsedTimeMs?: number }) => {
      if (!session.roomId) return
      const room = roomsById.get(session.roomId)
      if (!room || room.status === 'FINISHED') return

      room.status = 'FINISHED'
      const winHeight = Number(payload?.towerHeight || 30)
      room.matchStateByHandle.set(session.handle, {
        towerHeight: winHeight,
        lives: 3,
        isEliminated: false,
      })

      const presentPlayers = room.slots.filter(
        (s): s is RoomSlotPlayerDTO => s !== null
      )

      const sorted = [...presentPlayers].sort((a, b) => {
        if (a.handle === session.handle) return -1
        if (b.handle === session.handle) return 1
        const ha = room.matchStateByHandle.get(a.handle)?.towerHeight ?? 0
        const hb = room.matchStateByHandle.get(b.handle)?.towerHeight ?? 0
        return hb - ha
      })

      const podium = sorted.map((p, idx) => {
        const st = room.matchStateByHandle.get(p.handle)
        return {
          rank: idx + 1,
          userId: p.handle,
          handle: p.handle,
          customNick: p.customNick,
          equippedSkin: p.equippedSkin,
          slotIndex: p.slotIndex,
          towerHeight: st?.towerHeight ?? 0,
          lives: st?.lives ?? 3,
          isEliminated: st?.isEliminated ?? false,
          isWinner: p.handle === session.handle,
        }
      })

      io.to(room.roomId).emit('match:game_over', {
        roomId: room.roomId,
        winnerId: session.handle,
        winnerHandle: session.handle,
        winnerNick: session.customNick,
        winnerCustomNick: session.customNick,
        winnerSkin: session.equippedSkin,
        reason: 'GOAL_REACHED',
        elapsedTimeMs: Number(payload?.elapsedTimeMs || 0),
        podium,
      })

      // Update MongoDB stats asynchronously
      try {
        await connectMongoDB()
        for (const p of presentPlayers) {
          await UserModel.updateOne(
            { googleId: p.googleId },
            {
              $inc: {
                'stats.matchesPlayed': 1,
                'stats.wins': p.handle === session.handle ? 1 : 0,
              },
            }
          )
        }
      } catch {
        // Ignore stat update errors
      }
    }
  )

  socket.on('match:return_to_lobby', () => {
    if (!session.roomId) return
    const room = roomsById.get(session.roomId)
    if (!room) return

    room.status = 'LOBBY'
    room.countdownSeconds = null
    room.pieceSeed = null
    for (const s of room.slots) {
      if (s) s.isReady = false
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
