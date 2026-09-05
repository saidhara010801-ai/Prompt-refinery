import type {NextConfig} from 'next';

const developmentScriptSource = process.env.NODE_ENV === 'production' ? '' : " 'unsafe-eval'";
const contentSecurityPolicy = [
  "default-src 'self'",
  "base-uri 'self'",
  "object-src 'none'",
  "frame-ancestors 'none'",
  "form-action 'self' https://*.razorpay.com",
  `script-src 'self' 'unsafe-inline'${developmentScriptSource} https://apis.google.com https://accounts.google.com https://www.gstatic.com https://checkout.razorpay.com`,
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' data: https://fonts.gstatic.com",
  "img-src 'self' data: blob: https://*.googleusercontent.com https://images.unsplash.com https://picsum.photos https://placehold.co",
  "connect-src 'self' https://*.googleapis.com https://accounts.google.com https://*.firebaseio.com wss://*.firebaseio.com https://*.firebaseapp.com https://*.razorpay.com",
  "frame-src 'self' https://*.firebaseapp.com https://accounts.google.com https://*.google.com https://*.razorpay.com",
  "worker-src 'self' blob:",
  "manifest-src 'self'",
  'upgrade-insecure-requests',
].join('; ');

const productionSecurityHeaders = [
  {
    key: 'Content-Security-Policy',
    value: contentSecurityPolicy,
  },
  {
    key: 'Strict-Transport-Security',
    value: 'max-age=31536000; includeSubDomains',
  },
  {
    key: 'X-Content-Type-Options',
    value: 'nosniff',
  },
  {
    key: 'X-Frame-Options',
    value: 'DENY',
  },
  {
    key: 'Referrer-Policy',
    value: 'strict-origin-when-cross-origin',
  },
  {
    key: 'Permissions-Policy',
    value: 'camera=(), microphone=(), geolocation=(), browsing-topics=()',
  },
];

const nextConfig: NextConfig = {
  output: 'standalone',
  async headers() {
    return [
      {
        source: '/downloads/clarift-browser-extension.zip',
        headers: [
          { key: 'Content-Disposition', value: 'attachment; filename="clarift-browser-extension.zip"' },
          { key: 'Content-Type', value: 'application/zip' },
          { key: 'Cache-Control', value: 'public, max-age=0, must-revalidate' },
        ],
      },
      {
        source: '/:path*',
        headers: productionSecurityHeaders,
      },
    ];
  },
  webpack: (config, { webpack }) => {
    // Genkit telemetry optionally loads Jaeger and runtime instrumentation plugins.
    // This deployment does not configure Jaeger; keep the bundle warning-free.
    config.plugins.push(new webpack.IgnorePlugin({
      resourceRegExp: /^@opentelemetry\/exporter-jaeger$/,
    }));
    config.ignoreWarnings = [
      ...(config.ignoreWarnings ?? []),
      {
        module: /@opentelemetry\/instrumentation/,
        message: /the request of a dependency is an expression/i,
      },
    ];
    return config;
  },
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'placehold.co',
        port: '',
        pathname: '/**',
      },
      {
        protocol: 'https',
        hostname: 'images.unsplash.com',
        port: '',
        pathname: '/**',
      },
      {
        protocol: 'https',
        hostname: 'picsum.photos',
        port: '',
        pathname: '/**',
      },
    ],
  },
  // This is to allow cross-origin requests in the development environment.
  allowedDevOrigins: ["*.cloudworkstations.dev"],
};

export default nextConfig;
