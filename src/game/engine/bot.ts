import { legalTargetIds, skillsFor } from "./battle.ts";
import type { Battle, Command, CombatUnit, SkillDef } from "./types.ts";

function lowest(battle: Battle, ids: string[]): string | null {
  const units = ids
    .map((id) => battle.units.find((u) => u.instanceId === id))
    .filter((u): u is CombatUnit => Boolean(u));
  units.sort((a, b) => a.hp / a.maxHp - b.hp / b.maxHp);
  return units[0]?.instanceId ?? null;
}

function highestAtk(battle: Battle, ids: string[]): string | null {
  const units = ids
    .map((id) => battle.units.find((u) => u.instanceId === id))
    .filter((u): u is CombatUnit => Boolean(u));
  units.sort((a, b) => b.atk - a.atk);
  return units[0]?.instanceId ?? null;
}

function ready(unit: CombatUnit, skill: SkillDef): boolean {
  if ((unit.cds[skill.id] ?? 0) > 0 || unit.wp < skill.wp) return false;
  const pact = skill.effects.find((effect) => effect.op === "lifePact");
  if (pact && pact.op === "lifePact" && unit.hp <= pact.cost) return false;
  return true;
}

export function chooseBot(battle: Battle): Command | null {
  if (battle.status !== "battle" || battle.prompt) return null;
  const side = battle.phase;
  const mine = battle.units.filter((u) => u.alive && u.faction === side && !u.acted);
  if (!mine.length) return { kind: "end" };

  for (const caster of mine) {
    const skill = skillsFor(caster).find((s) => s.kind === "heal" && ready(caster, s));
    if (!skill) continue;
    const target = lowest(
      battle,
      legalTargetIds(battle, caster.instanceId, { type: "skill", skillId: skill.id }),
    );
    const ally = battle.units.find((u) => u.instanceId === target);
    if (ally && ally.hp < ally.maxHp) {
      return { kind: "skill", actorId: caster.instanceId, skillId: skill.id, targetId: ally.instanceId };
    }
  }

  for (const caster of mine) {
    const skill = skillsFor(caster).find((s) => s.kind === "guard" && ready(caster, s));
    if (!skill) continue;
    const target = lowest(battle, legalTargetIds(battle, caster.instanceId, { type: "skill", skillId: skill.id }));
    if (target) return { kind: "skill", actorId: caster.instanceId, skillId: skill.id, targetId: target };
  }

  for (const caster of mine) {
    const skill = skillsFor(caster).find((s) => s.kind === "hex" && ready(caster, s));
    if (!skill) continue;
    const target = highestAtk(battle, legalTargetIds(battle, caster.instanceId, { type: "skill", skillId: skill.id }));
    if (target) return { kind: "skill", actorId: caster.instanceId, skillId: skill.id, targetId: target };
  }

  for (const caster of mine) {
    const skill = skillsFor(caster).find((s) => s.kind === "buff" && ready(caster, s));
    if (!skill) continue;
    const ids = legalTargetIds(battle, caster.instanceId, { type: "skill", skillId: skill.id }).filter((id) => {
      const ally = battle.units.find((u) => u.instanceId === id);
      return ally && !(ally.statuses ?? []).some((status) => status.id === "nextHit");
    });
    const target = highestAtk(battle, ids);
    if (target) return { kind: "skill", actorId: caster.instanceId, skillId: skill.id, targetId: target };
  }

  for (const unit of mine) {
    const skill = skillsFor(unit).find((s) => s.kind === "damage" && ready(unit, s));
    if (!skill) continue;
    const target = lowest(battle, legalTargetIds(battle, unit.instanceId, { type: "skill", skillId: skill.id }));
    if (target) return { kind: "skill", actorId: unit.instanceId, skillId: skill.id, targetId: target };
  }

  for (const unit of mine) {
    const target = lowest(battle, legalTargetIds(battle, unit.instanceId, { type: "attack" }));
    if (target) return { kind: "attack", actorId: unit.instanceId, targetId: target };
  }
  return { kind: "end" };
}