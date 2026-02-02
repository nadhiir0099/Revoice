const crypto = require('crypto');
const ApiClient = require('../models/ApiClient');
const rateLimit = require('express-rate-limit');

const apiAuth = async (req, res, next) => {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ error: 'Missing or invalid Authorization header' });
    }

    const apiKey = authHeader.split(' ')[1];
    const keyHash = crypto.createHash('sha256').update(apiKey).digest('hex');

    try {
        const client = await ApiClient.findOne({ keyHash, isActive: true });
        if (!client) {
            return res.status(401).json({ error: 'Invalid API key' });
        }

        req.clientId = client._id;
        req.client = client;
        next();
    } catch (error) {
        res.status(500).json({ error: 'Internal Server Error' });
    }
};

const apiRateLimiter = rateLimit({
    windowMs: 60 * 60 * 1000, // 1 hour
    max: (req) => req.client ? req.client.rateLimit : 5000,
    message: { error: 'Too many requests from this API key, please try again after an hour' },
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => req.client._id.toString(),
});

module.exports = { apiAuth, apiRateLimiter };
