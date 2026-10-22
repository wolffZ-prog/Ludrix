class CancelledError extends Error {
    constructor(message = 'cancelado') {
        super(message);
        this.name = 'CancelledError';
    }
}
class JobError extends Error {
    constructor(message) {
        super(message);
        this.name = 'JobError';
    }
}
function humanSize(bytes) {
    const n = Math.max(0, Number(bytes) || 0);
    if (n < 1024)
        return `${n} B`;
    const units = ['KB', 'MB', 'GB', 'TB'];
    let v = n / 1024;
    let i = 0;
    while (v >= 1024 && i < units.length - 1) {
        v /= 1024;
        i++;
    }
    return `${v.toFixed(v >= 100 ? 0 : 1)} ${units[i]}`;
}
function humanTime(seconds) {
    const s = Math.max(0, Math.floor(Number(seconds) || 0));
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    if (h > 0)
        return `${h}h ${m}min`;
    if (m > 0)
        return `${m}min`;
    return `${s}s`;
}
function humanEta(seconds) {
    const s = Math.max(0, Math.floor(Number(seconds) || 0));
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = s % 60;
    if (h > 0)
        return `${h}h ${String(m).padStart(2, '0')}m`;
    return `${m}m${String(sec).padStart(2, '0')}s`;
}

export { humanSize, humanTime, humanEta, CancelledError, JobError };
