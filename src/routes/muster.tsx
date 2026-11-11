import { createFileRoute } from "@tanstack/react-router";
import { MusterScreen } from "@/components/game/muster-screen";

export const Route = createFileRoute("/muster")({
  component: MusterScreen,
});
