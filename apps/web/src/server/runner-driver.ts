/* eslint-disable no-console */
import { composition } from "@/composition";

const PUMP_MS = 2000;

let timer: ReturnType<typeof setInterval> | null = null;

export function startRunnerDriver(): void {
  if (timer) return;
  console.log("[runner] pump starting");
  timer = setInterval(() => void pumpOnce(), PUMP_MS);
}

export function stopRunnerDriver(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}

async function pumpOnce(): Promise<void> {
  try {
    const pending = await composition.repos.matches.pickPending(1);
    for (const m of pending) {
      await composition.runMatch.execute(m.id);
    }
  } catch (error) {
    console.error("[runner pump]", error);
  }
}
