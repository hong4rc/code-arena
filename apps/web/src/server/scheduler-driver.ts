/* eslint-disable no-console */
import { composition } from "@/composition";

const CYCLE_MS = 5 * 60 * 1000;

let timer: ReturnType<typeof setInterval> | null = null;

export function startSchedulerDriver(): void {
  if (timer) return;
  console.log("[scheduler] starting (cycle = 5min)");
  setTimeout(() => void runOnce(), 30000);
  timer = setInterval(() => void runOnce(), CYCLE_MS);
}

export function stopSchedulerDriver(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}

async function runOnce(): Promise<void> {
  try {
    const result = await composition.scheduleAutoMatches.execute();
    if (result.created > 0) console.log(`[scheduler] created ${result.created} matches`);
  } catch (error) {
    console.error("[scheduler]", error);
  }
}
