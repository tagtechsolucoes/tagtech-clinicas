import { Injectable, Logger } from '@nestjs/common';

export interface MailMessage {
  to: string;
  subject: string;
  text: string;
}

/**
 * Envio de e-mail. Com RESEND_API_KEY e MAIL_FROM, envia pela API do Resend (sem SDK, um POST).
 * Sem eles (desenvolvimento), escreve a mensagem no log. Em ambos os casos guarda as últimas
 * mensagens na memória, para os testes.
 */
@Injectable()
export class Mailer {
  private readonly logger = new Logger('Mailer');
  readonly outbox: MailMessage[] = [];

  async send(message: MailMessage): Promise<void> {
    this.outbox.push(message);
    if (this.outbox.length > 20) this.outbox.shift();
    const key = process.env.RESEND_API_KEY;
    const from = process.env.MAIL_FROM;
    if (key && from) {
      const response = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
        body: JSON.stringify({
          from,
          to: [message.to],
          subject: message.subject,
          text: message.text,
        }),
        signal: AbortSignal.timeout(10_000),
      });
      if (!response.ok) {
        // Não derruba o pedido de quem chamou: registra e segue (a resposta já é genérica).
        this.logger.error(`Resend respondeu ${response.status} ao enviar "${message.subject}"`);
      }
      return;
    }
    if (process.env.NODE_ENV !== 'test') {
      this.logger.log(`E-mail para ${message.to}: ${message.subject}\n${message.text}`);
    }
  }
}

/** Endereço do app da equipe, para os links dos e-mails. Nunca vem do pedido (Host falso). */
export const teamAppUrl = (): string =>
  (process.env.TEAM_APP_URL ?? 'http://localhost:3002').replace(/\/+$/, '');
