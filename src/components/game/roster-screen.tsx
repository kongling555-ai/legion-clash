import { Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { CATALOG, FALLEN, FALLEN_PASSIVE, GOD_LABEL } from "@/game/engine/catalog";
import { corruptionStage, deriveStats, rarityLabel, xpToNext } from "@/game/engine/progress";
import type { Faction, Roster, SavedUnit } from "@/game/engine/types";
import { getRoster, spendPoint, swapUnit } from "@/game/server/api";
import { useI18n } from "@/game/client/i18n";
import { playerToken } from "@/game/client/prefs";

export function RosterScreen() {
  const { t, tx } = useI18n();
  const [roster, setRoster] = useState<Roster | null>(null);
  const [faction, setFaction] = useState<Faction>("imperial");
  const [picked, setPicked] = useState<string | null>(null);
  const [reserveId, setReserveId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void getRoster({ data: { token: playerToken() } }).then((res) => {
      if (!res.ok) setError(res.error);
      else {
        setRoster(res.roster);
        setPicked(res.roster.imperial[0]?.instanceId ?? null);
      }
    });
  }, []);

  const field = faction === "imperial" ? roster?.imperial ?? [] : roster?.chaos ?? [];
  const reserve = faction === "imperial" ? roster?.imperialRes ?? [] : roster?.chaosRes ?? [];
  const unit = [...field, ...reserve].find((u) => u.instanceId === picked) ?? field[0];

  async function point(stat: "hp" | "atk" | "def") {
    if (!unit) return;
    const res = await spendPoint({ data: { token: playerToken(), instanceId: unit.instanceId, stat } });
    if (!res.ok) setError(res.error);
    else setRoster(res.roster);
  }

  async function swap(fieldId: string) {
    if (!reserveId) return;
    const res = await swapUnit({
      data: { token: playerToken(), faction, reserveId, fieldId },
    });
    if (!res.ok) setError(res.error);
    else {
      setRoster(res.roster);
      setReserveId(null);
    }
  }

  return (
    <main className="safe-pad mx-auto min-h-dvh max-w-lg bg-void px-4 py-5 text-ivory">
      <Link to="/" className="text-sm text-muted">
        {t.back}
      </Link>
      <h1 className="mt-4 font-display text-3xl">{t.roster}</h1>
      <p className="mt-2 text-sm text-muted">{t.rosterBlurb}</p>
      <div className="mt-4 grid grid-cols-2 gap-2">
        <button
          type="button"
          onClick={() => setFaction("imperial")}
          className={faction === "imperial" ? "min-h-11 rounded-md bg-gold text-void" : "min-h-11 rounded-md border border-line"}
        >
          {t.imperial}
        </button>
        <button
          type="button"
          onClick={() => setFaction("chaos")}
          className={faction === "chaos" ? "min-h-11 rounded-md bg-warp text-ivory" : "min-h-11 rounded-md border border-line"}
        >
          {t.chaos}
        </button>
      </div>
      <div className="mt-4 flex gap-2 overflow-x-auto pb-2">
        {field.map((entry) => (
          <button key={entry.instanceId} type="button" onClick={() => void (reserveId ? swap(entry.instanceId) : setPicked(entry.instanceId))} className="w-24 shrink-0">
            <Portrait unit={entry} active={unit?.instanceId === entry.instanceId} />
          </button>
        ))}
      </div>
      {reserve.length ? (
        <div className="mt-2">
          <p className="text-xs text-muted">{reserveId ? t.swapHint : t.reserve}</p>
          <div className="mt-2 flex gap-2 overflow-x-auto">
            {reserve.map((entry) => (
              <button
                key={entry.instanceId}
                type="button"
                onClick={() => setReserveId(entry.instanceId)}
                className="w-20 shrink-0"
              >
                <Portrait unit={entry} active={reserveId === entry.instanceId} />
              </button>
            ))}
          </div>
        </div>
      ) : null}
      {unit ? <Detail unit={unit} onPoint={(stat) => void point(stat)} /> : null}
      {error ? <p className="mt-3 text-sm text-blood">{tx(error)}</p> : null}
    </main>
  );
}

function Portrait({ unit, active }: { unit: SavedUnit; active: boolean }) {
  const { tx } = useI18n();
  return (
    <span className={active ? "block overflow-hidden rounded-md border border-gold" : "block overflow-hidden rounded-md border border-line"}>
      <img src={`/portraits/${unit.defId}.jpg`} alt="" className="aspect-[2/3] w-full object-cover" />
      <span className="block truncate px-1 py-1 text-xs">{tx(unit.name)}</span>
    </span>
  );
}

function Detail({ unit, onPoint }: { unit: SavedUnit; onPoint: (stat: "hp" | "atk" | "def") => void }) {
  const { t, tx, levelMark, freePoints } = useI18n();
  const stats = deriveStats(unit);
  const def = CATALOG[unit.defId];
  const passive = unit.fallen ? FALLEN_PASSIVE : def.passive;
  const active = unit.fallen && unit.fallenGod ? FALLEN[unit.fallenGod].skill : def.active;
  const next = xpToNext(unit.level);
  return (
    <section className="mt-4 rounded-md border border-line bg-panel p-4">
      <p className="font-display text-2xl">{tx(unit.name)}</p>
      <p className="mt-1 text-sm text-muted">
        {tx(unit.role)} · {tx(rarityLabel(unit.rarity))} · {levelMark(unit.level)}
        {unit.ascended ? ` · ${t.ascended}` : ""}
        {unit.fallen ? ` · ${t.fallenTag}` : ""}
      </p>
      <p className="mt-3 text-sm text-gold">
        {tx(corruptionStage(unit.corruption, unit.faction, unit.fallen))} · {t.corruption} {unit.corruption}
      </p>
      <div className="mt-2 h-1 overflow-hidden rounded-full bg-line">
        <div className="h-full bg-warp" style={{ width: `${unit.corruption}%` }} />
      </div>
      <div className="mt-3 grid grid-cols-4 gap-2 text-center text-sm">
        {(["khorne", "tzeentch", "nurgle", "slaanesh"] as const).map((god) => (
          <div key={god} className="rounded-md bg-ink py-2">
            <div className="text-xs text-muted">{tx(GOD_LABEL[god])}</div>
            <div>{unit.gods[god]}</div>
          </div>
        ))}
      </div>
      <dl className="mt-4 grid grid-cols-5 gap-2 text-center text-sm">
        <Stat label={t.statHp} value={stats.hp} />
        <Stat label={t.statAtk} value={stats.atk} />
        <Stat label={t.statDef} value={stats.def} />
        <Stat label={t.statSpd} value={stats.spd} />
        <Stat label={t.statWp} value={stats.wp} />
      </dl>
      <p className="mt-4 text-sm text-ivory">{tx(passive.name)}</p>
      <p className="text-sm leading-6 text-muted">{tx(passive.blurb)}</p>
      <p className="mt-3 text-sm text-ivory">{tx(active.name)}</p>
      <p className="text-sm leading-6 text-muted">{tx(active.blurb)}</p>
      {unit.gear ? (
        <p className="mt-3 text-sm text-gold">
          {t.gear} · {tx(unit.gear.name)}
        </p>
      ) : (
        <p className="mt-3 text-sm text-muted">{t.noGear}</p>
      )}
      <p className="mt-4 text-sm text-muted">
        {unit.level >= 20 ? t.peak : `${t.xpWord} ${unit.xp} / ${next}`}
        {unit.milestones.s5 ? ` · ${t.mileSkill}` : ""}
        {unit.milestones.s10 ? ` · ${t.mileClass}` : ""}
        {unit.milestones.s15 ? ` · ${t.mileLegend}` : ""}
        {unit.milestones.s20 ? ` · ${t.mileUltimate}` : ""}
      </p>
      {unit.freePoints > 0 ? (
        <div className="mt-3 grid grid-cols-3 gap-2">
          <button type="button" className="min-h-11 rounded-md border border-line" onClick={() => onPoint("hp")}>
            {t.plusHp}
          </button>
          <button type="button" className="min-h-11 rounded-md border border-line" onClick={() => onPoint("atk")}>
            {t.plusAtk}
          </button>
          <button type="button" className="min-h-11 rounded-md border border-line" onClick={() => onPoint("def")}>
            {t.plusDef}
          </button>
        </div>
      ) : null}
      <p className="mt-2 text-xs text-muted">{freePoints(unit.freePoints)}</p>
    </section>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-md bg-ink py-2">
      <dt className="text-xs text-muted">{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}
