const mongoose = require('mongoose');

const JobSchema = new mongoose.Schema({
    clientId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'ApiClient',
        required: true
    },
    mode: {
        type: String,
        enum: ['transcribe', 'translate', 'dub'],
        required: true
    },
    sourceLang: {
        type: String,
        required: true
    },
    targetLang: {
        type: String
    },
    status: {
        type: String,
        enum: ['queued', 'processing', 'done', 'failed'],
        default: 'queued'
    },
    stage: {
        type: String,
        enum: ['upload', 'stt', 'translate', 'tts', 'mux'],
        default: 'upload'
    },
    progress: {
        type: Number,
        default: 0
    },
    input: {
        originalFilename: String,
        videoPath: String,
        mimeType: String,
        size: Number
    },
    outputs: {
        transcriptJsonPath: String,
        srtPath: String,
        vttPath: String,
        dubbedVideoPath: String,
        downloadUrls: Map
    },
    error: {
        message: String,
        stack: String
    },
    callbackUrl: {
        type: String
    },
    createdAt: {
        type: Date,
        default: Date.now
    },
    updatedAt: {
        type: Date,
        default: Date.now
    }
}, {
    timestamps: true
});

// Helper functions
JobSchema.methods.setStage = function (stage, progress) {
    this.stage = stage;
    this.progress = progress;
    return this.save();
};

JobSchema.methods.markDone = function (outputs) {
    this.status = 'done';
    this.progress = 100;
    this.outputs = { ...this.outputs, ...outputs };
    return this.save();
};

JobSchema.methods.markFailed = function (error) {
    this.status = 'failed';
    this.error = {
        message: error.message,
        stack: error.stack
    };
    return this.save();
};

module.exports = mongoose.model('Job', JobSchema);
