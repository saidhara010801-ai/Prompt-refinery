import { config } from 'dotenv';
config();

import { genkit, type Genkit as GenkitType } from 'genkit';
import { googleAI } from '@genkit-ai/google-genai';

const generation = 'googleai/gemini-2.5-flash';

const plugins = [];
// Always initialize googleAI. It will use the environment variable if available.
// If not, it can be configured dynamically at the flow level.
plugins.push(googleAI());

const ai: GenkitType = genkit({
  plugins: plugins,
  model: generation,
});

export { genkit, generation, ai };
