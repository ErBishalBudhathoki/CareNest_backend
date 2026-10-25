FROM python:3.12-alpine

RUN pip install --no-cache-dir aiosmtpd

WORKDIR /app
COPY relay.py .

EXPOSE 587

CMD ["python3", "relay.py"]
