import { createFileRoute } from "@tanstack/react-router";
import { BattleScreen } from "@/components/game/battle-screen";

export const Route = createFileRoute("/battle/$code")({
  component: BattleRoute,
});

function BattleRoute() {
  const { code } = Route.useParams();
  return <BattleScreen code={code} />;
}
