/** @type {import('next').NextConfig} */
const nextConfig = {
  // Static export → Cloudflare Pages serves the static bundle from `out/`;
  // dynamic logic lives in /functions (Pages Functions on the Workers runtime).
  output: 'export',
  // next/image's optimizer needs a server — disable so static export works.
  images: { unoptimized: true },
  reactStrictMode: true,
}

export default nextConfig
