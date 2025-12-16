// =====================================================================
// RNE AI - Report Scheduler
// Automated daily reports at 0600 and 2000 EST
// =====================================================================

import { createLogger } from './logger.js';
import { ReasoningEngine, DailyReport } from './reasoning-engine.js';
import { KnowledgeStore } from './knowledge-store.js';

const logger = createLogger('Scheduler');

export interface SchedulerConfig {
    reportTimes: string[]; // '0600', '2000'
    timezone: string; // 'America/New_York'
    discordWebhook?: string;
    emailConfig?: {
        to: string;
        smtpHost: string;
        smtpPort: number;
        smtpUser: string;
        smtpPass: string;
    };
}

export class ReportScheduler {
    private config: SchedulerConfig;
    private reasoningEngine: ReasoningEngine;
    private knowledgeStore: KnowledgeStore;
    private checkInterval: NodeJS.Timeout | null = null;
    private lastReportTime: Date | null = null;

    constructor(
        config: SchedulerConfig,
        reasoningEngine: ReasoningEngine,
        knowledgeStore: KnowledgeStore
    ) {
        this.config = config;
        this.reasoningEngine = reasoningEngine;
        this.knowledgeStore = knowledgeStore;
    }

    start(): void {
        logger.info(`📅 Scheduler started: reports at ${this.config.reportTimes.join(', ')} ${this.config.timezone}`);

        // Check every minute if it's time for a report
        this.checkInterval = setInterval(() => this.checkSchedule(), 60000);

        // Also check immediately
        this.checkSchedule();
    }

    stop(): void {
        if (this.checkInterval) {
            clearInterval(this.checkInterval);
            this.checkInterval = null;
        }
        logger.info('Scheduler stopped');
    }

    private checkSchedule(): void {
        const now = new Date();
        const estTime = new Intl.DateTimeFormat('en-US', {
            timeZone: this.config.timezone,
            hour: '2-digit',
            minute: '2-digit',
            hour12: false,
        }).format(now);

        const currentTime = estTime.replace(':', '');

        // Check if current time matches any scheduled time
        for (const scheduleTime of this.config.reportTimes) {
            if (currentTime === scheduleTime) {
                // Only send once per scheduled time (avoid duplicate sends)
                if (this.shouldSendReport(scheduleTime)) {
                    this.generateAndSendReport();
                }
            }
        }
    }

    private shouldSendReport(scheduleTime: string): boolean {
        if (!this.lastReportTime) return true;

        // Don't send if we sent a report in the last hour
        const hourAgo = new Date(Date.now() - 60 * 60 * 1000);
        return this.lastReportTime < hourAgo;
    }

    private async generateAndSendReport(): Promise<void> {
        logger.info('📊 Generating scheduled report...');
        this.lastReportTime = new Date();

        try {
            // Get data since last report (or last 12 hours if first report)
            const since = new Date(Date.now() - 12 * 60 * 60 * 1000);
            const report = await this.reasoningEngine.generateDailyReport(since);

            // Format report as markdown
            const markdown = this.formatReportAsMarkdown(report);

            // Send via configured channels
            if (this.config.discordWebhook) {
                await this.sendToDiscord(markdown);
            }

            logger.info('✅ Report sent successfully');
        } catch (error) {
            logger.error(`Failed to generate/send report: ${error}`);
        }
    }

    private formatReportAsMarkdown(report: DailyReport): string {
        const lines = [
            `# 🏎️ RNE Intelligence Report`,
            `**Period:** ${report.period.from.split('T')[0]} to ${report.period.to.split('T')[0]}`,
            '',
            `## Summary`,
            report.summary,
            '',
            `## 📊 Stats`,
            `- Frames Analyzed: ${report.framesAnalyzed}`,
            `- Categories: ${Object.keys(report.categories).join(', ')}`,
            '',
        ];

        if (report.topInsights.length > 0) {
            lines.push('## 💡 Key Insights');
            report.topInsights.forEach(insight => {
                lines.push(`- ${insight}`);
            });
            lines.push('');
        }

        if (report.incidents.length > 0) {
            lines.push('## 🚨 Incidents');
            report.incidents.forEach(incident => {
                lines.push(`- ${incident}`);
            });
            lines.push('');
        }

        if (report.strategyPatterns.length > 0) {
            lines.push('## ⚡ Strategy Patterns');
            report.strategyPatterns.forEach(pattern => {
                lines.push(`- ${pattern}`);
            });
            lines.push('');
        }

        if (report.recommendations.length > 0) {
            lines.push('## ✅ Recommendations');
            report.recommendations.forEach(rec => {
                lines.push(`- ${rec}`);
            });
        }

        return lines.join('\n');
    }

    private async sendToDiscord(content: string): Promise<void> {
        if (!this.config.discordWebhook) return;

        try {
            const response = await fetch(this.config.discordWebhook, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    content: content.substring(0, 2000), // Discord limit
                }),
            });

            if (!response.ok) {
                throw new Error(`Discord webhook failed: ${response.status}`);
            }

            logger.info('Report sent to Discord');
        } catch (error) {
            logger.error(`Discord send failed: ${error}`);
        }
    }

    // Manual report generation for testing
    async generateReportNow(): Promise<DailyReport> {
        const since = new Date(Date.now() - 12 * 60 * 60 * 1000);
        return this.reasoningEngine.generateDailyReport(since);
    }
}
