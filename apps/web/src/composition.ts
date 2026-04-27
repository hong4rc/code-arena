// Composition root: wires concrete adapters into use-case instances.
// Every page / route / server hook reaches in here for use cases — never to
// adapters or to Drizzle directly. This is the ONLY file that knows how things
// are wired up.
//
// Built lazily on first access so that `next build` page-data collection
// doesn't trip over a missing DATABASE_URL at compile time.
import {
  AcornValidator,
  DrizzleBotParamsRepo,
  DrizzleBotRepo,
  DrizzleMatchRepo,
  DrizzleQueueRepo,
  DrizzleRatingRepo,
  DrizzleSeasonRepo,
  DrizzleUserRepo,
  InProcessEventPublisher,
  NsjailSandbox,
  SystemClock,
} from "@arena/adapters";
import {
  CloneBotUseCase,
  CreateCustomMatchUseCase,
  DeleteBotUseCase,
  DeleteMatchUseCase,
  GetOrCreateUserUseCase,
  RunMatchUseCase,
  SaveBotUseCase,
  ScheduleAutoMatchesUseCase,
  WipeMatchesUseCase,
} from "@arena/application";

interface BuiltComposition {
  repos: {
    users: DrizzleUserRepo;
    bots: DrizzleBotRepo;
    botParams: DrizzleBotParamsRepo;
    matches: DrizzleMatchRepo;
    ratings: DrizzleRatingRepo;
    seasons: DrizzleSeasonRepo;
    queue: DrizzleQueueRepo;
  };
  events: InProcessEventPublisher;
  clock: SystemClock;
  saveBot: SaveBotUseCase;
  cloneBot: CloneBotUseCase;
  getOrCreateUser: GetOrCreateUserUseCase;
  runMatch: RunMatchUseCase;
  scheduleAutoMatches: ScheduleAutoMatchesUseCase;
  deleteBot: DeleteBotUseCase;
  deleteMatch: DeleteMatchUseCase;
  wipeMatches: WipeMatchesUseCase;
  createCustomMatch: CreateCustomMatchUseCase;
}

let _built: BuiltComposition | null = null;

function build(): BuiltComposition {
  const users = new DrizzleUserRepo();
  const bots = new DrizzleBotRepo();
  const botParams = new DrizzleBotParamsRepo();
  const matches = new DrizzleMatchRepo();
  const ratings = new DrizzleRatingRepo();
  const seasons = new DrizzleSeasonRepo();
  const queue = new DrizzleQueueRepo();
  const validator = new AcornValidator();
  const sandbox = new NsjailSandbox();
  const clock = new SystemClock();
  const events = new InProcessEventPublisher();

  return {
    repos: { users, bots, botParams, matches, ratings, seasons, queue },
    events,
    clock,
    saveBot: new SaveBotUseCase({ bots, validator }),
    cloneBot: new CloneBotUseCase({ bots }),
    getOrCreateUser: new GetOrCreateUserUseCase({ users }),
    runMatch: new RunMatchUseCase({
      bots, matches, ratings, sandbox, events, clock, botParams,
      // 0 = run flat-out. Useful for tests; in dev/prod the engine + 100 ms
      // bot timeout already paces the loop to ~10 ticks/sec on its own.
      tickFloorMs: Number(process.env.TICK_FLOOR_MS ?? 0),
    }),
    scheduleAutoMatches: new ScheduleAutoMatchesUseCase(
      { bots, matches, ratings, seasons, queue },
      {
        matchesPerCycle: Number(process.env.SCHEDULE_MATCHES_PER_CYCLE ?? 3),
        matchSize: Number(process.env.SCHEDULE_MATCH_SIZE ?? 10),
        minBotsToRun: Number(process.env.SCHEDULE_MIN_BOTS ?? 20),
      },
    ),
    deleteBot: new DeleteBotUseCase({ bots }),
    deleteMatch: new DeleteMatchUseCase({ matches }),
    wipeMatches: new WipeMatchesUseCase({ matches }),
    createCustomMatch: new CreateCustomMatchUseCase({ bots, matches, seasons }),
  };
}

export const composition = new Proxy({} as BuiltComposition, {
  get(_t, prop) {
    if (!_built) _built = build();
    return _built[prop as keyof BuiltComposition];
  },
});

export type Composition = BuiltComposition;
