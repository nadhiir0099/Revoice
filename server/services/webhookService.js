const axios = require('axios');
const crypto = require('crypto');

async function sendWebhook(callbackUrl, job, secret = 'fuse-shared-secret') {
    if (!callbackUrl) return;

    const baseUrl = process.env.PUBLIC_BASE_URL || 'http://localhost:3005';
    const payload = {
        jobId: job._id,
        status: job.status,
        resultUrl: job.status === 'done' ? `${baseUrl}/api/v1/jobs/${job._id}/result` : null,
        error: job.error ? job.error.message : undefined
    };

    const signature = crypto
        .createHmac('sha256', secret)
        .update(JSON.stringify(payload))
        .digest('hex');

    try {
        await axios.post(callbackUrl, payload, {
            headers: {
                'X-Signature': `sha256=${signature}`,
                'Content-Type': 'application/json'
            },
            timeout: 5000
        });
        console.log(`Webhook sent to ${callbackUrl} for job ${job._id}`);
    } catch (error) {
        console.error(`Failed to send webhook to ${callbackUrl}:`, error.message);
    }
}

module.exports = { sendWebhook };
