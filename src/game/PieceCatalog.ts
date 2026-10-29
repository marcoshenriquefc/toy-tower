import { PieceType, PieceVariant, GAME_CONSTANTS } from '../types/game'

export interface CellCoord {
  x: number
  y: number
}

export interface PieceDefinition {
  type: PieceType
  name: string
  subtitle: string
  dimensionsLabel: string
  centerOfMassDescription: string
  gameplayRole: string
  /**
   * 4 square cell coordinates in piece-local unit space (before Center of Mass shift).
   * Matter.js automatically shifts the compound body origin to the physical Center of Mass.
   */
  cells: CellCoord[]
}

export const PIECE_CATALOG: Record<PieceType, PieceDefinition> = {
  I: {
    type: 'I',
    name: 'Peça "I"',
    subtitle: 'A Viga Longa — Azul',
    dimensionsLabel: '4x1',
    centerOfMassDescription: 'Exatamente no meio (entre o 2º e o 3º bloco).',
    gameplayRole:
      'Na horizontal serve como Ponte Estabilizadora travando duas colunas. Na vertical sobe 4 unidades de uma vez, mas tem base 1x1 super instável.',
    cells: [
      { x: -1.5, y: 0 },
      { x: -0.5, y: 0 },
      { x: 0.5, y: 0 },
      { x: 1.5, y: 0 },
    ],
  },
  O: {
    type: 'O',
    name: 'Peça "O"',
    subtitle: 'O Bloco 2x2 — Amarelo',
    dimensionsLabel: '2x2',
    centerOfMassDescription: 'Centralizado geometricamente no cruzamento dos 4 blocos.',
    gameplayRole:
      'Âncora de Peso. Centro de gravidade baixo e concentrado; ideal para prender peças na ponta de uma gangorra.',
    cells: [
      { x: -0.5, y: -0.5 },
      { x: 0.5, y: -0.5 },
      { x: -0.5, y: 0.5 },
      { x: 0.5, y: 0.5 },
    ],
  },
  T: {
    type: 'T',
    name: 'Peça "T"',
    subtitle: 'O Conector em T — Roxo',
    dimensionsLabel: '3x2',
    centerOfMassDescription:
      'Localizado dentro do bloco central da barra de 3, levemente deslocado em direção ao "dente" do T.',
    gameplayRole:
      'Correção de Desnível. O dente entra em buracos de 1 bloco enquanto as abas apoiam nas laterais, ou funciona como gangorra.',
    cells: [
      { x: -1, y: 0 },
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 0, y: 1 }, // Dente do T
    ],
  },
  L: {
    type: 'L',
    name: 'Peça "L"',
    subtitle: 'A Cantoneira Direita — Laranja',
    dimensionsLabel: '3x2',
    centerOfMassDescription:
      'Fora do eixo central — puxado para o canto onde os dois segmentos se encontram (cotovelo direito).',
    gameplayRole:
      'Gancho de Borda. Permite pendurar o dente para fora da borda da torre para alargar a área de construção.',
    cells: [
      { x: -1, y: 0 },
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 1, y: 1 }, // Ponta inferior direita
    ],
  },
  J: {
    type: 'J',
    name: 'Peça "J"',
    subtitle: 'A Cantoneira Esquerda — Azul Escuro',
    dimensionsLabel: '3x2',
    centerOfMassDescription: 'Deslocado para o cotovelo esquerdo.',
    gameplayRole:
      'Espelho exato da peça L. Gancho e contrapeso para o lado esquerdo; combinado com L forma um bloco sólido.',
    cells: [
      { x: -1, y: 0 },
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: -1, y: 1 }, // Ponta inferior esquerda
    ],
  },
  S: {
    type: 'S',
    name: 'Peça "S"',
    subtitle: 'O Degrau Direito — Verde Claro',
    dimensionsLabel: '3x2',
    centerOfMassDescription: 'No ponto de contato central entre os dois pares de blocos.',
    gameplayRole:
      'O Vilão da Estabilidade. A ponta suspensa gera torque imediato se receber peso sem apoio em degrau.',
    cells: [
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: -1, y: 1 },
      { x: 0, y: 1 },
    ],
  },
  Z: {
    type: 'Z',
    name: 'Peça "Z"',
    subtitle: 'O Degrau Esquerdo — Vermelho Vivo',
    dimensionsLabel: '3x2',
    centerOfMassDescription: 'No eixo diagonal central.',
    gameplayRole:
      'Espelho exato da peça S. Trava escadas/degraus na lateral da torre ou cria balanços arriscados.',
    cells: [
      { x: -1, y: 0 },
      { x: 0, y: 0 },
      { x: 0, y: 1 },
      { x: 1, y: 1 },
    ],
  },
}

export const ALL_PIECE_TYPES: PieceType[] = ['I', 'O', 'T', 'L', 'J', 'S', 'Z']

export interface PhysicalVariantSpec {
  scale: number
  cellMass: number
  totalMass: number
  friction: number
  snappedFriction: number
  restitution: number
  badgeLabel: string
}

export function getVariantPhysicsSpec(variant: PieceVariant): PhysicalVariantSpec {
  switch (variant) {
    case 'GIANT':
      return {
        scale: 2,
        cellMass: GAME_CONSTANTS.CELL_MASS_GIANT,
        totalMass: GAME_CONSTANTS.CELL_MASS_GIANT * 4, // 16.0
        friction: GAME_CONSTANTS.DEFAULT_FRICTION,
        snappedFriction: GAME_CONSTANTS.SNAPPED_FRICTION,
        restitution: GAME_CONSTANTS.DEFAULT_RESTITUTION,
        badgeLabel: 'MEGA-BLOCO 2x (Massa 16)',
      }
    case 'HEAVY_RUBBER':
      return {
        scale: 1,
        cellMass: GAME_CONSTANTS.CELL_MASS_HEAVY_RUBBER,
        totalMass: GAME_CONSTANTS.CELL_MASS_HEAVY_RUBBER * 4, // 10.0
        friction: GAME_CONSTANTS.HEAVY_RUBBER_FRICTION, // 2.0
        snappedFriction: GAME_CONSTANTS.HEAVY_RUBBER_FRICTION * 1.25, // 2.5
        restitution: 0.02,
        badgeLabel: 'BORRACHA PESADA (Massa 10 | μ=2.0)',
      }
    case 'NORMAL':
    default:
      return {
        scale: 1,
        cellMass: GAME_CONSTANTS.CELL_MASS_NORMAL,
        totalMass: GAME_CONSTANTS.CELL_MASS_NORMAL * 4, // 4.0
        friction: GAME_CONSTANTS.DEFAULT_FRICTION, // 0.6
        snappedFriction: GAME_CONSTANTS.SNAPPED_FRICTION, // 1.2
        restitution: GAME_CONSTANTS.DEFAULT_RESTITUTION, // 0.05
        badgeLabel: 'Plástico ABS (Massa 4 | μ=0.6)',
      }
  }
}
