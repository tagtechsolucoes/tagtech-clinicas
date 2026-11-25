-- Orçamento (plano de tratamento), financeiro (a receber e a pagar) e Pix pelo Mercado Pago.

-- ---------------------------------------------------------------- orçamento

CREATE TYPE plan_status AS ENUM ('draft', 'sent', 'approved', 'declined', 'cancelled');

CREATE TABLE treatment_plans (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id          uuid NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
  patient_id         uuid NOT NULL,
  professional_id    uuid,
  title              text NOT NULL CHECK (length(title) BETWEEN 1 AND 120),
  status             plan_status NOT NULL DEFAULT 'draft',
  -- Desconto geral (centavos) e desconto extra para pagamento à vista (%).
  discount_cents     integer NOT NULL DEFAULT 0 CHECK (discount_cents >= 0),
  cash_discount_pct  smallint NOT NULL DEFAULT 0 CHECK (cash_discount_pct BETWEEN 0 AND 50),
  max_installments   smallint NOT NULL DEFAULT 1 CHECK (max_installments BETWEEN 1 AND 24),
  notes              text NOT NULL DEFAULT '' CHECK (length(notes) <= 2000),
  valid_until        date,
  -- Link que o paciente recebe para aprovar. O banco guarda só o hash.
  approve_token_hash text UNIQUE CHECK (approve_token_hash IS NULL OR length(approve_token_hash) = 64),
  -- Escolha do paciente ao aprovar.
  chosen_installments smallint CHECK (chosen_installments BETWEEN 1 AND 24),
  sent_at            timestamptz,
  decided_at         timestamptz,
  created_by         uuid REFERENCES users (id) ON DELETE SET NULL,
  created_at         timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (tenant_id, patient_id) REFERENCES patients (tenant_id, id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id, professional_id) REFERENCES professionals (tenant_id, id) ON DELETE SET NULL (professional_id),
  UNIQUE (tenant_id, id)
);
CREATE INDEX treatment_plans_by_patient ON treatment_plans (patient_id, created_at DESC);

CREATE TABLE treatment_plan_items (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        uuid NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
  plan_id          uuid NOT NULL,
  service_id       uuid,
  description      text NOT NULL CHECK (length(description) BETWEEN 1 AND 160),
  tooth            smallint,
  quantity         smallint NOT NULL DEFAULT 1 CHECK (quantity BETWEEN 1 AND 99),
  unit_price_cents integer NOT NULL CHECK (unit_price_cents >= 0),
  position         integer NOT NULL DEFAULT 0,
  -- Consulta marcada para este item (quando já agendado).
  appointment_id   uuid,
  FOREIGN KEY (tenant_id, plan_id) REFERENCES treatment_plans (tenant_id, id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id, service_id) REFERENCES services (tenant_id, id) ON DELETE SET NULL (service_id),
  FOREIGN KEY (tenant_id, appointment_id) REFERENCES appointments (tenant_id, id) ON DELETE SET NULL (appointment_id)
);

-- ---------------------------------------------------------------- a receber e a pagar

CREATE TYPE pay_method AS ENUM ('pix', 'cash', 'debit', 'credit', 'transfer', 'other');
CREATE TYPE charge_status AS ENUM ('open', 'paid', 'cancelled');

CREATE TABLE charges (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      uuid NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
  patient_id     uuid,
  plan_id        uuid,
  appointment_id uuid,
  description    text NOT NULL CHECK (length(description) BETWEEN 1 AND 160),
  amount_cents   integer NOT NULL CHECK (amount_cents > 0),
  due_date       date NOT NULL,
  installment    smallint NOT NULL DEFAULT 1 CHECK (installment >= 1),
  installments   smallint NOT NULL DEFAULT 1 CHECK (installments >= installment),
  -- Sinal do agendamento pelo site: sem pagar no prazo, a consulta é cancelada.
  is_deposit     boolean NOT NULL DEFAULT false,
  status         charge_status NOT NULL DEFAULT 'open',
  method         pay_method,
  paid_at        timestamptz,
  created_by     uuid REFERENCES users (id) ON DELETE SET NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),
  CHECK ((status = 'paid') = (paid_at IS NOT NULL AND method IS NOT NULL)),
  FOREIGN KEY (tenant_id, patient_id) REFERENCES patients (tenant_id, id) ON DELETE SET NULL (patient_id),
  FOREIGN KEY (tenant_id, plan_id) REFERENCES treatment_plans (tenant_id, id) ON DELETE SET NULL (plan_id),
  FOREIGN KEY (tenant_id, appointment_id) REFERENCES appointments (tenant_id, id) ON DELETE SET NULL (appointment_id),
  UNIQUE (tenant_id, id)
);
CREATE INDEX charges_by_due ON charges (tenant_id, due_date) WHERE status = 'open';
CREATE INDEX charges_by_paid ON charges (tenant_id, paid_at) WHERE status = 'paid';
CREATE INDEX charges_by_patient ON charges (patient_id);

CREATE TABLE expenses (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
  description  text NOT NULL CHECK (length(description) BETWEEN 1 AND 160),
  category     text NOT NULL DEFAULT '' CHECK (length(category) <= 60),
  supplier     text NOT NULL DEFAULT '' CHECK (length(supplier) <= 120),
  amount_cents integer NOT NULL CHECK (amount_cents > 0),
  due_date     date NOT NULL,
  status       charge_status NOT NULL DEFAULT 'open',
  method       pay_method,
  paid_at      timestamptz,
  created_by   uuid REFERENCES users (id) ON DELETE SET NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  CHECK ((status = 'paid') = (paid_at IS NOT NULL))
);
CREATE INDEX expenses_by_due ON expenses (tenant_id, due_date);

-- ---------------------------------------------------------------- Pix

-- Credencial do Mercado Pago da clínica. A API nunca devolve.
CREATE TABLE clinic_payment_credentials (
  tenant_id    uuid PRIMARY KEY REFERENCES tenants (id) ON DELETE CASCADE,
  provider     text NOT NULL DEFAULT 'mercadopago' CHECK (provider IN ('mercadopago')),
  access_token text NOT NULL CHECK (length(access_token) BETWEEN 10 AND 300),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

-- Sinal cobrado no agendamento pelo site (0 = sem sinal).
ALTER TABLE tenants ADD COLUMN booking_deposit_cents integer NOT NULL DEFAULT 0
  CHECK (booking_deposit_cents BETWEEN 0 AND 1000000);
GRANT UPDATE (booking_deposit_cents) ON tenants TO tagtech_app;

CREATE TYPE pix_status AS ENUM ('pending', 'approved', 'cancelled', 'expired');

CREATE TABLE pix_payments (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           uuid NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
  charge_id           uuid NOT NULL,
  provider            text NOT NULL CHECK (provider IN ('mercadopago', 'fake')),
  provider_payment_id text NOT NULL,
  status              pix_status NOT NULL DEFAULT 'pending',
  amount_cents        integer NOT NULL CHECK (amount_cents > 0),
  pix_code            text NOT NULL,
  pix_qr_base64       text NOT NULL DEFAULT '',
  expires_at          timestamptz NOT NULL,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (tenant_id, charge_id) REFERENCES charges (tenant_id, id) ON DELETE CASCADE,
  UNIQUE (provider, provider_payment_id)
);
CREATE INDEX pix_payments_by_charge ON pix_payments (charge_id);
CREATE INDEX pix_payments_pending ON pix_payments (expires_at) WHERE status = 'pending';

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['treatment_plans', 'treatment_plan_items', 'charges', 'expenses',
    'clinic_payment_credentials', 'pix_payments'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY tenant_isolation ON %I
      USING (tenant_id = current_tenant_id()) WITH CHECK (tenant_id = current_tenant_id())', t);
  END LOOP;
END $$;
GRANT SELECT, INSERT, UPDATE ON treatment_plans, charges, pix_payments TO tagtech_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON treatment_plan_items, expenses, clinic_payment_credentials TO tagtech_app;

-- Link de aprovação do orçamento -> clínica e orçamento.
CREATE FUNCTION resolve_plan_token(p_token_hash text)
RETURNS TABLE (tenant_id uuid, plan_id uuid)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$ SELECT p.tenant_id, p.id FROM treatment_plans p WHERE p.approve_token_hash = p_token_hash $$;
REVOKE ALL ON FUNCTION resolve_plan_token(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION resolve_plan_token(text) TO tagtech_app;

-- Aviso do Mercado Pago -> o Pix que criamos (o id vai no endereço do aviso).
CREATE FUNCTION resolve_pix_payment(p_id uuid)
RETURNS TABLE (tenant_id uuid)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$ SELECT p.tenant_id FROM pix_payments p WHERE p.id = p_id $$;
REVOKE ALL ON FUNCTION resolve_pix_payment(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION resolve_pix_payment(uuid) TO tagtech_app;

-- Sinais de agendamento vencidos (de todas as clínicas), para cancelar a consulta.
CREATE FUNCTION expired_deposits(p_now timestamptz)
RETURNS TABLE (tenant_id uuid, charge_id uuid)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT c.tenant_id, c.id FROM charges c
  WHERE c.is_deposit AND c.status = 'open'
    AND NOT EXISTS (SELECT 1 FROM pix_payments x WHERE x.charge_id = c.id AND x.status = 'pending' AND x.expires_at > p_now)
    AND c.created_at < p_now - interval '2 minutes'
  LIMIT 200
$$;
REVOKE ALL ON FUNCTION expired_deposits(timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION expired_deposits(timestamptz) TO tagtech_app;
