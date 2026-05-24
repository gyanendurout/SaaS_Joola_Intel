/** @type {import('next').NextConfig} */
const nextConfig = {
  // Fail the build if there are TypeScript errors
  typescript: {
    ignoreBuildErrors: false,
  },
  // Fail the build if there are ESLint errors
  eslint: {
    ignoreDuringBuilds: false,
  },
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
        ],
      },
    ]
  },
}

module.exports = nextConfig
