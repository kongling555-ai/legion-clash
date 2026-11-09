import { createFileRoute } from "@tanstack/react-router";
import { LobbyScreen } from "@/components/game/lobby-screen";

export const Route = createFileRoute("/lobby")({ component: LobbyScreen });
