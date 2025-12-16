// =====================================================================
// RNE AI - Knowledge Store (Racing Intelligence Database)
// =====================================================================

import { writeFile, readFile, mkdir } from 'fs/promises';
import { existsSync } from 'fs';
import { createLogger } from './logger.js';

const logger = createLogger('KnowledgeStore');

export interface RacingInsight {
    id: string;
    timestamp: string;
    category: string;
    source: {
        videoId: string;
        videoTitle: string;
        frameTime: number;
    };
    type: string;
    content: string;
    confidence: number;
    tags: string[];
}

export interface IncidentRecord {
    timestamp: string;
    category: string;
    videoId: string;
    frameTime: number;
    type: string;
    severity: string;
    description: string;
    trackConditions?: {
        weather: string;
        trackState: string;
        visibility: string;
    };
}

export interface StrategyPattern {
    timestamp: string;
    category: string;
    videoId: string;
    observation: string;
    pitActivity: boolean;
    tireCompound?: string;
    trackConditions?: {
        weather: string;
        trackState: string;
        visibility: string;
    };
}

export interface KnowledgeBase {
    metadata: {
        version: string;
        lastUpdated: string;
        totalInsights: number;
        totalIncidents: number;
        totalStrategyPatterns: number;
    };
    insights: RacingInsight[];
    incidents: IncidentRecord[];
    strategyPatterns: StrategyPattern[];
    categoryStats: Record<string, {
        insightsCount: number;
        incidentsCount: number;
        hoursWatched: number;
    }>;
}

export class KnowledgeStore {
    private dataDir: string;
    private knowledgeBase: KnowledgeBase;
    private saveInterval: NodeJS.Timeout | null = null;
    private dirty = false;

    constructor(dataDir: string = '/app/data') {
        this.dataDir = dataDir;
        this.knowledgeBase = this.createEmptyKnowledgeBase();
    }

    private createEmptyKnowledgeBase(): KnowledgeBase {
        return {
            metadata: {
                version: '1.0.0',
                lastUpdated: new Date().toISOString(),
                totalInsights: 0,
                totalIncidents: 0,
                totalStrategyPatterns: 0,
            },
            insights: [],
            incidents: [],
            strategyPatterns: [],
            categoryStats: {},
        };
    }

    async initialize(): Promise<void> {
        try {
            // Create data directory if it doesn't exist
            if (!existsSync(this.dataDir)) {
                await mkdir(this.dataDir, { recursive: true });
            }

            // Load existing knowledge base
            const filePath = `${this.dataDir}/knowledge.json`;
            if (existsSync(filePath)) {
                const data = await readFile(filePath, 'utf-8');
                this.knowledgeBase = JSON.parse(data);
                logger.info(`Loaded knowledge base: ${this.knowledgeBase.metadata.totalInsights} insights`);
            } else {
                logger.info('Starting with empty knowledge base');
            }

            // Setup periodic save
            this.saveInterval = setInterval(() => this.save(), 60000); // Save every minute

        } catch (error) {
            logger.error(`Failed to initialize knowledge store: ${error}`);
        }
    }

    async addInsight(insight: RacingInsight): Promise<void> {
        // Deduplicate by checking if similar insight exists
        const exists = this.knowledgeBase.insights.some(i =>
            i.source.videoId === insight.source.videoId &&
            Math.abs(i.source.frameTime - insight.source.frameTime) < 10 &&
            i.content === insight.content
        );

        if (!exists) {
            this.knowledgeBase.insights.push(insight);
            this.knowledgeBase.metadata.totalInsights++;
            this.updateCategoryStats(insight.category, 'insights');
            this.dirty = true;

            logger.debug(`Added insight: ${insight.type} - ${insight.content.substring(0, 50)}...`);
        }
    }

    async addIncident(incident: IncidentRecord): Promise<void> {
        this.knowledgeBase.incidents.push(incident);
        this.knowledgeBase.metadata.totalIncidents++;
        this.updateCategoryStats(incident.category, 'incidents');
        this.dirty = true;

        logger.info(`🚨 Incident detected: ${incident.type} (${incident.severity})`);
    }

    async addStrategyPattern(pattern: StrategyPattern): Promise<void> {
        this.knowledgeBase.strategyPatterns.push(pattern);
        this.knowledgeBase.metadata.totalStrategyPatterns++;
        this.dirty = true;

        logger.debug(`Strategy pattern: ${pattern.observation.substring(0, 50)}...`);
    }

    private updateCategoryStats(category: string, field: 'insights' | 'incidents'): void {
        if (!this.knowledgeBase.categoryStats[category]) {
            this.knowledgeBase.categoryStats[category] = {
                insightsCount: 0,
                incidentsCount: 0,
                hoursWatched: 0,
            };
        }

        if (field === 'insights') {
            this.knowledgeBase.categoryStats[category].insightsCount++;
        } else {
            this.knowledgeBase.categoryStats[category].incidentsCount++;
        }
    }

    updateWatchTime(category: string, hours: number): void {
        if (!this.knowledgeBase.categoryStats[category]) {
            this.knowledgeBase.categoryStats[category] = {
                insightsCount: 0,
                incidentsCount: 0,
                hoursWatched: 0,
            };
        }
        this.knowledgeBase.categoryStats[category].hoursWatched += hours;
        this.dirty = true;
    }

    async save(): Promise<void> {
        if (!this.dirty) return;

        try {
            this.knowledgeBase.metadata.lastUpdated = new Date().toISOString();
            const filePath = `${this.dataDir}/knowledge.json`;
            await writeFile(filePath, JSON.stringify(this.knowledgeBase, null, 2));
            this.dirty = false;
            logger.debug('Knowledge base saved');
        } catch (error) {
            logger.error(`Failed to save knowledge base: ${error}`);
        }
    }

    // Query methods for PitBox integration
    getInsightsByCategory(category: string): RacingInsight[] {
        return this.knowledgeBase.insights.filter(i => i.category === category);
    }

    getInsightsByType(type: string): RacingInsight[] {
        return this.knowledgeBase.insights.filter(i => i.type === type);
    }

    getRecentIncidents(hours: number = 24): IncidentRecord[] {
        const cutoff = new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();
        return this.knowledgeBase.incidents.filter(i => i.timestamp > cutoff);
    }

    getStrategyPatternsByConditions(weather: string): StrategyPattern[] {
        return this.knowledgeBase.strategyPatterns.filter(
            p => p.trackConditions?.weather === weather
        );
    }

    getStats() {
        return {
            ...this.knowledgeBase.metadata,
            categoryStats: this.knowledgeBase.categoryStats,
        };
    }

    // Generate report for daily digest
    generateDailyReport(since: Date): object {
        const sinceIso = since.toISOString();

        const recentInsights = this.knowledgeBase.insights.filter(i => i.timestamp > sinceIso);
        const recentIncidents = this.knowledgeBase.incidents.filter(i => i.timestamp > sinceIso);
        const recentPatterns = this.knowledgeBase.strategyPatterns.filter(p => p.timestamp > sinceIso);

        // Group insights by type
        const insightsByType: Record<string, number> = {};
        for (const insight of recentInsights) {
            insightsByType[insight.type] = (insightsByType[insight.type] || 0) + 1;
        }

        // Group by category
        const byCategory: Record<string, number> = {};
        for (const insight of recentInsights) {
            byCategory[insight.category] = (byCategory[insight.category] || 0) + 1;
        }

        return {
            period: {
                from: sinceIso,
                to: new Date().toISOString(),
            },
            summary: {
                totalInsights: recentInsights.length,
                totalIncidents: recentIncidents.length,
                totalStrategyPatterns: recentPatterns.length,
            },
            insightsByType,
            byCategory,
            topInsights: recentInsights
                .sort((a, b) => b.confidence - a.confidence)
                .slice(0, 10)
                .map(i => ({
                    category: i.category,
                    type: i.type,
                    content: i.content,
                    source: i.source.videoTitle,
                })),
            incidents: recentIncidents.map(i => ({
                type: i.type,
                severity: i.severity,
                description: i.description,
                category: i.category,
            })),
        };
    }

    async shutdown(): Promise<void> {
        if (this.saveInterval) {
            clearInterval(this.saveInterval);
        }
        await this.save();
        logger.info('Knowledge store shut down');
    }
}
