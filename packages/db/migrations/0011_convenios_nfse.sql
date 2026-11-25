-- Convênios (opcional), nota fiscal de serviço (NFS-e pela Focus) e dados para recibo.

-- Dados da clínica para recibo e nota: razão social e CNPJ (ou CPF do profissional autônomo).
ALTER TABLE tenants
  ADD COLUMN legal_name text NOT NULL DEFAULT '' CHECK (length(legal_name) <= 160),
  ADD COLUMN document text NOT NULL DEFAULT '' CHECK (document ~ '^([0-9]{11}|[0-9]{14})?$'),
  ADD COLUMN insurance_enabled boolean NOT NULL DEFAULT false;
GRANT UPDATE (legal_name, document, insurance_enabled) ON tenants TO tagtech_app;

-- ---------------------------------------------------------------- convênios

CREATE TABLE insurers (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      uuid NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
  name           text NOT NULL CHECK (length(name) BETWEEN 1 AND 120),
  -- Registro da operadora na ANS (6 dígitos).
  ans_code       text NOT NULL DEFAULT '' CHECK (ans_code ~ '^([0-9]{6})?$'),
  -- Código da clínica na operadora (vai no lote TISS).
  provider_code  text NOT NULL DEFAULT '' CHECK (length(provider_code) <= 20),
  payment_days   smallint NOT NULL DEFAULT 30 CHECK (payment_days BETWEEN 0 AND 180),
  show_on_site   boolean NOT NULL DEFAULT true,
  active         boolean NOT NULL DEFAULT true,
  created_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id)
);

-- Tabela de preços por convênio: o que o plano paga e a coparticipação do paciente.
CREATE TABLE insurer_prices (
  tenant_id       uuid NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
  insurer_id      uuid NOT NULL,
  service_id      uuid NOT NULL,
  price_cents     integer NOT NULL CHECK (price_cents >= 0),
  copay_cents     integer NOT NULL DEFAULT 0 CHECK (copay_cents >= 0),
  -- Código do procedimento na tabela da operadora (TUSS).
  tuss_code       text NOT NULL DEFAULT '' CHECK (tuss_code ~ '^([0-9]{8})?$'),
  needs_authorization boolean NOT NULL DEFAULT false,
  PRIMARY KEY (insurer_id, service_id),
  FOREIGN KEY (tenant_id, insurer_id) REFERENCES insurers (tenant_id, id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id, service_id) REFERENCES services (tenant_id, id) ON DELETE CASCADE
);

-- Profissionais que atendem pelo convênio (sem nenhum = todos).
CREATE TABLE insurer_professionals (
  tenant_id       uuid NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
  insurer_id      uuid NOT NULL,
  professional_id uuid NOT NULL,
  PRIMARY KEY (insurer_id, professional_id),
  FOREIGN KEY (tenant_id, insurer_id) REFERENCES insurers (tenant_id, id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id, professional_id) REFERENCES professionals (tenant_id, id) ON DELETE CASCADE
);

-- Carteirinha do paciente.
CREATE TABLE patient_insurances (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
  patient_id   uuid NOT NULL,
  insurer_id   uuid NOT NULL,
  card_number  text NOT NULL CHECK (length(card_number) BETWEEN 1 AND 30),
  plan_name    text NOT NULL DEFAULT '' CHECK (length(plan_name) <= 60),
  valid_until  date,
  created_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (patient_id, insurer_id),
  FOREIGN KEY (tenant_id, patient_id) REFERENCES patients (tenant_id, id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id, insurer_id) REFERENCES insurers (tenant_id, id) ON DELETE CASCADE
);

-- Guia autorizada pelo plano (número, senha, validade e sessões liberadas).
CREATE TABLE insurance_authorizations (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id          uuid NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
  patient_id         uuid NOT NULL,
  insurer_id         uuid NOT NULL,
  service_id         uuid NOT NULL,
  guide_number       text NOT NULL CHECK (length(guide_number) BETWEEN 1 AND 20),
  password           text NOT NULL DEFAULT '' CHECK (length(password) <= 20),
  valid_until        date,
  sessions           smallint NOT NULL DEFAULT 1 CHECK (sessions BETWEEN 1 AND 200),
  created_at         timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (tenant_id, patient_id) REFERENCES patients (tenant_id, id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id, insurer_id) REFERENCES insurers (tenant_id, id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id, service_id) REFERENCES services (tenant_id, id) ON DELETE CASCADE,
  UNIQUE (tenant_id, id)
);

-- Consulta pelo convênio (sem convênio = particular).
ALTER TABLE appointments
  ADD COLUMN insurer_id uuid,
  ADD COLUMN authorization_id uuid,
  ADD COLUMN copay_cents integer CHECK (copay_cents >= 0),
  ADD FOREIGN KEY (tenant_id, insurer_id) REFERENCES insurers (tenant_id, id) ON DELETE SET NULL (insurer_id),
  ADD FOREIGN KEY (tenant_id, authorization_id) REFERENCES insurance_authorizations (tenant_id, id) ON DELETE SET NULL (authorization_id);
GRANT UPDATE (insurer_id, authorization_id, copay_cents) ON appointments TO tagtech_app;

-- Faturamento: lote mensal por convênio, com o que foi cobrado, pago e glosado.
CREATE TABLE insurance_batches (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
  insurer_id   uuid NOT NULL,
  number       integer NOT NULL CHECK (number > 0),
  competence   text NOT NULL CHECK (competence ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  status       text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'sent', 'paid')),
  sent_at      timestamptz,
  paid_at      timestamptz,
  charge_id    uuid REFERENCES charges (id) ON DELETE SET NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, insurer_id, number),
  FOREIGN KEY (tenant_id, insurer_id) REFERENCES insurers (tenant_id, id) ON DELETE CASCADE,
  UNIQUE (tenant_id, id)
);

CREATE TABLE insurance_claims (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      uuid NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
  batch_id       uuid NOT NULL,
  appointment_id uuid NOT NULL,
  billed_cents   integer NOT NULL CHECK (billed_cents >= 0),
  paid_cents     integer CHECK (paid_cents >= 0),
  glosa_reason   text NOT NULL DEFAULT '' CHECK (length(glosa_reason) <= 200),
  -- Guia reapresentada (recurso de glosa): aponta para a cobrança original.
  rebill_of      uuid REFERENCES insurance_claims (id) ON DELETE CASCADE,
  UNIQUE (rebill_of),
  FOREIGN KEY (tenant_id, batch_id) REFERENCES insurance_batches (tenant_id, id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id, appointment_id) REFERENCES appointments (tenant_id, id) ON DELETE CASCADE
);

-- ---------------------------------------------------------------- NFS-e

-- Cada consulta entra uma vez; a reapresentação é uma guia nova ligada à original.
CREATE UNIQUE INDEX insurance_claims_once ON insurance_claims (appointment_id) WHERE rebill_of IS NULL;

CREATE TABLE clinic_fiscal (
  tenant_id            uuid PRIMARY KEY REFERENCES tenants (id) ON DELETE CASCADE,
  environment          text NOT NULL DEFAULT 'homologacao' CHECK (environment IN ('homologacao', 'producao')),
  -- Token da Focus NFe. A API nunca devolve.
  token                text NOT NULL CHECK (length(token) BETWEEN 10 AND 200),
  -- 'nacional' (padrão nacional da NFS-e) ou 'municipal' (sistema da prefeitura).
  standard             text NOT NULL DEFAULT 'nacional' CHECK (standard IN ('nacional', 'municipal')),
  cnpj                 text NOT NULL CHECK (cnpj ~ '^[0-9]{14}$'),
  municipal_registration text NOT NULL DEFAULT '' CHECK (length(municipal_registration) <= 20),
  city_code            text NOT NULL CHECK (city_code ~ '^[0-9]{7}$'),
  -- Código do serviço: na nacional, o código de tributação (ex.: 040301); na municipal, o item da lista.
  service_code         text NOT NULL CHECK (length(service_code) BETWEEN 1 AND 20),
  municipal_service_code text NOT NULL DEFAULT '' CHECK (length(municipal_service_code) <= 20),
  iss_rate             numeric(5, 2) NOT NULL DEFAULT 0 CHECK (iss_rate BETWEEN 0 AND 10),
  -- 1 não optante, 2 MEI, 3 ME/EPP do Simples Nacional.
  simples_option       smallint NOT NULL DEFAULT 3 CHECK (simples_option BETWEEN 1 AND 3),
  description          text NOT NULL DEFAULT 'Serviços de saúde' CHECK (length(description) BETWEEN 1 AND 500),
  auto_emit            boolean NOT NULL DEFAULT false,
  updated_at           timestamptz NOT NULL DEFAULT now()
);

CREATE TYPE nfse_status AS ENUM ('emitting', 'authorized', 'error', 'cancelled');

CREATE TABLE service_invoices (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
  charge_id    uuid NOT NULL,
  ref          text NOT NULL UNIQUE CHECK (ref ~ '^tt[0-9a-f]{18}$'),
  environment  text NOT NULL,
  status       nfse_status NOT NULL DEFAULT 'emitting',
  amount_cents integer NOT NULL CHECK (amount_cents > 0),
  number       text,
  verification_code text,
  url          text,
  message      text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (tenant_id, charge_id) REFERENCES charges (tenant_id, id) ON DELETE CASCADE
);
-- Uma nota viva por recebimento.
CREATE UNIQUE INDEX service_invoices_one_alive ON service_invoices (charge_id) WHERE status IN ('emitting', 'authorized');

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['insurers', 'insurer_prices', 'insurer_professionals', 'patient_insurances',
    'insurance_authorizations', 'insurance_batches', 'insurance_claims', 'clinic_fiscal', 'service_invoices'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY tenant_isolation ON %I
      USING (tenant_id = current_tenant_id()) WITH CHECK (tenant_id = current_tenant_id())', t);
  END LOOP;
END $$;
GRANT SELECT, INSERT, UPDATE ON insurers, insurance_batches, service_invoices TO tagtech_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON insurer_prices, insurer_professionals, patient_insurances,
  insurance_authorizations, insurance_claims, clinic_fiscal TO tagtech_app;
