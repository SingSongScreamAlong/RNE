// =====================================================================
// RNE Headless Service - Logger
// =====================================================================

type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LOG_LEVELS: Record<LogLevel, number> = {
    debug: 0,
    info: 1,
    warn: 2,
    error: 3,
};

const currentLevel = (process.env.LOG_LEVEL as LogLevel) || 'info';

function formatTimestamp(): string {
    return new Date().toISOString().replace('T', ' ').substring(0, 19);
}

function shouldLog(level: LogLevel): boolean {
    return LOG_LEVELS[level] >= LOG_LEVELS[currentLevel];
}

export function createLogger(context: string) {
    const prefix = `[${context}]`;

    return {
        debug: (message: string, ...args: unknown[]) => {
            if (shouldLog('debug')) {
                console.debug(`${formatTimestamp()} DEBUG ${prefix} ${message}`, ...args);
            }
        },
        info: (message: string, ...args: unknown[]) => {
            if (shouldLog('info')) {
                console.log(`${formatTimestamp()} INFO  ${prefix} ${message}`, ...args);
            }
        },
        warn: (message: string, ...args: unknown[]) => {
            if (shouldLog('warn')) {
                console.warn(`${formatTimestamp()} WARN  ${prefix} ${message}`, ...args);
            }
        },
        error: (message: string, ...args: unknown[]) => {
            if (shouldLog('error')) {
                console.error(`${formatTimestamp()} ERROR ${prefix} ${message}`, ...args);
            }
        },
    };
}
