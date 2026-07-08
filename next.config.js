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
    // Ensure the ffmpeg-static binary is traced into the serverless function
    // bundle on Vercel. MUST live under `experimental` — Next reads this from
    // config.experimental.outputFileTracingIncludes (collect-build-traces.js),
    // and a top-level key (our first attempt) is silently ignored, which is
    // exactly why the binary was missing in production despite this glob
    // "being set". Keys are matched against the normalized app route (the
    // `/route` suffix is stripped by normalizeAppPath before matching), so
    // "/api/transcode-recording" — not ".../route" — is the correct key.
    outputFileTracingIncludes: {
      "/api/transcode-recording": ["./node_modules/ffmpeg-static/**"],
      "/api/transcode-recording/backfill": ["./node_modules/ffmpeg-static/**"],
    },
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
