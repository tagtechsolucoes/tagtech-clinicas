-- Mensagens automáticas no WhatsApp do paciente (API oficial da Meta, número da clínica).

CREATE TABLE clinic_whatsapp (
  tenant_id       uuid PRIMARY KEY REFERENCES tenants (id) ON DELETE CASCADE,
  phone_number_id text NOT NULL CHECK (phone_number_id ~ '^[0-9]{5,30}$'),
  -- A API nunca devolve este valor.
  access_token    text NOT NULL CHECK (length(access_token) BETWEEN 20 AND 600),
  template_name   text NOT NULL DEFAULT 'consulta_aviso' CHECK (template_name ~ '^[a-z0-9_]{1,200}$'),
  template_lang   text NOT NULL DEFAULT 'pt_BR' CHECK (template_lang ~ '^[a-z]{2}(_[A-Z]{2})?$'),
  display_phone   text NOT NULL DEFAULT '',
  -- Quantas horas antes da consulta vai o lembrete.
  reminder_hours  integer NOT NULL DEFAULT 24 CHECK (reminder_hours BETWEEN 2 AND 72),
  enabled         boolean NOT NULL DEFAULT true,
  updated_at      timestamptz NOT NULL DEFAULT now()
);

-- Cada mensagem de cada consulta uma vez só (por horário: remarcou, o lembrete vale de novo).
CREATE TABLE appointment_messages (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           uuid NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
  appointment_id      uuid NOT NULL,
  event               text NOT NULL CHECK (event IN ('booked', 'reminder', 'rescheduled', 'cancelled')),
  for_starts_at       timestamptz NOT NULL,
  status              text NOT NULL DEFAULT 'sending' CHECK (status IN ('sending', 'sent', 'failed')),
  provider_message_id text,
  error               text,
  created_at          timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (tenant_id, appointment_id) REFERENCES appointments (tenant_id, id) ON DELETE CASCADE,
  UNIQUE (appointment_id, event, for_starts_at)
);
CREATE INDEX appointment_messages_by_appointment ON appointment_messages (appointment_id, created_at);

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['clinic_whatsapp', 'appointment_messages'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY tenant_isolation ON %I
      USING (tenant_id = current_tenant_id()) WITH CHECK (tenant_id = current_tenant_id())', t);
  END LOOP;
END $$;
GRANT SELECT, INSERT, UPDATE, DELETE ON clinic_whatsapp TO tagtech_app;
GRANT SELECT, INSERT, UPDATE ON appointment_messages TO tagtech_app;

-- Consultas de todas as clínicas que já estão na hora do lembrete e ainda não receberam.
-- Roda sem clínica definida (a varredura vê todas), por isso devolve só os ids.
CREATE FUNCTION due_reminders(p_now timestamptz)
RETURNS TABLE (tenant_id uuid, appointment_id uuid)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT a.tenant_id, a.id
  FROM appointments a
  JOIN clinic_whatsapp w ON w.tenant_id = a.tenant_id AND w.enabled
  WHERE a.status IN ('scheduled', 'confirmed')
    AND a.starts_at > p_now + interval '1 hour'
    AND a.starts_at <= p_now + make_interval(hours => w.reminder_hours)
    -- Marcada já dentro da janela: o aviso de agendamento basta.
    AND a.created_at < a.starts_at - make_interval(hours => w.reminder_hours)
    AND NOT EXISTS (
      SELECT 1 FROM appointment_messages m
      WHERE m.appointment_id = a.id AND m.event = 'reminder' AND m.for_starts_at = a.starts_at
    )
  LIMIT 500
$$;
REVOKE ALL ON FUNCTION due_reminders(timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION due_reminders(timestamptz) TO tagtech_app;
