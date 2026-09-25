FROM python:3.12-slim

WORKDIR /app

# Install system build dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    curl \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt ./
# Install lightweight CPU-only PyTorch wheel first, then remaining dependencies
RUN pip install --no-cache-dir torch --index-url https://download.pytorch.org/whl/cpu && \
    pip install --no-cache-dir -r requirements.txt

COPY . .

# Ship the exact RAG embedding revision in the image. Production startup is
# offline-only and must never silently download or switch embedding spaces.
ENV HF_HOME=/opt/huggingface
RUN python -c "from sentence_transformers import SentenceTransformer; m = SentenceTransformer('sentence-transformers/all-MiniLM-L6-v2', revision='1110a243fdf4706b3f48f1d95db1a4f5529b4d41', trust_remote_code=False); assert m.get_sentence_embedding_dimension() == 384" \
    && chmod -R a+rX /opt/huggingface
ENV HF_HUB_OFFLINE=1
ENV TRANSFORMERS_OFFLINE=1

# Production images consume pre-generated, qualified serving artifacts. The
# verifier is read-only and fails the image build if the supplied artifacts
# cannot satisfy the serving feature/model contracts.
RUN python scripts/verify_serving_artifacts.py

EXPOSE 8000

ENV PORT=8000
ENV PYTHONUNBUFFERED=1
ENV TRACE_LOG_PATH=/app/traces.jsonl

RUN useradd -m -u 1000 appuser && chown -R appuser:appuser /app /opt/huggingface
USER appuser

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
