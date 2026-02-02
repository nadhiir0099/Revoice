# ReVoice: Automated Video Translation & Dubbing Pipeline

## Project Overview
**ReVoice** is an advanced AI-driven pipeline designed to automate the process of translating and dubbing video content while preserving speaker identity. The project addresses the complexity of multilingual content creation by integrating several state-of-the-art models for speech recognition, diarization, translation, and high-fidelity speech synthesis.

The goal of this project is to provide a seamless workflow from a source video in one language (e.g., Tunisian Arabic) to a finalized dubbed video in a target language (e.g., French or English), complete with time-aligned subtitles and synchronized audio.

## Key Features
- **Speech-to-Text (STT)**: High-accuracy transcription using OpenAI's Whisper (via Groq API).
- **Speaker Diarization**: Multi-speaker detection and assignment using Pyannote.audio.
- **Dialect Normalization**: Intelligent normalization of Tunisian Arabic/Darija to Modern Standard Arabic using GPT models.
- **Neural Machine Translation**: Leveraging Llama 3 for context-aware translation.
- **Voice Synthesis (TTS)**: Realistic voice cloning and dubbing via ElevenLabs.
- **Interactive UI**: A modern dashboard built with React to review transcriptions and manage the dubbing process.
- **Microservices Architecture**: Orchestrated using Docker and managed with BullMQ for reliable background processing.

## Project Structure
```text
revoice/
├── client/                 # React (Vite) Frontend Application
├── server/                 # Node.js (Express) Backend API
├── services/
│   └── diarization-worker/ # Python worker for speaker detection
├── stt_worker/             # Python worker for Whisper transcription
├── docker-compose.yml      # Orchestration for all services
├── package.json            # Project dependencies
└── README.md
```

## Datasets and External Files
Due to size constraints and licensing, the following large files are not included in this repository:
- **Pre-trained Models**: Pyannote.audio and Whisper models are downloaded at runtime or should be placed in the respective worker directories.
- **Datasets**: Sample videos used for testing are omitted.

> [!IMPORTANT]
> To run the diarization worker, you must obtain a HuggingFace token and accept the terms for `pyannote/speaker-diarization`.

## Installation

### Prerequisites
- Docker & Docker Compose
- Node.js (v18+)
- Python (3.10+)
- FFmpeg installed on the host system

### Setup Instructions
1. **Clone the repository**:
   ```bash
   git clone https://github.com/nadhiir0099/revoice.git
   cd revoice
   ```

2. **Configure Environment Variables**:
   Create a `.env` file in the root directory and populate it with the required API keys:
   ```env
   GROQ_API_KEY=your_key_here
   OPENAI_API_KEY=your_key_here
   ELEVENLABS_API_KEY=your_key_here
   HF_TOKEN=your_huggingface_token
   ```

3. **Deploy using Docker**:
   ```bash
   docker-compose up --build
   ```

## How to Run
Once the services are active:
1. Access the frontend dashboard at `http://localhost:5173`.
2. Upload a video file through the interface.
3. The system will automatically trigger the STT and Diarization workers.
4. Review the transcription in the UI, apply normalization if necessary, and proceed to "Generate Dubbing".
5. Download the final result from the "Creations" tab.

## Results & Outputs
- **Dubbed Video**: An MP4 file with the original video and the newly synthesized audio track.
- **Subtitles**: A Burned-in subtitle track or a standalone `.srt` file.
- **Segmentation Data**: JSON outputs containing time-aligned transcription and speaker IDs.

## Technologies Used
- **Frontend**: React, Vite, Axios, Tailwind CSS.
- **Backend**: Node.js, Express, Sequelize (SQLite), Passport.js.
- **Workers**: Python (MoviePy, Pyannote, Groq SDK).
- **Infrastructure**: Redis, BullMQ, Docker.
