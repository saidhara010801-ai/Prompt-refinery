import { config } from 'dotenv';
config();

import { genkit, type Genkit as GenkitType } from 'genkit';
import { googleAI } from '@genkit-ai/google-genai';

const generation = 'googleai/gemini-2.5-flash';

const plugins = [];
if (process.env.GEMINI_API_KEY) {
  plugins.push(googleAI({ apiKey: process.env.GEMINI_API_KEY }));
} else {
  // If no key is present, we can still initialize with an empty array.
  // The flow will dynamically add the plugin if a key is provided at runtime.
  plugins.push(googleAI());
}

const ai: GenkitType = genkit({
  plugins: plugins,
  model: generation,
});

export { genkit, generation, ai };
