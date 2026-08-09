/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  transpilePackages: ['@careeros/contracts', '@careeros/ui', '@careeros/config'],
  webpack: (config) => {
    config.resolve.extensionAlias = {
      ...(config.resolve.extensionAlias ?? {}),
      '.js': ['.ts', '.tsx', '.js'],
      '.mjs': ['.mts', '.mjs'],
    };
    return config;
  },
  experimental: {
    typedRoutes: true,
  },
  async rewrites() {
    const apiBaseUrl = process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:3001';
    return [
      {
        source: '/rt/twin',
        destination: `${apiBaseUrl.replace(/\/+$/, '')}/rt/twin`,
      },
    ];
  },
};

export default nextConfig;
