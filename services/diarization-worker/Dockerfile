# Use official Python image
FROM python:3.10-slim

# Install system dependencies
# git is often needed for downloading model components or specific package versions
RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
    libsndfile1 \
    curl \
    gcc \
    python3-dev \
    git \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Upgrade pip and install core build tools
RUN pip install --no-cache-dir --upgrade pip setuptools wheel

# Install CPU-specific Torch components first
# This ensures we don't accidentally pull in 4GB+ of CUDA libraries
RUN pip install --no-cache-dir torch==2.1.1 torchaudio==2.1.1 --index-url https://download.pytorch.org/whl/cpu

# Install pyannote.audio separately as it has a complex dependency tree
RUN pip install --no-cache-dir pyannote.audio==3.1.1

# Copy remaining requirements and install the rest
COPY requirements.txt .
# We remove pyannote.audio from requirements.txt to avoid re-install/conflict
RUN sed -i '/pyannote.audio/d' requirements.txt && \
    pip install --no-cache-dir -r requirements.txt

# Runtime optimizations for CPU efficiency
ENV OMP_NUM_THREADS=1
ENV MKL_NUM_THREADS=1
ENV OPENBLAS_NUM_THREADS=1

# Copy app code
COPY app.py .

EXPOSE 8000

# Run with uvicorn
CMD ["uvicorn", "app:app", "--host", "0.0.0.0", "--port", "8000"]
