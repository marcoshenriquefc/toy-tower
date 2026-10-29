export type PowerCategory = 'POSITIVE' | 'NEGATIVE'

export type PowerId =
  | 'SUPER_GLUE'
  | 'STATIC_BRICK'
  | 'BRICK_REMOVER'
  | 'SIDE_ISLAND'
  | 'GIANT_PIECE'
  | 'SLICK_BRICK'
  | 'LOCK_ROTATE'
  | 'BLIND_MANUAL'
  | 'TURBO_DROP'

export interface PowerConfig {
  id: PowerId
  name: string
  shortName: string
  icon: string
  category: PowerCategory
  /** How many pieces this power affects (e.g. 1 or 2) */
  durationPieces?: number
  /** Duration in milliseconds for timed screen powers (e.g. BLIND_MANUAL = 5000ms) */
  durationMs?: number
  /** Weighted probability in checkpoint random rolls */
  weight: number
  shortDescription: string
  description: string
  accentColor: string
}

export const POWERS_REGISTRY: PowerConfig[] = [
  // =========================================================================
  // PODERES POSITIVOS (Auto-Ajuda / Ordem — Ativos no Single-Player e Multi)
  // =========================================================================
  {
    id: 'SUPER_GLUE',
    name: 'Super Cola (Kragle / Weld)',
    shortName: 'Super Cola',
    icon: '💧',
    category: 'POSITIVE',
    durationPieces: 1,
    weight: 30,
    shortDescription:
      'Solda rigidamente (WeldJoint + vinhas de cola) a peça aos blocos que tocar ao pousar.',
    description:
      'A peça ganha gotas e vinhas de cola e cria juntas rígidas (WeldJoint) inseparáveis com todos os blocos que tocar ao pousar.',
    accentColor: '#00E5FF',
  },
  {
    id: 'STATIC_BRICK',
    name: 'Bloco de Ferro',
    shortName: 'Bloco de Ferro',
    icon: '⚓',
    category: 'POSITIVE',
    durationPieces: 1,
    weight: 25,
    shortDescription:
      'Congela no ar como plataforma estática no instante em que encosta (até lateralmente) em outro bloco.',
    description:
      'Transforma a peça em um Bloco de Ferro. No instante em que encostar em qualquer outro bloco (mesmo que lateralmente), congela imediatamente no ar!',
    accentColor: '#94A3B8',
  },
  {
    id: 'BRICK_REMOVER',
    name: 'Removedor de Peças (Brick Separator)',
    shortName: 'Removedor',
    icon: '🔧',
    category: 'POSITIVE',
    durationPieces: 1,
    weight: 25,
    shortDescription:
      'Desintegra instantaneamente a última peça que pousou na torre antes de um colapso.',
    description:
      'O extrator laranja desintegra instantaneamente a última peça que pousou na torre antes que cause um desmoronamento!',
    accentColor: '#FF6D00',
  },
  {
    id: 'SIDE_ISLAND',
    name: 'Ilha Auxiliar / Suporte Flutuante (Floating Outrigger)',
    shortName: 'Ilha Flutuante Lateral',
    icon: '🏝️',
    category: 'POSITIVE',
    durationPieces: 1,
    weight: 20,
    shortDescription:
      'Invoca imediatamente uma ilha estática 2.5×1.5 na lateral da torre sem substituir a peça atual!',
    description:
      'Invoca uma estrutura estática 2.5×1.5 unidades (μ=0.8 e Snap de Pinos) na lateral da torre (±5.25u) na altura do topo para escorar inclinações, criar pontes em arco ou recomeçar a subida!',
    accentColor: '#22C55E',
  },

  // =========================================================================
  // PODERES NEGATIVOS (Ataque / Caos — Bloqueados no Single-Player, ativos no Multi)
  // =========================================================================
  {
    id: 'GIANT_PIECE',
    name: 'Peça Duplo-Gigante (Mega Bloco 2x)',
    shortName: 'Mega Bloco 2x',
    icon: '🦣',
    category: 'NEGATIVE',
    durationPieces: 1,
    weight: 30,
    shortDescription:
      'A próxima peça surge com escala 200% (2x) e Massa = 16.0.',
    description:
      'A próxima peça surge com escala 200% (2x) e 4x a massa normal (Massa = 16.0). Alto risco de esmagar a torre!',
    accentColor: '#F59E0B',
  },
  {
    id: 'SLICK_BRICK',
    name: 'Peça de Gelo (Escorregadia μ=0.02)',
    shortName: 'Peça de Gelo',
    icon: '🧊',
    category: 'NEGATIVE',
    durationPieces: 2,
    weight: 30,
    shortDescription:
      'Deixa as próximas 2 peças do inimigo em gelo azul-ciano translúcido (μ = 0.02).',
    description:
      'Transforma as próximas 2 peças do adversário em gelo azul-ciano um pouco mais transparente, com atrito quase zero (μ = 0.02) e sem Snap de Pinos!',
    accentColor: '#38BDF8',
  },
  {
    id: 'LOCK_ROTATE',
    name: 'Giro Travado',
    shortName: 'Giro Travado',
    icon: '🔒',
    category: 'NEGATIVE',
    durationPieces: 2,
    weight: 20,
    shortDescription:
      'Trava apenas a rotação das próximas 2 peças do inimigo.',
    description:
      'Apenas trava a rotação das próximas 2 peças do adversário com um cadeado, impedindo que ele gire a peça!',
    accentColor: '#F43F5E',
  },
  {
    id: 'BLIND_MANUAL',
    name: 'Nuvem Fog (Neblina 20s)',
    shortName: 'Nuvem Fog (20s)',
    icon: '🌫️',
    category: 'NEGATIVE',
    durationPieces: 1,
    durationMs: 20000,
    weight: 20,
    shortDescription:
      'Cobre o topo da torre inimiga com uma Nuvem Fog por 20s e oculta a peça PRÓXIMA.',
    description:
      'Invoca uma densa Nuvem Fog que fica sobre o topo da torre adversária por 20 segundos e esconde o formato da peça no quadro PRÓXIMA!',
    accentColor: '#A855F7',
  },
  {
    id: 'TURBO_DROP',
    name: 'Queda Turbo (Gravidade Pesada)',
    shortName: 'Queda Turbo',
    icon: '⚡',
    category: 'NEGATIVE',
    durationPieces: 2,
    weight: 20,
    shortDescription:
      'As próximas 2 peças do inimigo caem em velocidade Soft Drop permanente.',
    description:
      'As próximas 2 peças do adversário já nascem com velocidade de Soft Drop permanente e batem no topo da torre com força total!',
    accentColor: '#EF4444',
  },
]

export function getPowerConfig(id: PowerId | null | undefined): PowerConfig | null {
  if (!id) return null
  return POWERS_REGISTRY.find((p) => p.id === id) || null
}

export function pickWeightedRandom(
  pool: PowerConfig[],
  rng: () => number = Math.random
): PowerConfig {
  const totalWeight = pool.reduce((sum, p) => sum + p.weight, 0)
  let roll = rng() * totalWeight
  for (const item of pool) {
    roll -= item.weight
    if (roll <= 0) {
      return item
    }
  }
  return pool[pool.length - 1]
}

/**
 * Função de sorteio ao cruzar e segurar (0.5s) a linha de Checkpoint:
 * - No MVP Single-Player (`isMultiplayer = false`), sorteia exclusivamente entre os Poderes Positivos (`attackPower: null`).
 * - No Multiplayer (`isMultiplayer = true`), sorteia 1 Poder Positivo (`selfPower`) e 1 Poder Negativo (`attackPower`).
 * - Se `excludePositiveIds` contiver `'SIDE_ISLAND'` (quando `hasSpawnedSideIsland === true`), remove a Ilha Lateral
 *   da roleta dos próximos Checkpoints (16m, 24m), sorteando apenas entre Super Cola, Bloco de Ferro e Removedor.
 */
export function rollCheckpointPowers(
  isMultiplayer: boolean,
  rng: () => number = Math.random,
  excludePositiveIds: PowerId[] = []
): {
  selfPower: PowerConfig
  attackPower: PowerConfig | null
} {
  const filteredPositive = POWERS_REGISTRY.filter(
    (p) => p.category === 'POSITIVE' && !excludePositiveIds.includes(p.id)
  )
  const positivePool =
    filteredPositive.length > 0
      ? filteredPositive
      : POWERS_REGISTRY.filter((p) => p.category === 'POSITIVE')
  const rolledPositive = pickWeightedRandom(positivePool, rng)

  if (!isMultiplayer) {
    return { selfPower: rolledPositive, attackPower: null }
  }

  const negativePool = POWERS_REGISTRY.filter((p) => p.category === 'NEGATIVE')
  const rolledNegative = pickWeightedRandom(negativePool, rng)

  return { selfPower: rolledPositive, attackPower: rolledNegative }
}
