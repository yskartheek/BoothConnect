# roll-parser worker: Python 3.12 + Tesseract 5 (English, Telugu).
#
#   docker compose -f infra/docker-compose.yml --profile roll-parser up -d --build roll-parser
#
# The default command is the queue worker; `check` (Tesseract self-test),
# `extract <pdf>` and the other commands work too.
#
# Ubuntu 24.04 gives the same Tesseract (5.3.4) and Python (3.12) as the CI
# runner, so OCR results in the image match the ones the tests check.

FROM ubuntu:24.04

# libgl/libglib aren't needed: we use the headless OpenCV build.
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
       python3.12 python3.12-venv ca-certificates \
       tesseract-ocr tesseract-ocr-eng tesseract-ocr-tel \
    && rm -rf /var/lib/apt/lists/*

# uv in its own virtual environment (Ubuntu's Python refuses global pip installs)
RUN python3.12 -m venv /opt/uv \
    && /opt/uv/bin/pip install --no-cache-dir uv==0.12.19

ENV UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy \
    UV_PYTHON=python3.12 \
    UV_PYTHON_DOWNLOADS=never \
    PYTHONUNBUFFERED=1 \
    PATH="/app/.venv/bin:/opt/uv/bin:$PATH"

WORKDIR /app

# Dependencies first, so code changes don't reinstall them
COPY pyproject.toml uv.lock ./
RUN uv sync --locked --no-dev --no-install-project

COPY README.md ./
COPY src ./src
RUN uv sync --locked --no-dev

# Never run as root
RUN useradd --system --uid 10001 --no-create-home rollparser
USER rollparser

# /health answers 200 while the worker runs and Redis responds
EXPOSE 8090
HEALTHCHECK --interval=15s --timeout=5s --start-period=20s --retries=3 \
    CMD ["python", "-c", "import sys, urllib.request; sys.exit(urllib.request.urlopen('http://127.0.0.1:8090/health', timeout=4).status != 200)"]

ENTRYPOINT ["roll-parser"]
CMD ["worker"]
