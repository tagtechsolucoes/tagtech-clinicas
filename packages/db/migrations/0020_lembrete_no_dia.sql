-- Segundo lembrete, perto da hora (com o endereço), e confirmação respondendo 1 ou 2.

-- Quantos minutos antes da consulta vai o lembrete do dia (null = desligado).
ALTER TABLE clinic_whatsapp
  ADD COLUMN soon_minutes integer DEFAULT 60 CHECK (soon_minutes IN (30, 60, 120, 180));

ALTER TABLE appointment_messages DROP CONSTRAINT appointment_messages_event_check;
ALTER TABLE appointment_messages ADD CONSTRAINT appointment_messages_event_check
  CHECK (event IN ('booked', 'reminder', 'soon', 'rescheduled', 'cancelled'));

-- Consultas na hora do lembrete do dia e ainda sem ele (todas as clínicas).
CREATE FUNCTION due_soon_reminders(p_now timestamptz)
RETURNS TABLE (tenant_id uuid, appointment_id uuid)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT a.tenant_id, a.id
  FROM appointments a
  JOIN clinic_whatsapp w ON w.tenant_id = a.tenant_id AND w.enabled AND w.soon_minutes IS NOT NULL
  WHERE a.status IN ('scheduled', 'confirmed')
    AND a.starts_at > p_now + interval '5 minutes'
    AND a.starts_at <= p_now + make_interval(mins => w.soon_minutes)
    -- O lembrete da véspera precisa ser bem antes deste; senão, um só basta.
    AND w.reminder_hours * 60 > w.soon_minutes
    -- Marcada já dentro da janela: o aviso de agendamento basta.
    AND a.created_at < a.starts_at - make_interval(mins => w.soon_minutes)
    AND NOT EXISTS (
      SELECT 1 FROM appointment_messages m
      WHERE m.appointment_id = a.id AND m.event = 'soon' AND m.for_starts_at = a.starts_at
    )
  LIMIT 500
$$;
REVOKE ALL ON FUNCTION due_soon_reminders(timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION due_soon_reminders(timestamptz) TO tagtech_app;
