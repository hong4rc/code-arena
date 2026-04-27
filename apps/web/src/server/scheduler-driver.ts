/* eslint-disable no-console */
import { composition } from "@/composition";

// Configurable so dev can run a fast loop and prod can stick with 5 min.
const CYCLE_MS = Number(process.env.SCHEDULE_CYCLE_MS ?? 5 * 60 * 1000);
const FIRST_DELAY_MS = Number(process.env.SCHEDULE_FIRST_DELAY_MS ?? 5000);

let timer: ReturnType<typeof setInterval> | null = null;

export function startSchedulerDriver(): void {
  if (timer) return;
  console.log(`[scheduler] starting (first run in ${FIRST_DELAY_MS / 1000}s, then every ${CYCLE_MS / 1000}s)`);
  setTimeout(() => void runOnce(), FIRST_DELAY_MS);
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
