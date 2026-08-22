# Clarift self-hosted Gemma 4

This directory runs Gemma 4 behind an OpenAI-compatible vLLM endpoint. Clarift calls it only from the server through the existing managed-inference gateway. End users never receive the endpoint, model ID, or credentials.

## Local development

Requirements:

- An NVIDIA GPU with enough memory for the selected checkpoint.
- Docker with GPU support.
- A Hugging Face token that has accepted the Gemma model license.

Set `GEMMA_API_KEY` and `HF_TOKEN`, then run:

```bash
docker compose -f infra/gemma/compose.yaml up --build
```

Configure Clarift with:

```dotenv
ENABLE_SELF_HOSTED_GEMMA=true
GEMMA_BASE_URL=http://localhost:8000
GEMMA_API_KEY=the-same-vllm-key
GEMMA_MODEL_ID=google/gemma-4-E4B-it
GEMMA_AUTH_MODE=api-key
CLARIFT_FREE_PROVIDER_ORDER=gemma,openrouter,together
```

## Private Cloud Run GPU

The deployment script creates an IAM-protected Cloud Run service with one L4 GPU, scale-to-zero, and a maximum of one instance. It grants only the supplied App Hosting runtime service account `roles/run.invoker`.

Create Secret Manager values named `GEMMA_API_KEY` and `HF_TOKEN`, identify the App Hosting runtime service account, then run from the repository root:

```bash
PROJECT_ID=clarift-e4f6f \
CLARIFT_CALLER_SERVICE_ACCOUNT=clarift-runtime@clarift-e4f6f.iam.gserviceaccount.com \
bash infra/gemma/deploy-cloud-run.sh
```

After deployment, set the Clarift App Hosting runtime variables and secret reference:

```dotenv
ENABLE_SELF_HOSTED_GEMMA=true
GEMMA_BASE_URL=https://clarift-gemma-...run.app
GEMMA_CLOUD_RUN_AUDIENCE=https://clarift-gemma-...run.app
GEMMA_AUTH_MODE=google-id-token
GEMMA_MODEL_ID=google/gemma-4-E4B-it
```

`GEMMA_API_KEY` remains a Secret Manager reference. Clarift sends the Google identity token in `X-Serverless-Authorization` and the vLLM key in `Authorization`.

## Release gate

Keep `ENABLE_SELF_HOSTED_GEMMA=false` until all of these pass:

- Cloud Run IAM rejects unauthenticated requests.
- The Admin Inference provider check reports `ready`.
- Warm p95 latency and cold-start behavior are measured.
- Cloud Billing budget alerts and a maximum instance count are active.
- A forced Gemma outage successfully fails over to Together and OpenRouter.

Scale-to-zero avoids idle instances, but GPU startup and model weight loading can exceed Clarift's interactive deadline. It is therefore an optional first provider, not the only provider. Use `min-instances=1` only after approving the fixed GPU cost.
