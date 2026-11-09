import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { applyCommand, createBattle, rawDamage } from "./battle.ts";
import { freshRoster, grantXp, applyPlayerRewards, xpToNext } from "./progress.ts";
import type { Battle, CombatUnit, Rng } from "./types.ts";

function rngOf(values: number[]): Rng {
  let i = 0;
  const next = () => {
    const value = values[i] ?? 0;
    i += 1;
    return value;
  };
  return {
    next,
    int(max: number) {
      return Math.min(max - 1, Math.floor(next() * max));
    },
    chance(p: number) {
      return next() < p;
    },
  };
}

function unit(battle: Battle, defId: string): CombatUnit {
  const found = battle.units.find((u) => u.defId === defId && !u.instanceId.startsWith("bot:"));
  if (!found) throw new Error(defId);
  return found;
}

describe("combat rules", () => {
  it("uses the published damage floor", () => {
    assert.equal(rawDamage(28, 0, 30), 13);
    assert.equal(rawDamage(10, 0, 100), 5);
  });

  it("blocks melee into a living backline and lets ranged through", () => {
    const roster = freshRoster();
    const battle = createBattle(roster.imperial, roster.chaos, rngOf([]));
    const wolf = unit(battle, "sw-hunter");
    const rubric = unit(battle, "ts-rubric");
    const gunner = unit(battle, "if-gunner");
    const blocked = applyCommand(
      battle,
      { kind: "attack", actorId: wolf.instanceId, targetId: rubric.instanceId },
      rngOf([]),
    );
    assert.equal(blocked.error, "前排未破，无法直击后排");
    const shot = applyCommand(
      battle,
      { kind: "attack", actorId: gunner.instanceId, targetId: rubric.instanceId },
      rngOf([0.99]),
    );
    assert.equal(shot.error, null);
    const hit = shot.battle.units.find((u) => u.instanceId === rubric.instanceId);
    assert.ok(hit && hit.hp < rubric.hp);
    assert.equal(shot.battle.units.find((u) => u.instanceId === wolf.instanceId)?.spd, wolf.spd);
  });

  it("applies grey knight bonus damage with the shared formula", () => {
    const roster = freshRoster();
    const battle = createBattle(roster.imperial, roster.chaos, rngOf([]));
    const knight = unit(battle, "gk-justicar");
    const plague = unit(battle, "dg-plague");
    const next = applyCommand(
      battle,
      { kind: "attack", actorId: knight.instanceId, targetId: plague.instanceId },
      rngOf([]),
    );
    assert.equal(next.error, null);
    const hp = next.battle.units.find((u) => u.instanceId === plague.instanceId)?.hp;
    assert.equal(hp, plague.hp - 13);
  });

  it("does not poison or corrupt a grey knight", () => {
    const roster = freshRoster();
    let battle = createBattle(roster.imperial, roster.chaos, rngOf([]));
    battle = applyCommand(battle, { kind: "end" }, rngOf([])).battle;
    const plague = unit(battle, "dg-plague");
    const knight = unit(battle, "gk-justicar");
    const next = applyCommand(
      battle,
      { kind: "skill", actorId: plague.instanceId, skillId: "plague-touch", targetId: knight.instanceId },
      rngOf([0.99]),
    );
    assert.equal(next.error, null);
    const after = next.battle.units.find((u) => u.instanceId === knight.instanceId);
    assert.equal(after?.corruption, 0);
    assert.equal(after?.statuses.some((s) => s.id === "poison"), false);
  });

  it("gives the killer the full pool when nobody assisted", () => {
    const roster = freshRoster();
    const battle = createBattle(roster.imperial, roster.chaos, rngOf([]));
    const knight = unit(battle, "gk-justicar");
    const plague = unit(battle, "dg-plague");
    plague.hp = 1;
    const next = applyCommand(
      battle,
      { kind: "attack", actorId: knight.instanceId, targetId: plague.instanceId },
      rngOf([]),
    );
    const killer = next.battle.units.find((u) => u.instanceId === knight.instanceId);
    assert.equal(next.battle.units.find((u) => u.instanceId === plague.instanceId)?.alive, false);
    assert.equal(killer?.pendingXp, 36 + plague.level * 6);
  });

  it("splits thirty percent of kill experience across assistants", () => {
    const roster = freshRoster();
    const battle = createBattle(roster.imperial, roster.chaos, rngOf([]));
    const knight = unit(battle, "gk-justicar");
    const wolf = unit(battle, "sw-hunter");
    const plague = unit(battle, "dg-plague");
    wolf.contribution = 20;
    plague.hp = 1;
    const next = applyCommand(
      battle,
      { kind: "attack", actorId: knight.instanceId, targetId: plague.instanceId },
      rngOf([]),
    );
    const pool = 36 + 6;
    const killer = next.battle.units.find((u) => u.instanceId === knight.instanceId);
    const ally = next.battle.units.find((u) => u.instanceId === wolf.instanceId);
    assert.equal(killer?.pendingXp, Math.round(pool * 0.7));
    assert.equal(ally?.pendingXp, pool - Math.round(pool * 0.7));
  });

  it("levels a unit and banks a free point", () => {
    const unitSaved = freshRoster().imperial[1];
    const levels = grantXp(unitSaved, xpToNext(1));
    assert.equal(levels, 1);
    assert.equal(unitSaved.level, 2);
    assert.equal(unitSaved.freePoints, 1);
    assert.equal(unitSaved.xp, 0);
  });

  it("refuses chaos loot for grey knights and flips a failed loyalty trial", () => {
    const roster = freshRoster();
    const battle = createBattle(roster.imperial, roster.chaos, rngOf([]));
    const knight = unit(battle, "gk-justicar");
    const wolf = unit(battle, "sw-hunter");
    knight.loot.khorne = 12;
    wolf.loot.khorne = 10;
    wolf.corruption = 95;
    const decided = applyPlayerRewards(
      battle,
      roster,
      "imperial",
      { [knight.instanceId]: "absorb", [wolf.instanceId]: "absorb" },
      rngOf([0.99, 0.2]),
    );
    const knightSaved = decided.roster.imperial.find((u) => u.defId === "gk-justicar" && u.greyKnight);
    assert.equal(knightSaved?.corruption, 0);
    assert.equal(knightSaved?.gods.khorne, 0);
    const fallen = [...decided.roster.chaos, ...decided.roster.chaosRes].find((u) => u.instanceId === wolf.instanceId);
    assert.equal(fallen?.fallen, true);
    assert.equal(fallen?.faction, "chaos");
    assert.equal(
      decided.roster.imperial.some((u) => u.instanceId === wolf.instanceId),
      false,
    );
    const again = applyPlayerRewards(battle, decided.roster, "imperial", {}, rngOf([0]));
    const still = [...again.roster.chaos, ...again.roster.chaosRes].find((u) => u.instanceId === wolf.instanceId);
    assert.equal(still?.fallen, true);
    assert.notEqual(still?.faction, "imperial");
  });

  it("opens a crisis and accepts purify", () => {
    const roster = freshRoster();
    const wolfSaved = roster.imperial.find((u) => u.defId === "sw-hunter");
    if (!wolfSaved) throw new Error("wolf");
    wolfSaved.corruption = 82;
    wolfSaved.crisisPending = true;
    const battle = createBattle(roster.imperial, roster.chaos, rngOf([]));
    assert.equal(battle.prompt?.type, "crisis");
    const wolf = unit(battle, "sw-hunter");
    const next = applyCommand(
      battle,
      { kind: "crisis", actorId: wolf.instanceId, choice: "purify" },
      rngOf([]),
    );
    const after = next.battle.units.find((u) => u.instanceId === wolf.instanceId);
    assert.equal(after?.corruption, 57);
    assert.equal(after?.crisisPending, false);
    assert.equal(next.battle.prompt, null);
  });

  it("declares an imperial victory when the chaos line is gone", () => {
    const roster = freshRoster();
    let battle = createBattle(roster.imperial, roster.chaos, rngOf([]));
    const order = ["gk-justicar", "sw-hunter", "if-gunner", "ba-medicae", "gk-purifier"];
    const enemies = ["dg-plague", "bl-term", "ts-sorc", "ts-rubric", "tz-summoner"];
    for (let i = 0; i < enemies.length; i += 1) {
      const enemy = unit(battle, enemies[i]);
      enemy.hp = 1;
      enemy.dustUsed = true;
      const actor = unit(battle, order[i]);
      const step = applyCommand(
        battle,
        { kind: "attack", actorId: actor.instanceId, targetId: enemy.instanceId },
        rngOf([0.99]),
      );
      assert.equal(step.error, null, step.error ?? enemies[i]);
      battle = step.battle;
    }
    assert.equal(battle.status, "absorb");
    assert.equal(battle.winner, "imperial");
  });
});
