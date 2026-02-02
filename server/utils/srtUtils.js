const formatTime = (seconds) => {
    const date = new Date(0);
    date.setSeconds(seconds);
    const ms = Math.floor((seconds % 1) * 1000);
    return date.toISOString().substr(11, 8) + ',' + ms.toString().padStart(3, '0');
};

const generateSRT = (segments) => {
    return segments.map((s, i) => {
        return `${i + 1}\n${formatTime(s.start)} --> ${formatTime(s.end)}\n${s.text}`;
    }).join('\n\n') + '\n\n';
}

module.exports = {
    formatTime,
    generateSRT
};
