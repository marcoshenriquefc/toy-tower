import Matter from 'matter-js'
import {
  ActivePieceSnapshot,
  FloatingIslandSnapshot,
  GAME_CONSTANTS,
  GameMode,
  InventoryPowerSlot,
  MatchState,
  PiecePowerEffect,
  PieceType,
  PieceVariant,
  QueuedPieceSpec,
  SettledBlockSnapshot,
  TowerSnapshot,
} from '../types/game'
import {
  CellCoord,
  getVariantPhysicsSpec,
  PIECE_CATALOG,
} from './PieceCatalog'
import {
  getPowerConfig,
  PowerId,
  rollCheckpointPowers,
} from './PowersCatalog'
import {
  generateRandomMatchSeed,
  SeededBagRandomizer,
  hashSeedString,
} from './SeededRandomizer'
import {
  BasePresetId,
  BaseTerrainPreset,
  getBasePresetById,
  selectBasePresetForSeed,
} from './BaseTerrainCatalog'
import { spriteRegistry } from '../sprites/SpriteRegistry'

const { Engine, World, Bodies, Body, Events, Collision } = Matter

export interface TowerPieceEntity {
  id: number
  type: PieceType
  variant: PieceVariant
  powerEffect: PiecePowerEffect
  /** Multi-color palette index (0..7) so each piece has multiple contrasting Lego brick colors */
  colorPaletteIndex: number
  scale: number
  body: Matter.Body
  baseInertia: number
  realInertia: number
  /**
   * Cell offsets in unit coordinates relative to `body.position`
   * (the physical Center of Mass) when `body.angle === 0`.
   */
  cellsFromCoM: CellCoord[]
  snapped: boolean
  isSettled: boolean
  settledAtMs: number
  isStaticAnchor?: boolean
  isGlued?: boolean
  isPetrified?: boolean
  isLaserBurning?: boolean
  isCountedHighlight?: boolean
  countOrderNumber?: number
}

export interface RemoteLaneRenderData {
  laneOffsetX: number
  slotIndex: number
  handle: string
  customNick: string
  skinSpriteId: string
  rankBadge: '1ST' | '2ND' | '3RD' | '4TH'
  towerHeight: number
  lives: number
  isEliminated: boolean
  activePiece: ActivePieceSnapshot | null
  settledBlocks: SettledBlockSnapshot[]
  activeDebuffs: string[]
  blindManualRemainingMs: number
  fogAnchorX?: number
  fogAnchorY?: number
  islands?: FloatingIslandSnapshot[]
  mascotCastAnimMs: number
  mascotCastCategory: 'POSITIVE' | 'NEGATIVE' | null
  lastLifeLostAtMs?: number
  puzzleBaseRiseUnits?: number
  isPetrified?: boolean
  countedPieces?: number
  laserOverloadRemainingMs?: number | null
}

export interface FallFeedbackCallout {
  x: number
  y: number
  startY: number
  title: string
  subtitle: string
  tone:
    | 'LIFE_LOSS'
    | 'SHIELD_PROTECTED'
    | 'PIECE_DROP'
    | 'EXTRA_LIFE_CAUGHT'
    | 'EXTRA_LIFE_ESCAPED'
  ageMs: number
  maxAgeMs: number
}

export interface ExtraLifeBalloonEntity {
  id: number
  x: number
  y: number
  vx: number
  vy: number
  swayPhase: number
  ageMs: number
  maxAgeMs: number
}

export interface PowerVfxRenderData {
  casterLaneOffsetX: number
  targetLaneOffsetsX: number[]
  category: 'POSITIVE' | 'NEGATIVE'
  powerType: PowerId
  progress: number // 0..1
}

export interface TowerInstanceConfig {
  id: string
  offsetX: number
  matchSeed?: string
  /** Optional global BasePresetId chosen by host/server in Multiplayer (otherwise deterministically rolled from matchSeed) */
  basePresetId?: BasePresetId
  gameMode?: GameMode
  onSnapshot?: (snapshot: TowerSnapshot) => void
  onEventBanner?: (message: string, tone: 'info' | 'warning' | 'success' | 'danger') => void
  onPowerCast?: (category: 'POSITIVE' | 'NEGATIVE', powerId: PowerId) => void
  onPieceSettled?: (towerHeight: number, settledCount: number) => void
  onLifeLost?: () => void
  onVictory?: (elapsedTimeMs: number, towerHeight: number) => void
  onGameOver?: (elapsedTimeMs: number, maxTowerHeight: number, piecesPlaced: number) => void
}

export interface ImpactParticle {
  x: number
  y: number
  vx: number
  vy: number
  radius: number
  ageMs: number
  maxAgeMs: number
  kind: 'spark' | 'smoke' | 'ring'
  color?: string
}

export interface CheckpointConsumeEffect {
  heightUnits: number
  ageMs: number
  maxAgeMs: number
}

export interface BrickRemoverEffect {
  x: number
  y: number
  ageMs: number
  maxAgeMs: number
}

export interface GlueVineBridge {
  bodyA: Matter.Body
  bodyB: Matter.Body
  /** Anchor point in bodyA's unrotated local frame */
  localA: { x: number; y: number }
  /** Anchor point in bodyB's unrotated local frame */
  localB: { x: number; y: number }
  waveAmp1: number
  waveAmp2: number
  beadCount: number
  seed: number
  scale: number
  ageMs: number
  delayMs: number
  growDurationMs: number
}

/**
 * Velocity-neutral Rigid Weld Link (`WeldJoint`) between `bodyA` and `bodyB`.
 * Avoids Matter.js's internal `Constraint` bug (which desynchronizes compound `body.parts`
 * from `body.angle` and injects runaway angular velocity when colliding bodies are constrained).
 */
export interface GlueWeldLink {
  bodyA: Matter.Body
  bodyB: Matter.Body
  /** Position of bodyA's center in bodyB's unrotated local frame */
  localOffsetFromB: { x: number; y: number }
  /** Initial relative angle (bodyA.angle - bodyB.angle) */
  relativeAngle: number
  /** First 2 physics ticks allow contact separation to settle before locking exact relative offset */
  warmupTicks: number
}

export interface FloatingIsland {
  id: string
  side: 'LEFT' | 'RIGHT'
  /** Center X in units (-5.25 on LEFT, +5.25 on RIGHT) */
  x: number
  /** Top surface height in units above the base plate */
  y: number
  /** 2.5 units (2 full blocks + 1 half-block) */
  width: number
  /** 1.5 units */
  height: number
  body: Matter.Body
  /** Elapsed time in ms since spawn (0 -> 200ms scale-in & safe push-out phase) */
  spawnAgeMs: number
  readonly spawnDurationMs: number
}

export interface DissolvingBrick {
  body: Matter.Body
  piece: TowerPieceEntity
  /** 0.0 to 1.0 over 200ms */
  progress: number
  ageMs: number
  durationMs: number
  startX: number
  startY: number
  angle: number
  reason: 'LATERAL' | 'WATER' | 'LASER'
}

export type PieceAlteringPowerId =
  | 'GIANT_PIECE'
  | 'SLICK_BRICK'
  | 'TURBO_DROP'
  | 'LOCK_ROTATE'

/**
 * State for the recall-to-spawn & transformation animation when the player receives
 * a piece-altering power (`GIANT_PIECE`, `SLICK_BRICK`, `TURBO_DROP`, `LOCK_ROTATE`):
 * 1. The active piece stops in place (`0..55ms`).
 * 2. It is elevated smoothly back up to the starting spawn point (`55..340ms`).
 * 3. At the starting point (`340ms`), the piece itself transforms into the new state
 *    with a scale-pop & aura animation (`340..620ms`) before resuming its fall.
 */
export interface PieceRecallTransformAnim {
  powerId: PieceAlteringPowerId
  startLocalX: number
  startLocalY: number
  startAngle: number
  targetLocalX: number
  targetLocalY: number
  targetAngle: number
  elapsedMs: number
  readonly liftDurationMs: number
  readonly totalDurationMs: number
  hasTransformed: boolean
}

/**
 * Isolated Player Arena / Tower Instance (`TowerInstance`).
 * Uses local coordinates relative to the center-top of its own Green Base Plate,
 * translated by `offsetX` when rendered on a shared or single Canvas.
 */
export class TowerInstance {
  public readonly id: string
  public offsetX: number
  public matchSeed: string
  /** Single-Player MVP flag: when true, Checkpoint rolls only Positive (Self-Help) powers */
  public isSinglePlayer: boolean = true
  /** Active Game Mode ('RACE' = Corrida 30m, 'SURVIVAL' = Sobrevivência 3 Vidas) */
  public gameMode: GameMode = 'RACE'
  public lives: number = GAME_CONSTANTS.SURVIVAL_INITIAL_LIVES
  public maxLives: number = GAME_CONSTANTS.SURVIVAL_INITIAL_LIVES
  public maxTowerHeight: number = 0
  /** 3-second (3000ms) blinking invulnerability countdown after losing a life in Survival Mode */
  public invulnerableRemainingMs: number = 0
  /** Intense multi-pulse white flash timer (780ms) when the player drops a piece */
  public fallWhiteFlashMs: number = 0
  /** Expressive Wizard (Mago) shock/panic reaction timer (2500ms) when a piece falls */
  public mascotFallReactionMs: number = 0
  private lastLifeLossAtMs: number = -5000
  private lastFallFeedbackAtMs: number = -5000
  private fallFeedbackCallouts: FallFeedbackCallout[] = []
  private survivalPieceCheckpointsReached: number[] = []
  private extraLifeBalloons: ExtraLifeBalloonEntity[] = []

  /** Floating Side Island (`SIDE_ISLAND`) & Lane Boundary configuration constants */
  public readonly BASE_WIDTH = GAME_CONSTANTS.BASE_WIDTH_UNITS // 8.0 columns (Col 0..7)
  public readonly ISLAND_WIDTH = GAME_CONSTANTS.ISLAND_WIDTH_UNITS // 2.5
  public readonly ISLAND_HEIGHT = GAME_CONSTANTS.ISLAND_HEIGHT_UNITS // 1.5
  public readonly ISLAND_GAP_X = GAME_CONSTANTS.ISLAND_GAP_X_UNITS // 1.0
  public readonly ISLAND_OFFSET_Y = GAME_CONSTANTS.ISLAND_OFFSET_Y_UNITS // 1.0
  public readonly CONTROL_LIMIT_X =
    GAME_CONSTANTS.CONTROL_BOUND_X_UNITS * GAME_CONSTANTS.UNIT_PX // ±7.5u
  public readonly KILL_LIMIT_X =
    GAME_CONSTANTS.KILL_ZONE_X_UNITS * GAME_CONSTANTS.UNIT_PX // ±8.5u

  /** Modular 8-Column Base Terrain Profile (1 single immutable Base Island per player centered at X=0 of their lane) */
  public currentBasePreset!: BaseTerrainPreset
  public forcedBasePresetId: BasePresetId | null = null

  /** Limit of 1 Side Island (`SIDE_ISLAND`) per player per match: once true, removed from Checkpoint rolls */
  public hasSpawnedSideIsland: boolean = false
  public islands: FloatingIsland[] = []
  public dissolvingBricks: DissolvingBrick[] = []

  private engine: Matter.Engine
  private baseBody!: Matter.Body
  private randomizer: SeededBagRandomizer
  private windPhaseOffset: number

  public state: MatchState = 'COUNTDOWN'
  public elapsedTimeMs: number = 0
  public countdownRemainingMs: number = GAME_CONSTANTS.START_COUNTDOWN_MS
  public respawnDelayRemainingMs: number = 0
  public goalCountdownMs: number | null = null

  /** Puzzle Mode ("Abaixo do Laser" - 9m) state fields */
  public puzzleBaseRiseUnits: number = 0
  private pendingPuzzleBaseRiseUnits: number = 0
  private puzzleBaseRiseTargetUnits: number = 0
  private puzzleLaserBurnPhaseMs: number = 0
  public laserOverloadRemainingMs: number | null = null
  public isPetrified: boolean = false
  public countedPieces: number = 0
  private puzzleCountTimerMs: number = 0
  private puzzleSortedCountPieces: TowerPieceEntity[] = []
  private puzzlePostCountDelayMs: number = 0

  /** Endless / Rising Abyss Mode ("Infinito / Abismo") state fields */
  public endlessScore: number = 0
  public consecutiveAbyssFalls: number = 0
  public petrifyLineHeightUnits: number = 0
  public targetPetrifyLineHeightUnits: number = 0
  public nextEndlessCheckpointUnits: number = GAME_CONSTANTS.ENDLESS_STEP_UNITS
  public endlessCheckpointsCount: number = 0
  public isAbyssOvertime: boolean = false
  public isAbyssMaxTimeLocked: boolean = false
  private lastOvertimeStepNotified: number = -1

  public towerHeight: number = 0
  public windForce: number = 0 // -1.0 (left) to +1.0 (right)
  public windActive: boolean = false
  public windEnabled: boolean = true
  /**
   * Slide regulator (0 = Firme/Colado, 50 = Equilibrado/Padrão, 100 = Muito Escorregadio).
   */
  public slideLevel: number = 50
  public checkpointsReached: number[] = []
  private checkpointHoldTarget: number | null = null
  private checkpointHoldTimerMs: number = 0

  /** Single-Slot Power Inventory (Non-cumulative: overwritten on new Checkpoint) */
  public inventoryPower: InventoryPowerSlot = {
    selfPower: null,
    attackPower: null,
    sourceCheckpoint: null,
  }
  private pendingNextPiecePower: PiecePowerEffect = 'NONE'
  public slickBrickRemaining: number = 0
  public lockRotateRemaining: number = 0
  public turboDropRemaining: number = 0
  public giantPieceRemaining: number = 0
  public blindManualRemainingMs: number = 0
  public fogAnchorX: number = 0
  public fogAnchorY: number = -38

  private glueWeldLinks: GlueWeldLink[] = []
  private glueVines: GlueVineBridge[] = []
  private checkpointConsumeEffects: CheckpointConsumeEffect[] = []
  private brickRemoverEffects: BrickRemoverEffect[] = []
  private confettiParticles: Array<{
    x: number
    y: number
    vx: number
    vy: number
    w: number
    h: number
    angle: number
    vAng: number
    color: string
    border: string
    ageMs: number
    maxAgeMs: number
  }> = []

  public activePiece: TowerPieceEntity | null = null
  /** Active recall-to-spawn & transformation animation when hit by a piece-altering power */
  public pieceRecallAnim: PieceRecallTransformAnim | null = null
  /** Frozen & hidden falling piece stored during GOAL_COUNTDOWN (restored if tower slips before 0.0s, discarded on ROOF_DROP) */
  public heldActivePiece: TowerPieceEntity | null = null
  public settledPieces: TowerPieceEntity[] = []
  private survivalFinalPiecesCount: number | null = null
  private nextEntityId: number = 1

  public isSoftDropping: boolean = false
  /** Mini shadow trail history when accelerating the piece downward (Soft Drop / Turbo Drop) */
  private softDropTrail: Array<{
    localX: number
    localY: number
    angle: number
    ageMs: number
  }> = []
  private softDropTrailAccumMs: number = 0
  private pendingLandPiece: boolean = false
  /** 0.2s (200ms) grace timer once the active piece touches the piece/surface below */
  private bottomTouchTimerMs: number = 0
  private hasBottomSupportThisTick: boolean = false
  private settlingTimerMs: number = 0
  private snapshotAccumulatorMs: number = 0

  /** Impulse Nudge ("O Socão") state: cooldown (250ms), piston animation (4px in 80ms), screen shake & particles */
  private lastNudgeAtMs: number = -1000
  private pistonTimerMs: number = 0
  private readonly pistonDurationMs: number = 80
  private pistonDir: -1 | 1 = 1
  private shakeTimerMs: number = 0
  private readonly shakeDurationMs: number = 95
  private shakeDir: -1 | 1 = 1
  private boundaryShakeTimerMs: number = 0
  private boundaryShakeDir: -1 | 1 = 1
  private impactParticles: ImpactParticle[] = []
  private audioCtx: AudioContext | null = null

  /** Smooth camera vertical/horizontal parallax tracking & Climax Zoom */
  public cameraCenterHeightUnits: number = 0
  public cameraParallaxX: number = 0
  public cameraZoom: number = 1.0
  private lastCanvasWidth: number = 1280
  private lastCanvasHeight: number = 720
  private mascotHoverXUnits: number = 6.2
  private mascotHoverYUnits: number = 3.5
  private victoryAnimTimeMs: number = 0
  public showDebugColliders: boolean = false
  public showGhostPiece: boolean = false

  /** Real-time Multiplayer rank badge, player nick, slot index, mascot cast animation, and remote lane render buffers */
  public rankBadge: '1ST' | '2ND' | '3RD' | '4TH' | null = null
  public playerNick: string = ''
  public localSlotIndex: number = 0
  public mascotCastAnimMs: number = 0
  public mascotCastCategory: 'POSITIVE' | 'NEGATIVE' | null = null
  public remoteLanesToRender: RemoteLaneRenderData[] = []
  public activePowerVfxToRender: PowerVfxRenderData[] = []

  private onSnapshot?: (snapshot: TowerSnapshot) => void
  private onEventBanner?: (
    message: string,
    tone: 'info' | 'warning' | 'success' | 'danger'
  ) => void
  private onPowerCast?: (category: 'POSITIVE' | 'NEGATIVE', powerId: PowerId) => void
  private onPieceSettled?: (towerHeight: number, settledCount: number) => void
  private onLifeLost?: () => void
  private onVictory?: (elapsedTimeMs: number, towerHeight: number) => void
  private onGameOver?: (
    elapsedTimeMs: number,
    maxTowerHeight: number,
    piecesPlaced: number
  ) => void

  constructor(config: TowerInstanceConfig) {
    this.id = config.id
    this.offsetX = config.offsetX
    this.matchSeed =
      config.matchSeed && config.matchSeed.trim().length > 0
        ? config.matchSeed.trim()
        : generateRandomMatchSeed()
    if (config.basePresetId) {
      this.forcedBasePresetId = config.basePresetId
    }
    if (config.gameMode) {
      this.gameMode = config.gameMode
    }
    if (this.gameMode === 'PUZZLE') {
      this.inventoryPower = {
        selfPower: 'SUPER_GLUE',
        attackPower: null,
        sourceCheckpoint: 0,
      }
      this.cameraCenterHeightUnits = 1.8
    }
    this.onSnapshot = config.onSnapshot
    this.onEventBanner = config.onEventBanner
    this.onPowerCast = config.onPowerCast
    this.onPieceSettled = config.onPieceSettled
    this.onLifeLost = config.onLifeLost
    this.onVictory = config.onVictory
    this.onGameOver = config.onGameOver

    this.randomizer = new SeededBagRandomizer(this.matchSeed)
    this.windPhaseOffset = (hashSeedString(this.matchSeed) % 1000) / 100

    this.engine = Engine.create({
      enableSleeping: true,
      positionIterations: 14,
      velocityIterations: 12,
    })
    this.engine.gravity.x = 0
    this.engine.gravity.y = 0.78

    this.initWorld()
    this.bindCollisions()
  }

  /**
   * Builds the Modular 8-Column Static Base (`Col 0` to `Col 7`, X from `-4u` to `+4u`):
   * - Selects the terrain profile from `this.forcedBasePresetId` (if set in Dev Mode) or deterministically from `this.matchSeed` and `this.gameMode`.
   * - Creates a compound static `this.baseBody` combining:
   *   1. The solid foundation floor (`Y = +1.0u` to `+2.0u`) under active columns (`elev >= -1`)
   *      so `-1` holes act as 1-block-deep pits while `-2` void columns remain open abysses for smaller platforms.
   *   2. Merged horizontal static rectangles for Layer `0` (`Y = 0..+1u`) up to `maxElev`
   *      according to `this.currentBasePreset.elevations`.
   */
  private initWorld(): void {
    const u = GAME_CONSTANTS.UNIT_PX
    const cols = 8
    const halfCols = cols / 2 // 4.0 units (-4u to +4u)

    this.currentBasePreset = this.forcedBasePresetId
      ? getBasePresetById(this.forcedBasePresetId)
      : selectBasePresetForSeed(this.matchSeed, this.gameMode)

    const elevations = this.currentBasePreset.elevations
    const maxElev = Math.max(2, ...elevations)
    const riseOffsetPx = -this.puzzleBaseRiseUnits * u
    const partBodies: Matter.Body[] = []

    // 1. Solid foundation floor under Layer 0 (from Y = +1.0u to +2.0u, centerY = +1.5u)
    // Built only under columns where `elev >= -1` so `-1` acts as a 1-block-deep pit and `-2` is open abyss!
    let roofCol = 0
    while (roofCol < cols) {
      if ((elevations[roofCol] ?? 0) >= -1) {
        const startCol = roofCol
        while (roofCol < cols && (elevations[roofCol] ?? 0) >= -1) {
          roofCol++
        }
        const endCol = roofCol - 1
        const spanCols = endCol - startCol + 1
        const leftWorldX = this.offsetX + (-halfCols + startCol) * u
        const rightWorldX = this.offsetX + (-halfCols + endCol + 1) * u
        const centerX = (leftWorldX + rightWorldX) * 0.5

        partBodies.push(
          Bodies.rectangle(centerX, 1.5 * u + riseOffsetPx, spanCols * u, u, {
            isStatic: true,
            friction: 1.4,
            frictionStatic: 4.5,
            restitution: 0.0,
            slop: 0.005,
          })
        )
      } else {
        roofCol++
      }
    }

    // 2. Modular 1x1 Static Green Block Layers (r = 0: surface Y=0 up to r = maxElev)
    for (let r = 0; r <= maxElev; r++) {
      let c = 0
      while (c < cols) {
        if ((elevations[c] ?? 0) >= r) {
          const startCol = c
          while (c < cols && (elevations[c] ?? 0) >= r) {
            c++
          }
          const endCol = c - 1 // inclusive
          const spanCols = endCol - startCol + 1

          const leftWorldX = this.offsetX + (-halfCols + startCol) * u
          const rightWorldX = this.offsetX + (-halfCols + endCol + 1) * u
          const centerX = (leftWorldX + rightWorldX) * 0.5
          // r = 0 -> centerY = +0.5u (+16px, top at Y = 0)
          // r = 1 -> centerY = -0.5u (-16px, top at Y = -1u)
          // r = 2 -> centerY = -1.5u (-48px, top at Y = -2u)
          const centerY = (0.5 - r) * u + riseOffsetPx

          // Slight lateral inset on exposed step walls so falling pieces slide past vertical steps without snagging
          const insetLeft =
            r >= 1 || (startCol > 0 && (elevations[startCol - 1] ?? 0) < r)
              ? 1.4
              : 0
          const insetRight =
            r >= 1 || (endCol < cols - 1 && (elevations[endCol + 1] ?? 0) < r)
              ? 1.4
              : 0
          const rectW = spanCols * u - insetLeft - insetRight
          const rectCenterX = centerX + (insetLeft - insetRight) * 0.5

          partBodies.push(
            Bodies.rectangle(rectCenterX, centerY, rectW, u - 0.6, {
              isStatic: true,
              chamfer: r >= 1 ? { radius: 2.5 } : undefined,
              friction: 1.4,
              frictionStatic: 4.5,
              restitution: 0.0,
              slop: 0.005,
            })
          )
        } else {
          c++
        }
      }
    }

    this.baseBody = Body.create({
      parts: partBodies,
      isStatic: true,
      friction: 1.4,
      frictionStatic: 4.5,
      restitution: 0.0,
      slop: 0.005,
      label: 'base_plate',
    })

    World.add(this.engine.world, [this.baseBody])
  }

  private bindCollisions(): void {
    Events.on(this.engine, 'collisionStart', (event) => {
      this.handleCollisionPairs(event.pairs)
    })
    Events.on(this.engine, 'collisionActive', (event) => {
      this.handleCollisionPairs(event.pairs)
    })
  }

  private handleCollisionPairs(pairs: Matter.Pair[]): void {
    if (
      !this.activePiece ||
      this.pieceRecallAnim !== null ||
      (this.state !== 'FALLING' && this.state !== 'ROOF_DROP')
    ) {
      return
    }

    const activeBody = this.activePiece.body
    const powerEffect = this.activePiece.powerEffect

    for (const pair of pairs) {
      const parentA = pair.bodyA.parent
      const parentB = pair.bodyB.parent

      const isActiveA = parentA === activeBody
      const isActiveB = parentB === activeBody
      if (!isActiveA && !isActiveB) continue

      const activePart = isActiveA ? pair.bodyA : pair.bodyB
      const otherPart = isActiveA ? pair.bodyB : pair.bodyA

      if (otherPart.isSensor || otherPart.parent.isSensor) continue

      // State C: ROOF_DROP ("Auto-Weld" do Telhado de Castelo):
      // As soon as the Castle Roof touches ANY block of the tower (or the base),
      // it immediately welds to the tower, bursts confetti, locks the entire tower static, and declares VICTORY!
      if (this.state === 'ROOF_DROP' || powerEffect === 'CASTLE_ROOF') {
        Body.setVelocity(activeBody, { x: 0, y: 0 })
        Body.setAngularVelocity(activeBody, 0)
        this.pendingLandPiece = true
        return
      }

      // Special Power 2: STATIC_BRICK ("Bloco de Ferro"):
      // In the exact millisecond it touches ANY piece of the tower (or the base),
      // it freezes in space and converts from Dynamic to Static!
      if (powerEffect === 'STATIC_BRICK') {
        Body.setVelocity(activeBody, { x: 0, y: 0 })
        Body.setAngularVelocity(activeBody, 0)
        this.pendingLandPiece = true
        return
      }

      // Compute horizontal and vertical bounding overlap between the two colliding squares
      const overlapX =
        Math.min(activePart.bounds.max.x, otherPart.bounds.max.x) -
        Math.max(activePart.bounds.min.x, otherPart.bounds.min.x)
      const overlapY =
        Math.min(activePart.bounds.max.y, otherPart.bounds.max.y) -
        Math.max(activePart.bounds.min.y, otherPart.bounds.min.y)

      // Center-to-center vertical distance: positive when activePart is above otherPart
      const dy = otherPart.position.y - activePart.position.y
      const normalY = Math.abs(pair.collision.normal.y)
      const isAboveTopSurface =
        activePart.bounds.max.y <= otherPart.bounds.min.y + 10

      // Require genuine horizontal support overlap (> 5.5px) so lateral corner grazes in adjacent columns
      // never falsely trigger bottom support on a tall vertical "I" piece
      const isBottomSupport =
        isAboveTopSurface &&
        ((dy >= 11 && overlapX > 5.5 && overlapX >= overlapY * 0.55) ||
          (dy >= 7 && overlapX > 5.5 && normalY > 0.65))

      if (isBottomSupport) {
        if (!otherPart.parent.isStatic && otherPart.parent.isSleeping) {
          Matter.Sleeping.set(otherPart.parent, false)
        }
        // Start / sustain the 0.5s (500ms) bottom-contact grace window so the player can walk sideways
        // or perform a "Socão" to one of the sides before the piece locks in place!
        if (this.bottomTouchTimerMs === 0 && !this.hasBottomSupportThisTick) {
          if (powerEffect === 'TURBO_DROP') {
            this.shakeTimerMs = this.shakeDurationMs
          }
          if (!otherPart.parent.isStatic) {
            const sup = otherPart.parent
            if (Math.abs(sup.velocity.y) > 0.4) {
              Body.setVelocity(sup, {
                x: sup.velocity.x * 0.5,
                y: Math.max(-0.2, Math.min(0.3, sup.velocity.y)),
              })
            }
          }
        }
        Body.setVelocity(activeBody, { x: 0, y: 0 })
        Body.setAngularVelocity(activeBody, 0)
        this.hasBottomSupportThisTick = true
        return
      }
    }
  }

  /**
   * Resets the arena for a fresh race, rolling a brand-new random `matchSeed` by default
   * unless an explicit custom seed is provided.
   */
  public resetMatch(newSeed?: string): void {
    this.matchSeed =
      newSeed && newSeed.trim().length > 0
        ? newSeed.trim()
        : generateRandomMatchSeed()
    World.clear(this.engine.world, false)
    Engine.clear(this.engine)

    this.randomizer = new SeededBagRandomizer(this.matchSeed)
    this.windPhaseOffset = (hashSeedString(this.matchSeed) % 1000) / 100

    this.state = 'COUNTDOWN'
    this.elapsedTimeMs = 0
    this.countdownRemainingMs = GAME_CONSTANTS.START_COUNTDOWN_MS
    this.respawnDelayRemainingMs = 0
    this.goalCountdownMs = null
    this.puzzleBaseRiseUnits = 0
    this.pendingPuzzleBaseRiseUnits = 0
    this.puzzleBaseRiseTargetUnits = 0
    this.puzzleLaserBurnPhaseMs = 0
    this.laserOverloadRemainingMs = null
    this.isPetrified = false
    this.countedPieces = 0
    this.puzzleCountTimerMs = 0
    this.puzzleSortedCountPieces = []
    this.puzzlePostCountDelayMs = 0
    this.endlessScore = 0
    this.consecutiveAbyssFalls = 0
    this.petrifyLineHeightUnits = 0
    this.targetPetrifyLineHeightUnits = 0
    this.nextEndlessCheckpointUnits = GAME_CONSTANTS.ENDLESS_STEP_UNITS
    this.endlessCheckpointsCount = 0
    this.isAbyssOvertime = false
    this.isAbyssMaxTimeLocked = false
    this.lastOvertimeStepNotified = -1
    this.towerHeight = 0
    this.maxTowerHeight = 0
    this.lives = GAME_CONSTANTS.SURVIVAL_INITIAL_LIVES
    this.maxLives = GAME_CONSTANTS.SURVIVAL_INITIAL_LIVES
    this.invulnerableRemainingMs = 0
    this.fallWhiteFlashMs = 0
    this.mascotFallReactionMs = 0
    this.lastLifeLossAtMs = -5000
    this.lastFallFeedbackAtMs = -5000
    this.fallFeedbackCallouts = []
    this.survivalPieceCheckpointsReached = []
    this.extraLifeBalloons = []
    this.windForce = 0
    this.windActive = false
    this.checkpointsReached = []
    this.checkpointHoldTarget = null
    this.checkpointHoldTimerMs = 0
    this.inventoryPower =
      this.gameMode === 'PUZZLE'
        ? {
            selfPower: 'SUPER_GLUE',
            attackPower: null,
            sourceCheckpoint: 0,
          }
        : {
            selfPower: null,
            attackPower: null,
            sourceCheckpoint: null,
          }
    this.pendingNextPiecePower = 'NONE'
    this.slickBrickRemaining = 0
    this.lockRotateRemaining = 0
    this.turboDropRemaining = 0
    this.giantPieceRemaining = 0
    this.blindManualRemainingMs = 0
    this.fogAnchorX = 0
    this.fogAnchorY = -38
    this.glueWeldLinks = []
    this.glueVines = []
    this.checkpointConsumeEffects = []
    this.brickRemoverEffects = []
    this.confettiParticles = []

    this.activePiece = null
    this.pieceRecallAnim = null
    this.heldActivePiece = null
    this.settledPieces = []
    this.survivalFinalPiecesCount = null
    this.hasSpawnedSideIsland = false
    this.islands = []
    this.dissolvingBricks = []
    this.nextEntityId = 1
    this.isSoftDropping = false
    this.softDropTrail = []
    this.softDropTrailAccumMs = 0
    this.pendingLandPiece = false
    this.bottomTouchTimerMs = 0
    this.hasBottomSupportThisTick = false
    this.settlingTimerMs = 0
    this.snapshotAccumulatorMs = 0
    this.cameraCenterHeightUnits = this.gameMode === 'PUZZLE' ? 1.8 : 0
    this.cameraZoom = 1.0
    this.mascotHoverXUnits = 6.2
    this.mascotHoverYUnits = 3.5
    this.victoryAnimTimeMs = 0
    this.lastNudgeAtMs = -1000
    this.pistonTimerMs = 0
    this.shakeTimerMs = 0
    this.boundaryShakeTimerMs = 0
    this.impactParticles = []

    this.initWorld()
    this.emitSnapshotNow()
  }

  /**
   * Updates the active game mode ('RACE', 'SURVIVAL', 'PUZZLE', or 'ENDLESS') and resets mode-specific state.
   */
  public setGameMode(mode: GameMode): void {
    const prevMode = this.gameMode
    this.gameMode = mode
    this.lives = GAME_CONSTANTS.SURVIVAL_INITIAL_LIVES
    this.maxLives = GAME_CONSTANTS.SURVIVAL_INITIAL_LIVES
    this.invulnerableRemainingMs = 0
    this.fallWhiteFlashMs = 0
    this.mascotFallReactionMs = 0
    this.fallFeedbackCallouts = []
    this.extraLifeBalloons = []
    this.puzzleBaseRiseUnits = 0
    this.pendingPuzzleBaseRiseUnits = 0
    this.puzzleBaseRiseTargetUnits = 0
    this.puzzleLaserBurnPhaseMs = 0
    this.laserOverloadRemainingMs = null
    this.isPetrified = false
    this.countedPieces = 0
    this.puzzleCountTimerMs = 0
    this.puzzleSortedCountPieces = []
    this.puzzlePostCountDelayMs = 0
    this.endlessScore = 0
    this.consecutiveAbyssFalls = 0
    this.petrifyLineHeightUnits = 0
    this.targetPetrifyLineHeightUnits = 0
    this.nextEndlessCheckpointUnits = GAME_CONSTANTS.ENDLESS_STEP_UNITS
    this.endlessCheckpointsCount = 0
    this.isAbyssOvertime = false
    this.isAbyssMaxTimeLocked = false
    this.lastOvertimeStepNotified = -1
    this.inventoryPower =
      mode === 'PUZZLE'
        ? {
            selfPower: 'SUPER_GLUE',
            attackPower: null,
            sourceCheckpoint: 0,
          }
        : {
            selfPower: null,
            attackPower: null,
            sourceCheckpoint: null,
          }
    if (mode === 'PUZZLE') {
      this.cameraCenterHeightUnits = 1.8
      this.windActive = false
      this.windForce = 0
    }
    if (
      prevMode !== mode &&
      (mode === 'PUZZLE' || prevMode === 'PUZZLE') &&
      this.baseBody
    ) {
      World.remove(this.engine.world, this.baseBody)
      this.initWorld()
    }
    this.emitSnapshotNow()
  }

  /**
   * Updates the horizontal world offset (`offsetX`) of this player's lane
   * (so Player 1 is at Position 1, Player 2 at Position 2, etc.) and seamlessly
   * translates all existing Matter.js bodies by `deltaX`.
   */
  public setLaneOffsetX(newOffsetX: number): void {
    const deltaX = newOffsetX - this.offsetX
    if (Math.abs(deltaX) < 0.05) return
    this.offsetX = newOffsetX

    if (this.baseBody) {
      Body.setPosition(this.baseBody, {
        x: this.baseBody.position.x + deltaX,
        y: this.baseBody.position.y,
      })
    }
    for (const isl of this.islands) {
      Body.setPosition(isl.body, {
        x: isl.body.position.x + deltaX,
        y: isl.body.position.y,
      })
    }
    for (const p of this.settledPieces) {
      this.setBodyPositionClean(
        p.body,
        p.body.position.x + deltaX,
        p.body.position.y
      )
    }
    if (this.activePiece) {
      this.setBodyPositionClean(
        this.activePiece.body,
        this.activePiece.body.position.x + deltaX,
        this.activePiece.body.position.y
      )
    }
    if (this.heldActivePiece) {
      this.setBodyPositionClean(
        this.heldActivePiece.body,
        this.heldActivePiece.body.position.x + deltaX,
        this.heldActivePiece.body.position.y
      )
    }
  }

  public setSinglePlayerMode(isSingle: boolean): void {
    this.isSinglePlayer = isSingle
    this.emitSnapshotNow()
  }

  /**
   * Forces a specific modular 8-column base preset (or `null` to return to deterministic seed roll)
   * and immediately rebuilds the arena with that base profile.
   */
  public setForcedBasePreset(presetId: BasePresetId | null): void {
    this.forcedBasePresetId = presetId
    this.resetMatch(this.matchSeed)
    const preset = this.currentBasePreset
    this.onEventBanner?.(
      `🏠 Base Modular: ${preset.name} [${preset.elevations.join(', ')}] — ${preset.description}`,
      'info'
    )
  }

  /**
   * Places a specific power into the Single-Slot HUD Inventory (Developer Mode helper).
   */
  public grantDevPower(powerId: PowerId): void {
    const cfg = getPowerConfig(powerId)
    if (!cfg) return
    if (cfg.category === 'POSITIVE') {
      this.inventoryPower = {
        selfPower: powerId,
        attackPower: this.inventoryPower.attackPower,
        sourceCheckpoint: 8,
      }
    } else {
      this.isSinglePlayer = false
      this.inventoryPower = {
        selfPower: this.inventoryPower.selfPower,
        attackPower: powerId,
        sourceCheckpoint: 8,
      }
    }
    this.onEventBanner?.(
      `${cfg.icon} Poder "${cfg.name}" ativo no balão do personagem!`,
      'info'
    )
    this.emitSnapshotNow()
  }

  /**
   * Activates the positive power currently stored in the Single-Slot HUD Inventory (Key: Space).
   */
  public activateSelfPower(): boolean {
    if (
      this.state === 'GOAL_COUNTDOWN' ||
      this.state === 'ROOF_DROP' ||
      this.state === 'VICTORY' ||
      this.state === 'GAME_OVER'
    ) {
      return false
    }
    const powerId = this.inventoryPower.selfPower
    if (!powerId) return false

    this.inventoryPower = {
      selfPower: null,
      attackPower: null,
      sourceCheckpoint: null,
    }
    this.mascotCastAnimMs = 950
    this.mascotCastCategory = 'POSITIVE'
    this.triggerPowerEffect(powerId)
    this.onPowerCast?.('POSITIVE', powerId)
    this.emitSnapshotNow()
    return true
  }

  /**
   * In Multiplayer mode, activates the negative attack power stored in the HUD Inventory (Key: KeyB / KeyC).
   * Negative effects are ONLY applied to enemies (applied to self only via Developer Mode!).
   */
  public activateAttackPower(): boolean {
    if (
      this.state === 'GOAL_COUNTDOWN' ||
      this.state === 'ROOF_DROP' ||
      this.state === 'VICTORY' ||
      this.state === 'GAME_OVER'
    ) {
      return false
    }
    const powerId = this.inventoryPower.attackPower
    if (!powerId) return false

    const cfg = getPowerConfig(powerId)
    this.inventoryPower = {
      selfPower: null,
      attackPower: null,
      sourceCheckpoint: null,
    }
    this.mascotCastAnimMs = 950
    this.mascotCastCategory = 'NEGATIVE'
    this.onPowerCast?.('NEGATIVE', powerId)
    this.onEventBanner?.(
      `${cfg?.icon || '🔥'} Ataque disparado nos inimigos: ${cfg?.name || powerId}!`,
      'warning'
    )
    this.emitSnapshotNow()
    return true
  }

  /**
   * Executes any Positive or Negative power from `POWERS_REGISTRY`.
   */
  public triggerPowerEffect(powerId: PowerId): void {
    const cfg = getPowerConfig(powerId)
    if (!cfg) return

    switch (powerId) {
      case 'SUPER_GLUE': {
        if (this.activePiece && this.state === 'FALLING') {
          this.activePiece.powerEffect = 'SUPER_GLUE'
          this.spawnColoredBurst(
            this.activePiece.body.position.x - this.offsetX,
            this.activePiece.body.position.y,
            '#00E5FF',
            10
          )
        } else {
          this.pendingNextPiecePower = 'SUPER_GLUE'
        }
        this.onEventBanner?.(
          `${cfg.icon} Super Cola ativada! A peça colará rigidamente (WeldJoint) ao pousar!`,
          'info'
        )
        break
      }

      case 'STATIC_BRICK': {
        if (this.activePiece && this.state === 'FALLING') {
          this.activePiece.powerEffect = 'STATIC_BRICK'
          this.spawnColoredBurst(
            this.activePiece.body.position.x - this.offsetX,
            this.activePiece.body.position.y,
            '#94A3B8',
            10
          )
          if (this.isStaticBrickTouchingTower(this.activePiece.body)) {
            this.landActivePiece()
          }
        } else {
          this.pendingNextPiecePower = 'STATIC_BRICK'
        }
        this.onEventBanner?.(
          `${cfg.icon} Bloco de Ferro ativado! Congelará ao encostar (até lateralmente) em outro bloco!`,
          'info'
        )
        break
      }

      case 'BRICK_REMOVER': {
        if (this.settledPieces.length > 0) {
          const lastSettled = this.settledPieces.pop()!
          const lx = lastSettled.body.position.x - this.offsetX
          const ly = lastSettled.body.position.y

          // Remove any Super Glue weld links & vine tendrils attached to this piece
          for (let i = this.glueWeldLinks.length - 1; i >= 0; i--) {
            const link = this.glueWeldLinks[i]
            if (
              link.bodyA === lastSettled.body ||
              link.bodyB === lastSettled.body
            ) {
              this.glueWeldLinks.splice(i, 1)
            }
          }
          for (let i = this.glueVines.length - 1; i >= 0; i--) {
            const v = this.glueVines[i]
            if (
              v.bodyA === lastSettled.body ||
              v.bodyB === lastSettled.body
            ) {
              this.glueVines.splice(i, 1)
            }
          }

          World.remove(this.engine.world, lastSettled.body)
          this.brickRemoverEffects.push({
            x: lx,
            y: ly,
            ageMs: 0,
            maxAgeMs: 650,
          })
          this.spawnColoredBurst(lx, ly, '#FF6D00', 16)
          this.updateSettledBlocksAndHeight()
          this.onEventBanner?.(
            `${cfg.icon} Removedor de Peças: última peça da torre desintegrada!`,
            'success'
          )
        } else if (this.activePiece) {
          const ax = this.activePiece.body.position.x - this.offsetX
          const ay = this.activePiece.body.position.y
          World.remove(this.engine.world, this.activePiece.body)
          this.activePiece = null
          this.pieceRecallAnim = null
          this.brickRemoverEffects.push({
            x: ax,
            y: ay,
            ageMs: 0,
            maxAgeMs: 650,
          })
          this.spawnColoredBurst(ax, ay, '#FF6D00', 14)
          this.state = 'SPAWNING'
          this.onEventBanner?.(
            `${cfg.icon} Removedor de Peças: peça atual descartada!`,
            'success'
          )
        }
        break
      }

      case 'SIDE_ISLAND': {
        this.activateSideIslandPower()
        break
      }

      case 'EXTRA_LIFE': {
        this.activateExtraLifeBalloonPower()
        break
      }

      case 'GIANT_PIECE': {
        const recalled = this.startPieceRecallTransform('GIANT_PIECE')
        if (!recalled) {
          const stableGiantTypes: PieceType[] = ['I', 'O', 'T', 'L', 'J']
          const type =
            stableGiantTypes[
              Math.floor(this.randomizer.nextFloat() * stableGiantTypes.length)
            ]
          this.giantPieceRemaining++
          this.randomizer.enqueueCustomPiece({
            type,
            variant: 'GIANT',
            label: `🦣 Poder Negativo: Mega-Bloco 2x "${type}" (Massa 16)!`,
          })
        }
        this.onEventBanner?.(
          `${cfg.icon} Mega-Bloco 2x: sua peça parou, subiu de volta ao topo e virou Gigante (2x)!`,
          'warning'
        )
        break
      }

      case 'SLICK_BRICK': {
        const count = cfg.durationPieces || 2
        const recalled = this.startPieceRecallTransform('SLICK_BRICK')
        if (recalled) {
          this.slickBrickRemaining += Math.max(0, count - 1)
        } else {
          this.slickBrickRemaining += count
        }
        this.onEventBanner?.(
          `${cfg.icon} Bloco Escorregadio: sua peça voltou ao topo e congelou em gelo azul-ciano (μ=0.02)!`,
          'warning'
        )
        break
      }

      case 'LOCK_ROTATE': {
        const count = cfg.durationPieces || 2
        const recalled = this.startPieceRecallTransform('LOCK_ROTATE')
        if (recalled) {
          this.lockRotateRemaining += Math.max(0, count - 1)
        } else {
          this.lockRotateRemaining += count
        }
        this.onEventBanner?.(
          `${cfg.icon} Giro Travado: sua peça voltou ao topo com rotação travada!`,
          'warning'
        )
        break
      }

      case 'BLIND_MANUAL': {
        this.blindManualRemainingMs = cfg.durationMs || 20000
        if (this.settledPieces.length > 0) {
          const lastPiece = this.settledPieces[this.settledPieces.length - 1]
          this.fogAnchorX = lastPiece.body.position.x - this.offsetX
          this.fogAnchorY = lastPiece.body.position.y
        } else {
          this.fogAnchorX = 0
          this.fogAnchorY = -1.2 * GAME_CONSTANTS.UNIT_PX
        }
        this.onEventBanner?.(
          `${cfg.icon} Nuvem Fog ativada por 20 segundos!`,
          'danger'
        )
        break
      }

      case 'TURBO_DROP': {
        const count = cfg.durationPieces || 2
        const recalled = this.startPieceRecallTransform('TURBO_DROP')
        if (recalled) {
          this.turboDropRemaining += Math.max(0, count - 1)
        } else {
          this.turboDropRemaining += count
        }
        this.onEventBanner?.(
          `${cfg.icon} Queda Turbo: sua peça voltou ao ponto de partida e entrou em Queda Turbo!`,
          'danger'
        )
        break
      }
    }
  }

  /**
   * Toggles `isSensor` on a piece's compound body and all its child parts so it can
   * elevate back to the starting point without colliding with tower blocks along the way.
   */
  private setPieceBodySensor(body: Matter.Body, isSensor: boolean): void {
    body.isSensor = isSensor
    for (const part of body.parts) {
      part.isSensor = isSensor
    }
  }

  /**
   * Computes the default starting point `(localX, localY)` at the top spawn zone for `piece`.
   */
  private computeDefaultSpawnLocalPosition(
    piece: Pick<TowerPieceEntity, 'cellsFromCoM' | 'scale'>
  ): { localX: number; localY: number } {
    const u = GAME_CONSTANTS.UNIT_PX
    const basePeakUnits = Math.max(0, ...this.currentBasePreset.elevations)
    const spawnHeightUnits =
      this.gameMode === 'PUZZLE'
        ? Math.max(
            GAME_CONSTANTS.PUZZLE_LASER_HEIGHT_UNITS + 6.5,
            this.towerHeight + 5.5
          )
        : Math.max(basePeakUnits, this.towerHeight) +
          GAME_CONSTANTS.SPAWN_OFFSET_UNITS
    const leftEdgeOffsetUnits = this.getCell0LeftEdgeOffsetUnits(piece, 0)
    const desiredLeftEdgeUnits = -1.0
    const spawnXUnits = desiredLeftEdgeUnits - leftEdgeOffsetUnits
    return {
      localX: spawnXUnits * u,
      localY: -spawnHeightUnits * u,
    }
  }

  /**
   * Stops the player's current falling piece, elevates it back up to the starting spawn point,
   * and schedules the piece-altering transformation (`GIANT_PIECE`, `SLICK_BRICK`, `TURBO_DROP`, `LOCK_ROTATE`)
   * with a dedicated pop/aura animation at the starting point.
   */
  private startPieceRecallTransform(powerId: PieceAlteringPowerId): boolean {
    // If the player is between pieces (SPAWNING / SETTLING / RESPAWN_DELAY), spawn the piece immediately so it transforms at the top!
    if (
      !this.activePiece &&
      (this.state === 'SPAWNING' ||
        this.state === 'SETTLING' ||
        this.state === 'RESPAWN_DELAY')
    ) {
      this.settlingTimerMs = 0
      this.respawnDelayRemainingMs = 0
      this.spawnNextPiece()
    }

    if (
      !this.activePiece ||
      this.state !== 'FALLING' ||
      this.activePiece.powerEffect === 'CASTLE_ROOF'
    ) {
      return false
    }

    // If an earlier recall animation was still lifting and hadn't applied its mutation yet, apply it now so nothing is lost
    if (this.pieceRecallAnim && !this.pieceRecallAnim.hasTransformed) {
      this.applyPieceRecallMutation(
        this.pieceRecallAnim.powerId,
        this.pieceRecallAnim.targetLocalX,
        this.pieceRecallAnim.targetLocalY
      )
    }

    // 1. Stop the active piece immediately
    this.pendingLandPiece = false
    this.bottomTouchTimerMs = 0
    this.hasBottomSupportThisTick = false
    this.isSoftDropping = false
    this.softDropTrail = []
    this.softDropTrailAccumMs = 0

    const body = this.activePiece.body
    Body.setVelocity(body, { x: 0, y: 0 })
    Body.setAngularVelocity(body, 0)
    this.setPieceBodySensor(body, true)

    const startLocalX = body.position.x - this.offsetX
    const startLocalY = body.position.y
    const startAngle = body.angle
    const spawnPos = this.computeDefaultSpawnLocalPosition(this.activePiece)

    const stopColor =
      powerId === 'GIANT_PIECE'
        ? '#EF4444'
        : powerId === 'SLICK_BRICK'
          ? '#38BDF8'
          : powerId === 'TURBO_DROP'
            ? '#F97316'
            : '#A855F7'

    // Visual burst where the piece stopped in mid-air
    this.spawnColoredBurst(startLocalX, startLocalY, stopColor, 14)
    this.impactParticles.push({
      x: startLocalX,
      y: startLocalY,
      vx: 0,
      vy: 0,
      radius: 10,
      ageMs: 0,
      maxAgeMs: 280,
      kind: 'ring',
    })

    this.pieceRecallAnim = {
      powerId,
      startLocalX,
      startLocalY,
      startAngle,
      targetLocalX: spawnPos.localX,
      targetLocalY: spawnPos.localY,
      targetAngle: 0,
      elapsedMs: 0,
      liftDurationMs: 340,
      totalDurationMs: 640,
      hasTransformed: false,
    }

    this.emitSnapshotNow()
    return true
  }

  /**
   * Applies the actual piece transformation (`GIANT_PIECE`, `SLICK_BRICK`, `TURBO_DROP`, `LOCK_ROTATE`)
   * once the piece arrives back at the starting point `(targetLocalX, targetLocalY)`.
   */
  private applyPieceRecallMutation(
    powerId: PieceAlteringPowerId,
    targetLocalX: number,
    targetLocalY: number
  ): void {
    if (!this.activePiece) return
    const u = GAME_CONSTANTS.UNIT_PX

    let burstColor = '#FACC15'

    if (powerId === 'GIANT_PIECE') {
      burstColor = '#EF4444'
      const oldPiece = this.activePiece
      const spawnHeightUnits = Math.max(2.5, -targetLocalY / u)
      World.remove(this.engine.world, oldPiece.body)

      const giantEntity = this.createPieceEntity(
        {
          type: oldPiece.type,
          variant: 'GIANT',
          powerEffect: oldPiece.powerEffect,
          colorPaletteIndex: oldPiece.colorPaletteIndex,
        },
        spawnHeightUnits
      )
      const giantSpawnPos = this.computeDefaultSpawnLocalPosition(giantEntity)
      this.setBodyPositionClean(
        giantEntity.body,
        this.offsetX + giantSpawnPos.localX,
        targetLocalY
      )
      Body.setAngle(giantEntity.body, 0)
      Body.setInertia(giantEntity.body, Infinity)
      Body.setVelocity(giantEntity.body, { x: 0, y: 0 })
      Body.setAngularVelocity(giantEntity.body, 0)
      this.setPieceBodySensor(giantEntity.body, true)
      World.add(this.engine.world, giantEntity.body)
      this.activePiece = giantEntity
      if (this.pieceRecallAnim) {
        this.pieceRecallAnim.targetLocalX = giantSpawnPos.localX
      }
    } else if (powerId === 'SLICK_BRICK') {
      burstColor = '#38BDF8'
      this.activePiece.powerEffect = 'SLICK_BRICK'
      this.applyPieceFriction(
        this.activePiece,
        GAME_CONSTANTS.SLICK_BRICK_FRICTION,
        false
      )
    } else if (powerId === 'TURBO_DROP') {
      burstColor = '#F97316'
      this.activePiece.powerEffect = 'TURBO_DROP'
    } else if (powerId === 'LOCK_ROTATE') {
      burstColor = '#A855F7'
      this.activePiece.powerEffect = 'LOCK_ROTATE'
    }

    const fxX = this.activePiece.body.position.x - this.offsetX
    const fxY = this.activePiece.body.position.y
    this.spawnMagicSmokePoof(fxX, fxY)
    this.spawnColoredBurst(fxX, fxY, burstColor, 20)
    this.playPieceTransformSound(powerId)
  }

  /**
   * Synthesizes a rising whoosh + transformation chime when a piece is recalled to the top and transformed.
   */
  private playPieceTransformSound(powerId: PieceAlteringPowerId): void {
    try {
      const AudioContextClass =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext })
          .webkitAudioContext
      if (!AudioContextClass) return
      if (!this.audioCtx) {
        this.audioCtx = new AudioContextClass()
      }
      if (this.audioCtx.state === 'suspended') {
        this.audioCtx.resume()
      }
      const ctx = this.audioCtx
      const now = ctx.currentTime

      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      osc.type = powerId === 'GIANT_PIECE' ? 'sawtooth' : 'triangle'
      const startFreq =
        powerId === 'GIANT_PIECE'
          ? 240
          : powerId === 'SLICK_BRICK'
            ? 520
            : 360
      const endFreq =
        powerId === 'GIANT_PIECE'
          ? 150
          : powerId === 'SLICK_BRICK'
            ? 880
            : 680
      osc.frequency.setValueAtTime(startFreq, now)
      osc.frequency.exponentialRampToValueAtTime(endFreq, now + 0.18)
      gain.gain.setValueAtTime(0.24, now)
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.22)
      osc.connect(gain)
      gain.connect(ctx.destination)
      osc.start(now)
      osc.stop(now + 0.23)
    } catch {
      // Ignore audio errors
    }
  }

  private spawnColoredBurst(
    localX: number,
    localY: number,
    color: string,
    count: number
  ): void {
    for (let i = 0; i < count; i++) {
      const ang = (Math.PI * 2 * i) / count + (Math.random() - 0.5) * 0.3
      const speed = 1.2 + Math.random() * 2.4
      this.impactParticles.push({
        x: localX,
        y: localY,
        vx: Math.cos(ang) * speed,
        vy: Math.sin(ang) * speed - 0.5,
        radius: 3.5 + Math.random() * 2.5,
        ageMs: 0,
        maxAgeMs: 360 + Math.random() * 180,
        kind: 'spark',
        color,
      })
    }
  }

  /**
   * Spawns a "fumaça mágica/plástico" puff animation when holding or restoring `heldActivePiece`
   * during the Finish Line Climax (`GOAL_COUNTDOWN` / `COUNTDOWN_ABORTED`).
   */
  private spawnMagicSmokePoof(localX: number, localY: number): void {
    this.impactParticles.push({
      x: localX,
      y: localY,
      vx: 0,
      vy: 0,
      radius: 8,
      ageMs: 0,
      maxAgeMs: 320,
      kind: 'ring',
    })
    for (let i = 0; i < 14; i++) {
      const ang = (Math.PI * 2 * i) / 14 + (Math.random() - 0.5) * 0.35
      const speed = 0.8 + Math.random() * 2.1
      this.impactParticles.push({
        x: localX + (Math.random() - 0.5) * 18,
        y: localY + (Math.random() - 0.5) * 18,
        vx: Math.cos(ang) * speed,
        vy: Math.sin(ang) * speed - 0.3,
        radius: 6 + Math.random() * 5,
        ageMs: 0,
        maxAgeMs: 380 + Math.random() * 160,
        kind: 'smoke',
      })
    }
    this.spawnColoredBurst(localX, localY, '#FACC15', 10)
  }

  /**
   * Spawns colorful toy-brick confetti pieces when the Castle Roof lands and welds to the tower!
   */
  private spawnVictoryConfetti(
    localX: number,
    localY: number,
    count: number = 42
  ): void {
    const palette = [
      { fill: '#EF4444', border: '#7F1D1D' },
      { fill: '#FACC15', border: '#713F12' },
      { fill: '#22C55E', border: '#14532D' },
      { fill: '#38BDF8', border: '#0C4A6E' },
      { fill: '#A855F7', border: '#4C1D95' },
      { fill: '#F97316', border: '#7C2D12' },
    ]
    for (let i = 0; i < count; i++) {
      const theme = palette[i % palette.length]
      const angle = -Math.PI * 0.15 - Math.random() * Math.PI * 0.7
      const speed = 2.2 + Math.random() * 5.2
      this.confettiParticles.push({
        x: localX + (Math.random() - 0.5) * 44,
        y: localY + (Math.random() - 0.5) * 24,
        vx: Math.cos(angle) * speed + (Math.random() - 0.5) * 2.4,
        vy: Math.sin(angle) * speed - 1.4,
        w: 7 + Math.random() * 6,
        h: 5 + Math.random() * 4,
        angle: Math.random() * Math.PI * 2,
        vAng: (Math.random() - 0.5) * 0.24,
        color: theme.fill,
        border: theme.border,
        ageMs: 0,
        maxAgeMs: 1800 + Math.random() * 900,
      })
    }
  }

  /**
   * Builds the 3x3 Toy-Brick Castle Roof Victory Piece (`CASTLE_ROOF` for State C: `ROOF_DROP`).
   * - Dimensions: Base of 3 units wide by 3 units high (battlements at base + stepped roof + red flag on top).
   * - Collider: 3x2 compound collider with low Center of Mass (`comY = -0.4u`) so it sits solidly on top.
   * - Rotation control is locked (`powerEffect: 'CASTLE_ROOF'`).
   */
  private createCastleRoofEntity(
    spawnXUnits: number,
    spawnHeightUnits: number
  ): TowerPieceEntity {
    const u = GAME_CONSTANTS.UNIT_PX
    const cellPx = u

    // Physical collider cells (3x1 base row + 2x1 middle roof row -> centroid is at x=0, y=-0.4)
    const colliderCells: CellCoord[] = [
      { x: -1, y: 0 },
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: -0.5, y: -1 },
      { x: 0.5, y: -1 },
    ]
    const comUnitX = 0
    const comUnitY = -0.4

    // Visual cells include the top turret peak cell { x: 0, y: -2 } so bounding box is exact 3x3 units
    const allVisualCells: CellCoord[] = [
      ...colliderCells,
      { x: 0, y: -2 },
    ]
    const cellsFromCoM: CellCoord[] = allVisualCells.map((c) => ({
      x: c.x - comUnitX,
      y: c.y - comUnitY,
    }))

    const colliderW = cellPx - 2.4
    const colliderH = cellPx - 0.8
    const effFriction = GAME_CONSTANTS.SNAPPED_FRICTION

    const partBodies: Matter.Body[] = colliderCells.map((cell) =>
      Bodies.rectangle(cell.x * cellPx, cell.y * cellPx, colliderW, colliderH, {
        chamfer: { radius: 3.5 },
        friction: effFriction,
        frictionStatic: effFriction * 3.5,
        restitution: 0.0,
        slop: 0.01,
      })
    )

    const compound = Body.create({
      parts: [...partBodies],
      friction: effFriction,
      frictionStatic: effFriction * 3.5,
      frictionAir: 0.02,
      restitution: 0.0,
      slop: 0.01,
      sleepThreshold: 24,
      label: `castle_roof_${this.nextEntityId}`,
    })

    Body.setMass(compound, 4.0)
    const baseInertia = compound.inertia
    const realInertia = baseInertia * 2.0

    const snappedSpawnXUnits = Math.round(spawnXUnits * 2) / 2
    Body.setPosition(compound, {
      x: this.offsetX + snappedSpawnXUnits * u,
      y: -spawnHeightUnits * u,
    })
    Body.setInertia(compound, Infinity)
    Body.setAngle(compound, 0)

    return {
      id: this.nextEntityId++,
      type: 'T',
      variant: 'NORMAL',
      powerEffect: 'CASTLE_ROOF',
      colorPaletteIndex: 0,
      scale: 1,
      body: compound,
      baseInertia,
      realInertia,
      cellsFromCoM,
      snapped: true,
      isSettled: false,
      settledAtMs: 0,
    }
  }

  /**
   * Positive Power 4 (`SIDE_ISLAND` — "Ilha Auxiliar / Suporte Flutuante"):
   * - Limit of 1 Active Side Island per Player:
   *   - Option A: Sets `this.hasSpawnedSideIsland = true` so subsequent Checkpoints (16m, 24m) remove `SIDE_ISLAND`
   *     from the roulette and roll only among Super Cola, Bloco de Ferro, and Removedor.
   *   - Option B (Repositioning / Replacement): If the player already has a Side Island below and triggers the power again,
   *     the old island disintegrates (if no tower blocks are resting on it) and repositions higher up; if blocks are already
   *     resting on the existing island, the extra spawn is blocked.
   */
  public activateSideIslandPower(): void {
    // Regra de Limite de 1 Ilha Auxiliar Ativa por Jogador (Opção A + Opção B)
    if (this.islands.length > 0) {
      const existingIsland = this.islands[0]
      if (this.isIslandSupportingAnyBlock(existingIsland)) {
        this.onEventBanner?.(
          '⚠️ Limite de 1 Ilha Flutuante atingido! A ilha atual já sustenta blocos da torre.',
          'warning'
        )
        return
      }
      // Opção B — Reposicionamento: desintegra a ilha antiga vazia antes de invocar a nova mais no alto
      const oldLocalX = this.toPixels(existingIsland.x)
      const oldLocalY = -this.toPixels(existingIsland.y)
      this.spawnMagicSmokePoof(oldLocalX, oldLocalY)
      this.spawnColoredBurst(oldLocalX, oldLocalY, '#38BDF8', 10)
      World.remove(this.engine.world, existingIsland.body)
      this.islands = []
    }

    // Marca que o jogador já invocou sua Ilha Lateral nesta partida (remove da roleta dos próximos Checkpoints)
    this.hasSpawnedSideIsland = true

    // 1. Descobre a altura do bloco mais alto estacionado na torre (em unidades acima da base)
    const highestY = this.getHighestSettledBlockY()

    // 2. Define a altura da superfície superior da ilha:
    // Se já houver torre (highestY >= 2.0), posiciona `ISLAND_OFFSET_Y` (1.0 bloco) abaixo do topo
    // para permitir pontes imediatas ("I"/"L") ou escorar inclinações; se a torre estiver baixa, nasce em +1.5m..2.5m.
    const rawTargetY =
      highestY >= 2.0
        ? Math.max(1.5, highestY - this.ISLAND_OFFSET_Y)
        : Math.max(1.5, highestY + this.ISLAND_OFFSET_Y)
    const targetY = Math.round(rawTargetY * 2) / 2

    // 3. Escolhe o lado (Esquerda ou Direita) priorizando o lado para onde o Centro de Massa da torre estiver pendendo!
    const side: 'LEFT' | 'RIGHT' = this.chooseBestIslandSide(targetY)
    const direction = side === 'LEFT' ? -1 : 1

    // 4. Calcula o X central da ilha:
    // Metade da base (4.0) + Vão (1.0) + Metade da Ilha (1.25) = ±6.25 unidades do centro
    const targetX =
      direction * (this.BASE_WIDTH / 2 + this.ISLAND_GAP_X + this.ISLAND_WIDTH / 2)

    // 5. Cria o corpo físico estático no Matter.js:
    // Começa como `isSensor: true` durante os primeiros 0.2s (200ms) enquanto escala de 0% a 100%
    // e empurra suavemente qualquer bloco dinâmico para fora antes de ativar o colisor rígido!
    const islandBody = Bodies.rectangle(
      this.offsetX + this.toPixels(targetX),
      this.toPixelsY(targetY),
      this.toPixels(this.ISLAND_WIDTH),
      this.toPixels(this.ISLAND_HEIGHT),
      {
        isStatic: true,
        isSensor: true,
        friction: GAME_CONSTANTS.ISLAND_FRICTION,
        frictionStatic: 3.6,
        restitution: 0.0,
        slop: 0.005,
        label: 'SIDE_ISLAND',
      }
    )

    World.add(this.engine.world, islandBody)

    const island: FloatingIsland = {
      id: `island_${this.nextEntityId++}`,
      side,
      x: targetX,
      y: targetY,
      width: this.ISLAND_WIDTH,
      height: this.ISLAND_HEIGHT,
      body: islandBody,
      spawnAgeMs: 0,
      spawnDurationMs: 200,
    }

    this.islands = [island]
    this.pushDynamicBodiesClearOfIsland(island)

    const localX = this.toPixels(targetX)
    const localTopY = -this.toPixels(targetY)
    this.spawnMagicSmokePoof(localX, localTopY)
    this.spawnColoredBurst(localX, localTopY, '#22C55E', 14)

    const sideLabel =
      side === 'LEFT'
        ? `ESQUERDA (${targetX.toFixed(2)}u)`
        : `DIREITA (+${targetX.toFixed(2)}u)`
    this.onEventBanner?.(
      `🏝️ Ilha Flutuante Lateral (2.5×1.5) invocada na ${sideLabel} a ${targetY.toFixed(1)}m!`,
      'success'
    )
  }

  /**
   * Positive Power 5 (`EXTRA_LIFE` — "Vida Extra / Balão Flutuante"):
   * Not free! Spawns a floating Heart Balloon ("balão de vida extra") that drifts upward
   * and sideways as it goes away. To actually earn `+1 ❤️ Vida Extra`, the player must
   * touch/catch the balloon using the piece they are currently controlling (`this.activePiece`)!
   */
  public activateExtraLifeBalloonPower(): void {
    const u = GAME_CONSTANTS.UNIT_PX
    const topHeightUnits = Math.max(1.5, this.towerHeight)

    let sideDir: -1 | 1 = this.randomizer.nextFloat() < 0.5 ? -1 : 1
    let spawnY = -(topHeightUnits + 3.4) * u

    if (this.activePiece) {
      const pieceLocalX = this.activePiece.body.position.x - this.offsetX
      const pieceLocalY = this.activePiece.body.position.y
      if (pieceLocalX > 0.6 * u) {
        sideDir = -1
      } else if (pieceLocalX < -0.6 * u) {
        sideDir = 1
      }
      const minY = -(topHeightUnits + 6.4) * u
      const maxY = -(topHeightUnits + 2.2) * u
      spawnY = Math.max(minY, Math.min(maxY, pieceLocalY + 2.4 * u))
    }

    const spawnX =
      sideDir * (2.8 + this.randomizer.nextFloat() * 1.15) * u

    this.extraLifeBalloons.push({
      id: this.nextEntityId++,
      x: spawnX,
      y: spawnY,
      vx: sideDir * 9.5,
      vy: -21,
      swayPhase: this.randomizer.nextFloat() * Math.PI * 2,
      ageMs: 0,
      maxAgeMs: 9200,
    })

    this.spawnMagicSmokePoof(spawnX, spawnY)
    this.spawnColoredBurst(spawnX, spawnY, '#F43F5E', 16)
    this.spawnColoredBurst(spawnX, spawnY, '#FEF08A', 10)
    this.playBalloonReleaseSound()

    this.onEventBanner?.(
      '🎈 Balão de Vida Extra solto! Encoste nele com a peça que está controlando antes que vá embora!',
      'info'
    )
  }

  /**
   * Checks whether any cell of the player's currently controlled piece (`this.activePiece`)
   * touches an active Extra Life Balloon (`this.extraLifeBalloons`).
   * If touched, pops the balloon with confetti and grants `+1 ❤️ Vida Extra`!
   */
  private checkExtraLifeBalloonCatch(): void {
    if (
      this.extraLifeBalloons.length === 0 ||
      !this.activePiece ||
      (this.state !== 'FALLING' && this.state !== 'ROOF_DROP')
    ) {
      return
    }

    const u = GAME_CONSTANTS.UNIT_PX
    const piece = this.activePiece
    const body = piece.body
    const pieceLocalX = body.position.x - this.offsetX
    const pieceLocalY = body.position.y
    const cos = Math.cos(body.angle)
    const sin = Math.sin(body.angle)
    const cellPx = u * piece.scale
    const cellHitRadius = cellPx * 0.56

    for (let i = this.extraLifeBalloons.length - 1; i >= 0; i--) {
      const balloon = this.extraLifeBalloons[i]
      let caught = false

      for (const c of piece.cellsFromCoM) {
        const rx = (c.x * cos - c.y * sin) * cellPx
        const ry = (c.x * sin + c.y * cos) * cellPx
        const cx = pieceLocalX + rx
        const cy = pieceLocalY + ry

        const distCrown = Math.hypot(cx - balloon.x, cy - balloon.y)
        const distCharm = Math.hypot(cx - balloon.x, cy - (balloon.y + 22))
        if (
          distCrown <= cellHitRadius + 26 ||
          distCharm <= cellHitRadius + 20
        ) {
          caught = true
          break
        }
      }

      if (caught) {
        this.extraLifeBalloons.splice(i, 1)
        this.lives = Math.min(this.maxLives, this.lives + 1)

        this.spawnVictoryConfetti(balloon.x, balloon.y, 26)
        this.spawnColoredBurst(balloon.x, balloon.y, '#F43F5E', 18)
        this.spawnColoredBurst(balloon.x, balloon.y, '#FACC15', 14)
        this.playExtraLifeCaughtSound()

        const calloutX = Math.max(-5.5 * u, Math.min(5.5 * u, balloon.x))
        this.fallFeedbackCallouts.push({
          x: calloutX,
          y: balloon.y,
          startY: balloon.y,
          title: '🎈❤️ +1 VIDA EXTRA!',
          subtitle: `AGORA COM ${this.lives} ❤️`,
          tone: 'EXTRA_LIFE_CAUGHT',
          ageMs: 0,
          maxAgeMs: 1750,
        })

        this.onLifeLost?.()
        const heartsDisplay =
          '❤️'.repeat(this.lives) +
          '🖤'.repeat(Math.max(0, this.maxLives - this.lives))
        this.onEventBanner?.(
          `🎈❤️ VIDA EXTRA CAPTURADA! Você pegou o balão com a peça controlada! (${heartsDisplay})`,
          'success'
        )
        this.emitSnapshotNow()
      }
    }
  }

  private playBalloonReleaseSound(): void {
    try {
      const AudioContextClass =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext })
          .webkitAudioContext
      if (!AudioContextClass) return
      if (!this.audioCtx) {
        this.audioCtx = new AudioContextClass()
      }
      if (this.audioCtx.state === 'suspended') {
        this.audioCtx.resume()
      }
      const ctx = this.audioCtx
      const now = ctx.currentTime
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      osc.type = 'sine'
      osc.frequency.setValueAtTime(340, now)
      osc.frequency.exponentialRampToValueAtTime(680, now + 0.22)
      gain.gain.setValueAtTime(0.22, now)
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.25)
      osc.connect(gain)
      gain.connect(ctx.destination)
      osc.start(now)
      osc.stop(now + 0.26)
    } catch {
      // Ignore audio errors
    }
  }

  private playExtraLifeCaughtSound(): void {
    try {
      const AudioContextClass =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext })
          .webkitAudioContext
      if (!AudioContextClass) return
      if (!this.audioCtx) {
        this.audioCtx = new AudioContextClass()
      }
      if (this.audioCtx.state === 'suspended') {
        this.audioCtx.resume()
      }
      const ctx = this.audioCtx
      const now = ctx.currentTime
      const notes = [587.33, 783.99, 987.77, 1174.66] // D5, G5, B5, D6
      notes.forEach((freq, idx) => {
        const osc = ctx.createOscillator()
        const gain = ctx.createGain()
        osc.type = 'triangle'
        const t0 = now + idx * 0.065
        osc.frequency.setValueAtTime(freq, t0)
        gain.gain.setValueAtTime(0.24, t0)
        gain.gain.exponentialRampToValueAtTime(0.001, t0 + 0.34)
        osc.connect(gain)
        gain.connect(ctx.destination)
        osc.start(t0)
        osc.stop(t0 + 0.35)
      })
    } catch {
      // Ignore audio errors
    }
  }

  /**
   * Checks whether any settled piece in the tower is resting on or welded to `island`.
   */
  private isIslandSupportingAnyBlock(island: FloatingIsland): boolean {
    const ib = island.body.bounds
    for (const link of this.glueWeldLinks) {
      if (link.bodyA === island.body || link.bodyB === island.body) {
        return true
      }
    }
    for (const p of this.settledPieces) {
      const b = p.body.bounds
      const overlapX = Math.min(b.max.x, ib.max.x) - Math.max(b.min.x, ib.min.x)
      const verticalGap = Math.abs(b.max.y - ib.min.y)
      if (overlapX > 3.0 && (verticalGap <= 6.0 || (b.max.y >= ib.min.y - 4 && b.min.y <= ib.max.y))) {
        return true
      }
    }
    return false
  }

  private getHighestSettledBlockY(): number {
    this.updateSettledBlocksAndHeight()
    return this.towerHeight
  }

  private toPixels(units: number): number {
    return units * GAME_CONSTANTS.UNIT_PX
  }

  /**
   * Converts the island's top surface height (`topUnits` above the base plate)
   * into the Matter.js center Y coordinate in pixels (`-(topUnits - ISLAND_HEIGHT / 2) * UNIT_PX`).
   */
  private toPixelsY(topUnits: number): number {
    return -(topUnits - this.ISLAND_HEIGHT / 2) * GAME_CONSTANTS.UNIT_PX
  }

  /**
   * Smart Side Selection (`LEFT` vs `RIGHT`) for `SIDE_ISLAND`:
   * 1. Avoids spawning on a side that already has an island within `< 3.0` units of `targetY`.
   * 2. Intelligent Auto-Brace: Calculates the total Center of Mass X of the tower; if the tower is leaning
   *    to one side, spawns the island on that side to act as an outrigger support step!
   * 3. Manual / Fallback: Uses the side where the player's active piece is positioned, or 50/50 seeded roll.
   */
  private chooseBestIslandSide(targetY: number): 'LEFT' | 'RIGHT' {
    const leftBlocked = this.islands.some(
      (i) => i.side === 'LEFT' && Math.abs(i.y - targetY) < 3.0
    )
    const rightBlocked = this.islands.some(
      (i) => i.side === 'RIGHT' && Math.abs(i.y - targetY) < 3.0
    )

    if (leftBlocked && !rightBlocked) return 'RIGHT'
    if (rightBlocked && !leftBlocked) return 'LEFT'

    // Modo Automático Inteligente: calcula o Centro de Massa horizontal da torre
    if (this.settledPieces.length > 0) {
      const u = GAME_CONSTANTS.UNIT_PX
      let weightedX = 0
      let totalWeight = 0
      for (const p of this.settledPieces) {
        const bxUnits = (p.body.position.x - this.offsetX) / u
        const byUnits = Math.max(0.5, -p.body.position.y / u)
        // Upper blocks contribute more to tower tilt/overhang
        const w = p.body.mass * (1 + byUnits * 0.15)
        weightedX += bxUnits * w
        totalWeight += w
      }
      if (totalWeight > 0) {
        const comXUnits = weightedX / totalWeight
        if (comXUnits > 0.18) return 'RIGHT'
        if (comXUnits < -0.18) return 'LEFT'
      }
    }

    // Alternativa Manual: se a peça ativa do jogador já estiver deslocada para um lado, invoca daquele lado
    if (this.activePiece) {
      const activeXUnits =
        (this.activePiece.body.position.x - this.offsetX) /
        GAME_CONSTANTS.UNIT_PX
      if (activeXUnits > 0.35) return 'RIGHT'
      if (activeXUnits < -0.35) return 'LEFT'
    }

    return this.randomizer.nextFloat() < 0.5 ? 'LEFT' : 'RIGHT'
  }

  /**
   * Safe Spawn Push-Out (Rule 2.C):
   * During the 0.2s (200ms) scale-in sensor window, gently nudges any overlapping dynamic piece
   * upward/outward above the island's top surface so no block ever gets trapped inside the static collider.
   */
  private pushDynamicBodiesClearOfIsland(island: FloatingIsland): void {
    const ib = island.body.bounds
    const dynamicBodies: Matter.Body[] = [
      ...(this.activePiece ? [this.activePiece.body] : []),
      ...this.settledPieces
        .filter((p) => !p.body.isStatic)
        .map((p) => p.body),
    ]

    for (const b of dynamicBodies) {
      const overlapX =
        Math.min(b.bounds.max.x, ib.max.x) - Math.max(b.bounds.min.x, ib.min.x)
      const overlapY =
        Math.min(b.bounds.max.y, ib.max.y) - Math.max(b.bounds.min.y, ib.min.y)

      if (overlapX > 0.5 && overlapY > 0.5) {
        Matter.Sleeping.set(b, false)
        const liftDy = b.bounds.max.y - ib.min.y + 2.0
        this.setBodyPositionClean(b, b.position.x, b.position.y - liftDy)
        if (b.velocity.y > 0) {
          Body.setVelocity(b, { x: b.velocity.x, y: 0 })
        }
      }
    }
  }

  /**
   * Queues a specific piece at the front of the queue (useful for testing catalog pieces).
   */
  public enqueueTestPiece(spec: QueuedPieceSpec): void {
    this.randomizer.enqueueCustomPiece(spec)
    this.emitSnapshotNow()
  }

  /**
   * Enables or disables environmental wind (Developer Mode toggle).
   */
  public setWindEnabled(enabled: boolean): void {
    this.windEnabled = enabled
    if (!enabled) {
      this.windActive = false
      this.windForce = 0
    } else if (this.towerHeight >= GAME_CONSTANTS.WIND_START_HEIGHT_UNITS) {
      this.windActive = true
    }
    this.emitSnapshotNow()
  }

  /**
   * Sets the piece sliding regulator (`0` = Firme/Colado, `50` = Equilibrado/Padrão, `100` = Muito Escorregadio)
   * and immediately updates all settled pieces in the tower.
   */
  public setSlideLevel(level: number): void {
    this.slideLevel = Math.max(0, Math.min(100, Math.round(level)))
    const params = this.getSlidePhysicsParams()

    for (const piece of this.settledPieces) {
      if (piece.isStaticAnchor) continue
      piece.realInertia = piece.baseInertia * params.inertiaMult
      Body.setInertia(piece.body, piece.realInertia)
      this.evaluatePinSnapForPiece(piece)
    }
  }

  private getSlidePhysicsParams() {
    const grip = 1 - this.slideLevel / 100
    return {
      grip,
      frictionScale: 0.58 + 0.42 * grip,
      staticMultUnsnapped: 1.1 + 1.5 * grip,
      staticMultSnapped: 1.65 + 2.15 * grip,
      pinSnapAngleDeg: 3.0 + 6.0 * grip,
      pinSnapGridTol: 0.12 + 0.16 * grip,
      inertiaMult: 1.0 + 0.85 * grip,
      landingSnapTol: 0.22 * grip,
      landingVxRetain: 0.45 * (1 - grip),
      maxDampAngleDeg: 2.5 + 11.5 * grip,
      dampXSnapped: 1.0 - 0.55 * grip,
      dampXUnsnapped: 1.0 - 0.38 * grip,
      dampAngSnapped: 1.0 - 0.45 * grip,
      dampAngUnsnapped: 1.0 - 0.28 * grip,
    }
  }

  private getCell0LeftEdgeOffsetUnits(
    piece: Pick<TowerPieceEntity, 'cellsFromCoM' | 'scale'>,
    angleRad: number
  ): number {
    const cos = Math.cos(angleRad)
    const sin = Math.sin(angleRad)
    const c0 = piece.cellsFromCoM[0]
    const rotCenterOffsetUnits = (c0.x * cos - c0.y * sin) * piece.scale
    return rotCenterOffsetUnits - 0.5 * piece.scale
  }

  /**
   * 1. Trava a movimentação da peça que está na mão do jogador dentro de [-CONTROL_LIMIT_X, +CONTROL_LIMIT_X] (±6.5u).
   */
  public clampActivePieceX(targetX: number, pieceHalfWidth: number): number {
    const minX = -this.CONTROL_LIMIT_X + pieceHalfWidth
    const maxX = this.CONTROL_LIMIT_X - pieceHalfWidth
    return Math.max(minX, Math.min(maxX, targetX))
  }

  /**
   * Returns the horizontal cell bounds `[minOffsetUnits, maxOffsetUnits]` relative to `body.position.x`
   * when rotated by `angleRad`, so the piece's outer edges stay strictly within `±CONTROL_BOUND_X_UNITS` (±6.5u).
   */
  private getPieceHorizontalSpanUnits(
    piece: Pick<TowerPieceEntity, 'cellsFromCoM' | 'scale'>,
    angleRad: number
  ): { minOffsetUnits: number; maxOffsetUnits: number } {
    const cos = Math.cos(angleRad)
    const sin = Math.sin(angleRad)
    const halfCell = 0.5 * piece.scale
    let minOffsetUnits = Infinity
    let maxOffsetUnits = -Infinity
    for (const c of piece.cellsFromCoM) {
      const rx = (c.x * cos - c.y * sin) * piece.scale
      minOffsetUnits = Math.min(minOffsetUnits, rx - halfCell)
      maxOffsetUnits = Math.max(maxOffsetUnits, rx + halfCell)
    }
    return { minOffsetUnits, maxOffsetUnits }
  }

  /**
   * Builds a compound Matter.Body made of 4 square colliders welded together.
   */
  private createPieceEntity(
    spec: QueuedPieceSpec,
    spawnHeightUnits: number
  ): TowerPieceEntity {
    const def = PIECE_CATALOG[spec.type]
    const phys = getVariantPhysicsSpec(spec.variant)
    const slideParams = this.getSlidePhysicsParams()
    const u = GAME_CONSTANTS.UNIT_PX
    const cellPx = u * phys.scale
    const powerEffect = spec.powerEffect || 'NONE'

    const comUnitX =
      def.cells.reduce((sum, c) => sum + c.x, 0) / def.cells.length
    const comUnitY =
      def.cells.reduce((sum, c) => sum + c.y, 0) / def.cells.length

    const cellsFromCoM: CellCoord[] = def.cells.map((c) => ({
      x: c.x - comUnitX,
      y: c.y - comUnitY,
    }))

    // Rotation-symmetric outer clearance (1.0px on exposed outer faces, 0px on internal shared seams)
    // so rotating any piece by 90° ("em pé") preserves exact slot width, height, and smooth notch-free sides!
    const outerInset = 1.0
    const outerCornerRadius = 2.0

    const hasNeighborCell = (
      cell: CellCoord,
      dx: number,
      dy: number
    ): boolean =>
      def.cells.some(
        (other) =>
          Math.abs(other.x - (cell.x + dx)) < 0.05 &&
          Math.abs(other.y - (cell.y + dy)) < 0.05
      )

    const partBodies: Matter.Body[] = def.cells.map((cell) => {
      const hasLeft = hasNeighborCell(cell, -1, 0)
      const hasRight = hasNeighborCell(cell, 1, 0)
      const hasTop = hasNeighborCell(cell, 0, -1)
      const hasBottom = hasNeighborCell(cell, 0, 1)

      const insetLeft = hasLeft ? 0 : outerInset
      const insetRight = hasRight ? 0 : outerInset
      const insetTop = hasTop ? 0 : outerInset
      const insetBottom = hasBottom ? 0 : outerInset

      const partW = cellPx - insetLeft - insetRight
      const partH = cellPx - insetTop - insetBottom
      const partCenterX = cell.x * cellPx + (insetLeft - insetRight) * 0.5
      const partCenterY = cell.y * cellPx + (insetTop - insetBottom) * 0.5

      // Only chamfer true outer corners of the piece; internal seams stay 100% flush with zero notches
      const rTL = !hasTop && !hasLeft ? outerCornerRadius : 0
      const rTR = !hasTop && !hasRight ? outerCornerRadius : 0
      const rBR = !hasBottom && !hasRight ? outerCornerRadius : 0
      const rBL = !hasBottom && !hasLeft ? outerCornerRadius : 0
      const cornerRadii = [rTL, rTR, rBR, rBL]
      const hasAnyChamfer = cornerRadii.some((r) => r > 0)

      // Active falling pieces use 0 friction while in player control so sliding past tower walls never drags settled blocks
      const part = Bodies.rectangle(partCenterX, partCenterY, partW, partH, {
        chamfer: hasAnyChamfer
          ? { radius: cornerRadii as unknown as number }
          : undefined,
        friction: 0,
        frictionStatic: 0,
        restitution: 0.0,
        slop: 0.01,
      })
      Body.setMass(part, phys.cellMass)
      return part
    })

    const compound = Body.create({
      parts: [...partBodies],
      friction: 0,
      frictionStatic: 0,
      frictionAir: 0.018 + 0.008 * slideParams.grip,
      restitution: 0.0,
      slop: 0.01,
      sleepThreshold: 24,
      label: `piece_${spec.type}_${this.nextEntityId}`,
    })

    // Ensure compound center of mass matches the exact geometric 4-cell average `(comUnitX, comUnitY)`
    const targetComPxX = comUnitX * cellPx
    const targetComPxY = comUnitY * cellPx
    if (
      Math.abs(compound.position.x - targetComPxX) > 1e-4 ||
      Math.abs(compound.position.y - targetComPxY) > 1e-4
    ) {
      Body.setCentre(
        compound,
        {
          x: targetComPxX - compound.position.x,
          y: targetComPxY - compound.position.y,
        },
        true
      )
    }

    Body.setMass(compound, phys.totalMass)
    const baseInertia = compound.inertia
    const typeInertiaMult = spec.type === 'I' ? 1.45 : 1.0
    const realInertia = baseInertia * slideParams.inertiaMult * typeInertiaMult

    const tempPiece = { cellsFromCoM, scale: phys.scale }
    const leftEdgeOffsetUnits = this.getCell0LeftEdgeOffsetUnits(tempPiece, 0)
    const desiredLeftEdgeUnits = -1.0
    const spawnXUnits = desiredLeftEdgeUnits - leftEdgeOffsetUnits

    const worldX = this.offsetX + spawnXUnits * u
    const worldY = -spawnHeightUnits * u

    Body.setPosition(compound, { x: worldX, y: worldY })
    Body.setInertia(compound, Infinity)
    Body.setAngle(compound, 0)

    return {
      id: this.nextEntityId++,
      type: spec.type,
      variant: spec.variant,
      powerEffect,
      colorPaletteIndex: spec.colorPaletteIndex ?? 0,
      scale: phys.scale,
      body: compound,
      baseInertia,
      realInertia,
      cellsFromCoM,
      snapped: false,
      isSettled: false,
      settledAtMs: 0,
    }
  }

  /**
   * Spawns the next piece from the 7-Bag (applying any queued Positive or Negative Power Effects).
   */
  private spawnNextPiece(): void {
    if (
      this.gameMode === 'SURVIVAL' &&
      this.lives > 0 &&
      this.settledPieces.length >= GAME_CONSTANTS.SURVIVAL_GOAL_PIECES
    ) {
      this.triggerSurvivalVictory()
      return
    }
    if (this.gameMode === 'PUZZLE' && this.isPetrified) {
      return
    }

    const basePeakUnits = Math.max(0, ...this.currentBasePreset.elevations)
    const spawnHeightUnits =
      this.gameMode === 'PUZZLE'
        ? Math.max(
            GAME_CONSTANTS.PUZZLE_LASER_HEIGHT_UNITS + 6.5,
            this.towerHeight + 5.5
          )
        : this.gameMode === 'ENDLESS'
          ? Math.max(
              basePeakUnits,
              this.towerHeight,
              this.petrifyLineHeightUnits + 4
            ) + GAME_CONSTANTS.SPAWN_OFFSET_UNITS
          : Math.max(basePeakUnits, this.towerHeight) +
            GAME_CONSTANTS.SPAWN_OFFSET_UNITS

    const spec = this.randomizer.nextPiece()
    if (spec.variant === 'GIANT' && this.giantPieceRemaining > 0) {
      this.giantPieceRemaining--
    }
    if (this.pendingNextPiecePower !== 'NONE') {
      spec.powerEffect = this.pendingNextPiecePower
      this.pendingNextPiecePower = 'NONE'
    } else if (!spec.powerEffect || spec.powerEffect === 'NONE') {
      if (this.slickBrickRemaining > 0) {
        spec.powerEffect = 'SLICK_BRICK'
        this.slickBrickRemaining--
      } else if (this.lockRotateRemaining > 0) {
        spec.powerEffect = 'LOCK_ROTATE'
        this.lockRotateRemaining--
      } else if (this.turboDropRemaining > 0) {
        spec.powerEffect = 'TURBO_DROP'
        this.turboDropRemaining--
      }
    }

    const entity = this.createPieceEntity(spec, spawnHeightUnits)
    this.activePiece = entity
    this.bottomTouchTimerMs = 0
    this.hasBottomSupportThisTick = false
    this.softDropTrail = []
    this.softDropTrailAccumMs = 0
    World.add(this.engine.world, entity.body)
    this.state = 'FALLING'

    if (spec.variant !== 'NORMAL' && spec.label) {
      this.onEventBanner?.(spec.label, 'info')
    }
  }

  /**
   * Releases control of the active piece after contact, applies STATIC_BRICK, SUPER_GLUE,
   * or CASTLE_ROOF ("Auto-Weld" & Tower Static Lock), unlocks physical rotation, and evaluates Pin Snap friction.
   */
  private landActivePiece(): void {
    this.pendingLandPiece = false
    this.bottomTouchTimerMs = 0
    this.hasBottomSupportThisTick = false
    this.softDropTrail = []
    this.softDropTrailAccumMs = 0
    if (!this.activePiece) return

    const piece = this.activePiece
    const body = piece.body
    const slideParams = this.getSlidePhysicsParams()
    this.activePiece = null
    this.isSoftDropping = false

    piece.isSettled = true
    piece.settledAtMs = this.elapsedTimeMs

    this.clearBodyPositionImpulses(body)
    for (const settled of this.settledPieces) {
      this.clearBodyPositionImpulses(settled.body)
    }

    // State C: ROOF_DROP ("Auto-Weld" do Telhado de Castelo):
    // Welds the Castle Roof to the tower, bursts toy-brick confetti, locks the entire tower Static, and declares VICTORY!
    if (this.state === 'ROOF_DROP' || piece.powerEffect === 'CASTLE_ROOF') {
      this.landCastleRoofAndWin(piece)
      return
    }

    // Positive Power 2: STATIC_BRICK ("Bloco Base Cinza / Âncora Estática")
    // Freezes in mid-air as an indestructible Static body on the exact millisecond of contact!
    if (piece.powerEffect === 'STATIC_BRICK') {
      Body.setVelocity(body, { x: 0, y: 0 })
      Body.setAngularVelocity(body, 0)
      Body.setStatic(body, true)
      piece.isStaticAnchor = true
      piece.snapped = true
      this.spawnColoredBurst(
        body.position.x - this.offsetX,
        body.position.y,
        '#E2E8F0',
        14
      )
      this.settledPieces.push(piece)
      if (this.gameMode === 'ENDLESS') {
        this.endlessScore += 1
        this.consecutiveAbyssFalls = 0
      }
      this.updateSettledBlocksAndHeight()
      this.onPieceSettled?.(this.towerHeight, this.settledPieces.length)
      this.state = 'SETTLING'
      this.settlingTimerMs = 150
      return
    }

    // Resolve any vertical micro-penetration with supporting blocks below before unlocking rotational inertia
    // so tall vertical pieces ("I" em pé) never receive an off-center separation kick upon landing!
    this.resolveLandingVerticalPenetration(body)

    // Unlock rotation: restore compound moment of inertia
    Body.setInertia(body, piece.realInertia)
    ;(body as unknown as { anglePrev: number }).anglePrev = body.angle
    Body.setAngularVelocity(body, 0)

    if (piece.powerEffect === 'TURBO_DROP') {
      // Keep heavy downward impact momentum for Turbo Drop
      Body.setVelocity(body, {
        x: body.velocity.x * 0.6,
        y: Math.min(body.velocity.y, 1.4),
      })
    } else {
      const clampedVy = Math.max(0, Math.min(body.velocity.y, 0.25))
      const clampedVx =
        Math.max(-0.8, Math.min(0.8, body.velocity.x)) *
        slideParams.landingVxRetain
      Body.setVelocity(body, {
        x: clampedVx,
        y: clampedVy,
      })
    }

    // Positive Power 1: SUPER_GLUE ("Super Cola / Kragle / WeldJoint")
    // Creates rigid physical WeldJoint constraints with all directly touching blocks!
    if (piece.powerEffect === 'SUPER_GLUE') {
      this.applySuperGlueWelds(piece)
    }

    this.evaluatePinSnapForPiece(piece)

    this.settledPieces.push(piece)
    if (this.gameMode === 'ENDLESS') {
      this.endlessScore += 1
      this.consecutiveAbyssFalls = 0
    }
    this.updateSettledBlocksAndHeight()
    this.onPieceSettled?.(this.towerHeight, this.settledPieces.length)
    this.state = 'SETTLING'
    this.settlingTimerMs = 170
  }

  /**
   * Separates any vertical micro-penetration between a newly landed `body` and the blocks supporting it below,
   * and damps any spurious angular impulse on the supporting blocks so landing a vertical piece never kicks the tower.
   */
  private resolveLandingVerticalPenetration(body: Matter.Body): void {
    const candidates: Matter.Body[] = [
      this.baseBody,
      ...this.islands.filter((i) => !i.body.isSensor).map((i) => i.body),
      ...this.settledPieces.map((p) => p.body),
    ]
    const activeParts =
      body.parts.length > 1 ? body.parts.slice(1) : [body]

    let maxPenY = 0
    for (const other of candidates) {
      if (other === body) continue
      const otherParts =
        other.parts.length > 1 ? other.parts.slice(1) : [other]

      for (const partA of activeParts) {
        for (const partB of otherParts) {
          const overlapX =
            Math.min(partA.bounds.max.x, partB.bounds.max.x) -
            Math.max(partA.bounds.min.x, partB.bounds.min.x)
          if (overlapX <= 5.5) continue

          const dy = partB.position.y - partA.position.y
          if (dy < 7) continue

          const penY = partA.bounds.max.y - partB.bounds.min.y
          if (penY > 0.05 && penY <= 6.5) {
            if (penY > maxPenY) {
              maxPenY = penY
            }
            if (!other.isStatic && !other.isSleeping) {
              Body.setAngularVelocity(other, other.angularVelocity * 0.35)
              Body.setVelocity(other, {
                x: other.velocity.x * 0.5,
                y: Math.max(-0.1, Math.min(0.25, other.velocity.y)),
              })
            }
          }
        }
      }
    }

    if (maxPenY > 0.05) {
      this.setBodyPositionClean(body, body.position.x, body.position.y - maxPenY)
    }
  }

  /**
   * State C: `ROOF_DROP` ("Auto-Weld"):
   * When the Castle Roof touches any block of the tower, it automatically welds to that block,
   * bursts colorful toy-brick confetti, locks the entire tower as Static so it never collapses on the
   * victory screen, and transitions to `VICTORY`.
   */
  private landCastleRoofAndWin(roofPiece: TowerPieceEntity): void {
    const body = roofPiece.body
    Body.setVelocity(body, { x: 0, y: 0 })
    Body.setAngularVelocity(body, 0)
    Body.setAngle(body, 0)

    this.applySuperGlueWelds(roofPiece)
    roofPiece.snapped = true
    roofPiece.isGlued = true
    roofPiece.isStaticAnchor = true
    this.settledPieces.push(roofPiece)

    // Freeze the entire tower (and the Castle Roof) as Static so it can never collapse on the Victory screen!
    for (const p of this.settledPieces) {
      Body.setVelocity(p.body, { x: 0, y: 0 })
      Body.setAngularVelocity(p.body, 0)
      Body.setStatic(p.body, true)
      p.snapped = true
    }

    const lx = body.position.x - this.offsetX
    const ly = body.position.y
    this.spawnVictoryConfetti(lx, ly, 52)
    this.spawnColoredBurst(lx, ly, '#FACC15', 18)
    this.playVictoryFanfareSound()

    this.state = 'VICTORY'
    this.goalCountdownMs = null
    this.updateSettledBlocksAndHeight()
    this.emitSnapshotNow()
    this.onVictory?.(this.elapsedTimeMs, this.towerHeight)
    this.onEventBanner?.(
      `🏰 VITÓRIA! Telhado de Castelo soldado no topo em ${(this.elapsedTimeMs / 1000).toFixed(2)}s!`,
      'success'
    )
  }

  /**
   * Converts a world-space point `(wx, wy)` into `body`'s unrotated local frame.
   */
  private worldToBodyLocal(
    body: Matter.Body,
    wx: number,
    wy: number
  ): { x: number; y: number } {
    const dx = wx - body.position.x
    const dy = wy - body.position.y
    const cos = Math.cos(-body.angle)
    const sin = Math.sin(-body.angle)
    return {
      x: dx * cos - dy * sin,
      y: dx * sin + dy * cos,
    }
  }

  /**
   * Converts a local point `(lx, ly)` in `body`'s unrotated frame back into arena local-world coordinates (with `-this.offsetX`).
   */
  private bodyLocalToArenaWorld(
    body: Matter.Body,
    lx: number,
    ly: number
  ): { x: number; y: number } {
    const cos = Math.cos(body.angle)
    const sin = Math.sin(body.angle)
    return {
      x: body.position.x - this.offsetX + (lx * cos - ly * sin),
      y: body.position.y + (lx * sin + ly * cos),
    }
  }

  /**
   * Creates velocity-neutral rigid welds (`GlueWeldLink`) between `piece`
   * and every tower block (or base plate) it is touching upon landing, plus organic spreading
   * Glue Vine Tendrils ("vinhas de cola") that crawl from `piece` across the seam onto every piece it glued to!
   */
  private applySuperGlueWelds(piece: TowerPieceEntity): void {
    const bodyA = piece.body
    Body.setVelocity(bodyA, { x: 0, y: 0 })
    Body.setAngularVelocity(bodyA, 0)
    this.clearBodyPositionImpulses(bodyA)

    const candidates: Matter.Body[] = [
      this.baseBody,
      ...this.islands.map((isl) => isl.body),
      ...this.settledPieces.map((p) => p.body),
    ]
    let weldedCount = 0
    let seedCounter = this.glueVines.length + 1

    for (const bodyB of candidates) {
      if (bodyB === bodyA) continue
      const touchingPairs: Array<{
        partA: Matter.Body
        partB: Matter.Body
        contactX: number
        contactY: number
        overlapX: number
        overlapY: number
      }> = []

      const partsA = bodyA.parts.length > 1 ? bodyA.parts.slice(1) : [bodyA]
      const partsB = bodyB.parts.length > 1 ? bodyB.parts.slice(1) : [bodyB]

      for (const partA of partsA) {
        for (const partB of partsB) {
          const gapX =
            Math.max(partA.bounds.min.x, partB.bounds.min.x) -
            Math.min(partA.bounds.max.x, partB.bounds.max.x)
          const gapY =
            Math.max(partA.bounds.min.y, partB.bounds.min.y) -
            Math.min(partA.bounds.max.y, partB.bounds.max.y)
          if (gapX <= 5.5 && gapY <= 5.5) {
            touchingPairs.push({
              partA,
              partB,
              contactX: (partA.position.x + partB.position.x) * 0.5,
              contactY: (partA.position.y + partB.position.y) * 0.5,
              overlapX: Math.max(0, -gapX),
              overlapY: Math.max(0, -gapY),
            })
          }
        }
      }

      if (touchingPairs.length > 0) {
        weldedCount++
        const primary = touchingPairs[0]
        const contactX = primary.contactX
        const contactY = primary.contactY

        // Resolve any impact penetration on landing before recording the weld offset
        let maxPenY = 0
        for (const tp of touchingPairs) {
          if (tp.overlapY > 0 && tp.overlapY < tp.overlapX && tp.overlapY <= 6) {
            maxPenY = Math.max(maxPenY, tp.overlapY)
          }
        }
        if (maxPenY > 0.15 && bodyA.position.y <= bodyB.position.y) {
          Body.setPosition(bodyA, {
            x: bodyA.position.x,
            y: bodyA.position.y - maxPenY,
          })
        }

        if (!bodyB.isStatic) {
          Body.setVelocity(bodyB, { x: 0, y: 0 })
          Body.setAngularVelocity(bodyB, 0)
          this.clearBodyPositionImpulses(bodyB)
        }

        // Mark the neighbor piece as glued too so it gets dripping glue puddles on its exposed top edge!
        const neighborPiece = this.settledPieces.find((p) => p.body === bodyB)
        if (neighborPiece) {
          neighborPiece.isGlued = true
          neighborPiece.snapped = true
        }

        // Register a velocity-neutral Rigid Weld Link (replaces Matter.Constraint so parts/angles never desync or spin!)
        this.glueWeldLinks.push({
          bodyA,
          bodyB,
          localOffsetFromB: this.worldToBodyLocal(
            bodyB,
            bodyA.position.x,
            bodyA.position.y
          ),
          relativeAngle: bodyA.angle - bodyB.angle,
          warmupTicks: bodyB.isStatic ? 0 : 2,
        })

        // Generate spreading Glue Vine Tendrils ("vinhas de cola") bridging bodyA -> bodyB across the touching cells!
        const selectedPairs = touchingPairs.slice(0, 3)
        let pairIdx = 0
        for (const pair of selectedPairs) {
          const ax = pair.partA.position.x
          const ay = pair.partA.position.y
          // Clamp bx if bodyB is the modular base plate or a 2.5x1.5 Side Island so the vine stays directly below partA
          const bx =
            bodyB === this.baseBody || bodyB.label === 'SIDE_ISLAND'
              ? Math.max(
                  pair.partB.bounds.min.x + 10,
                  Math.min(pair.partB.bounds.max.x - 10, ax + (pairIdx % 2 === 0 ? 8 : -8))
                )
              : pair.partB.position.x
          const by = pair.partB.position.y

          const dx = bx - ax
          const dy = by - ay
          const dist = Math.hypot(dx, dy) || 1
          const nx = -dy / dist
          const ny = dx / dist

          // If only 1 cell pair touched between bodyA and bodyB, spawn 2 slightly splayed glue vines across the seam
          // so every glued piece gets a rich, unmistakable vine cluster like in the reference image!
          const subVineOffsets =
            selectedPairs.length === 1 ? [-6.5, 6.5] : [pairIdx % 2 === 0 ? -3.5 : 3.5]

          for (let sIdx = 0; sIdx < subVineOffsets.length; sIdx++) {
            const latOffset = subVineOffsets[sIdx]
            const sign = (seedCounter + sIdx) % 2 === 0 ? 1 : -1
            const startWorldX = ax + nx * latOffset * 0.7 - (dx / dist) * 3
            const startWorldY = ay + ny * latOffset * 0.7 - (dy / dist) * 3
            const endWorldX = bx + nx * (latOffset * 1.15) + (dx / dist) * 4
            const endWorldY = by + ny * (latOffset * 1.15) + (dy / dist) * 4

            this.glueVines.push({
              bodyA,
              bodyB,
              localA: this.worldToBodyLocal(bodyA, startWorldX, startWorldY),
              localB: this.worldToBodyLocal(bodyB, endWorldX, endWorldY),
              waveAmp1: sign * (9.5 + (seedCounter % 3) * 2.2),
              waveAmp2: -sign * (8.5 + ((seedCounter + 1) % 3) * 2.0),
              beadCount: 4,
              seed: seedCounter++,
              scale: Math.min(1.25, Math.max(0.95, piece.scale * 0.95)),
              ageMs: 0,
              delayMs: pairIdx * 55 + sIdx * 70,
              growDurationMs: 380,
            })
          }

          // Secondary branching vine that crawls further onto an adjacent cell of `bodyB` (the glued neighbor block!)
          if (partsB.length > 1 && pairIdx === 0) {
            const extraPartB = partsB.find(
              (other) =>
                other !== pair.partB &&
                Math.hypot(
                  other.position.x - pair.partB.position.x,
                  other.position.y - pair.partB.position.y
                ) <=
                  GAME_CONSTANTS.UNIT_PX * 1.6
            )
            if (extraPartB) {
              const sign = seedCounter % 2 === 0 ? 1 : -1
              this.glueVines.push({
                bodyA: bodyB,
                bodyB,
                localA: this.worldToBodyLocal(
                  bodyB,
                  pair.partB.position.x,
                  pair.partB.position.y
                ),
                localB: this.worldToBodyLocal(
                  bodyB,
                  extraPartB.position.x,
                  extraPartB.position.y
                ),
                waveAmp1: sign * 9.0,
                waveAmp2: -sign * 8.0,
                beadCount: 3,
                seed: seedCounter++,
                scale: 0.92,
                ageMs: 0,
                delayMs: 140,
                growDurationMs: 360,
              })
            }
          }

          pairIdx++
        }

        this.spawnColoredBurst(
          contactX - this.offsetX,
          contactY,
          '#E0F2FE',
          10
        )
      }
    }

    if (weldedCount > 0) {
      piece.isGlued = true
      piece.snapped = true
    }
  }

  private clearBodyPositionImpulses(body: Matter.Body): void {
    type BodyWithImpulse = Matter.Body & {
      positionImpulse?: { x: number; y: number }
    }
    const root = body as BodyWithImpulse
    if (root.positionImpulse) {
      root.positionImpulse.x = 0
      root.positionImpulse.y = 0
    }
    for (const part of body.parts) {
      const p = part as BodyWithImpulse
      if (p.positionImpulse) {
        p.positionImpulse.x = 0
        p.positionImpulse.y = 0
      }
    }
  }

  /**
   * Evaluates grid alignment and Pin Snap friction according to `this.slideLevel`.
   * Respects `SLICK_BRICK` (μ = 0.02, Pin Snap disabled).
   */
  private evaluatePinSnapForPiece(piece: TowerPieceEntity): void {
    if (piece.isStaticAnchor) {
      piece.snapped = true
      return
    }

    // Negative Power 2: SLICK_BRICK disables Pin Snap and forces soap friction (μ = 0.02)
    if (piece.powerEffect === 'SLICK_BRICK') {
      this.applyPieceFriction(piece, GAME_CONSTANTS.SLICK_BRICK_FRICTION, false)
      return
    }

    const body = piece.body
    const phys = getVariantPhysicsSpec(piece.variant)
    const slideParams = this.getSlidePhysicsParams()
    const u = GAME_CONSTANTS.UNIT_PX

    const nearestRightAngleRad =
      Math.round(body.angle / (Math.PI / 2)) * (Math.PI / 2)
    const angleDiffRad = Math.abs(body.angle - nearestRightAngleRad)
    const angleErrorDeg = (angleDiffRad * 180) / Math.PI
    const isAngleFlat = angleErrorDeg <= slideParams.pinSnapAngleDeg

    if (!isAngleFlat) {
      this.applyPieceFriction(
        piece,
        phys.friction * slideParams.frictionScale,
        false
      )
      return
    }

    const leftEdgeOffsetUnits = this.getCell0LeftEdgeOffsetUnits(
      piece,
      nearestRightAngleRad
    )
    const bodyXUnits = (body.position.x - this.offsetX) / u
    const cell0LeftWorldUnits = bodyXUnits + leftEdgeOffsetUnits

    const nearestHalfGrid = Math.round(cell0LeftWorldUnits * 2) / 2
    const halfErrorUnits = Math.abs(cell0LeftWorldUnits - nearestHalfGrid)

    const isAlignedToGrid = halfErrorUnits <= slideParams.pinSnapGridTol

    if (isAlignedToGrid) {
      this.applyPieceFriction(
        piece,
        phys.snappedFriction * slideParams.frictionScale,
        true
      )
    } else {
      this.applyPieceFriction(
        piece,
        phys.friction * slideParams.frictionScale,
        false
      )
    }
  }

  private applyPieceFriction(
    piece: TowerPieceEntity,
    frictionValue: number,
    snapped: boolean
  ): void {
    const slideParams = this.getSlidePhysicsParams()
    piece.snapped = snapped || Boolean(piece.isGlued)
    piece.body.friction = frictionValue
    piece.body.frictionStatic =
      piece.powerEffect === 'SLICK_BRICK'
        ? GAME_CONSTANTS.SLICK_BRICK_FRICTION
        : snapped
          ? frictionValue * slideParams.staticMultSnapped
          : frictionValue * slideParams.staticMultUnsnapped
    for (let i = 1; i < piece.body.parts.length; i++) {
      const part = piece.body.parts[i]
      part.friction = frictionValue
      part.frictionStatic = piece.body.frictionStatic
    }
  }

  /**
   * Horizontal discrete movement & "O Socão" (Impulse Nudge / Investida):
   * - Normal Arrow Keys (`isShiftNudge === false`): Moves by 0.5 unit (Half Block = 16px).
   * - Shift + Arrow Keys (`isShiftNudge === true`):
   *   1. Always performs the "Investida" animation (piston lunge out & back to axis in 80ms).
   *   2. If the piece hits ANY other piece during the Socão (even horizontally!), it applies the physical
   *      "Socão" (`vx = ±3.5`, white plastic sparks/smoke at contact point, screen shake, dry "clack!" sound)
   *      and AUTOMATICALLY exits player control as if placed (`landActivePiece()`)!
   *   3. If in mid-air and path is completely free of other pieces: Moves 1.0 unit and performs the "Investida" animation.
   */
  public moveHorizontal(dir: -1 | 1, isShiftNudge: boolean): void {
    if (
      !this.activePiece ||
      this.pieceRecallAnim !== null ||
      (this.state !== 'FALLING' && this.state !== 'ROOF_DROP')
    ) {
      return
    }

    const piece = this.activePiece
    const u = GAME_CONSTANTS.UNIT_PX
    const body = piece.body
    const origPos = { x: body.position.x, y: body.position.y }

    // If Bloco de Ferro (`STATIC_BRICK`) is already touching any block laterally/vertically, freeze immediately!
    if (
      piece.powerEffect === 'STATIC_BRICK' &&
      this.isStaticBrickTouchingTower(body)
    ) {
      this.landActivePiece()
      return
    }

    const wasTouchingBottom =
      this.bottomTouchTimerMs > 0 ||
      this.hasBottomSupportThisTick ||
      this.isPieceSupportedBelow(body)

    // A) SHIFT + ARROW ("O Socão"): Check lateral sensor first if already adjacent to a block in direction `dir`
    if (isShiftNudge && this.state === 'FALLING') {
      const preContacts = this.detectLateralTowerContacts(body, dir)
      if (preContacts.length > 0) {
        if (piece.powerEffect === 'STATIC_BRICK') {
          this.landActivePiece()
          return
        }
        this.triggerImpulseNudge(dir, preContacts, true)
        this.landActivePiece()
        return
      }
    }

    // B) Compute target grid step & enforce Lane Control Limit (`CONTROL_BOUND_X = ±7.5` units):
    // - Normal Arrow (`!isShiftNudge`): 0.5 unit (Half Block = 16px)
    // - Shift + Arrow (`isShiftNudge` when path is free): 1.0 unit (Full Block = 32px) + Investida animation
    const stepUnits = isShiftNudge ? 1.0 : 0.5
    const leftEdgeOffsetUnits = this.getCell0LeftEdgeOffsetUnits(
      piece,
      body.angle
    )
    const span = this.getPieceHorizontalSpanUnits(piece, body.angle)
    const boundU = GAME_CONSTANTS.CONTROL_BOUND_X_UNITS
    const minBodyXUnits = -boundU - span.minOffsetUnits
    const maxBodyXUnits = boundU - span.maxOffsetUnits

    const currentBodyXUnits = (origPos.x - this.offsetX) / u
    const alreadyAtControlLimit =
      (dir === -1 && currentBodyXUnits <= minBodyXUnits + 0.04) ||
      (dir === 1 && currentBodyXUnits >= maxBodyXUnits - 0.04)

    if (alreadyAtControlLimit) {
      // Blocked by invisible Lane Control Wall: trigger subtle visual shake on the active piece!
      this.boundaryShakeDir = dir
      this.boundaryShakeTimerMs = 135
      this.shakeDir = dir
      this.shakeTimerMs = 45
      if (isShiftNudge) {
        if (wasTouchingBottom) {
          this.triggerImpulseNudge(
            dir,
            this.detectBottomTowerContacts(body),
            true
          )
          this.landActivePiece()
        } else {
          this.triggerImpulseNudge(dir, [])
        }
      }
      return
    }

    const currentLeftEdgeUnits = currentBodyXUnits + leftEdgeOffsetUnits
    const targetLeftEdgeUnits =
      Math.round((currentLeftEdgeUnits + dir * stepUnits) * 2) / 2
    const rawTargetBodyXUnits = targetLeftEdgeUnits - leftEdgeOffsetUnits
    const targetBodyXUnits = Math.max(
      minBodyXUnits,
      Math.min(maxBodyXUnits, rawTargetBodyXUnits)
    )
    const clampedByBoundary =
      Math.abs(targetBodyXUnits - rawTargetBodyXUnits) > 0.04
    const targetX = this.offsetX + targetBodyXUnits * u

    Matter.Sleeping.set(body, false)

    // Test requested step on exact grid alignment without penetrating any block
    if (this.tryMoveBodyWithSlotClearance(body, targetX, origPos.y)) {
      this.checkExtraLifeBalloonCatch()
      if (clampedByBoundary) {
        this.boundaryShakeDir = dir
        this.boundaryShakeTimerMs = 110
      }
      if (
        piece.powerEffect === 'STATIC_BRICK' &&
        this.isStaticBrickTouchingTower(body)
      ) {
        this.landActivePiece()
        return
      }
      if (isShiftNudge && this.state === 'FALLING') {
        const postContacts = this.detectLateralTowerContacts(body, dir)
        if (postContacts.length > 0) {
          this.triggerImpulseNudge(dir, postContacts, true)
          this.landActivePiece()
          return
        }
        if (wasTouchingBottom || this.isPieceSupportedBelow(body)) {
          this.triggerImpulseNudge(
            dir,
            this.detectBottomTowerContacts(body),
            true
          )
          this.landActivePiece()
          return
        }
        this.triggerImpulseNudge(dir, [])
        return
      }
      // Normal 0.5u step: if the piece walked off a supporting ledge into open air, reset the 0.5s grace timer so it falls!
      if (!this.isPieceSupportedBelow(body)) {
        this.bottomTouchTimerMs = 0
        this.hasBottomSupportThisTick = false
      }
      return
    }

    // If Shift + Arrow ("O Socão") tried 1.0u and was blocked by another piece along the path:
    // Slide up to 0.5u (or pixel-by-pixel flush against the blocking piece), punch it, and immediately land!
    if (isShiftNudge && this.state === 'FALLING') {
      this.setBodyPositionClean(body, origPos.x, origPos.y)
      const halfLeftEdgeUnits =
        Math.round((currentLeftEdgeUnits + dir * 0.5) * 2) / 2
      const halfBodyXUnits = Math.max(
        minBodyXUnits,
        Math.min(maxBodyXUnits, halfLeftEdgeUnits - leftEdgeOffsetUnits)
      )
      const halfTargetX = this.offsetX + halfBodyXUnits * u
      if (!this.tryMoveBodyWithSlotClearance(body, halfTargetX, origPos.y)) {
        this.setBodyPositionClean(body, origPos.x, origPos.y)
      }

      // Sweep in 1px increments from current X toward targetX to close any remaining gap flush against the blocking piece
      const startSweepX = body.position.x
      const startSweepY = body.position.y
      const remainingPx = Math.round(Math.abs(targetX - startSweepX))
      let lastClearX = startSweepX
      let lastClearY = startSweepY
      for (let s = 1; s <= remainingPx; s++) {
        const testX = startSweepX + dir * s
        if (this.tryMoveBodyWithSlotClearance(body, testX, startSweepY)) {
          lastClearX = body.position.x
          lastClearY = body.position.y
        } else {
          break
        }
      }
      this.setBodyPositionClean(body, lastClearX, lastClearY)

      if (piece.powerEffect === 'STATIC_BRICK') {
        this.landActivePiece()
        return
      }

      let hitContacts = this.detectLateralTowerContacts(body, dir)
      if (hitContacts.length === 0) {
        hitContacts = this.detectAnyCloseTowerContacts(body, dir)
      }
      this.triggerImpulseNudge(dir, hitContacts, true)
      this.landActivePiece()
      return
    }

    // If Bloco de Ferro (`STATIC_BRICK`) was blocked because moving toward `targetX` hit a block laterally,
    // slide it flush up to the side of that block and freeze immediately!
    if (piece.powerEffect === 'STATIC_BRICK') {
      const maxSteps = Math.max(1, Math.round(Math.abs(targetX - origPos.x)))
      let lastClearX = origPos.x
      for (let s = 1; s <= maxSteps; s++) {
        const testX = origPos.x + dir * s
        this.setBodyPositionClean(body, testX, origPos.y)
        if (this.getOverlappingTowerBodies(body).length === 0) {
          lastClearX = testX
        } else {
          break
        }
      }
      this.setBodyPositionClean(body, lastClearX, origPos.y)
      this.landActivePiece()
      return
    }

    // Revert to original grid position if blocked
    this.setBodyPositionClean(body, origPos.x, origPos.y)
  }

  /**
   * Moves `body` to `(x, y)` while keeping `positionPrev` synchronized with current velocity
   * and zeroing `positionImpulse` so Matter.js Verlet integration never invents phantom forces.
   */
  private setBodyPositionClean(body: Matter.Body, x: number, y: number): void {
    const vx = body.velocity.x
    const vy = body.velocity.y
    Body.setPosition(body, { x, y })
    Body.setVelocity(body, { x: vx, y: vy })
    this.clearBodyPositionImpulses(body)
  }

  /**
   * Attempts to place `body` at exact grid `(targetX, targetY)` without off-grid horizontal shifts
   * that could wedge the piece inside neighboring blocks. Includes small upward micro-lifts (`-1.5 .. -4.5px`)
   * so pieces resting on a block during the 0.5s bottom-contact window can slide sideways smoothly.
   */
  private tryMoveBodyWithSlotClearance(
    body: Matter.Body,
    targetX: number,
    targetY: number
  ): boolean {
    const yOffsets = [0, -1.5, -3.0, -4.5]

    for (const dy of yOffsets) {
      this.setBodyPositionClean(body, targetX, targetY + dy)
      if (this.getOverlappingTowerBodies(body).length === 0) {
        return true
      }
    }
    return false
  }

  /**
   * Checks whether `testBody` is currently resting on / supported by any block below it
   * (settled tower piece, base plate, or active side island).
   */
  private isPieceSupportedBelow(testBody: Matter.Body): boolean {
    const candidates: Matter.Body[] = [
      this.baseBody,
      ...this.islands.filter((i) => !i.body.isSensor).map((i) => i.body),
      ...this.settledPieces.map((p) => p.body),
    ]
    const testParts =
      testBody.parts.length > 1 ? testBody.parts.slice(1) : [testBody]

    for (const other of candidates) {
      if (other === testBody) continue
      const otherParts =
        other.parts.length > 1 ? other.parts.slice(1) : [other]

      for (const partA of testParts) {
        for (const partB of otherParts) {
          const overlapX =
            Math.min(partA.bounds.max.x, partB.bounds.max.x) -
            Math.max(partA.bounds.min.x, partB.bounds.min.x)
          if (overlapX <= 5.5) continue

          const dy = partB.position.y - partA.position.y
          if (dy < 7) continue

          const gapY = partB.bounds.min.y - partA.bounds.max.y
          if (gapY >= -6.0 && gapY <= 2.6) {
            return true
          }
        }
      }
    }
    return false
  }

  /**
   * Returns contact points along the bottom of `activeBody` where it touches a block below
   * (used when the player performs a Socão while resting on the piece below during the 0.5s grace window).
   */
  private detectBottomTowerContacts(
    activeBody: Matter.Body
  ): Array<{ body: Matter.Body; contactX: number; contactY: number }> {
    const results: Array<{
      body: Matter.Body
      contactX: number
      contactY: number
    }> = []
    const seenBodies = new Set<number>()
    const candidates: Matter.Body[] = [
      ...this.settledPieces.map((s) => s.body),
      this.baseBody,
      ...this.islands.filter((i) => !i.body.isSensor).map((i) => i.body),
    ]
    const activeParts =
      activeBody.parts.length > 1 ? activeBody.parts.slice(1) : [activeBody]

    for (const otherBody of candidates) {
      if (otherBody === activeBody) continue
      const otherParts =
        otherBody.parts.length > 1 ? otherBody.parts.slice(1) : [otherBody]

      for (const partA of activeParts) {
        for (const partB of otherParts) {
          const overlapX =
            Math.min(partA.bounds.max.x, partB.bounds.max.x) -
            Math.max(partA.bounds.min.x, partB.bounds.min.x)
          const gapY = partB.bounds.min.y - partA.bounds.max.y
          if (overlapX > 2.0 && gapY >= -6.0 && gapY <= 4.0) {
            if (!seenBodies.has(otherBody.id)) {
              seenBodies.add(otherBody.id)
              const contactWorldX =
                (Math.max(partA.bounds.min.x, partB.bounds.min.x) +
                  Math.min(partA.bounds.max.x, partB.bounds.max.x)) *
                0.5
              const contactWorldY = partA.bounds.max.y
              results.push({
                body: otherBody,
                contactX: contactWorldX - this.offsetX,
                contactY: contactWorldY,
              })
            }
          }
        }
      }
    }
    return results
  }

  /**
   * Fallback contact detector when a Socão lunge is blocked by a tilted or corner-adjacent piece.
   */
  private detectAnyCloseTowerContacts(
    activeBody: Matter.Body,
    dir: -1 | 1
  ): Array<{ body: Matter.Body; contactX: number; contactY: number }> {
    const results: Array<{
      body: Matter.Body
      contactX: number
      contactY: number
    }> = []
    const seenBodies = new Set<number>()
    const candidates: Matter.Body[] = [
      ...this.settledPieces.map((s) => s.body),
      this.baseBody,
      ...this.islands.filter((i) => !i.body.isSensor).map((i) => i.body),
    ]
    const activeParts =
      activeBody.parts.length > 1 ? activeBody.parts.slice(1) : [activeBody]

    for (const otherBody of candidates) {
      if (otherBody === activeBody) continue
      const otherParts =
        otherBody.parts.length > 1 ? otherBody.parts.slice(1) : [otherBody]

      for (const partA of activeParts) {
        for (const partB of otherParts) {
          const gapX = Math.max(
            0,
            Math.max(
              partA.bounds.min.x - partB.bounds.max.x,
              partB.bounds.min.x - partA.bounds.max.x
            )
          )
          const gapY = Math.max(
            0,
            Math.max(
              partA.bounds.min.y - partB.bounds.max.y,
              partB.bounds.min.y - partA.bounds.max.y
            )
          )
          if (gapX <= 6.5 && gapY <= 6.5) {
            if (!seenBodies.has(otherBody.id)) {
              seenBodies.add(otherBody.id)
              const contactWorldX =
                dir === 1 ? partA.bounds.max.x : partA.bounds.min.x
              const contactWorldY = (partA.position.y + partB.position.y) * 0.5
              results.push({
                body: otherBody,
                contactX: contactWorldX - this.offsetX,
                contactY: contactWorldY,
              })
            }
          }
        }
      }
    }
    return results
  }

  /**
   * Lateral Sensor (for Shift + Arrow "Socão"):
   * Detects any settled tower blocks (dynamic or static), base steps, or side islands touching or within ~4.5px
   * of `activeBody` in direction `dir`, returning the hit bodies and exact local contact points `(contactX, contactY)`.
   */
  private detectLateralTowerContacts(
    activeBody: Matter.Body,
    dir: -1 | 1
  ): Array<{ body: Matter.Body; contactX: number; contactY: number }> {
    const results: Array<{
      body: Matter.Body
      contactX: number
      contactY: number
    }> = []
    const seenBodies = new Set<number>()

    const activeParts =
      activeBody.parts.length > 1 ? activeBody.parts.slice(1) : [activeBody]

    const candidates: Matter.Body[] = [
      ...this.settledPieces.map((s) => s.body),
      this.baseBody,
      ...this.islands.filter((i) => !i.body.isSensor).map((i) => i.body),
    ]

    for (const otherBody of candidates) {
      if (otherBody === activeBody) continue

      const otherParts =
        otherBody.parts.length > 1 ? otherBody.parts.slice(1) : [otherBody]

      for (const partA of activeParts) {
        // Visual outer edges of partA (accounting for 1.0px outer collider inset)
        const aLeft = partA.bounds.min.x - 1.0
        const aRight = partA.bounds.max.x + 1.0
        const aTop = partA.bounds.min.y + 3.0
        const aBottom = partA.bounds.max.y - 3.0

        for (const partB of otherParts) {
          const bLeft = partB.bounds.min.x - 1.0
          const bRight = partB.bounds.max.x + 1.0
          const bTop = partB.bounds.min.y + 3.0
          const bBottom = partB.bounds.max.y - 3.0

          // Must overlap vertically on the side face
          const overlapY = Math.min(aBottom, bBottom) - Math.max(aTop, bTop)
          if (overlapY <= 0) continue

          // Ensure partB is genuinely on the `dir` side of partA
          if ((partB.position.x - partA.position.x) * dir <= 4) continue

          // Horizontal visual gap in pixels in direction `dir`
          const visualGapPx = dir === 1 ? bLeft - aRight : aLeft - bRight

          // Within <= 4.5px of the lateral face (with negative tolerance for grazing contact)
          if (visualGapPx >= -6.0 && visualGapPx <= 4.5) {
            if (!seenBodies.has(otherBody.id)) {
              seenBodies.add(otherBody.id)
              const contactWorldX = dir === 1 ? aRight : aLeft
              const contactWorldY =
                (Math.max(partA.bounds.min.y, partB.bounds.min.y) +
                  Math.min(partA.bounds.max.y, partB.bounds.max.y)) *
                0.5
              results.push({
                body: otherBody,
                contactX: contactWorldX - this.offsetX,
                contactY: contactWorldY,
              })
            }
          }
        }
      }
    }

    return results
  }

  /**
   * Executes "O Socão / Investida" (Impulse Nudge):
   * - Always animates the active piece piston lunge (goes out and returns to axis in 80ms),
   *   even when moving 1.0u in mid-air with no piece nearby!
   * - When touching a block (`contacts.length > 0`):
   *   - Applies dry horizontal velocity (`vx = ±3.5`) to hit dynamic tower block(s)
   *   - Spawns white plastic spark/smoke particles, short screen shake, and dry "clack!" sound
   */
  private triggerImpulseNudge(
    dir: -1 | 1,
    contacts: Array<{ body: Matter.Body; contactX: number; contactY: number }>,
    forceImpact: boolean = false
  ): void {
    if (
      !forceImpact &&
      contacts.length > 0 &&
      this.elapsedTimeMs - this.lastNudgeAtMs < 250
    ) {
      return
    }

    // 1. Always trigger the Piston Lunge ("Investida") animation over 80ms
    this.pistonDir = dir
    this.pistonTimerMs = this.pistonDurationMs

    if (contacts.length === 0) {
      // Mid-air "Investida" + 1.0u move: spawn subtle air-puff on the lunge side
      if (this.activePiece) {
        const b = this.activePiece.body
        const edgeX =
          (dir === 1 ? b.bounds.min.x : b.bounds.max.x) - this.offsetX
        const centerY = b.position.y
        for (let i = 0; i < 3; i++) {
          this.impactParticles.push({
            x: edgeX - dir * 4,
            y: centerY + (Math.random() - 0.5) * 18,
            vx: -dir * (0.6 + Math.random() * 0.9),
            vy: (Math.random() - 0.5) * 0.5,
            radius: 2.5 + Math.random() * 2.0,
            ageMs: 0,
            maxAgeMs: 110 + Math.random() * 40,
            kind: 'smoke',
          })
        }
      }
      return
    }

    this.lastNudgeAtMs = this.elapsedTimeMs

    // 2. Dry horizontal velocity impact (`vx = ±3.5`) on hit dynamic tower blocks
    for (const hit of contacts) {
      const targetBody = hit.body
      if (!targetBody.isStatic) {
        Matter.Sleeping.set(targetBody, false)

        // Wake neighboring settled pieces so the stack reacts cohesively
        for (const other of this.settledPieces) {
          if (other.body !== targetBody && other.body.isSleeping) {
            const dist = Math.hypot(
              other.body.position.x - targetBody.position.x,
              other.body.position.y - targetBody.position.y
            )
            if (dist < GAME_CONSTANTS.UNIT_PX * 3.5) {
              Matter.Sleeping.set(other.body, false)
            }
          }
        }

        // Standard pieces (mass 4.0) receive exact vx = ±3.5; heavier special pieces scale proportionally
        const massScale = Math.min(
          1.0,
          4.0 / Math.max(4.0, targetBody.mass * 0.65)
        )
        const impulseVx = dir * 3.5 * massScale

        Body.setVelocity(targetBody, {
          x: impulseVx,
          y: targetBody.velocity.y,
        })
      }

      // 3. Spawn white plastic sparks & smoke puff at the exact contact seam
      this.spawnNudgeImpactParticles(hit.contactX, hit.contactY, dir)
    }

    // 4. Short Screen Shake (~95ms)
    this.shakeDir = dir
    this.shakeTimerMs = this.shakeDurationMs

    // 5. Dry plastic "clack!" sound effect
    this.playPlasticClackSound()
  }

  private spawnNudgeImpactParticles(
    contactX: number,
    contactY: number,
    dir: -1 | 1
  ): void {
    // Crisp expanding impact ring
    this.impactParticles.push({
      x: contactX,
      y: contactY,
      vx: 0,
      vy: 0,
      radius: 3,
      ageMs: 0,
      maxAgeMs: 140,
      kind: 'ring',
    })

    // White plastic sparks shooting along the contact seam
    for (let i = 0; i < 8; i++) {
      const spreadAngle =
        (dir === 1 ? 0 : Math.PI) + (Math.random() - 0.5) * Math.PI * 0.85
      const speed = 1.6 + Math.random() * 2.8
      this.impactParticles.push({
        x: contactX,
        y: contactY + (Math.random() - 0.5) * 10,
        vx: Math.cos(spreadAngle) * speed,
        vy: Math.sin(spreadAngle) * speed - 0.5,
        radius: 1.8 + Math.random() * 1.5,
        ageMs: 0,
        maxAgeMs: 130 + Math.random() * 60,
        kind: 'spark',
      })
    }

    // Small white plastic dust/smoke puffs at the point of impact
    for (let i = 0; i < 5; i++) {
      this.impactParticles.push({
        x: contactX + (Math.random() - 0.5) * 6,
        y: contactY + (Math.random() - 0.5) * 12,
        vx: dir * (0.3 + Math.random() * 0.8) + (Math.random() - 0.5) * 0.6,
        vy: -0.4 - Math.random() * 0.9,
        radius: 3.5 + Math.random() * 3.0,
        ageMs: 0,
        maxAgeMs: 180 + Math.random() * 70,
        kind: 'smoke',
      })
    }
  }

  /**
   * Synthesizes a dry, tactile ABS plastic knock ("clack!") using Web Audio API.
   */
  private playPlasticClackSound(): void {
    try {
      const AudioContextClass =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext })
          .webkitAudioContext
      if (!AudioContextClass) return

      if (!this.audioCtx) {
        this.audioCtx = new AudioContextClass()
      }
      if (this.audioCtx.state === 'suspended') {
        this.audioCtx.resume()
      }

      const ctx = this.audioCtx
      const now = ctx.currentTime

      // 1. Short hollow plastic knock (pitch-dropping triangle wave)
      const osc = ctx.createOscillator()
      const oscGain = ctx.createGain()
      osc.type = 'triangle'
      osc.frequency.setValueAtTime(540, now)
      osc.frequency.exponentialRampToValueAtTime(135, now + 0.042)

      oscGain.gain.setValueAtTime(0.32, now)
      oscGain.gain.exponentialRampToValueAtTime(0.001, now + 0.045)

      osc.connect(oscGain)
      oscGain.connect(ctx.destination)
      osc.start(now)
      osc.stop(now + 0.048)

      // 2. Crisp high-frequency plastic click (bandpass-filtered noise burst)
      const bufferSize = Math.floor(ctx.sampleRate * 0.03)
      const noiseBuffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate)
      const data = noiseBuffer.getChannelData(0)
      for (let i = 0; i < bufferSize; i++) {
        data[i] = (Math.random() * 2 - 1) * Math.exp(-i / (bufferSize * 0.3))
      }

      const noise = ctx.createBufferSource()
      noise.buffer = noiseBuffer

      const filter = ctx.createBiquadFilter()
      filter.type = 'bandpass'
      filter.frequency.setValueAtTime(2350, now)
      filter.Q.setValueAtTime(2.8, now)

      const noiseGain = ctx.createGain()
      noiseGain.gain.setValueAtTime(0.45, now)
      noiseGain.gain.exponentialRampToValueAtTime(0.001, now + 0.03)

      noise.connect(filter)
      filter.connect(noiseGain)
      noiseGain.connect(ctx.destination)
      noise.start(now)
      noise.stop(now + 0.032)
    } catch {
      // Ignore audio errors if browser blocks autoplay
    }
  }

  /**
   * Synthesizes a failure buzzer sound ("Bzzzt!") when the tower slips below 30m during `GOAL_COUNTDOWN`.
   */
  private playCountdownAbortedBuzzer(): void {
    try {
      const AudioContextClass =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext })
          .webkitAudioContext
      if (!AudioContextClass) return
      if (!this.audioCtx) {
        this.audioCtx = new AudioContextClass()
      }
      if (this.audioCtx.state === 'suspended') {
        this.audioCtx.resume()
      }
      const ctx = this.audioCtx
      const now = ctx.currentTime

      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      osc.type = 'sawtooth'
      osc.frequency.setValueAtTime(165, now)
      osc.frequency.setValueAtTime(125, now + 0.14)
      gain.gain.setValueAtTime(0.26, now)
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.34)
      osc.connect(gain)
      gain.connect(ctx.destination)
      osc.start(now)
      osc.stop(now + 0.35)
    } catch {
      // Ignore audio errors
    }
  }

  /**
   * Synthesizes a bright celebratory victory chord when the Castle Roof lands & welds to the tower.
   */
  private playVictoryFanfareSound(): void {
    try {
      const AudioContextClass =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext })
          .webkitAudioContext
      if (!AudioContextClass) return
      if (!this.audioCtx) {
        this.audioCtx = new AudioContextClass()
      }
      if (this.audioCtx.state === 'suspended') {
        this.audioCtx.resume()
      }
      const ctx = this.audioCtx
      const now = ctx.currentTime
      const notes = [523.25, 659.25, 783.99, 1046.5] // C5, E5, G5, C6
      notes.forEach((freq, idx) => {
        const osc = ctx.createOscillator()
        const gain = ctx.createGain()
        osc.type = 'triangle'
        const t0 = now + idx * 0.08
        osc.frequency.setValueAtTime(freq, t0)
        gain.gain.setValueAtTime(0.22, t0)
        gain.gain.exponentialRampToValueAtTime(0.001, t0 + 0.45)
        osc.connect(gain)
        gain.connect(ctx.destination)
        osc.start(t0)
        osc.stop(t0 + 0.46)
      })
    } catch {
      // Ignore audio errors
    }
  }

  /**
   * Returns the downward extent (in pixels below `body.position.y`) of `piece` when rotated at `angleRad`.
   */
  private getPieceBottomExtentPx(
    piece: Pick<TowerPieceEntity, 'cellsFromCoM' | 'scale'>,
    angleRad: number
  ): number {
    const sin = Math.sin(angleRad)
    const cos = Math.cos(angleRad)
    const cellPx = GAME_CONSTANTS.UNIT_PX * piece.scale
    let maxBottomPx = -Infinity
    for (const c of piece.cellsFromCoM) {
      const ry = (c.x * sin + c.y * cos + 0.5) * cellPx
      if (ry > maxBottomPx) {
        maxBottomPx = ry
      }
    }
    return maxBottomPx
  }

  /**
   * Instant 90-degree rotation (clockwise = +1, counter-clockwise = -1)
   * with exact grid preservation and physical Wall Kick (±1.0 or ±0.5 unit).
   */
  public rotateActivePiece(direction: 1 | -1): void {
    if (
      !this.activePiece ||
      this.pieceRecallAnim !== null ||
      (this.state !== 'FALLING' && this.state !== 'ROOF_DROP')
    ) {
      return
    }

    const piece = this.activePiece

    // State C: ROOF_DROP ("Telhado de Castelo") locks rotation so the flag always points up!
    if (this.state === 'ROOF_DROP' || piece.powerEffect === 'CASTLE_ROOF') {
      this.shakeDir = direction
      this.shakeTimerMs = 50
      this.onEventBanner?.(
        '🏰 Rotação travada: o Telhado de Castelo desce sempre com a bandeira para cima!',
        'info'
      )
      return
    }

    // Negative Power 3: LOCK_ROTATE ("Pino Redondo / Giro Travado") blocks rotation!
    if (piece.powerEffect === 'LOCK_ROTATE') {
      this.shakeDir = direction
      this.shakeTimerMs = 60
      this.onEventBanner?.(
        '🔒 Giro Travado! Esta peça não pode ser rotacionada!',
        'warning'
      )
      return
    }

    const body = piece.body
    const u = GAME_CONSTANTS.UNIT_PX

    const origAngle = body.angle
    const origPos = { x: body.position.x, y: body.position.y }

    // Check if the piece's left edge was on the full 1.0u integer grid before rotating
    const oldLeftEdgeOffset = this.getCell0LeftEdgeOffsetUnits(piece, origAngle)
    const oldLeftEdgeUnits =
      (origPos.x - this.offsetX) / u + oldLeftEdgeOffset
    const wasOnFullGrid =
      Math.abs(oldLeftEdgeUnits - Math.round(oldLeftEdgeUnits)) < 0.2

    const targetAngle =
      Math.round((origAngle + direction * (Math.PI / 2)) / (Math.PI / 2)) *
      (Math.PI / 2)

    const oldBottomExtentPx = this.getPieceBottomExtentPx(piece, origAngle)
    const newBottomExtentPx = this.getPieceBottomExtentPx(piece, targetAngle)
    const extraDownwardPx = Math.max(0, newBottomExtentPx - oldBottomExtentPx)

    Body.setAngle(body, targetAngle)
    Body.setInertia(body, Infinity)

    // Align the rotated piece so its cells stay on the exact same 1.0u (or 0.5u) grid
    // and stay strictly within the ±6.5u Lane Control Boundary
    const newLeftEdgeOffset = this.getCell0LeftEdgeOffsetUnits(
      piece,
      targetAngle
    )
    const rotSpan = this.getPieceHorizontalSpanUnits(piece, targetAngle)
    const boundU = GAME_CONSTANTS.CONTROL_BOUND_X_UNITS
    const minRotBodyXUnits = -boundU - rotSpan.minOffsetUnits
    const maxRotBodyXUnits = boundU - rotSpan.maxOffsetUnits

    const rawNewLeftEdgeUnits =
      (origPos.x - this.offsetX) / u + newLeftEdgeOffset
    const snappedNewLeftEdgeUnits = wasOnFullGrid
      ? Math.round(rawNewLeftEdgeUnits)
      : Math.round(rawNewLeftEdgeUnits * 2) / 2
    const alignedBodyXUnits = Math.max(
      minRotBodyXUnits,
      Math.min(maxRotBodyXUnits, snappedNewLeftEdgeUnits - newLeftEdgeOffset)
    )
    const alignedPos = {
      x: this.offsetX + alignedBodyXUnits * u,
      y: origPos.y,
    }

    const finalizeSuccessfulRotation = () => {
      this.checkExtraLifeBalloonCatch()
      if (!this.isPieceSupportedBelow(body)) {
        this.bottomTouchTimerMs = 0
        this.hasBottomSupportThisTick = false
      }
      if (
        piece.powerEffect === 'STATIC_BRICK' &&
        this.isStaticBrickTouchingTower(body)
      ) {
        this.landActivePiece()
      }
    }

    // 1. First test exact vertical position (or micro-lifts) at `kickU = 0` and `±0.5`
    const primaryKicks = [0, 0.5, -0.5]
    for (const kickU of primaryKicks) {
      const candidateBodyXUnits = alignedBodyXUnits + kickU
      if (
        candidateBodyXUnits < minRotBodyXUnits - 0.04 ||
        candidateBodyXUnits > maxRotBodyXUnits + 0.04
      ) {
        continue
      }
      if (
        this.tryMoveBodyWithSlotClearance(
          body,
          alignedPos.x + kickU * u,
          alignedPos.y
        )
      ) {
        finalizeSuccessfulRotation()
        return
      }
    }

    // 2. When rotating a piece increases its downward reach (e.g. rotating "I" from horizontal 4x1 to vertical 1x4 "em pé",
    // which extends the bottom downward by +1.5u = +48px), lift the piece upward in its current column so its bottom
    // sits cleanly above the tower rather than kicking it sideways into the side of the tower!
    if (extraDownwardPx > 0) {
      const maxLiftPx = Math.ceil(extraDownwardPx + 6)
      for (const kickU of primaryKicks) {
        const candidateBodyXUnits = alignedBodyXUnits + kickU
        if (
          candidateBodyXUnits < minRotBodyXUnits - 0.04 ||
          candidateBodyXUnits > maxRotBodyXUnits + 0.04
        ) {
          continue
        }
        const testX = alignedPos.x + kickU * u
        for (let liftPx = 6; liftPx <= maxLiftPx; liftPx += 4) {
          this.setBodyPositionClean(body, testX, alignedPos.y - liftPx)
          if (this.getOverlappingTowerBodies(body).length === 0) {
            finalizeSuccessfulRotation()
            return
          }
        }
      }
    }

    // 3. Fallback wider horizontal Wall Kicks (±1.0u .. ±2.0u) if wedged between tall side walls
    const wideKickOffsetsUnits = [1.0, -1.0, 1.5, -1.5, 2.0, -2.0]
    for (const kickU of wideKickOffsetsUnits) {
      const candidateBodyXUnits = alignedBodyXUnits + kickU
      if (
        candidateBodyXUnits < minRotBodyXUnits - 0.04 ||
        candidateBodyXUnits > maxRotBodyXUnits + 0.04
      ) {
        continue
      }
      if (
        this.tryMoveBodyWithSlotClearance(
          body,
          alignedPos.x + kickU * u,
          alignedPos.y
        )
      ) {
        finalizeSuccessfulRotation()
        return
      }
    }

    // If blocked on all sides, revert rotation cleanly
    Body.setAngle(body, origAngle)
    ;(body as unknown as { anglePrev: number }).anglePrev = origAngle
    this.setBodyPositionClean(body, origPos.x, origPos.y)
    Body.setInertia(body, Infinity)
  }

  /**
   * Checks if a `STATIC_BRICK` ("Bloco de Ferro") is touching any block in the tower,
   * the base plate, or a Side Island—including lateral (side-to-side) contact!
   * Accounts for the 1.0px outer collider inset per cell (`gapX <= 3.8px` when visually flush).
   */
  private isStaticBrickTouchingTower(testBody: Matter.Body): boolean {
    const candidates: Matter.Body[] = [
      this.baseBody,
      ...this.islands.filter((i) => !i.body.isSensor).map((i) => i.body),
      ...this.settledPieces.map((p) => p.body),
    ]
    const testParts =
      testBody.parts.length > 1 ? testBody.parts.slice(1) : [testBody]

    for (const other of candidates) {
      if (other === testBody) continue
      const otherParts =
        other.parts.length > 1 ? other.parts.slice(1) : [other]

      for (const partA of testParts) {
        for (const partB of otherParts) {
          const col = Collision.collides(partA, partB)
          if (col && col.collided) {
            return true
          }

          const gapX = Math.max(
            0,
            Math.max(
              partA.bounds.min.x - partB.bounds.max.x,
              partB.bounds.min.x - partA.bounds.max.x
            )
          )
          const gapY = Math.max(
            0,
            Math.max(
              partA.bounds.min.y - partB.bounds.max.y,
              partB.bounds.min.y - partA.bounds.max.y
            )
          )
          const overlapX =
            Math.min(partA.bounds.max.x, partB.bounds.max.x) -
            Math.max(partA.bounds.min.x, partB.bounds.min.x)
          const overlapY =
            Math.min(partA.bounds.max.y, partB.bounds.max.y) -
            Math.max(partA.bounds.min.y, partB.bounds.min.y)

          // 1. Lateral touch (side-by-side): collider inset is 1.0px on each block (2.0px total when visually flush)
          if (gapX <= 3.8 && overlapY >= 2.0) {
            return true
          }

          // 2. Vertical touch (top or bottom): collider inset is 1.0px on each block (2.0px total when visually flush)
          if (gapY <= 2.8 && overlapX >= 2.0) {
            return true
          }
        }
      }
    }

    return false
  }

  /**
   * Checks if `testBody` overlaps the base plate, any active Side Island, or any settled piece in the tower.
   * Uses a tight depth threshold (0.25px) so pieces can never be moved or rotated inside another block.
   */
  private getOverlappingTowerBodies(testBody: Matter.Body): Matter.Body[] {
    const candidates: Matter.Body[] = [
      this.baseBody,
      ...this.islands.filter((i) => !i.body.isSensor).map((i) => i.body),
      ...this.settledPieces.map((p) => p.body),
    ]
    const overlapping: Matter.Body[] = []

    for (const other of candidates) {
      let hit = false
      for (let i = 1; i < testBody.parts.length && !hit; i++) {
        const partA = testBody.parts[i]
        const otherParts = other.parts.length > 1 ? other.parts.slice(1) : [other]
        for (const partB of otherParts) {
          const col = Collision.collides(partA, partB)
          if (col && col.collided && col.depth > 0.25) {
            hit = true
            break
          }
        }
      }
      if (hit) {
        overlapping.push(other)
      }
    }

    return overlapping
  }

  /**
   * Computes the rightmost horizontal extent (in grid units from tower center)
   * across settled tower blocks, right-side floating islands, and the active piece,
   * so as soon as the tower starts being built toward the character (`> 1.8u`),
   * the character visibly backs away further to the right and never overlaps the tower!
   */
  private getRightmostTowerExtentUnits(): number {
    const u = GAME_CONSTANTS.UNIT_PX
    let maxRightUnits = 1.8

    for (const isl of this.islands) {
      const rightEdge = isl.x + isl.width / 2
      if (rightEdge > maxRightUnits) {
        maxRightUnits = rightEdge
      }
    }

    for (const p of this.settledPieces) {
      const rightEdge = (p.body.bounds.max.x - this.offsetX) / u
      if (rightEdge > maxRightUnits) {
        maxRightUnits = rightEdge
      }
    }

    if (this.activePiece) {
      const activeRight =
        (this.activePiece.body.bounds.max.x - this.offsetX) / u
      if (activeRight > maxRightUnits) {
        maxRightUnits = activeRight
      }
    }

    return maxRightUnits
  }

  /**
   * Main fixed-timestep simulation tick (`dtMs` typically 16.67ms).
   */
  public update(dtMs: number): void {
    const targetMascotYUnits = Math.max(3.5, this.towerHeight)
    this.mascotHoverYUnits +=
      (targetMascotYUnits - this.mascotHoverYUnits) * Math.min(1, dtMs * 0.008)

    const targetMascotXUnits = Math.max(
      6.2,
      this.getRightmostTowerExtentUnits() + 4.4
    )
    const xLerpRate =
      targetMascotXUnits > this.mascotHoverXUnits ? 0.025 : 0.007
    this.mascotHoverXUnits +=
      (targetMascotXUnits - this.mascotHoverXUnits) *
      Math.min(1, dtMs * xLerpRate)

    if (this.state === 'VICTORY') {
      const prevBeat = Math.floor(this.victoryAnimTimeMs / 650)
      this.victoryAnimTimeMs += dtMs
      const currBeat = Math.floor(this.victoryAnimTimeMs / 650)
      if (currBeat > prevBeat) {
        const u = GAME_CONSTANTS.UNIT_PX
        this.spawnVictoryConfetti(0, -Math.max(2, this.towerHeight) * u, 14)
      }
      this.updateCamera(dtMs)
      this.updateNudgeEffects(dtMs)
      return
    }

    if (this.state === 'GAME_OVER') {
      this.updateCamera(dtMs)
      this.updateNudgeEffects(dtMs)
      this.tickSnapshots(dtMs)
      return
    }

    if (this.state === 'PUZZLE_COUNTING') {
      this.updatePuzzleCountingPhase(dtMs)
      this.updateCamera(dtMs)
      this.updateNudgeEffects(dtMs)
      this.tickSnapshots(dtMs)
      return
    }

    if (this.state === 'PETRIFIED_WAITING') {
      const allRemotesPetrified =
        this.isSinglePlayer ||
        this.remoteLanesToRender.length === 0 ||
        this.remoteLanesToRender.every((r) => r.isPetrified || r.isEliminated)
      if (allRemotesPetrified) {
        this.startPuzzleCountingPhase()
      }
      this.updateCamera(dtMs)
      this.updateNudgeEffects(dtMs)
      this.tickSnapshots(dtMs)
      return
    }

    const clampedDt = Math.min(16.667, dtMs)

    // 1. Handle initial 3, 2, 1, GO! countdown
    if (this.state === 'COUNTDOWN') {
      this.countdownRemainingMs = Math.max(0, this.countdownRemainingMs - dtMs)
      if (this.countdownRemainingMs <= 0) {
        this.state = 'SPAWNING'
      }
      this.tickSnapshots(dtMs)
      return
    }

    this.elapsedTimeMs += dtMs
    if (this.blindManualRemainingMs > 0) {
      this.blindManualRemainingMs = Math.max(
        0,
        this.blindManualRemainingMs - dtMs
      )
    }

    // 1b. Smooth Earth-Rising animation in PUZZLE mode (+0.5 block when a piece falls in the water)
    if (this.gameMode === 'PUZZLE' && this.pendingPuzzleBaseRiseUnits > 0.0001) {
      this.updatePuzzleBaseRiseAnimation(clampedDt)
    }

    // 2. State Machine transitions (Note: GOAL_COUNTDOWN, LASER_OVERLOAD, and ROOF_DROP pause normal piece spawning!)
    if (this.state === 'SPAWNING') {
      if (!this.isPuzzleWaitingForWaterOrBaseRise()) {
        this.spawnNextPiece()
      }
    } else if (this.state === 'SETTLING') {
      this.settlingTimerMs -= dtMs
      if (this.settlingTimerMs <= 0 && !this.isPuzzleWaitingForWaterOrBaseRise()) {
        this.state = 'SPAWNING'
      }
    } else if (this.state === 'RESPAWN_DELAY') {
      this.respawnDelayRemainingMs = Math.max(
        0,
        this.respawnDelayRemainingMs - dtMs
      )
      if (
        this.respawnDelayRemainingMs <= 0 &&
        !this.isPuzzleWaitingForWaterOrBaseRise()
      ) {
        this.state = 'SPAWNING'
      }
    }

    // Age and prune soft-drop mini shadow trail
    if (this.softDropTrail.length > 0) {
      for (let i = this.softDropTrail.length - 1; i >= 0; i--) {
        this.softDropTrail[i].ageMs += clampedDt
        if (this.softDropTrail[i].ageMs >= 110) {
          this.softDropTrail.splice(i, 1)
        }
      }
    }

    // 3. Control active falling piece velocity (or Recall-to-Spawn & Transform animation)
    if (this.pieceRecallAnim && this.activePiece) {
      this.updatePieceRecallAnim(clampedDt)
    } else if (
      this.activePiece &&
      (this.state === 'FALLING' || this.state === 'ROOF_DROP')
    ) {
      const body = this.activePiece.body
      const isPausedForPuzzleRise =
        this.gameMode === 'PUZZLE' && this.pendingPuzzleBaseRiseUnits > 0.0005
      const isRestingOnBottom =
        this.state === 'FALLING' &&
        (this.hasBottomSupportThisTick || this.isPieceSupportedBelow(body))

      if (isRestingOnBottom || isPausedForPuzzleRise) {
        // Hold piece gently during the 0.5s grace window or while the puzzle island is rising smoothly
        Body.setVelocity(body, { x: 0, y: 0 })
        Body.setAngularVelocity(body, 0)
        this.softDropTrail = []
      } else {
        const baseFallSpeed = 1.72
        const isTurbo = this.activePiece.powerEffect === 'TURBO_DROP'
        const targetVy = isTurbo
          ? baseFallSpeed * 4.0
          : this.isSoftDropping
            ? baseFallSpeed * 3.6
            : baseFallSpeed

        Body.setVelocity(body, {
          x: 0,
          y: targetVy,
        })
        Body.setAngularVelocity(body, 0)

        if (this.isSoftDropping || isTurbo) {
          this.softDropTrailAccumMs += clampedDt
          if (this.softDropTrailAccumMs >= 14) {
            this.softDropTrailAccumMs = 0
            this.softDropTrail.unshift({
              localX: body.position.x - this.offsetX,
              localY: body.position.y,
              angle: body.angle,
              ageMs: 0,
            })
            if (this.softDropTrail.length > 3) {
              this.softDropTrail.pop()
            }
          }
        } else {
          this.softDropTrailAccumMs = 0
        }
      }
    }

    // 4. Environmental Wind Gusts (disabled in PUZZLE mode)
    if (this.gameMode !== 'PUZZLE') {
      this.updateWind(clampedDt)
    }

    // 5. Step Matter.js 2D Physics Engine
    Engine.update(this.engine, clampedDt)

    // 5a. Prevent Matter.js warm-started positionImpulse explosions & clamp anomalous velocity spikes
    this.stabilizePhysicsStep()

    // 5a-bis. Bloco de Ferro (`STATIC_BRICK`): if it touches any block even laterally while falling, freeze immediately!
    if (
      !this.pendingLandPiece &&
      !this.pieceRecallAnim &&
      this.activePiece &&
      this.state === 'FALLING' &&
      this.activePiece.powerEffect === 'STATIC_BRICK' &&
      this.isStaticBrickTouchingTower(this.activePiece.body)
    ) {
      this.pendingLandPiece = true
    }

    // 5a-ter. 0.5s (500ms) Bottom-Contact Grace Window:
    // Upon touching the piece below, gives the player 0.5s to walk sideways (`←/→`) or perform a Socão (`Shift + ←/→`).
    if (
      !this.pendingLandPiece &&
      !this.pieceRecallAnim &&
      this.activePiece &&
      this.state === 'FALLING'
    ) {
      const supportedBelow =
        this.hasBottomSupportThisTick ||
        this.isPieceSupportedBelow(this.activePiece.body)
      this.hasBottomSupportThisTick = false

      if (supportedBelow) {
        this.bottomTouchTimerMs += dtMs
        if (this.bottomTouchTimerMs >= GAME_CONSTANTS.BOTTOM_TOUCH_GRACE_MS) {
          this.pendingLandPiece = true
        }
      } else {
        this.bottomTouchTimerMs = 0
      }
    } else {
      this.hasBottomSupportThisTick = false
    }

    // 5b. Process queued landing cleanly after Solver finishes position & velocity passes
    if (this.pendingLandPiece && !this.pieceRecallAnim) {
      this.landActivePiece()
    }

    // 6. Check Abyss Falls, Pin Snaps, Tower Height, Checkpoints (with 0.5s/1.5s hold), and Climax / Laser / Endless State Machine
    this.checkAbyssAndPrune()
    this.updateSettledBlocksAndHeight()
    if (this.gameMode === 'PUZZLE') {
      this.updatePuzzleLaserAndOverload(dtMs)
    } else {
      this.updateCheckpoints(dtMs)
      this.updateGoalCountdown(dtMs)
    }
    this.updateCamera(dtMs)
    this.updateNudgeEffects(dtMs)

    // 7. Export Network State Snapshot every 100ms
    this.tickSnapshots(dtMs)
  }

  /**
   * Advances the piece recall-to-spawn & transformation animation (`this.pieceRecallAnim`):
   * - `0..55ms`: Piece stops in mid-air.
   * - `55..liftDurationMs (340ms)`: Piece rises smoothly back up to the starting spawn point.
   * - `liftDurationMs (340ms)`: Applies the piece mutation (`GIANT_PIECE`, `SLICK_BRICK`, `TURBO_DROP`, `LOCK_ROTATE`).
   * - `liftDurationMs..totalDurationMs (640ms)`: Hovers at the starting point playing a transformation scale-pop & aura animation.
   */
  private updatePieceRecallAnim(dtMs: number): void {
    const anim = this.pieceRecallAnim
    if (!anim || !this.activePiece) {
      this.pieceRecallAnim = null
      return
    }

    anim.elapsedMs += dtMs

    if (anim.elapsedMs < anim.liftDurationMs) {
      const freezeMs = 55
      const rawT =
        anim.elapsedMs <= freezeMs
          ? 0
          : Math.min(
              1,
              (anim.elapsedMs - freezeMs) /
                Math.max(1, anim.liftDurationMs - freezeMs)
            )
      // Smooth cubic ease-in-out
      const ease =
        rawT < 0.5
          ? 4 * rawT * rawT * rawT
          : 1 - Math.pow(-2 * rawT + 2, 3) / 2

      const curLocalX =
        anim.startLocalX + (anim.targetLocalX - anim.startLocalX) * ease
      const curLocalY =
        anim.startLocalY + (anim.targetLocalY - anim.startLocalY) * ease
      const curAngle = anim.startAngle * (1 - ease)

      this.setBodyPositionClean(
        this.activePiece.body,
        this.offsetX + curLocalX,
        curLocalY
      )
      Body.setAngle(this.activePiece.body, curAngle)
      Body.setVelocity(this.activePiece.body, { x: 0, y: 0 })
      Body.setAngularVelocity(this.activePiece.body, 0)

      // Emit shimmering upward tractor-beam particles while elevating
      if (rawT > 0 && Math.random() < 0.65) {
        const beamColor =
          anim.powerId === 'GIANT_PIECE'
            ? '#EF4444'
            : anim.powerId === 'SLICK_BRICK'
              ? '#38BDF8'
              : anim.powerId === 'TURBO_DROP'
                ? '#F97316'
                : '#A855F7'
        this.impactParticles.push({
          x: curLocalX + (Math.random() - 0.5) * 28,
          y: curLocalY + (Math.random() - 0.5) * 16,
          vx: (Math.random() - 0.5) * 0.6,
          vy: 1.2 + Math.random() * 1.4,
          radius: 2.5 + Math.random() * 2.0,
          ageMs: 0,
          maxAgeMs: 220,
          kind: 'spark',
          color: beamColor,
        })
      }
      return
    }

    // Reached the starting point -> trigger transformation once!
    if (!anim.hasTransformed) {
      anim.hasTransformed = true
      this.setBodyPositionClean(
        this.activePiece.body,
        this.offsetX + anim.targetLocalX,
        anim.targetLocalY
      )
      Body.setAngle(this.activePiece.body, 0)
      Body.setVelocity(this.activePiece.body, { x: 0, y: 0 })
      Body.setAngularVelocity(this.activePiece.body, 0)
      this.applyPieceRecallMutation(
        anim.powerId,
        anim.targetLocalX,
        anim.targetLocalY
      )
    }

    if (!this.activePiece) {
      this.pieceRecallAnim = null
      return
    }

    // Hold at the starting point while playing the transformation pop animation
    this.setBodyPositionClean(
      this.activePiece.body,
      this.offsetX + anim.targetLocalX,
      anim.targetLocalY
    )
    Body.setAngle(this.activePiece.body, 0)
    Body.setVelocity(this.activePiece.body, { x: 0, y: 0 })
    Body.setAngularVelocity(this.activePiece.body, 0)

    if (anim.elapsedMs >= anim.totalDurationMs) {
      this.setPieceBodySensor(this.activePiece.body, false)
      this.pieceRecallAnim = null
      this.emitSnapshotNow()
    }
  }

  /**
   * Prevents compound-body position-impulse resonance (where blocks wedged in a slot
   * accumulate warm-started `positionImpulse` across frames and suddenly pop/explode)
   * and enforces velocity-neutral Super Glue welds (`solveGlueWelds`).
   */
  private stabilizePhysicsStep(): void {
    if (this.activePiece) {
      const activeBody = this.activePiece.body
      this.clearBodyPositionImpulses(activeBody)

      if (this.pieceRecallAnim) {
        // Keep the active piece pinned to its recall/transformation trajectory against gravity
        const anim = this.pieceRecallAnim
        if (anim.elapsedMs < anim.liftDurationMs) {
          const freezeMs = 55
          const rawT =
            anim.elapsedMs <= freezeMs
              ? 0
              : Math.min(
                  1,
                  (anim.elapsedMs - freezeMs) /
                    Math.max(1, anim.liftDurationMs - freezeMs)
                )
          const ease =
            rawT < 0.5
              ? 4 * rawT * rawT * rawT
              : 1 - Math.pow(-2 * rawT + 2, 3) / 2
          const curLocalX =
            anim.startLocalX + (anim.targetLocalX - anim.startLocalX) * ease
          const curLocalY =
            anim.startLocalY + (anim.targetLocalY - anim.startLocalY) * ease
          this.setBodyPositionClean(
            activeBody,
            this.offsetX + curLocalX,
            curLocalY
          )
        } else {
          this.setBodyPositionClean(
            activeBody,
            this.offsetX + anim.targetLocalX,
            anim.targetLocalY
          )
        }
        Body.setVelocity(activeBody, { x: 0, y: 0 })
        Body.setAngularVelocity(activeBody, 0)
      } else if (this.state === 'FALLING' || this.state === 'ROOF_DROP') {
        // Keep active falling piece on its exact 0.5u horizontal grid track if a lateral side-graze nudged it slightly
        const u = GAME_CONSTANTS.UNIT_PX
        const leftEdgeOffsetUnits = this.getCell0LeftEdgeOffsetUnits(
          this.activePiece,
          activeBody.angle
        )
        const curBodyXUnits = (activeBody.position.x - this.offsetX) / u
        const curLeftEdgeUnits = curBodyXUnits + leftEdgeOffsetUnits
        const snappedLeftEdgeUnits = Math.round(curLeftEdgeUnits * 2) / 2
        const gridTargetX =
          this.offsetX + (snappedLeftEdgeUnits - leftEdgeOffsetUnits) * u
        const driftPx = Math.abs(activeBody.position.x - gridTargetX)

        if (driftPx > 0.03 && driftPx <= 4.5) {
          const prevX = activeBody.position.x
          const prevY = activeBody.position.y
          this.setBodyPositionClean(activeBody, gridTargetX, prevY)
          if (this.getOverlappingTowerBodies(activeBody).length > 0) {
            this.setBodyPositionClean(activeBody, prevX, prevY)
          } else {
            Body.setVelocity(activeBody, { x: 0, y: activeBody.velocity.y })
          }
        }
      }
    }

    const isRecentNudge = this.elapsedTimeMs - this.lastNudgeAtMs < 220

    for (const piece of this.settledPieces) {
      const b = piece.body
      this.clearBodyPositionImpulses(b)

      if (b.isSleeping || b.isStatic) continue

      const maxVx = isRecentNudge ? 4.2 : 2.6
      const clampedVx = Math.max(-maxVx, Math.min(maxVx, b.velocity.x))
      // Never allow blocks in the tower to pop upward (vy < -0.35) from solver separation
      const clampedVy = Math.max(-0.35, Math.min(6.0, b.velocity.y))

      if (clampedVx !== b.velocity.x || clampedVy !== b.velocity.y) {
        Body.setVelocity(b, { x: clampedVx, y: clampedVy })
      }

      const maxAng = 0.1
      if (Math.abs(b.angularVelocity) > maxAng) {
        Body.setAngularVelocity(b, Math.sign(b.angularVelocity) * maxAng)
      }
    }

    if (this.glueWeldLinks.length > 0) {
      this.solveGlueWelds()
    }
  }

  /**
   * Velocity-neutral Rigid Weld Solver for Super Glue (`SUPER_GLUE`).
   * Uses `Body.setPosition(..., false)` and `Body.setAngle(..., false)` so position/angle
   * corrections shift `positionPrev` and `anglePrev` in lockstep—never injecting phantom
   * Verlet velocity or spinning torque!
   */
  private solveGlueWelds(): void {
    const anchoredBodies = new Set<Matter.Body>([this.baseBody])
    for (const isl of this.islands) {
      anchoredBodies.add(isl.body)
    }
    for (const p of this.settledPieces) {
      if (p.body.isStatic || p.isStaticAnchor) {
        anchoredBodies.add(p.body)
      }
    }

    // Propagate static anchorage through active glue links
    for (let pass = 0; pass < 2; pass++) {
      for (const link of this.glueWeldLinks) {
        if (link.warmupTicks > 0) continue
        if (anchoredBodies.has(link.bodyB)) {
          anchoredBodies.add(link.bodyA)
        } else if (anchoredBodies.has(link.bodyA)) {
          anchoredBodies.add(link.bodyB)
        }
      }
    }

    for (let pass = 0; pass < 2; pass++) {
      for (const link of this.glueWeldLinks) {
        const { bodyA, bodyB } = link

        // Warmup phase (first 2 ticks after landing): allow contact separation to settle cleanly
        // before locking in the exact zero-penetration local offset!
        if (link.warmupTicks > 0) {
          if (pass === 0) {
            link.warmupTicks--
            if (!bodyA.isStatic) {
              Body.setVelocity(bodyA, {
                x: bodyA.velocity.x * 0.25,
                y: Math.max(0, bodyA.velocity.y * 0.35),
              })
              Body.setAngularVelocity(bodyA, 0)
            }
            if (!bodyB.isStatic) {
              Body.setVelocity(bodyB, {
                x: bodyB.velocity.x * 0.25,
                y: Math.max(0, bodyB.velocity.y * 0.35),
              })
              Body.setAngularVelocity(bodyB, 0)
            }
            link.localOffsetFromB = this.worldToBodyLocal(
              bodyB,
              bodyA.position.x,
              bodyA.position.y
            )
            link.relativeAngle = bodyA.angle - bodyB.angle
          }
          continue
        }

        const fixedB = bodyB.isStatic || anchoredBodies.has(bodyB)
        const fixedA = bodyA.isStatic || anchoredBodies.has(bodyA)

        if (fixedB && !bodyA.isStatic) {
          const targetAngleA = bodyB.angle + link.relativeAngle
          const cosB = Math.cos(bodyB.angle)
          const sinB = Math.sin(bodyB.angle)
          const targetX =
            bodyB.position.x +
            (link.localOffsetFromB.x * cosB - link.localOffsetFromB.y * sinB)
          const targetY =
            bodyB.position.y +
            (link.localOffsetFromB.x * sinB + link.localOffsetFromB.y * cosB)

          Body.setPosition(bodyA, { x: targetX, y: targetY })
          Body.setAngle(bodyA, targetAngleA)
          Body.setVelocity(bodyA, { x: 0, y: 0 })
          Body.setAngularVelocity(bodyA, 0)
          this.clearBodyPositionImpulses(bodyA)
        } else if (fixedA && !bodyB.isStatic) {
          const targetAngleB = bodyA.angle - link.relativeAngle
          const cosB = Math.cos(targetAngleB)
          const sinB = Math.sin(targetAngleB)
          const targetX =
            bodyA.position.x -
            (link.localOffsetFromB.x * cosB - link.localOffsetFromB.y * sinB)
          const targetY =
            bodyA.position.y -
            (link.localOffsetFromB.x * sinB + link.localOffsetFromB.y * cosB)

          Body.setPosition(bodyB, { x: targetX, y: targetY })
          Body.setAngle(bodyB, targetAngleB)
          Body.setVelocity(bodyB, { x: 0, y: 0 })
          Body.setAngularVelocity(bodyB, 0)
          this.clearBodyPositionImpulses(bodyB)
        } else if (!bodyA.isStatic && !bodyB.isStatic) {
          const mA = bodyA.mass || 4
          const mB = bodyB.mass || 4
          const wA = mA / (mA + mB)
          const wB = mB / (mA + mB)

          const sharedVx =
            (wA * bodyA.velocity.x + wB * bodyB.velocity.x) * 0.85
          const sharedVy = Math.max(
            -0.1,
            (wA * bodyA.velocity.y + wB * bodyB.velocity.y) * 0.92
          )
          const rawOmega =
            (wA * bodyA.angularVelocity + wB * bodyB.angularVelocity) * 0.5
          const sharedOmega = Math.abs(rawOmega) < 0.0018 ? 0 : rawOmega

          const thetaBNew =
            wB * bodyB.angle + wA * (bodyA.angle - link.relativeAngle)
          const thetaANew = thetaBNew + link.relativeAngle
          const cosB = Math.cos(thetaBNew)
          const sinB = Math.sin(thetaBNew)

          const dx =
            link.localOffsetFromB.x * cosB - link.localOffsetFromB.y * sinB
          const dy =
            link.localOffsetFromB.x * sinB + link.localOffsetFromB.y * cosB

          const comX = wA * bodyA.position.x + wB * bodyB.position.x
          const newBX = comX - wA * dx
          const newAX = comX + wB * dx

          // Anchor vertical position to whichever body is lower (`position.y` is larger)
          // so the weld solver NEVER pushes the lower block downward into the block/pedestal beneath it!
          let newBY: number
          let newAY: number
          if (bodyB.position.y >= bodyA.position.y) {
            newBY = bodyB.position.y
            newAY = newBY + dy
          } else {
            newAY = bodyA.position.y
            newBY = newAY - dy
          }

          Body.setPosition(bodyB, { x: newBX, y: newBY })
          Body.setAngle(bodyB, thetaBNew)
          Body.setPosition(bodyA, { x: newAX, y: newAY })
          Body.setAngle(bodyA, thetaANew)

          Body.setVelocity(bodyB, { x: sharedVx, y: sharedVy })
          Body.setVelocity(bodyA, { x: sharedVx, y: sharedVy })
          Body.setAngularVelocity(bodyB, sharedOmega)
          Body.setAngularVelocity(bodyA, sharedOmega)
          this.clearBodyPositionImpulses(bodyA)
          this.clearBodyPositionImpulses(bodyB)
        }
      }
    }
  }

  private updateNudgeEffects(dtMs: number): void {
    if (this.pistonTimerMs > 0) {
      this.pistonTimerMs = Math.max(0, this.pistonTimerMs - dtMs)
    }
    if (this.shakeTimerMs > 0) {
      this.shakeTimerMs = Math.max(0, this.shakeTimerMs - dtMs)
    }
    if (this.boundaryShakeTimerMs > 0) {
      this.boundaryShakeTimerMs = Math.max(0, this.boundaryShakeTimerMs - dtMs)
    }
    if (this.mascotCastAnimMs > 0) {
      this.mascotCastAnimMs = Math.max(0, this.mascotCastAnimMs - dtMs)
      if (this.mascotCastAnimMs <= 0) {
        this.mascotCastCategory = null
      }
    }
    if (this.invulnerableRemainingMs > 0) {
      this.invulnerableRemainingMs = Math.max(
        0,
        this.invulnerableRemainingMs - dtMs
      )
    }
    if (this.fallWhiteFlashMs > 0) {
      this.fallWhiteFlashMs = Math.max(0, this.fallWhiteFlashMs - dtMs)
    }
    if (this.mascotFallReactionMs > 0) {
      this.mascotFallReactionMs = Math.max(0, this.mascotFallReactionMs - dtMs)
    }

    if (this.extraLifeBalloons.length > 0) {
      this.checkExtraLifeBalloonCatch()
      const dtSec = dtMs / 1000
      const u = GAME_CONSTANTS.UNIT_PX

      for (let i = this.extraLifeBalloons.length - 1; i >= 0; i--) {
        const balloon = this.extraLifeBalloons[i]
        balloon.ageMs += dtMs
        const lifeRatio = balloon.ageMs / balloon.maxAgeMs
        // Accelerate upward slightly in the final 30% as the balloon floats away
        const escapeBoost = lifeRatio > 0.7 ? 1 + (lifeRatio - 0.7) * 2.2 : 1
        balloon.y += balloon.vy * escapeBoost * dtSec
        balloon.x +=
          balloon.vx * dtSec +
          Math.sin(balloon.ageMs * 0.0045 + balloon.swayPhase) * 0.42

        if (balloon.ageMs >= balloon.maxAgeMs) {
          this.extraLifeBalloons.splice(i, 1)
          const calloutX = Math.max(-5.5 * u, Math.min(5.5 * u, balloon.x))
          this.spawnColoredBurst(calloutX, balloon.y, '#CBD5E1', 10)
          this.fallFeedbackCallouts.push({
            x: calloutX,
            y: balloon.y,
            startY: balloon.y,
            title: '🎈💨 BALÃO FUGIU!',
            subtitle: 'VIDA EXTRA PERDIDA',
            tone: 'EXTRA_LIFE_ESCAPED',
            ageMs: 0,
            maxAgeMs: 1450,
          })
          this.onEventBanner?.(
            '🎈💨 O Balão de Vida Extra foi embora! Você precisava encostar nele com a peça controlada.',
            'warning'
          )
        }
      }
      this.checkExtraLifeBalloonCatch()
    }

    for (let i = this.fallFeedbackCallouts.length - 1; i >= 0; i--) {
      const callout = this.fallFeedbackCallouts[i]
      callout.ageMs += dtMs
      if (callout.ageMs >= callout.maxAgeMs) {
        this.fallFeedbackCallouts.splice(i, 1)
        continue
      }
      const p = Math.min(1, callout.ageMs / callout.maxAgeMs)
      callout.y = callout.startY - (1 - Math.pow(1 - p, 2.2)) * 68
    }

    const stepFactor = dtMs / 16.667

    for (let i = this.impactParticles.length - 1; i >= 0; i--) {
      const p = this.impactParticles[i]
      p.ageMs += dtMs
      if (p.ageMs >= p.maxAgeMs) {
        this.impactParticles.splice(i, 1)
        continue
      }
      p.x += p.vx * stepFactor
      p.y += p.vy * stepFactor
      if (p.kind === 'spark') {
        p.vy += 0.14 * stepFactor
      } else if (p.kind === 'smoke') {
        p.radius += 0.12 * stepFactor
      } else if (p.kind === 'ring') {
        p.radius += 0.95 * stepFactor
      }
    }

    for (let i = this.confettiParticles.length - 1; i >= 0; i--) {
      const c = this.confettiParticles[i]
      c.ageMs += dtMs
      if (c.ageMs >= c.maxAgeMs) {
        this.confettiParticles.splice(i, 1)
        continue
      }
      c.x += c.vx * stepFactor
      c.y += c.vy * stepFactor
      c.vy += 0.11 * stepFactor
      c.vx *= 0.985
      c.angle += c.vAng * stepFactor
    }

    for (let i = this.checkpointConsumeEffects.length - 1; i >= 0; i--) {
      const fx = this.checkpointConsumeEffects[i]
      fx.ageMs += dtMs
      if (fx.ageMs >= fx.maxAgeMs) {
        this.checkpointConsumeEffects.splice(i, 1)
      }
    }

    for (let i = this.brickRemoverEffects.length - 1; i >= 0; i--) {
      const fx = this.brickRemoverEffects[i]
      fx.ageMs += dtMs
      if (fx.ageMs >= fx.maxAgeMs) {
        this.brickRemoverEffects.splice(i, 1)
      }
    }

    // 3. Atualiza a animação visual das peças que estão sumindo (200ms fade-out + scale 1.0 -> 0.3)
    for (let i = this.dissolvingBricks.length - 1; i >= 0; i--) {
      const item = this.dissolvingBricks[i]
      item.ageMs += dtMs
      item.progress = Math.min(1.0, item.ageMs / item.durationMs)
      if (item.progress >= 1.0) {
        this.dissolvingBricks.splice(i, 1)
      }
    }

    for (const vine of this.glueVines) {
      if (vine.ageMs < vine.delayMs + vine.growDurationMs + 100) {
        vine.ageMs += dtMs
      }
    }

    for (const island of this.islands) {
      if (island.spawnAgeMs < island.spawnDurationMs) {
        island.spawnAgeMs = Math.min(
          island.spawnDurationMs,
          island.spawnAgeMs + dtMs
        )
        this.pushDynamicBodiesClearOfIsland(island)
        if (
          island.spawnAgeMs >= island.spawnDurationMs &&
          island.body.isSensor
        ) {
          island.body.isSensor = false
        }
      }
    }
  }

  private updateWind(_dtMs: number): void {
    if (!this.windEnabled) {
      this.windActive = false
      this.windForce = 0
      return
    }

    const windThresholdUnits =
      this.gameMode === 'SURVIVAL'
        ? 10
        : GAME_CONSTANTS.WIND_START_HEIGHT_UNITS

    if (
      this.towerHeight >= windThresholdUnits ||
      (this.gameMode === 'SURVIVAL' && this.settledPieces.length >= 8)
    ) {
      if (!this.windActive) {
        this.windActive = true
        this.onEventBanner?.(
          this.gameMode === 'SURVIVAL'
            ? '💨 Brisa de Sobrevivência ativa no topo da torre!'
            : 'Brisa suave de altitude (15m+) ativa no topo da torre!',
          'info'
        )
      }
    }

    if (!this.windActive) {
      this.windForce = 0
      return
    }

    const t = this.elapsedTimeMs * 0.00032 + this.windPhaseOffset
    const rawWave = (Math.sin(t) * 0.65 + Math.sin(t * 1.7) * 0.35) * 0.4
    this.windForce =
      Math.abs(rawWave) < 0.06
        ? 0
        : Math.max(-0.4, Math.min(0.4, Number(rawWave.toFixed(2))))

    if (this.windForce === 0) return

    const minPieceWindHeight = this.gameMode === 'SURVIVAL' ? 8 : 14
    const u = GAME_CONSTANTS.UNIT_PX
    for (const piece of this.settledPieces) {
      if (piece.body.isSleeping || piece.body.isStatic) continue

      const pieceHeightUnits = Math.max(0, -piece.body.position.y / u)
      if (pieceHeightUnits < minPieceWindHeight) continue

      const heightFactor = Math.min(
        1.0,
        (pieceHeightUnits - minPieceWindHeight) / 16
      )
      const snappedResistance = piece.snapped ? 0.35 : 1.0
      const pushForceX =
        this.windForce *
        0.000018 *
        piece.body.mass *
        heightFactor *
        snappedResistance

      Body.applyForce(piece.body, piece.body.position, {
        x: pushForceX,
        y: 0,
      })
    }
  }

  /**
   * 2. Verifica todas as peças da torre a cada frame para sumir se invadirem a Zona de Desintegração Lateral
   * (`KILL_ZONE_X = ±8.5` unidades) ou caírem na água / abaixo da Linha de Petrificação (`petrifyLineY` no modo ENDLESS).
   * Também realiza Garbage Collection de blocos estáticos muito abaixo da câmera para manter 60fps com 500+ peças.
   */
  private checkAbyssAndPrune(): void {
    const u = GAME_CONSTANTS.UNIT_PX
    const isEndlessWithAbyss =
      this.gameMode === 'ENDLESS' && this.petrifyLineHeightUnits > 0.1
    const petrifyWorldY = -this.petrifyLineHeightUnits * u
    const abyssPhysY = isEndlessWithAbyss
      ? Math.min(4.5 * u, petrifyWorldY + 1.15 * u)
      : 4.5 * u
    const waterSurfaceY = isEndlessWithAbyss
      ? Math.min(2.8 * u, petrifyWorldY + 0.25 * u)
      : 2.8 * u

    // Garbage Collection (Limpeza de Memória no modo ENDLESS):
    // Qualquer bloco estático totalmente abaixo da borda inferior da câmera (cameraBottomY + 150px)
    // é removido do mundo físico para rodar liso mesmo com 500+ peças no SCORE!
    if (this.gameMode === 'ENDLESS' && this.cameraCenterHeightUnits > 8) {
      const cameraBottomWorldY =
        -(this.cameraCenterHeightUnits - 6.5) * u + 150
      for (let i = this.settledPieces.length - 1; i >= 0; i--) {
        const piece = this.settledPieces[i]
        const body = piece.body
        if (body.isStatic && body.bounds.min.y > cameraBottomWorldY) {
          for (let j = this.glueWeldLinks.length - 1; j >= 0; j--) {
            const link = this.glueWeldLinks[j]
            if (link.bodyA === body || link.bodyB === body) {
              this.glueWeldLinks.splice(j, 1)
            }
          }
          for (let j = this.glueVines.length - 1; j >= 0; j--) {
            const v = this.glueVines[j]
            if (v.bodyA === body || v.bodyB === body) {
              this.glueVines.splice(j, 1)
            }
          }
          World.remove(this.engine.world, body)
          this.settledPieces.splice(i, 1)
        }
      }
    }

    if (this.activePiece && this.activePiece.body.position.y > abyssPhysY) {
      // If the Castle Roof in ROOF_DROP somehow missed the tower completely, snap it onto the top of the tower and win!
      if (
        this.state === 'ROOF_DROP' ||
        this.activePiece.powerEffect === 'CASTLE_ROOF'
      ) {
        const roof = this.activePiece
        this.activePiece = null
        const topX = this.getHighestBlockCenterX()
        const topY = -this.towerHeight * u - 0.9 * u
        this.setBodyPositionClean(roof.body, topX, topY)
        this.landCastleRoofAndWin(roof)
        return
      }

      const activeLocalX = this.activePiece.body.position.x - this.offsetX
      if (this.gameMode === 'ENDLESS') {
        this.activePiece.isStaticAnchor = true
        this.dissolvingBricks.push({
          body: this.activePiece.body,
          piece: this.activePiece,
          progress: 0,
          ageMs: 0,
          durationMs: 280,
          startX: activeLocalX,
          startY: this.activePiece.body.position.y,
          angle: this.activePiece.body.angle,
          reason: 'WATER',
        })
        this.spawnColoredBurst(activeLocalX, waterSurfaceY, '#475569', 10)
      } else {
        this.spawnWaterSplashParticles(activeLocalX, waterSurfaceY)
      }

      World.remove(this.engine.world, this.activePiece.body)
      this.activePiece = null
      this.isSoftDropping = false
      this.state = 'RESPAWN_DELAY'
      this.respawnDelayRemainingMs =
        this.gameMode === 'PUZZLE' ? 280 : GAME_CONSTANTS.RESPAWN_PENALTY_MS
      this.handleSurvivalOrRaceLifeLoss('ACTIVE_WATER', activeLocalX, waterSurfaceY)
    }

    let settledLostReason: 'SETTLED_WATER' | 'SETTLED_LATERAL' | null = null
    let settledLostLocalX = 0
    let settledLostLocalY = waterSurfaceY

    for (let i = this.settledPieces.length - 1; i >= 0; i--) {
      const piece = this.settledPieces[i]
      const body = piece.body

      // Ignora a base estática, ilhas flutuantes e blocos-âncora/petrificados estáticos
      if (body.isStatic) continue

      const localX = body.position.x - this.offsetX
      const outLeft = localX < -this.KILL_LIMIT_X
      const outRight = localX > this.KILL_LIMIT_X
      const outBottom =
        body.position.y > 4.5 * u ||
        (isEndlessWithAbyss &&
          body.position.y > abyssPhysY &&
          body.velocity.y > 0.35)

      if (outLeft || outRight || outBottom) {
        for (let j = this.glueWeldLinks.length - 1; j >= 0; j--) {
          const link = this.glueWeldLinks[j]
          if (link.bodyA === body || link.bodyB === body) {
            this.glueWeldLinks.splice(j, 1)
          }
        }
        for (let j = this.glueVines.length - 1; j >= 0; j--) {
          const v = this.glueVines[j]
          if (v.bodyA === body || v.bodyB === body) {
            this.glueVines.splice(j, 1)
          }
        }

        // No modo ENDLESS, peça solta que cai abaixo de petrifyLineY é pintada de cinza escuro, perde colisão e despenca no abismo!
        if (this.gameMode === 'ENDLESS') {
          piece.isStaticAnchor = true
        }

        // A. Desativa a colisão imediatamente e remove do mundo físico para não interferir em mais nada
        body.isSensor = true
        World.remove(this.engine.world, body)
        this.settledPieces.splice(i, 1)

        // B. Registra para fazer a animação de sumiço (Dissolve / Fade-out + Shrink 1.0 -> 0.3 em 200ms)
        this.dissolvingBricks.push({
          body,
          piece,
          progress: 0,
          ageMs: 0,
          durationMs: GAME_CONSTANTS.DISSOLVE_DURATION_MS,
          startX: localX,
          startY: body.position.y,
          angle: body.angle,
          reason: outBottom ? 'WATER' : 'LATERAL',
        })

        // C. Efeito de partículas: estrelinhas/poeira na borda lateral ou splash na água/abismo
        if (outLeft || outRight) {
          this.spawnVaporizeParticles(
            localX,
            body.position.y,
            outLeft ? -1 : 1
          )
        } else if (outBottom) {
          if (this.gameMode === 'ENDLESS') {
            this.spawnColoredBurst(localX, waterSurfaceY, '#475569', 10)
          } else {
            this.spawnWaterSplashParticles(localX, waterSurfaceY)
          }
        }

        settledLostReason = outBottom ? 'SETTLED_WATER' : 'SETTLED_LATERAL'
        settledLostLocalX = localX
        settledLostLocalY = outBottom ? waterSurfaceY : body.position.y
      }
    }

    if (settledLostReason) {
      this.handleSurvivalOrRaceLifeLoss(
        settledLostReason,
        settledLostLocalX,
        settledLostLocalY
      )
    }
  }

  /**
   * Handles life/score deduction, 3-second blinking invulnerability, white flash feedback,
   * and Wizard shock reaction when a piece falls into the abyss or disintegrates laterally.
   */
  private handleSurvivalOrRaceLifeLoss(
    reason: 'ACTIVE_WATER' | 'SETTLED_WATER' | 'SETTLED_LATERAL',
    dropLocalX: number = 0,
    dropLocalY: number = 0
  ): void {
    if (this.gameMode === 'PUZZLE') {
      this.handlePuzzleWaterDrop(reason, dropLocalX, dropLocalY)
      return
    }

    const u = GAME_CONSTANTS.UNIT_PX
    const calloutStartX = Math.max(-5.5 * u, Math.min(5.5 * u, dropLocalX))
    const calloutStartY = Math.min(-1.2 * u, dropLocalY - 1.2 * u)

    if (this.gameMode === 'ENDLESS') {
      if (this.state === 'GAME_OVER' || this.state === 'VICTORY') return

      this.endlessScore = Math.max(0, this.endlessScore - 1)
      this.consecutiveAbyssFalls += 1
      this.fallWhiteFlashMs = 740
      this.mascotFallReactionMs = 2100
      this.shakeTimerMs = 190
      this.lastFallFeedbackAtMs = this.elapsedTimeMs
      this.playCountdownAbortedBuzzer()
      this.spawnColoredBurst(calloutStartX, dropLocalY, '#94A3B8', 12)
      this.fallFeedbackCallouts.push({
        x: calloutStartX,
        y: calloutStartY,
        startY: calloutStartY,
        title: '🪨 -1 PONTO NO ABISMO!',
        subtitle: `QUEDAS SEGUIDAS: ${this.consecutiveAbyssFalls}/${GAME_CONSTANTS.ENDLESS_MAX_CONSECUTIVE_FALLS}`,
        tone: 'LIFE_LOSS',
        ageMs: 0,
        maxAgeMs: 1550,
      })
      this.onLifeLost?.()

      if (
        this.consecutiveAbyssFalls >=
        GAME_CONSTANTS.ENDLESS_MAX_CONSECUTIVE_FALLS
      ) {
        this.triggerEndlessGameOver(
          'COLAPSO DA BASE ATIVA (5 PEÇAS PERDIDAS SEGUIDAS NO ABISMO)!'
        )
        return
      }

      this.onEventBanner?.(
        `🪨 -1 Ponto! Peça caiu no Abismo (Score: ${this.endlessScore} • Quedas seguidas: ${this.consecutiveAbyssFalls}/${GAME_CONSTANTS.ENDLESS_MAX_CONSECUTIVE_FALLS})`,
        'danger'
      )
      this.emitSnapshotNow()
      return
    }

    if (this.gameMode === 'RACE') {
      if (reason === 'ACTIVE_WATER') {
        this.fallWhiteFlashMs = 740
        this.mascotFallReactionMs = 2100
        this.shakeTimerMs = 190
        this.lastFallFeedbackAtMs = this.elapsedTimeMs
        this.playCountdownAbortedBuzzer()
        this.spawnColoredBurst(calloutStartX, dropLocalY, '#FFFFFF', 12)
        this.fallFeedbackCallouts.push({
          x: calloutStartX,
          y: calloutStartY,
          startY: calloutStartY,
          title: '⚠️ PEÇA CAIU!',
          subtitle: '⏱️ +1.0s PENALIDADE',
          tone: 'PIECE_DROP',
          ageMs: 0,
          maxAgeMs: 1450,
        })
        this.onLifeLost?.()
        this.onEventBanner?.(
          'Peça Ativa caiu no Abismo! Penalidade de +1.0s no Spawn!',
          'danger'
        )
        this.emitSnapshotNow()
      } else if (this.elapsedTimeMs - this.lastFallFeedbackAtMs >= 650) {
        this.lastFallFeedbackAtMs = this.elapsedTimeMs
        this.fallWhiteFlashMs = Math.max(this.fallWhiteFlashMs, 640)
        this.mascotFallReactionMs = Math.max(this.mascotFallReactionMs, 1850)
        this.shakeTimerMs = Math.max(this.shakeTimerMs, 150)
        this.spawnColoredBurst(calloutStartX, dropLocalY, '#FFFFFF', 10)
        this.fallFeedbackCallouts.push({
          x: calloutStartX,
          y: calloutStartY,
          startY: calloutStartY,
          title: '⚠️ BLOCO CAIU!',
          subtitle: 'SEGURE A TORRE!',
          tone: 'PIECE_DROP',
          ageMs: 0,
          maxAgeMs: 1350,
        })
      }
      return
    }

    if (this.state === 'GAME_OVER' || this.state === 'VICTORY') {
      return
    }

    // 3-Second Invulnerability Window: while blinking invulnerable, falling blocks do NOT deduct lives!
    if (
      this.invulnerableRemainingMs > 0 ||
      this.elapsedTimeMs - this.lastLifeLossAtMs <
        GAME_CONSTANTS.SURVIVAL_LIFE_LOSS_COOLDOWN_MS
    ) {
      if (this.elapsedTimeMs - this.lastFallFeedbackAtMs >= 520) {
        this.lastFallFeedbackAtMs = this.elapsedTimeMs
        this.spawnColoredBurst(calloutStartX, dropLocalY, '#38BDF8', 8)
        this.fallFeedbackCallouts.push({
          x: calloutStartX,
          y: calloutStartY,
          startY: calloutStartY,
          title: '🛡️ PROTEGIDO!',
          subtitle: `INVULNERÁVEL ${(this.invulnerableRemainingMs / 1000).toFixed(1)}s`,
          tone: 'SHIELD_PROTECTED',
          ageMs: 0,
          maxAgeMs: 1150,
        })
      }
      return
    }

    this.lastLifeLossAtMs = this.elapsedTimeMs
    this.lastFallFeedbackAtMs = this.elapsedTimeMs
    this.lives = Math.max(0, this.lives - 1)
    this.invulnerableRemainingMs =
      this.lives > 0 ? GAME_CONSTANTS.SURVIVAL_LIFE_LOSS_COOLDOWN_MS : 0
    this.fallWhiteFlashMs = 780
    this.mascotFallReactionMs = 2500
    this.playCountdownAbortedBuzzer()
    this.shakeTimerMs = 250
    this.spawnColoredBurst(calloutStartX, dropLocalY, '#FFFFFF', 14)
    this.spawnColoredBurst(calloutStartX, dropLocalY, '#F43F5E', 10)
    this.fallFeedbackCallouts.push({
      x: calloutStartX,
      y: calloutStartY,
      startY: calloutStartY,
      title: '💔 -1 VIDA!',
      subtitle:
        this.lives > 0 ? '🛡️ 3.0s INVULNERÁVEL!' : '💀 FIM DE JOGO!',
      tone: 'LIFE_LOSS',
      ageMs: 0,
      maxAgeMs: 1750,
    })
    this.onLifeLost?.()

    if (this.lives <= 0) {
      this.triggerSurvivalGameOver()
      return
    }

    const heartsDisplay =
      '❤️'.repeat(this.lives) +
      '🖤'.repeat(Math.max(0, this.maxLives - this.lives))
    const reasonText =
      reason === 'ACTIVE_WATER'
        ? 'Peça caiu na água!'
        : reason === 'SETTLED_WATER'
          ? 'Bloco da torre caiu na água!'
          : 'Bloco da torre desintegrou na lateral!'
    this.onEventBanner?.(
      `💔 -1 VIDA! ${reasonText} 🛡️ Invulnerável por 3s para estabilizar! (${heartsDisplay})`,
      'danger'
    )
    this.emitSnapshotNow()
  }

  /**
   * Ends the match in `ENDLESS` mode (either from losing 5 pieces in a row into the abyss
   * or having 100% of the tower swallowed below the Rising Abyss line).
   */
  public triggerEndlessGameOver(reasonMessage: string): void {
    if (this.state === 'GAME_OVER' || this.state === 'VICTORY') return

    this.updateSettledBlocksAndHeight()
    this.lives = 0
    const finalScore = this.endlessScore
    this.survivalFinalPiecesCount = finalScore

    if (this.activePiece) {
      const lx = this.activePiece.body.position.x - this.offsetX
      const ly = this.activePiece.body.position.y
      this.spawnMagicSmokePoof(lx, ly)
      World.remove(this.engine.world, this.activePiece.body)
      this.activePiece = null
    }
    if (this.heldActivePiece) {
      World.remove(this.engine.world, this.heldActivePiece.body)
      this.heldActivePiece = null
    }

    this.pieceRecallAnim = null
    this.extraLifeBalloons = []
    this.isSoftDropping = false
    this.pendingLandPiece = false
    this.goalCountdownMs = null
    this.state = 'GAME_OVER'

    this.emitSnapshotNow()
    this.onGameOver?.(
      this.elapsedTimeMs,
      this.maxTowerHeight,
      finalScore
    )
    this.onEventBanner?.(
      `💀 FIM DE JOGO! ${reasonMessage} • SCORE FINAL: ${finalScore} • Altura Máx: ${this.maxTowerHeight.toFixed(1)}m`,
      'danger'
    )
  }

  /**
   * Endless / Rising Abyss Mode ("Infinito / Abismo") per-tick state machine:
   * - Singleplayer: 3 moving vertical zones (Zone 1: Petrification Line `petrifyLineY`, Zone 2: Active Construction Zone,
   *   Zone 3: Checkpoint Flags `nextEndlessCheckpointUnits` with 1.5s hold that advances +8m and grants 1 Positive Power).
   * - Multiplayer ("Abismo Ascendente"): After 5s preparation, `petrifyLineY` rises continuously at 0.4 blocks/sec,
   *   entering Overload ("ABISMO ACELERANDO!") at 90s (+25% speed every 15s) and locking at 150s (2m30s) to declare
   *   the surviving player with the highest tower as winner!
   */
  private updateEndlessMode(dtMs: number): void {
    if (
      this.state === 'GAME_OVER' ||
      this.state === 'VICTORY' ||
      this.state === 'ROOF_DROP' ||
      this.state === 'COUNTDOWN'
    ) {
      return
    }

    const u = GAME_CONSTANTS.UNIT_PX
    const isMultiplayer =
      !this.isSinglePlayer && this.remoteLanesToRender.length > 0

    // 1. Update Petrification / Rising Abyss Line height (`petrifyLineHeightUnits`)
    if (isMultiplayer) {
      if (this.elapsedTimeMs >= GAME_CONSTANTS.ENDLESS_MAX_MATCH_TIME_MS) {
        if (!this.isAbyssMaxTimeLocked) {
          this.isAbyssMaxTimeLocked = true
          // Compare highest stabilized tower among surviving players at the 150s final whistle!
          const aliveRemotes = this.remoteLanesToRender.filter(
            (r) => !r.isEliminated && r.lives > 0
          )
          const maxRemoteHeight = aliveRemotes.reduce(
            (max, r) => Math.max(max, r.towerHeight),
            0
          )
          if (this.towerHeight >= maxRemoteHeight) {
            this.onEventBanner?.(
              `⏱️ TEMPO LIMITE (2m30s)! Feixe de Medição: SUA TORRE É A MAIS ALTA (${this.towerHeight.toFixed(1)}m)!`,
              'success'
            )
            this.triggerSurvivalCastleClimax()
          } else {
            this.triggerEndlessGameOver(
              `TEMPO LIMITE (2m30s)! Torre mais alta adversária: ${maxRemoteHeight.toFixed(1)}m`
            )
          }
          return
        }
      } else if (this.elapsedTimeMs >= GAME_CONSTANTS.ENDLESS_ABYSS_PREP_MS) {
        let speedUnitsPerSec =
          GAME_CONSTANTS.ENDLESS_ABYSS_BASE_SPEED_UNITS_PER_SEC
        if (this.elapsedTimeMs >= GAME_CONSTANTS.ENDLESS_OVERTIME_START_MS) {
          this.isAbyssOvertime = true
          const overtimeStep = Math.floor(
            (this.elapsedTimeMs - GAME_CONSTANTS.ENDLESS_OVERTIME_START_MS) /
              GAME_CONSTANTS.ENDLESS_OVERTIME_STEP_MS
          )
          speedUnitsPerSec *= Math.pow(1.25, overtimeStep + 1)
          if (overtimeStep > this.lastOvertimeStepNotified) {
            this.lastOvertimeStepNotified = overtimeStep
            const pctBoost = Math.round((Math.pow(1.25, overtimeStep + 1) - 1) * 100)
            this.onEventBanner?.(
              `⚡ ABISMO ACELERANDO! Velocidade de subida +${pctBoost}%!`,
              'danger'
            )
          }
        }
        this.targetPetrifyLineHeightUnits += speedUnitsPerSec * (dtMs / 1000)
        this.petrifyLineHeightUnits = this.targetPetrifyLineHeightUnits
      }
    } else {
      // Singleplayer: smooth lerp toward targetPetrifyLineHeightUnits (+8m per checkpoint)
      this.petrifyLineHeightUnits +=
        (this.targetPetrifyLineHeightUnits - this.petrifyLineHeightUnits) *
        Math.min(1, dtMs * 0.0045)
    }

    // 2. Herança de Terreno (Dynamic Petrification below petrifyLineY):
    // Any settled piece whose center of mass (body.position.y) falls below petrifyLineY is frozen at its exact angle
    // (Body.setStatic(body, true)), receiving gray stone texture (isStaticAnchor = true).
    if (this.petrifyLineHeightUnits > 0.05) {
      const petrifyWorldY = -this.petrifyLineHeightUnits * u
      for (const piece of this.settledPieces) {
        const body = piece.body
        if (body.isStatic) continue
        if (body.position.y >= petrifyWorldY && body.velocity.y <= 1.6) {
          Body.setVelocity(body, { x: 0, y: 0 })
          Body.setAngularVelocity(body, 0)
          Body.setStatic(body, true)
          piece.isStaticAnchor = true
          piece.isPetrified = true
          piece.snapped = true
          this.spawnColoredBurst(
            body.position.x - this.offsetX,
            body.position.y,
            '#94A3B8',
            5
          )
        }
      }
    }

    this.updateSettledBlocksAndHeight()

    // 3. Eliminação Instantânea (Totalmente Consumido pelo Abismo):
    // Se a linha do abismo já subiu acima da ilha inicial (>= 2.2m) e 100% dos blocos da torre ficaram abaixo da linha
    // (sem nenhuma superfície no topo acima da linha para apoiar a próxima peça), o jogador é eliminado!
    if (
      this.petrifyLineHeightUnits >= 2.2 &&
      this.towerHeight < this.petrifyLineHeightUnits - 0.15
    ) {
      this.triggerEndlessGameOver(
        isMultiplayer
          ? 'ENGOLIDO PELA NÉVOA DO ABISMO ASCENDENTE!'
          : 'COLAPSO TOTAL DA BASE ATIVA ABAIXO DA LINHA DE PETRIFICAÇÃO!'
      )
      return
    }

    // 4. Zona 3 — As Bandeiras de Checkpoint (1.5s = 1500ms hold):
    const cp = this.nextEndlessCheckpointUnits
    if (this.towerHeight >= cp) {
      if (this.checkpointHoldTarget !== cp) {
        this.checkpointHoldTarget = cp
        this.checkpointHoldTimerMs = 0
      }
      this.checkpointHoldTimerMs += dtMs

      if (
        this.checkpointHoldTimerMs >= GAME_CONSTANTS.ENDLESS_CHECKPOINT_HOLD_MS
      ) {
        this.checkpointsReached.push(cp)
        this.endlessCheckpointsCount += 1
        this.checkpointHoldTarget = null
        this.checkpointHoldTimerMs = 0

        this.checkpointConsumeEffects.push({
          heightUnits: cp,
          ageMs: 0,
          maxAgeMs: 950,
        })
        for (let x = -160; x <= 160; x += 32) {
          this.spawnColoredBurst(x, -cp * u, '#38BDF8', 4)
        }

        // Advance checkpointLineY by +8m; in Singleplayer also advance petrifyLineY by +8m!
        this.nextEndlessCheckpointUnits = cp + GAME_CONSTANTS.ENDLESS_STEP_UNITS
        if (!isMultiplayer) {
          this.targetPetrifyLineHeightUnits = Math.max(
            0,
            this.nextEndlessCheckpointUnits - 9.5
          )
        }

        // Grant 1 Positive Power in the mascot's bubble (BRICK_REMOVER, STATIC_BRICK, SUPER_GLUE, or SIDE_ISLAND)
        const excludePositive: PowerId[] = ['EXTRA_LIFE']
        if (this.hasSpawnedSideIsland) excludePositive.push('SIDE_ISLAND')
        const rolled = rollCheckpointPowers(
          !isMultiplayer,
          () => this.randomizer.nextFloat(),
          excludePositive
        )
        this.inventoryPower = {
          selfPower: rolled.selfPower.id,
          attackPower: rolled.attackPower ? rolled.attackPower.id : null,
          sourceCheckpoint: cp,
        }

        // Every 3 checkpoints, trigger a light weather event (lateral wind gust or occasional ice/giant piece)
        let weatherSuffix = ''
        if (this.endlessCheckpointsCount % 3 === 0) {
          if (this.randomizer.nextFloat() < 0.5) {
            this.windActive = true
            weatherSuffix = ' • 💨 Rajada de Vento Lateral Ativa!'
          } else if (this.randomizer.nextFloat() < 0.5) {
            this.slickBrickRemaining = Math.max(this.slickBrickRemaining, 1)
            weatherSuffix = ' • 🧊 Clima Glacial (Peça de Gelo)!'
          } else {
            const stableGiantTypes: PieceType[] = ['I', 'O', 'T', 'L', 'J']
            const gType =
              stableGiantTypes[
                Math.floor(this.randomizer.nextFloat() * stableGiantTypes.length)
              ]
            this.giantPieceRemaining = Math.max(this.giantPieceRemaining, 1)
            this.randomizer.enqueueCustomPiece({
              type: gType,
              variant: 'GIANT',
              label: `🦣 Anomalia Climática: Mega-Bloco 2x "${gType}"!`,
            })
            weatherSuffix = ' • 🦣 Anomalia Climática (Peça Gigante)!'
          }
        }

        this.onEventBanner?.(
          `🚩 Checkpoint ${cp}m validado! Base petrificada (+8m) • Poder: [Espaço] ${rolled.selfPower.icon} ${rolled.selfPower.shortName}${weatherSuffix}`,
          'success'
        )
        this.emitSnapshotNow()
      }
    } else {
      this.checkpointHoldTarget = null
      this.checkpointHoldTimerMs = 0
    }
  }

  /**
   * Transitions the instance into `GAME_OVER` when all 3 lives are lost in `SURVIVAL` mode.
   * All active and settled pieces dissolve/disappear cleanly.
   */
  public triggerSurvivalGameOver(): void {
    if (this.state === 'GAME_OVER' || this.state === 'VICTORY') return

    this.updateSettledBlocksAndHeight()
    const finalPieces = this.settledPieces.length
    this.survivalFinalPiecesCount = finalPieces

    if (this.activePiece) {
      const lx = this.activePiece.body.position.x - this.offsetX
      const ly = this.activePiece.body.position.y
      this.spawnMagicSmokePoof(lx, ly)
      World.remove(this.engine.world, this.activePiece.body)
      this.activePiece = null
    }
    if (this.heldActivePiece) {
      World.remove(this.engine.world, this.heldActivePiece.body)
      this.heldActivePiece = null
    }

    this.glueWeldLinks = []
    this.glueVines = []
    for (let i = this.settledPieces.length - 1; i >= 0; i--) {
      const piece = this.settledPieces[i]
      const body = piece.body
      const localX = body.position.x - this.offsetX
      body.isSensor = true
      World.remove(this.engine.world, body)
      this.dissolvingBricks.push({
        body,
        piece,
        progress: 0,
        ageMs: 0,
        durationMs: 360,
        startX: localX,
        startY: body.position.y,
        angle: body.angle,
        reason: 'LATERAL',
      })
    }
    this.settledPieces = []

    this.pieceRecallAnim = null
    this.extraLifeBalloons = []
    this.isSoftDropping = false
    this.pendingLandPiece = false
    this.goalCountdownMs = null
    this.state = 'GAME_OVER'

    this.emitSnapshotNow()
    this.onGameOver?.(
      this.elapsedTimeMs,
      this.maxTowerHeight,
      finalPieces
    )
    this.onEventBanner?.(
      `💀 FIM DE JOGO! Suas vidas acabaram! Peças empilhadas: ${finalPieces}/${GAME_CONSTANTS.SURVIVAL_GOAL_PIECES} • Altura Máx: ${this.maxTowerHeight.toFixed(1)}m`,
      'danger'
    )
  }

  /**
   * Triggers the Castle Roof Climax (`ROOF_DROP`) in `SURVIVAL` mode when the player wins
   * (either as the Last Player Standing when all opponents lose their lives, or by reaching 50 pieces).
   * Active falling pieces and queue pieces disappear in magic smoke, existing tower blocks lock static,
   * and the Castle Roof (`CASTLE_ROOF`) spawns on the winner's tower so they can place it to finish the game!
   */
  public triggerSurvivalCastleClimax(): void {
    if (this.state === 'ROOF_DROP' || this.state === 'VICTORY') return

    if (this.state === 'GAME_OVER') {
      this.lives = Math.max(1, this.lives)
    }

    this.survivalFinalPiecesCount = this.settledPieces.length
    this.pieceRecallAnim = null
    this.respawnDelayRemainingMs = 0
    this.settlingTimerMs = 0
    this.pendingLandPiece = false
    this.extraLifeBalloons = []
    this.blindManualRemainingMs = 0
    this.invulnerableRemainingMs = 999999
    this.inventoryPower = {
      selfPower: null,
      attackPower: null,
      sourceCheckpoint: null,
    }

    // Lock the survivor's existing tower blocks as Static so the tower stays solid for the Castle Roof!
    for (const p of this.settledPieces) {
      Body.setVelocity(p.body, { x: 0, y: 0 })
      Body.setAngularVelocity(p.body, 0)
      Body.setStatic(p.body, true)
      p.snapped = true
    }
    this.updateSettledBlocksAndHeight()

    this.spawnCastleRoof()
    this.onEventBanner?.(
      '🏰 FIM DE JOGO! Último sobrevivente — posicione o Castelo na sua torre para vencer!',
      'success'
    )
  }

  /**
   * Triggers `VICTORY` in `SURVIVAL` mode by spawning the Castle Roof climax (`triggerSurvivalCastleClimax`).
   */
  public triggerSurvivalVictory(): void {
    this.triggerSurvivalCastleClimax()
  }

  /**
   * Puzzle Mode ("Abaixo do Laser") Water Drop Penalty (`+0.5 Bloco na Base`):
   * Whenever an active or settled piece falls into the water (or disintegrates laterally),
   * queues a smooth `+0.5` block (`16px`) upward rise of the player's narrow island base toward the `9m` laser,
   * animating the earth and all stacked pieces smoothly before the next falling block spawns!
   */
  private handlePuzzleWaterDrop(
    reason: 'ACTIVE_WATER' | 'SETTLED_WATER' | 'SETTLED_LATERAL',
    dropLocalX: number = 0,
    dropLocalY: number = 0
  ): void {
    // Ao queimar uma peça no laser (LASER_OVERLOAD ou após), a torre/base NÃO pode mais subir mesmo se cair alguma peça na água!
    if (
      this.isPetrified ||
      this.state === 'LASER_OVERLOAD' ||
      this.puzzleLaserBurnPhaseMs > 0 ||
      this.laserOverloadRemainingMs !== null ||
      this.state === 'PETRIFIED_WAITING' ||
      this.state === 'PUZZLE_COUNTING' ||
      this.state === 'VICTORY' ||
      this.state === 'GAME_OVER'
    ) {
      return
    }

    const u = GAME_CONSTANTS.UNIT_PX
    const riseUnits = GAME_CONSTANTS.PUZZLE_BASE_RISE_UNITS // 0.5 block

    this.puzzleBaseRiseTargetUnits = Number(
      (this.puzzleBaseRiseTargetUnits + riseUnits).toFixed(2)
    )
    this.pendingPuzzleBaseRiseUnits = Math.max(
      0,
      this.puzzleBaseRiseTargetUnits - this.puzzleBaseRiseUnits
    )

    // Hold the next block spawn until the smooth earth-rising animation finishes!
    if (
      !this.activePiece &&
      (this.state === 'SPAWNING' ||
        this.state === 'SETTLING' ||
        this.state === 'RESPAWN_DELAY')
    ) {
      this.state = 'RESPAWN_DELAY'
      this.respawnDelayRemainingMs = Math.max(this.respawnDelayRemainingMs, 660)
    }

    const calloutStartX = Math.max(-5.5 * u, Math.min(5.5 * u, dropLocalX))
    const calloutStartY = Math.min(-1.2 * u, dropLocalY - 1.2 * u)

    this.fallWhiteFlashMs = 680
    this.mascotFallReactionMs = 1950
    this.shakeTimerMs = 190
    this.lastFallFeedbackAtMs = this.elapsedTimeMs
    this.playCountdownAbortedBuzzer()
    this.spawnColoredBurst(calloutStartX, dropLocalY, '#38BDF8', 12)
    this.spawnColoredBurst(calloutStartX, dropLocalY, '#EF4444', 8)

    this.fallFeedbackCallouts.push({
      x: calloutStartX,
      y: calloutStartY,
      startY: calloutStartY,
      title: '🌊 +0.5 BLOCO NA BASE!',
      subtitle: `ILHA SUBINDO (+${this.puzzleBaseRiseTargetUnits.toFixed(1)}m) → LASER!`,
      tone: 'PIECE_DROP',
      ageMs: 0,
      maxAgeMs: 1550,
    })

    this.onLifeLost?.()
    const dropLabel =
      reason === 'ACTIVE_WATER' ? 'Peça caiu na água!' : 'Bloco caiu na água!'
    this.onEventBanner?.(
      `🌊 ${dropLabel} Sua ilha está subindo +0.5 bloco (+${this.puzzleBaseRiseTargetUnits.toFixed(1)}m) em direção ao Laser (9m)!`,
      'warning'
    )

    this.emitSnapshotNow()
  }

  /**
   * Smoothly animates the island base (`this.baseBody`), floating side islands, and all settled blocks
   * upward when `pendingPuzzleBaseRiseUnits > 0` before the next piece spawns.
   */
  private updatePuzzleBaseRiseAnimation(dtMs: number): void {
    // Se já queimou peça no laser, trava imediatamente qualquer subida da base/torre
    if (
      this.isPetrified ||
      this.state === 'LASER_OVERLOAD' ||
      this.puzzleLaserBurnPhaseMs > 0 ||
      this.laserOverloadRemainingMs !== null ||
      this.state === 'PETRIFIED_WAITING' ||
      this.state === 'PUZZLE_COUNTING' ||
      this.state === 'VICTORY'
    ) {
      this.pendingPuzzleBaseRiseUnits = 0
      this.puzzleBaseRiseTargetUnits = Number(
        this.puzzleBaseRiseUnits.toFixed(2)
      )
      return
    }

    if (this.pendingPuzzleBaseRiseUnits <= 0.0001) return

    const u = GAME_CONSTANTS.UNIT_PX
    const speedMult = Math.max(
      0.7,
      Math.min(1.65, this.pendingPuzzleBaseRiseUnits / 0.32)
    )
    const stepUnits = Math.min(
      this.pendingPuzzleBaseRiseUnits,
      (GAME_CONSTANTS.PUZZLE_BASE_RISE_UNITS / 580) * dtMs * speedMult
    )
    const deltaY = -stepUnits * u

    this.puzzleBaseRiseUnits += stepUnits
    this.pendingPuzzleBaseRiseUnits = Math.max(
      0,
      this.pendingPuzzleBaseRiseUnits - stepUnits
    )

    if (this.pendingPuzzleBaseRiseUnits <= 0.0008) {
      this.puzzleBaseRiseUnits = this.puzzleBaseRiseTargetUnits
      this.pendingPuzzleBaseRiseUnits = 0
    }

    if (this.baseBody) {
      Body.setPosition(this.baseBody, {
        x: this.baseBody.position.x,
        y: this.baseBody.position.y + deltaY,
      })
    }
    for (const isl of this.islands) {
      Body.setPosition(isl.body, {
        x: isl.body.position.x,
        y: isl.body.position.y + deltaY,
      })
      isl.y = Number((isl.y + stepUnits).toFixed(3))
    }
    for (const p of this.settledPieces) {
      this.setBodyPositionClean(
        p.body,
        p.body.position.x,
        p.body.position.y + deltaY
      )
    }

    // Subtle rising water/earth foam particles at the base while the island smoothly rises
    if (Math.random() < 0.38) {
      const rx = (Math.random() - 0.5) * 4.2 * u
      const ry = (0.8 - this.puzzleBaseRiseUnits) * u
      this.impactParticles.push({
        x: rx,
        y: ry,
        vx: (Math.random() - 0.5) * 1.4,
        vy: -0.6 - Math.random() * 1.1,
        radius: 2.0 + Math.random() * 2.2,
        ageMs: 0,
        maxAgeMs: 220 + Math.random() * 90,
        kind: 'spark',
        color: Math.random() < 0.6 ? '#38BDF8' : '#86EFAC',
      })
    }

    this.updateSettledBlocksAndHeight()
  }

  /**
   * Returns `true` in `PUZZLE` mode while the island earth is still smoothly rising (`pendingPuzzleBaseRiseUnits > 0`)
   * or while an unbalanced block is actively plummeting below the island toward the water, so the next block only
   * spawns AFTER the earth finishes its smooth upward animation!
   */
  private isPuzzleWaitingForWaterOrBaseRise(): boolean {
    if (this.gameMode !== 'PUZZLE') return false
    if (this.pendingPuzzleBaseRiseUnits > 0.0005) return true

    const u = GAME_CONSTANTS.UNIT_PX
    const baseBottomThresholdY = (0.75 - this.puzzleBaseRiseUnits) * u
    for (const p of this.settledPieces) {
      if (p.body.isStatic) continue
      if (p.body.position.y > baseBottomThresholdY && p.body.velocity.y > 1.05) {
        return true
      }
    }
    return false
  }

  /**
   * Immediately shines and burns a settled piece that touched the 9m laser line,
   * removing it from the physics world and starting its bright incandescent laser disintegration.
   */
  private burnSettledPieceInLaser(indexInSettled: number): void {
    const piece = this.settledPieces[indexInSettled]
    if (!piece) return
    const body = piece.body

    for (let j = this.glueWeldLinks.length - 1; j >= 0; j--) {
      const link = this.glueWeldLinks[j]
      if (link.bodyA === body || link.bodyB === body) {
        this.glueWeldLinks.splice(j, 1)
      }
    }
    for (let j = this.glueVines.length - 1; j >= 0; j--) {
      const v = this.glueVines[j]
      if (v.bodyA === body || v.bodyB === body) {
        this.glueVines.splice(j, 1)
      }
    }

    const localX = body.position.x - this.offsetX
    const localY = body.position.y
    piece.isLaserBurning = true
    body.isSensor = true
    World.remove(this.engine.world, body)
    this.settledPieces.splice(indexInSettled, 1)

    this.dissolvingBricks.push({
      body,
      piece,
      progress: 0,
      ageMs: 0,
      durationMs: 440,
      startX: localX,
      startY: localY,
      angle: body.angle,
      reason: 'LASER',
    })

    // Intense incandescent flash + sparks at the laser burn point
    this.spawnColoredBurst(localX, localY, '#FFFFFF', 10)
    this.spawnColoredBurst(localX, localY, '#FEF08A', 12)
    this.spawnColoredBurst(localX, localY, '#EF4444', 14)
    this.impactParticles.push({
      x: localX,
      y: localY,
      vx: 0,
      vy: 0,
      radius: 16,
      ageMs: 0,
      maxAgeMs: 320,
      kind: 'ring',
    })
    this.shakeTimerMs = 190
    this.playCountdownAbortedBuzzer()
  }

  /**
   * Puzzle Mode ("Abaixo do Laser" - 9m) Laser Contact, Instant Burn, 3-Second Post-Burn Countdown & Petrification:
   * 1. Active falling pieces (`this.activePiece`) pass through the `9m` laser beam freely while controlled.
   * 2. If a placed/settled piece (`this.settledPieces`) touches or crosses the `9m` laser line, it INSTANTLY
   *    shines brightly and burns (`burnSettledPieceInLaser` over `440ms`).
   * 3. The 3-second countdown (`3, 2, 1`) ONLY starts counting AFTER the piece finishes burning!
   * 4. After the 3 seconds pass (`laserOverloadRemainingMs <= 0`), all remaining pieces below the laser turn into solid grey stone!
   */
  private updatePuzzleLaserAndOverload(dtMs: number): void {
    if (
      this.isPetrified ||
      this.state === 'PETRIFIED_WAITING' ||
      this.state === 'PUZZLE_COUNTING' ||
      this.state === 'VICTORY' ||
      this.state === 'GAME_OVER' ||
      this.state === 'COUNTDOWN'
    ) {
      return
    }

    const u = GAME_CONSTANTS.UNIT_PX
    const laserWorldY = -GAME_CONSTANTS.PUZZLE_LASER_HEIGHT_UNITS * u // -288px (9m)

    // Check if repeated water drops pushed the island base itself up to the 9m laser
    const maxBaseElev = Math.max(0, ...this.currentBasePreset.elevations)
    const baseTopUnits = maxBaseElev + 1 + this.puzzleBaseRiseUnits
    if (baseTopUnits >= GAME_CONSTANTS.PUZZLE_LASER_HEIGHT_UNITS) {
      this.pendingPuzzleBaseRiseUnits = 0
      this.puzzleBaseRiseTargetUnits = Number(
        this.puzzleBaseRiseUnits.toFixed(2)
      )
      this.triggerPuzzleLaserBurnAndPetrify()
      return
    }

    // 1. Check if any settled/placed piece touched the 9m laser — if so, it INSTANTLY shines and burns!
    let burnedAnyThisTick = false
    for (let i = this.settledPieces.length - 1; i >= 0; i--) {
      const piece = this.settledPieces[i]
      const body = piece.body
      let minPartY = Infinity
      for (let k = 1; k < body.parts.length; k++) {
        const part = body.parts[k]
        if (part.bounds.min.y < minPartY) {
          minPartY = part.bounds.min.y
        }
      }

      if (minPartY <= laserWorldY + 1.5) {
        this.burnSettledPieceInLaser(i)
        burnedAnyThisTick = true
      }
    }

    if (burnedAnyThisTick) {
      // Ao queimar a peça, a base/torre para de subir imediatamente!
      this.pendingPuzzleBaseRiseUnits = 0
      this.puzzleBaseRiseTargetUnits = Number(
        this.puzzleBaseRiseUnits.toFixed(2)
      )
      this.updateSettledBlocksAndHeight()

      // Clear any active or held falling piece so no more pieces drop
      if (this.activePiece) {
        const lx = this.activePiece.body.position.x - this.offsetX
        const ly = this.activePiece.body.position.y
        this.spawnMagicSmokePoof(lx, ly)
        World.remove(this.engine.world, this.activePiece.body)
        this.activePiece = null
      }
      if (this.heldActivePiece) {
        World.remove(this.engine.world, this.heldActivePiece.body)
        this.heldActivePiece = null
      }

      this.isSoftDropping = false
      this.pendingLandPiece = false

      if (this.state !== 'LASER_OVERLOAD') {
        this.state = 'LASER_OVERLOAD'
        // Wait for the piece's bright 440ms laser burn animation to finish BEFORE starting the 3s countdown!
        this.puzzleLaserBurnPhaseMs = 440
        this.laserOverloadRemainingMs = null
        this.emitSnapshotNow()
      } else if (this.laserOverloadRemainingMs === null) {
        this.puzzleLaserBurnPhaseMs = Math.max(this.puzzleLaserBurnPhaseMs, 440)
      }
    }

    // 2. If in LASER_OVERLOAD: first finish the piece burn phase, then count down 3 seconds, then petrify into stone!
    if (this.state === 'LASER_OVERLOAD') {
      if (this.puzzleLaserBurnPhaseMs > 0) {
        this.puzzleLaserBurnPhaseMs = Math.max(
          0,
          this.puzzleLaserBurnPhaseMs - dtMs
        )
        if (
          this.puzzleLaserBurnPhaseMs <= 0 &&
          this.laserOverloadRemainingMs === null
        ) {
          this.laserOverloadRemainingMs =
            GAME_CONSTANTS.PUZZLE_LASER_OVERLOAD_MS
          this.emitSnapshotNow()
        }
      } else if (this.laserOverloadRemainingMs !== null) {
        this.laserOverloadRemainingMs = Math.max(
          0,
          this.laserOverloadRemainingMs - dtMs
        )
        if (this.laserOverloadRemainingMs <= 0) {
          this.triggerPuzzleLaserBurnAndPetrify()
        }
      }
    }
  }

  /**
   * Cancels the laser overload if needed (kept for compatibility).
   */
  private abortPuzzleLaserOverload(): void {
    this.laserOverloadRemainingMs = null
    this.puzzleLaserBurnPhaseMs = 0
    for (const p of this.settledPieces) {
      p.isLaserBurning = false
    }
    this.state = 'SPAWNING'
    this.emitSnapshotNow()
  }

  /**
   * Executed when the 3-second post-burn countdown reaches `0.0s`:
   * 1. Any remaining settled piece touching the `9m` laser line is burned and discounted.
   * 2. All remaining pieces below the laser immediately petrify into static grey stone (`isPetrified = true`).
   * 3. Transitions to `PUZZLE_COUNTING` (if Solo or all Multiplayer lanes are petrified) or `PETRIFIED_WAITING` ("FINALIZADO").
   */
  public triggerPuzzleLaserBurnAndPetrify(): void {
    if (this.isPetrified) return

    const u = GAME_CONSTANTS.UNIT_PX
    const laserWorldY = -GAME_CONSTANTS.PUZZLE_LASER_HEIGHT_UNITS * u

    if (this.activePiece) {
      World.remove(this.engine.world, this.activePiece.body)
      this.activePiece = null
    }
    if (this.heldActivePiece) {
      World.remove(this.engine.world, this.heldActivePiece.body)
      this.heldActivePiece = null
    }

    for (let i = this.settledPieces.length - 1; i >= 0; i--) {
      const piece = this.settledPieces[i]
      const body = piece.body
      let minPartY = Infinity
      for (let k = 1; k < body.parts.length; k++) {
        if (body.parts[k].bounds.min.y < minPartY) {
          minPartY = body.parts[k].bounds.min.y
        }
      }

      if (piece.isLaserBurning || minPartY <= laserWorldY + 1.5) {
        this.burnSettledPieceInLaser(i)
      }
    }

    // Petrify all remaining valid pieces below the laser into static grey stone
    for (const p of this.settledPieces) {
      p.isPetrified = true
      p.isLaserBurning = false
      p.snapped = true
      Body.setVelocity(p.body, { x: 0, y: 0 })
      Body.setAngularVelocity(p.body, 0)
      Body.setStatic(p.body, true)
      this.spawnColoredBurst(
        p.body.position.x - this.offsetX,
        p.body.position.y,
        '#CBD5E1',
        5
      )
    }

    this.isPetrified = true
    this.puzzleLaserBurnPhaseMs = 0
    this.laserOverloadRemainingMs = null
    this.pieceRecallAnim = null
    this.isSoftDropping = false
    this.pendingLandPiece = false
    this.inventoryPower = {
      selfPower: null,
      attackPower: null,
      sourceCheckpoint: null,
    }
    this.survivalFinalPiecesCount = this.settledPieces.length
    this.countedPieces = this.settledPieces.length
    this.shakeTimerMs = 240
    this.playCountdownAbortedBuzzer()
    this.updateSettledBlocksAndHeight()

    const allRemotesPetrified =
      this.isSinglePlayer ||
      this.remoteLanesToRender.length === 0 ||
      this.remoteLanesToRender.every((r) => r.isPetrified || r.isEliminated)

    if (allRemotesPetrified) {
      this.startPuzzleCountingPhase()
    } else {
      this.state = 'PETRIFIED_WAITING'
      this.onEventBanner?.(
        `🪨 FINALIZADO! Torre petrificada com ${this.settledPieces.length} peças válidas — aguardando oponentes...`,
        'warning'
      )
      this.emitSnapshotNow()
    }
  }

  /**
   * Starts the synchronized bottom-to-top piece counting animation (`PUZZLE_COUNTING`)
   * once all players in the match have petrified.
   */
  public startPuzzleCountingPhase(): void {
    if (this.state === 'PUZZLE_COUNTING' || this.state === 'VICTORY') return

    this.state = 'PUZZLE_COUNTING'
    this.puzzleCountTimerMs = 0
    this.puzzlePostCountDelayMs = 0
    this.countedPieces = 0

    // Sort valid petrified pieces from bottom (largest world Y) to top (smallest world Y)
    this.puzzleSortedCountPieces = [...this.settledPieces].sort((a, b) => {
      const dy = b.body.position.y - a.body.position.y
      if (Math.abs(dy) > 4) return dy
      return a.body.position.x - b.body.position.x
    })

    for (const p of this.settledPieces) {
      p.isCountedHighlight = false
      p.countOrderNumber = undefined
    }

    for (const lane of this.remoteLanesToRender) {
      lane.countedPieces = 0
      lane.settledBlocks.sort((a, b) => a.y - b.y)
      for (const blk of lane.settledBlocks) {
        blk.isCountedHighlight = false
        blk.countOrderNumber = undefined
      }
    }

    this.onEventBanner?.(
      '🔢 APURAÇÃO FINAL! Contando peças válidas abaixo do Laser de baixo para cima...',
      'info'
    )
    this.emitSnapshotNow()
  }

  /**
   * Steps the bottom-to-top piece counting animation (`PUZZLE_COUNTING` -> `VICTORY`).
   */
  private updatePuzzleCountingPhase(dtMs: number): void {
    this.puzzleCountTimerMs += dtMs
    const stepMs = GAME_CONSTANTS.PUZZLE_COUNT_STEP_MS
    const targetStepCount = Math.floor(this.puzzleCountTimerMs / stepMs)

    const maxRemotePieces = this.remoteLanesToRender.reduce(
      (max, r) => Math.max(max, r.settledBlocks.length),
      0
    )
    const maxTotalPieces = Math.max(
      this.puzzleSortedCountPieces.length,
      maxRemotePieces
    )

    while (
      this.countedPieces < targetStepCount &&
      this.countedPieces < this.puzzleSortedCountPieces.length
    ) {
      const idx = this.countedPieces
      const piece = this.puzzleSortedCountPieces[idx]
      this.countedPieces = idx + 1
      if (piece) {
        piece.isCountedHighlight = true
        piece.countOrderNumber = this.countedPieces
        this.spawnColoredBurst(
          piece.body.position.x - this.offsetX,
          piece.body.position.y,
          '#FACC15',
          8
        )
      }
    }

    for (const lane of this.remoteLanesToRender) {
      const laneCount = Math.min(lane.settledBlocks.length, targetStepCount)
      lane.countedPieces = laneCount
      for (let i = 0; i < lane.settledBlocks.length; i++) {
        lane.settledBlocks[i].isCountedHighlight = i < laneCount
        lane.settledBlocks[i].countOrderNumber =
          i < laneCount ? i + 1 : undefined
      }
    }

    if (targetStepCount >= maxTotalPieces) {
      this.puzzlePostCountDelayMs += dtMs
      if (this.puzzlePostCountDelayMs >= 1600) {
        const finalCount = this.settledPieces.length
        this.countedPieces = finalCount
        this.survivalFinalPiecesCount = finalCount
        const u = GAME_CONSTANTS.UNIT_PX
        this.spawnVictoryConfetti(0, -Math.max(2, this.towerHeight) * u, 48)
        this.playVictoryFanfareSound()
        this.state = 'VICTORY'
        this.emitSnapshotNow()
        this.onVictory?.(this.elapsedTimeMs, finalCount)
        this.onEventBanner?.(
          `🏆 CONTAGEM FINALIZADA! Você encaixou ${finalCount} peça(s) abaixo do Laser!`,
          'success'
        )
      }
    }
  }

  /**
   * Solta 4 partículas pequenas de "poeira/estrelinhas de plástico" + anel de vaporização
   * na borda lateral (±7.5u) onde a peça física da torre se desintegrou.
   */
  private spawnVaporizeParticles(
    localX: number,
    localY: number,
    sideDir: -1 | 1
  ): void {
    this.impactParticles.push({
      x: localX,
      y: localY,
      vx: 0,
      vy: 0,
      radius: 6,
      ageMs: 0,
      maxAgeMs: 200,
      kind: 'ring',
    })

    // 4 estrelinhas/faíscas de plástico branco-azulado na borda onde sumiu
    for (let i = 0; i < 4; i++) {
      const angle =
        (sideDir === -1 ? 0 : Math.PI) + (Math.random() - 0.5) * Math.PI * 0.9
      const speed = 1.2 + Math.random() * 2.0
      this.impactParticles.push({
        x: localX + (Math.random() - 0.5) * 10,
        y: localY + (Math.random() - 0.5) * 10,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed - 0.4,
        radius: 2.2 + Math.random() * 1.4,
        ageMs: 0,
        maxAgeMs: 190 + Math.random() * 50,
        kind: 'spark',
        color: i % 2 === 0 ? '#FFFFFF' : '#E0F2FE',
      })
    }

    // 3 nuvenzinhas pequenas de poeira de plástico
    for (let i = 0; i < 3; i++) {
      this.impactParticles.push({
        x: localX + (Math.random() - 0.5) * 12,
        y: localY + (Math.random() - 0.5) * 12,
        vx: -sideDir * (0.3 + Math.random() * 0.7),
        vy: -0.35 - Math.random() * 0.6,
        radius: 3.8 + Math.random() * 2.5,
        ageMs: 0,
        maxAgeMs: 200,
        kind: 'smoke',
      })
    }
  }

  /**
   * Efeito de splash de água quando uma peça cai na água lá embaixo (`KILL_ZONE_Y`).
   */
  private spawnWaterSplashParticles(
    localX: number,
    waterSurfaceY: number
  ): void {
    this.impactParticles.push({
      x: localX,
      y: waterSurfaceY,
      vx: 0,
      vy: 0,
      radius: 7,
      ageMs: 0,
      maxAgeMs: 240,
      kind: 'ring',
    })

    for (let i = 0; i < 7; i++) {
      const spread = -Math.PI / 2 + (Math.random() - 0.5) * 1.15
      const speed = 2.0 + Math.random() * 2.4
      this.impactParticles.push({
        x: localX + (Math.random() - 0.5) * 16,
        y: waterSurfaceY,
        vx: Math.cos(spread) * speed,
        vy: Math.sin(spread) * speed,
        radius: 2.2 + Math.random() * 1.5,
        ageMs: 0,
        maxAgeMs: 220 + Math.random() * 80,
        kind: 'spark',
        color: i % 2 === 0 ? '#E0F2FE' : '#7DD3FC',
      })
    }

    for (let i = 0; i < 3; i++) {
      this.impactParticles.push({
        x: localX + (Math.random() - 0.5) * 18,
        y: waterSurfaceY + 2,
        vx: (Math.random() - 0.5) * 1.2,
        vy: -0.5 - Math.random() * 0.6,
        radius: 4.5 + Math.random() * 2.5,
        ageMs: 0,
        maxAgeMs: 220,
        kind: 'smoke',
      })
    }
  }

  private getHighestBlockCenterX(): number {
    if (this.settledPieces.length === 0) return this.offsetX
    let highestPiece = this.settledPieces[0]
    let minY = Infinity
    for (const p of this.settledPieces) {
      if (p.body.bounds.min.y < minY) {
        minY = p.body.bounds.min.y
        highestPiece = p
      }
    }
    return highestPiece.body.position.x
  }

  private updateSettledBlocksAndHeight(): void {
    const u = GAME_CONSTANTS.UNIT_PX
    let maxRestingHeightUnits = 0
    const isRecentNudge = this.elapsedTimeMs - this.lastNudgeAtMs < 180
    const slideParams = this.getSlidePhysicsParams()

    for (const piece of this.settledPieces) {
      const body = piece.body
      if (!body.isSleeping && !body.isStatic) {
        this.evaluatePinSnapForPiece(piece)

        // Active Anti-Slide & Wobble Stabilization scaled by `this.slideLevel`
        // (Disabled for SLICK_BRICK so soapy pieces slide freely on any tilt!)
        if (
          piece.powerEffect !== 'SLICK_BRICK' &&
          !isRecentNudge &&
          slideParams.grip > 0.02 &&
          body.position.y < u
        ) {
          const nearestRightAngleRad =
            Math.round(body.angle / (Math.PI / 2)) * (Math.PI / 2)
          const angleErrorDeg =
            (Math.abs(body.angle - nearestRightAngleRad) * 180) / Math.PI
          const speed = Matter.Vector.magnitude(body.velocity)
          const isVerticalBar =
            piece.type === 'I' && Math.abs(Math.sin(nearestRightAngleRad)) > 0.7

          if (
            angleErrorDeg <= slideParams.maxDampAngleDeg &&
            Math.abs(body.velocity.x) < 2.2
          ) {
            const dampX = piece.snapped
              ? slideParams.dampXSnapped
              : slideParams.dampXUnsnapped
            const baseDampAng = piece.snapped
              ? slideParams.dampAngSnapped
              : slideParams.dampAngUnsnapped
            const dampAng = isVerticalBar ? baseDampAng * 0.65 : baseDampAng
            Body.setVelocity(body, {
              x: body.velocity.x * dampX,
              y: body.velocity.y,
            })
            Body.setAngularVelocity(body, body.angularVelocity * dampAng)

            // Keep upright vertical "I" pillars ("em pé") from developing solver micro-wobble on a flat support
            if (
              isVerticalBar &&
              angleErrorDeg > 0.04 &&
              angleErrorDeg <= 2.6 * slideParams.grip &&
              Math.abs(body.velocity.x) < 0.65 &&
              this.isPieceSupportedBelow(body)
            ) {
              const correctedAngle =
                body.angle +
                (nearestRightAngleRad - body.angle) * (0.32 * slideParams.grip)
              Body.setAngle(body, correctedAngle)
            }
          }

          if (
            speed < 0.26 * slideParams.grip &&
            Math.abs(body.angularVelocity) < 0.022 * slideParams.grip &&
            angleErrorDeg <= slideParams.pinSnapAngleDeg
          ) {
            const microDamp = 1.0 - 0.8 * slideParams.grip
            Body.setVelocity(body, {
              x: body.velocity.x * microDamp,
              y: body.velocity.y * (1.0 - 0.35 * slideParams.grip),
            })
            Body.setAngularVelocity(body, body.angularVelocity * microDamp)
          }
        }
      }

      const speed = Matter.Vector.magnitude(body.velocity)
      const isStabilized =
        body.isStatic ||
        (speed < 2.8 &&
          Math.abs(body.angularVelocity) < 0.12 &&
          body.position.y < u)

      if (isStabilized) {
        let minPartY = Infinity
        for (let i = 1; i < body.parts.length; i++) {
          const part = body.parts[i]
          if (part.bounds.min.y < minPartY) {
            minPartY = part.bounds.min.y
          }
        }
        const topUnits = -minPartY / u
        if (topUnits > maxRestingHeightUnits) {
          maxRestingHeightUnits = topUnits
        }
      }
    }

    this.towerHeight = Math.max(0, Number(maxRestingHeightUnits.toFixed(1)))
    if (this.towerHeight > this.maxTowerHeight) {
      this.maxTowerHeight = this.towerHeight
    }
  }

  /**
   * Checkpoint Trigger Rule (`8m, 16m, 24m` in RACE, extended + piece milestones in SURVIVAL):
   * - A settled piece must stabilize crossing the line for at least 0.5 second (`500ms`).
   * - Once triggered, the line glows, dissolves, and grants a rolled Power into the Single-Slot Inventory
   *   (overwriting any unspent power). Each checkpoint line only rewards once per match.
   */
  private updateCheckpoints(dtMs: number): void {
    // In SURVIVAL mode, also grant a checkpoint power every 10 stabilized pieces (10, 20, 30, 40)
    // so wide/low survival towers receive helpful powers (including the Extra Life Balloon!) too!
    if (this.gameMode === 'SURVIVAL') {
      const pieceMilestones = [10, 20, 30, 40]
      const currentCount = this.settledPieces.length
      const nextPieceCp = pieceMilestones.find(
        (m) =>
          currentCount >= m &&
          !this.survivalPieceCheckpointsReached.includes(m)
      )
      if (nextPieceCp !== undefined) {
        this.survivalPieceCheckpointsReached.push(nextPieceCp)
        const excludePositive: PowerId[] = []
        if (this.hasSpawnedSideIsland) excludePositive.push('SIDE_ISLAND')
        if (
          this.lives >= this.maxLives ||
          this.lives > 2 ||
          this.extraLifeBalloons.length > 0 ||
          this.inventoryPower.selfPower === 'EXTRA_LIFE'
        ) {
          excludePositive.push('EXTRA_LIFE')
        }
        const rolled = rollCheckpointPowers(
          true,
          () => this.randomizer.nextFloat(),
          excludePositive
        )
        this.inventoryPower = {
          selfPower: rolled.selfPower.id,
          attackPower: rolled.attackPower ? rolled.attackPower.id : null,
          sourceCheckpoint: nextPieceCp,
        }
        this.onEventBanner?.(
          `★ Marco de ${nextPieceCp} Peças! [Espaço] ${rolled.selfPower.icon} ${rolled.selfPower.shortName} (Bom) | [C] ${rolled.attackPower?.icon} ${rolled.attackPower?.shortName} (Caos)`,
          'success'
        )
        this.emitSnapshotNow()
      }
    }

    const checkpoints =
      this.gameMode === 'SURVIVAL' ? [8, 16, 24, 32, 40, 48, 56] : [8, 16, 24]
    const nextUnreached = checkpoints.find(
      (cp) => !this.checkpointsReached.includes(cp)
    )

    if (!nextUnreached || this.towerHeight < nextUnreached) {
      this.checkpointHoldTarget = null
      this.checkpointHoldTimerMs = 0
      return
    }

    if (this.checkpointHoldTarget !== nextUnreached) {
      this.checkpointHoldTarget = nextUnreached
      this.checkpointHoldTimerMs = 0
    }

    this.checkpointHoldTimerMs += dtMs

    if (this.checkpointHoldTimerMs >= GAME_CONSTANTS.CHECKPOINT_HOLD_MS) {
      const cp = nextUnreached
      this.checkpointsReached.push(cp)
      this.checkpointHoldTarget = null
      this.checkpointHoldTimerMs = 0

      // Visual line dissolution & golden sparkles across the checkpoint line
      this.checkpointConsumeEffects.push({
        heightUnits: cp,
        ageMs: 0,
        maxAgeMs: 950,
      })
      const u = GAME_CONSTANTS.UNIT_PX
      for (let x = -160; x <= 160; x += 32) {
        this.spawnColoredBurst(x, -cp * u, '#FACC15', 3)
      }

      // Roll Checkpoint Power(s): Good Power (light bubble) + Chaos Power (dark red bubble) on the mascot!
      // Once the player has used SIDE_ISLAND (`hasSpawnedSideIsland === true`), remove SIDE_ISLAND from future Checkpoint rolls!
      const excludePositive: PowerId[] = []
      if (this.hasSpawnedSideIsland) excludePositive.push('SIDE_ISLAND')
      if (
        this.gameMode !== 'SURVIVAL' ||
        this.lives >= this.maxLives ||
        this.lives > 2 ||
        this.extraLifeBalloons.length > 0 ||
        this.inventoryPower.selfPower === 'EXTRA_LIFE'
      ) {
        excludePositive.push('EXTRA_LIFE')
      }
      const rolled = rollCheckpointPowers(
        true,
        () => this.randomizer.nextFloat(),
        excludePositive
      )
      this.inventoryPower = {
        selfPower: rolled.selfPower.id,
        attackPower: rolled.attackPower ? rolled.attackPower.id : null,
        sourceCheckpoint: cp,
      }

      this.onEventBanner?.(
        `★ Checkpoint ${cp}m! [Espaço] ${rolled.selfPower.icon} ${rolled.selfPower.shortName} (Bom) | [C] ${rolled.attackPower?.icon} ${rolled.attackPower?.shortName} (Caos)`,
        'success'
      )
      this.emitSnapshotNow()
    }
  }

  private goalThresholdHeightUnits: number = GAME_CONSTANTS.GOAL_HEIGHT_UNITS

  /**
   * Finish Line Climax State Machine (`GOAL_COUNTDOWN` -> `COUNTDOWN_ABORTED` or `ROOF_DROP` -> `VICTORY`):
   * - In `SURVIVAL` mode: bypasses the 30m finish line; reaching `SURVIVAL_GOAL_PIECES` (50 pieces) triggers `triggerSurvivalVictory()`.
   * - In `RACE` mode:
   *   - State A (`GOAL_COUNTDOWN`): Triggered when `towerHeight >= 30m`. Freezes and hides `activePiece` in
   *     `heldActivePiece` with a magic smoke poof, zooms camera in, and runs a 3.0s stability test.
   *   - State B (`COUNTDOWN_ABORTED`): If the tower slips below 30m before 0.0s, plays "Bzzzt!", cancels timer,
   *     and restores `heldActivePiece` at the top so the player resumes without losing their piece.
   *   - State C (`ROOF_DROP`): When the 3.0s timer reaches 0.0s, discards `heldActivePiece` and spawns the
   *     3x3 Castle Roof (`CASTLE_ROOF`), which auto-welds on contact, locks the tower static, and triggers `VICTORY`.
   */
  private updateGoalCountdown(dtMs: number): void {
    if (
      this.state === 'ROOF_DROP' ||
      this.state === 'VICTORY' ||
      this.state === 'GAME_OVER'
    ) {
      return
    }

    if (this.state === 'GOAL_COUNTDOWN') {
      const heldAboveThreshold =
        this.towerHeight >= this.goalThresholdHeightUnits

      // 1. Check if the tower slipped or collapsed below the threshold during the 3-second countdown
      if (!heldAboveThreshold) {
        this.abortGoalCountdown()
        return
      }

      // 2. Decrement the 3-second timer
      this.goalCountdownMs = Math.max(
        0,
        (this.goalCountdownMs ?? GAME_CONSTANTS.GOAL_HOLD_MS) - dtMs
      )

      // 3. When it reaches 0.0s without falling, spawn the Castle Roof (`ROOF_DROP`)!
      if (this.goalCountdownMs <= 0) {
        this.spawnCastleRoof()
      }
      return
    }

    // Survival Mode (3 Vidas): no 30m finish line; reaching 50 stabilized pieces wins!
    if (this.gameMode === 'SURVIVAL') {
      if (
        this.lives > 0 &&
        this.settledPieces.length >= GAME_CONSTANTS.SURVIVAL_GOAL_PIECES
      ) {
        this.triggerSurvivalVictory()
      }
      return
    }

    // Normal Race Mode gameplay states: if the tower reaches 30m, enter State A (`GOAL_COUNTDOWN`)!
    if (this.towerHeight >= GAME_CONSTANTS.GOAL_HEIGHT_UNITS) {
      this.startGoalCountdown(false)
    }
  }

  /**
   * Enters State A (`GOAL_COUNTDOWN`): freezes and hides the active piece in `heldActivePiece`,
   * spawns magic plastic smoke, and starts the 3.0-second equilibrium countdown.
   */
  public startGoalCountdown(isDevTest: boolean = false): void {
    if (this.state === 'GOAL_COUNTDOWN' || this.state === 'ROOF_DROP') return

    this.goalThresholdHeightUnits = isDevTest
      ? Math.max(0, this.towerHeight - 0.2)
      : GAME_CONSTANTS.GOAL_HEIGHT_UNITS
    this.state = 'GOAL_COUNTDOWN'
    this.goalCountdownMs = GAME_CONSTANTS.GOAL_HOLD_MS
    this.isSoftDropping = false
    this.pendingLandPiece = false

    // Freeze and hide the piece the player was controlling (`heldActivePiece`)
    if (this.activePiece) {
      const piece = this.activePiece
      this.activePiece = null
      const lx = piece.body.position.x - this.offsetX
      const ly = piece.body.position.y
      this.spawnMagicSmokePoof(lx, ly)

      Body.setVelocity(piece.body, { x: 0, y: 0 })
      Body.setAngularVelocity(piece.body, 0)
      Matter.Sleeping.set(piece.body, true)
      World.remove(this.engine.world, piece.body)
      this.heldActivePiece = piece
    }

    this.onEventBanner?.(
      '🏁 LINHA DE CHEGADA! Peça guardada — segure o equilíbrio por 3 segundos!',
      'warning'
    )
    this.emitSnapshotNow()
  }

  /**
   * State B (`COUNTDOWN_ABORTED`): triggered when the tower slips below 30m before the 3.0s timer reaches zero.
   * Plays "Bzzzt!", cancels countdown, and restores `heldActivePiece` at the top of the screen.
   */
  public abortGoalCountdown(): void {
    this.goalCountdownMs = null
    this.playCountdownAbortedBuzzer()
    this.shakeTimerMs = 135

    if (this.heldActivePiece) {
      const held = this.heldActivePiece
      this.heldActivePiece = null
      const u = GAME_CONSTANTS.UNIT_PX
      const spawnY =
        -(Math.max(0, this.towerHeight) + GAME_CONSTANTS.SPAWN_OFFSET_UNITS) * u

      this.setBodyPositionClean(held.body, held.body.position.x, spawnY)
      Body.setVelocity(held.body, { x: 0, y: 0 })
      Body.setAngularVelocity(held.body, 0)
      Matter.Sleeping.set(held.body, false)
      World.add(this.engine.world, held.body)

      this.spawnMagicSmokePoof(held.body.position.x - this.offsetX, spawnY)
      this.activePiece = held
      this.state = 'FALLING'
    } else {
      this.state = 'SPAWNING'
    }

    this.onEventBanner?.(
      '❌ Bzzzt! A torre cedeu antes do zero! Sua peça guardada voltou ao topo!',
      'danger'
    )
    this.emitSnapshotNow()
  }

  /**
   * Enters State C (`ROOF_DROP`): discards `heldActivePiece` and spawns the 3x3 Castle Roof (`CASTLE_ROOF`).
   */
  public spawnCastleRoof(): void {
    this.state = 'ROOF_DROP'
    this.goalCountdownMs = null
    this.isSoftDropping = false
    this.pieceRecallAnim = null
    this.extraLifeBalloons = []

    // If called while an activePiece was falling, make it vanish in a magic smoke poof!
    if (this.activePiece) {
      const lx = this.activePiece.body.position.x - this.offsetX
      const ly = this.activePiece.body.position.y
      this.spawnMagicSmokePoof(lx, ly)
      World.remove(this.engine.world, this.activePiece.body)
      this.activePiece = null
    }
    // Discard heldActivePiece from memory
    this.heldActivePiece = null

    const u = GAME_CONSTANTS.UNIT_PX
    const spawnHeightUnits =
      Math.max(0, this.towerHeight) + GAME_CONSTANTS.SPAWN_OFFSET_UNITS
    const topXUnits = (this.getHighestBlockCenterX() - this.offsetX) / u

    const roof = this.createCastleRoofEntity(topXUnits, spawnHeightUnits)
    this.activePiece = roof
    World.add(this.engine.world, roof.body)
    this.spawnMagicSmokePoof(
      roof.body.position.x - this.offsetX,
      roof.body.position.y
    )

    this.onEventBanner?.(
      '🏰 HORA DO TELHADO! Posicione o Telhado de Castelo no topo da sua torre!',
      'success'
    )
    this.emitSnapshotNow()
  }

  private updateCamera(dtMs: number): void {
    const u = GAME_CONSTANTS.UNIT_PX
    const isClimax =
      this.state === 'GOAL_COUNTDOWN' || this.state === 'ROOF_DROP'
    const isMultiplayer =
      !this.isSinglePlayer && this.remoteLanesToRender.length > 0

    let lowestPlayerHeight = this.towerHeight
    let highestVisibleUnits = Math.max(
      this.towerHeight + GAME_CONSTANTS.SPAWN_OFFSET_UNITS + 2.0,
      this.activePiece
        ? Math.max(0, -this.activePiece.body.position.y / u) + 2.0
        : 0
    )

    if (isMultiplayer) {
      const activeRemotes = this.remoteLanesToRender.filter(
        (r) => !r.isEliminated
      )
      for (const r of activeRemotes) {
        if (r.towerHeight < lowestPlayerHeight) {
          lowestPlayerHeight = r.towerHeight
        }
        const rTop = Math.max(
          r.towerHeight + GAME_CONSTANTS.SPAWN_OFFSET_UNITS + 2.0,
          r.activePiece ? Math.max(0, r.activePiece.y) + 2.0 : 0
        )
        if (rTop > highestVisibleUnits) {
          highestVisibleUnits = rTop
        }
      }
    }

    // Regra Multiplayer: a tela acompanha sempre o jogador que estiver mais embaixo (lowestPlayerHeight)
    const refLowHeight = isMultiplayer ? lowestPlayerHeight : this.towerHeight
    const baseVerticalPan =
      refLowHeight <= 6
        ? refLowHeight * 0.58
        : 3.48 + (refLowHeight - 6) * 0.94
    const targetPanUnits =
      this.gameMode === 'PUZZLE'
        ? 1.8
        : this.gameMode === 'ENDLESS'
          ? Math.max(baseVerticalPan, this.petrifyLineHeightUnits + 3.2)
          : !isMultiplayer && isClimax
            ? Math.max(baseVerticalPan, this.towerHeight - 8.5)
            : baseVerticalPan

    if (this.gameMode === 'PUZZLE') {
      // No Modo Quebra-Cabeça a tela fica SEMPRE fixa, sem nunca subir
      this.cameraCenterHeightUnits = 1.8
    } else {
      const lerpFactor = Math.min(1, dtMs * 0.0055)
      this.cameraCenterHeightUnits +=
        (targetPanUnits - this.cameraCenterHeightUnits) * lerpFactor
    }

    const targetParallaxX = this.activePiece
      ? Math.max(
          -56,
          Math.min(
            56,
            -(this.activePiece.body.position.x - this.offsetX) * 0.45
          )
        )
      : 0
    this.cameraParallaxX +=
      (targetParallaxX - this.cameraParallaxX) * Math.min(1, dtMs * 0.007)

    let targetZoom =
      this.state === 'GOAL_COUNTDOWN'
        ? 1.08
        : this.state === 'ROOF_DROP'
          ? 1.1
          : 1.0

    if (isMultiplayer) {
      const totalLanes = 1 + this.remoteLanesToRender.length
      const maxMultiLaneZoom =
        totalLanes >= 4 ? 0.68 : totalLanes === 3 ? 0.78 : 0.88

      const allOffsetsX = [
        this.offsetX,
        ...this.remoteLanesToRender.map((r) => r.laneOffsetX),
      ]
      const minLaneX = Math.min(...allOffsetsX)
      const maxLaneX = Math.max(...allOffsetsX)
      const totalHorizontalSpanPx = maxLaneX - minLaneX + 19.5 * u
      const availWidthPx = Math.max(360, this.lastCanvasWidth - 32)
      const horizontalFitZoom =
        availWidthPx / Math.max(1, totalHorizontalSpanPx)

      // Zoom out automaticamente se um jogador estiver muito pra baixo e outro muito pra cima
      const verticalSpanUnits =
        this.gameMode === 'PUZZLE'
          ? 15.5
          : Math.max(14, highestVisibleUnits - targetPanUnits + 1.2)
      const availHeightPx = Math.max(240, this.lastCanvasHeight - 112 - 56)
      const verticalFitZoom = availHeightPx / (verticalSpanUnits * u)

      targetZoom = Math.max(
        0.28,
        Math.min(maxMultiLaneZoom, horizontalFitZoom, verticalFitZoom)
      )
    }

    this.cameraZoom += (targetZoom - this.cameraZoom) * Math.min(1, dtMs * 0.006)
  }

  private tickSnapshots(dtMs: number): void {
    this.snapshotAccumulatorMs += dtMs
    if (this.snapshotAccumulatorMs >= GAME_CONSTANTS.SNAPSHOT_INTERVAL_MS) {
      this.snapshotAccumulatorMs = 0
      this.emitSnapshotNow()
    }
  }

  public emitSnapshotNow(): TowerSnapshot {
    const snapshot = this.getStateSnapshot()
    this.onSnapshot?.(snapshot)
    return snapshot
  }

  public getStateSnapshot(): TowerSnapshot {
    const u = GAME_CONSTANTS.UNIT_PX

    let activePieceSnap: ActivePieceSnapshot | null = null
    if (this.activePiece) {
      const b = this.activePiece.body
      activePieceSnap = {
        type: this.activePiece.type,
        variant: this.activePiece.variant,
        powerEffect: this.activePiece.powerEffect,
        colorPaletteIndex: this.activePiece.colorPaletteIndex,
        x: Number(((b.position.x - this.offsetX) / u).toFixed(2)),
        y: Number((-b.position.y / u).toFixed(2)),
        angle: Number((((b.angle * 180) / Math.PI) % 360).toFixed(2)),
        recallTransformProgress: this.pieceRecallAnim
          ? Number(
              Math.min(
                1,
                this.pieceRecallAnim.elapsedMs /
                  Math.max(1, this.pieceRecallAnim.totalDurationMs)
              ).toFixed(2)
            )
          : undefined,
        recallPowerId: this.pieceRecallAnim?.powerId,
      }
    }

    const settledBlocks: SettledBlockSnapshot[] = this.settledPieces.map((p) => {
      const b = p.body
      return {
        id: p.id,
        type: p.id ? p.type : 'I',
        variant: p.variant,
        powerEffect: p.powerEffect,
        colorPaletteIndex: p.colorPaletteIndex,
        x: Number(((b.position.x - this.offsetX) / u).toFixed(2)),
        y: Number((-b.position.y / u).toFixed(2)),
        angle: Number((((b.angle * 180) / Math.PI) % 360).toFixed(2)),
        snapped: p.snapped,
        sleeping: b.isSleeping,
        isStaticAnchor: p.isStaticAnchor,
        isGlued: p.isGlued,
        isPetrified: p.isPetrified,
        isLaserBurning: p.isLaserBurning,
        isCountedHighlight: p.isCountedHighlight,
        countOrderNumber: p.countOrderNumber,
      }
    })

    const effectivePieceCount =
      this.state === 'PUZZLE_COUNTING'
        ? this.countedPieces
        : this.gameMode === 'ENDLESS'
          ? this.endlessScore
          : this.survivalFinalPiecesCount ?? this.settledPieces.length

    return {
      playerId: this.id,
      matchSeed: this.matchSeed,
      isSinglePlayer: this.isSinglePlayer,
      gameMode: this.gameMode,
      lives: this.lives,
      maxLives: this.maxLives,
      invulnerableRemainingMs: Math.ceil(this.invulnerableRemainingMs),
      fallFlashRemainingMs: Math.ceil(this.fallWhiteFlashMs),
      piecesPlaced: effectivePieceCount,
      survivalGoalPieces: GAME_CONSTANTS.SURVIVAL_GOAL_PIECES,
      maxTowerHeight: this.maxTowerHeight,
      puzzleBaseRiseUnits: this.puzzleBaseRiseUnits,
      puzzleLaserHeightUnits: GAME_CONSTANTS.PUZZLE_LASER_HEIGHT_UNITS,
      laserOverloadRemainingMs:
        this.laserOverloadRemainingMs !== null
          ? Math.ceil(this.laserOverloadRemainingMs)
          : null,
      isPetrified: this.isPetrified,
      countedPieces: effectivePieceCount,
      endlessScore: this.endlessScore,
      petrifyLineHeightUnits: Number(this.petrifyLineHeightUnits.toFixed(2)),
      nextCheckpointHeightUnits: this.nextEndlessCheckpointUnits,
      consecutiveAbyssFalls: this.consecutiveAbyssFalls,
      isAbyssOvertime: this.isAbyssOvertime,
      abyssTimeRemainingMs:
        !this.isSinglePlayer && this.gameMode === 'ENDLESS'
          ? Math.max(
              0,
              Math.ceil(
                GAME_CONSTANTS.ENDLESS_MAX_MATCH_TIME_MS - this.elapsedTimeMs
              )
            )
          : null,
      basePresetId: this.currentBasePreset.id,
      basePresetName: this.currentBasePreset.name,
      baseElevations: [...this.currentBasePreset.elevations],
      elapsedTimeMs: Math.round(this.elapsedTimeMs),
      towerHeight: this.towerHeight,
      state: this.state,
      countdownRemainingMs: Math.ceil(this.countdownRemainingMs),
      goalCountdownMs:
        this.goalCountdownMs !== null ? Math.ceil(this.goalCountdownMs) : null,
      respawnDelayRemainingMs: Math.ceil(this.respawnDelayRemainingMs),
      windForce: this.windForce,
      windActive: this.windActive,
      checkpointsReached: [...this.checkpointsReached],
      checkpointHoldProgress:
        this.checkpointHoldTarget !== null
          ? {
              height: this.checkpointHoldTarget,
              progressRatio: Math.min(
                1,
                this.checkpointHoldTimerMs /
                  (this.gameMode === 'ENDLESS'
                    ? GAME_CONSTANTS.ENDLESS_CHECKPOINT_HOLD_MS
                    : GAME_CONSTANTS.CHECKPOINT_HOLD_MS)
              ),
            }
          : null,
      inventoryPower: { ...this.inventoryPower },
      blindManualRemainingMs: Math.ceil(this.blindManualRemainingMs),
      fogAnchorX: Number(this.fogAnchorX.toFixed(1)),
      fogAnchorY: Number(this.fogAnchorY.toFixed(1)),
      nextQueue:
        this.state === 'ROOF_DROP' ||
        this.state === 'VICTORY' ||
        this.state === 'GAME_OVER' ||
        this.state === 'PETRIFIED_WAITING' ||
        this.state === 'PUZZLE_COUNTING' ||
        this.isPetrified
          ? []
          : this.randomizer.peekQueue(
              this.gameMode === 'SURVIVAL'
                ? Math.min(
                    3,
                    Math.max(
                      0,
                      GAME_CONSTANTS.SURVIVAL_GOAL_PIECES -
                        this.settledPieces.length -
                        (this.activePiece ? 1 : 0)
                    )
                  )
                : 3
            ),
      activePiece: activePieceSnap,
      settledBlocks,
      hasSpawnedSideIsland: this.hasSpawnedSideIsland,
      islands: this.islands.map((isl) => ({
        id: isl.id,
        side: isl.side,
        x: isl.x,
        y: isl.y,
        width: isl.width,
        height: isl.height,
      })),
    }
  }

  private getPlayerFallVisualState(
    whiteFlashMs: number = this.fallWhiteFlashMs,
    invulnMs: number = this.invulnerableRemainingMs,
    reactionMs: number = this.mascotFallReactionMs,
    clockMs: number = this.elapsedTimeMs
  ): {
    whiteFlashAlpha: number
    blinkAlpha: number
    reactionIntensity: number
  } {
    let whiteFlashAlpha = 0
    let blinkAlpha = 1.0

    // 1. High-contrast multi-pulse white blink when dropping a piece ("piscar em branco")
    if (whiteFlashMs > 0) {
      const ratio = Math.min(1, whiteFlashMs / 780)
      const progress = 1 - ratio
      const pulse = Math.abs(Math.cos(progress * Math.PI * 3.5))
      whiteFlashAlpha = pulse * Math.pow(ratio, 0.45) * 0.95
    }

    // 2. 3-second invulnerability blinking ("piscando invulnerável por 3 segundos")
    if (invulnMs > 0) {
      const blinkWave = Math.sin(clockMs * 0.056)
      if (blinkWave < 0) {
        blinkAlpha = 0.46
        whiteFlashAlpha = Math.max(whiteFlashAlpha, 0.56)
      } else {
        blinkAlpha = 1.0
      }
    }

    const reactionIntensity =
      reactionMs > 0 ? Math.min(1, reactionMs / 2500) : 0

    return { whiteFlashAlpha, blinkAlpha, reactionIntensity }
  }

  public render(
    ctx: CanvasRenderingContext2D,
    canvasWidth: number,
    canvasHeight: number
  ): void {
    this.lastCanvasWidth = canvasWidth
    this.lastCanvasHeight = canvasHeight
    const u = GAME_CONSTANTS.UNIT_PX
    const isMultiplayer =
      !this.isSinglePlayer && this.remoteLanesToRender.length > 0

    let shakeOffsetX = 0
    let shakeOffsetY = 0
    if (this.shakeTimerMs > 0) {
      const decay = this.shakeTimerMs / this.shakeDurationMs
      const phase = (1 - decay) * Math.PI * 5
      shakeOffsetX = this.shakeDir * Math.cos(phase) * 3.5 * decay
      shakeOffsetY = Math.sin(phase * 1.4) * 1.8 * decay
    }

    const effectiveZoom = this.cameraZoom
    const cameraOriginScreenX = canvasWidth / 2 + this.offsetX + shakeOffsetX
    const cameraOriginScreenY =
      canvasHeight - 112 + this.cameraCenterHeightUnits * u + shakeOffsetY
    const effectiveSceneryOriginY = isMultiplayer
      ? canvasHeight -
        112 +
        this.cameraCenterHeightUnits * u * effectiveZoom +
        shakeOffsetY
      : cameraOriginScreenY

    const animTimeMs = this.elapsedTimeMs + this.victoryAnimTimeMs

    // 1. Full-screen Tricky Towers Parallax Background Scenery (with dynamic Endless sky progression or Survivor storm map)
    spriteRegistry.drawTrickyTowersSceneryBackground(
      ctx,
      canvasWidth,
      canvasHeight,
      canvasWidth / 2 + shakeOffsetX,
      effectiveSceneryOriginY,
      animTimeMs,
      this.windForce,
      this.cameraParallaxX,
      this.gameMode === 'ENDLESS' ? this.endlessScore : undefined,
      this.gameMode === 'SURVIVAL'
    )

    // 1b. Synchronized Negative Power Sky Darkening (`rgba(15, 10, 35, 0.45)`)
    const activeNegVfx = this.activePowerVfxToRender.find(
      (v) => v.category === 'NEGATIVE'
    )
    if (activeNegVfx) {
      const fade = Math.sin(Math.min(1, activeNegVfx.progress) * Math.PI)
      ctx.save()
      ctx.fillStyle = `rgba(15, 10, 35, ${(0.45 * Math.max(0.35, fade)).toFixed(3)})`
      ctx.fillRect(0, 0, canvasWidth, canvasHeight)
      ctx.restore()
    }

    ctx.save()
    ctx.translate(cameraOriginScreenX, cameraOriginScreenY)

    // Smooth camera zoom (centered on screen X and anchored at lowest-player height in Multiplayer)
    if (Math.abs(effectiveZoom - 1.0) > 0.002) {
      const pivotX = isMultiplayer ? -this.offsetX : 0
      const focusY = isMultiplayer
        ? -this.cameraCenterHeightUnits * u
        : -Math.max(0, this.towerHeight * 0.5) * u
      ctx.translate(pivotX, focusY)
      ctx.scale(effectiveZoom, effectiveZoom)
      ctx.translate(-pivotX, -focusY)
    }

    // 2. Finish Line (30m) & Checkpoint lines (or 9m Puzzle Laser Beam) in the sky
    this.renderHeightGridAndMarkers(ctx, canvasWidth)

    // 2a. Render Remote Online Friends' Lanes (2-4 Players)
    if (this.remoteLanesToRender.length > 0) {
      this.renderRemoteMultiplayerLanes(ctx, animTimeMs)
    }

    // 2b. Floating Helper Cloud Character (ALWAYS drawn behind the tower blocks so it is NEVER in front of the built tower!)
    this.renderFloatingGuideCloud(ctx)

    // 3. Subtle drop column guide under the active falling piece (in FALLING or ROOF_DROP)
    if (
      this.activePiece &&
      (this.state === 'FALLING' || this.state === 'ROOF_DROP')
    ) {
      this.renderActivePieceGuide(ctx, this.activePiece)
    }

    // 4. Modular 8-Column Green Base Plate + Cottage Pedestal (`assets/sprites/other/base.png`) or Narrow Puzzle Pillar Island
    spriteRegistry.drawBasePlate(
      ctx,
      0,
      u / 2 - this.puzzleBaseRiseUnits * u,
      this.currentBasePreset.elevations,
      {
        isPuzzleMode:
          this.gameMode === 'PUZZLE' ||
          Boolean(this.currentBasePreset.isPuzzleIsland),
        riseUnits: this.puzzleBaseRiseUnits,
      }
    )

    // 4b. Positive Power 4: Floating Side Islands (`SIDE_ISLAND` — 2.5x1.5 static outriggers)
    if (this.islands.length > 0) {
      this.renderSideIslands(ctx, animTimeMs)
    }

    // 5. Settled Tower Pieces
    for (const piece of this.settledPieces) {
      this.renderPieceEntity(ctx, piece)
    }

    // 5a. Dissolving Bricks (200ms fade-out + shrink 1.0 -> 0.3 + white glow when crossing ±7.5u or water)
    if (this.dissolvingBricks.length > 0) {
      this.renderDissolvingBricks(ctx)
    }

    // 5b. Super Glue ("Vinhas de Cola") spreading across welded pieces
    if (this.glueVines.length > 0 || this.glueWeldLinks.length > 0) {
      this.renderGlueWelds(ctx)
    }

    // 6. Active Falling Piece (with 4px/80ms piston animation during Impulse Nudge)
    if (this.activePiece) {
      this.renderPieceEntity(ctx, this.activePiece, true)
    }

    // 6-endless. In Endless / Abyss Mode, render Zone 1 (Petrification Line, Dark Curtain & Clouds) and Zone 3 (Checkpoint Flags & Cyan Diamond Line)
    if (this.gameMode === 'ENDLESS') {
      this.renderEndlessZonesAndAbyss(ctx, canvasWidth, animTimeMs)
    }

    // 6-puzzle. In Puzzle Mode, draw the Giant Piece Counter / Visual Podium (ONLY at the end of the match), 3s Laser Overload timer, and "FINALIZADO" stamp
    if (this.gameMode === 'PUZZLE') {
      const isEndCounting =
        this.state === 'PUZZLE_COUNTING' || this.state === 'VICTORY'
      const localCount =
        this.state === 'PUZZLE_COUNTING'
          ? this.countedPieces
          : this.state === 'VICTORY'
            ? this.settledPieces.length
            : 0
      this.renderPuzzleLaneOverlay(
        ctx,
        localCount,
        this.isPetrified,
        isEndCounting,
        this.laserOverloadRemainingMs,
        this.puzzleBaseRiseUnits,
        this.settledPieces.length
      )
    }

    // 6a. Floating Extra Life Balloons (`EXTRA_LIFE` — must be caught with the controlled piece before floating away!)
    if (this.extraLifeBalloons.length > 0) {
      this.renderExtraLifeBalloons(ctx, animTimeMs)
    }

    // 6b. Brick Separator (Removedor de Peças) orange extractor animation
    if (this.brickRemoverEffects.length > 0) {
      this.renderBrickRemoverEffects(ctx)
    }

    // 6c. Sparks & Smoke Particles + Toy-Brick Confetti + Fall Feedback Callouts
    if (this.impactParticles.length > 0) {
      this.renderImpactParticles(ctx)
    }
    if (this.confettiParticles.length > 0) {
      this.renderConfettiParticles(ctx)
    }
    if (this.fallFeedbackCallouts.length > 0) {
      this.renderFallFeedbackCallouts(ctx)
    }

    // 6d. Negative Power 4: Manual de Instruções na Tela (Cegueira / Névoa sobre o topo da torre)
    if (this.blindManualRemainingMs > 0) {
      this.renderBlindManualOverlay(ctx)
    }

    // 7. Synchronized Positive & Negative Power VFX (Golden/Cyan Blessing & Purple Névoa Caos Column)
    if (this.activePowerVfxToRender.length > 0) {
      this.renderSynchronizedPowerVfx(ctx, animTimeMs)
    }

    // 8. Optional Debug Colliders (in Developer Mode)
    if (this.showDebugColliders) {
      this.renderDebugColliders(ctx)
    }

    ctx.restore()

    // 9. Foreground Ocean Water or Survivor Stalagmites + Smoke (Abyss at bottom of world)
    spriteRegistry.drawTrickyTowersOceanForeground(
      ctx,
      canvasWidth,
      canvasHeight,
      effectiveSceneryOriginY,
      animTimeMs,
      this.gameMode === 'SURVIVAL',
      this.cameraParallaxX + shakeOffsetX
    )
  }

  private renderConfettiParticles(ctx: CanvasRenderingContext2D): void {
    ctx.save()
    for (const c of this.confettiParticles) {
      const life = Math.max(0, 1 - c.ageMs / c.maxAgeMs)
      ctx.save()
      ctx.translate(c.x, c.y)
      ctx.rotate(c.angle)
      ctx.globalAlpha = Math.min(1, life * 1.4)
      ctx.fillStyle = c.color
      ctx.strokeStyle = c.border
      ctx.lineWidth = 1.2
      ctx.fillRect(-c.w / 2, -c.h / 2, c.w, c.h)
      ctx.strokeRect(-c.w / 2, -c.h / 2, c.w, c.h)
      ctx.restore()
    }
    ctx.restore()
  }

  /**
   * Renders the spreading Glue Vine Tendrils ("vinhas de cola") connecting each `SUPER_GLUE` piece
   * to all neighboring pieces it welded to, matching the Tricky Towers vine style but made of glossy white/cyan glue.
   */
  private renderGlueWelds(ctx: CanvasRenderingContext2D): void {
    ctx.save()
    for (const vine of this.glueVines) {
      const elapsed = vine.ageMs - vine.delayMs
      if (elapsed <= 0) continue

      const rawT = Math.min(1, elapsed / vine.growDurationMs)
      // Smooth ease-out curve so the glue spreads rapidly out of the seam and settles onto the neighbor piece
      const progress = 1 - Math.pow(1 - rawT, 2.6)

      const p0 = this.bodyLocalToArenaWorld(
        vine.bodyA,
        vine.localA.x,
        vine.localA.y
      )
      const p3 = this.bodyLocalToArenaWorld(
        vine.bodyB,
        vine.localB.x,
        vine.localB.y
      )

      const dx = p3.x - p0.x
      const dy = p3.y - p0.y
      const dist = Math.hypot(dx, dy) || 1
      const nx = -dy / dist
      const ny = dx / dist

      const cp1 = {
        x: p0.x + dx * 0.32 + nx * vine.waveAmp1,
        y: p0.y + dy * 0.32 + ny * vine.waveAmp1,
      }
      const cp2 = {
        x: p0.x + dx * 0.68 + nx * vine.waveAmp2,
        y: p0.y + dy * 0.68 + ny * vine.waveAmp2,
      }

      spriteRegistry.drawGlueVineTendril(ctx, p0, cp1, cp2, p3, {
        scale: vine.scale,
        progress,
        seed: vine.seed,
        beadCount: vine.beadCount,
      })
    }
    ctx.restore()
  }

  private renderBrickRemoverEffects(ctx: CanvasRenderingContext2D): void {
    ctx.save()
    for (const fx of this.brickRemoverEffects) {
      const t = fx.ageMs / fx.maxAgeMs
      const alpha = Math.max(0, 1 - t)
      ctx.save()
      ctx.translate(fx.x, fx.y - t * 28)
      ctx.rotate(-0.35 + t * 0.65)
      ctx.globalAlpha = alpha

      // Orange Brick Separator tool shape
      ctx.fillStyle = '#FF6D00'
      ctx.strokeStyle = '#7C2D12'
      ctx.lineWidth = 2
      ctx.beginPath()
      ctx.roundRect(-22, -8, 44, 16, 4)
      ctx.fill()
      ctx.stroke()

      ctx.font = 'bold 12px Inter, system-ui, sans-serif'
      ctx.fillStyle = '#FFFFFF'
      ctx.textAlign = 'center'
      ctx.fillText('🔧 REMOVIDO!', 0, -14)
      ctx.restore()
    }
    ctx.restore()
  }

  /**
   * Renders Negative Power 4 (`BLIND_MANUAL` — "Nuvem Fog 20s") on the local player's tower.
   */
  private renderBlindManualOverlay(ctx: CanvasRenderingContext2D): void {
    this.renderBlindFogCloudAt(
      ctx,
      this.fogAnchorX * 0.25,
      this.fogAnchorY,
      this.blindManualRemainingMs
    )
  }

  /**
   * Renders the multi-layered borderless fog cloud bank ("Nuvem Fog" / "nuvem que esconde")
   * centered at `(centerX, anchorY)` on either the local tower or a remote opponent's tower.
   */
  private renderBlindFogCloudAt(
    ctx: CanvasRenderingContext2D,
    centerX: number,
    anchorY: number,
    remainingMs: number
  ): void {
    const t = this.elapsedTimeMs * 0.0022
    const fadeEnvelope = Math.min(1.0, Math.max(0.2, remainingMs / 800))

    // Lateral cloud bank (~1.5x height = 74-82px, spanning ~320px across the entire tower width)
    // Ordered back-to-front with different transparencies, subtle color depth, and independent drift phases
    const fogClouds: Array<{
      dx: number
      bottomY: number
      w: number
      h: number
      alpha: number
      color: string
      swayAmp: number
      phase: number
      flipX?: boolean
    }> = [
      // Back layer (distant, softer transparencies 0.34 - 0.46, cool mist tone)
      { dx: -115, bottomY: 20, w: 138, h: 68, alpha: 0.36, color: '#DCE7F5', swayAmp: 2.0, phase: 0.4, flipX: true },
      { dx: -38,  bottomY: 16, w: 168, h: 80, alpha: 0.44, color: '#E2E8F0', swayAmp: 2.5, phase: 1.3 },
      { dx: 48,   bottomY: 18, w: 162, h: 78, alpha: 0.42, color: '#E2E8F0', swayAmp: 2.2, phase: 2.4, flipX: true },
      { dx: 118,  bottomY: 22, w: 134, h: 66, alpha: 0.34, color: '#DCE7F5', swayAmp: 1.8, phase: 3.6 },

      // Mid layer (medium transparencies 0.56 - 0.68, soft cloud white)
      { dx: -86,  bottomY: 28, w: 152, h: 74, alpha: 0.58, color: '#EEF2F8', swayAmp: 3.2, phase: 0.9 },
      { dx: 8,    bottomY: 26, w: 174, h: 82, alpha: 0.68, color: '#F1F5F9', swayAmp: 3.5, phase: 2.0, flipX: true },
      { dx: 88,   bottomY: 30, w: 150, h: 72, alpha: 0.60, color: '#EEF2F8', swayAmp: 3.0, phase: 4.2 },

      // Front layer (foreground puffs with varied transparencies 0.50 - 0.86 for volumetric depth)
      { dx: -128, bottomY: 36, w: 116, h: 58, alpha: 0.50, color: '#F8FAFC', swayAmp: 3.8, phase: 1.7 },
      { dx: -46,  bottomY: 38, w: 160, h: 78, alpha: 0.86, color: '#FFFFFF', swayAmp: 4.2, phase: 0.2 },
      { dx: 42,   bottomY: 40, w: 156, h: 76, alpha: 0.80, color: '#F8FAFC', swayAmp: 4.0, phase: 2.9, flipX: true },
      { dx: 126,  bottomY: 36, w: 118, h: 60, alpha: 0.52, color: '#F8FAFC', swayAmp: 3.6, phase: 4.8 },
    ]

    ctx.save()
    ctx.translate(centerX, anchorY)

    for (const c of fogClouds) {
      const swayX = Math.sin(t + c.phase) * c.swayAmp
      const bobY = Math.cos(t * 0.85 + c.phase) * 1.4
      this.drawBorderlessFogCloudUnit(
        ctx,
        c.dx + swayX,
        c.bottomY + bobY,
        c.w,
        c.h,
        c.color,
        c.alpha * fadeEnvelope,
        Boolean(c.flipX)
      )
    }

    ctx.restore()
  }

  /**
   * Draws a single borderless (`sem bordas`) minimalist cloud silhouette at `(cx, bottomY)`
   * with the specified width, height, fill color, and alpha transparency.
   */
  private drawBorderlessFogCloudUnit(
    ctx: CanvasRenderingContext2D,
    cx: number,
    bottomY: number,
    w: number,
    h: number,
    color: string,
    alpha: number,
    flipX: boolean
  ): void {
    if (alpha <= 0.01) return

    ctx.save()
    ctx.translate(cx, bottomY)
    if (flipX) {
      ctx.scale(-1, 1)
    }
    ctx.globalAlpha = alpha
    ctx.fillStyle = color

    const x0 = -w / 2
    const r = Math.min(20, h * 0.34)

    ctx.beginPath()
    ctx.moveTo(x0 + r, 0)
    ctx.lineTo(x0 + w - r, 0)
    ctx.quadraticCurveTo(x0 + w, 0, x0 + w, -r)
    ctx.quadraticCurveTo(x0 + w - 4, -h * 0.65, x0 + w * 0.74, -h * 0.62)
    ctx.quadraticCurveTo(x0 + w * 0.52, -h * 1.08, x0 + w * 0.34, -h * 0.72)
    ctx.quadraticCurveTo(x0 + w * 0.14, -h * 0.78, x0 + 8, -h * 0.42)
    ctx.quadraticCurveTo(x0, -r, x0 + r, 0)
    ctx.closePath()
    ctx.fill()

    ctx.restore()
  }

  /**
   * Draws the player skin mascot floating in the air alongside the tower's top height.
   * - Reactive Safe Distance: Rests at `6.2u` when the tower is centered, and smoothly backs away further right (`rightmostExtent + 4.4u`) whenever blocks are built or moved toward the character—NEVER overlapping or standing in front of the built tower!
   * - Power Bubbles: Displays floating circular bubbles above the character's head (Light bubble for Good Power `selfPower`, Dark Red bubble for Chaos Power `attackPower`).
   * - On `VICTORY`: flies in a smooth ellipse high above the Castle Roof (`+3.8u` above `towerHeight`) from left to right -> flips -> right to left -> flips back!
   */
  private renderFloatingGuideCloud(ctx: CanvasRenderingContext2D): void {
    const u = GAME_CONSTANTS.UNIT_PX
    const t = this.elapsedTimeMs

    if (this.state === 'VICTORY') {
      const vt = this.victoryAnimTimeMs
      const animTime = t + vt

      // Smooth elliptical orbit well above the Castle Roof on top of the tower
      const orbitPhase = vt * 0.0021
      const radiusX = 3.8 * u
      const radiusY = 0.85 * u
      const centerY =
        -(Math.max(this.mascotHoverYUnits, this.towerHeight) + 3.8) * u

      // cx goes from -radiusX (left) -> +radiusX (right) -> -radiusX (left)
      const cx = -Math.cos(orbitPhase) * radiusX
      // cy traces the upper and lower arcs of the ellipse above the tower
      const cy = centerY - Math.sin(orbitPhase) * radiusY

      const velDir = Math.sin(orbitPhase)
      const scaleXFlip = Math.max(-1, Math.min(1, velDir / 0.22))
      const extraTiltRad = velDir * 0.05

      spriteRegistry.drawFloatingMascot(ctx, cx, cy, animTime, {
        scaleXFlip,
        extraTiltRad,
      })
      return
    }

    // Dynamic mid-air floating & wandering safely far to the right of the tower during gameplay
    const swayX =
      Math.sin(t * 0.0021) * 8 +
      Math.cos(t * 0.0049) * 3 -
      (this.pistonTimerMs > 0 ? 3 : 0)
    const bobY =
      Math.sin(t * 0.0038) * 8 +
      Math.cos(t * 0.0083) * 3 -
      (this.pistonTimerMs > 0 ? 3 : 0)

    const minSafeX =
      Math.max(6.0, this.getRightmostTowerExtentUnits() + 4.1) * u
    const cx = Math.max(minSafeX, this.mascotHoverXUnits * u + swayX)
    const cy = -this.mascotHoverYUnits * u + bobY

    // Sprite natively faces right (+X); when on the right of the tower (cx >= 0), flip (-1) to face the tower!
    const scaleXFlip: 1 | -1 = cx >= 0 ? -1 : 1
    const extraTiltRad = Math.cos(t * 0.0021) * 0.03

    const fallVis = this.getPlayerFallVisualState()

    spriteRegistry.drawFloatingMascot(ctx, cx, cy, t, {
      scaleXFlip,
      extraTiltRad,
      selfPower: this.inventoryPower.selfPower,
      attackPower: this.inventoryPower.attackPower,
      whiteFlashAlpha: fallVis.whiteFlashAlpha,
      blinkAlpha: fallVis.blinkAlpha,
      fallReactionIntensity: fallVis.reactionIntensity,
      isSurvivalLifeLoss: this.gameMode === 'SURVIVAL',
      invulnerableRemainingMs: this.invulnerableRemainingMs,
    })

    if (this.mascotCastAnimMs > 0 && this.mascotCastCategory) {
      this.drawMascotPowerCastAura(
        ctx,
        cx,
        cy,
        this.mascotCastCategory,
        this.mascotCastAnimMs / 950
      )
    }

    if (
      this.rankBadge ||
      this.gameMode === 'SURVIVAL' ||
      this.gameMode === 'PUZZLE' ||
      this.gameMode === 'ENDLESS'
    ) {
      const localDebuffs: string[] = []
      if (this.blindManualRemainingMs > 0) localDebuffs.push('BLIND_MANUAL')
      if (
        this.slickBrickRemaining > 0 ||
        this.activePiece?.powerEffect === 'SLICK_BRICK'
      ) {
        localDebuffs.push('SLICK_BRICK')
      }
      if (
        this.lockRotateRemaining > 0 ||
        this.activePiece?.powerEffect === 'LOCK_ROTATE'
      ) {
        localDebuffs.push('LOCK_ROTATE')
      }
      if (
        this.turboDropRemaining > 0 ||
        this.activePiece?.powerEffect === 'TURBO_DROP'
      ) {
        localDebuffs.push('TURBO_DROP')
      }
      if (
        this.giantPieceRemaining > 0 ||
        this.activePiece?.variant === 'GIANT'
      ) {
        localDebuffs.push('GIANT_PIECE')
      }

      const localPuzzlePieces =
        this.state === 'PUZZLE_COUNTING' ? this.countedPieces : 0

      this.drawRankBadgeBelowMascot(
        ctx,
        cx,
        cy + 58,
        this.rankBadge ?? '1ST',
        this.playerNick || 'VOCÊ',
        this.towerHeight,
        true,
        this.localSlotIndex,
        localDebuffs,
        this.lives,
        this.state === 'GAME_OVER' || this.lives <= 0,
        this.invulnerableRemainingMs,
        fallVis.whiteFlashAlpha,
        localPuzzlePieces,
        this.isPetrified
      )
    }
  }

  /**
   * Draws the real-time Rank Badge (`1ST`, `2ND`, `3RD`, `4TH`), Player Position (`P1`..`P4`),
   * Nickname, Survival Mode Hearts (`❤️❤️❤️`), Puzzle Mode Petrified Stamp, and any active negative power debuff pills directly below each floating mascot's cloud.
   */
  private drawRankBadgeBelowMascot(
    ctx: CanvasRenderingContext2D,
    cx: number,
    topY: number,
    rank: '1ST' | '2ND' | '3RD' | '4TH',
    nick: string,
    heightUnits: number,
    isLocal: boolean,
    slotIndex: number = 0,
    activeDebuffs: string[] = [],
    lives: number = GAME_CONSTANTS.SURVIVAL_INITIAL_LIVES,
    isEliminated: boolean = false,
    invulnerableRemainingMs: number = 0,
    whiteFlashAlpha: number = 0,
    puzzlePiecesCount: number = 0,
    isPetrified: boolean = false
  ): void {
    const theme =
      rank === '1ST'
        ? { bg: '#FACC15', border: '#713F12', text: '#1E1B4B' }
        : rank === '2ND'
          ? { bg: '#E2E8F0', border: '#334155', text: '#0F172A' }
          : rank === '3RD'
            ? { bg: '#FB923C', border: '#7C2D12', text: '#1E1B4B' }
            : { bg: '#94A3B8', border: '#1E293B', text: '#0F172A' }

    ctx.save()
    ctx.translate(cx, topY)

    // Rank pill (1ST / 2ND / 3RD / 4TH)
    ctx.fillStyle = theme.bg
    ctx.strokeStyle = theme.border
    ctx.lineWidth = 2.6
    ctx.beginPath()
    ctx.roundRect(-28, 0, 56, 22, 6)
    ctx.fill()
    ctx.stroke()

    ctx.font = '900 12px "Fredoka", Inter, system-ui, sans-serif'
    ctx.fillStyle = theme.text
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText(rank, 0, 11.5)

    // Player Slot Position (P1 / P2 / P3 / P4) + Nickname (& Height tag outside Puzzle Mode)
    const playerNumberTag = `P${Math.max(1, slotIndex + 1)}`
    const isPuzzleEndCount =
      this.state === 'PUZZLE_COUNTING' || this.state === 'VICTORY'
    const label =
      this.gameMode === 'PUZZLE'
        ? isPuzzleEndCount
          ? `${playerNumberTag} • ${nick.slice(0, 11)} • ${puzzlePiecesCount}`
          : `${playerNumberTag} • ${nick.slice(0, 11)}`
        : `${playerNumberTag} • ${nick.slice(0, 11)} • ${heightUnits.toFixed(1)}m`
    ctx.font = '800 10px Inter, system-ui, sans-serif'
    const textW = Math.max(82, ctx.measureText(label).width + 14)
    ctx.fillStyle = isLocal
      ? 'rgba(15, 23, 42, 0.88)'
      : 'rgba(30, 41, 59, 0.82)'
    ctx.strokeStyle = isLocal ? '#38BDF8' : '#475569'
    ctx.lineWidth = 1.6
    ctx.beginPath()
    ctx.roundRect(-textW / 2, 25, textW, 18, 5)
    ctx.fill()
    ctx.stroke()

    ctx.fillStyle = isLocal ? '#FEF08A' : '#F8FAFC'
    ctx.fillText(label, 0, 34.5)

    let offsetY = 47

    // In Endless Mode, show elimination status or consecutive falls warning
    if (this.gameMode === 'ENDLESS') {
      if (!this.isSinglePlayer && isEliminated) {
        const elimText = '🌫️ ENGOLIDO PELO ABISMO'
        ctx.font = '900 9px Inter, system-ui, sans-serif'
        const elimW = Math.max(96, ctx.measureText(elimText).width + 14)
        ctx.fillStyle = 'rgba(88, 28, 135, 0.94)'
        ctx.strokeStyle = '#C084FC'
        ctx.lineWidth = 1.5
        ctx.beginPath()
        ctx.roundRect(-elimW / 2, offsetY, elimW, 18, 5)
        ctx.fill()
        ctx.stroke()
        ctx.fillStyle = '#F3E8FF'
        ctx.fillText(elimText, 0, offsetY + 9.5)
        offsetY += 21
      } else if (
        this.isSinglePlayer &&
        isLocal &&
        this.consecutiveAbyssFalls > 0
      ) {
        const fallText = `⚠️ QUEDAS: ${this.consecutiveAbyssFalls}/${GAME_CONSTANTS.ENDLESS_MAX_CONSECUTIVE_FALLS}`
        ctx.font = '900 9px Inter, system-ui, sans-serif'
        const fallW = Math.max(82, ctx.measureText(fallText).width + 14)
        ctx.fillStyle =
          this.consecutiveAbyssFalls >= 3
            ? 'rgba(153, 27, 27, 0.94)'
            : 'rgba(30, 41, 59, 0.9)'
        ctx.strokeStyle =
          this.consecutiveAbyssFalls >= 3 ? '#F87171' : '#FACC15'
        ctx.lineWidth = 1.5
        ctx.beginPath()
        ctx.roundRect(-fallW / 2, offsetY, fallW, 18, 5)
        ctx.fill()
        ctx.stroke()
        ctx.fillStyle = '#FEF08A'
        ctx.fillText(fallText, 0, offsetY + 9.5)
        offsetY += 21
      }
    }

    // In Puzzle Mode, only show "🪨 FINALIZADO" pill when petrified (no piece count during the match!)
    if (this.gameMode === 'PUZZLE' && isPetrified && !isPuzzleEndCount) {
      const statusText = '🪨 FINALIZADO'
      ctx.font = '900 9.5px Inter, system-ui, sans-serif'
      const statusW = Math.max(82, ctx.measureText(statusText).width + 16)
      ctx.fillStyle = 'rgba(71, 85, 105, 0.94)'
      ctx.strokeStyle = '#CBD5E1'
      ctx.lineWidth = 1.6
      ctx.beginPath()
      ctx.roundRect(-statusW / 2, offsetY, statusW, 18, 5)
      ctx.fill()
      ctx.stroke()

      ctx.fillStyle = '#F1F5F9'
      ctx.fillText(statusText, 0, offsetY + 9.5)
      offsetY += 21
    }

    // In Survival Mode (3 Vidas), display the player's remaining hearts (or ELIMINADO) below their name tag!
    if (this.gameMode === 'SURVIVAL') {
      const maxHeartSlots = Math.max(
        GAME_CONSTANTS.SURVIVAL_INITIAL_LIVES,
        isLocal ? this.maxLives : GAME_CONSTANTS.SURVIVAL_INITIAL_LIVES,
        Math.min(5, lives)
      )
      const clampedLives = Math.max(0, Math.min(maxHeartSlots, lives))
      const heartsText =
        isEliminated || clampedLives <= 0
          ? '💀 ELIMINADO'
          : '❤️'.repeat(clampedLives) +
            '🖤'.repeat(Math.max(0, maxHeartSlots - clampedLives))
      ctx.font = '800 10px Inter, system-ui, sans-serif'
      const heartsW = Math.max(76, ctx.measureText(heartsText).width + 16)
      const isFlashingWhite = whiteFlashAlpha > 0.35
      ctx.fillStyle = isFlashingWhite
        ? 'rgba(255, 255, 255, 0.96)'
        : isEliminated || clampedLives <= 0
          ? 'rgba(127, 29, 29, 0.94)'
          : 'rgba(15, 23, 42, 0.9)'
      ctx.strokeStyle = isFlashingWhite
        ? '#FFFFFF'
        : isEliminated || clampedLives <= 0
          ? '#EF4444'
          : '#F43F5E'
      ctx.lineWidth = isFlashingWhite ? 2.2 : 1.5
      ctx.beginPath()
      ctx.roundRect(-heartsW / 2, offsetY, heartsW, 18, 5)
      ctx.fill()
      ctx.stroke()

      ctx.fillStyle = isFlashingWhite
        ? '#0F172A'
        : isEliminated || clampedLives <= 0
          ? '#FCA5A5'
          : '#FFFFFF'
      ctx.fillText(heartsText, 0, offsetY + 9.5)
      offsetY += 21

      // Blinking 3-second Invulnerability Stabilization Pill below hearts
      if (invulnerableRemainingMs > 0 && !isEliminated && clampedLives > 0) {
        const invText = `🛡️ INVULNERÁVEL ${(invulnerableRemainingMs / 1000).toFixed(1)}s`
        ctx.font = '900 9px Inter, system-ui, sans-serif'
        const invW = Math.max(106, ctx.measureText(invText).width + 14)
        const ratio = Math.max(
          0,
          Math.min(
            1,
            invulnerableRemainingMs /
              GAME_CONSTANTS.SURVIVAL_LIFE_LOSS_COOLDOWN_MS
          )
        )
        const blinkBright = Math.sin(this.elapsedTimeMs * 0.056) < 0

        ctx.fillStyle = blinkBright
          ? 'rgba(224, 242, 254, 0.95)'
          : 'rgba(12, 74, 110, 0.92)'
        ctx.strokeStyle = blinkBright ? '#FFFFFF' : '#38BDF8'
        ctx.lineWidth = 1.6
        ctx.beginPath()
        ctx.roundRect(-invW / 2, offsetY, invW, 19, 5)
        ctx.fill()
        ctx.stroke()

        // Progress bar at bottom of the pill
        ctx.fillStyle = blinkBright ? '#0284C7' : '#FEF08A'
        ctx.fillRect(-invW / 2 + 3, offsetY + 15, (invW - 6) * ratio, 2.5)

        ctx.fillStyle = blinkBright ? '#0F172A' : '#FFFFFF'
        ctx.fillText(invText, 0, offsetY + 8.5)
        offsetY += 22
      }
    }

    // Render active curse / negative power badges affecting this player
    if (activeDebuffs && activeDebuffs.length > 0) {
      const debuffMeta: Record<string, { label: string; bg: string; border: string }> = {
        BLIND_MANUAL: {
          label: '🌫️ NUVEM FOG',
          bg: 'rgba(107, 33, 168, 0.92)',
          border: '#D8B4FE',
        },
        SLICK_BRICK: {
          label: '🧊 GELO',
          bg: 'rgba(3, 105, 161, 0.92)',
          border: '#7DD3FC',
        },
        LOCK_ROTATE: {
          label: '🔒 GIRO TRAVADO',
          bg: 'rgba(159, 18, 57, 0.92)',
          border: '#FDA4AF',
        },
        TURBO_DROP: {
          label: '⚡ QUEDA TURBO',
          bg: 'rgba(185, 28, 28, 0.92)',
          border: '#FCA5A5',
        },
        GIANT_PIECE: {
          label: '🦣 MEGA 2X',
          bg: 'rgba(180, 83, 9, 0.92)',
          border: '#FDE047',
        },
      }

      for (const debuffId of activeDebuffs) {
        const meta = debuffMeta[debuffId]
        if (!meta) continue
        ctx.font = '800 9px Inter, system-ui, sans-serif'
        const pillW = Math.max(66, ctx.measureText(meta.label).width + 12)
        ctx.fillStyle = meta.bg
        ctx.strokeStyle = meta.border
        ctx.lineWidth = 1.4
        ctx.beginPath()
        ctx.roundRect(-pillW / 2, offsetY, pillW, 16, 4)
        ctx.fill()
        ctx.stroke()

        ctx.fillStyle = '#FFFFFF'
        ctx.fillText(meta.label, 0, offsetY + 8.5)
        offsetY += 19
      }
    }

    ctx.restore()
  }

  /**
   * Renders the mascot casting animation:
   * - POSITIVE: Golden/Cyan aura & raised blessing orb around the mascot.
   * - NEGATIVE: Dark purple chaos orb & jagged purple lightning bolt shooting straight up into the sky!
   */
  private drawMascotPowerCastAura(
    ctx: CanvasRenderingContext2D,
    cx: number,
    cy: number,
    category: 'POSITIVE' | 'NEGATIVE',
    lifeRatio: number
  ): void {
    const alpha = Math.min(1, Math.sin(lifeRatio * Math.PI) * 1.35)
    ctx.save()
    ctx.translate(cx, cy)

    if (category === 'POSITIVE') {
      const r = 46 + (1 - lifeRatio) * 28
      const grad = ctx.createRadialGradient(0, -10, 6, 0, -10, r)
      grad.addColorStop(0, `rgba(254, 240, 138, ${(0.85 * alpha).toFixed(3)})`)
      grad.addColorStop(0.55, `rgba(56, 189, 248, ${(0.55 * alpha).toFixed(3)})`)
      grad.addColorStop(1, 'rgba(56, 189, 248, 0)')
      ctx.fillStyle = grad
      ctx.beginPath()
      ctx.arc(0, -10, r, 0, Math.PI * 2)
      ctx.fill()

      // Raised hand golden/cyan energy orb
      ctx.fillStyle = '#FEF08A'
      ctx.strokeStyle = '#0284C7'
      ctx.lineWidth = 2.5
      ctx.globalAlpha = alpha
      ctx.beginPath()
      ctx.arc(-18, -48 - (1 - lifeRatio) * 12, 11, 0, Math.PI * 2)
      ctx.fill()
      ctx.stroke()
    } else {
      // NEGATIVE: Purple chaos aura + jagged purple lightning bolt shooting to the sky!
      const r = 52 + (1 - lifeRatio) * 24
      const grad = ctx.createRadialGradient(0, -12, 6, 0, -12, r)
      grad.addColorStop(0, `rgba(216, 180, 254, ${(0.9 * alpha).toFixed(3)})`)
      grad.addColorStop(0.55, `rgba(147, 51, 234, ${(0.65 * alpha).toFixed(3)})`)
      grad.addColorStop(1, 'rgba(88, 28, 135, 0)')
      ctx.fillStyle = grad
      ctx.beginPath()
      ctx.arc(0, -12, r, 0, Math.PI * 2)
      ctx.fill()

      // Jagged purple lightning bolt shooting from raised hand (-16, -46) into the sky (-540)
      ctx.save()
      ctx.globalAlpha = alpha
      ctx.strokeStyle = '#A855F7'
      ctx.shadowColor = '#C084FC'
      ctx.shadowBlur = 18
      ctx.lineWidth = 7
      ctx.lineCap = 'round'
      ctx.lineJoin = 'round'

      const segments = [
        { x: -16, y: -46 },
        { x: -34, y: -115 },
        { x: -4, y: -185 },
        { x: -28, y: -265 },
        { x: 8, y: -350 },
        { x: -20, y: -445 },
        { x: 0, y: -560 },
      ]

      ctx.beginPath()
      ctx.moveTo(segments[0].x, segments[0].y)
      for (let i = 1; i < segments.length; i++) {
        const jitterX = Math.sin(performance.now() * 0.04 + i * 2.1) * 8
        ctx.lineTo(segments[i].x + jitterX, segments[i].y)
      }
      ctx.stroke()

      // Bright white-lavender inner lightning core
      ctx.strokeStyle = '#F3E8FF'
      ctx.lineWidth = 2.6
      ctx.stroke()
      ctx.restore()
    }

    ctx.restore()
  }

  /**
   * Renders all remote online friends' lanes (Base Plate, Side Islands, Interpolated Settled Blocks,
   * Interpolated Active Piece, Active Power Effects such as `BLIND_MANUAL` Fog Cloud, Floating Mascot,
   * and Live Rank Badge `1ST`/`2ND`/`3RD`/`4TH`).
   */
  private renderRemoteMultiplayerLanes(
    ctx: CanvasRenderingContext2D,
    animTimeMs: number
  ): void {
    const u = GAME_CONSTANTS.UNIT_PX
    const nowPerf = performance.now()

    for (const lane of this.remoteLanesToRender) {
      const relOffsetX = lane.laneOffsetX - this.offsetX
      ctx.save()
      ctx.translate(relOffsetX, 0)

      const elapsedSinceLoss =
        typeof lane.lastLifeLostAtMs === 'number' && lane.lastLifeLostAtMs > 0
          ? Math.max(0, nowPerf - lane.lastLifeLostAtMs)
          : Infinity
      const remWhiteFlashMs =
        elapsedSinceLoss < 780 ? 780 - elapsedSinceLoss : 0
      const remInvulnMs =
        this.gameMode === 'SURVIVAL' &&
        !lane.isEliminated &&
        lane.lives > 0 &&
        elapsedSinceLoss < GAME_CONSTANTS.SURVIVAL_LIFE_LOSS_COOLDOWN_MS
          ? GAME_CONSTANTS.SURVIVAL_LIFE_LOSS_COOLDOWN_MS - elapsedSinceLoss
          : 0
      const remReactionMs =
        elapsedSinceLoss < 2500 ? 2500 - elapsedSinceLoss : 0

      const remFallVis = this.getPlayerFallVisualState(
        remWhiteFlashMs,
        remInvulnMs,
        remReactionMs,
        animTimeMs
      )

      // 1. Remote Friend's Floating Mascot + Live Rank Badge (`1ST`, `2ND`, `3RD`, `4TH`)
      const swayX = Math.sin(animTimeMs * 0.002 + lane.laneOffsetX * 0.01) * 7
      const bobY = Math.cos(animTimeMs * 0.0035 + lane.laneOffsetX * 0.01) * 7
      const mascotX = 6.2 * u + swayX
      const mascotY = -Math.max(3.5, lane.towerHeight + 1.2) * u + bobY

      spriteRegistry.drawMenuMascotBySkinId(
        ctx,
        lane.skinSpriteId,
        mascotX,
        mascotY,
        animTimeMs,
        {
          scaleXFlip: -1,
          targetHeight: 96,
          whiteFlashAlpha: remFallVis.whiteFlashAlpha,
          blinkAlpha: remFallVis.blinkAlpha,
          fallReactionIntensity: remFallVis.reactionIntensity,
          isSurvivalLifeLoss: this.gameMode === 'SURVIVAL',
          invulnerableRemainingMs: remInvulnMs,
        }
      )

      if (lane.mascotCastAnimMs > 0 && lane.mascotCastCategory) {
        this.drawMascotPowerCastAura(
          ctx,
          mascotX,
          mascotY,
          lane.mascotCastCategory,
          Math.min(1, lane.mascotCastAnimMs / 950)
        )
      }

      const laneDebuffs = [...(lane.activeDebuffs || [])]
      if (
        lane.blindManualRemainingMs > 0 &&
        !laneDebuffs.includes('BLIND_MANUAL')
      ) {
        laneDebuffs.push('BLIND_MANUAL')
      }
      if (
        lane.activePiece?.powerEffect &&
        lane.activePiece.powerEffect !== 'NONE' &&
        lane.activePiece.powerEffect !== 'CASTLE_ROOF' &&
        !laneDebuffs.includes(lane.activePiece.powerEffect)
      ) {
        laneDebuffs.push(lane.activePiece.powerEffect)
      }
      if (
        lane.activePiece?.variant === 'GIANT' &&
        !laneDebuffs.includes('GIANT_PIECE')
      ) {
        laneDebuffs.push('GIANT_PIECE')
      }

      const isPuzzleEndCounting =
        this.state === 'PUZZLE_COUNTING' || this.state === 'VICTORY'
      const parallelStepCount =
        this.state === 'PUZZLE_COUNTING'
          ? Math.floor(
              this.puzzleCountTimerMs / GAME_CONSTANTS.PUZZLE_COUNT_STEP_MS
            )
          : lane.settledBlocks.length
      const lanePieceCount = isPuzzleEndCounting
        ? Math.min(lane.settledBlocks.length, parallelStepCount)
        : 0

      this.drawRankBadgeBelowMascot(
        ctx,
        mascotX,
        mascotY + 54,
        lane.rankBadge,
        lane.customNick,
        lane.towerHeight,
        false,
        lane.slotIndex,
        laneDebuffs,
        lane.lives,
        lane.isEliminated || lane.lives <= 0,
        remInvulnMs,
        remFallVis.whiteFlashAlpha,
        lanePieceCount,
        Boolean(lane.isPetrified)
      )

      const laneRiseUnits = lane.puzzleBaseRiseUnits ?? 0

      // 2. Remote Friend's Modular Base Plate (or Narrow Puzzle Pillar Island rising with water drops)
      spriteRegistry.drawBasePlate(
        ctx,
        0,
        u / 2 - laneRiseUnits * u,
        this.currentBasePreset.elevations,
        {
          isPuzzleMode:
            this.gameMode === 'PUZZLE' ||
            Boolean(this.currentBasePreset.isPuzzleIsland),
          riseUnits: laneRiseUnits,
        }
      )

      // 2b. Remote Friend's Floating Side Islands (`SIDE_ISLAND`)
      if (lane.islands && lane.islands.length > 0) {
        for (const isl of lane.islands) {
          spriteRegistry.drawSideIsland(
            ctx,
            this.toPixels(isl.x),
            this.toPixelsY(isl.y),
            this.toPixels(isl.width),
            this.toPixels(isl.height),
            isl.side,
            1,
            animTimeMs
          )
        }
      }

      // 3. Remote Friend's Interpolated Settled Blocks (in Puzzle counting phase, light up bottom-to-top in parallel!)
      const blocksToRender =
        this.gameMode === 'PUZZLE' && isPuzzleEndCounting
          ? [...lane.settledBlocks]
              .sort((a, b) => {
                const dy = a.y - b.y
                if (Math.abs(dy) > 0.12) return dy
                return a.x - b.x
              })
              .map((blk, idx) => ({
                ...blk,
                isCountedHighlight: idx < lanePieceCount,
                countOrderNumber: idx < lanePieceCount ? idx + 1 : undefined,
              }))
          : lane.settledBlocks

      for (const blk of blocksToRender) {
        this.renderSnapshotPieceOnLane(
          ctx,
          blk,
          false,
          Boolean(lane.isPetrified)
        )
      }

      // 4. Remote Friend's Interpolated Active Falling Piece
      if (lane.activePiece && !lane.isEliminated && !lane.isPetrified) {
        this.renderSnapshotPieceOnLane(ctx, lane.activePiece, true, false)
      }

      // 4-puzzle. Remote Friend's Giant Piece Counter / Visual Podium (ONLY at end of match) & "FINALIZADO" Stamp in Puzzle Mode
      if (this.gameMode === 'PUZZLE') {
        this.renderPuzzleLaneOverlay(
          ctx,
          lanePieceCount,
          Boolean(lane.isPetrified),
          isPuzzleEndCounting,
          lane.laserOverloadRemainingMs ?? null,
          laneRiseUnits,
          lane.settledBlocks.length
        )
      }

      // 5. Remote Friend's Active Fog Cloud (`BLIND_MANUAL` — "nuvem que esconde")
      const hasBlindFog =
        lane.blindManualRemainingMs > 0 ||
        (lane.activeDebuffs && lane.activeDebuffs.includes('BLIND_MANUAL'))
      if (hasBlindFog) {
        const fogCenterX = (lane.fogAnchorX ?? 0) * 0.25
        const fogAnchorY =
          typeof lane.fogAnchorY === 'number'
            ? lane.fogAnchorY
            : -Math.max(1.2, lane.towerHeight) * u
        this.renderBlindFogCloudAt(
          ctx,
          fogCenterX,
          fogAnchorY,
          lane.blindManualRemainingMs > 0 ? lane.blindManualRemainingMs : 20000
        )
      }

      ctx.restore()
    }
  }

  private renderSnapshotPieceOnLane(
    ctx: CanvasRenderingContext2D,
    snap: ActivePieceSnapshot | SettledBlockSnapshot,
    isActive: boolean,
    forceLanePetrified: boolean = false
  ): void {
    const u = GAME_CONSTANTS.UNIT_PX
    const def = PIECE_CATALOG[snap.type] || PIECE_CATALOG.I
    const phys = getVariantPhysicsSpec(snap.variant || 'NORMAL')
    const comUnitX =
      def.cells.reduce((sum, c) => sum + c.x, 0) / def.cells.length
    const comUnitY =
      def.cells.reduce((sum, c) => sum + c.y, 0) / def.cells.length
    const cellsFromCoM: CellCoord[] =
      snap.powerEffect === 'CASTLE_ROOF'
        ? [
            { x: -1, y: 0.4 },
            { x: 0, y: 0.4 },
            { x: 1, y: 0.4 },
            { x: -0.5, y: -0.6 },
            { x: 0.5, y: -0.6 },
            { x: 0, y: -1.6 },
          ]
        : def.cells.map((c) => ({
            x: c.x - comUnitX,
            y: c.y - comUnitY,
          }))

    const pxX = snap.x * u
    const pxY = -snap.y * u
    const angleRad = (snap.angle * Math.PI) / 180

    const recallProg =
      isActive && 'recallTransformProgress' in snap
        ? snap.recallTransformProgress
        : undefined
    const recallPowerId =
      isActive && 'recallPowerId' in snap ? snap.recallPowerId : undefined

    // Render fast-drop shadow trail when opponent's active piece has TURBO_DROP
    if (
      isActive &&
      snap.powerEffect === 'TURBO_DROP' &&
      recallProg === undefined
    ) {
      for (const dy of [-16, -8]) {
        ctx.save()
        ctx.translate(pxX, pxY + dy)
        ctx.scale(0.96, 1.03)
        ctx.rotate(angleRad)
        ctx.globalAlpha = dy === -16 ? 0.14 : 0.24
        spriteRegistry.drawPieceCells(
          ctx,
          snap.type,
          snap.variant || 'NORMAL',
          cellsFromCoM,
          phys.scale,
          {
            isGhost: true,
            powerEffect: snap.powerEffect,
            colorPaletteIndex: snap.colorPaletteIndex ?? 0,
          }
        )
        ctx.restore()
      }
    }

    ctx.save()
    ctx.translate(pxX, pxY)
    if (recallProg !== undefined && recallProg >= 0.53) {
      const popT = Math.min(1, (recallProg - 0.53) / 0.47)
      const scalePop = 1 + 0.34 * Math.sin(popT * Math.PI)
      const wobble = Math.sin(popT * Math.PI * 3) * 0.085
      ctx.scale(scalePop, scalePop)
      ctx.rotate(wobble)
    }
    ctx.rotate(angleRad)
    spriteRegistry.drawPieceCells(
      ctx,
      snap.type,
      snap.variant || 'NORMAL',
      cellsFromCoM,
      phys.scale,
      {
        isSnapped: 'snapped' in snap ? snap.snapped : false,
        isSleeping: 'sleeping' in snap ? snap.sleeping : false,
        showCenterOfMass: isActive && this.showDebugColliders,
        powerEffect: snap.powerEffect || 'NONE',
        isStaticAnchor: 'isStaticAnchor' in snap ? snap.isStaticAnchor : false,
        isGlued: 'isGlued' in snap ? snap.isGlued : false,
        colorPaletteIndex: snap.colorPaletteIndex ?? 0,
        isPetrified:
          !isActive &&
          (forceLanePetrified ||
            ('isPetrified' in snap && Boolean(snap.isPetrified))),
        isLaserBurning:
          !isActive && 'isLaserBurning' in snap && Boolean(snap.isLaserBurning),
        isCountedHighlight:
          !isActive &&
          'isCountedHighlight' in snap &&
          Boolean(snap.isCountedHighlight),
        countOrderNumber:
          !isActive && 'countOrderNumber' in snap
            ? snap.countOrderNumber
            : undefined,
      }
    )
    ctx.restore()

    if (recallProg !== undefined && recallPowerId) {
      this.drawPieceRecallTransformOverlay(
        ctx,
        pxX,
        pxY,
        recallProg,
        recallPowerId
      )
    }
  }

  /**
   * Renders the tractor-beam lift aura (`progress < 0.53`) and the starting-point transformation
   * ring + badge (`progress >= 0.53`) when a piece is recalled to the top and transformed.
   */
  private drawPieceRecallTransformOverlay(
    ctx: CanvasRenderingContext2D,
    pxX: number,
    pxY: number,
    progress: number,
    powerId: PowerId,
    startLocalX?: number,
    startLocalY?: number
  ): void {
    const theme =
      powerId === 'GIANT_PIECE'
        ? {
            color: '#EF4444',
            glow: 'rgba(239, 68, 68, 0.55)',
            label: '🦣 MEGA 2X!',
          }
        : powerId === 'SLICK_BRICK'
          ? {
              color: '#38BDF8',
              glow: 'rgba(56, 189, 248, 0.55)',
              label: '🧊 BLOCO DE GELO!',
            }
          : powerId === 'TURBO_DROP'
            ? {
                color: '#F97316',
                glow: 'rgba(249, 115, 22, 0.55)',
                label: '⚡ QUEDA TURBO!',
              }
            : {
                color: '#A855F7',
                glow: 'rgba(168, 85, 247, 0.55)',
                label: '🔒 GIRO TRAVADO!',
              }

    ctx.save()

    if (progress < 0.53) {
      // Phase 1: Piece stopped & elevating back to the starting point
      const liftRatio = Math.min(1, progress / 0.53)
      if (
        typeof startLocalX === 'number' &&
        typeof startLocalY === 'number' &&
        Math.abs(startLocalY - pxY) > 8
      ) {
        const beamGrad = ctx.createLinearGradient(
          pxX,
          pxY,
          startLocalX,
          startLocalY
        )
        beamGrad.addColorStop(0, theme.glow)
        beamGrad.addColorStop(1, 'rgba(255, 255, 255, 0)')
        ctx.strokeStyle = beamGrad
        ctx.lineWidth = 38 * (1 - liftRatio * 0.35)
        ctx.lineCap = 'round'
        ctx.beginPath()
        ctx.moveTo(pxX, pxY)
        ctx.lineTo(startLocalX, startLocalY)
        ctx.stroke()
      }

      // Lock-on ring around the rising piece
      ctx.translate(pxX, pxY)
      const ringRadius = 38 + Math.sin(liftRatio * Math.PI * 2) * 6
      ctx.strokeStyle = theme.color
      ctx.shadowColor = theme.color
      ctx.shadowBlur = 14
      ctx.lineWidth = 3
      ctx.beginPath()
      ctx.arc(0, 0, ringRadius, 0, Math.PI * 2)
      ctx.stroke()
    } else {
      // Phase 2: Transformation pop at the starting point
      const popT = Math.min(1, (progress - 0.53) / 0.47)
      const alpha = Math.sin(popT * Math.PI)

      ctx.translate(pxX, pxY)

      // Radial flash
      const flashRadius = 36 + popT * 62
      const grad = ctx.createRadialGradient(0, 0, 6, 0, 0, flashRadius)
      grad.addColorStop(0, `rgba(255, 255, 255, ${(0.75 * alpha).toFixed(3)})`)
      grad.addColorStop(0.5, theme.glow)
      grad.addColorStop(1, 'rgba(255, 255, 255, 0)')
      ctx.fillStyle = grad
      ctx.beginPath()
      ctx.arc(0, 0, flashRadius, 0, Math.PI * 2)
      ctx.fill()

      // Expanding shockwave ring
      ctx.strokeStyle = theme.color
      ctx.lineWidth = 3.5 * (1 - popT * 0.6)
      ctx.globalAlpha = Math.max(0, 1 - popT * 0.85)
      ctx.beginPath()
      ctx.arc(0, 0, 28 + popT * 54, 0, Math.PI * 2)
      ctx.stroke()

      // Floating transformation pill label above the piece
      ctx.globalAlpha = Math.min(1, alpha * 1.45)
      ctx.font = '900 11px Inter, system-ui, sans-serif'
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      const pillW = Math.max(96, ctx.measureText(theme.label).width + 18)
      const pillY = -58 - popT * 12
      ctx.fillStyle = theme.color
      ctx.strokeStyle = '#FFFFFF'
      ctx.lineWidth = 2
      ctx.beginPath()
      ctx.roundRect(-pillW / 2, pillY - 11, pillW, 22, 6)
      ctx.fill()
      ctx.stroke()

      ctx.fillStyle = '#FFFFFF'
      ctx.fillText(theme.label, 0, pillY)
    }

    ctx.restore()
  }

  /**
   * Renders Synchronized Positive & Negative Power VFX across all lanes:
   * - POSITIVE: Golden/Cyan vertical shimmer on the caster's lane.
   * - NEGATIVE: Vertical purple column of "Névoa Caos" + jagged purple lightning striking the target tower(s)!
   */
  private renderSynchronizedPowerVfx(
    ctx: CanvasRenderingContext2D,
    animTimeMs: number
  ): void {
    const u = GAME_CONSTANTS.UNIT_PX
    const baseWidthPx = GAME_CONSTANTS.BASE_WIDTH_UNITS * u

    for (const vfx of this.activePowerVfxToRender) {
      const envelope = Math.sin(Math.min(1, vfx.progress) * Math.PI)
      if (envelope <= 0.02) continue

      if (vfx.category === 'POSITIVE') {
        const relX = vfx.casterLaneOffsetX - this.offsetX
        ctx.save()
        ctx.translate(relX, 0)
        const colH = 26 * u
        const grad = ctx.createLinearGradient(0, 0, 0, -colH)
        grad.addColorStop(0, `rgba(56, 189, 248, ${(0.38 * envelope).toFixed(3)})`)
        grad.addColorStop(0.5, `rgba(250, 204, 21, ${(0.28 * envelope).toFixed(3)})`)
        grad.addColorStop(1, 'rgba(56, 189, 248, 0)')
        ctx.fillStyle = grad
        ctx.fillRect(-baseWidthPx * 0.55, -colH, baseWidthPx * 1.1, colH)
        ctx.restore()
      } else {
        // NEGATIVE: Vertical purple column of "Névoa Caos" rising on each target tower!
        for (const targetAbsOffsetX of vfx.targetLaneOffsetsX) {
          const relX = targetAbsOffsetX - this.offsetX
          ctx.save()
          ctx.translate(relX, 0)

          const colH = 32 * u
          const colW = baseWidthPx * 1.18
          const grad = ctx.createLinearGradient(0, 20, 0, -colH)
          grad.addColorStop(0, `rgba(88, 28, 135, ${(0.68 * envelope).toFixed(3)})`)
          grad.addColorStop(0.45, `rgba(147, 51, 234, ${(0.48 * envelope).toFixed(3)})`)
          grad.addColorStop(0.85, `rgba(192, 132, 252, ${(0.25 * envelope).toFixed(3)})`)
          grad.addColorStop(1, 'rgba(192, 132, 252, 0)')

          ctx.fillStyle = grad
          ctx.fillRect(-colW / 2, -colH, colW, colH + 20)

          // Swirling purple Névoa Caos clouds rising up the column
          for (let i = 0; i < 6; i++) {
            const cycle = ((animTimeMs * 0.0018 + i * 0.17) % 1)
            const cy = -cycle * colH * 0.85
            const cx = Math.sin(animTimeMs * 0.004 + i * 1.7) * (colW * 0.28)
            this.drawBorderlessFogCloudUnit(
              ctx,
              cx,
              cy,
              140,
              64,
              i % 2 === 0 ? '#9333EA' : '#C084FC',
              0.42 * envelope * (1 - cycle * 0.5),
              i % 2 === 1
            )
          }

          // Jagged purple lightning strike down the target column
          ctx.strokeStyle = '#E9D5FF'
          ctx.shadowColor = '#A855F7'
          ctx.shadowBlur = 16
          ctx.lineWidth = 3.5
          ctx.globalAlpha = envelope
          ctx.beginPath()
          ctx.moveTo(0, -colH * 0.9)
          for (let s = 1; s <= 7; s++) {
            const sy = -colH * 0.9 + (s / 7) * (colH * 0.88)
            const sx = Math.sin(animTimeMs * 0.035 + s * 2.4) * 26
            ctx.lineTo(sx, sy)
          }
          ctx.stroke()

          ctx.restore()
        }
      }
    }
  }

  /**
   * Renderiza as 3 Zonas Móveis do Modo Infinito / Abismo (`ENDLESS`):
   * - Feixe de Luz Vertical suave no centro da construção.
   * - Zona 3 (Topo): Duas bandeiras ligadas por uma linha pontilhada de losangos azuis/cianos (`checkpointLineY`) + progresso de 1.5s.
   * - Zona 1 (Terço Inferior): Linha horizontal brilhante (`petrifyLineY` / `abyssLineY`), cortina escura/acinzentada semitransparente e nuvens escuras abaixo dela (ou feixe roxo/vermelho em sobrecarga no Multiplayer).
   * - Feixe de Medição Final quando o tempo limite máximo (`150s`) é atingido no Multiplayer.
   */
  private renderEndlessZonesAndAbyss(
    ctx: CanvasRenderingContext2D,
    canvasWidth: number,
    animTimeMs: number
  ): void {
    const u = GAME_CONSTANTS.UNIT_PX
    const baseHalfW = (GAME_CONSTANTS.BASE_WIDTH_UNITS * u) / 2
    const checkpointY = -this.nextEndlessCheckpointUnits * u
    const petrifyY = -this.petrifyLineHeightUnits * u

    let minSpanX = -Math.max(baseHalfW * 2.6, canvasWidth * 0.55)
    let maxSpanX = Math.max(baseHalfW * 2.6, canvasWidth * 0.55)
    if (this.remoteLanesToRender.length > 0) {
      for (const r of this.remoteLanesToRender) {
        const relX = r.laneOffsetX - this.offsetX
        minSpanX = Math.min(minSpanX, relX - baseHalfW * 2.5)
        maxSpanX = Math.max(maxSpanX, relX + baseHalfW * 2.5)
      }
    }

    ctx.save()

    // 0. Coluna de Luz Vertical suave no centro da torre (como na referência visual)
    const beamTopY = checkpointY - 14 * u
    const beamBotY = petrifyY
    if (beamBotY > beamTopY) {
      const beamW = 3.2 * u
      const colGrad = ctx.createLinearGradient(0, beamTopY, 0, beamBotY)
      colGrad.addColorStop(0, 'rgba(255, 255, 255, 0.22)')
      colGrad.addColorStop(0.55, 'rgba(224, 242, 254, 0.10)')
      colGrad.addColorStop(1, 'rgba(224, 242, 254, 0)')
      ctx.fillStyle = colGrad
      ctx.fillRect(-beamW / 2, beamTopY, beamW, beamBotY - beamTopY)
    }

    // 1. ZONA 3 — As Bandeiras de Checkpoint + Linha Pontilhada de Losangos Azuis/Cianos (Topo da Tela)
    const isHoldingHere =
      this.checkpointHoldTarget === this.nextEndlessCheckpointUnits
    const holdRatio = isHoldingHere
      ? Math.min(
          1,
          this.checkpointHoldTimerMs / GAME_CONSTANTS.ENDLESS_CHECKPOINT_HOLD_MS
        )
      : 0

    const flagSpreadX = baseHalfW * 1.48
    const diamondSpacing = 18
    const totalW = flagSpreadX * 2
    const countDiamonds = Math.floor(totalW / diamondSpacing)

    for (let i = 0; i <= countDiamonds; i++) {
      const dx = -flagSpreadX + i * diamondSpacing
      const isLit = isHoldingHere && i / Math.max(1, countDiamonds) <= holdRatio
      const pulse =
        0.82 + 0.18 * Math.sin(animTimeMs * 0.006 + i * 0.45)

      ctx.save()
      ctx.translate(dx, checkpointY)
      ctx.rotate(Math.PI / 4)
      const sz = isLit ? 6.8 : 5.4
      ctx.fillStyle = isLit ? '#FACC15' : '#38BDF8'
      ctx.strokeStyle = isLit ? '#FEF08A' : '#E0F2FE'
      ctx.lineWidth = 1.4
      ctx.globalAlpha = pulse
      if (isLit) {
        ctx.shadowColor = '#FACC15'
        ctx.shadowBlur = 10
      } else {
        ctx.shadowColor = '#0284C7'
        ctx.shadowBlur = 6
      }
      ctx.fillRect(-sz / 2, -sz / 2, sz, sz)
      ctx.strokeRect(-sz / 2, -sz / 2, sz, sz)
      ctx.restore()
    }

    // Duas Bandeiras de Checkpoint (esquerda e direita)
    const drawCheckpointFlag = (fx: number, side: -1 | 1) => {
      ctx.save()
      ctx.translate(fx, checkpointY)

      // Pedestal circular da bandeira
      ctx.fillStyle = '#E2E8F0'
      ctx.strokeStyle = '#334155'
      ctx.lineWidth = 2
      ctx.beginPath()
      ctx.ellipse(0, 6, 9, 4, 0, 0, Math.PI * 2)
      ctx.fill()
      ctx.stroke()

      // Mastro vertical
      ctx.strokeStyle = '#F8FAFC'
      ctx.lineWidth = 3.5
      ctx.lineCap = 'round'
      ctx.beginPath()
      ctx.moveTo(0, 5)
      ctx.lineTo(0, -34)
      ctx.stroke()

      // Pomo dourado no topo do mastro
      ctx.fillStyle = '#FACC15'
      ctx.strokeStyle = '#713F12'
      ctx.lineWidth = 1.5
      ctx.beginPath()
      ctx.arc(0, -36, 4, 0, Math.PI * 2)
      ctx.fill()
      ctx.stroke()

      // Flâmula ondulante azul/ciano com estrela/losango
      const wave = Math.sin(animTimeMs * 0.006 + side) * 3
      ctx.fillStyle = isHoldingHere ? '#FACC15' : '#0284C7'
      ctx.strokeStyle = '#FFFFFF'
      ctx.lineWidth = 1.8
      ctx.beginPath()
      ctx.moveTo(0, -33)
      ctx.quadraticCurveTo(
        side * 16,
        -29 + wave,
        side * 30,
        -22 + wave * 0.6
      )
      ctx.quadraticCurveTo(side * 16, -15 + wave, 0, -12)
      ctx.closePath()
      ctx.fill()
      ctx.stroke()

      ctx.restore()
    }
    drawCheckpointFlag(-flagSpreadX - 6, -1)
    drawCheckpointFlag(flagSpreadX + 6, 1)

    // Rótulo de validação do Checkpoint
    ctx.save()
    ctx.font = '800 11px Inter, system-ui, sans-serif'
    const cpLabel = isHoldingHere
      ? `⚡ VALIDANDO CHECKPOINT ${this.nextEndlessCheckpointUnits}m (${(
          (GAME_CONSTANTS.ENDLESS_CHECKPOINT_HOLD_MS -
            this.checkpointHoldTimerMs) /
          1000
        ).toFixed(1)}s)`
      : `🏁 CHECKPOINT ${this.nextEndlessCheckpointUnits}m (+1 PODER)`
    ctx.strokeStyle = '#0F172A'
    ctx.lineWidth = 3.2
    ctx.strokeText(cpLabel, flagSpreadX + 20, checkpointY + 4)
    ctx.fillStyle = isHoldingHere ? '#FEF08A' : '#7DD3FC'
    ctx.fillText(cpLabel, flagSpreadX + 20, checkpointY + 4)
    ctx.restore()

    // Efeito de dissolução ao validar o checkpoint anterior
    for (const consumeFx of this.checkpointConsumeEffects) {
      const cy = -consumeFx.heightUnits * u
      const t = consumeFx.ageMs / consumeFx.maxAgeMs
      const alpha = Math.max(0, 1 - t)
      ctx.save()
      ctx.globalAlpha = alpha
      ctx.strokeStyle = '#FACC15'
      ctx.shadowColor = '#FACC15'
      ctx.shadowBlur = 18
      ctx.lineWidth = 4.5 * (1 - t * 0.5)
      ctx.beginPath()
      ctx.moveTo(-flagSpreadX * (1 + t * 0.3), cy)
      ctx.lineTo(flagSpreadX * (1 + t * 0.3), cy)
      ctx.stroke()
      ctx.restore()
    }

    // 2. ZONA 1 — A Linha de Petrificação / Abismo (`petrifyLineY` / `abyssLineY`) no Terço Inferior da Tela
    if (this.petrifyLineHeightUnits > 0.02 || !this.isSinglePlayer) {
      const curtainHeight = 28 * u
      const isOvertime = this.isAbyssOvertime

      // 2a. Cortina escura/acinzentada abaixo de petrifyLineY (mantendo as peças petrificadas visíveis ao fundo)
      const curtainGrad = ctx.createLinearGradient(
        0,
        petrifyY,
        0,
        petrifyY + curtainHeight
      )
      if (isOvertime) {
        curtainGrad.addColorStop(0, 'rgba(88, 28, 135, 0.58)')
        curtainGrad.addColorStop(0.35, 'rgba(49, 10, 62, 0.78)')
        curtainGrad.addColorStop(1, 'rgba(15, 10, 28, 0.94)')
      } else {
        curtainGrad.addColorStop(0, 'rgba(30, 41, 59, 0.54)')
        curtainGrad.addColorStop(0.35, 'rgba(15, 23, 42, 0.76)')
        curtainGrad.addColorStop(1, 'rgba(9, 13, 24, 0.94)')
      }
      ctx.fillStyle = curtainGrad
      ctx.fillRect(minSpanX, petrifyY, maxSpanX - minSpanX, curtainHeight)

      // 2b. Banco de nuvens escuras/acinzentadas abaixo da linha de petrificação
      const cloudStep = 148
      for (
        let cx = minSpanX - 80;
        cx <= maxSpanX + 80;
        cx += cloudStep
      ) {
        const idx = Math.round(cx / cloudStep)
        const driftX =
          Math.sin(animTimeMs * 0.0014 + idx * 1.3) * 14
        const bobY =
          Math.cos(animTimeMs * 0.002 + idx * 0.9) * 4
        this.drawBorderlessFogCloudUnit(
          ctx,
          cx + driftX,
          petrifyY + 56 + (Math.abs(idx) % 2) * 14 + bobY,
          196,
          72,
          isOvertime ? '#3B0764' : '#1E293B',
          0.74,
          idx % 2 === 0
        )
        this.drawBorderlessFogCloudUnit(
          ctx,
          cx + 64 - driftX * 0.7,
          petrifyY + 96 + bobY,
          210,
          82,
          isOvertime ? '#1E1B4B' : '#0F172A',
          0.88,
          idx % 2 !== 0
        )
      }

      // 2c. Linha Horizontal Brilhante (`petrifyLineY`)
      const pulse =
        0.78 +
        0.22 *
          Math.sin(animTimeMs * (isOvertime ? 0.025 : 0.008))

      const glowH = isOvertime ? 22 : 14
      const lineGlow = ctx.createLinearGradient(
        0,
        petrifyY - glowH,
        0,
        petrifyY + glowH
      )
      lineGlow.addColorStop(0, 'rgba(255, 255, 255, 0)')
      lineGlow.addColorStop(
        0.5,
        isOvertime
          ? `rgba(192, 132, 252, ${(0.58 * pulse).toFixed(2)})`
          : `rgba(186, 230, 253, ${(0.48 * pulse).toFixed(2)})`
      )
      lineGlow.addColorStop(1, 'rgba(255, 255, 255, 0)')
      ctx.fillStyle = lineGlow
      ctx.fillRect(minSpanX, petrifyY - glowH, maxSpanX - minSpanX, glowH * 2)

      ctx.save()
      ctx.strokeStyle = isOvertime ? '#E879F9' : '#E0F2FE'
      ctx.shadowColor = isOvertime ? '#EF4444' : '#38BDF8'
      ctx.shadowBlur = isOvertime ? 18 : 12
      ctx.lineWidth = isOvertime ? 4.8 : 3.4
      ctx.beginPath()
      ctx.moveTo(minSpanX, petrifyY)
      ctx.lineTo(maxSpanX, petrifyY)
      ctx.stroke()

      ctx.strokeStyle = '#FFFFFF'
      ctx.lineWidth = 1.6
      ctx.beginPath()
      ctx.moveTo(minSpanX, petrifyY)
      ctx.lineTo(maxSpanX, petrifyY)
      ctx.stroke()

      // Etiqueta da Linha de Petrificação / Abismo
      ctx.shadowBlur = 0
      ctx.font = '900 11px Inter, system-ui, sans-serif'
      const lineTitle = isOvertime
        ? `⚡ ABISMO ACELERANDO! (${this.petrifyLineHeightUnits.toFixed(1)}m)`
        : this.isSinglePlayer
          ? `🪨 LINHA DE PETRIFICAÇÃO (${this.petrifyLineHeightUnits.toFixed(1)}m)`
          : `🌫️ ABISMO ASCENDENTE (${this.petrifyLineHeightUnits.toFixed(1)}m)`
      ctx.strokeStyle = '#0F172A'
      ctx.lineWidth = 3.2
      ctx.strokeText(lineTitle, baseHalfW + 18, petrifyY - 8)
      ctx.fillStyle = isOvertime ? '#FDE047' : '#E2E8F0'
      ctx.fillText(lineTitle, baseHalfW + 18, petrifyY - 8)
      ctx.restore()
    }

    // 3. Feixe Horizontal de Medição de Desempate (aos 2m30s no Multiplayer)
    if (this.isAbyssMaxTimeLocked) {
      const topY = -this.towerHeight * u
      ctx.save()
      ctx.strokeStyle = '#FACC15'
      ctx.shadowColor = '#FACC15'
      ctx.shadowBlur = 16
      ctx.lineWidth = 4
      ctx.setLineDash([10, 6])
      ctx.beginPath()
      ctx.moveTo(minSpanX, topY)
      ctx.lineTo(maxSpanX, topY)
      ctx.stroke()
      ctx.setLineDash([])

      ctx.font = '900 12px Inter, system-ui, sans-serif'
      ctx.strokeStyle = '#451A03'
      ctx.lineWidth = 3.5
      const measureLabel = `📏 MEDIÇÃO FINAL DE ALTURA: ${this.towerHeight.toFixed(1)}m`
      ctx.strokeText(measureLabel, baseHalfW + 18, topY - 8)
      ctx.fillStyle = '#FEF08A'
      ctx.fillText(measureLabel, baseHalfW + 18, topY - 8)
      ctx.restore()
    }

    ctx.restore()
  }

  private renderHeightGridAndMarkers(
    ctx: CanvasRenderingContext2D,
    canvasWidth: number
  ): void {
    const u = GAME_CONSTANTS.UNIT_PX
    const baseHalfW = (GAME_CONSTANTS.BASE_WIDTH_UNITS * u) / 2

    if (this.showDebugColliders) {
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.14)'
      ctx.lineWidth = 1
      for (let i = -4; i <= 4; i++) {
        const x = i * u
        ctx.beginPath()
        ctx.moveTo(x, 0)
        ctx.lineTo(x, -GAME_CONSTANTS.GOAL_HEIGHT_UNITS * u - 10 * u)
        ctx.stroke()
      }
    }

    if (this.gameMode === 'ENDLESS') {
      return
    }

    if (this.gameMode === 'PUZZLE') {
      this.renderPuzzleLaserBeam(ctx, canvasWidth)
      return
    }

    const markerHeights =
      this.gameMode === 'SURVIVAL'
        ? [5, 8, 10, 15, 16, 20, 24, 25, 30, 32, 35, 40, 48, 56]
        : [5, 8, 10, 15, 16, 20, 24, 25, 30, 35]
    for (const h of markerHeights) {
      const y = -h * u
      const isGoal =
        this.gameMode === 'RACE' && h === GAME_CONSTANTS.GOAL_HEIGHT_UNITS
      const isCheckpoint =
        this.gameMode === 'SURVIVAL'
          ? h === 8 ||
            h === 16 ||
            h === 24 ||
            h === 32 ||
            h === 40 ||
            h === 48 ||
            h === 56
          : h === 8 || h === 16 || h === 24
      const isWindLine = h === GAME_CONSTANTS.WIND_START_HEIGHT_UNITS

      if (isGoal) {
        let minLineX = -Math.max(baseHalfW * 2.5, canvasWidth * 0.25)
        let maxLineX = Math.max(baseHalfW * 2.5, canvasWidth * 0.25)
        if (this.remoteLanesToRender.length > 0) {
          for (const r of this.remoteLanesToRender) {
            const relX = r.laneOffsetX - this.offsetX
            minLineX = Math.min(minLineX, relX - baseHalfW * 2.2)
            maxLineX = Math.max(maxLineX, relX + baseHalfW * 2.2)
          }
        }
        ctx.save()
        ctx.strokeStyle = '#FACC15'
        ctx.lineWidth = 3.5
        ctx.setLineDash([14, 10])
        ctx.beginPath()
        ctx.moveTo(minLineX, y)
        ctx.lineTo(maxLineX, y)
        ctx.stroke()
        ctx.setLineDash([])

        ctx.fillStyle = '#FEF08A'
        ctx.strokeStyle = '#713F12'
        ctx.lineWidth = 3
        ctx.font = 'bold 13px Inter, system-ui, sans-serif'
        ctx.strokeText('🏁 LINHA DE CHEGADA (30m)', baseHalfW + 24, y - 6)
        ctx.fillText('🏁 LINHA DE CHEGADA (30m)', baseHalfW + 24, y - 6)
        ctx.restore()
      } else if (isCheckpoint) {
        const reached = this.checkpointsReached.includes(h)
        const consumeFx = this.checkpointConsumeEffects.find(
          (fx) => fx.heightUnits === h
        )
        const isHoldingHere = this.checkpointHoldTarget === h
        const holdRatio = isHoldingHere
          ? Math.min(
              1,
              this.checkpointHoldTimerMs / GAME_CONSTANTS.CHECKPOINT_HOLD_MS
            )
          : 0

        // Once consumed and its dissolution animation finishes, the line disappears ("brilha, se desfaz")
        if (reached && !consumeFx) {
          if (this.showDebugColliders) {
            ctx.save()
            ctx.fillStyle = 'rgba(134, 239, 172, 0.55)'
            ctx.font = '600 10px Inter, system-ui, sans-serif'
            ctx.fillText(`✓ Checkpoint ${h}m (Consumido)`, baseHalfW + 24, y + 4)
            ctx.restore()
          }
          continue
        }

        ctx.save()
        if (consumeFx) {
          // Glowing & dissolving line animation!
          const t = consumeFx.ageMs / consumeFx.maxAgeMs
          const alpha = Math.max(0, 1 - t)
          const spread = 1.8 + t * 0.8
          ctx.globalAlpha = alpha
          ctx.strokeStyle = '#FACC15'
          ctx.shadowColor = '#FACC15'
          ctx.shadowBlur = 16
          ctx.lineWidth = 4 * (1 - t * 0.5)
          ctx.beginPath()
          ctx.moveTo(-baseHalfW * spread, y)
          ctx.lineTo(baseHalfW * spread, y)
          ctx.stroke()
        } else {
          ctx.strokeStyle = isHoldingHere
            ? '#FDE047'
            : 'rgba(255, 255, 255, 0.65)'
          ctx.lineWidth = isHoldingHere ? 2.8 : 1.8
          ctx.setLineDash([8, 8])
          ctx.beginPath()
          ctx.moveTo(-baseHalfW * 1.8, y)
          ctx.lineTo(baseHalfW * 1.8, y)
          ctx.stroke()
          ctx.setLineDash([])

          if (isHoldingHere && holdRatio > 0) {
            // Fill progress along the checkpoint line during the 0.5s stabilization hold
            ctx.strokeStyle = '#FACC15'
            ctx.lineWidth = 4
            ctx.beginPath()
            ctx.moveTo(-baseHalfW * 1.8, y)
            ctx.lineTo(-baseHalfW * 1.8 + baseHalfW * 3.6 * holdRatio, y)
            ctx.stroke()
          }

          ctx.fillStyle = isHoldingHere ? '#FEF08A' : '#FFFFFF'
          ctx.font = '600 11px Inter, system-ui, sans-serif'
          ctx.fillText(
            isHoldingHere
              ? `⚡ Ativando Poder ${h}m (${Math.round(holdRatio * 100)}%)`
              : `★ Checkpoint ${h}m ( Poder )`,
            baseHalfW + 24,
            y + 4
          )
        }
        ctx.restore()
      } else if (this.showDebugColliders && isWindLine) {
        ctx.save()
        ctx.strokeStyle = this.windEnabled
          ? 'rgba(255, 255, 255, 0.35)'
          : 'rgba(255, 255, 255, 0.15)'
        ctx.lineWidth = 1
        ctx.setLineDash([4, 6])
        ctx.beginPath()
        ctx.moveTo(-baseHalfW * 1.8, y)
        ctx.lineTo(baseHalfW * 1.8, y)
        ctx.stroke()
        ctx.setLineDash([])

        ctx.fillStyle = this.windEnabled
          ? '#FFFFFF'
          : 'rgba(255, 255, 255, 0.5)'
        ctx.font = '600 11px Inter, system-ui, sans-serif'
        ctx.fillText(
          this.windEnabled
            ? '💨 Zona de Vento (15m+)'
            : '💨 Zona de Vento (15m+ — Removido)',
          baseHalfW + 24,
          y + 4
        )
        ctx.restore()
      } else if (this.showDebugColliders) {
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.15)'
        ctx.lineWidth = 1
        ctx.beginPath()
        ctx.moveTo(-baseHalfW * 1.3, y)
        ctx.lineTo(baseHalfW * 1.3, y)
        ctx.stroke()

        ctx.fillStyle = 'rgba(255, 255, 255, 0.65)'
        ctx.font = '10px Inter, system-ui, sans-serif'
        ctx.fillText(`${h}m`, baseHalfW + 24, y + 3)
      }
    }
  }

  /**
   * Renderiza o Feixe de Laser horizontal contínuo do Modo Quebra-Cabeça (9m)
   * com emissores metálicos nas extremidades, núcleo incandescente e sobrecarga.
   */
  private renderPuzzleLaserBeam(
    ctx: CanvasRenderingContext2D,
    canvasWidth: number
  ): void {
    const u = GAME_CONSTANTS.UNIT_PX
    const baseHalfW = (GAME_CONSTANTS.BASE_WIDTH_UNITS * u) / 2
    const laserY = -GAME_CONSTANTS.PUZZLE_LASER_HEIGHT_UNITS * u
    const now = performance.now()

    const anyOverload =
      (this.laserOverloadRemainingMs !== null &&
        this.laserOverloadRemainingMs > 0) ||
      this.remoteLanesToRender.some(
        (r) =>
          typeof r.laserOverloadRemainingMs === 'number' &&
          r.laserOverloadRemainingMs > 0
      )

    let minLineX = -Math.max(baseHalfW * 2.35, canvasWidth * 0.28)
    let maxLineX = Math.max(baseHalfW * 2.35, canvasWidth * 0.28)
    if (this.remoteLanesToRender.length > 0) {
      for (const r of this.remoteLanesToRender) {
        const relX = r.laneOffsetX - this.offsetX
        minLineX = Math.min(minLineX, relX - baseHalfW * 2.15)
        maxLineX = Math.max(maxLineX, relX + baseHalfW * 2.15)
      }
    }

    const pulse = anyOverload
      ? 0.65 + 0.35 * Math.sin(now * 0.032)
      : 0.78 + 0.22 * Math.sin(now * 0.008)

    ctx.save()

    // 1. Halo vermelho amplo
    const haloH = anyOverload ? 26 : 16
    const haloGrad = ctx.createLinearGradient(
      0,
      laserY - haloH,
      0,
      laserY + haloH
    )
    haloGrad.addColorStop(0, 'rgba(239, 68, 68, 0)')
    haloGrad.addColorStop(
      0.5,
      anyOverload
        ? `rgba(239, 68, 68, ${(0.55 * pulse).toFixed(2)})`
        : `rgba(239, 68, 68, ${(0.32 * pulse).toFixed(2)})`
    )
    haloGrad.addColorStop(1, 'rgba(239, 68, 68, 0)')
    ctx.fillStyle = haloGrad
    ctx.fillRect(minLineX, laserY - haloH, maxLineX - minLineX, haloH * 2)

    // 2. Feixe vermelho principal
    ctx.strokeStyle = anyOverload ? '#EF4444' : '#F87171'
    ctx.shadowColor = '#EF4444'
    ctx.shadowBlur = anyOverload ? 20 : 12
    ctx.lineWidth = anyOverload ? 6.5 : 4.2
    ctx.beginPath()
    ctx.moveTo(minLineX, laserY)
    ctx.lineTo(maxLineX, laserY)
    ctx.stroke()

    // 3. Núcleo branco-amarelado incandescente
    ctx.strokeStyle = anyOverload ? '#FEF08A' : '#FEE2E2'
    ctx.shadowBlur = 4
    ctx.lineWidth = anyOverload ? 2.6 : 1.6
    ctx.beginPath()
    ctx.moveTo(minLineX, laserY)
    ctx.lineTo(maxLineX, laserY)
    ctx.stroke()

    // 4. Emissores de laser metálicos nas extremidades esquerda e direita
    const drawEmitter = (ex: number, dir: 1 | -1) => {
      ctx.save()
      ctx.translate(ex, laserY)
      ctx.fillStyle = '#334155'
      ctx.strokeStyle = '#0F172A'
      ctx.lineWidth = 2.2
      ctx.beginPath()
      ctx.roundRect(dir === 1 ? -22 : -4, -11, 26, 22, 5)
      ctx.fill()
      ctx.stroke()

      // Lente vermelha brilhante do canhão de laser
      ctx.fillStyle = anyOverload ? '#FEF08A' : '#EF4444'
      ctx.shadowColor = '#EF4444'
      ctx.shadowBlur = 10
      ctx.beginPath()
      ctx.arc(dir === 1 ? 3 : -3, 0, 5.5, 0, Math.PI * 2)
      ctx.fill()
      ctx.restore()
    }
    drawEmitter(minLineX, 1)
    drawEmitter(maxLineX, -1)

    // 5. Etiqueta indicativa da barreira de laser (9m)
    ctx.shadowBlur = 0
    ctx.font = '900 12px Inter, system-ui, sans-serif'
    const labelText = anyOverload
      ? '⚠️ SOBRECARGA DO LASER! QUEIMANDO PEÇAS ACIMA DE 9m!'
      : `⚡ BARREIRA DE LASER (${GAME_CONSTANTS.PUZZLE_LASER_HEIGHT_UNITS}m — ABAIXO DO LASER)`
    ctx.strokeStyle = '#450A0A'
    ctx.lineWidth = 3.5
    ctx.strokeText(labelText, baseHalfW + 18, laserY - 9)
    ctx.fillStyle = anyOverload ? '#FEF08A' : '#FCA5A5'
    ctx.fillText(labelText, baseHalfW + 18, laserY - 9)

    ctx.restore()
  }

  /**
   * Renderiza os elementos visuais de cada raia no Modo Quebra-Cabeça:
   * - Contagem regressiva (3, 2, 1) no topo após queima no laser (APENAS O NÚMERO)
   * - Número da contagem de peças que vai SUBINDO e AUMENTANDO DE TAMANHO a cada peça contada, formando um Pódio Visual
   * - Selo "FINALIZADO" sobre a construção petrificada em pedra cinza
   * - Indicador de subida da base (+0.5 bloco por peça caída na água)
   */
  private renderPuzzleLaneOverlay(
    ctx: CanvasRenderingContext2D,
    pieceCount: number,
    isPetrified: boolean,
    isCountingPhase: boolean,
    laserOverloadRemainingMs: number | null,
    riseUnits: number,
    totalPiecesInLane: number = pieceCount
  ): void {
    const u = GAME_CONSTANTS.UNIT_PX
    const laserY = -GAME_CONSTANTS.PUZZLE_LASER_HEIGHT_UNITS * u
    const now = performance.now()

    ctx.save()

    const isCountdownActive =
      typeof laserOverloadRemainingMs === 'number' &&
      laserOverloadRemainingMs > 0 &&
      !isPetrified

    if (isCountdownActive) {
      // 1A. Contagem regressiva (3, 2, 1) pós-queima no topo da tela: APENAS O GRANDE NÚMERO
      const countdownY = laserY - 58
      const countdownText = `${Math.max(1, Math.ceil(laserOverloadRemainingMs / 1000))}`
      const countdownScale = 1 + 0.16 * Math.sin(now * 0.028)

      ctx.save()
      ctx.translate(0, countdownY)
      ctx.scale(countdownScale, countdownScale)
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.font = '900 64px "Fredoka", Inter, system-ui, sans-serif'
      ctx.shadowColor = 'rgba(239, 68, 68, 0.9)'
      ctx.shadowBlur = 20
      ctx.strokeStyle = '#450A0A'
      ctx.lineWidth = 10
      ctx.lineJoin = 'round'
      ctx.strokeText(countdownText, 0, 0)
      ctx.fillStyle = '#FEF08A'
      ctx.fillText(countdownText, 0, 0)
      ctx.restore()
    } else if (isCountingPhase) {
      // 1B. Número da contagem de peças (APENAS NO FINAL DA PARTIDA, em paralelo entre todos os concorrentes):
      // Começa ACIMA do laser e vai SUBINDO e AUMENTANDO DE TAMANHO a cada peça contada, formando um Pódio Visual!
      const stepMs = GAME_CONSTANTS.PUZZLE_COUNT_STEP_MS
      const currentGlobalStep = Math.floor(this.puzzleCountTimerMs / stepMs)
      const isActivelyStepping =
        this.state === 'PUZZLE_COUNTING' &&
        pieceCount > 0 &&
        currentGlobalStep <= totalPiecesInLane
      const stepProg = isActivelyStepping
        ? Math.min(1, (this.puzzleCountTimerMs % stepMs) / (stepMs * 0.75))
        : 1
      const smoothCount = isActivelyStepping
        ? Math.max(0, pieceCount - 1 + stepProg)
        : pieceCount

      // Começa ACIMA da linha do laser (`laserY`) e sobe a cada peça contada dentro da tela fixa
      const podiumBaseY = laserY - 12
      const startY = laserY - 36
      const linearRisePx = Math.min(18, smoothCount) * 8.5
      const extraRisePx = Math.max(0, smoothCount - 18) * 4.0
      const climbOffsetPx = Math.min(185, linearRisePx + extraRisePx)
      const numberY = startY - climbOffsetPx

      // Tamanho da fonte vai aumentando progressivamente a cada peça contada
      const fontSizePx = Math.round(Math.min(96, 32 + smoothCount * 3.0))
      const stepPopScale = isActivelyStepping
        ? 1 + 0.25 * Math.sin(stepProg * Math.PI)
        : 1 + 0.06 * Math.sin(now * 0.008)

      // Coluna do Pódio Visual ACIMA do laser sustentando o número
      if (smoothCount > 0) {
        const podiumTopY = numberY + fontSizePx * 0.44
        if (podiumBaseY > podiumTopY) {
          const podiumHeight = podiumBaseY - podiumTopY
          const podiumWidth = Math.min(118, 56 + smoothCount * 2.2)

          ctx.save()
          const podiumGrad = ctx.createLinearGradient(
            0,
            podiumTopY,
            0,
            podiumBaseY
          )
          podiumGrad.addColorStop(0, 'rgba(250, 204, 21, 0.48)')
          podiumGrad.addColorStop(0.6, 'rgba(245, 158, 11, 0.30)')
          podiumGrad.addColorStop(1, 'rgba(180, 83, 9, 0.14)')

          ctx.fillStyle = podiumGrad
          ctx.strokeStyle = 'rgba(253, 224, 71, 0.88)'
          ctx.lineWidth = 2.5
          ctx.shadowColor = 'rgba(250, 204, 21, 0.48)'
          ctx.shadowBlur = 14
          ctx.beginPath()
          ctx.roundRect(
            -podiumWidth / 2,
            podiumTopY,
            podiumWidth,
            podiumHeight,
            [10, 10, 4, 4]
          )
          ctx.fill()
          ctx.stroke()

          // Degraus horizontais no pódio representando cada peça contada acima do laser
          ctx.shadowBlur = 0
          ctx.strokeStyle = 'rgba(254, 240, 138, 0.38)'
          ctx.lineWidth = 1.5
          for (let i = 1; i <= pieceCount; i++) {
            const stepLinear = Math.min(18, i) * 8.5
            const stepExtra = Math.max(0, i - 18) * 4.0
            const rungY =
              startY - Math.min(185, stepLinear + stepExtra) + fontSizePx * 0.44
            if (rungY > podiumTopY + 5 && rungY < podiumBaseY - 4) {
              ctx.beginPath()
              ctx.moveTo(-podiumWidth / 2 + 6, rungY)
              ctx.lineTo(podiumWidth / 2 - 6, rungY)
              ctx.stroke()
            }
          }

          // Plataforma de topo do Pódio sustentando o número
          const capWidth = podiumWidth + 18
          ctx.fillStyle = '#FDE047'
          ctx.strokeStyle = '#78350F'
          ctx.lineWidth = 2.5
          ctx.beginPath()
          ctx.roundRect(-capWidth / 2, podiumTopY - 5, capWidth, 10, 5)
          ctx.fill()
          ctx.stroke()
          ctx.restore()
        }
      }

      // Renderiza APENAS O NÚMERO começando acima do laser, subindo e crescendo de tamanho
      const scoreText = `${pieceCount}`
      ctx.save()
      ctx.translate(0, numberY)
      ctx.scale(stepPopScale, stepPopScale)
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.font = `900 ${fontSizePx}px "Fredoka", Inter, system-ui, sans-serif`

      ctx.shadowColor = 'rgba(250, 204, 21, 0.92)'
      ctx.shadowBlur = 20

      ctx.strokeStyle = '#0F172A'
      ctx.lineWidth = Math.max(6, fontSizePx * 0.16)
      ctx.lineJoin = 'round'
      ctx.strokeText(scoreText, 0, 0)

      ctx.fillStyle = '#FACC15'
      ctx.fillText(scoreText, 0, 0)
      ctx.restore()
    }

    // 2. Selo "FINALIZADO" sobre a torre petrificada
    if (isPetrified && !isCountingPhase) {
      ctx.save()
      ctx.translate(0, -4.4 * u)
      ctx.rotate(-0.06)

      ctx.fillStyle = 'rgba(30, 41, 59, 0.94)'
      ctx.strokeStyle = '#CBD5E1'
      ctx.lineWidth = 3
      ctx.shadowColor = 'rgba(0, 0, 0, 0.55)'
      ctx.shadowBlur = 12
      ctx.beginPath()
      ctx.roundRect(-82, -20, 164, 40, 10)
      ctx.fill()
      ctx.stroke()

      ctx.shadowBlur = 0
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillStyle = '#F8FAFC'
      ctx.font = '900 15px Inter, system-ui, sans-serif'
      ctx.fillText('🪨 FINALIZADO', 0, 0)
      ctx.restore()
    }

    // 3. Indicador de subida da ilha quando caiu peça na água (+0.5 bloco por queda)
    if (riseUnits > 0) {
      const baseTopY = -riseUnits * u
      ctx.save()
      ctx.translate(0, baseTopY + 18)
      ctx.fillStyle = 'rgba(127, 29, 29, 0.88)'
      ctx.strokeStyle = '#FCA5A5'
      ctx.lineWidth = 1.6
      ctx.beginPath()
      ctx.roundRect(-58, -10, 116, 20, 6)
      ctx.fill()
      ctx.stroke()

      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillStyle = '#FECACA'
      ctx.font = '800 10px Inter, system-ui, sans-serif'
      ctx.fillText(`⬆️ BASE +${riseUnits.toFixed(1)} BLOCO`, 0, 0)
      ctx.restore()
    }

    ctx.restore()
  }

  private renderSideIslands(
    ctx: CanvasRenderingContext2D,
    animTimeMs: number
  ): void {
    for (const isl of this.islands) {
      const localX = isl.body.position.x - this.offsetX
      const localY = isl.body.position.y
      const widthPx = this.toPixels(isl.width)
      const heightPx = this.toPixels(isl.height)
      const spawnProgress =
        isl.spawnDurationMs > 0
          ? Math.min(1, isl.spawnAgeMs / isl.spawnDurationMs)
          : 1
      spriteRegistry.drawSideIsland(
        ctx,
        localX,
        localY,
        widthPx,
        heightPx,
        isl.side,
        spawnProgress,
        animTimeMs
      )
    }
  }

  private renderActivePieceGuide(
    ctx: CanvasRenderingContext2D,
    piece: TowerPieceEntity
  ): void {
    const u = GAME_CONSTANTS.UNIT_PX
    const body = piece.body
    const localX = body.position.x - this.offsetX
    const localY = body.position.y

    const cellPx = u * piece.scale
    const cos = Math.cos(body.angle)
    const sin = Math.sin(body.angle)

    let minX = Infinity
    let maxX = -Infinity
    const worldCells: Array<{ left: number; right: number; bottomY: number }> = []

    for (const c of piece.cellsFromCoM) {
      const rx = (c.x * cos - c.y * sin) * cellPx
      const ry = (c.x * sin + c.y * cos) * cellPx
      const cx = localX + rx
      const cy = localY + ry
      minX = Math.min(minX, cx - cellPx / 2)
      maxX = Math.max(maxX, cx + cellPx / 2)
      worldCells.push({
        left: body.position.x + rx - cellPx / 2 + 3.5,
        right: body.position.x + rx + cellPx / 2 - 3.5,
        bottomY: cy + cellPx / 2,
      })
    }

    let minDropDist = Infinity
    const supportBodies = [
      this.baseBody,
      ...this.islands.map((i) => i.body),
      ...this.settledPieces.map((p) => p.body),
    ]
    for (const sup of supportBodies) {
      const parts = sup.parts.length > 1 ? sup.parts.slice(1) : [sup]
      for (const part of parts) {
        const pLeft = part.bounds.min.x
        const pRight = part.bounds.max.x
        const pTop = part.bounds.min.y
        for (const wc of worldCells) {
          const overlapX = Math.min(wc.right, pRight) - Math.max(wc.left, pLeft)
          if (overlapX > 4.0 && pTop >= wc.bottomY - 2) {
            const drop = pTop - wc.bottomY
            if (drop < minDropDist) {
              minDropDist = drop
            }
          }
        }
      }
    }

    const guideBottomY =
      minDropDist < Infinity ? localY + minDropDist : 0

    ctx.save()
    ctx.fillStyle = 'rgba(255, 255, 255, 0.045)'
    ctx.fillRect(
      minX,
      localY,
      maxX - minX,
      Math.max(0, guideBottomY - localY)
    )

    ctx.strokeStyle = 'rgba(255, 255, 255, 0.2)'
    ctx.lineWidth = 1
    ctx.setLineDash([4, 4])
    ctx.beginPath()
    ctx.moveTo(minX, localY)
    ctx.lineTo(minX, guideBottomY)
    ctx.moveTo(maxX, localY)
    ctx.lineTo(maxX, guideBottomY)
    ctx.stroke()
    ctx.setLineDash([])

    if (this.showGhostPiece && minDropDist < Infinity && minDropDist > 4) {
      ctx.save()
      ctx.translate(localX, localY + minDropDist)
      ctx.rotate(body.angle)
      ctx.globalAlpha = 0.28
      spriteRegistry.drawPieceCells(
        ctx,
        piece.type,
        piece.variant,
        piece.cellsFromCoM,
        piece.scale,
        {
          isGhost: true,
          showCenterOfMass: false,
          powerEffect: piece.powerEffect,
          colorPaletteIndex: piece.colorPaletteIndex,
        }
      )
      ctx.restore()
    }

    ctx.restore()
  }

  private renderPieceEntity(
    ctx: CanvasRenderingContext2D,
    piece: TowerPieceEntity,
    isActive: boolean = false
  ): void {
    const u = GAME_CONSTANTS.UNIT_PX
    const body = piece.body
    let localX = body.position.x - this.offsetX
    const localY = body.position.y

    const recallAnim = isActive ? this.pieceRecallAnim : null
    const recallProg = recallAnim
      ? Math.min(
          1,
          recallAnim.elapsedMs / Math.max(1, recallAnim.totalDurationMs)
        )
      : undefined

    let pulse = 0
    if (isActive && this.pistonTimerMs > 0 && !recallAnim) {
      const progress = 1 - this.pistonTimerMs / this.pistonDurationMs
      pulse = Math.sin(progress * Math.PI)
      const pistonOffsetPx = this.pistonDir * 6.0 * pulse
      localX += pistonOffsetPx
    }

    if (isActive && this.boundaryShakeTimerMs > 0 && !recallAnim) {
      const ratio = this.boundaryShakeTimerMs / 135
      const jiggle =
        Math.sin((1 - ratio) * Math.PI * 3.5) * 3.6 * ratio * this.boundaryShakeDir
      localX += jiggle
    }

    const isFastFalling =
      isActive &&
      !recallAnim &&
      (this.isSoftDropping || piece.powerEffect === 'TURBO_DROP') &&
      this.bottomTouchTimerMs === 0 &&
      !this.hasBottomSupportThisTick

    // Mini rastro shadow ("mini rastro shadow") behind the accelerating piece
    if (
      isActive &&
      !recallAnim &&
      (isFastFalling || this.softDropTrail.length > 0)
    ) {
      this.renderFastDropShadowTrail(ctx, piece, localX, localY, isFastFalling)
    }

    ctx.save()
    ctx.translate(localX, localY)
    if (recallProg !== undefined && recallProg >= 0.53) {
      const popT = Math.min(1, (recallProg - 0.53) / 0.47)
      const scalePop = 1 + 0.34 * Math.sin(popT * Math.PI)
      const wobble = Math.sin(popT * Math.PI * 3) * 0.085
      ctx.scale(scalePop, scalePop)
      ctx.rotate(wobble)
    } else if (pulse > 0) {
      ctx.scale(1 + 0.08 * pulse, 1 - 0.04 * pulse)
    } else if (isFastFalling) {
      // Subtle vertical aerodynamic speed stretch when pressing Down
      ctx.scale(0.97, 1.045)
    }
    ctx.rotate(body.angle)

    if (piece.body.isSleeping && !isActive) {
      ctx.globalAlpha = 0.94
    }

    spriteRegistry.drawPieceCells(
      ctx,
      piece.type,
      piece.variant,
      piece.cellsFromCoM,
      piece.scale,
      {
        isSnapped: piece.snapped,
        isSleeping: piece.body.isSleeping,
        showCenterOfMass: isActive || this.showDebugColliders,
        powerEffect: piece.powerEffect,
        isStaticAnchor: piece.isStaticAnchor,
        isGlued: piece.isGlued,
        colorPaletteIndex: piece.colorPaletteIndex,
        isPetrified: piece.isPetrified,
        isLaserBurning: piece.isLaserBurning,
        isCountedHighlight: piece.isCountedHighlight,
        countOrderNumber: piece.countOrderNumber,
      }
    )

    // Visual speed effect directly on the accelerating piece ("efeito de velocidade na peça")
    if (isFastFalling) {
      this.renderFastDropPieceOverlay(ctx, piece)
    }

    // Lateral Barrier Masked Glow ("efeito de glow na lateral da peça com uma máscara")
    ctx.rotate(-body.angle)
    if (isActive) {
      const span = this.getPieceHorizontalSpanUnits(piece, body.angle)
      const bodyXUnits = (body.position.x - this.offsetX) / u
      const leftOuterUnits = bodyXUnits + span.minOffsetUnits
      const rightOuterUnits = bodyXUnits + span.maxOffsetUnits
      const boundU = GAME_CONSTANTS.CONTROL_BOUND_X_UNITS // 6.5u
      const fadeZoneU = 1.25

      let leftGlow = Math.max(
        0,
        Math.min(1, (-leftOuterUnits - (boundU - fadeZoneU)) / fadeZoneU)
      ) * 0.85
      let rightGlow = Math.max(
        0,
        Math.min(1, (rightOuterUnits - (boundU - fadeZoneU)) / fadeZoneU)
      ) * 0.85

      if (this.boundaryShakeTimerMs > 0) {
        const boost = (this.boundaryShakeTimerMs / 135) * 0.35
        if (this.boundaryShakeDir === -1) {
          leftGlow = Math.min(1, Math.max(leftGlow, 0.85) + boost)
        } else {
          rightGlow = Math.min(1, Math.max(rightGlow, 0.85) + boost)
        }
      }

      if (leftGlow > 0.01 || rightGlow > 0.01) {
        spriteRegistry.drawPieceLateralBarrierGlow(
          ctx,
          piece.type,
          piece.variant,
          piece.cellsFromCoM,
          piece.scale,
          body.angle,
          {
            leftGlow,
            rightGlow,
            mode: 'CONTROL',
            powerEffect: piece.powerEffect,
          }
        )
      }
    } else if (!body.isStatic) {
      const leftOuterUnits = (body.bounds.min.x - this.offsetX) / u
      const rightOuterUnits = (body.bounds.max.x - this.offsetX) / u
      const killU = GAME_CONSTANTS.KILL_ZONE_X_UNITS
      const warnStartU = killU - 1.7

      const leftGlow = Math.max(
        0,
        Math.min(1, (-leftOuterUnits - warnStartU) / (killU - warnStartU))
      )
      const rightGlow = Math.max(
        0,
        Math.min(1, (rightOuterUnits - warnStartU) / (killU - warnStartU))
      )

      if (leftGlow > 0.01 || rightGlow > 0.01) {
        spriteRegistry.drawPieceLateralBarrierGlow(
          ctx,
          piece.type,
          piece.variant,
          piece.cellsFromCoM,
          piece.scale,
          body.angle,
          {
            leftGlow,
            rightGlow,
            mode: 'DANGER',
            powerEffect: piece.powerEffect,
          }
        )
      }
    }

    ctx.restore()

    if (recallAnim && recallProg !== undefined) {
      this.drawPieceRecallTransformOverlay(
        ctx,
        localX,
        localY,
        recallProg,
        recallAnim.powerId,
        recallAnim.startLocalX,
        recallAnim.startLocalY
      )
    }
  }

  /**
   * Renders a compact, layered afterimage shadow trail ("mini rastro shadow")
   * directly behind the falling piece while pressing Down (`isSoftDropping` / `TURBO_DROP`).
   */
  private renderFastDropShadowTrail(
    ctx: CanvasRenderingContext2D,
    piece: TowerPieceEntity,
    localX: number,
    localY: number,
    isFastFalling: boolean
  ): void {
    const cellPx = GAME_CONSTANTS.UNIT_PX * piece.scale
    const echoes: Array<{ x: number; y: number; angle: number; fade: number }> = []

    if (this.softDropTrail.length >= 2) {
      for (let i = this.softDropTrail.length - 1; i >= 0; i--) {
        const pt = this.softDropTrail[i]
        const ageRatio = Math.min(1, pt.ageMs / 110)
        const fade = Math.max(0.12, (1 - ageRatio) * ((this.softDropTrail.length - i) / this.softDropTrail.length))
        // Ensure trail echo sits visually above the current piece position
        const trailY = Math.min(pt.localY, localY - (i + 1) * 7.5)
        echoes.push({
          x: pt.localX,
          y: trailY,
          angle: pt.angle,
          fade,
        })
      }
    } else if (isFastFalling) {
      // Immediate 2-step mini shadow trail on the first frame of pressing Down
      echoes.push(
        { x: localX, y: localY - 16, angle: piece.body.angle, fade: 0.38 },
        { x: localX, y: localY - 8, angle: piece.body.angle, fade: 0.72 }
      )
    }

    for (const echo of echoes) {
      ctx.save()
      ctx.translate(echo.x, echo.y)
      ctx.scale(0.96, 1.03)
      ctx.rotate(echo.angle)

      // 1. Faint ghost pass of the piece sprite
      ctx.save()
      ctx.globalAlpha = 0.22 * echo.fade
      spriteRegistry.drawPieceCells(
        ctx,
        piece.type,
        piece.variant,
        piece.cellsFromCoM,
        piece.scale,
        {
          isGhost: true,
          powerEffect: piece.powerEffect,
          colorPaletteIndex: piece.colorPaletteIndex,
        }
      )
      ctx.restore()

      // 2. Crisp dark-indigo mini shadow silhouette over each block cell
      ctx.fillStyle = `rgba(15, 23, 42, ${(0.34 * echo.fade).toFixed(3)})`
      ctx.strokeStyle = `rgba(125, 211, 252, ${(0.28 * echo.fade).toFixed(3)})`
      ctx.lineWidth = 1
      for (const cell of piece.cellsFromCoM) {
        const rx = (cell.x - 0.5) * cellPx + 1
        const ry = (cell.y - 0.5) * cellPx + 1
        const rw = cellPx - 2
        const rh = cellPx - 2
        ctx.beginPath()
        ctx.roundRect(rx, ry, rw, rh, 4)
        ctx.fill()
        ctx.stroke()
      }

      ctx.restore()
    }
  }

  /**
   * Renders the aerodynamic speed effect ("efeito de velocidade na peça") directly
   * on the active piece while accelerating downward:
   * - Leading-edge wind compression highlight along the bottom of the piece
   * - Animated vertical speed streaks streaming upward across the piece's cells
   */
  private renderFastDropPieceOverlay(
    ctx: CanvasRenderingContext2D,
    piece: TowerPieceEntity
  ): void {
    const cellPx = GAME_CONSTANTS.UNIT_PX * piece.scale
    const now = performance.now()

    ctx.save()
    // Work in world-vertical orientation centered on the piece so speed lines stream straight up
    ctx.rotate(-piece.body.angle)

    const span = this.getPieceHorizontalSpanUnits(piece, piece.body.angle)
    const minX = span.minOffsetUnits * GAME_CONSTANTS.UNIT_PX
    const maxX = span.maxOffsetUnits * GAME_CONSTANTS.UNIT_PX
    const widthPx = Math.max(cellPx, maxX - minX)

    // Compute approximate vertical extent in local space
    let minY = Infinity
    let maxY = -Infinity
    const cos = Math.cos(piece.body.angle)
    const sin = Math.sin(piece.body.angle)
    for (const c of piece.cellsFromCoM) {
      const wy = (c.x * sin + c.y * cos) * cellPx
      if (wy - cellPx * 0.5 < minY) minY = wy - cellPx * 0.5
      if (wy + cellPx * 0.5 > maxY) maxY = wy + cellPx * 0.5
    }
    if (!Number.isFinite(minY)) {
      minY = -cellPx
      maxY = cellPx
    }

    // 1. Leading-edge wind-compression sheen at the bottom of the piece
    const sheenH = Math.min(14, (maxY - minY) * 0.45)
    const sheenGrad = ctx.createLinearGradient(0, maxY + 2, 0, maxY - sheenH)
    sheenGrad.addColorStop(0, 'rgba(224, 242, 254, 0.65)')
    sheenGrad.addColorStop(0.45, 'rgba(56, 189, 248, 0.28)')
    sheenGrad.addColorStop(1, 'rgba(56, 189, 248, 0)')
    ctx.fillStyle = sheenGrad
    ctx.beginPath()
    ctx.roundRect(minX + 2, maxY - sheenH, widthPx - 4, sheenH + 2, 4)
    ctx.fill()

    // 2. Animated vertical speed streaks ("linhas de velocidade") across & trailing the piece
    const streakCount = Math.max(3, Math.min(6, Math.round(widthPx / 14)))
    ctx.lineCap = 'round'
    for (let i = 0; i < streakCount; i++) {
      const t = (i + 0.5) / streakCount
      const sx = minX + 4 + t * (widthPx - 8)
      // Fast upward cycle
      const cycle = ((now * 0.011 + i * 1.37) % 1)
      const streakLen = 11 + (i % 2) * 6
      const syBottom = maxY - 2 - cycle * ((maxY - minY) + 12)
      const syTop = syBottom - streakLen
      const alpha = Math.sin(cycle * Math.PI) * 0.78

      if (alpha > 0.05) {
        const lineGrad = ctx.createLinearGradient(sx, syBottom, sx, syTop)
        lineGrad.addColorStop(0, `rgba(255, 255, 255, ${alpha.toFixed(3)})`)
        lineGrad.addColorStop(0.5, `rgba(125, 211, 252, ${(alpha * 0.85).toFixed(3)})`)
        lineGrad.addColorStop(1, 'rgba(125, 211, 252, 0)')

        ctx.strokeStyle = lineGrad
        ctx.lineWidth = i % 2 === 0 ? 2.0 : 1.4
        ctx.beginPath()
        ctx.moveTo(sx, syBottom)
        ctx.lineTo(sx, syTop)
        ctx.stroke()
      }
    }

    ctx.restore()
  }

  /**
   * 3. Renderiza a animação visual das peças que estão sumindo (`DISSOLVING` por 200ms):
   * - Fade-out rápido (`alpha = 1.0 - progress`)
   * - Efeito de encolhimento (`scale` de `1.0` para `0.3`)
   * - Brilho branco/transparente de vaporização
   */
  private renderDissolvingBricks(ctx: CanvasRenderingContext2D): void {
    const u = GAME_CONSTANTS.UNIT_PX
    for (const item of this.dissolvingBricks) {
      const isLaser = item.reason === 'LASER'
      const alpha = isLaser
        ? item.progress < 0.42
          ? 1.0
          : Math.max(0, 1.0 - (item.progress - 0.42) / 0.58)
        : Math.max(0, 1.0 - item.progress)
      // Para LASER: primeiro infla levemente brilhando intenso (0..0.38) e depois queima/encolhe rápido
      const scale = isLaser
        ? item.progress < 0.38
          ? 1.0 + Math.sin((item.progress / 0.38) * Math.PI) * 0.14
          : Math.max(0.22, 1.0 - ((item.progress - 0.38) / 0.62) * 0.78)
        : 1.0 - item.progress * 0.7
      const piece = item.piece

      ctx.save()
      ctx.translate(item.startX, item.startY)
      ctx.rotate(item.angle)
      ctx.scale(scale, scale)
      ctx.globalAlpha = alpha
      ctx.shadowColor = isLaser ? '#FEF08A' : '#FFFFFF'
      ctx.shadowBlur = isLaser
        ? 26 * (1 - item.progress * 0.35)
        : 14 * (1 - item.progress * 0.4)

      spriteRegistry.drawPieceCells(
        ctx,
        piece.type,
        piece.variant,
        piece.cellsFromCoM,
        piece.scale,
        {
          isSnapped: false,
          isSleeping: false,
          showCenterOfMass: false,
          powerEffect: piece.powerEffect,
          colorPaletteIndex: piece.colorPaletteIndex,
          isLaserBurning: isLaser,
        }
      )

      // Brilho de vaporização/queima sobre os blocos da peça
      const cellPx = u * piece.scale
      ctx.fillStyle = isLaser
        ? item.progress < 0.35
          ? 'rgba(254, 240, 138, 0.92)'
          : 'rgba(239, 68, 68, 0.85)'
        : item.reason === 'WATER'
          ? 'rgba(224, 242, 254, 0.55)'
          : 'rgba(255, 255, 255, 0.65)'
      ctx.globalAlpha = isLaser
        ? alpha * (item.progress < 0.35 ? 0.88 : 0.72)
        : alpha * (0.45 + 0.45 * item.progress)
      for (const c of piece.cellsFromCoM) {
        ctx.fillRect(
          c.x * cellPx - cellPx * 0.48,
          c.y * cellPx - cellPx * 0.48,
          cellPx * 0.96,
          cellPx * 0.96
        )
      }

      ctx.restore()
    }
  }

  private renderImpactParticles(ctx: CanvasRenderingContext2D): void {
    ctx.save()
    for (const p of this.impactParticles) {
      const lifeRatio = Math.max(0, 1 - p.ageMs / p.maxAgeMs)
      if (p.kind === 'ring') {
        ctx.strokeStyle = `rgba(255, 255, 255, ${(lifeRatio * 0.85).toFixed(2)})`
        ctx.lineWidth = 2.2 * lifeRatio
        ctx.beginPath()
        ctx.arc(p.x, p.y, p.radius, 0, Math.PI * 2)
        ctx.stroke()
      } else if (p.kind === 'spark') {
        ctx.fillStyle = p.color || `rgba(255, 255, 255, ${(lifeRatio * 0.95).toFixed(2)})`
        ctx.strokeStyle = p.color || `rgba(254, 240, 138, ${(lifeRatio * 0.85).toFixed(2)})`
        ctx.globalAlpha = lifeRatio
        ctx.lineWidth = 1
        ctx.beginPath()
        ctx.arc(p.x, p.y, p.radius * lifeRatio, 0, Math.PI * 2)
        ctx.fill()
        ctx.stroke()
        ctx.globalAlpha = 1.0
      } else {
        ctx.fillStyle = `rgba(248, 250, 252, ${(lifeRatio * 0.65).toFixed(2)})`
        ctx.beginPath()
        ctx.arc(p.x, p.y, p.radius, 0, Math.PI * 2)
        ctx.fill()
      }
    }
    ctx.restore()
  }

  /**
   * Renders the floating Extra Life Balloon (`EXTRA_LIFE`) that drifts upward and away.
   * The player must steer their active falling piece (`activePiece`) into the balloon to catch it and earn `+1 ❤️ Vida Extra`!
   */
  private renderExtraLifeBalloons(
    ctx: CanvasRenderingContext2D,
    animTimeMs: number
  ): void {
    const u = GAME_CONSTANTS.UNIT_PX

    ctx.save()
    for (const b of this.extraLifeBalloons) {
      const px = b.x
      const py = b.y
      const lifeRatio = Math.max(0, 1 - b.ageMs / b.maxAgeMs)
      const isUrgent = lifeRatio < 0.34
      const pulse = 1 + Math.sin(animTimeMs * (isUrgent ? 0.018 : 0.008) + b.swayPhase) * 0.08
      const tiltRad = Math.sin(animTimeMs * 0.0042 + b.swayPhase) * 0.14

      ctx.save()
      ctx.translate(px, py)

      // 1. Pulsing catch-zone target ring around the balloon so the player sees the exact pickup radius
      const ringRadius = (1.35 + Math.sin(animTimeMs * 0.01) * 0.12) * u
      ctx.save()
      ctx.strokeStyle = isUrgent
        ? 'rgba(254, 240, 138, 0.88)'
        : 'rgba(251, 113, 133, 0.78)'
      ctx.lineWidth = 2.4
      ctx.setLineDash([7, 5])
      ctx.lineDashOffset = -animTimeMs * 0.03
      ctx.beginPath()
      ctx.arc(0, 0, ringRadius, 0, Math.PI * 2)
      ctx.stroke()
      ctx.restore()

      // Soft warm glow behind the balloon
      const auraGrad = ctx.createRadialGradient(0, -4, 4, 0, -4, 42)
      auraGrad.addColorStop(0, 'rgba(254, 240, 138, 0.68)')
      auraGrad.addColorStop(0.55, 'rgba(244, 63, 94, 0.32)')
      auraGrad.addColorStop(1, 'rgba(244, 63, 94, 0)')
      ctx.fillStyle = auraGrad
      ctx.beginPath()
      ctx.arc(0, -4, 42, 0, Math.PI * 2)
      ctx.fill()

      ctx.save()
      ctx.rotate(tiltRad)
      ctx.scale(pulse, pulse)

      // 2. Wavy white/gold balloon string dangling below
      ctx.strokeStyle = '#FEF08A'
      ctx.lineWidth = 2.6
      ctx.lineCap = 'round'
      ctx.beginPath()
      ctx.moveTo(0, 18)
      const wave = Math.sin(animTimeMs * 0.009 + b.swayPhase) * 7
      ctx.bezierCurveTo(wave, 28, -wave, 38, wave * 0.5, 48)
      ctx.stroke()

      // Small golden gift tag dangling on the string
      ctx.fillStyle = '#FACC15'
      ctx.strokeStyle = '#713F12'
      ctx.lineWidth = 1.8
      ctx.beginPath()
      ctx.roundRect(-12, 27, 24, 13, 3.5)
      ctx.fill()
      ctx.stroke()
      ctx.font = '900 8.5px "Fredoka", Inter, system-ui, sans-serif'
      ctx.fillStyle = '#713F12'
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillText('+1♥', 0, 34)

      // 3. Balloon knot at bottom of heart
      ctx.fillStyle = '#E11D48'
      ctx.strokeStyle = '#4C0519'
      ctx.lineWidth = 2.2
      ctx.beginPath()
      ctx.moveTo(-5, 19)
      ctx.lineTo(5, 19)
      ctx.lineTo(0, 13)
      ctx.closePath()
      ctx.fill()
      ctx.stroke()

      // 4. Glossy 3D Heart Balloon body
      const heartGrad = ctx.createRadialGradient(-8, -14, 3, 0, -4, 32)
      heartGrad.addColorStop(0, '#FDA4AF')
      heartGrad.addColorStop(0.35, '#F43F5E')
      heartGrad.addColorStop(0.8, '#E11D48')
      heartGrad.addColorStop(1, '#9F1239')
      ctx.fillStyle = heartGrad
      ctx.strokeStyle = '#4C0519'
      ctx.lineWidth = 3
      ctx.beginPath()
      ctx.moveTo(0, 16)
      ctx.bezierCurveTo(-28, 2, -30, -24, -13, -24)
      ctx.bezierCurveTo(-5, -24, 0, -16, 0, -11)
      ctx.bezierCurveTo(0, -16, 5, -24, 13, -24)
      ctx.bezierCurveTo(30, -24, 28, 2, 0, 16)
      ctx.closePath()
      ctx.fill()
      ctx.stroke()

      // Glossy specular highlight on upper-left lobe
      ctx.fillStyle = 'rgba(255, 255, 255, 0.72)'
      ctx.beginPath()
      ctx.ellipse(-11, -13, 6, 3.2, -0.55, 0, Math.PI * 2)
      ctx.fill()

      // Bold white "+1 ❤️" inside the balloon
      ctx.font = '900 12px "Fredoka", Inter, system-ui, sans-serif'
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.strokeStyle = '#4C0519'
      ctx.lineWidth = 3
      ctx.strokeText('+1♥', 0, -4)
      ctx.fillStyle = '#FFFFFF'
      ctx.fillText('+1♥', 0, -4)

      ctx.restore()

      // 5. Floating prompt pill above the balloon so the mechanic is 100% clear
      const promptText = isUrgent
        ? '🎈💨 PEGUE RÁPIDO!'
        : '🎈 PEGUE COM A PEÇA!'
      ctx.font = '900 10px "Fredoka", Inter, system-ui, sans-serif'
      const pillW = Math.max(114, ctx.measureText(promptText).width + 18)
      const pillY = -48
      ctx.fillStyle = isUrgent
        ? 'rgba(185, 28, 28, 0.94)'
        : 'rgba(15, 23, 42, 0.92)'
      ctx.strokeStyle = isUrgent ? '#FEF08A' : '#FB7185'
      ctx.lineWidth = 2
      ctx.beginPath()
      ctx.roundRect(-pillW / 2, pillY, pillW, 19, 6)
      ctx.fill()
      ctx.stroke()

      ctx.fillStyle = '#FEF08A'
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillText(promptText, 0, pillY + 9.5)

      ctx.restore()
    }
    ctx.restore()
  }

  /**
   * Renders attractive visual fall feedback ("feedback visual mais atrativo para entender")
   * when a piece drops into the water or disintegrates laterally:
   * - Expanding dual shockwave rings + vertical splash beacon at the fall location
   * - Elastic 3D cartoon callout badge (`💔 -1 VIDA! • 🛡️ 3.0s INVULNERÁVEL!` / `🛡️ PROTEGIDO!` / `⚠️ PEÇA CAIU!`)
   */
  private renderFallFeedbackCallouts(ctx: CanvasRenderingContext2D): void {
    ctx.save()
    for (const c of this.fallFeedbackCallouts) {
      const progress = Math.min(1, c.ageMs / c.maxAgeMs)
      const fadeOut =
        progress > 0.72 ? Math.max(0, 1 - (progress - 0.72) / 0.28) : 1
      if (fadeOut <= 0.02) continue

      const popIn =
        progress < 0.16
          ? 0.55 + Math.sin((progress / 0.16) * (Math.PI / 2)) * 0.6
          : progress < 0.26
            ? 1.15 - ((progress - 0.16) / 0.1) * 0.15
            : 1.0

      const theme =
        c.tone === 'LIFE_LOSS'
          ? {
              bgTop: '#EF4444',
              bgBottom: '#991B1B',
              border: '#FFFFFF',
              outerBorder: '#450A0A',
              subColor: '#FEF08A',
              ringColor: 'rgba(244, 63, 94, 0.85)',
              beamColor: 'rgba(255, 255, 255, 0.55)',
            }
          : c.tone === 'EXTRA_LIFE_CAUGHT'
            ? {
                bgTop: '#10B981',
                bgBottom: '#047857',
                border: '#FEF08A',
                outerBorder: '#064E3B',
                subColor: '#FEF08A',
                ringColor: 'rgba(52, 211, 153, 0.9)',
                beamColor: 'rgba(254, 240, 138, 0.55)',
              }
            : c.tone === 'EXTRA_LIFE_ESCAPED'
              ? {
                  bgTop: '#64748B',
                  bgBottom: '#334155',
                  border: '#CBD5E1',
                  outerBorder: '#0F172A',
                  subColor: '#F8FAFC',
                  ringColor: 'rgba(148, 163, 184, 0.75)',
                  beamColor: 'rgba(226, 232, 240, 0.35)',
                }
              : c.tone === 'SHIELD_PROTECTED'
                ? {
                    bgTop: '#0284C7',
                    bgBottom: '#0C4A6E',
                    border: '#E0F2FE',
                    outerBorder: '#082F49',
                    subColor: '#FEF08A',
                    ringColor: 'rgba(56, 189, 248, 0.85)',
                    beamColor: 'rgba(186, 230, 253, 0.45)',
                  }
                : {
                    bgTop: '#F97316',
                    bgBottom: '#9A3412',
                    border: '#FEF08A',
                    outerBorder: '#431407',
                    subColor: '#FFFFFF',
                    ringColor: 'rgba(251, 146, 60, 0.85)',
                    beamColor: 'rgba(255, 255, 255, 0.45)',
                  }

      // 1. Expanding shockwave ring & vertical impact beacon in the first 500ms
      if (c.ageMs < 520) {
        const ringT = c.ageMs / 520
        const ringAlpha = (1 - ringT) * 0.9
        ctx.save()
        ctx.translate(c.x, c.startY + 28)

        // Vertical light column shooting up from the fall spot
        const beamH = 120 * (1 - ringT * 0.4)
        const beamW = 48 * (1 - ringT * 0.5)
        const beamGrad = ctx.createLinearGradient(0, 10, 0, -beamH)
        beamGrad.addColorStop(0, theme.beamColor)
        beamGrad.addColorStop(1, 'rgba(255, 255, 255, 0)')
        ctx.globalAlpha = ringAlpha
        ctx.fillStyle = beamGrad
        ctx.fillRect(-beamW / 2, -beamH, beamW, beamH + 10)

        // Expanding elliptical shockwave ring
        ctx.strokeStyle = '#FFFFFF'
        ctx.shadowColor = theme.ringColor
        ctx.shadowBlur = 14
        ctx.lineWidth = 3.5 * (1 - ringT * 0.6)
        ctx.beginPath()
        ctx.ellipse(
          0,
          0,
          18 + ringT * 68,
          7 + ringT * 22,
          0,
          0,
          Math.PI * 2
        )
        ctx.stroke()
        ctx.restore()
      }

      // 2. Rising 3D Arcade Callout Pill
      ctx.save()
      ctx.translate(c.x, c.y)
      ctx.scale(popIn, popIn)
      ctx.globalAlpha = fadeOut

      ctx.font = '900 13px "Fredoka", Inter, system-ui, sans-serif'
      const titleW = ctx.measureText(c.title).width
      ctx.font = '800 9.5px Inter, system-ui, sans-serif'
      const subW = ctx.measureText(c.subtitle).width
      const boxW = Math.max(118, Math.max(titleW, subW) + 24)
      const boxH = 38

      const bgGrad = ctx.createLinearGradient(0, -boxH / 2, 0, boxH / 2)
      bgGrad.addColorStop(0, theme.bgTop)
      bgGrad.addColorStop(1, theme.bgBottom)

      ctx.fillStyle = bgGrad
      ctx.strokeStyle = theme.outerBorder
      ctx.lineWidth = 4.2
      ctx.beginPath()
      ctx.roundRect(-boxW / 2, -boxH / 2, boxW, boxH, 9)
      ctx.stroke()
      ctx.fill()

      ctx.strokeStyle = theme.border
      ctx.lineWidth = 2.0
      ctx.beginPath()
      ctx.roundRect(-boxW / 2 + 1.5, -boxH / 2 + 1.5, boxW - 3, boxH - 3, 7.5)
      ctx.stroke()

      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'

      ctx.font = '900 13px "Fredoka", Inter, system-ui, sans-serif'
      ctx.fillStyle = '#FFFFFF'
      ctx.strokeStyle = theme.outerBorder
      ctx.lineWidth = 2.8
      ctx.strokeText(c.title, 0, -5.5)
      ctx.fillText(c.title, 0, -5.5)

      ctx.font = '800 9.5px Inter, system-ui, sans-serif'
      ctx.fillStyle = theme.subColor
      ctx.fillText(c.subtitle, 0, 9.5)

      ctx.restore()
    }
    ctx.restore()
  }

  private renderDebugColliders(ctx: CanvasRenderingContext2D): void {
    const activeBody = this.activePiece?.body || null
    const bodies = [
      this.baseBody,
      ...this.islands.map((i) => i.body),
      ...this.settledPieces.map((p) => p.body),
      ...(activeBody ? [activeBody] : []),
    ]

    ctx.save()

    for (const b of bodies) {
      const isAct = b === activeBody
      const parts = b.parts.length > 1 ? b.parts.slice(1) : [b]

      for (const part of parts) {
        const verts = part.vertices
        ctx.beginPath()
        ctx.moveTo(verts[0].x - this.offsetX, verts[0].y)
        for (let i = 1; i < verts.length; i++) {
          ctx.lineTo(verts[i].x - this.offsetX, verts[i].y)
        }
        ctx.closePath()

        ctx.fillStyle = isAct
          ? 'rgba(250, 204, 21, 0.25)'
          : 'rgba(0, 255, 136, 0.22)'
        ctx.fill()

        ctx.lineWidth = 1.8
        ctx.strokeStyle = isAct ? '#FACC15' : '#00FF88'
        ctx.stroke()
      }

      if (!b.isStatic) {
        const cx = b.position.x - this.offsetX
        const cy = b.position.y
        ctx.strokeStyle = '#00E5FF'
        ctx.lineWidth = 1.5
        ctx.beginPath()
        ctx.moveTo(cx - 5, cy)
        ctx.lineTo(cx + 5, cy)
        ctx.moveTo(cx, cy - 5)
        ctx.lineTo(cx, cy + 5)
        ctx.stroke()
      }
    }

    const pairsList = (this.engine.pairs as unknown as { list: Matter.Pair[] }).list || []
    for (const pair of pairsList) {
      if (!pair.isActive) continue
      const contacts = pair.activeContacts || []
      for (const contact of contacts) {
        const vx = contact.vertex.x - this.offsetX
        const vy = contact.vertex.y

        ctx.fillStyle = '#FF1744'
        ctx.beginPath()
        ctx.arc(vx, vy, 4, 0, Math.PI * 2)
        ctx.fill()
        ctx.strokeStyle = '#FFFFFF'
        ctx.lineWidth = 1
        ctx.stroke()

        const nx = pair.collision.normal.x
        const ny = pair.collision.normal.y
        ctx.strokeStyle = '#FF1744'
        ctx.lineWidth = 2
        ctx.beginPath()
        ctx.moveTo(vx, vy)
        ctx.lineTo(vx + nx * 12, vy + ny * 12)
        ctx.stroke()
      }
    }

    ctx.restore()
  }
}
