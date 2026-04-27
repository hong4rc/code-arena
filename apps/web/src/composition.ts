// Composition root: wires concrete adapters into use-case instances.
// Every page / route / server hook reaches in here for use cases — never to
// adapters or to Drizzle directly. This is the ONLY file that knows how things
// are wired up.
//
// Built lazily on first access so that `next build` page-data collection
// doesn't trip over a missing DATABASE_URL at compile time.
import {
  AcornValidator,
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
  GetOrCreateUserUseCase,
  RunMatchUseCase,
  SaveBotUseCase,
  ScheduleAutoMatchesUseCase,
} from "@arena/application";

interface BuiltComposition {
  repos: {
    users: DrizzleUserRepo;
    bots: DrizzleBotRepo;
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
}

let _built: BuiltComposition | null = null;

function build(): BuiltComposition {
  const users = new DrizzleUserRepo();
  const bots = new DrizzleBotRepo();
  const matches = new DrizzleMatchRepo();
  const ratings = new DrizzleRatingRepo();
  const seasons = new DrizzleSeasonRepo();
  const queue = new DrizzleQueueRepo();
  const validator = new AcornValidator();
  const sandbox = new NsjailSandbox();
  const clock = new SystemClock();
  const events = new InProcessEventPublisher();

  return {
    repos: { users, bots, matches, ratings, seasons, queue },
    events,
    clock,
    saveBot: new SaveBotUseCase({ bots, validator }),
    cloneBot: new CloneBotUseCase({ bots }),
    getOrCreateUser: new GetOrCreateUserUseCase({ users }),
    runMatch: new RunMatchUseCase({ bots, matches, ratings, sandbox, events, clock }),
    scheduleAutoMatches: new ScheduleAutoMatchesUseCase({ bots, matches, ratings, seasons, queue }),
  };
}

export const composition = new Proxy({} as BuiltComposition, {
  get(_t, prop) {
    if (!_built) _built = build();
    return _built[prop as keyof BuiltComposition];
  },
});

export type Composition = BuiltComposition;
