import type { CombatUnit } from "@/game/engine/types";
import { corruptionStage } from "@/game/engine/progress";
import { useI18n } from "@/game/client/i18n";

export function BattleCard({
  unit,
  selected,
  target,
  motion,
  floater,
  onPress,
}: {
  unit: CombatUnit;
  selected: boolean;
  target: boolean;
  motion: "" | "up" | "down" | "flip";
  floater: string | null;
  onPress: () => void;
}) {
  const { tx, card } = useI18n();
  const chaos = unit.faction === "chaos" || unit.fallen;
  const warn = !unit.fallen && unit.faction === "imperial" && unit.corruption >= 80;
  const motionClass = motion === "up" ? "anim-up" : motion === "down" ? "anim-down" : motion === "flip" ? "anim-flip" : "";
  return (
    <button
      type="button"
      onClick={onPress}
      aria-pressed={selected}
      className={[
        "card-face relative w-full overflow-hidden rounded-md border text-left",
        chaos ? "border-warp" : "border-gold-2",
        selected ? "ring-2 ring-gold" : "",
        target ? "anim-target ring-2 ring-warp" : "",
        warn ? "ring-2 ring-gold" : "",
        unit.alive ? "" : "opacity-50 grayscale",
        motionClass,
      ].join(" ")}
    >
      <img
        src={`/portraits/${unit.defId}.jpg`}
        alt=""
        className="absolute inset-0 h-full w-full object-cover object-top"
      />
      <span className="absolute inset-0 bg-gradient-to-t from-void via-void/20 to-transparent" />
      {unit.corruption >= 20 ? <Cracks amount={unit.corruption} warn={warn} /> : null}
      <span className="absolute top-1 left-1 rounded-sm bg-void/80 px-1 text-xs text-gold">
        {unit.level}
      </span>
      {unit.shield > 0 ? (
        <span className="absolute top-1 right-1 rounded-sm bg-void/80 px-1 text-xs text-steel">{unit.shield}</span>
      ) : null}
      <span className="absolute inset-x-0 bottom-0 px-1 pb-1">
        <span className="block truncate text-xs text-ivory">{card(unit)}</span>
        <span className="mt-0.5 block h-1 overflow-hidden rounded-full bg-line">
          <span
            className={chaos ? "block h-full bg-warp" : "block h-full bg-gold"}
            style={{ width: `${Math.max(0, Math.round((unit.hp / unit.maxHp) * 100))}%` }}
          />
        </span>
        <span className="mt-0.5 flex justify-between text-xs tabular-nums text-ivory">
          <span>{unit.atk}</span>
          <span className="text-steel">{unit.def}</span>
          <span className="text-gold">{unit.hp}</span>
        </span>
      </span>
      {floater ? (
        <span className="anim-float pointer-events-none absolute top-6 left-1/2 -translate-x-1/2 text-sm font-display text-gold">
          {tx(floater)}
        </span>
      ) : null}
      <span className="sr-only">
        {tx(unit.name)} {tx(corruptionStage(unit.corruption, unit.faction, unit.fallen))} {unit.hp}
      </span>
    </button>
  );
}

function Cracks({ amount, warn }: { amount: number; warn: boolean }) {
  const opacity = Math.min(0.9, amount / 110);
  return (
    <svg
      viewBox="0 0 100 150"
      className={warn ? "pointer-events-none absolute inset-0 h-full w-full text-gold" : "pointer-events-none absolute inset-0 h-full w-full text-warp"}
      aria-hidden="true"
    >
      <path d="M18 0 L34 36 L16 68 L40 150" stroke="currentColor" strokeWidth="1.4" fill="none" opacity={opacity} />
      <path d="M78 0 L58 48 L86 92 L52 150" stroke="currentColor" strokeWidth="1.1" fill="none" opacity={opacity} />
      <path d="M48 20 L60 70 L42 110" stroke="currentColor" strokeWidth="0.8" fill="none" opacity={opacity} />
    </svg>
  );
}
