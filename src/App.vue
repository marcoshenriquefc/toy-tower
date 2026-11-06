<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
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
  BlockSkinInfo,
  PlayerSkinInfo,
  spriteRegistry,
  SpriteKey,
  SpriteSlot,
} from './sprites/SpriteRegistry'
import PiecePreviewCanvas from './components/PiecePreviewCanvas.vue'
import {
  authStore,
  dbBlockSkinToSpriteId,
  dbSkinToSpriteId,
  FriendAccountEntry,
  isBlockSkinUnlocked,
  isPlayerSkinUnlocked,
  spriteIdToDbBlockSkin,
  spriteIdToDbSkin,
  unlockLocalBlockSkin,
  unlockLocalPlayerSkin,
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
const blockSkins = ref<BlockSkinInfo[]>(spriteRegistry.getBlockSkins())
const activeBlockSkinId = ref<string>(spriteRegistry.getActiveBlockSkinId())
const selectedSkinsColumn = ref<'PLAYER' | 'BLOCK'>('PLAYER')
const isSkinPickerOpen = ref<boolean>(false)

type ScreenFlowState =
  | 'TITLE_SCREEN'
  | 'TRANSITIONING'
  | 'MAIN_MENU'
  | 'LOCAL_LOBBY'
  | 'MULTIPLAYER_LOBBY'
  | 'SKINS_SCREEN'
  | 'SHOP_SCREEN'
  | 'OPTIONS_SCREEN'
  | 'IN_GAME'
const screenFlow = ref<ScreenFlowState>('TITLE_SCREEN')
const selectedMenuCard = ref<
  'LOCAL' | 'MULTIPLAYER' | 'SKINS' | 'STORE' | 'OPTIONS'
>('LOCAL')
const isGamePaused = ref<boolean>(false)
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
  'player_mage',
  'player_dino',
  'player_pirate',
  'player_shadow',
]

const fallbackLobbySlots = ref<LobbySlotInfo[]>([
  {
    slotIndex: 0,
    state: 'JOINED_UNREADY',
    isLocalHost: true,
    customNick: 'ReiDosBlocos',
    handle: '@lucas_042',
    skinSpriteId: 'player_mage',
    silhouetteSkinId: 'player_mage',
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
    skinSpriteId: 'player_shadow',
    silhouetteSkinId: 'player_shadow',
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

const activeBlockSkin = computed<BlockSkinInfo | null>(() => {
  return (
    blockSkins.value.find((s) => s.id === activeBlockSkinId.value) ||
    blockSkins.value[0] ||
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

const isEndTowerShowcaseActive = ref<boolean>(false)
let endTowerShowcaseTimer: number | null = null

function clearEndTowerShowcase() {
  if (endTowerShowcaseTimer !== null) {
    window.clearTimeout(endTowerShowcaseTimer)
    endTowerShowcaseTimer = null
  }
  isEndTowerShowcaseActive.value = false
}

const isMatchFinishedForOverlay = computed<boolean>(() => {
  return (
    multiplayerClient.state.gameOverResult !== null ||
    snapshot.value.state === 'VICTORY' ||
    (snapshot.value.state === 'GAME_OVER' &&
      (!isOnlineMultiplayerMatch.value || !hasAliveRemoteOpponents.value))
  )
})

watch(
  isMatchFinishedForOverlay,
  (finished, prevFinished) => {
    if (finished && !prevFinished) {
      if (snapshot.value.gameMode !== 'PUZZLE') {
        if (endTowerShowcaseTimer !== null) {
          window.clearTimeout(endTowerShowcaseTimer)
        }
        isEndTowerShowcaseActive.value = true
        endTowerShowcaseTimer = window.setTimeout(() => {
          isEndTowerShowcaseActive.value = false
          endTowerShowcaseTimer = null
        }, 2800)
      } else {
        clearEndTowerShowcase()
      }
    } else if (!finished) {
      clearEndTowerShowcase()
    }
  },
  { flush: 'sync' }
)

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
  const hostSkin = isPlayerSkinUnlocked(activePlayerSkinId.value)
    ? activePlayerSkinId.value || 'player_mage'
    : 'player_mage'
  fallbackLobbySlots.value = [
    {
      slotIndex: 0,
      state: 'JOINED_UNREADY',
      isLocalHost: true,
      customNick: user?.customNick || 'ReiDosBlocos',
      handle: user?.handle || '@lucas_042',
      skinSpriteId: hostSkin,
      silhouetteSkinId: 'player_mage',
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
      skinSpriteId: 'player_shadow',
      silhouetteSkinId: 'player_shadow',
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
  isGamePaused.value = false
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
  clearEndTowerShowcase()
  multiplayerClient.emitReturnToLobby()
  isGamePaused.value = false
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
    activeBlockSkinId.value = spriteRegistry.getActiveBlockSkinId()
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
  activePlayerSkinId.value = spriteRegistry.getActivePlayerSkinId()
  activeBlockSkinId.value = spriteRegistry.getActiveBlockSkinId()
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
  clearEndTowerShowcase()
  if (
    screenFlow.value === 'MULTIPLAYER_LOBBY' ||
    isOnlineMultiplayerMatch.value ||
    Boolean(multiplayerClient.state.room)
  ) {
    multiplayerClient.leaveRoom()
  }
  isOnlineMultiplayerMatch.value = false
  isGamePaused.value = false
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

function openSkinsScreen(asModal: boolean = false) {
  selectedSkinsColumn.value = 'PLAYER'
  isBurgerMenuOpen.value = false
  isFriendsModalOpen.value = false
  isGameModeModalOpen.value = false
  isOptionsModalOpen.value = false
  playToySfx('click')
  if (asModal) {
    isSkinPickerOpen.value = true
  } else {
    selectedMenuCard.value = 'SKINS'
    isSkinPickerOpen.value = false
    isAuthModalOpen.value = false
    screenFlow.value = 'SKINS_SCREEN'
  }
}

function closeSkinsScreen() {
  playToySfx('click')
  if (isSkinPickerOpen.value) {
    isSkinPickerOpen.value = false
    if (fallbackLobbySlots.value[0]) {
      fallbackLobbySlots.value[0].skinSpriteId = activePlayerSkinId.value
    }
    return
  }
  returnToMainMenu()
}

type ShopCategoryTab = 'TODOS' | 'MAGOS' | 'BLOCOS' | 'MOEDAS'

interface ShopCatalogItem {
  id: string
  titleLine1: string
  titleLine2?: string
  price: number
  cardBg: string
  category: 'MAGOS' | 'BLOCOS'
  playerSkinId?: string
  blockSkinId?: string
  hideTitleWhenOwned?: boolean
}

export interface ShopCoinPackageItem {
  id: string
  coins: number
  coinsLabel: string
  title: string
  bonusLabel?: string
  priceBrl: number
  priceLabel: string
  badge?: string
  badgeVariant?: 'popular' | 'best' | 'gold'
  cardVariant: 'sky' | 'gold' | 'royal'
  artType: 'PILE' | 'SACK' | 'CHEST_SMALL' | 'CHEST_OPEN' | 'SAFE' | 'MOUNTAIN'
}

const SHOP_COIN_PACKAGES: ShopCoinPackageItem[] = [
  {
    id: 'PACK_150',
    coins: 150,
    coinsLabel: '150',
    title: 'PUNHADO DE MOEDAS',
    priceBrl: 4.9,
    priceLabel: 'R$ 4,90',
    cardVariant: 'sky',
    artType: 'PILE',
  },
  {
    id: 'PACK_500',
    coins: 500,
    coinsLabel: '500',
    title: 'SACO DE MOEDAS',
    priceBrl: 14.9,
    priceLabel: 'R$ 14,90',
    cardVariant: 'sky',
    artType: 'SACK',
  },
  {
    id: 'PACK_1200',
    coins: 1200,
    coinsLabel: '1.200',
    title: 'BAÚ PEQUENO',
    bonusLabel: '+120 BÔNUS',
    priceBrl: 29.9,
    priceLabel: 'R$ 29,90',
    badge: 'MAIS POPULAR',
    badgeVariant: 'popular',
    cardVariant: 'gold',
    artType: 'CHEST_SMALL',
  },
  {
    id: 'PACK_3000',
    coins: 3000,
    coinsLabel: '3.000',
    title: 'BAÚ GRANDE',
    bonusLabel: '+450 BÔNUS',
    priceBrl: 59.9,
    priceLabel: 'R$ 59,90',
    cardVariant: 'sky',
    artType: 'CHEST_OPEN',
  },
  {
    id: 'PACK_6000',
    coins: 6000,
    coinsLabel: '6.000',
    title: 'CAIXA FORTE',
    bonusLabel: '+1.000 BÔNUS',
    priceBrl: 99.9,
    priceLabel: 'R$ 99,90',
    badge: 'MELHOR PREÇO',
    badgeVariant: 'best',
    cardVariant: 'sky',
    artType: 'SAFE',
  },
  {
    id: 'PACK_15000',
    coins: 15000,
    coinsLabel: '15.000',
    title: 'FORTUNA DO ABISMO',
    bonusLabel: '+3.000 BÔNUS',
    priceBrl: 199.9,
    priceLabel: 'R$ 199,90',
    badge: 'MUITO OURO!',
    badgeVariant: 'gold',
    cardVariant: 'royal',
    artType: 'MOUNTAIN',
  },
]

const SHOP_ITEMS_CATALOG: Record<string, ShopCatalogItem> = {
  mago_sombrio: {
    id: 'mago_sombrio',
    titleLine1: 'MAGO SOMBRIO',
    price: 500,
    cardBg: '#E6B3FF',
    category: 'MAGOS',
    playerSkinId: 'player_shadow',
  },
  mago_dino: {
    id: 'mago_dino',
    titleLine1: 'DINO EXPLORADOR',
    price: 450,
    cardBg: '#A7F3D0',
    category: 'MAGOS',
    playerSkinId: 'player_dino',
  },
  mago_pirata: {
    id: 'mago_pirata',
    titleLine1: 'CAPITÃO PIRATA',
    price: 450,
    cardBg: '#FECACA',
    category: 'MAGOS',
    playerSkinId: 'player_pirate',
  },
  mago_classico: {
    id: 'mago_classico',
    titleLine1: 'MAGO CLÁSSICO',
    price: 350,
    cardBg: '#A5E3FF',
    category: 'MAGOS',
    playerSkinId: 'player_mage',
  },
  bloco_ouro: {
    id: 'bloco_ouro',
    titleLine1: 'BLOCO DE OURO',
    price: 1000,
    cardBg: '#FFE055',
    category: 'BLOCOS',
    blockSkinId: 'gold',
  },
  bloco_madeira: {
    id: 'bloco_madeira',
    titleLine1: 'BLOCO MADEIRA',
    price: 500,
    cardBg: '#FDE68A',
    category: 'BLOCOS',
    blockSkinId: 'wood',
  },
  bloco_diy: {
    id: 'bloco_diy',
    titleLine1: 'BLOCO PAPELÃO',
    price: 650,
    cardBg: '#E9D5FF',
    category: 'BLOCOS',
    blockSkinId: 'diy',
  },
  bloco_classico: {
    id: 'bloco_classico',
    titleLine1: 'BLOCO CLÁSSICO',
    price: 0,
    cardBg: '#9BA8B8',
    category: 'BLOCOS',
    blockSkinId: 'default',
    hideTitleWhenOwned: true,
  },
}

const SHOP_PLAYER_ITEM_IDS = [
  'mago_sombrio',
  'mago_dino',
  'mago_pirata',
  'mago_classico',
]

const SHOP_BLOCK_ITEM_IDS = [
  'bloco_ouro',
  'bloco_madeira',
  'bloco_diy',
  'bloco_classico',
]

const LOCAL_SHOP_COINS_KEY = 'toy_tower_local_shop_coins'
const LOCAL_SHOP_OWNED_KEY = 'toy_tower_local_shop_owned_items'

function loadInitialShopCoins(): number {
  if (typeof window === 'undefined') return 1250
  try {
    const raw = window.localStorage.getItem(LOCAL_SHOP_COINS_KEY)
    if (raw !== null) {
      const parsed = Number(raw)
      if (Number.isFinite(parsed) && parsed >= 0) return Math.floor(parsed)
    }
  } catch {
    // Ignore storage error
  }
  return 1250
}

function syncOwnedShopItemsWithSkinUnlocks(itemIds: string[]) {
  for (const id of itemIds) {
    const item = SHOP_ITEMS_CATALOG[id]
    if (!item) continue
    if (item.playerSkinId) {
      unlockLocalPlayerSkin(item.playerSkinId)
    }
    if (item.blockSkinId) {
      unlockLocalBlockSkin(item.blockSkinId)
    }
  }
}

function loadInitialOwnedShopItems(): string[] {
  const base = ['mago_classico', 'bloco_classico']
  if (typeof window === 'undefined') return base
  try {
    const raw = window.localStorage.getItem(LOCAL_SHOP_OWNED_KEY)
    if (!raw) {
      syncOwnedShopItemsWithSkinUnlocks(base)
      return base
    }
    const parsed = JSON.parse(raw)
    if (Array.isArray(parsed)) {
      const merged = Array.from(new Set([...base, ...parsed.map(String)]))
      syncOwnedShopItemsWithSkinUnlocks(merged)
      return merged
    }
  } catch {
    // Ignore storage error
  }
  syncOwnedShopItemsWithSkinUnlocks(base)
  return base
}

const shopActiveTab = ref<ShopCategoryTab>('TODOS')
const selectedShopItemId = ref<string>('mago_sombrio')
const selectedCoinPackageId = ref<string>('PACK_1200')
const isCreatingCoinOrder = ref<boolean>(false)
const localShopCoins = ref<number>(loadInitialShopCoins())
const ownedShopItemIds = ref<string[]>(loadInitialOwnedShopItems())
const shopPurchaseBurstActive = ref<boolean>(false)
let shopBurstTimer: number | null = null

const isMercadoPagoConfigured = computed<boolean>(() => {
  return Boolean(authStore.state.isMercadoPagoConfigured)
})

const selectedCoinPackage = computed<ShopCoinPackageItem>(() => {
  return (
    SHOP_COIN_PACKAGES.find((p) => p.id === selectedCoinPackageId.value) ||
    SHOP_COIN_PACKAGES[2]
  )
})

const displayedShopCoins = computed<number>(() => {
  const userCoins = authStore.state.user?.coins
  if (typeof userCoins === 'number' && userCoins > localShopCoins.value) {
    return userCoins
  }
  return localShopCoins.value
})

function formatShopCoins(amount: number): string {
  return Math.max(0, Math.floor(amount)).toLocaleString('pt-BR')
}

function getShopItemSpriteUrl(item: ShopCatalogItem): string {
  if (item.playerSkinId) {
    const found = playerSkins.value.find((s) => s.id === item.playerSkinId)
    return (
      found?.url ||
      spriteRegistry.getSkinSprite(item.playerSkinId, 'idle')?.src ||
      ''
    )
  }
  if (item.blockSkinId) {
    const found = blockSkins.value.find((s) => s.id === item.blockSkinId)
    return (
      found?.squarePreviewUrl ||
      found?.previewUrl ||
      found?.pieceUrls?.O ||
      found?.pieceUrls?.T ||
      ''
    )
  }
  return ''
}

const SHOP_ITEMS_PER_SHELF = 3

const currentShopShelfItems = computed<ShopCatalogItem[]>(() => {
  if (shopActiveTab.value === 'MAGOS') {
    return SHOP_PLAYER_ITEM_IDS.map((id) => SHOP_ITEMS_CATALOG[id]).filter(
      (item): item is ShopCatalogItem => Boolean(item)
    )
  }
  if (shopActiveTab.value === 'BLOCOS') {
    return SHOP_BLOCK_ITEM_IDS.map((id) => SHOP_ITEMS_CATALOG[id]).filter(
      (item): item is ShopCatalogItem => Boolean(item)
    )
  }
  if (shopActiveTab.value === 'MOEDAS') {
    return []
  }
  // 'TODOS': Exibe todas as skins reais de Magos e Blocos (3 itens por prateleira)
  return [
    ...SHOP_PLAYER_ITEM_IDS.map((id) => SHOP_ITEMS_CATALOG[id]),
    ...SHOP_BLOCK_ITEM_IDS.map((id) => SHOP_ITEMS_CATALOG[id]),
  ].filter((item): item is ShopCatalogItem => Boolean(item))
})

const shopShelvesList = computed<ShopCatalogItem[][]>(() => {
  const items = currentShopShelfItems.value
  const shelves: ShopCatalogItem[][] = []
  for (let i = 0; i < items.length; i += SHOP_ITEMS_PER_SHELF) {
    shelves.push(items.slice(i, i + SHOP_ITEMS_PER_SHELF))
  }
  while (shelves.length < 2) {
    shelves.push([])
  }
  return shelves
})

const selectedShopItem = computed<ShopCatalogItem>(() => {
  return (
    SHOP_ITEMS_CATALOG[selectedShopItemId.value] ||
    SHOP_ITEMS_CATALOG.mago_sombrio
  )
})

function isShopItemOwned(item: ShopCatalogItem): boolean {
  if (ownedShopItemIds.value.includes(item.id)) return true
  if (item.playerSkinId && isPlayerSkinUnlocked(item.playerSkinId)) {
    return true
  }
  if (item.blockSkinId && isBlockSkinUnlocked(item.blockSkinId)) {
    return true
  }
  return false
}

function saveLocalShopState() {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(
      LOCAL_SHOP_COINS_KEY,
      String(localShopCoins.value)
    )
    window.localStorage.setItem(
      LOCAL_SHOP_OWNED_KEY,
      JSON.stringify(ownedShopItemIds.value)
    )
  } catch {
    // Ignore storage error
  }
}

function selectShopTab(tab: ShopCategoryTab) {
  if (shopActiveTab.value === tab) {
    shopActiveTab.value = 'TODOS'
  } else {
    shopActiveTab.value = tab
    if (tab === 'MAGOS') {
      selectedShopItemId.value = 'mago_sombrio'
    } else if (tab === 'BLOCOS') {
      selectedShopItemId.value = 'bloco_ouro'
    } else if (tab === 'MOEDAS') {
      selectedCoinPackageId.value = 'PACK_1200'
    }
  }
  playToySfx('move')
}

function openCoinRechargeTab() {
  shopActiveTab.value = 'MOEDAS'
  selectedCoinPackageId.value = 'PACK_1200'
  playToySfx('click')
}

function selectShopItem(itemId: string) {
  selectedShopItemId.value = itemId
  playToySfx('click')
}

function selectCoinPackage(packId: string) {
  selectedCoinPackageId.value = packId
  playToySfx('click')
}

let coinOrderPollTimer: number | null = null

function startCoinOrderPolling(orderId: string) {
  if (typeof window === 'undefined' || !orderId) return
  if (coinOrderPollTimer !== null) {
    window.clearInterval(coinOrderPollTimer)
    coinOrderPollTimer = null
  }
  let attempts = 0
  coinOrderPollTimer = window.setInterval(async () => {
    attempts += 1
    if (attempts > 75) {
      if (coinOrderPollTimer !== null) {
        window.clearInterval(coinOrderPollTimer)
        coinOrderPollTimer = null
      }
      return
    }
    try {
      const res = await authStore.checkCoinOrderStatus(orderId)
      if (res.order.status === 'APPROVED') {
        if (coinOrderPollTimer !== null) {
          window.clearInterval(coinOrderPollTimer)
          coinOrderPollTimer = null
        }
        if (typeof authStore.state.user?.coins === 'number') {
          localShopCoins.value = authStore.state.user.coins
          saveLocalShopState()
        }
        playToySfx('victory')
        triggerShopPurchaseBurst()
        triggerBanner(
          `🎉 Pagamento aprovado! +${res.order.coinsAmount} moedas foram adicionadas à sua conta!`,
          'success'
        )
      } else if (
        res.order.status === 'REJECTED' ||
        res.order.status === 'CANCELLED'
      ) {
        if (coinOrderPollTimer !== null) {
          window.clearInterval(coinOrderPollTimer)
          coinOrderPollTimer = null
        }
      }
    } catch {
      // Ignore transient network poll errors
    }
  }, 4000)
}

async function handleRechargeCoinPackage(pack?: ShopCoinPackageItem) {
  const targetPack = pack || selectedCoinPackage.value
  if (!targetPack) return
  selectedCoinPackageId.value = targetPack.id

  if (!isMercadoPagoConfigured.value) {
    playToySfx('click')
    triggerBanner(
      '🔒 Recarga via Mercado Pago desativada até configurar as variáveis de ambiente (.env).',
      'info'
    )
    return
  }

  if (!authStore.state.user) {
    playToySfx('click')
    isAuthModalOpen.value = true
    triggerBanner(
      'Faça login na sua conta Google para recarregar moedas via Mercado Pago.',
      'warning'
    )
    return
  }

  if (isCreatingCoinOrder.value) return
  isCreatingCoinOrder.value = true
  playToySfx('click')

  try {
    const order = await authStore.createCoinOrder(targetPack.id, 'CARD')
    const redirectUrl = order.checkoutUrl || order.ticketUrl
    startCoinOrderPolling(order.orderId)
    if (redirectUrl && typeof window !== 'undefined') {
      window.open(redirectUrl, '_blank', 'noopener,noreferrer')
      triggerBanner(
        `Checkout Mercado Pago aberto para ${targetPack.title} (${targetPack.priceLabel})!`,
        'success'
      )
    } else {
      triggerBanner(
        `Pedido ${order.orderId} criado! Aguardando confirmação do Mercado Pago.`,
        'info'
      )
    }
  } catch (err) {
    triggerBanner(
      err instanceof Error
        ? err.message
        : 'Não foi possível iniciar a recarga via Mercado Pago.',
      'warning'
    )
  } finally {
    isCreatingCoinOrder.value = false
  }
}

function triggerShopPurchaseBurst() {
  if (shopBurstTimer !== null) {
    window.clearTimeout(shopBurstTimer)
  }
  shopPurchaseBurstActive.value = true
  shopBurstTimer = window.setTimeout(() => {
    shopPurchaseBurstActive.value = false
    shopBurstTimer = null
  }, 1100)
}

async function handleShopPrimaryAction() {
  if (shopActiveTab.value === 'MOEDAS') {
    await handleRechargeCoinPackage(selectedCoinPackage.value)
    return
  }

  const item = selectedShopItem.value
  if (!item) return

  // Na loja apenas compramos os itens (não equipa pela loja)
  if (isShopItemOwned(item)) {
    return
  }

  const fullTitle = item.titleLine2
    ? `${item.titleLine1} ${item.titleLine2}`
    : item.titleLine1

  const currentCoins = displayedShopCoins.value
  if (currentCoins < item.price) {
    playToySfx('click')
    openCoinRechargeTab()
    triggerBanner(
      `🪙 Moedas insuficientes para ${fullTitle}! Confira a aba Recarga de Moedas.`,
      'warning'
    )
    return
  }

  // Deduct coins & unlock skin (without equipping from the shop)
  const nextCoins = Math.max(0, currentCoins - item.price)
  localShopCoins.value = nextCoins
  if (authStore.state.user) {
    authStore.state.user.coins = nextCoins
  }
  if (!ownedShopItemIds.value.includes(item.id)) {
    ownedShopItemIds.value = [...ownedShopItemIds.value, item.id]
  }
  saveLocalShopState()

  if (item.playerSkinId) {
    unlockLocalPlayerSkin(item.playerSkinId)
    if (authStore.state.user) {
      void authStore
        .buySkinWithCoins(
          'PLAYER_SKIN',
          spriteIdToDbSkin(item.playerSkinId),
          false
        )
        .catch(() => {})
    }
  } else if (item.blockSkinId) {
    unlockLocalBlockSkin(item.blockSkinId)
    if (authStore.state.user) {
      void authStore
        .buySkinWithCoins(
          'BLOCK_SKIN',
          spriteIdToDbBlockSkin(item.blockSkinId),
          false
        )
        .catch(() => {})
    }
  }

  playToySfx('victory')
  triggerShopPurchaseBurst()
  triggerBanner(
    `🎉 Você comprou ${fullTitle}! Equipe na tela SKINS do menu.`,
    'success'
  )
}

function openShopScreen() {
  selectedMenuCard.value = 'STORE'
  shopActiveTab.value = 'TODOS'
  selectedShopItemId.value = 'mago_sombrio'
  selectedCoinPackageId.value = 'PACK_1200'
  isBurgerMenuOpen.value = false
  isSkinPickerOpen.value = false
  isAuthModalOpen.value = false
  isFriendsModalOpen.value = false
  isGameModeModalOpen.value = false
  isOptionsModalOpen.value = false
  void authStore.fetchShopCatalog().catch(() => {})
  playToySfx('click')
  screenFlow.value = 'SHOP_SCREEN'
}

function closeShopScreen() {
  playToySfx('click')
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
    } else {
      await document.exitFullscreen()
      isFullscreen.value = false
    }
  } catch {
    triggerBanner(
      'Não foi possível alternar Tela Cheia neste navegador.',
      'warning'
    )
  }
}

async function setFullscreenMode(targetFullscreen: boolean) {
  if (typeof document === 'undefined') return
  const currentlyFullscreen = Boolean(document.fullscreenElement)
  if (currentlyFullscreen === targetFullscreen) return
  await toggleFullscreen()
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
}

function toggleScreenShakeOption() {
  optionsStore.state.screenShakeEnabled = !optionsStore.state.screenShakeEnabled
  if (towerInstance) {
    towerInstance.screenShakeEnabled = optionsStore.state.screenShakeEnabled
  }
  playToySfx('click')
}

function toggleShowFpsPingOption() {
  optionsStore.state.showFpsPing = !optionsStore.state.showFpsPing
  playToySfx('click')
}

function toggleShowOpponentHandlesOption() {
  optionsStore.state.showOpponentHandles =
    !optionsStore.state.showOpponentHandles
  if (towerInstance) {
    towerInstance.showPlayerNicks = optionsStore.state.showOpponentHandles
  }
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
    towerInstance.screenShakeEnabled = optionsStore.state.screenShakeEnabled
    towerInstance.showPlayerNicks = optionsStore.state.showOpponentHandles
  }
  spriteRegistry.setDynamicTintEnabled(dynamicTintEnabled.value)
  triggerBanner(
    'Opções restauradas para o padrão!',
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
      } else if (selectedMenuCard.value === 'STORE') {
        openShopScreen()
      } else if (selectedMenuCard.value === 'SKINS') {
        openSkinsScreen()
      } else if (selectedMenuCard.value === 'MULTIPLAYER') {
        handleMultiplayerCardClick()
      } else {
        openLocalBattleLobby()
      }
    } else if (screenFlow.value === 'SKINS_SCREEN' || isSkinPickerOpen.value) {
      closeSkinsScreen()
    } else if (screenFlow.value === 'SHOP_SCREEN') {
      closeShopScreen()
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
      handle: '',
      customNick: r.customNick,
      skinSpriteId: dbSkinToSpriteId(r.equippedSkin),
      blockSkinId: dbBlockSkinToSpriteId(r.equippedBlockSkin),
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
          if (
            !isDevModeOpen.value &&
            !isOptionsModalOpen.value &&
            !isGameModeModalOpen.value &&
            !isGamePaused.value
          ) {
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

          towerInstance.screenShakeEnabled =
            optionsStore.state.screenShakeEnabled
          towerInstance.showPlayerNicks =
            optionsStore.state.showOpponentHandles
          if (!isOnlineMultiplayerMatch.value) {
            towerInstance.playerNick =
              authStore.state.user?.customNick ||
              authStore.state.user?.displayName ||
              fallbackLobbySlots.value[0]?.customNick ||
              'Jogador'
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
                screenFlow.value !== 'SKINS_SCREEN' &&
                screenFlow.value !== 'OPTIONS_SCREEN' &&
                screenFlow.value !== 'SHOP_SCREEN',
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

  // Botão Options: pausa/despausa durante a partida
  if (justOptions) {
    if (screenFlow.value === 'IN_GAME') {
      if (isOptionsModalOpen.value) {
        closeOptionsScreen()
      } else if (isGameModeModalOpen.value) {
        closeGameModeModal()
      } else {
        togglePauseGame()
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
    isOptionsModalOpen.value ||
    isGameModeModalOpen.value ||
    isGamePaused.value
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

function togglePauseGame(forceState?: boolean) {
  if (screenFlow.value !== 'IN_GAME') return
  const nextState =
    forceState !== undefined ? forceState : !isGamePaused.value
  isGamePaused.value = nextState
  isSkinPickerOpen.value = false
  playToySfx('click')
  if (nextState && towerInstance) {
    towerInstance.isSoftDropping = false
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

  // Tela de SKINS (SKINS_SCREEN ou Modal de Skins no Hub Multiplayer — Coluna Esquerda = Sua Skin, Coluna Direita = Skin dos Blocos)
  if (screenFlow.value === 'SKINS_SCREEN' || isSkinPickerOpen.value) {
    if (e.code === 'Escape' || e.code === 'Enter' || e.code === 'Space') {
      e.preventDefault()
      closeSkinsScreen()
    } else if (e.code === 'ArrowLeft' || e.code === 'KeyA') {
      e.preventDefault()
      selectedSkinsColumn.value = 'PLAYER'
      playToySfx('move')
    } else if (e.code === 'ArrowRight' || e.code === 'KeyD') {
      e.preventDefault()
      selectedSkinsColumn.value = 'BLOCK'
      playToySfx('move')
    } else if (e.code === 'ArrowUp' || e.code === 'KeyW') {
      e.preventDefault()
      if (selectedSkinsColumn.value === 'PLAYER') {
        cyclePlayerSkinOption(-1)
      } else {
        cycleBlockSkinOption(-1)
      }
    } else if (e.code === 'ArrowDown' || e.code === 'KeyS') {
      e.preventDefault()
      if (selectedSkinsColumn.value === 'PLAYER') {
        cyclePlayerSkinOption(1)
      } else {
        cycleBlockSkinOption(1)
      }
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

  // Tela de LOJA (SHOP_SCREEN)
  if (screenFlow.value === 'SHOP_SCREEN') {
    const items = currentShopShelfItems.value
    const curIdx = Math.max(
      0,
      items.findIndex((i) => i.id === selectedShopItemId.value)
    )
    if (e.code === 'Escape') {
      e.preventDefault()
      closeShopScreen()
    } else if (e.code === 'Enter' || e.code === 'Space') {
      e.preventDefault()
      void handleShopPrimaryAction()
    } else if (e.code === 'ArrowRight' || e.code === 'KeyD') {
      e.preventDefault()
      const next = items[(curIdx + 1) % items.length]
      if (next) selectShopItem(next.id)
    } else if (e.code === 'ArrowLeft' || e.code === 'KeyA') {
      e.preventDefault()
      const prev = items[(curIdx - 1 + items.length) % items.length]
      if (prev) selectShopItem(prev.id)
    } else if (e.code === 'ArrowDown' || e.code === 'KeyS') {
      e.preventDefault()
      const next = items[(curIdx + 3) % items.length]
      if (next) selectShopItem(next.id)
    } else if (e.code === 'ArrowUp' || e.code === 'KeyW') {
      e.preventDefault()
      const prev = items[(curIdx - 3 + items.length) % items.length]
      if (prev) selectShopItem(prev.id)
    }
    return
  }

  // Menu 2: MAIN_MENU — 3 cartões no topo (LOCAL, MULTIPLAYER, SKINS) e 2 embaixo (LOJA, OPÇÕES)
  if (screenFlow.value === 'MAIN_MENU') {
    if (e.code === 'ArrowLeft' || e.code === 'KeyA') {
      e.preventDefault()
      if (selectedMenuCard.value === 'SKINS') {
        selectedMenuCard.value = 'MULTIPLAYER'
      } else if (selectedMenuCard.value === 'MULTIPLAYER') {
        selectedMenuCard.value = 'LOCAL'
      } else if (selectedMenuCard.value === 'OPTIONS') {
        selectedMenuCard.value = 'STORE'
      }
      playToySfx('move')
    } else if (e.code === 'ArrowRight' || e.code === 'KeyD') {
      e.preventDefault()
      if (selectedMenuCard.value === 'LOCAL') {
        selectedMenuCard.value = 'MULTIPLAYER'
      } else if (selectedMenuCard.value === 'MULTIPLAYER') {
        selectedMenuCard.value = 'SKINS'
      } else if (selectedMenuCard.value === 'STORE') {
        selectedMenuCard.value = 'OPTIONS'
      }
      playToySfx('move')
    } else if (e.code === 'ArrowDown' || e.code === 'KeyS') {
      e.preventDefault()
      if (selectedMenuCard.value === 'LOCAL') {
        selectedMenuCard.value = 'STORE'
      } else if (selectedMenuCard.value === 'SKINS') {
        selectedMenuCard.value = 'OPTIONS'
      } else if (selectedMenuCard.value === 'MULTIPLAYER') {
        selectedMenuCard.value = 'STORE'
      }
      playToySfx('move')
    } else if (e.code === 'ArrowUp' || e.code === 'KeyW') {
      e.preventDefault()
      if (selectedMenuCard.value === 'STORE') {
        selectedMenuCard.value = 'LOCAL'
      } else if (selectedMenuCard.value === 'OPTIONS') {
        selectedMenuCard.value = 'SKINS'
      }
      playToySfx('move')
    } else if (e.code === 'Enter' || e.code === 'Space') {
      e.preventDefault()
      if (selectedMenuCard.value === 'MULTIPLAYER') {
        handleMultiplayerCardClick()
      } else if (selectedMenuCard.value === 'SKINS') {
        openSkinsScreen()
      } else if (selectedMenuCard.value === 'STORE') {
        openShopScreen()
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
    if (isEndTowerShowcaseActive.value) {
      return
    }
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

  if (e.code === 'Escape' || e.code === 'KeyP') {
    e.preventDefault()
    if (e.code === 'Escape' && isSkinPickerOpen.value) {
      isSkinPickerOpen.value = false
      return
    }
    togglePauseGame()
    return
  }

  if (optionsStore.matchesAction('restartMatch', e.code)) {
    e.preventDefault()
    if (
      !isOnlineMultiplayerMatch.value ||
      Object.keys(multiplayerClient.state.remoteLanes).length === 0
    ) {
      isGamePaused.value = false
      restartMatch(true)
    }
    return
  }

  // While Game Paused, Developer Mode, or Options Modal is open, ignore piece movement keys
  if (isGamePaused.value) {
    if (e.code === 'Enter' || e.code === 'Space') {
      e.preventDefault()
      togglePauseGame(false)
    }
    return
  }

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
  clearEndTowerShowcase()
  isGamePaused.value = false
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
  const cfg = getPowerConfig(powerId)
  towerInstance.mascotCastAnimMs = 950
  towerInstance.mascotCastCategory = cfg?.category || 'POSITIVE'
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
  if (!isPlayerSkinUnlocked(skinId)) {
    playToySfx('click')
    triggerBanner(
      '🔒 Esta skin de personagem está bloqueada! Adquira na Loja com suas moedas para liberar na sua conta.',
      'warning'
    )
    return
  }
  spriteRegistry.setActivePlayerSkin(skinId)
  activePlayerSkinId.value = spriteRegistry.getActivePlayerSkinId()
  if (towerInstance) {
    towerInstance.mascotCastAnimMs = 950
    towerInstance.mascotCastCategory = 'POSITIVE'
  }
  if (fallbackLobbySlots.value[0]) {
    fallbackLobbySlots.value[0].skinSpriteId = skinId
  }
  void authStore.syncEquippedSkinBySpriteId(skinId)
  multiplayerClient.updateEquippedSkin(spriteIdToDbSkin(skinId), undefined)
  playToySfx('click')
  const chosen = spriteRegistry.getActivePlayerSkin()
  triggerBanner(
    `🎭 Sua Skin alterada para ${chosen ? chosen.name : skinId}!`,
    'success'
  )
}

function selectBlockSkin(skinId: string) {
  if (!isBlockSkinUnlocked(skinId)) {
    playToySfx('click')
    triggerBanner(
      '🔒 Esta skin de blocos está bloqueada! Adquira na Loja com suas moedas para liberar na sua conta.',
      'warning'
    )
    return
  }
  spriteRegistry.setActiveBlockSkin(skinId)
  activeBlockSkinId.value = spriteRegistry.getActiveBlockSkinId()
  void authStore.syncEquippedBlockSkinById(skinId)
  multiplayerClient.updateEquippedSkin(
    undefined,
    spriteIdToDbBlockSkin(skinId)
  )
  playToySfx('click')
  const chosen = spriteRegistry.getActiveBlockSkin()
  triggerBanner(
    `${chosen?.emoji || '🧱'} Skin dos Blocos alterada para ${
      chosen ? chosen.name : skinId
    }!`,
    'success'
  )
}

function cyclePlayerSkinOption(dir: -1 | 1) {
  selectedSkinsColumn.value = 'PLAYER'
  const unlockedList = playerSkins.value.filter((s) =>
    isPlayerSkinUnlocked(s.id)
  )
  if (unlockedList.length <= 1) {
    playToySfx('click')
    triggerBanner(
      '🔒 Apenas a skin inicial (Mago Normal) está liberada! Adquira novas skins na Loja com suas moedas.',
      'info'
    )
    return
  }
  const curIdx = Math.max(
    0,
    unlockedList.findIndex((s) => s.id === activePlayerSkinId.value)
  )
  const nextIdx =
    (curIdx + dir + unlockedList.length) % unlockedList.length
  const nextSkin = unlockedList[nextIdx]
  if (nextSkin) {
    selectPlayerSkin(nextSkin.id)
  }
}

function cycleBlockSkinOption(dir: -1 | 1) {
  selectedSkinsColumn.value = 'BLOCK'
  const unlockedList = blockSkins.value.filter((s) =>
    isBlockSkinUnlocked(s.id)
  )
  if (unlockedList.length <= 1) {
    playToySfx('click')
    triggerBanner(
      '🔒 Apenas as peças iniciais (Plástico Normal) estão liberadas! Adquira novas skins na Loja com suas moedas.',
      'info'
    )
    return
  }
  const curIdx = Math.max(
    0,
    unlockedList.findIndex((s) => s.id === activeBlockSkinId.value)
  )
  const nextIdx =
    (curIdx + dir + unlockedList.length) % unlockedList.length
  const nextSkin = unlockedList[nextIdx]
  if (nextSkin) {
    selectBlockSkin(nextSkin.id)
  }
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
  void authStore.fetchShopCatalog()
  void authStore.restoreSession().then((restoredUser) => {
    activePlayerSkinId.value = spriteRegistry.getActivePlayerSkinId()
    activeBlockSkinId.value = spriteRegistry.getActiveBlockSkinId()
    if (restoredUser) {
      optionsNickInput.value = restoredUser.customNick || restoredUser.displayName
      personalBestScore.value = Math.max(
        personalBestScore.value,
        authStore.getPersonalBest()
      )
      multiplayerClient.connect()
      if (typeof window !== 'undefined') {
        const params = new URLSearchParams(window.location.search)
        const returnedOrderId = (params.get('shopOrder') || '').trim()
        if (returnedOrderId) {
          startCoinOrderPolling(returnedOrderId)
          window.history.replaceState({}, document.title, window.location.pathname)
        }
      }
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
      towerInstance?.freezeTowerForMatchEnd()
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
      clearEndTowerShowcase()
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
    blockSkins.value = [...spriteRegistry.getBlockSkins()]
    activeBlockSkinId.value = spriteRegistry.getActiveBlockSkinId()
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
  clearEndTowerShowcase()
  if (coinOrderPollTimer !== null) {
    window.clearInterval(coinOrderPollTimer)
    coinOrderPollTimer = null
  }
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

    <!-- Contador de FPS discreto no topo da tela (apenas o número, sem box) -->
    <div
      v-if="optionsStore.state.showFpsPing"
      class="discreet-fps-counter mono"
    >
      {{ liveFps }}
    </div>

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

            <!-- Botão 1: AMIGOS (somente quando logado) -->
            <button
              v-if="authStore.state.user"
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

            <!-- Botão 2: ENVIAR CONVITE (somente quando logado) -->
            <button
              v-if="authStore.state.user"
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
              @click="
                isBurgerMenuOpen = false;
                authStore.state.error = null;
                isAuthModalOpen = true;
              "
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

          <!-- BLOCO 3: SKINS (ATIVO) -->
          <div
            role="button"
            tabindex="0"
            class="menu-brick-card menu-brick-card--active"
            :class="{
              'menu-brick-card--selected': selectedMenuCard === 'SKINS',
            }"
            @mouseenter="selectedMenuCard = 'SKINS'"
            @focus="selectedMenuCard = 'SKINS'"
            @click="openSkinsScreen()"
            @keydown.enter.prevent="openSkinsScreen()"
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
                :src="menuSprites.screen_skins"
                alt="Skins"
                class="menu-brick-card-img"
                draggable="false"
              />
              <span class="menu-brick-card-title menu-brick-card-title--narrow">
                SKINS
              </span>
            </div>
          </div>

          <!-- BLOCO 4: LOJA (ATIVA — BASEADA EM screen_store.png) -->
          <div
            role="button"
            tabindex="0"
            class="menu-brick-card menu-brick-card--active"
            :class="{
              'menu-brick-card--selected': selectedMenuCard === 'STORE',
            }"
            title="Abrir Loja Toy Tower"
            @mouseenter="selectedMenuCard = 'STORE'"
            @focus="selectedMenuCard = 'STORE'"
            @click="openShopScreen"
            @keydown.enter.prevent="openShopScreen"
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
                :src="menuSprites.screen_store"
                alt="Loja"
                class="menu-brick-card-img"
                draggable="false"
              />
              <span class="menu-brick-card-title menu-brick-card-title--store">
                LOJA
              </span>
            </div>
          </div>

          <!-- BLOCO 5: OPÇÕES (ATIVO) -->
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
    <!-- TELA DA LOJA ("LOJA TOY TOWER"): ESTANTE LEGO + BANCA DOS VENDEDORES -->
    <!-- =================================================================== -->
    <transition name="menu-fade-300">
      <div
        v-if="screenFlow === 'SHOP_SCREEN'"
        class="selecione-modo-screen shop-screen-overlay"
      >
        <!-- Partículas mágicas de ambiente ao fundo da Loja -->
        <div class="shop-ambient-particles" aria-hidden="true">
          <span
            v-for="n in 14"
            :key="`shop-bg-mote-${n}`"
            class="shop-ambient-mote"
            :class="`shop-ambient-mote--${n}`"
          ></span>
        </div>

        <!-- TOPO DA LOJA: Botão X LEGO, Título "LOJA TOY TOWER" e Contador de Moedas LEGO -->
        <header class="shop-top-header">
          <!-- Botão Fechar (X) estilo Peça LEGO Vermelha -->
          <button
            type="button"
            class="shop-close-lego-btn"
            title="Voltar ao Menu Principal (Esc)"
            @click="closeShopScreen"
          >
            <span class="shop-close-lego-studs" aria-hidden="true">
              <span></span>
              <span></span>
            </span>
            <span class="shop-close-lego-body">
              <span class="shop-close-lego-x">X</span>
            </span>
          </button>

          <!-- Título Central: LOJA (Amarelo) TOY (Azul) TOWER (Vermelho) -->
          <h1 class="shop-header-title" aria-label="Loja Toy Tower">
            <span class="shop-title-part shop-title-part--loja">LOJA</span>
            <span class="shop-title-part shop-title-part--toy">TOY</span>
            <span class="shop-title-part shop-title-part--tower">TOWER</span>
          </h1>

          <!-- Contador de Moedas estilo Bloco LEGO Dourado (Clica para abrir Recarga de Moedas) -->
          <button
            type="button"
            class="shop-coin-lego-counter"
            :class="{
              'shop-coin-lego-counter--active': shopActiveTab === 'MOEDAS',
            }"
            title="Recarga de Moedas"
            @click="openCoinRechargeTab"
          >
            <span class="shop-coin-side-studs" aria-hidden="true">
              <span></span>
              <span></span>
            </span>
            <span class="shop-coin-top-studs" aria-hidden="true">
              <span></span>
              <span></span>
              <span></span>
              <span></span>
            </span>
            <span class="shop-coin-brick-body">
              <span class="shop-coin-brick-left-cap" aria-hidden="true"></span>
              <span class="shop-coin-inset-box">
                <span class="shop-coin-amount">
                  {{ formatShopCoins(displayedShopCoins) }}
                </span>
                <!-- Ícone de Moeda Dourada com Coroa -->
                <svg
                  class="shop-coin-svg-icon"
                  viewBox="0 0 36 36"
                  aria-hidden="true"
                >
                  <circle
                    cx="18"
                    cy="18"
                    r="15"
                    fill="#F59E0B"
                    stroke="#14111F"
                    stroke-width="3.2"
                  />
                  <circle
                    cx="18"
                    cy="18"
                    r="11"
                    fill="#FBBF24"
                    stroke="#B45309"
                    stroke-width="2"
                  />
                  <path
                    d="M 11,22 L 12.5,14 L 15.8,17.2 L 18,12.5 L 20.2,17.2 L 23.5,14 L 25,22 Z"
                    fill="#FDE047"
                    stroke="#92400E"
                    stroke-width="1.5"
                    stroke-linejoin="round"
                  />
                </svg>
              </span>
            </span>
          </button>
        </header>

        <!-- CORPO PRINCIPAL DA LOJA: ESQUERDA (Vitrine LEGO) + DIREITA (Banca Animada) -->
        <div class="shop-main-content">
          <!-- =============================================================== -->
          <!-- PAINEL ESQUERDO: MOLDURA LEGO COM PINOS + ABAS + CONTEÚDO        -->
          <!-- =============================================================== -->
          <section class="shop-left-lego-panel" aria-label="Catálogo da Loja">
            <!-- Pinos superiores da moldura LEGO -->
            <div class="shop-frame-top-studs" aria-hidden="true">
              <span v-for="s in 14" :key="`top-stud-${s}`"></span>
            </div>

            <div class="shop-frame-outer-box">
              <!-- Barra Superior da Moldura com Pinos Circulares -->
              <div class="shop-frame-beam-top" aria-hidden="true">
                <span
                  v-for="s in 14"
                  :key="`beam-top-stud-${s}`"
                  class="shop-stud-circle"
                ></span>
              </div>

              <!-- Coluna Lateral Esquerda (Azul -> Laranja -> Azul -> Laranja) -->
              <div class="shop-frame-col shop-frame-col--left" aria-hidden="true">
                <div class="shop-frame-segment shop-frame-segment--blue-top">
                  <span v-for="s in 3" :key="`l-bt-${s}`" class="shop-stud-circle"></span>
                </div>
                <div class="shop-frame-segment shop-frame-segment--orange-mid">
                  <span
                    v-for="s in 6"
                    :key="`l-om-${s}`"
                    class="shop-stud-circle shop-stud-circle--orange"
                  ></span>
                </div>
                <div class="shop-frame-segment shop-frame-segment--blue-bot">
                  <span v-for="s in 4" :key="`l-bb-${s}`" class="shop-stud-circle"></span>
                </div>
              </div>

              <!-- Coluna Lateral Direita (Azul -> Laranja -> Azul -> Laranja) -->
              <div class="shop-frame-col shop-frame-col--right" aria-hidden="true">
                <div class="shop-frame-segment shop-frame-segment--blue-top">
                  <span v-for="s in 3" :key="`r-bt-${s}`" class="shop-stud-circle"></span>
                </div>
                <div class="shop-frame-segment shop-frame-segment--orange-mid">
                  <span
                    v-for="s in 6"
                    :key="`r-om-${s}`"
                    class="shop-stud-circle shop-stud-circle--orange"
                  ></span>
                </div>
                <div class="shop-frame-segment shop-frame-segment--blue-bot">
                  <span v-for="s in 4" :key="`r-bb-${s}`" class="shop-stud-circle"></span>
                </div>
              </div>

              <!-- Interior do Armário LEGO -->
              <div class="shop-cabinet-inner">
                <!-- 3 Abas Reais usando os Sprites de Blocos Dinâmicos (MAGOS, BLOCOS, MOEDAS) -->
                <nav class="shop-category-tabs" aria-label="Categorias da Loja">
                  <button
                    type="button"
                    class="shop-tab-brick"
                    :class="{ 'shop-tab-brick--active': shopActiveTab === 'MAGOS' }"
                    @click="selectShopTab('MAGOS')"
                  >
                    <img
                      :src="menuSprites.button_clean_purple || menuSprites.button_clean"
                      alt=""
                      class="shop-tab-brick-img"
                      aria-hidden="true"
                      draggable="false"
                    />
                    <span class="shop-tab-brick-label">MAGOS</span>
                  </button>

                  <button
                    type="button"
                    class="shop-tab-brick"
                    :class="{ 'shop-tab-brick--active': shopActiveTab === 'BLOCOS' }"
                    @click="selectShopTab('BLOCOS')"
                  >
                    <img
                      :src="menuSprites.button_clean_orange || menuSprites.button_clean"
                      alt=""
                      class="shop-tab-brick-img"
                      aria-hidden="true"
                      draggable="false"
                    />
                    <span class="shop-tab-brick-label">BLOCOS</span>
                  </button>

                  <button
                    type="button"
                    class="shop-tab-brick"
                    :class="{ 'shop-tab-brick--active': shopActiveTab === 'MOEDAS' }"
                    @click="selectShopTab('MOEDAS')"
                  >
                    <img
                      :src="menuSprites.button_clean_yellow || menuSprites.button_clean"
                      alt=""
                      class="shop-tab-brick-img"
                      aria-hidden="true"
                      draggable="false"
                    />
                    <span class="shop-tab-brick-label">MOEDAS</span>
                  </button>
                </nav>

                <!-- ========================================================= -->
                <!-- VISÃO 1: ABA "RECARGA DE MOEDAS" (GRID 3x2 DE PACOTES)    -->
                <!-- ========================================================= -->
                <div
                  v-if="shopActiveTab === 'MOEDAS'"
                  class="shop-coins-recharge-view"
                >
                  <div class="shop-coins-recharge-header">
                    <span class="shop-coins-recharge-title">RECARGA DE MOEDAS</span>
                    <span
                      v-if="!isMercadoPagoConfigured"
                      class="shop-coins-mp-status-pill"
                      title="Configure MERCADOPAGO_ACCESS_TOKEN e VITE_MERCADOPAGO_PUBLIC_KEY no .env para ativar compras reais"
                    >
                      MERCADO PAGO DESATIVADO
                    </span>
                  </div>

                  <div class="shop-coins-grid">
                    <div
                      v-for="pack in SHOP_COIN_PACKAGES"
                      :key="pack.id"
                      class="shop-coin-pack-card"
                      :class="[
                        `shop-coin-pack-card--${pack.cardVariant}`,
                        {
                          'shop-coin-pack-card--selected':
                            selectedCoinPackageId === pack.id,
                        },
                      ]"
                      @click="selectCoinPackage(pack.id)"
                    >
                      <!-- Selo Superior Opcional (MAIS POPULAR / MELHOR PREÇO / MUITO OURO!) -->
                      <div
                        v-if="pack.badge"
                        class="shop-coin-pack-badge"
                        :class="`shop-coin-pack-badge--${pack.badgeVariant || 'popular'}`"
                      >
                        <span>{{ pack.badge }}</span>
                      </div>

                      <div class="shop-coin-pack-surface">
                        <!-- Quantidade de Moedas no Topo + Ícone de Moeda -->
                        <div class="shop-coin-pack-amount-row">
                          <span class="shop-coin-pack-amount-num">
                            {{ pack.coinsLabel }}
                          </span>
                          <svg
                            class="shop-coin-pack-amount-icon"
                            viewBox="0 0 36 36"
                            aria-hidden="true"
                          >
                            <circle
                              cx="18"
                              cy="18"
                              r="15"
                              fill="#F59E0B"
                              stroke="#14111F"
                              stroke-width="3.2"
                            />
                            <circle
                              cx="18"
                              cy="18"
                              r="10.5"
                              fill="#FBBF24"
                              stroke="#B45309"
                              stroke-width="2"
                            />
                            <path
                              d="M 11,22 L 12.5,14 L 15.8,17.2 L 18,12.5 L 20.2,17.2 L 23.5,14 L 25,22 Z"
                              fill="#FDE047"
                              stroke="#92400E"
                              stroke-width="1.4"
                              stroke-linejoin="round"
                            />
                          </svg>
                        </div>

                        <!-- Ilustração Vetorial do Pacote (igual à imagem de referência) -->
                        <div class="shop-coin-pack-art" aria-hidden="true">
                          <!-- 1. PUNHADO DE MOEDAS (150) -->
                          <svg
                            v-if="pack.artType === 'PILE'"
                            viewBox="0 0 120 76"
                            class="shop-coin-pack-svg"
                          >
                            <ellipse cx="60" cy="64" rx="44" ry="8" fill="rgba(20,17,31,0.18)" />
                            <!-- Moedas empilhadas -->
                            <g stroke="#14111F" stroke-width="2.6">
                              <ellipse cx="36" cy="54" rx="15" ry="7" fill="#D97706" />
                              <ellipse cx="36" cy="50" rx="15" ry="7" fill="#FBBF24" />
                              <ellipse cx="82" cy="55" rx="15" ry="7" fill="#D97706" />
                              <ellipse cx="82" cy="51" rx="15" ry="7" fill="#FBBF24" />
                              <ellipse cx="58" cy="58" rx="17" ry="7.5" fill="#D97706" />
                              <ellipse cx="58" cy="53" rx="17" ry="7.5" fill="#FBBF24" />
                              <ellipse cx="58" cy="48" rx="17" ry="7.5" fill="#FDE047" />
                              <!-- Moeda em pé central com coroa -->
                              <circle cx="59" cy="34" r="16" fill="#F59E0B" />
                              <circle cx="59" cy="34" r="11.5" fill="#FDE047" stroke="#B45309" stroke-width="1.8" />
                              <path
                                d="M 52,38 L 53.5,30 L 56.5,33 L 59,28.5 L 61.5,33 L 64.5,30 L 66,38 Z"
                                fill="#F59E0B"
                                stroke="#92400E"
                                stroke-width="1.2"
                                stroke-linejoin="round"
                              />
                            </g>
                            <path d="M 24,24 L 26,18 L 28,24 L 34,26 L 28,28 L 26,34 L 24,28 L 18,26 Z" fill="#FFFFFF" />
                            <path d="M 92,20 L 93.5,15 L 95,20 L 100,21.5 L 95,23 L 93.5,28 L 92,23 L 87,21.5 Z" fill="#FEF08A" />
                          </svg>

                          <!-- 2. SACO DE MOEDAS (500) -->
                          <svg
                            v-else-if="pack.artType === 'SACK'"
                            viewBox="0 0 120 76"
                            class="shop-coin-pack-svg"
                          >
                            <ellipse cx="60" cy="66" rx="44" ry="8" fill="rgba(20,17,31,0.2)" />
                            <!-- Moedas ao redor da base -->
                            <g stroke="#14111F" stroke-width="2.4">
                              <ellipse cx="28" cy="59" rx="12" ry="5.5" fill="#F59E0B" />
                              <ellipse cx="92" cy="58" rx="12" ry="5.5" fill="#F59E0B" />
                              <!-- Corpo do saco de pano marrom -->
                              <path
                                d="M 43,25 C 30,33 27,54 36,63 C 45,68 75,68 84,63 C 93,54 90,33 77,25 Z"
                                fill="#9A5B32"
                                stroke-width="3"
                                stroke-linejoin="round"
                              />
                              <path
                                d="M 47,28 C 37,35 35,52 42,60"
                                fill="none"
                                stroke="#C27D4E"
                                stroke-width="3"
                                stroke-linecap="round"
                              />
                              <!-- Moedas transbordando no topo do saco -->
                              <circle cx="51" cy="21" r="8" fill="#FBBF24" />
                              <circle cx="60" cy="18" r="9" fill="#FDE047" />
                              <circle cx="69" cy="21" r="8" fill="#F59E0B" />
                              <!-- Corda amarrada -->
                              <rect x="42" y="23" width="36" height="6" rx="3" fill="#D97706" />
                              <!-- Emblema de moeda no saco -->
                              <circle cx="60" cy="46" r="10.5" fill="#FBBF24" />
                              <circle cx="60" cy="46" r="7" fill="#FDE047" stroke="#B45309" stroke-width="1.5" />
                            </g>
                          </svg>

                          <!-- 3. BAÚ PEQUENO (1.200) -->
                          <svg
                            v-else-if="pack.artType === 'CHEST_SMALL'"
                            viewBox="0 0 120 76"
                            class="shop-coin-pack-svg"
                          >
                            <ellipse cx="60" cy="65" rx="46" ry="8" fill="rgba(20,17,31,0.22)" />
                            <g stroke="#14111F" stroke-width="2.6" stroke-linejoin="round">
                              <!-- Base de madeira do baú -->
                              <rect x="26" y="34" width="58" height="28" rx="4" fill="#8C4A23" />
                              <!-- Tampa arqueada do baú -->
                              <path d="M 24,34 C 24,19 86,19 86,34 Z" fill="#A85B2E" />
                              <!-- Faixas metálicas douradas -->
                              <rect x="33" y="22" width="8" height="40" fill="#FBBF24" />
                              <rect x="69" y="22" width="8" height="40" fill="#FBBF24" />
                              <rect x="25" y="32" width="60" height="6" fill="#F59E0B" />
                              <!-- Fechadura central -->
                              <rect x="49" y="30" width="12" height="14" rx="3" fill="#FDE047" />
                              <circle cx="55" cy="36" r="2" fill="#14111F" />
                              <!-- Moedas ao lado direito do baú -->
                              <ellipse cx="89" cy="60" rx="11" ry="5" fill="#F59E0B" />
                              <circle cx="92" cy="49" r="11" fill="#FBBF24" />
                              <circle cx="92" cy="49" r="7.5" fill="#FDE047" stroke="#B45309" stroke-width="1.5" />
                            </g>
                          </svg>

                          <!-- 4. BAÚ GRANDE ABERTO (3.000) -->
                          <svg
                            v-else-if="pack.artType === 'CHEST_OPEN'"
                            viewBox="0 0 120 76"
                            class="shop-coin-pack-svg"
                          >
                            <ellipse cx="60" cy="66" rx="48" ry="8" fill="rgba(20,17,31,0.22)" />
                            <g stroke="#14111F" stroke-width="2.5" stroke-linejoin="round">
                              <!-- Tampa aberta ao fundo -->
                              <path d="M 24,28 C 26,12 94,12 96,28 Z" fill="#7C3F1D" />
                              <rect x="34" y="15" width="8" height="14" fill="#F59E0B" />
                              <rect x="78" y="15" width="8" height="14" fill="#F59E0B" />
                              <!-- Monte de moedas de ouro brilhantes dentro do baú -->
                              <circle cx="40" cy="31" r="9" fill="#F59E0B" />
                              <circle cx="52" cy="27" r="10" fill="#FDE047" />
                              <circle cx="67" cy="27" r="10" fill="#FBBF24" />
                              <circle cx="80" cy="31" r="9" fill="#F59E0B" />
                              <circle cx="60" cy="32" r="10" fill="#FEF08A" />
                              <!-- Caixa inferior do baú -->
                              <rect x="24" y="34" width="72" height="29" rx="4" fill="#9A5229" />
                              <rect x="33" y="34" width="9" height="29" fill="#FBBF24" />
                              <rect x="78" y="34" width="9" height="29" fill="#FBBF24" />
                              <!-- Fechadura dourada -->
                              <rect x="53" y="32" width="14" height="15" rx="3" fill="#FDE047" />
                              <circle cx="60" cy="39" r="2.2" fill="#14111F" />
                            </g>
                            <path d="M 18,22 L 20,16 L 22,22 L 28,24 L 22,26 L 20,32 L 18,26 L 12,24 Z" fill="#FFFFFF" />
                            <path d="M 100,18 L 101.5,13 L 103,18 L 108,19.5 L 103,21 L 101.5,26 L 100,21 L 95,19.5 Z" fill="#FEF08A" />
                          </svg>

                          <!-- 5. CAIXA FORTE (6.000) -->
                          <svg
                            v-else-if="pack.artType === 'SAFE'"
                            viewBox="0 0 120 76"
                            class="shop-coin-pack-svg"
                          >
                            <ellipse cx="60" cy="66" rx="48" ry="8" fill="rgba(20,17,31,0.24)" />
                            <g stroke="#14111F" stroke-width="2.6" stroke-linejoin="round">
                              <!-- Moedas espalhadas na base do cofre -->
                              <ellipse cx="24" cy="60" rx="11" ry="5" fill="#F59E0B" />
                              <ellipse cx="96" cy="60" rx="11" ry="5" fill="#F59E0B" />
                              <!-- Pés do cofre -->
                              <rect x="34" y="59" width="10" height="6" rx="1.5" fill="#334155" />
                              <rect x="76" y="59" width="10" height="6" rx="1.5" fill="#334155" />
                              <!-- Corpo blindado de aço -->
                              <rect x="28" y="13" width="64" height="48" rx="6" fill="#64748B" />
                              <!-- Porta interna do cofre -->
                              <rect x="35" y="19" width="50" height="36" rx="4" fill="#94A3B8" />
                              <!-- Dobradiças direitas -->
                              <rect x="82" y="23" width="6" height="8" rx="1.5" fill="#475569" />
                              <rect x="82" y="42" width="6" height="8" rx="1.5" fill="#475569" />
                              <!-- Volante giratório dourado/metálico do cofre -->
                              <circle cx="57" cy="37" r="12" fill="#E2E8F0" />
                              <line x1="57" y1="25" x2="57" y2="49" stroke="#14111F" stroke-width="2.6" />
                              <line x1="45" y1="37" x2="69" y2="37" stroke="#14111F" stroke-width="2.6" />
                              <circle cx="57" cy="37" r="5" fill="#FBBF24" />
                              <!-- Pilha de moedas na frente -->
                              <ellipse cx="86" cy="62" rx="12" ry="5.5" fill="#FBBF24" />
                              <ellipse cx="86" cy="58" rx="12" ry="5.5" fill="#FDE047" />
                            </g>
                          </svg>

                          <!-- 6. FORTUNA DO ABISMO (15.000) -->
                          <svg
                            v-else
                            viewBox="0 0 120 76"
                            class="shop-coin-pack-svg"
                          >
                            <ellipse cx="60" cy="67" rx="52" ry="8" fill="rgba(20,17,31,0.25)" />
                            <g stroke="#14111F" stroke-width="2.4" stroke-linejoin="round">
                              <!-- Picos da montanha rochosa ao fundo -->
                              <polygon points="16,62 44,14 72,62" fill="#64748B" />
                              <polygon points="44,14 57,36 37,38" fill="#CBD5E1" />
                              <polygon points="48,62 78,18 106,62" fill="#475569" />
                              <polygon points="78,18 89,35 70,36" fill="#94A3B8" />
                              <!-- Montanha de ouro brilhante na base -->
                              <path
                                d="M 14,63 C 22,40 42,33 60,33 C 78,33 98,40 106,63 Z"
                                fill="#F59E0B"
                              />
                              <path
                                d="M 22,63 C 30,45 45,39 60,39 C 75,39 90,45 98,63 Z"
                                fill="#FDE047"
                              />
                              <!-- 2 Baús de tesouro sobre a montanha de ouro -->
                              <rect x="26" y="42" width="26" height="16" rx="2.5" fill="#8C4A23" />
                              <rect x="30" y="42" width="4" height="16" fill="#FBBF24" />
                              <rect x="44" y="42" width="4" height="16" fill="#FBBF24" />
                              <rect x="68" y="40" width="28" height="18" rx="2.5" fill="#8C4A23" />
                              <rect x="72" y="40" width="4" height="18" fill="#FBBF24" />
                              <rect x="88" y="40" width="4" height="18" fill="#FBBF24" />
                              <!-- Moeda central em destaque -->
                              <circle cx="60" cy="52" r="11" fill="#FBBF24" />
                              <circle cx="60" cy="52" r="7.5" fill="#FEF08A" stroke="#B45309" stroke-width="1.5" />
                            </g>
                            <path d="M 20,22 L 22,15 L 24,22 L 31,24 L 24,26 L 22,33 L 20,26 L 13,24 Z" fill="#FFFFFF" />
                            <path d="M 98,16 L 100,10 L 102,16 L 108,18 L 102,20 L 100,26 L 98,20 L 92,18 Z" fill="#FEF08A" />
                          </svg>
                        </div>

                        <!-- Nome do Pacote e Bônus -->
                        <div class="shop-coin-pack-captions">
                          <span class="shop-coin-pack-title">{{ pack.title }}</span>
                          <span
                            v-if="pack.bonusLabel"
                            class="shop-coin-pack-bonus"
                          >
                            {{ pack.bonusLabel }}
                          </span>
                        </div>

                        <!-- Botão de Preço em Reais (Mercado Pago — desativado até configurar .env) -->
                        <button
                          type="button"
                          class="shop-coin-pack-price-btn"
                          :class="{
                            'shop-coin-pack-price-btn--disabled':
                              !isMercadoPagoConfigured || isCreatingCoinOrder,
                          }"
                          :disabled="!isMercadoPagoConfigured || isCreatingCoinOrder"
                          :title="
                            isMercadoPagoConfigured
                              ? `Recarregar ${pack.coinsLabel} moedas por ${pack.priceLabel} via Mercado Pago`
                              : 'Recarga via Mercado Pago desativada até configurar as variáveis de ambiente (.env)'
                          "
                          @click.stop="handleRechargeCoinPackage(pack)"
                        >
                          <span>{{ pack.priceLabel }}</span>
                        </button>
                      </div>
                    </div>
                  </div>
                </div>

                <!-- ========================================================= -->
                <!-- VISÃO 2: PRATELEIRAS DE MADEIRA (3 ITENS POR PRATELEIRA)  -->
                <!-- ========================================================= -->
                <div v-else class="shop-shelves-container">
                  <div
                    v-for="(shelfItems, shelfIdx) in shopShelvesList"
                    :key="`shop-shelf-${shelfIdx}`"
                    class="shop-shelf-unit"
                  >
                    <div class="shop-shelf-cards-row">
                      <button
                        v-for="item in shelfItems"
                        :key="item.id"
                        type="button"
                        class="shop-item-card"
                        :class="{
                          'shop-item-card--selected': selectedShopItemId === item.id,
                          'shop-item-card--owned': isShopItemOwned(item),
                        }"
                        :style="{ '--shop-card-bg': item.cardBg }"
                        @click="selectShopItem(item.id)"
                      >
                        <div class="shop-item-card-surface">
                          <!-- Sprite Real do Item (Player Skin ou Block Skin) -->
                          <div class="shop-item-visual">
                            <img
                              :src="getShopItemSpriteUrl(item)"
                              :alt="item.titleLine1"
                              class="shop-item-sprite"
                              :class="{
                                'shop-item-sprite--player': Boolean(item.playerSkinId),
                                'shop-item-sprite--block': Boolean(item.blockSkinId),
                                'shop-item-sprite--gold': item.blockSkinId === 'gold',
                              }"
                              draggable="false"
                            />
                          </div>

                          <!-- Nome do Item no Card (Oculto no Bloco Clássico quando Obtido, igual à imagem) -->
                          <div
                            v-if="!(isShopItemOwned(item) && item.hideTitleWhenOwned)"
                            class="shop-item-title-wrap"
                          >
                            <span class="shop-item-title-line">{{ item.titleLine1 }}</span>
                            <span
                              v-if="item.titleLine2"
                              class="shop-item-title-line"
                            >
                              {{ item.titleLine2 }}
                            </span>
                          </div>

                          <!-- Carimbo Verde Inclinado "OBTIDO" quando já adquirido -->
                          <div
                            v-if="isShopItemOwned(item)"
                            class="shop-item-owned-stamp"
                          >
                            <span>OBTIDO</span>
                          </div>
                        </div>

                        <!-- Plaquinha de Preço na Base da Prateleira (quando ainda não obtido) -->
                        <div
                          v-if="!isShopItemOwned(item)"
                          class="shop-item-price-tag"
                        >
                          <span class="shop-item-price-num">
                            {{ formatShopCoins(item.price) }}
                          </span>
                          <span class="shop-item-price-coin" aria-hidden="true"></span>
                        </div>
                      </button>
                    </div>

                    <!-- Tábua de Madeira Horizontal da Prateleira + Suportes -->
                    <div class="shop-wood-shelf-plank" aria-hidden="true">
                      <span class="shop-wood-shelf-bracket shop-wood-shelf-bracket--left"></span>
                      <span class="shop-wood-shelf-bracket shop-wood-shelf-bracket--right"></span>
                    </div>
                  </div>
                </div>
              </div>

              <!-- Barra Inferior da Moldura (Cantos Laranja + Centro Azul com Pinos) -->
              <div class="shop-frame-beam-bottom" aria-hidden="true">
                <div class="shop-frame-bot-corner shop-frame-bot-corner--left">
                  <span
                    v-for="s in 3"
                    :key="`bot-l-${s}`"
                    class="shop-stud-circle shop-stud-circle--orange"
                  ></span>
                </div>
                <div class="shop-frame-bot-center">
                  <span
                    v-for="s in 8"
                    :key="`bot-c-${s}`"
                    class="shop-stud-circle"
                  ></span>
                </div>
                <div class="shop-frame-bot-corner shop-frame-bot-corner--right">
                  <span
                    v-for="s in 3"
                    :key="`bot-r-${s}`"
                    class="shop-stud-circle shop-stud-circle--orange"
                  ></span>
                </div>
              </div>
            </div>
          </section>

          <!-- =============================================================== -->
          <!-- PAINEL DIREITO: BANCA ANIMADA (shelf.png + vendedores + table)  -->
          <!-- =============================================================== -->
          <section class="shop-right-stall-panel" aria-label="Balcão da Loja">
            <div
              class="shop-stall-scene"
              :class="{ 'shop-stall-scene--burst': shopPurchaseBurstActive }"
            >
              <!-- CAMADA 1 (FUNDO): Prateleira e estrutura de madeira (shelf.png) -->
              <img
                :src="menuSprites.shelf"
                alt=""
                class="shop-scene-shelf-bg"
                draggable="false"
              />

              <!-- CAMADA 2 (VITRINE CENTRAL SUPERIOR): Brilho Mágico + Item ou Pacote Selecionado -->
              <div class="shop-showcase-stage">
                <!-- Aura mágica rosada/dourada atrás do item em destaque -->
                <div class="shop-showcase-aura" aria-hidden="true"></div>

                <!-- Estrelas de 4 pontas e partículas cintilantes ao redor do item -->
                <div class="shop-showcase-sparkles" aria-hidden="true">
                  <svg
                    class="shop-sparkle-star shop-sparkle-star--1"
                    viewBox="0 0 32 32"
                  >
                    <path
                      d="M16 0 L20 12 L32 16 L20 20 L16 32 L12 20 L0 16 L12 12 Z"
                      fill="#FFFFFF"
                    />
                  </svg>
                  <svg
                    class="shop-sparkle-star shop-sparkle-star--2"
                    viewBox="0 0 32 32"
                  >
                    <path
                      d="M16 2 L19 13 L30 16 L19 19 L16 30 L13 19 L2 16 L13 13 Z"
                      fill="#FEF08A"
                    />
                  </svg>
                  <svg
                    class="shop-sparkle-star shop-sparkle-star--3"
                    viewBox="0 0 32 32"
                  >
                    <path
                      d="M16 2 L19 13 L30 16 L19 19 L16 30 L13 19 L2 16 L13 13 Z"
                      fill="#FEF08A"
                    />
                  </svg>
                  <svg
                    class="shop-sparkle-star shop-sparkle-star--4"
                    viewBox="0 0 32 32"
                  >
                    <path
                      d="M16 0 L20 12 L32 16 L20 20 L16 32 L12 20 L0 16 L12 12 Z"
                      fill="#FFFFFF"
                    />
                  </svg>
                  <span class="shop-magic-dot shop-magic-dot--1"></span>
                  <span class="shop-magic-dot shop-magic-dot--2"></span>
                  <span class="shop-magic-dot shop-magic-dot--3"></span>
                  <span class="shop-magic-dot shop-magic-dot--4"></span>
                  <span class="shop-magic-dot shop-magic-dot--5"></span>
                  <span class="shop-magic-dot shop-magic-dot--6"></span>
                </div>

                <!-- Item Flutuante Completo em Destaque com Glow -->
                <div class="shop-pedestal-float-wrap">
                  <!-- Quando na aba MOEDAS, destaca o Pacote de Moedas selecionado -->
                  <div
                    v-if="shopActiveTab === 'MOEDAS'"
                    class="shop-pedestal-featured-item shop-pedestal-featured-item--coins"
                  >
                    <svg
                      viewBox="0 0 120 110"
                      class="shop-pedestal-coin-treasure-svg"
                      aria-hidden="true"
                    >
                      <g stroke="#14111F" stroke-width="3.2" stroke-linejoin="round">
                        <!-- Baú e Moedas Douradas Flutuantes com Glow -->
                        <rect x="24" y="48" width="72" height="38" rx="6" fill="#8C4A23" />
                        <path d="M 22,48 C 22,26 98,26 98,48 Z" fill="#A85B2E" />
                        <rect x="34" y="30" width="10" height="56" fill="#FBBF24" />
                        <rect x="76" y="30" width="10" height="56" fill="#FBBF24" />
                        <rect x="23" y="45" width="74" height="7" fill="#F59E0B" />
                        <circle cx="60" cy="44" r="18" fill="#F59E0B" />
                        <circle cx="60" cy="44" r="13" fill="#FDE047" stroke="#B45309" stroke-width="2.2" />
                        <path
                          d="M 51,49 L 53,39 L 56.5,43 L 60,37 L 63.5,43 L 67,39 L 69,49 Z"
                          fill="#F59E0B"
                          stroke="#92400E"
                          stroke-width="1.5"
                        />
                      </g>
                    </svg>
                    <span class="shop-pedestal-coin-pack-badge">
                      +{{ selectedCoinPackage.coinsLabel }} MOEDAS
                    </span>
                  </div>

                  <!-- Quando nas abas de Skins (TODOS, MAGOS, BLOCOS), exibe o Sprite Real Completo -->
                  <div v-else class="shop-pedestal-featured-item">
                    <img
                      :src="getShopItemSpriteUrl(selectedShopItem)"
                      :alt="selectedShopItem.titleLine1"
                      class="shop-pedestal-hero-img"
                      :class="{
                        'shop-pedestal-hero-img--player': Boolean(selectedShopItem.playerSkinId),
                        'shop-pedestal-hero-img--block': Boolean(selectedShopItem.blockSkinId),
                        'shop-pedestal-hero-img--shadow':
                          selectedShopItem.playerSkinId === 'player_shadow',
                        'shop-pedestal-hero-img--gold':
                          selectedShopItem.blockSkinId === 'gold',
                      }"
                      draggable="false"
                    />
                    <template v-if="selectedShopItem.playerSkinId === 'player_shadow'">
                      <span class="shop-potion-particle shop-potion-particle--1"></span>
                      <span class="shop-potion-particle shop-potion-particle--2"></span>
                      <span class="shop-potion-particle shop-potion-particle--3"></span>
                    </template>
                  </div>
                </div>
              </div>

              <!-- CAMADA 3 (MEIO - VENDEDORES ATRÁS DO BALCÃO): shop_dino.png e shop_shadow.png -->
              <div class="shop-keepers-layer" aria-hidden="true">
                <!-- Vendedor Esquerdo: Dino Explorador Acenando -->
                <div class="shop-keeper-actor shop-keeper-actor--dino">
                  <img
                    :src="menuSprites.shop_dino"
                    alt="Vendedor Dino"
                    class="shop-keeper-sprite"
                    draggable="false"
                  />
                </div>

                <!-- Vendedor Direito: Mago Sombrio Apontando + Partículas da Poção -->
                <div class="shop-keeper-actor shop-keeper-actor--shadow">
                  <img
                    :src="menuSprites.shop_shadow"
                    alt="Vendedor Mago Sombrio"
                    class="shop-keeper-sprite"
                    draggable="false"
                  />
                  <span class="shop-keeper-potion-bubble shop-keeper-potion-bubble--1"></span>
                  <span class="shop-keeper-potion-bubble shop-keeper-potion-bubble--2"></span>
                  <span class="shop-keeper-potion-bubble shop-keeper-potion-bubble--3"></span>
                </div>
              </div>

              <!-- CAMADA 4 (FRENTE): Mesa/Balcão com Baú de Tesouro e Colunas LEGO (table.png) -->
              <img
                :src="menuSprites.table"
                alt=""
                class="shop-scene-table-fg"
                draggable="false"
              />

              <!-- Brilhos dourados nas moedas e no baú sobre a mesa -->
              <div class="shop-table-treasure-glints" aria-hidden="true">
                <span class="shop-treasure-glint shop-treasure-glint--chest"></span>
                <span class="shop-treasure-glint shop-treasure-glint--coins-left"></span>
                <span class="shop-treasure-glint shop-treasure-glint--coins-right"></span>
              </div>

              <!-- Explosão de partículas ao comprar um item -->
              <div
                v-if="shopPurchaseBurstActive"
                class="shop-purchase-burst-fx"
                aria-hidden="true"
              >
                <span
                  v-for="b in 12"
                  :key="`burst-p-${b}`"
                  class="shop-burst-particle"
                  :class="`shop-burst-particle--${b}`"
                ></span>
              </div>

              <!-- CAMADA 5 (ACIONAMENTO NO BALCÃO): Plaquinha de Preço + Botão Verde LEGO "COMPRAR" -->
              <div class="shop-counter-cta-dock">
                <!-- Plaquinha Marrom de Preço na aba MOEDAS -->
                <div
                  v-if="shopActiveTab === 'MOEDAS'"
                  class="shop-counter-price-badge"
                >
                  <span class="shop-counter-price-value">
                    {{ selectedCoinPackage.priceLabel }}
                  </span>
                </div>

                <!-- Plaquinha Marrom de Preço nas abas de Skins (somente quando ainda não obtido) -->
                <div
                  v-else-if="!isShopItemOwned(selectedShopItem)"
                  class="shop-counter-price-badge"
                >
                  <svg
                    class="shop-counter-price-coin"
                    viewBox="0 0 36 36"
                    aria-hidden="true"
                  >
                    <circle
                      cx="18"
                      cy="18"
                      r="15"
                      fill="#F59E0B"
                      stroke="#14111F"
                      stroke-width="3.2"
                    />
                    <circle
                      cx="18"
                      cy="18"
                      r="10.5"
                      fill="#FBBF24"
                      stroke="#B45309"
                      stroke-width="2"
                    />
                    <path
                      d="M 11,22 L 12.5,14 L 15.8,17.2 L 18,12.5 L 20.2,17.2 L 23.5,14 L 25,22 Z"
                      fill="#FDE047"
                      stroke="#92400E"
                      stroke-width="1.4"
                      stroke-linejoin="round"
                    />
                  </svg>
                  <span class="shop-counter-price-value">
                    {{ formatShopCoins(selectedShopItem.price) }}
                  </span>
                </div>

                <!-- Grande Botão LEGO "COMPRAR" (ou "OBTIDO" / desativado quando Mercado Pago sem env) -->
                <button
                  type="button"
                  class="shop-buy-lego-btn"
                  :class="{
                    'shop-buy-lego-btn--owned':
                      shopActiveTab === 'MOEDAS'
                        ? !isMercadoPagoConfigured || isCreatingCoinOrder
                        : isShopItemOwned(selectedShopItem),
                  }"
                  :disabled="
                    shopActiveTab === 'MOEDAS'
                      ? !isMercadoPagoConfigured || isCreatingCoinOrder
                      : isShopItemOwned(selectedShopItem)
                  "
                  :title="
                    shopActiveTab === 'MOEDAS' && !isMercadoPagoConfigured
                      ? 'Recarga via Mercado Pago desativada até configurar as variáveis de ambiente (.env)'
                      : undefined
                  "
                  @click="handleShopPrimaryAction"
                >
                  <span class="shop-buy-lego-studs" aria-hidden="true">
                    <span></span>
                    <span></span>
                    <span></span>
                    <span></span>
                  </span>
                  <span class="shop-buy-lego-body">
                    <span class="shop-buy-lego-label">
                      {{
                        shopActiveTab === 'MOEDAS'
                          ? isMercadoPagoConfigured
                            ? 'RECARREGAR'
                            : 'DESATIVADO'
                          : isShopItemOwned(selectedShopItem)
                            ? 'OBTIDO'
                            : 'COMPRAR'
                      }}
                    </span>
                  </span>
                </button>
              </div>
            </div>
          </section>
        </div>
      </div>
    </transition>

    <!-- =================================================================== -->
    <!-- TELA DE SKINS ("SKINS E BLOCOS"): SUA SKIN + SKIN DOS SEUS BLOCOS   -->
    <!-- =================================================================== -->
    <transition name="menu-fade-300">
      <div
        v-if="screenFlow === 'SKINS_SCREEN' || isSkinPickerOpen"
        class="selecione-modo-screen skins-screen-overlay"
      >
        <!-- Botão superior esquerdo (X) para voltar -->
        <button
          type="button"
          class="mp-lobby-back-btn"
          :title="
            isSkinPickerOpen
              ? 'Voltar para a Sala Multiplayer (Esc)'
              : 'Voltar ao Menu Principal (Esc)'
          "
          @click="closeSkinsScreen"
        >
          <img
            :src="menuSprites.button_x"
            alt="Voltar"
            draggable="false"
          />
        </button>

        <!-- 1. Topo em Pedra: "SKINS E BLOCOS" -->
        <header class="selecione-modo-top-banner" aria-hidden="true">
          <div class="selecione-modo-stone-header">
            <div class="selecione-modo-stone-wing selecione-modo-stone-wing--left"></div>
            <div class="selecione-modo-stone-pillar"></div>
            <div class="selecione-modo-stone-center">
              <span class="selecione-modo-banner-title">SKINS E BLOCOS</span>
            </div>
            <div class="selecione-modo-stone-pillar"></div>
            <div class="selecione-modo-stone-wing selecione-modo-stone-wing--right"></div>
            <div class="selecione-modo-stone-ledge">
              <span></span><span></span><span></span>
            </div>
          </div>
        </header>

        <!-- 2. Dois Seletores Quadrados Lado a Lado: SUA SKIN & SKIN DOS BLOCOS -->
        <div class="selecione-modo-stage">
          <!-- COLUNA ESQUERDA: SUA SKIN (PERSONAGEM) -->
          <div
            class="selecione-modo-col"
            @mouseenter="selectedSkinsColumn = 'PLAYER'"
            @click="selectedSkinsColumn = 'PLAYER'"
          >
            <!-- Seta Superior ▲ -->
            <button
              type="button"
              class="selecione-modo-arrow-btn"
              title="Personagem anterior"
              aria-label="Personagem anterior"
              @click.stop="cyclePlayerSkinOption(-1)"
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

            <!-- Cartão Quadrado de Parede LEGO: SUA SKIN -->
            <div
              class="selecione-modo-brick-box"
              :class="{
                'selecione-modo-brick-box--active':
                  selectedSkinsColumn === 'PLAYER',
              }"
              @click="selectedSkinsColumn = 'PLAYER'"
            >
              <!-- 8 Pinos Superiores Escuros -->
              <div class="selecione-modo-box-studs" aria-hidden="true">
                <span v-for="s in 8" :key="s"></span>
              </div>

              <!-- 4 Cantoneiras Amarelas/Laranjas quando focado -->
              <template v-if="selectedSkinsColumn === 'PLAYER'">
                <span class="selecione-corner selecione-corner--tl" aria-hidden="true"></span>
                <span class="selecione-corner selecione-corner--tr" aria-hidden="true"></span>
                <span class="selecione-corner selecione-corner--bl" aria-hidden="true"></span>
                <span class="selecione-corner selecione-corner--br" aria-hidden="true"></span>
              </template>

              <div class="selecione-modo-card-inner skins-card-inner">
                <div class="selecione-single-mode-art skins-player-art">
                  <div class="selecione-char-cloud-wrap selecione-char-cloud-wrap--center">
                    <img
                      v-if="activePlayerSkin"
                      :src="activePlayerSkin.url"
                      :alt="activePlayerSkin.name"
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
                  <span class="selecione-card-main-title">
                    {{ activePlayerSkin?.shortName || 'MAGO' }}
                  </span>
                </div>
              </div>
            </div>

            <!-- Seta Inferior ▼ -->
            <button
              type="button"
              class="selecione-modo-arrow-btn"
              title="Próximo personagem"
              aria-label="Próximo personagem"
              @click.stop="cyclePlayerSkinOption(1)"
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
                  d="M 12,11 H 72 L 46,39 Q 42,43 38,39 Z"
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

          <!-- COLUNA DIREITA: SKIN DOS BLOCOS -->
          <div
            class="selecione-modo-col"
            @mouseenter="selectedSkinsColumn = 'BLOCK'"
            @click="selectedSkinsColumn = 'BLOCK'"
          >
            <!-- Seta Superior ▲ -->
            <button
              type="button"
              class="selecione-modo-arrow-btn"
              title="Skin de bloco anterior"
              aria-label="Skin de bloco anterior"
              @click.stop="cycleBlockSkinOption(-1)"
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

            <!-- Cartão Quadrado de Parede LEGO: SKIN DOS BLOCOS -->
            <div
              class="selecione-modo-brick-box"
              :class="{
                'selecione-modo-brick-box--active':
                  selectedSkinsColumn === 'BLOCK',
                'selecione-modo-brick-box--wood':
                  activeBlockSkinId === 'wood',
                'selecione-modo-brick-box--gold':
                  activeBlockSkinId === 'gold',
              }"
              @click="selectedSkinsColumn = 'BLOCK'"
            >
              <!-- 8 Pinos Superiores Escuros -->
              <div class="selecione-modo-box-studs" aria-hidden="true">
                <span v-for="s in 8" :key="s"></span>
              </div>

              <!-- 4 Cantoneiras Amarelas/Laranjas quando focado -->
              <template v-if="selectedSkinsColumn === 'BLOCK'">
                <span class="selecione-corner selecione-corner--tl" aria-hidden="true"></span>
                <span class="selecione-corner selecione-corner--tr" aria-hidden="true"></span>
                <span class="selecione-corner selecione-corner--bl" aria-hidden="true"></span>
                <span class="selecione-corner selecione-corner--br" aria-hidden="true"></span>
              </template>

              <div class="selecione-modo-card-inner skins-card-inner">
                <!-- Vitrine Dinâmica de Peças com as Cores da Skin Selecionada -->
                <div class="skins-blocks-showcase-grid">
                  <div class="skins-block-preview-cell">
                    <PiecePreviewCanvas
                      type="T"
                      variant="NORMAL"
                      :color-palette-index="0"
                      :size="108"
                    />
                  </div>
                  <div class="skins-block-preview-cell">
                    <PiecePreviewCanvas
                      type="L"
                      variant="NORMAL"
                      :color-palette-index="2"
                      :size="108"
                    />
                  </div>
                  <div class="skins-block-preview-cell">
                    <PiecePreviewCanvas
                      type="O"
                      variant="NORMAL"
                      :color-palette-index="1"
                      :size="108"
                    />
                  </div>
                  <div class="skins-block-preview-cell">
                    <PiecePreviewCanvas
                      type="Z"
                      variant="NORMAL"
                      :color-palette-index="3"
                      :size="108"
                    />
                  </div>
                </div>

                <div class="selecione-card-bottom-captions">
                  <span class="selecione-card-main-title">
                    {{ activeBlockSkin?.shortName || 'PLÁSTICO' }}
                  </span>
                </div>
              </div>
            </div>

            <!-- Seta Inferior ▼ -->
            <button
              type="button"
              class="selecione-modo-arrow-btn"
              title="Próxima skin de bloco"
              aria-label="Próxima skin de bloco"
              @click.stop="cycleBlockSkinOption(1)"
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
                  d="M 12,11 H 72 L 46,39 Q 42,43 38,39 Z"
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

        <!-- 3. Botões LEGO no Canto Inferior Direito: PRONTO e VOLTAR -->
        <div class="selecione-modo-bottom-right-actions">
          <button
            type="button"
            class="selecione-action-brick-btn selecione-action-brick-btn--ready"
            @click="closeSkinsScreen"
          >
            <span class="selecione-action-studs" aria-hidden="true">
              <span></span><span></span><span></span>
            </span>
            <span class="selecione-action-body">PRONTO</span>
          </button>

          <button
            type="button"
            class="selecione-action-brick-btn selecione-action-brick-btn--back"
            @click="closeSkinsScreen"
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
          <!-- Abas de Navegação estilo Peça LEGO (Minimalistas sem ícones) -->
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
              <span class="options-tab-body">ÁUDIO &amp; GERAL</span>
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
              <span class="options-tab-body">CONTROLES</span>
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
              <span class="options-tab-body">GRÁFICOS &amp; HUD</span>
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
              <span class="options-tab-body">CONTA &amp; SOCIAL</span>
            </button>
          </div>

          <!-- Quadro Principal de Opções -->
          <div class="options-brick-board">
            <!-- =========================================================== -->
            <!-- ABA 1: ÁUDIO & GERAL                                        -->
            <!-- =========================================================== -->
            <div v-if="optionsActiveTab === 'AUDIO'" class="options-tab-panel">
              <!-- Card de Volume -->
              <div class="options-section-card">
                <div class="options-section-header">
                  <h3 class="options-section-title">Volume</h3>
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
                      {{ optionsStore.state.isMuted ? 'MUDO' : 'SOM ATIVO' }}
                    </button>
                    <button
                      type="button"
                      class="options-pill-btn options-pill-btn--gold"
                      @click="playToySfx('victory')"
                    >
                      Testar Som
                    </button>
                  </div>
                </div>

                <!-- Volume Geral -->
                <div class="options-slider-row">
                  <div class="options-slider-label">
                    <span>Volume Geral</span>
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

                <!-- Volume de Efeitos Sonoros -->
                <div class="options-slider-row">
                  <div class="options-slider-label">
                    <span>Efeitos Sonoros</span>
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

                <!-- Volume da Música -->
                <div class="options-slider-row">
                  <div class="options-slider-label">
                    <span>Música</span>
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

              <!-- Modo de Tela Minimalista (Janela / FullScreen) -->
              <div class="options-toggles-grid">
                <div class="options-toggle-item">
                  <div class="options-toggle-info">
                    <strong>Modo de Tela</strong>
                  </div>
                  <div class="options-segmented-group">
                    <button
                      type="button"
                      class="options-switch-btn"
                      :class="{ 'options-switch-btn--on': !isFullscreen }"
                      @click="setFullscreenMode(false)"
                    >
                      Janela
                    </button>
                    <button
                      type="button"
                      class="options-switch-btn"
                      :class="{ 'options-switch-btn--on': isFullscreen }"
                      @click="setFullscreenMode(true)"
                    >
                      FullScreen
                    </button>
                  </div>
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
                              ? 'D-Pad Esq'
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
                              ? 'D-Pad Dir'
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
                              ? 'D-Pad Baixo'
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
            <!-- ABA 3: GRÁFICOS & HUD (MINIMALISTA)                         -->
            <!-- =========================================================== -->
            <div
              v-else-if="optionsActiveTab === 'GRAPHICS'"
              class="options-tab-panel"
            >
              <div class="options-toggles-grid">
                <div class="options-toggle-item">
                  <div class="options-toggle-info">
                    <strong>Screen Shake</strong>
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
                    <strong>Contador de FPS</strong>
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
                      optionsStore.state.showFpsPing ? 'LIGADO' : 'DESLIGADO'
                    }}
                  </button>
                </div>

                <div class="options-toggle-item">
                  <div class="options-toggle-info">
                    <strong>Mostrar Apelido</strong>
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
                        ? 'LIGADO'
                        : 'DESLIGADO'
                    }}
                  </button>
                </div>
              </div>
            </div>

            <!-- =========================================================== -->
            <!-- ABA 4: CONTA & SOCIAL (MINIMALISTA, SEM SKINS)              -->
            <!-- =========================================================== -->
            <div v-else class="options-tab-panel">
              <!-- Perfil e Apelido -->
              <div class="options-section-card">
                <div class="options-section-header">
                  <h3 class="options-section-title">Conta</h3>
                  <button
                    v-if="authStore.state.user"
                    type="button"
                    class="options-pill-btn options-pill-btn--gold"
                    @click="copyMyHandle"
                  >
                    Copiar {{ authStore.state.user.handle }}
                  </button>
                </div>

                <div class="options-account-row">
                  <div
                    v-if="authStore.state.user"
                    class="options-nick-editor"
                  >
                    <label class="options-field-label" for="options-nick-input">
                      Apelido
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
                        {{ isSavingCustomNick ? 'SALVANDO...' : 'SALVAR' }}
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
                        Sair
                      </button>
                    </template>
                    <template v-else>
                      <div class="options-account-meta">
                        <strong>Convidado</strong>
                      </div>
                      <button
                        type="button"
                        class="options-pill-btn options-pill-btn--gold"
                        @click="
                          closeOptionsScreen();
                          isAuthModalOpen = true;
                        "
                      >
                        Conectar Google
                      </button>
                    </template>
                  </div>
                </div>
              </div>

              <!-- Privacidade de Convites -->
              <div class="options-toggles-grid">
                <div class="options-toggle-item">
                  <div class="options-toggle-info">
                    <strong>Alertas de Convite</strong>
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
                        ? 'LIGADO'
                        : 'DESLIGADO'
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
              @click.stop="
                !showCupSelectionColumn
                  ? startGame()
                  : (selectedModeScreenColumn = 'MODE')
              "
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
        v-if="
          screenFlow === 'MULTIPLAYER_LOBBY' &&
          !isGameModeModalOpen &&
          !isSkinPickerOpen
        "
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
                      ? 'Clique no seu personagem para alterar seu mago e seus blocos'
                      : slot.customNick
                  "
                  draggable="false"
                  @click="slot.isLocalHost && openSkinsScreen(true)"
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
            class="survival-remaining-pieces-tag"
          >
            <span
              :key="Math.max(0, snapshot.survivalGoalPieces - snapshot.piecesPlaced)"
              class="survival-remaining-num"
            >
              {{ Math.max(0, snapshot.survivalGoalPieces - snapshot.piecesPlaced) }}
            </span>
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

      <!-- MINIMAL FLOATING TOP-RIGHT HUD (APENAS MODO DESENVOLVEDOR) -->
      <div
        class="floating-hud-right"
        :class="{
          'floating-hud-right--endless': snapshot.gameMode === 'ENDLESS',
        }"
      >
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

      <!-- PAUSE OVERLAY (ATIVADO COM ESC OU P) -->
      <transition name="menu-fade-300">
        <div
          v-if="
            isGamePaused &&
            !isOptionsModalOpen &&
            !isGameModeModalOpen &&
            !isDevModeOpen
          "
          class="pause-game-overlay"
          @click.self="togglePauseGame(false)"
        >
          <div class="pause-game-card">
            <div class="selecione-modo-box-studs" aria-hidden="true">
              <span v-for="s in 6" :key="s"></span>
            </div>

            <div class="pause-game-header">
              <span class="pause-game-title">JOGO PAUSADO</span>
            </div>

            <div class="pause-game-actions">
              <button
                type="button"
                class="selecione-action-brick-btn selecione-action-brick-btn--ready pause-brick-btn"
                @click="togglePauseGame(false)"
              >
                <span class="selecione-action-studs" aria-hidden="true">
                  <span></span><span></span><span></span><span></span>
                </span>
                <span class="selecione-action-body">CONTINUAR</span>
              </button>

              <button
                v-if="!isOnlineMultiplayerMatch"
                type="button"
                class="selecione-action-brick-btn pause-brick-btn pause-brick-btn--blue"
                @click="restartMatch(true)"
              >
                <span class="selecione-action-studs" aria-hidden="true">
                  <span></span><span></span><span></span><span></span>
                </span>
                <span class="selecione-action-body">REINICIAR</span>
              </button>

              <button
                type="button"
                class="selecione-action-brick-btn pause-brick-btn pause-brick-btn--slate"
                @click="openOptionsScreen(true)"
              >
                <span class="selecione-action-studs" aria-hidden="true">
                  <span></span><span></span><span></span><span></span>
                </span>
                <span class="selecione-action-body">OPÇÕES</span>
              </button>

              <button
                type="button"
                class="selecione-action-brick-btn selecione-action-brick-btn--back pause-brick-btn"
                @click="returnToMainMenu"
              >
                <span class="selecione-action-studs" aria-hidden="true">
                  <span></span><span></span><span></span><span></span>
                </span>
                <span class="selecione-action-body">MENU PRINCIPAL</span>
              </button>
            </div>
          </div>
        </div>
      </transition>

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
          !isEndTowerShowcaseActive &&
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
          !isEndTowerShowcaseActive &&
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
          !isEndTowerShowcaseActive &&
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
          !isEndTowerShowcaseActive &&
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
