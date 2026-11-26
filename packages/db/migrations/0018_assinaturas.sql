-- Assinatura de cada clínica com a TagTech: plano, situação, valor e até quando está pago.
-- A cobrança é feita por fora (Pix ou boleto); aqui fica o controle. A clínica só LÊ a própria
-- assinatura; quem altera é a equipe da TagTech, pelas funções de plataforma no fim do arquivo.

CREATE TABLE subscriptions (
  tenant_id     uuid PRIMARY KEY REFERENCES tenants (id) ON DELETE CASCADE,
  plan          text NOT NULL DEFAULT 'clinica' CHECK (plan IN ('essencial', 'profissional', 'clinica')),
  -- trial: teste grátis até trial_ends_at; active: em dia até paid_until;
  -- suspended / cancelled: decididos pela TagTech.
  status        text NOT NULL DEFAULT 'trial' CHECK (status IN ('trial', 'active', 'suspended', 'cancelled')),
  price_cents   integer NOT NULL DEFAULT 0 CHECK (price_cents BETWEEN 0 AND 10000000),
  trial_ends_at date,
  paid_until    date,
  notes         text NOT NULL DEFAULT '' CHECK (length(notes) <= 1000),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE subscription_payments (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
  amount_cents  integer NOT NULL CHECK (amount_cents BETWEEN 0 AND 100000000),
  paid_on       date NOT NULL,
  months        integer NOT NULL CHECK (months BETWEEN 1 AND 24),
  method        text NOT NULL DEFAULT 'pix' CHECK (method IN ('pix', 'boleto', 'cartao', 'transferencia', 'outro')),
  note          text NOT NULL DEFAULT '' CHECK (length(note) <= 300),
  recorded_by   text NOT NULL CHECK (length(recorded_by) BETWEEN 3 AND 254),
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX subscription_payments_by_tenant ON subscription_payments (tenant_id, paid_on DESC);

ALTER TABLE subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE subscription_payments ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_reads_own ON subscriptions FOR SELECT USING (tenant_id = current_tenant_id());
CREATE POLICY tenant_reads_own ON subscription_payments FOR SELECT USING (tenant_id = current_tenant_id());
GRANT SELECT ON subscriptions, subscription_payments TO tagtech_app;

-- Clínicas que já existem: em dia por 30 dias, no plano completo, até a TagTech ajustar.
INSERT INTO subscriptions (tenant_id, plan, status, paid_until)
SELECT id, 'clinica', 'active', current_date + 30 FROM tenants
ON CONFLICT (tenant_id) DO NOTHING;

-- Clínica nova (cadastro pelo site): 14 dias de teste com tudo liberado.
CREATE FUNCTION subscriptions_on_new_tenant() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
BEGIN
  INSERT INTO subscriptions (tenant_id, plan, status, trial_ends_at)
  VALUES (NEW.id, 'clinica', 'trial', current_date + 14)
  ON CONFLICT (tenant_id) DO NOTHING;
  RETURN NEW;
END $$;
CREATE TRIGGER tenants_new_subscription AFTER INSERT ON tenants
  FOR EACH ROW EXECUTE FUNCTION subscriptions_on_new_tenant();

-- ---------------------------------------------------------------- plataforma (equipe TagTech)
-- A API só chama estas funções depois de conferir que a pessoa logada é da TagTech.

CREATE FUNCTION platform_tenants()
RETURNS TABLE (
  tenant_id uuid, name text, slug text, created_at timestamptz,
  plan text, status text, price_cents integer, trial_ends_at date, paid_until date, notes text,
  owner_email text, professionals bigint, patients bigint,
  appointments_30d bigint, last_payment date
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  SELECT t.id, t.name, t.slug, t.created_at,
         s.plan, s.status, s.price_cents, s.trial_ends_at, s.paid_until, s.notes,
         (SELECT u.email FROM memberships m JOIN users u ON u.id = m.user_id
           WHERE m.tenant_id = t.id AND m.role = 'owner' ORDER BY m.created_at LIMIT 1),
         (SELECT count(*) FROM professionals p WHERE p.tenant_id = t.id AND p.active),
         (SELECT count(*) FROM patients p WHERE p.tenant_id = t.id),
         (SELECT count(*) FROM appointments a WHERE a.tenant_id = t.id
           AND a.starts_at > now() - interval '30 days' AND a.status <> 'cancelled'),
         (SELECT max(paid_on) FROM subscription_payments sp WHERE sp.tenant_id = t.id)
  FROM tenants t LEFT JOIN subscriptions s ON s.tenant_id = t.id
  ORDER BY t.created_at DESC
$$;

CREATE FUNCTION platform_set_subscription(
  p_tenant uuid, p_plan text, p_status text, p_price_cents integer,
  p_trial_ends_at date, p_paid_until date, p_notes text
) RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  INSERT INTO subscriptions (tenant_id, plan, status, price_cents, trial_ends_at, paid_until, notes, updated_at)
  VALUES (p_tenant, p_plan, p_status, p_price_cents, p_trial_ends_at, p_paid_until, p_notes, now())
  ON CONFLICT (tenant_id) DO UPDATE SET
    plan = EXCLUDED.plan, status = EXCLUDED.status, price_cents = EXCLUDED.price_cents,
    trial_ends_at = EXCLUDED.trial_ends_at, paid_until = EXCLUDED.paid_until,
    notes = EXCLUDED.notes, updated_at = now()
$$;

-- Registra um pagamento e estende o "pago até" a partir do maior entre hoje e o vencimento atual.
CREATE FUNCTION platform_record_payment(
  p_tenant uuid, p_amount_cents integer, p_paid_on date, p_months integer,
  p_method text, p_note text, p_recorded_by text
) RETURNS date
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE v_until date;
BEGIN
  INSERT INTO subscription_payments (tenant_id, amount_cents, paid_on, months, method, note, recorded_by)
  VALUES (p_tenant, p_amount_cents, p_paid_on, p_months, p_method, p_note, p_recorded_by);
  INSERT INTO subscriptions (tenant_id) VALUES (p_tenant) ON CONFLICT (tenant_id) DO NOTHING;
  UPDATE subscriptions
     SET paid_until = (greatest(coalesce(paid_until, current_date), current_date) + make_interval(months => p_months))::date,
         status = CASE WHEN status IN ('trial', 'suspended') THEN 'active' ELSE status END,
         updated_at = now()
   WHERE tenant_id = p_tenant
  RETURNING paid_until INTO v_until;
  RETURN v_until;
END $$;

CREATE FUNCTION platform_payments(p_tenant uuid)
RETURNS SETOF subscription_payments
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$ SELECT * FROM subscription_payments WHERE tenant_id = p_tenant ORDER BY paid_on DESC, created_at DESC $$;

-- Para tarefas automáticas (lembretes, relacionamento): assinatura de qualquer clínica.
CREATE FUNCTION subscription_of(p_tenant uuid) RETURNS SETOF subscriptions
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$ SELECT * FROM subscriptions WHERE tenant_id = p_tenant $$;

REVOKE ALL ON FUNCTION platform_tenants(), platform_set_subscription(uuid, text, text, integer, date, date, text),
  platform_record_payment(uuid, integer, date, integer, text, text, text), platform_payments(uuid),
  subscription_of(uuid), subscriptions_on_new_tenant() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION platform_tenants(), platform_set_subscription(uuid, text, text, integer, date, date, text),
  platform_record_payment(uuid, integer, date, integer, text, text, text), platform_payments(uuid),
  subscription_of(uuid) TO tagtech_app;
