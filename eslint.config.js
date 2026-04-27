import js from "@eslint/js";
import tseslint from "@typescript-eslint/eslint-plugin";
import tsparser from "@typescript-eslint/parser";

const runtimeGlobals = {
  Bun: "readonly",
  Buffer: "readonly",
  process: "readonly",
  console: "readonly",
  performance: "readonly",
  setTimeout: "readonly",
  clearTimeout: "readonly",
  setInterval: "readonly",
  clearInterval: "readonly",
  TextEncoder: "readonly",
  TextDecoder: "readonly",
  URL: "readonly",
  fetch: "readonly",
  // Browser globals (for React components)
  window: "readonly",
  document: "readonly",
  WebSocket: "readonly",
};

const browserReactGlobals = {
  ...runtimeGlobals,
  HTMLCanvasElement: "readonly",
  CanvasRenderingContext2D: "readonly",
  MessageEvent: "readonly",
};

const baseRules = {
  "no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
  "no-console": ["warn", { allow: ["warn", "error"] }],
  eqeqeq: ["error", "always"],
};

const baseTsRules = {
  ...tseslint.configs.recommended.rules,
  "@typescript-eslint/no-unused-vars": [
    "error",
    { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
  ],
  "@typescript-eslint/consistent-type-imports": "error",
  "@typescript-eslint/no-explicit-any": "error",
  "no-unused-vars": "off",
};

export default [
  {
    ignores: [
      "**/dist/**",
      "**/.next/**",
      "**/node_modules/**",
      "**/*.config.js",
      "**/next.config.mjs",
    ],
  },
  js.configs.recommended,
  // Bot harness (full Node access).
  {
    files: ["bots/runtime/**/*.js"],
    languageOptions: { globals: runtimeGlobals, ecmaVersion: 2022, sourceType: "module" },
    rules: { ...baseRules, "no-console": "off" },
  },
  // Sample bots: single-file, reference helpers as globals (injected by harness).
  {
    files: ["bots/samples/**/*.js"],
    languageOptions: {
      globals: {
        ...runtimeGlobals,
        DIRS: "readonly",
        adjacent: "readonly",
        here: "readonly",
        nearest: "readonly",
        nearestBot: "readonly",
        nearestItem: "readonly",
        visibleBots: "readonly",
        visibleItems: "readonly",
        adjacentBots: "readonly",
        adjacentItems: "readonly",
        canMove: "readonly",
        canAttack: "readonly",
        canKill: "readonly",
        canPickup: "readonly",
        attackRange: "readonly",
        bestAttackDir: "readonly",
        smartMove: "readonly",
        scanLine: "readonly",
        turn: "readonly",
        hasItem: "readonly",
        hpFraction: "readonly",
        lowHp: "readonly",
        dirTo: "readonly",
        fleeFrom: "readonly",
        opposite: "readonly",
        safestDir: "readonly",
        dist: "readonly",
        pickRandom: "readonly",
        log: "readonly",
      },
      ecmaVersion: 2022,
      sourceType: "module",
    },
    rules: { ...baseRules, "no-console": "off" },
  },
  // packages/* — strict type-checked TS
  {
    files: ["packages/**/*.ts"],
    languageOptions: {
      parser: tsparser,
      parserOptions: { project: "./tsconfig.json", tsconfigRootDir: import.meta.dirname },
      globals: runtimeGlobals,
    },
    plugins: { "@typescript-eslint": tseslint },
    rules: {
      ...baseRules,
      ...baseTsRules,
      ...tseslint.configs["recommended-type-checked"].rules,
    },
  },
  // apps/web — lighter rules (Next.js / React introduces many `any`s; tsc enforces correctness).
  {
    files: ["apps/web/**/*.{ts,tsx}", "apps/web/server.ts"],
    languageOptions: {
      parser: tsparser,
      parserOptions: { project: "apps/web/tsconfig.json", tsconfigRootDir: import.meta.dirname },
      globals: browserReactGlobals,
    },
    plugins: { "@typescript-eslint": tseslint },
    rules: {
      ...baseRules,
      ...baseTsRules,
    },
  },
];
