import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service.js';
import type { EnvConfig } from '../config/env.schema.js';

export const DATA_CLEANUP_CRON_NAME = 'data-cleanup';
export const READ_NOTIFICATION_RETENTION_DAYS = 30;

@Injectable()
export class DataCleanupService implements OnModuleInit {
  private readonly logger = new Logger(DataCleanupService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService<EnvConfig, true>,
  ) {}

  async onModuleInit() {
    // Perform non-blocking cleanup when application boots up
    try {
      await this.runCleanup();
    } catch (err) {
      this.logger.warn(
        `Initial data cleanup failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  @Cron(CronExpression.EVERY_DAY_AT_MIDNIGHT, { name: DATA_CLEANUP_CRON_NAME })
  async handleDailyScheduledCleanup(): Promise<void> {
    try {
      await this.runCleanup();
    } catch (err) {
      this.logger.error(
        `Daily scheduled data cleanup failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  async purgeExpiredSessions(): Promise<number> {
    const now = new Date();
    const result = await this.prisma.session.deleteMany({
      where: {
        expiresAt: { lt: now },
      },
    });
    this.logger.log(`[GDPR Art. 5 Data Minimization] Purged ${result.count} expired session(s)`);
    return result.count;
  }

  async purgeExpiredInvitations(): Promise<number> {
    const now = new Date();
    const result = await this.prisma.invitation.deleteMany({
      where: {
        OR: [{ expiresAt: { lt: now } }, { status: 'expired' }],
      },
    });
    this.logger.log(`[GDPR Art. 5 Data Minimization] Purged ${result.count} expired invitation(s)`);
    return result.count;
  }

  async purgeExpiredSignupAttempts(): Promise<number> {
    const windowSeconds = this.configService.get('LIMIT_SIGNUPS_WINDOW_SECONDS', { infer: true });
    const cutoff = new Date(Date.now() - windowSeconds * 1000);
    const result = await this.prisma.signupAttempt.deleteMany({
      where: {
        createdAt: { lt: cutoff },
      },
    });
    this.logger.log(`[Data Minimization] Purged ${result.count} expired signup attempt(s)`);
    return result.count;
  }

  /** A notification that was read and is a month old has done its job; unread ones stay. */
  async purgeReadNotifications(): Promise<number> {
    const cutoff = new Date(Date.now() - READ_NOTIFICATION_RETENTION_DAYS * 24 * 60 * 60 * 1000);
    const result = await this.prisma.notification.deleteMany({
      where: { readAt: { lt: cutoff } },
    });
    this.logger.log(`[Data Minimization] Purged ${result.count} read notification(s)`);
    return result.count;
  }

  async runCleanup(): Promise<{
    sessionsPurged: number;
    invitationsPurged: number;
    signupAttemptsPurged: number;
    notificationsPurged: number;
    timestamp: string;
  }> {
    const sessionsPurged = await this.purgeExpiredSessions();
    const invitationsPurged = await this.purgeExpiredInvitations();
    const signupAttemptsPurged = await this.purgeExpiredSignupAttempts();
    const notificationsPurged = await this.purgeReadNotifications();

    return {
      sessionsPurged,
      invitationsPurged,
      signupAttemptsPurged,
      notificationsPurged,
      timestamp: new Date().toISOString(),
    };
  }
}
