import { CATALOG, FALLEN, GOD_LABEL, RELICS } from "./catalog.ts";
import { deriveStats, dominantGods, emptyGods } from "./progress.ts";
import type {
  Battle,
  CombatUnit,
  Command,
  Faction,
  FxEvent,
  God,
  LogLine,
  Reach,
  Rng,
  SavedUnit,
  SkillDef,
  StatusInst,
} from "./types.ts";

export function rawDamage(atk: number, bonus: number, def: number, ignore = 0): number {
  const mitigated = def * (1 - ignore);
  return Math.max(5, Math.round(atk + bonus - mitigated * 0.5));
}

export function passiveKey(unit: { defId: string; fallen: boolean }): string {
  if (unit.fallen) return "fallen-hunger";
  return CATALOG[unit.defId]?.passive.key ?? "";
}

export function skillsFor(unit: CombatUnit): SkillDef[] {
  if (unit.fallen && unit.fallenGod) return [FALLEN[unit.fallenGod].skill];
  const def = CATALOG[unit.defId];
  if (!def) return [];
  const list = [def.active];
  if (unit.level >= 15 && def.legendary) list.push(def.legendary);
  return list;
}

export function basicReach(unit: CombatUnit): Reach {
  if (unit.fallen) return "melee";
  return CATALOG[unit.defId]?.basicReach ?? "melee";
}

function skillBonus(unit: CombatUnit, skill: SkillDef): number {
  if (!unit.fallen && unit.milestones.s5 && CATALOG[unit.defId]?.active.id === skill.id) {
    return skill.bonus + 8;
  }
  return skill.bonus;
}

export function toCombat(saved: SavedUnit, position: number, owner: Faction): CombatUnit {
  const stats = deriveStats(saved);
  const fallen = saved.fallen && saved.fallenGod ? FALLEN[saved.fallenGod] : null;
  return {
    ...structuredClone(saved),
    name: fallen?.name ?? saved.name,
    role: fallen?.role ?? saved.role,
    faction: saved.fallen ? "chaos" : saved.faction,
    owner,
    hp: stats.hp,
    maxHp: stats.hp,
    atk: stats.atk,
    def: stats.def,
    spd: stats.spd,
    wp: stats.wp,
    maxWp: stats.wp,
    shield: 0,
    position,
    alive: true,
    fled: false,
    acted: false,
    cds: {},
    statuses: [],
    contribution: 0,
    dustUsed: false,
    pact: false,
    medicUsedRound: 0,
    pendingXp: 0,
    loot: emptyGods(),
  };
}

export function createBattle(imperial: SavedUnit[], chaos: SavedUnit[], _rng: Rng): Battle {
  const units = [
    ...imperial.slice(0, 5).map((u, i) => toCombat(u, i, "imperial")),
    ...chaos.slice(0, 5).map((u, i) => toCombat(u, i, "chaos")),
  ];
  for (const unit of units) {
    if (passiveKey(unit) === "gk-ward") unit.shield = 20;
  }
  const battle: Battle = {
    round: 1,
    phase: "imperial",
    status: "battle",
    seq: 0,
    fx: [],
    log: [],
    units,
    prompt: null,
    winner: null,
    summary: null,
    rematch: { imperial: false, chaos: false },
    finalized: false,
    maxRound: 24,
  };
  pushLog(battle, "普罗斯佩罗遗迹开启。帝国先手。", "info");
  openPhase(battle, _rng, true);
  return battle;
}

export function applyCommand(
  battle: Battle,
  command: Command,
  rng: Rng,
): { battle: Battle; error: string | null } {
  const next = structuredClone(battle);
  const error = applyInPlace(next, command, rng);
  if (error) return { battle, error };
  return { battle: next, error: null };
}

export function legalTargetIds(
  battle: Battle,
  actorId: string,
  mode: { type: "attack" } | { type: "skill"; skillId: string },
): string[] {
  const actor = battle.units.find((u) => u.instanceId === actorId);
  if (!actor || !actor.alive) return [];
  if (mode.type === "attack") {
    return battle.units.filter((t) => isLegal(battle, actor, t, "enemy", basicReach(actor))).map((t) => t.instanceId);
  }
  const skill = skillsFor(actor).find((s) => s.id === mode.skillId);
  if (!skill) return [];
  return battle.units
    .filter((t) => isLegal(battle, actor, t, skill.target, skill.reach))
    .map((t) => t.instanceId);
}

function applyInPlace(battle: Battle, command: Command, rng: Rng): string | null {
  if (battle.status !== "battle") return "战斗已经结束";
  if (command.kind === "crisis") return resolveCrisis(battle, command, rng);
  if (battle.prompt) return "请先解决临界抉择";
  if (command.kind === "end") {
    for (const unit of battle.units) {
      if (unit.alive && unit.faction === battle.phase) unit.acted = true;
    }
    pushLog(battle, battle.phase === "imperial" ? "帝国结束行动。" : "混沌结束行动。", "info");
    switchPhase(battle, rng);
    return null;
  }
  const actor = battle.units.find((u) => u.instanceId === command.actorId);
  if (!actor || !actor.alive) return "角色无法行动";
  if (actor.faction !== battle.phase) return "还没轮到该阵营";
  if (actor.acted) return "该角色本阶段已经行动";
  if (actor.crisisPending && !actor.fallen && actor.faction === "imperial") {
    battle.prompt = { type: "crisis", unitId: actor.instanceId };
    return "腐化达到临界，必须先抉择";
  }
  const target = battle.units.find((u) => u.instanceId === command.targetId);
  if (!target || !target.alive) return "目标无效";

  let skill: SkillDef | null = null;
  if (command.kind === "skill") {
    skill = skillsFor(actor).find((s) => s.id === command.skillId) ?? null;
    if (!skill) return "技能不可用";
    if ((actor.cds[skill.id] ?? 0) > 0) return "技能冷却中";
    if (actor.wp < skill.wp) return "灵能不足";
    if (!isLegal(battle, actor, target, skill.target, skill.reach)) return blockReason(battle, actor, target, skill.reach);
    actor.wp -= skill.wp;
    actor.cds[skill.id] = skill.cd;
    if (passiveKey(actor) === "sorc-refund" && skill.wp > 0) {
      actor.wp = Math.min(actor.maxWp, actor.wp + 10);
    }
    if (actor.faction === "chaos" && (skill.wp > 0 || skill.effects.some((e) => e.op === "poison"))) {
      addCorruption(battle, actor, 4, rng);
    }
  } else if (!isLegal(battle, actor, target, "enemy", basicReach(actor))) {
    return blockReason(battle, actor, target, basicReach(actor));
  }

  if (!skill || skill.kind === "damage") resolveDamage(battle, actor, target, skill, rng);
  else resolveSupport(battle, actor, target, skill, rng);

  if (actor.alive && passiveKey(actor) === "dg-rot" && actor.hp > 0 && actor.hp < actor.maxHp * 0.4) {
    const gained = heal(actor, actor, 6);
    if (gained > 0) {
      pushLog(battle, `${actor.name} 的不洁躯壳恢复了 ${gained} 点生命。`, "heal");
      pushFx(battle, { kind: "heal", actorId: actor.instanceId, targetId: actor.instanceId, amount: gained });
    }
  }

  if (actor.alive) actor.acted = true;
  afterAction(battle, rng);
  return null;
}

function resolveCrisis(
  battle: Battle,
  command: Extract<Command, { kind: "crisis" }>,
  rng: Rng,
): string | null {
  if (!battle.prompt || battle.prompt.unitId !== command.actorId) return "当前没有临界抉择";
  const unit = battle.units.find((u) => u.instanceId === command.actorId);
  if (!unit || !unit.alive) return "角色无法抉择";
  unit.crisisPending = false;
  battle.prompt = null;
  if (command.choice === "purify") {
    unit.corruption = Math.max(0, unit.corruption - 25);
    if (battle.phase === unit.faction) unit.acted = true;
    pushLog(battle, `${unit.name} 强行净化，腐化降至 ${unit.corruption}。`, "warp");
    pushFx(battle, { kind: "text", targetId: unit.instanceId, text: "净化" });
  } else if (command.choice === "retreat") {
    unit.alive = false;
    unit.fled = true;
    unit.hp = 0;
    pushLog(battle, `${unit.name} 撤离了遗迹。`, "warp");
    pushFx(battle, { kind: "death", targetId: unit.instanceId, text: "撤退" });
  } else {
    unit.corruption = Math.min(100, unit.corruption + 10);
    unit.pact = true;
    pushLog(battle, `${unit.name} 倾听低语，伤害提高，腐化为 ${unit.corruption}。`, "warp");
    pushFx(battle, { kind: "text", targetId: unit.instanceId, text: "低语" });
    if (unit.corruption >= 100 && !unit.fallen && unit.faction === "imperial") {
      loyaltyTrial(battle, unit, rng);
    }
  }
  afterAction(battle, rng);
  return null;
}

function resolveDamage(
  battle: Battle,
  actor: CombatUnit,
  target: CombatUnit,
  skill: SkillDef | null,
  rng: Rng,
): void {
  let bonus = skill ? skillBonus(actor, skill) : 0;
  let ignore = 0;
  if (skill) {
    for (const effect of skill.effects) {
      if (effect.op === "execute" && target.maxHp > 0 && target.hp / target.maxHp < effect.threshold) bonus += effect.bonus;
      if (effect.op === "ignoreDef") ignore = effect.ratio;
    }
  }
  let amount = rawDamage(combatAtk(battle, actor), bonus, combatDef(target), ignore);
  if (passiveKey(actor) === "gk-aegis" && (target.faction === "chaos" || target.corruption >= 20)) {
    amount = Math.max(5, Math.round(amount * 1.15));
  }
  const kind = skill?.psychic ? "psychic" : "attack";
  pushFx(battle, { kind, actorId: actor.instanceId, targetId: target.instanceId, amount });
  deal(battle, actor, target, amount, rng, skill?.psychic ? "psychic" : "hit");
  if (skill) applyHitEffects(battle, actor, target, skill, rng);
}

function resolveSupport(battle: Battle, actor: CombatUnit, target: CombatUnit, skill: SkillDef, rng: Rng): void {
  let amount = skillBonus(actor, skill);
  for (const effect of skill.effects) {
    if (effect.op === "healMissing") amount += Math.round((target.maxHp - target.hp) * effect.ratio);
  }
  if (skill.kind === "heal" && amount > 0) {
    const gained = heal(actor, target, amount);
    actor.contribution += gained;
    pushLog(battle, `${actor.name} 为 ${target.name} 恢复了 ${gained} 点生命。`, "heal");
    pushFx(battle, { kind: "heal", actorId: actor.instanceId, targetId: target.instanceId, amount: gained });
  } else {
    pushFx(battle, { kind: "shield", actorId: actor.instanceId, targetId: target.instanceId });
  }
  for (const effect of skill.effects) {
    if (effect.op === "shield") {
      const who = effect.on === "self" ? actor : target;
      who.shield += effect.value;
      actor.contribution += effect.value;
      pushLog(battle, `${who.name} 获得 ${effect.value} 点护盾。`, "heal");
    }
    if (effect.op === "atkUp") {
      const who = effect.on === "self" ? actor : target;
      who.statuses.push({ id: "atkUp", value: effect.value, turns: effect.turns, sourceId: actor.instanceId });
      pushLog(battle, `${who.name} 的攻击提高了 ${effect.value}。`, "info");
    }
  }
  if (skill.psychic && actor.faction === "chaos") addCorruption(battle, actor, 2, rng);
}

function applyHitEffects(
  battle: Battle,
  actor: CombatUnit,
  target: CombatUnit,
  skill: SkillDef,
  rng: Rng,
): void {
  let corrupted = false;
  for (const effect of skill.effects) {
    if (effect.op === "poison" && target.alive && passiveKey(target) !== "gk-aegis") {
      upsertStatus(target, { id: "poison", value: effect.value, turns: effect.turns, sourceId: actor.instanceId });
      pushLog(battle, `${target.name} 中毒了。`, "warp");
      pushFx(battle, { kind: "poison", actorId: actor.instanceId, targetId: target.instanceId, amount: effect.value });
    }
    if (effect.op === "defDown" && target.alive) {
      upsertStatus(target, { id: "defDown", value: effect.value, turns: effect.turns, sourceId: actor.instanceId });
      pushLog(battle, `${target.name} 的防御降低了 ${effect.value}。`, "info");
    }
    if (effect.op === "splash" && target.position < 2) {
      const victims = neighbors(battle, target).filter((u) => u.alive && u.faction !== actor.faction);
      for (const extra of victims) deal(battle, actor, extra, effect.value, rng, "hit");
    }
    if (effect.op === "cleanseSelf") {
      const debuff = actor.statuses.find((s) => s.id === "poison" || s.id === "defDown");
      if (debuff) actor.statuses = actor.statuses.filter((s) => s !== debuff);
    }
    if (effect.op === "corruption" && target.alive) {
      addCorruption(battle, target, effect.value, rng);
      corrupted = true;
    }
  }
  if (
    !corrupted &&
    skill.psychic &&
    actor.faction === "chaos" &&
    target.alive &&
    target.faction === "imperial"
  ) {
    addCorruption(battle, target, 6, rng);
  }
}

function deal(
  battle: Battle,
  source: CombatUnit,
  target: CombatUnit,
  amount: number,
  rng: Rng,
  kind: "hit" | "psychic" | "poison",
): void {
  if (!target.alive || amount <= 0) return;
  let left = amount;
  if (kind !== "poison" && passiveKey(target) === "tz-veil" && rng.chance(0.2)) {
    left = Math.max(1, Math.round(left * 0.7));
    pushLog(battle, `${target.name} 的形体变幻，卸去部分伤害。`, "warp");
  }
  if (target.shield > 0) {
    const absorbed = Math.min(target.shield, left);
    target.shield -= absorbed;
    left -= absorbed;
  }
  if (left <= 0) {
    pushLog(battle, `${target.name} 的护盾挡住了攻击。`, "info");
    pushFx(battle, { kind: "shield", actorId: source.instanceId, targetId: target.instanceId, amount: 0 });
    return;
  }
  const before = target.hp;
  if (target.hp - left <= 0 && passiveKey(target) === "rubric-dust" && !target.dustUsed) {
    target.hp = 1;
    target.dustUsed = true;
    pushLog(battle, `${target.name} 化作尘埃，仍以一点生命站住。`, "warp");
    pushFx(battle, { kind: "text", actorId: source.instanceId, targetId: target.instanceId, text: "尘埃" });
    return;
  }
  target.hp = Math.max(0, target.hp - left);
  if (source.instanceId !== target.instanceId) source.contribution += left;
  const label = kind === "poison" ? "毒素" : kind === "psychic" ? "灵能" : "攻击";
  pushLog(battle, `${source.name} 的${label}对 ${target.name} 造成 ${left} 点伤害。`, kind === "poison" ? "warp" : "hit");
  pushFx(battle, {
    kind: kind === "poison" ? "poison" : kind === "psychic" ? "psychic" : "attack",
    actorId: source.instanceId,
    targetId: target.instanceId,
    amount: left,
  });
  if (target.hp <= 0) kill(battle, source, target, rng);
  else if (before / target.maxHp >= 0.3 && target.hp / target.maxHp < 0.3) maybeMedic(battle, target);
}

function maybeMedic(battle: Battle, target: CombatUnit): void {
  const medic = battle.units.find(
    (u) =>
      u.alive &&
      u.faction === target.faction &&
      u.instanceId !== target.instanceId &&
      passiveKey(u) === "medic-ping" &&
      u.medicUsedRound !== battle.round,
  );
  if (!medic) return;
  medic.medicUsedRound = battle.round;
  const gained = heal(medic, target, 12);
  medic.contribution += gained;
  pushLog(battle, `${medic.name} 拉住了 ${target.name}，治疗 ${gained} 点。`, "heal");
  pushFx(battle, { kind: "heal", actorId: medic.instanceId, targetId: target.instanceId, amount: gained });
}

function kill(battle: Battle, killer: CombatUnit, victim: CombatUnit, rng: Rng): void {
  victim.alive = false;
  victim.hp = 0;
  victim.acted = true;
  pushFx(battle, { kind: "death", actorId: killer.instanceId, targetId: victim.instanceId });
  pushLog(battle, `${victim.name} 倒下了。`, "death");
  if (killer.alive && passiveKey(killer) === "fallen-hunger") {
    const gained = heal(killer, killer, 10);
    if (gained > 0) pushFx(battle, { kind: "heal", actorId: killer.instanceId, targetId: killer.instanceId, amount: gained });
  }
  const pool = 36 + victim.level * 6;
  const assistants = battle.units.filter(
    (u) => u.instanceId !== killer.instanceId && u.contribution > 0 && u.faction === killer.faction,
  );
  const killerShare = assistants.length ? Math.round(pool * 0.7) : pool;
  killer.pendingXp += killerShare;
  if (assistants.length) {
    const assistPool = pool - killerShare;
    const weight = assistants.reduce((sum, u) => sum + u.contribution, 0) || 1;
    let given = 0;
    assistants.forEach((ally, index) => {
      const share =
        index === assistants.length - 1 ? assistPool - given : Math.round((assistPool * ally.contribution) / weight);
      given += share;
      ally.pendingXp += share;
    });
  }
  const god = victimGod(victim);
  if (god) {
    const receivers = [killer, ...assistants].filter((u) => u.owner === "imperial" && !u.fallen && !u.greyKnight);
    if (receivers.length) {
      const each = Math.max(1, Math.round((10 + victim.level) / receivers.length));
      for (const unit of receivers) unit.loot[god] += each;
    }
  }
  if (killer.alive && killer.faction === "chaos") addCorruption(battle, killer, 6, rng);
}

function victimGod(victim: CombatUnit): God | null {
  if (victim.fallen && victim.fallenGod) return victim.fallenGod;
  return CATALOG[victim.defId]?.god ?? null;
}

function addCorruption(battle: Battle, unit: CombatUnit, amount: number, rng: Rng): void {
  if (amount <= 0 || !unit.alive) return;
  if (unit.greyKnight && !unit.fallen && unit.faction === "imperial") {
    pushLog(battle, `${unit.name} 净化了亚空间侵染。`, "warp");
    return;
  }
  if (unit.faction === "chaos" || unit.fallen) {
    const prev = unit.corruption;
    unit.corruption = Math.min(100, unit.corruption + amount);
    if (unit.corruption >= 100 && !unit.ascended && prev >= 100) ascend(battle, unit);
    else if (unit.corruption >= 100 && !unit.ascended && !unit.fallen) ascend(battle, unit);
    else if (unit.corruption >= 100 && !unit.ascended && unit.fallen && prev < 100) ascend(battle, unit);
    return;
  }
  const prev = unit.corruption;
  unit.corruption = Math.min(100, unit.corruption + amount);
  pushFx(battle, { kind: "text", targetId: unit.instanceId, text: "腐化", amount: unit.corruption });
  if (unit.corruption >= 100) {
    loyaltyTrial(battle, unit, rng);
    return;
  }
  if (prev < 80 && unit.corruption >= 80) {
    unit.crisisPending = true;
    battle.prompt = { type: "crisis", unitId: unit.instanceId };
    pushLog(battle, `${unit.name} 听见亚空间低语，必须做出抉择。`, "warp");
    pushFx(battle, { kind: "text", targetId: unit.instanceId, text: "低语" });
  }
}

function loyaltyTrial(battle: Battle, unit: CombatUnit, rng: Rng): void {
  unit.crisisPending = false;
  if (battle.prompt?.unitId === unit.instanceId) battle.prompt = null;
  const odds = unit.greyKnight ? 0.9 : 0.5;
  if (rng.next() < odds) {
    unit.corruption = 40;
    pushLog(battle, `${unit.name} 通过忠诚试炼，腐化回落到 40。`, "warp");
    pushFx(battle, { kind: "text", targetId: unit.instanceId, text: "守住" });
    return;
  }
  fall(battle, unit, rng);
}

function fall(battle: Battle, unit: CombatUnit, rng: Rng): void {
  (Object.keys(unit.loot) as God[]).forEach((god) => {
    unit.gods[god] += unit.loot[god];
  });
  unit.loot = emptyGods();
  const tops = dominantGods(unit.gods);
  const pool: God[] = tops.length > 0 ? tops : ["khorne", "tzeentch", "nurgle", "slaanesh"];
  const god = pool[rng.int(pool.length)] ?? "tzeentch";
  if (tops.length !== 1) {
    pushLog(battle, `诸神争夺：${GOD_LABEL[god]} 胜出。`, "warp");
  }
  const kit = FALLEN[god];
  unit.fallen = true;
  unit.fallenGod = god;
  unit.faction = "chaos";
  unit.name = kit.name;
  unit.role = kit.role;
  unit.greyKnight = false;
  unit.corruption = 100;
  unit.pact = false;
  unit.cds = {};
  const relic = RELICS.find((item) => item.god === god);
  if (relic) unit.gear = { id: relic.id, name: relic.name, hp: relic.hp, atk: relic.atk, def: relic.def };
  pushLog(battle, `${kit.name} 永久堕入${GOD_LABEL[god]}，阵营已不可逆转。`, "death");
  pushFx(battle, { kind: "flip", targetId: unit.instanceId, text: kit.name });
}

function ascend(battle: Battle, unit: CombatUnit): void {
  if (unit.ascended) return;
  unit.ascended = true;
  unit.maxHp += 20;
  unit.hp += 20;
  unit.atk += 8;
  unit.def += 4;
  pushLog(battle, `${unit.name} 完成混沌升华。`, "warp");
  pushFx(battle, { kind: "ascend", targetId: unit.instanceId, text: "升华" });
}

function afterAction(battle: Battle, rng: Rng): void {
  if (maybeEnd(battle)) return;
  if (battle.prompt) return;
  const live = battle.units.filter((u) => u.alive && u.faction === battle.phase);
  if (live.length === 0 || live.every((u) => u.acted)) switchPhase(battle, rng);
}

function switchPhase(battle: Battle, rng: Rng): void {
  if (maybeEnd(battle)) return;
  battle.phase = battle.phase === "imperial" ? "chaos" : "imperial";
  if (battle.phase === "imperial") battle.round += 1;
  openPhase(battle, rng, false);
}

function openPhase(battle: Battle, rng: Rng, first: boolean): void {
  if (!first) {
    pushLog(
      battle,
      battle.phase === "imperial" ? `第 ${battle.round} 回合 · 帝国行动` : `第 ${battle.round} 回合 · 混沌行动`,
      "info",
    );
  }
  if (maybeEnd(battle)) return;
  for (const unit of battle.units) {
    if (!unit.alive || unit.faction !== battle.phase) continue;
    unit.acted = false;
    if (!first) unit.wp = Math.min(unit.maxWp, unit.wp + 10);
    tickUnit(battle, unit, rng);
  }
  if (maybeEnd(battle)) return;
  raiseCrisis(battle);
}

function tickUnit(battle: Battle, unit: CombatUnit, rng: Rng): void {
  const poison = unit.statuses.find((s) => s.id === "poison");
  if (poison) {
    if (passiveKey(unit) === "gk-aegis") {
      unit.statuses = unit.statuses.filter((s) => s.id !== "poison");
    } else {
      const source = battle.units.find((u) => u.instanceId === poison.sourceId) ?? unit;
      deal(battle, source, unit, poison.value, rng, "poison");
      poison.turns -= 1;
      if (poison.turns <= 0) unit.statuses = unit.statuses.filter((s) => s !== poison);
    }
  }
  for (const status of unit.statuses) {
    if (status.id !== "poison") status.turns -= 1;
  }
  unit.statuses = unit.statuses.filter((s) => s.id === "poison" || s.turns > 0);
  for (const key of Object.keys(unit.cds)) {
    if (unit.cds[key] > 0) unit.cds[key] -= 1;
  }
}

function maybeEnd(battle: Battle): boolean {
  if (battle.status !== "battle") return true;
  const imperial = battle.units.some((u) => u.alive && u.faction === "imperial");
  const chaos = battle.units.some((u) => u.alive && u.faction === "chaos");
  if (battle.round > battle.maxRound || !imperial || !chaos) {
    if (battle.round > battle.maxRound && imperial && chaos) {
      const ih = sumHp(battle, "imperial");
      const ch = sumHp(battle, "chaos");
      battle.winner = ih === ch ? null : ih > ch ? "imperial" : "chaos";
    } else {
      battle.winner = imperial ? "imperial" : chaos ? "chaos" : null;
    }
    battle.status = "absorb";
    battle.prompt = null;
    const title =
      battle.winner === "imperial" ? "帝国阵线仍在。" : battle.winner === "chaos" ? "混沌占领遗迹。" : "遗迹吞没了双方。";
    pushLog(battle, title, "death");
    return true;
  }
  return false;
}

function raiseCrisis(battle: Battle): void {
  if (battle.prompt || battle.status !== "battle") return;
  const unit = battle.units.find((u) => u.alive && !u.fallen && u.faction === "imperial" && u.crisisPending);
  if (unit) battle.prompt = { type: "crisis", unitId: unit.instanceId };
}

function sumHp(battle: Battle, faction: Faction): number {
  return battle.units.filter((u) => u.alive && u.faction === faction).reduce((sum, u) => sum + u.hp, 0);
}

function combatAtk(battle: Battle, unit: CombatUnit): number {
  let atk = unit.atk;
  for (const status of unit.statuses) if (status.id === "atkUp") atk += status.value;
  if (passiveKey(unit) === "wolf-hunt" && unit.hp * 2 < unit.maxHp) atk += 8;
  if (unit.pact) atk = Math.round(atk * 1.15);
  const aura = battle.units.some(
    (other) => other.alive && other.instanceId !== unit.instanceId && other.faction === unit.faction && passiveKey(other) === "bl-aura",
  );
  if (aura) atk += 3;
  return atk;
}

function combatDef(unit: CombatUnit): number {
  let def = unit.def;
  for (const status of unit.statuses) if (status.id === "defDown") def -= status.value;
  if (passiveKey(unit) === "fist-wall" && unit.position >= 2) def += 6;
  return Math.max(0, def);
}

function isLegal(
  battle: Battle,
  actor: CombatUnit,
  target: CombatUnit,
  side: "enemy" | "ally",
  reach: Reach,
): boolean {
  if (!target.alive || target.fled) return false;
  if (side === "ally") {
    if (target.faction !== actor.faction) return false;
  } else if (target.faction === actor.faction) return false;
  if (side === "enemy" && reach === "melee") {
    const front = battle.units.some((u) => u.alive && u.faction === target.faction && u.position < 2);
    if (front && target.position >= 2) return false;
  }
  return true;
}

function blockReason(battle: Battle, actor: CombatUnit, target: CombatUnit, reach: Reach): string {
  if (reach === "melee" && target.position >= 2) {
    const front = battle.units.some((u) => u.alive && u.faction === target.faction && u.position < 2);
    if (front && target.faction !== actor.faction) return "前排未破，无法直击后排";
  }
  return "不能选择这个目标";
}

function neighbors(battle: Battle, target: CombatUnit): CombatUnit[] {
  const sameRow = (position: number) => (target.position < 2 ? position < 2 : position >= 2);
  return battle.units.filter(
    (u) =>
      u.faction === target.faction &&
      u.instanceId !== target.instanceId &&
      sameRow(u.position) &&
      Math.abs(u.position - target.position) === 1,
  );
}

function heal(source: CombatUnit, target: CombatUnit, amount: number): number {
  if (!target.alive || amount <= 0) return 0;
  const before = target.hp;
  target.hp = Math.min(target.maxHp, target.hp + amount);
  void source;
  return target.hp - before;
}

function upsertStatus(unit: CombatUnit, status: StatusInst): void {
  const existing = unit.statuses.find((s) => s.id === status.id);
  if (!existing) {
    unit.statuses.push(status);
    return;
  }
  existing.value = Math.max(existing.value, status.value);
  existing.turns = Math.max(existing.turns, status.turns);
  existing.sourceId = status.sourceId;
}

function pushFx(battle: Battle, fx: Omit<FxEvent, "id">): void {
  battle.seq += 1;
  battle.fx = [...battle.fx, { ...fx, id: `fx${battle.seq}` }].slice(-10);
}

function pushLog(battle: Battle, text: string, tone: LogLine["tone"]): void {
  battle.seq += 1;
  battle.log = [...battle.log, { id: `log${battle.seq}`, text, tone }].slice(-40);
}
