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
  ShieldInst,
  SkillDef,
  StatusInst,
} from "./types.ts";

type Aim = {
  target: "enemy" | "ally";
  reach: Reach;
  allowSelf?: boolean;
  bypassFront?: boolean;
  requireWounded?: boolean;
};

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

export function cooldownLeft(unit: CombatUnit, skillId: string): number {
  return unit.cds?.[skillId] ?? 0;
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
    shields: [],
    guardedBy: null,
    ambushReady: false,
    position,
    alive: true,
    fled: false,
    acted: false,
    cds: {},
    cdHold: {},
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
    const key = passiveKey(unit);
    unit.ambushReady = key === "ambush-prep";
    if (key === "gk-ward") grantShield(unit, { key: "gk-ward", name: "心灵堡垒", value: 20, turns: null, faction: unit.faction });
    if (key === "spare-armor") grantShield(unit, { key: "spare-armor", name: "备用装甲", value: 10, turns: null, faction: unit.faction });
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
    return battle.units
      .filter((t) => isLegal(battle, actor, t, { target: "enemy", reach: basicReach(actor) }))
      .map((t) => t.instanceId);
  }
  const skill = skillsFor(actor).find((s) => s.id === mode.skillId);
  if (!skill) return [];
  return battle.units.filter((t) => isLegal(battle, actor, t, skill)).map((t) => t.instanceId);
}

export function targetReason(
  battle: Battle,
  actorId: string,
  targetId: string,
  mode: { type: "attack" } | { type: "skill"; skillId: string },
): string | null {
  const actor = battle.units.find((u) => u.instanceId === actorId);
  const target = battle.units.find((u) => u.instanceId === targetId);
  if (!actor || !target) return "目标无效";
  const skill = mode.type === "skill" ? skillsFor(actor).find((s) => s.id === mode.skillId) : null;
  if (mode.type === "skill" && !skill) return "技能不可用";
  const rule = skill ?? { target: "enemy" as const, reach: basicReach(actor) };
  if (isLegal(battle, actor, target, rule)) return null;
  return blockReason(battle, actor, target, rule);
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
  if (!target) return "目标无效";
  if (!target.alive || target.fled) return "已阵亡，不能选为目标";

  let skill: SkillDef | null = null;
  if (command.kind === "skill") {
    skill = skillsFor(actor).find((s) => s.id === command.skillId) ?? null;
    if (!skill) return "技能不可用";
    if (cooldownLeft(actor, skill.id) > 0) return "技能冷却中";
    if (actor.wp < skill.wp) return "灵能不足";
    if (!isLegal(battle, actor, target, skill)) return blockReason(battle, actor, target, skill);
    const pact = skill.effects.find((effect) => effect.op === "lifePact");
    if (pact && pact.op === "lifePact" && actor.hp <= pact.cost) return "生命不足以支付";
    actor.wp -= skill.wp;
    actor.cds[skill.id] = skill.cd;
    actor.cdHold = actor.cdHold ?? {};
    actor.cdHold[skill.id] = true;
    if (passiveKey(actor) === "sorc-refund" && skill.wp > 0) {
      actor.wp = Math.min(actor.maxWp, actor.wp + 10);
    }
    if (actor.faction === "chaos" && (skill.wp > 0 || skill.effects.some((e) => e.op === "poison"))) {
      addCorruption(battle, actor, 4, rng);
    }
  } else if (!isLegal(battle, actor, target, { target: "enemy", reach: basicReach(actor) })) {
    return blockReason(battle, actor, target, { target: "enemy", reach: basicReach(actor) });
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
  if (passiveKey(actor) === "ambush-prep" && actor.ambushReady) {
    ignore = Math.min(1, ignore + 0.2);
    actor.ambushReady = false;
    pushLog(battle, `${actor.name} 的伏击准备生效，忽略目标20%防御。`, "info");
  }
  let scale = skill?.scale ?? 1;
  const sunder = skill?.effects.find((effect) => effect.op === "sunder");
  if (sunder && sunder.op === "sunder") {
    if (target.shield > 0) {
      const ripped = absorbShield(target, sunder.strip);
      ignore = Math.min(1, ignore + sunder.ignore);
      scale = 1;
      pushLog(battle, `${actor.name} 的碎盾撕开了 ${ripped} 点护盾。`, "info");
    } else {
      scale = sunder.bareScale;
      pushLog(battle, `${target.name} 没有护盾，碎盾改为 ${Math.round(sunder.bareScale * 100)}% 攻击。`, "info");
    }
  }
  let ordered = 0;
  const nextHit = (actor.statuses ?? []).find((status) => status.id === "nextHit");
  if (nextHit) {
    ordered = nextHit.value;
    actor.statuses = actor.statuses.filter((status) => status !== nextHit);
    pushLog(battle, `${actor.name} 的号令打出，攻击提高 ${ordered}。`, "info");
  }
  const atk = Math.round((combatAtk(battle, actor) + ordered) * scale);
  let amount = rawDamage(atk, bonus, combatDef(target), ignore);
  if (passiveKey(actor) === "gk-aegis" && (target.faction === "chaos" || target.corruption >= 20)) {
    amount = Math.max(5, Math.round(amount * 1.15));
  }
  const down = (actor.statuses ?? []).filter((s) => s.id === "dmgDown");
  if (down.length) {
    const ratio = Math.max(...down.map((s) => s.value));
    const reduced = Math.max(0, Math.round(amount * (1 - ratio)));
    pushLog(battle, `${actor.name} 受灵能压制，直接伤害由 ${amount} 降为 ${reduced}。`, "warp");
    amount = reduced;
  }
  const cause = skill?.name ?? "普通攻击";
  const kind = skill?.psychic ? "psychic" : "hit";
  deal(battle, actor, target, amount, rng, kind, cause, false);
  if (skill) applyHitEffects(battle, actor, target, skill, rng);
}

function resolveSupport(battle: Battle, actor: CombatUnit, target: CombatUnit, skill: SkillDef, rng: Rng): void {
  const pact = skill.effects.find((effect) => effect.op === "lifePact");
  if (pact && pact.op === "lifePact") {
    const healthy = actor.maxHp > 0 && actor.hp / actor.maxHp > pact.threshold;
    actor.hp -= pact.cost;
    const gained = heal(actor, target, pact.heal + (healthy ? pact.extra : 0));
    actor.contribution += gained;
    pushLog(battle, `${actor.name} 付出 ${pact.cost} 点生命，为 ${target.name} 恢复了 ${gained} 点。`, "heal");
    pushFx(battle, { kind: "heal", actorId: actor.instanceId, targetId: target.instanceId, amount: gained });
    pushFx(battle, { kind: "text", actorId: actor.instanceId, amount: pact.cost, text: "血契" });
    return;
  }
  let amount = skillBonus(actor, skill);
  for (const effect of skill.effects) {
    if (effect.op === "healMissing") amount += Math.round((target.maxHp - target.hp) * effect.ratio);
  }
  if (skill.kind === "heal" && amount > 0) {
    const gained = heal(actor, target, amount);
    actor.contribution += gained;
    pushLog(battle, `${actor.name} 为 ${target.name} 恢复了 ${gained} 点生命。`, "heal");
    pushFx(battle, { kind: "heal", actorId: actor.instanceId, targetId: target.instanceId, amount: gained });
  } else if (skill.kind === "guard") {
    pushFx(battle, { kind: "shield", actorId: actor.instanceId, targetId: target.instanceId });
  } else if (skill.kind === "buff") {
    pushFx(battle, { kind: "text", actorId: actor.instanceId, targetId: target.instanceId, text: skill.name });
  }
  for (const effect of skill.effects) {
    if (effect.op === "shield") {
      const who = effect.on === "self" ? actor : target;
      grantShield(who, {
        key: skill.id,
        name: skill.name,
        value: effect.value,
        turns: effect.turns ?? null,
        faction: actor.faction,
      });
      actor.contribution += effect.value;
      const timer = effect.turns ? "，时限已刷新" : "";
      pushLog(battle, `${who.name} 获得 ${effect.value} 点护盾。`, "heal");
      if (timer) pushLog(battle, `${who.name} 的${skill.name}护盾保留较高值${timer}。`, "info");
    }
    if (effect.op === "atkUp") {
      const who = effect.on === "self" ? actor : target;
      upsertStatus(who, { id: "atkUp", key: skill.id, value: effect.value, turns: effect.turns, sourceId: actor.instanceId, tick: "start" });
      pushLog(battle, `${who.name} 的攻击提高了 ${effect.value}。`, "info");
    }
    if (effect.op === "guard") {
      target.guardedBy = { guardianId: actor.instanceId, ratio: effect.ratio, hold: 1 };
      pushLog(battle, `${actor.name} 守护 ${target.name}，承担其 ${Math.round(effect.ratio * 100)}% 的直接伤害，直到下个己方阶段开始。`, "info");
      pushFx(battle, { kind: "shield", actorId: actor.instanceId, targetId: target.instanceId, text: "守护" });
    }
    if (effect.op === "dmgDown" && target.alive) {
      upsertStatus(target, {
        id: "dmgDown",
        key: skill.id,
        value: effect.ratio,
        turns: effect.turns,
        sourceId: actor.instanceId,
        tick: "end",
      });
      pushLog(battle, `${target.name} 被${skill.name}压制，直接伤害降低 ${Math.round(effect.ratio * 100)}%，持续到其下个阶段结束。`, "warp");
      pushFx(battle, { kind: "psychic", actorId: actor.instanceId, targetId: target.instanceId, text: "压制" });
    }
    if (effect.op === "nextHit" && target.alive) {
      upsertStatus(target, {
        id: "nextHit",
        key: skill.id,
        value: effect.value,
        turns: effect.turns,
        sourceId: actor.instanceId,
        tick: "end",
      });
      pushLog(battle, `${target.name} 得到号令，下一次攻击的攻击力 +${effect.value}。`, "info");
    }
  }
  if (skill.psychic && actor.faction === "chaos" && skill.kind !== "hex") addCorruption(battle, actor, 2, rng);
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
      const tick = effect.tick ?? "start";
      const refreshed = upsertPoison(target, {
        id: "poison",
        key: skill.id,
        value: effect.value,
        turns: effect.turns,
        sourceId: actor.instanceId,
        tick,
      });
      pushLog(battle, refreshed ? `${target.name} 的${skill.name}只刷新了持续时间。` : `${target.name} 中毒了。`, "warp");
      pushFx(battle, { kind: "poison", actorId: actor.instanceId, targetId: target.instanceId, amount: effect.value });
    }
    if (effect.op === "defDown") {
      const who = effect.on === "self" ? actor : target;
      if (who.alive) {
        upsertStatus(who, {
          id: "defDown",
          key: `${skill.id}:${effect.on ?? "target"}`,
          value: effect.value,
          turns: effect.turns,
          sourceId: actor.instanceId,
          tick: "start",
        });
        pushLog(battle, `${who.name} 的防御降低了 ${effect.value}。`, "info");
      }
    }
    if (effect.op === "splash" && target.position < 2) {
      const victims = neighbors(battle, target).filter((u) => u.alive && u.faction !== actor.faction);
      for (const extra of victims) deal(battle, actor, extra, effect.value, rng, "hit", "溅射", false);
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
    skill.kind === "damage" &&
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
  cause: string,
  noShare: boolean,
): void {
  if (!target.alive || amount <= 0) return;
  let left = amount;
  if (kind === "poison" && passiveKey(target) === "toxin-body") {
    left = Math.round(left * 0.75);
    if (left <= 0) return;
  }
  if (kind !== "poison" && !noShare && passiveKey(target) === "tz-veil" && rng.chance(0.2)) {
    left = Math.max(1, Math.round(left * 0.7));
    pushLog(battle, `${target.name} 的形体变幻，卸去部分伤害。`, "warp");
  }
  if (kind !== "poison" && !noShare && target.guardedBy) {
    const link = target.guardedBy;
    const guardian = battle.units.find((u) => u.instanceId === link.guardianId);
    if (!guardian || !guardian.alive || guardian.instanceId === target.instanceId) {
      target.guardedBy = null;
    } else {
      const share = Math.round(left * link.ratio);
      const stay = left - share;
      pushLog(battle, `${guardian.name} 替 ${target.name} 分担 ${share} 点直接伤害。`, "info");
      if (stay > 0) applyBody(battle, source, target, stay, rng, kind, cause);
      if (share > 0 && guardian.alive) applyBody(battle, source, guardian, share, rng, kind, "守护分担");
      if (!guardian.alive) clearGuardOf(battle, guardian.instanceId);
      return;
    }
  }
  applyBody(battle, source, target, left, rng, kind, cause);
}

function applyBody(
  battle: Battle,
  source: CombatUnit,
  target: CombatUnit,
  left: number,
  rng: Rng,
  kind: "hit" | "psychic" | "poison",
  cause: string,
): void {
  if (!target.alive || left <= 0) return;
  const absorbed = absorbShield(target, left);
  left -= absorbed;
  if (absorbed > 0) {
    pushLog(battle, `${target.name} 的护盾吸收了 ${absorbed} 点。`, "info");
    pushFx(battle, { kind: "shield", actorId: source.instanceId, targetId: target.instanceId, amount: absorbed });
  }
  if (left <= 0) {
    pushLog(battle, `${target.name} 的护盾挡住了攻击。`, "info");
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
  const via = cause && cause !== "普通攻击" && cause !== "毒素" ? `（${cause}）` : "";
  pushLog(battle, `${source.name} 的${label}${via}对 ${target.name} 造成 ${left} 点伤害。`, kind === "poison" ? "warp" : "hit");
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
  victim.guardedBy = null;
  clearGuardOf(battle, victim.instanceId);
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
  unit.cdHold = {};
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
  closePhase(battle, rng);
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
    if (unit.guardedBy && !first) {
      const guardian = battle.units.find((u) => u.instanceId === unit.guardedBy?.guardianId);
      if (!guardian || !guardian.alive) unit.guardedBy = null;
      else if (guardian.faction === battle.phase) {
        unit.guardedBy.hold -= 1;
        if (unit.guardedBy.hold <= 0) unit.guardedBy = null;
      }
    }
  }
  for (const unit of battle.units) {
    if (!unit.alive || unit.faction !== battle.phase) continue;
    unit.acted = false;
    if (!first) {
      const gain = passiveKey(unit) === "meditate" ? 5 : 10;
      unit.wp = Math.min(unit.maxWp, unit.wp + gain);
    }
    tickUnit(battle, unit, rng);
  }
  if (maybeEnd(battle)) return;
  raiseCrisis(battle);
}

function closePhase(battle: Battle, rng: Rng): void {
  const ending = battle.phase;
  for (const unit of battle.units) {
    if (!unit.alive || unit.faction !== ending) continue;
    tickEnd(battle, unit, rng);
    tickShields(unit, ending);
    tickCooldowns(unit);
  }
}

function tickUnit(battle: Battle, unit: CombatUnit, rng: Rng): void {
  unit.statuses = unit.statuses ?? [];
  const starting = unit.statuses.filter((s) => s.id === "poison" && s.tick !== "end");
  if (passiveKey(unit) === "gk-aegis") {
    unit.statuses = unit.statuses.filter((s) => s.id !== "poison");
  } else {
    for (const poison of starting) {
      const source = battle.units.find((u) => u.instanceId === poison.sourceId) ?? unit;
      deal(battle, source, unit, poison.value, rng, "poison", "毒素", true);
      poison.turns -= 1;
    }
    unit.statuses = unit.statuses.filter((s) => s.id !== "poison" || s.tick === "end" || s.turns > 0);
  }
  for (const status of unit.statuses) {
    if (status.id === "poison" || status.tick === "end") continue;
    status.turns -= 1;
  }
  unit.statuses = unit.statuses.filter((s) => s.id === "poison" || s.tick === "end" || s.turns > 0);
}

function tickEnd(battle: Battle, unit: CombatUnit, rng: Rng): void {
  unit.statuses = unit.statuses ?? [];
  if (passiveKey(unit) === "gk-aegis") {
    unit.statuses = unit.statuses.filter((s) => s.id !== "poison");
  } else {
    const ending = unit.statuses.filter((s) => s.id === "poison" && s.tick === "end");
    for (const poison of ending) {
      const source = battle.units.find((u) => u.instanceId === poison.sourceId) ?? unit;
      deal(battle, source, unit, poison.value, rng, "poison", "疫毒", true);
      poison.turns -= 1;
    }
    unit.statuses = unit.statuses.filter((s) => s.id !== "poison" || s.tick !== "end" || s.turns > 0);
  }
  for (const status of unit.statuses) {
    if (status.tick !== "end" || status.id === "poison") continue;
    status.turns -= 1;
  }
  unit.statuses = unit.statuses.filter((s) => s.tick !== "end" || s.id === "poison" || s.turns > 0);
}

function tickShields(unit: CombatUnit, faction: Faction): void {
  const shields = shieldsOf(unit);
  for (const shield of shields) {
    if (shield.faction !== faction || shield.turns == null) continue;
    shield.turns -= 1;
  }
  unit.shields = shields.filter((s) => s.value > 0 && (s.turns == null || s.turns > 0));
  syncShield(unit);
}

function tickCooldowns(unit: CombatUnit): void {
  unit.cds = unit.cds ?? {};
  unit.cdHold = unit.cdHold ?? {};
  for (const key of Object.keys(unit.cds)) {
    if (unit.cdHold[key]) {
      delete unit.cdHold[key];
      continue;
    }
    if (unit.cds[key] > 0) unit.cds[key] -= 1;
    if (unit.cds[key] <= 0) delete unit.cds[key];
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
  for (const status of unit.statuses ?? []) if (status.id === "atkUp") atk += status.value;
  if (passiveKey(unit) === "wolf-hunt" && unit.hp * 2 < unit.maxHp) atk += 8;
  if (passiveKey(unit) === "blood-rage") {
    if (unit.hp * 4 <= unit.maxHp) atk += 10;
    else if (unit.hp * 2 <= unit.maxHp) atk += 6;
  }
  if (unit.pact) atk = Math.round(atk * 1.15);
  const aura = battle.units.some(
    (other) => other.alive && other.instanceId !== unit.instanceId && other.faction === unit.faction && passiveKey(other) === "bl-aura",
  );
  if (aura) atk += 3;
  const line = battle.units.some(
    (other) =>
      other.alive &&
      other.instanceId !== unit.instanceId &&
      other.faction === unit.faction &&
      passiveKey(other) === "line-command",
  );
  if (line && unit.position >= 2) atk += 2;
  return atk;
}

function combatDef(unit: CombatUnit): number {
  let def = unit.def;
  for (const status of unit.statuses ?? []) if (status.id === "defDown") def -= status.value;
  if (passiveKey(unit) === "fist-wall" && unit.position >= 2) def += 6;
  if (passiveKey(unit) === "hold-fast" && unit.hp * 2 > unit.maxHp) def += 5;
  if (passiveKey(unit) === "vanguard" && unit.position < 2) def += 4;
  return Math.max(0, def);
}

function isLegal(battle: Battle, actor: CombatUnit, target: CombatUnit, rule: Aim): boolean {
  if (!target.alive || target.fled) return false;
  if (rule.target === "ally") {
    if (target.faction !== actor.faction) return false;
    if (rule.allowSelf === false && target.instanceId === actor.instanceId) return false;
  } else if (target.faction === actor.faction) return false;
  if (rule.requireWounded && target.hp >= target.maxHp) return false;
  if (rule.target === "enemy" && rule.reach === "melee" && !rule.bypassFront) {
    const front = battle.units.some((u) => u.alive && u.faction === target.faction && u.position < 2);
    if (front && target.position >= 2) return false;
  }
  return true;
}

function blockReason(battle: Battle, actor: CombatUnit, target: CombatUnit, rule: Aim): string {
  if (!target.alive || target.fled) return "已阵亡，不能选为目标";
  if (rule.target === "ally" && target.faction !== actor.faction) return "这个技能要选择友军";
  if (rule.target === "enemy" && target.faction === actor.faction) return "这个行动要选择敌人";
  if (rule.allowSelf === false && target.instanceId === actor.instanceId) return "不能选择自己";
  if (rule.requireWounded && target.hp >= target.maxHp) return "目标生命已满";
  if (rule.target === "enemy" && rule.reach === "melee" && !rule.bypassFront && target.position >= 2) {
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
  unit.statuses = unit.statuses ?? [];
  const existing = unit.statuses.find((s) => s.id === status.id && s.key === status.key);
  if (!existing) {
    unit.statuses.push(status);
    return;
  }
  existing.value = Math.max(existing.value, status.value);
  existing.turns = Math.max(existing.turns, status.turns);
  existing.sourceId = status.sourceId;
}

function upsertPoison(unit: CombatUnit, status: StatusInst): boolean {
  unit.statuses = unit.statuses ?? [];
  const existing = unit.statuses.find((s) => s.id === "poison" && s.key === status.key);
  if (!existing) {
    unit.statuses.push(status);
    return false;
  }
  existing.turns = status.turns;
  existing.sourceId = status.sourceId;
  return true;
}

function shieldsOf(unit: CombatUnit): ShieldInst[] {
  if (!Array.isArray(unit.shields)) {
    unit.shields =
      unit.shield > 0 ? [{ key: "legacy", name: "护盾", value: unit.shield, turns: null, faction: unit.faction }] : [];
  }
  return unit.shields;
}

function grantShield(unit: CombatUnit, shield: ShieldInst): void {
  const shields = shieldsOf(unit);
  const prev = shields.find((s) => s.key === shield.key);
  if (!prev) shields.push({ ...shield });
  else {
    prev.value = Math.max(prev.value, shield.value);
    prev.turns = shield.turns;
    prev.name = shield.name;
    prev.faction = shield.faction;
  }
  syncShield(unit);
}

function absorbShield(unit: CombatUnit, amount: number): number {
  const shields = shieldsOf(unit).sort((a, b) => {
    if (a.turns == null && b.turns == null) return 0;
    if (a.turns == null) return 1;
    if (b.turns == null) return -1;
    return a.turns - b.turns;
  });
  let left = amount;
  let taken = 0;
  for (const shield of shields) {
    if (left <= 0) break;
    const bite = Math.min(shield.value, left);
    shield.value -= bite;
    left -= bite;
    taken += bite;
  }
  unit.shields = shields.filter((s) => s.value > 0);
  syncShield(unit);
  return taken;
}

function syncShield(unit: CombatUnit): void {
  unit.shield = (unit.shields ?? []).reduce((sum, shield) => sum + shield.value, 0);
}

function clearGuardOf(battle: Battle, guardianId: string): void {
  for (const unit of battle.units) {
    if (unit.guardedBy?.guardianId === guardianId) unit.guardedBy = null;
  }
}

function pushFx(battle: Battle, fx: Omit<FxEvent, "id">): void {
  battle.seq += 1;
  battle.fx = [...battle.fx, { ...fx, id: `fx${battle.seq}` }].slice(-12);
}

function pushLog(battle: Battle, text: string, tone: LogLine["tone"]): void {
  battle.seq += 1;
  battle.log = [...battle.log, { id: `log${battle.seq}`, text, tone }].slice(-40);
}
