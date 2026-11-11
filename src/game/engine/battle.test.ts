import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { applyCommand, cooldownLeft, createBattle, rawDamage } from "./battle.ts";
import { applyPlayerRewards, botSquad, freshRoster, grantXp, makeSaved, placeTanks, tankScore, xpToNext } from "./progress.ts";
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

function endPhase(battle: Battle): Battle {
  const step = applyCommand(battle, { kind: "end" }, rngOf([0.99]));
  if (step.error) throw new Error(step.error);
  return step.battle;
}

function line(ids: string[], prefix: string) {
  return ids.map((id, index) => makeSaved(id, `${prefix}-${index}`));
}

describe("new squad rules", () => {
  it("keeps a cooldown of 2 locked for the next two own phases", () => {
    let battle = createBattle(
      line(["imp-sniper", "sw-hunter", "if-gunner", "ba-medicae", "gk-purifier"], "i"),
      line(["dg-plague", "chs-sprayer", "ts-sorc", "ts-rubric", "tz-summoner"], "c"),
      rngOf([0.99]),
    );
    const sniper = "i-0";
    const plague = "c-0";
    let step = applyCommand(
      battle,
      { kind: "skill", actorId: sniper, skillId: "precise-shot", targetId: plague },
      rngOf([0.99]),
    );
    assert.equal(step.error, null);
    assert.equal(cooldownLeft(step.battle.units.find((u) => u.instanceId === sniper)!, "precise-shot"), 2);
    battle = endPhase(step.battle);
    battle = endPhase(battle);
    step = applyCommand(battle, { kind: "skill", actorId: sniper, skillId: "precise-shot", targetId: plague }, rngOf([0.99]));
    assert.equal(step.error, "技能冷却中");
    battle = endPhase(battle);
    battle = endPhase(battle);
    step = applyCommand(battle, { kind: "skill", actorId: sniper, skillId: "precise-shot", targetId: plague }, rngOf([0.99]));
    assert.equal(step.error, "技能冷却中");
    battle = endPhase(battle);
    battle = endPhase(battle);
    step = applyCommand(battle, { kind: "skill", actorId: sniper, skillId: "precise-shot", targetId: plague }, rngOf([0.99]));
    assert.equal(step.error, null);
  });

  it("lets ranged fire past a living front line and still blocks melee", () => {
    const battle = createBattle(
      line(["imp-sniper", "sw-hunter", "if-gunner", "ba-medicae", "gk-purifier"], "i"),
      line(["dg-plague", "chs-sprayer", "ts-sorc", "ts-rubric", "tz-summoner"], "c"),
      rngOf([0.99]),
    );
    const back = battle.units.find((u) => u.instanceId === "c-4")!;
    assert.ok(back.position >= 2);
    const shot = applyCommand(battle, { kind: "attack", actorId: "i-0", targetId: "c-4" }, rngOf([0.99]));
    assert.equal(shot.error, null);
    const wolf = applyCommand(battle, { kind: "attack", actorId: "i-1", targetId: "c-4" }, rngOf([0.99]));
    assert.equal(wolf.error, "前排未破，无法直击后排");
  });

  it("splits guarded damage after defence and does not chain", () => {
    let battle = createBattle(
      line(["imp-bulwark", "ba-medicae", "gk-justicar", "sw-hunter", "if-gunner"], "i"),
      line(["dg-plague", "chs-sprayer", "ts-sorc", "ts-rubric", "tz-summoner"], "c"),
      rngOf([0.99]),
    );
    const ward = battle.units.find((u) => u.instanceId === "i-1")!;
    const guard = battle.units.find((u) => u.instanceId === "i-0")!;
    ward.def = 20;
    const pledged = applyCommand(
      battle,
      { kind: "skill", actorId: guard.instanceId, skillId: "guard-oath", targetId: ward.instanceId },
      rngOf([0.99]),
    );
    assert.equal(pledged.error, null);
    battle = endPhase(pledged.battle);
    const enemy = battle.units.find((u) => u.instanceId === "c-0")!;
    enemy.atk = 40;
    enemy.statuses = [];
    const beforeWard = battle.units.find((u) => u.instanceId === ward.instanceId)!.hp;
    const beforeGuard = battle.units.find((u) => u.instanceId === guard.instanceId)!.hp;
    const hit = applyCommand(battle, { kind: "attack", actorId: enemy.instanceId, targetId: ward.instanceId }, rngOf([0.99]));
    assert.equal(hit.error, null);
    const afterWard = hit.battle.units.find((u) => u.instanceId === ward.instanceId)!;
    const afterGuard = hit.battle.units.find((u) => u.instanceId === guard.instanceId)!;
    assert.equal(beforeWard - afterWard.hp, 18);
    assert.equal(beforeGuard - afterGuard.hp, 12);
    const self = applyCommand(
      pledged.battle,
      { kind: "skill", actorId: "i-2", skillId: "guard-oath", targetId: "i-2" },
      rngOf([0.99]),
    );
    assert.equal(self.error === "不能选择自己" || self.error === "技能不可用" || self.error === "该角色本阶段已经行动", true);
  });

  it("does not chain guard when both units protect each other", () => {
    let battle = createBattle(
      [makeSaved("imp-bulwark", "ga"), makeSaved("imp-bulwark", "gb"), ...line(["gk-justicar", "sw-hunter", "if-gunner"], "i")],
      line(["dg-plague", "chs-sprayer", "ts-sorc", "ts-rubric", "tz-summoner"], "c"),
      rngOf([0.99]),
    );
    let step = applyCommand(battle, { kind: "skill", actorId: "ga", skillId: "guard-oath", targetId: "gb" }, rngOf([0.99]));
    assert.equal(step.error, null);
    battle = step.battle;
    const gb = battle.units.find((u) => u.instanceId === "gb")!;
    gb.acted = false;
    gb.cds = {};
    step = applyCommand(battle, { kind: "skill", actorId: "gb", skillId: "guard-oath", targetId: "ga" }, rngOf([0.99]));
    assert.equal(step.error, null);
    battle = endPhase(step.battle);
    const enemy = battle.units.find((u) => u.instanceId === "c-0")!;
    enemy.atk = 50;
    enemy.statuses = [];
    for (const id of ["ga", "gb"]) {
      const body = battle.units.find((u) => u.instanceId === id)!;
      body.def = 0;
      body.hp = 400;
      body.maxHp = 1000;
      body.shield = 0;
      body.shields = [];
    }
    const beforeA = battle.units.find((u) => u.instanceId === "ga")!.hp;
    const beforeB = battle.units.find((u) => u.instanceId === "gb")!.hp;
    const hit = applyCommand(battle, { kind: "attack", actorId: "c-0", targetId: "gb" }, rngOf([0.99]));
    const a = hit.battle.units.find((u) => u.instanceId === "ga")!;
    const b = hit.battle.units.find((u) => u.instanceId === "gb")!;
    assert.equal(beforeB - b.hp, 30);
    assert.equal(beforeA - a.hp, 20);
  });

  it("stacks different shields, refreshes the same one, and spends shield before health", () => {
    let battle = createBattle(
      line(["imp-armorer", "sw-hunter", "if-gunner", "ba-medicae", "gk-purifier"], "i"),
      line(["dg-plague", "chs-sprayer", "ts-sorc", "ts-rubric", "tz-summoner"], "c"),
      rngOf([0.99]),
    );
    const cast = applyCommand(
      battle,
      { kind: "skill", actorId: "i-0", skillId: "field-screen", targetId: "i-0" },
      rngOf([0.99]),
    );
    assert.equal(cast.error, null);
    let armorer = cast.battle.units.find((u) => u.instanceId === "i-0")!;
    assert.equal(armorer.shield, 35);
    armorer.acted = false;
    armorer.cds = {};
    battle = cast.battle;
    const again = applyCommand(battle, { kind: "skill", actorId: "i-0", skillId: "field-screen", targetId: "i-0" }, rngOf([0.99]));
    armorer = again.battle.units.find((u) => u.instanceId === "i-0")!;
    assert.equal(armorer.shield, 35);
    battle = endPhase(again.battle);
    const enemy = battle.units.find((u) => u.instanceId === "c-0")!;
    enemy.atk = 80;
    enemy.statuses = [];
    armorer = battle.units.find((u) => u.instanceId === "i-0")!;
    armorer.def = 0;
    const hp = armorer.hp;
    const hit = applyCommand(battle, { kind: "attack", actorId: "c-0", targetId: "i-0" }, rngOf([0.99]));
    const after = hit.battle.units.find((u) => u.instanceId === "i-0")!;
    assert.equal(after.hp, hp - (80 - 35));
    assert.equal(after.shield, 0);
  });

  it("refreshes the same poison and ticks it at the end of the victim phase, ignoring defence", () => {
    let battle = createBattle(
      line(["if-gunner", "sw-hunter", "gk-justicar", "ba-medicae", "gk-purifier"], "i"),
      line(["chs-sprayer", "dg-plague", "ts-sorc", "ts-rubric", "tz-summoner"], "c"),
      rngOf([0.99]),
    );
    battle = endPhase(battle);
    const gunner = battle.units.find((u) => u.instanceId === "i-0")!;
    gunner.def = 80;
    gunner.shield = 0;
    gunner.shields = [];
    let step = applyCommand(battle, { kind: "skill", actorId: "c-0", skillId: "plague-spray", targetId: "i-0" }, rngOf([0.99]));
    assert.equal(step.error, null);
    let victim = step.battle.units.find((u) => u.instanceId === "i-0")!;
    const poisons = victim.statuses.filter((s) => s.key === "plague-spray");
    assert.equal(poisons.length, 1);
    assert.equal(poisons[0]?.turns, 2);
    victim.acted = false;
    const sprayer = step.battle.units.find((u) => u.instanceId === "c-0")!;
    sprayer.acted = false;
    sprayer.cds = {};
    sprayer.cdHold = {};
    step = applyCommand(step.battle, { kind: "skill", actorId: "c-0", skillId: "plague-spray", targetId: "i-0" }, rngOf([0.99]));
    victim = step.battle.units.find((u) => u.instanceId === "i-0")!;
    assert.equal(victim.statuses.filter((s) => s.key === "plague-spray").length, 1);
    const hp = victim.hp;
    battle = endPhase(step.battle);
    victim = battle.units.find((u) => u.instanceId === "i-0")!;
    assert.equal(victim.hp, hp);
    battle = endPhase(battle);
    victim = battle.units.find((u) => u.instanceId === "i-0")!;
    assert.equal(hp - victim.hp, 6);
  });

  it("lowers poison damage on the sprayer and drops blood-rage after a heal", () => {
    let battle = createBattle(
      line(["ba-medicae", "sw-hunter", "if-gunner", "gk-justicar", "gk-purifier"], "i"),
      line(["chs-sprayer", "chs-berserk", "bl-term", "ts-sorc", "ts-rubric"], "c"),
      rngOf([0.99]),
    );
    battle = endPhase(battle);
    const sprayer = battle.units.find((u) => u.instanceId === "c-0")!;
    sprayer.statuses = [{ id: "poison", key: "test", value: 8, turns: 1, sourceId: "c-0", tick: "end" }];
    const hp = sprayer.hp;
    battle = endPhase(battle);
    const after = battle.units.find((u) => u.instanceId === "c-0")!;
    assert.equal(hp - after.hp, 6);

    battle = createBattle(
      line(["if-gunner", "sw-hunter", "gk-justicar", "ba-medicae", "gk-purifier"], "i"),
      line(["chs-berserk", "dg-plague", "ts-sorc", "ts-rubric", "tz-summoner"], "c"),
      rngOf([0.99]),
    );
    battle = endPhase(battle);
    const ber = battle.units.find((u) => u.instanceId === "c-0")!;
    const dummy = battle.units.find((u) => u.instanceId === "i-0")!;
    dummy.def = 0;
    dummy.shields = [];
    dummy.shield = 0;
    ber.hp = ber.maxHp;
    let hit = applyCommand(battle, { kind: "attack", actorId: "c-0", targetId: "i-0" }, rngOf([0.99]));
    assert.equal(dummy.hp - hit.battle.units.find((u) => u.instanceId === "i-0")!.hp, 36);
    battle = createBattle(
      line(["if-gunner", "sw-hunter", "gk-justicar", "ba-medicae", "gk-purifier"], "i"),
      line(["chs-berserk", "dg-plague", "ts-sorc", "ts-rubric", "tz-summoner"], "c"),
      rngOf([0.99]),
    );
    battle = endPhase(battle);
    const low = battle.units.find((u) => u.instanceId === "c-0")!;
    const target = battle.units.find((u) => u.instanceId === "i-0")!;
    target.def = 0;
    target.shield = 0;
    target.shields = [];
    low.hp = 31;
    hit = applyCommand(battle, { kind: "attack", actorId: "c-0", targetId: "i-0" }, rngOf([0.99]));
    assert.equal(target.hp - hit.battle.units.find((u) => u.instanceId === "i-0")!.hp, 46);
    const healed = hit.battle.units.find((u) => u.instanceId === "c-0")!;
    healed.hp = healed.maxHp;
    healed.acted = false;
    const again = applyCommand(hit.battle, { kind: "attack", actorId: "c-0", targetId: "i-1" }, rngOf([0.99]));
    const second = again.battle.units.find((u) => u.instanceId === "i-1")!;
    const start = hit.battle.units.find((u) => u.instanceId === "i-1")!;
    assert.ok(start.hp - second.hp < 46);
  });

  it("suppresses direct damage, restores 5 warp, and refuses a cast without warp", () => {
    let battle = createBattle(
      line(["if-gunner", "sw-hunter", "gk-justicar", "ba-medicae", "gk-purifier"], "i"),
      line(["chs-jammer", "dg-plague", "bl-term", "ts-sorc", "ts-rubric"], "c"),
      rngOf([0.99]),
    );
    battle = endPhase(battle);
    const jammer = battle.units.find((u) => u.instanceId === "c-0")!;
    assert.equal(jammer.wp, 100);
    const cast = applyCommand(
      battle,
      { kind: "skill", actorId: "c-0", skillId: "warp-suppress", targetId: "i-0" },
      rngOf([0.99]),
    );
    assert.equal(cast.error, null);
    assert.equal(cast.battle.units.find((u) => u.instanceId === "c-0")!.wp, 75);
    const broke = applyCommand(
      { ...cast.battle, units: cast.battle.units.map((u) => (u.instanceId === "c-0" ? { ...u, wp: 10, acted: false, cds: {}, cdHold: {} } : u)) },
      { kind: "skill", actorId: "c-0", skillId: "warp-suppress", targetId: "i-0" },
      rngOf([0.99]),
    );
    assert.equal(broke.error, "灵能不足");
    battle = endPhase(cast.battle);
    const gunner = battle.units.find((u) => u.instanceId === "i-0")!;
    const victim = battle.units.find((u) => u.instanceId === "c-0")!;
    const hp = victim.hp;
    const hit = applyCommand(battle, { kind: "attack", actorId: gunner.instanceId, targetId: victim.instanceId }, rngOf([0.99]));
    const left = hit.battle.units.find((u) => u.instanceId === victim.instanceId)!.hp;
    assert.equal(hp - left, 19);
    battle = endPhase(hit.battle);
    const later = battle.units.find((u) => u.instanceId === "c-0")!;
    assert.equal(later.wp, 80);
  });

  it("refuses a heal on a dead ally and ignores defence on the sniper's first hit only", () => {
    const battle = createBattle(
      line(["ba-medicae", "sw-hunter", "if-gunner", "gk-justicar", "gk-purifier"], "i"),
      line(["dg-plague", "chs-sprayer", "ts-sorc", "ts-rubric", "tz-summoner"], "c"),
      rngOf([0.99]),
    );
    const wolf = battle.units.find((u) => u.instanceId === "i-1")!;
    wolf.alive = false;
    wolf.hp = 0;
    const heal = applyCommand(
      battle,
      { kind: "skill", actorId: "i-0", skillId: "redeem-blood", targetId: "i-1" },
      rngOf([0.99]),
    );
    assert.equal(heal.error, "已阵亡，不能选为目标");

    let snipers = createBattle(
      line(["imp-sniper", "sw-hunter", "if-gunner", "ba-medicae", "gk-purifier"], "i"),
      line(["dg-plague", "chs-sprayer", "ts-sorc", "ts-rubric", "tz-summoner"], "c"),
      rngOf([0.99]),
    );
    const target = snipers.units.find((u) => u.instanceId === "c-0")!;
    target.def = 35;
    target.shield = 0;
    target.shields = [];
    const first = applyCommand(snipers, { kind: "attack", actorId: "i-0", targetId: "c-0" }, rngOf([0.99]));
    assert.equal(target.hp - first.battle.units.find((u) => u.instanceId === "c-0")!.hp, 20);
    snipers = endPhase(first.battle);
    snipers = endPhase(snipers);
    const secondTarget = snipers.units.find((u) => u.instanceId === "c-0")!;
    const before = secondTarget.hp;
    const second = applyCommand(snipers, { kind: "attack", actorId: "i-0", targetId: "c-0" }, rngOf([0.99]));
    assert.equal(before - second.battle.units.find((u) => u.instanceId === "c-0")!.hp, 17);
  });

  it("keeps a dead fighter's earned experience and withholds the survival bonus", () => {
    const roster = freshRoster();
    const battle = createBattle(roster.imperial, roster.chaos, rngOf([]));
    const plague = battle.units.find((u) => u.defId === "dg-plague");
    if (!plague) throw new Error("plague");
    plague.pendingXp = 15;
    plague.alive = false;
    plague.hp = 0;
    const result = applyPlayerRewards(battle, roster, "chaos", {}, rngOf([0.2]));
    const saved = result.roster.chaos.find((u) => u.instanceId === plague.instanceId);
    assert.equal(saved?.xp, 15);
    assert.equal(result.lines.find((line) => line.instanceId === plague.instanceId)?.xp, 15);
  });
});

describe("promoted cards", () => {
  it("orders the next hit, then drops the bonus, and buffs the back line", () => {
    const battle = createBattle(
      line(["imp-commander", "ba-medicae", "sw-hunter", "if-gunner", "gk-purifier"], "i"),
      line(["dg-plague", "ts-rubric", "ts-sorc", "tz-summoner", "chs-sprayer"], "c"),
      rngOf([0.99]),
    );
    const ordered = applyCommand(battle, { kind: "skill", actorId: "i-0", skillId: "battle-order", targetId: "i-2" }, rngOf([0.99]));
    assert.equal(ordered.error, null);
    const wolf = ordered.battle.units.find((u) => u.instanceId === "i-2")!;
    assert.equal(wolf.statuses.some((s) => s.id === "nextHit" && s.value === 12), true);
    const hit = applyCommand(ordered.battle, { kind: "attack", actorId: "i-2", targetId: "c-0" }, rngOf([0.99]));
    assert.equal(hit.error, null);
    const plague = hit.battle.units.find((u) => u.instanceId === "c-0")!;
    assert.equal(160 - plague.hp, rawDamage(35 + 2 + 12, 0, 35));
    assert.equal(hit.battle.units.find((u) => u.instanceId === "i-2")!.statuses.some((s) => s.id === "nextHit"), false);
  });

  it("lets the order expire at the end of the next allied phase", () => {
    let battle = createBattle(
      line(["imp-commander", "ba-medicae", "sw-hunter", "if-gunner", "gk-purifier"], "i"),
      line(["dg-plague", "ts-rubric", "ts-sorc", "tz-summoner", "chs-sprayer"], "c"),
      rngOf([0.99]),
    );
    const ordered = applyCommand(battle, { kind: "skill", actorId: "i-0", skillId: "battle-order", targetId: "i-2" }, rngOf([0.99]));
    battle = endPhase(ordered.battle);
    assert.equal(battle.units.find((u) => u.instanceId === "i-2")!.statuses.some((s) => s.id === "nextHit"), true);
    battle = endPhase(battle);
    battle = endPhase(battle);
    assert.equal(battle.units.find((u) => u.instanceId === "i-2")!.statuses.some((s) => s.id === "nextHit"), false);
  });

  it("lets the assault skill cross a living front line and adds front-line defence", () => {
    let battle = createBattle(
      line(["imp-assault", "ba-medicae", "sw-hunter", "if-gunner", "gk-purifier"], "i"),
      line(["dg-plague", "ts-rubric", "ts-sorc", "tz-summoner", "chs-sprayer"], "c"),
      rngOf([0.99]),
    );
    const basic = applyCommand(battle, { kind: "attack", actorId: "i-0", targetId: "c-2" }, rngOf([0.99]));
    assert.equal(basic.error, "前排未破，无法直击后排");
    const breach = applyCommand(battle, { kind: "skill", actorId: "i-0", skillId: "breach-rank", targetId: "c-2" }, rngOf([0.99]));
    assert.equal(breach.error, null);
    battle = endPhase(breach.battle);
    const before = battle.units.find((u) => u.instanceId === "i-0")!.hp;
    const punch = applyCommand(battle, { kind: "attack", actorId: "c-0", targetId: "i-0" }, rngOf([0.99]));
    const after = punch.battle.units.find((u) => u.instanceId === "i-0")!.hp;
    assert.equal(before - after, rawDamage(25, 0, 18 + 4));
  });

  it("pays life for a wounded ally and refuses a payment that would kill", () => {
    let battle = createBattle(
      line(["if-gunner", "sw-hunter", "gk-justicar", "ba-medicae", "gk-purifier"], "i"),
      line(["chs-transfer", "chs-sprayer", "ts-sorc", "ts-rubric", "tz-summoner"], "c"),
      rngOf([0.99]),
    );
    battle = endPhase(battle);
    const full = applyCommand(battle, { kind: "skill", actorId: "c-0", skillId: "blood-pact", targetId: "c-1" }, rngOf([0.99]));
    assert.equal(full.error, "目标生命已满");
    const self = applyCommand(battle, { kind: "skill", actorId: "c-0", skillId: "blood-pact", targetId: "c-0" }, rngOf([0.99]));
    assert.equal(self.error, "不能选择自己");
    const ally = battle.units.find((u) => u.instanceId === "c-1")!;
    ally.hp = 50;
    const broke = battle.units.find((u) => u.instanceId === "c-0")!;
    broke.hp = 14;
    const refused = applyCommand(battle, { kind: "skill", actorId: "c-0", skillId: "blood-pact", targetId: "c-1" }, rngOf([0.99]));
    assert.equal(refused.error, "生命不足以支付");
    assert.equal(refused.battle.units.find((u) => u.instanceId === "c-0")!.hp, 14);
    broke.hp = 130;
    const paid = applyCommand(battle, { kind: "skill", actorId: "c-0", skillId: "blood-pact", targetId: "c-1" }, rngOf([0.99]));
    assert.equal(paid.error, null);
    assert.equal(paid.battle.units.find((u) => u.instanceId === "c-0")!.hp, 116);
    assert.equal(paid.battle.units.find((u) => u.instanceId === "c-1")!.hp, 86);
  });

  it("strips a shield before the hit and hits softer when there is none", () => {
    let shielded = createBattle(
      line(["imp-sniper", "sw-hunter", "if-gunner", "ba-medicae", "gk-purifier"], "i"),
      line(["chs-breaker", "ts-rubric", "ts-sorc", "tz-summoner", "chs-sprayer"], "c"),
      rngOf([0.99]),
    );
    shielded = endPhase(shielded);
    const sniper = shielded.units.find((u) => u.instanceId === "i-0")!;
    sniper.shield = 50;
    sniper.shields = [{ key: "test", name: "护盾", value: 50, turns: null, faction: "imperial" }];
    const hit = applyCommand(shielded, { kind: "skill", actorId: "c-0", skillId: "sunder-shield", targetId: "i-0" }, rngOf([0.99]));
    const struck = hit.battle.units.find((u) => u.instanceId === "i-0")!;
    const blow = rawDamage(26, 0, 14, 0.15);
    assert.equal(struck.shield, 50 - 20 - blow);
    assert.equal(struck.hp, 90);

    let bare = createBattle(
      line(["imp-sniper", "sw-hunter", "if-gunner", "ba-medicae", "gk-purifier"], "i"),
      line(["chs-breaker", "ts-rubric", "ts-sorc", "tz-summoner", "chs-sprayer"], "c"),
      rngOf([0.99]),
    );
    bare = endPhase(bare);
    const soft = applyCommand(bare, { kind: "skill", actorId: "c-0", skillId: "sunder-shield", targetId: "i-0" }, rngOf([0.99]));
    const open = soft.battle.units.find((u) => u.instanceId === "i-0")!;
    assert.equal(90 - open.hp, rawDamage(Math.round(26 * 0.7), 0, 14));
  });

  it("puts the new cards in reserve and draws five different bot fighters", () => {
    const roster = freshRoster();
    assert.equal(roster.imperialRes.some((u) => u.defId === "imp-commander"), true);
    assert.equal(roster.imperialRes.some((u) => u.defId === "imp-assault"), true);
    assert.equal(roster.chaosRes.some((u) => u.defId === "chs-transfer"), true);
    assert.equal(roster.chaosRes.some((u) => u.defId === "chs-breaker"), true);
    const squad = botSquad(1, "chaos", rngOf([0.2, 0.8, 0.1, 0.9, 0.3, 0.7, 0.4, 0.6, 0.5, 0.15]));
    assert.equal(squad.length, 5);
    assert.equal(new Set(squad.map((u) => u.defId)).size, 5);
    assert.equal(squad.every((u) => u.faction === "chaos"), true);
    const scores = squad.map(tankScore);
    assert.ok(scores[0] >= scores[2] && scores[0] >= scores[3] && scores[0] >= scores[4]);
    assert.ok(scores[1] >= scores[2] && scores[1] >= scores[3] && scores[1] >= scores[4]);
    const imperial = freshRoster();
    assert.equal(imperial.imperial.length + imperial.imperialRes.length, 10);
    assert.equal(imperial.chaos.length + imperial.chaosRes.length, 10);
    const lined = placeTanks(imperial.imperial);
    assert.equal(lined[0].defId, "gk-justicar");
    assert.equal(lined[1].defId, "sw-hunter");
  });
});
