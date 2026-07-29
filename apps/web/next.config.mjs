/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  transpilePackages: ['@careeros/contracts', '@careeros/ui', '@careeros/config'],
  experimental: {
    typedRoutes: true,
  },
};

export default nextConfig;