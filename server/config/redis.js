const Redis = require('ioredis');
const dotenv = require('dotenv');

dotenv.config();

const redisOptions = {
    host: process.env.REDIS_HOST || '127.0.0.1',
    port: process.env.REDIS_PORT || 6379,
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
};

const connection = new Redis(redisOptions);

const pingRedis = async () => {
    try {
        const res = await connection.ping();
        return res === 'PONG';
    } catch (error) {
        console.error('Redis Ping Error:', error);
        return false;
    }
};

module.exports = { connection, pingRedis };
