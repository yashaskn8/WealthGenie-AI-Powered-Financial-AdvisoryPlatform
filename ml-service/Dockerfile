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

# Build the deterministic baseline artifacts into the image. Module execution
# preserves the model package import contract and any training failure must
# fail the image build instead of producing a falsely healthy image.
RUN python -m model.training.train
RUN python -m model.training.train_pytorch

# Refuse to ship an image that cannot load every baseline serving artifact.
RUN set -eux; \
    for artifact in \
      /app/model/model.pkl \
      /app/model/label_encoder.pkl \
      /app/model/metadata.json \
      /app/model/saved_models/mlp_model.pt \
      /app/model/saved_models/scaler.pkl \
      /app/model/saved_models/pytorch_metadata.json \
      /app/model/saved_models/ft_transformer.pt \
      /app/model/saved_models/ft_transformer_metadata.json; do \
      test -s "$artifact"; \
    done

EXPOSE 8000

ENV PORT=8000
ENV PYTHONUNBUFFERED=1
ENV TRACE_LOG_PATH=/app/traces.jsonl

RUN useradd -m -u 1000 appuser && chown -R appuser:appuser /app
USER appuser

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
