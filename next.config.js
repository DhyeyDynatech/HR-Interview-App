/** @type {import('next').NextConfig} */
const nextConfig = {
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
      {
        // Azure Blob Storage — recordings, resumes, and user images now live
        // here. Allows next/image to optimize avatars served from any Azure
        // storage account (*.blob.core.windows.net).
        protocol: "https",
        hostname: "*.blob.core.windows.net",
      },
    ],
  },
  allowedDevOrigins: [
    "http://192.168.175.247",
    "http://192.168.175.247:3000",
    "http://192.168.178.220",
    "http://192.168.178.220:3000",
  ],
  // Don't fail build on ESLint warnings
  eslint: {
    ignoreDuringBuilds: true,
  },
  // Ensure the ffmpeg-static binary is traced into the serverless function
  // bundle on Vercel. Without this, the /api/transcode-recording route resolves
  // a binary path that doesn't exist in the deployed function and ffmpeg fails
  // with ENOENT. Keyed under both the URL path and the App Router file path —
  // Next 14's outputFileTracingIncludes matching for nested app/api routes has
  // been inconsistent between versions/patches, so covering both keys is
  // cheap insurance against a silent no-op match.
  outputFileTracingIncludes: {
    "/api/transcode-recording": ["./node_modules/ffmpeg-static/**"],
    "/api/transcode-recording/route": ["./node_modules/ffmpeg-static/**"],
    "/api/transcode-recording/backfill": ["./node_modules/ffmpeg-static/**"],
    "/api/transcode-recording/backfill/route": [
      "./node_modules/ffmpeg-static/**",
    ],
  },
  // Disable Next.js auto-patching for Yarn 4 compatibility
  experimental: {
    swcTraceProfiling: false,
    // Fix ESM module handling for Supabase
    esmExternals: "loose",
    // ffmpeg-static ships a native binary — keep it external so webpack doesn't
    // try to bundle/parse it; it's invoked via spawn() at runtime instead.
    serverComponentsExternalPackages: [
      "mammoth",
      "word-extractor",
      "pdfjs-dist",
      "canvas",
      "mupdf",
      "adm-zip",
      "ffmpeg-static",
    ],
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
