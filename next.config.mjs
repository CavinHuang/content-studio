/** @type {import('next').NextConfig} */
const nextConfig = {
  // Node-specific SQLite: self-host a persistent Node server; NOT Edge/Vercel static export.
  serverExternalPackages: [],
};
export default nextConfig;
