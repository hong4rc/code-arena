/** @type {import('next').NextConfig} */
const nextConfig = {
  output: "standalone",
  serverExternalPackages: ["postgres", "@arena/db", "@arena/adapters"],
  transpilePackages: ["@arena/application", "@arena/domain"],
  reactStrictMode: true,
  eslint: { ignoreDuringBuilds: true }, // we lint separately at the workspace root
  typescript: { ignoreBuildErrors: false },
};

export default nextConfig;
