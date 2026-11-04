import { hashSeedString } from './SeededRandomizer'
import { GameMode } from '../types/game'

export type BasePresetId =
  | 'CLASSIC_FLAT'
  | 'SIDE_DOUBLE_STEP'
  | 'LONE_PIN'
  | 'TWIN_TOWERS'
  | 'CRADLE_U'
  | 'CENTER_PYRAMID'
  | 'STAIRCASE'
  | 'SAWTOOTH'
  | 'BROKEN_BRIDGE'
  | 'SEESAW_PIVOT'
  | 'LEFT_DOUBLE_STEP'
  | 'SYMMETRIC_SHOULDERS'
  | 'STEPPED_VALLEY'
  | 'TWIN_PITS'
  | 'COMPACT_SIX'
  | 'MINI_FOUR'
  | 'COMPACT_CRADLE_SIX'
  | 'SPLIT_TWIN_ISLANDS'
  | 'PUZZLE_STEPPED_CLIFF'
  | 'PUZZLE_NOTCHED_TOTEM'
  | 'PUZZLE_THREE_NEEDLES'
  | 'PUZZLE_MICRO_PILLAR_2'
  | 'PUZZLE_TWIN_STILTS'
  | 'PUZZLE_CANTILEVER_HOOK'
  | 'PUZZLE_ZIGZAG_SPIRES'
  | 'PUZZLE_NARROW_T_HEAD'

export interface BaseTerrainPreset {
  id: BasePresetId
  index: number
  name: string
  /**
   * 8-column elevation array [Col 0 .. Col 7]:
   * -  0: normal green base surface (Y = 0)
   * -  1..4: +1..+4 extra green 1x1 blocks stacked on top (Y = -1u .. -4u)
   * - -1: 1x1 hole/pit in the first green row exposing the cottage roof (Y = +1u)
   * - -2: void / absent column (for smaller/narrower platforms — open abyss with no roof or block)
   */
  elevations: readonly [
    number,
    number,
    number,
    number,
    number,
    number,
    number,
    number,
  ]
  description: string
  isPuzzleIsland?: boolean
}

export const STANDARD_BASE_TERRAIN_CATALOG: readonly BaseTerrainPreset[] = [
  {
    id: 'CLASSIC_FLAT',
    index: 1,
    name: '1. Plana Clássica',
    elevations: [0, 0, 0, 0, 0, 0, 0, 0],
    description:
      'Superfície 100% reta. Ideal para iniciantes ou partidas focadas em velocidade pura.',
  },
  {
    id: 'SIDE_DOUBLE_STEP',
    index: 2,
    name: '2. Degrau Duplo Lateral',
    elevations: [0, 0, 0, 0, 0, 1, 1, 0],
    description:
      'Cria um platô de 2 blocos na direita. Perfeito para encaixar peças L, J ou Z logo de cara.',
  },
  {
    id: 'LONE_PIN',
    index: 3,
    name: '3. Pino Solitário',
    elevations: [0, 0, 1, 0, 0, 0, 0, 0],
    description:
      'Um dente único na coluna 2. Atrapalha peças compridas (I ou O), forçando nivelar o lado esquerdo primeiro.',
  },
  {
    id: 'TWIN_TOWERS',
    index: 4,
    name: '4. Ameias / Torres Gêmeas',
    elevations: [0, 0, 1, 0, 0, 0, 0, 1],
    description:
      'Dois pinos separados criando um vale de 4 blocos no meio (cabe exatamente uma peça I deitada ali dentro).',
  },
  {
    id: 'CRADLE_U',
    index: 5,
    name: '5. Berço / U-Shape',
    elevations: [1, 0, 0, 0, 0, 0, 0, 1],
    description:
      'Paredes nas duas pontas extremas. Abraça as peças no começo e impede que escorreguem para o abismo.',
  },
  {
    id: 'CENTER_PYRAMID',
    index: 6,
    name: '6. Pirâmide Central',
    elevations: [0, 0, 1, 2, 2, 1, 0, 0],
    description:
      'Começa mais alta no meio, dando vantagem de altura, mas faz peças mal colocadas rolarem para as bordas.',
  },
  {
    id: 'STAIRCASE',
    index: 7,
    name: '7. Escadaria',
    elevations: [0, 0, 1, 1, 2, 2, 0, 0],
    description:
      'Três níveis de degraus. Obriga o jogador a usar rotações em pé ou peças S / Z / T para travar os desníveis.',
  },
  {
    id: 'SAWTOOTH',
    index: 8,
    name: '8. Dentes de Serra (Crenelada)',
    elevations: [1, 0, 1, 0, 0, 1, 0, 1],
    description:
      'Cheia de vãos de 1x1. Peças quadradas (O) apoiam nas pontas; peças T, L e J travam como engrenagem.',
  },
  {
    id: 'BROKEN_BRIDGE',
    index: 9,
    name: '9. Ponte Quebrada (Com Fosso)',
    elevations: [0, 0, 0, -1, -1, 0, 0, 0],
    description:
      'Remove os 2 blocos verdes centrais, deixando um fosso no meio da ilha para atravessar ou subir em duas colunas.',
  },
  {
    id: 'SEESAW_PIVOT',
    index: 10,
    name: '10. Gangorra / Pino Central',
    elevations: [0, 0, 0, 1, 1, 0, 0, 0],
    description:
      'Apenas os 2 blocos do meio são elevados, criando um ponto de pivô central onde a torre exige equilíbrio fino.',
  },
  {
    id: 'LEFT_DOUBLE_STEP',
    index: 11,
    name: '11. Degrau Duplo Esquerdo',
    elevations: [0, 1, 1, 0, 0, 0, 0, 0],
    description:
      'Platô duplo na esquerda (colunas 1 e 2), ideal para travar peças J, L ou S nos primeiros segundos.',
  },
  {
    id: 'SYMMETRIC_SHOULDERS',
    index: 12,
    name: '12. Platôs Laterais Duplos',
    elevations: [1, 1, 0, 0, 0, 0, 1, 1],
    description:
      'Ombros duplos elevados nas duas bordas com um berço central de 4 blocos para encaixar uma viga I.',
  },
  {
    id: 'STEPPED_VALLEY',
    index: 13,
    name: '13. Vale em Degraus (Anfiteatro)',
    elevations: [2, 1, 0, 0, 0, 0, 1, 2],
    description:
      'Bordas em escada que afunilam para o centro, oferecendo forte contenção lateral para torres altas.',
  },
  {
    id: 'TWIN_PITS',
    index: 14,
    name: '14. Fossos Laterais',
    elevations: [0, -1, 0, 0, 0, 0, -1, 0],
    description:
      'Dois pequenos fossos de 1x1 nas colunas 1 e 6, perfeitos para encaixar o dente central de peças T.',
  },
  {
    id: 'COMPACT_SIX',
    index: 15,
    name: '15. Plataforma Curta (6 Colunas)',
    elevations: [-2, 0, 0, 0, 0, 0, 0, -2],
    description:
      'Plataforma reduzida de 6 blocos de largura (sem as colunas extremas 0 e 7), exigindo construção mais vertical.',
  },
  {
    id: 'MINI_FOUR',
    index: 16,
    name: '16. Mini-Ilha Central (4 Colunas)',
    elevations: [-2, -2, 0, 0, 0, 0, -2, -2],
    description:
      'Plataforma estreita de apenas 4 blocos no centro! Desafio de precisão máxima desde a primeira peça.',
  },
  {
    id: 'COMPACT_CRADLE_SIX',
    index: 17,
    name: '17. Mini-Berço (6 Colunas)',
    elevations: [-2, 1, 0, 0, 0, 0, 1, -2],
    description:
      'Plataforma curta de 6 blocos com abas laterais elevadas para abraçar o início da torre.',
  },
  {
    id: 'SPLIT_TWIN_ISLANDS',
    index: 18,
    name: '18. Ilhas Gêmeas (Abismo Central)',
    elevations: [0, 0, 0, -2, -2, 0, 0, 0],
    description:
      'Duas mini-plataformas de 3 blocos separadas por um abismo real no centro — feche com uma peça I ou suba nos dois pilares!',
  },
]

/**
 * Dedicated ultra-narrow, asymmetric, stepped, and multi-needle islands
 * exclusively for Puzzle Mode ("Abaixo do Laser" - 9m), modeled after Tricky Towers Puzzle levels.
 */
export const PUZZLE_BASE_TERRAIN_CATALOG: readonly BaseTerrainPreset[] = [
  {
    id: 'PUZZLE_STEPPED_CLIFF',
    index: 19,
    name: '19. Penhasco em Degraus (Puzzle 4 Col)',
    elevations: [-2, -2, 0, 1, 3, 3, -2, -2],
    description:
      'Pilar estreito de 4 colunas em escada íngreme! Exige criar contrapesos laterais para a esquerda antes de encostar no laser.',
    isPuzzleIsland: true,
  },
  {
    id: 'PUZZLE_NOTCHED_TOTEM',
    index: 20,
    name: '20. Totem Entalhado (Puzzle 3 Col)',
    elevations: [-2, -2, -2, 2, 3, 1, -2, -2],
    description:
      'Apenas 3 blocos de largura com degraus irregulares no topo. Prenda peças L, J e T nas quinas para abrir asas no ar!',
    isPuzzleIsland: true,
  },
  {
    id: 'PUZZLE_THREE_NEEDLES',
    index: 21,
    name: '21. Três Agulhas (Puzzle 3×1 Col)',
    elevations: [-2, 2, -2, -2, 1, -2, 3, -2],
    description:
      'Três pilares finos de 1 bloco separados por abismos! Conecte as agulhas com vigas ou equilibre mini-torres independentes.',
    isPuzzleIsland: true,
  },
  {
    id: 'PUZZLE_MICRO_PILLAR_2',
    index: 22,
    name: '22. Micro-Pilar Duplo (Puzzle 2 Col)',
    elevations: [-2, -2, -2, 2, 2, -2, -2, -2],
    description:
      'Absurdamente estreito: apenas 2 blocos centrais! Toda a construção precisa se expandir em V usando contrapeso perfeito.',
    isPuzzleIsland: true,
  },
  {
    id: 'PUZZLE_TWIN_STILTS',
    index: 23,
    name: '23. Pernas de Pau (Puzzle 2×1 Col)',
    elevations: [-2, -2, 2, -2, -2, 3, -2, -2],
    description:
      'Duas colunas unitárias em alturas diferentes com um vão de 2 blocos no meio. Crie uma ponte baixa para aproveitar o vão!',
    isPuzzleIsland: true,
  },
  {
    id: 'PUZZLE_CANTILEVER_HOOK',
    index: 24,
    name: '24. Gancho de Contrapeso (Puzzle 3 Col)',
    elevations: [-2, -2, -2, 3, 0, 0, -2, -2],
    description:
      'Um dente alto na esquerda e um degrau baixo de 2 blocos na direita — ideal para travar peças em balanço sobre a água.',
    isPuzzleIsland: true,
  },
  {
    id: 'PUZZLE_ZIGZAG_SPIRES',
    index: 25,
    name: '25. Pilares Partidos (Puzzle 3 Col)',
    elevations: [-2, -2, 2, 0, -2, 2, -2, -2],
    description:
      'Pilar duplo em degrau na esquerda e uma agulha isolada na direita. Exige encaixes cirúrgicos abaixo do laser!',
    isPuzzleIsland: true,
  },
  {
    id: 'PUZZLE_NARROW_T_HEAD',
    index: 26,
    name: '26. Agulha Assimétrica (Puzzle 2 Col)',
    elevations: [-2, -2, -2, 1, 3, -2, -2, -2],
    description:
      'Apenas 2 colunas com 2 blocos de desnível entre elas. Use o Socão para encaixar peças nos flancos do pilar!',
    isPuzzleIsland: true,
  },
]

export const BASE_TERRAIN_CATALOG: readonly BaseTerrainPreset[] = [
  ...STANDARD_BASE_TERRAIN_CATALOG,
  ...PUZZLE_BASE_TERRAIN_CATALOG,
]

export function getBasePresetById(
  id: BasePresetId | null | undefined
): BaseTerrainPreset {
  if (id) {
    const found = BASE_TERRAIN_CATALOG.find((p) => p.id === id)
    if (found) return found
  }
  return BASE_TERRAIN_CATALOG[0]
}

/**
 * Deterministically picks a Base Terrain Preset from `matchSeed`
 * so all players in a seeded / multiplayer match start with the exact same modular base.
 * In `PUZZLE` mode, exclusively selects from `PUZZLE_BASE_TERRAIN_CATALOG` (ultra-narrow islands).
 */
export function selectBasePresetForSeed(
  matchSeed: string,
  gameMode: GameMode = 'RACE'
): BaseTerrainPreset {
  if (gameMode === 'PUZZLE') {
    const hash = hashSeedString(`${matchSeed}_PUZZLE_ISLAND`)
    const idx = hash % PUZZLE_BASE_TERRAIN_CATALOG.length
    return PUZZLE_BASE_TERRAIN_CATALOG[idx]
  }
  const hash = hashSeedString(`${matchSeed}_MODULAR_BASE`)
  const idx = hash % STANDARD_BASE_TERRAIN_CATALOG.length
  return STANDARD_BASE_TERRAIN_CATALOG[idx]
}
