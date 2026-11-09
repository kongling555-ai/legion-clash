import { CATALOG, FALLEN, GOD_LABEL, RELICS, SQUAD } from "./catalog.ts";
import type {
  Battle,
  BattleSummary,
  Faction,
  Gear,
  God,
  Gods,
  Rarity,
  Rng,
  Roster,
  SavedUnit,
  SummaryLine,
} from "./types.ts";

export function emptyGods(): Gods {
  return { khorne: 0, tzeentch: 0, nurgle: 0, slaanesh: 0 };
}

export function godSum(g: Gods): number {
  return g.khorne + g.tzeentch + g.nurgle + g.slaanesh;
}

export function dominantGods(g: Gods): God[] {
  const keys: God[] = ["khorne", "tzeentch", "nurgle", "slaanesh"];
  const max = Math.max(...keys.map((k) => g[k]));
  if (max <= 0) return [];
  return keys.filter((k) => g[k] === max);
}

export function corruptionStage(value: number, faction: Faction, fallen: boolean): string {
  if (fallen || faction === "chaos") {
    if (value >= 100) return "混沌升华";
    if (value >= 80) return "堕落预警";
    if (value >= 60) return "严重腐化";
    if (value >= 40) return "亚空间侵蚀";
    if (value >= 20) return "混沌低语";
    return "未觉醒";
  }
  if (value >= 100) return "忠诚试炼";
  if (value >= 80) return "堕落预警";
  if (value >= 60) return "严重腐化";
  if (value >= 40) return "亚空间侵蚀";
  if (value >= 20) return "混沌低语";
  return "纯净";
}

export function xpToNext(level: number): number {
  if (level >= 20) return 0;
  return 80 + level * 40;
}

export function grantXp(unit: SavedUnit, amount: number): number {
  if (amount <= 0 || unit.level >= 20) return 0;
  let levels = 0;
  unit.xp += amount;
  while (unit.level < 20 && unit.xp >= xpToNext(unit.level)) {
    unit.xp -= xpToNext(unit.level);
    unit.level += 1;
    unit.freePoints += 1;
    levels += 1;
  }
  if (unit.level >= 20) unit.xp = 0;
  syncMilestones(unit);
  return levels;
}

function syncMilestones(unit: SavedUnit): void {
  if (unit.level >= 5) unit.milestones.s5 = true;
  if (unit.level >= 10) unit.milestones.s10 = true;
  if (unit.level >= 15) unit.milestones.s15 = true;
  if (unit.level >= 20) unit.milestones.s20 = true;
}

export function deriveStats(saved: SavedUnit): { hp: number; atk: number; def: number; spd: number; wp: number } {
  const def = CATALOG[saved.defId];
  if (!def) return { hp: 1, atk: 1, def: 0, spd: 1, wp: 0 };
  const steps = Math.max(0, saved.level - 1);
  let hp = def.base.hp + steps * 8 + saved.bonusHp + (saved.gear?.hp ?? 0);
  let atk = def.base.atk + steps * 2 + saved.bonusAtk + (saved.gear?.atk ?? 0);
  let defn = def.base.def + steps + saved.bonusDef + (saved.gear?.def ?? 0);
  if (saved.milestones.s10) {
    hp += 12;
    atk += 3;
  }
  if (saved.milestones.s20) {
    hp += Math.round(def.base.hp * 0.1);
    atk += Math.round(def.base.atk * 0.1);
    defn += Math.round(def.base.def * 0.1);
  }
  if (saved.ascended) {
    hp += 20;
    atk += 8;
    defn += 4;
  }
  return { hp, atk, def: defn, spd: def.base.spd, wp: def.base.wp };
}

export function makeSaved(defId: string, instanceId = defId): SavedUnit {
  const def = CATALOG[defId];
  return {
    instanceId,
    defId,
    name: def.name,
    role: def.role,
    rarity: def.rarity,
    faction: def.faction,
    greyKnight: Boolean(def.greyKnight),
    fallen: false,
    ascended: false,
    fallenGod: null,
    level: 1,
    xp: 0,
    freePoints: 0,
    bonusHp: 0,
    bonusAtk: 0,
    bonusDef: 0,
    corruption: 0,
    gods: emptyGods(),
    crisisPending: false,
    gear: null,
    milestones: { s5: false, s10: false, s15: false, s20: false },
  };
}

export function freshRoster(): Roster {
  return {
    imperial: SQUAD.imperial.map((id) => makeSaved(id)),
    chaos: SQUAD.chaos.map((id) => makeSaved(id)),
    imperialRes: [],
    chaosRes: [],
  };
}

export function botSquad(level: number): SavedUnit[] {
  return SQUAD.chaos.map((id) => {
    const unit = makeSaved(id, `bot:${id}`);
    unit.level = Math.min(20, Math.max(1, level));
    syncMilestones(unit);
    return unit;
  });
}

export function assignPoint(unit: SavedUnit, stat: "hp" | "atk" | "def"): string | null {
  if (unit.freePoints <= 0) return "没有可用属性点";
  unit.freePoints -= 1;
  if (stat === "hp") unit.bonusHp += 8;
  else if (stat === "atk") unit.bonusAtk += 2;
  else unit.bonusDef += 1;
  return null;
}

export function swapIntoField(
  roster: Roster,
  faction: Faction,
  reserveId: string,
  fieldId: string,
): string | null {
  const field = faction === "imperial" ? roster.imperial : roster.chaos;
  const reserve = faction === "imperial" ? roster.imperialRes : roster.chaosRes;
  const fi = field.findIndex((u) => u.instanceId === fieldId);
  const ri = reserve.findIndex((u) => u.instanceId === reserveId);
  if (fi < 0 || ri < 0) return "找不到要对调的角色";
  const a = field[fi];
  const b = reserve[ri];
  field[fi] = b;
  reserve[ri] = a;
  return null;
}

export interface AbsorbRow {
  instanceId: string;
  name: string;
  xp: number;
  loot: Gods;
  greyKnight: boolean;
}

export function listAbsorb(battle: Battle): AbsorbRow[] {
  return battle.units
    .filter(
      (u) =>
        u.owner === "imperial" && !u.fallen && !u.greyKnight && godSum(u.loot) > 0,
    )
    .map((u) => ({
      instanceId: u.instanceId,
      name: u.name,
      xp: u.pendingXp + (u.alive ? 12 : 0),
      loot: u.loot,
      greyKnight: false,
    }));
}

function findUnit(roster: Roster, id: string): { list: SavedUnit[]; index: number } | null {
  const lists = [roster.imperial, roster.chaos, roster.imperialRes, roster.chaosRes];
  for (const list of lists) {
    const index = list.findIndex((u) => u.instanceId === id);
    if (index >= 0) return { list, index };
  }
  return null;
}

function fallSaved(saved: SavedUnit, rng: Rng): void {
  const tops = dominantGods(saved.gods);
  const pool: God[] = tops.length ? tops : ["khorne", "tzeentch", "nurgle", "slaanesh"];
  const god = pool[rng.int(pool.length)] ?? "tzeentch";
  const kit = FALLEN[god];
  saved.fallen = true;
  saved.fallenGod = god;
  saved.faction = "chaos";
  saved.name = kit.name;
  saved.role = kit.role;
  saved.greyKnight = false;
  saved.corruption = 100;
  saved.crisisPending = false;
  const relic = RELICS.find((r) => r.forFaction === "chaos" && r.god === god);
  if (relic) saved.gear = { id: relic.id, name: relic.name, hp: relic.hp, atk: relic.atk, def: relic.def };
}

function moveFallen(roster: Roster, saved: SavedUnit, rng: Rng): void {
  const idx = roster.imperial.findIndex((u) => u.instanceId === saved.instanceId);
  if (idx < 0) return;
  roster.imperial.splice(idx, 1);
  const recruit = makeSaved(saved.defId, `${saved.defId}-n${rng.int(1_000_000)}`);
  roster.imperial.splice(idx, 0, recruit);
  if (roster.chaos.length < 5) {
    roster.chaos.push(saved);
    return;
  }
  let worst = 0;
  for (let i = 1; i < roster.chaos.length; i += 1) {
    if (roster.chaos[i].level < roster.chaos[worst].level) worst = i;
  }
  roster.chaosRes.push(roster.chaos[worst]);
  roster.chaos[worst] = saved;
}

function gearFor(saved: SavedUnit, rng: Rng): Gear | null {
  const faction = saved.fallen || saved.faction === "chaos" ? "chaos" : "imperial";
  let pool = RELICS.filter((r) => r.forFaction === faction);
  if (saved.fallenGod) {
    const themed = pool.filter((r) => r.god === saved.fallenGod);
    if (themed.length) pool = themed;
  }
  if (!pool.length) return null;
  const relic = pool[rng.int(pool.length)];
  return { id: relic.id, name: relic.name, hp: relic.hp, atk: relic.atk, def: relic.def };
}

export function applyPlayerRewards(
  battle: Battle,
  rosterIn: Roster,
  owner: Faction,
  decisions: Record<string, "purify" | "absorb">,
  rng: Rng,
): { roster: Roster; lines: SummaryLine[]; gear: string | null } {
  const roster = structuredClone(rosterIn);
  const lines: SummaryLine[] = [];
  let gear: string | null = null;

  for (const unit of battle.units.filter((u) => u.owner === owner)) {
    const slot = findUnit(roster, unit.instanceId);
    if (!slot) continue;
    const saved = slot.list[slot.index];
    if (saved.fallen && !unit.fallen) continue;
    const before = saved.corruption;
    saved.corruption = unit.corruption;
    saved.gods = { ...unit.gods };
    saved.crisisPending = unit.crisisPending;
    saved.ascended = unit.ascended || saved.ascended;
    saved.fallen = unit.fallen;
    saved.fallenGod = unit.fallenGod;
    saved.name = unit.name;
    saved.role = unit.role;
    saved.greyKnight = unit.greyKnight;
    saved.faction = unit.fallen ? "chaos" : unit.faction === "chaos" && unit.owner === "chaos" ? "chaos" : saved.faction;
    if (unit.gear) saved.gear = unit.gear;

    let note = "";
    const choice = decisions[unit.instanceId] ?? "purify";
    if (
      owner === "imperial" &&
      !saved.fallen &&
      !saved.greyKnight &&
      choice === "absorb" &&
      godSum(unit.loot) > 0
    ) {
      (Object.keys(unit.loot) as God[]).forEach((god) => {
        saved.gods[god] += unit.loot[god];
      });
      const gain = Math.min(18, 8 + Math.floor(godSum(unit.loot) / 5));
      saved.corruption = Math.min(100, saved.corruption + gain);
      note = "吸收混沌";
    } else if (saved.greyKnight && godSum(unit.loot) + unit.pendingXp > 0) {
      note = "灰骑士已净化战利品";
    } else if (godSum(unit.loot) > 0) {
      note = "已净化";
    }

    const xp = unit.pendingXp + (unit.alive ? 12 : 0);
    const levels = grantXp(saved, xp);

    if (!saved.fallen && saved.faction === "imperial" && saved.corruption >= 100) {
      const odds = saved.greyKnight ? 0.9 : 0.5;
      if (rng.next() < odds) {
        saved.corruption = 40;
        note = "忠诚试炼通过";
      } else {
        fallSaved(saved, rng);
        note = topsNote(saved, "忠诚试炼失败，永久堕落");
        moveFallen(roster, saved, rng);
      }
    } else if (saved.fallen && slot.list === roster.imperial) {
      moveFallen(roster, saved, rng);
      if (!note) note = "已堕入混沌";
    }

    if ((saved.fallen || saved.faction === "chaos") && saved.corruption >= 100 && !saved.ascended) {
      saved.ascended = true;
      if (!note) note = "混沌升华";
    }

    lines.push({
      instanceId: unit.instanceId,
      name: saved.fallen ? saved.name : unit.name,
      xp,
      levels,
      corruption: saved.corruption - before,
      note,
    });
  }

  if (battle.winner === owner) {
    const living = battle.units.filter((u) => u.owner === owner && u.alive && !u.fled);
    if (living.length) {
      const pick = living[rng.int(living.length)];
      const slot = findUnit(roster, pick.instanceId);
      if (slot && !slot.list[slot.index].gear) {
        const relic = gearFor(slot.list[slot.index], rng);
        if (relic) {
          slot.list[slot.index].gear = relic;
          gear = `${slot.list[slot.index].name} 获得 ${relic.name}`;
        }
      }
    }
  }

  return { roster, lines, gear };
}

function topsNote(saved: SavedUnit, prefix: string): string {
  const god = saved.fallenGod ? GOD_LABEL[saved.fallenGod] : "";
  return god ? `${prefix} · 归属${god}` : prefix;
}

export function buildSummary(winner: Faction | null, lines: SummaryLine[], gear: string | null): BattleSummary {
  const title =
    winner === "imperial" ? "帝国守住了遗迹" : winner === "chaos" ? "混沌吞没了普罗斯佩罗" : "双方同归于尽";
  return { winner, title, lines, gear };
}

export function rarityLabel(rarity: Rarity): string {
  if (rarity === "legendary") return "传奇";
  if (rarity === "epic") return "史诗";
  return "稀有";
}
