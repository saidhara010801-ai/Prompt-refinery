ARG VLLM_IMAGE=vllm/vllm-openai:v0.26.0
FROM ${VLLM_IMAGE}

ENV MODEL_ID=google/gemma-4-E4B-it \
    MAX_MODEL_LEN=8192 \
    GPU_MEMORY_UTILIZATION=0.90 \
    PORT=8000

EXPOSE 8000

ENTRYPOINT ["/bin/sh", "-c"]
CMD ["exec vllm serve \"${MODEL_ID}\" --host 0.0.0.0 --port \"${PORT}\" --api-key \"${GEMMA_API_KEY}\" --max-model-len \"${MAX_MODEL_LEN}\" --gpu-memory-utilization \"${GPU_MEMORY_UTILIZATION}\""]
