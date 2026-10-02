FROM python:3.11-slim
ENV PYTHONUNBUFFERED=1 PIP_NO_CACHE_DIR=1 HF_HOME=/models/hf EASYOCR_MODULE_PATH=/models/easyocr
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends tesseract-ocr libglib2.0-0 \
    && rm -rf /var/lib/apt/lists/*
# CPU-only torch first, so sentence-transformers / easyocr do not pull the multi-GB CUDA build
RUN pip install torch torchvision --index-url https://download.pytorch.org/whl/cpu
COPY requirements.txt .
RUN pip install -r requirements.txt
COPY app ./app
COPY data ./data
COPY artifacts ./artifacts
COPY eval ./eval
COPY train_router.py .
EXPOSE 8000
HEALTHCHECK --interval=20s --timeout=5s --start-period=60s --retries=5 \
  CMD python -c "import urllib.request,sys; sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:8000/health').status==200 else 1)"
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
