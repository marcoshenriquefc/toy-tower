<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref } from 'vue'
import { TowerInstance } from './game/TowerInstance'
import {
  GAME_CONSTANTS,
  GameMode,
  PieceType,
  PieceVariant,
  SelectableGameMode,
  TowerSnapshot,
  VictoryCondition,
} from './types/game'
import { ALL_PIECE_TYPES, PIECE_CATALOG } from './game/PieceCatalog'
import {
  getPowerConfig,
  PowerId,
  POWERS_REGISTRY,
} from './game/PowersCatalog'
import { generateRandomMatchSeed } from './game/SeededRandomizer'
import {
  BASE_TERRAIN_CATALOG,
  BasePresetId,
  selectBasePresetForSeed,
} from './game/BaseTerrainCatalog'
import {
  PlayerSkinInfo,
  spriteRegistry,
  SpriteKey,
  SpriteSlot,
} from './sprites/SpriteRegistry'
import PiecePreviewCanvas from './components/PiecePreviewCanvas.vue'
import {
  authStore,
  dbSkinToSpriteId,
  FriendAccountEntry,
  spriteIdToDbSkin,
} from './services/authStore'
import {
  multiplayerClient,
  RoomStateDTO,
} from './services/multiplayerClient'
import {
  PowerVfxRenderData,
  RemoteLaneRenderData,
} from './game/TowerInstance'

const canvasRef = ref<HTMLCanvasElement | null>(null)
const canvasWidth = ref<number>(window.innerWidth)
const canvasHeight = ref<number>(window.innerHeight)

/** Default is FALSE: 100% full-screen Tricky Towers scenery */
const isDevModeOpen = ref<boolean>(false)
const activeTab = ref<'sprites' | 'catalog' | 'network' | 'controls'>('sprites')

const initialRandomSeed = generateRandomMatchSeed()
const initialBasePreset = selectBasePresetForSeed(initialRandomSeed)
const seedInput = ref<string>(initialRandomSeed)
const forcedBasePresetId = ref<BasePresetId | null>(null)
const isShiftHeld = ref<boolean>(false)
const showColliders = ref<boolean>(false)
const showGhostPiece = ref<boolean>(false)
const windEnabled = ref<boolean>(true)
const slideLevel = ref<number>(50)
const forcePlaceholders = ref<boolean>(spriteRegistry.forcePlaceholders)
const dynamicTintEnabled = ref<boolean>(spriteRegistry.dynamicTintEnabled)
const spriteSlots = ref<SpriteSlot[]>(spriteRegistry.getAllSlots())
const playerSkins = ref<PlayerSkinInfo[]>(spriteRegistry.getPlayerSkins())
const activePlayerSkinId = ref<string>(spriteRegistry.getActivePlayerSkinId())
const isSkinPickerOpen = ref<boolean>(false)

type ScreenFlowState =
  | 'TITLE_SCREEN'
  | 'TRANSITIONING'
  | 'MAIN_MENU'
  | 'LOCAL_LOBBY'
  | 'MULTIPLAYER_LOBBY'
  | 'IN_GAME'
const screenFlow = ref<ScreenFlowState>('TITLE_SCREEN')
const selectedMenuCard = ref<'LOCAL' | 'MULTIPLAYER'>('LOCAL')
const isAuthModalOpen = ref<boolean>(false)
const isOnlineMultiplayerMatch = ref<boolean>(false)
const localPlayerLives = ref<number>(3)

/** Selected game mode in Local / Multiplayer lobby ('RACE' | 'SURVIVAL' | 'RANDOM') */
const selectedGameMode = ref<SelectableGameMode>('RACE')
/** Resolved active game mode for the current match ('RACE' | 'SURVIVAL') */
const activeMatchGameMode = ref<GameMode>('RACE')
/** Selected Victory Condition (valid only for Multiplayer mode: 'SINGLE_WIN' | 'CUP_6' | 'CUP_12') */
const selectedVictoryCondition = ref<VictoryCondition>('CUP_6')
/** Controls the "Selecione o Modo de Jogo / Condição de Vitória" popup opened via the Gear button */
const isGameModeModalOpen = ref<boolean>(false)

const isEditingCustomNick = ref<boolean>(false)
const customNickInput = ref<string>('')
const isSavingCustomNick = ref<boolean>(false)

type LobbySlotState = 'EMPTY' | 'JOINED_UNREADY' | 'READY'

interface LobbySlotInfo {
  slotIndex: number
  state: LobbySlotState
  isLocalHost: boolean
  customNick: string
  handle: string
  skinSpriteId: string
  silhouetteSkinId: string
  cupPoints: number
}

const DEFAULT_SILHOUETTE_SKINS = [
  'player_shadow',
  'player_dino',
  'player_pirate',
  'player_mage',
]

const fallbackLobbySlots = ref<LobbySlotInfo[]>([
  {
    slotIndex: 0,
    state: 'JOINED_UNREADY',
    isLocalHost: true,
    customNick: 'ReiDosBlocos',
    handle: '@lucas_042',
    skinSpriteId: 'player_shadow',
    silhouetteSkinId: 'player_shadow',
    cupPoints: 0,
  },
  {
    slotIndex: 1,
    state: 'EMPTY',
    isLocalHost: false,
    customNick: '',
    handle: '',
    skinSpriteId: 'player_dino',
    silhouetteSkinId: 'player_dino',
    cupPoints: 0,
  },
  {
    slotIndex: 2,
    state: 'EMPTY',
    isLocalHost: false,
    customNick: '',
    handle: '',
    skinSpriteId: 'player_pirate',
    silhouetteSkinId: 'player_pirate',
    cupPoints: 0,
  },
  {
    slotIndex: 3,
    state: 'EMPTY',
    isLocalHost: false,
    customNick: '',
    handle: '',
    skinSpriteId: 'player_mage',
    silhouetteSkinId: 'player_mage',
    cupPoints: 0,
  },
])

const lobbySlots = computed<LobbySlotInfo[]>(() => {
  const room = multiplayerClient.state.room
  if (!room) {
    return fallbackLobbySlots.value
  }
  const myHandle = (authStore.state.user?.handle || '').toLowerCase()
  return [0, 1, 2, 3].map((idx) => {
    const slotPlayer = room.slots[idx]
    const silhouetteSkinId = DEFAULT_SILHOUETTE_SKINS[idx] || 'player_mage'
    if (!slotPlayer || !slotPlayer.handle) {
      return {
        slotIndex: idx,
        state: 'EMPTY' as LobbySlotState,
        isLocalHost: false,
        customNick: '',
        handle: '',
        skinSpriteId: silhouetteSkinId,
        silhouetteSkinId,
        cupPoints: 0,
      }
    }
    const isMe =
      Boolean(myHandle) && slotPlayer.handle.toLowerCase() === myHandle
    return {
      slotIndex: idx,
      state: (slotPlayer.isReady ? 'READY' : 'JOINED_UNREADY') as LobbySlotState,
      isLocalHost: isMe,
      customNick: slotPlayer.customNick,
      handle: slotPlayer.handle,
      skinSpriteId: dbSkinToSpriteId(slotPlayer.equippedSkin),
      silhouetteSkinId,
      cupPoints: slotPlayer.cupPoints ?? 0,
    }
  })
})

const isFriendsModalOpen = ref<boolean>(false)
const isBurgerMenuOpen = ref<boolean>(false)
const pendingFriendsOpenAfterLogin = ref<'list' | 'invite' | null>(null)
const friendSearchInputRef = ref<HTMLInputElement | null>(null)
const pendingInviteSlotIndex = ref<number | null>(null)
const friendSearchInput = ref<string>('')
const isAddingFriend = ref<boolean>(false)
const invitingFriendHandles = ref<Record<string, boolean>>({})
const lobbyCountdownMs = ref<number | null>(null)

const menuSprites = ref<Record<string, string>>(spriteRegistry.getMenuSprites())
const [initialLeftSkin, initialRightSkin] =
  spriteRegistry.pickTwoRandomPlayerSkins()
const menuLeftSkinId = ref<string>(initialLeftSkin)
const menuRightSkinId = ref<string>(initialRightSkin)
const titleTowerAlpha = ref<number>(1.0)
let menuAnimTimeMs = 0
let transitionElapsedMs = 0
let wasGamepadPressed = false
let syncBroadcastAccumMs = 0

const activePlayerSkin = computed<PlayerSkinInfo | null>(() => {
  return (
    playerSkins.value.find((s) => s.id === activePlayerSkinId.value) ||
    playerSkins.value[0] ||
    null
  )
})

const positivePowersList = POWERS_REGISTRY.filter(
  (p) => p.category === 'POSITIVE'
)
const negativePowersList = POWERS_REGISTRY.filter(
  (p) => p.category === 'NEGATIVE'
)

const slideLevelDescription = computed(() => {
  if (slideLevel.value <= 25) return '🔒 Firme / Fácil'
  if (slideLevel.value <= 65) return '⚖️ Equilibrado'
  return '🧊 Escorregadio'
})

const eventBanner = ref<{
  message: string
  tone: 'info' | 'warning' | 'success' | 'danger'
} | null>(null)
let bannerTimeout: ReturnType<typeof setTimeout> | null = null

function triggerBanner(
  message: string,
  tone: 'info' | 'warning' | 'success' | 'danger'
) {
  eventBanner.value = { message, tone }
  if (bannerTimeout) clearTimeout(bannerTimeout)
  bannerTimeout = setTimeout(() => {
    eventBanner.value = null
  }, 3000)
}

const snapshot = ref<TowerSnapshot>({
  playerId: 'player_1',
  matchSeed: initialRandomSeed,
  isSinglePlayer: true,
  gameMode: 'RACE',
  lives: GAME_CONSTANTS.SURVIVAL_INITIAL_LIVES,
  maxLives: GAME_CONSTANTS.SURVIVAL_INITIAL_LIVES,
  piecesPlaced: 0,
  survivalGoalPieces: GAME_CONSTANTS.SURVIVAL_GOAL_PIECES,
  maxTowerHeight: 0,
  basePresetId: initialBasePreset.id,
  basePresetName: initialBasePreset.name,
  baseElevations: [...initialBasePreset.elevations],
  elapsedTimeMs: 0,
  towerHeight: 0,
  state: 'COUNTDOWN',
  countdownRemainingMs: 3000,
  goalCountdownMs: null,
  respawnDelayRemainingMs: 0,
  windForce: 0,
  windActive: false,
  checkpointsReached: [],
  checkpointHoldProgress: null,
  inventoryPower: {
    selfPower: null,
    attackPower: null,
    sourceCheckpoint: null,
  },
  blindManualRemainingMs: 0,
  nextQueue: [],
  activePiece: null,
  settledBlocks: [],
})

interface GameModeOptionCard {
  id: SelectableGameMode
  title: string
  shortTitle: string
  badge: string
  icon: string
  accentColor: string
  description: string
  rulesSummary: string[]
}

const GAME_MODE_OPTIONS: GameModeOptionCard[] = [
  {
    id: 'RACE',
    title: 'MODO CORRIDA',
    shortTitle: 'Corrida (30m)',
    badge: 'CLÁSSICO',
    icon: '🏁',
    accentColor: '#3B82F6',
    description:
      'Corra até a linha de chegada em 30m, estabilize sua torre por 3 segundos e encaixe o Telhado do Castelo para vencer!',
    rulesSummary: [
      '🏁 Meta: Alcançar 30m de altura primeiro',
      '🏰 Clímax: Segure 3s e solde o Telhado 3×3',
      '🌊 Quedas na água aplicam apenas penalidade de tempo (1,5s)',
    ],
  },
  {
    id: 'SURVIVAL',
    title: 'MODO SOBREVIVÊNCIA',
    shortTitle: 'Sobrevivência (3 Vidas • 50 Peças)',
    badge: '3 VIDAS • 50 PEÇAS',
    icon: '❤️',
    accentColor: '#EF4444',
    description:
      'Você tem 50 peças e 3 Vidas (❤️❤️❤️). Coloque todas as 50 peças sem perder suas vidas! Quem terminar primeiro (ou for o último sobrevivente) vence!',
    rulesSummary: [
      '🧱 Meta de 50 Peças: Coloque todas as 50 peças primeiro mantendo suas vidas para vencer!',
      '❤️❤️❤️ 3 Vidas + 3s Invulnerável: Ao cair uma peça, seu mago pisca invulnerável por 3s',
      '🎈 Poder Vida Extra: Solta um balão flutuante — pegue-o com a peça controlada antes que fuja!',
    ],
  },
  {
    id: 'RANDOM',
    title: 'ALEATÓRIO',
    shortTitle: 'Aleatório',
    badge: 'SORTEIO',
    icon: '🎲',
    accentColor: '#A855F7',
    description:
      'Não consegue decidir? O jogo sorteia automaticamente entre Modo Corrida e Modo Sobrevivência no início da partida!',
    rulesSummary: [
      '🎲 Sorteia 50/50 entre Corrida (30m) e Sobrevivência (3 Vidas)',
      '✨ Revela o modo sorteado assim que a partida começa',
      '🔄 Novo sorteio a cada revanche ou reinício',
    ],
  },
]

interface VictoryConditionOptionCard {
  id: VictoryCondition
  title: string
  shortTitle: string
  badge: string
  icon: string
  accentColor: string
  targetPoints: number
  description: string
  rulesSummary: string[]
}

const VICTORY_CONDITION_OPTIONS: VictoryConditionOptionCard[] = [
  {
    id: 'SINGLE_WIN',
    title: 'COPA 1 VITÓRIA',
    shortTitle: 'Copa 1 Vitória',
    badge: '1 RODADA',
    icon: '🥇',
    accentColor: '#10B981',
    targetPoints: 3,
    description:
      'Partida rápida de rodada única! Quem vencer em 1º lugar recebe os 3 pontos da vitória e conquista o troféu imediatamente.',
    rulesSummary: [
      '🥇 1º Lugar conquista a vitória imediata (+3 pts)',
      '⚡ Ideal para duelos rápidos de 1 rodada',
      '📋 Cartela rápida de 3 áreas (1 vitória = 3/3)',
    ],
  },
  {
    id: 'CUP_6',
    title: 'COPA 6 PONTOS',
    shortTitle: 'Copa 6 Pontos',
    badge: 'CARTELA 6 PTS',
    icon: '🏆',
    accentColor: '#F59E0B',
    targetPoints: 6,
    description:
      'Torneio clássico estilo Tricky Towers! A cada rodada os jogadores preenchem sua Cartela de 6 áreas conforme a colocação.',
    rulesSummary: [
      '🥇 1º = 3 pts • 🥈 2º = 2 pts • 🥉 3º = 1 pt • 4º = 0 pts',
      '📋 Cada ponto preenche 1 área da Cartela (total de 6 áreas)',
      '🏆 O primeiro jogador a preencher todas as 6 áreas vence a Copa!',
    ],
  },
  {
    id: 'CUP_12',
    title: 'COPA 12 PONTOS',
    shortTitle: 'Copa 12 Pontos',
    badge: 'CARTELA 12 PTS',
    icon: '👑',
    accentColor: '#EC4899',
    targetPoints: 12,
    description:
      'Grande Copa Maratona! Disputa épica em múltiplas rodadas onde vence quem preencher primeiro todas as 12 áreas da Cartela!',
    rulesSummary: [
      '🥇 1º = 3 pts • 🥈 2º = 2 pts • 🥉 3º = 1 pt • 4º = 0 pts',
      '📋 Cada ponto preenche 1 área da Cartela (total de 12 áreas)',
      '👑 Exige consistência máxima até completar as 12 áreas!',
    ],
  },
]

const currentLobbySelectableMode = computed<SelectableGameMode>(() => {
  if (
    screenFlow.value === 'MULTIPLAYER_LOBBY' &&
    multiplayerClient.state.room?.selectedGameMode
  ) {
    return multiplayerClient.state.room.selectedGameMode
  }
  return selectedGameMode.value
})

const currentLobbyModeInfo = computed<GameModeOptionCard>(() => {
  const mode = currentLobbySelectableMode.value
  return (
    GAME_MODE_OPTIONS.find((opt) => opt.id === mode) || GAME_MODE_OPTIONS[0]
  )
})

const currentLobbyVictoryCondition = computed<VictoryCondition>(() => {
  if (
    screenFlow.value === 'MULTIPLAYER_LOBBY' &&
    multiplayerClient.state.room?.victoryCondition
  ) {
    return multiplayerClient.state.room.victoryCondition
  }
  return selectedVictoryCondition.value
})

const currentLobbyVictoryInfo = computed<VictoryConditionOptionCard>(() => {
  const vc = currentLobbyVictoryCondition.value
  return (
    VICTORY_CONDITION_OPTIONS.find((opt) => opt.id === vc) ||
    VICTORY_CONDITION_OPTIONS[1]
  )
})

function openGameModeModal() {
  isBurgerMenuOpen.value = false
  isGameModeModalOpen.value = true
}

function closeGameModeModal() {
  isGameModeModalOpen.value = false
}

async function selectGameModeOption(mode: SelectableGameMode) {
  selectedGameMode.value = mode
  const chosen =
    GAME_MODE_OPTIONS.find((opt) => opt.id === mode) || GAME_MODE_OPTIONS[0]

  if (
    screenFlow.value === 'MULTIPLAYER_LOBBY' &&
    multiplayerClient.state.room
  ) {
    try {
      await multiplayerClient.setRoomGameMode(mode)
      triggerBanner(
        `⚙️ Modo da sala alterado para: ${chosen.icon} ${chosen.title}!`,
        'success'
      )
    } catch (err) {
      triggerBanner(
        err instanceof Error ? err.message : 'Erro ao alterar modo da sala.',
        'danger'
      )
    }
  } else {
    triggerBanner(
      `⚙️ Modo selecionado: ${chosen.icon} ${chosen.title}!`,
      'success'
    )
  }
}

async function selectVictoryConditionOption(vc: VictoryCondition) {
  selectedVictoryCondition.value = vc
  const chosen =
    VICTORY_CONDITION_OPTIONS.find((opt) => opt.id === vc) ||
    VICTORY_CONDITION_OPTIONS[1]

  if (
    screenFlow.value === 'MULTIPLAYER_LOBBY' &&
    multiplayerClient.state.room
  ) {
    try {
      await multiplayerClient.setRoomVictoryCondition(vc)
      triggerBanner(
        `🏆 Condição de Vitória da Sala: ${chosen.icon} ${chosen.title}!`,
        'success'
      )
    } catch (err) {
      triggerBanner(
        err instanceof Error
          ? err.message
          : 'Erro ao alterar condição de vitória.',
        'danger'
      )
    }
  } else {
    triggerBanner(
      `🏆 Condição de Vitória (Multiplayer): ${chosen.icon} ${chosen.title}!`,
      'info'
    )
  }
}

function handleNextCupRound() {
  multiplayerClient.emitNextCupRound()
}

function resolveEffectiveGameMode(mode: SelectableGameMode): GameMode {
  if (mode === 'RANDOM') {
    return Math.random() < 0.5 ? 'SURVIVAL' : 'RACE'
  }
  return mode
}

const currentSelfPower = computed(() =>
  getPowerConfig(snapshot.value.inventoryPower.selfPower)
)
const currentAttackPower = computed(() =>
  getPowerConfig(snapshot.value.inventoryPower.attackPower)
)

let towerInstance: TowerInstance | null = null
let rafId: number | null = null
let lastFrameTime = 0

const formattedTime = computed(() => {
  const ms = snapshot.value.elapsedTimeMs
  const totalSec = Math.floor(ms / 1000)
  const mins = Math.floor(totalSec / 60)
  const secs = totalSec % 60
  const tenths = Math.floor((ms % 1000) / 100)
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}.${tenths}`
})

const heightProgressPercent = computed(() => {
  return Math.min(
    100,
    Math.max(
      0,
      (snapshot.value.towerHeight / GAME_CONSTANTS.GOAL_HEIGHT_UNITS) * 100
    )
  )
})

const snappedBlocksCount = computed(() => {
  return snapshot.value.settledBlocks.filter((b) => b.snapped).length
})

const sleepingBlocksCount = computed(() => {
  return snapshot.value.settledBlocks.filter((b) => b.sleeping).length
})

const formattedSnapshotJson = computed(() => {
  const s = snapshot.value
  return JSON.stringify(
    {
      playerId: s.playerId,
      state: s.state,
      goalCountdownMs: s.goalCountdownMs,
      isSinglePlayer: s.isSinglePlayer,
      elapsedTimeMs: s.elapsedTimeMs,
      towerHeight: s.towerHeight,
      checkpointsReached: s.checkpointsReached,
      inventoryPower: s.inventoryPower,
      activePiece: s.activePiece,
      settledBlocks: s.settledBlocks.slice(-8),
    },
    null,
    2
  )
})

function handleResize() {
  canvasWidth.value = window.innerWidth
  canvasHeight.value = window.innerHeight
}

function transitionToMainMenu() {
  if (screenFlow.value !== 'TITLE_SCREEN') return
  multiplayerClient.wakeUpSocketServer()
  screenFlow.value = 'TRANSITIONING'
  transitionElapsedMs = 0
}

const friendsList = computed<Array<FriendAccountEntry & { isOnline: boolean }>>(
  () => {
    const raw = authStore.state.user?.friends ?? []
    return raw.map((f) => ({
      ...f,
      isOnline: isFriendOnline(f.handle),
    }))
  }
)

const lobbyCountdownDisplayNumber = computed<number | null>(() => {
  if (multiplayerClient.state.countdownSeconds !== null) {
    return multiplayerClient.state.countdownSeconds
  }
  if (lobbyCountdownMs.value === null) return null
  return Math.max(1, Math.ceil(lobbyCountdownMs.value / 1000))
})

function getSkinSpriteUrl(skinSpriteId: string): string {
  const found = playerSkins.value.find(
    (s) => s.id.toLowerCase() === skinSpriteId.toLowerCase()
  )
  return found?.url || playerSkins.value[0]?.url || ''
}

function getFriendSkinSpriteUrl(equippedSkin: string): string {
  const spriteId = dbSkinToSpriteId(equippedSkin)
  return getSkinSpriteUrl(spriteId)
}

function isFriendOnline(handle: string): boolean {
  return multiplayerClient.isFriendOnline(handle)
}

function openNickEditor() {
  customNickInput.value =
    authStore.state.user?.customNick ||
    lobbySlots.value.find((s) => s.isLocalHost)?.customNick ||
    ''
  isEditingCustomNick.value = true
}

function cancelNickEditor() {
  isEditingCustomNick.value = false
}

async function saveCustomNick() {
  const cleaned = customNickInput.value.trim()
  if (cleaned.length < 2 || cleaned.length > 16) {
    triggerBanner('O apelido deve ter entre 2 e 16 caracteres.', 'warning')
    return
  }
  isSavingCustomNick.value = true
  try {
    await multiplayerClient.updateCustomNick(cleaned)
    if (fallbackLobbySlots.value[0]) {
      fallbackLobbySlots.value[0].customNick = cleaned
    }
    isEditingCustomNick.value = false
    triggerBanner(`✨ Apelido atualizado para "${cleaned}"!`, 'success')
  } catch (err) {
    triggerBanner(
      err instanceof Error ? err.message : 'Erro ao atualizar apelido.',
      'danger'
    )
  } finally {
    isSavingCustomNick.value = false
  }
}

async function enterMultiplayerLobby() {
  const user = authStore.state.user
  const hostSkin = activePlayerSkinId.value || 'player_shadow'
  fallbackLobbySlots.value = [
    {
      slotIndex: 0,
      state: 'JOINED_UNREADY',
      isLocalHost: true,
      customNick: user?.customNick || 'ReiDosBlocos',
      handle: user?.handle || '@lucas_042',
      skinSpriteId: hostSkin,
      silhouetteSkinId: 'player_shadow',
      cupPoints: 0,
    },
    {
      slotIndex: 1,
      state: 'EMPTY',
      isLocalHost: false,
      customNick: '',
      handle: '',
      skinSpriteId: 'player_dino',
      silhouetteSkinId: 'player_dino',
      cupPoints: 0,
    },
    {
      slotIndex: 2,
      state: 'EMPTY',
      isLocalHost: false,
      customNick: '',
      handle: '',
      skinSpriteId: 'player_pirate',
      silhouetteSkinId: 'player_pirate',
      cupPoints: 0,
    },
    {
      slotIndex: 3,
      state: 'EMPTY',
      isLocalHost: false,
      customNick: '',
      handle: '',
      skinSpriteId: 'player_mage',
      silhouetteSkinId: 'player_mage',
      cupPoints: 0,
    },
  ]
  lobbyCountdownMs.value = null
  isFriendsModalOpen.value = false
  isEditingCustomNick.value = false
  pendingInviteSlotIndex.value = null
  screenFlow.value = 'MULTIPLAYER_LOBBY'

  try {
    const room = await multiplayerClient.enterLobby()
    if (
      room &&
      room.selectedGameMode !== selectedGameMode.value &&
      room.hostHandle?.toLowerCase() === (user?.handle || '').toLowerCase()
    ) {
      await multiplayerClient.setRoomGameMode(selectedGameMode.value)
    }
    if (
      room &&
      room.victoryCondition !== selectedVictoryCondition.value &&
      room.hostHandle?.toLowerCase() === (user?.handle || '').toLowerCase()
    ) {
      await multiplayerClient.setRoomVictoryCondition(
        selectedVictoryCondition.value
      )
    }
  } catch {
    // Fallback local lobby if offline
  }
}

function syncLobbyCountdownState() {
  if (multiplayerClient.state.room) return
  const occupied = fallbackLobbySlots.value.filter((s) => s.state !== 'EMPTY')
  const allReady =
    occupied.length >= 1 && occupied.every((s) => s.state === 'READY')
  if (allReady) {
    if (lobbyCountdownMs.value === null) {
      lobbyCountdownMs.value = 3000
    }
  } else {
    lobbyCountdownMs.value = null
  }
}

async function toggleLobbySlotReady(slotIndex: number) {
  const slot = lobbySlots.value[slotIndex]
  if (!slot || !slot.isLocalHost || slot.state === 'EMPTY') return

  if (multiplayerClient.state.room) {
    try {
      const nextReady = slot.state !== 'READY'
      const updatedRoom = await multiplayerClient.toggleReady(nextReady)
      const occupied = updatedRoom.slots.filter(Boolean)
      // If playing solo in the room (1 player) and ready, start local 3s countdown too so host can test immediately
      if (occupied.length === 1 && nextReady) {
        lobbyCountdownMs.value = 3000
      } else {
        lobbyCountdownMs.value = null
      }
    } catch (err) {
      triggerBanner(
        err instanceof Error ? err.message : 'Erro ao atualizar Pronto.',
        'danger'
      )
    }
    return
  }

  const fbSlot = fallbackLobbySlots.value[slotIndex]
  if (!fbSlot) return
  fbSlot.state = fbSlot.state === 'READY' ? 'JOINED_UNREADY' : 'READY'
  syncLobbyCountdownState()
}

function cycleLocalLobbySkin() {
  if (playerSkins.value.length === 0) return
  const localSlot =
    lobbySlots.value.find((s) => s.isLocalHost) || lobbySlots.value[0]
  const currentIdx = playerSkins.value.findIndex(
    (s) => s.id === localSlot.skinSpriteId
  )
  const nextSkin =
    playerSkins.value[(currentIdx + 1) % playerSkins.value.length]
  if (!nextSkin) return
  selectPlayerSkin(nextSkin.id)
  if (fallbackLobbySlots.value[0]) {
    fallbackLobbySlots.value[0].skinSpriteId = nextSkin.id
  }
  multiplayerClient.updateEquippedSkin(spriteIdToDbSkin(nextSkin.id))
}

async function cancelLobbyCountdown() {
  lobbyCountdownMs.value = null
  if (multiplayerClient.state.room) {
    try {
      await multiplayerClient.toggleReady(false)
    } catch {
      // Ignore
    }
    return
  }
  if (
    fallbackLobbySlots.value[0] &&
    fallbackLobbySlots.value[0].state === 'READY'
  ) {
    fallbackLobbySlots.value[0].state = 'JOINED_UNREADY'
  }
}

function toggleBurgerMenu() {
  isBurgerMenuOpen.value = !isBurgerMenuOpen.value
}

function closeBurgerMenu() {
  isBurgerMenuOpen.value = false
}

function openFriendsFromBurger(mode: 'list' | 'invite') {
  isBurgerMenuOpen.value = false
  if (!authStore.isAuthenticated.value) {
    pendingFriendsOpenAfterLogin.value = mode
    authStore.state.error = null
    isAuthModalOpen.value = true
    return
  }
  multiplayerClient.connect()
  pendingInviteSlotIndex.value = null
  isFriendsModalOpen.value = true
  if (mode === 'invite') {
    void nextTick(() => {
      friendSearchInputRef.value?.focus()
    })
  }
}

async function copyMyHandle() {
  const handle = authStore.state.user?.handle
  if (!handle) return
  try {
    await navigator.clipboard.writeText(handle)
    triggerBanner(`📋 Seu ID ${handle} foi copiado!`, 'success')
  } catch {
    triggerBanner(`Seu ID: ${handle}`, 'info')
  }
}

function openFriendsInviteModal(slotIndex?: number) {
  isBurgerMenuOpen.value = false
  pendingInviteSlotIndex.value =
    typeof slotIndex === 'number' ? slotIndex : null
  isFriendsModalOpen.value = true
}

function closeFriendsInviteModal() {
  isFriendsModalOpen.value = false
  pendingInviteSlotIndex.value = null
}

function isFriendInLobby(handle: string): boolean {
  const target = handle.toLowerCase()
  return lobbySlots.value.some(
    (s) => s.state !== 'EMPTY' && s.handle.toLowerCase() === target
  )
}

async function handleAddFriend() {
  const query = friendSearchInput.value.trim()
  if (!query || isAddingFriend.value) return
  isAddingFriend.value = true
  try {
    const result = await multiplayerClient.sendFriendRequest(query)
    friendSearchInput.value = ''
    if (result.autoAccepted) {
      triggerBanner(
        `🤝 Vocês agora são amigos! ${result.target.customNick} (${result.target.handle}) foi adicionado!`,
        'success'
      )
    } else {
      triggerBanner(
        `📨 Convite enviado! ${result.target.customNick} (${result.target.handle}) já está na sua lista de amigos e no Multiplayer!`,
        'success'
      )
    }
  } catch (err) {
    triggerBanner(
      err instanceof Error ? err.message : 'Jogador não encontrado',
      'danger'
    )
  } finally {
    isAddingFriend.value = false
  }
}

async function handleRespondFriendRequest(
  senderHandle: string,
  accept: boolean
) {
  try {
    const res = await multiplayerClient.respondFriendRequest(
      senderHandle,
      accept
    )
    if (accept && res.acceptedFriend) {
      triggerBanner(
        `🤝 Pedido aceito! ${res.acceptedFriend.customNick} (${res.acceptedFriend.handle}) agora está na sua lista de amigos!`,
        'success'
      )
    } else {
      triggerBanner('Pedido de amizade recusado.', 'info')
    }
  } catch (err) {
    triggerBanner(
      err instanceof Error ? err.message : 'Erro ao responder pedido.',
      'danger'
    )
  }
}

async function handleInviteFriend(friend: FriendAccountEntry) {
  const isOwnerFriend = friendsList.value.some(
    (f) => f.handle.toLowerCase() === friend.handle.toLowerCase()
  )
  if (!isOwnerFriend) {
    triggerBanner(
      'Você só pode convidar amigos da sua própria lista!',
      'warning'
    )
    return
  }
  if (!isFriendOnline(friend.handle)) {
    triggerBanner(
      `${friend.customNick} está OFFLINE no momento.`,
      'warning'
    )
    return
  }
  if (invitingFriendHandles.value[friend.handle]) return

  if (screenFlow.value !== 'MULTIPLAYER_LOBBY') {
    await enterMultiplayerLobby()
  }

  if (isFriendInLobby(friend.handle)) {
    triggerBanner(`${friend.customNick} já está na sala!`, 'info')
    return
  }

  invitingFriendHandles.value = {
    ...invitingFriendHandles.value,
    [friend.handle]: true,
  }

  try {
    await multiplayerClient.inviteFriend(
      friend.handle,
      pendingInviteSlotIndex.value ?? undefined
    )
    triggerBanner(
      `📨 Convite enviado em tempo real para ${friend.customNick} (${friend.handle})!`,
      'success'
    )
    setTimeout(() => {
      const nextInviting = { ...invitingFriendHandles.value }
      delete nextInviting[friend.handle]
      invitingFriendHandles.value = nextInviting
    }, 1500)
  } catch (err) {
    const nextInviting = { ...invitingFriendHandles.value }
    delete nextInviting[friend.handle]
    invitingFriendHandles.value = nextInviting
    triggerBanner(
      err instanceof Error ? err.message : 'Erro ao convidar amigo.',
      'danger'
    )
  }
}

async function handleAcceptIncomingRoomInvite() {
  const invite = multiplayerClient.state.incomingRoomInvite
  if (!invite) return
  try {
    await multiplayerClient.acceptRoomInvite(
      invite.roomId,
      invite.preferredSlotIndex
    )
    isAuthModalOpen.value = false
    isFriendsModalOpen.value = false
    isBurgerMenuOpen.value = false
    screenFlow.value = 'MULTIPLAYER_LOBBY'
    triggerBanner(
      `🎮 Você entrou na sala de ${invite.hostCustomNick} (${invite.hostHandle})! Clique em PRONTO quando quiser!`,
      'success'
    )
  } catch (err) {
    triggerBanner(
      err instanceof Error ? err.message : 'Não foi possível entrar na sala.',
      'danger'
    )
  }
}

function handleDeclineIncomingRoomInvite() {
  const invite = multiplayerClient.state.incomingRoomInvite
  if (!invite) return
  multiplayerClient.declineRoomInvite(invite.roomId)
}

function openLocalBattleLobby() {
  selectedMenuCard.value = 'LOCAL'
  isBurgerMenuOpen.value = false
  isAuthModalOpen.value = false
  isFriendsModalOpen.value = false
  isGameModeModalOpen.value = false
  screenFlow.value = 'LOCAL_LOBBY'
}

function startGame(
  sharedPieceSeed?: string,
  isOnlineMatch: boolean = false,
  onlineResolvedMode?: GameMode,
  onlineSelectedMode?: SelectableGameMode
) {
  isSkinPickerOpen.value = false
  isAuthModalOpen.value = false
  isFriendsModalOpen.value = false
  isBurgerMenuOpen.value = false
  isGameModeModalOpen.value = false
  lobbyCountdownMs.value = null
  isOnlineMultiplayerMatch.value = isOnlineMatch
  localPlayerLives.value = GAME_CONSTANTS.SURVIVAL_INITIAL_LIVES

  const selectableMode: SelectableGameMode = isOnlineMatch
    ? onlineSelectedMode ||
      multiplayerClient.state.room?.selectedGameMode ||
      selectedGameMode.value
    : selectedGameMode.value

  const resolvedMode: GameMode =
    isOnlineMatch && onlineResolvedMode
      ? onlineResolvedMode
      : resolveEffectiveGameMode(selectableMode)

  activeMatchGameMode.value = resolvedMode
  if (towerInstance) {
    towerInstance.setGameMode(resolvedMode)
  }

  screenFlow.value = 'IN_GAME'
  if (sharedPieceSeed) {
    seedInput.value = sharedPieceSeed
    if (towerInstance) {
      towerInstance.setSinglePlayerMode(!isOnlineMatch)
      if (isOnlineMatch) {
        computeLaneLayoutAndRanks(performance.now())
      } else {
        towerInstance.localSlotIndex = null
        towerInstance.setLaneOffsetX(0)
      }
    }
    restartMatch(false, false)
  } else {
    if (towerInstance) {
      towerInstance.setSinglePlayerMode(true)
      towerInstance.rankBadge = null
      towerInstance.localSlotIndex = null
      towerInstance.remoteLanesToRender = []
      towerInstance.activePowerVfxToRender = []
      towerInstance.setLaneOffsetX(0)
    }
    restartMatch(true, false)
  }

  if (selectableMode === 'RANDOM') {
    triggerBanner(
      `🎲 Modo Aleatório sorteou: ${
        resolvedMode === 'SURVIVAL'
          ? '❤️ MODO SOBREVIVÊNCIA (3 VIDAS)'
          : '🏁 MODO CORRIDA (30m)'
      }!`,
      'info'
    )
  }
}

function handleReturnToLobbyFromMatch() {
  multiplayerClient.emitReturnToLobby()
  isOnlineMultiplayerMatch.value = false
  if (towerInstance) {
    towerInstance.rankBadge = null
    towerInstance.localSlotIndex = null
    towerInstance.remoteLanesToRender = []
    towerInstance.activePowerVfxToRender = []
    towerInstance.setLaneOffsetX(0)
  }
  screenFlow.value = 'MULTIPLAYER_LOBBY'
}

function handleMultiplayerCardClick() {
  selectedMenuCard.value = 'MULTIPLAYER'
  isBurgerMenuOpen.value = false
  isGameModeModalOpen.value = false
  pendingFriendsOpenAfterLogin.value = null
  if (authStore.isAuthenticated.value) {
    isAuthModalOpen.value = false
    void enterMultiplayerLobby()
  } else {
    authStore.state.error = null
    isAuthModalOpen.value = true
  }
}

function closeAuthModal() {
  isAuthModalOpen.value = false
  pendingFriendsOpenAfterLogin.value = null
  authStore.state.error = null
}

async function handleGoogleLogin() {
  try {
    const result = await authStore.loginWithGoogle()
    activePlayerSkinId.value = spriteRegistry.getActivePlayerSkinId()
    isAuthModalOpen.value = false
    multiplayerClient.connect()
    const pendingMode = pendingFriendsOpenAfterLogin.value
    pendingFriendsOpenAfterLogin.value = null
    if (pendingMode) {
      isFriendsModalOpen.value = true
      if (pendingMode === 'invite') {
        void nextTick(() => {
          friendSearchInputRef.value?.focus()
        })
      }
    } else {
      void enterMultiplayerLobby()
    }
    triggerBanner(
      result.isNewUser
        ? `🎉 Conta criada para ${result.user.displayName} (${result.user.email})!`
        : `👋 Bem-vindo de volta, ${result.user.displayName}!`,
      'success'
    )
  } catch (err) {
    triggerBanner(
      err instanceof Error
        ? err.message
        : 'Falha ao autenticar com o Google.',
      'danger'
    )
  }
}

async function handleLogout() {
  multiplayerClient.disconnect()
  await authStore.logout()
  isAuthModalOpen.value = false
  isFriendsModalOpen.value = false
  isBurgerMenuOpen.value = false
  isGameModeModalOpen.value = false
  lobbyCountdownMs.value = null
  if (screenFlow.value === 'MULTIPLAYER_LOBBY') {
    screenFlow.value = 'MAIN_MENU'
  }
  triggerBanner('Sessão encerrada com sucesso.', 'info')
}

function returnToMainMenu() {
  if (screenFlow.value === 'MULTIPLAYER_LOBBY') {
    multiplayerClient.leaveRoom()
  }
  isOnlineMultiplayerMatch.value = false
  isDevModeOpen.value = false
  isSkinPickerOpen.value = false
  isAuthModalOpen.value = false
  isFriendsModalOpen.value = false
  isGameModeModalOpen.value = false
  lobbyCountdownMs.value = null
  if (towerInstance) {
    towerInstance.rankBadge = null
    towerInstance.localSlotIndex = null
    towerInstance.remoteLanesToRender = []
    towerInstance.activePowerVfxToRender = []
    towerInstance.setLaneOffsetX(0)
  }
  const [leftSkin, rightSkin] = spriteRegistry.pickTwoRandomPlayerSkins()
  menuLeftSkinId.value = leftSkin
  menuRightSkinId.value = rightSkin
  titleTowerAlpha.value = 0
  screenFlow.value = 'MAIN_MENU'
}

function pollMenuGamepad() {
  if (typeof navigator === 'undefined' || !navigator.getGamepads) return
  const pads = navigator.getGamepads()
  let anyPressed = false
  for (const pad of pads) {
    if (!pad) continue
    if (pad.buttons.some((b) => b.pressed)) {
      anyPressed = true
      break
    }
  }
  if (anyPressed && !wasGamepadPressed) {
    if (screenFlow.value === 'TITLE_SCREEN') {
      transitionToMainMenu()
    } else if (screenFlow.value === 'MAIN_MENU') {
      openLocalBattleLobby()
    } else if (screenFlow.value === 'LOCAL_LOBBY' && !isGameModeModalOpen.value) {
      startGame()
    }
  }
  wasGamepadPressed = anyPressed
}

function computeLaneLayoutAndRanks(now: number) {
  if (!towerInstance) return
  if (!isOnlineMultiplayerMatch.value || !multiplayerClient.state.activeMatch) {
    towerInstance.rankBadge = null
    towerInstance.localSlotIndex = null
    towerInstance.remoteLanesToRender = []
    towerInstance.activePowerVfxToRender = []
    return
  }

  const remoteEntries = Object.values(multiplayerClient.state.remoteLanes)
  const totalPlayers = 1 + remoteEntries.length
  const laneSpacingPx =
    totalPlayers >= 4 ? 360 : totalPlayers === 3 ? 400 : 440

  // Compute live rank (1ST, 2ND, 3RD, 4TH)
  const myHandle = (authStore.state.user?.handle || '@voce').toLowerCase()
  const myNick = authStore.state.user?.customNick || 'VOCÊ'
  const isSurvivalMode = snapshot.value.gameMode === 'SURVIVAL'
  const allHeights = [
    {
      handle: myHandle,
      height: snapshot.value.towerHeight,
      lives: snapshot.value.lives,
      pieces: snapshot.value.piecesPlaced,
    },
    ...remoteEntries.map((r) => ({
      handle: r.handle.toLowerCase(),
      height: r.towerHeight,
      lives: r.lives,
      pieces: r.settledBlocks?.length ?? 0,
    })),
  ].sort((a, b) => {
    if (isSurvivalMode) {
      const aAlive = a.lives > 0 ? 1 : 0
      const bAlive = b.lives > 0 ? 1 : 0
      if (bAlive !== aAlive) return bAlive - aAlive
      if (b.pieces !== a.pieces) return b.pieces - a.pieces
      if (b.lives !== a.lives) return b.lives - a.lives
    }
    return b.height - a.height
  })

  const rankLabels: Array<'1ST' | '2ND' | '3RD' | '4TH'> = [
    '1ST',
    '2ND',
    '3RD',
    '4TH',
  ]
  const rankByHandle = new Map<string, '1ST' | '2ND' | '3RD' | '4TH'>()
  allHeights.forEach((entry, idx) => {
    rankByHandle.set(entry.handle, rankLabels[Math.min(3, idx)])
  })

  // Determine each player's fixed Lobby slotIndex (0 = P1, 1 = P2, 2 = P3, 3 = P4)
  const myMatchPlayer = multiplayerClient.state.activeMatch.players.find(
    (p) => p.handle.toLowerCase() === myHandle
  )
  const myRoomSlot = multiplayerClient.state.room?.slots.find(
    (s) => s && s.handle.toLowerCase() === myHandle
  )
  const mySlotIndex = myMatchPlayer?.slotIndex ?? myRoomSlot?.slotIndex ?? 0

  // Sort all players by slotIndex ascending so Player 1 is at Position 1 (leftmost),
  // Player 2 is at Position 2, Player 3 at Position 3, and Player 4 at Position 4.
  const orderedParticipants = [
    { handle: myHandle, slotIndex: mySlotIndex },
    ...remoteEntries.map((r) => ({
      handle: r.handle.toLowerCase(),
      slotIndex: r.slotIndex ?? 1,
    })),
  ].sort((a, b) =>
    a.slotIndex !== b.slotIndex
      ? a.slotIndex - b.slotIndex
      : a.handle.localeCompare(b.handle)
  )

  const laneOffsetByHandle = new Map<string, number>()
  orderedParticipants.forEach((entry, posIdx) => {
    const xOffset = (posIdx - (totalPlayers - 1) / 2) * laneSpacingPx
    laneOffsetByHandle.set(entry.handle, xOffset)
  })

  const myTargetOffsetX = laneOffsetByHandle.get(myHandle) ?? 0
  towerInstance.setLaneOffsetX(myTargetOffsetX)
  towerInstance.localSlotIndex = mySlotIndex
  towerInstance.rankBadge = rankByHandle.get(myHandle) || '1ST'
  towerInstance.playerNick = myNick

  const remoteRenderList: RemoteLaneRenderData[] = remoteEntries.map((r) => {
    const laneOffsetX =
      laneOffsetByHandle.get(r.handle.toLowerCase()) ??
      towerInstance!.offsetX + laneSpacingPx
    return {
      laneOffsetX,
      slotIndex: r.slotIndex ?? 1,
      handle: r.handle,
      customNick: r.customNick,
      skinSpriteId: dbSkinToSpriteId(r.equippedSkin),
      rankBadge: rankByHandle.get(r.handle.toLowerCase()) || '2ND',
      towerHeight: r.towerHeight,
      lives: r.lives,
      isEliminated: r.isEliminated,
      activePiece: r.renderActivePiece,
      settledBlocks: r.renderSettledBlocks,
      mascotCastAnimMs: r.mascotCastAnimMs,
      mascotCastCategory: r.mascotCastCategory,
      activeDebuffs: r.activeDebuffs || [],
      blindManualRemainingMs: r.blindManualRemainingMs || 0,
      fogAnchorX: r.fogAnchorX ?? 0,
      fogAnchorY: r.fogAnchorY ?? 2.2,
      islands: r.islands || [],
      lastLifeLostAtMs: r.lastLifeLostAtMs || 0,
    }
  })

  towerInstance.remoteLanesToRender = remoteRenderList

  // Map active synchronized power VFX to lane offsets
  const vfxRenderList: PowerVfxRenderData[] =
    multiplayerClient.state.activePowerVfx.map((vfx) => {
      const casterOffset =
        laneOffsetByHandle.get(vfx.casterHandle.toLowerCase()) ??
        towerInstance!.offsetX
      const targetOffsets = vfx.targetHandles.map(
        (th) =>
          laneOffsetByHandle.get(th.toLowerCase()) ?? towerInstance!.offsetX
      )
      return {
        casterLaneOffsetX: casterOffset,
        targetLaneOffsetsX: targetOffsets,
        category: vfx.category,
        powerType: vfx.powerType,
        progress: Math.min(1, (now - vfx.createdAtMs) / vfx.durationMs),
      }
    })

  towerInstance.activePowerVfxToRender = vfxRenderList
}

function startLoop() {
  lastFrameTime = performance.now()
  const step = (now: number) => {
    const dt = Math.min(32, now - lastFrameTime)
    lastFrameTime = now

    pollMenuGamepad()

    if (
      screenFlow.value === 'MULTIPLAYER_LOBBY' &&
      lobbyCountdownMs.value !== null
    ) {
      lobbyCountdownMs.value = Math.max(0, lobbyCountdownMs.value - dt)
      if (lobbyCountdownMs.value <= 0) {
        lobbyCountdownMs.value = null
        startGame()
      }
    }

    if (canvasRef.value) {
      const ctx = canvasRef.value.getContext('2d')
      if (ctx) {
        ctx.clearRect(0, 0, canvasRef.value.width, canvasRef.value.height)

        if (screenFlow.value === 'IN_GAME' && towerInstance) {
          if (!isDevModeOpen.value) {
            towerInstance.update(dt)
          }

          if (isOnlineMultiplayerMatch.value) {
            multiplayerClient.stepInterpolation(dt)
            computeLaneLayoutAndRanks(now)

            // 20Hz (50ms) state broadcast to room opponents
            syncBroadcastAccumMs += dt
            if (syncBroadcastAccumMs >= 50) {
              syncBroadcastAccumMs = 0
              const snap = towerInstance.getStateSnapshot()
              const activeDebuffs: string[] = []
              if (snap.blindManualRemainingMs > 0) {
                activeDebuffs.push('BLIND_MANUAL')
              }
              if (
                towerInstance.slickBrickRemaining > 0 ||
                snap.activePiece?.powerEffect === 'SLICK_BRICK'
              ) {
                activeDebuffs.push('SLICK_BRICK')
              }
              if (
                towerInstance.lockRotateRemaining > 0 ||
                snap.activePiece?.powerEffect === 'LOCK_ROTATE'
              ) {
                activeDebuffs.push('LOCK_ROTATE')
              }
              if (
                towerInstance.turboDropRemaining > 0 ||
                snap.activePiece?.powerEffect === 'TURBO_DROP'
              ) {
                activeDebuffs.push('TURBO_DROP')
              }
              if (
                towerInstance.giantPieceRemaining > 0 ||
                snap.activePiece?.variant === 'GIANT'
              ) {
                activeDebuffs.push('GIANT_PIECE')
              }
              localPlayerLives.value = snap.lives
              multiplayerClient.emitMatchSyncState({
                activePiece: snap.activePiece,
                settledBlocks: snap.settledBlocks,
                towerHeight: snap.towerHeight,
                lives: snap.lives,
                mana:
                  snap.inventoryPower.selfPower ||
                  snap.inventoryPower.attackPower
                    ? 100
                    : 0,
                activeDebuffs,
                blindManualRemainingMs: snap.blindManualRemainingMs,
                fogAnchorX: snap.fogAnchorX,
                fogAnchorY: snap.fogAnchorY,
                islands: snap.islands,
                isEliminated:
                  snap.gameMode === 'SURVIVAL' && snap.lives <= 0,
              })
            }
          }

          towerInstance.render(
            ctx,
            canvasRef.value.width,
            canvasRef.value.height
          )
        } else {
          menuAnimTimeMs += dt
          if (screenFlow.value === 'TRANSITIONING') {
            transitionElapsedMs += dt
            titleTowerAlpha.value = Math.max(0, 1 - transitionElapsedMs / 300)
            if (transitionElapsedMs >= 300) {
              titleTowerAlpha.value = 0
              screenFlow.value = 'MAIN_MENU'
            }
          }
          spriteRegistry.drawMenuScene(
            ctx,
            canvasRef.value.width,
            canvasRef.value.height,
            menuAnimTimeMs,
            {
              leftSkinId: menuLeftSkinId.value,
              rightSkinId: menuRightSkinId.value,
              towerAlpha: titleTowerAlpha.value,
              showSideMascots:
                screenFlow.value !== 'MULTIPLAYER_LOBBY' &&
                screenFlow.value !== 'LOCAL_LOBBY',
            }
          )
        }
      }
    }
    rafId = requestAnimationFrame(step)
  }
  rafId = requestAnimationFrame(step)
}

function toggleDevMode(forceState?: boolean) {
  const nextState =
    forceState !== undefined ? forceState : !isDevModeOpen.value
  isDevModeOpen.value = nextState
  if (nextState && towerInstance) {
    towerInstance.isSoftDropping = false
  }
}

function handleKeyDown(e: KeyboardEvent) {
  if (document.activeElement && document.activeElement.tagName === 'INPUT') {
    return
  }

  if (e.code === 'F2' || e.code === 'Backquote') {
    e.preventDefault()
    toggleDevMode()
    return
  }

  if (e.code === 'Escape' && isDevModeOpen.value) {
    e.preventDefault()
    toggleDevMode(false)
    return
  }

  if (isGameModeModalOpen.value) {
    if (e.code === 'Escape') {
      e.preventDefault()
      closeGameModeModal()
    }
    return
  }

  // Menu 1: TITLE_SCREEN — any key triggers the 300ms transition to MAIN_MENU
  if (screenFlow.value === 'TITLE_SCREEN') {
    e.preventDefault()
    transitionToMainMenu()
    return
  }

  // Modal de Autenticação aberto: Escape fecha o modal; inputs de texto funcionam normalmente
  if (isAuthModalOpen.value) {
    if (e.code === 'Escape') {
      e.preventDefault()
      closeAuthModal()
    }
    return
  }

  // Tela de Preparação Batalha Local (LOCAL_LOBBY)
  if (screenFlow.value === 'LOCAL_LOBBY') {
    if (e.code === 'Escape') {
      e.preventDefault()
      returnToMainMenu()
    } else if (e.code === 'Enter' || e.code === 'Space') {
      e.preventDefault()
      startGame()
    }
    return
  }

  // Tela de Lobby do Multiplayer: Escape fecha o popup de amigos (se aberto) ou retorna ao MAIN_MENU
  if (screenFlow.value === 'MULTIPLAYER_LOBBY') {
    if (e.code === 'Escape') {
      e.preventDefault()
      if (isFriendsModalOpen.value) {
        closeFriendsInviteModal()
      } else {
        returnToMainMenu()
      }
    }
    return
  }

  // Menu 2: MAIN_MENU — Setas alternam entre BATALHA LOCAL e MULTIPLAYER; Enter/Space confirma; Escape volta ao TITLE_SCREEN
  if (screenFlow.value === 'MAIN_MENU') {
    if (e.code === 'ArrowLeft' || e.code === 'KeyA') {
      e.preventDefault()
      selectedMenuCard.value = 'LOCAL'
    } else if (e.code === 'ArrowRight' || e.code === 'KeyD') {
      e.preventDefault()
      selectedMenuCard.value = 'MULTIPLAYER'
    } else if (e.code === 'Enter' || e.code === 'Space') {
      e.preventDefault()
      if (selectedMenuCard.value === 'MULTIPLAYER') {
        handleMultiplayerCardClick()
      } else {
        openLocalBattleLobby()
      }
    } else if (e.code === 'Escape') {
      e.preventDefault()
      const [leftSkin, rightSkin] = spriteRegistry.pickTwoRandomPlayerSkins()
      menuLeftSkinId.value = leftSkin
      menuRightSkinId.value = rightSkin
      titleTowerAlpha.value = 1.0
      screenFlow.value = 'TITLE_SCREEN'
    }
    return
  }

  if (screenFlow.value !== 'IN_GAME') {
    return
  }

  isShiftHeld.value = e.shiftKey
  if (!towerInstance) return

  if (e.code === 'KeyR') {
    e.preventDefault()
    if (!isOnlineMultiplayerMatch.value) {
      restartMatch(true)
    }
    return
  }

  // While Developer Mode is open, the game is paused: ignore piece movement keys
  if (isDevModeOpen.value) {
    return
  }

  switch (e.code) {
    case 'ArrowLeft':
    case 'KeyA':
      e.preventDefault()
      towerInstance.moveHorizontal(-1, e.shiftKey)
      break
    case 'ArrowRight':
    case 'KeyD':
      e.preventDefault()
      towerInstance.moveHorizontal(1, e.shiftKey)
      break
    case 'ArrowUp':
    case 'KeyW':
    case 'KeyE':
    case 'KeyX':
      e.preventDefault()
      towerInstance.rotateActivePiece(1)
      break
    case 'KeyZ':
    case 'KeyQ':
      e.preventDefault()
      towerInstance.rotateActivePiece(-1)
      break
    case 'ArrowDown':
    case 'KeyS':
      e.preventDefault()
      towerInstance.isSoftDropping = true
      break
    case 'Space':
      e.preventDefault()
      towerInstance.activateSelfPower()
      break
    case 'KeyC':
    case 'KeyB':
      e.preventDefault()
      towerInstance.activateAttackPower()
      break
  }
}

function handleKeyUp(e: KeyboardEvent) {
  isShiftHeld.value = e.shiftKey
  if (!towerInstance) return

  if (e.code === 'ArrowDown' || e.code === 'KeyS') {
    towerInstance.isSoftDropping = false
  }
}

function restartMatch(
  generateNewRandomSeed: boolean = true,
  reRollRandomMode: boolean = true
) {
  if (!towerInstance) return
  if (
    reRollRandomMode &&
    !isOnlineMultiplayerMatch.value &&
    selectedGameMode.value === 'RANDOM'
  ) {
    const nextMode = resolveEffectiveGameMode('RANDOM')
    activeMatchGameMode.value = nextMode
    towerInstance.setGameMode(nextMode)
    triggerBanner(
      `🎲 Modo Aleatório sorteou: ${
        nextMode === 'SURVIVAL'
          ? '❤️ MODO SOBREVIVÊNCIA (3 VIDAS)'
          : '🏁 MODO CORRIDA (30m)'
      }!`,
      'info'
    )
  } else if (!isOnlineMultiplayerMatch.value && selectedGameMode.value !== 'RANDOM') {
    activeMatchGameMode.value = selectedGameMode.value
    towerInstance.setGameMode(selectedGameMode.value)
  }

  localPlayerLives.value = GAME_CONSTANTS.SURVIVAL_INITIAL_LIVES
  if (generateNewRandomSeed || !seedInput.value.trim()) {
    seedInput.value = generateRandomMatchSeed()
  }
  towerInstance.resetMatch(seedInput.value.trim())
}

function toggleColliders() {
  showColliders.value = !showColliders.value
  if (towerInstance) {
    towerInstance.showDebugColliders = showColliders.value
  }
}

function toggleGhostPiece() {
  showGhostPiece.value = !showGhostPiece.value
  if (towerInstance) {
    towerInstance.showGhostPiece = showGhostPiece.value
  }
  triggerBanner(
    showGhostPiece.value
      ? 'Sombra de Encaixe (Ghost Piece) ativada!'
      : 'Sombra de Encaixe (Ghost Piece) desativada!',
    'info'
  )
}

function toggleWind() {
  windEnabled.value = !windEnabled.value
  if (towerInstance) {
    towerInstance.setWindEnabled(windEnabled.value)
  }
  triggerBanner(
    windEnabled.value
      ? 'Vento ativado (a partir de 15m)!'
      : 'Vento removido na aba Desenvolvedor!',
    windEnabled.value ? 'info' : 'warning'
  )
}

function updateSlideLevel(newLevel: number) {
  slideLevel.value = Math.max(0, Math.min(100, Math.round(newLevel)))
  if (towerInstance) {
    towerInstance.setSlideLevel(slideLevel.value)
  }
}

function toggleSinglePlayerMode() {
  if (!towerInstance) return
  towerInstance.setSinglePlayerMode(!snapshot.value.isSinglePlayer)
}

function useSelfPower() {
  towerInstance?.activateSelfPower()
}

function useAttackPower() {
  towerInstance?.activateAttackPower()
}

function triggerDevPower(powerId: PowerId) {
  if (!towerInstance) return
  towerInstance.triggerPowerEffect(powerId)
}

function grantDevSlotPower(powerId: PowerId) {
  if (!towerInstance) return
  towerInstance.grantDevPower(powerId)
}

function triggerDevGoalCountdown() {
  if (!towerInstance) return
  toggleDevMode(false)
  towerInstance.startGoalCountdown(true)
}

function triggerDevAbortCountdown() {
  if (!towerInstance) return
  toggleDevMode(false)
  towerInstance.abortGoalCountdown()
}

function triggerDevRoofDrop() {
  if (!towerInstance) return
  toggleDevMode(false)
  towerInstance.spawnCastleRoof()
}

function togglePlaceholderMode() {
  forcePlaceholders.value = !forcePlaceholders.value
  spriteRegistry.forcePlaceholders = forcePlaceholders.value
}

function toggleDynamicTint() {
  dynamicTintEnabled.value = !dynamicTintEnabled.value
  spriteRegistry.setDynamicTintEnabled(dynamicTintEnabled.value)
  triggerBanner(
    dynamicTintEnabled.value
      ? 'Colorização Dinâmica (3-Tons Plástico) ativada!'
      : 'Exibindo sprites originais em escala de cinza!',
    'info'
  )
}

function selectPlayerSkin(skinId: string) {
  spriteRegistry.setActivePlayerSkin(skinId)
  activePlayerSkinId.value = spriteRegistry.getActivePlayerSkinId()
  isSkinPickerOpen.value = false
  void authStore.syncEquippedSkinBySpriteId(skinId)
  const chosen = spriteRegistry.getActivePlayerSkin()
  triggerBanner(
    `Skin do Personagem alterada para ${chosen ? chosen.name : skinId}!`,
    'success'
  )
}

function selectBasePreset(presetId: BasePresetId | null) {
  forcedBasePresetId.value = presetId
  if (towerInstance) {
    towerInstance.setForcedBasePreset(presetId)
  }
}

function injectCatalogPiece(type: PieceType, variant: PieceVariant) {
  if (!towerInstance) return
  towerInstance.enqueueTestPiece({
    type,
    variant,
    label: `Teste Manual: Peça "${type}" (${variant}) adicionada na fila!`,
  })
  triggerBanner(
    `Peça "${type}" (${variant}) adicionada no topo da fila!`,
    'info'
  )
}

function onUploadTestSprite(key: SpriteKey, event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file) return

  const objectUrl = URL.createObjectURL(file)
  spriteRegistry.registerSprite(key, objectUrl).then(() => {
    forcePlaceholders.value = false
    spriteRegistry.forcePlaceholders = false
    spriteSlots.value = [...spriteRegistry.getAllSlots()]
    triggerBanner(`Sprite importado com sucesso para "${key}"!`, 'success')
  })
}

function clearSlotSprite(key: SpriteKey) {
  spriteRegistry.clearSprite(key)
  spriteSlots.value = [...spriteRegistry.getAllSlots()]
}

let unsubscribeSprites: (() => void) | null = null

onMounted(() => {
  handleResize()
  // Anti-Hibernation Wake-up Ping for Render Socket.io Server on initial menu load
  multiplayerClient.wakeUpSocketServer()
  void authStore.restoreSession().then((restoredUser) => {
    if (restoredUser) {
      activePlayerSkinId.value = spriteRegistry.getActivePlayerSkinId()
      multiplayerClient.connect()
    }
  })

  multiplayerClient.registerCallbacks({
    onMatchStart: (payload) => {
      startGame(
        payload.pieceSeed,
        true,
        payload.gameMode,
        payload.selectedGameMode
      )
      const modeTitle =
        payload.gameMode === 'SURVIVAL'
          ? '❤️ Modo Sobrevivência (3 Vidas)'
          : '🏁 Modo Corrida (30m)'
      triggerBanner(
        `${modeTitle} Iniciado! Seed compartilhada: ${payload.pieceSeed}`,
        'success'
      )
    },
    onReceiveNegativePower: (powerType, attackerNick) => {
      if (!towerInstance) return
      const cfg = getPowerConfig(powerType)
      towerInstance.triggerPowerEffect(powerType)
      triggerBanner(
        `⚡ ${attackerNick} lançou ${cfg?.name || powerType} na sua torre!`,
        'danger'
      )
    },
    onGameOver: (payload) => {
      triggerBanner(
        `🏆 Fim de Jogo! Vencedor: ${payload.winnerNick} (${payload.winnerHandle})!`,
        'success'
      )
    },
    onReturnToLobby: (_room: RoomStateDTO) => {
      isOnlineMultiplayerMatch.value = false
      if (towerInstance) {
        towerInstance.rankBadge = null
        towerInstance.localSlotIndex = null
        towerInstance.remoteLanesToRender = []
        towerInstance.activePowerVfxToRender = []
        towerInstance.setLaneOffsetX(0)
      }
      screenFlow.value = 'MULTIPLAYER_LOBBY'
      triggerBanner('Vocês voltaram juntos para a Sala Multiplayer!', 'info')
    },
  })

  unsubscribeSprites = spriteRegistry.onChange(() => {
    spriteSlots.value = [...spriteRegistry.getAllSlots()]
    playerSkins.value = [...spriteRegistry.getPlayerSkins()]
    activePlayerSkinId.value = spriteRegistry.getActivePlayerSkinId()
    forcePlaceholders.value = spriteRegistry.forcePlaceholders
    menuSprites.value = { ...spriteRegistry.getMenuSprites() }
  })
  towerInstance = new TowerInstance({
    id: 'player_1',
    offsetX: 0,
    matchSeed: seedInput.value,
    gameMode: activeMatchGameMode.value,
    onSnapshot: (snap) => {
      snapshot.value = snap
    },
    onEventBanner: (msg, tone) => {
      triggerBanner(msg, tone)
    },
    onPowerCast: (category, powerId) => {
      if (!isOnlineMultiplayerMatch.value) return
      if (category === 'POSITIVE') {
        multiplayerClient.emitUsePositivePower(powerId)
      } else {
        multiplayerClient.emitUseNegativePower(powerId)
      }
    },
    onPieceSettled: (towerHeight, settledCount) => {
      if (!isOnlineMultiplayerMatch.value) return
      multiplayerClient.emitPieceSettled(towerHeight, settledCount)
    },
    onLifeLost: () => {
      localPlayerLives.value = towerInstance
        ? towerInstance.lives
        : Math.max(0, localPlayerLives.value - 1)
      if (!isOnlineMultiplayerMatch.value) return
      multiplayerClient.emitLifeLost(localPlayerLives.value)
    },
    onVictory: (elapsedTimeMs, towerHeight) => {
      if (!isOnlineMultiplayerMatch.value) return
      multiplayerClient.emitClaimVictory(towerHeight, elapsedTimeMs)
    },
  })
  towerInstance.emitSnapshotNow()

  window.addEventListener('resize', handleResize)
  window.addEventListener('keydown', handleKeyDown)
  window.addEventListener('keyup', handleKeyUp)
  startLoop()
})

onUnmounted(() => {
  if (unsubscribeSprites) unsubscribeSprites()
  if (rafId !== null) cancelAnimationFrame(rafId)
  window.removeEventListener('resize', handleResize)
  window.removeEventListener('keydown', handleKeyDown)
  window.removeEventListener('keyup', handleKeyUp)
})
</script>

<template>
  <div class="fullscreen-stage">
    <!-- 100% FULLSCREEN TRICKY TOWERS SCENERY CANVAS -->
    <canvas
      ref="canvasRef"
      :width="canvasWidth"
      :height="canvasHeight"
      class="fullscreen-canvas"
    />

    <!-- =================================================================== -->
    <!-- MENU 1: ESTADO TITLE_SCREEN (LOGO + TORRE COM BALANÇO + CTA)        -->
    <!-- =================================================================== -->
    <transition name="menu-fade-300">
      <div
        v-if="screenFlow === 'TITLE_SCREEN'"
        class="title-screen-overlay"
        @pointerdown="transitionToMainMenu"
      >
        <div class="title-logo-wrap">
          <img
            v-if="menuSprites.logo"
            :src="menuSprites.logo"
            alt="TOY TOWER"
            class="title-logo-img"
            draggable="false"
          />
          <h1 v-else class="title-logo-fallback">TOY TOWER</h1>
        </div>

        <div class="title-cta-banner">
          <span class="title-cta-text">APERTE QUALQUER BOTÃO PARA COMEÇAR</span>
        </div>
      </div>
    </transition>

    <!-- =================================================================== -->
    <!-- BLOCO MENU BURGUER + PERFIL NO CANTO SUPERIOR DIREITO               -->
    <!-- =================================================================== -->
    <transition name="menu-fade-300">
      <div
        v-if="
          screenFlow === 'MAIN_MENU' ||
          screenFlow === 'LOCAL_LOBBY' ||
          screenFlow === 'MULTIPLAYER_LOBBY'
        "
        class="top-right-menu-cluster"
      >
        <!-- Crachá compacto da conta Google (quando logado) -->
        <div v-if="authStore.state.user" class="menu-profile-badge">
          <img
            :src="authStore.state.user.avatarUrl"
            :alt="authStore.state.user.displayName"
            class="menu-profile-avatar"
            referrerpolicy="no-referrer"
          />
          <div class="menu-profile-info">
            <span class="menu-profile-name">
              {{
                authStore.state.user.customNick ||
                authStore.state.user.displayName
              }}
            </span>
            <span class="menu-profile-meta">
              <img
                v-if="activePlayerSkin"
                :src="activePlayerSkin.url"
                :alt="activePlayerSkin.name"
                class="menu-profile-skin-icon"
              />
              {{ authStore.state.user.handle }}
            </span>
          </div>
        </div>

        <!-- Bloco Menu Burguer Estilo Lego no Canto Superior Direito -->
        <button
          type="button"
          class="menu-burger-block-btn"
          :class="{ 'menu-burger-block-btn--active': isBurgerMenuOpen }"
          title="Menu de Amigos e Convites"
          aria-label="Abrir Menu de Amigos e Convites"
          @click="toggleBurgerMenu"
        >
          <div class="menu-burger-studs" aria-hidden="true">
            <span class="menu-burger-stud"></span>
            <span class="menu-burger-stud"></span>
          </div>
          <div class="menu-burger-lines" aria-hidden="true">
            <span class="menu-burger-line"></span>
            <span class="menu-burger-line"></span>
            <span class="menu-burger-line"></span>
          </div>
          <span
            v-if="multiplayerClient.state.incomingFriendRequests.length > 0"
            class="menu-burger-badge"
          >
            {{ multiplayerClient.state.incomingFriendRequests.length }}
          </span>
        </button>

        <!-- Backdrop invisível para fechar o popup ao clicar fora -->
        <div
          v-if="isBurgerMenuOpen"
          class="burger-menu-backdrop"
          @click="closeBurgerMenu"
        ></div>

        <!-- Popup do Menu Burguer -->
        <transition name="menu-fade-300">
          <div
            v-if="isBurgerMenuOpen"
            class="burger-menu-popup"
            role="menu"
            aria-label="Menu Rápido"
          >
            <div class="burger-popup-studs" aria-hidden="true">
              <span class="burger-popup-stud"></span>
              <span class="burger-popup-stud"></span>
              <span class="burger-popup-stud"></span>
              <span class="burger-popup-stud"></span>
            </div>

            <div class="burger-popup-header">
              <span class="burger-popup-title">MENU SOCIAL</span>
              <button
                v-if="authStore.state.user"
                type="button"
                class="burger-popup-handle-chip"
                title="Copiar meu ID de amigo"
                @click="copyMyHandle"
              >
                <span>{{ authStore.state.user.handle }}</span>
                <span class="burger-popup-copy-tag">COPIAR</span>
              </button>
            </div>

            <!-- Botão 1: AMIGOS (abre a lista de amigos adicionados) -->
            <button
              type="button"
              class="burger-menu-action-btn burger-menu-action-btn--friends"
              @click="openFriendsFromBurger('list')"
            >
              <span class="burger-menu-action-icon">👥</span>
              <span class="burger-menu-action-text">
                AMIGOS ({{ friendsList.length }})
              </span>
              <span
                v-if="multiplayerClient.state.incomingFriendRequests.length > 0"
                class="burger-menu-action-pill"
              >
                +{{ multiplayerClient.state.incomingFriendRequests.length }}
              </span>
            </button>

            <!-- Botão 2: ENVIAR CONVITE (abre e foca o envio de convite de amizade) -->
            <button
              type="button"
              class="burger-menu-action-btn burger-menu-action-btn--invite"
              @click="openFriendsFromBurger('invite')"
            >
              <span class="burger-menu-action-icon">📨</span>
              <span class="burger-menu-action-text">ENVIAR CONVITE</span>
            </button>

            <div class="burger-popup-divider"></div>

            <!-- Botão de Conta (Sair ou Entrar com Google) -->
            <button
              v-if="authStore.state.user"
              type="button"
              class="burger-menu-action-btn burger-menu-action-btn--logout"
              @click="handleLogout"
            >
              <span class="burger-menu-action-icon">🚪</span>
              <span class="burger-menu-action-text">SAIR DA CONTA</span>
            </button>
            <button
              v-else
              type="button"
              class="burger-menu-action-btn burger-menu-action-btn--login"
              @click="openFriendsFromBurger('list')"
            >
              <span class="burger-menu-action-icon">🔑</span>
              <span class="burger-menu-action-text">CONECTAR GOOGLE</span>
            </button>
          </div>
        </transition>
      </div>
    </transition>

    <!-- =================================================================== -->
    <!-- MENU 2: ESTADO MAIN_MENU (GRID 2x2 DE CARTÕES ESTILO BLOCOS)        -->
    <!-- =================================================================== -->
    <transition name="menu-fade-300">
      <div v-if="screenFlow === 'MAIN_MENU'" class="main-menu-overlay">
        <div class="main-menu-grid">
          <!-- BLOCO 1: BATALHA LOCAL (ATIVO) -->
          <button
            type="button"
            class="menu-brick-card menu-brick-card--active"
            :class="{
              'menu-brick-card--selected': selectedMenuCard === 'LOCAL',
            }"
            @mouseenter="selectedMenuCard = 'LOCAL'"
            @focus="selectedMenuCard = 'LOCAL'"
            @click="openLocalBattleLobby"
          >
            <!-- 4 Cantoneiras Amarelas estilo Bloco de Montar -->
            <svg
              class="menu-corner-bracket menu-corner-bracket--tl"
              viewBox="0 0 64 64"
              aria-hidden="true"
            >
              <rect
                x="8"
                y="2"
                width="16"
                height="8"
                rx="3"
                fill="#F59E0B"
                stroke="#1E1B4B"
                stroke-width="3.5"
              />
              <rect
                x="30"
                y="2"
                width="16"
                height="8"
                rx="3"
                fill="#F59E0B"
                stroke="#1E1B4B"
                stroke-width="3.5"
              />
              <path
                d="M 4,10 H 54 V 24 H 18 V 56 H 4 Z"
                fill="#FBBF24"
                stroke="#1E1B4B"
                stroke-width="3.8"
                stroke-linejoin="round"
              />
              <path
                d="M 7,13 H 50 V 17 H 14 V 52 H 7 Z"
                fill="#FDE68A"
              />
            </svg>

            <svg
              class="menu-corner-bracket menu-corner-bracket--tr"
              viewBox="0 0 64 64"
              aria-hidden="true"
            >
              <rect
                x="18"
                y="2"
                width="16"
                height="8"
                rx="3"
                fill="#F59E0B"
                stroke="#1E1B4B"
                stroke-width="3.5"
              />
              <rect
                x="40"
                y="2"
                width="16"
                height="8"
                rx="3"
                fill="#F59E0B"
                stroke="#1E1B4B"
                stroke-width="3.5"
              />
              <path
                d="M 10,10 H 60 V 56 H 46 V 24 H 10 Z"
                fill="#FBBF24"
                stroke="#1E1B4B"
                stroke-width="3.8"
                stroke-linejoin="round"
              />
              <path
                d="M 14,13 H 56 V 52 H 50 V 17 H 14 Z"
                fill="#FDE68A"
              />
            </svg>

            <svg
              class="menu-corner-bracket menu-corner-bracket--bl"
              viewBox="0 0 64 64"
              aria-hidden="true"
            >
              <path
                d="M 4,8 H 18 V 44 H 54 V 58 H 4 Z"
                fill="#FBBF24"
                stroke="#1E1B4B"
                stroke-width="3.8"
                stroke-linejoin="round"
              />
              <path
                d="M 7,12 H 14 V 48 H 50 V 53 H 7 Z"
                fill="#FDE68A"
              />
            </svg>

            <svg
              class="menu-corner-bracket menu-corner-bracket--br"
              viewBox="0 0 64 64"
              aria-hidden="true"
            >
              <path
                d="M 46,8 H 60 V 58 H 10 V 44 H 46 Z"
                fill="#FBBF24"
                stroke="#1E1B4B"
                stroke-width="3.8"
                stroke-linejoin="round"
              />
              <path
                d="M 50,12 H 56 V 53 H 14 V 48 H 50 Z"
                fill="#FDE68A"
              />
            </svg>

            <div class="menu-brick-card-inner">
              <img
                :src="menuSprites.screen_local"
                alt="Batalha Local"
                class="menu-brick-card-img"
                draggable="false"
              />
              <span class="menu-brick-card-title">BATALHA LOCAL</span>
            </div>

            <!-- Botão de Engrenagem (Modo de Jogo) direto no cartão Batalha Local -->
            <span
              class="menu-card-gear-pill"
              role="button"
              tabindex="0"
              title="Selecionar Modo de Jogo antes de iniciar"
              @click.stop="openGameModeModal"
              @keydown.enter.stop.prevent="openGameModeModal"
            >
              <span class="menu-card-gear-icon" aria-hidden="true">⚙️</span>
              <span class="menu-card-gear-text">
                {{ currentLobbyModeInfo.icon }} {{ currentLobbyModeInfo.shortTitle }}
              </span>
            </span>
          </button>

          <!-- BLOCO 2: MULTIPLAYER (ATIVO — AUTENTICAÇÃO GOOGLE + MONGODB) -->
          <button
            type="button"
            class="menu-brick-card menu-brick-card--active"
            :class="{
              'menu-brick-card--selected': selectedMenuCard === 'MULTIPLAYER',
            }"
            @mouseenter="selectedMenuCard = 'MULTIPLAYER'"
            @focus="selectedMenuCard = 'MULTIPLAYER'"
            @click="handleMultiplayerCardClick"
          >
            <!-- 4 Cantoneiras Amarelas estilo Bloco de Montar -->
            <svg
              class="menu-corner-bracket menu-corner-bracket--tl"
              viewBox="0 0 64 64"
              aria-hidden="true"
            >
              <rect
                x="8"
                y="2"
                width="16"
                height="8"
                rx="3"
                fill="#F59E0B"
                stroke="#1E1B4B"
                stroke-width="3.5"
              />
              <rect
                x="30"
                y="2"
                width="16"
                height="8"
                rx="3"
                fill="#F59E0B"
                stroke="#1E1B4B"
                stroke-width="3.5"
              />
              <path
                d="M 4,10 H 54 V 24 H 18 V 56 H 4 Z"
                fill="#FBBF24"
                stroke="#1E1B4B"
                stroke-width="3.8"
                stroke-linejoin="round"
              />
              <path
                d="M 7,13 H 50 V 17 H 14 V 52 H 7 Z"
                fill="#FDE68A"
              />
            </svg>

            <svg
              class="menu-corner-bracket menu-corner-bracket--tr"
              viewBox="0 0 64 64"
              aria-hidden="true"
            >
              <rect
                x="18"
                y="2"
                width="16"
                height="8"
                rx="3"
                fill="#F59E0B"
                stroke="#1E1B4B"
                stroke-width="3.5"
              />
              <rect
                x="40"
                y="2"
                width="16"
                height="8"
                rx="3"
                fill="#F59E0B"
                stroke="#1E1B4B"
                stroke-width="3.5"
              />
              <path
                d="M 10,10 H 60 V 56 H 46 V 24 H 10 Z"
                fill="#FBBF24"
                stroke="#1E1B4B"
                stroke-width="3.8"
                stroke-linejoin="round"
              />
              <path
                d="M 14,13 H 56 V 52 H 50 V 17 H 14 Z"
                fill="#FDE68A"
              />
            </svg>

            <svg
              class="menu-corner-bracket menu-corner-bracket--bl"
              viewBox="0 0 64 64"
              aria-hidden="true"
            >
              <path
                d="M 4,8 H 18 V 44 H 54 V 58 H 4 Z"
                fill="#FBBF24"
                stroke="#1E1B4B"
                stroke-width="3.8"
                stroke-linejoin="round"
              />
              <path
                d="M 7,12 H 14 V 48 H 50 V 53 H 7 Z"
                fill="#FDE68A"
              />
            </svg>

            <svg
              class="menu-corner-bracket menu-corner-bracket--br"
              viewBox="0 0 64 64"
              aria-hidden="true"
            >
              <path
                d="M 46,8 H 60 V 58 H 10 V 44 H 46 Z"
                fill="#FBBF24"
                stroke="#1E1B4B"
                stroke-width="3.8"
                stroke-linejoin="round"
              />
              <path
                d="M 50,12 H 56 V 53 H 14 V 48 H 50 Z"
                fill="#FDE68A"
              />
            </svg>

            <div class="menu-brick-card-inner">
              <img
                :src="menuSprites.screen_multiplayer"
                alt="Multiplayer"
                class="menu-brick-card-img"
                draggable="false"
              />
              <span class="menu-brick-card-title">MULTIPLAYER</span>
            </div>

            <!-- Botões de Modo de Jogo + Condição de Vitória (ao lado) direto no cartão Multiplayer -->
            <div class="menu-card-pills-row">
              <span
                class="menu-card-gear-pill"
                role="button"
                tabindex="0"
                title="Selecionar Modo de Jogo e Condição de Vitória antes de iniciar"
                @click.stop="openGameModeModal"
                @keydown.enter.stop.prevent="openGameModeModal"
              >
                <span class="menu-card-gear-icon" aria-hidden="true">⚙️</span>
                <span class="menu-card-gear-text">
                  {{ currentLobbyModeInfo.icon }} {{ currentLobbyModeInfo.shortTitle }}
                </span>
              </span>

              <span
                class="menu-card-gear-pill menu-card-gear-pill--cup"
                role="button"
                tabindex="0"
                title="Selecionar Condição de Vitória (Copa Multiplayer)"
                @click.stop="openGameModeModal"
                @keydown.enter.stop.prevent="openGameModeModal"
              >
                <span class="menu-card-gear-text">
                  {{ currentLobbyVictoryInfo.icon }} {{ currentLobbyVictoryInfo.shortTitle }}
                </span>
              </span>
            </div>
          </button>

          <!-- BLOCO 3: SKINS (BLOQUEADO) -->
          <div
            class="menu-brick-card menu-brick-card--locked"
            aria-disabled="true"
          >
            <div class="menu-brick-card-inner">
              <img
                :src="menuSprites.screen_skins"
                alt="Skins"
                class="menu-brick-card-img"
                draggable="false"
              />
              <span class="menu-brick-card-title menu-brick-card-title--narrow">
                SKINS
              </span>
            </div>
            <div class="menu-coming-soon-ribbon">
              <span>EM BREVE</span>
            </div>
          </div>

          <!-- BLOCO 4: OPÇÕES (BLOQUEADO) -->
          <div
            class="menu-brick-card menu-brick-card--locked"
            aria-disabled="true"
          >
            <div class="menu-brick-card-inner">
              <img
                :src="menuSprites.screen_option"
                alt="Opções"
                class="menu-brick-card-img"
                draggable="false"
              />
              <span class="menu-brick-card-title menu-brick-card-title--narrow">
                OPÇÕES
              </span>
            </div>
            <div class="menu-coming-soon-ribbon">
              <span>EM BREVE</span>
            </div>
          </div>
        </div>
      </div>
    </transition>

    <!-- =================================================================== -->
    <!-- TELA DE PREPARAÇÃO BATALHA LOCAL (LOCAL_LOBBY + ENGRENAGEM ⚙️)      -->
    <!-- =================================================================== -->
    <transition name="menu-fade-300">
      <div v-if="screenFlow === 'LOCAL_LOBBY'" class="local-lobby-screen">
        <!-- Botão superior esquerdo para voltar ao Menu Principal -->
        <button
          type="button"
          class="mp-lobby-back-btn"
          title="Voltar ao Menu Principal (Esc)"
          @click="returnToMainMenu"
        >
          <img
            :src="menuSprites.button_x"
            alt="Voltar"
            draggable="false"
          />
        </button>

        <div class="local-lobby-card">
          <div class="local-lobby-studs" aria-hidden="true">
            <span class="local-lobby-stud"></span>
            <span class="local-lobby-stud"></span>
            <span class="local-lobby-stud"></span>
            <span class="local-lobby-stud"></span>
            <span class="local-lobby-stud"></span>
            <span class="local-lobby-stud"></span>
          </div>

          <header class="local-lobby-header">
            <span class="local-lobby-kicker">PREPARAÇÃO DA PARTIDA</span>
            <h2 class="local-lobby-title">BATALHA LOCAL</h2>
          </header>

          <div class="local-lobby-body">
            <!-- Coluna Esquerda: Personagem Selecionado (clicável para trocar skin) -->
            <div class="local-lobby-char-box">
              <div
                class="local-lobby-char-stage"
                title="Clique para trocar de personagem"
                @click="cycleLocalLobbySkin"
              >
                <img
                  :src="menuSprites.area_ready"
                  alt=""
                  class="local-lobby-char-bg"
                  draggable="false"
                />
                <img
                  v-if="activePlayerSkin"
                  :src="activePlayerSkin.url"
                  :alt="activePlayerSkin.name"
                  class="local-lobby-char-sprite"
                  draggable="false"
                />
              </div>
              <button
                type="button"
                class="local-lobby-skin-cycle-btn"
                @click="cycleLocalLobbySkin"
              >
                🎭 {{ activePlayerSkin ? activePlayerSkin.name : 'Personagem' }} ↻
              </button>
            </div>

            <!-- Coluna Direita: Modo de Jogo Selecionado + Botão de Engrenagem ⚙️ -->
            <div class="local-lobby-mode-panel">
              <div class="local-lobby-mode-top">
                <div class="local-lobby-mode-label-col">
                  <span class="local-lobby-mode-caption">MODO DE JOGO ATUAL</span>
                  <div class="local-lobby-mode-current">
                    <span class="local-lobby-mode-icon">
                      {{ currentLobbyModeInfo.icon }}
                    </span>
                    <span class="local-lobby-mode-name">
                      {{ currentLobbyModeInfo.title }}
                    </span>
                    <span
                      class="local-lobby-mode-badge"
                      :style="{ backgroundColor: currentLobbyModeInfo.accentColor }"
                    >
                      {{ currentLobbyModeInfo.badge }}
                    </span>
                  </div>
                </div>

                <!-- BOTÃO DE ENGRENAGEM (SELECIONE O MODO DE JOGO) -->
                <button
                  type="button"
                  class="mode-gear-btn"
                  title="Selecionar o Modo de Jogo"
                  aria-label="Selecionar o Modo de Jogo"
                  @click="openGameModeModal"
                >
                  <span class="mode-gear-btn-icon" aria-hidden="true">⚙️</span>
                  <span class="mode-gear-btn-text">MODO DE JOGO</span>
                </button>
              </div>

              <p class="local-lobby-mode-desc">
                {{ currentLobbyModeInfo.description }}
              </p>

              <ul class="local-lobby-mode-rules">
                <li
                  v-for="(rule, rIdx) in currentLobbyModeInfo.rulesSummary"
                  :key="rIdx"
                >
                  {{ rule }}
                </li>
              </ul>

              <div class="local-lobby-actions">
                <button
                  type="button"
                  class="local-lobby-ChangeMode-btn"
                  @click="openGameModeModal"
                >
                  ⚙️ SELECIONE O MODO DE JOGO
                </button>

                <button
                  type="button"
                  class="mp-clean-brick-btn mp-clean-brick-btn--local-start"
                  @click="startGame()"
                >
                  <img
                    :src="
                      menuSprites.button_clean_green || menuSprites.button_clean
                    "
                    alt=""
                    aria-hidden="true"
                    draggable="false"
                  />
                  <span class="mp-clean-brick-btn-label">INICIAR PARTIDA</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </transition>

    <!-- =================================================================== -->
    <!-- MODAL SOBREPOSTO: CONTA MULTIPLAYER ("LOGAR COM O GOOGLE")          -->
    <!-- =================================================================== -->
    <transition name="menu-fade-300">
      <div
        v-if="isAuthModalOpen"
        class="auth-modal-backdrop"
        @click.self="closeAuthModal"
      >
        <div
          class="auth-brick-modal"
          role="dialog"
          aria-modal="true"
          aria-labelledby="auth-modal-title"
        >
          <!-- Botão X (button_x.png) sobreposto no canto superior direito -->
          <button
            type="button"
            class="auth-sprite-close-x"
            aria-label="Fechar modal"
            @click="closeAuthModal"
          >
            <img
              :src="menuSprites.button_x"
              alt="Fechar"
              draggable="false"
            />
          </button>

          <!-- Título CONTA MULTIPLAYER -->
          <h2 id="auth-modal-title" class="auth-brick-title">
            CONTA MULTIPLAYER
          </h2>

          <!-- Botão Principal LOGAR COM O GOOGLE (button_google.png) -->
          <button
            type="button"
            class="auth-sprite-google-btn"
            :disabled="authStore.state.isLoading"
            aria-label="Logar com o Google"
            @click="handleGoogleLogin"
          >
            <img
              :src="menuSprites.button_google"
              alt="Logar com o Google"
              draggable="false"
            />
          </button>

          <p v-if="authStore.state.isLoading" class="auth-status-msg">
            ⏳ Aguardando confirmação na janela oficial do Google...
          </p>
          <p v-else-if="authStore.state.error" class="auth-error-msg">
            ⚠️ {{ authStore.state.error }}
          </p>

          <!-- Botão Secundário CANCELAR (button_cancel.png) sobreposto na borda inferior -->
          <button
            type="button"
            class="auth-sprite-cancel-btn"
            aria-label="Cancelar"
            @click="closeAuthModal"
          >
            <img
              :src="menuSprites.button_cancel"
              alt="Cancelar"
              draggable="false"
            />
          </button>
        </div>
      </div>
    </transition>

    <!-- =================================================================== -->
    <!-- TELA DE LOBBY DO MULTIPLAYER (MULTIPLAYER_LOBBY — 4 SLOTS)          -->
    <!-- =================================================================== -->
    <transition name="menu-fade-300">
      <div
        v-if="screenFlow === 'MULTIPLAYER_LOBBY'"
        class="mp-lobby-screen"
      >
        <!-- Botão discreto no canto superior esquerdo para voltar ao Menu Principal -->
        <button
          type="button"
          class="mp-lobby-back-btn"
          title="Voltar ao Menu Principal (Esc)"
          @click="returnToMainMenu"
        >
          <img
            :src="menuSprites.button_x"
            alt="Voltar"
            draggable="false"
          />
        </button>

        <!-- 1. Cabeçalho Superior: text_multiplayer.png ("SALA MULTIPLAYER") + MODO DE JOGO AO LADO DE CONDIÇÃO DE VITÓRIA -->
        <header class="mp-lobby-top-banner">
          <img
            :src="menuSprites.text_multiplayer"
            alt="Sala Multiplayer"
            class="mp-lobby-banner-img"
            draggable="false"
          />

          <!-- Barra Dupla Lado a Lado: Modo de Jogo + Condição de Vitória (Copa) -->
          <div class="mp-lobby-settings-row">
            <!-- Bloco 1: Modo de Jogo -->
            <div class="mp-lobby-mode-bar">
              <div class="mp-lobby-mode-status">
                <span class="mp-lobby-mode-kicker">MODO DE JOGO:</span>
                <span class="mp-lobby-mode-value">
                  {{ currentLobbyModeInfo.icon }} {{ currentLobbyModeInfo.title }}
                </span>
                <span
                  class="mp-lobby-mode-tag"
                  :style="{ backgroundColor: currentLobbyModeInfo.accentColor }"
                >
                  {{ currentLobbyModeInfo.badge }}
                </span>
              </div>

              <button
                type="button"
                class="mode-gear-btn mode-gear-btn--mp"
                title="Selecionar o Modo de Jogo da Sala"
                aria-label="Selecionar o Modo de Jogo da Sala"
                @click="openGameModeModal"
              >
                <span class="mode-gear-btn-icon" aria-hidden="true">⚙️</span>
                <span class="mode-gear-btn-text">MODO DE JOGO</span>
              </button>
            </div>

            <!-- Bloco 2 (AO LADO): Condição de Vitória (Copa Multiplayer + Cartela) -->
            <div class="mp-lobby-mode-bar mp-lobby-mode-bar--victory">
              <div class="mp-lobby-mode-status">
                <span class="mp-lobby-mode-kicker">CONDIÇÃO DE VITÓRIA:</span>
                <span class="mp-lobby-mode-value">
                  {{ currentLobbyVictoryInfo.icon }} {{ currentLobbyVictoryInfo.title }}
                </span>
                <div
                  class="cartela-mini-preview"
                  :title="`Cartela de ${currentLobbyVictoryInfo.targetPoints} áreas (1º=3pts, 2º=2pts, 3º=1pt, 4º=0pts)`"
                >
                  <span
                    v-for="cell in currentLobbyVictoryInfo.targetPoints"
                    :key="cell"
                    class="cartela-mini-cell"
                  ></span>
                </div>
              </div>

              <button
                type="button"
                class="mode-gear-btn mode-gear-btn--mp mode-gear-btn--cup"
                title="Selecionar Condição de Vitória da Copa Multiplayer"
                aria-label="Selecionar Condição de Vitória"
                @click="openGameModeModal"
              >
                <span class="mode-gear-btn-icon" aria-hidden="true">🏆</span>
                <span class="mode-gear-btn-text">CONDIÇÃO DE VITÓRIA</span>
              </button>
            </div>
          </div>
        </header>

        <!-- 2. Grid Central de 4 Slots Horizontais (Máximo de 4 Players) -->
        <div class="mp-lobby-slots-grid">
          <div
            v-for="slot in lobbySlots"
            :key="slot.slotIndex"
            class="mp-slot-column"
            :class="`mp-slot-column--${slot.state.toLowerCase()}`"
          >
            <!-- ========================================================= -->
            <!-- ESTADO A: SLOT VAZIO (EMPTY — area_unready.png)           -->
            <!-- ========================================================= -->
            <template v-if="slot.state === 'EMPTY'">
              <div class="mp-slot-unready-stage">
                <img
                  :src="menuSprites.area_unready"
                  alt="Slot Vazio"
                  class="mp-slot-unready-wall"
                  draggable="false"
                />
                <!-- Silhueta sombreada do personagem sobre o bloco escuro -->
                <img
                  :src="getSkinSpriteUrl(slot.silhouetteSkinId)"
                  alt=""
                  aria-hidden="true"
                  class="mp-slot-silhouette-char"
                  draggable="false"
                />
              </div>

              <!-- Área inferior do slot vazio: Botão Verde CONVIDAR + Aguardando -->
              <div class="mp-slot-empty-actions">
                <button
                  type="button"
                  class="mp-clean-brick-btn mp-clean-brick-btn--green"
                  @click="openFriendsInviteModal(slot.slotIndex)"
                >
                  <img
                    :src="
                      menuSprites.button_clean_green || menuSprites.button_clean
                    "
                    alt=""
                    aria-hidden="true"
                    draggable="false"
                  />
                  <span class="mp-clean-brick-btn-label">CONVIDAR</span>
                </button>
                <span class="mp-slot-waiting-text">Aguardando</span>
              </div>
            </template>

            <!-- ========================================================= -->
            <!-- ESTADOS B & C: JOGADOR NA SALA (JOINED_UNREADY / READY)   -->
            <!-- ========================================================= -->
            <template v-else>
              <div class="mp-slot-ready-stage">
                <!-- Parede amarela + placa branca inferior (area_ready.png) -->
                <img
                  :src="menuSprites.area_ready"
                  alt="Jogador na Sala"
                  class="mp-slot-ready-bg"
                  draggable="false"
                />

                <!-- Cartela de Pontos da Copa no topo do Slot do Jogador -->
                <div
                  class="mp-slot-cartela-badge"
                  :title="`Cartela da Copa: ${slot.cupPoints} / ${currentLobbyVictoryInfo.targetPoints} pontos`"
                >
                  <div class="mp-slot-cartela-header">
                    <span class="mp-slot-cartela-title">
                      {{ currentLobbyVictoryInfo.icon }} CARTELA
                    </span>
                    <span class="mp-slot-cartela-score mono">
                      {{ slot.cupPoints }}/{{ currentLobbyVictoryInfo.targetPoints }}
                    </span>
                  </div>
                  <div
                    class="mp-slot-cartela-grid"
                    :class="`mp-slot-cartela-grid--${currentLobbyVictoryInfo.targetPoints}`"
                  >
                    <span
                      v-for="cellIdx in currentLobbyVictoryInfo.targetPoints"
                      :key="cellIdx"
                      class="mp-slot-cartela-cell"
                      :class="{
                        'mp-slot-cartela-cell--filled': cellIdx <= slot.cupPoints,
                      }"
                    ></span>
                  </div>
                </div>

                <!-- Personagem equipado sobre a nuvem de blocos brancos -->
                <img
                  :src="getSkinSpriteUrl(slot.skinSpriteId)"
                  :alt="slot.customNick"
                  class="mp-slot-character-sprite"
                  :class="{
                    'mp-slot-character-sprite--interactive': slot.isLocalHost,
                  }"
                  :title="
                    slot.isLocalHost
                      ? 'Clique no personagem para trocar de skin'
                      : slot.customNick
                  "
                  draggable="false"
                  @click="slot.isLocalHost && cycleLocalLobbySkin()"
                />

                <!-- Placa branca inferior: Linha 1 (customNick editável para o player local) e Linha 2 (@handle imutável) -->
                <div class="mp-slot-identity-plate">
                  <template v-if="slot.isLocalHost && isEditingCustomNick">
                    <div class="mp-slot-nick-editor">
                      <input
                        v-model="customNickInput"
                        type="text"
                        maxlength="16"
                        class="mp-slot-nick-input"
                        placeholder="Seu nick (2-16)"
                        @keydown.enter.prevent="saveCustomNick"
                        @keydown.esc.prevent="cancelNickEditor"
                      />
                      <button
                        type="button"
                        class="mp-slot-nick-save-btn"
                        :disabled="isSavingCustomNick"
                        title="Salvar Nick"
                        @click="saveCustomNick"
                      >
                        {{ isSavingCustomNick ? '...' : 'OK' }}
                      </button>
                    </div>
                  </template>
                  <button
                    v-else-if="slot.isLocalHost"
                    type="button"
                    class="mp-slot-nick-edit-btn"
                    title="Clique para personalizar seu Nick (2 a 16 caracteres)"
                    @click="openNickEditor"
                  >
                    <span class="mp-slot-nick">{{ slot.customNick }}</span>
                    <span class="mp-slot-nick-pencil" aria-hidden="true">✎</span>
                  </button>
                  <span v-else class="mp-slot-nick">{{ slot.customNick }}</span>

                  <span class="mp-slot-handle">{{ slot.handle }}</span>
                </div>

                <!-- Base da placa branca: Apenas o próprio player pode clicar em PRONTO / cancelar o próprio PRONTO! -->
                <div class="mp-slot-ready-footer">
                  <!-- ESTADO C (Próprio player pronto): Botão PRONTO! clicável para cancelar -->
                  <button
                    v-if="slot.state === 'READY' && slot.isLocalHost"
                    type="button"
                    class="mp-slot-ready-sprite-btn"
                    title="Clique para cancelar o seu Pronto"
                    @click="toggleLobbySlotReady(slot.slotIndex)"
                  >
                    <img
                      :src="menuSprites.text_ready"
                      alt="PRONTO!"
                      draggable="false"
                    />
                  </button>

                  <!-- ESTADO C (Convidado pronto): Badge estático PRONTO! (somente o próprio convidado controla seu estado) -->
                  <div
                    v-else-if="slot.state === 'READY'"
                    class="mp-slot-ready-sprite-static"
                  >
                    <img
                      :src="menuSprites.text_ready"
                      alt="PRONTO!"
                      draggable="false"
                    />
                  </div>

                  <!-- ESTADO B (Apenas para o próprio jogador local): Botão clicável PRONTO -->
                  <button
                    v-else-if="slot.isLocalHost"
                    type="button"
                    class="mp-clean-brick-btn mp-clean-brick-btn--ready"
                    @click="toggleLobbySlotReady(slot.slotIndex)"
                  >
                    <img
                      :src="
                        menuSprites.button_clean_green ||
                        menuSprites.button_clean
                      "
                      alt=""
                      aria-hidden="true"
                      draggable="false"
                    />
                    <span class="mp-clean-brick-btn-label">PRONTO</span>
                  </button>

                  <!-- ESTADO B (Convidado na sala ainda não pronto): Exibe Aguardando... -->
                  <span
                    v-else
                    class="mp-slot-guest-waiting-badge"
                  >
                    Aguardando...
                  </span>
                </div>
              </div>
            </template>
          </div>
        </div>

        <!-- 3. Rodapé Central: Contagem Regressiva e Início da Partida -->
        <transition name="menu-fade-300">
          <footer
            v-if="lobbyCountdownDisplayNumber !== null"
            class="mp-lobby-countdown-footer"
          >
            <span class="mp-countdown-heading">COMEÇANDO EM:</span>
            <span class="mp-countdown-digit">
              {{ lobbyCountdownDisplayNumber }}
            </span>
            <div class="mp-starting-badge-wrap">
              <div class="mp-clean-brick-btn mp-clean-brick-btn--starting">
                <img
                  :src="
                    menuSprites.button_clean_yellow || menuSprites.button_clean
                  "
                  alt=""
                  aria-hidden="true"
                  draggable="false"
                />
                <span class="mp-clean-brick-btn-label">STARTING</span>
              </div>
              <button
                type="button"
                class="mp-starting-cancel-x"
                title="Cancelar contagem regressiva"
                @click="cancelLobbyCountdown"
              >
                <img
                  :src="menuSprites.button_x"
                  alt="Cancelar"
                  draggable="false"
                />
              </button>
            </div>
          </footer>
        </transition>
      </div>
    </transition>

    <!-- =================================================================== -->
    <!-- MENU POPUP: "SELECIONE O MODO DE JOGO" + AO LADO "CONDIÇÃO DE VITÓRIA" -->
    <!-- =================================================================== -->
    <transition name="menu-fade-300">
      <div
        v-if="isGameModeModalOpen"
        class="gamemode-modal-backdrop"
        @click.self="closeGameModeModal"
      >
        <div
          class="gamemode-lego-modal gamemode-lego-modal--wide"
          role="dialog"
          aria-modal="true"
          aria-labelledby="gamemode-modal-title"
        >
          <div class="gamemode-modal-studs" aria-hidden="true">
            <span class="gamemode-modal-stud"></span>
            <span class="gamemode-modal-stud"></span>
            <span class="gamemode-modal-stud"></span>
            <span class="gamemode-modal-stud"></span>
            <span class="gamemode-modal-stud"></span>
            <span class="gamemode-modal-stud"></span>
            <span class="gamemode-modal-stud"></span>
            <span class="gamemode-modal-stud"></span>
          </div>

          <button
            type="button"
            class="gamemode-modal-close-x"
            title="Fechar configurações da partida (Esc)"
            aria-label="Fechar configurações da partida"
            @click="closeGameModeModal"
          >
            <img
              :src="menuSprites.button_x"
              alt="Fechar"
              draggable="false"
            />
          </button>

          <!-- DUAS COLUNAS LADO A LADO: MODO DE JOGO (ESQUERDA) + CONDIÇÃO DE VITÓRIA (DIREITA - MULTIPLAYER) -->
          <div class="gamemode-dual-columns">
            <!-- COLUNA 1: SELECIONE O MODO DE JOGO -->
            <section class="gamemode-column-panel">
              <header class="gamemode-modal-header">
                <div class="gamemode-modal-gear-badge" aria-hidden="true">⚙️</div>
                <div>
                  <h2 id="gamemode-modal-title" class="gamemode-modal-title">
                    SELECIONE O MODO DE JOGO
                  </h2>
                  <p class="gamemode-modal-subtitle">
                    Válido para Batalha Local e Multiplayer (ou deixe no Aleatório!)
                  </p>
                </div>
              </header>

              <div class="gamemode-options-grid">
                <button
                  v-for="opt in GAME_MODE_OPTIONS"
                  :key="opt.id"
                  type="button"
                  class="gamemode-option-card"
                  :class="{
                    'gamemode-option-card--selected':
                      currentLobbySelectableMode === opt.id,
                  }"
                  :style="{ '--mode-accent': opt.accentColor }"
                  @click="selectGameModeOption(opt.id)"
                >
                  <div class="gamemode-option-top">
                    <span class="gamemode-option-icon">{{ opt.icon }}</span>
                    <span
                      class="gamemode-option-badge"
                      :style="{ backgroundColor: opt.accentColor }"
                    >
                      {{ opt.badge }}
                    </span>
                  </div>

                  <h3 class="gamemode-option-title">{{ opt.title }}</h3>
                  <p class="gamemode-option-desc">{{ opt.description }}</p>

                  <ul class="gamemode-option-rules">
                    <li v-for="(rule, rIdx) in opt.rulesSummary" :key="rIdx">
                      {{ rule }}
                    </li>
                  </ul>

                  <div class="gamemode-option-footer">
                    <span
                      class="gamemode-option-cta"
                      :class="{
                        'gamemode-option-cta--active':
                          currentLobbySelectableMode === opt.id,
                      }"
                    >
                      {{
                        currentLobbySelectableMode === opt.id
                          ? '✓ MODO SELECIONADO'
                          : 'SELECIONAR MODO'
                      }}
                    </span>
                  </div>
                </button>
              </div>
            </section>

            <!-- COLUNA 2 (AO LADO): CONDIÇÃO DE VITÓRIA (VÁLIDO APENAS PARA O MODO MULTIPLAYER) -->
            <section
              class="gamemode-column-panel gamemode-column-panel--victory"
              :class="{
                'gamemode-column-panel--local-hint':
                  screenFlow === 'LOCAL_LOBBY' ||
                  (screenFlow === 'MAIN_MENU' && selectedMenuCard === 'LOCAL'),
              }"
            >
              <header class="gamemode-modal-header">
                <div
                  class="gamemode-modal-gear-badge gamemode-modal-gear-badge--cup"
                  aria-hidden="true"
                >
                  🏆
                </div>
                <div class="gamemode-victory-header-copy">
                  <div class="gamemode-victory-title-row">
                    <h2 class="gamemode-modal-title">CONDIÇÃO DE VITÓRIA</h2>
                    <span class="gamemode-mp-only-pill">
                      🌐 APENAS MULTIPLAYER
                    </span>
                  </div>
                  <p class="gamemode-modal-subtitle">
                    Pontuação Tricky Towers:
                    <strong>1º = 3 pts</strong> •
                    <strong>2º = 2 pts</strong> •
                    <strong>3º = 1 pt</strong> •
                    <strong>4º = 0 pts</strong>
                    (cada ponto preenche 1 área da cartela!)
                  </p>
                </div>
              </header>

              <div class="gamemode-options-grid">
                <button
                  v-for="vcOpt in VICTORY_CONDITION_OPTIONS"
                  :key="vcOpt.id"
                  type="button"
                  class="gamemode-option-card gamemode-option-card--victory"
                  :class="{
                    'gamemode-option-card--selected':
                      currentLobbyVictoryCondition === vcOpt.id,
                  }"
                  :style="{ '--mode-accent': vcOpt.accentColor }"
                  @click="selectVictoryConditionOption(vcOpt.id)"
                >
                  <div class="gamemode-option-top">
                    <span class="gamemode-option-icon">{{ vcOpt.icon }}</span>
                    <span
                      class="gamemode-option-badge"
                      :style="{ backgroundColor: vcOpt.accentColor }"
                    >
                      {{ vcOpt.badge }}
                    </span>
                  </div>

                  <h3 class="gamemode-option-title">{{ vcOpt.title }}</h3>

                  <!-- CARTELA VISUAL DE DEMONSTRAÇÃO (CADA PONTO PREENCHE UMA ÁREA) -->
                  <div class="victory-card-cartela-box">
                    <div class="victory-card-cartela-top">
                      <span class="victory-card-cartela-label">
                        📋 CARTELA DE {{ vcOpt.targetPoints }} ÁREAS:
                      </span>
                      <span class="victory-card-cartela-pts mono">
                        {{ vcOpt.targetPoints }} PTS
                      </span>
                    </div>
                    <div
                      class="victory-card-cartela-slots"
                      :class="`victory-card-cartela-slots--${vcOpt.targetPoints}`"
                    >
                      <span
                        v-for="slotNum in vcOpt.targetPoints"
                        :key="slotNum"
                        class="victory-card-cartela-slot"
                        :class="{
                          'victory-card-cartela-slot--sample-1st': slotNum <= 3,
                          'victory-card-cartela-slot--sample-2nd':
                            slotNum > 3 && slotNum <= 5,
                        }"
                      >
                        {{ slotNum }}
                      </span>
                    </div>
                  </div>

                  <p class="gamemode-option-desc">{{ vcOpt.description }}</p>

                  <ul class="gamemode-option-rules">
                    <li v-for="(rule, rIdx) in vcOpt.rulesSummary" :key="rIdx">
                      {{ rule }}
                    </li>
                  </ul>

                  <div class="gamemode-option-footer">
                    <span
                      class="gamemode-option-cta"
                      :class="{
                        'gamemode-option-cta--active':
                          currentLobbyVictoryCondition === vcOpt.id,
                      }"
                    >
                      {{
                        currentLobbyVictoryCondition === vcOpt.id
                          ? '✓ COPA SELECIONADA'
                          : 'SELECIONAR COPA'
                      }}
                    </span>
                  </div>
                </button>
              </div>
            </section>
          </div>

          <footer class="gamemode-modal-bottom-bar">
            <div class="gamemode-modal-summary">
              <span>
                ⚙️ Modo:
                <strong>
                  {{ currentLobbyModeInfo.icon }} {{ currentLobbyModeInfo.title }}
                </strong>
              </span>
              <span class="gamemode-modal-summary-sep">•</span>
              <span>
                🏆 Copa Multiplayer:
                <strong>
                  {{ currentLobbyVictoryInfo.icon }}
                  {{ currentLobbyVictoryInfo.title }}
                  ({{ currentLobbyVictoryInfo.targetPoints }} áreas na cartela)
                </strong>
              </span>
            </div>
            <button
              type="button"
              class="gamemode-modal-confirm-btn"
              @click="closeGameModeModal"
            >
              ✓ CONFIRMAR E VOLTAR
            </button>
          </footer>
        </div>
      </div>
    </transition>

    <!-- =================================================================== -->
    <!-- 4. POPUP GLOBAL DE AMIGOS E ENVIAR CONVITE (MENU E MULTIPLAYER)     -->
    <!-- =================================================================== -->
    <transition name="menu-fade-300">
      <div
        v-if="isFriendsModalOpen"
        class="friends-modal-backdrop"
        @click.self="closeFriendsInviteModal"
      >
        <div
          class="friends-lego-frame"
          role="dialog"
          aria-modal="true"
          aria-label="Lista de Amigos e Enviar Convite"
        >
          <!-- Botão Fechar (X) no canto superior direito do modal -->
          <button
            type="button"
            class="friends-modal-close-btn"
            title="Fechar lista de amigos"
            @click="closeFriendsInviteModal"
          >
            <img
              :src="menuSprites.button_x"
              alt="Fechar"
              draggable="false"
            />
          </button>

          <!-- Barra Superior Vermelha de Blocos: Input + Botão Laranja ENVIAR CONVITE -->
          <div class="friends-lego-top-bar">
            <div class="friends-top-side-studs" aria-hidden="true">
              <span class="friends-stud friends-stud--red"></span>
              <span class="friends-stud friends-stud--red"></span>
            </div>

            <div class="friends-add-controls">
              <input
                ref="friendSearchInputRef"
                v-model="friendSearchInput"
                type="text"
                class="friends-search-input"
                placeholder="@nome_000 ou email do amigo"
                @keydown.enter.prevent="handleAddFriend"
              />
              <button
                type="button"
                class="mp-clean-brick-btn mp-clean-brick-btn--orange"
                :disabled="isAddingFriend"
                @click="handleAddFriend"
              >
                <img
                  :src="
                    menuSprites.button_clean_orange ||
                    menuSprites.button_clean
                  "
                  alt=""
                  aria-hidden="true"
                  draggable="false"
                />
                <span class="mp-clean-brick-btn-label">
                  {{ isAddingFriend ? '...' : 'ENVIAR CONVITE' }}
                </span>
              </button>
            </div>

            <div class="friends-top-side-studs" aria-hidden="true">
              <span class="friends-stud friends-stud--red"></span>
              <span class="friends-stud friends-stud--red"></span>
            </div>
          </div>

          <!-- Corpo Central: Coluna Esquerda de Blocos + Lista Rolável + Coluna Direita de Blocos -->
          <div class="friends-lego-middle">
            <!-- Coluna Lateral Esquerda de Blocos -->
            <div class="friends-lego-side-rail" aria-hidden="true">
              <div class="friends-rail-brick friends-rail-brick--green">
                <span class="friends-stud friends-stud--green"></span>
                <span class="friends-stud friends-stud--green"></span>
              </div>
              <div class="friends-rail-brick friends-rail-brick--orange"></div>
              <div class="friends-rail-brick friends-rail-brick--blue-tall">
                <span class="friends-stud friends-stud--blue"></span>
                <span class="friends-stud friends-stud--blue"></span>
                <span class="friends-stud friends-stud--blue"></span>
              </div>
            </div>

            <!-- Lista Rolável de Amigos Adicionados (exibe até 4 visíveis e rola para os demais) -->
            <div class="friends-list-bezel">
              <div v-if="authStore.state.user" class="friends-my-handle-bar">
                <span class="friends-my-handle-label">
                  AMIGOS ADICIONADOS ({{ friendsList.length }})
                </span>
                <button
                  type="button"
                  class="friends-my-handle-copy-btn"
                  title="Copiar seu ID para enviar a um amigo"
                  @click="copyMyHandle"
                >
                  Meu ID: <strong>{{ authStore.state.user.handle }}</strong> 📋
                </button>
              </div>
              <div class="friends-list-scroll">
                <!-- Pedidos de amizade pendentes recebidos em tempo real -->
                <div
                  v-for="req in multiplayerClient.state.incomingFriendRequests"
                  :key="`req-${req.handle}`"
                  class="friend-item-card friend-item-card--request"
                >
                  <div class="friend-avatar-box">
                    <img
                      :src="getFriendSkinSpriteUrl(req.equippedSkin)"
                      :alt="req.customNick"
                      class="friend-avatar-img"
                      draggable="false"
                    />
                  </div>
                  <div class="friend-identity-col">
                    <span class="friend-custom-nick">
                      {{ req.customNick }}
                    </span>
                    <span class="friend-handle-tag">
                      {{ req.handle }} • PEDIDO DE AMIZADE
                    </span>
                  </div>
                  <div class="friend-request-actions">
                    <button
                      type="button"
                      class="mp-clean-brick-btn mp-clean-brick-btn--req-accept"
                      @click="handleRespondFriendRequest(req.handle, true)"
                    >
                      <img
                        :src="
                          menuSprites.button_clean_green ||
                          menuSprites.button_clean
                        "
                        alt=""
                        aria-hidden="true"
                        draggable="false"
                      />
                      <span class="mp-clean-brick-btn-label">ACEITAR</span>
                    </button>
                    <button
                      type="button"
                      class="mp-clean-brick-btn mp-clean-brick-btn--req-decline"
                      @click="handleRespondFriendRequest(req.handle, false)"
                    >
                      <img
                        :src="
                          menuSprites.button_clean_orange ||
                          menuSprites.button_clean
                        "
                        alt=""
                        aria-hidden="true"
                        draggable="false"
                      />
                      <span class="mp-clean-brick-btn-label">RECUSAR</span>
                    </button>
                  </div>
                </div>

                <div
                  v-if="
                    friendsList.length === 0 &&
                    multiplayerClient.state.incomingFriendRequests.length === 0
                  "
                  class="friends-empty-state"
                >
                  <span class="friends-empty-title">
                    NENHUM AMIGO ADICIONADO
                  </span>
                  <span class="friends-empty-sub">
                    Digite o <strong>@nome_000</strong> ou
                    <strong>email</strong> acima e clique em
                    <strong>ENVIAR CONVITE</strong> para adicionar seu amigo! Ele já aparecerá automaticamente aqui e no Multiplayer.
                  </span>
                </div>

                <div
                  v-for="(friend, fIdx) in friendsList"
                  :key="`${friend.handle}-${fIdx}`"
                  class="friend-item-card"
                  :class="{ 'friend-item-card--offline': !friend.isOnline }"
                >
                  <!-- Esquerda: Miniatura do personagem/skin do amigo -->
                  <div class="friend-avatar-box">
                    <!-- Avatar SVG para skin ROBOT (fiel à imagem de referência) -->
                    <svg
                      v-if="friend.equippedSkin.toUpperCase() === 'ROBOT'"
                      viewBox="0 0 64 64"
                      class="friend-robot-svg"
                      aria-hidden="true"
                    >
                      <line
                        x1="32"
                        y1="6"
                        x2="32"
                        y2="14"
                        stroke="#1e293b"
                        stroke-width="3.5"
                        stroke-linecap="round"
                      />
                      <circle
                        cx="32"
                        cy="6"
                        r="4"
                        fill="#94a3b8"
                        stroke="#1e293b"
                        stroke-width="2.5"
                      />
                      <rect
                        x="14"
                        y="14"
                        width="36"
                        height="26"
                        rx="5"
                        fill="#94a3b8"
                        stroke="#1e293b"
                        stroke-width="3"
                      />
                      <circle
                        cx="24"
                        cy="26"
                        r="4.5"
                        fill="#f8fafc"
                        stroke="#1e293b"
                        stroke-width="2.5"
                      />
                      <circle cx="24" cy="26" r="1.8" fill="#1e293b" />
                      <circle
                        cx="40"
                        cy="26"
                        r="4.5"
                        fill="#f8fafc"
                        stroke="#1e293b"
                        stroke-width="2.5"
                      />
                      <circle cx="40" cy="26" r="1.8" fill="#1e293b" />
                      <rect
                        x="23"
                        y="33"
                        width="18"
                        height="3.5"
                        rx="1.5"
                        fill="#475569"
                      />
                      <rect
                        x="16"
                        y="42"
                        width="32"
                        height="20"
                        rx="4"
                        fill="#64748b"
                        stroke="#1e293b"
                        stroke-width="3"
                      />
                      <rect
                        x="22"
                        y="48"
                        width="9"
                        height="7"
                        rx="1.5"
                        fill="#ef4444"
                        stroke="#1e293b"
                        stroke-width="2"
                      />
                      <rect
                        x="34"
                        y="48"
                        width="8"
                        height="7"
                        rx="1.5"
                        fill="#22c55e"
                        stroke="#1e293b"
                        stroke-width="2"
                      />
                    </svg>
                    <img
                      v-else
                      :src="getFriendSkinSpriteUrl(friend.equippedSkin)"
                      :alt="friend.customNick"
                      class="friend-avatar-img"
                      draggable="false"
                    />
                  </div>

                  <!-- Centro: customNick em destaque + @handle + status ONLINE/OFFLINE -->
                  <div class="friend-identity-col">
                    <span class="friend-custom-nick">
                      {{ friend.customNick }}
                    </span>
                    <div class="friend-handle-row">
                      <span class="friend-handle-tag">
                        {{ friend.handle }}
                      </span>
                      <span
                        class="friend-presence-badge"
                        :class="
                          friend.isOnline
                            ? 'friend-presence-badge--online'
                            : 'friend-presence-badge--offline'
                        "
                      >
                        {{ friend.isOnline ? '● ONLINE' : '○ OFFLINE' }}
                      </span>
                    </div>
                  </div>

                  <!-- Direita: Botão verde usando button_clean.png com texto CONVIDAR (ativo apenas se ONLINE) -->
                  <button
                    type="button"
                    class="mp-clean-brick-btn mp-clean-brick-btn--friend-invite"
                    :disabled="
                      !friend.isOnline ||
                      Boolean(invitingFriendHandles[friend.handle]) ||
                      (screenFlow === 'MULTIPLAYER_LOBBY' &&
                        isFriendInLobby(friend.handle))
                    "
                    @click="handleInviteFriend(friend)"
                  >
                    <img
                      :src="
                        menuSprites.button_clean_green ||
                        menuSprites.button_clean
                      "
                      alt=""
                      aria-hidden="true"
                      draggable="false"
                    />
                    <span class="mp-clean-brick-btn-label">
                      {{
                        screenFlow === 'MULTIPLAYER_LOBBY' &&
                        isFriendInLobby(friend.handle)
                          ? 'NA SALA'
                          : !friend.isOnline
                            ? 'OFFLINE'
                            : invitingFriendHandles[friend.handle]
                              ? 'ENVIADO...'
                              : 'CONVIDAR'
                      }}
                    </span>
                  </button>
                </div>
              </div>
            </div>

            <!-- Coluna Lateral Direita de Blocos -->
            <div class="friends-lego-side-rail" aria-hidden="true">
              <div class="friends-rail-brick friends-rail-brick--blue">
                <span class="friends-stud friends-stud--blue"></span>
                <span class="friends-stud friends-stud--blue"></span>
              </div>
              <div class="friends-rail-brick friends-rail-brick--yellow"></div>
              <div class="friends-rail-brick friends-rail-brick--red-tall">
                <span class="friends-stud friends-stud--red"></span>
                <span class="friends-stud friends-stud--red"></span>
                <span class="friends-stud friends-stud--red"></span>
              </div>
            </div>
          </div>

          <!-- Barra Inferior Colorida de Blocos -->
          <div class="friends-lego-bottom-bar" aria-hidden="true">
            <div class="friends-bottom-brick friends-bottom-brick--blue">
              <span class="friends-stud friends-stud--blue"></span>
              <span class="friends-stud friends-stud--blue"></span>
              <span class="friends-stud friends-stud--blue"></span>
            </div>
            <div class="friends-bottom-brick friends-bottom-brick--green">
              <span class="friends-stud friends-stud--green"></span>
              <span class="friends-stud friends-stud--green"></span>
            </div>
            <div class="friends-bottom-brick friends-bottom-brick--orange">
              <span class="friends-stud friends-stud--orange"></span>
            </div>
            <div class="friends-bottom-brick friends-bottom-brick--purple">
              <span class="friends-stud friends-stud--purple"></span>
            </div>
            <div class="friends-bottom-brick friends-bottom-brick--red">
              <span class="friends-stud friends-stud--red"></span>
              <span class="friends-stud friends-stud--red"></span>
              <span class="friends-stud friends-stud--red"></span>
              <span class="friends-stud friends-stud--red"></span>
            </div>
          </div>
        </div>
      </div>
    </transition>

    <!-- =================================================================== -->
    <!-- ALERTAS EM TEMPO REAL (CONVITES DE SALA E PEDIDOS DE AMIZADE)       -->
    <!-- =================================================================== -->
    <div class="mp-realtime-alerts-stack">
      <!-- Alerta de Convite para Sala Multiplayer -->
      <transition name="menu-fade-300">
        <div
          v-if="multiplayerClient.state.incomingRoomInvite"
          class="mp-realtime-invite-toast"
        >
          <div class="mp-realtime-invite-text">
            <strong>
              {{ multiplayerClient.state.incomingRoomInvite.hostCustomNick }}
            </strong>
            <span>
              ({{ multiplayerClient.state.incomingRoomInvite.hostHandle }})
              convidou você para jogar!
            </span>
          </div>
          <div class="mp-realtime-invite-actions">
            <button
              type="button"
              class="mp-clean-brick-btn mp-clean-brick-btn--toast-accept"
              @click="handleAcceptIncomingRoomInvite"
            >
              <img
                :src="
                  menuSprites.button_clean_green || menuSprites.button_clean
                "
                alt=""
                aria-hidden="true"
                draggable="false"
              />
              <span class="mp-clean-brick-btn-label">ACEITAR</span>
            </button>
            <button
              type="button"
              class="mp-clean-brick-btn mp-clean-brick-btn--toast-decline"
              @click="handleDeclineIncomingRoomInvite"
            >
              <img
                :src="
                  menuSprites.button_clean_orange || menuSprites.button_clean
                "
                alt=""
                aria-hidden="true"
                draggable="false"
              />
              <span class="mp-clean-brick-btn-label">RECUSAR</span>
            </button>
          </div>
        </div>
      </transition>

      <!-- Alerta de Pedido de Amizade Recebido em Tempo Real -->
      <transition name="menu-fade-300">
        <div
          v-if="
            multiplayerClient.state.incomingFriendRequests.length > 0 &&
            !isFriendsModalOpen
          "
          class="mp-realtime-invite-toast mp-realtime-invite-toast--friend"
        >
          <div class="mp-realtime-invite-text">
            <strong>
              {{
                multiplayerClient.state.incomingFriendRequests[0].customNick
              }}
            </strong>
            <span>
              ({{ multiplayerClient.state.incomingFriendRequests[0].handle }})
              enviou um pedido de amizade!
            </span>
          </div>
          <div class="mp-realtime-invite-actions">
            <button
              type="button"
              class="mp-clean-brick-btn mp-clean-brick-btn--toast-accept"
              @click="
                handleRespondFriendRequest(
                  multiplayerClient.state.incomingFriendRequests[0].handle,
                  true,
                )
              "
            >
              <img
                :src="
                  menuSprites.button_clean_green || menuSprites.button_clean
                "
                alt=""
                aria-hidden="true"
                draggable="false"
              />
              <span class="mp-clean-brick-btn-label">ACEITAR</span>
            </button>
            <button
              type="button"
              class="mp-clean-brick-btn mp-clean-brick-btn--toast-decline"
              @click="
                handleRespondFriendRequest(
                  multiplayerClient.state.incomingFriendRequests[0].handle,
                  false,
                )
              "
            >
              <img
                :src="
                  menuSprites.button_clean_orange || menuSprites.button_clean
                "
                alt=""
                aria-hidden="true"
                draggable="false"
              />
              <span class="mp-clean-brick-btn-label">RECUSAR</span>
            </button>
          </div>
        </div>
      </transition>
    </div>

    <!-- FLOATING EVENT BANNER (GLOBAL: MENU, LOBBY & IN-GAME) -->
    <transition name="fade">
      <div
        v-if="eventBanner"
        class="event-banner"
        :class="`event-banner--${eventBanner.tone}`"
      >
        {{ eventBanner.message }}
      </div>
    </transition>

    <!-- =================================================================== -->
    <!-- IN-GAME HUD & MATCH OVERLAYS                                        -->
    <!-- =================================================================== -->
    <template v-if="screenFlow === 'IN_GAME'">
      <!-- MINIMAL FLOATING TOP-LEFT HUD (MODE, LIVES, RACE/SURVIVAL INFO & WIND) -->
      <div class="floating-hud-left">
        <div
          class="hud-pill"
          :class="
            snapshot.gameMode === 'SURVIVAL'
              ? 'hud-pill--survival-mode'
              : 'hud-pill--race-mode'
          "
        >
          <span class="hud-pill-label">MODO</span>
          <span class="hud-pill-value">
            {{
              snapshot.gameMode === 'SURVIVAL'
                ? '❤️ SOBREVIVÊNCIA'
                : '🏁 CORRIDA'
            }}
          </span>
        </div>

        <div
          v-if="snapshot.gameMode === 'SURVIVAL'"
          class="hud-pill hud-pill--lives"
          :class="{
            'hud-pill--lives-danger': snapshot.lives <= 1,
            'hud-pill--lives-invulnerable':
              (snapshot.invulnerableRemainingMs || 0) > 0,
            'hud-pill--lives-flash': (snapshot.fallFlashRemainingMs || 0) > 0,
          }"
        >
          <span class="hud-pill-label">VIDAS</span>
          <span class="hud-pill-value hud-lives-hearts">
            <span
              v-for="idx in snapshot.maxLives"
              :key="`heart-${idx}`"
              class="hud-heart-icon"
              :class="{ 'hud-heart-icon--lost': idx > snapshot.lives }"
            >
              {{ idx <= snapshot.lives ? '❤️' : '🖤' }}
            </span>
          </span>
          <span
            v-if="(snapshot.invulnerableRemainingMs || 0) > 0"
            class="hud-invulnerable-badge mono"
            title="Invulnerável por 3 segundos para estabilizar a torre!"
          >
            🛡️ {{ ((snapshot.invulnerableRemainingMs || 0) / 1000).toFixed(1) }}s
          </span>
        </div>

        <div class="hud-pill">
          <span class="hud-pill-label">TEMPO</span>
          <span class="hud-pill-value mono">{{ formattedTime }}</span>
        </div>

        <div v-if="snapshot.gameMode === 'SURVIVAL'" class="hud-pill">
          <span class="hud-pill-label">🧱 PEÇAS</span>
          <span class="hud-pill-value mono">
            {{ snapshot.piecesPlaced }}<small>/{{ snapshot.survivalGoalPieces }}</small>
            <small style="margin-left: 4px; color: #fde047">
              • FALTAM {{ Math.max(0, snapshot.survivalGoalPieces - snapshot.piecesPlaced) }}
            </small>
          </span>
        </div>

        <div class="hud-pill">
          <span class="hud-pill-label">ALTURA</span>
          <span v-if="snapshot.gameMode === 'SURVIVAL'" class="hud-pill-value mono">
            {{ snapshot.towerHeight.toFixed(1) }}m
            <small>MÁX {{ snapshot.maxTowerHeight.toFixed(1) }}m</small>
          </span>
          <span v-else class="hud-pill-value mono">
            {{ snapshot.towerHeight.toFixed(1) }}<small>/30m</small>
          </span>
        </div>

        <div
          class="hud-pill"
          :title="`Elevação [Col 0..7]: [${snapshot.baseElevations.join(', ')}]`"
        >
          <span class="hud-pill-label">🏠 BASE</span>
          <span class="hud-pill-value">{{ snapshot.basePresetName }}</span>
        </div>
        <div
          v-if="snapshot.windActive"
          class="hud-pill hud-pill--wind"
        >
          <span class="hud-pill-label">💨 VENTO</span>
          <span class="hud-pill-value">
            {{
              snapshot.windForce > 0.05
                ? `→ ${Math.round(snapshot.windForce * 100)}%`
                : snapshot.windForce < -0.05
                  ? `← ${Math.round(Math.abs(snapshot.windForce) * 100)}%`
                  : 'Calmo'
            }}
          </span>
        </div>
        <div
          v-if="isShiftHeld"
          class="hud-pill hud-pill--subgrid"
        >
          <span>🥊 Shift: Socão (Investida)</span>
        </div>
        <div
          v-if="isDevModeOpen"
          class="hud-pill hud-pill--paused"
        >
          <span>⏸️ PAUSADO (MODO DEV)</span>
        </div>
      </div>

      <!-- TOP-CENTER NEXT PIECE BANNER (ALIGNED WITH THE TOWER AT TOP OF SCREEN) -->
      <div
        v-if="snapshot.nextQueue.length > 0"
        class="top-tower-next-piece"
        title="Próxima Peça"
      >
        <svg
          class="next-piece-banner-svg"
          viewBox="0 0 96 76"
          width="96"
          height="76"
          aria-hidden="true"
        >
          <!-- Hanging Trapezoidal Lavender-White Box (with slightly angled bottom edge) -->
          <path
            d="M 13,12 L 84,13 L 79,71 L 16,66 Z"
            fill="#E8E6FA"
            stroke="#0F172A"
            stroke-width="3"
            stroke-linejoin="round"
          />
          <!-- Crisp White Inner Highlight Border -->
          <path
            d="M 15.5,14.5 L 81.5,15.5 L 76.8,68.2 L 18.5,63.5 Z"
            fill="none"
            stroke="#FFFFFF"
            stroke-width="2"
            stroke-linejoin="round"
          />
          <!-- Subtle Top Shadow Strip under the Header Rod -->
          <path
            d="M 14.5,13.5 L 82.5,14.5 L 82,21 L 15,20 Z"
            fill="#CBC9EC"
          />
          <!-- Top Blue-Indigo Header Bar / Rod -->
          <path
            d="M 4,2.5 L 92,3.5 L 91,13.5 L 5,12.5 Z"
            fill="#5C6BC0"
            stroke="#0F172A"
            stroke-width="3"
            stroke-linejoin="round"
          />
          <!-- Top Rod Highlight Strip -->
          <path
            d="M 6.5,4.5 L 89.5,5.5 L 89.2,8.5 L 6.8,7.5 Z"
            fill="#7E8CE0"
          />
        </svg>

        <div class="next-piece-banner-content">
          <div
            v-if="snapshot.blindManualRemainingMs > 0"
            class="next-blind-mystery"
            title="Nuvem Fog ativa: próxima peça oculta!"
          >
            <span>?</span>
          </div>
          <PiecePreviewCanvas
            v-else
            :type="snapshot.nextQueue[0].type"
            :variant="snapshot.nextQueue[0].variant"
            :color-palette-index="snapshot.nextQueue[0].colorPaletteIndex"
            :size="54"
          />
        </div>

        <div
          v-if="snapshot.gameMode === 'SURVIVAL'"
          class="survival-remaining-pieces-tag mono"
        >
          🧱 RESTAM {{ Math.max(0, snapshot.survivalGoalPieces - snapshot.piecesPlaced) }}
        </div>
      </div>

      <!-- MINIMAL FLOATING TOP-RIGHT HUD (SINGLE-SLOT POWER + DEV MODE) -->
      <div class="floating-hud-right">
        <!-- SINGLE-SLOT POWER INVENTORY CARD (8m / 16m / 24m CHECKPOINTS) -->
        <div
          class="power-slot-card"
          :class="{
            'power-slot-card--ready': currentSelfPower || currentAttackPower,
          }"
        >
          <div class="power-slot-header">
            <span class="power-slot-title">⚡ PODER (SLOT ÚNICO)</span>
            <span class="power-slot-mode">
              {{ snapshot.isSinglePlayer ? 'MVP Solo' : 'Multi' }}
            </span>
          </div>

          <template v-if="currentSelfPower || currentAttackPower">
            <button
              v-if="currentSelfPower"
              class="power-activate-btn power-activate-btn--positive"
              title="Ativar Poder Positivo em sua torre (Tecla Espaço)"
              @click="useSelfPower"
            >
              <span class="power-icon">{{ currentSelfPower.icon }}</span>
              <span class="power-info">
                <strong>{{ currentSelfPower.name }}</strong>
                <small>{{ currentSelfPower.shortDescription }}</small>
              </span>
              <kbd class="power-kbd">ESPAÇO</kbd>
            </button>

            <button
              v-if="currentAttackPower"
              class="power-activate-btn power-activate-btn--negative"
              title="Disparar Poder Negativo nos Inimigos (Tecla C ou B)"
              @click="useAttackPower"
            >
              <span class="power-icon">{{ currentAttackPower.icon }}</span>
              <span class="power-info">
                <strong>{{ currentAttackPower.name }}</strong>
                <small>Atacar Inimigos (Caos)</small>
              </span>
              <kbd class="power-kbd">C / B</kbd>
            </button>
          </template>
          <div v-else class="power-slot-empty">
            Estabilize 0.5s em
            <strong>
              {{
                snapshot.gameMode === 'SURVIVAL'
                  ? '8m, 16m, 24m+ ou 10/20/30 peças'
                  : '8m, 16m ou 24m'
              }}
            </strong>
          </div>
        </div>

        <!-- CHARACTER SKIN SELECTOR PILL + POPOVER (assets/sprites/player) -->
        <div v-if="playerSkins.length > 0" class="hud-skin-selector-wrap">
          <button
            class="hud-action-btn hud-skin-btn"
            :class="{ 'hud-skin-btn--open': isSkinPickerOpen }"
            title="Escolher Skin do Personagem (Mago, Dino, Pirata, Sombra)"
            @click="isSkinPickerOpen = !isSkinPickerOpen"
          >
            <img
              v-if="activePlayerSkin"
              :src="activePlayerSkin.url"
              :alt="activePlayerSkin.name"
              class="hud-skin-thumb"
            />
            <span class="hud-skin-label">
              <small>PERSONAGEM</small>
              <strong>{{ activePlayerSkin ? activePlayerSkin.shortName : 'Skin' }}</strong>
            </span>
          </button>

          <transition name="fade">
            <div v-if="isSkinPickerOpen" class="hud-skin-popover">
              <div class="hud-skin-popover-head">
                <span>🎭 Variações de Skin (<code>assets/sprites/player</code>)</span>
                <button
                  class="hud-skin-close"
                  title="Fechar"
                  @click="isSkinPickerOpen = false"
                >
                  ✕
                </button>
              </div>
              <div class="hud-skin-grid">
                <button
                  v-for="skin in playerSkins"
                  :key="skin.id"
                  class="hud-skin-card"
                  :class="{
                    'hud-skin-card--active': activePlayerSkinId === skin.id,
                  }"
                  :style="{ '--skin-accent': skin.accentColor }"
                  @click="selectPlayerSkin(skin.id)"
                >
                  <div class="hud-skin-card-img-wrap">
                    <img
                      :src="skin.url"
                      :alt="skin.name"
                      class="hud-skin-card-img"
                    />
                  </div>
                  <div class="hud-skin-card-meta">
                    <strong>{{ skin.name }}</strong>
                    <small>{{ skin.description }}</small>
                  </div>
                </button>
              </div>
            </div>
          </transition>
        </div>

        <button
          v-if="!isOnlineMultiplayerMatch"
          class="hud-action-btn"
          title="Selecionar o Modo de Jogo"
          @click="openGameModeModal"
        >
          ⚙️ Modo
        </button>

        <button
          v-if="!isOnlineMultiplayerMatch"
          class="hud-action-btn"
          title="Nova Partida com Nova Seed (Tecla R)"
          @click="restartMatch(true)"
        >
          🎲 Reiniciar
        </button>

        <button
          class="hud-action-btn"
          title="Voltar ao Menu Principal"
          @click="returnToMainMenu"
        >
          🏠 Menu
        </button>

        <button
          class="hud-action-btn hud-dev-btn"
          :class="{ 'hud-dev-btn--active': isDevModeOpen }"
          @click="toggleDevMode()"
        >
          {{ isDevModeOpen ? '⏸️ Dev (Pausado)' : '🛠️ Modo Desenvolvedor' }}
        </button>
      </div>

      <!-- 3-SECOND GOAL COUNTDOWN CLIMAX OVERLAY (STATE A: GOAL_COUNTDOWN) -->
      <template
        v-if="
          snapshot.state === 'GOAL_COUNTDOWN' && snapshot.goalCountdownMs !== null
        "
      >
        <div class="goal-countdown-banner">
          <div class="goal-countdown-label">
            🏁 TESTE DE EQUILÍBRIO NA LINHA DE CHEGADA!
          </div>
          <div class="goal-countdown-sub">
            Peça ativa guardada em espera • Segure por
            <strong>{{ (snapshot.goalCountdownMs / 1000).toFixed(1) }}s</strong>
          </div>
        </div>

        <div class="center-countdown-overlay">
          <div class="tricky-title-banner">
            {{ Math.max(1, Math.ceil(snapshot.goalCountdownMs / 1000)) }}
          </div>
        </div>
      </template>

      <!-- CASTLE ROOF DROP CLIMAX BANNER (STATE C: ROOF_DROP) -->
      <div
        v-if="snapshot.state === 'ROOF_DROP'"
        class="goal-countdown-banner goal-countdown-banner--roof"
      >
        <div class="goal-countdown-label">
          🏰 A PEÇA FINAL: TELHADO DE CASTELO!
        </div>
        <div class="goal-countdown-sub">
          Use <kbd>←</kbd> <kbd>→</kbd> e <kbd>↓</kbd> (Rotação travada) • Encoste
          no topo para Soldar &amp; Vencer!
        </div>
      </div>

      <!-- RESPAWN PENALTY OVERLAY (1.5s) -->
      <div
        v-if="snapshot.state === 'RESPAWN_DELAY'"
        class="penalty-overlay"
      >
        <div
          class="penalty-box"
          :class="{
            'penalty-box--survival': snapshot.gameMode === 'SURVIVAL',
            'penalty-box--flash': (snapshot.fallFlashRemainingMs || 0) > 0,
          }"
        >
          <div class="penalty-title">
            {{
              snapshot.gameMode === 'SURVIVAL'
                ? `💔 PERDEU 1 VIDA! (${snapshot.lives}/${snapshot.maxLives})`
                : '⚠️ CAIU NA ÁGUA!'
            }}
          </div>
          <div
            v-if="
              snapshot.gameMode === 'SURVIVAL' &&
              (snapshot.invulnerableRemainingMs || 0) > 0
            "
            class="penalty-shield-pill"
          >
            🛡️ INVULNERÁVEL POR
            <strong>
              {{ ((snapshot.invulnerableRemainingMs || 0) / 1000).toFixed(1) }}s
            </strong>
            (ESTABILIZE SUA TORRE!)
          </div>
          <div class="penalty-sub">
            Respawn em
            <strong>
              {{ (snapshot.respawnDelayRemainingMs / 1000).toFixed(1) }}s
            </strong>
          </div>
        </div>
      </div>

      <!-- INITIAL 3, 2, 1, GO! COUNTDOWN OVERLAY -->
      <div
        v-if="snapshot.state === 'COUNTDOWN'"
        class="center-countdown-overlay"
      >
        <div class="tricky-title-banner">
          {{
            Math.ceil(snapshot.countdownRemainingMs / 1000) > 0
              ? Math.ceil(snapshot.countdownRemainingMs / 1000)
              : 'GO!'
          }}
        </div>
      </div>

      <!-- SURVIVAL ELIMINATED SPECTATOR BANNER IN ONLINE MULTIPLAYER -->
      <div
        v-if="
          snapshot.state === 'GAME_OVER' &&
          isOnlineMultiplayerMatch &&
          multiplayerClient.state.gameOverResult === null
        "
        class="goal-countdown-banner goal-countdown-banner--eliminated"
      >
        <div class="goal-countdown-label">
          💀 VOCÊ PERDEU AS 3 VIDAS E FOI ELIMINADO!
        </div>
        <div class="goal-countdown-sub">
          Assistindo os sobreviventes até o fim da partida...
        </div>
      </div>

      <!-- SURVIVAL SINGLE-PLAYER GAME OVER OVERLAY -->
      <div
        v-if="
          snapshot.state === 'GAME_OVER' &&
          !isOnlineMultiplayerMatch &&
          multiplayerClient.state.gameOverResult === null
        "
        class="winner-screen-overlay winner-screen-overlay--gameover"
      >
        <div class="tricky-winner-text tricky-winner-text--gameover">
          FIM DE JOGO!
        </div>
        <div class="winner-subcard winner-subcard--gameover">
          <div class="survival-gameover-badge">
            💔 SUAS 3 VIDAS ACABARAM!
          </div>

          <div class="survival-stats-grid">
            <div class="survival-stat-box">
              <span class="survival-stat-label">🧱 PEÇAS EMPILHADAS</span>
              <strong class="survival-stat-value mono">
                {{ snapshot.piecesPlaced }} / {{ snapshot.survivalGoalPieces }}
              </strong>
            </div>
            <div class="survival-stat-box">
              <span class="survival-stat-label">📏 ALTURA MÁXIMA</span>
              <strong class="survival-stat-value mono">
                {{ snapshot.maxTowerHeight.toFixed(1) }}m
              </strong>
            </div>
            <div class="survival-stat-box">
              <span class="survival-stat-label">⏱️ TEMPO SOBREVIVIDO</span>
              <strong class="survival-stat-value mono">
                {{ formattedTime }}
              </strong>
            </div>
          </div>

          <div class="winner-actions">
            <button
              class="btn btn-primary"
              @click="restartMatch(true)"
            >
              🔄 Tentar Novamente (R)
            </button>
            <button
              class="btn btn-secondary"
              @click="openGameModeModal"
            >
              ⚙️ Modo de Jogo
            </button>
            <button class="btn btn-secondary" @click="returnToMainMenu">
              🏠 Menu Principal
            </button>
          </div>
        </div>
      </div>

      <!-- TRICKY TOWERS STYLE "WINNER!" & 4-PLAYER PODIUM OVERLAY -->
      <div
        v-if="
          snapshot.state === 'VICTORY' ||
          multiplayerClient.state.gameOverResult !== null
        "
        class="winner-screen-overlay"
      >
        <div class="winner-sunburst" />
        <div class="tricky-winner-text">
          {{
            multiplayerClient.state.gameOverResult
              ? multiplayerClient.state.gameOverResult.isCupFinished === false
                ? `RODADA ${multiplayerClient.state.gameOverResult.roundNumber || 1}: ${multiplayerClient.state.gameOverResult.roundWinnerNick || multiplayerClient.state.gameOverResult.winnerCustomNick}!`
                : `🏆 ${multiplayerClient.state.gameOverResult.winnerCustomNick} VENCEU A COPA!`
              : snapshot.gameMode === 'SURVIVAL'
                ? 'SOBREVIVEU!'
                : 'WINNER!'
          }}
        </div>
        <div class="winner-subcard winner-subcard--cup">
          <!-- Cabeçalho da Copa Multiplayer e Regras da Cartela -->
          <div
            v-if="multiplayerClient.state.gameOverResult"
            class="mp-cup-banner"
          >
            <div class="mp-cup-banner-top">
              <span class="mp-cup-banner-title">
                {{
                  multiplayerClient.state.gameOverResult.victoryCondition ===
                  'SINGLE_WIN'
                    ? '🥇 COPA 1 VITÓRIA'
                    : multiplayerClient.state.gameOverResult
                          .victoryCondition === 'CUP_12'
                      ? '👑 COPA 12 PONTOS'
                      : '🏆 COPA 6 PONTOS'
                }}
                • RODADA {{ multiplayerClient.state.gameOverResult.roundNumber || 1 }}
              </span>
              <span
                class="mp-cup-banner-status"
                :class="{
                  'mp-cup-banner-status--done':
                    multiplayerClient.state.gameOverResult.isCupFinished !==
                    false,
                }"
              >
                {{
                  multiplayerClient.state.gameOverResult.isCupFinished === false
                    ? `EM DISPUTA (META: ${multiplayerClient.state.gameOverResult.cupTargetPoints || 6} ÁREAS)`
                    : '🏆 COPA FINALIZADA!'
                }}
              </span>
            </div>
            <div class="mp-cup-banner-rules">
              <span>🥇 1º = +3 pts</span>
              <span>🥈 2º = +2 pts</span>
              <span>🥉 3º = +1 pt</span>
              <span>4º = +0 pts</span>
            </div>
          </div>

          <!-- Pódio Multiplayer Online com CARTELA DE PONTOS (até 4 jogadores) -->
          <div
            v-if="multiplayerClient.state.gameOverResult"
            class="mp-podium-list"
          >
            <div
              v-for="entry in multiplayerClient.state.gameOverResult.podium"
              :key="entry.handle || entry.userId"
              class="mp-podium-row mp-podium-row--with-cartela"
              :class="[
                `mp-podium-row--rank-${entry.rank}`,
                { 'mp-podium-row--cup-champion': entry.isCupWinner },
              ]"
            >
              <div class="mp-podium-row-main">
                <span class="mp-podium-rank">{{ entry.rank }}º</span>
                <img
                  :src="getFriendSkinSpriteUrl(entry.equippedSkin)"
                  :alt="entry.customNick"
                  class="mp-podium-skin"
                />
                <div class="mp-podium-identity">
                  <strong>
                    {{ entry.customNick }}
                    <span
                      v-if="entry.isCupWinner"
                      class="mp-podium-cup-crown"
                      title="Campeão da Copa!"
                    >
                      👑 CAMPEÃO
                    </span>
                  </strong>
                  <small>
                    {{ entry.handle }} • {{ entry.towerHeight.toFixed(1) }}m
                    <template
                      v-if="
                        multiplayerClient.state.gameOverResult.gameMode ===
                          'SURVIVAL' || snapshot.gameMode === 'SURVIVAL'
                      "
                    >
                      •
                      {{
                        entry.lives > 0
                          ? '❤️'.repeat(Math.min(3, entry.lives))
                          : '💀 Eliminado'
                      }}
                    </template>
                  </small>
                </div>

                <!-- Pontos Ganhos na Rodada (+3, +2, +1, +0) -->
                <span
                  class="mp-podium-round-pts"
                  :class="`mp-podium-round-pts--rank-${entry.rank}`"
                >
                  +{{
                    entry.pointsEarned ??
                    (entry.rank === 1
                      ? 3
                      : entry.rank === 2
                        ? 2
                        : entry.rank === 3
                          ? 1
                          : 0)
                  }}
                  {{
                    (entry.pointsEarned ??
                      (entry.rank === 1
                        ? 3
                        : entry.rank === 2
                          ? 2
                          : entry.rank === 3
                            ? 1
                            : 0)) === 1
                      ? 'PT'
                      : 'PTS'
                  }}
                </span>
              </div>

              <!-- CARTELA DE PONTOS DO JOGADOR (CADA PONTO PREENCHE UMA ÁREA) -->
              <div class="mp-podium-cartela-wrap">
                <div
                  class="mp-podium-cartela-grid"
                  :class="`mp-podium-cartela-grid--${entry.cupTargetPoints || multiplayerClient.state.gameOverResult.cupTargetPoints || 6}`"
                >
                  <span
                    v-for="cellIdx in entry.cupTargetPoints ||
                    multiplayerClient.state.gameOverResult.cupTargetPoints ||
                    6"
                    :key="cellIdx"
                    class="mp-podium-cartela-cell"
                    :class="{
                      'mp-podium-cartela-cell--filled':
                        cellIdx <= (entry.previousCupPoints ?? 0),
                      'mp-podium-cartela-cell--earned-now':
                        cellIdx > (entry.previousCupPoints ?? 0) &&
                        cellIdx <= (entry.cupPoints ?? entry.pointsEarned ?? 0),
                    }"
                  >
                    <span class="mp-podium-cartela-cell-num">{{ cellIdx }}</span>
                  </span>
                </div>
                <span class="mp-podium-cartela-total mono">
                  {{ entry.cupPoints ?? entry.pointsEarned ?? 0 }}/{{
                    entry.cupTargetPoints ||
                    multiplayerClient.state.gameOverResult.cupTargetPoints ||
                    6
                  }}
                </span>
              </div>
            </div>
          </div>

          <div
            v-else-if="snapshot.gameMode === 'SURVIVAL'"
            class="survival-stats-grid"
          >
            <div class="survival-stat-box">
              <span class="survival-stat-label">❤️ VIDAS RESTANTES</span>
              <strong class="survival-stat-value">
                {{ '❤️'.repeat(Math.max(0, snapshot.lives)) }} ({{ snapshot.lives }}/3)
              </strong>
            </div>
            <div class="survival-stat-box">
              <span class="survival-stat-label">🧱 PEÇAS EMPILHADAS</span>
              <strong class="survival-stat-value mono">
                {{ snapshot.piecesPlaced }}
              </strong>
            </div>
            <div class="survival-stat-box">
              <span class="survival-stat-label">📏 ALTURA MÁXIMA</span>
              <strong class="survival-stat-value mono">
                {{ snapshot.maxTowerHeight.toFixed(1) }}m
              </strong>
            </div>
          </div>

          <p class="winner-time">
            Tempo da Partida: <strong>{{ formattedTime }}</strong>
          </p>
          <div class="winner-actions">
            <template
              v-if="
                isOnlineMultiplayerMatch ||
                multiplayerClient.state.gameOverResult
              "
            >
              <button
                v-if="
                  multiplayerClient.state.gameOverResult &&
                  multiplayerClient.state.gameOverResult.isCupFinished === false
                "
                class="btn btn-primary"
                @click="handleNextCupRound"
              >
                ⏭️ PRÓXIMA RODADA DA COPA (RODADA
                {{ (multiplayerClient.state.gameOverResult.roundNumber || 1) + 1 }})
              </button>
              <button
                class="btn"
                :class="
                  multiplayerClient.state.gameOverResult &&
                  multiplayerClient.state.gameOverResult.isCupFinished === false
                    ? 'btn-secondary'
                    : 'btn-primary'
                "
                @click="handleReturnToLobbyFromMatch"
              >
                🎉 VOLTAR PARA A SALA
              </button>
            </template>
            <button
              v-else
              class="btn btn-primary"
              @click="restartMatch(true)"
            >
              🎲 Nova Partida
            </button>
            <button
              v-if="!isOnlineMultiplayerMatch"
              class="btn btn-secondary"
              @click="openGameModeModal"
            >
              ⚙️ Modo de Jogo
            </button>
            <button class="btn btn-secondary" @click="returnToMainMenu">
              🏠 Menu Principal
            </button>
          </div>
        </div>
      </div>
    </template>

    <!-- DEVELOPER MODE SLIDE-OVER DRAWER (HIDDEN BY DEFAULT) -->
    <transition name="slide-drawer">
      <aside v-if="isDevModeOpen" class="dev-drawer">
        <div class="dev-drawer-header">
          <div>
            <h2>🛠️ Modo Desenvolvedor <span class="dev-pause-tag">⏸️ Jogo Pausado</span></h2>
            <p>Ferramentas de Física, Placeholders, Catálogo e Rede</p>
          </div>
          <button class="btn-close-dev" @click="toggleDevMode(false)">
            ▶ Retomar (F2)
          </button>
        </div>

        <!-- SEED & DEBUG BAR -->
        <div class="dev-seed-bar">
          <div class="dev-seed-row">
            <label>Seed (7-Bag):</label>
            <input
              v-model="seedInput"
              class="seed-input"
              type="text"
              maxlength="16"
              @keydown.enter="restartMatch(false)"
            />
            <button class="btn btn-xs btn-secondary" @click="restartMatch(false)">
              Aplicar Seed
            </button>
            <button class="btn btn-xs btn-primary" @click="restartMatch(true)">
              🎲 Nova Seed
            </button>
          </div>

          <div class="dev-quick-toggles">
            <button
              class="btn btn-xs"
              :class="showColliders ? 'btn-primary' : 'btn-special-giant'"
              @click="toggleColliders"
            >
              🎯 Colisão: {{ showColliders ? 'ATIVADA (Ver Hitboxes)' : 'DESATIVADA' }}
            </button>
            <button
              class="btn btn-xs"
              :class="showGhostPiece ? 'btn-primary' : 'btn-secondary'"
              @click="toggleGhostPiece"
            >
              👻 Sombra de Encaixe: {{ showGhostPiece ? 'ATIVADA' : 'DESATIVADA' }}
            </button>
            <button
              class="btn btn-xs"
              :class="windEnabled ? 'btn-primary' : 'btn-secondary'"
              @click="toggleWind"
            >
              💨 Vento: {{ windEnabled ? 'ATIVADO (15m+)' : 'REMOVIDO' }}
            </button>
            <button
              class="btn btn-xs"
              :class="forcePlaceholders ? 'btn-primary' : 'btn-secondary'"
              @click="togglePlaceholderMode"
            >
              {{
                forcePlaceholders
                  ? 'Modo: Placeholders Sólidos'
                  : 'Modo: Sprites Ativos'
              }}
            </button>
            <button
              class="btn btn-xs"
              :class="dynamicTintEnabled ? 'btn-primary' : 'btn-secondary'"
              @click="toggleDynamicTint"
            >
              🎨 Colorir Cinza:
              {{ dynamicTintEnabled ? 'ATIVO (3-Tons)' : 'CINZA ORIGINAL' }}
            </button>
            <button
              class="btn btn-xs"
              :class="snapshot.isSinglePlayer ? 'btn-primary' : 'btn-special-giant'"
              @click="toggleSinglePlayerMode"
            >
              ⚡ Sorteio Checkpoints:
              {{
                snapshot.isSinglePlayer
                  ? 'MVP SINGLE-PLAYER (Só Positivos)'
                  : 'MULTIPLAYER (Positivo + Negativo)'
              }}
            </button>
          </div>

          <!-- PLAYER SKIN SELECTOR (assets/sprites/player) -->
          <div v-if="playerSkins.length > 0" class="slide-regulator-box">
            <div class="slide-regulator-header">
              <span>🎭 Variações de Skin do Personagem (<code>assets/sprites/player</code>):</span>
              <strong>{{ activePlayerSkin ? activePlayerSkin.name : activePlayerSkinId }}</strong>
            </div>
            <div class="dev-skin-cards-grid">
              <button
                v-for="skin in playerSkins"
                :key="skin.id"
                class="dev-skin-card"
                :class="{
                  'dev-skin-card--active': activePlayerSkinId === skin.id,
                }"
                :style="{ '--skin-accent': skin.accentColor }"
                @click="selectPlayerSkin(skin.id)"
              >
                <img
                  :src="skin.url"
                  :alt="skin.name"
                  class="dev-skin-card-thumb"
                />
                <div class="dev-skin-card-info">
                  <strong>{{ skin.name }}</strong>
                  <small>{{ skin.description }}</small>
                  <code>{{ skin.fileName }}</code>
                </div>
              </button>
            </div>
          </div>

          <!-- MODULAR 8-COLUMN BASE TERRAIN SELECTOR -->
          <div class="slide-regulator-box">
            <div class="slide-regulator-header">
              <span>🏠 Base Modular (8 Colunas — <code>base.png</code>):</span>
              <strong>
                {{ snapshot.basePresetName }}
                <code>[{{ snapshot.baseElevations.join(', ') }}]</code>
              </strong>
            </div>
            <div class="slide-presets-row" style="flex-wrap: wrap">
              <button
                class="btn btn-xs"
                :class="
                  forcedBasePresetId === null ? 'btn-primary' : 'btn-secondary'
                "
                title="Sorteia automaticamente a base a partir da Seed da partida"
                @click="selectBasePreset(null)"
              >
                🎲 Sorteio pela Seed
              </button>
              <button
                v-for="preset in BASE_TERRAIN_CATALOG"
                :key="preset.id"
                class="btn btn-xs"
                :class="
                  snapshot.basePresetId === preset.id &&
                  forcedBasePresetId === preset.id
                    ? 'btn-primary'
                    : 'btn-secondary'
                "
                :title="`[${preset.elevations.join(', ')}] — ${preset.description}`"
                @click="selectBasePreset(preset.id)"
              >
                {{ preset.name }}
              </button>
            </div>
          </div>

          <!-- SLIDE / GRIP REGULATOR -->
          <div class="slide-regulator-box">
            <div class="slide-regulator-header">
              <span>🧊 Nível de Deslize das Peças:</span>
              <strong>{{ slideLevel }}% ({{ slideLevelDescription }})</strong>
            </div>
            <div class="slide-slider-row">
              <span class="slide-end-label">🔒 0%</span>
              <input
                type="range"
                min="0"
                max="100"
                step="5"
                :value="slideLevel"
                class="slide-range-input"
                @input="updateSlideLevel(Number(($event.target as HTMLInputElement).value))"
              />
              <span class="slide-end-label">🧊 100%</span>
            </div>
            <div class="slide-presets-row">
              <button
                class="btn btn-xs"
                :class="slideLevel === 15 ? 'btn-primary' : 'btn-secondary'"
                @click="updateSlideLevel(15)"
              >
                🔒 Firme (15%)
              </button>
              <button
                class="btn btn-xs"
                :class="slideLevel === 50 ? 'btn-primary' : 'btn-secondary'"
                @click="updateSlideLevel(50)"
              >
                ⚖️ Equilibrado (50%)
              </button>
              <button
                class="btn btn-xs"
                :class="slideLevel === 85 ? 'btn-primary' : 'btn-secondary'"
                @click="updateSlideLevel(85)"
              >
                🧊 Escorregadio (85%)
              </button>
            </div>
          </div>

          <div v-if="showColliders" class="collider-legend">
            <span>🟩 Hitbox Torre</span>
            <span>🟨 Hitbox Ativa</span>
            <span>🔴 Ponto de Contato</span>
            <span>➕ Centro de Massa</span>
          </div>
        </div>

        <!-- DEVELOPER TABS -->
        <div class="tabs-header">
          <button
            class="tab-btn"
            :class="{ active: activeTab === 'sprites' }"
            @click="activeTab = 'sprites'"
          >
            🎨 Sprites ({{ spriteSlots.length }})
          </button>
          <button
            class="tab-btn"
            :class="{ active: activeTab === 'catalog' }"
            @click="activeTab = 'catalog'"
          >
            ⚡ Poderes & Peças
          </button>
          <button
            class="tab-btn"
            :class="{ active: activeTab === 'controls' }"
            @click="activeTab = 'controls'"
          >
            🎮 Controles & Régua
          </button>
          <button
            class="tab-btn"
            :class="{ active: activeTab === 'network' }"
            @click="activeTab = 'network'"
          >
            🌐 JSON 100ms
          </button>
        </div>

        <!-- TAB 1: SPRITE REGISTRY & PLACEHOLDERS -->
        <div v-if="activeTab === 'sprites'" class="tab-body">
          <div class="tab-intro">
            <strong>Sprites Carregados, Máscaras de Colisão & Colorização</strong>
            <p>
              Os blocos cinza em <code>assets/sprites/block</code> são
              coloridos dinamicamente em 3 tons (Borda, Cor Base e Brilho) e
              alinhados às máscaras <code>*_colision.png</code>.
            </p>
          </div>

          <div class="sprite-slots-list">
            <div
              v-for="slot in spriteSlots"
              :key="slot.key"
              class="sprite-slot-card"
            >
              <div class="slot-swatch-col">
                <div
                  class="color-swatch"
                  :style="{
                    backgroundColor: slot.placeholder.fill,
                    borderColor: slot.placeholder.border,
                  }"
                />
              </div>
              <div class="slot-info-col">
                <div class="slot-title">{{ slot.name }}</div>
                <div class="slot-meta">
                  <code>{{ slot.key }}</code> • {{ slot.expectedSizeDescription }}
                </div>
                <div class="slot-status">
                  <span class="color-tag">
                    {{ slot.placeholder.label }} ({{ slot.placeholder.fill }})
                  </span>
                  <span v-if="slot.loaded" class="loaded-tag">
                    ✓ Sprite Ativo
                  </span>
                  <span
                    v-if="slot.key.startsWith('piece_') && slot.loaded"
                    class="loaded-tag"
                  >
                    {{
                      slot.hasCollisionMask
                        ? '🎯 Máscara _colision'
                        : '🎯 Colisão Total'
                    }}
                  </span>
                </div>
              </div>
              <div class="slot-action-col">
                <label class="upload-btn" title="Importar sprite de teste">
                  📂 Sprite
                  <input
                    type="file"
                    accept="image/*"
                    hidden
                    @change="onUploadTestSprite(slot.key, $event)"
                  />
                </label>
                <button
                  v-if="slot.loaded"
                  class="btn-clear-sprite"
                  @click="clearSlotSprite(slot.key)"
                >
                  ✕
                </button>
              </div>
            </div>
          </div>
        </div>

        <!-- TAB 2: POWERS SYSTEM & PIECE CATALOG -->
        <div v-else-if="activeTab === 'catalog'" class="tab-body">
          <!-- FINISH LINE CLIMAX STATE MACHINE TESTER (GOAL_COUNTDOWN / ABORT / CASTLE_ROOF) -->
          <div class="tab-intro">
            <strong>🏁 Clímax da Linha de Chegada (30m) &amp; Telhado de Castelo (<code>CASTLE_ROOF</code>)</strong>
            <p>
              Teste o fluxo completo de estados do clímax sem precisar subir até
              <code>30m</code>: congela e guarda a peça ativa
              (<code>heldActivePiece</code>) com fumaça mágica e zoom de câmera,
              executa os 3s de equilíbrio ou solta direto o Telhado 3×3!
            </p>
            <div class="special-buttons-row">
              <button
                class="btn btn-xs btn-primary"
                @click="triggerDevGoalCountdown"
              >
                ⏱️ Iniciar Contagem 3s (Hold Peça)
              </button>
              <button
                class="btn btn-xs btn-special-giant"
                @click="triggerDevAbortCountdown"
              >
                ❌ Simular Queda / Bzzzt! (Abortar)
              </button>
              <button
                class="btn btn-xs btn-special-rubber"
                @click="triggerDevRoofDrop"
              >
                🏰 Dropar Telhado de Castelo (3×3)
              </button>
            </div>
          </div>

          <!-- POSITIVE POWERS (ORDER / SELF-HELP) -->
          <div class="tab-intro">
            <strong>✨ Poderes Positivos (Ordem / Auto-Ajuda — Ativos no Solo & Multi)</strong>
            <p>
              Sorteados ao estabilizar uma peça por <code>0,5s</code> cruzando
              as linhas de Checkpoint (<code>8m, 16m, 24m</code>):
            </p>
            <div class="dev-powers-grid">
              <div
                v-for="p in positivePowersList"
                :key="p.id"
                class="dev-power-card dev-power-card--positive"
              >
                <div class="dev-power-head">
                  <span class="dev-power-title">{{ p.icon }} {{ p.name }}</span>
                  <span class="dev-power-weight">Peso {{ p.weight }}%</span>
                </div>
                <div class="dev-power-desc">{{ p.shortDescription }}</div>
                <div class="dev-power-actions">
                  <button
                    class="btn btn-xs btn-primary"
                    @click="triggerDevPower(p.id)"
                  >
                    ⚡ Ativar Agora
                  </button>
                  <button
                    class="btn btn-xs btn-secondary"
                    @click="grantDevSlotPower(p.id)"
                  >
                    📥 Guardar no Slot
                  </button>
                </div>
              </div>
            </div>
          </div>

          <!-- NEGATIVE POWERS (CHAOS / ATTACK) -->
          <div class="tab-intro">
            <strong>🔥 Poderes Negativos (Ataque / Caos — Aplicados nos Inimigos)</strong>
            <p>
              Durante a partida, os efeitos negativos são disparados
              <strong>apenas contra os inimigos</strong> (Tecla <code>C</code> ou
              <code>B</code>). Abaixo você pode aplicá-los em si mesmo
              exclusivamente pelo Modo Desenvolvedor para testar os efeitos:
            </p>
            <div class="dev-powers-grid">
              <div
                v-for="p in negativePowersList"
                :key="p.id"
                class="dev-power-card dev-power-card--negative"
              >
                <div class="dev-power-head">
                  <span class="dev-power-title">{{ p.icon }} {{ p.name }}</span>
                  <span class="dev-power-weight">Peso {{ p.weight }}%</span>
                </div>
                <div class="dev-power-desc">{{ p.shortDescription }}</div>
                <div class="dev-power-actions">
                  <button
                    class="btn btn-xs btn-special-giant"
                    @click="triggerDevPower(p.id)"
                  >
                    💥 Aplicar em Si (Dev)
                  </button>
                  <button
                    class="btn btn-xs btn-secondary"
                    @click="grantDevSlotPower(p.id)"
                  >
                    📥 Slot Ataque
                  </button>
                </div>
              </div>
            </div>
          </div>

          <div class="tab-intro">
            <strong>Injetor de Peças na Fila</strong>
            <p>
              Adicione qualquer peça ou variante especial no topo da fila:
            </p>
            <div class="special-buttons-row">
              <button
                class="btn btn-xs btn-special-giant"
                @click="injectCatalogPiece('T', 'GIANT')"
              >
                + Mega-Bloco 2x (Massa 16)
              </button>
              <button
                class="btn btn-xs btn-special-rubber"
                @click="injectCatalogPiece('I', 'HEAVY_RUBBER')"
              >
                + Borracha "I" (Massa 10 | μ=2.0)
              </button>
              <button
                class="btn btn-xs btn-special-rubber"
                @click="injectCatalogPiece('O', 'HEAVY_RUBBER')"
              >
                + Borracha "O" (Massa 10 | μ=2.0)
              </button>
            </div>
          </div>

          <div class="catalog-list">
            <div
              v-for="type in ALL_PIECE_TYPES"
              :key="type"
              class="catalog-item-card"
            >
              <div class="catalog-preview-box">
                <PiecePreviewCanvas :type="type" variant="NORMAL" :size="64" />
                <div class="catalog-spawn-btns">
                  <button
                    class="btn btn-xs btn-secondary"
                    @click="injectCatalogPiece(type, 'NORMAL')"
                  >
                    +1x
                  </button>
                  <button
                    class="btn btn-xs btn-special-giant"
                    @click="injectCatalogPiece(type, 'GIANT')"
                  >
                    +2x
                  </button>
                </div>
              </div>
              <div class="catalog-details">
                <div class="catalog-title">
                  {{ PIECE_CATALOG[type].name }} —
                  <span>{{ PIECE_CATALOG[type].subtitle }}</span>
                </div>
                <div class="catalog-com">
                  <strong>Centro de Massa:</strong>
                  {{ PIECE_CATALOG[type].centerOfMassDescription }}
                </div>
                <div class="catalog-role">
                  {{ PIECE_CATALOG[type].gameplayRole }}
                </div>
              </div>
            </div>
          </div>
        </div>

        <!-- TAB 3: CONTROLS & HEIGHT RULER -->
        <div v-else-if="activeTab === 'controls'" class="tab-body">
          <div class="tab-intro">
            <strong>Botões de Teste Manual & Telemetria da Torre</strong>
            <div class="touch-controls-bar" style="margin-top: 8px">
              <button
                class="btn btn-xs btn-special-giant"
                @click="towerInstance?.moveHorizontal(-1, true)"
              >
                🥊 Shift ◀
              </button>
              <button
                class="btn btn-xs btn-secondary"
                @click="towerInstance?.moveHorizontal(-1, false)"
              >
                ◁ -0.5u
              </button>
              <button
                class="btn btn-xs btn-secondary"
                @click="towerInstance?.rotateActivePiece(-1)"
              >
                ↺ -90°
              </button>
              <button
                class="btn btn-xs btn-secondary"
                @click="towerInstance?.rotateActivePiece(1)"
              >
                ↻ +90°
              </button>
              <button
                class="btn btn-xs btn-secondary"
                @click="towerInstance?.moveHorizontal(1, false)"
              >
                +0.5u ▷
              </button>
              <button
                class="btn btn-xs btn-special-giant"
                @click="towerInstance?.moveHorizontal(1, true)"
              >
                Shift ▶ 🥊
              </button>
            </div>
          </div>

          <div class="Snap-summary">
            <div class="mini-stat">
              <span>Progresso até 30m:</span>
              <strong>{{ heightProgressPercent.toFixed(0) }}%</strong>
            </div>
            <div class="mini-stat">
              <span>Checkpoints Consumidos (8m/16m/24m):</span>
              <strong>
                {{
                  snapshot.checkpointsReached.length > 0
                    ? snapshot.checkpointsReached.map((m) => `${m}m`).join(', ')
                    : 'Nenhum'
                }}
              </strong>
            </div>
            <div class="mini-stat">
              <span>Blocos Estacionados na Torre:</span>
              <strong>{{ snapshot.settledBlocks.length }}</strong>
            </div>
            <div class="mini-stat">
              <span>Blocos com Snap de Pinos (μ=1.2):</span>
              <strong class="text-green">{{ snappedBlocksCount }}</strong>
            </div>
            <div class="mini-stat">
              <span>Blocos Adormecidos (Sleep):</span>
              <strong class="text-blue">{{ sleepingBlocksCount }}</strong>
            </div>
          </div>

          <ul class="controls-list">
            <li>
              <span><kbd>Espaço</kbd></span>
              <span>Ativar Poder Positivo (Ordem) do Slot Único</span>
            </li>
            <li>
              <span><kbd>C</kbd> ou <kbd>B</kbd></span>
              <span>Disparar Poder Negativo (Caos — Modo Multiplayer)</span>
            </li>
            <li>
              <span><kbd>←</kbd> <kbd>→</kbd> ou <kbd>A</kbd> <kbd>D</kbd></span>
              <span>Mover 0.5 bloco (Meio Bloco)</span>
            </li>
            <li>
              <span><kbd>Shift</kbd> + <kbd>←/→</kbd></span>
              <span>"Socão" (encostado &lt;2px) ou Passo 1.0u</span>
            </li>
            <li>
              <span><kbd>↑</kbd> / <kbd>W</kbd> / <kbd>E</kbd></span>
              <span>Girar 90° Horário (c/ Wall Kick)</span>
            </li>
            <li>
              <span><kbd>Z</kbd> / <kbd>Q</kbd></span>
              <span>Girar 90° Anti-Horário</span>
            </li>
            <li>
              <span><kbd>↓</kbd> / <kbd>S</kbd></span>
              <span>Soft Drop 3x (Momento $p = m \cdot v$)</span>
            </li>
            <li>
              <span><kbd>F2</kbd> ou <kbd>`</kbd></span>
              <span>Alternar Modo Desenvolvedor</span>
            </li>
          </ul>
        </div>

        <!-- TAB 4: 100ms NETWORK SNAPSHOT -->
        <div v-else class="tab-body">
          <div class="tab-intro">
            <strong>State Snapshot (100ms JSON)</strong>
            <p>
              Pacote JSON exportado a cada <code>100ms</code> pela
              <code>TowerInstance</code> pronto para sincronização Multiplayer
              via WebSocket:
            </p>
          </div>
          <pre class="snapshot-json">{{ formattedSnapshotJson }}</pre>
        </div>
      </aside>
    </transition>
  </div>
</template>
