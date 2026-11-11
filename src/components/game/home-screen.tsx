import { Link } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { unlockAudio } from "@/game/client/audio";
import { useI18n } from "@/game/client/i18n";
import { loadFx, loadSound, saveFx, saveSound, type FxLevel, type Lang } from "@/game/client/prefs";

export function HomeScreen() {
  const { t, lang, setLang } = useI18n();
  const [fx, setFx] = useState<FxLevel>("full");
  const [sound, setSound] = useState(true);
  const [open, setOpen] = useState(false);
  const panelRef = useRef<HTMLElement>(null);

  useEffect(() => {
    if (!open) return;
    panelRef.current?.scrollIntoView({ block: "end" });
  }, [open, lang]);

  useEffect(() => {
    setFx(loadFx());
    setSound(loadSound());
    document.documentElement.dataset.fx = loadFx();
    const unlock = () => unlockAudio();
    window.addEventListener("pointerdown", unlock);
    return () => window.removeEventListener("pointerdown", unlock);
  }, []);

  function chooseFx(value: FxLevel) {
    setFx(value);
    saveFx(value);
    document.documentElement.dataset.fx = value;
  }

  function chooseLang(next: Lang) {
    setLang(next);
  }

  return (
    <main className="safe-pad relative min-h-dvh overflow-x-hidden bg-void text-ivory">
      <div className="scene-prospero absolute inset-0 opacity-70" />
      <div className="relative mx-auto flex min-h-dvh max-w-lg flex-col justify-end px-5 py-8">
        <p className="text-xs tracking-widest text-gold">{t.kicker}</p>
        <h1 className="mt-2 font-display text-4xl text-ivory">{t.gameTitle}</h1>
        <p className="mt-2 max-w-sm text-sm leading-6 text-muted">{t.homeBlurb}</p>
        <div className="mt-6 grid grid-cols-2 gap-3">
          <img src="/portraits/gk-justicar.jpg" alt="" className="aspect-[2/3] w-full rounded-md border border-gold-2 object-cover" />
          <img src="/portraits/ts-sorc.jpg" alt="" className="aspect-[2/3] w-full rounded-md border border-warp object-cover" />
        </div>
        <div className="mt-6 grid gap-3">
          <Link
            to="/lobby"
            className="flex min-h-12 items-center justify-center rounded-md bg-gold text-center font-display text-void"
          >
            {t.enterLobby}
          </Link>
          <Link
            to="/muster"
            className="flex min-h-12 items-center justify-center rounded-md border border-steel bg-ink text-ivory"
          >
            {t.skirmish}
          </Link>
          <Link
            to="/roster"
            className="flex min-h-12 items-center justify-center rounded-md border border-line bg-panel text-gold"
          >
            {t.roster}
          </Link>
          <button type="button" onClick={() => setOpen((v) => !v)} className="min-h-12 rounded-md text-muted">
            {t.settings}
          </button>
        </div>
        {open ? (
          <section ref={panelRef} className="mt-2 rounded-md border border-line bg-panel p-4">
            <p className="text-sm text-ivory">{t.language}</p>
            <div className="mt-2 grid grid-cols-2 gap-2">
              {(
                [
                  ["zh", "中文"],
                  ["en", "English"],
                ] as const
              ).map(([id, label]) => (
                <button
                  key={id}
                  type="button"
                  aria-pressed={lang === id}
                  onClick={() => chooseLang(id)}
                  className={lang === id ? "min-h-11 rounded-md bg-gold text-void" : "min-h-11 rounded-md border border-line text-ivory"}
                >
                  {label}
                </button>
              ))}
            </div>
            <p className="mt-4 text-sm text-ivory">{t.animation}</p>
            <div className="mt-2 grid grid-cols-3 gap-2">
              {(
                [
                  ["full", t.fxFull],
                  ["low", t.fxLow],
                  ["off", t.fxOff],
                ] as const
              ).map(([id, label]) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => chooseFx(id)}
                  className={fx === id ? "min-h-11 rounded-md bg-gold text-void" : "min-h-11 rounded-md border border-line text-ivory"}
                >
                  {label}
                </button>
              ))}
            </div>
            <button
              type="button"
              className="mt-3 min-h-11 w-full rounded-md border border-line"
              onClick={() => {
                const next = !sound;
                setSound(next);
                saveSound(next);
              }}
            >
              {sound ? t.soundOn : t.soundOff}
            </button>
          </section>
        ) : null}
      </div>
    </main>
  );
}
