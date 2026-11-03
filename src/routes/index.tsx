import { createFileRoute } from "@tanstack/react-router";
import { DexParseApp } from "@/components/dexparse/dex-parse-app";

export const Route = createFileRoute("/")({ component: DexParseApp });
