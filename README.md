# The Prompt Refinery

Refine raw prompts with an AI Council of expert agents for dramatically better LLM outputs.

The Prompt Refinery helps AI enthusiasts, developers, creators, marketers, researchers, and teams turn vague prompts into structured, high-quality prompts. The current app uses a five-agent council, Firebase Auth/Firestore, Google Genkit, OpenRouter routing, and user-provided API keys stored locally in the browser.

## Current Product Scope

- AI Council prompt refinement with The Specifier, The Simplifier, The Stylist, The Critic, and The Formatter.
- Eight refinement techniques: Zero-shot, Few-shot, Chain-of-thought, Tree-of-thoughts, Role/persona, Prompt chaining, ReAct, and Meta/reflection.
- Guideline Evaluator with overall and sub-dimension quality scores.
- Saved Prompts for authenticated users, including version-history metadata for new saves.
- Projects & Memory for iterative, context-aware refinement across sessions.
- Reference file context in the Refinery with Gemini Vision images and MarkItDown document conversion.
- Dedicated format converter for reusable Markdown output from supported documents.
- Before/after diff view for refined prompts.
- Prompt templates, explanation mode, styled copy actions, and TXT/Markdown/JSON exports.
- Free and Pro segmentation with protected subscription tiers, daily managed-key limits, and server-enforced saved-prompt limits.
- Stripe subscription Checkout and webhook fulfillment for Pro upgrades.
- Local Bring Your Own Key Gemini support.
- OpenRouter support with configurable model IDs for each council member.
- Deterministic token count estimates for Gemini, OpenAI, DeepSeek, and Qwen families.
- Optional max-character target for refined output.
- Email, Google, and guest sign-in through Firebase Authentication.
- Signed-out BYOK refinement, evaluation, conversion, and template browsing; authentication remains required for saved prompts, Projects, managed-key usage, and Pro checkout.
- Dark/light mode and responsive Next.js UI.

Production-readiness tooling includes regression tests, CI, route throttles, a redacted health endpoint, and an operator runbook.

## Tech Stack

- Next.js App Router with TypeScript
- Tailwind CSS and Radix UI components
- Google Genkit with `@genkit-ai/google-genai`
- Firebase Auth and Firestore
- Stripe subscription Checkout and webhook fulfillment

## Prerequisites

- Node.js 20.19+ LTS
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

   Firebase client config is required for auth and saved prompts. Enable Email/Password, Anonymous, and Google sign-in providers in Firebase Authentication. Gemini keys are entered by users in the app Settings dialog and are stored only in browser local storage.

4. Optional: install Microsoft MarkItDown to convert PDF and Office attachments into prompt context:

   ```powershell
   pip install -r requirements-markitdown.txt
   ```

5. Start the app:

   ```powershell
   npm run dev
   ```

6. Open [http://localhost:9002](http://localhost:9002).

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

Required for Stripe Pro subscription upgrades:

```env
STRIPE_SECRET_KEY=
STRIPE_PRO_PRICE_ID=
STRIPE_WEBHOOK_SECRET=
APP_BASE_URL=https://your-production-host.example
```

`APP_BASE_URL` is the trusted public origin used for Stripe Checkout success and cancellation redirects. Keep it explicit in production rather than deriving it from request headers.

Outside Firebase App Hosting, server-side tier enforcement also needs Firebase Admin application-default credentials:

```env
GOOGLE_APPLICATION_CREDENTIALS=
```

Optional for managed server-side OpenRouter fallback:

```env
OPENROUTER_API_KEY=
```

OpenRouter can also be used as a user-provided browser-local key from Settings. In that BYOK mode, each AI Council member can use a different OpenRouter model ID.

Optional for document conversion when the MarkItDown CLI is not discoverable as `markitdown`:

```env
MARKITDOWN_COMMAND=
```

With the Gemini provider, image uploads are sent as inline data URIs for Vision-aware refinement. Text files are read in the browser. PDF and Office attachments use the server-side Microsoft MarkItDown CLI when installed, with a metadata-only fallback when conversion is unavailable.

## Scripts

```powershell
npm run dev          # Start Next.js on port 9002
npm run lint         # Run Next.js ESLint checks
npm run typecheck    # Run TypeScript validation
npm test             # Run automated regression coverage
npm run build        # Create a production Next.js build
npm run verify       # Run lint, typecheck, regression tests, and production build
npm run check:production-env # Validate required production environment values
npm run genkit:dev   # Start Genkit dev flow runner
```

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

User profiles store `subscriptionTier`, the server-maintained `savedPromptCount`, and managed-refinement usage metadata. Free accounts can save up to 10 prompts and use up to 5 managed-key refinements per day. BYOK refinements do not consume managed usage. Pro accounts unlock all eight techniques, Projects & Memory, unlimited saved prompts, and unlimited managed-key refinements.

Saved-prompt writes, project-memory writes, recursive project deletion, and Stripe tier changes run through server-side Firebase Admin code. Browser clients may read their own tier and Pro project memory but cannot self-promote or bypass server enforcement.

## Production Operations

The app exposes `GET /api/health` for liveness monitoring and `GET /api/health?ready=1` for readiness monitoring. Both responses report redacted configuration checks only.

Firestore transactions enforce the Free managed-key quota. Checkout and document conversion also use per-instance request throttles as a best-effort abuse guard. Multi-instance production deployments should complement these with platform or edge rate limits.

See [docs/production-runbook.md](docs/production-runbook.md) for Firebase App Hosting secrets, Stripe webhook registration, alerting, release gates, and manual promotion checks.

Project sessions store raw prompts, refined prompts, selected technique, timestamps, and optional downstream LLM response notes. Recent project sessions are compressed into a bounded text memory block and passed into new refinements when a project is selected. API keys must remain local-only or server env-only and must never be stored in Firestore.

## Development Notes

- Work should happen on feature branches, never directly on `main`.
- Keep changes aligned with the numbered implementation phases in `Documents/06-Implementation-Plan.md`.
- Commit messages should be focused and conventional, for example `fix: make token counts deterministic` or `docs: replace starter readme`.
- Do not commit `.env`, `.env.local`, `.next`, `node_modules`, or generated Firebase/Genkit debug files.
