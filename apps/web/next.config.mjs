import { fileURLToPath } from "node:url";

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Pin the workspace root to this repo — otherwise Next.js's root
  // inference can pick up an unrelated lockfile elsewhere on disk.
  outputFileTracingRoot: fileURLToPath(new URL("../..", import.meta.url)),
};

export default nextConfig;
