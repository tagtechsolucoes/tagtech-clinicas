import { Controller, Get, Inject, ServiceUnavailableException } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { DbService } from '../db/db.module';

@Controller('health')
export class HealthController {
  constructor(@Inject(DbService) private readonly dbService: DbService) {}

  @Get()
  async check(): Promise<{ status: 'ok'; version: string }> {
    try {
      await this.dbService.db.execute(sql`select 1`);
    } catch {
      throw new ServiceUnavailableException('banco de dados indisponível');
    }
    // Versão no ar (ex.: "1.2.0 (a1b2c3d)"), para conferir depois de um deploy.
    return { status: 'ok', version: process.env.APP_VERSION ?? 'dev' };
  }
}
