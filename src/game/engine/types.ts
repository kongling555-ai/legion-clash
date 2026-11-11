export type Faction = "imperial" | "chaos";
export type God = "khorne" | "tzeentch" | "nurgle" | "slaanesh";
export type Rarity = "rare" | "epic" | "legendary";
export type Reach = "melee" | "ranged";
export type SkillKind = "damage" | "heal" | "guard" | "hex" | "buff";

export interface Gods {
  khorne: number;
  tzeentch: number;
  nurgle: number;
  slaanesh: number;
}

export type Effect =
  | { op: "poison"; value: number; turns: number; tick?: "start" | "end" }
  | { op: "atkUp"; value: number; turns: number; on: "self" | "target" }
  | { op: "defDown"; value: number; turns: number; on?: "self" | "target" }
  | { op: "shield"; value: number; on: "self" | "target"; turns?: number }
  | { op: "splash"; value: number }
  | { op: "execute"; threshold: number; bonus: number }
  | { op: "ignoreDef"; ratio: number }
  | { op: "cleanseSelf" }
  | { op: "healMissing"; ratio: number }
  | { op: "corruption"; value: number }
  | { op: "guard"; ratio: number }
  | { op: "dmgDown"; ratio: number; turns: number }
  | { op: "nextHit"; value: number; turns: number }
  | { op: "lifePact"; cost: number; heal: number; extra: number; threshold: number }
  | { op: "sunder"; strip: number; bareScale: number; ignore: number };

export interface SkillDef {
  id: string;
  name: string;
  blurb: string;
  kind: SkillKind;
  target: "enemy" | "ally";
  reach: Reach;
  bonus: number;
  wp: number;
  cd: number;
  /** Multiplies attack before the damage formula. Omitted means 100%. */
  scale?: number;
  /** Ally skills may target the caster unless this is false. */
  allowSelf?: boolean;
  /** Melee skills with this flag may hit a living back line. */
  bypassFront?: boolean;
  /** Ally skills that only accept a wounded target. */
  requireWounded?: boolean;
  psychic?: boolean;
  effects: Effect[];
}

export interface PassiveDef {
  key: string;
  name: string;
  blurb: string;
}

export interface UnitDef {
  id: string;
  name: string;
  faction: Faction;
  role: string;
  rarity: Rarity;
  greyKnight?: boolean;
  god?: God;
  basicReach: Reach;
  /** Existing art to reuse. Falls back to the unit id. */
  portrait?: string;
  base: { hp: number; atk: number; def: number; spd: number; wp: number };
  active: SkillDef;
  legendary?: SkillDef;
  passive: PassiveDef;
}

export interface Gear {
  id: string;
  name: string;
  hp: number;
  atk: number;
  def: number;
}

export interface Milestones {
  s5: boolean;
  s10: boolean;
  s15: boolean;
  s20: boolean;
}

export interface SavedUnit {
  instanceId: string;
  defId: string;
  name: string;
  role: string;
  rarity: Rarity;
  faction: Faction;
  greyKnight: boolean;
  fallen: boolean;
  ascended: boolean;
  fallenGod: God | null;
  level: number;
  xp: number;
  freePoints: number;
  bonusHp: number;
  bonusAtk: number;
  bonusDef: number;
  corruption: number;
  gods: Gods;
  crisisPending: boolean;
  gear: Gear | null;
  milestones: Milestones;
}

export interface Roster {
  imperial: SavedUnit[];
  chaos: SavedUnit[];
  imperialRes: SavedUnit[];
  chaosRes: SavedUnit[];
}

export interface StatusInst {
  id: "poison" | "atkUp" | "defDown" | "dmgDown" | "nextHit";
  key: string;
  value: number;
  turns: number;
  sourceId: string;
  /** "end" waits for the end of this unit's own phase. Default is the phase start. */
  tick: "start" | "end";
}

export interface ShieldInst {
  key: string;
  name: string;
  value: number;
  /** Own-phase endings left. Null lasts until the shield is broken. */
  turns: number | null;
  faction: Faction;
}

export interface GuardLink {
  guardianId: string;
  ratio: number;
  /** Cleared at the start of the guardian's next own phase. */
  hold: number;
}

export interface CombatUnit extends SavedUnit {
  owner: Faction;
  hp: number;
  maxHp: number;
  atk: number;
  def: number;
  spd: number;
  wp: number;
  maxWp: number;
  shield: number;
  shields: ShieldInst[];
  guardedBy: GuardLink | null;
  ambushReady: boolean;
  position: number;
  alive: boolean;
  fled: boolean;
  acted: boolean;
  cds: Record<string, number>;
  /** Skip the next end-of-phase cooldown tick. Set when a skill is cast. */
  cdHold: Record<string, boolean>;
  statuses: StatusInst[];
  contribution: number;
  dustUsed: boolean;
  pact: boolean;
  medicUsedRound: number;
  pendingXp: number;
  loot: Gods;
}

export interface FxEvent {
  id: string;
  kind: "attack" | "psychic" | "heal" | "poison" | "death" | "flip" | "ascend" | "shield" | "text";
  actorId?: string;
  targetId?: string;
  amount?: number;
  text?: string;
}

export interface LogLine {
  id: string;
  text: string;
  tone: "info" | "hit" | "heal" | "death" | "warp";
}

export interface Prompt {
  type: "crisis";
  unitId: string;
}

export interface SummaryLine {
  instanceId: string;
  name: string;
  xp: number;
  levels: number;
  corruption: number;
  note: string;
}

export interface BattleSummary {
  winner: Faction | null;
  title: string;
  lines: SummaryLine[];
  gear: string | null;
}

export interface Battle {
  round: number;
  phase: Faction;
  status: "battle" | "absorb" | "finished";
  seq: number;
  fx: FxEvent[];
  log: LogLine[];
  units: CombatUnit[];
  prompt: Prompt | null;
  winner: Faction | null;
  summary: BattleSummary | null;
  rematch: { imperial: boolean; chaos: boolean };
  finalized: boolean;
  maxRound: number;
}

export type Command =
  | { kind: "attack"; actorId: string; targetId: string }
  | { kind: "skill"; actorId: string; skillId: string; targetId: string }
  | { kind: "end" }
  | { kind: "crisis"; actorId: string; choice: "purify" | "retreat" | "continue" };

export interface Rng {
  next(): number;
  int(max: number): number;
  chance(p: number): boolean;
}
