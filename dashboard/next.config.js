/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
  env: {
    NEXT_PUBLIC_API_URL: process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000',
    MCP_AGENT_URL: process.env.MCP_AGENT_URL || 'http://localhost:8001',
  },
}

module.exports = nextConfig