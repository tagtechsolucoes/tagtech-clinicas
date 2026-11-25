-- Clínica com equipe: repasse, documentos clínicos e tela de chamada da recepção.

-- ---------------------------------------------------------------- repasse

-- Porcentagem padrão do profissional sobre o que ele atende (0 = sem repasse).
ALTER TABLE professionals ADD COLUMN commission_pct numeric(5, 2) NOT NULL DEFAULT 0
  CHECK (commission_pct BETWEEN 0 AND 100);

-- Exceção por serviço: porcentagem própria ou valor fixo por atendimento.
CREATE TABLE commission_rules (
  tenant_id       uuid NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
  professional_id uuid NOT NULL,
  service_id      uuid NOT NULL,
  pct             numeric(5, 2) CHECK (pct BETWEEN 0 AND 100),
  fixed_cents     integer CHECK (fixed_cents >= 0),
  CHECK ((pct IS NULL) <> (fixed_cents IS NULL)),
  PRIMARY KEY (professional_id, service_id),
  FOREIGN KEY (tenant_id, professional_id) REFERENCES professionals (tenant_id, id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id, service_id) REFERENCES services (tenant_id, id) ON DELETE CASCADE
);

-- ---------------------------------------------------------------- documentos

-- Receita, atestado, declaração e pedido de exame. Fazem parte do prontuário: não mudam
-- depois de emitidos (um erro se corrige emitindo outro).
CREATE TABLE clinical_documents (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
  patient_id      uuid NOT NULL,
  professional_id uuid NOT NULL,
  appointment_id  uuid,
  author_user_id  uuid REFERENCES users (id) ON DELETE SET NULL,
  kind            text NOT NULL CHECK (kind IN ('prescription', 'certificate', 'declaration', 'exam_request')),
  content         jsonb NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (tenant_id, patient_id) REFERENCES patients (tenant_id, id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id, professional_id) REFERENCES professionals (tenant_id, id),
  FOREIGN KEY (tenant_id, appointment_id) REFERENCES appointments (tenant_id, id) ON DELETE SET NULL (appointment_id)
);
CREATE INDEX clinical_documents_by_patient ON clinical_documents (patient_id, created_at DESC);

-- ---------------------------------------------------------------- chamada na TV

-- Link da TV da recepção (o banco guarda só o hash). Trocar o link desliga a TV antiga.
ALTER TABLE tenants ADD COLUMN tv_token_hash text UNIQUE CHECK (tv_token_hash IS NULL OR length(tv_token_hash) = 64);
GRANT UPDATE (tv_token_hash) ON tenants TO tagtech_app;

CREATE TABLE patient_calls (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      uuid NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
  appointment_id uuid NOT NULL,
  -- Só o que aparece na TV: primeiro nome e inicial, e para onde ir.
  display_name   text NOT NULL CHECK (length(display_name) BETWEEN 1 AND 60),
  destination    text NOT NULL CHECK (length(destination) BETWEEN 1 AND 80),
  called_by      uuid REFERENCES users (id) ON DELETE SET NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (tenant_id, appointment_id) REFERENCES appointments (tenant_id, id) ON DELETE CASCADE
);
CREATE INDEX patient_calls_recent ON patient_calls (tenant_id, created_at DESC);

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['commission_rules', 'clinical_documents', 'patient_calls'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY tenant_isolation ON %I
      USING (tenant_id = current_tenant_id()) WITH CHECK (tenant_id = current_tenant_id())', t);
  END LOOP;
END $$;
GRANT SELECT, INSERT, UPDATE, DELETE ON commission_rules TO tagtech_app;
GRANT SELECT, INSERT ON clinical_documents, patient_calls TO tagtech_app;

CREATE FUNCTION resolve_tv_token(p_token_hash text)
RETURNS TABLE (tenant_id uuid)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$ SELECT t.id FROM tenants t WHERE t.tv_token_hash = p_token_hash $$;
REVOKE ALL ON FUNCTION resolve_tv_token(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION resolve_tv_token(text) TO tagtech_app;
