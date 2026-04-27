export interface Season {
  id: string;
  name: string;
  isActive: boolean;
  startedAt: Date;
  endedAt: Date | null;
  configId: string | null;
}

export interface SeasonRepo {
  findActive(): Promise<Season | null>;
}
