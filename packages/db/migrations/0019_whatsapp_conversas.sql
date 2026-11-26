-- WhatsApp pelo QR code (Evolution API) e a central de conversas.
-- A clínica escolhe o provedor: a API oficial da Meta (modelos aprovados, só mensagens
-- automáticas) ou o número conectado por QR code, que também recebe e responde pelo painel.

ALTER TABLE clinic_whatsapp
  ADD COLUMN provider text NOT NULL DEFAULT 'meta' CHECK (provider IN ('meta', 'evolution')),
  -- Nome da instância na Evolution (uma por clínica).
  ADD COLUMN instance text UNIQUE CHECK (instance ~ '^[a-z0-9-]{3,64}$'),
  -- Segredo do endereço que a Evolution chama ao chegar mensagem.
  ADD COLUMN hook_secret text UNIQUE CHECK (length(hook_secret) BETWEEN 32 AND 128),
  ADD COLUMN connection text NOT NULL DEFAULT 'close' CHECK (connection IN ('open', 'connecting', 'close')),
  ALTER COLUMN phone_number_id DROP NOT NULL,
  ALTER COLUMN access_token DROP NOT NULL,
  ADD CONSTRAINT clinic_whatsapp_provider_fields CHECK (
    (provider = 'meta' AND phone_number_id IS NOT NULL AND access_token IS NOT NULL)
    OR (provider = 'evolution' AND instance IS NOT NULL AND hook_secret IS NOT NULL)
  );

-- Uma conversa por número de paciente em cada clínica.
CREATE TABLE wa_conversations (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
  -- Só dígitos, com DDI (5581999998888).
  phone           text NOT NULL CHECK (phone ~ '^[0-9]{10,15}$'),
  name            text NOT NULL DEFAULT '' CHECK (length(name) <= 120),
  last_message_at timestamptz NOT NULL DEFAULT now(),
  last_preview    text NOT NULL DEFAULT '' CHECK (length(last_preview) <= 200),
  last_direction  text NOT NULL DEFAULT 'in' CHECK (last_direction IN ('in', 'out')),
  unread          integer NOT NULL DEFAULT 0 CHECK (unread >= 0),
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, phone),
  UNIQUE (tenant_id, id)
);
CREATE INDEX wa_conversations_recent ON wa_conversations (tenant_id, last_message_at DESC);

CREATE TABLE wa_messages (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL,
  conversation_id uuid NOT NULL,
  direction       text NOT NULL CHECK (direction IN ('in', 'out')),
  -- auto: mensagem automática (aviso, lembrete, retorno…); media: foto, áudio ou arquivo.
  kind            text NOT NULL DEFAULT 'text' CHECK (kind IN ('text', 'auto', 'media')),
  body            text NOT NULL CHECK (length(body) <= 4096),
  status          text NOT NULL DEFAULT 'sent' CHECK (status IN ('sending', 'sent', 'failed', 'received')),
  external_id     text CHECK (length(external_id) <= 200),
  error           text CHECK (length(error) <= 500),
  sent_by         uuid REFERENCES users (id) ON DELETE SET NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (tenant_id, conversation_id) REFERENCES wa_conversations (tenant_id, id) ON DELETE CASCADE,
  -- A mesma mensagem não entra duas vezes (a Evolution pode repetir o aviso).
  UNIQUE (tenant_id, external_id)
);
CREATE INDEX wa_messages_thread ON wa_messages (conversation_id, created_at DESC);

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['wa_conversations', 'wa_messages'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY tenant_isolation ON %I
      USING (tenant_id = current_tenant_id()) WITH CHECK (tenant_id = current_tenant_id())', t);
  END LOOP;
END $$;
GRANT SELECT, INSERT, UPDATE ON wa_conversations, wa_messages TO tagtech_app;

-- Endereço secreto do webhook -> a clínica. Quem não sabe o segredo não descobre nada.
CREATE FUNCTION resolve_whatsapp_hook(p_secret text)
RETURNS TABLE (tenant_id uuid, instance text)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT w.tenant_id, w.instance
  FROM clinic_whatsapp w
  WHERE w.provider = 'evolution' AND w.hook_secret = p_secret
$$;
REVOKE ALL ON FUNCTION resolve_whatsapp_hook(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION resolve_whatsapp_hook(text) TO tagtech_app;
