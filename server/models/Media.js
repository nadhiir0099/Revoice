const mongoose = require('mongoose');

const MediaSchema = new mongoose.Schema({
    creationId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Creation',
        required: true
    },
    type: {
        type: String,
        enum: ['original_video', 'audio', 'dubbed_video', 'vtt'],
        required: true
    },
    url: {
        type: String,
        required: true
    },
    metadata: {
        type: Object,
        default: {}
    },
    createdAt: {
        type: Date,
        default: Date.now
    }
});

module.exports = mongoose.model('Media', MediaSchema);
