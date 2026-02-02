const mongoose = require('mongoose');

const ApiClientSchema = new mongoose.Schema({
    name: {
        type: String,
        required: true
    },
    keyHash: {
        type: String,
        required: true,
        unique: true
    },
    isActive: {
        type: Boolean,
        default: true
    },
    rateLimit: {
        type: Number,
        default: 100 // requests per hour
    },
    createdAt: {
        type: Date,
        default: Date.now
    }
});

module.exports = mongoose.model('ApiClient', ApiClientSchema);
