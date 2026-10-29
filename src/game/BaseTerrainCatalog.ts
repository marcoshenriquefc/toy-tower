import { hashSeedString } from './SeededRandomizer'

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

export interface BaseTerrainPreset {
  id: BasePresetId
  index: number
  name: string
  /**
   * 8-column elevation array [Col 0 .. Col 7]:
   * -  0: normal green base surface (Y = 0)
   * -  1: +1 extra green 1x1 block stacked on top (Y = -1u)
   * -  2: +2 extra green 1x1 blocks stacked on top (Y = -2u)
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
}

export const BASE_TERRAIN_CATALOG: readonly BaseTerrainPreset[] = [
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
 */
export function selectBasePresetForSeed(matchSeed: string): BaseTerrainPreset {
  const hash = hashSeedString(`${matchSeed}_MODULAR_BASE`)
  const idx = hash % BASE_TERRAIN_CATALOG.length
  return BASE_TERRAIN_CATALOG[idx]
}
