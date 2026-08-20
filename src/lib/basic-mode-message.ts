import type { BasicModeStatus, FreeInferenceAllowance, FreeInferenceTask } from './free-inference';
import { freeTaskAvailability } from './free-inference';

function localDate(value: string) {
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(new Date(value));
}
function localDateTime(value: string) {
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));
}

interface BasicModeMessageContext {
  task?: Exclude<FreeInferenceTask, 'evaluate'>;
  taskLabel?: string;
  allowance?: FreeInferenceAllowance | null;
}

export function basicModeMessage(status?: BasicModeStatus, context: BasicModeMessageContext = {}) {
  if (!status) return 'Basic mode was used for this request.';
  if (status.reason === 'request_size') return 'Basic mode was used because this request is larger than the generative limit.';
  if (status.reason === 'monthly_limit' && status.resetAt) return `Basic mode was used. Generative access resets on ${localDate(status.resetAt)}.`;
  if (status.reason === 'daily_limit' && status.resetAt) {
    if (context.task && context.allowance) {
      const availability = freeTaskAvailability(context.task, context.allowance);
      return `${context.taskLabel ?? 'This mode'} needs ${availability.requiredUnits} daily generative units, but ${availability.dailyRemaining} remain. Generative access resets ${localDateTime(status.resetAt)}.`;
    }
    return `Basic mode was used. Generative access resets ${localDateTime(status.resetAt)}.`;
  }
  if (status.reason === 'budget_limit') return 'Basic mode is active for the rest of today.';
  return 'Basic mode was used for this request.';
}
