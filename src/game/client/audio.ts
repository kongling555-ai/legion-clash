let ctx: AudioContext | null = null;

function context(): AudioContext | null {
  if (typeof window === "undefined") return null;
  if (!ctx) {
    const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return null;
    ctx = new Ctx();
  }
  return ctx;
}

export function unlockAudio(): void {
  const audio = context();
  if (audio && audio.state === "suspended") void audio.resume();
}

export function playTone(kind: "hit" | "heal" | "warp" | "death", enabled: boolean): void {
  if (!enabled) return;
  const audio = context();
  if (!audio || audio.state !== "running") return;
  const osc = audio.createOscillator();
  const gain = audio.createGain();
  const now = audio.currentTime;
  const freq = kind === "heal" ? 520 : kind === "warp" ? 180 : kind === "death" ? 90 : 240;
  osc.type = kind === "heal" ? "triangle" : "sawtooth";
  osc.frequency.setValueAtTime(freq, now);
  if (kind === "hit") osc.frequency.exponentialRampToValueAtTime(80, now + 0.12);
  gain.gain.setValueAtTime(0.0001, now);
  gain.gain.exponentialRampToValueAtTime(0.05, now + 0.02);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + (kind === "death" ? 0.35 : 0.16));
  osc.connect(gain);
  gain.connect(audio.destination);
  osc.start(now);
  osc.stop(now + 0.4);
}
