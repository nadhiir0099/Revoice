# Base image with Node.js 20 on Debian Bookworm (slim version for smaller footprint)
FROM node:20-bookworm-slim

# Install system dependencies
# - python3, python3-pip: for Python scripts
# - ffmpeg: for video processing
# - libsndfile1: REQUIRED for soundfile/librosa
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 \
    python3-pip \
    python3-venv \
    ffmpeg \
    libsndfile1 \
    && ln -s /usr/bin/python3 /usr/bin/python \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

# Set working directory
WORKDIR /app

# Copy package.json and install Node dependencies
COPY package*.json ./
RUN npm install

# Copy requirements and install minimal Python dependencies
COPY requirements.docker.txt ./
# We use --break-system-packages for simplicity in this container environment 
# or we could use a venv, but for a single-app container this is standard practice.
RUN pip3 install --no-cache-dir \
    --default-timeout=1000 \
    --retries 10 \
    --trusted-host pypi.org \
    --trusted-host files.pythonhosted.org \
    -r requirements.docker.txt \
    --break-system-packages

# Copy the rest of the application code
COPY . .

# Expose the API port
EXPOSE 3005

# Start the application
CMD ["npm", "start"]
