import { randomInt, timingSafeEqual } from "node:crypto";

import { getSql } from "@/lib/db";
import { chooseBot } from "@/game/engine/bot.ts";
import { applyCommand, createBattle } from "@/game/engine/battle.ts";
import { CATALOG, PLAYABLE, SQUAD } from "@/game/engine/catalog.ts";
import {
  applyPlayerRewards,
  assignPoint,
  botSquad,
  buildSummary,
  ensurePlayable,
  freshRoster,
  listAbsorb,
  makeSaved,
  swapIntoField,
} from "@/game/engine/progress.ts";
import type { AbsorbRow } from "@/game/engine/progress.ts";
import type { Battle, Command, Faction, Rng, Roster, SavedUnit } from "@/game/engine/types.ts";

const ALPHA = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const TOKEN = /^[a-f0-9]{32}$/;
const CODE = /^[A-Z0-9]{4}$/;

export interface RoomView {
  code: string;
  mode: "duel" | "skirmish";
  status: "lobby" | "battle" | "absorb" | "finished";
  you: Faction | null;
  version: number;
  opponent: boolean;
  battle: Battle | null;
  absorb: AbsorbRow[];
}

type ApiResult = { ok: true; view: RoomView } | { ok: false; error: string; view?: RoomView };

interface RoomState {
  battle: Battle | null;
  recent: string[];
  player?: Faction;
  slots?: string[];
}

interface RoomRow {
  code: string;
  mode: "duel" | "skirmish";
  host_token: string;
  guest_token: string | null;
  version: number;
  state: RoomState | string;
  updated_at: string;
}

const tails = new Map<string, Promise<unknown>>();
const lastHit = new Map<string, number>();

function lock<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const prev = tails.get(key) ?? Promise.resolve();
  const run = prev.then(fn, fn);
  tails.set(
    key,
    run.then(
      () => undefined,
      () => undefined,
    ),
  );
  return run;
}

function limited(token: string): boolean {
  const now = Date.now();
  if (now - (lastHit.get(token) ?? 0) < 160) return true;
  lastHit.set(token, now);
  return false;
}

function serverRng(): Rng {
  return {
    next: () => randomInt(0, 1_000_000) / 1_000_000,
    int: (max: number) => randomInt(0, Math.max(1, max)),
    chance: (p: number) => randomInt(0, 1_000_000) / 1_000_000 < p,
  };
}

function sameToken(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

function parseState(value: RoomState | string): RoomState {
  const state = typeof value === "string" ? (JSON.parse(value) as RoomState) : value;
  return {
    battle: state.battle ?? null,
    recent: state.recent ?? [],
    player: state.player,
    slots: state.slots,
  };
}

function parseRoster(value: unknown): Roster {
  const roster = typeof value === "string" ? (JSON.parse(value) as Roster) : (value as Roster);
  if (!roster || !Array.isArray(roster.imperial) || !Array.isArray(roster.chaos)) return freshRoster();
  const next: Roster = {
    imperial: roster.imperial.filter((u) => u && CATALOG[u.defId]),
    chaos: roster.chaos.filter((u) => u && CATALOG[u.defId]),
    imperialRes: (roster.imperialRes ?? []).filter((u) => u && CATALOG[u.defId]),
    chaosRes: (roster.chaosRes ?? []).filter((u) => u && CATALOG[u.defId]),
  };
  (["imperial", "chaos"] as const).forEach((faction, _i) => {
    const field = next[faction];
    const reserve = faction === "imperial" ? next.imperialRes : next.chaosRes;
    while (field.length > 5) {
      const extra = field.pop();
      if (extra) reserve.push(extra);
    }
    while (field.length < 5) {
      const id = SQUAD[faction][field.length] ?? SQUAD[faction][0];
      field.push(makeSaved(id, `${id}-r${field.length}-${randomInt(0, 9999)}`));
    }
  });
  return ensurePlayable(next);
}

async function sql() {
  return getSql();
}

export async function ensureCommander(token: string): Promise<Roster> {
  if (!TOKEN.test(token)) throw new Error("身份无效");
  const db = await sql();
  const existing = await db.query<{ roster: Roster | string }>("select roster from commanders where token = $1", [token]);
  if (existing[0]) {
    const stored = existing[0].roster;
    const raw = typeof stored === "string" ? (JSON.parse(stored) as Roster) : stored;
    const before =
      (raw?.imperial?.length ?? 0) +
      (raw?.chaos?.length ?? 0) +
      (raw?.imperialRes?.length ?? 0) +
      (raw?.chaosRes?.length ?? 0);
    const roster = parseRoster(stored);
    const after = roster.imperial.length + roster.chaos.length + roster.imperialRes.length + roster.chaosRes.length;
    if (after !== before) await saveRoster(token, roster);
    return roster;
  }
  const roster = freshRoster();
  await db.query(
    "insert into commanders (token, roster) values ($1, $2::jsonb) on conflict (token) do nothing",
    [token, JSON.stringify(roster)],
  );
  const again = await db.query<{ roster: Roster | string }>("select roster from commanders where token = $1", [token]);
  return parseRoster(again[0]?.roster ?? roster);
}

async function saveRoster(token: string, roster: Roster): Promise<void> {
  const db = await sql();
  await db.query("update commanders set roster = $2::jsonb, updated_at = now() where token = $1", [
    token,
    JSON.stringify(roster),
  ]);
}

async function sweep(): Promise<void> {
  const db = await sql();
  await db.query("delete from rooms where updated_at < now() - interval '8 hours'");
}

function makeCode(): string {
  let code = "";
  for (let i = 0; i < 4; i += 1) code += ALPHA[randomInt(0, ALPHA.length)];
  return code;
}

async function loadRoom(code: string): Promise<RoomRow | null> {
  const db = await sql();
  const rows = await db.query<RoomRow>("select code, mode, host_token, guest_token, version, state from rooms where code = $1", [
    code,
  ]);
  return rows[0] ?? null;
}

function seatOf(room: RoomRow, token: string): Faction | null {
  if (sameToken(room.host_token, token)) {
    if (room.mode === "skirmish") return parseState(room.state).player ?? "imperial";
    return "imperial";
  }
  if (room.guest_token && sameToken(room.guest_token, token)) return "chaos";
  return null;
}

function toView(room: RoomRow, you: Faction | null): RoomView {
  const state = parseState(room.state);
  const battle = state.battle;
  return {
    code: room.code,
    mode: room.mode,
    status: battle?.status ?? "lobby",
    you,
    version: Number(room.version),
    opponent: room.mode === "skirmish" ? true : Boolean(room.guest_token),
    battle,
    absorb: you === "imperial" && battle && battle.status === "absorb" ? listAbsorb(battle) : [],
  };
}

async function writeRoom(room: RoomRow, state: RoomState, version: number): Promise<number | null> {
  const db = await sql();
  const rows = await db.query<{ version: number }>(
    "update rooms set state = $1::jsonb, version = version + 1, updated_at = now() where code = $2 and version = $3 returning version",
    [JSON.stringify(state), room.code, version],
  );
  return rows[0] ? Number(rows[0].version) : null;
}

function avgLevel(units: SavedUnit[]): number {
  if (!units.length) return 1;
  return Math.max(1, Math.round(units.reduce((sum, unit) => sum + unit.level, 0) / units.length));
}

async function finalize(room: RoomRow, state: RoomState, decisions: Record<string, "purify" | "absorb">): Promise<void> {
  const battle = state.battle;
  if (!battle || battle.finalized || battle.status === "battle") return;
  const rng = serverRng();
  const host = await ensureCommander(room.host_token);
  const hostFaction = state.player ?? "imperial";
  const hostResult = applyPlayerRewards(battle, host, hostFaction, decisions, rng);
  await saveRoster(room.host_token, hostResult.roster);
  let lines = hostResult.lines;
  let gear = hostResult.gear;
  if (room.mode === "duel" && room.guest_token) {
    const guest = await ensureCommander(room.guest_token);
    const guestResult = applyPlayerRewards(battle, guest, "chaos", {}, rng);
    await saveRoster(room.guest_token, guestResult.roster);
    lines = [...lines, ...guestResult.lines];
    gear = [gear, guestResult.gear].filter(Boolean).join(" · ") || null;
  }
  battle.summary = buildSummary(battle.winner, lines, gear);
  battle.status = "finished";
  battle.finalized = true;
  battle.prompt = null;
}

async function settleIfReady(room: RoomRow, state: RoomState): Promise<void> {
  const battle = state.battle;
  if (!battle || battle.finalized || battle.status !== "absorb") return;
  const player = state.player ?? "imperial";
  if (player !== "imperial" || listAbsorb(battle).length === 0) await finalize(room, state, {});
}

export async function createRoom(token: string): Promise<ApiResult> {
  if (!TOKEN.test(token)) return { ok: false, error: "身份无效" };
  await ensureCommander(token);
  await sweep();
  const db = await sql();
  for (let i = 0; i < 6; i += 1) {
    const code = makeCode();
    const state: RoomState = { battle: null, recent: [] };
    try {
      await db.query(
        "insert into rooms (code, mode, host_token, guest_token, version, state) values ($1, 'duel', $2, null, 1, $3::jsonb)",
        [code, token, JSON.stringify(state)],
      );
      const room = await loadRoom(code);
      if (!room) return { ok: false, error: "房间创建失败" };
      return { ok: true, view: toView(room, "imperial") };
    } catch {
      // code collision, try again
    }
  }
  return { ok: false, error: "房间号暂时耗尽，请再试一次" };
}

export async function joinRoom(token: string, code: string): Promise<ApiResult> {
  if (!TOKEN.test(token) || !CODE.test(code)) return { ok: false, error: "房间号不正确" };
  if (limited(token)) return { ok: false, error: "操作过快" };
  return lock(code, async () => {
    await ensureCommander(token);
    const room = await loadRoom(code);
    if (!room || room.mode !== "duel") return { ok: false, error: "找不到这个房间" };
    const seat = seatOf(room, token);
    if (seat === "imperial") return { ok: true, view: toView(room, seat) };
    if (seat === "chaos") return { ok: true, view: toView(room, seat) };
    if (room.guest_token) return { ok: false, error: "房间已满" };
    const state = parseState(room.state);
    if (state.battle) return { ok: false, error: "战斗已经开始" };
    const host = await ensureCommander(room.host_token);
    const guest = await ensureCommander(token);
    state.battle = createBattle(host.imperial, guest.chaos, serverRng());
    const db = await sql();
    const rows = await db.query<{ version: number }>(
      "update rooms set guest_token = $1, state = $2::jsonb, version = version + 1, updated_at = now() where code = $3 and guest_token is null returning version",
      [token, JSON.stringify(state), code],
    );
    if (!rows[0]) return { ok: false, error: "房间已满" };
    const next = await loadRoom(code);
    if (!next) return { ok: false, error: "房间丢失" };
    return { ok: true, view: toView(next, "chaos") };
  });
}

export async function createSkirmish(token: string, faction: Faction, slots: string[]): Promise<ApiResult> {
  if (!TOKEN.test(token)) return { ok: false, error: "身份无效" };
  if (!Array.isArray(slots) || slots.length !== 5 || new Set(slots).size !== 5) {
    return { ok: false, error: "请选择五名不同角色" };
  }
  const roster = await ensureCommander(token);
  const pool = [
    ...(faction === "imperial" ? roster.imperial : roster.chaos),
    ...(faction === "imperial" ? roster.imperialRes : roster.chaosRes),
  ];
  const picked: SavedUnit[] = [];
  for (const id of slots) {
    const unit = pool.find((entry) => entry.instanceId === id);
    if (!unit || unit.fallen || unit.faction !== faction || !PLAYABLE[faction].includes(unit.defId)) {
      return { ok: false, error: "阵容里有不能出战的角色" };
    }
    picked.push(unit);
  }
  await sweep();
  const db = await sql();
  const level = avgLevel(picked);
  const imperial = faction === "imperial" ? picked : botSquad(level, "imperial", serverRng());
  const chaos = faction === "chaos" ? picked : botSquad(level, "chaos", serverRng());
  for (let i = 0; i < 6; i += 1) {
    const code = makeCode();
    const state: RoomState = {
      battle: createBattle(imperial, chaos, serverRng()),
      recent: [],
      player: faction,
      slots: [...slots],
    };
    try {
      await db.query(
        "insert into rooms (code, mode, host_token, guest_token, version, state) values ($1, 'skirmish', $2, null, 1, $3::jsonb)",
        [code, token, JSON.stringify(state)],
      );
      const room = await loadRoom(code);
      if (!room) return { ok: false, error: "演练创建失败" };
      return { ok: true, view: toView(room, faction) };
    } catch {
      // retry code
    }
  }
  return { ok: false, error: "演练暂时无法创建" };
}

export async function getRoom(token: string, code: string): Promise<ApiResult> {
  if (!TOKEN.test(token) || !CODE.test(code)) return { ok: false, error: "房间号不正确" };
  await ensureCommander(token);
  const room = await loadRoom(code);
  if (!room) return { ok: false, error: "房间不存在或已关闭" };
  const seat = seatOf(room, token);
  if (!seat) return { ok: false, error: "你不在这个房间" };
  return { ok: true, view: toView(room, seat) };
}

export async function getRoster(token: string): Promise<{ ok: true; roster: Roster } | { ok: false; error: string }> {
  if (!TOKEN.test(token)) return { ok: false, error: "身份无效" };
  const roster = await ensureCommander(token);
  return { ok: true, roster };
}

export async function spendPoint(
  token: string,
  instanceId: string,
  stat: "hp" | "atk" | "def",
): Promise<{ ok: true; roster: Roster } | { ok: false; error: string }> {
  if (!TOKEN.test(token)) return { ok: false, error: "身份无效" };
  if (limited(token)) return { ok: false, error: "操作过快" };
  const roster = await ensureCommander(token);
  const lists = [roster.imperial, roster.chaos, roster.imperialRes, roster.chaosRes];
  const unit = lists.flat().find((u) => u.instanceId === instanceId);
  if (!unit) return { ok: false, error: "找不到角色" };
  const error = assignPoint(unit, stat);
  if (error) return { ok: false, error };
  await saveRoster(token, roster);
  return { ok: true, roster };
}

export async function swapUnit(
  token: string,
  faction: Faction,
  reserveId: string,
  fieldId: string,
): Promise<{ ok: true; roster: Roster } | { ok: false; error: string }> {
  if (!TOKEN.test(token)) return { ok: false, error: "身份无效" };
  const roster = await ensureCommander(token);
  const error = swapIntoField(roster, faction, reserveId, fieldId);
  if (error) return { ok: false, error };
  await saveRoster(token, roster);
  return { ok: true, roster };
}

async function mutate(
  token: string,
  code: string,
  version: number,
  actionId: string,
  run: (room: RoomRow, state: RoomState, seat: Faction) => Promise<string | null>,
): Promise<ApiResult> {
  if (!TOKEN.test(token) || !CODE.test(code)) return { ok: false, error: "房间号不正确" };
  if (limited(token)) return { ok: false, error: "操作过快" };
  return lock(`room:${code}`, async () => {
    const room = await loadRoom(code);
    if (!room) return { ok: false, error: "房间不存在或已关闭" };
    const seat = seatOf(room, token);
    if (!seat) return { ok: false, error: "你不在这个房间" };
    const state = parseState(room.state);
    if (state.recent.includes(actionId)) return { ok: true, view: toView({ ...room, state }, seat) };
    if (Number(room.version) !== version) {
      return { ok: false, error: "战场已变化，请重试", view: toView({ ...room, state }, seat) };
    }
    const error = await run(room, state, seat);
    if (error === "NOOP") return { ok: true, view: toView({ ...room, state }, seat) };
    if (error) return { ok: false, error, view: toView({ ...room, state }, seat) };
    state.recent = [...state.recent, actionId].slice(-20);
    await settleIfReady(room, state);
    const nextVersion = await writeRoom(room, state, Number(room.version));
    if (!nextVersion) return { ok: false, error: "操作冲突，请重试", view: toView(room, seat) };
    room.version = nextVersion;
    room.state = state;
    return { ok: true, view: toView(room, seat) };
  });
}

export async function act(token: string, code: string, version: number, actionId: string, command: Command): Promise<ApiResult> {
  return mutate(token, code, version, actionId, async (_room, state, seat) => {
    const battle = state.battle;
    if (!battle) return "对手还未进入";
    if (command.kind === "crisis") {
      const unit = battle.units.find((u) => u.instanceId === command.actorId);
      if (!unit || unit.owner !== seat) return "不能替对方做临界抉择";
    } else if (command.kind === "end") {
      if (battle.phase !== seat) return "还没轮到你的阵营";
    } else {
      const actor = battle.units.find((u) => u.instanceId === command.actorId);
      if (!actor || actor.faction !== seat) return "不能指挥这个角色";
    }
    const result = applyCommand(battle, command, serverRng());
    if (result.error) return result.error;
    state.battle = result.battle;
    return null;
  });
}

export async function botAct(token: string, code: string, version: number, actionId: string): Promise<ApiResult> {
  return mutate(token, code, version, actionId, async (room, state, seat) => {
    if (room.mode !== "skirmish") return "这里没有自动指挥的对手";
    const player = parseState(room.state).player ?? "imperial";
    if (seat !== player) return "这里没有自动指挥的对手";
    const battle = state.battle;
    if (!battle) return "战斗尚未开始";
    if (battle.status !== "battle") return "NOOP";
    if (battle.prompt) {
      const unit = battle.units.find((u) => u.instanceId === battle.prompt?.unitId);
      if (!unit || unit.owner === player) return "NOOP";
      const result = applyCommand(battle, { kind: "crisis", actorId: unit.instanceId, choice: "purify" }, serverRng());
      if (result.error) return result.error;
      state.battle = result.battle;
      return null;
    }
    if (battle.phase === player) return "NOOP";
    const command = chooseBot(battle);
    if (!command) return "NOOP";
    const result = applyCommand(battle, command, serverRng());
    if (result.error) return result.error;
    state.battle = result.battle;
    return null;
  });
}

export async function absorb(
  token: string,
  code: string,
  version: number,
  actionId: string,
  decisions: { instanceId: string; mode: "purify" | "absorb" }[],
): Promise<ApiResult> {
  return mutate(token, code, version, actionId, async (_room, state, seat) => {
    const player = state.player ?? "imperial";
    if (_room.mode === "skirmish" && player !== "imperial") {
      await finalize(_room, state, {});
      return null;
    }
    if (seat !== "imperial") return "只有帝国指挥官可以选择净化或吸收";
    const battle = state.battle;
    if (!battle || battle.status !== "absorb") return "现在不能结算战利品";
    const map: Record<string, "purify" | "absorb"> = {};
    for (const row of decisions) {
      if (row.mode === "absorb") map[row.instanceId] = "absorb";
    }
    await finalize(_room, state, map);
    return null;
  });
}

export async function rematch(token: string, code: string, version: number, actionId: string): Promise<ApiResult> {
  return mutate(token, code, version, actionId, async (room, state, seat) => {
    const battle = state.battle;
    if (!battle || battle.status !== "finished") return "战斗尚未结算";
    battle.rematch[seat] = true;
    const ready = room.mode === "skirmish" ? battle.rematch[state.player ?? "imperial"] : battle.rematch.imperial && battle.rematch.chaos;
    if (!ready) return null;
    const host = await ensureCommander(room.host_token);
    if (room.mode === "skirmish") {
      const faction = state.player ?? "imperial";
      const pool = [
        ...(faction === "imperial" ? host.imperial : host.chaos),
        ...(faction === "imperial" ? host.imperialRes : host.chaosRes),
      ];
      const rebuilt = (state.slots ?? [])
        .map((id) => pool.find((unit) => unit.instanceId === id))
        .filter((unit): unit is SavedUnit => Boolean(unit));
      const picked = rebuilt.length === 5 ? rebuilt : faction === "imperial" ? host.imperial : host.chaos;
      const level = avgLevel(picked);
      state.battle = createBattle(
        faction === "imperial" ? picked : botSquad(level, "imperial", serverRng()),
        faction === "chaos" ? picked : botSquad(level, "chaos", serverRng()),
        serverRng(),
      );
      return null;
    }
    const chaos = (await ensureCommander(room.guest_token ?? "")).chaos;
    state.battle = createBattle(host.imperial, chaos, serverRng());
    return null;
  });
}
