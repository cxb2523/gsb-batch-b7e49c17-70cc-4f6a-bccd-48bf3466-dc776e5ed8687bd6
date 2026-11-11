# Worker fijo de SentriX en Azure: lleva el código del repo y solo los metadatos de los modelos.
# Sin GPU ni pesos: la inferencia la hace el servidor del PC (SENTRIX_INFERENCE_URL).
FROM python:3.12-slim

ENV PYTHONUNBUFFERED=1 PIP_NO_CACHE_DIR=1 PYTHONDONTWRITEBYTECODE=1
WORKDIR /app/backend

COPY backend/requirements.txt /tmp/requirements.txt
RUN pip install -r /tmp/requirements.txt numpy opencv-python-headless

COPY backend /app/backend
COPY modelo /app/modelo
RUN mkdir -p /app/backend/data/clips

CMD ["python", "-m", "uvicorn", "app.main:app", "--host", "127.0.0.1", "--port", "8000", "--log-level", "warning"]
