import { reactive, watch } from 'vue'

export type ControlPresetId =
  | 'TRICKY'
  | 'HYBRID'
  | 'ARROWS_ZXC'
  | 'WASD_QE'
  | 'CUSTOM'

export type KeybindActionId =
  | 'moveLeft'
  | 'moveRight'
  | 'softDrop'
  | 'rotateCW'
  | 'rotateCCW'
  | 'nudgeLeft'
  | 'nudgeRight'
  | 'selfPower'
  | 'attackPower'
  | 'restartMatch'

export interface KeybindActionMeta {
  id: KeybindActionId
  label: string
  description: string
  icon: string
}

export const KEYBIND_ACTIONS_META: KeybindActionMeta[] = [
  {
    id: 'moveLeft',
    label: 'Movimentar p/ Esquerda',
    description: 'Setas para a Esquerda (desloca o bloco 0.5u para a esquerda)',
    icon: '⬅️',
  },
  {
    id: 'moveRight',
    label: 'Movimentar p/ Direita',
    description: 'Setas para a Direita (desloca o bloco 0.5u para a direita)',
    icon: '➡️',
  },
  {
    id: 'softDrop',
    label: 'Acelerar a Queda (Drop)',
    description: 'Seta para Baixo (acelera a descida em 3x enquanto segurado)',
    icon: '⬇️',
  },
  {
    id: 'rotateCW',
    label: 'Rotacionar p/ Direita (90°)',
    description: 'Seta para Cima (gira o bloco 90° no sentido horário)',
    icon: '↻',
  },
  {
    id: 'rotateCCW',
    label: 'Rotacionar p/ Esquerda (90°)',
    description: 'Barra de Espaço (gira o bloco 90° no sentido anti-horário)',
    icon: '↺',
  },
  {
    id: 'nudgeLeft',
    label: 'Empurrar o Bloco p/ Esquerda (Socão)',
    description: 'Tecla U ou Shift + Esquerda (empurrão lateral para a esquerda)',
    icon: '🥊',
  },
  {
    id: 'nudgeRight',
    label: 'Empurrar o Bloco p/ Direita (Socão)',
    description: 'Tecla I ou Shift + Direita (empurrão lateral para a direita)',
    icon: '🥊',
  },
  {
    id: 'selfPower',
    label: 'Magia de Luz (Ajuda / Defesa)',
    description: 'Tecla J (ativa o poder de Ordem/Luz guardado no slot)',
    icon: '✨',
  },
  {
    id: 'attackPower',
    label: 'Magia das Trevas (Ataque)',
    description: 'Tecla K (dispara o poder de Caos/Trevas contra os adversários)',
    icon: '🔥',
  },
  {
    id: 'restartMatch',
    label: 'Reiniciar Partida (Solo)',
    description: 'Gera uma nova partida rápida no modo local',
    icon: '🎲',
  },
]

export type KeybindMap = Record<KeybindActionId, string[]>

export const PRESET_KEYBINDS: Record<
  Exclude<ControlPresetId, 'CUSTOM'>,
  KeybindMap
> = {
  TRICKY: {
    moveLeft: ['ArrowLeft'],
    moveRight: ['ArrowRight'],
    softDrop: ['ArrowDown'],
    rotateCW: ['ArrowUp'],
    rotateCCW: ['Space'],
    nudgeLeft: ['KeyU'],
    nudgeRight: ['KeyI'],
    selfPower: ['KeyJ'],
    attackPower: ['KeyK'],
    restartMatch: ['KeyR'],
  },
  HYBRID: {
    moveLeft: ['ArrowLeft', 'KeyA'],
    moveRight: ['ArrowRight', 'KeyD'],
    softDrop: ['ArrowDown', 'KeyS'],
    rotateCW: ['ArrowUp', 'KeyW', 'KeyE', 'KeyX'],
    rotateCCW: ['KeyZ', 'KeyQ'],
    nudgeLeft: ['KeyU'],
    nudgeRight: ['KeyI'],
    selfPower: ['Space', 'KeyJ'],
    attackPower: ['KeyC', 'KeyB', 'KeyK'],
    restartMatch: ['KeyR'],
  },
  ARROWS_ZXC: {
    moveLeft: ['ArrowLeft'],
    moveRight: ['ArrowRight'],
    softDrop: ['ArrowDown'],
    rotateCW: ['ArrowUp', 'KeyX'],
    rotateCCW: ['KeyZ'],
    nudgeLeft: ['KeyU'],
    nudgeRight: ['KeyI'],
    selfPower: ['Space'],
    attackPower: ['KeyC'],
    restartMatch: ['KeyR'],
  },
  WASD_QE: {
    moveLeft: ['KeyA'],
    moveRight: ['KeyD'],
    softDrop: ['KeyS'],
    rotateCW: ['KeyW', 'KeyE'],
    rotateCCW: ['KeyQ'],
    nudgeLeft: ['KeyU'],
    nudgeRight: ['KeyI'],
    selfPower: ['Space'],
    attackPower: ['KeyC', 'KeyF'],
    restartMatch: ['KeyR'],
  },
}

export interface GameOptionsState {
  // Áudio
  masterVolume: number
  bgmVolume: number
  sfxVolume: number
  isMuted: boolean

  // Jogabilidade & Controles
  controlPreset: ControlPresetId
  keybinds: KeybindMap
  showGhostPiece: boolean

  // Gráficos & HUD
  dynamicTintEnabled: boolean
  windEnabled: boolean
  screenShakeEnabled: boolean
  showFpsPing: boolean
  showOpponentHandles: boolean

  // Social & Privacidade
  allowInvitesInGame: boolean
}

const STORAGE_KEY = 'toy_tower_options_v1'

function cloneKeybinds(map: KeybindMap): KeybindMap {
  return {
    moveLeft: [...map.moveLeft],
    moveRight: [...map.moveRight],
    softDrop: [...map.softDrop],
    rotateCW: [...map.rotateCW],
    rotateCCW: [...map.rotateCCW],
    nudgeLeft: [...map.nudgeLeft],
    nudgeRight: [...map.nudgeRight],
    selfPower: [...map.selfPower],
    attackPower: [...map.attackPower],
    restartMatch: [...map.restartMatch],
  }
}

function getDefaultOptions(): GameOptionsState {
  return {
    masterVolume: 80,
    bgmVolume: 60,
    sfxVolume: 85,
    isMuted: false,
    controlPreset: 'TRICKY',
    keybinds: cloneKeybinds(PRESET_KEYBINDS.TRICKY),
    showGhostPiece: false,
    dynamicTintEnabled: true,
    windEnabled: true,
    screenShakeEnabled: true,
    showFpsPing: false,
    showOpponentHandles: true,
    allowInvitesInGame: true,
  }
}

function loadSavedOptions(): GameOptionsState {
  const defaults = getDefaultOptions()
  if (typeof window === 'undefined' || !window.localStorage) {
    return defaults
  }
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return defaults
    const parsed = JSON.parse(raw) as Partial<GameOptionsState>
    const mergedKeybinds = cloneKeybinds(defaults.keybinds)
    if (parsed.keybinds && typeof parsed.keybinds === 'object') {
      for (const action of Object.keys(mergedKeybinds) as KeybindActionId[]) {
        const arr = parsed.keybinds[action]
        if (Array.isArray(arr) && arr.length > 0) {
          mergedKeybinds[action] = arr.filter((k) => typeof k === 'string')
        }
      }
    }
    return {
      masterVolume:
        typeof parsed.masterVolume === 'number'
          ? Math.max(0, Math.min(100, parsed.masterVolume))
          : defaults.masterVolume,
      bgmVolume:
        typeof parsed.bgmVolume === 'number'
          ? Math.max(0, Math.min(100, parsed.bgmVolume))
          : defaults.bgmVolume,
      sfxVolume:
        typeof parsed.sfxVolume === 'number'
          ? Math.max(0, Math.min(100, parsed.sfxVolume))
          : defaults.sfxVolume,
      isMuted:
        typeof parsed.isMuted === 'boolean' ? parsed.isMuted : defaults.isMuted,
      controlPreset:
        parsed.controlPreset === 'TRICKY' ||
        parsed.controlPreset === 'HYBRID' ||
        parsed.controlPreset === 'ARROWS_ZXC' ||
        parsed.controlPreset === 'WASD_QE' ||
        parsed.controlPreset === 'CUSTOM'
          ? parsed.controlPreset
          : defaults.controlPreset,
      keybinds: mergedKeybinds,
      showGhostPiece: defaults.showGhostPiece,
      dynamicTintEnabled: defaults.dynamicTintEnabled,
      windEnabled: defaults.windEnabled,
      screenShakeEnabled:
        typeof parsed.screenShakeEnabled === 'boolean'
          ? parsed.screenShakeEnabled
          : defaults.screenShakeEnabled,
      showFpsPing:
        typeof parsed.showFpsPing === 'boolean'
          ? parsed.showFpsPing
          : defaults.showFpsPing,
      showOpponentHandles:
        typeof parsed.showOpponentHandles === 'boolean'
          ? parsed.showOpponentHandles
          : defaults.showOpponentHandles,
      allowInvitesInGame:
        typeof parsed.allowInvitesInGame === 'boolean'
          ? parsed.allowInvitesInGame
          : defaults.allowInvitesInGame,
    }
  } catch {
    return defaults
  }
}

const state = reactive<GameOptionsState>(loadSavedOptions())

watch(
  state,
  (val) => {
    if (typeof window === 'undefined' || !window.localStorage) return
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(val))
    } catch {
      // Ignore storage quota errors
    }
  },
  { deep: true }
)

/**
 * Formats a DOM KeyboardEvent.code into a friendly Portuguese label for LEGO keycaps.
 */
export function formatKeyCodeLabel(code: string): string {
  if (!code) return '—'
  const map: Record<string, string> = {
    ArrowLeft: 'Seta Esq',
    ArrowRight: 'Seta Dir',
    ArrowUp: 'Seta Cima',
    ArrowDown: 'Seta Baixo',
    Space: 'Espaço',
    Enter: 'Enter',
    ShiftLeft: 'Shift Esq',
    ShiftRight: 'Shift Dir',
    ControlLeft: 'Ctrl Esq',
    ControlRight: 'Ctrl Dir',
    AltLeft: 'Alt Esq',
    AltRight: 'Alt Dir',
    Tab: 'Tab',
    Backspace: 'Backspace',
  }
  if (map[code]) return map[code]
  if (code.startsWith('Key')) return code.slice(3).toUpperCase()
  if (code.startsWith('Digit')) return code.slice(5)
  if (code.startsWith('Numpad')) return `Num ${code.slice(6)}`
  return code.toUpperCase()
}

// ============================================================================
// SYNTHETIC WEB AUDIO API SOUND EFFECTS (TOY-BRICK FEEDBACK)
// ============================================================================
let audioCtx: AudioContext | null = null

function getAudioContext(): AudioContext | null {
  if (typeof window === 'undefined') return null
  if (!audioCtx) {
    const Ctx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext })
        .webkitAudioContext
    if (Ctx) {
      audioCtx = new Ctx()
    }
  }
  if (audioCtx && audioCtx.state === 'suspended') {
    void audioCtx.resume().catch(() => {})
  }
  return audioCtx
}

export type ToySfxType =
  | 'click'
  | 'move'
  | 'rotate'
  | 'settle'
  | 'power'
  | 'victory'

export function playToySfx(type: ToySfxType = 'click'): void {
  if (state.isMuted) return
  const effectiveGain = (state.masterVolume / 100) * (state.sfxVolume / 100)
  if (effectiveGain <= 0.01) return

  const ctx = getAudioContext()
  if (!ctx) return

  const now = ctx.currentTime
  const osc = ctx.createOscillator()
  const gain = ctx.createGain()
  osc.connect(gain)
  gain.connect(ctx.destination)

  const vol = Math.min(0.35, effectiveGain * 0.28)

  if (type === 'click') {
    osc.type = 'triangle'
    osc.frequency.setValueAtTime(520, now)
    osc.frequency.exponentialRampToValueAtTime(780, now + 0.055)
    gain.gain.setValueAtTime(vol, now)
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.065)
    osc.start(now)
    osc.stop(now + 0.07)
  } else if (type === 'move') {
    osc.type = 'sine'
    osc.frequency.setValueAtTime(340, now)
    osc.frequency.exponentialRampToValueAtTime(420, now + 0.035)
    gain.gain.setValueAtTime(vol * 0.65, now)
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.04)
    osc.start(now)
    osc.stop(now + 0.045)
  } else if (type === 'rotate') {
    osc.type = 'triangle'
    osc.frequency.setValueAtTime(440, now)
    osc.frequency.exponentialRampToValueAtTime(660, now + 0.07)
    gain.gain.setValueAtTime(vol * 0.85, now)
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.08)
    osc.start(now)
    osc.stop(now + 0.085)
  } else if (type === 'settle') {
    osc.type = 'square'
    osc.frequency.setValueAtTime(210, now)
    osc.frequency.exponentialRampToValueAtTime(140, now + 0.065)
    gain.gain.setValueAtTime(vol * 0.75, now)
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.075)
    osc.start(now)
    osc.stop(now + 0.08)
  } else if (type === 'power') {
    osc.type = 'sawtooth'
    osc.frequency.setValueAtTime(330, now)
    osc.frequency.exponentialRampToValueAtTime(880, now + 0.18)
    gain.gain.setValueAtTime(vol * 0.9, now)
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.2)
    osc.start(now)
    osc.stop(now + 0.21)
  } else if (type === 'victory') {
    osc.type = 'triangle'
    osc.frequency.setValueAtTime(523.25, now)
    osc.frequency.setValueAtTime(659.25, now + 0.08)
    osc.frequency.setValueAtTime(783.99, now + 0.16)
    osc.frequency.setValueAtTime(1046.5, now + 0.24)
    gain.gain.setValueAtTime(vol, now)
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.38)
    osc.start(now)
    osc.stop(now + 0.4)
  }
}

export const optionsStore = {
  state,

  applyPreset(preset: Exclude<ControlPresetId, 'CUSTOM'>) {
    state.controlPreset = preset
    state.keybinds = cloneKeybinds(PRESET_KEYBINDS[preset])
    playToySfx('click')
  },

  setKeybind(action: KeybindActionId, code: string) {
    if (!code || code === 'Escape' || code === 'F2') return
    state.keybinds[action] = [code]
    state.controlPreset = 'CUSTOM'
    playToySfx('rotate')
  },

  clearActionToSingleKey(action: KeybindActionId, code: string) {
    if (!code || code === 'Escape' || code === 'F2') return
    state.keybinds[action] = [code]
    state.controlPreset = 'CUSTOM'
    playToySfx('rotate')
  },

  matchesAction(action: KeybindActionId, code: string): boolean {
    return state.keybinds[action]?.includes(code) ?? false
  },

  resetToDefaults() {
    const defaults = getDefaultOptions()
    Object.assign(state, defaults)
    playToySfx('victory')
  },
}
