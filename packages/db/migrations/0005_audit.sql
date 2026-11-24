-- Histórico de ações sensíveis.

-- Quem fez o quê: cancelamentos, mudanças na equipe, preços, acesso a dados de pacientes.
-- A API só insere e lê; nunca altera nem apaga.
CREATE TABLE audit_events (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
  unit_id      uuid,
  actor_user_id uuid REFERENCES users (id) ON DELETE SET NULL,
  action        text NOT NULL CHECK (action ~ '^[a-z_]+\.[a-z_]+$'),
  summary       text NOT NULL CHECK (length(summary) BETWEEN 1 AND 300),
  details       jsonb NOT NULL DEFAULT '{}',
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX audit_events_by_tenant ON audit_events (tenant_id, created_at DESC);
ALTER TABLE audit_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON audit_events
  USING (tenant_id = current_tenant_id()) WITH CHECK (tenant_id = current_tenant_id());
GRANT SELECT, INSERT ON audit_events TO tagtech_app;

-- Nome de quem fez, para o histórico (a API não lê users direto).
CREATE FUNCTION auth_member_names(p_user_ids uuid[])
RETURNS TABLE (user_id uuid, name text)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT u.id, u.name FROM users u
  WHERE u.id = ANY (p_user_ids)
    AND EXISTS (SELECT 1 FROM memberships m WHERE m.user_id = u.id AND m.tenant_id = current_tenant_id())
  UNION
  -- Quem já saiu da equipe continua aparecendo pelo nome no histórico desta clínica.
  SELECT u.id, u.name FROM users u
  WHERE u.id = ANY (p_user_ids)
    AND EXISTS (SELECT 1 FROM audit_events a WHERE a.actor_user_id = u.id AND a.tenant_id = current_tenant_id())
$$;
REVOKE ALL ON FUNCTION auth_member_names(uuid[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION auth_member_names(uuid[]) TO tagtech_app;
