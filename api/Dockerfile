FROM python:3.12.12-slim-bookworm
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 HF_HOME=/models HF_HUB_DISABLE_TELEMETRY=1
WORKDIR /app
RUN pip install --no-cache-dir torch==2.14.1 --index-url https://download.pytorch.org/whl/cpu
COPY requirements.txt requirements.lock ./
RUN pip install --no-cache-dir -r requirements.txt
RUN useradd --uid 10001 --create-home assistant && mkdir -p /data /models && chown assistant:assistant /data /models
COPY --chown=assistant:assistant . .
USER assistant
EXPOSE 8000
CMD ["uvicorn", "api.main:app", "--host", "0.0.0.0", "--port", "8000"]
