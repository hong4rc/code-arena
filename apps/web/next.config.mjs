import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));

/** @type {import('next').NextConfig} */
const nextConfig = {
  output: "standalone",
  // Pin the workspace root to OUR repo root, not whatever Next infers from
  // stray package-lock.json files higher up in the parent dirs.
  outputFileTracingRoot: resolve(here, "../.."),
  serverExternalPackages: ["postgres", "@arena/db", "@arena/adapters"],
  transpilePackages: ["@arena/application", "@arena/domain"],
  reactStrictMode: true,
  eslint: { ignoreDuringBuilds: true },
  typescript: { ignoreBuildErrors: false },
  // Force single-threaded build on tiny hosts (Render free 512 MB).
  // Each Next build worker eats ~150 MB; without this it spawns one per CPU
  // and OOMs immediately.
  experimental: { cpus: 1, workerThreads: false },
};

export default nextConfig;
