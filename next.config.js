/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
  env: { REPOLIGHT_VERCEL_BUILD: process.env.REPOLIGHT_VERCEL_BUILD === '1' ? '1' : '0' },
}

module.exports = nextConfig
