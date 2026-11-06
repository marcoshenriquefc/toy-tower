import { PowerId } from '../game/PowersCatalog'
import { BasePresetId } from '../game/BaseTerrainCatalog'

export type PieceType = 'I' | 'O' | 'T' | 'L' | 'J' | 'S' | 'Z'

export type PieceVariant = 'NORMAL' | 'GIANT' | 'HEAVY_RUBBER'

export type PiecePowerEffect =
  | 'NONE'
  | 'SUPER_GLUE'
  | 'STATIC_BRICK'
  | 'SLICK_BRICK'
  | 'LOCK_ROTATE'
  | 'TURBO_DROP'
  | 'CASTLE_ROOF'

export type GameMode = 'RACE' | 'SURVIVAL' | 'PUZZLE' | 'ENDLESS'

export type SelectableGameMode =
  | 'RACE'
  | 'PUZZLE'
  | 'SURVIVAL'
  | 'ENDLESS'
  | 'RANDOM'

export type VictoryCondition = 'SINGLE_WIN' | 'CUP_6' | 'CUP_12'

export type MatchState =
  | 'COUNTDOWN'
  | 'SPAWNING'
  | 'FALLING'
  | 'SETTLING'
  | 'RESPAWN_DELAY'
  | 'GOAL_COUNTDOWN'
  | 'ROOF_DROP'
  | 'LASER_OVERLOAD'
  | 'PETRIFIED_WAITING'
  | 'PUZZLE_COUNTING'
  | 'VICTORY'
  | 'GAME_OVER'

export const GAME_CONSTANTS = {
  /** 1 unit = 32x32 pixels */
  UNIT_PX: 32,
  /** Modular Green Base Plate width in units (8 columns: Col 0 to Col 7) */
  BASE_WIDTH_UNITS: 8,
  /** Green Base Plate base row height in units */
  BASE_HEIGHT_UNITS: 1,
  /** Floating Side Island (SIDE_ISLAND) width in units (2 blocks + 1 half-block) */
  ISLAND_WIDTH_UNITS: 2.5,
  /** Floating Side Island (SIDE_ISLAND) height in units */
  ISLAND_HEIGHT_UNITS: 1.5,
  /** Horizontal gap in units between main base edge and Side Island inner edge (center at ±6.25u) */
  ISLAND_GAP_X_UNITS: 1.0,
  /** Configurable vertical offset in units relative to the highest settled block */
  ISLAND_OFFSET_Y_UNITS: 1.0,
  /** Side Island top surface friction (μ = 0.8) */
  ISLAND_FRICTION: 0.8,
  /** Finish Line height in units above the top of the base plate */
  GOAL_HEIGHT_UNITS: 30,
  /** Fixed Laser Beam height in units in Puzzle Mode ("Abaixo do Laser" - 9m) */
  PUZZLE_LASER_HEIGHT_UNITS: 9,
  /** Base rise increment in units whenever a piece falls in the water in Puzzle Mode (+0.5 block) */
  PUZZLE_BASE_RISE_UNITS: 0.5,
  /** Laser Overload countdown duration in ms before burning touching blocks and petrifying the rest (3.0 seconds) */
  PUZZLE_LASER_OVERLOAD_MS: 3000,
  /** Step interval in ms per block during the final bottom-to-top counting phase in Puzzle Mode */
  PUZZLE_COUNT_STEP_MS: 210,
  /** Initial lives in Survival Mode (3 Hearts) */
  SURVIVAL_INITIAL_LIVES: 3,
  /** Target number of stabilized pieces to win Survival Mode */
  SURVIVAL_GOAL_PIECES: 50,
  /** Invulnerability duration in ms after losing a life in Survival Mode (3 seconds = 3000ms blinking stabilization window) */
  SURVIVAL_LIFE_LOSS_COOLDOWN_MS: 3000,
  /** Hold time in ms at Checkpoint line in Endless Mode (1.5 seconds = 1500ms) */
  ENDLESS_CHECKPOINT_HOLD_MS: 1500,
  /** Vertical step in units when an Endless checkpoint is validated (+12m) */
  ENDLESS_STEP_UNITS: 12,
  /** Preparation time in ms before the Rising Abyss begins climbing in Multiplayer Endless Mode (5 seconds) */
  ENDLESS_ABYSS_PREP_MS: 5000,
  /** Base rising speed of the Abyss line in Multiplayer Endless Mode (0.4 blocks/second) */
  ENDLESS_ABYSS_BASE_SPEED_UNITS_PER_SEC: 0.4,
  /** Time in ms when Multiplayer Endless enters Overload ("ABISMO ACELERANDO!") phase (90 seconds) */
  ENDLESS_OVERTIME_START_MS: 90000,
  /** Interval in ms for each +25% speed step during Overload phase (15 seconds) */
  ENDLESS_OVERTIME_STEP_MS: 15000,
  /** Maximum match time in ms for Multiplayer Endless Mode before locking abyss & measuring highest tower (150 seconds) */
  ENDLESS_MAX_MATCH_TIME_MS: 150000,
  /** Consecutive pieces lost into the abyss that cause Game Over (collapse of active base) */
  ENDLESS_MAX_CONSECUTIVE_FALLS: 5,
  /** Wind activation threshold in units above the base plate */
  WIND_START_HEIGHT_UNITS: 15,
  /** Checkpoint height interval in units (12m, 24m) */
  CHECKPOINT_INTERVAL_UNITS: 12,
  /** Time a settled piece must hold across a Checkpoint line to trigger & consume it (0.5 second) */
  CHECKPOINT_HOLD_MS: 500,
  /** Grace window upon touching the piece below to allow a final sideways step or Socão (0.2 second = 200ms) */
  BOTTOM_TOUCH_GRACE_MS: 200,
  /** Active piece always spawns 16.5 units above highest resting block (or base) so it drops from higher up */
  SPAWN_OFFSET_UNITS: 16.5,
  /** Hold time at Finish Line during GOAL_COUNTDOWN to win and spawn Castle Roof (3 seconds) */
  GOAL_HOLD_MS: 3000,
  /** Penalty delay when active controlled piece falls into abyss (1.0 second) */
  RESPAWN_PENALTY_MS: 1000,
  /** Initial 3, 2, 1, GO! countdown duration */
  START_COUNTDOWN_MS: 3000,
  /** State snapshot export interval (100ms) */
  SNAPSHOT_INTERVAL_MS: 100,
  /** Pin snap angle tolerance in degrees (±9°) */
  PIN_SNAP_ANGLE_DEG: 9,
  /** Pin snap grid alignment tolerance in units */
  PIN_SNAP_GRID_TOLERANCE_UNITS: 0.28,
  /** Normal piece friction (high-grip ABS plastic) */
  DEFAULT_FRICTION: 0.95,
  /** Snapped piece friction (interlocked toy studs) */
  SNAPPED_FRICTION: 1.65,
  /** Almost zero bounce (ABS plastic restitution) */
  DEFAULT_RESTITUTION: 0.0,
  /** Standard mass per 1x1 cell (total 4.0 per 4-cell piece) */
  CELL_MASS_NORMAL: 1.0,
  /** Giant piece total mass = 16.0 (4.0 per 2x2 cell) */
  CELL_MASS_GIANT: 4.0,
  /** Heavy rubber piece total mass = 10.0 (2.5 per 1x1 cell) */
  CELL_MASS_HEAVY_RUBBER: 2.5,
  /** Heavy rubber friction */
  HEAVY_RUBBER_FRICTION: 2.5,
  /** Slick Brick (soap/waxed plastic) friction */
  SLICK_BRICK_FRICTION: 0.02,
  /** Active piece horizontal control boundary (±7.5 units from tower center = 4u half-base + 1u gap + 2.5u island) */
  CONTROL_BOUND_X_UNITS: 7.5,
  /** Lateral disintegration kill zone boundary (±8.5 units from tower center) */
  KILL_ZONE_X_UNITS: 8.5,
  /** Duration of the dissolving brick fade & shrink animation (200ms) */
  DISSOLVE_DURATION_MS: 200,
} as const

export interface QueuedPieceSpec {
  type: PieceType
  variant: PieceVariant
  powerEffect?: PiecePowerEffect
  colorPaletteIndex?: number
  label?: string
}

export interface ActivePieceSnapshot {
  type: PieceType
  variant: PieceVariant
  powerEffect: PiecePowerEffect
  colorPaletteIndex?: number
  x: number
  y: number
  angle: number
  /** 0.0 to 1.0 progress of the recall-to-spawn & transform animation when hit by GIANT_PIECE / SLICK_BRICK / TURBO_DROP / LOCK_ROTATE */
  recallTransformProgress?: number
  recallPowerId?: PowerId
}

export interface SettledBlockSnapshot {
  id: number
  type: PieceType
  variant: PieceVariant
  powerEffect: PiecePowerEffect
  colorPaletteIndex?: number
  x: number
  y: number
  angle: number
  snapped: boolean
  sleeping: boolean
  isStaticAnchor?: boolean
  isGlued?: boolean
  isPetrified?: boolean
  isLaserBurning?: boolean
  isCountedHighlight?: boolean
  countOrderNumber?: number
}

export interface FloatingIslandSnapshot {
  id: string
  side: 'LEFT'
  | 'RIGHT'
  x: number
  y: number
  width: number
  height: number
}

export interface InventoryPowerSlot {
  selfPower: PowerId | null
  attackPower: PowerId | null
  sourceCheckpoint: number | null
}

/**
 * Lightweight network-ready State Snapshot exported every 100ms by TowerInstance.
 * Directly feeds the HUD in Single-Player and can be emitted over WebSocket in Multiplayer.
 */
export interface TowerSnapshot {
  playerId: string
  matchSeed: string
  isSinglePlayer: boolean
  gameMode: GameMode
  lives: number
  maxLives: number
  invulnerableRemainingMs?: number
  fallFlashRemainingMs?: number
  piecesPlaced: number
  survivalGoalPieces: number
  maxTowerHeight: number
  elapsedTimeMs: number
  towerHeight: number
  puzzleBaseRiseUnits?: number
  puzzleLaserHeightUnits?: number
  laserOverloadRemainingMs?: number | null
  isPetrified?: boolean
  countedPieces?: number
  /** Endless Mode: current score (+1 per stabilized piece, -1 per piece lost below petrification line) */
  endlessScore?: number
  /** Endless Mode: current height (in units) of the Petrification / Abyss Line */
  petrifyLineHeightUnits?: number
  /** Endless Mode: height (in units) of the next Checkpoint flag line */
  nextCheckpointHeightUnits?: number
  /** Endless Mode: number of consecutive pieces lost into the abyss */
  consecutiveAbyssFalls?: number
  /** Endless Multiplayer: true when elapsedTimeMs >= 90s ("ABISMO ACELERANDO!") */
  isAbyssOvertime?: boolean
  /** Endless Multiplayer: remaining match time in ms before 150s max time tiebreaker */
  abyssTimeRemainingMs?: number | null
  state: MatchState
  countdownRemainingMs: number
  goalCountdownMs: number | null
  respawnDelayRemainingMs: number
  windForce: number // -1.0 (strong left) to +1.0 (strong right)
  windActive: boolean
  checkpointsReached: number[]
  checkpointHoldProgress: {
    height: number
    progressRatio: number
  } | null
  inventoryPower: InventoryPowerSlot
  blindManualRemainingMs: number
  fogAnchorX?: number
  fogAnchorY?: number
  nextQueue: QueuedPieceSpec[]
  activePiece: ActivePieceSnapshot | null
  settledBlocks: SettledBlockSnapshot[]
  islands?: FloatingIslandSnapshot[]
  hasSpawnedSideIsland?: boolean
  basePresetId: BasePresetId
  basePresetName: string
  baseElevations: readonly number[]
}

