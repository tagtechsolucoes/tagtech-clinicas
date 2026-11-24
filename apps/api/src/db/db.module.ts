import { Global, Inject, Injectable, Module, type OnApplicationShutdown } from '@nestjs/common';
import { createDb, type Db, type DbHandle } from '@tagtech/db';

export const DATABASE_URL = Symbol('DATABASE_URL');

/**
 * Conexão da API com o banco, sempre com o usuário da aplicação (sujeito ao RLS).
 * Dados de negócio só são acessados dentro de withTenant(db, tenantId, ...).
 */
@Injectable()
export class DbService implements OnApplicationShutdown {
  private readonly handle: DbHandle;

  constructor(@Inject(DATABASE_URL) url: string) {
    this.handle = createDb(url);
  }

  get db(): Db {
    return this.handle.db;
  }

  async onApplicationShutdown(): Promise<void> {
    await this.handle.close();
  }
}

@Global()
@Module({
  providers: [
    {
      provide: DATABASE_URL,
      useFactory: () => {
        const url = process.env.DATABASE_URL;
        if (!url) throw new Error('DATABASE_URL não definida. Copie .env.example para .env.');
        return url;
      },
    },
    DbService,
  ],
  exports: [DbService],
})
export class DbModule {}
