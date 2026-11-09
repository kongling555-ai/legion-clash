import { Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { createRoom, joinRoom } from "@/game/server/api";
import { useI18n } from "@/game/client/i18n";
import { playerToken } from "@/game/client/prefs";

export function LobbyScreen() {
  const navigate = useNavigate();
  const { t, tx } = useI18n();
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState<"create" | "join" | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function create() {
    setBusy("create");
    setError(null);
    try {
      const res = await createRoom({ data: { token: playerToken() } });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      await navigate({ to: "/battle/$code", params: { code: res.view.code } });
    } catch {
      setError("房间没有创建成功");
    } finally {
      setBusy(null);
    }
  }

  async function join() {
    const next = code.trim().toUpperCase();
    if (!/^[A-Z0-9]{4}$/.test(next)) {
      setError("房间号是四位字母或数字");
      return;
    }
    setBusy("join");
    setError(null);
    try {
      const res = await joinRoom({ data: { token: playerToken(), code: next } });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      await navigate({ to: "/battle/$code", params: { code: res.view.code } });
    } catch {
      setError("没能进入房间");
    } finally {
      setBusy(null);
    }
  }

  return (
    <main className="safe-pad mx-auto flex min-h-dvh max-w-lg flex-col bg-void px-5 py-6 text-ivory">
      <Link to="/" className="text-sm text-muted">
        {t.back}
      </Link>
      <p className="mt-6 text-xs tracking-widest text-gold">{t.lobbyKicker}</p>
      <h1 className="mt-2 font-display text-3xl">{t.lobbyTitle}</h1>
      <p className="mt-2 text-sm leading-6 text-muted">{t.lobbyBlurb}</p>
      <button
        type="button"
        disabled={busy !== null}
        onClick={() => void create()}
        className="mt-8 min-h-12 rounded-md bg-gold font-display text-void disabled:opacity-40"
      >
        {busy === "create" ? t.creatingRoom : t.createRoom}
      </button>
      <label className="mt-8 text-sm text-muted" htmlFor="room-code">
        {t.joinRoom}
      </label>
      <input
        id="room-code"
        value={code}
        autoCapitalize="characters"
        autoCorrect="off"
        maxLength={4}
        onChange={(event) => setCode(event.target.value.toUpperCase())}
        placeholder={t.roomPlaceholder}
        className="mt-2 min-h-12 rounded-md border border-line bg-ink px-4 font-display text-2xl tracking-widest text-ivory outline-none"
      />
      <button
        type="button"
        disabled={busy !== null}
        onClick={() => void join()}
        className="mt-3 min-h-12 rounded-md border border-warp text-ivory disabled:opacity-40"
      >
        {busy === "join" ? t.joining : t.joinChaos}
      </button>
      {error ? <p className="mt-4 text-sm text-blood">{tx(error)}</p> : null}
    </main>
  );
}
