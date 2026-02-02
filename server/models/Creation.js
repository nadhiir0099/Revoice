const mongoose = require('mongoose');

const CreationSchema = new mongoose.Schema({
    userId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    title: {
        type: String,
        default: 'Untitled Video'
    },
    status: {
        type: String,
        enum: ['uploading', 'transcribed', 'edited', 'processing', 'dubbed', 'failed'],
        default: 'uploading'
    },
    sourceDialect: {
        type: String,
        enum: ['original', 'tunisian_normalized'],
        default: 'original'
    },
    targetLanguage: String,
    detectedGender: {
        type: String,
        enum: ['male', 'female', 'unknown'],
        default: 'unknown'
    },
    detectedLanguage: String,
    originalFilename: String, // Keeping for convenience/reference
    resultUrl: String,        // Keeping for convenience/reference
    useCloning: {
        type: Boolean,
        default: false
    },
    speakerClones: {
        type: Map,
        of: String,
        default: {}
    }
}, { timestamps: true });

module.exports = mongoose.model('Creation', CreationSchema);
