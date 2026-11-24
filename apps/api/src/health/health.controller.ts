import { Controller, Get, Inject, ServiceUnavailableException } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { DbService } from '../db/db.module';

@Controller('health')
export class HealthController {
  constructor(@Inject(DbService) private readonly dbService: DbService) {}

  @Get()
  async check(): Promise<{ status: 'ok' }> {
    try {
      await this.dbService.db.execute(sql`select 1`);
    } catch {
      throw new ServiceUnavailableException('banco de dados indisponível');
    }
    return { status: 'ok' };
  }
}
