-- Conteúdo do site da clínica: números, dúvidas, pagamento, horário, depoimentos
-- (o formato é conferido pela API; aqui só o tipo e um teto de tamanho) e fotos do espaço.

ALTER TABLE tenants
  ADD COLUMN site jsonb NOT NULL DEFAULT '{}'::jsonb
    CHECK (jsonb_typeof(site) = 'object' AND pg_column_size(site) <= 32768);
GRANT UPDATE (site) ON tenants TO tagtech_app;

CREATE TABLE site_photos (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id  uuid NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
  url        text NOT NULL CHECK (url ~ '^/media/[0-9a-f]{32}\.webp$'),
  title      text NOT NULL DEFAULT '' CHECK (length(title) <= 40),
  caption    text NOT NULL DEFAULT '' CHECK (length(caption) <= 80),
  position   integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX site_photos_order ON site_photos (tenant_id, position);

ALTER TABLE site_photos ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON site_photos
  USING (tenant_id = current_tenant_id()) WITH CHECK (tenant_id = current_tenant_id());
GRANT SELECT, INSERT, UPDATE, DELETE ON site_photos TO tagtech_app;
