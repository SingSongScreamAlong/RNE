// =====================================================================
// RNE AI - Report Scheduler
// Automated daily reports via Email or Discord
// =====================================================================

import nodemailer from 'nodemailer';
import { createLogger } from './logger.js';
import { ReasoningEngine, DailyReport } from './reasoning-engine.js';
import { KnowledgeStore } from './knowledge-store.js';

const logger = createLogger('Scheduler');

export interface SchedulerConfig {
    reportTimes: string[]; // '0600', '2000'
    timezone: string; // 'America/New_York'
    discordWebhook?: string;
    email?: {
        from: string;      // rne@okboxbox.com
        to: string;        // conrad@okboxbox.com
        smtpUser: string;  // rne@okboxbox.com
        smtpPass: string;  // app password
    };
}

export class ReportScheduler {
    private config: SchedulerConfig;
    private reasoningEngine: ReasoningEngine;
    private knowledgeStore: KnowledgeStore;
    private checkInterval: NodeJS.Timeout | null = null;
    private lastReportTime: Date | null = null;
    private emailTransport: nodemailer.Transporter | null = null;

    constructor(
        config: SchedulerConfig,
        reasoningEngine: ReasoningEngine,
        knowledgeStore: KnowledgeStore
    ) {
        this.config = config;
        this.reasoningEngine = reasoningEngine;
        this.knowledgeStore = knowledgeStore;

        // Setup email transport if configured
        if (config.email) {
            this.emailTransport = nodemailer.createTransport({
                service: 'gmail',
                auth: {
                    user: config.email.smtpUser,
                    pass: config.email.smtpPass,
                },
            });
            logger.info(`📧 Email configured: ${config.email.from} → ${config.email.to}`);
        }
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
                if (this.shouldSendReport()) {
                    this.generateAndSendReport();
                }
            }
        }
    }

    private shouldSendReport(): boolean {
        if (!this.lastReportTime) return true;

        // Don't send if we sent a report in the last hour
        const hourAgo = new Date(Date.now() - 60 * 60 * 1000);
        return this.lastReportTime < hourAgo;
    }

    async generateAndSendReport(): Promise<void> {
        logger.info('📊 Generating scheduled report...');
        this.lastReportTime = new Date();

        try {
            // Get data since last report (or last 12 hours if first report)
            const since = new Date(Date.now() - 12 * 60 * 60 * 1000);
            const report = await this.reasoningEngine.generateDailyReport(since);

            // Format report
            const markdown = this.formatReportAsMarkdown(report);
            const html = this.formatReportAsHtml(report);

            // Send via configured channels
            if (this.config.email && this.emailTransport) {
                await this.sendEmail(report, html);
            }

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
            `- Categories: ${Object.keys(report.categories).join(', ') || 'N/A'}`,
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

    private formatReportAsHtml(report: DailyReport): string {
        return `
<!DOCTYPE html>
<html>
<head>
    <style>
        body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; background: #f5f5f5; }
        .container { background: white; border-radius: 12px; padding: 24px; box-shadow: 0 2px 8px rgba(0,0,0,0.1); }
        h1 { color: #e10600; margin-bottom: 8px; }
        h2 { color: #333; border-bottom: 2px solid #e10600; padding-bottom: 8px; margin-top: 24px; }
        .period { color: #666; font-size: 14px; margin-bottom: 16px; }
        .summary { background: #f8f9fa; padding: 16px; border-radius: 8px; margin: 16px 0; }
        .stats { display: flex; gap: 16px; margin: 16px 0; }
        .stat { background: #e8f4f8; padding: 12px; border-radius: 8px; flex: 1; text-align: center; }
        ul { padding-left: 20px; }
        li { margin: 8px 0; }
        .footer { margin-top: 24px; padding-top: 16px; border-top: 1px solid #eee; color: #999; font-size: 12px; }
    </style>
</head>
<body>
    <div class="container">
        <h1>🏎️ RNE Intelligence Report</h1>
        <div class="period">Period: ${report.period.from.split('T')[0]} to ${report.period.to.split('T')[0]}</div>
        
        <div class="summary">
            <strong>Summary:</strong><br/>
            ${report.summary}
        </div>
        
        <div class="stats">
            <div class="stat">
                <div style="font-size: 24px; font-weight: bold;">${report.framesAnalyzed}</div>
                <div style="font-size: 12px;">Frames Analyzed</div>
            </div>
            <div class="stat">
                <div style="font-size: 24px; font-weight: bold;">${Object.keys(report.categories).length}</div>
                <div style="font-size: 12px;">Categories</div>
            </div>
        </div>

        ${report.topInsights.length > 0 ? `
        <h2>💡 Key Insights</h2>
        <ul>
            ${report.topInsights.map(i => `<li>${i}</li>`).join('')}
        </ul>
        ` : ''}

        ${report.incidents.length > 0 ? `
        <h2>🚨 Incidents</h2>
        <ul>
            ${report.incidents.map(i => `<li>${i}</li>`).join('')}
        </ul>
        ` : ''}

        ${report.strategyPatterns.length > 0 ? `
        <h2>⚡ Strategy Patterns</h2>
        <ul>
            ${report.strategyPatterns.map(p => `<li>${p}</li>`).join('')}
        </ul>
        ` : ''}

        ${report.recommendations.length > 0 ? `
        <h2>✅ Recommendations</h2>
        <ul>
            ${report.recommendations.map(r => `<li>${r}</li>`).join('')}
        </ul>
        ` : ''}
        
        <div class="footer">
            Generated by Racecraft Neural Engine (RNE)<br/>
            Powered by Gemini Vision + GPT-5 Reasoning
        </div>
    </div>
</body>
</html>`;
    }

    private async sendEmail(report: DailyReport, html: string): Promise<void> {
        if (!this.emailTransport || !this.config.email) return;

        try {
            await this.emailTransport.sendMail({
                from: `"RNE Reports" <${this.config.email.from}>`,
                to: this.config.email.to,
                subject: `🏎️ RNE Intelligence Report - ${new Date().toLocaleDateString()}`,
                html: html,
            });

            logger.info(`📧 Email sent to ${this.config.email.to}`);
        } catch (error) {
            logger.error(`Email send failed: ${error}`);
        }
    }

    private async sendToDiscord(content: string): Promise<void> {
        if (!this.config.discordWebhook) return;

        try {
            const response = await fetch(this.config.discordWebhook, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    content: content.substring(0, 2000),
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
