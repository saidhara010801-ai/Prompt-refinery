import type { MetadataRoute } from 'next';

function getBaseUrl() {
  return (process.env.APP_BASE_URL || 'https://clarift.dpdns.org').replace(/\/+$/, '');
}

export default function sitemap(): MetadataRoute.Sitemap {
  const baseUrl = getBaseUrl();

  return [
    {
      url: baseUrl,
      lastModified: new Date(),
      changeFrequency: 'weekly',
      priority: 1,
    },
  ];
}
