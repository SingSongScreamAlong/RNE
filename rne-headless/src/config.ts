// =====================================================================
// RNE Headless Service - Configuration
// =====================================================================

export interface Source {
    name: string;
    url: string;
    type: 'video' | 'playlist' | 'channel';
    priority: number;
    category: string;
}

export interface Config {
    brain: {
        endpoint: string;
        apiKey: string;
        reconnectIntervalMs: number;
        maxReconnectAttempts: number;
        batchIntervalMs: number;
        batchMaxSize: number;
    };
    browser: {
        headless: boolean;
        viewport: { width: number; height: number };
        userAgent: string;
    };
    streams: {
        sources: Source[];
        maxConcurrent: number;
        rotationIntervalMinutes: number;
    };
    capture: {
        fps: number;
        quality: number;
    };
    // Vision AI (Gemini - high volume, perception)
    vision: {
        enabled: boolean;
        googleApiKey: string;
        model: string;
        analyzeEveryNthFrame: number;
    };
    // Reasoning AI (GPT-5 - low volume, deep thinking)
    reasoning: {
        enabled: boolean;
        openaiApiKey: string;
        model: string;
        maxTokens: number;
    };
    // Scheduled reports
    reporting: {
        enabled: boolean;
        times: string[]; // ['0600', '2000']
        timezone: string;
        discordWebhook: string;
    };
    server: {
        healthPort: number;
    };
}

const defaultSources: Source[] = [
    // === Formula 1 ===
    { name: 'F1 Official', url: 'https://www.youtube.com/@Formula1/videos', type: 'channel', priority: 1, category: 'F1' },
    { name: 'F1 Highlights', url: 'https://www.youtube.com/playlist?list=PLfoNZDHitwjUv0pjTwlV1vzaE0r7UDVDR', type: 'playlist', priority: 1, category: 'F1' },

    // === IMSA / SportsCar ===
    { name: 'IMSA Official', url: 'https://www.youtube.com/@IMSA/videos', type: 'channel', priority: 2, category: 'IMSA' },

    // === WEC / Endurance ===
    { name: 'FIA WEC', url: 'https://www.youtube.com/@FIAWEC/videos', type: 'channel', priority: 2, category: 'WEC' },
    { name: 'Le Mans 24h', url: 'https://www.youtube.com/@24hoursoflemans/videos', type: 'channel', priority: 2, category: 'WEC' },

    // === NASCAR / Oval ===
    { name: 'NASCAR', url: 'https://www.youtube.com/@NASCAR/videos', type: 'channel', priority: 3, category: 'NASCAR' },

    // === IndyCar ===
    { name: 'IndyCar', url: 'https://www.youtube.com/@INDYCAR/videos', type: 'channel', priority: 3, category: 'IndyCar' },

    // === Simracing ===
    { name: 'iRacing', url: 'https://www.youtube.com/@iRacing/videos', type: 'channel', priority: 4, category: 'Simracing' },
    { name: 'ACC Esports', url: 'https://www.youtube.com/@ACCompetizione/videos', type: 'channel', priority: 4, category: 'Simracing' },
    { name: 'The Sim Grid', url: 'https://www.youtube.com/@TheSimGrid/videos', type: 'channel', priority: 4, category: 'Simracing' },

    // === GT / Touring ===
    { name: 'GT World', url: 'https://www.youtube.com/@GTWorld/videos', type: 'channel', priority: 3, category: 'GT' },

    // === Rally ===
    { name: 'WRC', url: 'https://www.youtube.com/@WRC/videos', type: 'channel', priority: 3, category: 'Rally' },

    // === Formula E ===
    { name: 'Formula E', url: 'https://www.youtube.com/@FIAFormulaE/videos', type: 'channel', priority: 3, category: 'FormulaE' },
];

export function loadConfig(): Config {
    return {
        brain: {
            endpoint: process.env.BRAIN_ENDPOINT || 'https://coral-app-x988a.ondigitalocean.app',
            apiKey: process.env.BRAIN_API_KEY || 'dev-watcher-key',
            reconnectIntervalMs: 5000,
            maxReconnectAttempts: 10,
            batchIntervalMs: 1000,
            batchMaxSize: 50,
        },
        browser: {
            headless: process.env.HEADLESS !== 'false',
            viewport: { width: 1280, height: 720 },
            userAgent: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        },
        streams: {
            sources: defaultSources,
            maxConcurrent: parseInt(process.env.MAX_STREAMS || '2', 10),
            rotationIntervalMinutes: parseInt(process.env.ROTATION_MINUTES || '20', 10),
        },
        capture: {
            fps: parseFloat(process.env.CAPTURE_FPS || '1'),
            quality: 80,
        },
        // Vision AI (Gemini) - high volume frame analysis
        vision: {
            enabled: !!process.env.GOOGLE_API_KEY,
            googleApiKey: process.env.GOOGLE_API_KEY || '',
            model: process.env.VISION_MODEL || 'gemini-2.0-flash',
            analyzeEveryNthFrame: parseInt(process.env.VISION_ANALYZE_EVERY_N || '60', 10),
        },
        // Reasoning AI (GPT-5) - low volume deep thinking
        reasoning: {
            enabled: !!process.env.OPENAI_API_KEY,
            openaiApiKey: process.env.OPENAI_API_KEY || '',
            model: process.env.REASONING_MODEL || 'gpt-4o',
            maxTokens: parseInt(process.env.REASONING_MAX_TOKENS || '2000', 10),
        },
        // Scheduled reports
        reporting: {
            enabled: !!(process.env.OPENAI_API_KEY && process.env.DISCORD_WEBHOOK),
            times: (process.env.REPORT_TIMES || '0600,2000').split(','),
            timezone: process.env.REPORT_TIMEZONE || 'America/New_York',
            discordWebhook: process.env.DISCORD_WEBHOOK || '',
        },
        server: {
            healthPort: parseInt(process.env.HEALTH_PORT || '8080', 10),
        },
    };
}
