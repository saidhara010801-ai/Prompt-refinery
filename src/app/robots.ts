import type { MetadataRoute } from 'next';

function getBaseUrl() {
  return (process.env.APP_BASE_URL || 'https://clarift.dpdns.org').replace(/\/+$/, '');
}

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: '*',
      allow: '/',
      disallow: [
        '/api/',
        '/extension/',
        '/downloads/',
      ],
    },
    sitemap: `${getBaseUrl()}/sitemap.xml`,
    host: getBaseUrl(),
  };
}
