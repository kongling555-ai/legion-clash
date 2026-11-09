export type FxLevel = "full" | "low" | "off";
export type Lang = "zh" | "en";

const TOKEN = "legion.token.v1";
const FX = "legion.fx.v1";
const SOUND = "legion.sound.v1";
const LANG = "legion.lang.v1";

export function playerToken(): string {
  const existing = localStorage.getItem(TOKEN);
  if (existing && /^[a-f0-9]{32}$/.test(existing)) return existing;
  const token = crypto.randomUUID().replace(/-/g, "").slice(0, 32);
  localStorage.setItem(TOKEN, token);
  return token;
}

export function loadFx(): FxLevel {
  const value = localStorage.getItem(FX);
  if (value === "low" || value === "off" || value === "full") return value;
  return "full";
}

export function saveFx(value: FxLevel): void {
  localStorage.setItem(FX, value);
}

export function loadSound(): boolean {
  return localStorage.getItem(SOUND) !== "0";
}

export function saveSound(on: boolean): void {
  localStorage.setItem(SOUND, on ? "1" : "0");
}

export function loadLang(): Lang {
  return localStorage.getItem(LANG) === "en" ? "en" : "zh";
}

export function saveLang(lang: Lang): void {
  localStorage.setItem(LANG, lang);
}

export function actionId(): string {
  return crypto.randomUUID();
}
