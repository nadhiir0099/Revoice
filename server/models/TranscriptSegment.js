const mongoose = require('mongoose');

const TranscriptSegmentSchema = new mongoose.Schema({
    creationId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Creation',
        required: true
    },
    start: Number,
    end: Number,
    text: String, // The "main" text (edited or original)
    originalText: String,
    normalizedText: String,
    editedText: String,
    speakerId: String,
    voiceId: String,
    gender: String,
    createdAt: {
        type: Date,
        default: Date.now
    }
});

module.exports = mongoose.model('TranscriptSegment', TranscriptSegmentSchema);
