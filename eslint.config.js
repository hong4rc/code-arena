import js from "@eslint/js";
import nextPlugin from "@next/eslint-plugin-next";
import tseslint from "@typescript-eslint/eslint-plugin";
import tsparser from "@typescript-eslint/parser";
import importX from "eslint-plugin-import-x";
import jsxA11y from "eslint-plugin-jsx-a11y";
import reactHooks from "eslint-plugin-react-hooks";
import unicorn from "eslint-plugin-unicorn";

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
  window: "readonly",
  document: "readonly",
  WebSocket: "readonly",
};

const browserReactGlobals = {
  ...runtimeGlobals,
  HTMLCanvasElement: "readonly",
  CanvasRenderingContext2D: "readonly",
  MessageEvent: "readonly",
  React: "readonly",
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

const importRules = {
  "import-x/order": [
    "error",
    {
      groups: ["builtin", "external", "internal", "parent", "sibling", "index", "type"],
      "newlines-between": "always",
      alphabetize: { order: "asc", caseInsensitive: true },
      pathGroups: [
        { pattern: "@arena/**", group: "internal", position: "before" },
        { pattern: "@/**", group: "internal", position: "after" },
      ],
      pathGroupsExcludedImportTypes: ["builtin"],
    },
  ],
  "import-x/no-cycle": ["error", { maxDepth: 8 }],
  "import-x/no-self-import": "error",
  "import-x/no-useless-path-segments": "error",
  "import-x/first": "error",
  "import-x/newline-after-import": "error",
  "import-x/no-duplicates": "error",
};

const unicornRules = {
  ...unicorn.configs.recommended.rules,
  "unicorn/filename-case": "off",
  "unicorn/prevent-abbreviations": "off",
  "unicorn/no-null": "off",
  "unicorn/no-array-callback-reference": "off",
  "unicorn/no-array-reduce": "off",
  "unicorn/prefer-top-level-await": "off",
  "unicorn/no-useless-undefined": "off",
  "unicorn/prefer-global-this": "off",
  "unicorn/prefer-module": "off",
  "unicorn/no-process-exit": "off",
  "unicorn/numeric-separators-style": ["error", { number: { minimumDigits: 6 } }],
  "unicorn/import-style": "off",            // named imports from node:* are idiomatic
  "unicorn/no-array-sort": "off",           // .toSorted() requires ES2023; .sort() is fine
};

// react-hooks — rules of hooks + exhaustive-deps. The critical pair.
const reactHooksRules = {
  ...reactHooks.configs.recommended.rules,
};

const a11yRules = {
  ...jsxA11y.configs.recommended.rules,
};

const nextRules = {
  ...nextPlugin.configs.recommended.rules,
  ...nextPlugin.configs["core-web-vitals"].rules,
};

const tsLanguageOptions = (project) => ({
  parser: tsparser,
  parserOptions: { project, tsconfigRootDir: import.meta.dirname },
});

export default [
  {
    ignores: [
      "**/dist/**",
      "**/.next/**",
      "**/node_modules/**",
      "**/*.config.js",
      "**/next.config.mjs",
      "**/next-env.d.ts",
      "**/drizzle/**",
    ],
  },
  js.configs.recommended,

  // ── Bot harness (full Node access) ────────────────────────────────
  {
    files: ["bots/runtime/**/*.js"],
    plugins: { unicorn, "import-x": importX },
    languageOptions: { globals: runtimeGlobals, ecmaVersion: 2022, sourceType: "module" },
    rules: {
      ...baseRules,
      ...unicornRules,
      ...importRules,
      "no-console": "off",
    },
  },

  // ── Sample bots (single-file, helpers as globals) ─────────────────
  {
    files: ["bots/samples/**/*.js"],
    plugins: { unicorn },
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
    rules: { ...baseRules, ...unicornRules, "no-console": "off" },
  },

  // ── packages/* — strict type-checked TS + import + unicorn ────────
  {
    files: ["packages/**/*.ts"],
    plugins: { "@typescript-eslint": tseslint, "import-x": importX, unicorn },
    languageOptions: { ...tsLanguageOptions("./tsconfig.json"), globals: runtimeGlobals },
    settings: {
      "import-x/resolver": { typescript: { project: "./tsconfig.json" } },
    },
    rules: {
      ...baseRules,
      ...baseTsRules,
      ...tseslint.configs["recommended-type-checked"].rules,
      ...importRules,
      ...unicornRules,
    },
  },

  // ── apps/web TypeScript files (server + client) ───────────────────
  {
    files: ["apps/web/**/*.{ts,tsx}", "apps/web/server.ts"],
    plugins: {
      "@typescript-eslint": tseslint,
      "import-x": importX,
      unicorn,
      "@next/next": nextPlugin,
    },
    languageOptions: { ...tsLanguageOptions("apps/web/tsconfig.json"), globals: browserReactGlobals },
    settings: {
      "import-x/resolver": { typescript: { project: "apps/web/tsconfig.json" } },
      next: { rootDir: "apps/web" },
    },
    rules: {
      ...baseRules,
      ...baseTsRules,
      ...importRules,
      ...unicornRules,
      ...nextRules,
      // Next.js routes/pages MUST default-export.
      "import-x/no-default-export": "off",
      "unicorn/no-anonymous-default-export": "off",
    },
  },

  // ── apps/web TSX files: hooks + a11y on top ──────────────────────
  {
    files: ["apps/web/**/*.tsx"],
    plugins: {
      "react-hooks": reactHooks,
      "jsx-a11y": jsxA11y,
    },
    languageOptions: {
      ...tsLanguageOptions("apps/web/tsconfig.json"),
      globals: browserReactGlobals,
      parserOptions: {
        project: "apps/web/tsconfig.json",
        tsconfigRootDir: import.meta.dirname,
        ecmaFeatures: { jsx: true },
      },
    },
    rules: {
      ...reactHooksRules,
      ...a11yRules,
    },
  },
];
