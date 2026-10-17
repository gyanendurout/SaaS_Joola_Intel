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
  // Redirect /v2 before any page code runs. The page-level redirect() in
  // app/v2/page.tsx only fires after the date-range gate is ready, and a
  // click in that window crashes the client router.
  async redirects() {
    return [{ source: '/v2', destination: '/v2/overview', permanent: false }]
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
