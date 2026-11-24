import { Module } from '@nestjs/common';
import { AuditController } from './audit/audit';
import { AuthController } from './auth/auth.controller';
import { SessionGuard, TenantGuard } from './auth/auth.guard';
import { AuthService } from './auth/auth.service';
import { LoginLimiter, SignupLimiter } from './auth/login-limiter';
import { DbModule } from './db/db.module';
import { HealthController } from './health/health.controller';
import { Mailer } from './mail/mailer';
import { MediaController } from './media/media.controller';
import { defaultMediaDir, MEDIA_DIR, MediaService } from './media/media.service';
import { ClinicController } from './clinic/clinic.controller';
import { ClinicService } from './clinic/clinic.service';
import { InvitesController, TeamController } from './team/team.controller';
import { AgendaController } from './agenda/agenda.controller';
import { AgendaService } from './agenda/agenda.service';
import { PatientsController } from './patients/patients.controller';
import { PatientsService } from './patients/patients.service';
import { PublicController } from './public/public.controller';
import { PublicService } from './public/public.service';
import { WhatsAppController } from './whatsapp/whatsapp.controller';
import { WHATSAPP_HTTP, WhatsAppService } from './whatsapp/whatsapp.service';
import { TeamService } from './team/team.service';

@Module({
  imports: [DbModule],
  controllers: [
    HealthController,
    AuthController,
    TeamController,
    InvitesController,
    AuditController,
    ClinicController,
    PatientsController,
    AgendaController,
    PublicController,
    WhatsAppController,
    MediaController,
  ],
  providers: [
    AuthService,
    Mailer,
    LoginLimiter,
    SignupLimiter,
    SessionGuard,
    TenantGuard,
    TeamService,
    ClinicService,
    PatientsService,
    AgendaService,
    PublicService,
    WhatsAppService,
    { provide: WHATSAPP_HTTP, useValue: (...a: Parameters<typeof fetch>) => fetch(...a) },
    { provide: MEDIA_DIR, useFactory: defaultMediaDir },
    {
      provide: MediaService,
      useFactory: (dir: string) => new MediaService(dir),
      inject: [MEDIA_DIR],
    },
  ],
})
export class AppModule {}
