import type { Server as HttpServer, IncomingMessage } from 'node:http'
import { Server as SocketIOServer, type Socket } from 'socket.io'
import {
  extractRequestToken,
  findUserByGoogleId,
  recordMatchStats,
  respondToFriendRequest,
  sendFriendRequest,
  updateUserCustomNick,
  updateUserEquippedSkin,
  verifySessionJwt,
} from '../authController'
import type { IUser } from '../models/User'

export interface RoomSlotDTO {
  slotIndex: number // 0..3
  state: 'EMPTY' | 'JOINED_UNREADY' | 'READY'
  isHost: boolean
  isReady: boolean
  handle: string
  customNick: string
  equippedSkin: string
  avatarUrl: string
  silhouetteSkin: string
  cupPoints: number
  lastPointsEarned: number
}

export type RoomSelectableGameMode = 'RACE' | 'SURVIVAL' | 'RANDOM'
export type RoomActiveGameMode = 'RACE' | 'SURVIVAL'
export type RoomVictoryCondition = 'SINGLE_WIN' | 'CUP_6' | 'CUP_12'

const TRICKY_TOWERS_RANK_POINTS = [3, 2, 1, 0] as const

function getCupTargetPoints(victoryCondition: RoomVictoryCondition): number {
  if (victoryCondition === 'CUP_6') return 6
  if (victoryCondition === 'CUP_12') return 12
  return 3
}

export interface RoomStateDTO {
  roomId: string
  hostHandle: string
  status: 'LOBBY' | 'COUNTDOWN' | 'IN_MATCH' | 'POST_MATCH'
  countdownSeconds: number | null
  selectedGameMode: RoomSelectableGameMode
  activeGameMode: RoomActiveGameMode
  victoryCondition: RoomVictoryCondition
  cupTargetPoints: number
  roundNumber: number
  slots: RoomSlotDTO[]
}

export interface MatchLaneSyncPayload {
  roomId: string
  handle: string
  customNick: string
  equippedSkin: string
  slotIndex: number
  towerHeight: number
  lives: number
  remainingPieces: number
  state: string
  goalCountdownMs: number | null
  elapsedTimeMs: number
  blindManualRemainingMs: number
  inventoryPower: {
    selfPower: string | null
    attackPower: string | null
    sourceCheckpoint: number | null
  }
  activePiece: {
    type: string
    variant: string
    powerEffect: string
    colorPaletteIndex?: number
    x: number
    y: number
    angle: number
  } | null
  settledBlocks: Array<{
    id: number
    type: string
    variant: string
    powerEffect: string
    colorPaletteIndex?: number
    x: number
    y: number
    angle: number
    snapped: boolean
    sleeping: boolean
    isStaticAnchor?: boolean
    isGlued?: boolean
  }>
  islands?: Array<{
    id: string
    side: 'LEFT' | 'RIGHT'
    x: number
    y: number
    width: number
    height: number
  }>
}

export interface PodiumEntryDTO {
  rank: number // 1..4
  handle: string
  customNick: string
  equippedSkin: string
  towerHeight: number
  lives: number
  eliminationOrder?: number
  isEliminated?: boolean
  pointsEarned: number
  previousCupPoints: number
  cupPoints: number
  cupTargetPoints: number
  isWinner: boolean
  isCupWinner: boolean
}

interface InternalRoomSlot {
  slotIndex: number
  handle: string | null
  googleId: string | null
  customNick: string
  equippedSkin: string
  avatarUrl: string
  isHost: boolean
  isReady: boolean
  silhouetteSkin: string
  lastTowerHeight: number
  lastLives: number
  eliminationOrder: number
  cupPoints: number
  lastPointsEarned: number
}

interface InternalRoom {
  roomId: string
  hostHandle: string
  status: 'LOBBY' | 'COUNTDOWN' | 'IN_MATCH' | 'POST_MATCH'
  countdownSeconds: number | null
  countdownTimer: ReturnType<typeof setInterval> | null
  pieceSeed: string | null
  selectedGameMode: RoomSelectableGameMode
  activeGameMode: RoomActiveGameMode
  victoryCondition: RoomVictoryCondition
  cupTargetPoints: number
  roundNumber: number
  eliminationCounter: number
  survivalClimaxWinnerHandle: string | null
  survivalClimaxTimer: ReturnType<typeof setTimeout> | null
  slots: [InternalRoomSlot, InternalRoomSlot, InternalRoomSlot, InternalRoomSlot]
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

const DEFAULT_SILHOUETTES = ['DARK_MAGE', 'DINO', 'PIRATE', 'WIZARD']

let ioInstance: SocketIOServer | null = null
const sessionsBySocketId = new Map<string, ConnectedSession>()
const socketIdsByHandle = new Map<string, Set<string>>()
const roomsById = new Map<string, InternalRoom>()

function generateRoomId(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  let code = 'SALA-'
  for (let i = 0; i < 4; i++) {
    code += chars[Math.floor(Math.random() * chars.length)]
  }
  return code
}

function generateSharedPieceSeed(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  let token = 'TOY-'
  for (let i = 0; i < 6; i++) {
    token += chars[Math.floor(Math.random() * chars.length)]
  }
  return token
}

function isHandleOnline(handle: string): boolean {
  const set = socketIdsByHandle.get(handle.toLowerCase())
  return Boolean(set && set.size > 0)
}

function emitToHandle(handle: string, event: string, payload: unknown): void {
  if (!ioInstance) return
  const set = socketIdsByHandle.get(handle.toLowerCase())
  if (!set) return
  for (const sid of set) {
    ioInstance.to(sid).emit(event, payload)
  }
}

function serializeRoom(room: InternalRoom): RoomStateDTO {
  return {
    roomId: room.roomId,
    hostHandle: room.hostHandle,
    status: room.status,
    countdownSeconds: room.countdownSeconds,
    selectedGameMode: room.selectedGameMode,
    activeGameMode: room.activeGameMode,
    victoryCondition: room.victoryCondition,
    cupTargetPoints: room.cupTargetPoints,
    roundNumber: room.roundNumber,
    slots: room.slots.map((s) => ({
      slotIndex: s.slotIndex,
      state: !s.handle
        ? 'EMPTY'
        : s.isReady
          ? 'READY'
          : 'JOINED_UNREADY',
      isHost: s.isHost,
      isReady: s.isReady,
      handle: s.handle || '',
      customNick: s.customNick,
      equippedSkin: s.equippedSkin,
      avatarUrl: s.avatarUrl,
      silhouetteSkin: s.silhouetteSkin,
      cupPoints: s.cupPoints,
      lastPointsEarned: s.lastPointsEarned,
    })),
  }
}

function broadcastRoomState(room: InternalRoom): void {
  if (!ioInstance) return
  const dto = serializeRoom(room)
  ioInstance.to(room.roomId).emit('room:state_updated', dto)
}

function abortRoomCountdown(room: InternalRoom, reason?: string): void {
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
  if (wasCounting && ioInstance) {
    ioInstance.to(room.roomId).emit('room:countdown_aborted', {
      roomId: room.roomId,
      reason: reason || 'Contagem regressiva cancelada.',
    })
  }
}

function startRoomCountdownIfEligible(room: InternalRoom): void {
  const occupied = room.slots.filter((s) => Boolean(s.handle))
  // Inicia contagem regressiva de 3s quando todos os jogadores presentes na sala (1 a 4) estiverem com isReady: true
  const allReady =
    occupied.length >= 1 && occupied.every((s) => s.isReady === true)

  if (!allReady) {
    abortRoomCountdown(room)
    broadcastRoomState(room)
    return
  }

  if (room.countdownTimer) {
    return
  }

  room.status = 'COUNTDOWN'
  room.countdownSeconds = 3
  broadcastRoomState(room)
  ioInstance?.to(room.roomId).emit('room:countdown_tick', {
    roomId: room.roomId,
    seconds: 3,
  })

  room.countdownTimer = setInterval(() => {
    const currentOccupied = room.slots.filter((s) => Boolean(s.handle))
    if (
      currentOccupied.length < 1 ||
      !currentOccupied.every((s) => s.isReady)
    ) {
      abortRoomCountdown(room)
      broadcastRoomState(room)
      return
    }

    if (room.countdownSeconds === null) {
      abortRoomCountdown(room)
      return
    }

    room.countdownSeconds -= 1

    if (room.countdownSeconds > 0) {
      broadcastRoomState(room)
      ioInstance?.to(room.roomId).emit('room:countdown_tick', {
        roomId: room.roomId,
        seconds: room.countdownSeconds,
      })
    } else {
      if (room.countdownTimer) {
        clearInterval(room.countdownTimer)
        room.countdownTimer = null
      }
      room.countdownSeconds = null
      room.status = 'IN_MATCH'
      room.roundNumber = 1
      room.eliminationCounter = 0
      room.survivalClimaxWinnerHandle = null
      clearSurvivalClimaxTimer(room)
      room.cupTargetPoints = getCupTargetPoints(room.victoryCondition)
      room.pieceSeed = generateSharedPieceSeed()
      room.activeGameMode =
        room.selectedGameMode === 'RANDOM'
          ? Math.random() < 0.5
            ? 'RACE'
            : 'SURVIVAL'
          : room.selectedGameMode

      for (const s of room.slots) {
        s.lastTowerHeight = 0
        s.lastLives = 3
        s.eliminationOrder = 0
        s.cupPoints = 0
        s.lastPointsEarned = 0
      }

      const players = room.slots
        .filter((s) => Boolean(s.handle))
        .map((s) => ({
          slotIndex: s.slotIndex,
          handle: s.handle!,
          customNick: s.customNick,
          equippedSkin: s.equippedSkin,
          avatarUrl: s.avatarUrl,
          isHost: s.isHost,
          cupPoints: s.cupPoints,
          lastPointsEarned: s.lastPointsEarned,
        }))

      broadcastRoomState(room)
      ioInstance?.to(room.roomId).emit('match:start', {
        roomId: room.roomId,
        pieceSeed: room.pieceSeed,
        gameMode: room.activeGameMode,
        selectedGameMode: room.selectedGameMode,
        victoryCondition: room.victoryCondition,
        cupTargetPoints: room.cupTargetPoints,
        roundNumber: room.roundNumber,
        players,
      })
    }
  }, 1000)
}

function clearSurvivalClimaxTimer(room: InternalRoom): void {
  if (room.survivalClimaxTimer) {
    clearTimeout(room.survivalClimaxTimer)
    room.survivalClimaxTimer = null
  }
}

function markSlotEliminatedIfNeeded(
  room: InternalRoom,
  slot: InternalRoomSlot
): void {
  if (slot.lastLives <= 0 && slot.eliminationOrder === 0) {
    room.eliminationCounter += 1
    slot.eliminationOrder = room.eliminationCounter
  }
}

async function concludeMultiplayerRound(
  room: InternalRoom,
  winnerSlot: InternalRoomSlot,
  elapsedTimeMs: number,
  clientEliminationOrders?: Record<string, number>
): Promise<void> {
  if (!winnerSlot.handle) return
  clearSurvivalClimaxTimer(room)
  room.survivalClimaxWinnerHandle = null
  room.status = 'POST_MATCH'
  const occupied = room.slots.filter((s) => Boolean(s.handle))

  if (clientEliminationOrders) {
    for (const s of occupied) {
      if (s.handle && s.lastLives <= 0 && s.eliminationOrder === 0) {
        const clientOrder =
          clientEliminationOrders[s.handle.toLowerCase()] ??
          clientEliminationOrders[s.handle]
        if (typeof clientOrder === 'number' && clientOrder > 0) {
          s.eliminationOrder = clientOrder
        }
      }
    }
  }

  const sorted = [...occupied].sort((a, b) => {
    if (a.handle === winnerSlot.handle) return -1
    if (b.handle === winnerSlot.handle) return 1
    if (room.activeGameMode === 'SURVIVAL') {
      const aAlive = a.lastLives > 0 ? 1 : 0
      const bAlive = b.lastLives > 0 ? 1 : 0
      if (bAlive !== aAlive) return bAlive - aAlive
      // Both eliminated: the player who died LATER (higher eliminationOrder) ranks higher;
      // the player who died FIRST (eliminationOrder = 1) ranks last!
      if (aAlive === 0 && bAlive === 0) {
        const aOrder = a.eliminationOrder || 0
        const bOrder = b.eliminationOrder || 0
        if (aOrder !== bOrder) return bOrder - aOrder
      }
      if (b.lastLives !== a.lastLives) return b.lastLives - a.lastLives
    }
    return b.lastTowerHeight - a.lastTowerHeight
  })

  const cupTargetPoints = getCupTargetPoints(room.victoryCondition)
  room.cupTargetPoints = cupTargetPoints

  const podium: PodiumEntryDTO[] = sorted.map((s, idx) => {
    const pointsEarned = TRICKY_TOWERS_RANK_POINTS[idx] ?? 0
    const previousCupPoints = s.cupPoints
    const nextCupPoints = Math.min(cupTargetPoints, s.cupPoints + pointsEarned)
    s.cupPoints = nextCupPoints
    s.lastPointsEarned = pointsEarned
    return {
      rank: idx + 1,
      handle: s.handle!,
      customNick: s.customNick,
      equippedSkin: s.equippedSkin,
      towerHeight: Number(s.lastTowerHeight.toFixed(1)),
      lives: s.lastLives,
      eliminationOrder: s.eliminationOrder,
      isEliminated: room.activeGameMode === 'SURVIVAL' && s.lastLives <= 0,
      pointsEarned,
      previousCupPoints,
      cupPoints: nextCupPoints,
      cupTargetPoints,
      isWinner: s.handle === winnerSlot.handle,
      isCupWinner: false,
    }
  })

  const isSingleWin = room.victoryCondition === 'SINGLE_WIN'
  const cupChampions = podium.filter((p) => p.cupPoints >= cupTargetPoints)
  const isCupFinished = isSingleWin || cupChampions.length > 0

  let cupWinnerEntry = podium[0]
  if (isCupFinished && !isSingleWin && cupChampions.length > 0) {
    // Prioriza quem atingiu a meta e ficou melhor colocado nesta rodada
    cupWinnerEntry = [...cupChampions].sort((a, b) => {
      if (b.cupPoints !== a.cupPoints) return b.cupPoints - a.cupPoints
      return a.rank - b.rank
    })[0]
  }

  for (const entry of podium) {
    entry.isCupWinner =
      isCupFinished && entry.handle === cupWinnerEntry?.handle
  }

  const participantHandles = occupied.map((s) => s.handle!)
  if (isCupFinished && cupWinnerEntry) {
    await recordMatchStats(cupWinnerEntry.handle, participantHandles)
    for (const s of occupied) {
      if (s.googleId) {
        const { user: updatedPlayer } = await findUserByGoogleId(s.googleId)
        if (updatedPlayer) {
          emitToHandle(s.handle!, 'auth:user_updated', updatedPlayer)
        }
      }
      s.isReady = false
    }
  } else {
    for (const s of occupied) {
      s.isReady = false
    }
  }

  const displayWinner =
    isCupFinished && cupWinnerEntry ? cupWinnerEntry : podium[0]

  broadcastRoomState(room)
  ioInstance?.to(room.roomId).emit('match:game_over', {
    roomId: room.roomId,
    gameMode: room.activeGameMode,
    selectedGameMode: room.selectedGameMode,
    victoryCondition: room.victoryCondition,
    cupTargetPoints,
    roundNumber: room.roundNumber,
    isCupFinished,
    roundWinnerHandle: winnerSlot.handle,
    roundWinnerNick: winnerSlot.customNick,
    roundWinnerSkin: winnerSlot.equippedSkin,
    winnerHandle: displayWinner?.handle || winnerSlot.handle,
    winnerCustomNick: displayWinner?.customNick || winnerSlot.customNick,
    winnerNick: displayWinner?.customNick || winnerSlot.customNick,
    winnerSkin: displayWinner?.equippedSkin || winnerSlot.equippedSkin,
    elapsedTimeMs,
    podium,
  })
}

async function checkSurvivalLastPlayerStanding(
  room: InternalRoom
): Promise<void> {
  if (room.status !== 'IN_MATCH' || room.activeGameMode !== 'SURVIVAL') {
    return
  }

  const occupied = room.slots.filter((s) => Boolean(s.handle))
  if (occupied.length < 2) return

  const alive = occupied.filter((s) => s.lastLives > 0)
  if (alive.length > 1) {
    return
  }

  const winnerSlot =
    alive[0] ||
    [...occupied].sort((a, b) => {
      if (b.lastLives !== a.lastLives) return b.lastLives - a.lastLives
      if (b.eliminationOrder !== a.eliminationOrder) {
        return b.eliminationOrder - a.eliminationOrder
      }
      return b.lastTowerHeight - a.lastTowerHeight
    })[0]
  if (!winnerSlot || !winnerSlot.handle) return

  // If already triggered Castle Roof climax for this survivor, wait for them to place the Castle Roof (`match:claim_victory`)
  if (room.survivalClimaxWinnerHandle === winnerSlot.handle) {
    return
  }

  room.survivalClimaxWinnerHandle = winnerSlot.handle
  ioInstance?.to(room.roomId).emit('match:survival_climax', {
    roomId: room.roomId,
    winnerHandle: winnerSlot.handle,
    winnerCustomNick: winnerSlot.customNick,
    winnerSkin: winnerSlot.equippedSkin,
  })

  // Safety fallback if the winner never places the Castle Roof or disconnects
  clearSurvivalClimaxTimer(room)
  room.survivalClimaxTimer = setTimeout(() => {
    if (room.status === 'IN_MATCH') {
      void concludeMultiplayerRound(room, winnerSlot, 0)
    }
  }, 15000)
}

function createEmptySlot(slotIndex: number): InternalRoomSlot {
  return {
    slotIndex,
    handle: null,
    googleId: null,
    customNick: '',
    equippedSkin: DEFAULT_SILHOUETTES[slotIndex] || 'WIZARD',
    avatarUrl: '',
    isHost: false,
    isReady: false,
    silhouetteSkin: DEFAULT_SILHOUETTES[slotIndex] || 'WIZARD',
    lastTowerHeight: 0,
    lastLives: 3,
    eliminationOrder: 0,
    cupPoints: 0,
    lastPointsEarned: 0,
  }
}

function removePlayerFromCurrentRoom(
  socket: Socket,
  session: ConnectedSession
): void {
  if (!session.roomId) return
  const room = roomsById.get(session.roomId)
  socket.leave(session.roomId)
  session.roomId = null
  if (!room) return

  const slot = room.slots.find(
    (s) => s.handle && s.handle.toLowerCase() === session.handle.toLowerCase()
  )
  if (slot) {
    const wasHost = slot.isHost
    const idx = slot.slotIndex
    room.slots[idx] = createEmptySlot(idx)

    const remainingOccupied = room.slots.filter((s) => Boolean(s.handle))
    if (remainingOccupied.length === 0) {
      abortRoomCountdown(room)
      roomsById.delete(room.roomId)
      return
    }

    if (wasHost) {
      remainingOccupied[0].isHost = true
      room.hostHandle = remainingOccupied[0].handle!
    }
  }

  if (room.status === 'IN_MATCH') {
    broadcastRoomState(room)
    void checkSurvivalLastPlayerStanding(room)
    return
  }

  abortRoomCountdown(room, `${session.customNick} saiu da sala.`)
  broadcastRoomState(room)
}

async function notifyFriendsPresence(user: IUser): Promise<void> {
  const myHandle = user.handle.toLowerCase()
  const myFriends = Array.isArray(user.friends) ? user.friends : []
  const onlineFriendsForMe = myFriends
    .map((f) => f.handle.toLowerCase())
    .filter((h) => isHandleOnline(h))

  emitToHandle(myHandle, 'friends:presence_updated', {
    onlineHandles: onlineFriendsForMe,
  })

  // Also notify each online friend that `myHandle` is online/offline
  for (const f of myFriends) {
    const fHandle = f.handle.toLowerCase()
    if (isHandleOnline(fHandle)) {
      emitToHandle(fHandle, 'friends:peer_status', {
        handle: myHandle,
        customNick: user.customNick,
        equippedSkin: user.equippedSkin,
        online: isHandleOnline(myHandle),
      })
    }
  }
}

export function getAllowedCorsOrigins(): string[] {
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

export function isAllowedCorsOrigin(origin?: string): boolean {
  if (!origin) return true
  const normalized = origin.trim().replace(/\/+$/, '')
  const allowed = getAllowedCorsOrigins()
  if (allowed.includes(normalized)) return true
  // Also allow Vercel preview deployment subdomains if FRONTEND_URL is a .vercel.app domain
  if (
    normalized.endsWith('.vercel.app') &&
    allowed.some((o) => o.endsWith('.vercel.app'))
  ) {
    return true
  }
  return false
}

async function authenticateSocket(socket: Socket): Promise<IUser | null> {
  const authToken =
    typeof socket.handshake.auth?.token === 'string'
      ? socket.handshake.auth.token.trim()
      : null
  const reqToken = extractRequestToken(socket.request as IncomingMessage)
  const token = authToken || reqToken
  if (!token) return null

  const verified = verifySessionJwt(token)
  if (!verified) return null

  const { user } = await findUserByGoogleId(verified.googleId)
  return user
}

/**
 * Attaches the real-time Socket.io Multiplayer Server to the HTTP server.
 * Safe to call multiple times (idempotent per process).
 */
export function attachMultiplayerSocketServer(httpServer: HttpServer): SocketIOServer {
  if (ioInstance) {
    return ioInstance
  }

  const io = new SocketIOServer(httpServer, {
    cors: {
      origin: (origin, callback) => {
        if (isAllowedCorsOrigin(origin)) {
          callback(null, true)
        } else {
          callback(new Error(`Origin ${origin} not allowed by Toy Tower CORS`))
        }
      },
      methods: ['GET', 'POST'],
      credentials: true,
    },
    path: '/socket.io',
  })

  ioInstance = io

  // Handshake Authentication Middleware: validates JWT signed by Vercel using shared JWT_SECRET
  io.use(async (socket, next) => {
    try {
      const user = await authenticateSocket(socket)
      if (!user) {
        return next(new Error('AUTH_UNAUTHORIZED: Token JWT inválido ou ausente.'))
      }
      socket.data.user = user
      next()
    } catch (err) {
      next(
        err instanceof Error
          ? err
          : new Error('AUTH_ERROR: Falha na validação do token JWT.')
      )
    }
  })

  io.on('connection', async (socket) => {
    const user =
      (socket.data.user as IUser | undefined) || (await authenticateSocket(socket))
    if (!user) {
      socket.emit('auth:unauthorized')
      socket.disconnect(true)
      return
    }

    const handleLower = user.handle.toLowerCase()
    const session: ConnectedSession = {
      socketId: socket.id,
      googleId: user.googleId,
      email: user.email,
      handle: handleLower,
      customNick: user.customNick,
      equippedSkin: user.equippedSkin,
      avatarUrl: user.avatarUrl,
      roomId: null,
    }

    sessionsBySocketId.set(socket.id, session)
    let handleSet = socketIdsByHandle.get(handleLower)
    if (!handleSet) {
      handleSet = new Set()
      socketIdsByHandle.set(handleLower, handleSet)
    }
    handleSet.add(socket.id)

    socket.emit('auth:user_updated', user)
    await notifyFriendsPresence(user)

    // ========================================================================
    // PARTE 1: SOCIAL — PEDIDOS DE AMIZADE E EDIÇÃO DE NICK / SKIN
    // ========================================================================

    // Helper to safely invoke Socket.IO ack callbacks even if client omits or passes payload first
    function safeAck<T>(maybeFn1: unknown, maybeFn2: unknown, data: T): void {
      if (typeof maybeFn2 === 'function') {
        ;(maybeFn2 as (res: T) => void)(data)
      } else if (typeof maybeFn1 === 'function') {
        ;(maybeFn1 as (res: T) => void)(data)
      }
    }

    socket.on(
      'friend:send_request',
      async (
        payload: { query?: string },
        ack?: (res: {
          ok: boolean
          error?: string
          user?: IUser
          target?: unknown
          autoAccepted?: boolean
          targetNick?: string
        }) => void
      ) => {
        try {
          const query = String(payload?.query || '').trim()
          const result = await sendFriendRequest(session.googleId, query)

          emitToHandle(session.handle, 'auth:user_updated', result.senderUser)
          await notifyFriendsPresence(result.senderUser)

          const targetHandle = result.targetUser.handle.toLowerCase()
          if (isHandleOnline(targetHandle)) {
            emitToHandle(targetHandle, 'auth:user_updated', result.targetUser)
            await notifyFriendsPresence(result.targetUser)

            if (result.autoAccepted) {
              emitToHandle(targetHandle, 'friend:request_accepted', {
                handle: result.senderProfile.handle,
                customNick: result.senderProfile.customNick,
                equippedSkin: result.senderProfile.equippedSkin,
              })
            } else {
              // Emit immediate real-time friend request alert to target!
              emitToHandle(
                targetHandle,
                'friend:request_received',
                result.senderProfile
              )
            }
          }

          safeAck(payload, ack, {
            ok: true,
            user: result.senderUser,
            target: result.targetProfile,
            autoAccepted: result.autoAccepted,
            targetNick: result.targetProfile.customNick,
          })
        } catch (err) {
          safeAck(payload, ack, {
            ok: false,
            error:
              err instanceof Error
                ? err.message
                : 'Erro ao enviar pedido de amizade.',
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
          user?: IUser
          accepted?: boolean
          acceptedFriend?: unknown
        }) => void
      ) => {
        try {
          const senderHandle = String(payload?.senderHandle || '').trim()
          const accept = Boolean(payload?.accept)
          const result = await respondToFriendRequest(
            session.googleId,
            senderHandle,
            accept
          )

          emitToHandle(
            session.handle,
            'auth:user_updated',
            result.recipientUser
          )
          await notifyFriendsPresence(result.recipientUser)

          let acceptedFriendProfile:
            | { handle: string; customNick: string; equippedSkin: string }
            | undefined

          if (result.senderUser) {
            acceptedFriendProfile = {
              handle: result.senderUser.handle,
              customNick: result.senderUser.customNick,
              equippedSkin: result.senderUser.equippedSkin,
            }
            const targetH = result.senderUser.handle.toLowerCase()
            if (isHandleOnline(targetH)) {
              emitToHandle(targetH, 'auth:user_updated', result.senderUser)
              await notifyFriendsPresence(result.senderUser)
              if (accept) {
                emitToHandle(targetH, 'friend:request_accepted', {
                  handle: session.handle,
                  customNick: session.customNick,
                  equippedSkin: session.equippedSkin,
                })
              }
            }
          }

          safeAck(payload, ack, {
            ok: true,
            user: result.recipientUser,
            accepted: result.accepted,
            acceptedFriend: acceptedFriendProfile,
          })
        } catch (err) {
          safeAck(payload, ack, {
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
          const rawNick = String(payload?.customNick || '').trim()
          const updated = await updateUserCustomNick(session.googleId, rawNick)
          if (!updated) {
            throw new Error('Não foi possível atualizar o Nick.')
          }
          session.customNick = updated.customNick
          emitToHandle(session.handle, 'auth:user_updated', updated)
          await notifyFriendsPresence(updated)

          if (session.roomId) {
            const room = roomsById.get(session.roomId)
            if (room) {
              const slot = room.slots.find(
                (s) => s.handle === session.handle
              )
              if (slot) {
                slot.customNick = updated.customNick
                broadcastRoomState(room)
              }
            }
          }

          safeAck(payload, ack, { ok: true, user: updated })
        } catch (err) {
          safeAck(payload, ack, {
            ok: false,
            error:
              err instanceof Error ? err.message : 'Erro ao atualizar Nick.',
          })
        }
      }
    )

    socket.on(
      'profile:update_skin',
      async (payload: { equippedSkin?: string }) => {
        const skin = String(payload?.equippedSkin || '').trim()
        if (!skin) return
        const updated = await updateUserEquippedSkin(session.googleId, skin)
        if (!updated) return
        session.equippedSkin = updated.equippedSkin
        emitToHandle(session.handle, 'auth:user_updated', updated)
        await notifyFriendsPresence(updated)

        if (session.roomId) {
          const room = roomsById.get(session.roomId)
          if (room) {
            const slot = room.slots.find((s) => s.handle === session.handle)
            if (slot) {
              slot.equippedSkin = updated.equippedSkin
              broadcastRoomState(room)
            }
          }
        }
      }
    )

    // ========================================================================
    // PARTE 2: SALA DE 4 SLOTS, CONVITES DE AMIGOS E PRONTO (READY)
    // ========================================================================

    socket.on(
      'room:enter_lobby',
      async (
        payloadOrAck?: unknown,
        maybeAck?: (res: { ok: boolean; room: RoomStateDTO }) => void
      ) => {
        // Refresh user profile from DB
        const { user: freshUser } = await findUserByGoogleId(session.googleId)
        if (freshUser) {
          session.customNick = freshUser.customNick
          session.equippedSkin = freshUser.equippedSkin
          await notifyFriendsPresence(freshUser)
        }

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
          const existingRoom = roomsById.get(session.roomId)
          if (existingRoom) {
            if (
              existingRoom.status === 'LOBBY' &&
              existingRoom.hostHandle.toLowerCase() ===
                session.handle.toLowerCase()
            ) {
              if (reqOpts?.selectedGameMode) {
                existingRoom.selectedGameMode = initialMode
                if (initialMode !== 'RANDOM') {
                  existingRoom.activeGameMode = initialMode
                }
              }
              if (reqOpts?.victoryCondition) {
                existingRoom.victoryCondition = initialVictory
                existingRoom.cupTargetPoints = getCupTargetPoints(initialVictory)
              }
            }
            const dto = serializeRoom(existingRoom)
            socket.emit('room:state_updated', dto)
            safeAck(payloadOrAck, maybeAck, { ok: true, room: dto })
            return
          }
        }

        let roomId = generateRoomId()
        while (roomsById.has(roomId)) {
          roomId = generateRoomId()
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
          slots: [
            {
              slotIndex: 0,
              handle: session.handle,
              googleId: session.googleId,
              customNick: session.customNick,
              equippedSkin: session.equippedSkin,
              avatarUrl: session.avatarUrl,
              isHost: true,
              isReady: false,
              silhouetteSkin: DEFAULT_SILHOUETTES[0],
              lastTowerHeight: 0,
              lastLives: 3,
              eliminationOrder: 0,
              cupPoints: 0,
              lastPointsEarned: 0,
            },
            createEmptySlot(1),
            createEmptySlot(2),
            createEmptySlot(3),
          ],
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
        ack?: (res: {
          ok: boolean
          error?: string
          room?: RoomStateDTO
        }) => void
      ) => {
        if (!session.roomId) {
          safeAck(payload, ack, {
            ok: false,
            error: 'Você não está em uma sala.',
          })
          return
        }
        const room = roomsById.get(session.roomId)
        if (!room) {
          safeAck(payload, ack, {
            ok: false,
            error: 'Sala não encontrada.',
          })
          return
        }
        if (room.status === 'IN_MATCH') {
          safeAck(payload, ack, {
            ok: false,
            error: 'Não é possível mudar o modo com a partida em andamento.',
          })
          return
        }

        const requested = payload?.gameMode
        const nextMode: RoomSelectableGameMode =
          requested === 'SURVIVAL' || requested === 'RANDOM'
            ? requested
            : 'RACE'

        room.selectedGameMode = nextMode
        if (nextMode !== 'RANDOM') {
          room.activeGameMode = nextMode
        }

        broadcastRoomState(room)
        safeAck(payload, ack, { ok: true, room: serializeRoom(room) })
      }
    )

    socket.on(
      'room:set_victory_condition',
      (
        payload: { victoryCondition?: RoomVictoryCondition },
        ack?: (res: {
          ok: boolean
          error?: string
          room?: RoomStateDTO
        }) => void
      ) => {
        if (!session.roomId) {
          safeAck(payload, ack, {
            ok: false,
            error: 'Você não está em uma sala.',
          })
          return
        }
        const room = roomsById.get(session.roomId)
        if (!room) {
          safeAck(payload, ack, {
            ok: false,
            error: 'Sala não encontrada.',
          })
          return
        }
        if (room.status === 'IN_MATCH') {
          safeAck(payload, ack, {
            ok: false,
            error:
              'Não é possível mudar a condição de vitória durante a partida.',
          })
          return
        }

        const requested = payload?.victoryCondition
        const nextCondition: RoomVictoryCondition =
          requested === 'SINGLE_WIN' ||
          requested === 'CUP_6' ||
          requested === 'CUP_12'
            ? requested
            : 'CUP_6'

        room.victoryCondition = nextCondition
        room.cupTargetPoints = getCupTargetPoints(nextCondition)
        room.roundNumber = 1
        for (const s of room.slots) {
          s.cupPoints = 0
          s.lastPointsEarned = 0
        }

        broadcastRoomState(room)
        safeAck(payload, ack, { ok: true, room: serializeRoom(room) })
      }
    )

    socket.on(
      'room:invite_friend',
      async (
        payload: {
          targetHandle?: string
          friendHandle?: string
          preferredSlotIndex?: number
        },
        ack?: (res: { ok: boolean; error?: string }) => void
      ) => {
        try {
          if (!session.roomId) {
            throw new Error('Você precisa estar em uma sala para convidar.')
          }
          const room = roomsById.get(session.roomId)
          if (!room) {
            throw new Error('Sala não encontrada.')
          }

          const rawHandle = String(
            payload?.targetHandle || payload?.friendHandle || ''
          )
            .trim()
            .toLowerCase()
          const targetHandle = rawHandle
            ? rawHandle.startsWith('@')
              ? rawHandle
              : `@${rawHandle}`
            : ''
          if (!targetHandle) {
            throw new Error('Amigo inválido.')
          }

          const { user: freshMe } = await findUserByGoogleId(session.googleId)
          const isFriend = freshMe?.friends?.some(
            (f) => f.handle.toLowerCase() === targetHandle
          )
          if (!isFriend) {
            throw new Error(
              'Você só pode convidar jogadores que já aceitaram seu pedido de amizade!'
            )
          }

          if (!isHandleOnline(targetHandle)) {
            throw new Error('Este amigo está OFFLINE no momento.')
          }

          const alreadyInRoom = room.slots.some(
            (s) => s.handle === targetHandle
          )
          if (alreadyInRoom) {
            throw new Error('Este amigo já está na sua sala!')
          }

          const hasEmptySlot = room.slots.some((s) => !s.handle)
          if (!hasEmptySlot) {
            throw new Error('A sala já está cheia (4/4 jogadores)!')
          }

          emitToHandle(targetHandle, 'room:invite_received', {
            roomId: room.roomId,
            hostHandle: session.handle,
            hostCustomNick: session.customNick,
            hostEquippedSkin: session.equippedSkin,
            hostSkin: session.equippedSkin,
            preferredSlotIndex:
              typeof payload?.preferredSlotIndex === 'number'
                ? payload.preferredSlotIndex
                : undefined,
          })

          safeAck(payload, ack, { ok: true })
        } catch (err) {
          safeAck(payload, ack, {
            ok: false,
            error:
              err instanceof Error ? err.message : 'Erro ao enviar convite.',
          })
        }
      }
    )

    socket.on(
      'room:accept_invite',
      (
        payload: { roomId?: string; preferredSlotIndex?: number },
        ack?: (res: {
          ok: boolean
          error?: string
          room?: RoomStateDTO
        }) => void
      ) => {
        try {
          const targetRoomId = String(payload?.roomId || '').trim()
          const room = roomsById.get(targetRoomId)
          if (!room) {
            throw new Error('Esta sala não existe mais.')
          }
          if (room.status === 'IN_MATCH') {
            throw new Error('A partida desta sala já começou!')
          }

          // If already in this room, just return state
          if (session.roomId === targetRoomId) {
            const dto = serializeRoom(room)
            safeAck(payload, ack, { ok: true, room: dto })
            return
          }

          const prefIdx =
            typeof payload?.preferredSlotIndex === 'number' &&
            payload.preferredSlotIndex >= 0 &&
            payload.preferredSlotIndex <= 3
              ? payload.preferredSlotIndex
              : null

          const emptySlot =
            (prefIdx !== null && !room.slots[prefIdx].handle
              ? room.slots[prefIdx]
              : null) || room.slots.find((s) => !s.handle)

          if (!emptySlot) {
            throw new Error('A sala já está cheia (4/4 jogadores)!')
          }

          removePlayerFromCurrentRoom(socket, session)

          emptySlot.handle = session.handle
          emptySlot.googleId = session.googleId
          emptySlot.customNick = session.customNick
          emptySlot.equippedSkin = session.equippedSkin
          emptySlot.avatarUrl = session.avatarUrl
          emptySlot.isHost = false
          emptySlot.isReady = false
          emptySlot.lastTowerHeight = 0
          emptySlot.lastLives = 3
          emptySlot.cupPoints = 0
          emptySlot.lastPointsEarned = 0

          session.roomId = room.roomId
          socket.join(room.roomId)

          abortRoomCountdown(
            room,
            `${session.customNick} entrou na sala! Aguardando todos ficarem prontos.`
          )
          broadcastRoomState(room)

          const dto = serializeRoom(room)
          safeAck(payload, ack, { ok: true, room: dto })
        } catch (err) {
          safeAck(payload, ack, {
            ok: false,
            error:
              err instanceof Error ? err.message : 'Erro ao entrar na sala.',
          })
        }
      }
    )

    socket.on(
      'room:decline_invite',
      (payload: { roomId?: string; hostHandle?: string }) => {
        const room = payload?.roomId ? roomsById.get(payload.roomId) : undefined
        const hostHandle = String(
          payload?.hostHandle || room?.hostHandle || ''
        )
          .trim()
          .toLowerCase()
        if (hostHandle && isHandleOnline(hostHandle)) {
          emitToHandle(hostHandle, 'room:invite_declined', {
            handle: session.handle,
            customNick: session.customNick,
            friendHandle: session.handle,
            friendNick: session.customNick,
          })
        }
      }
    )

    socket.on(
      'room:toggle_ready',
      (
        payloadOrAck?:
          | { isReady?: boolean }
          | ((res: {
              ok: boolean
              error?: string
              room?: RoomStateDTO
            }) => void),
        maybeAck?: (res: {
          ok: boolean
          error?: string
          room?: RoomStateDTO
        }) => void
      ) => {
        if (!session.roomId) {
          safeAck(payloadOrAck, maybeAck, {
            ok: false,
            error: 'Você não está em uma sala.',
          })
          return
        }
        const room = roomsById.get(session.roomId)
        if (!room) {
          safeAck(payloadOrAck, maybeAck, {
            ok: false,
            error: 'Sala não encontrada.',
          })
          return
        }

        // Regra: O ÚNICO que pode se colocar como "pronto" é o próprio player
        const mySlot = room.slots.find((s) => s.handle === session.handle)
        if (!mySlot) {
          safeAck(payloadOrAck, maybeAck, {
            ok: false,
            error: 'Slot do jogador não encontrado.',
          })
          return
        }

        const forcedReady =
          payloadOrAck &&
          typeof payloadOrAck === 'object' &&
          typeof payloadOrAck.isReady === 'boolean'
            ? payloadOrAck.isReady
            : undefined

        mySlot.isReady =
          forcedReady !== undefined ? forcedReady : !mySlot.isReady

        if (!mySlot.isReady) {
          abortRoomCountdown(
            room,
            `${session.customNick} cancelou o Pronto.`
          )
        }

        broadcastRoomState(room)
        startRoomCountdownIfEligible(room)

        safeAck(payloadOrAck, maybeAck, {
          ok: true,
          room: serializeRoom(room),
        })
      }
    )

    socket.on('room:cancel_countdown', () => {
      if (!session.roomId) return
      const room = roomsById.get(session.roomId)
      if (!room) return
      const mySlot = room.slots.find((s) => s.handle === session.handle)
      if (mySlot) {
        mySlot.isReady = false
      }
      abortRoomCountdown(room, `${session.customNick} cancelou a contagem.`)
      broadcastRoomState(room)
    })

    socket.on('room:leave', () => {
      removePlayerFromCurrentRoom(socket, session)
    })

    // ========================================================================
    // PARTE 3: PARTIDA ONLINE EM TEMPO REAL (20Hz SYNC + PODERES + PÓDIO)
    // ========================================================================

    socket.on('match:sync_state', (packet: MatchLaneSyncPayload) => {
      if (!session.roomId) return
      const room = roomsById.get(session.roomId)
      if (!room) return

      const mySlot = room.slots.find((s) => s.handle === session.handle)
      if (mySlot) {
        mySlot.lastTowerHeight = Number(packet.towerHeight || 0)
        mySlot.lastLives = Number(packet.lives ?? 3)
        if (mySlot.lastLives <= 0) {
          markSlotEliminatedIfNeeded(room, mySlot)
          void checkSurvivalLastPlayerStanding(room)
        }
      }

      const syncDto = {
        ...packet,
        roomId: room.roomId,
        handle: session.handle,
        customNick: session.customNick,
        equippedSkin: session.equippedSkin,
        slotIndex: mySlot ? mySlot.slotIndex : packet.slotIndex,
      }
      socket.to(room.roomId).emit('match:player_state_updated', syncDto)
      socket.to(room.roomId).emit('match:sync_state', syncDto)
    })

    socket.on(
      'match:piece_settled',
      (payload: { towerHeight: number; pieceId?: number; pieceCount?: number }) => {
        if (!session.roomId) return
        socket.to(session.roomId).emit('match:piece_settled', {
          handle: session.handle,
          customNick: session.customNick,
          towerHeight: payload?.towerHeight ?? 0,
          pieceId: payload?.pieceId ?? payload?.pieceCount ?? 0,
        })
      }
    )

    socket.on(
      'match:life_lost',
      (payload: { livesRemaining?: number; lives?: number }) => {
        if (!session.roomId) return
        const room = roomsById.get(session.roomId)
        const lives = payload?.lives ?? payload?.livesRemaining ?? 0
        let eliminationOrder = 0
        if (room) {
          const mySlot = room.slots.find((s) => s.handle === session.handle)
          if (mySlot) {
            mySlot.lastLives = lives
            if (lives <= 0) {
              markSlotEliminatedIfNeeded(room, mySlot)
              eliminationOrder = mySlot.eliminationOrder
            }
          }
        }
        socket.to(session.roomId).emit('match:life_lost', {
          handle: session.handle,
          customNick: session.customNick,
          lives,
          livesRemaining: lives,
          isEliminated: lives <= 0,
          eliminationOrder,
        })
        if (room && lives <= 0) {
          void checkSurvivalLastPlayerStanding(room)
        }
      }
    )

    // Poder Positivo (match:use_positive_power)
    socket.on(
      'match:use_positive_power',
      (payload: { powerId?: string; powerType?: string }) => {
        const powerType = payload?.powerType || payload?.powerId
        if (!session.roomId || !powerType) return
        const room = roomsById.get(session.roomId)
        const mySlot = room?.slots.find((s) => s.handle === session.handle)
        const vfxPayload = {
          category: 'POSITIVE' as const,
          powerId: powerType,
          powerType,
          casterHandle: session.handle,
          casterNick: session.customNick,
          casterSkin: session.equippedSkin,
          casterSlotIndex: mySlot ? mySlot.slotIndex : 0,
          targetHandles: [session.handle],
        }
        io.to(session.roomId).emit('match:apply_power_vfx', vfxPayload)
        io.to(session.roomId).emit('match:cast_power', vfxPayload)
      }
    )

    // Poder Negativo (match:use_negative_power / match:cast_power)
    socket.on(
      'match:use_negative_power',
      (payload: {
        powerId?: string
        powerType?: string
        targetHandle?: string
        targetId?: string
      }) => {
        const powerType = payload?.powerType || payload?.powerId
        if (!session.roomId || !powerType) return
        const room = roomsById.get(session.roomId)
        if (!room) return

        const mySlot = room.slots.find((s) => s.handle === session.handle)
        const opponents = room.slots.filter(
          (s) => Boolean(s.handle) && s.handle !== session.handle
        )
        if (opponents.length === 0) return

        const requestedTarget = payload.targetHandle || payload.targetId
        // Escolhe o líder atual da partida (maior towerHeight) entre os oponentes, ou o alvo específico
        const sortedOpponents = [...opponents].sort(
          (a, b) => b.lastTowerHeight - a.lastTowerHeight
        )
        const primaryTarget =
          (requestedTarget &&
            opponents.find((o) => o.handle === requestedTarget)) ||
          sortedOpponents[0]

        const targetHandles = primaryTarget?.handle
          ? [primaryTarget.handle]
          : opponents.map((o) => o.handle!)

        const vfxPayload = {
          category: 'NEGATIVE' as const,
          powerId: powerType,
          powerType,
          casterHandle: session.handle,
          casterNick: session.customNick,
          casterSkin: session.equippedSkin,
          casterSlotIndex: mySlot ? mySlot.slotIndex : 0,
          targetHandles,
        }
        io.to(room.roomId).emit('match:apply_power_vfx', vfxPayload)
        io.to(room.roomId).emit('match:cast_power', vfxPayload)
      }
    )

    // Fim de Jogo e Pódio (match:claim_victory -> match:game_over)
    socket.on(
      'match:claim_victory',
      async (payload: {
        towerHeight?: number
        elapsedTimeMs?: number
        eliminationOrderByHandle?: Record<string, number>
      }) => {
        if (!session.roomId) return
        const room = roomsById.get(session.roomId)
        if (!room || room.status === 'POST_MATCH') return

        const mySlot = room.slots.find((s) => s.handle === session.handle)
        if (!mySlot || !mySlot.handle) return
        if (typeof payload?.towerHeight === 'number') {
          mySlot.lastTowerHeight = payload.towerHeight
        }

        await concludeMultiplayerRound(
          room,
          mySlot,
          payload?.elapsedTimeMs ?? 0,
          payload?.eliminationOrderByHandle
        )
      }
    )

    socket.on('match:next_cup_round', () => {
      if (!session.roomId) return
      const room = roomsById.get(session.roomId)
      if (!room || room.status !== 'POST_MATCH') return

      const cupTargetPoints = getCupTargetPoints(room.victoryCondition)
      const hasCupWinner =
        room.victoryCondition === 'SINGLE_WIN' ||
        room.slots.some((s) => Boolean(s.handle) && s.cupPoints >= cupTargetPoints)
      if (hasCupWinner) return

      clearSurvivalClimaxTimer(room)
      room.survivalClimaxWinnerHandle = null
      room.eliminationCounter = 0
      room.status = 'IN_MATCH'
      room.roundNumber += 1
      room.cupTargetPoints = cupTargetPoints
      room.pieceSeed = generateSharedPieceSeed()
      room.activeGameMode =
        room.selectedGameMode === 'RANDOM'
          ? Math.random() < 0.5
            ? 'RACE'
            : 'SURVIVAL'
          : room.selectedGameMode

      for (const s of room.slots) {
        s.lastTowerHeight = 0
        s.lastLives = 3
        s.eliminationOrder = 0
        s.lastPointsEarned = 0
      }

      const players = room.slots
        .filter((s) => Boolean(s.handle))
        .map((s) => ({
          slotIndex: s.slotIndex,
          handle: s.handle!,
          customNick: s.customNick,
          equippedSkin: s.equippedSkin,
          avatarUrl: s.avatarUrl,
          isHost: s.isHost,
          cupPoints: s.cupPoints,
          lastPointsEarned: s.lastPointsEarned,
        }))

      broadcastRoomState(room)
      io.to(room.roomId).emit('match:start', {
        roomId: room.roomId,
        pieceSeed: room.pieceSeed,
        gameMode: room.activeGameMode,
        selectedGameMode: room.selectedGameMode,
        victoryCondition: room.victoryCondition,
        cupTargetPoints: room.cupTargetPoints,
        roundNumber: room.roundNumber,
        players,
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
      room.roundNumber = 1
      for (const s of room.slots) {
        s.isReady = false
        s.cupPoints = 0
        s.lastPointsEarned = 0
        s.lastTowerHeight = 0
        s.lastLives = 3
        s.eliminationOrder = 0
      }

      const dto = serializeRoom(room)
      io.to(room.roomId).emit('match:return_to_lobby', {
        roomId: room.roomId,
        room: dto,
      })
      io.to(room.roomId).emit('room:returned_to_lobby', dto)
      io.to(room.roomId).emit('room:state_updated', dto)
    })

    socket.on('disconnect', async () => {
      removePlayerFromCurrentRoom(socket, session)
      sessionsBySocketId.delete(socket.id)

      const set = socketIdsByHandle.get(session.handle)
      if (set) {
        set.delete(socket.id)
        if (set.size === 0) {
          socketIdsByHandle.delete(session.handle)
        }
      }

      const { user: freshUser } = await findUserByGoogleId(session.googleId)
      if (freshUser) {
        await notifyFriendsPresence(freshUser)
      }
    })
  })

  return io
}
