-- "Esqueci minha senha": link de uso único, válido por 1 hora. O banco guarda só o hash.

CREATE TABLE password_resets (
  token_hash text PRIMARY KEY CHECK (length(token_hash) = 64),
  user_id    uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  used_at    timestamptz
);
CREATE INDEX password_resets_by_user ON password_resets (user_id, created_at);
-- Sem nenhum acesso direto da API: só as funções abaixo.
ALTER TABLE password_resets ENABLE ROW LEVEL SECURITY;

-- Cria o pedido de troca se o e-mail tiver conta. Devolve nome e e-mail para a mensagem,
-- ou nada (a API responde igual nos dois casos). No máximo 3 pedidos por hora por conta.
CREATE FUNCTION auth_request_password_reset(p_email text, p_token_hash text, p_expires_at timestamptz)
RETURNS TABLE (email text, name text)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE v_user users;
BEGIN
  SELECT * INTO v_user FROM users u WHERE u.email = lower(trim(p_email));
  IF v_user.id IS NULL THEN RETURN; END IF;
  IF (SELECT count(*) FROM password_resets r
      WHERE r.user_id = v_user.id AND r.created_at > now() - interval '1 hour') >= 3 THEN
    RETURN;
  END IF;
  INSERT INTO password_resets (token_hash, user_id, expires_at) VALUES (p_token_hash, v_user.id, p_expires_at);
  RETURN QUERY SELECT v_user.email, v_user.name;
END $$;

-- O link ainda vale? Devolve o e-mail da conta para mostrar na tela.
CREATE FUNCTION auth_password_reset_email(p_token_hash text) RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT u.email FROM password_resets r JOIN users u ON u.id = r.user_id
  WHERE r.token_hash = p_token_hash AND r.used_at IS NULL AND r.expires_at > now()
$$;

-- Troca a senha, gasta o link (e os outros pendentes) e encerra todas as sessões da conta.
CREATE FUNCTION auth_reset_password(p_token_hash text, p_password_hash text) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE v_user uuid;
BEGIN
  SELECT r.user_id INTO v_user FROM password_resets r
    WHERE r.token_hash = p_token_hash AND r.used_at IS NULL AND r.expires_at > now()
    FOR UPDATE;
  IF v_user IS NULL THEN RETURN NULL; END IF;
  UPDATE users SET password_hash = p_password_hash WHERE id = v_user;
  UPDATE password_resets SET used_at = now() WHERE user_id = v_user AND used_at IS NULL;
  UPDATE sessions SET revoked_at = now() WHERE user_id = v_user AND revoked_at IS NULL;
  RETURN v_user;
END $$;

REVOKE ALL ON FUNCTION
  auth_request_password_reset(text, text, timestamptz),
  auth_password_reset_email(text),
  auth_reset_password(text, text)
FROM PUBLIC;
GRANT EXECUTE ON FUNCTION
  auth_request_password_reset(text, text, timestamptz),
  auth_password_reset_email(text),
  auth_reset_password(text, text)
TO tagtech_app;
