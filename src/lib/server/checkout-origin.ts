function parseBaseUrl(value: string): string {
  const parsed = new URL(value);

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('APP_BASE_URL must use http or https.');
  }

  return parsed.origin;
}

export function getCheckoutReturnOrigin(requestUrl: string, environment: Record<string, string | undefined> = process.env): string {
  const configuredBaseUrl = environment.APP_BASE_URL?.trim();

  if (configuredBaseUrl) {
    return parseBaseUrl(configuredBaseUrl);
  }

  if (environment.NODE_ENV === 'production') {
    throw new Error('APP_BASE_URL is required for production Stripe checkout.');
  }

  return parseBaseUrl(requestUrl);
}
