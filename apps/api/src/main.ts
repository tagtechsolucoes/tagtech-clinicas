import 'reflect-metadata';
import { HttpAdapterHost, NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { AppModule } from './app.module';
import { configureApp } from './configure-app';
import { initMonitoring, MonitoringFilter } from './monitoring';

const monitoring = initMonitoring();

/**
 * Atrás do Caddy, o IP de quem chamou vem no X-Forwarded-For. TRUST_PROXY diz de quais
 * endereços aceitar esse cabeçalho (ex.: "loopback,uniquelocal" = a rede interna do Docker,
 * onde só o Caddy alcança a API). O Caddy descarta o X-Forwarded-For que vem da internet.
 * Sem proxy na frente, deixe vazio: senão qualquer um forjaria o IP e furaria os limites.
 */
const trustProxy = process.env.TRUST_PROXY?.trim();
const app = await NestFactory.create<NestFastifyApplication>(
  AppModule,
  new FastifyAdapter(
    (trustProxy ? { trustProxy } : {}) as ConstructorParameters<typeof FastifyAdapter>[0],
  ),
);
configureApp(app);
if (monitoring) app.useGlobalFilters(new MonitoringFilter(app.get(HttpAdapterHost).httpAdapter));
app.enableShutdownHooks();

if (process.env.NODE_ENV === 'production') {
  for (const name of ['TEAM_APP_URL', 'DATABASE_URL']) {
    if (!process.env[name]) throw new Error(`${name} é obrigatória em produção`);
  }
  if (!process.env.RESEND_API_KEY) {
    console.warn('RESEND_API_KEY ausente: e-mails de troca de senha vão só para o log.');
  }
}

const port = Number(process.env.PORT ?? 3000);
await app.listen(port, '0.0.0.0');
console.log(`API no ar em http://localhost:${port}`);
