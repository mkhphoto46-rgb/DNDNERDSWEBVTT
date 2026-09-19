export type SpellSchool =
  | 'Abjuration'
  | 'Conjuration'
  | 'Divination'
  | 'Enchantment'
  | 'Evocation'
  | 'Illusion'
  | 'Necromancy'
  | 'Transmutation'

export interface SpellAudioProfile {
  spell: string
  school: SpellSchool
  cue: string
  loopCue?: string
}

// Curated against the D&D 2024 Free Rules spell names. These profiles only
// select presentation audio; rules data and dice resolution remain separate.
export const SPELL_AUDIO_PROFILES: SpellAudioProfile[] = [
  { spell: 'Acid Splash', school: 'Evocation', cue: 'magic/sim_explacid' },
  { spell: 'Aid', school: 'Abjuration', cue: 'magic/sim_bonholy' },
  { spell: 'Barkskin', school: 'Transmutation', cue: 'magic/sim_barkskin' },
  { spell: 'Blindness/Deafness', school: 'Transmutation', cue: 'magic/sim_blinddeaf' },
  { spell: 'Blur', school: 'Illusion', cue: 'magic/sdr_blur' },
  { spell: 'Charm Person', school: 'Enchantment', cue: 'magic/sim_mentcharm' },
  { spell: 'Cone of Cold', school: 'Evocation', cue: 'magic/sar_conecold' },
  { spell: 'Darkness', school: 'Evocation', cue: 'magic/sdr_darkness' },
  { spell: 'Dispel Magic', school: 'Abjuration', cue: 'magic/sim_magdisp' },
  { spell: 'Dominate Person', school: 'Enchantment', cue: 'magic/sim_mentdomn' },
  { spell: 'Entangle', school: 'Conjuration', cue: 'magic/sdr_entangle', loopCue: 'magic/sps_entangle' },
  { spell: 'Fear', school: 'Illusion', cue: 'magic/sim_mentfear' },
  { spell: 'Fireball', school: 'Evocation', cue: 'magic/spr_fireball' },
  { spell: 'Fog Cloud', school: 'Conjuration', cue: 'magic/sps_fog', loopCue: 'magic/sps_fog_loop' },
  { spell: 'Grease', school: 'Conjuration', cue: 'magic/sps_grease' },
  { spell: 'Haste', school: 'Transmutation', cue: 'magic/sim_movhaste' },
  { spell: 'Invisibility', school: 'Illusion', cue: 'magic/sdr_invisible' },
  { spell: 'Knock', school: 'Transmutation', cue: 'magic/sim_magknock' },
  { spell: 'Lightning Bolt', school: 'Evocation', cue: 'magic/sim_exp2light' },
  { spell: 'Magic Missile', school: 'Evocation', cue: 'magic/spr_magicmissle' },
  { spell: 'Meteor Swarm', school: 'Evocation', cue: 'magic/sff_rainmeteor' },
  { spell: 'Polymorph', school: 'Transmutation', cue: 'magic/sim_magpoly' },
  { spell: 'Ray of Frost', school: 'Evocation', cue: 'magic/sim_raycold' },
  { spell: 'Sanctuary', school: 'Abjuration', cue: 'magic/sdr_sanctuary' },
  { spell: 'Sleep', school: 'Enchantment', cue: 'magic/sim_magsleep' },
  { spell: 'Slow', school: 'Transmutation', cue: 'magic/sim_movslow' },
  { spell: 'Stoneskin', school: 'Transmutation', cue: 'magic/sim_stoneskin' },
  { spell: 'Wall of Fire', school: 'Evocation', cue: 'magic/sps_wallfire' },
  { spell: 'Web', school: 'Conjuration', cue: 'magic/sdr_web' },
]

export const MAGIC_SCHOOL_CHANTS: Record<SpellSchool, string[]> = {
  Abjuration: ['magic/vs_chant_conj_lf', 'magic/vs_chant_conj_lm'],
  Conjuration: ['magic/vs_chant_conj_hf', 'magic/vs_chant_conj_hm'],
  Divination: ['magic/vs_chant_illu_lf', 'magic/vs_chant_illu_lm'],
  Enchantment: ['magic/vs_chant_ench_hf', 'magic/vs_chant_ench_hm'],
  Evocation: ['magic/vs_chant_evoc_hf', 'magic/vs_chant_evoc_hm'],
  Illusion: ['magic/vs_chant_illu_hf', 'magic/vs_chant_illu_hm'],
  Necromancy: ['magic/vs_chant_necr_hf', 'magic/vs_chant_necr_hm'],
  Transmutation: ['magic/vs_chant_conj_lf', 'magic/vs_chant_conj_lm'],
}
