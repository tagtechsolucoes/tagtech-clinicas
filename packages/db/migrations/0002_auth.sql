-- Contas, sessões e papéis.
--
-- users e sessions não pertencem a uma clínica (uma pessoa pode trabalhar em mais
-- de um), então não dá para protegê-las com a política de tenant. A proteção aqui é
-- outra: o usuário do app NÃO tem nenhum acesso direto a essas duas tabelas. Tudo passa
-- pelas funções auth_* abaixo, que rodam com os direitos do dono e fazem uma coisa só.
-- Um bug de consulta na API não consegue listar e-mails nem hashes de senha.

CREATE TABLE users (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email         text NOT NULL UNIQUE
                CHECK (email = lower(email) AND email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' AND length(email) <= 254),
  name          text NOT NULL CHECK (length(name) BETWEEN 1 AND 120),
  -- Hash Argon2id gerado pela API. A senha em si nunca chega ao banco.
  password_hash text NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE sessions (
  -- SHA-256 do token que fica no cookie. Quem ler o banco não consegue usar a sessão.
  token_hash text PRIMARY KEY CHECK (length(token_hash) = 64),
  user_id    uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz
);
CREATE INDEX sessions_by_user ON sessions (user_id);

CREATE TYPE member_role AS ENUM ('owner', 'manager', 'reception', 'professional');

-- O papel de uma pessoa numa clínica. unit_id nulo = vale para todas as unidades.
CREATE TABLE memberships (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id  uuid NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
  user_id    uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  unit_id   uuid,
  role       member_role NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (tenant_id, unit_id) REFERENCES units (tenant_id, id) ON DELETE CASCADE,
  UNIQUE (tenant_id, user_id)
);
CREATE INDEX memberships_by_user ON memberships (user_id);

-- RLS ligado e nenhuma política nem GRANT em users e sessions: acesso direto negado.
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE sessions ENABLE ROW LEVEL SECURITY;

ALTER TABLE memberships ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON memberships
  USING (tenant_id = current_tenant_id()) WITH CHECK (tenant_id = current_tenant_id());
-- Só leitura por enquanto: convidar e remover pessoas da equipe vem com o fluxo de convite.
GRANT SELECT ON memberships TO tagtech_app;

-- ---------------------------------------------------------------- funções de conta

-- Cadastro: cria a pessoa, a clínica, a primeira unidade e o papel de dono, tudo ou nada.
CREATE FUNCTION auth_signup(
  p_email text, p_name text, p_password_hash text,
  p_tenant_name text, p_tenant_slug text, p_unit_name text
) RETURNS TABLE (new_user_id uuid, new_tenant_id uuid, new_unit_id uuid)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user uuid; v_tenant uuid; v_unit uuid;
BEGIN
  INSERT INTO users (email, name, password_hash)
    VALUES (lower(trim(p_email)), trim(p_name), p_password_hash) RETURNING id INTO v_user;
  INSERT INTO tenants (name, slug) VALUES (trim(p_tenant_name), p_tenant_slug) RETURNING id INTO v_tenant;
  INSERT INTO units (tenant_id, name) VALUES (v_tenant, trim(p_unit_name)) RETURNING id INTO v_unit;
  INSERT INTO memberships (tenant_id, user_id, role) VALUES (v_tenant, v_user, 'owner');
  RETURN QUERY SELECT v_user, v_tenant, v_unit;
END $$;

-- Login: devolve só o id e o hash da senha de UM e-mail, para a API conferir.
CREATE FUNCTION auth_user_for_login(p_email text)
RETURNS TABLE (user_id uuid, password_hash text)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$ SELECT u.id, u.password_hash FROM users u WHERE u.email = lower(trim(p_email)) $$;

CREATE FUNCTION auth_create_session(p_user_id uuid, p_token_hash text, p_expires_at timestamptz)
RETURNS void
LANGUAGE sql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$ INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (p_token_hash, p_user_id, p_expires_at) $$;

-- Quem é o dono desta sessão e em quais clínicas ele tem papel.
-- Uma linha por clínica; sessão vencida ou revogada devolve zero linhas.
CREATE FUNCTION auth_session(p_token_hash text)
RETURNS TABLE (
  user_id uuid, email text, name text,
  tenant_id uuid, tenant_name text, role member_role, unit_id uuid
)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT u.id, u.email, u.name, m.tenant_id, t.name, m.role, m.unit_id
  FROM sessions s
  JOIN users u ON u.id = s.user_id
  LEFT JOIN memberships m ON m.user_id = u.id
  LEFT JOIN tenants t ON t.id = m.tenant_id
  WHERE s.token_hash = p_token_hash AND s.revoked_at IS NULL AND s.expires_at > now()
  ORDER BY m.created_at
$$;

CREATE FUNCTION auth_revoke_session(p_token_hash text) RETURNS void
LANGUAGE sql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$ UPDATE sessions SET revoked_at = now() WHERE token_hash = p_token_hash AND revoked_at IS NULL $$;

REVOKE ALL ON FUNCTION
  auth_signup(text, text, text, text, text, text),
  auth_user_for_login(text),
  auth_create_session(uuid, text, timestamptz),
  auth_session(text),
  auth_revoke_session(text)
FROM PUBLIC;
GRANT EXECUTE ON FUNCTION
  auth_signup(text, text, text, text, text, text),
  auth_user_for_login(text),
  auth_create_session(uuid, text, timestamptz),
  auth_session(text),
  auth_revoke_session(text)
TO tagtech_app;
