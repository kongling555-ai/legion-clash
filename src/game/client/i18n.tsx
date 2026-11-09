import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { UI, cardName, translateText, type Dict } from "@/game/client/copy";
import { loadLang, saveLang, type Lang } from "@/game/client/prefs";
import type { God } from "@/game/engine/types";

type CardUnit = { defId: string; name: string; fallen: boolean; fallenGod: God | null };

type I18n = {
  lang: Lang;
  setLang: (lang: Lang) => void;
  t: Dict;
  tx: (text: string | null | undefined) => string;
  card: (unit: CardUnit) => string;
  roundLine: (round: number, phase: "imperial" | "chaos") => string;
  levelMark: (level: number) => string;
  freePoints: (points: number) => string;
  levelUp: (levels: number) => string;
};

const Ctx = createContext<I18n | null>(null);

export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>("zh");

  useEffect(() => {
    setLangState(loadLang());
  }, []);

  useEffect(() => {
    document.documentElement.lang = lang === "en" ? "en" : "zh-CN";
    document.title = UI[lang].docTitle;
  }, [lang]);

  const value = useMemo<I18n>(() => {
    const t = UI[lang];
    return {
      lang,
      setLang: (next) => {
        saveLang(next);
        setLangState(next);
      },
      t,
      tx: (text) => translateText(lang, text),
      card: (unit) => cardName(lang, unit),
      roundLine: (round, phase) => {
        const side = phase === "imperial" ? t.imperial : t.chaos;
        return lang === "en" ? `Round ${round} · ${side}` : `第 ${round} 回合 · ${side}`;
      },
      levelMark: (level) => (lang === "en" ? `Lv ${level}` : `${level}级`),
      freePoints: (points) => (lang === "en" ? `Free points ${points}. ${t.pointsNote}` : `自由属性点 ${points}。${t.pointsNote}`),
      levelUp: (levels) => (lang === "en" ? `Level +${levels}` : `升级 ${levels}`),
    };
  }, [lang]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useI18n(): I18n {
  const value = useContext(Ctx);
  if (!value) throw new Error("useI18n outside provider");
  return value;
}
