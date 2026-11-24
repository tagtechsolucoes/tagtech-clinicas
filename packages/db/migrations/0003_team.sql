-- Equipe: convites com papel.

-- ---------------------------------------------------------------- convites
-- O link do convite leva um token; o banco guarda só o hash (como nas sessões).
CREATE TABLE invites (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
  unit_id    uuid,
  role        member_role NOT NULL CHECK (role <> 'owner'),
  name        text NOT NULL CHECK (length(name) BETWEEN 1 AND 120),
  token_hash  text NOT NULL UNIQUE CHECK (length(token_hash) = 64),
  created_by  uuid NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  expires_at  timestamptz NOT NULL,
  accepted_at timestamptz,
  accepted_by uuid,
  revoked_at  timestamptz,
  FOREIGN KEY (tenant_id, unit_id) REFERENCES units (tenant_id, id) ON DELETE CASCADE
);
CREATE INDEX invites_pending ON invites (tenant_id) WHERE accepted_at IS NULL AND revoked_at IS NULL;
ALTER TABLE invites ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON invites
  USING (tenant_id = current_tenant_id()) WITH CHECK (tenant_id = current_tenant_id());
GRANT SELECT, INSERT, UPDATE ON invites TO tagtech_app;

-- Dono e gerente mudam o papel e tiram pessoas da equipe. Entrar só por convite (função abaixo).
GRANT UPDATE (role, unit_id), DELETE ON memberships TO tagtech_app;

-- ---------------------------------------------------------------- funções

-- Equipe da clínica em contexto, com nome e e-mail (que a API não lê direto de users).
CREATE FUNCTION auth_team()
RETURNS TABLE (
  membership_id uuid, user_id uuid, name text, email text,
  role member_role, unit_id uuid, created_at timestamptz
)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT m.id, u.id, u.name, u.email, m.role, m.unit_id, m.created_at
  FROM memberships m
  JOIN users u ON u.id = m.user_id
  WHERE m.tenant_id = current_tenant_id()
  ORDER BY m.created_at
$$;

-- O que mostrar na página do convite. Convite usado, revogado ou vencido não aparece.
CREATE FUNCTION auth_invite(p_token_hash text)
RETURNS TABLE (tenant_name text, unit_name text, role member_role, name text)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT t.name, s.name, i.role, i.name
  FROM invites i
  JOIN tenants t ON t.id = i.tenant_id
  LEFT JOIN units s ON s.id = i.unit_id
  WHERE i.token_hash = p_token_hash
    AND i.accepted_at IS NULL AND i.revoked_at IS NULL AND i.expires_at > now()
$$;

-- Aceita o convite para uma conta que já existe. Tudo ou nada; o convite vale uma vez.
CREATE FUNCTION auth_accept_invite(p_token_hash text, p_user_id uuid)
RETURNS TABLE (tenant_id uuid, membership_id uuid)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE v_invite invites; v_membership uuid;
BEGIN
  SELECT * INTO v_invite FROM invites i WHERE i.token_hash = p_token_hash FOR UPDATE;
  IF v_invite.id IS NULL OR v_invite.accepted_at IS NOT NULL OR v_invite.revoked_at IS NOT NULL
     OR v_invite.expires_at <= now() THEN
    RAISE EXCEPTION 'invite_invalid' USING ERRCODE = 'P0001';
  END IF;
  IF EXISTS (SELECT 1 FROM memberships m WHERE m.tenant_id = v_invite.tenant_id AND m.user_id = p_user_id) THEN
    RAISE EXCEPTION 'already_member' USING ERRCODE = 'P0001';
  END IF;
  INSERT INTO memberships (tenant_id, user_id, unit_id, role)
    VALUES (v_invite.tenant_id, p_user_id, v_invite.unit_id, v_invite.role)
    RETURNING id INTO v_membership;
  UPDATE invites SET accepted_at = now(), accepted_by = p_user_id WHERE id = v_invite.id;
  RETURN QUERY SELECT v_invite.tenant_id, v_membership;
END $$;

-- Aceita o convite criando a conta junto.
CREATE FUNCTION auth_accept_invite_new(
  p_token_hash text, p_email text, p_name text, p_password_hash text
) RETURNS TABLE (user_id uuid, tenant_id uuid, membership_id uuid)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE v_user uuid;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM auth_invite(p_token_hash)) THEN
    RAISE EXCEPTION 'invite_invalid' USING ERRCODE = 'P0001';
  END IF;
  INSERT INTO users (email, name, password_hash)
    VALUES (lower(trim(p_email)), trim(p_name), p_password_hash) RETURNING id INTO v_user;
  RETURN QUERY SELECT v_user, a.tenant_id, a.membership_id FROM auth_accept_invite(p_token_hash, v_user) a;
END $$;

REVOKE ALL ON FUNCTION
  auth_team(), auth_invite(text),
  auth_accept_invite(text, uuid), auth_accept_invite_new(text, text, text, text)
FROM PUBLIC;
GRANT EXECUTE ON FUNCTION
  auth_team(), auth_invite(text),
  auth_accept_invite(text, uuid), auth_accept_invite_new(text, text, text, text)
TO tagtech_app;
