export interface QueueRepo {
  /** Bots currently waiting in the matchmaking queue. */
  enqueued(): Promise<string[]>;
  /** Drain a list of bots from the queue (e.g. after they've been placed in a match). */
  drain(botIds: string[]): Promise<void>;
}
