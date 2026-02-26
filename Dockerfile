FROM python:3.12-slim

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY python/ ./python/

EXPOSE 8765

CMD python3 python/server.py
