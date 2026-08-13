import type { BasicModeStatus } from './free-inference';

function localDate(value: string) {
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(new Date(value));
}
function localTime(value: string) {
  return new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' }).format(new Date(value));
}

export function basicModeMessage(status?: BasicModeStatus) {
  if (!status) return 'Basic mode was used for this request.';
  if (status.reason === 'request_size') return 'Basic mode was used because this request is larger than the generative limit.';
  if (status.reason === 'monthly_limit' && status.resetAt) return `Basic mode was used. Generative access resets on ${localDate(status.resetAt)}.`;
  if (status.reason === 'daily_limit' && status.resetAt) return `Basic mode was used. Generative access resets today at ${localTime(status.resetAt)}.`;
  if (status.reason === 'budget_limit') return 'Basic mode is active for the rest of today.';
  return 'Basic mode was used for this request.';
}
