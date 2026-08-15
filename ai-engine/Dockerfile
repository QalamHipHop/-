FROM python:3.12-slim
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential libpq-dev ca-certificates && rm -rf /var/lib/apt/lists/*
COPY requirements.txt .
RUN pip install --no-cache-dir --index-url https://download.pytorch.org/whl/cpu torch==2.2.1 && \
    pip install --no-cache-dir -r requirements.txt
COPY . .
EXPOSE 50058
HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
  CMD python -c "import urllib.request; urllib.request.urlopen('http://localhost:50058/healthz').read()" || exit 1
CMD ["uvicorn","src.api.main:app","--host","0.0.0.0","--port","50058"]
