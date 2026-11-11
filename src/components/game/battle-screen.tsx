import { Link } from "@tanstack/react-router";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { BattleCard } from "@/components/game/battle-card";
import { playTone, unlockAudio } from "@/game/client/audio";
import { useI18n } from "@/game/client/i18n";
import { actionId, loadFx, loadSound, playerToken } from "@/game/client/prefs";
import { CATALOG, GOD_LABEL } from "@/game/engine/catalog";
import { basicReach, legalTargetIds, skillsFor, targetReason } from "@/game/engine/battle";
import { corruptionStage, godSum } from "@/game/engine/progress";
import type { Command, SkillDef } from "@/game/engine/types";
import { absorbLoot, act, botAct, getRoom, requestRematch } from "@/game/server/api";

type View = Extract<Awaited<ReturnType<typeof getRoom>>, { ok: true }>["view"];

export function BattleScreen({ code }: { code: string }) {
  const { t, tx, roundLine, levelUp } = useI18n();
  const [token, setToken] = useState("");
  const [view, setView] = useState<View | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [banner, setBanner] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [armed, setArmed] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [logOpen, setLogOpen] = useState(false);
  const [motion, setMotion] = useState<Record<string, "up" | "down" | "flip">>({});
  const [floats, setFloats] = useState<Record<string, string>>({});
  const [auras, setAuras] = useState<Record<string, "psychic" | "heal" | "impact">>({});
  const [choices, setChoices] = useState<Record<string, "purify" | "absorb">>({});
  const [confirmEnd, setConfirmEnd] = useState(false);
  const [inspect, setInspect] = useState(false);
  const seen = useRef(0);
  const primed = useRef(false);
  const versionRef = useRef(0);
  const sound = useRef(true);

  function take(next: View) {
    if (next.version < versionRef.current) return;
    versionRef.current = next.version;
    setView(next);
    setError(null);
  }

  useEffect(() => {
    setToken(playerToken());
    sound.current = loadSound();
    document.documentElement.dataset.fx = loadFx();
    const unlock = () => unlockAudio();
    window.addEventListener("pointerdown", unlock);
    return () => window.removeEventListener("pointerdown", unlock);
  }, []);

  useEffect(() => {
    if (!token) return;
    let cancel = false;
    let timer = 0;
    const loop = async () => {
      try {
        const res = await getRoom({ data: { token, code } });
        if (cancel) return;
        if (!res.ok) setError(res.error);
        else take(res.view);
      } catch {
        if (!cancel) setError("连线中断，正在重试");
      }
      if (!cancel) timer = window.setTimeout(() => void loop(), 800);
    };
    void loop();
    return () => {
      cancel = true;
      window.clearTimeout(timer);
    };
  }, [code, token]);

  const battle = view?.battle ?? null;
  const version = view?.version ?? 0;
  const phase = battle?.phase;
  const status = view?.status;
  const promptId = battle?.prompt?.unitId ?? "";
  const mode = view?.mode;
  const you = view?.you;

  useEffect(() => {
    const fx = battle?.fx ?? [];
    const seq = (id: string) => Number(id.replace(/\D/g, "")) || 0;
    const newest = fx.length ? seq(fx[fx.length - 1]?.id ?? "") : 0;
    if (!primed.current) {
      primed.current = true;
      seen.current = newest;
      return;
    }
    const fresh = fx.filter((event) => seq(event.id) > seen.current);
    if (!fresh.length) return;
    seen.current = newest;
    const nextMotion: Record<string, "up" | "down" | "flip"> = {};
    const nextFloat: Record<string, string> = {};
    const nextAura: Record<string, "psychic" | "heal" | "impact"> = {};
    for (const event of fresh) {
      if (event.kind === "flip" && event.targetId) nextMotion[event.targetId] = "flip";
      else if (event.actorId) nextMotion[event.actorId] = event.actorId && you && battle?.units.find((u) => u.instanceId === event.actorId)?.faction === you ? "up" : "down";
      if (event.targetId && event.kind === "shield" && event.amount) {
        const prev = nextFloat[event.targetId] ?? "";
        nextFloat[event.targetId] = `${prev}${prev ? " " : ""}${t.shieldWord}-${event.amount}`;
      } else if (event.targetId && event.amount && event.kind === "heal") {
        nextFloat[event.targetId] = `+${event.amount}`;
      } else if (event.targetId && event.amount) {
        const prev = nextFloat[event.targetId] ?? "";
        nextFloat[event.targetId] = `${prev}${prev ? " " : ""}-${event.amount}`;
      } else if (event.targetId && event.text) nextFloat[event.targetId] = event.text;
      if (event.targetId && event.kind === "psychic") nextAura[event.targetId] = "psychic";
      else if (event.targetId && event.kind === "heal") nextAura[event.targetId] = "heal";
      else if (event.targetId && (event.kind === "attack" || event.kind === "poison")) nextAura[event.targetId] = "impact";
      if (event.kind === "heal") playTone("heal", sound.current);
      else if (event.kind === "death" || event.kind === "flip") playTone("death", sound.current);
      else if (event.kind === "psychic" || event.kind === "poison") playTone("warp", sound.current);
      else if (event.amount) playTone("hit", sound.current);
    }
    setMotion(nextMotion);
    setFloats(nextFloat);
    setAuras(nextAura);
    const timer = window.setTimeout(() => {
      setMotion({});
      setFloats({});
      setAuras({});
    }, 900);
    return () => window.clearTimeout(timer);
  }, [battle?.fx, you, t.shieldWord]);

  useEffect(() => {
    if (!version || mode !== "skirmish" || !you) return;
    if (status !== "battle" || phase === you) return;
    if (promptId && battle?.units.find((u) => u.instanceId === promptId)?.owner === you) return;
    const timer = window.setTimeout(() => {
      void botAct({ data: { token, code, version, actionId: actionId() } }).then((res) => {
        if (res.view) take(res.view);
      });
    }, loadFx() === "off" ? 280 : 760);
    return () => window.clearTimeout(timer);
  }, [version, phase, status, promptId, mode, you, code, token]);

  async function send(command: Command) {
    if (!view || sending) return;
    setSending(true);
    setBanner(null);
    try {
      const res = await act({
        data: { token, code, version: view.version, actionId: actionId(), command },
      });
      if (res.view) take(res.view);
      if (!res.ok) setBanner(res.error);
      else {
        setArmed(null);
        setSelected(null);
        setConfirmEnd(false);
      }
    } catch {
      setBanner("行动没有送达");
    } finally {
      setSending(false);
    }
  }

  const mine = you;
  const top = (battle?.units ?? []).filter((u) => u.faction !== mine).sort((a, b) => a.position - b.position);
  const bottom = (battle?.units ?? []).filter((u) => u.faction === mine).sort((a, b) => a.position - b.position);
  const actor =
    battle?.units.find((u) => u.instanceId === selected && u.faction === mine && u.alive && !u.acted) ??
    bottom.find((u) => u.alive && !u.acted);
  const focus = battle?.units.find((u) => u.instanceId === selected) ?? actor;
  const myTurn = Boolean(battle && mine && battle.status === "battle" && battle.phase === mine && !battle.prompt);
  const legal =
    battle && actor && armed
      ? legalTargetIds(
          battle,
          actor.instanceId,
          armed === "attack" ? { type: "attack" } : { type: "skill", skillId: armed },
        )
      : [];

  const readyCount = bottom.filter((u) => u.alive && !u.acted).length;
  const armedSkill = actor && armed && armed !== "attack" ? skillsFor(actor).find((s) => s.id === armed) : null;
  const aim = armedSkill?.target === "ally" ? t.selectAlly : armed ? t.selectEnemy : null;

  function press(id: string) {
    if (!battle || !mine) return;
    const tapped = battle.units.find((u) => u.instanceId === id);
    if (myTurn && armed && actor && legal.includes(id)) {
      const command: Command =
        armed === "attack"
          ? { kind: "attack", actorId: actor.instanceId, targetId: id }
          : { kind: "skill", actorId: actor.instanceId, skillId: armed, targetId: id };
      void send(command);
      return;
    }
    if (myTurn && armed && actor && !legal.includes(id)) {
      const reason = targetReason(
        battle,
        actor.instanceId,
        id,
        armed === "attack" ? { type: "attack" } : { type: "skill", skillId: armed },
      );
      setBanner(reason);
      return;
    }
    setSelected(id);
    setInspect(false);
    if (tapped?.faction === mine) setArmed(null);
  }

  function endPhase() {
    if (readyCount > 0 && !confirmEnd) {
      setConfirmEnd(true);
      return;
    }
    setConfirmEnd(false);
    void send({ kind: "end" });
  }

  return (
    <main className="safe-pad flex h-dvh flex-col bg-void text-ivory">
      <header className="flex items-center justify-between px-3 py-2">
        <Link to="/" className="text-sm text-muted">
          {t.leave}
        </Link>
        <div className="text-center">
          <p className="font-display text-sm text-gold">{code}</p>
          <p className="text-xs text-muted">
            {battle ? `${roundLine(battle.round, battle.phase)} · ${t.remain} ${readyCount}` : t.waiting}
          </p>
        </div>
        <button type="button" className="min-h-11 px-2 text-sm text-steel" onClick={() => setLogOpen(true)}>
          {t.battleLog}
        </button>
      </header>

      {!battle && !error ? (
        <section className="flex flex-1 flex-col items-center justify-center px-6 text-center">
          <p className="text-xs tracking-widest text-gold">{t.roomCode}</p>
          <p className="mt-2 font-display text-5xl tracking-widest">{code}</p>
          <p className="mt-4 max-w-xs text-sm leading-6 text-muted">{t.roomHint}</p>
        </section>
      ) : null}

      {battle ? (
        <>
          <section className="grid grid-cols-5 gap-1 px-2">
            {top.map((unit) => (
              <BattleCard
                key={unit.instanceId}
                unit={unit}
                selected={selected === unit.instanceId}
                legal={legal.includes(unit.instanceId)}
                mark={legal.includes(unit.instanceId) ? tx("可选") : null}
                armed={Boolean(armed)}
                motion={motion[unit.instanceId] ?? ""}
                floater={floats[unit.instanceId] ?? null}
                aura={auras[unit.instanceId] ?? ""}
                onPress={() => press(unit.instanceId)}
              />
            ))}
          </section>
          <section className="scene-prospero relative mx-2 my-2 min-h-28 flex-1 overflow-y-auto rounded-md border border-line">
            <div className="p-3">
              {mode === "skirmish" && you === "chaos" && battle.round === 1 && battle.phase === "imperial" && battle.status === "battle" ? (
                <p className="text-sm text-gold">{t.oppFirst}</p>
              ) : mode === "skirmish" && you && battle.phase !== you && battle.status === "battle" ? (
                <p className="text-sm text-gold">{t.botActing}</p>
              ) : null}
              {aim ? <p className="text-sm text-ivory">{aim}</p> : null}
              {focus ? (
                <>
                  <p className="mt-1 font-display text-xl leading-6">{tx(focus.name)}</p>
                  <p className="text-xs leading-5 text-muted">
                    {tx(focus.role)} · Lv{focus.level} · {basicReach(focus) === "ranged" ? t.rangedTag : t.meleeTag} ·{" "}
                    {focus.position < 2 ? t.frontTag : t.backTag}
                  </p>
                  <p className="text-xs leading-5 text-ivory">
                    {t.statHp} {focus.hp}/{focus.maxHp} · {t.statAtk} {focus.atk} · {t.statDef} {focus.def} · {t.shieldWord}{" "}
                    {focus.shield} · {t.statWp} {focus.wp}/{focus.maxWp}
                  </p>
                  <p className="text-xs text-steel">
                    {t.corruption} {focus.corruption} · {tx(corruptionStage(focus.corruption, focus.faction, focus.fallen))}
                  </p>
                  <button type="button" className="mt-1 min-h-11 text-sm text-gold" onClick={() => setInspect(true)}>
                    {t.detail}
                  </button>
                </>
              ) : null}
              <p className="mt-1 text-sm leading-5 text-ivory">{tx(battle.log[battle.log.length - 1]?.text)}</p>
              {banner ? <p className="mt-1 text-sm text-blood">{tx(banner)}</p> : null}
              {armedSkill ? <p className="mt-1 text-xs leading-5 text-muted">{skillBlurb(armedSkill, actor?.cds[armedSkill.id] ?? 0, t, tx)}</p> : null}
            </div>
          </section>
          <section className="grid grid-cols-5 gap-1 px-2">
            {bottom.map((unit) => (
              <BattleCard
                key={unit.instanceId}
                unit={unit}
                selected={selected === unit.instanceId}
                legal={legal.includes(unit.instanceId)}
                mark={legal.includes(unit.instanceId) ? tx("可选") : null}
                armed={Boolean(armed)}
                motion={motion[unit.instanceId] ?? ""}
                floater={floats[unit.instanceId] ?? null}
                aura={auras[unit.instanceId] ?? ""}
                onPress={() => press(unit.instanceId)}
              />
            ))}
          </section>
          <footer className="grid max-h-40 grid-cols-2 gap-2 overflow-y-auto p-2">
            {confirmEnd ? (
              <>
                <p className="col-span-2 text-sm leading-5 text-ivory">{t.endWarn}</p>
                <Action label={t.endAnyway} disabled={sending} onClick={endPhase} />
                <Action label={t.cancelTarget} onClick={() => setConfirmEnd(false)} />
              </>
            ) : myTurn && actor && actor.faction === mine && actor.alive ? (
              <>
                <Action
                  label={t.basicAttack}
                  onClick={() => {
                    setArmed("attack");
                    setBanner(null);
                  }}
                  active={armed === "attack"}
                />
                {skillsFor(actor).map((skill) => {
                  const cd = actor.cds?.[skill.id] ?? 0;
                  const ready = cd === 0 && actor.wp >= skill.wp;
                  return (
                    <Action
                      key={skill.id}
                      label={`${tx(skill.name)}${cd ? ` · ${cd}` : skill.wp ? ` · ${skill.wp}` : ""}`}
                      disabled={sending}
                      active={armed === skill.id}
                      onClick={() => {
                        if (!ready) {
                          setBanner(cd > 0 ? "技能冷却中" : "灵能不足");
                          setArmed(null);
                          return;
                        }
                        setBanner(null);
                        setArmed(skill.id);
                      }}
                    />
                  );
                })}
                {armed ? (
                  <Action
                    label={t.cancelTarget}
                    onClick={() => {
                      setArmed(null);
                      setBanner(null);
                    }}
                  />
                ) : null}
                <Action label={t.endPhase} disabled={sending} onClick={endPhase} />
              </>
            ) : (
              <p className="col-span-2 py-3 text-center text-sm text-muted">
                {battle.prompt
                  ? t.crisisFirst
                  : battle.status === "battle"
                    ? mode === "skirmish" && you && battle.phase !== you
                      ? you === "chaos" && battle.round === 1
                        ? t.oppFirst
                        : t.botActing
                      : t.waitOther
                    : t.stopped}
              </p>
            )}
          </footer>
        </>
      ) : null}

      {error && !battle ? <p className="px-6 text-center text-sm text-blood">{tx(error)}</p> : null}

      {battle?.prompt && battle.units.find((u) => u.instanceId === battle.prompt?.unitId)?.owner === you ? (
        <Overlay>
          <h2 className="font-display text-2xl">{t.whisperTitle}</h2>
          <p className="mt-2 text-sm leading-6 text-muted">{t.whisperBody}</p>
          <div className="mt-4 grid gap-2">
            <Action label={t.purify} onClick={() => void send({ kind: "crisis", actorId: battle.prompt!.unitId, choice: "purify" })} />
            <Action label={t.retreat} onClick={() => void send({ kind: "crisis", actorId: battle.prompt!.unitId, choice: "retreat" })} />
            <Action label={t.carryOn} onClick={() => void send({ kind: "crisis", actorId: battle.prompt!.unitId, choice: "continue" })} />
          </div>
        </Overlay>
      ) : null}

      {inspect && focus && battle ? (
        <Overlay>
          <div className="flex items-center justify-between">
            <h2 className="font-display text-xl">{tx(focus.name)}</h2>
            <button type="button" className="min-h-11 px-2" onClick={() => setInspect(false)}>
              {t.close}
            </button>
          </div>
          <p className="mt-2 text-sm leading-6 text-muted">
            {tx(focus.role)} · Lv{focus.level} · {basicReach(focus) === "ranged" ? t.rangedTag : t.meleeTag} ·{" "}
            {focus.position < 2 ? t.frontTag : t.backTag} · {!focus.alive ? t.deadTag : focus.acted ? t.hasActed : t.canAct}
          </p>
          <p className="mt-2 text-sm leading-6">
            {t.statHp} {focus.hp}/{focus.maxHp} · {t.statAtk} {focus.atk} · {t.statDef} {focus.def} · {t.shieldWord} {focus.shield} · {t.statWp}{" "}
            {focus.wp}/{focus.maxWp} · {t.corruption} {focus.corruption} · {tx(corruptionStage(focus.corruption, focus.faction, focus.fallen))}
          </p>
          <p className="mt-2 text-sm leading-6 text-ivory">
            {tx(CATALOG[focus.defId]?.passive.name)} · {tx(CATALOG[focus.defId]?.passive.blurb)}
          </p>
          <div className="mt-3 grid gap-2">
            {skillsFor(focus).map((skill) => (
              <p key={skill.id} className="text-sm leading-6">
                {tx(skill.name)} · {skillBlurb(skill, focus.cds?.[skill.id] ?? 0, t, tx)}
              </p>
            ))}
          </div>
        </Overlay>
      ) : null}

      {view?.status === "absorb" && you === "imperial" && view.absorb.length ? (
        <Overlay>
          <h2 className="font-display text-2xl">{t.lootTitle}</h2>
          <p className="mt-2 text-sm text-muted">{t.lootBody}</p>
          <div className="mt-3 grid gap-2">
            {view.absorb.map((row) => (
              <div key={row.instanceId} className="rounded-md border border-line p-3">
                <p>{tx(row.name)}</p>
                <p className="text-xs text-muted">
                  {t.xpWord} {row.xp} · {godText(row.loot, tx, t.energy)}
                </p>
                <div className="mt-2 grid grid-cols-2 gap-2">
                  <button type="button" className={choices[row.instanceId] !== "absorb" ? "min-h-11 rounded-md bg-gold text-void" : "min-h-11 rounded-md border border-line"} onClick={() => setChoices((c) => ({ ...c, [row.instanceId]: "purify" }))}>
                    {t.purify}
                  </button>
                  <button type="button" className={choices[row.instanceId] === "absorb" ? "min-h-11 rounded-md bg-warp text-ivory" : "min-h-11 rounded-md border border-line"} onClick={() => setChoices((c) => ({ ...c, [row.instanceId]: "absorb" }))}>
                    {t.absorb}
                  </button>
                </div>
              </div>
            ))}
          </div>
          <button
            type="button"
            className="mt-3 min-h-12 w-full rounded-md bg-gold text-void"
            onClick={() => {
              if (!view) return;
              void absorbLoot({
                data: {
                  token,
                  code,
                  version: view.version,
                  actionId: actionId(),
                  decisions: view.absorb.map((row) => ({
                    instanceId: row.instanceId,
                    mode: choices[row.instanceId] ?? "purify",
                  })),
                },
              }).then((res) => {
                if (res.view) take(res.view);
                if (!res.ok) setBanner(res.error);
              });
            }}
          >
            {t.confirmLoot}
          </button>
        </Overlay>
      ) : null}

      {battle?.status === "finished" && battle.summary ? (
        <Overlay>
          <p className="text-xs tracking-widest text-gold">{battle.summary.winner === you ? t.victory : battle.summary.winner ? t.defeat : t.draw}</p>
          <h2 className="mt-1 font-display text-2xl">{tx(battle.summary.title)}</h2>
          <div className="mt-3 max-h-64 space-y-2 overflow-y-auto">
            {battle.summary.lines.map((line) => (
              <p key={line.instanceId} className="text-sm">
                {line.levels ? <span className="fx-pillar" aria-hidden="true" /> : null}
                {tx(line.name)} · {t.xpWord} {line.xp}
                {line.levels ? ` · ${levelUp(line.levels)}` : ""}
                {line.note ? ` · ${tx(line.note)}` : ""}
              </p>
            ))}
          </div>
          {battle.summary.gear ? <p className="mt-2 text-sm text-gold">{tx(battle.summary.gear)}</p> : null}
          <button
            type="button"
            className="mt-4 min-h-12 w-full rounded-md bg-gold text-void"
            onClick={() => {
              if (!view) return;
              void requestRematch({
                data: { token, code, version: view.version, actionId: actionId() },
              }).then((res) => {
                if (res.view) take(res.view);
                if (!res.ok) setBanner(res.error);
              });
            }}
          >
            {battle.rematch[you ?? "imperial"] ? t.rematchAsked : t.rematch}
          </button>
          <Link to="/roster" className="mt-2 flex min-h-11 items-center justify-center text-sm text-steel">
            {t.growth}
          </Link>
        </Overlay>
      ) : null}

      {logOpen && battle ? (
        <Overlay>
          <div className="flex items-center justify-between">
            <h2 className="font-display text-xl">{t.logTitle}</h2>
            <button type="button" className="min-h-11 px-2" onClick={() => setLogOpen(false)}>
              {t.close}
            </button>
          </div>
          <ol className="mt-3 max-h-[60vh] space-y-2 overflow-y-auto">
            {battle.log.map((line) => (
              <li key={line.id} className={line.tone === "death" || line.tone === "warp" ? "text-sm text-gold" : "text-sm text-ivory"}>
                {tx(line.text)}
              </li>
            ))}
          </ol>
        </Overlay>
      ) : null}
    </main>
  );
}

function skillBlurb(
  skill: SkillDef,
  cd: number,
  t: { costNone: string; statWp: string; selectAlly: string; selectEnemy: string; meleeTag: string; rangedTag: string },
  tx: (text: string | null | undefined) => string,
): string {
  const cost = skill.wp > 0 ? `${skill.wp} ${t.statWp}` : t.costNone;
  const scale = skill.scale ? `${Math.round(skill.scale * 100)}%` : "";
  const who = skill.target === "ally" ? t.selectAlly : t.selectEnemy;
  const reach = skill.reach === "melee" ? t.meleeTag : t.rangedTag;
  return `${tx(skill.blurb)} · ${cost} · ${who} · ${reach}${scale ? ` · ${scale}` : ""}${cd ? ` · ${cd}` : ""}`;
}

function Action({
  label,
  onClick,
  disabled,
  active,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  active?: boolean;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={
        active
          ? "min-h-12 whitespace-normal rounded-md bg-gold px-2 text-center text-sm leading-5 text-void disabled:opacity-40"
          : "min-h-12 whitespace-normal rounded-md border border-line bg-ink px-2 text-center text-sm leading-5 text-ivory disabled:opacity-40"
      }
    >
      {label}
    </button>
  );
}

function Overlay({ children }: { children: ReactNode }) {
  return (
    <div className="fixed inset-0 z-20 flex items-end justify-center bg-void/80 p-3 sm:items-center">
      <section className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-md border border-line bg-panel p-4">
        {children}
      </section>
    </div>
  );
}

function godText(
  loot: { khorne: number; tzeentch: number; nurgle: number; slaanesh: number },
  tx: (text: string | null | undefined) => string,
  energy: string,
): string {
  const bits = (Object.keys(loot) as (keyof typeof loot)[])
    .filter((god) => loot[god] > 0)
    .map((god) => `${tx(GOD_LABEL[god])} ${loot[god]}`);
  return bits.join(" · ") || `${energy} ${godSum(loot)}`;
}
