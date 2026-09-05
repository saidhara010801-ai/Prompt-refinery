const ERROR_RESPONSE = {
  description: 'Request failed',
  content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } },
};

function jsonBody(schema: Record<string, unknown>) {
  return { required: true, content: { 'application/json': { schema } } };
}

function jsonResponse(description: string, schema: Record<string, unknown>) {
  return { description, content: { 'application/json': { schema } } };
}

const PROJECT_ID = { name: 'projectId', in: 'path', required: true, schema: { type: 'string' } };
const ENTRY_ID = { name: 'entryId', in: 'path', required: true, schema: { type: 'string' } };

export function buildClariftOpenApiDocument(origin: string) {
  return {
    openapi: '3.1.0',
    info: {
      title: 'Clarift Developer API',
      version: '1.1.0',
      description: 'Tenant-isolated refinement, evaluation, conversion, project memory, and usage APIs. Managed inference provider details are intentionally abstracted.',
    },
    servers: [{ url: `${origin}/api/v1` }],
    security: [{ clariftToken: [] }],
    components: {
      securitySchemes: {
        clariftToken: { type: 'http', scheme: 'bearer', bearerFormat: 'clf_live_*' },
      },
      schemas: {
        ErrorResponse: {
          type: 'object',
          required: ['error'],
          properties: {
            error: {
              type: 'object',
              required: ['code', 'message'],
              properties: { code: { type: 'string' }, message: { type: 'string' } },
            },
          },
        },
        AllowancePeriod: {
          type: 'object',
          required: ['limit', 'used', 'reserved', 'remaining', 'resetAt'],
          properties: {
            limit: { type: 'integer' },
            used: { type: 'integer' },
            reserved: { type: 'integer' },
            remaining: { type: 'integer' },
            resetAt: { type: 'string', format: 'date-time' },
          },
        },
        InferenceMetadata: {
          type: 'object',
          required: ['contractVersion', 'requestId', 'creditsCharged', 'qualityTier', 'allowance'],
          properties: {
            contractVersion: { type: 'integer', const: 2 },
            requestId: { type: 'string' },
            creditsCharged: { type: 'integer', minimum: 0 },
            qualityTier: { type: 'string', enum: ['generative', 'fallback'] },
            allowance: {
              type: 'object',
              properties: {
                refinement: {
                  type: 'object',
                  properties: {
                    daily: { $ref: '#/components/schemas/AllowancePeriod' },
                    monthly: { $ref: '#/components/schemas/AllowancePeriod' },
                  },
                },
                evaluation: {
                  type: 'object',
                  properties: {
                    daily: { $ref: '#/components/schemas/AllowancePeriod' },
                    monthly: { $ref: '#/components/schemas/AllowancePeriod' },
                  },
                },
              },
            },
            basicMode: {
              type: ['object', 'null'],
              properties: {
                reason: { type: 'string', enum: ['daily_limit', 'monthly_limit', 'budget_limit', 'request_size', 'service_busy'] },
                resetScope: { type: ['string', 'null'], enum: ['daily', 'monthly', null] },
                resetAt: { type: ['string', 'null'], format: 'date-time' },
              },
            },
          },
        },
        Project: {
          type: 'object',
          required: ['id', 'name', 'description', 'status', 'defaultTechnique', 'defaultGuidelines'],
          properties: {
            id: { type: 'string' },
            name: { type: 'string' },
            description: { type: 'string' },
            status: { type: 'string', enum: ['active', 'trashed'] },
            defaultTechnique: { type: 'string' },
            defaultGuidelines: { type: 'array', items: { type: 'string' } },
            createdAt: { type: ['string', 'null'], format: 'date-time' },
            updatedAt: { type: ['string', 'null'], format: 'date-time' },
            trashedAt: { type: ['string', 'null'], format: 'date-time' },
          },
        },
        MemoryProvenance: {
          type: 'object',
          required: ['source', 'userId', 'consent'],
          properties: {
            source: { type: 'string', enum: ['web', 'api', 'mcp', 'system', 'migration'] },
            agent: { type: ['string', 'null'] },
            requestId: { type: ['string', 'null'] },
            userId: { type: 'string' },
            timestamp: { type: ['string', 'null'], format: 'date-time' },
            consent: { type: 'string', enum: ['explicit', 'workflow', 'project-policy', 'system'] },
          },
        },
        MemoryEntry: {
          type: 'object',
          required: ['id', 'projectId', 'kind', 'title', 'content', 'active', 'status', 'tokenEstimate', 'provenance'],
          properties: {
            id: { type: 'string' },
            projectId: { type: 'string' },
            kind: { type: 'string', enum: ['refinement', 'response', 'converter', 'note', 'evaluation'] },
            title: { type: 'string' },
            content: { type: 'string' },
            active: { type: 'boolean' },
            status: { type: 'string', enum: ['active', 'inactive'] },
            tokenEstimate: { type: 'integer', minimum: 0 },
            sourceRef: { type: ['string', 'null'] },
            validFrom: { type: ['string', 'null'], format: 'date-time' },
            validTo: { type: ['string', 'null'], format: 'date-time' },
            createdAt: { type: ['string', 'null'], format: 'date-time' },
            updatedAt: { type: ['string', 'null'], format: 'date-time' },
            provenance: { $ref: '#/components/schemas/MemoryProvenance' },
          },
        },
      },
    },
    paths: {
      '/openapi.json': {
        get: {
          operationId: 'getOpenApiDocument',
          summary: 'Get the Clarift OpenAPI document',
          security: [],
          responses: { '200': jsonResponse('OpenAPI 3.1 document', { type: 'object' }) },
        },
      },
      '/refinements': {
        post: {
          operationId: 'createRefinement',
          summary: 'Refine a prompt with managed inference',
          description: 'Requires refinements:write. Quick, Guided, and Full Council consume 1, 2, and 3 weighted units.',
          requestBody: jsonBody({
            type: 'object',
            required: ['prompt'],
            properties: {
              prompt: { type: 'string', maxLength: 60000 },
              technique: { type: 'string' },
              mode: { type: 'string', enum: ['quick_refine', 'guided_fix', 'full_council'], default: 'quick_refine' },
              projectMemory: { type: 'string', maxLength: 100000 },
              explanationMode: { type: 'boolean' },
              maxCharacters: { type: 'integer', minimum: 100, maximum: 60000 },
              idempotencyKey: { type: 'string', minLength: 8, maxLength: 200 },
            },
          }),
          responses: {
            '200': jsonResponse('Refinement plus quality and allowance metadata', {
              allOf: [
                { $ref: '#/components/schemas/InferenceMetadata' },
                { type: 'object', required: ['refinedPrompt'], properties: { refinedPrompt: { type: 'string' } } },
              ],
            }),
            default: ERROR_RESPONSE,
          },
        },
      },
      '/evaluations': {
        post: {
          operationId: 'createEvaluation',
          summary: 'Evaluate a prompt against guidelines',
          description: 'Requires evaluations:write.',
          requestBody: jsonBody({
            type: 'object',
            required: ['prompt', 'guidelines'],
            properties: {
              prompt: { type: 'string', maxLength: 60000 },
              guidelines: { type: 'array', minItems: 1, maxItems: 8, items: { type: 'string', maxLength: 8000 } },
            },
          }),
          responses: {
            '200': jsonResponse('Evaluation plus quality and allowance metadata', {
              allOf: [
                { $ref: '#/components/schemas/InferenceMetadata' },
                { type: 'object', required: ['results', 'combinedScore'], properties: { results: { type: 'array', items: { type: 'object' } }, combinedScore: { type: 'number' } } },
              ],
            }),
            default: ERROR_RESPONSE,
          },
        },
      },
      '/conversions': {
        post: {
          operationId: 'createConversion',
          summary: 'Convert documents to Markdown',
          description: 'Requires conversions:write.',
          requestBody: {
            required: true,
            content: { 'multipart/form-data': { schema: { type: 'object', required: ['files'], properties: { files: { type: 'array', minItems: 1, maxItems: 10, items: { type: 'string', format: 'binary' } } } } } },
          },
          responses: { '200': jsonResponse('Converted Markdown documents', { type: 'object' }), default: ERROR_RESPONSE },
        },
      },
      '/projects': {
        get: {
          operationId: 'listProjects',
          summary: 'List projects',
          description: 'Requires projects:read.',
          parameters: [{ name: 'includeTrashed', in: 'query', schema: { type: 'boolean', default: false } }],
          responses: { '200': jsonResponse('Projects', { type: 'object', required: ['projects'], properties: { projects: { type: 'array', items: { $ref: '#/components/schemas/Project' } } } }), default: ERROR_RESPONSE },
        },
        post: {
          operationId: 'createProject',
          summary: 'Create a project',
          description: 'Requires projects:write.',
          requestBody: jsonBody({ type: 'object', required: ['name'], properties: { name: { type: 'string', maxLength: 120 }, description: { type: 'string', maxLength: 2000 } } }),
          responses: { '201': jsonResponse('Created project', { $ref: '#/components/schemas/Project' }), default: ERROR_RESPONSE },
        },
      },
      '/projects/{projectId}': {
        parameters: [PROJECT_ID],
        get: { operationId: 'getProject', summary: 'Get a project', description: 'Requires projects:read.', responses: { '200': jsonResponse('Project', { $ref: '#/components/schemas/Project' }), default: ERROR_RESPONSE } },
        patch: {
          operationId: 'updateProject',
          summary: 'Update or restore a project',
          description: 'Requires projects:write.',
          requestBody: jsonBody({ type: 'object', properties: { name: { type: 'string' }, description: { type: 'string' }, status: { type: 'string', enum: ['active', 'trashed'] } } }),
          responses: { '200': jsonResponse('Updated project', { $ref: '#/components/schemas/Project' }), default: ERROR_RESPONSE },
        },
        delete: { operationId: 'trashProject', summary: 'Move a project to Trash', description: 'Requires projects:write. Purge is delayed for 30 days.', responses: { '200': jsonResponse('Trashed project', { $ref: '#/components/schemas/Project' }), default: ERROR_RESPONSE } },
      },
      '/projects/{projectId}/memory': {
        parameters: [PROJECT_ID],
        get: {
          operationId: 'listProjectMemory',
          summary: 'List project memory entries',
          description: 'Requires memory:read.',
          parameters: [
            { name: 'activeOnly', in: 'query', schema: { type: 'boolean', default: false } },
            { name: 'limit', in: 'query', schema: { type: 'integer', minimum: 1, maximum: 100 } },
          ],
          responses: { '200': jsonResponse('Memory entries', { type: 'object', required: ['entries'], properties: { entries: { type: 'array', items: { $ref: '#/components/schemas/MemoryEntry' } } } }), default: ERROR_RESPONSE },
        },
        post: {
          operationId: 'createProjectMemory',
          summary: 'Create a permissioned memory entry',
          description: 'Requires memory:write and explicit consent=true (or X-Clarift-Write-Consent: true).',
          requestBody: jsonBody({ type: 'object', required: ['title', 'content', 'consent'], properties: { kind: { type: 'string', enum: ['refinement', 'response', 'converter', 'note', 'evaluation'], default: 'note' }, title: { type: 'string' }, content: { type: 'string' }, sourceRef: { type: ['string', 'null'] }, consent: { type: 'boolean', const: true } } }),
          responses: { '201': jsonResponse('Created memory entry', { $ref: '#/components/schemas/MemoryEntry' }), default: ERROR_RESPONSE },
        },
      },
      '/projects/{projectId}/memory/{entryId}': {
        parameters: [PROJECT_ID, ENTRY_ID],
        patch: {
          operationId: 'updateProjectMemory',
          summary: 'Update or activate/deactivate memory',
          description: 'Requires memory:write and explicit consent.',
          requestBody: jsonBody({ type: 'object', required: ['consent'], properties: { title: { type: 'string' }, content: { type: 'string' }, active: { type: 'boolean' }, consent: { type: 'boolean', const: true } } }),
          responses: { '200': jsonResponse('Updated memory entry', { $ref: '#/components/schemas/MemoryEntry' }), default: ERROR_RESPONSE },
        },
        delete: {
          operationId: 'deleteProjectMemory',
          summary: 'Delete a memory entry',
          description: 'Requires memory:write and explicit consent. The deletion is recorded in a content-free audit event.',
          parameters: [{ name: 'X-Clarift-Write-Consent', in: 'header', required: true, schema: { type: 'string', const: 'true' } }],
          responses: { '200': jsonResponse('Deletion result', { type: 'object', required: ['deleted', 'id'], properties: { deleted: { type: 'boolean' }, id: { type: 'string' } } }), default: ERROR_RESPONSE },
        },
      },
      '/memory/search': {
        post: {
          operationId: 'searchMemory',
          summary: 'Search project memory by normalized keywords',
          description: 'Requires memory:read. Hybrid semantic retrieval remains separately feature-gated.',
          requestBody: jsonBody({ type: 'object', required: ['query'], properties: { query: { type: 'string' }, projectId: { type: 'string' }, activeOnly: { type: 'boolean', default: true }, limit: { type: 'integer', minimum: 1, maximum: 50, default: 20 } } }),
          responses: { '200': jsonResponse('Matching memory entries', { type: 'object', required: ['entries'], properties: { entries: { type: 'array', items: { $ref: '#/components/schemas/MemoryEntry' } } } }), default: ERROR_RESPONSE },
        },
      },
      '/memory/context': {
        post: {
          operationId: 'getActiveMemoryContext',
          summary: 'Retrieve token-budgeted hybrid project context',
          description: 'Requires memory:read and ENABLE_HYBRID_MEMORY. Retrieval combines vector similarity, keyword scoring, one graph hop, and active temporal filtering.',
          requestBody: jsonBody({
            type: 'object',
            required: ['projectId', 'query'],
            properties: {
              projectId: { type: 'string' },
              query: { type: 'string', maxLength: 2000 },
              maxTokens: { type: 'integer', minimum: 200, maximum: 12000, default: 3000 },
              topK: { type: 'integer', minimum: 1, maximum: 20, default: 8 },
            },
          }),
          responses: { '200': jsonResponse('Active hybrid memory context with ranked provenance', { type: 'object' }), default: ERROR_RESPONSE },
        },
      },
      '/usage': {
        get: {
          operationId: 'getUsage',
          summary: 'Get credits, plan, Developer entitlement, and current allowance',
          description: 'Requires usage:read.',
          responses: { '200': jsonResponse('Current usage and allowance', { type: 'object' }), default: ERROR_RESPONSE },
        },
      },
    },
  };
}
