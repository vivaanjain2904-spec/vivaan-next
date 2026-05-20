/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // yahoo-finance2 uses some Node APIs; keep on Node runtime not edge
  serverExternalPackages: ["yahoo-finance2"],
};
module.exports = nextConfig;
