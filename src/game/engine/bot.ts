import { legalTargetIds, skillsFor } from "./battle.ts";
import type { Battle, Command, CombatUnit } from "./types.ts";

function lowest(battle: Battle, ids: string[]): string | null {
  const units = ids
    .map((id) => battle.units.find((u) => u.instanceId === id))
    .filter((u): u is CombatUnit => Boolean(u));
  units.sort((a, b) => a.hp / a.maxHp - b.hp / b.maxHp);
  return units[0]?.instanceId ?? null;
}

export function chooseBot(battle: Battle): Command | null {
  if (battle.status !== "battle" || battle.prompt || battle.phase !== "chaos") return null;
  const mine = battle.units.filter((u) => u.alive && u.faction === "chaos" && !u.acted);
  if (!mine.length) return { kind: "end" };

  for (const caster of mine) {
    const skill = skillsFor(caster).find(
      (s) => s.kind !== "damage" && (caster.cds[s.id] ?? 0) === 0 && caster.wp >= s.wp,
    );
    if (!skill) continue;
    const allies = battle.units.filter((u) => u.alive && u.faction === "chaos" && u.hp < u.maxHp * 0.55);
    allies.sort((a, b) => a.hp - b.hp);
    if (allies[0]) {
      return { kind: "skill", actorId: caster.instanceId, skillId: skill.id, targetId: allies[0].instanceId };
    }
  }

  for (const unit of mine) {
    const skill = skillsFor(unit).find((s) => s.kind === "damage" && (unit.cds[s.id] ?? 0) === 0 && unit.wp >= s.wp);
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
