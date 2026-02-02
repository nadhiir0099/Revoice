const { Worker } = require('bullmq');
const path = require('path');
const fs = require('fs');
const mongoose = require('mongoose');
const Job = require('../models/Job');
const { connection } = require('../config/redis');
const { sendWebhook } = require('../services/webhookService');
const { groq, translateSegments, normalizeSegments, refineTunisianSegments } = require('../services/aiService');
const { generateSRT } = require('../utils/srtUtils');
const ffmpeg = require('fluent-ffmpeg');
const { spawn } = require('child_process');
const { processDiarization } = require('../utils/diarizationUtils');

// Connect to DB for worker process
const connectDB = require('../config/db');
connectDB();

const worker = new Worker('video-jobs', async (jobData) => {
    const { jobId } = jobData.data;
    console.log(`Processing job ${jobId} (Name: ${jobData.name}, Mode: ${jobData.data.mode})`);

    const job = await Job.findById(jobId);
    if (!job) throw new Error(`Job ${jobId} not found`);

    try {
        await job.setStage('upload', 10);
        job.status = 'processing';
        await job.save();

        const jobDir = path.dirname(job.input.videoPath);
        const videoPath = job.input.videoPath;
        const baseName = path.basename(videoPath, path.extname(videoPath));

        // --- PHASE 1: PREPROCESSING & STT ---
        await job.setStage('stt', 20);
        const processedAudioPath = path.join(jobDir, `${baseName}_clean.wav`);

        await new Promise((resolve, reject) => {
            ffmpeg(videoPath)
                .audioChannels(1)
                .audioFrequency(16000)
                .audioFilters(['afftdn=nf=-25', 'loudnorm'])
                .toFormat('wav')
                .on('end', resolve)
                .on('error', reject)
                .save(processedAudioPath);
        });

        const whisperOptions = {
            file: fs.createReadStream(processedAudioPath),
            model: 'whisper-large-v3',
            temperature: 0,
            response_format: 'verbose_json',
            timestamp_granularities: ['segment'],
        };
        if (job.sourceLang === 'tn') {
            whisperOptions.language = 'ar';
            whisperOptions.prompt = "برشة، شنوا، علاش، نحب، ما نيش، نمشي، توة، خاطر";
        }

        const transcription = await groq.audio.transcriptions.create(whisperOptions);
        let finalSegments = (transcription.segments || []).map(s => ({
            start: s.start,
            end: s.end,
            text: s.text
        }));

        if (job.sourceLang === 'tn') {
            finalSegments = await refineTunisianSegments(finalSegments);
            const normalizedData = await normalizeSegments(finalSegments);
            finalSegments = finalSegments.map((s, i) => ({
                ...s,
                text: normalizedData[i].normalized_text || s.text,
                original_text: s.text
            }));
        }

        const transcriptPath = path.join(jobDir, 'transcript.json');
        fs.writeFileSync(transcriptPath, JSON.stringify(finalSegments, null, 2));

        // --- PHASE 1.5: DIARIZATION (Multi-Voice Assignment) ---
        await job.setStage('stt', 30);
        try {
            console.log(`[Job ${jobId}] Starting Diarization via Worker...`);

            // The worker now handles alignment and voice assignment
            const enhancedSegments = await processDiarization(processedAudioPath, finalSegments);

            if (enhancedSegments && enhancedSegments.length > 0) {
                finalSegments = enhancedSegments;
                console.log(`[Job ${jobId}] Diarization and voice assignment complete.`);
            } else {
                console.log(`[Job ${jobId}] No enhanced segments returned, using default.`);
            }
        } catch (err) {
            console.error(`[Job ${jobId}] Diarization failed, continuing with single voice:`, err.message);
        }

        // --- PHASE 2: TRANSLATE (if needed) ---
        if (job.mode === 'translate' || job.mode === 'dub') {
            await job.setStage('translate', 50);
            if (job.targetLang && job.targetLang !== job.sourceLang) {
                finalSegments = await translateSegments(finalSegments, job.targetLang);
            }
        }

        // --- PHASE 3: DUB / MUX ---
        let finalVideoPath = videoPath;
        const srtPath = path.join(jobDir, 'subtitles.srt');
        fs.writeFileSync(srtPath, generateSRT(finalSegments));

        if (job.mode === 'dub') {
            await job.setStage('tts', 70);
            const dubbedAudioPath = path.join(jobDir, 'dubbed.mp3');
            const segmentsJsonPath = path.join(jobDir, 'segments_dub.json');
            fs.writeFileSync(segmentsJsonPath, JSON.stringify(finalSegments));

            // Run dub.py
            await new Promise((resolve, reject) => {
                const dubPyPath = path.join(__dirname, '..', 'dub.py');
                if (!fs.existsSync(dubPyPath)) return reject(new Error('dub.py not found'));

                const py = spawn('python', [dubPyPath, segmentsJsonPath, videoPath, dubbedAudioPath, job.targetLang]);
                py.on('close', code => code === 0 ? resolve() : reject(new Error(`Dubbing failed with code ${code}`)));
                py.stderr.on('data', d => console.error(`[Dub Error]: ${d}`));
            });

            await job.setStage('mux', 90);
            const muxedVideoPath = path.join(jobDir, 'output_dubbed.mp4');
            // Simplified escaping for Linux (Docker)
            const escapedSrtPath = srtPath.replace(/'/g, "'\\''").replace(/:/g, '\\:');

            await new Promise((resolve, reject) => {
                ffmpeg(videoPath)
                    .input(dubbedAudioPath)
                    .outputOptions([
                        '-c:v libx264', '-preset fast', '-c:a aac', '-shortest',
                        '-vf', `subtitles='${escapedSrtPath}'`,
                        '-map', '0:v:0', '-map', '1:a:0'
                    ])
                    .on('end', resolve)
                    .on('error', (err) => {
                        console.error(`[Mux Error]: ${err.message}`);
                        reject(err);
                    })
                    .save(muxedVideoPath);
            });
            finalVideoPath = muxedVideoPath;
        }

        // --- MARK DONE ---
        await job.markDone({
            transcriptJsonPath: transcriptPath,
            srtPath: srtPath,
            dubbedVideoPath: finalVideoPath
        });

        await sendWebhook(job.callbackUrl, job);

    } catch (error) {
        console.error(`Job ${jobId} failed:`, error);
        await job.markFailed(error);
        await sendWebhook(job.callbackUrl, job);
    }
}, { connection });

worker.on('active', (job) => console.log(`Job ${job.id} started processing (BullMQ ID: ${job.id})`));
worker.on('completed', (job) => console.log(`Job ${job.id} completed successfully`));
worker.on('failed', (job, err) => console.error(`Job ${job.id} failed:`, err));

console.log('Worker started and listening on video-jobs queue...');

module.exports = worker;
