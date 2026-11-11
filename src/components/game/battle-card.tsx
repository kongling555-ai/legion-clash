import type { CombatUnit } from "@/game/engine/types";
import { portraitOf } from "@/game/engine/catalog";
import { basicReach } from "@/game/engine/battle";
import { corruptionStage } from "@/game/engine/progress";
import { useI18n } from "@/game/client/i18n";

export function BattleCard({
  unit,
  selected,
  legal,
  mark,
  armed,
  motion,
  floater,
  aura,
  onPress,
}: {
  unit: CombatUnit;
  selected: boolean;
  legal: boolean;
  mark: string | null;
  armed: boolean;
  motion: "" | "up" | "down" | "flip";
  floater: string | null;
  aura: "" | "psychic" | "heal" | "impact";
  onPress: () => void;
}) {
  const { t, tx, card } = useI18n();
  const chaos = unit.faction === "chaos" || unit.fallen;
  const warn = !unit.fallen && unit.faction === "imperial" && unit.corruption >= 80;
  const motionClass = motion === "up" ? "anim-up" : motion === "down" ? "anim-down" : motion === "flip" ? "anim-flip" : "";
  const state = !unit.alive ? t.deadTag : unit.acted ? t.hasActed : t.canAct;
  const reach = basicReach(unit) === "ranged" ? t.rangedTag : t.meleeTag;
  const row = unit.position < 2 ? t.frontTag : t.backTag;
  return (
    <span className="card-stage block">
    <button
      type="button"
      onClick={onPress}
      aria-pressed={selected}
      className={[
        "card-face relative w-full overflow-hidden rounded-md border text-left",
        chaos ? "border-warp" : "border-gold-2",
        selected ? "ring-2 ring-gold" : "",
        legal ? "border-2 border-ivory ring-2 ring-gold" : "",
        armed && !legal ? "opacity-70" : "",
        warn && !legal ? "ring-2 ring-gold" : "",
        unit.alive ? "" : "opacity-50 grayscale",
        motionClass,
      ].join(" ")}
    >
      <img
        src={`/portraits/${portraitOf(unit.defId)}.jpg`}
        alt=""
        className={unit.fallen ? "fallen-art absolute inset-0 h-full w-full object-cover object-top" : "absolute inset-0 h-full w-full object-cover object-top"}
      />
      <span className="absolute inset-0 bg-gradient-to-t from-void via-void/35 to-void/10" />
      {unit.fallen ? <span className="fallen-sheen" /> : null}
      {unit.corruption >= 20 ? <Cracks amount={unit.corruption} warn={warn} /> : null}
      {aura === "psychic" ? <Bolts /> : null}
      {aura === "heal" ? <span className="fx-heal" /> : null}
      {aura === "impact" ? <span className="fx-impact" /> : null}
      <span className="absolute top-0.5 left-0.5 rounded-sm bg-void/85 px-0.5 text-[10px] leading-4 text-gold">
        {state}
      </span>
      {mark ? (
        <span className="absolute top-0.5 right-0.5 rounded-sm border border-ivory bg-void/85 px-0.5 text-[10px] leading-4 text-ivory">
          {mark}
        </span>
      ) : null}
      <span className="absolute inset-x-0 bottom-0 px-0.5 pb-0.5">
        <span className="block text-[10px] leading-3 text-ivory">{card(unit)}</span>
        <span className="block text-[10px] leading-3 text-steel">
          {reach} {row}
          {unit.shield > 0 ? ` ${t.shieldWord}${unit.shield}` : ""}
        </span>
        <span className="mt-0.5 block h-1 overflow-hidden rounded-full bg-line">
          <span
            className={chaos ? "block h-full bg-warp" : "block h-full bg-gold"}
            style={{ width: `${Math.max(0, Math.round((unit.hp / Math.max(1, unit.maxHp)) * 100))}%` }}
          />
        </span>
        <span className="flex justify-between text-[10px] leading-3 tabular-nums text-ivory">
          <span>{unit.hp}/{unit.maxHp}</span>
        </span>
      </span>
      {floater ? (
        <span className="anim-float pointer-events-none absolute top-5 left-1/2 -translate-x-1/2 text-center text-[11px] font-display leading-4 text-gold">
          {tx(floater)}
        </span>
      ) : null}
      <span className="sr-only">
        {tx(unit.name)} {state} {reach} {row} {t.statHp} {unit.hp}/{unit.maxHp} {t.statAtk} {unit.atk} {t.statDef} {unit.def}{" "}
        {t.shieldWord} {unit.shield} {tx(corruptionStage(unit.corruption, unit.faction, unit.fallen))}
      </span>
    </button>
    </span>
  );
}

function Cracks({ amount, warn }: { amount: number; warn: boolean }) {
  const opacity = Math.min(0.9, amount / 110);
  return (
    <svg
      viewBox="0 0 100 150"
      className={warn ? "crack-live pointer-events-none absolute inset-0 h-full w-full text-gold" : "crack-live pointer-events-none absolute inset-0 h-full w-full text-warp"}
      aria-hidden="true"
    >
      <path d="M18 0 L34 36 L16 68 L40 150" stroke="currentColor" strokeWidth="1.4" fill="none" opacity={opacity} />
      <path d="M78 0 L58 48 L86 92 L52 150" stroke="currentColor" strokeWidth="1.1" fill="none" opacity={opacity} />
      <path d="M48 20 L60 70 L42 110" stroke="currentColor" strokeWidth="0.8" fill="none" opacity={opacity} />
    </svg>
  );
}

function Bolts() {
  return (
    <svg viewBox="0 0 100 150" className="pointer-events-none absolute inset-0 h-full w-full" aria-hidden="true">
      <path className="fx-bolt" d="M54 0 L40 46 L64 54 L36 150" />
      <path className="fx-bolt fx-bolt-b" d="M74 0 L56 58 L80 72 L46 150" />
    </svg>
  );
}
