import { createFileRoute } from "@tanstack/react-router";
import { RosterScreen } from "@/components/game/roster-screen";

export const Route = createFileRoute("/roster")({ component: RosterScreen });
