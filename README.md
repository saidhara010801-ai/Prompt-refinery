# The Prompt Refinery

Refine raw prompts with an AI Council of expert agents for dramatically better LLM outputs.

The Prompt Refinery helps AI enthusiasts, developers, creators, marketers, researchers, and teams turn vague prompts into structured, high-quality prompts. The current app uses a three-agent council, Firebase Auth/Firestore, Google Genkit, and a user-provided Gemini API key stored locally in the browser.

## Current Product Scope

- AI Council prompt refinement with The Specifier, The Simplifier, and The Stylist.
- Eight refinement techniques: Zero-shot, Few-shot, Chain-of-thought, Tree-of-thoughts, Role/persona, Prompt chaining, ReAct, and Meta/reflection.
- Guideline Evaluator for deciding whether a prompt should include one of the council guidelines.
- Saved Prompts for authenticated users.
- Projects & Memory for iterative, context-aware refinement across sessions.
- Local Bring Your Own Key Gemini support.
- OpenRouter support with configurable model IDs for each council member.
- Deterministic token count estimates for Gemini, OpenAI, DeepSeek, and Qwen families.
- Dark/light mode and responsive Next.js UI.

Planned roadmap items from the product docs include OpenRouter model routing, Projects & Memory, multimodal/format conversion, prompt versioning, export options, Pro-tier limits, and richer evaluator scoring.

## Tech Stack

- Next.js App Router with TypeScript
- Tailwind CSS and Radix UI components
- Google Genkit with `@genkit-ai/google-genai`
- Firebase Auth and Firestore
- Optional Stripe checkout endpoint for donations

## Prerequisites

- Node.js LTS
- npm
- Firebase project with Auth and Firestore configured
- Gemini API key for AI refinement and evaluation

## Local Setup

1. Clone and install dependencies:

   ```powershell
   git clone https://github.com/saidhara010801-ai/Prompt-refinery.git
   cd Prompt-refinery
   npm install
   ```

2. Create a local env file:

   ```powershell
   Copy-Item .env.example .env.local
   ```

3. Fill in Firebase values in `.env.local`.

   Firebase client config is required for auth and saved prompts. Gemini keys are entered by users in the app Settings dialog and are stored only in browser local storage.

4. Start the app:

   ```powershell
   npm run dev
   ```

5. Open [http://localhost:9002](http://localhost:9002).

## Environment Variables

Required for Firebase-backed auth and saved prompts:

```env
NEXT_PUBLIC_FIREBASE_API_KEY=
NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=
NEXT_PUBLIC_FIREBASE_PROJECT_ID=
NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET=
NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=
NEXT_PUBLIC_FIREBASE_APP_ID=
NEXT_PUBLIC_FIREBASE_MEASUREMENT_ID=
```

Optional for the donation checkout button:

```env
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=
STRIPE_SECRET_KEY=
```

Optional for managed server-side OpenRouter fallback:

```env
OPENROUTER_API_KEY=
```

OpenRouter can also be used as a user-provided browser-local key from Settings. In that BYOK mode, each AI Council member can use a different OpenRouter model ID.

## Scripts

```powershell
npm run dev          # Start Next.js on port 9002
npm run typecheck    # Run TypeScript validation
npm run build        # Create a production Next.js build
npm run genkit:dev   # Start Genkit dev flow runner
```

`npm run lint` currently invokes Next.js' interactive ESLint setup because this repository does not yet include an ESLint config.

## Phase 1 Verification

The critical bug-fix phase is considered healthy when:

- Token estimates render after a successful refinement without calling an AI model.
- Missing or invalid Gemini API keys show clear user-facing messages.
- The Settings button visually pulses when API-key action is required.
- AI flows do not use unsafe `output!` assertions.
- `npm run typecheck` passes.
- `npm run build` passes.

## Data Model

The app stores user-owned data under each authenticated user path in Firestore:

- `/users/{uid}/savedPrompts`
- `/users/{uid}/projects`
- `/users/{uid}/projects/{projectId}/projectSessions`

Project sessions store raw prompts, refined prompts, selected technique, timestamps, and optional downstream LLM response notes. Recent project sessions are compressed into a bounded text memory block and passed into new refinements when a project is selected. API keys must remain local-only or server env-only and must never be stored in Firestore.

## Development Notes

- Work should happen on feature branches, never directly on `main`.
- Keep changes aligned with the numbered implementation phases in `Documents/06-Implementation-Plan.md`.
- Commit messages should be focused and conventional, for example `fix: make token counts deterministic` or `docs: replace starter readme`.
- Do not commit `.env`, `.env.local`, `.next`, `node_modules`, or generated Firebase/Genkit debug files.
