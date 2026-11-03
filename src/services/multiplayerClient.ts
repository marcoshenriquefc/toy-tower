import { reactive } from 'vue'
import { io, Socket } from 'socket.io-client'
import {
  authStore,
  FriendEntry,
  FriendRequestEntry,
  UserAccount,
} from './authStore'
import {
  ActivePieceSnapshot,
  FloatingIslandSnapshot,
  GAME_CONSTANTS,
  GameMode,
  SelectableGameMode,
  SettledBlockSnapshot,
  VictoryCondition,
} from '../types/game'
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
  cupPoints?: number
  lastPointsEarned?: number
}

export interface RoomStateDTO {
  roomId: string
  hostHandle: string
  status: 'LOBBY' | 'COUNTDOWN' | 'PLAYING' | 'FINISHED'
  countdownSeconds: number | null
  pieceSeed: string | null
  selectedGameMode?: SelectableGameMode
  activeGameMode?: GameMode
  victoryCondition?: VictoryCondition
  cupTargetPoints?: number
  roundNumber?: number
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
  blindManualRemainingMs?: number
  fogAnchorX?: number
  fogAnchorY?: number
  islands?: FloatingIslandSnapshot[]
  isEliminated: boolean
  eliminationOrder?: number
  updatedAt: number
}

export interface RemoteLaneInterpolatedState extends MatchPlayerRealtimeState {
  /** Smoothly interpolated active piece position/angle for 60fps canvas rendering */
  renderActivePiece: ActivePieceSnapshot | null
  /** Smoothly interpolated settled blocks for 60fps canvas rendering */
  renderSettledBlocks: SettledBlockSnapshot[]
  /** Remaining duration of BLIND_MANUAL ("Nuvem Fog") on this opponent's tower */
  blindManualRemainingMs: number
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
  gameMode?: GameMode
  selectedGameMode?: SelectableGameMode
  victoryCondition?: VictoryCondition
  cupTargetPoints?: number
  roundNumber?: number
  startedAt: string
  players: Array<{
    handle: string
    customNick: string
    equippedSkin: string
    slotIndex: number
    isHost: boolean
    cupPoints?: number
    lastPointsEarned?: number
  }>
}

export interface MatchSurvivalClimaxPayload {
  roomId: string
  winnerHandle: string
  winnerCustomNick: string
  winnerSkin?: string
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
  eliminationOrder?: number
  pointsEarned?: number
  previousCupPoints?: number
  cupPoints?: number
  cupTargetPoints?: number
  pointMedals?: Array<1 | 2 | 3>
  isEliminated: boolean
  isWinner: boolean
  isCupWinner?: boolean
}

export interface MatchGameOverPayload {
  roomId: string
  gameMode?: GameMode
  selectedGameMode?: SelectableGameMode
  victoryCondition?: VictoryCondition
  cupTargetPoints?: number
  roundNumber?: number
  isCupFinished?: boolean
  roundWinnerHandle?: string
  roundWinnerNick?: string
  roundWinnerSkin?: string
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
  eliminationCounter: number
  eliminationOrderByHandle: Record<string, number>
  pointMedalsByHandle: Record<string, Array<1 | 2 | 3>>
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
  eliminationCounter: 0,
  eliminationOrderByHandle: {},
  pointMedalsByHandle: {},
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
type SurvivalClimaxListener = (payload: MatchSurvivalClimaxPayload) => void
type GameOverListener = (payload: MatchGameOverPayload) => void
type ReturnToLobbyListener = (room: RoomStateDTO) => void

let onMatchStartCallback: MatchStartListener | null = null
let onReceiveNegativePowerCallback: NegativePowerListener | null = null
let onSurvivalClimaxCallback: SurvivalClimaxListener | null = null
let onGameOverCallback: GameOverListener | null = null
let onReturnToLobbyCallback: ReturnToLobbyListener | null = null

function recordEliminationIfNeeded(
  rawHandle: string,
  explicitOrder?: number
): number {
  if (!rawHandle) return 0
  const h = normalizeHandle(rawHandle)
  if (explicitOrder && explicitOrder > 0) {
    state.eliminationOrderByHandle[h] = explicitOrder
    if (explicitOrder > state.eliminationCounter) {
      state.eliminationCounter = explicitOrder
    }
    return explicitOrder
  }
  if (!state.eliminationOrderByHandle[h]) {
    state.eliminationCounter += 1
    state.eliminationOrderByHandle[h] = state.eliminationCounter
  }
  return state.eliminationOrderByHandle[h]
}

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
    if (roomState && state.room) {
      if (!roomState.selectedGameMode && state.room.selectedGameMode) {
        roomState.selectedGameMode = state.room.selectedGameMode
      }
      if (!roomState.victoryCondition && state.room.victoryCondition) {
        roomState.victoryCondition = state.room.victoryCondition
      }
    }
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
    state.eliminationCounter = 0
    state.eliminationOrderByHandle = {}
    if ((payload.roundNumber || 1) <= 1) {
      state.pointMedalsByHandle = {}
    }

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
        blindManualRemainingMs: 0,
        fogAnchorX: 0,
        fogAnchorY: -1.2 * GAME_CONSTANTS.UNIT_PX,
        islands: [],
        isEliminated: false,
        eliminationOrder: 0,
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
        const hasBlind =
          (remoteState.blindManualRemainingMs ?? 0) > 0 ||
          (remoteState.activeDebuffs || []).includes('BLIND_MANUAL')
        const elimOrder =
          remoteState.lives <= 0 || remoteState.isEliminated
            ? recordEliminationIfNeeded(h, remoteState.eliminationOrder)
            : 0
        state.remoteLanes[h] = {
          ...remoteState,
          handle: h,
          eliminationOrder: elimOrder,
          renderActivePiece: remoteState.activePiece
            ? { ...remoteState.activePiece }
            : null,
          renderSettledBlocks: (remoteState.settledBlocks || []).map((b) => ({
            ...b,
          })),
          blindManualRemainingMs:
            remoteState.blindManualRemainingMs ?? (hasBlind ? 20000 : 0),
          fogAnchorX: remoteState.fogAnchorX ?? 0,
          fogAnchorY:
            remoteState.fogAnchorY ??
            -Math.max(1.2, remoteState.towerHeight || 0) *
              GAME_CONSTANTS.UNIT_PX,
          islands: remoteState.islands || [],
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
      if (
        typeof remoteState.lives === 'number' &&
        remoteState.lives < existing.lives &&
        performance.now() - existing.lastLifeLostAtMs > 500
      ) {
        existing.lastLifeLostAtMs = performance.now()
      }
      existing.lives = remoteState.lives
      existing.mana = remoteState.mana
      existing.isEliminated = remoteState.isEliminated
      if (remoteState.lives <= 0 || remoteState.isEliminated) {
        existing.eliminationOrder = recordEliminationIfNeeded(
          h,
          remoteState.eliminationOrder
        )
      }
      existing.updatedAt = performance.now()
      if (remoteState.islands) {
        existing.islands = remoteState.islands
      }
      if (typeof remoteState.fogAnchorX === 'number') {
        existing.fogAnchorX = remoteState.fogAnchorX
      }
      if (typeof remoteState.fogAnchorY === 'number') {
        existing.fogAnchorY = remoteState.fogAnchorY
      }

      const incomingDebuffs = remoteState.activeDebuffs || []
      const incomingBlindMs = remoteState.blindManualRemainingMs ?? 0
      if (incomingBlindMs > 0) {
        existing.blindManualRemainingMs = incomingBlindMs
      } else if (incomingDebuffs.includes('BLIND_MANUAL')) {
        if (existing.blindManualRemainingMs <= 0) {
          existing.blindManualRemainingMs = 20000
          existing.fogAnchorY =
            -Math.max(1.2, remoteState.towerHeight || 0) *
            GAME_CONSTANTS.UNIT_PX
        }
      } else if (existing.blindManualRemainingMs < 18000) {
        // Only clear if not freshly triggered within the last 2s (avoids in-flight packet flicker)
        existing.blindManualRemainingMs = 0
      }

      if (
        existing.blindManualRemainingMs > 0 &&
        !incomingDebuffs.includes('BLIND_MANUAL')
      ) {
        existing.activeDebuffs = [...incomingDebuffs, 'BLIND_MANUAL']
      } else {
        existing.activeDebuffs = incomingDebuffs
      }

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
    (payload: {
      handle: string
      lives: number
      isEliminated: boolean
      eliminationOrder?: number
    }) => {
      if (!payload?.handle) return
      const h = normalizeHandle(payload.handle)
      const lane = state.remoteLanes[h]
      if (lane) {
        const lostLife = payload.lives < lane.lives
        lane.lives = payload.lives
        lane.isEliminated = payload.isEliminated
        if (payload.lives <= 0 || payload.isEliminated) {
          lane.eliminationOrder = recordEliminationIfNeeded(
            h,
            payload.eliminationOrder
          )
          lane.activePiece = null
          lane.renderActivePiece = null
          lane.settledBlocks = []
          lane.renderSettledBlocks = []
        }
        if (lostLife) {
          lane.lastLifeLostAtMs = performance.now()
        }
      } else if (payload.lives <= 0 || payload.isEliminated) {
        recordEliminationIfNeeded(h, payload.eliminationOrder)
      }
    }
  )

  socket.on(
    'match:survival_climax',
    (payload: MatchSurvivalClimaxPayload) => {
      if (onSurvivalClimaxCallback) {
        onSurvivalClimaxCallback(payload)
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
      const targetHandles = (payload.targetHandles || []).map((t) =>
        normalizeHandle(t)
      )
      const vfx: SynchronizedPowerVfx = {
        id: `${now}_${Math.random().toString(36).slice(2, 6)}`,
        casterHandle: normalizeHandle(payload.casterHandle),
        casterNick: payload.casterNick,
        casterSlotIndex: payload.casterSlotIndex,
        category: payload.category,
        powerType,
        targetHandles,
        createdAtMs: now,
        durationMs: payload.category === 'NEGATIVE' ? 1450 : 950,
      }
      state.activePowerVfx.push(vfx)

      const casterLane = state.remoteLanes[vfx.casterHandle]
      if (casterLane) {
        casterLane.mascotCastAnimMs = 950
        casterLane.mascotCastCategory = payload.category
      }

      if (payload.category === 'NEGATIVE') {
        for (const targetH of targetHandles) {
          const targetLane = state.remoteLanes[targetH]
          if (targetLane) {
            applyNegativePowerVisualToRemoteLane(targetLane, powerType)
          }
        }
      }

      const myHandle = normalizeHandle(authStore.state.user?.handle || '')
      if (
        payload.category === 'NEGATIVE' &&
        vfx.casterHandle !== myHandle &&
        targetHandles.includes(myHandle)
      ) {
        if (onReceiveNegativePowerCallback) {
          onReceiveNegativePowerCallback(powerType, payload.casterNick)
        }
      }
    }
  )

  socket.on('match:game_over', (payload: MatchGameOverPayload) => {
    const isSurvival =
      payload.gameMode === 'SURVIVAL' ||
      state.activeMatch?.gameMode === 'SURVIVAL'
    const winnerHandleNorm = normalizeHandle(payload.winnerHandle || '')

    let podium = (payload.podium || []).map((p) => {
      const h = normalizeHandle(p.handle)
      const elimOrder =
        p.eliminationOrder || state.eliminationOrderByHandle[h] || 0
      return {
        ...p,
        userId: p.userId || p.handle,
        eliminationOrder: elimOrder,
      }
    })

    if (isSurvival && podium.length > 1) {
      // Capture previous points earned before re-sorting so totalCupPoints stays accurate if adjusted
      const prevPointsByHandle: Record<string, number> = {}
      for (const p of podium) {
        prevPointsByHandle[normalizeHandle(p.handle)] = p.pointsEarned ?? 0
      }

      podium = [...podium].sort((a, b) => {
        const aIsWinner = normalizeHandle(a.handle) === winnerHandleNorm
        const bIsWinner = normalizeHandle(b.handle) === winnerHandleNorm
        if (aIsWinner) return -1
        if (bIsWinner) return 1
        const aAlive = a.lives > 0
        const bAlive = b.lives > 0
        if (aAlive !== bAlive) return aAlive ? -1 : 1
        if (!aAlive && !bAlive) {
          const aOrder = a.eliminationOrder || 0
          const bOrder = b.eliminationOrder || 0
          if (aOrder !== bOrder) {
            // Later eliminationOrder (died later) ranks higher!
            return bOrder - aOrder
          }
        }
        if (b.lives !== a.lives) return b.lives - a.lives
        return b.towerHeight - a.towerHeight
      })

      const pointsByRank = [3, 2, 1, 0]
      podium = podium.map((p, idx) => {
        const newPoints = pointsByRank[idx] ?? 0
        const oldPoints =
          prevPointsByHandle[normalizeHandle(p.handle)] ?? newPoints
        const prevCupPts =
          p.previousCupPoints ??
          Math.max(0, (p.cupPoints ?? oldPoints) - oldPoints)
        return {
          ...p,
          rank: idx + 1,
          pointsEarned: newPoints,
          previousCupPoints: prevCupPts,
          cupPoints: prevCupPts + newPoints,
        }
      })
    }

    podium = podium.map((p) => {
      const h = normalizeHandle(p.handle)
      const earned =
        p.pointsEarned ??
        (p.rank === 1 ? 3 : p.rank === 2 ? 2 : p.rank === 3 ? 1 : 0)
      const prevPts =
        p.previousCupPoints ?? Math.max(0, (p.cupPoints ?? earned) - earned)
      const prevMedals = (state.pointMedalsByHandle[h] || []).slice(0, prevPts)
      while (prevMedals.length < prevPts) {
        prevMedals.push(1)
      }
      const medalRank: 1 | 2 | 3 =
        p.rank === 1 ? 1 : p.rank === 2 ? 2 : 3
      const nextMedals: Array<1 | 2 | 3> = [...prevMedals]
      for (let i = 0; i < earned; i++) {
        nextMedals.push(medalRank)
      }
      state.pointMedalsByHandle[h] = nextMedals
      return {
        ...p,
        pointsEarned: earned,
        previousCupPoints: prevPts,
        cupPoints: prevPts + earned,
        pointMedals: nextMedals,
      }
    })

    const normalized: MatchGameOverPayload = {
      ...payload,
      winnerCustomNick:
        payload.winnerCustomNick || payload.winnerNick || 'VENCEDOR',
      winnerNick:
        payload.winnerNick || payload.winnerCustomNick || 'VENCEDOR',
      podium,
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
      state.pointMedalsByHandle = {}
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

function enterLobby(options?: {
  selectedGameMode?: SelectableGameMode
  victoryCondition?: VictoryCondition
}): Promise<RoomStateDTO> {
  connect()
  return new Promise((resolve, reject) => {
    if (!socket) {
      reject(new Error('Conexão em tempo real indisponível.'))
      return
    }
    let settled = false
    const timer = window.setTimeout(() => {
      if (settled) return
      settled = true
      reject(new Error('Tempo limite ao criar a sala Multiplayer.'))
    }, 4500)

    socket.emit(
      'room:enter_lobby',
      {
        selectedGameMode: options?.selectedGameMode,
        victoryCondition: options?.victoryCondition,
      },
      (res: { ok?: boolean; room?: RoomStateDTO; error?: string }) => {
        if (settled) return
        settled = true
        window.clearTimeout(timer)
        if (res?.ok && res.room) {
          if (options?.selectedGameMode) {
            res.room.selectedGameMode = options.selectedGameMode
            if (options.selectedGameMode !== 'RANDOM') {
              res.room.activeGameMode = options.selectedGameMode
            }
          }
          if (options?.victoryCondition) {
            res.room.victoryCondition = options.victoryCondition
            res.room.cupTargetPoints =
              options.victoryCondition === 'SINGLE_WIN'
                ? 1
                : options.victoryCondition === 'CUP_12'
                  ? 12
                  : 6
          }
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

function toggleReady(
  forceReady?: boolean,
  options?: {
    selectedGameMode?: SelectableGameMode
    victoryCondition?: VictoryCondition
  }
): Promise<RoomStateDTO> {
  connect()
  return new Promise((resolve, reject) => {
    if (!socket) {
      reject(new Error('Sem conexão com o servidor.'))
      return
    }
    let settled = false
    const timer = window.setTimeout(() => {
      if (settled) return
      settled = true
      if (state.room) {
        resolve(state.room)
      } else {
        reject(new Error('Tempo limite ao atualizar estado Pronto.'))
      }
    }, 3500)

    const selectedGameMode =
      options?.selectedGameMode || state.room?.selectedGameMode
    const victoryCondition =
      options?.victoryCondition || state.room?.victoryCondition

    socket.emit(
      'room:toggle_ready',
      {
        isReady: forceReady,
        selectedGameMode,
        victoryCondition,
      },
      (res: { ok?: boolean; room?: RoomStateDTO; error?: string }) => {
        if (settled) return
        settled = true
        window.clearTimeout(timer)
        if (res?.ok && res.room) {
          if (state.room) {
            if (!res.room.selectedGameMode && state.room.selectedGameMode) {
              res.room.selectedGameMode = state.room.selectedGameMode
            }
            if (!res.room.victoryCondition && state.room.victoryCondition) {
              res.room.victoryCondition = state.room.victoryCondition
            }
          }
          state.room = res.room
          resolve(res.room)
        } else {
          reject(new Error(res?.error || 'Falha ao atualizar estado Pronto.'))
        }
      }
    )
  })
}

function setRoomGameMode(gameMode: SelectableGameMode): Promise<RoomStateDTO> {
  // Optimistically update local room state immediately so UI responds without delay
  if (state.room) {
    state.room.selectedGameMode = gameMode
    if (gameMode !== 'RANDOM') {
      state.room.activeGameMode = gameMode
    }
  }
  connect()
  return new Promise((resolve, reject) => {
    if (!socket || !socket.connected) {
      if (state.room) {
        resolve(state.room)
      } else {
        reject(new Error('Sem conexão com o servidor.'))
      }
      return
    }
    let settled = false
    const timer = window.setTimeout(() => {
      if (settled) return
      settled = true
      if (state.room) {
        resolve(state.room)
      } else {
        reject(new Error('Tempo limite ao alterar modo de jogo.'))
      }
    }, 2000)

    socket.emit(
      'room:set_game_mode',
      { gameMode },
      (res: { ok?: boolean; room?: RoomStateDTO; error?: string }) => {
        if (settled) return
        settled = true
        window.clearTimeout(timer)
        if (res?.ok && res.room) {
          state.room = res.room
          resolve(res.room)
        } else if (state.room) {
          resolve(state.room)
        } else {
          reject(new Error(res?.error || 'Falha ao alterar modo de jogo.'))
        }
      }
    )
  })
}

function setRoomVictoryCondition(
  victoryCondition: VictoryCondition
): Promise<RoomStateDTO> {
  // Optimistically update local room state immediately so UI responds without delay
  if (state.room) {
    state.room.victoryCondition = victoryCondition
    state.room.cupTargetPoints =
      victoryCondition === 'SINGLE_WIN'
        ? 1
        : victoryCondition === 'CUP_12'
          ? 12
          : 6
  }
  connect()
  return new Promise((resolve, reject) => {
    if (!socket || !socket.connected) {
      if (state.room) {
        resolve(state.room)
      } else {
        reject(new Error('Sem conexão com o servidor.'))
      }
      return
    }
    let settled = false
    const timer = window.setTimeout(() => {
      if (settled) return
      settled = true
      if (state.room) {
        resolve(state.room)
      } else {
        reject(new Error('Tempo limite ao alterar condição de vitória.'))
      }
    }, 2000)

    socket.emit(
      'room:set_victory_condition',
      { victoryCondition },
      (res: { ok?: boolean; room?: RoomStateDTO; error?: string }) => {
        if (settled) return
        settled = true
        window.clearTimeout(timer)
        if (res?.ok && res.room) {
          state.room = res.room
          resolve(res.room)
        } else if (state.room) {
          resolve(state.room)
        } else {
          reject(
            new Error(res?.error || 'Falha ao alterar condição de vitória.')
          )
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

function applyNegativePowerVisualToRemoteLane(
  lane: RemoteLaneInterpolatedState,
  powerType: PowerId
): void {
  if (!lane.activeDebuffs.includes(powerType)) {
    lane.activeDebuffs = [...lane.activeDebuffs, powerType]
  }
  if (powerType === 'BLIND_MANUAL') {
    lane.blindManualRemainingMs = 20000
    lane.fogAnchorX = lane.fogAnchorX ?? 0
    lane.fogAnchorY =
      -Math.max(1.2, lane.towerHeight || 0) * GAME_CONSTANTS.UNIT_PX
  } else if (
    powerType === 'SLICK_BRICK' ||
    powerType === 'LOCK_ROTATE' ||
    powerType === 'TURBO_DROP'
  ) {
    if (
      lane.activePiece &&
      (!lane.activePiece.powerEffect || lane.activePiece.powerEffect === 'NONE')
    ) {
      lane.activePiece.powerEffect = powerType
    }
    if (
      lane.renderActivePiece &&
      (!lane.renderActivePiece.powerEffect ||
        lane.renderActivePiece.powerEffect === 'NONE')
    ) {
      lane.renderActivePiece.powerEffect = powerType
    }
  } else if (powerType === 'GIANT_PIECE') {
    if (
      lane.activePiece &&
      lane.activePiece.variant !== 'GIANT' &&
      lane.activePiece.y >= lane.towerHeight + 2.0
    ) {
      lane.activePiece.variant = 'GIANT'
      if (lane.renderActivePiece) {
        lane.renderActivePiece.variant = 'GIANT'
      }
    }
  }
}

function emitMatchSyncState(payload: {
  activePiece: ActivePieceSnapshot | null
  settledBlocks: SettledBlockSnapshot[]
  towerHeight: number
  lives: number
  mana: number
  activeDebuffs: string[]
  blindManualRemainingMs?: number
  fogAnchorX?: number
  fogAnchorY?: number
  islands?: FloatingIslandSnapshot[]
  isEliminated: boolean
}): void {
  if (payload.lives <= 0 || payload.isEliminated) {
    const myHandle = normalizeHandle(authStore.state.user?.handle || '')
    if (myHandle) {
      recordEliminationIfNeeded(myHandle)
    }
  }
  if (!socket || !socket.connected || !state.activeMatch) return
  socket.emit('match:sync_state', payload)
}

function emitPieceSettled(towerHeight: number, pieceCount: number): void {
  if (!socket || !socket.connected || !state.activeMatch) return
  socket.emit('match:piece_settled', { towerHeight, pieceCount })
}

function emitLifeLost(lives: number): void {
  if (lives <= 0) {
    const myHandle = normalizeHandle(authStore.state.user?.handle || '')
    if (myHandle) {
      recordEliminationIfNeeded(myHandle)
    }
  }
  if (!socket || !socket.connected || !state.activeMatch) return
  socket.emit('match:life_lost', { lives })
}

function emitUsePositivePower(powerType: PowerId): void {
  if (!socket || !socket.connected || !state.activeMatch) return
  socket.emit('match:use_positive_power', { powerType })
}

function emitUseNegativePower(powerType: PowerId, targetId?: string): void {
  // Optimistically apply the visual effect to the target opponent lane immediately
  const remoteList = Object.values(state.remoteLanes).filter(
    (l) => !l.isEliminated
  )
  if (remoteList.length > 0) {
    const sorted = [...remoteList].sort(
      (a, b) => b.towerHeight - a.towerHeight
    )
    const targetLane =
      (targetId && state.remoteLanes[normalizeHandle(targetId)]) || sorted[0]
    if (targetLane) {
      applyNegativePowerVisualToRemoteLane(targetLane, powerType)
    }
  }

  if (!socket || !socket.connected || !state.activeMatch) return
  socket.emit('match:use_negative_power', { powerType, targetId })
}

function emitClaimVictory(towerHeight: number, elapsedTimeMs: number): void {
  if (!socket || !socket.connected || !state.activeMatch) return
  socket.emit('match:claim_victory', {
    towerHeight,
    elapsedTimeMs,
    eliminationOrderByHandle: { ...state.eliminationOrderByHandle },
  })
}

function emitReturnToLobby(): void {
  if (!socket || !socket.connected) return
  socket.emit('match:return_to_lobby')
}

function emitNextCupRound(): void {
  if (!socket || !socket.connected) return
  socket.emit('match:next_cup_round')
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

    if (lane.blindManualRemainingMs > 0) {
      lane.blindManualRemainingMs = Math.max(
        0,
        lane.blindManualRemainingMs - dtMs
      )
      if (lane.blindManualRemainingMs <= 0) {
        lane.activeDebuffs = lane.activeDebuffs.filter(
          (d) => d !== 'BLIND_MANUAL'
        )
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
      lane.renderActivePiece.recallTransformProgress =
        lane.activePiece.recallTransformProgress
      lane.renderActivePiece.recallPowerId = lane.activePiece.recallPowerId
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
  onSurvivalClimax?: SurvivalClimaxListener
  onGameOver?: GameOverListener
  onReturnToLobby?: ReturnToLobbyListener
}): void {
  if (callbacks.onMatchStart !== undefined) {
    onMatchStartCallback = callbacks.onMatchStart
  }
  if (callbacks.onReceiveNegativePower !== undefined) {
    onReceiveNegativePowerCallback = callbacks.onReceiveNegativePower
  }
  if (callbacks.onSurvivalClimax !== undefined) {
    onSurvivalClimaxCallback = callbacks.onSurvivalClimax
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
  setRoomGameMode,
  setRoomVictoryCondition,
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
  emitNextCupRound,
  stepInterpolation,
  registerCallbacks,
}

