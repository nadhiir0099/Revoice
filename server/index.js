const dotenv = require('dotenv');
dotenv.config();

const express = require('express');
const cors = require('cors');
const multer = require('multer');
const { groq, translateSegments, normalizeSegments, refineTunisianSegments } = require('./services/aiService');
const { generateSRT } = require('./utils/srtUtils');
const fs = require('fs');
const path = require('path');
const ffmpeg = require('fluent-ffmpeg');
const bcrypt = require('bcryptjs');
const session = require('express-session');
const { MongoStore } = require('connect-mongo');
const passport = require('./config/passport');
const connectDB = require('./config/db');
const Job = require('./models/Job');
const ApiClient = require('./models/ApiClient');
const User = require('./models/User');
const Creation = require('./models/Creation');
const Media = require('./models/Media');
const TranscriptSegment = require('./models/TranscriptSegment');
const { apiAuth, apiRateLimiter } = require('./utils/apiAuth');
const { videoQueue } = require('./config/queue');
const { pingRedis } = require('./config/redis');
const mongoose = require('mongoose');


// Connect to MongoDB
connectDB();

const port = 3005;
const app = express();

// Session setup
const mongoUri = process.env.MONGODB_URI || 'mongodb://localhost:27017/revoice';
app.use(session({
    secret: process.env.SESSION_SECRET || 'revoice-secret',
    store: MongoStore.create({
        mongoUrl: mongoUri
    }),
    resave: true, // Force session to be saved back to the session store
    saveUninitialized: false,
    name: 'revoice.sid',
    cookie: {
        maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
        httpOnly: true,
        secure: false, // Set to true if using HTTPS
        sameSite: 'lax'
    }
}));

app.use(passport.initialize());
app.use(passport.session());

app.use(cors({
    origin: 'http://localhost:5173',
    credentials: true
}));
app.use(express.json());
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

const upload = multer({ dest: 'uploads/' });

// Ensure jobs upload directory exists
if (!fs.existsSync(path.join(__dirname, 'uploads', 'jobs'))) {
    fs.mkdirSync(path.join(__dirname, 'uploads', 'jobs'), { recursive: true });
}


// --- AUTH HELPERS ---
const isAuthenticated = (req, res, next) => {
    if (req.isAuthenticated()) return next();
    res.status(401).json({ error: 'Unauthorized' });
};

// --- AUTH ENDPOINTS ---

// Signup
app.post('/api/auth/signup', async (req, res) => {
    try {
        const { email, password, name } = req.body;
        if (!email || !password || !name) return res.status(400).json({ error: 'Missing fields' });

        const existingUser = await User.findOne({ email });
        if (existingUser) return res.status(400).json({ error: 'Email already in use' });

        const hashedPassword = await bcrypt.hash(password, 10);
        const user = await User.create({ email, password: hashedPassword, name });

        req.login(user, (err) => {
            if (err) return res.status(500).json({ error: 'Login failed after signup' });
            res.json({ user: { id: user.id, email: user.email, name: user.name } });
        });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// Login
app.post('/api/auth/login', passport.authenticate('local'), (req, res) => {
    res.json({ user: { id: req.user.id, email: req.user.email, name: req.user.name } });
});

// Check auth state (for persistence on refresh)
app.get('/api/auth/me', (req, res) => {
    if (req.isAuthenticated()) {
        return res.json({ user: { id: req.user.id, email: req.user.email, name: req.user.name } });
    }
    res.status(401).json({ error: 'Not authenticated' });
});


// Logout
app.post('/api/auth/logout', (req, res) => {
    req.logout((err) => {
        if (err) return res.status(500).json({ error: 'Logout failed' });
        res.json({ success: true });
    });
});

// --- HEALTH CHECK ---
app.get('/api/v1/health', async (req, res) => {
    try {
        const mongoHealthy = mongoose.connection.readyState === 1;
        const redisHealthy = await pingRedis();

        const status = (mongoHealthy && redisHealthy) ? 200 : 503;
        res.status(status).json({
            status: status === 200 ? 'OK' : 'Service Unavailable',
            timestamp: new Date().toISOString(),
            services: {
                mongodb: mongoHealthy ? 'connected' : 'disconnected',
                redis: redisHealthy ? 'connected' : 'disconnected'
            }
        });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// --- CREATION ENDPOINTS ---

// List all creations for user (Sidebar summary)
app.get('/api/creations', isAuthenticated, async (req, res) => {
    try {
        console.log(`Fetching creations for user: ${req.user.id}`);
        const creations = await Creation.find({ userId: req.user.id })
            .select('title status sourceDialect targetLanguage createdAt')
            .sort({ createdAt: -1 });
        console.log(`Found ${creations.length} creations`);
        res.json({ creations });
    } catch (e) {
        console.error('Fetch creations error:', e);
        res.status(500).json({ error: e.message });
    }
});

// Create new creation skeleton
app.post('/api/creations', isAuthenticated, async (req, res) => {
    try {
        const creation = await Creation.create({
            userId: req.user.id,
            status: 'uploading'
        });
        res.json({ creation });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// Get single creation with full hydrated state
app.get('/api/creations/:id', isAuthenticated, async (req, res) => {
    try {
        const creation = await Creation.findOne({ _id: req.params.id, userId: req.user.id });
        if (!creation) return res.status(404).json({ error: 'Not found' });

        // Hydrate with media and segments
        const media = await Media.find({ creationId: creation._id });
        const segments = await TranscriptSegment.find({ creationId: creation._id }).sort({ start: 1 });

        res.json({
            creation,
            media,
            segments
        });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});



// Update creation
app.patch('/api/creations/:id', isAuthenticated, async (req, res) => {
    try {
        const creation = await Creation.findOneAndUpdate(
            { _id: req.params.id, userId: req.user.id },
            { $set: req.body },
            { new: true }
        );
        res.json({ creation });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// --- API V1 ENDPOINTS (EXTERNAL) ---

// POST /api/v1/jobs - Create & Upload
app.post('/api/v1/jobs', apiAuth, apiRateLimiter, upload.single('file'), async (req, res) => {
    try {
        const { mode, sourceLang, targetLang, callbackUrl } = req.body;
        if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
        if (!['transcribe', 'translate', 'dub'].includes(mode)) return res.status(400).json({ error: 'Invalid mode' });

        // 1. Create Job in DB
        const job = new Job({
            clientId: req.clientId,
            mode,
            sourceLang,
            targetLang,
            callbackUrl,
            status: 'queued',
            stage: 'upload',
            progress: 0,
            input: {
                originalFilename: req.file.originalname,
                mimeType: req.file.mimetype,
                size: req.file.size
            }
        });
        await job.save();

        // 2. Prepare directory and move file
        const jobDir = path.join(__dirname, 'uploads', 'jobs', job._id.toString());
        if (!fs.existsSync(jobDir)) fs.mkdirSync(jobDir, { recursive: true });

        const extension = path.extname(req.file.originalname) || '.mp4';
        const finalInputPath = path.join(jobDir, `input${extension}`);
        fs.renameSync(req.file.path, finalInputPath);

        // Update job with final path
        job.input.videoPath = finalInputPath;
        await job.save();

        // 3. Enqueue for processing
        await videoQueue.add('process-video', { jobId: job._id.toString() }, {
            attempts: 3,
            backoff: {
                type: 'exponential',
                delay: 1000
            }
        });

        res.json({ jobId: job._id, status: "queued" });
    } catch (e) {
        console.error('API V1 Job Creation Error:', e);
        res.status(500).json({ error: e.message });
    }
});

// GET /api/v1/jobs/:jobId - Status
app.get('/api/v1/jobs/:jobId', apiAuth, apiRateLimiter, async (req, res) => {
    try {
        const job = await Job.findOne({ _id: req.params.jobId, clientId: req.clientId });
        if (!job) return res.status(404).json({ error: 'Job not found' });

        res.json({
            jobId: job._id,
            status: job.status,
            stage: job.stage,
            progress: job.progress,
            createdAt: job.createdAt,
            updatedAt: job.updatedAt,
            error: job.status === 'failed' ? job.error.message : undefined
        });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// GET /api/v1/jobs/:jobId/result - Results
app.get('/api/v1/jobs/:jobId/result', apiAuth, apiRateLimiter, async (req, res) => {
    try {
        const job = await Job.findOne({ _id: req.params.jobId, clientId: req.clientId });
        if (!job) return res.status(404).json({ error: 'Job not found' });

        if (job.status !== 'done') {
            return res.status(409).json({ status: job.status, message: 'Job is not completed yet' });
        }

        // Return transcript JSON if available and download URLs
        let transcript = null;
        if (job.outputs.transcriptJsonPath && fs.existsSync(job.outputs.transcriptJsonPath)) {
            transcript = JSON.parse(fs.readFileSync(job.outputs.transcriptJsonPath, 'utf8'));
        }

        const baseUrl = `${req.protocol}://${req.get('host')}/api/v1/jobs/${job._id}/download`;
        const downloads = {
            srt: `${baseUrl}/srt`,
            video: `${baseUrl}/video`,
            json: `${baseUrl}/json`
        };

        if (job.outputs.vttPath && fs.existsSync(job.outputs.vttPath)) {
            downloads.vtt = `${baseUrl}/vtt`;
        }

        res.json({
            jobId: job._id,
            status: job.status,
            transcript,
            downloads
        });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// GET /api/v1/jobs/:jobId/download/:type
app.get('/api/v1/jobs/:jobId/download/:type', apiAuth, apiRateLimiter, async (req, res) => {
    try {
        const job = await Job.findOne({ _id: req.params.jobId, clientId: req.clientId });
        if (!job) return res.status(404).json({ error: 'Job not found' });
        if (job.status !== 'done') return res.status(409).json({ error: 'Job not completed' });

        let filePath;
        switch (req.params.type) {
            case 'srt': filePath = job.outputs.srtPath; break;
            case 'vtt': filePath = job.outputs.vttPath; break;
            case 'video': filePath = job.outputs.dubbedVideoPath; break;
            case 'json': filePath = job.outputs.transcriptJsonPath; break;
            default: return res.status(400).json({ error: 'Invalid file type' });
        }

        if (!filePath || !fs.existsSync(filePath)) {
            return res.status(404).json({ error: 'File not found' });
        }

        res.download(filePath);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});


// Save/Update multiple segments
app.post('/api/creations/:id/segments', isAuthenticated, async (req, res) => {
    try {
        const { segments } = req.body;
        // Simple wipe and replace for now to keep it robust
        await TranscriptSegment.deleteMany({ creationId: req.params.id });

        const prepared = segments.map(s => ({
            creationId: req.params.id,
            start: s.start,
            end: s.end,
            text: s.text,
            originalText: s.originalText || s.text,
            normalizedText: s.normalizedText,
            editedText: s.editedText,
            speakerId: s.speakerId || s.speaker_id,
            voiceId: s.voiceId || s.voice_id,
            gender: s.gender
        }));

        await TranscriptSegment.insertMany(prepared);
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// --- ENDPOINTS ---

// STEP 1: Upload, Transcribe, and Normalize
app.post('/api/init-transcription', isAuthenticated, upload.single('audio'), async (req, res) => {
    console.log('--- STEP 1: TRANSCRIPTION INIT ---');
    try {
        const userDir = path.join(__dirname, 'uploads', req.user.id);
        if (!fs.existsSync(userDir)) fs.mkdirSync(userDir, { recursive: true });

        let filePath = req.file.path;
        const originalName = req.file.originalname;
        const extension = path.extname(originalName).toLowerCase() || '.mp4';
        const uniqueFilename = `${req.file.filename}${extension}`;
        const finalPath = path.join(userDir, uniqueFilename);

        fs.renameSync(filePath, finalPath);
        filePath = finalPath;

        // Path for client (relative to uploads root)
        const relativeFilename = path.join(req.user.id, uniqueFilename).replace(/\\/g, '/');

        const videoExtensions = ['.mp4', '.mov', '.avi', '.mkv', '.webm'];
        const isVideo = videoExtensions.includes(extension);

        const filename = path.basename(filePath);
        let finalAudioPath = filePath;

        if (isVideo) {
            console.log('Video detected, extracting raw audio...');
        }

        // --- 1. Audio Preprocessing (Mandatory) ---
        console.log('Preprocessing audio (MP3, 64k, Mono, Denoise, Loudnorm)...');
        const processedAudioPath = path.join(userDir, `processed_${path.basename(filePath, path.extname(filePath))}.mp3`);

        await new Promise((resolve, reject) => {
            ffmpeg(filePath)
                .audioChannels(1)
                .audioFrequency(16000)
                .audioBitrate('64k') // Use MP3 64k to reduce size (~0.5MB/min) while keeping quality for STT
                .audioFilters([
                    'afftdn=nf=-25', // Light noise reduction
                    'loudnorm'       // Loudness normalization
                ])
                .toFormat('mp3')     // Use MP3 for efficient size/duration ratio
                .on('start', cmd => console.log('Preprocessing command:', cmd))
                .on('end', () => {
                    console.log('Audio preprocessing complete.');
                    resolve();
                })
                .on('error', (err) => reject(err))
                .save(processedAudioPath);
        });

        // Update finalAudioPath to point to the clean version for STT
        finalAudioPath = processedAudioPath;

        const languageMode = req.query.languageMode || 'original';
        console.log("Language Mode:", languageMode);

        const whisperOptions = {
            file: fs.createReadStream(finalAudioPath),
            model: 'whisper-large-v3',
            temperature: 0,
            response_format: 'verbose_json',
            timestamp_granularities: ['segment'],
        };

        if (languageMode === 'normalized_arabic') {
            console.log("Configuring Whisper for Tunisian Arabic...");
            whisperOptions.language = 'ar';
            whisperOptions.prompt = "برشة، شنوا، علاش، نحب، ما نيش، نمشي، توة، خاطر";
        } else {
            console.log("Configuring Whisper for Auto-Detect (Original)...");
            // No language or prompt set -> Auto detect
        }

        console.log('Transcribing:', finalAudioPath);
        try {
            const transcription = await groq.audio.transcriptions.create(whisperOptions);
            console.log('Transcription successful');

            let finalSegments = transcription.segments || [];
            if (finalSegments.length === 0) {
                finalSegments = [{
                    start: 0,
                    end: transcription.duration || 0,
                    text: transcription.text
                }];
            }

            finalSegments = finalSegments.map(s => ({
                start: s.start,
                end: s.end,
                text: s.text
            }));

            // --- BRANCHING: Arabic-Specific Pipeline ---
            if (languageMode === 'normalized_arabic') {
                // --- 4. Post-STT Refinement Layer (New: GitHub Models) ---
                console.log("Applying GPT-4o Refinement...");
                finalSegments = await refineTunisianSegments(finalSegments);

                // --- 5. Normalization Layer (Tunisian -> MSA) ---
                console.log("Normalizing segments (Tunisian -> MSA)...");
                const normalizedSegmentsData = await normalizeSegments(finalSegments);
                finalSegments = finalSegments.map((s, i) => ({
                    ...s,
                    text: normalizedSegmentsData[i].normalized_text || s.text,
                    original_text: s.text // Keep the refined Tunisian as original_text for reference
                }));
            } else {
                console.log("Skipping Arabic Correction/Normalization (Original Mode)");
                // In Original mode, we just keep the raw transcription
                finalSegments = finalSegments.map(s => ({
                    ...s,
                    original_text: s.text // Consistency for frontend
                }));
            }

            // --- Multi-Voice Assignment (Diarization) ---
            try {
                console.log("Starting Multi-Voice Assignment with Diarization via Worker...");
                const { processDiarization } = require('./utils/diarizationUtils');

                // Use the centralized worker service for alignment and voice assignment
                const enhanced = await processDiarization(finalAudioPath, finalSegments);

                if (enhanced && Array.isArray(enhanced)) {
                    finalSegments = enhanced;
                    console.log("Speaker Diarization & Voice Assignment complete.");
                } else {
                    console.log("Diarization worker returned no data. Using defaults.");
                }
            } catch (err) {
                console.error("Diarization block error:", err);
            }

            // Detect source dialect from payload/mode
            const dialectMap = { 'original': 'original', 'normalized_arabic': 'tunisian_normalized' };
            const sourceDialect = dialectMap[languageMode] || 'original';

            // Detect dominant gender for the creation record
            const dominantGender = finalSegments.length > 0 ?
                (finalSegments.filter(s => s.gender === 'female').length >
                    finalSegments.filter(s => s.gender === 'male').length ? 'female' : 'male') : 'unknown';

            // 1. Create Initial Creation record
            const creation = await Creation.create({
                userId: req.user.id,
                title: originalName.split('.')[0] + ' Dub',
                status: 'transcribed',
                sourceDialect,
                detectedGender: dominantGender,
                detectedLanguage: transcription.language || 'unknown', // Save detected language
                originalFilename: relativeFilename
            });

            // 2. Save Original Media Asset
            await Media.create({
                creationId: creation._id,
                type: 'original_video',
                url: `/uploads/${relativeFilename}`,
                metadata: { originalName, size: req.file.size }
            });

            // 3. Save Transcript Segments
            const segmentPrepared = finalSegments.map(s => ({
                creationId: creation._id,
                start: s.start,
                end: s.end,
                text: s.text,
                originalText: s.original_text || s.text,
                normalizedText: languageMode === 'normalized_arabic' ? s.text : undefined,
                speakerId: s.speaker_id,
                voiceId: s.voice_id,
                gender: s.gender
            }));
            await TranscriptSegment.insertMany(segmentPrepared);



            res.json({
                creationId: creation._id,
                filename: relativeFilename,
                segments: finalSegments
            });

        } catch (groqError) {
            console.error('Groq/Transcribe Detailed Error:', groqError);
            if (groqError.status === 429) {
                return res.status(429).json({ error: 'Groq API usage limit reached. Please try again later.' });
            }
            throw groqError;
        }

    } catch (error) {
        console.error('Init Transcription API error:', error);
        res.status(500).json({ error: 'Transcription Failed', details: error.message });
    }
});

// STEP 2: Finalize Dubbing
app.post('/api/finalize-dub', isAuthenticated, async (req, res) => {
    const cloneLog = (msg) => {
        fs.appendFileSync('cloning_debug.log', `[${new Date().toISOString()}] ${msg}\n`);
        console.log(msg);
    };
    cloneLog('--- STEP 2: FINALIZE DUBBING ---');
    try {
        cloneLog(`Finalize-dub body: ${JSON.stringify(req.body).substring(0, 500)}`);
        const { creationId, filename, segments, dub_language, sub_language, use_cloning } = req.body;

        if (!filename || !segments) {
            return res.status(400).json({ error: 'Missing filename or segments' });
        }

        const filePath = path.join(__dirname, 'uploads', filename); // filename is now 'userId/file.ext'
        if (!fs.existsSync(filePath)) {
            return res.status(404).json({ error: 'File not found. Please upload again.' });
        }

        const userDir = path.dirname(filePath);
        const baseName = path.basename(filename);

        const dubbedAudioPath = path.join(userDir, `dubbed_${baseName}.mp3`);
        const finalVideoPath = path.join(userDir, `final_${baseName}`);
        const srtPath = path.join(userDir, `subs_${baseName}.srt`);

        let sourceSegments = segments;

        // --- VOICE CLONING LAYER ---
        console.log(`Cloning flag (use_cloning): ${use_cloning}`);
        if (use_cloning && dub_language !== 'original') {
            console.log("Voice cloning requested. Checking for speaker clones...");
            const creation = await Creation.findById(creationId);
            if (!creation) throw new Error("Creation not found");

            creation.useCloning = true;

            if (!creation.speakerClones) {
                creation.speakerClones = new Map();
            }

            // Find unique speakers in segments
            const speakerIds = [...new Set(segments.map(s => s.speakerId || s.speaker_id).filter(id => id))];
            console.log(`Unique speakers found: ${speakerIds.join(', ')}`);

            for (const spkId of speakerIds) {
                const existing = creation.speakerClones.get(spkId) || creation.speakerClones.get(spkId.toString());
                if (!existing) {
                    cloneLog(`Cloning voice for speaker: ${spkId}...`);
                    const userDir = path.join(__dirname, 'uploads', req.user.id);
                    const samplePath = path.join(userDir, 'speaker_samples', `${spkId}_sample.wav`);

                    if (fs.existsSync(samplePath)) {
                        const { execSync } = require('child_process');
                        try {
                            const stdout = execSync(`python clone_voice.py "${spkId}" "${samplePath}"`, { stdio: ['pipe', 'pipe', 'pipe'] });
                            const voiceId = stdout.toString().trim();
                            cloneLog(`Cloning output for ${spkId}: [${voiceId}]`);
                            if (voiceId && !voiceId.startsWith('Error')) {
                                creation.speakerClones.set(spkId, voiceId);
                                cloneLog(`Successfully set clone for ${spkId} -> ${voiceId}`);
                            } else {
                                cloneLog(`Invalid voiceId returned for ${spkId}: ${voiceId}`);
                            }
                        } catch (err) {
                            cloneLog(`Cloning failed for ${spkId}: ${err.message}`);
                            if (err.stderr) cloneLog(`Stderr: ${err.stderr.toString()}`);
                            if (err.stdout) cloneLog(`Stdout: ${err.stdout.toString()}`);
                            cloneLog(`Stack trace: ${err.stack}`);
                        }
                    } else {
                        cloneLog(`Sample not found for ${spkId} at ${samplePath}`);
                    }
                } else {
                    cloneLog(`Using existing clone for ${spkId}: ${existing}`);
                }
            }
            creation.markModified('speakerClones');
            await creation.save();
            cloneLog(`Saved creation with speakerClones keys: ${Array.from(creation.speakerClones.keys()).join(', ')}`);

            // Update segments with cloned voice IDs
            sourceSegments = sourceSegments.map(s => {
                const spkId = s.speakerId || s.speaker_id;
                const cloneId = creation.speakerClones.get(spkId) || creation.speakerClones.get(spkId.toString());
                if (spkId && cloneId) {
                    cloneLog(`Mapping segment to cloned voice: ${spkId} -> ${cloneId}`);
                    return { ...s, voice_id: cloneId, voiceId: cloneId };
                }
                return s;
            });
        }

        // Translation for Subtitles
        let subSegments = sourceSegments;
        if (sub_language !== 'original') {
            subSegments = await translateSegments(sourceSegments, sub_language);
        }

        let dubbedVideoUrl = `http://localhost:3005/uploads/${filename}`;

        // Final Video Processing
        if (dub_language !== 'original' || (sub_language && sub_language !== 'none')) {
            const dubLang = dub_language;
            const subLang = sub_language;

            console.log("Processing final video (Dub:", dubLang, ", Sub:", subLang, ")...");

            try {
                let finalAudioSource = filePath;

                if (dubLang !== 'original') {
                    console.log("Generating Dubbed Audio...");
                    const { spawn } = require('child_process');
                    const segmentsJsonPath = path.join(userDir, `segments_dub_${baseName}.json`);
                    let dubSegments;

                    if (dubLang === subLang && subLang !== 'original') {
                        dubSegments = subSegments;
                    } else {
                        dubSegments = await translateSegments(sourceSegments, dubLang);
                    }
                    fs.writeFileSync(segmentsJsonPath, JSON.stringify(dubSegments, null, 2));
                    cloneLog(`Segments written to ${segmentsJsonPath}. Samples: ${JSON.stringify(dubSegments.slice(0, 1))}`);

                    const dubbedAudioPath = path.join(userDir, `dubbed_${baseName}.mp3`);
                    const originalVideoPath = filePath;

                    // Ensure dub.py exists
                    if (!fs.existsSync('dub.py')) {
                        throw new Error("dub.py not found");
                    }

                    const pythonProcess = spawn('python', ['dub.py', segmentsJsonPath, originalVideoPath, dubbedAudioPath, dubLang]);

                    await new Promise((resolve, reject) => {
                        pythonProcess.stdout.on('data', d => console.log(`[Py Log]: ${d}`));
                        pythonProcess.stderr.on('data', d => console.error(`[Py Error]: ${d}`));
                        pythonProcess.on('error', (err) => reject(err));
                        pythonProcess.on('close', code => {
                            if (code === 0) resolve();
                            else reject(new Error(`Dubbing script failed with code ${code}`));
                        });
                    });
                    finalAudioSource = dubbedAudioPath;
                }

                const finalVideoPath = path.join(userDir, `final_${baseName}`);
                const srtPath = path.join(userDir, `subs_${baseName}.srt`);

                if (!fs.existsSync('uploads')) fs.mkdirSync('uploads', { recursive: true });
                if (!fs.existsSync('temp_dub')) fs.mkdirSync('temp_dub', { recursive: true });

                fs.writeFileSync(srtPath, generateSRT(subSegments));

                const absoluteSrtPath = path.resolve(srtPath).replace(/\\/g, '/').replace(/:/g, '\\:');
                const escapedSrtPath = absoluteSrtPath.replace(/'/g, "'\\\\''");

                await new Promise((resolve, reject) => {
                    let command = ffmpeg(filePath);

                    if (finalAudioSource !== filePath) {
                        if (!fs.existsSync(finalAudioSource)) {
                            return reject(new Error(`Dubbed audio file not found: ${finalAudioSource}`));
                        }
                        command = command.input(finalAudioSource);
                    }

                    const outputOptions = [
                        '-c:v libx264',
                        '-preset fast',
                        '-c:a aac',
                        '-shortest'
                    ];

                    // Always burn subtitles if available
                    console.log(`Burning subtitles from: ${escapedSrtPath}`);
                    outputOptions.push('-vf', `subtitles='${escapedSrtPath}':force_style='Fontname=Arial,Fontsize=14,PrimaryColour=&H00FFFFFF,OutlineColour=&H00000000,BorderStyle=1,Outline=1,Shadow=0'`);

                    if (finalAudioSource !== filePath) {
                        outputOptions.push('-map', '0:v:0', '-map', '1:a:0');
                    } else {
                        outputOptions.push('-map', '0:v:0', '-map', '0:a:0');
                    }

                    command
                        .outputOptions(outputOptions)
                        .on('start', (cmd) => console.log('FFmpeg Command:', cmd))
                        .on('end', () => {
                            console.log('Final video processed successfully.');
                            resolve();
                        })
                        .on('error', (err, stdout, stderr) => {
                            console.error("FFmpeg merge error:", err);
                            console.error("FFmpeg stderr:", stderr);
                            reject(err);
                        })
                        .save(finalVideoPath);
                });

                const dubbedUrl = `/uploads/${path.join(req.user.id, `final_${baseName}`).replace(/\\/g, '/')}`;

                // Update Creation status
                await Creation.findByIdAndUpdate(req.body.creationId, {
                    status: 'dubbed',
                    resultUrl: dubbedUrl,
                    targetLanguage: dub_language
                });

                // Save Dubbed Media Asset
                await Media.create({
                    creationId: req.body.creationId,
                    type: 'dubbed_video',
                    url: dubbedUrl,
                    metadata: { dubLanguage: dub_language, subLanguage: sub_language }
                });

                dubbedVideoUrl = `http://localhost:3005${dubbedUrl}`;
            } catch (err) {
                console.error("Video processing failed:", err);
                throw err;
            }
        }

        res.json({
            dubbed_video_url: dubbedVideoUrl,
            status: 'completed'
        });

    } catch (error) {
        console.error('Finalize Dub API error:', error);
        res.status(500).json({ error: 'Finalization Failed', details: error.toString() });
    }
});

// Delete creation and all associated data
app.delete('/api/creations/:id', isAuthenticated, async (req, res) => {
    try {
        const creation = await Creation.findOne({ _id: req.params.id, userId: req.user.id });
        if (!creation) return res.status(404).json({ error: 'Creation not found' });

        // 1. Find all media associated with this creation
        const mediaItems = await Media.find({ creationId: creation._id });

        // 2. Delete physical files from disk
        mediaItems.forEach(item => {
            if (item.url) {
                // url is usually /uploads/userId/filename
                const relativePath = item.url.replace(/^\//, ''); // Remove leading slash
                const absolutePath = path.join(__dirname, relativePath);
                if (fs.existsSync(absolutePath)) {
                    try {
                        fs.unlinkSync(absolutePath);
                        console.log(`Deleted file: ${absolutePath}`);
                    } catch (err) {
                        console.error(`Failed to delete file: ${absolutePath}`, err);
                    }
                }
            }
        });

        // Also check for the original filename if not explicitly in Media
        if (creation.originalFilename) {
            const absolutePath = path.join(__dirname, 'uploads', creation.originalFilename);
            if (fs.existsSync(absolutePath)) {
                try {
                    fs.unlinkSync(absolutePath);
                    console.log(`Deleted original file: ${absolutePath}`);
                } catch (err) {
                    console.error(`Failed to delete original file: ${absolutePath}`, err);
                }
            }
        }

        // 3. Delete database records
        await Media.deleteMany({ creationId: creation._id });
        await TranscriptSegment.deleteMany({ creationId: creation._id });
        await Creation.deleteOne({ _id: creation._id });

        res.json({ success: true, message: 'Creation and associated data deleted' });
    } catch (e) {
        console.error('Delete creation error:', e);
        res.status(500).json({ error: e.message });
    }
});

// --- AUTOMATED CLEANUP ---
const cleanupOldFiles = () => {
    console.log("Running scheduled cleanup of old files...");
    const uploadsDir = path.join(__dirname, 'uploads');
    const MAX_AGE_MS = 24 * 60 * 60 * 1000; // 24 hours

    const scanAndRemove = (dir) => {
        if (!fs.existsSync(dir)) return;
        const files = fs.readdirSync(dir);

        files.forEach(file => {
            const fullPath = path.join(dir, file);
            const stats = fs.statSync(fullPath);

            if (stats.isDirectory()) {
                scanAndRemove(fullPath);
                // Also remove empty directories
                if (fs.readdirSync(fullPath).length === 0) {
                    try { fs.rmdirSync(fullPath); } catch (e) { }
                }
            } else {
                if (Date.now() - stats.mtimeMs > MAX_AGE_MS) {
                    try {
                        fs.unlinkSync(fullPath);
                        console.log(`Cleaned up old file: ${fullPath}`);
                    } catch (e) {
                        console.error(`Failed to clean up: ${fullPath}`, e);
                    }
                }
            }
        });
    };

    try {
        scanAndRemove(uploadsDir);
    } catch (err) {
        console.error("Cleanup task failed:", err);
    }
};

// Run cleanup every 12 hours
setInterval(cleanupOldFiles, 12 * 60 * 60 * 1000);
// Also run once on startup
setTimeout(cleanupOldFiles, 5000);

app.listen(port, () => {
    console.log(`Server running on http://localhost:${port}`);
}).setTimeout(300000); // 5 minute timeout for large uploads
