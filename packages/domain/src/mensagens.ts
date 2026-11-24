/** Mensagens automáticas para o paciente no WhatsApp (modelo aprovado na Meta). */

export type MessageEvent = 'booked' | 'reminder' | 'rescheduled' | 'cancelled';

export const MESSAGE_LABELS: Record<MessageEvent, string> = {
  booked: 'Aviso de agendamento',
  reminder: 'Lembrete',
  rescheduled: 'Aviso de remarcação',
  cancelled: 'Aviso de cancelamento',
};

/**
 * Texto do modelo que a clínica cadastra na Meta (categoria Utilidade):
 * {{1}} primeiro nome · {{2}} serviço · {{3}} clínica · {{4}} frase do aviso · {{5}} link.
 */
export const WHATSAPP_TEMPLATE_BODY =
  'Olá, {{1}}! Sua consulta de {{2}} na {{3}} {{4}} Para confirmar ou desmarcar, use o link: {{5}}';

/** A frase do {{4}}. `quando` já vem pronta: "quarta, 25/11, às 09:00". */
export function messageSentence(event: MessageEvent, quando: string): string {
  switch (event) {
    case 'booked':
      return `está marcada para ${quando}.`;
    case 'reminder':
      return `é ${quando}. Podemos contar com você?`;
    case 'rescheduled':
      return `foi remarcada para ${quando}.`;
    case 'cancelled':
      return `de ${quando} foi cancelada. Se quiser outro horário, é só agendar.`;
  }
}

/** "quarta, 25/11, às 09:00" no fuso da clínica; "amanhã" e "hoje" quando couber. */
export function whenText(startsAt: Date, timeZone: string, now = new Date()): string {
  const dia = (d: Date) => new Intl.DateTimeFormat('en-CA', { timeZone }).format(d);
  const hora = new Intl.DateTimeFormat('pt-BR', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
  }).format(startsAt);
  const amanha = new Date(now.getTime() + 24 * 3600_000);
  if (dia(startsAt) === dia(now)) return `hoje, às ${hora}`;
  if (dia(startsAt) === dia(amanha)) return `amanhã, às ${hora}`;
  const semana = new Intl.DateTimeFormat('pt-BR', { timeZone, weekday: 'long' })
    .format(startsAt)
    .replace('-feira', '');
  const data = new Intl.DateTimeFormat('pt-BR', {
    timeZone,
    day: '2-digit',
    month: '2-digit',
  }).format(startsAt);
  return `${semana}, ${data}, às ${hora}`;
}
