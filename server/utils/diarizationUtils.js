const axios = require('axios');

const DIARIZATION_WORKER_URL = process.env.DIARIZATION_WORKER_URL || 'http://diarization-worker:8000';

/**
 * Calls the external diarization worker to get speaker segments and voice assignments.
 */
async function processDiarization(audioPath, whisperSegments) {
    console.log(`[Diarization] Requesting diarization and assignment for ${audioPath}`);
    let retries = 5;
    while (retries > 0) {
        try {
            const response = await axios.post(`${DIARIZATION_WORKER_URL}/diarize`, {
                audioPath: audioPath,
                whisperSegments: whisperSegments.map(s => ({
                    start: s.start,
                    end: s.end,
                    text: s.text
                }))
            });
            return response.data;
        } catch (error) {
            // If the worker is still loading (503), wait and retry
            if (error.response && error.response.status === 503 && retries > 1) {
                console.log(`[Diarization] Worker is still loading models (503). Retrying in 30s... (${retries - 1} retries left)`);
                await new Promise(resolve => setTimeout(resolve, 30000));
                retries--;
                continue;
            }

            if (error.response) {
                console.error(`[Diarization] Worker returned error ${error.response.status}:`, JSON.stringify(error.response.data));
            } else if (error.request) {
                console.error(`[Diarization] No response from worker. Is it running at ${DIARIZATION_WORKER_URL}?`);
            } else {
                console.error(`[Diarization] Request error: ${error.message}`);
            }
            throw error;
        }
    }
}

module.exports = {
    processDiarization
};
