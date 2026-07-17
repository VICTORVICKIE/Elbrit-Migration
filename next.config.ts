import type { NextConfig } from 'next'
import path from 'path'

const nextConfig: NextConfig = {
  basePath: '/migration',
  turbopack: {
    root: path.join(__dirname),
  },
  experimental: {
    optimizePackageImports: ['@tanstack/react-table', '@tanstack/react-query'],
  },
}

export default nextConfig
