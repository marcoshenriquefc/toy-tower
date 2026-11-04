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
  PUZZLE_BASE_TERRAIN_CATALOG,
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
import {
  formatKeyCodeLabel,
  KeybindActionId,
  optionsStore,
  playToySfx,
} from './services/optionsStore'

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
const showGhostPiece = ref<boolean>(optionsStore.state.showGhostPiece)
const windEnabled = ref<boolean>(optionsStore.state.windEnabled)
const slideLevel = ref<number>(50)
const forcePlaceholders = ref<boolean>(spriteRegistry.forcePlaceholders)
const dynamicTintEnabled = ref<boolean>(optionsStore.state.dynamicTintEnabled)
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
  | 'OPTIONS_SCREEN'
  | 'IN_GAME'
const screenFlow = ref<ScreenFlowState>('TITLE_SCREEN')
const selectedMenuCard = ref<'LOCAL' | 'MULTIPLAYER' | 'OPTIONS'>('LOCAL')
const isOptionsModalOpen = ref<boolean>(false)
const optionsActiveTab = ref<'AUDIO' | 'CONTROLS' | 'GRAPHICS' | 'ACCOUNT'>(
  'AUDIO'
)
const listeningKeybindAction = ref<KeybindActionId | null>(null)
const isFullscreen = ref<boolean>(
  Boolean(typeof document !== 'undefined' && document.fullscreenElement)
)
const optionsNickInput = ref<string>('')
const liveFps = ref<number>(60)
let fpsFrameCount = 0
let fpsAccumMs = 0

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

function normalizePlayerHandle(raw?: string | null): string {
  const cleaned = (raw || '').trim().toLowerCase()
  if (!cleaned) return ''
  return cleaned.startsWith('@') ? cleaned : `@${cleaned}`
}

const lobbySlots = computed<LobbySlotInfo[]>(() => {
  const room = multiplayerClient.state.room
  if (!room) {
    return fallbackLobbySlots.value
  }
  const myHandle = normalizePlayerHandle(authStore.state.user?.handle)
  const mapped = [0, 1, 2, 3].map((idx) => {
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
      Boolean(myHandle) &&
      normalizePlayerHandle(slotPlayer.handle) === myHandle
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

  if (!mapped.some((s) => s.isLocalHost)) {
    const firstOccupied = mapped.find((s) => s.state !== 'EMPTY')
    if (firstOccupied) {
      firstOccupied.isLocalHost = true
    }
  }

  return mapped
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
    shortTitle: 'Modo Corrida (30m)',
    badge: 'CLÁSSICO • 30m',
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
    id: 'PUZZLE',
    title: 'MODO QUEBRA-CABEÇA',
    shortTitle: 'Modo Quebra-Cabeça (Abaixo do Laser - 9m)',
    badge: 'ABAIXO DO LASER • 9m',
    icon: '🧩',
    accentColor: '#F59E0B',
    description:
      'Compactação extrema e contrapeso! Encaixe o máximo de peças em ilhas estreitas sem deixar peças estabilizadas tocarem o laser de 9m.',
    rulesSummary: [
      '⚡ Laser em 9m: Peça estabilizada no laser queima após 3s e petrifica a torre',
      '🌊 Queda na Água (+0.5 Bloco): A ilha sobe 0.5 bloco em direção ao laser',
      '🧴 1 Super Cola única no início • Vence quem petrificar mais peças abaixo do laser!',
    ],
  },
  {
    id: 'SURVIVAL',
    title: 'MODO SOBREVIVÊNCIA',
    shortTitle: 'Modo Sobrevivência',
    badge: '3 VIDAS • 50 PEÇAS',
    icon: '❤️',
    accentColor: '#EF4444',
    description:
      'Você tem 50 peças e 3 Vidas (❤️❤️❤️). Coloque todas as 50 peças sem perder suas vidas! Quem terminar primeiro (ou for o último sobrevivente) vence!',
    rulesSummary: [
      '🧱 Meta de 50 Peças: Coloque todas as 50 peças primeiro mantendo suas vidas para vencer!',
      '❤️❤️❤️ 3 Vidas + 3s Invulnerável: Ao cair uma peça, seu mago pisca invulnerável por 3s',
      '🎈 Poder Vida Extra (Raro, máx. 3 ❤️): Só aparece com 2 vidas ou menos — pegue o balão com a peça controlada!',
    ],
  },
  {
    id: 'ENDLESS',
    title: 'MODO INFINITO / ABISMO',
    shortTitle: 'Modo Infinito / Abismo',
    badge: 'SCORE • ABISMO',
    icon: '🌌',
    accentColor: '#38BDF8',
    description:
      'Construa sem limite! A cada checkpoint validado por 1,5s a câmera e a linha de petrificação sobem +8m, transformando sua base em pedra. No Multiplayer, o Abismo sobe sem parar!',
    rulesSummary: [
      '🏔️ 3 Zonas Móveis: Linha de Petrificação + Zona Ativa + Bandeiras (+8m a cada 1,5s)',
      '🏆 SCORE vs PERSONAL BEST: +1 pt por peça estabilizada, -1 pt se cair no abismo',
      '🌋 Multiplayer Abismo Ascendente: Subida contínua (0,4 bl/s), sobrecarga aos 90s e desempate aos 150s!',
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
      'Não consegue decidir? O jogo sorteia automaticamente entre Corrida, Quebra-Cabeça, Sobrevivência e Infinito/Abismo no início da partida!',
    rulesSummary: [
      '🎲 Sorteia entre Corrida (30m), Quebra-Cabeça (9m), Sobrevivência e Infinito/Abismo',
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

const isRoomHostOrSolo = computed<boolean>(() => {
  const room = multiplayerClient.state.room
  if (!room) return true
  const occupiedCount = room.slots.filter((s) => Boolean(s && s.handle)).length
  if (occupiedCount <= 1) return true
  const myHandle = normalizePlayerHandle(authStore.state.user?.handle)
  const hostHandle = normalizePlayerHandle(room.hostHandle)
  return Boolean(myHandle && hostHandle && myHandle === hostHandle)
})

const hasAliveRemoteOpponents = computed<boolean>(() => {
  if (!isOnlineMultiplayerMatch.value) return false
  const remotes = Object.values(multiplayerClient.state.remoteLanes)
  if (remotes.length === 0) return false
  return remotes.some((r) => r.lives > 0 && !r.isEliminated)
})

const currentLobbySelectableMode = computed<SelectableGameMode>(() => {
  if (
    screenFlow.value === 'MULTIPLAYER_LOBBY' &&
    multiplayerClient.state.room?.selectedGameMode &&
    !isRoomHostOrSolo.value
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
    multiplayerClient.state.room?.victoryCondition &&
    !isRoomHostOrSolo.value
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

const showCupSelectionColumn = computed(
  () => screenFlow.value === 'MULTIPLAYER_LOBBY'
)

function openGameModeModal() {
  isBurgerMenuOpen.value = false
  if (!showCupSelectionColumn.value) {
    selectedModeScreenColumn.value = 'MODE'
  }
  isGameModeModalOpen.value = true
}

function closeGameModeModal() {
  isGameModeModalOpen.value = false
  if (
    screenFlow.value === 'MULTIPLAYER_LOBBY' &&
    multiplayerClient.state.room &&
    isRoomHostOrSolo.value
  ) {
    void multiplayerClient.setRoomGameMode(selectedGameMode.value)
    void multiplayerClient.setRoomVictoryCondition(
      selectedVictoryCondition.value
    )
  }
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

const selectedModeScreenColumn = ref<'MODE' | 'CUP'>('MODE')

function cycleGameModeOption(dir: -1 | 1) {
  selectedModeScreenColumn.value = 'MODE'
  const order: SelectableGameMode[] = [
    'RACE',
    'PUZZLE',
    'SURVIVAL',
    'ENDLESS',
    'RANDOM',
  ]
  const curIdx = order.indexOf(currentLobbySelectableMode.value)
  const nextIdx = (curIdx + dir + order.length) % order.length
  void selectGameModeOption(order[nextIdx])
}

function cycleVictoryConditionOption(dir: -1 | 1) {
  selectedModeScreenColumn.value = 'CUP'
  const order: VictoryCondition[] = ['SINGLE_WIN', 'CUP_6', 'CUP_12']
  const curIdx = order.indexOf(currentLobbyVictoryCondition.value)
  const nextIdx = (curIdx + dir + order.length) % order.length
  void selectVictoryConditionOption(order[nextIdx])
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
    resetLocalCupState()
    triggerBanner(
      `🏆 Condição de Vitória: ${chosen.icon} ${chosen.title}!`,
      'info'
    )
  }
}

interface GrandeCopaScoreboardRow {
  key: string
  slotIndex: number
  rank: number
  customNick: string
  handle: string
  avatarUrl: string
  skinSpriteId: string
  towerHeight: number
  lives: number
  eliminationOrder: number
  pointsEarned: number
  previousCupPoints: number
  cupPoints: number
  cupTargetPoints: number
  totalVisualSlots: number
  pointMedals: Array<1 | 2 | 3>
  isCupWinner: boolean
  isLocalPlayer: boolean
}

interface LocalCupParticipant {
  slotIndex: number
  isLocalPlayer: boolean
  customNick: string
  handle: string
  avatarUrl: string
  skinSpriteId: string
  rank: number
  towerHeight: number
  lives: number
  eliminationOrder: number
  pointsEarned: number
  previousCupPoints: number
  cupPoints: number
  pointMedals: Array<1 | 2 | 3>
  isCupWinner: boolean
}

const brokenAvatarByKey = ref<Record<string, boolean>>({})

function markAvatarBroken(key: string) {
  brokenAvatarByKey.value = {
    ...brokenAvatarByKey.value,
    [key]: true,
  }
}

function resolvePlayerAvatarUrl(
  handle: string,
  isLocalPlayer: boolean,
  explicitUrl?: string
): string {
  if (explicitUrl && explicitUrl.trim()) {
    return explicitUrl.trim()
  }
  if (isLocalPlayer && authStore.state.user?.avatarUrl) {
    return authStore.state.user.avatarUrl
  }
  const norm = normalizePlayerHandle(handle)
  if (norm) {
    if (
      normalizePlayerHandle(authStore.state.user?.handle) === norm &&
      authStore.state.user?.avatarUrl
    ) {
      return authStore.state.user.avatarUrl
    }
    const roomSlot = multiplayerClient.state.room?.slots.find(
      (s) => s && normalizePlayerHandle(s.handle) === norm && s.avatarUrl
    )
    if (roomSlot?.avatarUrl) return roomSlot.avatarUrl
    const matchPlayer = multiplayerClient.state.activeMatch?.players.find(
      (p) => normalizePlayerHandle(p.handle) === norm && p.avatarUrl
    )
    if (matchPlayer?.avatarUrl) return matchPlayer.avatarUrl
    const friend = authStore.state.user?.friends?.find(
      (f) => normalizePlayerHandle(f.handle) === norm && f.avatarUrl
    )
    if (friend?.avatarUrl) return friend.avatarUrl
  }
  return ''
}

const localCupState = ref<{
  roundNumber: number
  lastProcessedRound: number
  lastProcessedState: 'NONE' | 'GAME_OVER' | 'VICTORY'
  isCupFinished: boolean
  cupWinnerNick: string
  roundWinnerNick: string
  participants: LocalCupParticipant[]
}>({
  roundNumber: 1,
  lastProcessedRound: 0,
  lastProcessedState: 'NONE',
  isCupFinished: false,
  cupWinnerNick: '',
  roundWinnerNick: '',
  participants: [],
})

function buildInitialLocalParticipants(): LocalCupParticipant[] {
  const myNick =
    authStore.state.user?.customNick ||
    fallbackLobbySlots.value[0]?.customNick ||
    'Rick The Hank'
  const myHandle = authStore.state.user?.handle || '@voce'
  const myAvatar = authStore.state.user?.avatarUrl || ''
  const mySkin = activePlayerSkinId.value || 'player_mage'

  return [
    {
      slotIndex: 0,
      isLocalPlayer: true,
      customNick: myNick,
      handle: myHandle,
      avatarUrl: myAvatar,
      skinSpriteId: mySkin,
      rank: 1,
      towerHeight: 0,
      lives: 3,
      eliminationOrder: 0,
      pointsEarned: 0,
      previousCupPoints: 0,
      cupPoints: 0,
      pointMedals: [],
      isCupWinner: false,
    },
  ]
}

function resetLocalCupState() {
  localCupState.value = {
    roundNumber: 1,
    lastProcessedRound: 0,
    lastProcessedState: 'NONE',
    isCupFinished: false,
    cupWinnerNick: '',
    roundWinnerNick: '',
    participants: buildInitialLocalParticipants(),
  }
}

function recordLocalRoundResult(snap: TowerSnapshot) {
  if (
    isOnlineMultiplayerMatch.value &&
    Object.keys(multiplayerClient.state.remoteLanes).length > 0
  ) {
    return
  }

  const mpResult = multiplayerClient.state.gameOverResult
  const myHandleNorm = normalizePlayerHandle(authStore.state.user?.handle)
  const mpLocalWon = Boolean(
    mpResult?.podium?.some(
      (e) =>
        (e.isWinner || (e.rank === 1 && !e.isEliminated)) &&
        (!myHandleNorm ||
          normalizePlayerHandle(e.handle) === myHandleNorm ||
          (mpResult.podium?.length ?? 0) === 1)
    )
  )
  const playerWon = snap.state === 'VICTORY' || mpLocalWon
  const playerLost = snap.state === 'GAME_OVER' && !playerWon

  if (!playerWon && !playerLost && !mpResult) {
    return
  }

  if (localCupState.value.participants.length === 0) {
    resetLocalCupState()
  }

  const roundNum = localCupState.value.roundNumber
  const alreadyProcessedThisRound =
    localCupState.value.lastProcessedRound >= roundNum

  // Se já processou esta rodada, só permite reprocessar caso tenha sido registrada como derrota
  // antes da vitória (ex: telhado de castelo pousando ou teste de vitória no dev mode)
  if (
    alreadyProcessedThisRound &&
    (!playerWon || localCupState.value.lastProcessedState === 'VICTORY')
  ) {
    return
  }

  const targetPts = currentLobbyVictoryInfo.value.targetPoints || 6
  const myNick =
    authStore.state.user?.customNick ||
    fallbackLobbySlots.value[0]?.customNick ||
    'Rick The Hank'
  const myHandle = authStore.state.user?.handle || '@voce'
  const myAvatar = authStore.state.user?.avatarUrl || ''
  const mySkin = activePlayerSkinId.value || 'player_mage'

  for (const p of localCupState.value.participants) {
    const basePrevPts = alreadyProcessedThisRound
      ? p.previousCupPoints
      : p.cupPoints
    if (p.isLocalPlayer) {
      p.customNick = myNick
      p.handle = myHandle
      p.avatarUrl = myAvatar
      p.skinSpriteId = mySkin
      p.towerHeight = snap.towerHeight || snap.maxTowerHeight || 0
      p.lives = snap.lives
      p.eliminationOrder = playerWon ? 0 : 1
    }

    const r = playerWon ? 1 : 4
    const earned = playerWon ? 3 : 0
    p.rank = r
    p.previousCupPoints = basePrevPts
    p.pointsEarned = earned
    p.cupPoints = basePrevPts + earned
    p.pointMedals = p.pointMedals.slice(0, basePrevPts)
    for (let i = 0; i < earned; i++) {
      p.pointMedals.push(1)
    }
    p.isCupWinner = false
  }

  const roundWinner =
    localCupState.value.participants.find((p) => p.rank === 1) ||
    localCupState.value.participants[0]
  localCupState.value.roundWinnerNick = roundWinner?.customNick || myNick

  const candidates = localCupState.value.participants
    .filter((p) => p.cupPoints >= targetPts)
    .sort((a, b) =>
      b.cupPoints !== a.cupPoints ? b.cupPoints - a.cupPoints : a.rank - b.rank
    )

  if (candidates.length > 0) {
    candidates[0].isCupWinner = true
    localCupState.value.isCupFinished = true
    localCupState.value.cupWinnerNick = candidates[0].customNick
  } else {
    localCupState.value.isCupFinished = false
    localCupState.value.cupWinnerNick = ''
  }

  localCupState.value.lastProcessedRound = roundNum
  localCupState.value.lastProcessedState = playerWon ? 'VICTORY' : 'GAME_OVER'
}

function handleLocalNextCupRound() {
  if (localCupState.value.isCupFinished) {
    resetLocalCupState()
  } else {
    localCupState.value.roundNumber += 1
  }
  restartMatch(true)
}

const grandeCopaScoreboard = computed<{
  isOnline: boolean
  roundNumber: number
  isCupFinished: boolean
  isTiebreaker: boolean
  victoryCondition: VictoryCondition
  cupTargetPoints: number
  cupTitle: string
  winnerNick: string
  roundWinnerNick: string
  gameMode: GameMode
  rows: GrandeCopaScoreboardRow[]
}>(() => {
  const mpResult = multiplayerClient.state.gameOverResult
  const myHandle = normalizePlayerHandle(authStore.state.user?.handle)

  if (mpResult && (mpResult.podium?.length ?? 0) > 0) {
    const vc = mpResult.victoryCondition || currentLobbyVictoryCondition.value
    const targetPts =
      mpResult.cupTargetPoints ||
      (vc === 'SINGLE_WIN' ? 3 : vc === 'CUP_12' ? 12 : 6)
    const roundNum = mpResult.roundNumber || 1
    const isTiebreaker = Boolean(mpResult.isTiebreaker)
    const rows: GrandeCopaScoreboardRow[] = (mpResult.podium || []).map(
      (entry, idx) => {
        const isLocal =
          (Boolean(myHandle) &&
            normalizePlayerHandle(entry.handle) === myHandle) ||
          (mpResult.podium?.length ?? 0) === 1
        const isEntryWinner =
          Boolean(entry.isWinner) ||
          (!entry.isEliminated && entry.rank === 1) ||
          (isLocal && snapshot.value.state === 'VICTORY')
        const rawEarned =
          entry.pointsEarned ??
          (entry.rank === 1 && !entry.isEliminated
            ? 3
            : entry.rank === 2 && !entry.isEliminated
              ? 2
              : entry.rank === 3 && !entry.isEliminated
                ? 1
                : 0)
        const earned = isEntryWinner ? Math.max(3, rawEarned) : rawEarned
        const rawPrevPts =
          entry.previousCupPoints ??
          Math.max(0, (entry.cupPoints ?? earned) - earned)
        const totalPts = Math.max(entry.cupPoints ?? 0, rawPrevPts + earned)
        const prevPts =
          earned > 0
            ? Math.min(rawPrevPts, Math.max(0, totalPts - earned))
            : rawPrevPts

        const medals: Array<1 | 2 | 3> = entry.pointMedals
          ? [...entry.pointMedals]
          : []
        const fallbackMedal: 1 | 2 | 3 =
          isEntryWinner || entry.rank === 1 ? 1 : entry.rank === 2 ? 2 : 3
        while (medals.length < prevPts) medals.push(1)
        while (medals.length < totalPts) medals.push(fallbackMedal)

        const rowTarget = entry.cupTargetPoints || targetPts
        return {
          key: entry.handle || entry.userId || `mp-${idx}`,
          slotIndex: entry.slotIndex ?? idx,
          rank: isEntryWinner ? 1 : entry.rank || idx + 1,
          customNick: entry.customNick || entry.handle || `Jogador ${idx + 1}`,
          handle: entry.handle || '',
          avatarUrl: resolvePlayerAvatarUrl(
            entry.handle || '',
            isLocal,
            entry.avatarUrl
          ),
          skinSpriteId: dbSkinToSpriteId(entry.equippedSkin),
          towerHeight: entry.towerHeight ?? 0,
          lives: entry.lives ?? 0,
          eliminationOrder: entry.eliminationOrder ?? 0,
          pointsEarned: earned,
          previousCupPoints: prevPts,
          cupPoints: totalPts,
          cupTargetPoints: rowTarget,
          totalVisualSlots: Math.max(8, rowTarget, medals.length),
          pointMedals: medals,
          isCupWinner: Boolean(entry.isCupWinner),
          isLocalPlayer: isLocal,
        }
      }
    )

    return {
      isOnline: true,
      roundNumber: roundNum,
      isCupFinished: !isTiebreaker && mpResult.isCupFinished !== false,
      isTiebreaker,
      victoryCondition: vc,
      cupTargetPoints: targetPts,
      cupTitle: isTiebreaker ? 'DESEMPATE!' : 'GRANDE COPA',
      winnerNick:
        mpResult.winnerCustomNick || mpResult.winnerNick || 'VENCEDOR',
      roundWinnerNick:
        mpResult.roundWinnerNick ||
        mpResult.winnerCustomNick ||
        mpResult.winnerNick ||
        'VENCEDOR',
      gameMode: mpResult.gameMode || snapshot.value.gameMode,
      rows,
    }
  }

  // Caso esteja em partida Multiplayer Online com outros jogadores e a vitória local
  // tenha disparado alguns milissegundos antes do pacote match:game_over chegar do servidor:
  if (
    isOnlineMultiplayerMatch.value &&
    Object.keys(multiplayerClient.state.remoteLanes).length > 0 &&
    (snapshot.value.state === 'VICTORY' || snapshot.value.state === 'GAME_OVER')
  ) {
    const vc = currentLobbyVictoryCondition.value
    const targetPts = currentLobbyVictoryInfo.value.targetPoints || 6
    const activePlayers = multiplayerClient.state.activeMatch?.players || []
    if (activePlayers.length > 0) {
      const localWon = snapshot.value.state === 'VICTORY'
      const rows: GrandeCopaScoreboardRow[] = activePlayers.map((p, idx) => {
        const isLocal =
          Boolean(myHandle) && normalizePlayerHandle(p.handle) === myHandle
        const prevPts = p.cupPoints ?? 0
        const earned = isLocal && localWon ? 3 : 0
        const totalPts = prevPts + earned
        const medals: Array<1 | 2 | 3> = []
        while (medals.length < prevPts) medals.push(1)
        while (medals.length < totalPts) medals.push(1)
        return {
          key: p.handle || `mp-${idx}`,
          slotIndex: p.slotIndex ?? idx,
          rank: isLocal && localWon ? 1 : idx + 2,
          customNick: p.customNick || p.handle || `Jogador ${idx + 1}`,
          handle: p.handle || '',
          avatarUrl: resolvePlayerAvatarUrl(p.handle || '', isLocal, p.avatarUrl),
          skinSpriteId: dbSkinToSpriteId(p.equippedSkin),
          towerHeight: isLocal ? snapshot.value.towerHeight : 0,
          lives: isLocal ? snapshot.value.lives : 0,
          eliminationOrder: 0,
          pointsEarned: earned,
          previousCupPoints: prevPts,
          cupPoints: totalPts,
          cupTargetPoints: targetPts,
          totalVisualSlots: Math.max(8, targetPts, medals.length),
          pointMedals: medals,
          isCupWinner: totalPts >= targetPts,
          isLocalPlayer: isLocal,
        }
      })
      const championsCount = rows.filter((r) => r.isCupWinner).length
      const isTiebreaker = vc !== 'SINGLE_WIN' && championsCount >= 2
      return {
        isOnline: true,
        roundNumber: multiplayerClient.state.activeMatch?.roundNumber || 1,
        isCupFinished: !isTiebreaker && championsCount === 1,
        isTiebreaker,
        victoryCondition: vc,
        cupTargetPoints: targetPts,
        cupTitle: isTiebreaker ? 'DESEMPATE!' : 'GRANDE COPA',
        winnerNick: rows[0]?.customNick || 'VOCÊ',
        roundWinnerNick: rows[0]?.customNick || 'VOCÊ',
        gameMode: snapshot.value.gameMode,
        rows,
      }
    }
  }

  // Local / Solo Cup Scoreboard
  if (
    snapshot.value.state === 'VICTORY' ||
    snapshot.value.state === 'GAME_OVER'
  ) {
    recordLocalRoundResult(snapshot.value)
  }

  const vc = currentLobbyVictoryCondition.value
  const targetPts = currentLobbyVictoryInfo.value.targetPoints || 6
  const participants =
    localCupState.value.participants.length > 0
      ? localCupState.value.participants
      : buildInitialLocalParticipants()

  const localWonNow = snapshot.value.state === 'VICTORY'
  const rows: GrandeCopaScoreboardRow[] = participants.map((p) => {
    const forceWinMedals = p.isLocalPlayer && localWonNow && p.pointsEarned < 3
    const earned = forceWinMedals ? 3 : p.pointsEarned
    const prevPts = forceWinMedals ? p.previousCupPoints : p.previousCupPoints
    const totalPts = forceWinMedals ? prevPts + 3 : p.cupPoints
    const medals: Array<1 | 2 | 3> = [...p.pointMedals]
    if (forceWinMedals || medals.length < totalPts) {
      while (medals.length < prevPts) medals.push(1)
      while (medals.length < totalPts) medals.push(1)
    }
    return {
      key: p.handle || `local-${p.slotIndex}`,
      slotIndex: p.slotIndex,
      rank: forceWinMedals ? 1 : p.rank,
      customNick: p.customNick,
      handle: p.handle,
      avatarUrl: resolvePlayerAvatarUrl(
        p.handle,
        p.isLocalPlayer,
        p.avatarUrl
      ),
      skinSpriteId: p.skinSpriteId,
      towerHeight: p.towerHeight,
      lives: p.lives,
      eliminationOrder: p.eliminationOrder,
      pointsEarned: earned,
      previousCupPoints: prevPts,
      cupPoints: totalPts,
      cupTargetPoints: targetPts,
      totalVisualSlots: Math.max(8, targetPts, medals.length),
      pointMedals: medals,
      isCupWinner: p.isCupWinner || totalPts >= targetPts,
      isLocalPlayer: p.isLocalPlayer,
    }
  })

  return {
    isOnline: isOnlineMultiplayerMatch.value,
    roundNumber: localCupState.value.roundNumber || 1,
    isCupFinished: localCupState.value.isCupFinished,
    isTiebreaker: false,
    victoryCondition: vc,
    cupTargetPoints: targetPts,
    cupTitle: 'GRANDE COPA',
    winnerNick:
      localCupState.value.cupWinnerNick ||
      localCupState.value.roundWinnerNick ||
      rows[0]?.customNick ||
      'VOCÊ',
    roundWinnerNick:
      localCupState.value.roundWinnerNick || rows[0]?.customNick || 'VOCÊ',
    gameMode: snapshot.value.gameMode,
    rows,
  }
})

function handleNextCupRound() {
  multiplayerClient.emitNextCupRound()
}

function handleGrandeCopaContinue() {
  if (
    !isOnlineMultiplayerMatch.value &&
    multiplayerClient.state.gameOverResult === null
  ) {
    restartMatch(true)
    return
  }

  if (isOnlineMultiplayerMatch.value && multiplayerClient.state.room) {
    if (
      grandeCopaScoreboard.value.isTiebreaker ||
      (grandeCopaScoreboard.value.victoryCondition !== 'SINGLE_WIN' &&
        !grandeCopaScoreboard.value.isCupFinished)
    ) {
      handleNextCupRound()
    } else {
      handleReturnToLobbyFromMatch()
    }
    return
  }

  multiplayerClient.state.gameOverResult = null
  if (
    !grandeCopaScoreboard.value.isTiebreaker &&
    (grandeCopaScoreboard.value.victoryCondition === 'SINGLE_WIN' ||
      grandeCopaScoreboard.value.isCupFinished) &&
    isOnlineMultiplayerMatch.value
  ) {
    resetLocalCupState()
    handleReturnToLobbyFromMatch()
    return
  }
  handleLocalNextCupRound()
}

function resolveEffectiveGameMode(mode: SelectableGameMode): GameMode {
  if (mode === 'RANDOM') {
    const pool: GameMode[] = ['RACE', 'PUZZLE', 'SURVIVAL', 'ENDLESS']
    return pool[Math.floor(Math.random() * pool.length)]
  }
  return mode
}

const personalBestScore = ref<number>(authStore.getPersonalBest())

const displayPersonalBest = computed<number>(() => {
  const currentEndless =
    snapshot.value.gameMode === 'ENDLESS'
      ? (snapshot.value.endlessScore ?? 0)
      : 0
  return Math.max(
    personalBestScore.value,
    authStore.getPersonalBest(),
    currentEndless
  )
})

const formattedAbyssRemainingTime = computed<string>(() => {
  const ms = Math.max(
    0,
    snapshot.value.abyssTimeRemainingMs ??
      GAME_CONSTANTS.ENDLESS_MAX_MATCH_TIME_MS - snapshot.value.elapsedTimeMs
  )
  const totalSec = Math.ceil(ms / 1000)
  const mins = Math.floor(totalSec / 60)
  const secs = totalSec % 60
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`
})

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
    const room = await multiplayerClient.enterLobby({
      selectedGameMode: selectedGameMode.value,
      victoryCondition: selectedVictoryCondition.value,
    })
    const isHost =
      normalizePlayerHandle(room?.hostHandle) ===
      normalizePlayerHandle(user?.handle)
    if (room && isHost) {
      if (room.selectedGameMode !== selectedGameMode.value) {
        await multiplayerClient.setRoomGameMode(selectedGameMode.value)
      }
      if (room.victoryCondition !== selectedVictoryCondition.value) {
        await multiplayerClient.setRoomVictoryCondition(
          selectedVictoryCondition.value
        )
      }
    } else if (room && !isHost) {
      if (room.selectedGameMode) {
        selectedGameMode.value = room.selectedGameMode
      }
      if (room.victoryCondition) {
        selectedVictoryCondition.value = room.victoryCondition
      }
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
      const updatedRoom = await multiplayerClient.toggleReady(nextReady, {
        selectedGameMode: selectedGameMode.value,
        victoryCondition: selectedVictoryCondition.value,
      })
      const occupied = updatedRoom.slots.filter((s) =>
        Boolean(s && s.handle && s.handle.trim())
      )
      // Fallback local 3s countdown if server did not start COUNTDOWN on a 1-player test room
      if (
        occupied.length === 1 &&
        nextReady &&
        updatedRoom.status !== 'COUNTDOWN' &&
        multiplayerClient.state.countdownSeconds === null
      ) {
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
  selectedModeScreenColumn.value = 'MODE'
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
  if (
    !isOnlineMatch ||
    (multiplayerClient.state.activeMatch?.roundNumber || 1) <= 1
  ) {
    resetLocalCupState()
  }

  const selectableMode: SelectableGameMode = isOnlineMatch
    ? isRoomHostOrSolo.value
      ? selectedGameMode.value
      : onlineSelectedMode ||
        multiplayerClient.state.room?.selectedGameMode ||
        selectedGameMode.value
    : selectedGameMode.value

  const resolvedMode: GameMode =
    isOnlineMatch &&
    onlineResolvedMode &&
    (!isRoomHostOrSolo.value || selectableMode === 'RANDOM')
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
          : resolvedMode === 'PUZZLE'
            ? '🧩 MODO QUEBRA-CABEÇA (ABAIXO DO LASER - 9m)'
            : resolvedMode === 'ENDLESS'
              ? '🌌 MODO INFINITO / ABISMO'
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
    personalBestScore.value = Math.max(
      personalBestScore.value,
      authStore.getPersonalBest()
    )
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
  if (
    screenFlow.value === 'MULTIPLAYER_LOBBY' ||
    isOnlineMultiplayerMatch.value ||
    Boolean(multiplayerClient.state.room)
  ) {
    multiplayerClient.leaveRoom()
  }
  isOnlineMultiplayerMatch.value = false
  isDevModeOpen.value = false
  isSkinPickerOpen.value = false
  isAuthModalOpen.value = false
  isFriendsModalOpen.value = false
  isGameModeModalOpen.value = false
  isOptionsModalOpen.value = false
  listeningKeybindAction.value = null
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

function openOptionsScreen(asModal: boolean = false) {
  selectedMenuCard.value = 'OPTIONS'
  isBurgerMenuOpen.value = false
  isSkinPickerOpen.value = false
  listeningKeybindAction.value = null
  optionsNickInput.value =
    authStore.state.user?.customNick ||
    fallbackLobbySlots.value[0]?.customNick ||
    'ReiDosBlocos'
  playToySfx('click')
  if (asModal) {
    isOptionsModalOpen.value = true
  } else {
    isAuthModalOpen.value = false
    isFriendsModalOpen.value = false
    isGameModeModalOpen.value = false
    isOptionsModalOpen.value = false
    screenFlow.value = 'OPTIONS_SCREEN'
  }
}

function closeOptionsScreen() {
  listeningKeybindAction.value = null
  playToySfx('click')
  if (isOptionsModalOpen.value) {
    isOptionsModalOpen.value = false
    return
  }
  returnToMainMenu()
}

function handleFullscreenChange() {
  isFullscreen.value = Boolean(
    typeof document !== 'undefined' && document.fullscreenElement
  )
}

async function toggleFullscreen() {
  if (typeof document === 'undefined') return
  playToySfx('click')
  try {
    if (!document.fullscreenElement) {
      await document.documentElement.requestFullscreen()
      isFullscreen.value = true
      triggerBanner('🖥️ Modo Tela Cheia ativado!', 'info')
    } else {
      await document.exitFullscreen()
      isFullscreen.value = false
      triggerBanner('🪟 Modo Janela ativado!', 'info')
    }
  } catch {
    triggerBanner(
      'Não foi possível alternar Tela Cheia neste navegador.',
      'warning'
    )
  }
}

const controlsViewDevice = ref<'KEYBOARD' | 'GAMEPAD'>('KEYBOARD')

function selectKeyboardPreset(
  preset: 'TRICKY' | 'HYBRID' | 'ARROWS_ZXC' | 'WASD_QE'
) {
  controlsViewDevice.value = 'KEYBOARD'
  listeningKeybindAction.value = null
  optionsStore.applyPreset(preset)
}

function selectGamepadControlsView() {
  controlsViewDevice.value = 'GAMEPAD'
  listeningKeybindAction.value = null
  playToySfx('click')
}

function getPrimaryKeycapLabel(actionId: KeybindActionId): string {
  if (listeningKeybindAction.value === actionId) {
    return '...'
  }
  const primary = optionsStore.state.keybinds[actionId]?.[0] || ''
  return formatKeyCodeLabel(primary)
}

function startListeningKeybind(actionId: KeybindActionId) {
  if (controlsViewDevice.value !== 'KEYBOARD') return
  playToySfx('click')
  listeningKeybindAction.value =
    listeningKeybindAction.value === actionId ? null : actionId
}

function setMasterVolume(val: number) {
  optionsStore.state.masterVolume = Math.max(0, Math.min(100, Math.round(val)))
}

function setBgmVolume(val: number) {
  optionsStore.state.bgmVolume = Math.max(0, Math.min(100, Math.round(val)))
}

function setSfxVolume(val: number) {
  optionsStore.state.sfxVolume = Math.max(0, Math.min(100, Math.round(val)))
}

function toggleMuteAudio() {
  optionsStore.state.isMuted = !optionsStore.state.isMuted
  if (!optionsStore.state.isMuted) {
    playToySfx('click')
  }
  triggerBanner(
    optionsStore.state.isMuted
      ? '🔇 Áudio silenciado!'
      : '🔊 Áudio reativado!',
    'info'
  )
}

function toggleScreenShakeOption() {
  optionsStore.state.screenShakeEnabled = !optionsStore.state.screenShakeEnabled
  playToySfx('click')
}

function toggleShowFpsPingOption() {
  optionsStore.state.showFpsPing = !optionsStore.state.showFpsPing
  playToySfx('click')
}

function toggleShowOpponentHandlesOption() {
  optionsStore.state.showOpponentHandles =
    !optionsStore.state.showOpponentHandles
  playToySfx('click')
}

function toggleAllowInvitesInGameOption() {
  optionsStore.state.allowInvitesInGame = !optionsStore.state.allowInvitesInGame
  playToySfx('click')
}

function handleResetOptions() {
  optionsStore.resetToDefaults()
  listeningKeybindAction.value = null
  showGhostPiece.value = optionsStore.state.showGhostPiece
  windEnabled.value = optionsStore.state.windEnabled
  dynamicTintEnabled.value = optionsStore.state.dynamicTintEnabled
  if (towerInstance) {
    towerInstance.showGhostPiece = showGhostPiece.value
    towerInstance.setWindEnabled(windEnabled.value)
  }
  spriteRegistry.setDynamicTintEnabled(dynamicTintEnabled.value)
  triggerBanner(
    '🔄 Todas as opções foram restauradas para o padrão!',
    'success'
  )
}

async function saveOptionsCustomNick() {
  const cleaned = optionsNickInput.value.trim()
  if (cleaned.length < 2 || cleaned.length > 16) {
    triggerBanner('O apelido deve ter entre 2 e 16 caracteres.', 'warning')
    return
  }
  isSavingCustomNick.value = true
  try {
    if (authStore.state.user) {
      await multiplayerClient.updateCustomNick(cleaned)
    }
    if (fallbackLobbySlots.value[0]) {
      fallbackLobbySlots.value[0].customNick = cleaned
    }
    playToySfx('victory')
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
      if (selectedMenuCard.value === 'OPTIONS') {
        openOptionsScreen(false)
      } else if (selectedMenuCard.value === 'MULTIPLAYER') {
        handleMultiplayerCardClick()
      } else {
        openLocalBattleLobby()
      }
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
  const isEndlessMode = snapshot.value.gameMode === 'ENDLESS'
  const isPuzzleMode = snapshot.value.gameMode === 'PUZZLE'

  // If in Survival or Endless (Rising Abyss) Mode and all opponents have been eliminated while we are alive,
  // trigger the Castle Roof Climax on our tower so we place the final Castle to finish!
  if (
    (isSurvivalMode || isEndlessMode) &&
    remoteEntries.length >= 1 &&
    snapshot.value.lives > 0 &&
    towerInstance.state === 'PLAYING' &&
    remoteEntries.every((r) => r.lives <= 0 || r.isEliminated)
  ) {
    towerInstance.triggerSurvivalCastleClimax()
  }

  // If in Puzzle Mode and ALL players in the room have petrified ("FINALIZADO"),
  // start the synchronized block-by-block counting phase!
  if (
    isPuzzleMode &&
    towerInstance.state === 'PETRIFIED_WAITING' &&
    (remoteEntries.length === 0 ||
      remoteEntries.every((r) => Boolean(r.isPetrified) || r.isEliminated))
  ) {
    towerInstance.startPuzzleCountingPhase()
  }

  const elimMap = multiplayerClient.state.eliminationOrderByHandle
  const allHeights = [
    {
      handle: myHandle,
      height: snapshot.value.towerHeight,
      lives: snapshot.value.lives,
      pieces: isPuzzleMode
        ? (snapshot.value.countedPieces ?? snapshot.value.settledBlocks.length)
        : snapshot.value.piecesPlaced,
      eliminationOrder: elimMap[myHandle] || 0,
    },
    ...remoteEntries.map((r) => {
      const h = r.handle.toLowerCase()
      return {
        handle: h,
        height: r.towerHeight,
        lives: r.lives,
        pieces: isPuzzleMode
          ? (r.countedPieces ?? r.settledBlocks?.length ?? 0)
          : (r.settledBlocks?.length ?? 0),
        eliminationOrder: r.eliminationOrder || elimMap[h] || 0,
      }
    }),
  ].sort((a, b) => {
    if (isPuzzleMode) {
      if (b.pieces !== a.pieces) return b.pieces - a.pieces
      return b.height - a.height
    }
    if (isSurvivalMode || isEndlessMode) {
      const aAlive = a.lives > 0 ? 1 : 0
      const bAlive = b.lives > 0 ? 1 : 0
      if (bAlive !== aAlive) return bAlive - aAlive
      if (!aAlive && !bAlive && a.eliminationOrder !== b.eliminationOrder) {
        // Reverse order of death: died later -> higher rank; died first -> last place
        return b.eliminationOrder - a.eliminationOrder
      }
      if (isSurvivalMode) {
        if (b.pieces !== a.pieces) return b.pieces - a.pieces
        if (b.lives !== a.lives) return b.lives - a.lives
      }
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
      handle: optionsStore.state.showOpponentHandles ? r.handle : '',
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
      puzzleBaseRiseUnits: r.puzzleBaseRiseUnits ?? 0,
      isPetrified: Boolean(r.isPetrified),
      countedPieces: r.countedPieces ?? r.renderSettledBlocks.length,
      laserOverloadRemainingMs: r.laserOverloadRemainingMs ?? null,
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
    const rawDt = Math.max(1, now - lastFrameTime)
    const dt = Math.min(32, rawDt)
    lastFrameTime = now

    fpsFrameCount += 1
    fpsAccumMs += rawDt
    if (fpsAccumMs >= 500) {
      liveFps.value = Math.min(240, Math.round((fpsFrameCount * 1000) / fpsAccumMs))
      fpsFrameCount = 0
      fpsAccumMs = 0
    }

    pollMenuGamepad()

    if (
      screenFlow.value === 'MULTIPLAYER_LOBBY' &&
      lobbyCountdownMs.value !== null
    ) {
      if (multiplayerClient.state.countdownSeconds !== null) {
        lobbyCountdownMs.value = null
      } else {
        lobbyCountdownMs.value = Math.max(0, lobbyCountdownMs.value - dt)
        if (lobbyCountdownMs.value <= 0) {
          lobbyCountdownMs.value = null
          const isOnline = Boolean(multiplayerClient.state.room)
          startGame(
            multiplayerClient.state.room?.pieceSeed || undefined,
            isOnline,
            undefined,
            currentLobbySelectableMode.value
          )
        }
      }
    }

    if (canvasRef.value) {
      const ctx = canvasRef.value.getContext('2d')
      if (ctx) {
        ctx.clearRect(0, 0, canvasRef.value.width, canvasRef.value.height)

        if (screenFlow.value === 'IN_GAME' && towerInstance) {
          if (!isDevModeOpen.value && !isOptionsModalOpen.value) {
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
                  (snap.gameMode === 'SURVIVAL' ||
                    snap.gameMode === 'ENDLESS') &&
                  (snap.lives <= 0 || snap.state === 'GAME_OVER'),
                puzzleBaseRiseUnits: snap.puzzleBaseRiseUnits,
                isPetrified: snap.isPetrified,
                countedPieces: snap.countedPieces,
                laserOverloadRemainingMs: snap.laserOverloadRemainingMs,
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
                screenFlow.value !== 'LOCAL_LOBBY' &&
                screenFlow.value !== 'OPTIONS_SCREEN',
            }
          )
        }
      }
    }
    pollGamepadInput(now)
    rafId = requestAnimationFrame(step)
  }
  rafId = requestAnimationFrame(step)
}

// ============================================================================
// GAMEPAD SUPPORT (PADRÃO XBOX / PLAYSTATION - CONTROLE TRICKY)
// ============================================================================
const connectedGamepadName = ref<string | null>(null)
let gamepadWasSoftDropping = false
let lastGamepadHorizMoveMs = 0
const prevGamepadBtnState = {
  left: false,
  right: false,
  rotateCW: false,
  rotateCCW: false,
  nudgeLeft: false,
  nudgeRight: false,
  lightMagic: false,
  darkMagic: false,
  options: false,
}

function pollGamepadInput(nowMs: number) {
  if (typeof navigator === 'undefined' || !navigator.getGamepads) return
  let gamepads: (Gamepad | null)[] = []
  try {
    gamepads = Array.from(navigator.getGamepads())
  } catch {
    return
  }

  const gp = gamepads.find((g) => g && g.connected) ?? null
  connectedGamepadName.value = gp ? gp.id : null

  if (!gp) {
    if (gamepadWasSoftDropping && towerInstance) {
      towerInstance.isSoftDropping = false
      gamepadWasSoftDropping = false
    }
    prevGamepadBtnState.left = false
    prevGamepadBtnState.right = false
    prevGamepadBtnState.rotateCW = false
    prevGamepadBtnState.rotateCCW = false
    prevGamepadBtnState.nudgeLeft = false
    prevGamepadBtnState.nudgeRight = false
    prevGamepadBtnState.lightMagic = false
    prevGamepadBtnState.darkMagic = false
    prevGamepadBtnState.options = false
    return
  }

  const isPressed = (idx: number): boolean => Boolean(gp.buttons[idx]?.pressed)
  const axisX = gp.axes[0] ?? 0
  const axisY = gp.axes[1] ?? 0

  // Mover bloco para os lados: Direcional Digital (D-Pad) ou Analógico Esquerdo
  const moveLeft = isPressed(14) || axisX < -0.5
  const moveRight = isPressed(15) || axisX > 0.5
  // Acelerar a queda (Drop): Direcional p/ Baixo ou Analógico Esquerdo p/ Baixo
  const softDrop = isPressed(13) || axisY > 0.5
  // Rotacionar p/ Direita: Botão X (Cruz / A = idx 0) ou Direcional p/ Cima (12) ou Analógico Esquerdo p/ Cima
  const rotateCW = isPressed(0) || isPressed(12) || axisY < -0.6
  // Rotacionar p/ Esquerda: Botão Triângulo / Y (idx 3)
  const rotateCCW = isPressed(3)
  // Empurrar bloco p/ os lados ("Socão"): Botões L1 (idx 4) e R1 (idx 5)
  const nudgeLeft = isPressed(4)
  const nudgeRight = isPressed(5)
  // Usar Magia Branca (Luz/Defesa): Botão Quadrado (□ / X = idx 2)
  const lightMagic = isPressed(2)
  // Usar Magia Negra (Trevas/Ataque): Botão Círculo (○ / B = idx 1)
  const darkMagic = isPressed(1)
  // Pausar o jogo: Botão Options (Start = idx 9)
  const optionsBtn = isPressed(9)

  const justOptions = optionsBtn && !prevGamepadBtnState.options
  const justRotateCW = rotateCW && !prevGamepadBtnState.rotateCW
  const justRotateCCW = rotateCCW && !prevGamepadBtnState.rotateCCW
  const justNudgeLeft = nudgeLeft && !prevGamepadBtnState.nudgeLeft
  const justNudgeRight = nudgeRight && !prevGamepadBtnState.nudgeRight
  const justLightMagic = lightMagic && !prevGamepadBtnState.lightMagic
  const justDarkMagic = darkMagic && !prevGamepadBtnState.darkMagic
  const justMoveLeft = moveLeft && !prevGamepadBtnState.left
  const justMoveRight = moveRight && !prevGamepadBtnState.right

  prevGamepadBtnState.left = moveLeft
  prevGamepadBtnState.right = moveRight
  prevGamepadBtnState.rotateCW = rotateCW
  prevGamepadBtnState.rotateCCW = rotateCCW
  prevGamepadBtnState.nudgeLeft = nudgeLeft
  prevGamepadBtnState.nudgeRight = nudgeRight
  prevGamepadBtnState.lightMagic = lightMagic
  prevGamepadBtnState.darkMagic = darkMagic
  prevGamepadBtnState.options = optionsBtn

  if (screenFlow.value === 'TITLE_SCREEN' && (justOptions || justRotateCW)) {
    transitionToMainMenu()
    return
  }

  // Botão Options: pausa/abre Opções durante a partida
  if (justOptions) {
    if (screenFlow.value === 'IN_GAME') {
      if (isOptionsModalOpen.value) {
        closeOptionsScreen()
      } else {
        openOptionsScreen(true)
      }
      return
    } else if (screenFlow.value === 'OPTIONS_SCREEN') {
      closeOptionsScreen()
      return
    }
  }

  if (
    screenFlow.value !== 'IN_GAME' ||
    !towerInstance ||
    isDevModeOpen.value ||
    isOptionsModalOpen.value
  ) {
    if (gamepadWasSoftDropping && towerInstance) {
      towerInstance.isSoftDropping = false
      gamepadWasSoftDropping = false
    }
    return
  }

  // Acelerar a queda (Drop)
  if (softDrop) {
    towerInstance.isSoftDropping = true
    gamepadWasSoftDropping = true
  } else if (gamepadWasSoftDropping) {
    towerInstance.isSoftDropping = false
    gamepadWasSoftDropping = false
  }

  // Mover bloco para os lados (D-Pad ou Analógico Esquerdo com auto-repeat suave)
  if (justMoveLeft || (moveLeft && nowMs - lastGamepadHorizMoveMs >= 135)) {
    towerInstance.moveHorizontal(-1, false)
    playToySfx('move')
    lastGamepadHorizMoveMs = nowMs
  } else if (
    justMoveRight ||
    (moveRight && nowMs - lastGamepadHorizMoveMs >= 135)
  ) {
    towerInstance.moveHorizontal(1, false)
    playToySfx('move')
    lastGamepadHorizMoveMs = nowMs
  }

  // Empurrar bloco para os lados ("Socão"): Botões L1 e R1
  if (justNudgeLeft) {
    towerInstance.moveHorizontal(-1, true)
    playToySfx('move')
  } else if (justNudgeRight) {
    towerInstance.moveHorizontal(1, true)
    playToySfx('move')
  }

  // Rotacionar para a Direita (Botão X / D-Pad Cima / Analógico Cima)
  if (justRotateCW) {
    towerInstance.rotateActivePiece(1)
    playToySfx('rotate')
  } else if (justRotateCCW) {
    towerInstance.rotateActivePiece(-1)
    playToySfx('rotate')
  }

  // Magia Branca (Botão Quadrado) e Magia Negra (Botão Círculo)
  if (justLightMagic) {
    towerInstance.activateSelfPower()
    playToySfx('power')
  } else if (justDarkMagic) {
    towerInstance.activateAttackPower()
    playToySfx('power')
  }
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
  // Interactive Keybind Remapping inside the Options screen
  if (listeningKeybindAction.value !== null) {
    e.preventDefault()
    if (e.code === 'Escape') {
      listeningKeybindAction.value = null
      return
    }
    const actionId = listeningKeybindAction.value
    optionsStore.setKeybind(actionId, e.code)
    listeningKeybindAction.value = null
    triggerBanner(
      `🎮 Tecla [${formatKeyCodeLabel(e.code)}] atribuída com sucesso!`,
      'success'
    )
    return
  }

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

  // Tela de Opções aberta (como página ou modal)
  if (screenFlow.value === 'OPTIONS_SCREEN' || isOptionsModalOpen.value) {
    if (e.code === 'Escape') {
      e.preventDefault()
      closeOptionsScreen()
    }
    return
  }

  if (isGameModeModalOpen.value) {
    if (e.code === 'Escape' || e.code === 'Enter' || e.code === 'Space') {
      e.preventDefault()
      closeGameModeModal()
    } else if (e.code === 'ArrowLeft' || e.code === 'KeyA') {
      e.preventDefault()
      if (showCupSelectionColumn.value) {
        selectedModeScreenColumn.value = 'MODE'
      } else {
        cycleGameModeOption(-1)
      }
    } else if (e.code === 'ArrowRight' || e.code === 'KeyD') {
      e.preventDefault()
      if (showCupSelectionColumn.value) {
        selectedModeScreenColumn.value = 'CUP'
      } else {
        cycleGameModeOption(1)
      }
    } else if (e.code === 'ArrowUp' || e.code === 'KeyW') {
      e.preventDefault()
      if (
        !showCupSelectionColumn.value ||
        selectedModeScreenColumn.value === 'MODE'
      ) {
        cycleGameModeOption(-1)
      } else {
        cycleVictoryConditionOption(-1)
      }
    } else if (e.code === 'ArrowDown' || e.code === 'KeyS') {
      e.preventDefault()
      if (
        !showCupSelectionColumn.value ||
        selectedModeScreenColumn.value === 'MODE'
      ) {
        cycleGameModeOption(1)
      } else {
        cycleVictoryConditionOption(1)
      }
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

  // Tela SELECIONE O MODO (LOCAL_LOBBY — Singleplayer só tem Modo de Jogo, sem Copa)
  if (screenFlow.value === 'LOCAL_LOBBY') {
    if (e.code === 'Escape') {
      e.preventDefault()
      returnToMainMenu()
    } else if (
      e.code === 'ArrowUp' ||
      e.code === 'KeyW' ||
      e.code === 'ArrowLeft' ||
      e.code === 'KeyA'
    ) {
      e.preventDefault()
      cycleGameModeOption(-1)
    } else if (
      e.code === 'ArrowDown' ||
      e.code === 'KeyS' ||
      e.code === 'ArrowRight' ||
      e.code === 'KeyD'
    ) {
      e.preventDefault()
      cycleGameModeOption(1)
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

  // Menu 2: MAIN_MENU — Setas alternam entre BATALHA LOCAL, MULTIPLAYER e OPÇÕES; Enter/Space confirma; Escape volta ao TITLE_SCREEN
  if (screenFlow.value === 'MAIN_MENU') {
    if (e.code === 'ArrowLeft' || e.code === 'KeyA') {
      e.preventDefault()
      selectedMenuCard.value = 'LOCAL'
      playToySfx('move')
    } else if (e.code === 'ArrowRight' || e.code === 'KeyD') {
      e.preventDefault()
      selectedMenuCard.value =
        selectedMenuCard.value === 'OPTIONS' ? 'OPTIONS' : 'MULTIPLAYER'
      playToySfx('move')
    } else if (e.code === 'ArrowDown' || e.code === 'KeyS') {
      e.preventDefault()
      selectedMenuCard.value = 'OPTIONS'
      playToySfx('move')
    } else if (e.code === 'ArrowUp' || e.code === 'KeyW') {
      e.preventDefault()
      selectedMenuCard.value =
        selectedMenuCard.value === 'OPTIONS'
          ? 'MULTIPLAYER'
          : selectedMenuCard.value
      playToySfx('move')
    } else if (e.code === 'Enter' || e.code === 'Space') {
      e.preventDefault()
      if (selectedMenuCard.value === 'MULTIPLAYER') {
        handleMultiplayerCardClick()
      } else if (selectedMenuCard.value === 'OPTIONS') {
        openOptionsScreen(false)
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

  if (
    multiplayerClient.state.gameOverResult !== null ||
    snapshot.value.state === 'VICTORY' ||
    (snapshot.value.state === 'GAME_OVER' &&
      (!isOnlineMultiplayerMatch.value || !hasAliveRemoteOpponents.value))
  ) {
    if (
      e.code === 'Enter' ||
      e.code === 'Space' ||
      optionsStore.matchesAction('restartMatch', e.code) ||
      e.code === 'Escape'
    ) {
      e.preventDefault()
      handleGrandeCopaContinue()
    }
    return
  }

  if (optionsStore.matchesAction('restartMatch', e.code)) {
    e.preventDefault()
    if (
      !isOnlineMultiplayerMatch.value ||
      Object.keys(multiplayerClient.state.remoteLanes).length === 0
    ) {
      restartMatch(true)
    }
    return
  }

  // While Developer Mode or Options Modal is open, the game is paused: ignore piece movement keys
  if (isDevModeOpen.value || isOptionsModalOpen.value) {
    return
  }

  if (optionsStore.matchesAction('nudgeLeft', e.code)) {
    e.preventDefault()
    towerInstance.moveHorizontal(-1, true)
    playToySfx('move')
  } else if (optionsStore.matchesAction('nudgeRight', e.code)) {
    e.preventDefault()
    towerInstance.moveHorizontal(1, true)
    playToySfx('move')
  } else if (optionsStore.matchesAction('moveLeft', e.code)) {
    e.preventDefault()
    towerInstance.moveHorizontal(-1, e.shiftKey)
    playToySfx('move')
  } else if (optionsStore.matchesAction('moveRight', e.code)) {
    e.preventDefault()
    towerInstance.moveHorizontal(1, e.shiftKey)
    playToySfx('move')
  } else if (optionsStore.matchesAction('rotateCW', e.code)) {
    e.preventDefault()
    towerInstance.rotateActivePiece(1)
    playToySfx('rotate')
  } else if (optionsStore.matchesAction('rotateCCW', e.code)) {
    e.preventDefault()
    towerInstance.rotateActivePiece(-1)
    playToySfx('rotate')
  } else if (optionsStore.matchesAction('softDrop', e.code)) {
    e.preventDefault()
    towerInstance.isSoftDropping = true
  } else if (optionsStore.matchesAction('selfPower', e.code)) {
    e.preventDefault()
    towerInstance.activateSelfPower()
    playToySfx('power')
  } else if (optionsStore.matchesAction('attackPower', e.code)) {
    e.preventDefault()
    towerInstance.activateAttackPower()
    playToySfx('power')
  }
}

function handleKeyUp(e: KeyboardEvent) {
  isShiftHeld.value = e.shiftKey
  if (!towerInstance) return

  if (optionsStore.matchesAction('softDrop', e.code)) {
    towerInstance.isSoftDropping = false
  }
}

function restartMatch(
  generateNewRandomSeed: boolean = true,
  reRollRandomMode: boolean = true
) {
  if (!towerInstance) return
  const isSoloOrOffline =
    !isOnlineMultiplayerMatch.value ||
    Object.keys(multiplayerClient.state.remoteLanes).length === 0

  if (
    reRollRandomMode &&
    isSoloOrOffline &&
    selectedGameMode.value === 'RANDOM'
  ) {
    const nextMode = resolveEffectiveGameMode('RANDOM')
    activeMatchGameMode.value = nextMode
    towerInstance.setGameMode(nextMode)
    triggerBanner(
      `🎲 Modo Aleatório sorteou: ${
        nextMode === 'SURVIVAL'
          ? '❤️ MODO SOBREVIVÊNCIA (3 VIDAS)'
          : nextMode === 'PUZZLE'
            ? '🧩 MODO QUEBRA-CABEÇA (ABAIXO DO LASER - 9m)'
            : nextMode === 'ENDLESS'
              ? '🌌 MODO INFINITO / ABISMO'
              : '🏁 MODO CORRIDA (30m)'
      }!`,
      'info'
    )
  } else if (isSoloOrOffline && selectedGameMode.value !== 'RANDOM') {
    activeMatchGameMode.value = selectedGameMode.value
    towerInstance.setGameMode(selectedGameMode.value)
  }

  if (isSoloOrOffline) {
    multiplayerClient.state.gameOverResult = null
    if (
      localCupState.value.lastProcessedRound >=
      localCupState.value.roundNumber
    ) {
      for (const p of localCupState.value.participants) {
        p.cupPoints = p.previousCupPoints
        p.pointsEarned = 0
        p.pointMedals = p.pointMedals.slice(0, p.previousCupPoints)
        p.isCupWinner = false
      }
      localCupState.value.isCupFinished = false
      localCupState.value.cupWinnerNick = ''
      localCupState.value.lastProcessedRound = Math.max(
        0,
        localCupState.value.roundNumber - 1
      )
      localCupState.value.lastProcessedState = 'NONE'
    }
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
  optionsStore.state.showGhostPiece = showGhostPiece.value
  if (towerInstance) {
    towerInstance.showGhostPiece = showGhostPiece.value
  }
  playToySfx('click')
  triggerBanner(
    showGhostPiece.value
      ? 'Sombra de Encaixe (Ghost Piece) ativada!'
      : 'Sombra de Encaixe (Ghost Piece) desativada!',
  'info'
  )
}

function toggleWind() {
  windEnabled.value = !windEnabled.value
  optionsStore.state.windEnabled = windEnabled.value
  if (towerInstance) {
    towerInstance.setWindEnabled(windEnabled.value)
  }
  playToySfx('click')
  triggerBanner(
    windEnabled.value
      ? 'Vento ativado (a partir de 15m)!'
      : 'Vento desativado!',
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
  playToySfx('power')
}

function useAttackPower() {
  towerInstance?.activateAttackPower()
  playToySfx('power')
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
  optionsStore.state.dynamicTintEnabled = dynamicTintEnabled.value
  spriteRegistry.setDynamicTintEnabled(dynamicTintEnabled.value)
  playToySfx('click')
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
  playToySfx('click')
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
  spriteRegistry.setDynamicTintEnabled(optionsStore.state.dynamicTintEnabled)
  // Anti-Hibernation Wake-up Ping for Render Socket.io Server on initial menu load
  multiplayerClient.wakeUpSocketServer()
  void authStore.restoreSession().then((restoredUser) => {
    if (restoredUser) {
      activePlayerSkinId.value = spriteRegistry.getActivePlayerSkinId()
      optionsNickInput.value = restoredUser.customNick || restoredUser.displayName
      personalBestScore.value = Math.max(
        personalBestScore.value,
        authStore.getPersonalBest()
      )
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
      if (payload.isTiebreakerRound) {
        triggerBanner(
          '⚔️ RODADA DE DESEMPATE FINAL iniciada com todos os jogadores!',
          'info'
        )
        return
      }
      const modeTitle =
        activeMatchGameMode.value === 'SURVIVAL'
          ? '❤️ Modo Sobrevivência (3 Vidas)'
          : activeMatchGameMode.value === 'PUZZLE'
            ? '🧩 Modo Quebra-Cabeça (Abaixo do Laser - 9m)'
            : activeMatchGameMode.value === 'ENDLESS'
              ? '🌌 Modo Infinito / Abismo Ascendente'
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
      playToySfx('power')
      triggerBanner(
        `⚡ ${attackerNick} lançou ${cfg?.name || powerType} na sua torre!`,
        'danger'
      )
    },
    onSurvivalClimax: (payload) => {
      const myHandle = normalizePlayerHandle(authStore.state.user?.handle || '')
      const winnerHandle = normalizePlayerHandle(payload.winnerHandle || '')
      if (myHandle && myHandle === winnerHandle) {
        towerInstance?.triggerSurvivalCastleClimax()
      } else {
        triggerBanner(
          `🏰 Fim de jogo! ${payload.winnerCustomNick} foi o último sobrevivente e está colocando o Castelo na torre!`,
          'info'
        )
      }
    },
    onGameOver: (payload) => {
      playToySfx('victory')
      if (payload.isTiebreaker) {
        triggerBanner(
          '⚔️ EMPATE! Mais uma rodada com todos os jogadores para o Desempate Final!',
          'info'
        )
        return
      }
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
      if (snap.gameMode === 'ENDLESS') {
        const currentScore = snap.endlessScore ?? 0
        if (currentScore > personalBestScore.value) {
          personalBestScore.value = currentScore
          void authStore.updatePersonalBest(currentScore)
        }
      }
      if (
        (!isOnlineMultiplayerMatch.value ||
          Object.keys(multiplayerClient.state.remoteLanes).length === 0) &&
        (snap.state === 'VICTORY' || snap.state === 'GAME_OVER')
      ) {
        recordLocalRoundResult(snap)
      }
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
      playToySfx('settle')
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
      playToySfx('victory')
      if (!isOnlineMultiplayerMatch.value) return
      const scoreOrHeight =
        towerInstance?.gameMode === 'PUZZLE'
          ? towerInstance.settledPieces.length
          : towerHeight
      multiplayerClient.emitClaimVictory(scoreOrHeight, elapsedTimeMs)
    },
  })
  towerInstance.showGhostPiece = optionsStore.state.showGhostPiece
  towerInstance.setWindEnabled(optionsStore.state.windEnabled)
  towerInstance.emitSnapshotNow()

  window.addEventListener('resize', handleResize)
  window.addEventListener('keydown', handleKeyDown)
  window.addEventListener('keyup', handleKeyUp)
  document.addEventListener('fullscreenchange', handleFullscreenChange)
  startLoop()
})

onUnmounted(() => {
  if (unsubscribeSprites) unsubscribeSprites()
  if (rafId !== null) cancelAnimationFrame(rafId)
  window.removeEventListener('resize', handleResize)
  window.removeEventListener('keydown', handleKeyDown)
  window.removeEventListener('keyup', handleKeyUp)
  document.removeEventListener('fullscreenchange', handleFullscreenChange)
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

            <!-- Botão 3: OPÇÕES DO JOGO -->
            <button
              type="button"
              class="burger-menu-action-btn burger-menu-action-btn--options"
              @click="openOptionsScreen(screenFlow !== 'MAIN_MENU')"
            >
              <span class="burger-menu-action-icon">⚙️</span>
              <span class="burger-menu-action-text">OPÇÕES DO JOGO</span>
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
          <div
            role="button"
            tabindex="0"
            class="menu-brick-card menu-brick-card--active"
            :class="{
              'menu-brick-card--selected': selectedMenuCard === 'LOCAL',
            }"
            @mouseenter="selectedMenuCard = 'LOCAL'"
            @focus="selectedMenuCard = 'LOCAL'"
            @click="openLocalBattleLobby"
            @keydown.enter.prevent="openLocalBattleLobby"
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
          </div>

          <!-- BLOCO 2: MULTIPLAYER (ATIVO — AUTENTICAÇÃO GOOGLE + MONGODB) -->
          <div
            role="button"
            tabindex="0"
            class="menu-brick-card menu-brick-card--active"
            :class="{
              'menu-brick-card--selected': selectedMenuCard === 'MULTIPLAYER',
            }"
            @mouseenter="selectedMenuCard = 'MULTIPLAYER'"
            @focus="selectedMenuCard = 'MULTIPLAYER'"
            @click="handleMultiplayerCardClick"
            @keydown.enter.prevent="handleMultiplayerCardClick"
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
          </div>

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

          <!-- BLOCO 4: OPÇÕES (ATIVO) -->
          <div
            role="button"
            tabindex="0"
            class="menu-brick-card menu-brick-card--active"
            :class="{
              'menu-brick-card--selected': selectedMenuCard === 'OPTIONS',
            }"
            @mouseenter="selectedMenuCard = 'OPTIONS'"
            @focus="selectedMenuCard = 'OPTIONS'"
            @click="openOptionsScreen(false)"
            @keydown.enter.prevent="openOptionsScreen(false)"
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
                :src="menuSprites.screen_option"
                alt="Opções"
                class="menu-brick-card-img"
                draggable="false"
              />
              <span class="menu-brick-card-title menu-brick-card-title--narrow">
                OPÇÕES
              </span>
            </div>
          </div>
        </div>
      </div>
    </transition>

    <!-- =================================================================== -->
    <!-- TELA E MODAL DE OPÇÕES COMPLETA ("OPÇÕES DO JOGO")                  -->
    <!-- =================================================================== -->
    <transition name="menu-fade-300">
      <div
        v-if="screenFlow === 'OPTIONS_SCREEN' || isOptionsModalOpen"
        class="selecione-modo-screen options-screen-overlay"
        :class="{
          'selecione-modo-screen--in-game': isOptionsModalOpen,
        }"
      >
        <!-- Botão superior esquerdo (X) para fechar ou voltar ao Menu Principal -->
        <button
          type="button"
          class="mp-lobby-back-btn"
          title="Voltar (Esc)"
          @click="closeOptionsScreen"
        >
          <img
            :src="menuSprites.button_x"
            alt="Voltar"
            draggable="false"
          />
        </button>

        <!-- 1. Topo em Pedra: "OPÇÕES DO JOGO" -->
        <header class="selecione-modo-top-banner" aria-hidden="true">
          <div class="selecione-modo-stone-header">
            <div class="selecione-modo-stone-wing selecione-modo-stone-wing--left"></div>
            <div class="selecione-modo-stone-pillar"></div>
            <div class="selecione-modo-stone-center">
              <span class="selecione-modo-banner-title">OPÇÕES DO JOGO</span>
            </div>
            <div class="selecione-modo-stone-pillar"></div>
            <div class="selecione-modo-stone-wing selecione-modo-stone-wing--right"></div>
            <div class="selecione-modo-stone-ledge">
              <span></span><span></span><span></span>
            </div>
          </div>
        </header>

        <!-- 2. Painel Central Estilo LEGO com 4 Abas -->
        <div class="options-main-container">
          <!-- Abas de Navegação estilo Peça LEGO -->
          <div class="options-lego-tabs" role="tablist">
            <button
              type="button"
              role="tab"
              class="options-lego-tab-btn"
              :class="{
                'options-lego-tab-btn--active': optionsActiveTab === 'AUDIO',
              }"
              @click="
                optionsActiveTab = 'AUDIO';
                listeningKeybindAction = null;
                playToySfx('click');
              "
            >
              <span class="options-tab-studs" aria-hidden="true">
                <span></span><span></span><span></span>
              </span>
              <span class="options-tab-body">🔊 ÁUDIO &amp; GERAL</span>
            </button>

            <button
              type="button"
              role="tab"
              class="options-lego-tab-btn"
              :class="{
                'options-lego-tab-btn--active': optionsActiveTab === 'CONTROLS',
              }"
              @click="
                optionsActiveTab = 'CONTROLS';
                listeningKeybindAction = null;
                playToySfx('click');
              "
            >
              <span class="options-tab-studs" aria-hidden="true">
                <span></span><span></span><span></span>
              </span>
              <span class="options-tab-body">🎮 CONTROLES</span>
            </button>

            <button
              type="button"
              role="tab"
              class="options-lego-tab-btn"
              :class="{
                'options-lego-tab-btn--active': optionsActiveTab === 'GRAPHICS',
              }"
              @click="
                optionsActiveTab = 'GRAPHICS';
                listeningKeybindAction = null;
                playToySfx('click');
              "
            >
              <span class="options-tab-studs" aria-hidden="true">
                <span></span><span></span><span></span>
              </span>
              <span class="options-tab-body">🖥️ GRÁFICOS &amp; HUD</span>
            </button>

            <button
              type="button"
              role="tab"
              class="options-lego-tab-btn"
              :class="{
                'options-lego-tab-btn--active': optionsActiveTab === 'ACCOUNT',
              }"
              @click="
                optionsActiveTab = 'ACCOUNT';
                listeningKeybindAction = null;
                playToySfx('click');
              "
            >
              <span class="options-tab-studs" aria-hidden="true">
                <span></span><span></span><span></span>
              </span>
              <span class="options-tab-body">👤 CONTA &amp; SOCIAL</span>
            </button>
          </div>

          <!-- Quadro Principal de Opções -->
          <div class="options-brick-board">
            <!-- =========================================================== -->
            <!-- ABA 1: ÁUDIO & GERAL                                        -->
            <!-- =========================================================== -->
            <div v-if="optionsActiveTab === 'AUDIO'" class="options-tab-panel">
              <!-- Card de Volume Geral + Botão Mute + Testar Som -->
              <div class="options-section-card">
                <div class="options-section-header">
                  <div>
                    <h3 class="options-section-title">🔊 Controle de Volume</h3>
                    <p class="options-section-desc">
                      Ajuste o volume dos efeitos sintéticos de blocos, poderes e música
                    </p>
                  </div>
                  <div class="options-header-actions">
                    <button
                      type="button"
                      class="options-pill-btn"
                      :class="
                        optionsStore.state.isMuted
                          ? 'options-pill-btn--danger'
                          : 'options-pill-btn--secondary'
                      "
                      @click="toggleMuteAudio"
                    >
                      {{
                        optionsStore.state.isMuted
                          ? '🔇 MUDO ATIVO'
                          : '🔊 SOM ATIVO'
                      }}
                    </button>
                    <button
                      type="button"
                      class="options-pill-btn options-pill-btn--gold"
                      @click="playToySfx('victory')"
                    >
                      🎵 Testar Som
                    </button>
                  </div>
                </div>

                <!-- Volume Geral (Master) -->
                <div class="options-slider-row">
                  <div class="options-slider-label">
                    <span>🎚️ Volume Geral (Master)</span>
                    <strong class="mono">{{ optionsStore.state.masterVolume }}%</strong>
                  </div>
                  <input
                    type="range"
                    min="0"
                    max="100"
                    step="5"
                    :value="optionsStore.state.masterVolume"
                    class="options-range-slider"
                    @input="
                      setMasterVolume(
                        Number(($event.target as HTMLInputElement).value)
                      )
                    "
                    @change="playToySfx('click')"
                  />
                </div>

                <!-- Volume de Efeitos Sonoros (SFX) -->
                <div class="options-slider-row">
                  <div class="options-slider-label">
                    <span>🧱 Efeitos Sonoros (SFX de Peças e Poderes)</span>
                    <strong class="mono">{{ optionsStore.state.sfxVolume }}%</strong>
                  </div>
                  <input
                    type="range"
                    min="0"
                    max="100"
                    step="5"
                    :value="optionsStore.state.sfxVolume"
                    class="options-range-slider"
                    @input="
                      setSfxVolume(
                        Number(($event.target as HTMLInputElement).value)
                      )
                    "
                    @change="playToySfx('rotate')"
                  />
                </div>

                <!-- Volume da Música (BGM) -->
                <div class="options-slider-row">
                  <div class="options-slider-label">
                    <span>🎶 Música Ambiente (BGM)</span>
                    <strong class="mono">{{ optionsStore.state.bgmVolume }}%</strong>
                  </div>
                  <input
                    type="range"
                    min="0"
                    max="100"
                    step="5"
                    :value="optionsStore.state.bgmVolume"
                    class="options-range-slider"
                    @input="
                      setBgmVolume(
                        Number(($event.target as HTMLInputElement).value)
                      )
                    "
                    @change="playToySfx('click')"
                  />
                </div>
              </div>

              <!-- Opções Gerais de Tela e Assistência -->
              <div class="options-toggles-grid">
                <div class="options-toggle-item">
                  <div class="options-toggle-info">
                    <strong>🖥️ Modo Tela Cheia (Fullscreen)</strong>
                    <small>
                      Expande o jogo para ocupar 100% do monitor sem barras do navegador
                    </small>
                  </div>
                  <button
                    type="button"
                    class="options-switch-btn"
                    :class="{ 'options-switch-btn--on': isFullscreen }"
                    @click="toggleFullscreen"
                  >
                    {{ isFullscreen ? 'ATIVADO' : 'JANELA' }}
                  </button>
                </div>

                <div class="options-toggle-item">
                  <div class="options-toggle-info">
                    <strong>👻 Sombra de Encaixe (Ghost Piece)</strong>
                    <small>
                      Exibe a silhueta projetada na base/torre indicando onde a peça cairá
                    </small>
                  </div>
                  <button
                    type="button"
                    class="options-switch-btn"
                    :class="{ 'options-switch-btn--on': showGhostPiece }"
                    @click="toggleGhostPiece"
                  >
                    {{ showGhostPiece ? 'LIGADO' : 'DESLIGADO' }}
                  </button>
                </div>
              </div>
            </div>

            <!-- =========================================================== -->
            <!-- ABA 2: CONTROLES (LAYOUT VISUAL MINIMALISTA TRICKY)         -->
            <!-- =========================================================== -->
            <div
              v-else-if="optionsActiveTab === 'CONTROLS'"
              class="options-tab-panel tricky-controls-panel"
            >
              <!-- Seletor Minimalista de Esquema -->
              <div class="tricky-controls-scheme-bar">
                <button
                  type="button"
                  class="tricky-scheme-pill"
                  :class="{
                    'tricky-scheme-pill--active':
                      controlsViewDevice === 'KEYBOARD' &&
                      optionsStore.state.controlPreset === 'TRICKY',
                  }"
                  @click="selectKeyboardPreset('TRICKY')"
                >
                  Controle Tricky
                </button>
                <button
                  type="button"
                  class="tricky-scheme-pill"
                  :class="{
                    'tricky-scheme-pill--active':
                      controlsViewDevice === 'KEYBOARD' &&
                      optionsStore.state.controlPreset === 'WASD_QE',
                  }"
                  @click="selectKeyboardPreset('WASD_QE')"
                >
                  WASD
                </button>
                <button
                  type="button"
                  class="tricky-scheme-pill"
                  :class="{
                    'tricky-scheme-pill--active':
                      controlsViewDevice === 'GAMEPAD',
                  }"
                  @click="selectGamepadControlsView()"
                >
                  Gamepad
                </button>
              </div>

              <!-- Painel Visual Minimalista Integrado ao Popup -->
              <div class="tricky-controls-scroll">
                <div class="tricky-controls-scroll-body">
                  <!-- 1. MOVER BLOCO -->
                  <div class="tricky-ctrl-section">
                    <h4 class="tricky-ctrl-heading">MOVER BLOCO</h4>
                    <div class="tricky-ctrl-band tricky-ctrl-band--move">
                      <div class="tricky-ctrl-row">
                        <span class="tricky-arrow-tri" aria-hidden="true">◀</span>
                        <button
                          type="button"
                          class="tricky-keycap-btn"
                          :class="{
                            'tricky-keycap-btn--listening':
                              listeningKeybindAction === 'moveLeft',
                          }"
                          @click="startListeningKeybind('moveLeft')"
                        >
                          {{
                            controlsViewDevice === 'GAMEPAD'
                              ? 'D-Pad ⬅️'
                              : getPrimaryKeycapLabel('moveLeft')
                          }}
                        </button>

                        <button
                          type="button"
                          class="tricky-keycap-btn"
                          :class="{
                            'tricky-keycap-btn--listening':
                              listeningKeybindAction === 'moveRight',
                          }"
                          @click="startListeningKeybind('moveRight')"
                        >
                          {{
                            controlsViewDevice === 'GAMEPAD'
                              ? 'D-Pad ➡️'
                              : getPrimaryKeycapLabel('moveRight')
                          }}
                        </button>
                        <span class="tricky-arrow-tri" aria-hidden="true">▶</span>
                      </div>

                      <div class="tricky-ctrl-down-stack">
                        <button
                          type="button"
                          class="tricky-keycap-btn"
                          :class="{
                            'tricky-keycap-btn--listening':
                              listeningKeybindAction === 'softDrop',
                          }"
                          @click="startListeningKeybind('softDrop')"
                        >
                          {{
                            controlsViewDevice === 'GAMEPAD'
                              ? 'D-Pad ⬇️'
                              : getPrimaryKeycapLabel('softDrop')
                          }}
                        </button>
                        <span class="tricky-arrow-tri tricky-arrow-tri--down" aria-hidden="true">▼</span>
                      </div>
                    </div>
                  </div>

                  <!-- 2. GIRAR BLOCO -->
                  <div class="tricky-ctrl-section">
                    <h4 class="tricky-ctrl-heading">GIRAR BLOCO</h4>
                    <div class="tricky-ctrl-band">
                      <div class="tricky-ctrl-row">
                        <button
                          type="button"
                          class="tricky-keycap-btn"
                          :class="{
                            'tricky-keycap-btn--listening':
                              listeningKeybindAction === 'rotateCW',
                          }"
                          @click="startListeningKeybind('rotateCW')"
                        >
                          {{
                            controlsViewDevice === 'GAMEPAD'
                              ? '✕ / Cima'
                              : getPrimaryKeycapLabel('rotateCW')
                          }}
                        </button>
                      </div>
                    </div>
                  </div>

                  <!-- 3. EMPURRAR BLOCO -->
                  <div class="tricky-ctrl-section">
                    <h4 class="tricky-ctrl-heading">EMPURRAR BLOCO</h4>
                    <div class="tricky-ctrl-band">
                      <div class="tricky-ctrl-row">
                        <span class="tricky-arrow-tri tricky-arrow-tri--double" aria-hidden="true">◀◀</span>
                        <button
                          type="button"
                          class="tricky-keycap-btn"
                          :class="{
                            'tricky-keycap-btn--listening':
                              listeningKeybindAction === 'nudgeLeft',
                          }"
                          @click="startListeningKeybind('nudgeLeft')"
                        >
                          {{
                            controlsViewDevice === 'GAMEPAD'
                              ? 'L1'
                              : getPrimaryKeycapLabel('nudgeLeft')
                          }}
                        </button>

                        <button
                          type="button"
                          class="tricky-keycap-btn"
                          :class="{
                            'tricky-keycap-btn--listening':
                              listeningKeybindAction === 'nudgeRight',
                          }"
                          @click="startListeningKeybind('nudgeRight')"
                        >
                          {{
                            controlsViewDevice === 'GAMEPAD'
                              ? 'R1'
                              : getPrimaryKeycapLabel('nudgeRight')
                          }}
                        </button>
                        <span class="tricky-arrow-tri tricky-arrow-tri--double" aria-hidden="true">▶▶</span>
                      </div>
                    </div>
                  </div>

                  <!-- 4. MAGIA DE LUZ -->
                  <div class="tricky-ctrl-section tricky-ctrl-section--magic">
                    <div class="tricky-magic-header">
                      <span class="tricky-magic-orb tricky-magic-orb--light" aria-hidden="true" />
                      <h4 class="tricky-ctrl-heading tricky-ctrl-heading--magic">
                        MAGIA DE LUZ
                      </h4>
                    </div>
                    <div class="tricky-ctrl-band">
                      <div class="tricky-ctrl-row">
                        <button
                          type="button"
                          class="tricky-keycap-btn"
                          :class="{
                            'tricky-keycap-btn--listening':
                              listeningKeybindAction === 'selfPower',
                          }"
                          @click="startListeningKeybind('selfPower')"
                        >
                          {{
                            controlsViewDevice === 'GAMEPAD'
                              ? '□ Quadrado'
                              : getPrimaryKeycapLabel('selfPower')
                          }}
                        </button>
                      </div>
                    </div>
                  </div>

                  <!-- 5. MAGIA DAS TREVAS -->
                  <div class="tricky-ctrl-section tricky-ctrl-section--magic">
                    <div class="tricky-magic-header">
                      <span class="tricky-magic-orb tricky-magic-orb--dark" aria-hidden="true" />
                      <h4 class="tricky-ctrl-heading tricky-ctrl-heading--magic">
                        MAGIA DAS TREVAS
                      </h4>
                    </div>
                    <div class="tricky-ctrl-band">
                      <div class="tricky-ctrl-row">
                        <button
                          type="button"
                          class="tricky-keycap-btn"
                          :class="{
                            'tricky-keycap-btn--listening':
                              listeningKeybindAction === 'attackPower',
                          }"
                          @click="startListeningKeybind('attackPower')"
                        >
                          {{
                            controlsViewDevice === 'GAMEPAD'
                              ? '○ Círculo'
                              : getPrimaryKeycapLabel('attackPower')
                          }}
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <!-- =========================================================== -->
            <!-- ABA 3: GRÁFICOS, FÍSICA LOCAL & HUD                         -->
            <!-- =========================================================== -->
            <div
              v-else-if="optionsActiveTab === 'GRAPHICS'"
              class="options-tab-panel"
            >
              <div class="options-toggles-grid">
                <div class="options-toggle-item">
                  <div class="options-toggle-info">
                    <strong>🎨 Colorização Plástica 3-Tons (ABS)</strong>
                    <small>
                      Pinta os blocos em 10 cores vibrantes de brinquedo (desative para cinza original)
                    </small>
                  </div>
                  <button
                    type="button"
                    class="options-switch-btn"
                    :class="{ 'options-switch-btn--on': dynamicTintEnabled }"
                    @click="toggleDynamicTint"
                  >
                    {{ dynamicTintEnabled ? 'ATIVO (3-TONS)' : 'CINZA' }}
                  </button>
                </div>

                <div class="options-toggle-item">
                  <div class="options-toggle-info">
                    <strong>💨 Efeito de Vento e Folhas (15m+)</strong>
                    <small>
                      Ativa rajadas de vento e partículas de folhas a partir de 15m de altura no modo local
                    </small>
                  </div>
                  <button
                    type="button"
                    class="options-switch-btn"
                    :class="{ 'options-switch-btn--on': windEnabled }"
                    @click="toggleWind"
                  >
                    {{ windEnabled ? 'LIGADO' : 'DESLIGADO' }}
                  </button>
                </div>

                <div class="options-toggle-item">
                  <div class="options-toggle-info">
                    <strong>💥 Impacto Visual (Screen Shake)</strong>
                    <small>
                      Vibração sutil ao encaixar blocos pesados e receber poderes de caos
                    </small>
                  </div>
                  <button
                    type="button"
                    class="options-switch-btn"
                    :class="{
                      'options-switch-btn--on':
                        optionsStore.state.screenShakeEnabled,
                    }"
                    @click="toggleScreenShakeOption"
                  >
                    {{
                      optionsStore.state.screenShakeEnabled
                        ? 'LIGADO'
                        : 'DESLIGADO'
                    }}
                  </button>
                </div>

                <div class="options-toggle-item">
                  <div class="options-toggle-info">
                    <strong>📊 Contador de FPS &amp; Status de Rede</strong>
                    <small>
                      Exibe a taxa de quadros por segundo (FPS) no topo esquerdo durante a partida
                    </small>
                  </div>
                  <button
                    type="button"
                    class="options-switch-btn"
                    :class="{
                      'options-switch-btn--on': optionsStore.state.showFpsPing,
                    }"
                    @click="toggleShowFpsPingOption"
                  >
                    {{
                      optionsStore.state.showFpsPing ? 'VISÍVEL' : 'OCULTO'
                    }}
                  </button>
                </div>

                <div class="options-toggle-item">
                  <div class="options-toggle-info">
                    <strong>🏷️ Mostrar @handle nas Torres Adversárias</strong>
                    <small>
                      Exibe o identificador @nome_000 abaixo do apelido nas raias do Multiplayer
                    </small>
                  </div>
                  <button
                    type="button"
                    class="options-switch-btn"
                    :class="{
                      'options-switch-btn--on':
                        optionsStore.state.showOpponentHandles,
                    }"
                    @click="toggleShowOpponentHandlesOption"
                  >
                    {{
                      optionsStore.state.showOpponentHandles
                        ? 'VISÍVEL'
                        : 'OCULTO'
                    }}
                  </button>
                </div>
              </div>
            </div>

            <!-- =========================================================== -->
            <!-- ABA 4: CONTA, SKIN & PRIVACIDADE SOCIAL                     -->
            <!-- =========================================================== -->
            <div v-else class="options-tab-panel">
              <!-- Perfil e Apelido -->
              <div class="options-section-card">
                <div class="options-section-header">
                  <div>
                    <h3 class="options-section-title">
                      👤 Perfil de Jogador &amp; Conta Google
                    </h3>
                    <p class="options-section-desc">
                      Personalize como você aparece na Sala Multiplayer e na Grande Copa
                    </p>
                  </div>
                  <button
                    v-if="authStore.state.user"
                    type="button"
                    class="options-pill-btn options-pill-btn--gold"
                    @click="copyMyHandle"
                  >
                    📋 Copiar {{ authStore.state.user.handle }}
                  </button>
                </div>

                <div class="options-account-row">
                  <div class="options-nick-editor">
                    <label class="options-field-label" for="options-nick-input">
                      Apelido na Sala (2 a 16 caracteres):
                    </label>
                    <div class="options-nick-input-group">
                      <input
                        id="options-nick-input"
                        v-model="optionsNickInput"
                        type="text"
                        maxlength="16"
                        placeholder="Seu apelido..."
                        class="options-text-input"
                        @keydown.enter.prevent="saveOptionsCustomNick"
                      />
                      <button
                        type="button"
                        class="options-pill-btn options-pill-btn--green"
                        :disabled="isSavingCustomNick"
                        @click="saveOptionsCustomNick"
                      >
                        {{ isSavingCustomNick ? 'SALVANDO...' : 'SALVAR APELIDO' }}
                      </button>
                    </div>
                  </div>

                  <div class="options-account-status-box">
                    <template v-if="authStore.state.user">
                      <img
                        :src="authStore.state.user.avatarUrl"
                        :alt="authStore.state.user.displayName"
                        class="options-account-avatar"
                        referrerpolicy="no-referrer"
                      />
                      <div class="options-account-meta">
                        <strong>{{ authStore.state.user.displayName }}</strong>
                        <small>{{ authStore.state.user.email }}</small>
                      </div>
                      <button
                        type="button"
                        class="options-pill-btn options-pill-btn--danger"
                        @click="handleLogout"
                      >
                        🚪 Sair
                      </button>
                    </template>
                    <template v-else>
                      <div class="options-account-meta">
                        <strong>Conta Offline (Convidado)</strong>
                        <small>
                          Conecte sua conta Google para adicionar amigos e jogar online
                        </small>
                      </div>
                      <button
                        type="button"
                        class="options-pill-btn options-pill-btn--gold"
                        @click="
                          closeOptionsScreen();
                          isAuthModalOpen = true;
                        "
                      >
                        🔑 Conectar Google
                      </button>
                    </template>
                  </div>
                </div>
              </div>

              <!-- Seletor Rápido de Skin do Mascote -->
              <div class="options-section-card">
                <h3 class="options-section-title" style="margin-bottom: 8px">
                  🎭 Personagem Equipado
                </h3>
                <div class="options-skins-row">
                  <button
                    v-for="skin in playerSkins"
                    :key="skin.id"
                    type="button"
                    class="options-skin-chip"
                    :class="{
                      'options-skin-chip--active':
                        activePlayerSkinId === skin.id,
                    }"
                    @click="selectPlayerSkin(skin.id)"
                  >
                    <img
                      :src="skin.url"
                      :alt="skin.name"
                      class="options-skin-chip-img"
                      draggable="false"
                    />
                    <div class="options-skin-chip-text">
                      <strong>{{ skin.shortName }}</strong>
                      <small>{{ skin.name }}</small>
                    </div>
                  </button>
                </div>
              </div>

              <!-- Privacidade de Convites -->
              <div class="options-toggles-grid">
                <div class="options-toggle-item">
                  <div class="options-toggle-info">
                    <strong>📨 Alertas de Convite durante a Partida</strong>
                    <small>
                      Exibe notificações no topo caso um amigo te convide enquanto você está jogando
                    </small>
                  </div>
                  <button
                    type="button"
                    class="options-switch-btn"
                    :class="{
                      'options-switch-btn--on':
                        optionsStore.state.allowInvitesInGame,
                    }"
                    @click="toggleAllowInvitesInGameOption"
                  >
                    {{
                      optionsStore.state.allowInvitesInGame
                        ? 'PERMITIR'
                        : 'SILENCIAR'
                    }}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>

        <!-- 3. Botões LEGO no Canto Inferior Direito: RESTAURAR, PRONTO e VOLTAR -->
        <div class="selecione-modo-bottom-right-actions">
          <button
            type="button"
            class="selecione-action-brick-btn selecione-action-brick-btn--ready"
            @click="closeOptionsScreen"
          >
            <span class="selecione-action-studs" aria-hidden="true">
              <span></span><span></span><span></span>
            </span>
            <span class="selecione-action-body">SALVAR</span>
          </button>

          <button
            type="button"
            class="selecione-action-brick-btn selecione-action-brick-btn--reset"
            title="Restaurar todas as opções para os valores de fábrica"
            @click="handleResetOptions"
          >
            <span class="selecione-action-studs" aria-hidden="true">
              <span></span><span></span><span></span>
            </span>
            <span class="selecione-action-body">PADRÃO</span>
          </button>

          <button
            type="button"
            class="selecione-action-brick-btn selecione-action-brick-btn--back"
            @click="closeOptionsScreen"
          >
            <span class="selecione-action-studs" aria-hidden="true">
              <span></span><span></span><span></span>
            </span>
            <span class="selecione-action-body">VOLTAR</span>
          </button>
        </div>
      </div>
    </transition>

    <!-- =================================================================== -->
    <!-- TELA E POPUP DE SELEÇÃO DE MODO ("SELECIONE O MODO")                -->
    <!-- =================================================================== -->
    <transition name="menu-fade-300">
      <div
        v-if="screenFlow === 'LOCAL_LOBBY' || isGameModeModalOpen"
        class="selecione-modo-screen"
        :class="{
          'selecione-modo-screen--in-game': screenFlow === 'IN_GAME',
        }"
      >
        <!-- Botão superior esquerdo (X) para fechar o popup ou voltar ao Menu Principal -->
        <button
          type="button"
          class="mp-lobby-back-btn"
          :title="
            isGameModeModalOpen
              ? 'Fechar seleção de modo (Esc)'
              : 'Voltar ao Menu Principal (Esc)'
          "
          @click="
            isGameModeModalOpen ? closeGameModeModal() : returnToMainMenu()
          "
        >
          <img
            :src="menuSprites.button_x"
            alt="Voltar"
            draggable="false"
          />
        </button>

        <!-- 1. Topo em Pedra: "SELECIONE O MODO" -->
        <header class="selecione-modo-top-banner" aria-hidden="true">
          <div class="selecione-modo-stone-header">
            <div class="selecione-modo-stone-wing selecione-modo-stone-wing--left"></div>
            <div class="selecione-modo-stone-pillar"></div>
            <div class="selecione-modo-stone-center">
              <span class="selecione-modo-banner-title">SELECIONE O MODO</span>
            </div>
            <div class="selecione-modo-stone-pillar"></div>
            <div class="selecione-modo-stone-wing selecione-modo-stone-wing--right"></div>
            <div class="selecione-modo-stone-ledge">
              <span></span><span></span><span></span>
            </div>
          </div>
        </header>

        <!-- 2. Dois Grandes Blocos Centrais com Setas ▲ / ▼ -->
        <div class="selecione-modo-stage">
          <!-- COLUNA ESQUERDA: MODO DE JOGO (ALEATÓRIO / CORRIDA / SOBREVIVÊNCIA) -->
          <div
            class="selecione-modo-col"
            @mouseenter="selectedModeScreenColumn = 'MODE'"
            @click="selectedModeScreenColumn = 'MODE'"
          >
            <!-- Seta Superior ▲ -->
            <button
              type="button"
              class="selecione-modo-arrow-btn"
              title="Modo anterior"
              aria-label="Modo anterior"
              @click.stop="cycleGameModeOption(-1)"
            >
              <svg viewBox="0 0 84 52" aria-hidden="true">
                <path
                  d="M 36,6 Q 42,0 48,6 L 78,38 Q 84,45 75,47 H 9 Q 0,45 6,38 Z"
                  fill="#94a3b8"
                  stroke="#181425"
                  stroke-width="4"
                  stroke-linejoin="round"
                />
                <path
                  d="M 38,10 Q 42,6 46,10 L 72,38 H 12 Z"
                  fill="#cbd5e1"
                />
                <polygon
                  points="42,16 58,34 26,34"
                  fill="#f97316"
                  stroke="#9a3412"
                  stroke-width="2"
                  stroke-linejoin="round"
                />
              </svg>
            </button>

            <!-- Cartão Quadrado de Parede LEGO -->
            <div
              class="selecione-modo-brick-box"
              :class="{
                'selecione-modo-brick-box--active':
                  selectedModeScreenColumn === 'MODE',
              }"
              @click="selectedModeScreenColumn = 'MODE'"
            >
              <!-- 8 Pinos Superiores Escuros -->
              <div class="selecione-modo-box-studs" aria-hidden="true">
                <span v-for="s in 8" :key="s"></span>
              </div>

              <!-- 4 Cantoneiras Amarelas/Laranjas quando focado -->
              <template v-if="selectedModeScreenColumn === 'MODE'">
                <span class="selecione-corner selecione-corner--tl" aria-hidden="true"></span>
                <span class="selecione-corner selecione-corner--tr" aria-hidden="true"></span>
                <span class="selecione-corner selecione-corner--bl" aria-hidden="true"></span>
                <span class="selecione-corner selecione-corner--br" aria-hidden="true"></span>
              </template>

              <!-- CONTEÚDO INTERNO DO MODO: ALEATÓRIO (DIVIDIDO NA DIAGONAL) -->
              <div
                v-if="currentLobbySelectableMode === 'RANDOM'"
                class="selecione-modo-card-inner selecione-modo-card-inner--random"
              >
                <!-- Metade Superior Esquerda: Pirata na nuvem com bandeira de corrida -->
                <div class="selecione-random-half selecione-random-half--tl">
                  <div class="selecione-char-cloud-wrap selecione-char-cloud-wrap--tl">
                    <img
                      :src="getSkinSpriteUrl('player_pirate')"
                      alt=""
                      class="selecione-char-img"
                      draggable="false"
                    />
                    <!-- Bandeira Quadriculada -->
                    <svg class="selecione-mini-flag-svg" viewBox="0 0 64 64" aria-hidden="true">
                      <rect
                        x="8"
                        y="6"
                        width="5"
                        height="52"
                        rx="2.5"
                        fill="#b45309"
                        stroke="#181425"
                        stroke-width="3"
                      />
                      <path
                        d="M 13,9 C 26,4 38,16 54,10 L 54,36 C 38,42 26,30 13,35 Z"
                        fill="#ffffff"
                        stroke="#181425"
                        stroke-width="3"
                        stroke-linejoin="round"
                      />
                      <path
                        d="M 13,9 L 23,8 L 23,17 L 13,18 Z M 33,10 L 43,12 L 43,21 L 33,19 Z M 23,17 L 33,19 L 33,28 L 23,26 Z M 43,21 L 54,19 L 54,28 L 43,30 Z M 13,26 L 23,26 L 23,35 L 13,35 Z M 33,28 L 43,30 L 43,38 L 33,36 Z"
                        fill="#181425"
                      />
                    </svg>
                    <!-- Nuvem Branca -->
                    <svg class="selecione-cloud-svg" viewBox="0 0 140 60" aria-hidden="true">
                      <path
                        d="M 28,50 C 14,50 8,40 13,30 C 16,23 24,20 31,22 C 36,11 49,6 62,10 C 70,3 85,3 93,11 C 104,8 118,14 120,25 C 129,27 134,35 130,43 C 127,48 120,50 111,50 Z"
                        fill="#ffffff"
                        stroke="#181425"
                        stroke-width="3.8"
                        stroke-linejoin="round"
                      />
                      <path
                        d="M 22,43 C 36,48 104,48 120,42"
                        fill="none"
                        stroke="#cbd5e1"
                        stroke-width="4"
                        stroke-linecap="round"
                      />
                    </svg>
                  </div>
                </div>

                <!-- Metade Inferior Direita: Dino na nuvem com corações -->
                <div class="selecione-random-half selecione-random-half--br">
                  <div class="selecione-char-cloud-wrap selecione-char-cloud-wrap--br">
                    <!-- Corações flutuantes ao redor do Dino -->
                    <span class="selecione-floating-heart selecione-floating-heart--1">❤️</span>
                    <span class="selecione-floating-heart selecione-floating-heart--2">❤️</span>
                    <span class="selecione-floating-heart selecione-floating-heart--3">❤️</span>
                    <span class="selecione-floating-heart selecione-floating-heart--4">❤️</span>
                    <img
                      :src="getSkinSpriteUrl('player_dino')"
                      alt=""
                      class="selecione-char-img"
                      draggable="false"
                    />
                    <svg class="selecione-cloud-svg" viewBox="0 0 140 60" aria-hidden="true">
                      <path
                        d="M 28,50 C 14,50 8,40 13,30 C 16,23 24,20 31,22 C 36,11 49,6 62,10 C 70,3 85,3 93,11 C 104,8 118,14 120,25 C 129,27 134,35 130,43 C 127,48 120,50 111,50 Z"
                        fill="#ffffff"
                        stroke="#181425"
                        stroke-width="3.8"
                        stroke-linejoin="round"
                      />
                      <path
                        d="M 22,43 C 36,48 104,48 120,42"
                        fill="none"
                        stroke="#cbd5e1"
                        stroke-width="4"
                        stroke-linecap="round"
                      />
                    </svg>
                  </div>
                </div>

                <!-- Linha Diagonal Divisória -->
                <svg class="selecione-diagonal-line" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
                  <line x1="100" y1="0" x2="0" y2="100" stroke="#181425" stroke-width="1.6" />
                </svg>

                <div class="selecione-card-bottom-captions">
                  <span class="selecione-card-main-title">ALEATÓRIO</span>
                  <span class="selecione-card-sub-title">Sorteia entre os 4 modos</span>
                </div>
              </div>

              <!-- CONTEÚDO INTERNO DO MODO: CORRIDA (30m) -->
              <div
                v-else-if="currentLobbySelectableMode === 'RACE'"
                class="selecione-modo-card-inner"
              >
                <div class="selecione-single-mode-art">
                  <div class="selecione-char-cloud-wrap selecione-char-cloud-wrap--center">
                    <img
                      :src="getSkinSpriteUrl('player_pirate')"
                      alt=""
                      class="selecione-char-img selecione-char-img--large"
                      draggable="false"
                    />
                    <svg class="selecione-mini-flag-svg selecione-mini-flag-svg--large" viewBox="0 0 64 64" aria-hidden="true">
                      <rect
                        x="8"
                        y="6"
                        width="5"
                        height="52"
                        rx="2.5"
                        fill="#b45309"
                        stroke="#181425"
                        stroke-width="3"
                      />
                      <path
                        d="M 13,9 C 26,4 38,16 54,10 L 54,36 C 38,42 26,30 13,35 Z"
                        fill="#ffffff"
                        stroke="#181425"
                        stroke-width="3"
                        stroke-linejoin="round"
                      />
                      <path
                        d="M 13,9 L 23,8 L 23,17 L 13,18 Z M 33,10 L 43,12 L 43,21 L 33,19 Z M 23,17 L 33,19 L 33,28 L 23,26 Z M 43,21 L 54,19 L 54,28 L 43,30 Z M 13,26 L 23,26 L 23,35 L 13,35 Z M 33,28 L 43,30 L 43,38 L 33,36 Z"
                        fill="#181425"
                      />
                    </svg>
                    <svg class="selecione-cloud-svg selecione-cloud-svg--large" viewBox="0 0 140 60" aria-hidden="true">
                      <path
                        d="M 28,50 C 14,50 8,40 13,30 C 16,23 24,20 31,22 C 36,11 49,6 62,10 C 70,3 85,3 93,11 C 104,8 118,14 120,25 C 129,27 134,35 130,43 C 127,48 120,50 111,50 Z"
                        fill="#ffffff"
                        stroke="#181425"
                        stroke-width="3.8"
                        stroke-linejoin="round"
                      />
                      <path
                        d="M 22,43 C 36,48 104,48 120,42"
                        fill="none"
                        stroke="#cbd5e1"
                        stroke-width="4"
                        stroke-linecap="round"
                      />
                    </svg>
                  </div>
                </div>
                <div class="selecione-card-bottom-captions">
                  <span class="selecione-card-main-title">CORRIDA</span>
                  <span class="selecione-card-sub-title">Meta de 30m</span>
                </div>
              </div>

              <!-- CONTEÚDO INTERNO DO MODO: QUEBRA-CABEÇA (ABAIXO DO LASER - 9m) -->
              <div
                v-else-if="currentLobbySelectableMode === 'PUZZLE'"
                class="selecione-modo-card-inner selecione-modo-card-inner--puzzle"
              >
                <div class="selecione-single-mode-art">
                  <div class="selecione-char-cloud-wrap selecione-char-cloud-wrap--center">
                    <!-- Feixe de Laser Vermelho Horizontal (9m) no Topo da Ilustração -->
                    <svg
                      class="selecione-puzzle-laser-svg"
                      viewBox="0 0 190 42"
                      aria-hidden="true"
                    >
                      <!-- Emissor Esquerdo -->
                      <rect
                        x="4"
                        y="10"
                        width="16"
                        height="22"
                        rx="3"
                        fill="#334155"
                        stroke="#181425"
                        stroke-width="3"
                      />
                      <!-- Emissor Direito -->
                      <rect
                        x="170"
                        y="10"
                        width="16"
                        height="22"
                        rx="3"
                        fill="#334155"
                        stroke="#181425"
                        stroke-width="3"
                      />
                      <!-- Brilho Externo do Laser -->
                      <line
                        x1="20"
                        y1="21"
                        x2="170"
                        y2="21"
                        stroke="#ef4444"
                        stroke-width="9"
                        stroke-linecap="round"
                        opacity="0.55"
                      />
                      <!-- Feixe Central Intenso -->
                      <line
                        x1="20"
                        y1="21"
                        x2="170"
                        y2="21"
                        stroke="#fef08a"
                        stroke-width="3.5"
                        stroke-linecap="round"
                      />
                      <!-- Tag 9m -->
                      <rect
                        x="68"
                        y="2"
                        width="54"
                        height="16"
                        rx="8"
                        fill="#991b1b"
                        stroke="#fca5a5"
                        stroke-width="1.8"
                      />
                      <text
                        x="95"
                        y="13"
                        text-anchor="middle"
                        fill="#fef08a"
                        font-size="10"
                        font-weight="900"
                      >
                        ⚡ 9m
                      </text>
                    </svg>

                    <span class="selecione-floating-heart selecione-floating-heart--1">🧩</span>
                    <span class="selecione-floating-heart selecione-floating-heart--2">🧴</span>
                    <img
                      :src="getSkinSpriteUrl('player_mage')"
                      alt=""
                      class="selecione-char-img selecione-char-img--large"
                      draggable="false"
                    />
                    <!-- Pilar Estreito de Pedra sobre a Água -->
                    <svg class="selecione-cloud-svg selecione-cloud-svg--large" viewBox="0 0 140 60" aria-hidden="true">
                      <!-- Ondas de Água na Base -->
                      <path
                        d="M 10,52 Q 35,44 70,52 T 130,52 L 130,58 L 10,58 Z"
                        fill="#0284c7"
                        stroke="#181425"
                        stroke-width="3"
                      />
                      <!-- Pilar Central Estreito (3 blocos) -->
                      <rect
                        x="46"
                        y="18"
                        width="48"
                        height="36"
                        rx="4"
                        fill="#64748b"
                        stroke="#181425"
                        stroke-width="3.6"
                      />
                      <rect
                        x="42"
                        y="12"
                        width="56"
                        height="11"
                        rx="3"
                        fill="#22c55e"
                        stroke="#181425"
                        stroke-width="3.2"
                      />
                    </svg>
                  </div>
                </div>
                <div class="selecione-card-bottom-captions">
                  <span class="selecione-card-main-title selecione-card-main-title--fit">
                    QUEBRA-CABEÇA
                  </span>
                  <span class="selecione-card-sub-title">Abaixo do Laser - 9m</span>
                </div>
              </div>

              <!-- CONTEÚDO INTERNO DO MODO: INFINITO / ABISMO (ENDLESS) -->
              <div
                v-else-if="currentLobbySelectableMode === 'ENDLESS'"
                class="selecione-modo-card-inner selecione-modo-card-inner--endless"
              >
                <div class="selecione-single-mode-art">
                  <div class="selecione-char-cloud-wrap selecione-char-cloud-wrap--center">
                    <!-- Linha Pontilhada de Losangos Cianos + Bandeiras de Checkpoint no Topo -->
                    <svg
                      class="selecione-puzzle-laser-svg"
                      viewBox="0 0 190 42"
                      aria-hidden="true"
                    >
                      <!-- Bandeira Esquerda -->
                      <rect x="10" y="6" width="4" height="28" rx="2" fill="#475569" stroke="#181425" stroke-width="2" />
                      <polygon points="14,7 36,13 14,19" fill="#0ea5e9" stroke="#181425" stroke-width="2" />
                      <!-- Bandeira Direita -->
                      <rect x="176" y="6" width="4" height="28" rx="2" fill="#475569" stroke="#181425" stroke-width="2" />
                      <polygon points="176,7 154,13 176,19" fill="#0ea5e9" stroke="#181425" stroke-width="2" />
                      <!-- Losangos Azuis/Cianos -->
                      <polygon points="50,15 55,20 50,25 45,20" fill="#38bdf8" stroke="#181425" stroke-width="1.5" />
                      <polygon points="72,15 77,20 72,25 67,20" fill="#38bdf8" stroke="#181425" stroke-width="1.5" />
                      <polygon points="95,15 100,20 95,25 90,20" fill="#e0f2fe" stroke="#0284c7" stroke-width="1.5" />
                      <polygon points="118,15 123,20 118,25 113,20" fill="#38bdf8" stroke="#181425" stroke-width="1.5" />
                      <polygon points="140,15 145,20 140,25 135,20" fill="#38bdf8" stroke="#181425" stroke-width="1.5" />
                    </svg>

                    <span class="selecione-floating-heart selecione-floating-heart--1">🌌</span>
                    <span class="selecione-floating-heart selecione-floating-heart--2">🪨</span>
                    <img
                      :src="getSkinSpriteUrl('player_shadow')"
                      alt=""
                      class="selecione-char-img selecione-char-img--large"
                      draggable="false"
                    />
                    <!-- Linha de Petrificação Brilhante + Base de Pedra Cinza e Névoa do Abismo -->
                    <svg class="selecione-cloud-svg selecione-cloud-svg--large" viewBox="0 0 140 60" aria-hidden="true">
                      <!-- Cortina Escura do Abismo -->
                      <rect x="8" y="26" width="124" height="32" rx="6" fill="#1e293b" opacity="0.92" />
                      <!-- Blocos Petrificados Cinza -->
                      <rect x="34" y="28" width="24" height="18" rx="2" fill="#64748b" stroke="#0f172a" stroke-width="2.5" />
                      <rect x="58" y="26" width="26" height="20" rx="2" fill="#94a3b8" stroke="#0f172a" stroke-width="2.5" />
                      <rect x="84" y="30" width="22" height="16" rx="2" fill="#64748b" stroke="#0f172a" stroke-width="2.5" />
                      <!-- Linha Horizontal Brilhante (petrifyLineY) -->
                      <line x1="6" y1="26" x2="134" y2="26" stroke="#38bdf8" stroke-width="6" stroke-linecap="round" opacity="0.55" />
                      <line x1="6" y1="26" x2="134" y2="26" stroke="#f8fafc" stroke-width="2.5" stroke-linecap="round" />
                    </svg>
                  </div>
                </div>
                <div class="selecione-card-bottom-captions">
                  <span class="selecione-card-main-title selecione-card-main-title--fit">
                    INFINITO / ABISMO
                  </span>
                  <span class="selecione-card-sub-title">Score Recorde • Abismo</span>
                </div>
              </div>

              <!-- CONTEÚDO INTERNO DO MODO: SOBREVIVÊNCIA -->
              <div
                v-else
                class="selecione-modo-card-inner"
              >
                <div class="selecione-single-mode-art">
                  <div class="selecione-char-cloud-wrap selecione-char-cloud-wrap--center">
                    <span class="selecione-floating-heart selecione-floating-heart--1">❤️</span>
                    <span class="selecione-floating-heart selecione-floating-heart--2">❤️</span>
                    <span class="selecione-floating-heart selecione-floating-heart--3">❤️</span>
                    <span class="selecione-floating-heart selecione-floating-heart--4">❤️</span>
                    <img
                      :src="getSkinSpriteUrl('player_dino')"
                      alt=""
                      class="selecione-char-img selecione-char-img--large"
                      draggable="false"
                    />
                    <svg class="selecione-cloud-svg selecione-cloud-svg--large" viewBox="0 0 140 60" aria-hidden="true">
                      <path
                        d="M 28,50 C 14,50 8,40 13,30 C 16,23 24,20 31,22 C 36,11 49,6 62,10 C 70,3 85,3 93,11 C 104,8 118,14 120,25 C 129,27 134,35 130,43 C 127,48 120,50 111,50 Z"
                        fill="#ffffff"
                        stroke="#181425"
                        stroke-width="3.8"
                        stroke-linejoin="round"
                      />
                      <path
                        d="M 22,43 C 36,48 104,48 120,42"
                        fill="none"
                        stroke="#cbd5e1"
                        stroke-width="4"
                        stroke-linecap="round"
                      />
                    </svg>
                  </div>
                </div>
                <div class="selecione-card-bottom-captions">
                  <span class="selecione-card-main-title">SOBREVIVÊNCIA</span>
                  <span class="selecione-card-sub-title">3 Vidas • 50 Peças</span>
                </div>
              </div>
            </div>

            <!-- Seta Inferior ▼ -->
            <button
              type="button"
              class="selecione-modo-arrow-btn"
              title="Próximo modo"
              aria-label="Próximo modo"
              @click.stop="cycleGameModeOption(1)"
            >
              <svg viewBox="0 0 84 52" aria-hidden="true">
                <path
                  d="M 9,5 H 75 Q 84,7 78,14 L 48,46 Q 42,52 36,46 L 6,14 Q 0,7 9,5 Z"
                  fill="#94a3b8"
                  stroke="#181425"
                  stroke-width="4"
                  stroke-linejoin="round"
                />
                <path
                  d="M 12,14 H 72 L 46,42 Q 42,46 38,42 Z"
                  fill="#cbd5e1"
                />
                <polygon
                  points="42,36 58,18 26,18"
                  fill="#f97316"
                  stroke="#9a3412"
                  stroke-width="2"
                  stroke-linejoin="round"
                />
              </svg>
            </button>
          </div>

          <!-- COLUNA DIREITA: CONDIÇÃO DE VITÓRIA / COPA (APENAS NO MULTIPLAYER) -->
          <div
            v-if="showCupSelectionColumn"
            class="selecione-modo-col"
            @mouseenter="selectedModeScreenColumn = 'CUP'"
            @click="selectedModeScreenColumn = 'CUP'"
          >
            <!-- Seta Superior ▲ -->
            <button
              type="button"
              class="selecione-modo-arrow-btn"
              title="Copa anterior"
              aria-label="Copa anterior"
              @click.stop="cycleVictoryConditionOption(-1)"
            >
              <svg viewBox="0 0 84 52" aria-hidden="true">
                <path
                  d="M 36,6 Q 42,0 48,6 L 78,38 Q 84,45 75,47 H 9 Q 0,45 6,38 Z"
                  fill="#94a3b8"
                  stroke="#181425"
                  stroke-width="4"
                  stroke-linejoin="round"
                />
                <path
                  d="M 38,10 Q 42,6 46,10 L 72,38 H 12 Z"
                  fill="#cbd5e1"
                />
                <polygon
                  points="42,16 58,34 26,34"
                  fill="#f97316"
                  stroke="#9a3412"
                  stroke-width="2"
                  stroke-linejoin="round"
                />
              </svg>
            </button>

            <!-- Cartão Quadrado de Parede LEGO -->
            <div
              class="selecione-modo-brick-box"
              :class="{
                'selecione-modo-brick-box--active':
                  selectedModeScreenColumn === 'CUP',
              }"
              @click="selectedModeScreenColumn = 'CUP'"
            >
              <!-- 8 Pinos Superiores Escuros -->
              <div class="selecione-modo-box-studs" aria-hidden="true">
                <span v-for="s in 8" :key="s"></span>
              </div>

              <!-- 4 Cantoneiras Amarelas/Laranjas quando focado -->
              <template v-if="selectedModeScreenColumn === 'CUP'">
                <span class="selecione-corner selecione-corner--tl" aria-hidden="true"></span>
                <span class="selecione-corner selecione-corner--tr" aria-hidden="true"></span>
                <span class="selecione-corner selecione-corner--bl" aria-hidden="true"></span>
                <span class="selecione-corner selecione-corner--br" aria-hidden="true"></span>
              </template>

              <div class="selecione-modo-card-inner selecione-modo-card-inner--cup">
                <!-- Ilustração dos Troféus (1 troféu = Copa 1 | 2 troféus = Copa 6 | 3 troféus brilhando = Copa 12) -->
                <div class="selecione-cup-art" aria-hidden="true">
                  <svg
                    viewBox="0 0 240 175"
                    class="selecione-cup-svg"
                    :class="{
                      'selecione-cup-svg--shining':
                        currentLobbyVictoryCondition === 'CUP_12',
                    }"
                  >
                    <defs>
                      <radialGradient
                        id="selecioneCup12Glow"
                        cx="50%"
                        cy="50%"
                        r="50%"
                      >
                        <stop offset="0%" stop-color="#fff3bf" stop-opacity="0.95" />
                        <stop offset="55%" stop-color="#ffd43b" stop-opacity="0.45" />
                        <stop offset="100%" stop-color="#fcc419" stop-opacity="0" />
                      </radialGradient>

                      <!-- Ramo Esquerdo de Louros -->
                      <g
                        id="selecioneLaurelLeft"
                        stroke="#181425"
                        stroke-width="3"
                        stroke-linejoin="round"
                      >
                        <path
                          d="M 98,136 C 62,128 42,96 46,56 C 58,62 66,74 66,86 C 54,74 54,52 62,38 C 72,48 76,62 74,76 C 68,60 74,44 84,34 C 90,46 90,62 84,76 C 82,98 88,116 104,128 Z"
                          fill="#40c057"
                        />
                        <circle cx="52" cy="72" r="8" fill="#69db7c" />
                        <circle cx="64" cy="96" r="9" fill="#51cf66" />
                        <circle cx="80" cy="116" r="9" fill="#69db7c" />
                      </g>

                      <!-- Ramo Direito de Louros -->
                      <g
                        id="selecioneLaurelRight"
                        stroke="#181425"
                        stroke-width="3"
                        stroke-linejoin="round"
                      >
                        <path
                          d="M 142,136 C 178,128 198,96 194,56 C 182,62 174,74 174,86 C 186,74 186,52 178,38 C 168,48 164,62 166,76 C 172,60 166,44 156,34 C 150,46 150,62 156,76 C 158,98 152,116 136,128 Z"
                          fill="#40c057"
                        />
                        <circle cx="188" cy="72" r="8" fill="#69db7c" />
                        <circle cx="176" cy="96" r="9" fill="#51cf66" />
                        <circle cx="160" cy="116" r="9" fill="#69db7c" />
                      </g>

                      <!-- Troféu Dourado Individual (centrado em x=120) -->
                      <g id="selecioneTrophyUnit">
                        <!-- Alças Laterais do Troféu -->
                        <path
                          d="M 84,72 C 58,68 58,104 88,112"
                          fill="none"
                          stroke="#181425"
                          stroke-width="11"
                          stroke-linecap="round"
                        />
                        <path
                          d="M 84,72 C 58,68 58,104 88,112"
                          fill="none"
                          stroke="#f97316"
                          stroke-width="5.5"
                          stroke-linecap="round"
                        />
                        <path
                          d="M 156,72 C 182,68 182,104 152,112"
                          fill="none"
                          stroke="#181425"
                          stroke-width="11"
                          stroke-linecap="round"
                        />
                        <path
                          d="M 156,72 C 182,68 182,104 152,112"
                          fill="none"
                          stroke="#f97316"
                          stroke-width="5.5"
                          stroke-linecap="round"
                        />

                        <!-- Base e Pedestal do Troféu -->
                        <path
                          d="M 108,122 H 132 L 138,146 H 102 Z"
                          fill="#f59f00"
                          stroke="#181425"
                          stroke-width="3.8"
                          stroke-linejoin="round"
                        />
                        <ellipse
                          cx="120"
                          cy="150"
                          rx="30"
                          ry="9"
                          fill="#fcc419"
                          stroke="#181425"
                          stroke-width="3.8"
                        />

                        <!-- Cálice Principal -->
                        <path
                          d="M 78,66 H 162 C 160,104 144,126 120,126 C 96,126 80,104 78,66 Z"
                          fill="#fcc419"
                          stroke="#181425"
                          stroke-width="4"
                          stroke-linejoin="round"
                        />
                        <!-- Emblema T no centro do cálice -->
                        <path
                          d="M 106,82 H 134 V 91 H 125 V 104 H 115 V 91 H 106 Z"
                          fill="#f59f00"
                          stroke="#d97706"
                          stroke-width="2"
                          stroke-linejoin="round"
                        />

                        <!-- Tampa Abobadada do Cálice -->
                        <path
                          d="M 74,66 C 74,34 96,20 120,20 C 144,20 166,34 166,66 Z"
                          fill="#ffd43b"
                          stroke="#181425"
                          stroke-width="4"
                          stroke-linejoin="round"
                        />
                        <!-- Topo da Tampa -->
                        <circle
                          cx="120"
                          cy="17"
                          r="8"
                          fill="#fcc419"
                          stroke="#181425"
                          stroke-width="3.8"
                        />
                        <!-- Faixa Decorativa com Bolinhas Douradas -->
                        <path
                          d="M 74,62 Q 120,72 166,62"
                          fill="none"
                          stroke="#f59f00"
                          stroke-width="8"
                          stroke-linecap="round"
                        />
                        <circle cx="88" cy="56" r="4" fill="#fff3bf" />
                        <circle cx="104" cy="58" r="4" fill="#fff3bf" />
                        <circle cx="120" cy="59" r="4" fill="#fff3bf" />
                        <circle cx="136" cy="58" r="4" fill="#fff3bf" />
                        <circle cx="152" cy="56" r="4" fill="#fff3bf" />
                      </g>

                      <!-- Estrela de Brilho de 4 Pontas -->
                      <g id="selecioneSparkleStar">
                        <path
                          d="M 0,-14 C 2,-4 4,-2 14,0 C 4,2 2,4 0,14 C -2,4 -4,2 -14,0 C -4,-2 -2,-4 0,-14 Z"
                          fill="#fff9db"
                          stroke="#181425"
                          stroke-width="2.4"
                          stroke-linejoin="round"
                        />
                        <circle cx="0" cy="0" r="3" fill="#ffd43b" />
                      </g>
                    </defs>

                    <!-- ===================================================== -->
                    <!-- OPÇÃO 1: COPA 1 (1 Troféu com decoração de plantas)   -->
                    <!-- ===================================================== -->
                    <template v-if="currentLobbyVictoryCondition === 'SINGLE_WIN'">
                      <use href="#selecioneLaurelLeft" />
                      <use href="#selecioneLaurelRight" />
                      <use href="#selecioneTrophyUnit" />
                    </template>

                    <!-- ===================================================== -->
                    <!-- OPÇÃO 2: COPA 6 PONTOS (2 Troféus)                    -->
                    <!-- ===================================================== -->
                    <template v-else-if="currentLobbyVictoryCondition === 'CUP_6'">
                      <use href="#selecioneLaurelLeft" transform="translate(-20, 2)" />
                      <use href="#selecioneLaurelRight" transform="translate(20, 2)" />
                      <!-- Troféu da Esquerda -->
                      <use
                        href="#selecioneTrophyUnit"
                        transform="translate(-34, 8) translate(120, 90) scale(0.82) rotate(-7) translate(-120, -90)"
                      />
                      <!-- Troféu da Direita -->
                      <use
                        href="#selecioneTrophyUnit"
                        transform="translate(34, 6) translate(120, 90) scale(0.86) rotate(6) translate(-120, -90)"
                      />
                    </template>

                    <!-- ===================================================== -->
                    <!-- OPÇÃO 3: COPA 12 PONTOS (3 Troféus Brilhando)         -->
                    <!-- ===================================================== -->
                    <template v-else>
                      <!-- Aura Dourada Radiante de Fundo -->
                      <circle
                        cx="120"
                        cy="88"
                        r="82"
                        fill="url(#selecioneCup12Glow)"
                        class="selecione-cup12-glow-circle"
                      />
                      <use href="#selecioneLaurelLeft" transform="translate(-28, 4)" />
                      <use href="#selecioneLaurelRight" transform="translate(28, 4)" />
                      <!-- Troféu Esquerdo -->
                      <use
                        href="#selecioneTrophyUnit"
                        transform="translate(-48, 12) translate(120, 94) scale(0.74) rotate(-11) translate(-120, -94)"
                      />
                      <!-- Troféu Direito -->
                      <use
                        href="#selecioneTrophyUnit"
                        transform="translate(48, 12) translate(120, 94) scale(0.74) rotate(11) translate(-120, -94)"
                      />
                      <!-- Troféu Central em Destaque -->
                      <use
                        href="#selecioneTrophyUnit"
                        transform="translate(0, 2) translate(120, 90) scale(0.88) translate(-120, -90)"
                      />
                      <!-- Brilhos / Estrelas Cintilantes ao redor dos 3 Troféus -->
                      <g class="selecione-cup-sparkle selecione-cup-sparkle--1" transform="translate(38, 28) scale(0.95)">
                        <use href="#selecioneSparkleStar" />
                      </g>
                      <g class="selecione-cup-sparkle selecione-cup-sparkle--2" transform="translate(202, 26) scale(0.9)">
                        <use href="#selecioneSparkleStar" />
                      </g>
                      <g class="selecione-cup-sparkle selecione-cup-sparkle--3" transform="translate(120, 12) scale(1.05)">
                        <use href="#selecioneSparkleStar" />
                      </g>
                      <g class="selecione-cup-sparkle selecione-cup-sparkle--4" transform="translate(24, 122) scale(0.78)">
                        <use href="#selecioneSparkleStar" />
                      </g>
                      <g class="selecione-cup-sparkle selecione-cup-sparkle--5" transform="translate(216, 120) scale(0.82)">
                        <use href="#selecioneSparkleStar" />
                      </g>
                    </template>
                  </svg>
                </div>

                <div class="selecione-card-bottom-captions">
                  <span class="selecione-card-main-title">
                    {{
                      currentLobbyVictoryCondition === 'SINGLE_WIN'
                        ? 'COPA 1'
                        : currentLobbyVictoryCondition === 'CUP_12'
                          ? 'COPA 12 PONTOS'
                          : 'COPA 6 PONTOS'
                    }}
                  </span>
                </div>
              </div>
            </div>

            <!-- Seta Inferior ▼ -->
            <button
              type="button"
              class="selecione-modo-arrow-btn"
              title="Próxima copa"
              aria-label="Próxima copa"
              @click.stop="cycleVictoryConditionOption(1)"
            >
              <svg viewBox="0 0 84 52" aria-hidden="true">
                <path
                  d="M 9,5 H 75 Q 84,7 78,14 L 48,46 Q 42,52 36,46 L 6,14 Q 0,7 9,5 Z"
                  fill="#94a3b8"
                  stroke="#181425"
                  stroke-width="4"
                  stroke-linejoin="round"
                />
                <path
                  d="M 12,14 H 72 L 46,42 Q 42,46 38,42 Z"
                  fill="#cbd5e1"
                />
                <polygon
                  points="42,36 58,18 26,18"
                  fill="#f97316"
                  stroke="#9a3412"
                  stroke-width="2"
                  stroke-linejoin="round"
                />
              </svg>
            </button>
          </div>
        </div>

        <!-- 3. Botões LEGO no Canto Inferior Direito: PRONTO (Verde) e VOLTAR (Vermelho) -->
        <div class="selecione-modo-bottom-right-actions">
          <button
            type="button"
            class="selecione-action-brick-btn selecione-action-brick-btn--ready"
            @click="isGameModeModalOpen ? closeGameModeModal() : startGame()"
          >
            <span class="selecione-action-studs" aria-hidden="true">
              <span></span><span></span><span></span>
            </span>
            <span class="selecione-action-body">PRONTO</span>
          </button>

          <button
            type="button"
            class="selecione-action-brick-btn selecione-action-brick-btn--back"
            @click="
              isGameModeModalOpen ? closeGameModeModal() : returnToMainMenu()
            "
          >
            <span class="selecione-action-studs" aria-hidden="true">
              <span></span><span></span><span></span>
            </span>
            <span class="selecione-action-body">VOLTAR</span>
          </button>
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
        v-if="screenFlow === 'MULTIPLAYER_LOBBY' && !isGameModeModalOpen"
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

          <!-- Botão LEGO Amarelo "MODO E COPA" (idêntico à imagem de referência) -->
          <button
            type="button"
            class="lego-modo-copa-btn"
            title="Selecionar Modo de Jogo e Condição de Vitória (Copa)"
            aria-label="Modo e Copa"
            @click="openGameModeModal"
          >
            <span class="lego-modo-copa-studs" aria-hidden="true">
              <span class="lego-modo-copa-stud"></span>
              <span class="lego-modo-copa-stud"></span>
              <span class="lego-modo-copa-stud"></span>
              <span class="lego-modo-copa-stud"></span>
            </span>
            <span class="lego-modo-copa-body">
              <!-- Ícone duplo de engrenagens laranja/dourado -->
              <svg
                class="lego-modo-copa-gears"
                viewBox="0 0 44 36"
                aria-hidden="true"
              >
                <!-- Engrenagem maior (esquerda) -->
                <g transform="translate(15, 19)">
                  <circle
                    r="10.5"
                    fill="#f59e0b"
                    stroke="#451a03"
                    stroke-width="2.4"
                  />
                  <path
                    d="M-2.5,-13.5 H2.5 L3.2,-10 H-3.2 Z M-2.5,13.5 H2.5 L3.2,10 H-3.2 Z M-13.5,-2.5 V2.5 L-10,3.2 V-3.2 Z M13.5,-2.5 V2.5 L10,3.2 V-3.2 Z M-10.5,-8.5 L-7,-11.5 L-5.2,-8.5 L-8.5,-5.5 Z M10.5,8.5 L7,11.5 L5.2,8.5 L8.5,5.5 Z M8.5,-10.5 L11.5,-7 L8.5,-5.2 L5.5,-8.5 Z M-8.5,10.5 L-11.5,7 L-8.5,5.2 L-5.5,8.5 Z"
                    fill="#fbbf24"
                    stroke="#451a03"
                    stroke-width="1.8"
                    stroke-linejoin="round"
                  />
                  <circle
                    r="7.5"
                    fill="#fbbf24"
                    stroke="#78350f"
                    stroke-width="1.6"
                  />
                  <circle
                    r="3.6"
                    fill="#92400e"
                    stroke="#451a03"
                    stroke-width="1.8"
                  />
                </g>
                <!-- Engrenagem menor (direita superior) -->
                <g transform="translate(32, 11)">
                  <circle
                    r="7.2"
                    fill="#d97706"
                    stroke="#451a03"
                    stroke-width="2.2"
                  />
                  <path
                    d="M-1.8,-9.5 H1.8 L2.3,-7 H-2.3 Z M-1.8,9.5 H1.8 L2.3,7 H-2.3 Z M-9.5,-1.8 V1.8 L-7,2.3 V-2.3 Z M9.5,-1.8 V1.8 L7,2.3 V-2.3 Z M-7.2,-6 L-4.8,-8.2 L-3.5,-6 L-6,-3.8 Z M7.2,6 L4.8,8.2 L3.5,6 L6,3.8 Z M6,-7.2 L8.2,-4.8 L6,-3.5 L3.8,-6 Z M-6,7.2 L-8.2,4.8 L-6,3.5 L-3.8,6 Z"
                    fill="#f59e0b"
                    stroke="#451a03"
                    stroke-width="1.5"
                    stroke-linejoin="round"
                  />
                  <circle
                    r="5"
                    fill="#fbbf24"
                    stroke="#78350f"
                    stroke-width="1.4"
                  />
                  <circle
                    r="2.4"
                    fill="#92400e"
                    stroke="#451a03"
                    stroke-width="1.5"
                  />
                </g>
              </svg>
              <span class="lego-modo-copa-label">MODO E COPA</span>
            </span>
          </button>

          <div class="mp-lobby-mode-cup-summary">
            <span>
              {{
                currentLobbySelectableMode === 'SURVIVAL'
                  ? 'SOBREVIVÊNCIA'
                  : currentLobbySelectableMode === 'PUZZLE'
                    ? 'QUEBRA-CABEÇA (9m)'
                    : currentLobbySelectableMode === 'ENDLESS'
                      ? 'INFINITO / ABISMO'
                      : currentLobbySelectableMode === 'RANDOM'
                        ? 'ALEATÓRIO'
                        : 'CORRIDA (30m)'
              }}
            </span>
            <span class="mp-lobby-mode-cup-dot" aria-hidden="true">•</span>
            <span>
              {{
                currentLobbyVictoryCondition === 'SINGLE_WIN'
                  ? 'COPA 1'
                  : currentLobbyVictoryCondition === 'CUP_12'
                    ? 'COPA 12 PONTOS'
                    : 'COPA 6 PONTOS'
              }}
            </span>
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
            <span class="mp-countdown-heading">
              COMEÇANDO EM: {{ lobbyCountdownDisplayNumber }}
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
    <div
      v-if="screenFlow !== 'IN_GAME' || optionsStore.state.allowInvitesInGame"
      class="mp-realtime-alerts-stack"
    >
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
      <!-- MINIMAL FLOATING TOP-LEFT HUD (MODE, LIVES, RACE/SURVIVAL/PUZZLE/ENDLESS INFO & WIND) -->
      <div class="floating-hud-left">
        <div
          class="hud-pill"
          :class="
            snapshot.gameMode === 'SURVIVAL'
              ? 'hud-pill--survival-mode'
              : snapshot.gameMode === 'PUZZLE'
                ? 'hud-pill--puzzle-mode'
                : snapshot.gameMode === 'ENDLESS'
                  ? 'hud-pill--endless-mode'
                  : 'hud-pill--race-mode'
          "
        >
          <span class="hud-pill-label">MODO</span>
          <span class="hud-pill-value">
            {{
              snapshot.gameMode === 'SURVIVAL'
                ? '❤️ SOBREVIVÊNCIA'
                : snapshot.gameMode === 'PUZZLE'
                  ? '🧩 QUEBRA-CABEÇA'
                  : snapshot.gameMode === 'ENDLESS'
                    ? snapshot.isSinglePlayer
                      ? '🌌 INFINITO'
                      : '🌋 ABISMO'
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
          <span class="hud-pill-label">
            {{
              snapshot.gameMode === 'ENDLESS' && !snapshot.isSinglePlayer
                ? '⏱️ ABISMO'
                : 'TEMPO'
            }}
          </span>
          <span class="hud-pill-value mono">
            {{
              snapshot.gameMode === 'ENDLESS' && !snapshot.isSinglePlayer
                ? formattedAbyssRemainingTime
                : formattedTime
            }}
          </span>
        </div>

        <div
          v-if="
            snapshot.gameMode === 'ENDLESS' &&
            !snapshot.isSinglePlayer &&
            snapshot.isAbyssOvertime
          "
          class="hud-pill hud-pill--abyss-overtime"
        >
          <span>⚡ ABISMO ACELERANDO!</span>
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

        <div
          v-else-if="
            snapshot.gameMode === 'PUZZLE' &&
            (snapshot.state === 'PUZZLE_COUNTING' || snapshot.state === 'VICTORY')
          "
          class="hud-pill"
        >
          <span class="hud-pill-label">🧱 PEÇAS</span>
          <span class="hud-pill-value mono">
            {{ snapshot.countedPieces ?? snapshot.settledBlocks.length }}
          </span>
        </div>

        <div
          v-else-if="
            snapshot.gameMode === 'ENDLESS' &&
            snapshot.isSinglePlayer &&
            (snapshot.consecutiveAbyssFalls || 0) > 0
          "
          class="hud-pill hud-pill--lives-danger"
          title="Perder 5 peças seguidas no abismo encerra a partida por colapso da base!"
        >
          <span class="hud-pill-label">⚠️ RISCO ABISMO</span>
          <span class="hud-pill-value mono">
            {{ snapshot.consecutiveAbyssFalls }}/5 quedas
          </span>
        </div>

        <div class="hud-pill">
          <span class="hud-pill-label">ALTURA</span>
          <span v-if="snapshot.gameMode === 'SURVIVAL'" class="hud-pill-value mono">
            {{ snapshot.towerHeight.toFixed(1) }}m
            <small>MÁX {{ snapshot.maxTowerHeight.toFixed(1) }}m</small>
          </span>
          <span v-else-if="snapshot.gameMode === 'PUZZLE'" class="hud-pill-value mono">
            {{ snapshot.towerHeight.toFixed(1) }}<small>/9m ⚡</small>
          </span>
          <span v-else-if="snapshot.gameMode === 'ENDLESS'" class="hud-pill-value mono">
            {{ snapshot.towerHeight.toFixed(1) }}m
            <small v-if="snapshot.isSinglePlayer">
              / 🏁 {{ (snapshot.nextCheckpointHeightUnits ?? 10).toFixed(0) }}m
            </small>
            <small v-else>
              • 🪨 {{ (snapshot.petrifyLineHeightUnits ?? 0).toFixed(1) }}m
            </small>
          </span>
          <span v-else class="hud-pill-value mono">
            {{ snapshot.towerHeight.toFixed(1) }}<small>/30m</small>
          </span>
        </div>

        <div
          v-if="snapshot.gameMode === 'PUZZLE'"
          class="hud-pill"
          title="Cada peça que cai na água eleva sua ilha estreita em +0.5 bloco em direção ao feixe de laser!"
        >
          <span class="hud-pill-label">🌊 SUBIDA</span>
          <span class="hud-pill-value mono">
            +{{ (snapshot.puzzleBaseRiseUnits || 0).toFixed(1) }}<small>bl</small>
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
          v-if="optionsStore.state.showFpsPing"
          class="hud-pill"
        >
          <span class="hud-pill-label">📊 FPS</span>
          <span class="hud-pill-value mono">
            {{ liveFps }}
            <small v-if="isOnlineMultiplayerMatch" style="color: #4ade80">
              • ONLINE
            </small>
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

      <!-- TOP-CENTER HUD: ENDLESS SCORE + NEXT PIECE BANNER (MATCHING REFERENCE IMAGE) -->
      <div
        v-if="snapshot.nextQueue.length > 0 || snapshot.gameMode === 'ENDLESS'"
        class="top-tower-center-cluster"
        :class="{
          'top-tower-center-cluster--endless': snapshot.gameMode === 'ENDLESS',
        }"
      >
        <div
          v-if="snapshot.gameMode === 'ENDLESS'"
          class="endless-hud-score-banner"
        >
          SCORE: {{ snapshot.endlessScore ?? 0 }}
        </div>

        <div
          v-if="snapshot.nextQueue.length > 0"
          class="top-tower-next-piece"
          :class="{
            'top-tower-next-piece--inline': snapshot.gameMode === 'ENDLESS',
          }"
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
      </div>

      <!-- PERSONAL BEST TOP-RIGHT BANNER FOR ENDLESS MODE (UPDATES IN REAL TIME WITH SCORE) -->
      <div
        v-if="snapshot.gameMode === 'ENDLESS'"
        class="endless-personal-best-banner"
        :class="{
          'endless-personal-best-banner--new-record':
            (snapshot.endlessScore ?? 0) > 0 &&
            (snapshot.endlessScore ?? 0) >= displayPersonalBest,
        }"
      >
        PERSONAL BEST: {{ displayPersonalBest }}
      </div>

      <!-- MINIMAL FLOATING TOP-RIGHT HUD (SINGLE-SLOT POWER + DEV MODE) -->
      <div
        class="floating-hud-right"
        :class="{
          'floating-hud-right--endless': snapshot.gameMode === 'ENDLESS',
        }"
      >
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
              {{
                snapshot.gameMode === 'PUZZLE'
                  ? '1x Cola'
                  : snapshot.gameMode === 'ENDLESS'
                    ? 'Checkpoint +8m'
                    : snapshot.isSinglePlayer
                      ? 'MVP Solo'
                      : 'Multi'
              }}
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
          <div v-else-if="snapshot.gameMode === 'PUZZLE'" class="power-slot-empty">
            🧴 <strong>Super Cola única utilizada</strong> • Sem magias no Modo Quebra-Cabeça
          </div>
          <div v-else-if="snapshot.gameMode === 'ENDLESS'" class="power-slot-empty">
            Estabilize <strong>1.5s</strong> na linha das bandeiras (<strong>{{ (snapshot.nextCheckpointHeightUnits ?? 10).toFixed(0) }}m</strong>) para subir +8m e ganhar Poder!
          </div>
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
          class="hud-action-btn"
          title="Abrir Opções de Áudio, Controles e Gráficos"
          @click="openOptionsScreen(true)"
        >
          🎛️ Opções
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
                : snapshot.gameMode === 'PUZZLE'
                  ? '🌊 CAIU NA ÁGUA! (+0.5 BLOCO NA BASE)'
                  : snapshot.gameMode === 'ENDLESS'
                    ? '🪨 CAIU NO ABISMO! (-1 SCORE)'
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
          <div
            v-else-if="snapshot.gameMode === 'PUZZLE'"
            class="penalty-shield-pill"
          >
            ⬆️ SUA ILHA SUBIU
            <strong>+0.5 BLOCO</strong>
            EM DIREÇÃO AO LASER (TOTAL: +{{ (snapshot.puzzleBaseRiseUnits || 0).toFixed(1) }} BL)
          </div>
          <div
            v-else-if="
              snapshot.gameMode === 'ENDLESS' && snapshot.isSinglePlayer
            "
            class="penalty-shield-pill"
          >
            ⚠️ QUEDAS SEGUIDAS NO ABISMO:
            <strong>{{ snapshot.consecutiveAbyssFalls ?? 0 }}/5</strong>
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

      <!-- SURVIVAL / ENDLESS ELIMINATED SPECTATOR BANNER IN ONLINE MULTIPLAYER -->
      <div
        v-if="
          snapshot.state === 'GAME_OVER' &&
          isOnlineMultiplayerMatch &&
          hasAliveRemoteOpponents &&
          multiplayerClient.state.gameOverResult === null
        "
        class="goal-countdown-banner goal-countdown-banner--eliminated"
      >
        <div class="goal-countdown-label">
          {{
            snapshot.gameMode === 'ENDLESS'
              ? '🌋 SUA TORRE FOI ENGOLIDA PELO ABISMO E VOCÊ FOI ELIMINADO!'
              : '💀 VOCÊ PERDEU AS 3 VIDAS E FOI ELIMINADO!'
          }}
        </div>
        <div class="goal-countdown-sub">
          Assistindo os sobreviventes até o fim da partida...
        </div>
      </div>

      <!-- ================================================================= -->
      <!-- FIM DE PARTIDA NO SINGLEPLAYER (SEM COPA / SEM CARTELA)           -->
      <!-- ================================================================= -->
      <div
        v-if="
          !isOnlineMultiplayerMatch &&
          multiplayerClient.state.gameOverResult === null &&
          snapshot.state === 'GAME_OVER'
        "
        class="winner-screen-overlay winner-screen-overlay--gameover"
      >
        <div class="tricky-winner-text tricky-winner-text--gameover">
          FIM DE JOGO!
        </div>
        <div class="winner-subcard winner-subcard--gameover">
          <div class="survival-gameover-badge">
            {{
              snapshot.gameMode === 'ENDLESS'
                ? '🪨 SUA BASE ATIVA COLAPSOU NO ABISMO!'
                : '💔 SUAS 3 VIDAS ACABARAM!'
            }}
          </div>

          <div
            v-if="snapshot.gameMode === 'ENDLESS'"
            class="survival-stats-grid"
          >
            <div class="survival-stat-box">
              <span class="survival-stat-label">🏆 SCORE FINAL</span>
              <strong class="survival-stat-value mono">
                {{ snapshot.endlessScore ?? 0 }}
              </strong>
            </div>
            <div class="survival-stat-box">
              <span class="survival-stat-label">👑 PERSONAL BEST</span>
              <strong class="survival-stat-value mono" style="color: #fde047">
                {{ displayPersonalBest }}
              </strong>
            </div>
            <div class="survival-stat-box">
              <span class="survival-stat-label">📏 ALTURA MÁXIMA</span>
              <strong class="survival-stat-value mono">
                {{ snapshot.maxTowerHeight.toFixed(1) }}m
              </strong>
            </div>
          </div>

          <div v-else class="survival-stats-grid">
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

      <div
        v-else-if="
          !isOnlineMultiplayerMatch &&
          multiplayerClient.state.gameOverResult === null &&
          snapshot.state === 'VICTORY'
        "
        class="winner-screen-overlay"
      >
        <div class="winner-sunburst" />
        <div class="tricky-winner-text">
          {{
            snapshot.gameMode === 'SURVIVAL'
              ? 'SOBREVIVEU!'
              : snapshot.gameMode === 'PUZZLE'
                ? 'FINALIZADO!'
                : 'WINNER!'
          }}
        </div>
        <div class="winner-subcard">
          <div
            v-if="snapshot.gameMode === 'SURVIVAL'"
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

          <div
            v-else-if="snapshot.gameMode === 'PUZZLE'"
            class="survival-stats-grid"
          >
            <div class="survival-stat-box">
              <span class="survival-stat-label">🧩 PEÇAS CONTABILIZADAS</span>
              <strong class="survival-stat-value mono">
                {{ snapshot.countedPieces ?? snapshot.settledBlocks.length }}
              </strong>
            </div>
            <div class="survival-stat-box">
              <span class="survival-stat-label">🌊 SUBIDA DA ILHA</span>
              <strong class="survival-stat-value mono">
                +{{ (snapshot.puzzleBaseRiseUnits || 0).toFixed(1) }} bl
              </strong>
            </div>
            <div class="survival-stat-box">
              <span class="survival-stat-label">⚡ ALTURA / LASER</span>
              <strong class="survival-stat-value mono">
                {{ snapshot.towerHeight.toFixed(1) }}m / 9m
              </strong>
            </div>
          </div>

          <p class="winner-time">
            Tempo da Partida: <strong>{{ formattedTime }}</strong>
          </p>

          <div class="winner-actions">
            <button
              class="btn btn-primary"
              @click="restartMatch(true)"
            >
              🎲 Nova Partida (R)
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

      <!-- ================================================================= -->
      <!-- FIM DE PARTIDA MULTIPLAYER: MODO COPA 1 (SEM CARTELA, 1º GANHADOR)-->
      <!-- ================================================================= -->
      <div
        v-else-if="
          (isOnlineMultiplayerMatch ||
            multiplayerClient.state.gameOverResult !== null) &&
          grandeCopaScoreboard.victoryCondition === 'SINGLE_WIN' &&
          (multiplayerClient.state.gameOverResult !== null ||
            snapshot.state === 'VICTORY' ||
            (snapshot.state === 'GAME_OVER' && !hasAliveRemoteOpponents))
        "
        class="winner-screen-overlay"
      >
        <div class="winner-sunburst" />
        <div class="tricky-winner-text">
          <template v-if="grandeCopaScoreboard.isTiebreaker">
            ⚔️ EMPATE! RODADA DE DESEMPATE!
          </template>
          <template v-else>
            🏆 {{ grandeCopaScoreboard.winnerNick }} VENCEU!
          </template>
        </div>
        <div class="winner-subcard winner-subcard--cup">
          <div class="mp-podium-list">
            <div
              v-for="row in grandeCopaScoreboard.rows"
              :key="row.key"
              class="mp-podium-row"
              :class="[
                `mp-podium-row--rank-${row.rank}`,
                {
                  'mp-podium-row--cup-champion':
                    !grandeCopaScoreboard.isTiebreaker && row.rank === 1,
                },
              ]"
            >
              <span class="mp-podium-rank">{{ row.rank }}º</span>
              <div class="grande-copa-portrait-square" style="width: 38px; height: 38px">
                <img
                  v-if="row.avatarUrl && !brokenAvatarByKey[row.key]"
                  :src="row.avatarUrl"
                  :alt="row.customNick"
                  class="grande-copa-google-avatar-img"
                  referrerpolicy="no-referrer"
                  draggable="false"
                  @error="markAvatarBroken(row.key)"
                />
                <div
                  v-else
                  class="grande-copa-google-avatar-fallback"
                  style="font-size: 18px"
                  aria-hidden="true"
                >
                  <span>
                    {{ (row.customNick || 'J').charAt(0).toUpperCase() }}
                  </span>
                </div>
              </div>
              <img
                :src="getSkinSpriteUrl(row.skinSpriteId)"
                :alt="row.customNick"
                class="mp-podium-skin"
              />
              <div class="mp-podium-identity">
                <strong>
                  {{ row.customNick }}
                  <span
                    v-if="!grandeCopaScoreboard.isTiebreaker && row.rank === 1"
                    class="mp-podium-cup-crown"
                    title="Vencedor da Copa 1!"
                  >
                    👑 VENCEDOR
                  </span>
                </strong>
                <small>
                  {{ row.handle }} • {{ row.towerHeight.toFixed(1) }}m
                </small>
              </div>
            </div>
          </div>

          <div class="winner-actions">
            <button
              v-if="grandeCopaScoreboard.isTiebreaker"
              class="btn btn-primary"
              @click="handleGrandeCopaContinue"
            >
              ⚔️ INICIAR DESEMPATE FINAL
            </button>
            <button
              v-else
              class="btn btn-primary"
              @click="handleReturnToLobbyFromMatch"
            >
              🎉 VOLTAR PARA A SALA
            </button>
          </div>
        </div>
      </div>

      <!-- ================================================================= -->
      <!-- POPUP DE FIM DE PARTIDA: GRANDE COPA (COPA 6 E COPA 12 PONTOS)    -->
      <!-- ================================================================= -->
      <div
        v-else-if="
          (isOnlineMultiplayerMatch ||
            multiplayerClient.state.gameOverResult !== null) &&
          grandeCopaScoreboard.victoryCondition !== 'SINGLE_WIN' &&
          (multiplayerClient.state.gameOverResult !== null ||
            snapshot.state === 'VICTORY' ||
            (snapshot.state === 'GAME_OVER' && !hasAliveRemoteOpponents))
        "
        class="grande-copa-overlay"
        @click="handleGrandeCopaContinue"
      >
        <div class="grande-copa-modal">
          <!-- TROFÉU LEGO DOURADO COM LOUROS (CANTO SUPERIOR ESQUERDO) -->
          <div
            class="grande-copa-corner-trophy grande-copa-corner-trophy--left"
            aria-hidden="true"
          >
            <svg viewBox="0 0 120 120" class="grande-copa-trophy-svg">
              <!-- Folhas de Louro Verdes atrás do Troféu -->
              <g stroke="#181425" stroke-width="3.5" stroke-linejoin="round">
                <path
                  d="M 24 66 C 6 52, 6 28, 26 22 C 24 38, 28 52, 38 62 Z"
                  fill="#40c057"
                />
                <path
                  d="M 18 82 C 2 72, 2 50, 18 42 C 20 56, 26 68, 36 76 Z"
                  fill="#2f9e44"
                />
                <path
                  d="M 96 66 C 114 52, 114 28, 94 22 C 96 38, 92 52, 82 62 Z"
                  fill="#40c057"
                />
                <path
                  d="M 102 82 C 118 72, 118 50, 102 42 C 100 56, 94 68, 84 76 Z"
                  fill="#2f9e44"
                />
              </g>
              <!-- 2 Pinos LEGO no Topo da Taça -->
              <rect
                x="41"
                y="13"
                width="14"
                height="9"
                rx="2"
                fill="#ffd43b"
                stroke="#181425"
                stroke-width="3.5"
              />
              <rect
                x="65"
                y="13"
                width="14"
                height="9"
                rx="2"
                fill="#ffd43b"
                stroke="#181425"
                stroke-width="3.5"
              />
              <!-- Alças Laterais da Taça -->
              <path
                d="M 34 30 H 19 C 13 30, 13 55, 24 57 L 38 58"
                fill="none"
                stroke="#181425"
                stroke-width="9.5"
                stroke-linecap="round"
                stroke-linejoin="round"
              />
              <path
                d="M 34 30 H 19 C 13 30, 13 55, 24 57 L 38 58"
                fill="none"
                stroke="#ffaa00"
                stroke-width="4.2"
                stroke-linecap="round"
                stroke-linejoin="round"
              />
              <path
                d="M 86 30 H 101 C 107 30, 107 55, 96 57 L 82 58"
                fill="none"
                stroke="#181425"
                stroke-width="9.5"
                stroke-linecap="round"
                stroke-linejoin="round"
              />
              <path
                d="M 86 30 H 101 C 107 30, 107 55, 96 57 L 82 58"
                fill="none"
                stroke="#ffaa00"
                stroke-width="4.2"
                stroke-linecap="round"
                stroke-linejoin="round"
              />
              <!-- Corpo Principal da Taça LEGO -->
              <path
                d="M 32 22 H 88 V 50 C 88 68, 74 76, 60 76 C 46 76, 32 68, 32 50 Z"
                fill="#fcc419"
                stroke="#181425"
                stroke-width="3.8"
                stroke-linejoin="round"
              />
              <!-- Brilho Lateral da Taça -->
              <path
                d="M 39 27 H 49 V 52 C 49 60, 43 64, 39 60 Z"
                fill="#fff3bf"
                opacity="0.85"
              />
              <!-- Haste e Base do Troféu -->
              <rect
                x="51"
                y="74"
                width="18"
                height="16"
                fill="#f59f00"
                stroke="#181425"
                stroke-width="3.6"
              />
              <rect
                x="38"
                y="89"
                width="44"
                height="10"
                rx="2.5"
                fill="#ffd43b"
                stroke="#181425"
                stroke-width="3.6"
              />
              <rect
                x="31"
                y="98"
                width="58"
                height="11"
                rx="2.5"
                fill="#f08c00"
                stroke="#181425"
                stroke-width="3.6"
              />
            </svg>
          </div>

          <!-- TROFÉU LEGO DOURADO COM LOUROS (CANTO SUPERIOR DIREITO) -->
          <div
            class="grande-copa-corner-trophy grande-copa-corner-trophy--right"
            aria-hidden="true"
          >
            <svg viewBox="0 0 120 120" class="grande-copa-trophy-svg">
              <g stroke="#181425" stroke-width="3.5" stroke-linejoin="round">
                <path
                  d="M 24 66 C 6 52, 6 28, 26 22 C 24 38, 28 52, 38 62 Z"
                  fill="#40c057"
                />
                <path
                  d="M 18 82 C 2 72, 2 50, 18 42 C 20 56, 26 68, 36 76 Z"
                  fill="#2f9e44"
                />
                <path
                  d="M 96 66 C 114 52, 114 28, 94 22 C 96 38, 92 52, 82 62 Z"
                  fill="#40c057"
                />
                <path
                  d="M 102 82 C 118 72, 118 50, 102 42 C 100 56, 94 68, 84 76 Z"
                  fill="#2f9e44"
                />
              </g>
              <rect
                x="41"
                y="13"
                width="14"
                height="9"
                rx="2"
                fill="#ffd43b"
                stroke="#181425"
                stroke-width="3.5"
              />
              <rect
                x="65"
                y="13"
                width="14"
                height="9"
                rx="2"
                fill="#ffd43b"
                stroke="#181425"
                stroke-width="3.5"
              />
              <path
                d="M 34 30 H 19 C 13 30, 13 55, 24 57 L 38 58"
                fill="none"
                stroke="#181425"
                stroke-width="9.5"
                stroke-linecap="round"
                stroke-linejoin="round"
              />
              <path
                d="M 34 30 H 19 C 13 30, 13 55, 24 57 L 38 58"
                fill="none"
                stroke="#ffaa00"
                stroke-width="4.2"
                stroke-linecap="round"
                stroke-linejoin="round"
              />
              <path
                d="M 86 30 H 101 C 107 30, 107 55, 96 57 L 82 58"
                fill="none"
                stroke="#181425"
                stroke-width="9.5"
                stroke-linecap="round"
                stroke-linejoin="round"
              />
              <path
                d="M 86 30 H 101 C 107 30, 107 55, 96 57 L 82 58"
                fill="none"
                stroke="#ffaa00"
                stroke-width="4.2"
                stroke-linecap="round"
                stroke-linejoin="round"
              />
              <path
                d="M 32 22 H 88 V 50 C 88 68, 74 76, 60 76 C 46 76, 32 68, 32 50 Z"
                fill="#fcc419"
                stroke="#181425"
                stroke-width="3.8"
                stroke-linejoin="round"
              />
              <path
                d="M 39 27 H 49 V 52 C 49 60, 43 64, 39 60 Z"
                fill="#fff3bf"
                opacity="0.85"
              />
              <rect
                x="51"
                y="74"
                width="18"
                height="16"
                fill="#f59f00"
                stroke="#181425"
                stroke-width="3.6"
              />
              <rect
                x="38"
                y="89"
                width="44"
                height="10"
                rx="2.5"
                fill="#ffd43b"
                stroke="#181425"
                stroke-width="3.6"
              />
              <rect
                x="31"
                y="98"
                width="58"
                height="11"
                rx="2.5"
                fill="#f08c00"
                stroke="#181425"
                stroke-width="3.6"
              />
            </svg>
          </div>

          <!-- BARRA SUPERIOR DE BLOCOS LEGO AZUL-CLARO E AMARELO -->
          <div class="grande-copa-top-rail" aria-hidden="true">
            <div class="grande-copa-top-brick grande-copa-top-brick--blue">
              <span class="grande-copa-top-stud"></span>
              <span class="grande-copa-top-stud"></span>
              <span class="grande-copa-top-stud"></span>
            </div>
            <div class="grande-copa-top-brick grande-copa-top-brick--yellow">
              <span class="grande-copa-top-stud"></span>
              <span class="grande-copa-top-stud"></span>
              <span class="grande-copa-top-stud"></span>
            </div>
            <div
              class="grande-copa-top-brick grande-copa-top-brick--blue grande-copa-top-brick--center"
            >
              <span class="grande-copa-top-stud"></span>
              <span class="grande-copa-top-stud"></span>
              <span class="grande-copa-top-stud"></span>
              <span class="grande-copa-top-stud"></span>
              <span class="grande-copa-top-stud"></span>
              <span class="grande-copa-top-stud"></span>
              <span class="grande-copa-top-stud"></span>
            </div>
            <div class="grande-copa-top-brick grande-copa-top-brick--yellow">
              <span class="grande-copa-top-stud"></span>
              <span class="grande-copa-top-stud"></span>
              <span class="grande-copa-top-stud"></span>
            </div>
            <div class="grande-copa-top-brick grande-copa-top-brick--blue">
              <span class="grande-copa-top-stud"></span>
              <span class="grande-copa-top-stud"></span>
              <span class="grande-copa-top-stud"></span>
            </div>
          </div>

          <!-- TÍTULO CENTRAL 3D EM SVG: GRANDE COPA -->
          <div class="grande-copa-title-wrap" aria-hidden="true">
            <svg viewBox="0 0 540 84" class="grande-copa-title-svg">
              <defs>
                <linearGradient
                  id="grandeCopaTitleGrad"
                  x1="0%"
                  y1="0%"
                  x2="0%"
                  y2="100%"
                >
                  <stop offset="0%" stop-color="#ffe066" />
                  <stop offset="45%" stop-color="#ff9f1c" />
                  <stop offset="100%" stop-color="#e8590c" />
                </linearGradient>
              </defs>
              <!-- Sombra sólida inferior 3D -->
              <text
                x="270"
                y="65"
                text-anchor="middle"
                class="grande-copa-title-svg-shadow"
              >
                {{ grandeCopaScoreboard.cupTitle }}
              </text>
              <!-- Texto principal com preenchimento dourado/laranja brilhante e contorno grosso -->
              <text
                x="270"
                y="60"
                text-anchor="middle"
                class="grande-copa-title-svg-text"
              >
                {{ grandeCopaScoreboard.cupTitle }}
              </text>
            </svg>
          </div>

          <!-- CORPO CENTRAL: COLUNAS LEGO LATERAIS + QUADRO DE TIJOLOS BRANCOS -->
          <div class="grande-copa-body-wrap">
            <!-- Coluna Lateral Esquerda de Pinos LEGO -->
            <div
              class="grande-copa-side-rail grande-copa-side-rail--left"
              aria-hidden="true"
            >
              <div class="grande-copa-side-plate grande-copa-side-plate--blue">
                <span class="grande-copa-face-stud"></span>
                <span class="grande-copa-face-stud"></span>
                <span class="grande-copa-face-stud"></span>
                <span class="grande-copa-face-stud"></span>
              </div>
              <div
                class="grande-copa-side-plate grande-copa-side-plate--yellow"
              >
                <span class="grande-copa-outer-bump"></span>
                <span class="grande-copa-outer-bump"></span>
              </div>
              <div
                class="grande-copa-side-plate grande-copa-side-plate--blue grande-copa-side-plate--bottom"
              >
                <span class="grande-copa-face-stud"></span>
                <span class="grande-copa-face-stud"></span>
                <span class="grande-copa-face-stud"></span>
              </div>
            </div>

            <!-- QUADRO INTERNO DE PAREDE DE TIJOLOS BRANCO/GELO -->
            <div class="grande-copa-board">
              <!-- LISTA DE 4 JOGADORES COM SUAS CARTELAS E MEDALHAS -->
              <div class="grande-copa-rows-list">
                <div
                  v-for="row in grandeCopaScoreboard.rows"
                  :key="row.key"
                  class="grande-copa-player-block"
                >
                  <!-- Apenas o Nome do Jogador acima da Barra (idêntico ao print) -->
                  <div class="grande-copa-player-header">
                    <span class="grande-copa-player-name">
                      {{ row.customNick }}
                    </span>
                  </div>

                  <!-- BARRA HORIZONTAL AZUL-CLARO LEGO (CARTELA DO JOGADOR) -->
                  <div class="grande-copa-track-bar">
                    <!-- Compartimento Esquerdo: Foto Google/Conta Quadrada + Ícone Redondo do Personagem -->
                    <div class="grande-copa-avatar-compartment">
                      <!-- 1. Foto Quadrada do Google / Conta do Jogador -->
                      <div class="grande-copa-portrait-square">
                        <img
                          v-if="row.avatarUrl && !brokenAvatarByKey[row.key]"
                          :src="row.avatarUrl"
                          :alt="row.customNick"
                          class="grande-copa-google-avatar-img"
                          referrerpolicy="no-referrer"
                          draggable="false"
                          @error="markAvatarBroken(row.key)"
                        />
                        <div
                          v-else
                          class="grande-copa-google-avatar-fallback"
                          aria-hidden="true"
                        >
                          <span>
                            {{
                              (row.customNick || 'J').charAt(0).toUpperCase()
                            }}
                          </span>
                        </div>
                      </div>

                      <!-- 2. Medalhão Circular do Personagem Equipado -->
                      <div class="grande-copa-character-circle">
                        <img
                          v-if="getSkinSpriteUrl(row.skinSpriteId)"
                          :src="getSkinSpriteUrl(row.skinSpriteId)"
                          :alt="row.customNick"
                          class="grande-copa-skin-circle-img"
                          draggable="false"
                        />
                      </div>
                    </div>

                    <!-- Divisória Vertical entre Avatar e Trilha de Pontos -->
                    <div
                      class="grande-copa-compartment-divider"
                      aria-hidden="true"
                    />

                    <!-- Trilha de 8 Slots: Medalhas (1, 2, 3) e Pontos Vazios (•) -->
                    <div class="grande-copa-slots-track">
                      <div
                        v-for="slotIdx in row.totalVisualSlots"
                        :key="`slot-${row.key}-${slotIdx}`"
                        class="grande-copa-slot-cell"
                        :class="{
                          'grande-copa-slot-cell--seam':
                            slotIdx === 4 || slotIdx === 7,
                        }"
                      >
                        <!-- Medalha Roseta Ondulada com Fitas (1 = Ouro, 2 = Prata/Roxo, 3 = Bronze) -->
                        <div
                          v-if="slotIdx <= row.pointMedals.length"
                          class="grande-copa-medal-wrap"
                          :class="[
                            `grande-copa-medal-wrap--rank-${row.pointMedals[slotIdx - 1]}`,
                            {
                              'grande-copa-medal-wrap--earned-now':
                                slotIdx > row.previousCupPoints,
                            },
                          ]"
                          :style="
                            slotIdx > row.previousCupPoints
                              ? {
                                  animationDelay: `${
                                    Math.max(
                                      0,
                                      slotIdx - row.previousCupPoints - 1
                                    ) *
                                      230 +
                                    160
                                  }ms`,
                                }
                              : undefined
                          "
                        >
                          <svg
                            viewBox="0 0 68 78"
                            class="grande-copa-medal-svg"
                          >
                            <!-- Fitas Inferiores em V -->
                            <path
                              d="M 23 44 L 12 71 L 23 66 L 29 74 L 34 48 Z"
                              :fill="
                                row.pointMedals[slotIdx - 1] === 1
                                  ? '#e03131'
                                  : row.pointMedals[slotIdx - 1] === 2
                                    ? '#9c36b5'
                                    : '#e8590c'
                              "
                              stroke="#181425"
                              stroke-width="3.2"
                              stroke-linejoin="round"
                            />
                            <path
                              d="M 45 44 L 56 71 L 45 66 L 39 74 L 34 48 Z"
                              :fill="
                                row.pointMedals[slotIdx - 1] === 1
                                  ? '#c92a2a'
                                  : row.pointMedals[slotIdx - 1] === 2
                                    ? '#862e9c'
                                    : '#d9480f'
                              "
                              stroke="#181425"
                              stroke-width="3.2"
                              stroke-linejoin="round"
                            />
                            <!-- Borda Roseta Ondulada (12 lóbulos) -->
                            <path
                              d="M 34 6 C 37 6, 39 8, 42 7 C 45 7, 47 10, 50 10 C 53 11, 53 14, 56 16 C 58 18, 57 21, 58 24 C 59 27, 57 30, 58 33 C 58 36, 55 38, 55 41 C 54 44, 50 45, 49 48 C 47 50, 43 50, 41 52 C 38 53, 36 52, 34 52 C 32 52, 30 53, 27 52 C 25 50, 21 50, 19 48 C 18 45, 14 44, 13 41 C 13 38, 10 36, 10 33 C 11 30, 9 27, 10 24 C 11 21, 10 18, 12 16 C 15 14, 15 11, 18 10 C 21 10, 23 7, 26 7 C 29 8, 31 6, 34 6 Z"
                              :fill="
                                row.pointMedals[slotIdx - 1] === 1
                                  ? '#fcc419'
                                  : row.pointMedals[slotIdx - 1] === 2
                                    ? '#d0bfff'
                                    : '#f08c00'
                              "
                              stroke="#181425"
                              stroke-width="3.5"
                              stroke-linejoin="round"
                            />
                            <!-- Círculo Interno da Medalha -->
                            <circle
                              cx="34"
                              cy="29"
                              r="17"
                              :fill="
                                row.pointMedals[slotIdx - 1] === 1
                                  ? '#fab005'
                                  : row.pointMedals[slotIdx - 1] === 2
                                    ? '#b197fc'
                                    : '#e67700'
                              "
                              stroke="#181425"
                              stroke-width="3"
                            />
                            <!-- Número 1, 2 ou 3 -->
                            <text
                              x="34"
                              y="37"
                              text-anchor="middle"
                              class="grande-copa-medal-num"
                              :fill="
                                row.pointMedals[slotIdx - 1] === 1
                                  ? '#fff3bf'
                                  : row.pointMedals[slotIdx - 1] === 2
                                    ? '#f3f0ff'
                                    : '#ffe8cc'
                              "
                            >
                              {{ row.pointMedals[slotIdx - 1] }}
                            </text>
                          </svg>
                        </div>

                        <!-- Ponto Vazio: Círculo Azul Escuro Suave (sem borda preta) -->
                        <span
                          v-else
                          class="grande-copa-empty-dot"
                          aria-hidden="true"
                        />
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <!-- Coluna Lateral Direita de Pinos LEGO -->
            <div
              class="grande-copa-side-rail grande-copa-side-rail--right"
              aria-hidden="true"
            >
              <div class="grande-copa-side-plate grande-copa-side-plate--blue">
                <span class="grande-copa-face-stud"></span>
                <span class="grande-copa-face-stud"></span>
                <span class="grande-copa-face-stud"></span>
                <span class="grande-copa-face-stud"></span>
              </div>
              <div
                class="grande-copa-side-plate grande-copa-side-plate--yellow"
              >
                <span class="grande-copa-outer-bump"></span>
                <span class="grande-copa-outer-bump"></span>
              </div>
              <div
                class="grande-copa-side-plate grande-copa-side-plate--blue grande-copa-side-plate--bottom"
              >
                <span class="grande-copa-face-stud"></span>
                <span class="grande-copa-face-stud"></span>
                <span class="grande-copa-face-stud"></span>
              </div>
            </div>
          </div>

          <!-- BARRA INFERIOR DE BLOCOS LEGO (IDÊNTICA À REFERÊNCIA: 4 PINOS ESQ + BARRA LISA + 4 PINOS DIR) -->
          <div class="grande-copa-bottom-rail" aria-hidden="true">
            <div class="grande-copa-bottom-plate">
              <span class="grande-copa-face-stud"></span>
              <span class="grande-copa-face-stud"></span>
              <span class="grande-copa-face-stud"></span>
              <span class="grande-copa-face-stud"></span>
            </div>

            <div class="grande-copa-bottom-center-bar">
              <div class="grande-copa-bottom-seam" />
            </div>

            <div class="grande-copa-bottom-plate">
              <span class="grande-copa-face-stud"></span>
              <span class="grande-copa-face-stud"></span>
              <span class="grande-copa-face-stud"></span>
              <span class="grande-copa-face-stud"></span>
            </div>
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
              <span>
                🏠 Base Modular ({{
                  snapshot.gameMode === 'PUZZLE'
                    ? 'Ilhas Estreitas Quebra-Cabeça'
                    : '8 Colunas — base.png'
                }}):
              </span>
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
                v-for="preset in snapshot.gameMode === 'PUZZLE'
                  ? PUZZLE_BASE_TERRAIN_CATALOG
                  : BASE_TERRAIN_CATALOG"
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
