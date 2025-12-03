import { genkit, type Genkit as GenkitType } from 'genkit';
import { googleAI } from '@genkit-ai/google-genai';

const generation = 'googleai/gemini-2.5-flash';

const ai: GenkitType = genkit({
  plugins: [googleAI()],
  model: generation,
});

export { genkit, generation, ai };
