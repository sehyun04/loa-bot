FROM python:3.12-slim

# PID 1이 SIGTERM을 제대로 전달해야 컨테이너가 깔끔하게 종료된다
RUN apt-get update && apt-get install -y --no-install-recommends tini \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY main.py .
COPY migrations/ ./migrations/
COPY resources/ ./resources/
COPY run/ ./run/

ENV PYTHONUNBUFFERED=1 \
    BOT_DATA_DIR=/data

VOLUME ["/data"]

ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["python", "main.py"]
