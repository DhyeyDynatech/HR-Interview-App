/** @type {import('next').NextConfig} */
const nextConfig = {
  serverExternalPackages: ['mammoth'],
  async redirects() {
    return [
      {
        source: "/",
        destination: "/dashboard",
        permanent: true,
      },
    ];
  },
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "img.clerk.com",
      },
      {
        protocol: "https",
        hostname: "rfn6tjersyav5kj8.public.blob.vercel-storage.com",
      },
    ],
  },
  allowedDevOrigins: [
    'http://192.168.175.247',
    'http://192.168.175.247:3000',
    'http://192.168.178.220',
    'http://192.168.178.220:3000',
  ],
  // Don't fail build on ESLint warnings
  eslint: {
    ignoreDuringBuilds: true,
  },
  // Disable Next.js auto-patching for Yarn 4 compatibility
  experimental: {
    swcTraceProfiling: false,
    // Fix ESM module handling for Supabase
    esmExternals: 'loose',
  },
  webpack: (webpackConfig, { webpack, isServer }) => {
    // Remove node: from import specifiers for compatibility
    webpackConfig.plugins.push(
      new webpack.NormalModuleReplacementPlugin(/^node:/, (resource) => {
        resource.request = resource.request.replace(/^node:/, "");
      }),
    );

    // Suppress warnings for face-api.js dependencies (loaded dynamically)
    webpackConfig.ignoreWarnings = [
      { module: /node_modules\/face-api\.js/ },
      { module: /node_modules\/@tensorflow/ },
    ];

    return webpackConfig;
  },
};

module.exports = nextConfig;
