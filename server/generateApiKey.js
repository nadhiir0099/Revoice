const mongoose = require('mongoose');
const crypto = require('crypto');
const ApiClient = require('./models/ApiClient');
const dotenv = require('dotenv');

dotenv.config();

async function generateApiKey(clientName) {
    await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/revoice');

    const apiKey = `fuse_${crypto.randomBytes(32).toString('hex')}`;
    const keyHash = crypto.createHash('sha256').update(apiKey).digest('hex');

    const client = new ApiClient({
        name: clientName,
        keyHash: keyHash
    });

    await client.save();
    console.log('API Client registered successfully!');
    console.log('Client Name:', clientName);
    console.log('API Key:', apiKey);
    console.log('IMPORTANT: Store this key safely. It will not be shown again.');

    await mongoose.disconnect();
}

const name = process.argv[2];
if (!name) {
    console.error('Usage: node generateApiKey.js <ClientName>');
    process.exit(1);
}

generateApiKey(name).catch(err => {
    console.error('Error generating API key:', err);
    process.exit(1);
});
