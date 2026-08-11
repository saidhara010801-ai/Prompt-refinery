import { NextResponse } from 'next/server';

export async function GET(request: Request) {
  const origin = new URL(request.url).origin;
  return NextResponse.json({
    openapi: '3.1.0',
    info: { title: 'Clarift API', version: '1.0.0', description: 'Programmatic prompt refinement, evaluation, and document conversion.' },
    servers: [{ url: `${origin}/api/v1` }],
    components: { securitySchemes: { clariftKey: { type: 'http', scheme: 'bearer' }, providerKey: { type: 'apiKey', in: 'header', name: 'X-Provider-API-Key' } } },
    security: [{ clariftKey: [], providerKey: [] }],
    paths: {
      '/refinements': { post: { summary: 'Refine a prompt', parameters: [{ in: 'header', name: 'X-AI-Provider', schema: { type: 'string', enum: ['gemini', 'openrouter'], default: 'gemini' } }], requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['prompt'], properties: { prompt: { type: 'string' }, technique: { type: 'string' }, projectMemory: { type: 'string' } } } } } }, responses: { '200': { description: 'Refined prompt' } } } },
      '/evaluations': { post: { summary: 'Evaluate against guidelines', requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['prompt', 'guidelines'], properties: { prompt: { type: 'string' }, guidelines: { type: 'array', items: { type: 'string' } } } } } } }, responses: { '200': { description: 'Evaluation scorecard' } } } },
      '/conversions': { post: { summary: 'Convert documents to Markdown', requestBody: { required: true, content: { 'multipart/form-data': { schema: { type: 'object', properties: { files: { type: 'array', items: { type: 'string', format: 'binary' } } } } } } }, responses: { '200': { description: 'Converted Markdown documents' } } } },
    },
  });
}
