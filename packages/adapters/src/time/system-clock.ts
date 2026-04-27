import type { Clock } from "@arena/application";

export class SystemClock implements Clock {
  now(): Date {
    return new Date();
  }
}
