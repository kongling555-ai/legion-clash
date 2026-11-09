import { createFileRoute } from "@tanstack/react-router";
import { HomeScreen } from "@/components/game/home-screen";

export const Route = createFileRoute("/")({ component: HomeScreen });
