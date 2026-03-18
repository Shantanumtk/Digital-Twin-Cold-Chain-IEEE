/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
  env: {
    NEXT_PUBLIC_API_URL: process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000',
    MCP_AGENT_URL: process.env.MCP_AGENT_URL || 'http://localhost:8001',
    NEXTAUTH_SECRET: process.env.NEXTAUTH_SECRET || 'coldchain-digital-twin-secret-2026',
    NEXTAUTH_URL: process.env.NEXTAUTH_URL || 'http://localhost:3000',
    AUTH_MONGO_URI: process.env.AUTH_MONGO_URI || 'mongodb://localhost:27017',
  },
}

module.exports = nextConfig