# LinkedIn Outreach Agent — web dashboard container.
#
# NOTE: the LinkedIn step drives a real Chrome session, so it needs a browser
# in the image and a persisted profile volume. Email-only use works fine
# headless. For the full flow, running on your own machine (./run_web.sh) is
# smoother because the login window is visible. This image is for hosting the
# dashboard / email workflow.
FROM python:3.12-slim

# Chromium + driver for the Selenium steps
RUN apt-get update && apt-get install -y --no-install-recommends \
      chromium chromium-driver ca-certificates fonts-liberation \
    && rm -rf /var/lib/apt/lists/*

ENV CHROME_BIN=/usr/bin/chromium \
    PYTHONUNBUFFERED=1

WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

# Persist the browser profile + state across restarts by mounting these:
VOLUME ["/app/profile", "/root/.config/chrome-linkedin-agent"]

EXPOSE 8000
# Bind 0.0.0.0 inside the container so the host can reach it.
CMD ["python", "-c", "import uvicorn; uvicorn.run('webapp.server:app', host='0.0.0.0', port=8000)"]
