/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  experimental: {
    serverComponentsExternalPackages: ["@neondatabase/serverless"],
  },
};
module.exports = nextConfig;
