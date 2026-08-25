# `@clarift/sdk`

Typed, provider-agnostic client for the Clarift Developer API.

```ts
import { ClariftClient } from '@clarift/sdk';

const clarift = new ClariftClient({ apiKey: process.env.CLARIFT_API_TOKEN! });
const result = await clarift.refine({ prompt: 'Write a launch plan', mode: 'quick_refine' });
console.log(result.refinedPrompt, result.qualityTier, result.allowance);
```

Memory mutations require `consent: true`; the API records provenance and a content-free audit event. Provider keys and model names are not part of the public contract.
