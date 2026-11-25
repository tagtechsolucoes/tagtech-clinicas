-- Relacionamento: vaga da lista de espera oferecida no WhatsApp, lembrete de retorno,
-- reativação de quem sumiu e pedido de avaliação no Google.

-- ---------------------------------------------------------------- configuração

-- Dias até o retorno daquele serviço (ex.: limpeza 180). NULL = sem lembrete.
ALTER TABLE services ADD COLUMN return_days integer CHECK (return_days BETWEEN 7 AND 730);

ALTER TABLE tenants
  -- Oferecer sozinho o horário que vagou para a lista de espera.
  ADD COLUMN waitlist_auto_offer boolean NOT NULL DEFAULT true,
  -- Mensagem para quem não volta há N dias (0 = desligado).
  ADD COLUMN reactivation_days integer NOT NULL DEFAULT 0
    CHECK (reactivation_days = 0 OR reactivation_days BETWEEN 60 AND 730),
  -- Link "avalie no Google" da clínica (vazio = não pede avaliação).
  ADD COLUMN google_review_url text NOT NULL DEFAULT ''
    CHECK (google_review_url = '' OR (google_review_url ~ '^https://\S+$' AND length(google_review_url) <= 300));
GRANT UPDATE (waitlist_auto_offer, reactivation_days, google_review_url) ON tenants TO tagtech_app;

-- ---------------------------------------------------------------- mensagens ao paciente

-- Mensagens que não são de uma consulta específica. Cada uma uma vez só por referência.
CREATE TABLE patient_messages (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           uuid NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
  patient_id          uuid NOT NULL,
  kind                text NOT NULL CHECK (kind IN ('waitlist_offer', 'recall', 'reactivation', 'review')),
  -- Oferta: a oferta. Retorno, reativação e avaliação: a consulta que originou.
  ref_id              uuid NOT NULL,
  service_id          uuid,
  status              text NOT NULL DEFAULT 'sending' CHECK (status IN ('sending', 'sent', 'failed')),
  provider_message_id text,
  error               text,
  created_at          timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (tenant_id, patient_id) REFERENCES patients (tenant_id, id) ON DELETE CASCADE,
  UNIQUE (kind, ref_id)
);
CREATE INDEX patient_messages_by_patient ON patient_messages (patient_id, kind, created_at DESC);
CREATE INDEX patient_messages_by_month ON patient_messages (tenant_id, created_at);

-- ---------------------------------------------------------------- oferta da lista de espera

-- waitlist precisa de (tenant_id, id) único para a FK composta.
ALTER TABLE waitlist ADD CONSTRAINT waitlist_tenant_id_key UNIQUE (tenant_id, id);

CREATE TABLE waitlist_offers (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
  waitlist_id     uuid NOT NULL,
  -- Consulta cancelada que abriu a vaga.
  source_appointment_id uuid NOT NULL,
  service_id      uuid NOT NULL,
  professional_id uuid NOT NULL,
  unit_id         uuid NOT NULL,
  starts_at       timestamptz NOT NULL,
  token_hash      text NOT NULL UNIQUE CHECK (length(token_hash) = 64),
  expires_at      timestamptz NOT NULL,
  status          text NOT NULL DEFAULT 'offered'
    CHECK (status IN ('offered', 'accepted', 'declined', 'expired', 'taken')),
  booked_appointment_id uuid,
  decided_at      timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (tenant_id, waitlist_id) REFERENCES waitlist (tenant_id, id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id, source_appointment_id) REFERENCES appointments (tenant_id, id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id, booked_appointment_id) REFERENCES appointments (tenant_id, id) ON DELETE SET NULL (booked_appointment_id),
  UNIQUE (tenant_id, id)
);
-- A mesma vaga só fica oferecida para uma pessoa por vez.
CREATE UNIQUE INDEX waitlist_offers_one_open ON waitlist_offers (source_appointment_id) WHERE status = 'offered';
CREATE INDEX waitlist_offers_expiring ON waitlist_offers (expires_at) WHERE status = 'offered';

-- ---------------------------------------------------------------- avaliação

CREATE TABLE review_requests (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      uuid NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
  appointment_id uuid NOT NULL,
  patient_id     uuid NOT NULL,
  token_hash     text NOT NULL UNIQUE CHECK (length(token_hash) = 64),
  rating         smallint CHECK (rating BETWEEN 1 AND 5),
  comment        text NOT NULL DEFAULT '' CHECK (length(comment) <= 1000),
  -- Nota alta: o paciente foi mandado para o Google.
  sent_to_google boolean NOT NULL DEFAULT false,
  answered_at    timestamptz,
  created_at     timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (tenant_id, appointment_id) REFERENCES appointments (tenant_id, id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id, patient_id) REFERENCES patients (tenant_id, id) ON DELETE CASCADE,
  UNIQUE (appointment_id)
);
CREATE INDEX review_requests_by_month ON review_requests (tenant_id, created_at);

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['patient_messages', 'waitlist_offers', 'review_requests'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY tenant_isolation ON %I
      USING (tenant_id = current_tenant_id()) WITH CHECK (tenant_id = current_tenant_id())', t);
  END LOOP;
END $$;
GRANT SELECT, INSERT, UPDATE ON patient_messages, waitlist_offers, review_requests TO tagtech_app;

-- ---------------------------------------------------------------- links públicos

CREATE FUNCTION resolve_offer_token(p_token_hash text)
RETURNS TABLE (tenant_id uuid, offer_id uuid)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$ SELECT o.tenant_id, o.id FROM waitlist_offers o WHERE o.token_hash = p_token_hash $$;
REVOKE ALL ON FUNCTION resolve_offer_token(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION resolve_offer_token(text) TO tagtech_app;

CREATE FUNCTION resolve_review_token(p_token_hash text)
RETURNS TABLE (tenant_id uuid, review_id uuid)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$ SELECT r.tenant_id, r.id FROM review_requests r WHERE r.token_hash = p_token_hash $$;
REVOKE ALL ON FUNCTION resolve_review_token(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION resolve_review_token(text) TO tagtech_app;

-- ---------------------------------------------------------------- varreduras (todas as clínicas)

-- Ofertas vencidas: passam a vez para o próximo da fila.
CREATE FUNCTION expired_offers(p_now timestamptz)
RETURNS TABLE (tenant_id uuid, offer_id uuid)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  SELECT o.tenant_id, o.id FROM waitlist_offers o
  WHERE o.status = 'offered' AND o.expires_at <= p_now
  LIMIT 200
$$;

-- Retorno: última consulta feita daquele serviço passou do prazo, nada marcado depois.
-- Só olha os 60 dias depois do prazo, para não acordar pacientes de anos atrás de uma vez.
CREATE FUNCTION due_recalls(p_now timestamptz)
RETURNS TABLE (tenant_id uuid, appointment_id uuid)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  SELECT a.tenant_id, a.id
  FROM appointments a
  JOIN services s ON s.id = a.service_id AND s.return_days IS NOT NULL
  JOIN patients p ON p.id = a.patient_id AND p.phone <> '' AND p.contact_erased_at IS NULL
  JOIN clinic_whatsapp w ON w.tenant_id = a.tenant_id AND w.enabled
  WHERE a.status = 'done'
    AND a.ends_at <= p_now - make_interval(days => s.return_days)
    AND a.ends_at >  p_now - make_interval(days => s.return_days + 60)
    -- É a última vez que fez este serviço.
    AND NOT EXISTS (SELECT 1 FROM appointments b WHERE b.patient_id = a.patient_id
      AND b.service_id = a.service_id AND b.status = 'done' AND b.starts_at > a.starts_at)
    -- Não tem nada marcado.
    AND NOT EXISTS (SELECT 1 FROM appointments b WHERE b.patient_id = a.patient_id
      AND b.status IN ('scheduled', 'confirmed', 'arrived', 'in_progress') AND b.starts_at > a.starts_at)
    AND NOT EXISTS (SELECT 1 FROM patient_messages m WHERE m.kind = 'recall' AND m.ref_id = a.id)
  LIMIT 300
$$;

-- Reativação: última consulta feita há N dias (janela de 30 dias), nada marcado, e sem
-- mensagem de reativação nos últimos N dias.
CREATE FUNCTION due_reactivations(p_now timestamptz)
RETURNS TABLE (tenant_id uuid, appointment_id uuid)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  SELECT a.tenant_id, a.id
  FROM appointments a
  JOIN tenants t ON t.id = a.tenant_id AND t.reactivation_days > 0
  JOIN patients p ON p.id = a.patient_id AND p.phone <> '' AND p.contact_erased_at IS NULL
  JOIN clinic_whatsapp w ON w.tenant_id = a.tenant_id AND w.enabled
  WHERE a.status = 'done'
    AND a.ends_at <= p_now - make_interval(days => t.reactivation_days)
    AND a.ends_at >  p_now - make_interval(days => t.reactivation_days + 30)
    AND NOT EXISTS (SELECT 1 FROM appointments b WHERE b.patient_id = a.patient_id
      AND b.status NOT IN ('cancelled', 'no_show') AND b.starts_at > a.starts_at)
    AND NOT EXISTS (SELECT 1 FROM patient_messages m WHERE m.patient_id = a.patient_id
      AND m.kind IN ('reactivation', 'recall')
      AND m.created_at > p_now - make_interval(days => t.reactivation_days))
  LIMIT 300
$$;

-- Avaliação: consulta feita que terminou há 2 a 24 horas, uma vez por paciente a cada 90 dias.
CREATE FUNCTION due_reviews(p_now timestamptz)
RETURNS TABLE (tenant_id uuid, appointment_id uuid)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  SELECT a.tenant_id, a.id
  FROM appointments a
  JOIN tenants t ON t.id = a.tenant_id AND t.google_review_url <> ''
  JOIN patients p ON p.id = a.patient_id AND p.phone <> '' AND p.contact_erased_at IS NULL
  JOIN clinic_whatsapp w ON w.tenant_id = a.tenant_id AND w.enabled
  WHERE a.status = 'done'
    AND a.ends_at <= p_now - interval '2 hours'
    AND a.ends_at >  p_now - interval '24 hours'
    AND NOT EXISTS (SELECT 1 FROM review_requests r WHERE r.patient_id = a.patient_id
      AND r.created_at > p_now - interval '90 days')
  LIMIT 300
$$;

DO $$
DECLARE f text;
BEGIN
  FOREACH f IN ARRAY ARRAY['expired_offers(timestamptz)', 'due_recalls(timestamptz)',
    'due_reactivations(timestamptz)', 'due_reviews(timestamptz)'] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO tagtech_app', f);
  END LOOP;
END $$;
