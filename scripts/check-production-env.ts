import { getMissingProductionVariables } from '../src/lib/server/runtime-readiness';

const missingVariables = getMissingProductionVariables(process.env);

if (missingVariables.length > 0) {
  console.error(`Missing production environment variables:\n- ${missingVariables.join('\n- ')}`);
  process.exitCode = 1;
} else {
  console.log('Production environment variables are configured.');
}

if (!process.env.OPENROUTER_API_KEY) {
  console.warn('Optional managed OpenRouter fallback is not configured.');
}

if (!process.env.MARKITDOWN_COMMAND) {
  console.warn('MARKITDOWN_COMMAND is not set. Ensure the default `markitdown` executable is installed on the runtime image.');
}

