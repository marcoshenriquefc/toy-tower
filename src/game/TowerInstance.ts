import Matter from 'matter-js'
import {
  ActivePieceSnapshot,
  GAME_CONSTANTS,
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
}

export interface RemoteLaneRenderData {
  laneOffsetX: number
  handle: string
  customNick: string
  skinSpriteId: string
  rankBadge: '1ST' | '2ND' | '3RD' | '4TH'
  towerHeight: number
  lives: number
  isEliminated: boolean
  activePiece: ActivePieceSnapshot | null
  settledBlocks: SettledBlockSnapshot[]
  mascotCastAnimMs: number
  mascotCastCategory: 'POSITIVE' | 'NEGATIVE' | null
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
  onSnapshot?: (snapshot: TowerSnapshot) => void
  onEventBanner?: (message: string, tone: 'info' | 'warning' | 'success' | 'danger') => void
  onPowerCast?: (category: 'POSITIVE' | 'NEGATIVE', powerId: PowerId) => void
  onPieceSettled?: (towerHeight: number, settledCount: number) => void
  onLifeLost?: () => void
  onVictory?: (elapsedTimeMs: number, towerHeight: number) => void
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
  reason: 'LATERAL' | 'WATER'
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
  public blindManualRemainingMs: number = 0
  private fogAnchorX: number = 0
  private fogAnchorY: number = -38

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
  /** Frozen & hidden falling piece stored during GOAL_COUNTDOWN (restored if tower slips before 0.0s, discarded on ROOF_DROP) */
  public heldActivePiece: TowerPieceEntity | null = null
  public settledPieces: TowerPieceEntity[] = []
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
  private mascotHoverXUnits: number = 6.2
  private mascotHoverYUnits: number = 3.5
  private victoryAnimTimeMs: number = 0
  public showDebugColliders: boolean = false
  public showGhostPiece: boolean = false

  /** Real-time Multiplayer rank badge, player nick, mascot cast animation, and remote lane render buffers */
  public rankBadge: '1ST' | '2ND' | '3RD' | '4TH' | null = null
  public playerNick: string = ''
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
    this.onSnapshot = config.onSnapshot
    this.onEventBanner = config.onEventBanner
    this.onPowerCast = config.onPowerCast
    this.onPieceSettled = config.onPieceSettled
    this.onLifeLost = config.onLifeLost
    this.onVictory = config.onVictory

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
   * - Selects the terrain profile from `this.forcedBasePresetId` (if set in Dev Mode) or deterministically from `this.matchSeed`.
   * - Creates a compound static `this.baseBody` combining:
   *   1. The solid Cottage Roof foundation floor (`Y = +1.0u` to `+2.0u`) under active columns (`elev >= -1`)
   *      so `-1` holes act as 1-block-deep pits while `-2` void columns remain open abysses for smaller platforms.
   *   2. Merged horizontal static rectangles for Layer `0` (`Y = 0..+1u`), Layer `1` (`Y = -1u..0`), and Layer `2` (`Y = -2u..-1u`)
   *      according to `this.currentBasePreset.elevations`.
   */
  private initWorld(): void {
    const u = GAME_CONSTANTS.UNIT_PX
    const cols = 8
    const halfCols = cols / 2 // 4.0 units (-4u to +4u)

    this.currentBasePreset = this.forcedBasePresetId
      ? getBasePresetById(this.forcedBasePresetId)
      : selectBasePresetForSeed(this.matchSeed)

    const elevations = this.currentBasePreset.elevations
    const partBodies: Matter.Body[] = []

    // 1. Solid Cottage Roof floor under Layer 0 (from Y = +1.0u to +2.0u, centerY = +1.5u)
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
          Bodies.rectangle(centerX, 1.5 * u, spanCols * u, u, {
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

    // 2. Modular 1x1 Static Green Block Layers (r = 0: surface Y=0, r = 1: Y=-1u, r = 2: Y=-2u)
    for (let r = 0; r <= 2; r++) {
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
          const centerY = (0.5 - r) * u

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

      // Wake sleeping tower blocks if bumped by active piece
      if (!otherPart.parent.isStatic && otherPart.parent.isSleeping) {
        Matter.Sleeping.set(otherPart.parent, false)
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

      const isBottomSupport =
        isAboveTopSurface &&
        ((dy >= 11 && overlapX > 2.2 && overlapX >= overlapY * 0.55) ||
          (dy >= 7 && overlapX > 2.2 && normalY > 0.65))

      if (isBottomSupport) {
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
    this.towerHeight = 0
    this.windForce = 0
    this.windActive = false
    this.checkpointsReached = []
    this.checkpointHoldTarget = null
    this.checkpointHoldTimerMs = 0
    this.inventoryPower = {
      selfPower: null,
      attackPower: null,
      sourceCheckpoint: null,
    }
    this.pendingNextPiecePower = 'NONE'
    this.slickBrickRemaining = 0
    this.lockRotateRemaining = 0
    this.turboDropRemaining = 0
    this.blindManualRemainingMs = 0
    this.fogAnchorX = 0
    this.fogAnchorY = -38
    this.glueWeldLinks = []
    this.glueVines = []
    this.checkpointConsumeEffects = []
    this.brickRemoverEffects = []
    this.confettiParticles = []

    this.activePiece = null
    this.heldActivePiece = null
    this.settledPieces = []
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
    this.cameraCenterHeightUnits = 0
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
      this.state === 'VICTORY'
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
      this.state === 'VICTORY'
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

      case 'GIANT_PIECE': {
        const stableGiantTypes: PieceType[] = ['I', 'O', 'T', 'L', 'J']
        const type =
          stableGiantTypes[
            Math.floor(this.randomizer.nextFloat() * stableGiantTypes.length)
          ]
        this.randomizer.enqueueCustomPiece({
          type,
          variant: 'GIANT',
          label: `🦣 Poder Negativo: Mega-Bloco 2x "${type}" (Massa 16)!`,
        })
        this.onEventBanner?.(
          `${cfg.icon} Efeito Negativo (Dev): Próxima peça será um Mega-Bloco 2x (Massa 16.0)!`,
          'warning'
        )
        break
      }

      case 'SLICK_BRICK': {
        const count = cfg.durationPieces || 2
        if (
          this.activePiece &&
          this.state === 'FALLING' &&
          this.activePiece.powerEffect === 'NONE'
        ) {
          this.activePiece.powerEffect = 'SLICK_BRICK'
          this.applyPieceFriction(
            this.activePiece,
            GAME_CONSTANTS.SLICK_BRICK_FRICTION,
            false
          )
          this.slickBrickRemaining += count - 1
        } else {
          this.slickBrickRemaining += count
        }
        this.onEventBanner?.(
          `${cfg.icon} Efeito de Gelo: Próximas ${count} peças em gelo azul-ciano escorregadio (μ=0.02)!`,
          'warning'
        )
        break
      }

      case 'LOCK_ROTATE': {
        const count = cfg.durationPieces || 2
        if (
          this.activePiece &&
          this.state === 'FALLING' &&
          this.activePiece.powerEffect === 'NONE'
        ) {
          this.activePiece.powerEffect = 'LOCK_ROTATE'
          this.lockRotateRemaining += count - 1
        } else {
          this.lockRotateRemaining += count
        }
        this.onEventBanner?.(
          `${cfg.icon} Giro Travado: Próximas ${count} peças com rotação travada!`,
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
        if (
          this.activePiece &&
          this.state === 'FALLING' &&
          this.activePiece.powerEffect === 'NONE'
        ) {
          this.activePiece.powerEffect = 'TURBO_DROP'
          this.turboDropRemaining += count - 1
        } else {
          this.turboDropRemaining += count
        }
        this.onEventBanner?.(
          `${cfg.icon} Queda Turbo: Próximas ${count} peças em queda acelerada!`,
          'danger'
        )
        break
      }
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

    const colliderW = cellPx - 3.2
    const colliderH = cellPx - 0.8
    const effFriction =
      powerEffect === 'SLICK_BRICK'
        ? GAME_CONSTANTS.SLICK_BRICK_FRICTION
        : phys.friction * slideParams.frictionScale

    const partBodies: Matter.Body[] = def.cells.map((cell) => {
      return Bodies.rectangle(
        cell.x * cellPx,
        cell.y * cellPx,
        colliderW,
        colliderH,
        {
          chamfer: { radius: 3.5 },
          friction: effFriction,
          frictionStatic:
            powerEffect === 'SLICK_BRICK'
              ? GAME_CONSTANTS.SLICK_BRICK_FRICTION
              : effFriction * slideParams.staticMultUnsnapped,
          restitution: 0.0,
          slop: 0.01,
        }
      )
    })

    const compound = Body.create({
      parts: [...partBodies],
      friction: effFriction,
      frictionStatic:
        powerEffect === 'SLICK_BRICK'
          ? GAME_CONSTANTS.SLICK_BRICK_FRICTION
          : effFriction * slideParams.staticMultUnsnapped,
      frictionAir: 0.018 + 0.008 * slideParams.grip,
      restitution: 0.0,
      slop: 0.01,
      sleepThreshold: 24,
      label: `piece_${spec.type}_${this.nextEntityId}`,
    })

    Body.setMass(compound, phys.totalMass)
    const baseInertia = compound.inertia
    const realInertia = baseInertia * slideParams.inertiaMult

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
    const basePeakUnits = Math.max(0, ...this.currentBasePreset.elevations)
    const spawnHeightUnits =
      Math.max(basePeakUnits, this.towerHeight) + GAME_CONSTANTS.SPAWN_OFFSET_UNITS

    const spec = this.randomizer.nextPiece()
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
      this.updateSettledBlocksAndHeight()
      this.onPieceSettled?.(this.towerHeight, this.settledPieces.length)
      this.state = 'SETTLING'
      this.settlingTimerMs = 150
      return
    }

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
    this.updateSettledBlocksAndHeight()
    this.onPieceSettled?.(this.towerHeight, this.settledPieces.length)
    this.state = 'SETTLING'
    this.settlingTimerMs = 170
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
          if (overlapX <= 2.2) continue

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
        // Visual outer edges of partA (accounting for 1.6px horizontal collider inset)
        const aLeft = partA.bounds.min.x - 1.6
        const aRight = partA.bounds.max.x + 1.6
        const aTop = partA.bounds.min.y + 3.0
        const aBottom = partA.bounds.max.y - 3.0

        for (const partB of otherParts) {
          const bLeft = partB.bounds.min.x - 1.6
          const bRight = partB.bounds.max.x + 1.6
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
   * Instant 90-degree rotation (clockwise = +1, counter-clockwise = -1)
   * with exact grid preservation and physical Wall Kick (±1.0 or ±0.5 unit).
   */
  public rotateActivePiece(direction: 1 | -1): void {
    if (
      !this.activePiece ||
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

    // Prioritize small Wall Kicks and slot-fitting micro-clearance so rotating near slots works smoothly
    const kickOffsetsUnits = [0, 0.5, -0.5, 1.0, -1.0, 1.5, -1.5, 2.0, -2.0]
    for (const kickU of kickOffsetsUnits) {
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
        if (
          piece.powerEffect === 'STATIC_BRICK' &&
          this.isStaticBrickTouchingTower(body)
        ) {
          this.landActivePiece()
        }
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
   * Accounts for the 1.6px horizontal collider inset per cell (`gapX <= 3.8px` when visually flush).
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

          // 1. Lateral touch (side-by-side): collider inset is 1.6px on each block (3.2px total when visually flush)
          if (gapX <= 3.8 && overlapY >= 2.0) {
            return true
          }

          // 2. Vertical touch (top or bottom): collider inset is 0.4px on each block (0.8px total when visually flush)
          if (gapY <= 1.6 && overlapX >= 2.0) {
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

    // 2. State Machine transitions (Note: GOAL_COUNTDOWN and ROOF_DROP pause normal piece spawning!)
    if (this.state === 'SPAWNING') {
      this.spawnNextPiece()
    } else if (this.state === 'SETTLING') {
      this.settlingTimerMs -= dtMs
      if (this.settlingTimerMs <= 0) {
        this.state = 'SPAWNING'
      }
    } else if (this.state === 'RESPAWN_DELAY') {
      this.respawnDelayRemainingMs = Math.max(
        0,
        this.respawnDelayRemainingMs - dtMs
      )
      if (this.respawnDelayRemainingMs <= 0) {
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

    // 3. Control active falling piece velocity (in FALLING or ROOF_DROP, with Soft Drop & Turbo Drop support)
    if (
      this.activePiece &&
      (this.state === 'FALLING' || this.state === 'ROOF_DROP')
    ) {
      const body = this.activePiece.body
      const isRestingOnBottom =
        this.state === 'FALLING' &&
        (this.hasBottomSupportThisTick || this.isPieceSupportedBelow(body))

      if (isRestingOnBottom) {
        // Hold piece gently on top of the lower piece during the 0.5s (500ms) grace window
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

    // 4. Environmental Wind Gusts (active once tower reaches 15 units, continues during GOAL_COUNTDOWN!)
    this.updateWind(clampedDt)

    // 5. Step Matter.js 2D Physics Engine
    Engine.update(this.engine, clampedDt)

    // 5a. Prevent Matter.js warm-started positionImpulse explosions & clamp anomalous velocity spikes
    this.stabilizePhysicsStep()

    // 5a-bis. Bloco de Ferro (`STATIC_BRICK`): if it touches any block even laterally while falling, freeze immediately!
    if (
      !this.pendingLandPiece &&
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
    if (this.pendingLandPiece) {
      this.landActivePiece()
    }

    // 6. Check Abyss Falls, Pin Snaps, Tower Height, Checkpoints (with 0.5s hold), and Climax State Machine
    this.checkAbyssAndPrune()
    this.updateSettledBlocksAndHeight()
    this.updateCheckpoints(dtMs)
    this.updateGoalCountdown(dtMs)
    this.updateCamera(dtMs)
    this.updateNudgeEffects(dtMs)

    // 7. Export Network State Snapshot every 100ms
    this.tickSnapshots(dtMs)
  }

  /**
   * Prevents compound-body position-impulse resonance (where blocks wedged in a slot
   * accumulate warm-started `positionImpulse` across frames and suddenly pop/explode)
   * and enforces velocity-neutral Super Glue welds (`solveGlueWelds`).
   */
  private stabilizePhysicsStep(): void {
    if (this.activePiece) {
      this.clearBodyPositionImpulses(this.activePiece.body)
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

    if (this.towerHeight >= GAME_CONSTANTS.WIND_START_HEIGHT_UNITS) {
      if (!this.windActive) {
        this.windActive = true
        this.onEventBanner?.(
          'Brisa suave de altitude (15m+) ativa no topo da torre!',
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

    const u = GAME_CONSTANTS.UNIT_PX
    for (const piece of this.settledPieces) {
      if (piece.body.isSleeping || piece.body.isStatic) continue

      const pieceHeightUnits = Math.max(0, -piece.body.position.y / u)
      if (pieceHeightUnits < 14) continue

      const heightFactor = Math.min(1.0, (pieceHeightUnits - 14) / 16)
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
   * (`KILL_ZONE_X = ±7.5` unidades) ou caírem na água lá embaixo (`KILL_LIMIT_Y` / Abismo).
   */
  private checkAbyssAndPrune(): void {
    const u = GAME_CONSTANTS.UNIT_PX
    const abyssPhysY = 4.5 * u
    const waterSurfaceY = 2.8 * u

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
      this.spawnWaterSplashParticles(activeLocalX, waterSurfaceY)

      World.remove(this.engine.world, this.activePiece.body)
      this.activePiece = null
      this.isSoftDropping = false
      this.state = 'RESPAWN_DELAY'
      this.respawnDelayRemainingMs = GAME_CONSTANTS.RESPAWN_PENALTY_MS
      this.onLifeLost?.()
      this.onEventBanner?.(
        'Peça Ativa caiu no Abismo! Penalidade de +1.0s no Spawn!',
        'danger'
      )
    }

    for (let i = this.settledPieces.length - 1; i >= 0; i--) {
      const piece = this.settledPieces[i]
      const body = piece.body

      // Ignora a base estática, ilhas flutuantes e blocos-âncora estáticos
      if (body.isStatic) continue

      const localX = body.position.x - this.offsetX
      const outLeft = localX < -this.KILL_LIMIT_X
      const outRight = localX > this.KILL_LIMIT_X
      const outBottom = body.position.y > abyssPhysY

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

        // C. Efeito de partículas: estrelinhas/poeira na borda lateral ou splash na água
        if (outLeft || outRight) {
          this.spawnVaporizeParticles(
            localX,
            body.position.y,
            outLeft ? -1 : 1
          )
        } else if (outBottom) {
          this.spawnWaterSplashParticles(localX, waterSurfaceY)
        }
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

          if (
            angleErrorDeg <= slideParams.maxDampAngleDeg &&
            Math.abs(body.velocity.x) < 2.2
          ) {
            const dampX = piece.snapped
              ? slideParams.dampXSnapped
              : slideParams.dampXUnsnapped
            const dampAng = piece.snapped
              ? slideParams.dampAngSnapped
              : slideParams.dampAngUnsnapped
            Body.setVelocity(body, {
              x: body.velocity.x * dampX,
              y: body.velocity.y,
            })
            Body.setAngularVelocity(body, body.angularVelocity * dampAng)
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
  }

  /**
   * Checkpoint Trigger Rule (`8m, 16m, 24m`):
   * - A settled piece must stabilize crossing the line for at least 0.5 second (`500ms`).
   * - Once triggered, the line glows, dissolves, and grants a rolled Power into the Single-Slot Inventory
   *   (overwriting any unspent power). Each checkpoint line only rewards once per match.
   */
  private updateCheckpoints(dtMs: number): void {
    const checkpoints = [8, 16, 24]
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
      const excludePositive = this.hasSpawnedSideIsland
        ? (['SIDE_ISLAND'] as PowerId[])
        : []
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
   * - State A (`GOAL_COUNTDOWN`): Triggered when `towerHeight >= 30m`. Freezes and hides `activePiece` in
   *   `heldActivePiece` with a magic smoke poof, zooms camera in, and runs a 3.0s stability test.
   * - State B (`COUNTDOWN_ABORTED`): If the tower slips below 30m before 0.0s, plays "Bzzzt!", cancels timer,
   *   and restores `heldActivePiece` at the top so the player resumes without losing their piece.
   * - State C (`ROOF_DROP`): When the 3.0s timer reaches 0.0s, discards `heldActivePiece` and spawns the
   *   3x3 Castle Roof (`CASTLE_ROOF`), which auto-welds on contact, locks the tower static, and triggers `VICTORY`.
   */
  private updateGoalCountdown(dtMs: number): void {
    if (this.state === 'ROOF_DROP' || this.state === 'VICTORY') {
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

    // Normal gameplay states: if the tower reaches 30m, enter State A (`GOAL_COUNTDOWN`)!
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

    // If called directly from Developer Mode while an activePiece was falling, remove it
    if (this.activePiece) {
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
    const isClimax =
      this.state === 'GOAL_COUNTDOWN' || this.state === 'ROOF_DROP'
    const baseVerticalPan =
      this.towerHeight <= 6
        ? this.towerHeight * 0.58
        : 3.48 + (this.towerHeight - 6) * 0.94
    const targetPanUnits = isClimax
      ? Math.max(baseVerticalPan, this.towerHeight - 8.5)
      : baseVerticalPan
    const lerpFactor = Math.min(1, dtMs * 0.005)
    this.cameraCenterHeightUnits +=
      (targetPanUnits - this.cameraCenterHeightUnits) * lerpFactor

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

    const targetZoom =
      this.state === 'GOAL_COUNTDOWN'
        ? 1.14
        : this.state === 'ROOF_DROP'
          ? 1.1
          : 1.0
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
      }
    })

    return {
      playerId: this.id,
      matchSeed: this.matchSeed,
      isSinglePlayer: this.isSinglePlayer,
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
                this.checkpointHoldTimerMs / GAME_CONSTANTS.CHECKPOINT_HOLD_MS
              ),
            }
          : null,
      inventoryPower: { ...this.inventoryPower },
      blindManualRemainingMs: Math.ceil(this.blindManualRemainingMs),
      nextQueue: this.randomizer.peekQueue(3),
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

  public render(
    ctx: CanvasRenderingContext2D,
    canvasWidth: number,
    canvasHeight: number
  ): void {
    const u = GAME_CONSTANTS.UNIT_PX

    let shakeOffsetX = 0
    let shakeOffsetY = 0
    if (this.shakeTimerMs > 0) {
      const decay = this.shakeTimerMs / this.shakeDurationMs
      const phase = (1 - decay) * Math.PI * 5
      shakeOffsetX = this.shakeDir * Math.cos(phase) * 3.5 * decay
      shakeOffsetY = Math.sin(phase * 1.4) * 1.8 * decay
    }

    const cameraOriginScreenX = canvasWidth / 2 + this.offsetX + shakeOffsetX
    const cameraOriginScreenY =
      canvasHeight - 112 + this.cameraCenterHeightUnits * u + shakeOffsetY

    const animTimeMs = this.elapsedTimeMs + this.victoryAnimTimeMs

    // 1. Full-screen Tricky Towers Parallax Background Scenery
    spriteRegistry.drawTrickyTowersSceneryBackground(
      ctx,
      canvasWidth,
      canvasHeight,
      cameraOriginScreenX,
      cameraOriginScreenY,
      animTimeMs,
      this.windForce,
      this.cameraParallaxX
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

    // Multi-lane scale adjustment when 2-4 online players are in the match so all lanes fit comfortably
    const multiLaneScale =
      this.remoteLanesToRender.length >= 3
        ? 0.66
        : this.remoteLanesToRender.length === 2
          ? 0.76
          : this.remoteLanesToRender.length === 1
            ? 0.86
            : 1.0
    const effectiveZoom = this.cameraZoom * multiLaneScale

    // Smooth camera zoom focused on the top of the tower during GOAL_COUNTDOWN and ROOF_DROP
    if (Math.abs(effectiveZoom - 1.0) > 0.002) {
      const focusY = -Math.max(0, this.towerHeight * 0.5) * u
      ctx.translate(0, focusY)
      ctx.scale(effectiveZoom, effectiveZoom)
      ctx.translate(0, -focusY)
    }

    // 2. Finish Line (30m) & Checkpoint lines in the sky
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

    // 4. Modular 8-Column Green Base Plate + Cottage Pedestal (`assets/sprites/other/base.png`)
    spriteRegistry.drawBasePlate(
      ctx,
      0,
      u / 2,
      this.currentBasePreset.elevations
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

    // 6b. Brick Separator (Removedor de Peças) orange extractor animation
    if (this.brickRemoverEffects.length > 0) {
      this.renderBrickRemoverEffects(ctx)
    }

    // 6c. Sparks & Smoke Particles + Toy-Brick Confetti
    if (this.impactParticles.length > 0) {
      this.renderImpactParticles(ctx)
    }
    if (this.confettiParticles.length > 0) {
      this.renderConfettiParticles(ctx)
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

    // 9. Foreground Ocean Water (Abyss at bottom of world)
    spriteRegistry.drawTrickyTowersOceanForeground(
      ctx,
      canvasWidth,
      canvasHeight,
      cameraOriginScreenY,
      animTimeMs
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
   * Renders Negative Power 4 (`BLIND_MANUAL` — "Nuvem Fog 20s"):
   * A lateral bank of overlapping borderless clouds (`sem bordas`) with ~1.5x height,
   * spanning the full width of the tower laterally (`ocupando toda a torre lateralmente`),
   * using different transparencies (`transparências diferentes entre si`) to create depth,
   * while remaining vertically fixed at the height of the last block where it spawned (`this.fogAnchorY`).
   */
  private renderBlindManualOverlay(ctx: CanvasRenderingContext2D): void {
    const t = this.elapsedTimeMs * 0.0022
    const fadeEnvelope = Math.min(1.0, this.blindManualRemainingMs / 800)

    // Center horizontally across the tower width (`x = 0` with slight anchor bias), fixed vertically at `this.fogAnchorY`
    const centerX = this.fogAnchorX * 0.25
    const anchorY = this.fogAnchorY

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
    const r = Math.min(18, h * 0.24)

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

    spriteRegistry.drawFloatingMascot(ctx, cx, cy, t, {
      scaleXFlip,
      extraTiltRad,
      selfPower: this.inventoryPower.selfPower,
      attackPower: this.inventoryPower.attackPower,
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

    if (this.rankBadge) {
      this.drawRankBadgeBelowMascot(
        ctx,
        cx,
        cy + 58,
        this.rankBadge,
        this.playerNick || 'VOCÊ',
        this.towerHeight,
        true
      )
    }
  }

  /**
   * Draws the real-time Rank Badge (`1ST`, `2ND`, `3RD`, `4TH`) and Player Nickname
   * directly below each floating mascot's cloud in Multiplayer matches.
   */
  private drawRankBadgeBelowMascot(
    ctx: CanvasRenderingContext2D,
    cx: number,
    topY: number,
    rank: '1ST' | '2ND' | '3RD' | '4TH',
    nick: string,
    heightUnits: number,
    isLocal: boolean
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

    // Nickname & Height tag below rank pill
    const label = `${nick.slice(0, 12)} • ${heightUnits.toFixed(1)}m`
    ctx.font = '800 10px Inter, system-ui, sans-serif'
    const textW = Math.max(68, ctx.measureText(label).width + 14)
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
   * Renders all remote online friends' lanes (Base Plate, Interpolated Settled Blocks,
   * Interpolated Active Piece, Floating Mascot, and Live Rank Badge `1ST`/`2ND`/`3RD`/`4TH`).
   */
  private renderRemoteMultiplayerLanes(
    ctx: CanvasRenderingContext2D,
    animTimeMs: number
  ): void {
    const u = GAME_CONSTANTS.UNIT_PX

    for (const lane of this.remoteLanesToRender) {
      const relOffsetX = lane.laneOffsetX - this.offsetX
      ctx.save()
      ctx.translate(relOffsetX, 0)

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
        { scaleXFlip: -1, targetHeight: 96 }
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

      this.drawRankBadgeBelowMascot(
        ctx,
        mascotX,
        mascotY + 54,
        lane.rankBadge,
        lane.customNick,
        lane.towerHeight,
        false
      )

      // 2. Remote Friend's Modular 8-Column Green Base Plate
      spriteRegistry.drawBasePlate(
        ctx,
        0,
        u / 2,
        this.currentBasePreset.elevations
      )

      // 3. Remote Friend's Interpolated Settled Blocks
      for (const blk of lane.settledBlocks) {
        this.renderSnapshotPieceOnLane(ctx, blk, false)
      }

      // 4. Remote Friend's Interpolated Active Falling Piece
      if (lane.activePiece && !lane.isEliminated) {
        this.renderSnapshotPieceOnLane(ctx, lane.activePiece, true)
      }

      ctx.restore()
    }
  }

  private renderSnapshotPieceOnLane(
    ctx: CanvasRenderingContext2D,
    snap: ActivePieceSnapshot | SettledBlockSnapshot,
    isActive: boolean
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

    ctx.save()
    ctx.translate(snap.x * u, -snap.y * u)
    ctx.rotate((snap.angle * Math.PI) / 180)
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
      }
    )
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

    const markerHeights = [5, 8, 10, 15, 16, 20, 24, 25, 30, 35]
    for (const h of markerHeights) {
      const y = -h * u
      const isGoal = h === GAME_CONSTANTS.GOAL_HEIGHT_UNITS
      const isCheckpoint = h === 8 || h === 16 || h === 24
      const isWindLine = h === GAME_CONSTANTS.WIND_START_HEIGHT_UNITS

      if (isGoal) {
        const lineHalfW = Math.max(baseHalfW * 2.5, canvasWidth * 0.25)
        ctx.save()
        ctx.strokeStyle = '#FACC15'
        ctx.lineWidth = 3.5
        ctx.setLineDash([14, 10])
        ctx.beginPath()
        ctx.moveTo(-lineHalfW, y)
        ctx.lineTo(lineHalfW, y)
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

    let pulse = 0
    if (isActive && this.pistonTimerMs > 0) {
      const progress = 1 - this.pistonTimerMs / this.pistonDurationMs
      pulse = Math.sin(progress * Math.PI)
      const pistonOffsetPx = this.pistonDir * 6.0 * pulse
      localX += pistonOffsetPx
    }

    if (isActive && this.boundaryShakeTimerMs > 0) {
      const ratio = this.boundaryShakeTimerMs / 135
      const jiggle =
        Math.sin((1 - ratio) * Math.PI * 3.5) * 3.6 * ratio * this.boundaryShakeDir
      localX += jiggle
    }

    const isFastFalling =
      isActive &&
      (this.isSoftDropping || piece.powerEffect === 'TURBO_DROP') &&
      this.bottomTouchTimerMs === 0 &&
      !this.hasBottomSupportThisTick

    // Mini rastro shadow ("mini rastro shadow") behind the accelerating piece
    if (isActive && (isFastFalling || this.softDropTrail.length > 0)) {
      this.renderFastDropShadowTrail(ctx, piece, localX, localY, isFastFalling)
    }

    ctx.save()
    ctx.translate(localX, localY)
    if (pulse > 0) {
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
      const alpha = Math.max(0, 1.0 - item.progress)
      // Encolhe de 100% (1.0) para 30% (0.3) enquanto desaparece
      const scale = 1.0 - item.progress * 0.7
      const piece = item.piece

      ctx.save()
      ctx.translate(item.startX, item.startY)
      ctx.rotate(item.angle)
      ctx.scale(scale, scale)
      ctx.globalAlpha = alpha
      ctx.shadowColor = '#FFFFFF'
      ctx.shadowBlur = 14 * (1 - item.progress * 0.4)

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
        }
      )

      // Brilho branco/transparente de vaporização sobre os blocos da peça
      const cellPx = u * piece.scale
      ctx.fillStyle =
        item.reason === 'WATER'
          ? 'rgba(224, 242, 254, 0.55)'
          : 'rgba(255, 255, 255, 0.65)'
      ctx.globalAlpha = alpha * (0.45 + 0.45 * item.progress)
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
