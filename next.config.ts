import type {NextConfig} from 'next';

const nextConfig: NextConfig = {
  /* config options here */
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
