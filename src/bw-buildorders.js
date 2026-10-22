'use strict'

/**
 * Curated Brood War (SC1) build orders — sourced from Liquipedia and
 * community research. Since spawningtool is SC2-only, this static list
 * provides reliable, linkable BW build orders per matchup.
 *
 * Each entry: { id, matchup, name, difficulty, url, description, source }
 *   - matchup: PvT, PvP, PvZ, TvT, TvZ, TvP, ZvZ, ZvP, ZvT
 *   - url: Liquipedia build order page (opens in Brave)
 *   - source: community reference (pro player, tournament, guide)
 */

const BW_BUILDS = [
  // ═══════════════════════════════════════
  // PvT — Protoss vs Terran
  // ═══════════════════════════════════════
  {
    id: 'pvt-4gate-expand',
    matchup: 'PvT',
    name: '4-Gate Expand (Standard)',
    difficulty: 'Medium',
    url: 'https://liquipedia.net/starcraft/4-Gate_Expand',
    description: 'Nexus → Forge → 1-Gate → Cyber Core → 4-Gate expand. Standard safe PvT open.',
    source: 'Bisu, Mini standard',
  },
  {
    id: 'pvt-1gate-double',
    matchup: 'PvT',
    name: '1-Gate Double Nexus',
    difficulty: 'Hard',
    url: 'https://liquipedia.net/starcraft/1-Gate_Double_Nexus',
    description: 'Forge FE → 1-Gate → Cyber Core → Double Nexus. Aggressive economic open vs mech.',
    source: 'Bisu vs Flash',
  },
  {
    id: 'pvt-2gate-reaver',
    matchup: 'PvT',
    name: '2-Gate Reaver Drop',
    difficulty: 'Hard',
    url: 'https://liquipedia.net/starcraft/2-Gate_Reaver',
    description: '2-Gate → Robo → Reaver + Shuttle drop. Early pressure vs bio.',
    source: 'Pusan, Reach',
  },
  {
    id: 'pvt-carrier-switch',
    matchup: 'PvT',
    name: 'Carrier Transition',
    difficulty: 'Medium',
    url: 'https://liquipedia.net/starcraft/Carrier_Transition',
    description: '4-Gate safe → 3-Base → Stargate → Carrier switch. Late-game vs mech.',
    source: 'Midas, JJu',
  },
  {
    id: 'pvt-dt-rush',
    matchup: 'PvT',
    name: 'Dark Templar Rush',
    difficulty: 'Easy',
    url: 'https://liquipedia.net/starcraft/Dark_Templar_Rush',
    description: '1-Gate → Citadel → DT rush. Early cheese vs greedy Terran.',
    source: 'Legacy cheese build',
  },

  // ═══════════════════════════════════════
  // PvZ — Protoss vs Zerg
  // ═══════════════════════════════════════
  {
    id: 'pvz-ffe-standard',
    matchup: 'PvZ',
    name: 'FFE (Forge Fast Expand)',
    difficulty: 'Medium',
    url: 'https://liquipedia.net/starcraft/Forge_Fast_Expand',
    description: '13/13 FE → Forge → Gateway → Cyber Core → Dragoon Range → 4-Gate. Standard safe open.',
    source: 'Bisu, Mini standard',
  },
  {
    id: 'pvz-4gate-z',
    matchup: 'PvZ',
    name: '4-Gate Aggressive',
    difficulty: 'Medium',
    url: 'https://liquipedia.net/starcraft/4-Gate_Expand',
    description: '13/13 FE → 18-Gateway → 4-Gate → continuous Dragoon production. Timing vs 3-hatch.',
    source: 'Bisu aggressive',
  },
  {
    id: 'pvz-1gate-double-z',
    matchup: 'PvZ',
    name: '1-Gate Double Nexus',
    difficulty: 'Hard',
    url: 'https://liquipedia.net/starcraft/1-Gate_Double_Nexus',
    description: 'Forge FE → 1-Gate → Cyber Core → Double Nexus. Economic vs 3-hatch.',
    source: 'Bisu vs Jaedong',
  },
  {
    id: 'pvz-stargate-z',
    matchup: 'PvZ',
    name: 'Stargate First',
    difficulty: 'Medium',
    url: 'https://liquipedia.net/starcraft/Stargate_First',
    description: 'FFE → Gateway → Cyber Core → Stargate. Corsair vs overlord vision.',
    source: 'Reach, sOs (SC2 adapt)',
  },
  {
    id: 'pvz-carrier-z',
    matchup: 'PvZ',
    name: 'Carrier Transition',
    difficulty: 'Hard',
    url: 'https://liquipedia.net/starcraft/Carrier_Transition',
    description: 'FFE → 3-Base → Carrier switch. Late-game vs ultra/ling.',
    source: 'Mini, Stork',
  },

  // ═══════════════════════════════════════
  // PvP — Protoss vs Protoss
  // ═══════════════════════════════════════
  {
    id: 'pvp-2gate',
    matchup: 'PvP',
    name: '2-Gate (Standard)',
    difficulty: 'Easy',
    url: 'https://liquipedia.net/starcraft/2-Gate',
    description: 'Forge FE → 1-Gate → Cyber Core → 2-Gate. Standard safe open.',
    source: 'Standard meta',
  },
  {
    id: 'pvp-fast-expand',
    matchup: 'PvP',
    name: 'Fast Expand (FFE)',
    difficulty: 'Medium',
    url: 'https://liquipedia.net/starcraft/Forge_Fast_Expand',
    description: '13/13 FE → Forge → Gateway → Cyber Core. Safe FE vs greedy Protoss.',
    source: 'Safe macro',
  },
  {
    id: 'pvp-dt-rush-p',
    matchup: 'PvP',
    name: 'Dark Templar Rush',
    difficulty: 'Easy',
    url: 'https://liquipedia.net/starcraft/Dark_Templar_Rush',
    description: '1-Gate → Citadel → DT rush. Cheese vs no detection.',
    source: 'Legacy cheese',
  },
  {
    id: 'pvp-reaver-p',
    matchup: 'PvP',
    name: 'Reaver Drop',
    difficulty: 'Hard',
    url: 'https://liquipedia.net/starcraft/2-Gate_Reaver',
    description: '2-Gate → Robo → Reaver + Shuttle drop. Standard mid-game.',
    source: 'Standard PvP',
  },
  {
    id: 'pvp-carrier-p',
    matchup: 'PvP',
    name: 'Carrier Transition',
    difficulty: 'Hard',
    url: 'https://liquipedia.net/starcraft/Carrier_Transition',
    description: 'FFE → 3-Base → Carrier switch. Late-game stalemate breaker.',
    source: 'Late-game PvP',
  },

  // ═══════════════════════════════════════
  // TvT — Terran vs Terran
  // ═══════════════════════════════════════
  {
    id: 'tvt-1rax-fe',
    matchup: 'TvT',
    name: '1-Rax FE (Standard)',
    difficulty: 'Medium',
    url: 'https://liquipedia.net/starcraft/Terran_vs_Terran',
    description: '1-Rax → CC → 2-Factory → 3-CC. Standard TvT open.',
    source: 'Flash, Fantasy',
  },
  {
    id: 'tvt-2rax',
    matchup: 'TvT',
    name: '2-Rax Aggressive',
    difficulty: 'Hard',
    url: 'https://liquipedia.net/starcraft/Terran_vs_Terran',
    description: '2-Rax → Marine push → CC. Early pressure vs mech.',
    source: 'Early rush TvT',
  },
  {
    id: 'tvt-tank-push',
    matchup: 'TvT',
    name: 'Tank Push',
    difficulty: 'Medium',
    url: 'https://liquipedia.net/starcraft/Terran_vs_Terran',
    description: '1-Rax → Factory → Tank push. Standard mid-game.',
    source: 'Standard TvT',
  },

  // ═══════════════════════════════════════
  // TvZ — Terran vs Zerg
  // ═══════════════════════════════════════
  {
    id: 'tvz-1rax-fe',
    matchup: 'TvZ',
    name: '1-Rax FE (Standard)',
    difficulty: 'Medium',
    url: 'https://liquipedia.net/starcraft/Terran_vs_Zerg',
    description: '1-Rax → CC → 2-Factory → 3-CC. Standard TvZ open.',
    source: 'Light, Sea',
  },
  {
    id: 'tvz-2fac',
    matchup: 'TvZ',
    name: '2-Factory Timing',
    difficulty: 'Hard',
    url: 'https://liquipedia.net/starcraft/Terran_vs_Zerg',
    description: '1-Rax → 2-Factory timing push. Anti-3-hatch.',
    source: 'Aggressive TvZ',
  },
  {
    id: 'tvz-bio-push',
    matchup: 'TvZ',
    name: 'Bio Push',
    difficulty: 'Easy',
    url: 'https://liquipedia.net/starcraft/Terran_vs_Zerg',
    description: '1-Rax → Marine/Medic push. Standard mid-game.',
    source: 'Standard TvZ',
  },

  // ═══════════════════════════════════════
  // ZvZ — Zerg vs Zerg
  // ═══════════════════════════════════════
  {
    id: 'zvz-12pool',
    matchup: 'ZvZ',
    name: '12-Pool (Standard)',
    difficulty: 'Medium',
    url: 'https://liquipedia.net/starcraft/Zerg_vs_Zerg',
    description: '12-Pool → Hatch → 3-Hatch. Standard ZvZ open.',
    source: 'Standard meta',
  },
  {
    id: 'zvz-9pool',
    matchup: 'ZvZ',
    name: '9-Pool Aggressive',
    difficulty: 'Hard',
    url: 'https://liquipedia.net/starcraft/Zerg_vs_Zerg',
    description: '9-Pool → Ling rush. Early pressure.',
    source: 'Aggressive ZvZ',
  },
  {
    id: 'zvz-3hatch-ling',
    matchup: 'ZvZ',
    name: '3-Hatch Ling',
    difficulty: 'Medium',
    url: 'https://liquipedia.net/starcraft/Zerg_vs_Zerg',
    description: '12-Hatch → 3-Hatch → Mass ling. Economic ZvZ.',
    source: 'Economic ZvZ',
  },

  // ═══════════════════════════════════════
  // ZvT — Zerg vs Terran
  // ═══════════════════════════════════════
  {
    id: 'zvt-3hatch-ling',
    matchup: 'ZvT',
    name: '3-Hatch Ling (Standard)',
    difficulty: 'Medium',
    url: 'https://liquipedia.net/starcraft/Zerg_vs_Terran',
    description: '12-Pool → 3-Hatch → Mass ling. Standard ZvT open.',
    source: 'Standard meta',
  },
  {
    id: 'zvt-2hatch-lurker',
    matchup: 'ZvT',
    name: '2-Hatch Lurker',
    difficulty: 'Hard',
    url: 'https://liquipedia.net/starcraft/Zerg_vs_Terran',
    description: '12-Hatch → 2-Hatch → Lurker. Early tech.',
    source: 'Aggressive ZvT',
  },
  {
    id: 'zvt-3hatch-muta',
    matchup: 'ZvT',
    name: '3-Hatch Muta',
    difficulty: 'Medium',
    url: 'https://liquipedia.net/starcraft/Zerg_vs_Terran',
    description: '12-Pool → 3-Hatch → Muta. Standard mid-game.',
    source: 'Standard ZvT',
  },

  // ═══════════════════════════════════════
  // ZvP — Zerg vs Protoss
  // ═══════════════════════════════════════
  {
    id: 'zvp-3hatch-ling',
    matchup: 'ZvP',
    name: '3-Hatch Ling (Standard)',
    difficulty: 'Medium',
    url: 'https://liquipedia.net/starcraft/Zerg_vs_Protoss',
    description: '12-Pool → 3-Hatch → Mass ling. Standard ZvP open.',
    source: 'Standard meta',
  },
  {
    id: 'zvp-2hatch-hydra',
    matchup: 'ZvP',
    name: '2-Hatch Hydra',
    difficulty: 'Hard',
    url: 'https://liquipedia.net/starcraft/Zerg_vs_Protoss',
    description: '12-Hatch → 2-Hatch → Hydra. Early tech.',
    source: 'Aggressive ZvP',
  },
  {
    id: 'zvp-3hatch-hydra',
    matchup: 'ZvP',
    name: '3-Hatch Hydra',
    difficulty: 'Medium',
    url: 'https://liquipedia.net/starcraft/Zerg_vs_Protoss',
    description: '12-Pool → 3-Hatch → Hydra bust. Standard mid-game.',
    source: 'Standard ZvP',
  },
]

module.exports = {
  BW_BUILDS,
  fetchBuildOrdersBW: () => BW_BUILDS,
}
