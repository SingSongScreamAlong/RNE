// =====================================================================
// RNE AI Analysis Engine - Frame Analyzer (Gemini + OpenAI)
// =====================================================================

import { GoogleGenerativeAI, Part } from '@google/generative-ai';
import OpenAI from 'openai';
import { createLogger } from './logger.js';
import { KnowledgeStore, RacingInsight } from './knowledge-store.js';

const logger = createLogger('AIAnalyzer');

export interface FrameAnalysis {
    timestamp: string;
    videoId: string;
    videoTitle: string;
    category: string;
    frameTime: number;

    // Scene understanding
    sceneType: 'race' | 'qualifying' | 'practice' | 'pitlane' | 'replay' | 'interview' | 'analysis' | 'other';

    // Positions & gaps
    visiblePositions?: {
        position: number;
        driver?: string;
        team?: string;
        gap?: string;
    }[];

    // Track conditions
    trackConditions?: {
        weather: 'dry' | 'wet' | 'damp' | 'mixed';
        trackState: 'green' | 'yellow' | 'red' | 'safety_car' | 'vsc';
        visibility: 'clear' | 'rain' | 'spray' | 'fog';
    };

    // Incidents
    incident?: {
        detected: boolean;
        type?: 'contact' | 'spin' | 'crash' | 'off_track' | 'puncture' | 'mechanical';
        severity?: 'minor' | 'moderate' | 'major';
        description?: string;
    };

    // Strategy observations
    strategyObservation?: {
        pitActivity: boolean;
        tireCompound?: string;
        stintLength?: number;
        observation?: string;
    };

    // Racing insights
    insights: string[];

    // Raw AI response for learning
    rawAnalysis: string;

    // Confidence score
    confidence: number;

    // Provider used
    provider: 'gemini' | 'openai';
}

export interface AnalyzerConfig {
    provider: 'gemini' | 'openai';
    googleApiKey?: string;
    openaiApiKey?: string;
    model: string;
    analyzeEveryNthFrame: number;
    maxTokens: number;
}

const RACING_ANALYSIS_PROMPT = `You are an expert motorsport analyst AI. Analyze this racing video frame and extract insights.

CONTEXT:
- Video: {videoTitle}
- Category: {category}
- Timestamp: {frameTime}s

ANALYZE AND RESPOND IN JSON ONLY (no markdown, no explanation):
{
  "sceneType": "race|qualifying|practice|pitlane|replay|interview|analysis|other",
  "visiblePositions": [{"position": 1, "driver": "name or null", "team": "name or null", "gap": "gap or null"}],
  "trackConditions": {
    "weather": "dry|wet|damp|mixed",
    "trackState": "green|yellow|red|safety_car|vsc", 
    "visibility": "clear|rain|spray|fog"
  },
  "incident": {
    "detected": true/false,
    "type": "contact|spin|crash|off_track|puncture|mechanical",
    "severity": "minor|moderate|major",
    "description": "brief description"
  },
  "strategyObservation": {
    "pitActivity": true/false,
    "tireCompound": "soft|medium|hard|intermediate|wet",
    "observation": "strategy insight"
  },
  "insights": [
    "Key observation 1",
    "Key observation 2"
  ],
  "confidence": 0.0-1.0
}

Be precise. If you can't determine something, use null. Focus on actionable racing intelligence.`;

export class AIAnalyzer {
    private config: AnalyzerConfig;
    private gemini: GoogleGenerativeAI | null = null;
    private openai: OpenAI | null = null;
    private knowledgeStore: KnowledgeStore;
    private frameCounter = 0;
    private totalAnalyzed = 0;
    private totalCost = 0;

    constructor(config: AnalyzerConfig, knowledgeStore: KnowledgeStore) {
        this.config = config;
        this.knowledgeStore = knowledgeStore;

        if (config.provider === 'gemini' && config.googleApiKey) {
            this.gemini = new GoogleGenerativeAI(config.googleApiKey);
            logger.info(`🧠 AI Analyzer: Gemini (${config.model})`);
        } else if (config.provider === 'openai' && config.openaiApiKey) {
            this.openai = new OpenAI({ apiKey: config.openaiApiKey });
            logger.info(`🧠 AI Analyzer: OpenAI (${config.model})`);
        }

        logger.info(`Analyzing every ${config.analyzeEveryNthFrame} frames`);
    }

    async analyzeFrame(
        screenshotBase64: string,
        videoId: string,
        videoTitle: string,
        category: string,
        frameTime: number
    ): Promise<FrameAnalysis | null> {
        this.frameCounter++;

        // Only analyze every Nth frame to control costs
        if (this.frameCounter % this.config.analyzeEveryNthFrame !== 0) {
            return null;
        }

        try {
            const prompt = RACING_ANALYSIS_PROMPT
                .replace('{videoTitle}', videoTitle)
                .replace('{category}', category)
                .replace('{frameTime}', frameTime.toString());

            let rawAnalysis: string;

            if (this.config.provider === 'gemini' && this.gemini) {
                rawAnalysis = await this.analyzeWithGemini(prompt, screenshotBase64);
            } else if (this.config.provider === 'openai' && this.openai) {
                rawAnalysis = await this.analyzeWithOpenAI(prompt, screenshotBase64);
            } else {
                logger.warn('No AI provider configured');
                return null;
            }

            this.totalAnalyzed++;

            // Parse JSON response
            const jsonMatch = rawAnalysis.match(/\{[\s\S]*\}/);
            if (!jsonMatch) {
                logger.warn('AI response did not contain valid JSON');
                return null;
            }

            const parsed = JSON.parse(jsonMatch[0]);

            const analysis: FrameAnalysis = {
                timestamp: new Date().toISOString(),
                videoId,
                videoTitle,
                category,
                frameTime,
                sceneType: parsed.sceneType || 'other',
                visiblePositions: parsed.visiblePositions,
                trackConditions: parsed.trackConditions,
                incident: parsed.incident,
                strategyObservation: parsed.strategyObservation,
                insights: parsed.insights || [],
                rawAnalysis,
                confidence: parsed.confidence || 0.5,
                provider: this.config.provider,
            };

            // Store insights in knowledge base
            await this.storeInsights(analysis);

            logger.debug(`🧠 [${this.config.provider}] Analyzed: ${analysis.sceneType}, ${analysis.insights.length} insights`);

            return analysis;

        } catch (error) {
            logger.error(`Frame analysis failed: ${error}`);
            return null;
        }
    }

    private async analyzeWithGemini(prompt: string, imageBase64: string): Promise<string> {
        const model = this.gemini!.getGenerativeModel({ model: this.config.model });

        const imagePart: Part = {
            inlineData: {
                mimeType: 'image/jpeg',
                data: imageBase64,
            },
        };

        const result = await model.generateContent([prompt, imagePart]);
        const response = await result.response;

        // Estimate cost (Gemini 2.0 Flash is very cheap)
        this.totalCost += 0.0025; // ~$0.0025 per image

        return response.text();
    }

    private async analyzeWithOpenAI(prompt: string, imageBase64: string): Promise<string> {
        const response = await this.openai!.chat.completions.create({
            model: this.config.model,
            max_tokens: this.config.maxTokens,
            messages: [
                {
                    role: 'user',
                    content: [
                        { type: 'text', text: prompt },
                        {
                            type: 'image_url',
                            image_url: {
                                url: `data:image/jpeg;base64,${imageBase64}`,
                                detail: 'high',
                            },
                        },
                    ],
                },
            ],
        });

        // Estimate cost
        const inputTokens = response.usage?.prompt_tokens || 0;
        const outputTokens = response.usage?.completion_tokens || 0;
        this.totalCost += (inputTokens * 0.00001) + (outputTokens * 0.00003);

        return response.choices[0]?.message?.content || '';
    }

    private async storeInsights(analysis: FrameAnalysis): Promise<void> {
        // Extract and store valuable insights
        for (const insight of analysis.insights) {
            if (insight && insight.length > 10) {
                const racingInsight: RacingInsight = {
                    id: `${analysis.videoId}-${analysis.frameTime}-${Date.now()}`,
                    timestamp: analysis.timestamp,
                    category: analysis.category,
                    source: {
                        videoId: analysis.videoId,
                        videoTitle: analysis.videoTitle,
                        frameTime: analysis.frameTime,
                    },
                    type: this.classifyInsight(insight, analysis),
                    content: insight,
                    confidence: analysis.confidence,
                    tags: this.extractTags(analysis),
                };

                await this.knowledgeStore.addInsight(racingInsight);
            }
        }

        // Store incident if detected
        if (analysis.incident?.detected) {
            await this.knowledgeStore.addIncident({
                timestamp: analysis.timestamp,
                category: analysis.category,
                videoId: analysis.videoId,
                frameTime: analysis.frameTime,
                type: analysis.incident.type || 'unknown',
                severity: analysis.incident.severity || 'unknown',
                description: analysis.incident.description || '',
                trackConditions: analysis.trackConditions,
            });
        }

        // Store strategy observation
        if (analysis.strategyObservation?.observation) {
            await this.knowledgeStore.addStrategyPattern({
                timestamp: analysis.timestamp,
                category: analysis.category,
                videoId: analysis.videoId,
                observation: analysis.strategyObservation.observation,
                pitActivity: analysis.strategyObservation.pitActivity,
                tireCompound: analysis.strategyObservation.tireCompound,
                trackConditions: analysis.trackConditions,
            });
        }
    }

    private classifyInsight(insight: string, analysis: FrameAnalysis): string {
        const lowerInsight = insight.toLowerCase();

        if (lowerInsight.includes('pit') || lowerInsight.includes('strategy')) return 'strategy';
        if (lowerInsight.includes('overtake') || lowerInsight.includes('pass')) return 'overtaking';
        if (lowerInsight.includes('tire') || lowerInsight.includes('tyre')) return 'tires';
        if (lowerInsight.includes('weather') || lowerInsight.includes('rain')) return 'weather';
        if (lowerInsight.includes('gap') || lowerInsight.includes('position')) return 'positions';
        if (analysis.incident?.detected) return 'incident';

        return 'general';
    }

    private extractTags(analysis: FrameAnalysis): string[] {
        const tags: string[] = [analysis.category, analysis.sceneType];

        if (analysis.trackConditions?.weather) tags.push(analysis.trackConditions.weather);
        if (analysis.trackConditions?.trackState) tags.push(analysis.trackConditions.trackState);
        if (analysis.strategyObservation?.tireCompound) tags.push(analysis.strategyObservation.tireCompound);
        if (analysis.incident?.type) tags.push(`incident:${analysis.incident.type}`);

        return tags.filter(Boolean);
    }

    getStats() {
        return {
            provider: this.config.provider,
            model: this.config.model,
            framesProcessed: this.frameCounter,
            framesAnalyzed: this.totalAnalyzed,
            estimatedCost: this.totalCost.toFixed(4),
        };
    }
}
