// =====================================================================
// RNE AI - Reasoning Engine (GPT-5 Brain)
// Deep reasoning, coaching, reports, synthesis
// =====================================================================

import OpenAI from 'openai';
import { createLogger } from './logger.js';
import { KnowledgeStore } from './knowledge-store.js';

const logger = createLogger('ReasoningEngine');

export interface CoachingInsight {
    timestamp: string;
    category: string;
    type: 'strategy' | 'setup' | 'driving' | 'general';
    title: string;
    explanation: string;
    actionItems: string[];
    confidence: number;
}

export interface DailyReport {
    period: { from: string; to: string };
    summary: string;
    hoursWatched: number;
    framesAnalyzed: number;
    categories: Record<string, number>;
    topInsights: string[];
    incidents: string[];
    strategyPatterns: string[];
    recommendations: string[];
}

export interface ReasoningConfig {
    openaiApiKey: string;
    model: string;
    maxTokens: number;
}

export class ReasoningEngine {
    private openai: OpenAI;
    private config: ReasoningConfig;
    private knowledgeStore: KnowledgeStore;

    constructor(config: ReasoningConfig, knowledgeStore: KnowledgeStore) {
        this.config = config;
        this.knowledgeStore = knowledgeStore;
        this.openai = new OpenAI({ apiKey: config.openaiApiKey });

        logger.info(`🧠 Reasoning Engine initialized: ${config.model}`);
    }

    // Generate daily intelligence report
    async generateDailyReport(since: Date): Promise<DailyReport> {
        logger.info('📊 Generating daily intelligence report...');

        const rawStats = this.knowledgeStore.generateDailyReport(since);

        const prompt = `You are a professional motorsport analyst AI. Generate a comprehensive daily intelligence report based on the following racing content analysis data.

DATA:
${JSON.stringify(rawStats, null, 2)}

Generate a report with:
1. A brief executive summary (2-3 sentences)
2. Key insights learned (top 5)
3. Notable incidents observed
4. Strategy patterns identified
5. Actionable recommendations for racing teams

Respond in JSON:
{
  "summary": "Executive summary here",
  "topInsights": ["insight 1", "insight 2", ...],
  "incidents": ["incident 1", ...],
  "strategyPatterns": ["pattern 1", ...],
  "recommendations": ["recommendation 1", ...]
}`;

        try {
            const response = await this.openai.chat.completions.create({
                model: this.config.model,
                max_tokens: this.config.maxTokens,
                messages: [{ role: 'user', content: prompt }],
            });

            const content = response.choices[0]?.message?.content || '{}';
            const jsonMatch = content.match(/\{[\s\S]*\}/);
            const parsed = jsonMatch ? JSON.parse(jsonMatch[0]) : {};

            return {
                period: (rawStats as any).period || { from: since.toISOString(), to: new Date().toISOString() },
                summary: parsed.summary || 'No data available for this period.',
                hoursWatched: 0, // Will be calculated
                framesAnalyzed: (rawStats as any).summary?.totalInsights || 0,
                categories: (rawStats as any).byCategory || {},
                topInsights: parsed.topInsights || [],
                incidents: parsed.incidents || [],
                strategyPatterns: parsed.strategyPatterns || [],
                recommendations: parsed.recommendations || [],
            };
        } catch (error) {
            logger.error(`Report generation failed: ${error}`);
            throw error;
        }
    }

    // Generate coaching insight from accumulated observations
    async synthesizeCoachingInsight(
        category: string,
        topic: string,
        observations: string[]
    ): Promise<CoachingInsight> {
        logger.info(`🧠 Synthesizing coaching insight: ${topic}`);

        const prompt = `You are an expert motorsport coach AI. Based on the following observations from ${category} racing content, provide a coaching insight.

TOPIC: ${topic}

OBSERVATIONS:
${observations.map((o, i) => `${i + 1}. ${o}`).join('\n')}

Provide actionable coaching guidance. Respond in JSON:
{
  "title": "Concise title for this insight",
  "explanation": "Detailed explanation of what we learned and why it matters",
  "actionItems": ["Specific action 1", "Specific action 2", ...],
  "confidence": 0.0-1.0
}`;

        try {
            const response = await this.openai.chat.completions.create({
                model: this.config.model,
                max_tokens: this.config.maxTokens,
                messages: [{ role: 'user', content: prompt }],
            });

            const content = response.choices[0]?.message?.content || '{}';
            const jsonMatch = content.match(/\{[\s\S]*\}/);
            const parsed = jsonMatch ? JSON.parse(jsonMatch[0]) : {};

            return {
                timestamp: new Date().toISOString(),
                category,
                type: 'general',
                title: parsed.title || topic,
                explanation: parsed.explanation || '',
                actionItems: parsed.actionItems || [],
                confidence: parsed.confidence || 0.5,
            };
        } catch (error) {
            logger.error(`Coaching synthesis failed: ${error}`);
            throw error;
        }
    }

    // Answer "why" questions using accumulated knowledge
    async answerQuestion(question: string, context: string): Promise<string> {
        logger.info(`🧠 Answering: ${question.substring(0, 50)}...`);

        const prompt = `You are an expert motorsport coach AI. Answer the following question based on your racing knowledge and the provided context.

QUESTION: ${question}

CONTEXT:
${context}

Provide a clear, actionable answer. Be specific and reference relevant racing concepts.`;

        try {
            const response = await this.openai.chat.completions.create({
                model: this.config.model,
                max_tokens: this.config.maxTokens,
                messages: [{ role: 'user', content: prompt }],
            });

            return response.choices[0]?.message?.content || 'Unable to generate answer.';
        } catch (error) {
            logger.error(`Question answering failed: ${error}`);
            throw error;
        }
    }

    // Analyze patterns across time
    async analyzePatterns(category: string): Promise<string[]> {
        const insights = this.knowledgeStore.getInsightsByCategory(category);
        const strategyPatterns = this.knowledgeStore.getStrategyPatternsByConditions('dry');

        if (insights.length < 5) {
            return ['Insufficient data - continue collecting observations'];
        }

        const prompt = `Analyze these racing observations and identify recurring patterns:

OBSERVATIONS (${category}):
${insights.slice(0, 20).map(i => i.content).join('\n')}

STRATEGY DATA:
${strategyPatterns.slice(0, 10).map(p => p.observation).join('\n')}

List 3-5 key patterns you observe. Be specific and actionable.`;

        try {
            const response = await this.openai.chat.completions.create({
                model: this.config.model,
                max_tokens: 500,
                messages: [{ role: 'user', content: prompt }],
            });

            const content = response.choices[0]?.message?.content || '';
            return content.split('\n').filter(line => line.trim().length > 10);
        } catch (error) {
            logger.error(`Pattern analysis failed: ${error}`);
            return [];
        }
    }
}
