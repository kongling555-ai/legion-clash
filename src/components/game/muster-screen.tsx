import { Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useI18n } from "@/game/client/i18n";
import { playerToken } from "@/game/client/prefs";
import { CATALOG, PLAYABLE, portraitOf } from "@/game/engine/catalog";
import { corruptionStage, deriveStats, placeTanks } from "@/game/engine/progress";
import type { Faction, SavedUnit } from "@/game/engine/types";
import { createSkirmish, getRoster } from "@/game/server/api";

export function MusterScreen() {
  const navigate = useNavigate();
  const { t, tx, card } = useI18n();
  const [token, setToken] = useState("");
  const [units, setUnits] = useState<SavedUnit[]>([]);
  const [faction, setFaction] = useState<Faction>("imperial");
  const [picked, setPicked] = useState<string[]>([]);
  const [slots, setSlots] = useState<(string | null)[]>([null, null, null, null, null]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rules, setRules] = useState(false);

  useEffect(() => {
    const id = playerToken();
    setToken(id);
    void getRoster({ data: { token: id } }).then((res) => {
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setUnits([...res.roster.imperial, ...res.roster.chaos, ...res.roster.imperialRes, ...res.roster.chaosRes]);
    });
  }, []);

  const pool = units.filter(
    (unit) => unit.faction === faction && !unit.fallen && PLAYABLE[faction].includes(unit.defId),
  );

  function chooseFaction(next: Faction) {
    setFaction(next);
    setPicked([]);
    setSlots([null, null, null, null, null]);
    setError(null);
  }

  function fill(ids: string[]) {
    const next: (string | null)[] = [null, null, null, null, null];
    ids.slice(0, 5).forEach((id, index) => {
      next[index] = id;
    });
    setPicked(ids.slice(0, 5));
    setSlots(next);
  }

  function recommend() {
    const sides: Faction[] = ["imperial", "chaos"];
    const next = sides[Math.floor(Math.random() * sides.length)] ?? "imperial";
    const nextPool = units.filter(
      (unit) => unit.faction === next && !unit.fallen && PLAYABLE[next].includes(unit.defId),
    );
    const bag = [...nextPool];
    for (let i = bag.length - 1; i > 0; i -= 1) {
      const j = Math.floor(Math.random() * (i + 1));
      const swap = bag[i];
      bag[i] = bag[j]!;
      bag[j] = swap!;
    }
    setFaction(next);
    setError(null);
    fill(placeTanks(bag.slice(0, 5)).map((unit) => unit.instanceId));
  }

  function toggle(id: string) {
    setError(null);
    if (picked.includes(id)) {
      setPicked(picked.filter((item) => item !== id));
      setSlots(slots.map((slot) => (slot === id ? null : slot)));
      return;
    }
    if (picked.length >= 5) return;
    const next = [...picked, id];
    setPicked(next);
    if (next.length === 5) fill(next);
  }

  function place(id: string, index: number) {
    if (!picked.includes(id)) return;
    const next = slots.map((slot) => (slot === id ? null : slot));
    next[index] = id;
    setSlots(next);
  }

  const ready = slots.every(Boolean) && new Set(slots).size === 5;

  async function start() {
    if (!ready || busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await createSkirmish({
        data: { token, faction, slots: slots.filter((id): id is string => Boolean(id)) },
      });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      await navigate({ to: "/battle/$code", params: { code: res.view.code } });
    } catch {
      setError("演练没有创建成功");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="safe-pad min-h-dvh overflow-x-hidden bg-void text-ivory">
      <div className="mx-auto flex max-w-lg flex-col gap-4 px-4 py-5">
        <div className="flex items-center justify-between">
          <Link to="/" className="min-h-11 text-sm text-muted">
            {t.back}
          </Link>
          <button type="button" className="min-h-11 text-sm text-steel" onClick={() => setRules((v) => !v)}>
            {t.rulesTitle}
          </button>
        </div>
        <div>
          <p className="text-xs tracking-widest text-gold">{t.kicker}</p>
          <h1 className="font-display text-3xl">{t.musterTitle}</h1>
          <p className="mt-2 text-sm leading-6 text-muted">{t.musterBlurb}</p>
        </div>
        {rules ? <p className="rounded-md border border-line bg-panel p-3 text-sm leading-6 text-ivory">{t.rulesBody}</p> : null}

        <section>
          <p className="text-sm text-gold">{t.pickFaction}</p>
          <div className="mt-2 grid grid-cols-2 gap-2">
            {(["imperial", "chaos"] as const).map((id) => (
              <button
                key={id}
                type="button"
                aria-pressed={faction === id}
                onClick={() => chooseFaction(id)}
                className={faction === id ? "min-h-12 rounded-md bg-gold text-void" : "min-h-12 rounded-md border border-line"}
              >
                {id === "imperial" ? t.imperial : t.chaos}
              </button>
            ))}
          </div>
          <p className="mt-2 text-xs text-muted">
            {t.youLead} · {t.enemyBot}
          </p>
        </section>

        <button type="button" onClick={recommend} className="min-h-11 rounded-md border border-steel text-sm text-steel">
          {t.recommended}
        </button>

        <section className="grid gap-2">
          {pool.map((unit) => {
            const stats = deriveStats(unit);
            const on = picked.includes(unit.instanceId);
            const def = CATALOG[unit.defId];
            return (
              <button
                key={unit.instanceId}
                type="button"
                aria-pressed={on}
                onClick={() => toggle(unit.instanceId)}
                className={on ? "flex min-h-16 gap-3 rounded-md border-2 border-gold bg-panel p-2 text-left" : "flex min-h-16 gap-3 rounded-md border border-line bg-ink p-2 text-left"}
              >
                <img src={`/portraits/${portraitOf(unit.defId)}.jpg`} alt="" className="h-16 w-12 rounded-sm object-cover" />
                <span className="min-w-0 flex-1">
                  <span className="block text-sm text-ivory">{tx(unit.name)}</span>
                  <span className="mt-1 block text-xs leading-5 text-muted">
                    {tx(unit.role)} · {def?.basicReach === "ranged" ? t.rangedTag : t.meleeTag} · {t.statHp} {stats.hp} · {t.statAtk}{" "}
                    {stats.atk} · {t.statDef} {stats.def} · {t.statWp} {stats.wp}
                  </span>
                  <span className="block text-xs text-steel">{tx(corruptionStage(unit.corruption, unit.faction, unit.fallen))}</span>
                </span>
                <span className="text-xs text-gold">{on ? picked.indexOf(unit.instanceId) + 1 : ""}</span>
              </button>
            );
          })}
        </section>

        <section>
          <p className="text-sm text-gold">{t.frontRow}</p>
          <div className="mt-2 grid grid-cols-2 gap-2">
            {[0, 1].map((index) => (
              <Slot key={index} label={`${t.frontTag} ${index + 1}`} id={slots[index] ?? null} units={pool} onPick={(id) => place(id, index)} card={card} tx={tx} />
            ))}
          </div>
          <p className="mt-3 text-sm text-gold">{t.backRow}</p>
          <div className="mt-2 grid grid-cols-3 gap-2">
            {[2, 3, 4].map((index) => (
              <Slot key={index} label={`${t.backTag} ${index - 1}`} id={slots[index] ?? null} units={pool} onPick={(id) => place(id, index)} card={card} tx={tx} />
            ))}
          </div>
          <p className="mt-2 text-xs leading-5 text-muted">{ready ? t.growthNote : t.needFive}</p>
        </section>

        <button
          type="button"
          disabled={!ready || busy}
          onClick={() => void start()}
          className="min-h-12 rounded-md bg-gold text-void disabled:opacity-40"
        >
          {busy ? t.skirmishBusy : t.startBattle}
        </button>
        {error ? <p className="text-sm text-blood">{tx(error)}</p> : null}
      </div>
    </main>
  );
}

function Slot({
  label,
  id,
  units,
  onPick,
  card,
  tx,
}: {
  label: string;
  id: string | null;
  units: SavedUnit[];
  onPick: (id: string) => void;
  card: (unit: SavedUnit) => string;
  tx: (text: string | null | undefined) => string;
}) {
  const unit = units.find((entry) => entry.instanceId === id);
  return (
    <label className="block rounded-md border border-line bg-ink p-2 text-xs">
      <span className="text-muted">{label}</span>
      <select
        className="mt-1 min-h-11 w-full bg-void text-sm text-ivory"
        value={id ?? ""}
        onChange={(event) => {
          if (event.target.value) onPick(event.target.value);
        }}
      >
        <option value="">{label}</option>
        {units.map((entry) => (
          <option key={entry.instanceId} value={entry.instanceId}>
            {tx(entry.name)}
          </option>
        ))}
      </select>
      <span className="mt-1 block truncate text-ivory">{unit ? card(unit) : " "}</span>
    </label>
  );
}
