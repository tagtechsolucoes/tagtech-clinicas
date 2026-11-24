import { Injectable } from '@nestjs/common';
import { AttemptLimiter } from '../common/attempt-limiter';

/** Freia tentativa de adivinhar senha: 5 erros em 15 minutos para o mesmo e-mail e IP. */
@Injectable()
export class LoginLimiter extends AttemptLimiter {
  constructor() {
    super({
      maxFailures: 5,
      windowMs: 15 * 60 * 1000,
      message: 'Muitas tentativas. Aguarde alguns minutos e tente de novo.',
    });
  }
}

/** Cadastros novos: 5 por hora por IP, para ninguém encher o banco de restaurantes falsos. */
@Injectable()
export class SignupLimiter extends AttemptLimiter {
  constructor() {
    super({
      maxFailures: 5,
      windowMs: 60 * 60 * 1000,
      message: 'Muitos cadastros a partir desta rede. Tente mais tarde.',
    });
  }
}
