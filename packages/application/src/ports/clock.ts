/** Time, abstracted for testability. */
export interface Clock {
  now(): Date;
}
