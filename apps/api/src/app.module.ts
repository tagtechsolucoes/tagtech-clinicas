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
import { RecordsController } from './records/records.controller';
import { RecordsService } from './records/records.service';
import { WhatsAppController } from './whatsapp/whatsapp.controller';
import { WHATSAPP_HTTP, WhatsAppService } from './whatsapp/whatsapp.service';
import { TeamService } from './team/team.service';
import { FinanceController, PublicFinanceController } from './finance/finance.controller';
import { FinanceService } from './finance/finance.service';
import { PlansService } from './finance/plans.service';
import { ResultsService } from './results/results.service';
import { StockController } from './stock/stock.controller';
import { StockService } from './stock/stock.service';
import { InsuranceController } from './insurance/insurance.controller';
import { InsuranceService } from './insurance/insurance.service';
import { FOCUS_HTTP, NfseService } from './nfse/nfse.service';

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
    RecordsController,
    FinanceController,
    PublicFinanceController,
    StockController,
    InsuranceController,
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
    RecordsService,
    FinanceService,
    PlansService,
    StockService,
    ResultsService,
    InsuranceService,
    NfseService,
    { provide: FOCUS_HTTP, useValue: (...a: Parameters<typeof fetch>) => fetch(...a) },
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
