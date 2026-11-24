-- Base multi-inquilino do TagTech Clínicas.
--
-- Regra de ouro: toda tabela de negócio tem tenant_id e uma política de RLS que só
-- mostra as linhas da clínica definida em app.tenant_id. A API define essa variável
-- no começo de cada transação (SET LOCAL), a partir da sessão autenticada.
-- Sem a variável definida, a consulta não devolve nenhuma linha.

CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS btree_gist;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'tagtech_app') THEN
    CREATE ROLE tagtech_app NOLOGIN NOSUPERUSER NOBYPASSRLS;
  END IF;
END $$;

-- Devolve a clínica da transação atual, ou NULL se não foi definida.
CREATE FUNCTION current_tenant_id() RETURNS uuid
LANGUAGE sql STABLE
AS $$ SELECT nullif(current_setting('app.tenant_id', true), '')::uuid $$;

-- ---------------------------------------------------------------- clínica e unidades

CREATE TABLE tenants (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name          text NOT NULL CHECK (length(name) BETWEEN 1 AND 120),
  -- Endereço público do site de agendamento: /c/<slug>.
  slug          text NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$'),
  -- Identidade visual: o site de agendamento se veste com a marca de cada clínica.
  brand_primary text NOT NULL DEFAULT '#1d4e5f' CHECK (brand_primary ~ '^#[0-9a-f]{6}$'),
  brand_accent  text NOT NULL DEFAULT '#e9a23b' CHECK (brand_accent ~ '^#[0-9a-f]{6}$'),
  display_font  text NOT NULL DEFAULT 'grotesca'
    CHECK (display_font IN ('grotesca', 'serifada', 'condensada')),
  tagline       text NOT NULL DEFAULT '' CHECK (length(tagline) <= 120),
  about         text NOT NULL DEFAULT '' CHECK (length(about) <= 1200),
  whatsapp      text NOT NULL DEFAULT '' CHECK (whatsapp = '' OR whatsapp ~ '^55[1-9][0-9][0-9]{8,9}$'),
  instagram     text NOT NULL DEFAULT '' CHECK (instagram ~ '^[a-z0-9._]{0,30}$'),
  -- Caminho da imagem já tratada pela API ("/media/<aleatório>.webp"). Nunca um link externo.
  logo_url      text CHECK (logo_url ~ '^/media/[0-9a-f]{32}\.webp$'),
  cover_url     text CHECK (cover_url ~ '^/media/[0-9a-f]{32}\.webp$'),
  -- Agendamento online: liga/desliga, antecedência mínima e até quantos dias à frente.
  booking_enabled      boolean NOT NULL DEFAULT true,
  booking_min_notice_minutes integer NOT NULL DEFAULT 120 CHECK (booking_min_notice_minutes BETWEEN 0 AND 10080),
  booking_horizon_days integer NOT NULL DEFAULT 60 CHECK (booking_horizon_days BETWEEN 1 AND 365),
  slot_step_minutes    integer NOT NULL DEFAULT 15 CHECK (slot_step_minutes IN (5, 10, 15, 20, 30, 60)),
  created_at    timestamptz NOT NULL DEFAULT now()
);

-- Unidade: o endereço onde se atende. Clínica pequena tem uma só.
CREATE TABLE units (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id  uuid NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
  name       text NOT NULL CHECK (length(name) BETWEEN 1 AND 120),
  timezone   text NOT NULL DEFAULT 'America/Recife',
  address    text NOT NULL DEFAULT '' CHECK (length(address) <= 300),
  phone      text NOT NULL DEFAULT '' CHECK (phone = '' OR phone ~ '^55[1-9][0-9][0-9]{8,9}$'),
  active     boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  -- Permite chaves estrangeiras compostas (tenant_id, unit_id): uma linha filha
  -- nunca aponta para a unidade de outra clínica, nem por engano.
  UNIQUE (tenant_id, id)
);

ALTER TABLE tenants ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON tenants
  USING (id = current_tenant_id()) WITH CHECK (id = current_tenant_id());
ALTER TABLE units ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON units
  USING (tenant_id = current_tenant_id()) WITH CHECK (tenant_id = current_tenant_id());

GRANT SELECT ON tenants TO tagtech_app;
GRANT UPDATE (name, brand_primary, brand_accent, display_font, tagline, about, whatsapp,
              instagram, logo_url, cover_url, booking_enabled, booking_min_notice_minutes,
              booking_horizon_days, slot_step_minutes) ON tenants TO tagtech_app;
GRANT SELECT, INSERT, UPDATE ON units TO tagtech_app;

-- Endereço público do site -> clínica. Endereço desconhecido devolve nada.
CREATE FUNCTION resolve_clinic_slug(p_slug text) RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$ SELECT t.id FROM tenants t WHERE t.slug = lower(p_slug) $$;
REVOKE ALL ON FUNCTION resolve_clinic_slug(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION resolve_clinic_slug(text) TO tagtech_app;
