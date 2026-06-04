import 'dotenv/config';

import {
  getMissingFeatureFlags,
  getMissingProductionVariables,
  getOptionalProductionWarnings,
} from '../src/lib/server/runtime-readiness';

const missingVariables = getMissingProductionVariables(process.env);
const missingFeatureFlags = getMissingFeatureFlags(process.env);

if (missingVariables.length > 0 || missingFeatureFlags.length > 0) {
  if (missingVariables.length > 0) {
    console.error(`Missing production environment variables:\n- ${missingVariables.join('\n- ')}`);
  }
  if (missingFeatureFlags.length > 0) {
    console.error(`Missing or invalid feature flags:\n- ${missingFeatureFlags.join('\n- ')}`);
  }
  process.exitCode = 1;
} else {
  console.log('Production environment variables are configured.');
}

for (const warning of getOptionalProductionWarnings(process.env)) {
  console.warn(warning);
}
