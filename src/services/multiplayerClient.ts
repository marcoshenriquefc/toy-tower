import { reactive } from 'vue'
import { io, Socket } from 'socket.io-client'
import {
  authStore,
  FriendEntry,
  FriendRequestEntry,
  UserAccount,
} from './authStore'
import { ActivePieceSnapshot, SettledBlockSnapshot } from '../types/game'
import { PowerId } from '../game/PowersCatalog'

export interface RoomSlotPlayerDTO {
  socketId: string
  googleId: string
  handle: string
  customNick: string
  avatarUrl: string
  equippedSkin: string
  isHost: boolean
  isReady: boolean
  slotIndex: number // 0, 1, 2, 3
}

export interface RoomStateDTO {
  roomId: string
  hostHandle: string
  status: 'LOBBY' | 'COUNTDOWN' | 'PLAYING' | 'FINISHED'
  countdownSeconds: number | null
  pieceSeed: string | null
  slots: Array<RoomSlotPlayerDTO | null>
}

export interface IncomingRoomInviteDTO {
  roomId: string
  hostHandle: string
  hostCustomNick: string
  hostSkin: string
  preferredSlotIndex?: number
  invitedAt: string
}

export interface MatchPlayerRealtimeState {
  handle: string
  customNick: string
  equippedSkin: string
  slotIndex: number
  activePiece: ActivePieceSnapshot | null
  settledBlocks: SettledBlockSnapshot[]
  towerHeight: number
  lives: number
  mana: number
  activeDebuffs: string[]
  isEliminated: boolean
  updatedAt: number
}

export interface RemoteLaneInterpolatedState extends MatchPlayerRealtimeState {
  /** Smoothly interpolated active piece position/angle for 60fps canvas rendering */
  renderActivePiece: ActivePieceSnapshot | null
  /** Smoothly interpolated settled blocks for 60fps canvas rendering */
  renderSettledBlocks: SettledBlockSnapshot[]
  /** Recent piece settled flash timestamp */
  lastPieceSettledAtMs: number
  /** Recent life lost flash timestamp */
  lastLifeLostAtMs: number
  /** Recent positive/negative cast animation remaining ms */
  mascotCastAnimMs: number
  mascotCastCategory: 'POSITIVE' | 'NEGATIVE' | null
}

export interface SynchronizedPowerVfx {
  id: string
  casterHandle: string
  casterNick: string
  casterSlotIndex: number
  category: 'POSITIVE' | 'NEGATIVE'
  powerType: PowerId
  targetHandles: string[]
  createdAtMs: number
  durationMs: number
}

export interface MatchStartPayload {
  roomId: string
  pieceSeed: string
  startedAt: string
  players: Array<{
    handle: string
    customNick: string
    equippedSkin: string
    slotIndex: number
    isHost: boolean
  }>
}

export interface MatchGameOverPodiumEntry {
  rank: number
  userId?: string
  handle: string
  customNick: string
  equippedSkin: string
  slotIndex: number
  towerHeight: number
  lives: number
  isEliminated: boolean
  isWinner: boolean
}

export interface MatchGameOverPayload {
  roomId: string
  winnerId: string
  winnerHandle: string
  winnerNick: string
  winnerCustomNick: string
  winnerSkin: string
  reason: string
  elapsedTimeMs: number
  podium: MatchGameOverPodiumEntry[]
}

interface MultiplayerState {
  connected: boolean
  socketId: string | null
  onlineFriendHandles: Record<string, boolean>
  incomingFriendRequests: FriendRequestEntry[]
  friendNotifications: Array<{
    id: string
    message: string
    tone: 'info' | 'success' | 'warning'
  }>
  room: RoomStateDTO | null
  incomingRoomInvite: IncomingRoomInviteDTO | null
  countdownSeconds: number | null
  activeMatch: MatchStartPayload | null
  remoteLanes: Record<string, RemoteLaneInterpolatedState>
  activePowerVfx: SynchronizedPowerVfx[]
  gameOverResult: MatchGameOverPayload | null
}

const state = reactive<MultiplayerState>({
  connected: false,
  socketId: null,
  onlineFriendHandles: {},
  incomingFriendRequests: [],
  friendNotifications: [],
  room: null,
  incomingRoomInvite: null,
  countdownSeconds: null,
  activeMatch: null,
  remoteLanes: {},
  activePowerVfx: [],
  gameOverResult: null,
})

let socket: Socket | null = null
let lastWakeUpPingAtMs = 0

/**
 * Resolves the public Socket.io server URL (`VITE_SOCKET_URL` or `NUXT_PUBLIC_SOCKET_URL`).
 * In production (Vercel), this points to the dedicated Render Web Service URL.
 * In local development, falls back to the current origin (`''`).
 */
export function getSocketServerUrl(): string {
  const envMeta = import.meta.env as Record<string, string | undefined>
  const raw = (
    envMeta.VITE_SOCKET_URL ||
    envMeta.NUXT_PUBLIC_SOCKET_URL ||
    ''
  ).trim()
  return raw.replace(/\/+$/, '')
}

/**
 * Anti-Hibernation Wake-up Ping (`GET ${SOCKET_URL}/health`).
 * Triggered silently when the player opens the initial menu (`TITLE_SCREEN` / `MAIN_MENU`)
 * so that if the free Render Web Service is sleeping, it wakes up in the background
 * before the player enters the Multiplayer Lobby.
 */
export function wakeUpSocketServer(): void {
  if (typeof window === 'undefined') return
  const now = Date.now()
  if (now - lastWakeUpPingAtMs < 30_000) return
  lastWakeUpPingAtMs = now

  const baseUrl = getSocketServerUrl()
  const healthUrl = baseUrl ? `${baseUrl}/health` : '/health'

  void fetch(healthUrl, {
    method: 'GET',
    mode: 'cors',
    cache: 'no-store',
  }).catch(() => {
    // Silent background wake-up ping; ignore network errors while Render wakes up
  })
}

type MatchStartListener = (payload: MatchStartPayload) => void
type NegativePowerListener = (powerType: PowerId, attackerNick: string) => void
type GameOverListener = (payload: MatchGameOverPayload) => void
type ReturnToLobbyListener = (room: RoomStateDTO) => void

let onMatchStartCallback: MatchStartListener | null = null
let onReceiveNegativePowerCallback: NegativePowerListener | null = null
let onGameOverCallback: GameOverListener | null = null
let onReturnToLobbyCallback: ReturnToLobbyListener | null = null

function pushNotification(
  message: string,
  tone: 'info' | 'success' | 'warning' = 'info'
) {
  const id = `${Date.now()}_${Math.random().toString(36).slice(2, 7)}`
  state.friendNotifications.push({ id, message, tone })
  window.setTimeout(() => {
    const idx = state.friendNotifications.findIndex((n) => n.id === id)
    if (idx >= 0) {
      state.friendNotifications.splice(idx, 1)
    }
  }, 4500)
}

function normalizeHandle(raw: string): string {
  const cleaned = raw.trim().toLowerCase()
  return cleaned.startsWith('@') ? cleaned : `@${cleaned}`
}

function syncPendingFriendRequestsFromUser(user: UserAccount | null) {
  if (!user || !Array.isArray(user.friendRequestsReceived)) {
    state.incomingFriendRequests = []
    return
  }
  state.incomingFriendRequests = [...user.friendRequestsReceived]
}

function connect(): void {
  if (!authStore.state.user) return
  syncPendingFriendRequestsFromUser(authStore.state.user)

  if (socket && socket.connected) {
    return
  }

  if (socket) {
    socket.disconnect()
    socket = null
  }

  const targetUrl = getSocketServerUrl()
  const socketOpts = {
    path: '/socket.io',
    withCredentials: true,
    auth: {
      token: authStore.state.token || undefined,
    },
    transports: ['websocket', 'polling'],
  }

  socket = targetUrl ? io(targetUrl, socketOpts) : io(socketOpts)

  socket.on('connect', () => {
    state.connected = true
    state.socketId = socket?.id || null
  })

  socket.on('disconnect', () => {
    state.connected = false
    state.socketId = null
  })

  socket.on('auth:user_updated', (updatedUser: UserAccount) => {
    if (updatedUser) {
      authStore.setUser(updatedUser)
      syncPendingFriendRequestsFromUser(updatedUser)
    }
  })

  const handleOnlineList = (payload: {
    handles?: string[]
    onlineHandles?: string[]
  }) => {
    const nextMap: Record<string, boolean> = {}
    const list = payload?.handles || payload?.onlineHandles || []
    for (const h of list) {
      nextMap[normalizeHandle(h)] = true
    }
    state.onlineFriendHandles = nextMap
  }

  socket.on('friends:online_list', handleOnlineList)
  socket.on('friends:presence_updated', handleOnlineList)

  const handlePeerStatus = (payload: {
    handle: string
    online: boolean
    customNick?: string
  }) => {
    if (!payload?.handle) return
    const h = normalizeHandle(payload.handle)
    if (payload.online) {
      state.onlineFriendHandles[h] = true
    } else {
      delete state.onlineFriendHandles[h]
    }
  }

  socket.on('friend:status_changed', handlePeerStatus)
  socket.on('friends:peer_status', handlePeerStatus)

  socket.on('friend:request_received', (senderProfile: FriendRequestEntry) => {
    if (!senderProfile?.handle) return
    const h = normalizeHandle(senderProfile.handle)
    const exists = state.incomingFriendRequests.some(
      (r) => normalizeHandle(r.handle) === h
    )
    if (!exists) {
      state.incomingFriendRequests.unshift({
        handle: h,
        customNick: senderProfile.customNick || h,
        email: senderProfile.email,
        equippedSkin: senderProfile.equippedSkin || 'WIZARD',
        requestedAt: senderProfile.requestedAt || new Date().toISOString(),
      })
    }
    pushNotification(
      `${senderProfile.customNick} (${h}) enviou um pedido de amizade!`,
      'info'
    )
  })

  socket.on('friend:request_accepted', (friendProfile: FriendEntry) => {
    if (!friendProfile?.handle) return
    const h = normalizeHandle(friendProfile.handle)
    state.onlineFriendHandles[h] = true
    pushNotification(
      `${friendProfile.customNick} (${h}) aceitou seu pedido de amizade!`,
      'success'
    )
  })

  socket.on('room:state_updated', (roomState: RoomStateDTO | null) => {
    state.room = roomState
    if (roomState) {
      state.countdownSeconds = roomState.countdownSeconds
    } else {
      state.countdownSeconds = null
    }
  })

  socket.on('room:invite_received', (invite: IncomingRoomInviteDTO) => {
    state.incomingRoomInvite = invite
  })

  socket.on(
    'room:invite_declined',
    (payload: { handle: string; customNick: string }) => {
      pushNotification(
        `${payload.customNick} (${payload.handle}) recusou o convite para a sala.`,
        'warning'
      )
    }
  )

  socket.on(
    'room:countdown_tick',
    (payload: {
      roomId: string
      secondsRemaining?: number
      seconds?: number
    }) => {
      const secs =
        typeof payload.secondsRemaining === 'number'
          ? payload.secondsRemaining
          : typeof payload.seconds === 'number'
            ? payload.seconds
            : 3
      state.countdownSeconds = secs
      if (state.room && state.room.roomId === payload.roomId) {
        state.room.countdownSeconds = secs
        state.room.status = 'COUNTDOWN'
      }
    }
  )

  socket.on('room:countdown_aborted', () => {
    state.countdownSeconds = null
    if (state.room) {
      state.room.countdownSeconds = null
      state.room.status = 'LOBBY'
    }
  })

  socket.on('match:start', (payload: MatchStartPayload) => {
    state.countdownSeconds = null
    state.gameOverResult = null
    state.activePowerVfx = []
    state.activeMatch = payload

    const myHandle = normalizeHandle(authStore.state.user?.handle || '')
    const nextRemoteLanes: Record<string, RemoteLaneInterpolatedState> = {}
    for (const p of payload.players) {
      const h = normalizeHandle(p.handle)
      if (h === myHandle) continue
      nextRemoteLanes[h] = {
        handle: h,
        customNick: p.customNick,
        equippedSkin: p.equippedSkin,
        slotIndex: p.slotIndex,
        activePiece: null,
        settledBlocks: [],
        renderActivePiece: null,
        renderSettledBlocks: [],
        towerHeight: 0,
        lives: 3,
        mana: 0,
        activeDebuffs: [],
        isEliminated: false,
        updatedAt: performance.now(),
        lastPieceSettledAtMs: 0,
        lastLifeLostAtMs: 0,
        mascotCastAnimMs: 0,
        mascotCastCategory: null,
      }
    }
    state.remoteLanes = nextRemoteLanes

    if (onMatchStartCallback) {
      onMatchStartCallback(payload)
    }
  })

  socket.on(
    'match:player_state_updated',
    (remoteState: MatchPlayerRealtimeState) => {
      if (!remoteState?.handle) return
      const h = normalizeHandle(remoteState.handle)
      const myHandle = normalizeHandle(authStore.state.user?.handle || '')
      if (h === myHandle) return

      const existing = state.remoteLanes[h]
      if (!existing) {
        state.remoteLanes[h] = {
          ...remoteState,
          handle: h,
          renderActivePiece: remoteState.activePiece
            ? { ...remoteState.activePiece }
            : null,
          renderSettledBlocks: (remoteState.settledBlocks || []).map((b) => ({
            ...b,
          })),
          lastPieceSettledAtMs: 0,
          lastLifeLostAtMs: 0,
          mascotCastAnimMs: 0,
          mascotCastCategory: null,
        }
        return
      }

      existing.customNick = remoteState.customNick
      existing.equippedSkin = remoteState.equippedSkin
      existing.slotIndex = remoteState.slotIndex
      existing.activePiece = remoteState.activePiece
      existing.settledBlocks = remoteState.settledBlocks || []
      existing.towerHeight = remoteState.towerHeight
      existing.lives = remoteState.lives
      existing.mana = remoteState.mana
      existing.activeDebuffs = remoteState.activeDebuffs || []
      existing.isEliminated = remoteState.isEliminated
      existing.updatedAt = performance.now()

      if (!remoteState.activePiece) {
        existing.renderActivePiece = null
      } else if (
        !existing.renderActivePiece ||
        existing.renderActivePiece.type !== remoteState.activePiece.type
      ) {
        existing.renderActivePiece = { ...remoteState.activePiece }
      }
    }
  )

  socket.on(
    'match:piece_settled',
    (payload: { handle: string; towerHeight: number }) => {
      if (!payload?.handle) return
      const h = normalizeHandle(payload.handle)
      const lane = state.remoteLanes[h]
      if (lane) {
        lane.towerHeight = payload.towerHeight
        lane.lastPieceSettledAtMs = performance.now()
      }
    }
  )

  socket.on(
    'match:life_lost',
    (payload: { handle: string; lives: number; isEliminated: boolean }) => {
      if (!payload?.handle) return
      const h = normalizeHandle(payload.handle)
      const lane = state.remoteLanes[h]
      if (lane) {
        lane.lives = payload.lives
        lane.isEliminated = payload.isEliminated
        lane.lastLifeLostAtMs = performance.now()
      }
    }
  )

  socket.on(
    'match:apply_power_vfx',
    (payload: {
      casterHandle: string
      casterNick: string
      casterSlotIndex: number
      category: 'POSITIVE' | 'NEGATIVE'
      powerType: string
      targetHandles: string[]
    }) => {
      const now = performance.now()
      const powerType = payload.powerType as PowerId
      const vfx: SynchronizedPowerVfx = {
        id: `${now}_${Math.random().toString(36).slice(2, 6)}`,
        casterHandle: normalizeHandle(payload.casterHandle),
        casterNick: payload.casterNick,
        casterSlotIndex: payload.casterSlotIndex,
        category: payload.category,
        powerType,
        targetHandles: (payload.targetHandles || []).map((t) =>
          normalizeHandle(t)
        ),
        createdAtMs: now,
        durationMs: payload.category === 'NEGATIVE' ? 1450 : 950,
      }
      state.activePowerVfx.push(vfx)

      const casterLane = state.remoteLanes[vfx.casterHandle]
      if (casterLane) {
        casterLane.mascotCastAnimMs = 950
        casterLane.mascotCastCategory = payload.category
      }

      const myHandle = normalizeHandle(authStore.state.user?.handle || '')
      if (
        payload.category === 'NEGATIVE' &&
        vfx.casterHandle !== myHandle &&
        vfx.targetHandles.includes(myHandle)
      ) {
        if (onReceiveNegativePowerCallback) {
          onReceiveNegativePowerCallback(powerType, payload.casterNick)
        }
      }
    }
  )

  socket.on('match:game_over', (payload: MatchGameOverPayload) => {
    const normalized: MatchGameOverPayload = {
      ...payload,
      winnerCustomNick:
        payload.winnerCustomNick || payload.winnerNick || 'VENCEDOR',
      winnerNick:
        payload.winnerNick || payload.winnerCustomNick || 'VENCEDOR',
      podium: (payload.podium || []).map((p) => ({
        ...p,
        userId: p.userId || p.handle,
      })),
    }
    state.gameOverResult = normalized
    if (onGameOverCallback) {
      onGameOverCallback(normalized)
    }
  })

  socket.on(
    'match:return_to_lobby',
    (payload: { roomId: string; room: RoomStateDTO }) => {
      state.activeMatch = null
      state.gameOverResult = null
      state.remoteLanes = {}
      state.activePowerVfx = []
      if (payload?.room) {
        state.room = payload.room
      }
      if (onReturnToLobbyCallback && payload?.room) {
        onReturnToLobbyCallback(payload.room)
      }
    }
  )
}

function disconnect(): void {
  if (socket) {
    socket.disconnect()
    socket = null
  }
  state.connected = false
  state.socketId = null
  state.room = null
  state.activeMatch = null
  state.remoteLanes = {}
}

function isFriendOnline(handle: string): boolean {
  return Boolean(state.onlineFriendHandles[normalizeHandle(handle)])
}

function enterLobby(): Promise<RoomStateDTO> {
  connect()
  return new Promise((resolve, reject) => {
    if (!socket) {
      reject(new Error('Conexão em tempo real indisponível.'))
      return
    }
    socket.emit(
      'room:enter_lobby',
      (res: { ok?: boolean; room?: RoomStateDTO; error?: string }) => {
        if (res?.ok && res.room) {
          state.room = res.room
          resolve(res.room)
        } else {
          reject(new Error(res?.error || 'Não foi possível criar a sala.'))
        }
      }
    )
  })
}

function leaveRoom(): void {
  if (!socket) return
  socket.emit('room:leave')
  state.room = null
  state.activeMatch = null
  state.remoteLanes = {}
  state.gameOverResult = null
}

function toggleReady(forceReady?: boolean): Promise<RoomStateDTO> {
  return new Promise((resolve, reject) => {
    if (!socket) {
      reject(new Error('Sem conexão com o servidor.'))
      return
    }
    socket.emit(
      'room:toggle_ready',
      { isReady: forceReady },
      (res: { ok?: boolean; room?: RoomStateDTO; error?: string }) => {
        if (res?.ok && res.room) {
          state.room = res.room
          resolve(res.room)
        } else {
          reject(new Error(res?.error || 'Falha ao atualizar estado Pronto.'))
        }
      }
    )
  })
}

function inviteFriend(
  friendHandle: string,
  preferredSlotIndex?: number
): Promise<void> {
  return new Promise((resolve, reject) => {
    if (!socket) {
      reject(new Error('Sem conexão com o servidor.'))
      return
    }
    socket.emit(
      'room:invite_friend',
      { friendHandle, preferredSlotIndex },
      (res: { ok?: boolean; error?: string }) => {
        if (res?.ok) {
          resolve()
        } else {
          reject(new Error(res?.error || 'Não foi possível enviar o convite.'))
        }
      }
    )
  })
}

function acceptRoomInvite(
  roomId: string,
  preferredSlotIndex?: number
): Promise<RoomStateDTO> {
  connect()
  return new Promise((resolve, reject) => {
    if (!socket) {
      reject(new Error('Sem conexão com o servidor.'))
      return
    }
    socket.emit(
      'room:accept_invite',
      { roomId, preferredSlotIndex },
      (res: { ok?: boolean; room?: RoomStateDTO; error?: string }) => {
        state.incomingRoomInvite = null
        if (res?.ok && res.room) {
          state.room = res.room
          resolve(res.room)
        } else {
          reject(new Error(res?.error || 'Não foi possível entrar na sala.'))
        }
      }
    )
  })
}

function declineRoomInvite(roomId: string): void {
  state.incomingRoomInvite = null
  if (socket) {
    socket.emit('room:decline_invite', { roomId })
  }
}

async function sendFriendRequest(
  query: string
): Promise<{ target: FriendEntry; autoAccepted: boolean }> {
  if (socket && socket.connected) {
    return new Promise((resolve, reject) => {
      socket!.emit(
        'friend:send_request',
        { query },
        (res: {
          ok?: boolean
          error?: string
          target?: FriendEntry
          targetNick?: string
          autoAccepted?: boolean
        }) => {
          if (res?.ok) {
            resolve({
              target: res.target || {
                handle: normalizeHandle(query),
                customNick: res.targetNick || query,
                equippedSkin: 'WIZARD',
              },
              autoAccepted: Boolean(res.autoAccepted),
            })
          } else {
            reject(new Error(res?.error || 'Jogador não encontrado'))
          }
        }
      )
    })
  }
  return authStore.sendFriendRequest(query)
}

async function respondFriendRequest(
  senderHandle: string,
  accept: boolean
): Promise<{ acceptedFriend?: FriendEntry }> {
  const norm = normalizeHandle(senderHandle)
  state.incomingFriendRequests = state.incomingFriendRequests.filter(
    (r) => normalizeHandle(r.handle) !== norm
  )

  if (socket && socket.connected) {
    return new Promise((resolve, reject) => {
      socket!.emit(
        'friend:respond_request',
        { senderHandle: norm, accept },
        (res: {
          ok?: boolean
          error?: string
          acceptedFriend?: FriendEntry
        }) => {
          if (res?.ok) {
            if (accept && res.acceptedFriend) {
              state.onlineFriendHandles[
                normalizeHandle(res.acceptedFriend.handle)
              ] = true
            }
            resolve({ acceptedFriend: res.acceptedFriend })
          } else {
            reject(
              new Error(res?.error || 'Não foi possível responder ao pedido.')
            )
          }
        }
      )
    })
  }
  return authStore.respondFriendRequest(norm, accept)
}

async function updateCustomNick(customNick: string): Promise<void> {
  if (socket && socket.connected) {
    return new Promise((resolve, reject) => {
      socket!.emit(
        'profile:update_nick',
        { customNick },
        (res: { ok?: boolean; error?: string; user?: UserAccount }) => {
          if (res?.ok && res.user) {
            authStore.setUser(res.user)
            resolve()
          } else {
            reject(
              new Error(res?.error || 'Não foi possível atualizar o apelido.')
            )
          }
        }
      )
    })
  }
  await authStore.updateCustomNick(customNick)
}

function updateEquippedSkin(equippedSkin: string): void {
  if (socket && socket.connected) {
    socket.emit('profile:update_skin', { equippedSkin })
  }
}

function emitMatchSyncState(payload: {
  activePiece: ActivePieceSnapshot | null
  settledBlocks: SettledBlockSnapshot[]
  towerHeight: number
  lives: number
  mana: number
  activeDebuffs: string[]
  isEliminated: boolean
}): void {
  if (!socket || !socket.connected || !state.activeMatch) return
  socket.emit('match:sync_state', payload)
}

function emitPieceSettled(towerHeight: number, pieceCount: number): void {
  if (!socket || !socket.connected || !state.activeMatch) return
  socket.emit('match:piece_settled', { towerHeight, pieceCount })
}

function emitLifeLost(lives: number): void {
  if (!socket || !socket.connected || !state.activeMatch) return
  socket.emit('match:life_lost', { lives })
}

function emitUsePositivePower(powerType: PowerId): void {
  if (!socket || !socket.connected || !state.activeMatch) return
  socket.emit('match:use_positive_power', { powerType })
}

function emitUseNegativePower(powerType: PowerId, targetId?: string): void {
  if (!socket || !socket.connected || !state.activeMatch) return
  socket.emit('match:use_negative_power', { powerType, targetId })
}

function emitClaimVictory(towerHeight: number, elapsedTimeMs: number): void {
  if (!socket || !socket.connected || !state.activeMatch) return
  socket.emit('match:claim_victory', { towerHeight, elapsedTimeMs })
}

function emitReturnToLobby(): void {
  if (!socket || !socket.connected) return
  socket.emit('match:return_to_lobby')
}

function lerpNumber(current: number, target: number, alpha: number): number {
  return current + (target - current) * alpha
}

function lerpAngle(current: number, target: number, alpha: number): number {
  let diff = target - current
  while (diff > Math.PI) diff -= Math.PI * 2
  while (diff < -Math.PI) diff += Math.PI * 2
  return current + diff * alpha
}

/**
 * Steps 60fps visual interpolation (`lerp`) for all remote opponent lanes
 * and ages active synchronized power VFX.
 */
function stepInterpolation(dtMs: number): void {
  const alpha = Math.min(1, (dtMs / 16.67) * 0.32)
  const now = performance.now()

  for (const key of Object.keys(state.remoteLanes)) {
    const lane = state.remoteLanes[key]
    if (!lane) continue

    if (lane.mascotCastAnimMs > 0) {
      lane.mascotCastAnimMs = Math.max(0, lane.mascotCastAnimMs - dtMs)
      if (lane.mascotCastAnimMs <= 0) {
        lane.mascotCastCategory = null
      }
    }

    // Interpolate active falling piece
    if (!lane.activePiece) {
      lane.renderActivePiece = null
    } else if (!lane.renderActivePiece) {
      lane.renderActivePiece = { ...lane.activePiece }
    } else {
      lane.renderActivePiece.type = lane.activePiece.type
      lane.renderActivePiece.variant = lane.activePiece.variant
      lane.renderActivePiece.powerEffect = lane.activePiece.powerEffect
      lane.renderActivePiece.colorPaletteIndex =
        lane.activePiece.colorPaletteIndex
      lane.renderActivePiece.x = lerpNumber(
        lane.renderActivePiece.x,
        lane.activePiece.x,
        alpha
      )
      lane.renderActivePiece.y = lerpNumber(
        lane.renderActivePiece.y,
        lane.activePiece.y,
        alpha
      )
      lane.renderActivePiece.angle = lerpAngle(
        lane.renderActivePiece.angle,
        lane.activePiece.angle,
        alpha
      )
    }

    // Interpolate settled blocks by block id
    const existingById = new Map<number, SettledBlockSnapshot>()
    for (const b of lane.renderSettledBlocks) {
      existingById.set(b.id, b)
    }

    const nextRenderBlocks: SettledBlockSnapshot[] = []
    for (const targetBlock of lane.settledBlocks) {
      const prev = existingById.get(targetBlock.id)
      if (!prev) {
        nextRenderBlocks.push({ ...targetBlock })
      } else {
        prev.x = lerpNumber(prev.x, targetBlock.x, alpha)
        prev.y = lerpNumber(prev.y, targetBlock.y, alpha)
        prev.angle = lerpAngle(prev.angle, targetBlock.angle, alpha)
        prev.snapped = targetBlock.snapped
        prev.sleeping = targetBlock.sleeping
        prev.isStaticAnchor = targetBlock.isStaticAnchor
        prev.isGlued = targetBlock.isGlued
        prev.powerEffect = targetBlock.powerEffect
        prev.variant = targetBlock.variant
        prev.colorPaletteIndex = targetBlock.colorPaletteIndex
        nextRenderBlocks.push(prev)
      }
    }
    lane.renderSettledBlocks = nextRenderBlocks
  }

  // Filter expired power VFX
  for (let i = state.activePowerVfx.length - 1; i >= 0; i--) {
    const vfx = state.activePowerVfx[i]
    if (now - vfx.createdAtMs > vfx.durationMs) {
      state.activePowerVfx.splice(i, 1)
    }
  }
}

function registerCallbacks(callbacks: {
  onMatchStart?: MatchStartListener
  onReceiveNegativePower?: NegativePowerListener
  onGameOver?: GameOverListener
  onReturnToLobby?: ReturnToLobbyListener
}): void {
  if (callbacks.onMatchStart !== undefined) {
    onMatchStartCallback = callbacks.onMatchStart
  }
  if (callbacks.onReceiveNegativePower !== undefined) {
    onReceiveNegativePowerCallback = callbacks.onReceiveNegativePower
  }
  if (callbacks.onGameOver !== undefined) {
    onGameOverCallback = callbacks.onGameOver
  }
  if (callbacks.onReturnToLobby !== undefined) {
    onReturnToLobbyCallback = callbacks.onReturnToLobby
  }
}

export const multiplayerClient = {
  state,
  getSocketServerUrl,
  wakeUpSocketServer,
  connect,
  disconnect,
  isFriendOnline,
  enterLobby,
  leaveRoom,
  toggleReady,
  inviteFriend,
  acceptRoomInvite,
  declineRoomInvite,
  sendFriendRequest,
  respondFriendRequest,
  updateCustomNick,
  updateEquippedSkin,
  emitMatchSyncState,
  emitPieceSettled,
  emitLifeLost,
  emitUsePositivePower,
  emitUseNegativePower,
  emitClaimVictory,
  emitReturnToLobby,
  stepInterpolation,
  registerCallbacks,
}

