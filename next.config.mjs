/** @type {import('next').NextConfig} */
const nextConfig = {
  // Node-specific SQLite: self-host a persistent Node server; NOT Edge/Vercel static export.
  serverExternalPackages: ['sharp','sanitize-html'],
};
export default nextConfig;
