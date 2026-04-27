import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { getDb, uuidv7 } from "@arena/db";

const baseUrl = process.env.AUTH_URL ?? process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _auth: any = null;

function build() {
  return betterAuth({
    baseURL: baseUrl,
    secret: process.env.AUTH_SECRET ?? "dev-only-not-for-production",
    database: drizzleAdapter(getDb(), { provider: "pg" }),
    advanced: { database: { generateId: uuidv7 } },
    socialProviders: {
      google: {
        clientId: process.env.GOOGLE_CLIENT_ID ?? "",
        clientSecret: process.env.GOOGLE_CLIENT_SECRET ?? "",
      },
    },
    session: {
      expiresIn: 60 * 60 * 24 * 30,
      updateAge: 60 * 60 * 24,
    },
  });
}

/** Lazy singleton — avoids touching the DB at build time when env isn't set. */
export const auth = new Proxy({} as ReturnType<typeof build>, {
  get(_t, prop) {
    if (!_auth) _auth = build();
    return _auth[prop as keyof typeof _auth];
  },
});
