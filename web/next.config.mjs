/** @type {import('next').NextConfig} */
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const nextConfig = {
  reactStrictMode: true,
  outputFileTracingRoot: path.join(__dirname, ".."),
  // Large zip uploads go directly to Express (NEXT_PUBLIC_API_URL).
  // Do not proxy /api/analyze through Next — body limit breaks >10MB files.
};

export default nextConfig;
