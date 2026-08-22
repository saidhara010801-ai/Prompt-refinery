#!/usr/bin/env bash
set -euo pipefail

: "${PROJECT_ID:?Set PROJECT_ID to the Clarift Google Cloud project}"
: "${CLARIFT_CALLER_SERVICE_ACCOUNT:?Set the App Hosting runtime service-account email}"

REGION="${REGION:-us-central1}"
SERVICE="${SERVICE:-clarift-gemma}"
REPOSITORY="${REPOSITORY:-clarift-inference}"
IMAGE="${REGION}-docker.pkg.dev/${PROJECT_ID}/${REPOSITORY}/${SERVICE}:v0.26.0"

gcloud artifacts repositories describe "${REPOSITORY}" --location "${REGION}" --project "${PROJECT_ID}" >/dev/null 2>&1 || \
  gcloud artifacts repositories create "${REPOSITORY}" --repository-format docker --location "${REGION}" --project "${PROJECT_ID}"

gcloud builds submit --project "${PROJECT_ID}" --tag "${IMAGE}" infra/gemma

gcloud run deploy "${SERVICE}" \
  --project "${PROJECT_ID}" \
  --region "${REGION}" \
  --image "${IMAGE}" \
  --no-allow-unauthenticated \
  --gpu 1 \
  --gpu-type nvidia-l4 \
  --no-gpu-zonal-redundancy \
  --cpu 4 \
  --memory 16Gi \
  --no-cpu-throttling \
  --concurrency 1 \
  --min-instances 0 \
  --max-instances 1 \
  --timeout 900 \
  --set-env-vars "MODEL_ID=google/gemma-4-E4B-it,MAX_MODEL_LEN=8192,GPU_MEMORY_UTILIZATION=0.90" \
  --set-secrets "GEMMA_API_KEY=GEMMA_API_KEY:latest,HF_TOKEN=HF_TOKEN:latest"

gcloud run services add-iam-policy-binding "${SERVICE}" \
  --project "${PROJECT_ID}" \
  --region "${REGION}" \
  --member "serviceAccount:${CLARIFT_CALLER_SERVICE_ACCOUNT}" \
  --role roles/run.invoker

gcloud run services describe "${SERVICE}" --project "${PROJECT_ID}" --region "${REGION}" --format 'value(status.url)'
