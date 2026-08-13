import { NextResponse } from 'next/server';

export async function GET(request: Request) {
  const origin = new URL(request.url).origin;
  const allowancePeriod = {
    type: 'object',
    required: ['limit', 'used', 'reserved', 'remaining', 'resetAt'],
    properties: {
      limit: { type: 'integer' },
      used: { type: 'integer' },
      reserved: { type: 'integer' },
      remaining: { type: 'integer' },
      resetAt: { type: 'string', format: 'date-time' },
    },
  };
  const inferenceMetadata = {
    contractVersion: { type: 'integer', const: 2 },
    requestId: { type: 'string' },
    creditsCharged: { type: 'integer', const: 0 },
    qualityTier: { type: 'string', enum: ['generative', 'fallback'] },
    allowance: {
      type: 'object',
      properties: {
        refinement: { type: 'object', properties: { daily: allowancePeriod, monthly: allowancePeriod } },
        evaluation: { type: 'object', properties: { daily: allowancePeriod, monthly: allowancePeriod } },
      },
    },
    basicMode: {
      type: 'object',
      properties: {
        reason: { type: 'string', enum: ['daily_limit', 'monthly_limit', 'budget_limit', 'request_size', 'service_busy'] },
        resetScope: { type: ['string', 'null'], enum: ['daily', 'monthly', null] },
        resetAt: { type: ['string', 'null'], format: 'date-time' },
      },
    },
  };
  return NextResponse.json({
    openapi: '3.1.0',
    info: { title: 'Clarift API', version: '1.0.0', description: 'Programmatic prompt refinement, evaluation, and document conversion.' },
    servers: [{ url: `${origin}/api/v1` }],
    components: { securitySchemes: { clariftToken: { type: 'http', scheme: 'bearer', bearerFormat: 'clf_live_*' } } },
    security: [{ clariftToken: [] }],
    paths: {
      '/refinements': { post: { summary: 'Refine a prompt with Clarift managed inference', requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['prompt'], properties: { prompt: { type: 'string' }, technique: { type: 'string' }, mode: { type: 'string', enum: ['quick_refine', 'guided_fix', 'full_council'] }, projectMemory: { type: 'string' } } } } } }, responses: { '200': { description: 'Refined prompt', headers: { 'X-Clarift-Contract-Version': { schema: { type: 'string', const: '2' } } }, content: { 'application/json': { schema: { type: 'object', required: ['contractVersion', 'refinedPrompt', 'requestId', 'creditsCharged', 'qualityTier', 'allowance'], properties: { ...inferenceMetadata, refinedPrompt: { type: 'string' } } } } } } } } },
      '/evaluations': { post: { summary: 'Evaluate against guidelines', requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['prompt', 'guidelines'], properties: { prompt: { type: 'string' }, guidelines: { type: 'array', items: { type: 'string' } } } } } } }, responses: { '200': { description: 'Evaluation scorecard', headers: { 'X-Clarift-Contract-Version': { schema: { type: 'string', const: '2' } } }, content: { 'application/json': { schema: { type: 'object', required: ['contractVersion', 'results', 'combinedScore', 'requestId', 'creditsCharged', 'qualityTier', 'allowance'], properties: { ...inferenceMetadata, results: { type: 'array', items: { type: 'object' } }, combinedScore: { type: 'number' } } } } } } } } },
      '/conversions': { post: { summary: 'Convert documents to Markdown', requestBody: { required: true, content: { 'multipart/form-data': { schema: { type: 'object', properties: { files: { type: 'array', items: { type: 'string', format: 'binary' } } } } } } }, responses: { '200': { description: 'Converted Markdown documents' } } } },
    },
  });
}
