const { Queue } = require('bullmq');
const { connection } = require('./redis');

const videoQueue = new Queue('video-jobs', { connection });

module.exports = { videoQueue };
