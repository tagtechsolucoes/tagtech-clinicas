-- Prontuário: evoluções por atendimento (com modelo por especialidade), odontograma,
-- fotos clínicas (antes, durante, depois) e autorização de uso de imagem.

-- Modelo de prontuário que o profissional usa por padrão.
ALTER TABLE professionals
  ADD COLUMN record_kind text NOT NULL DEFAULT 'geral'
    CHECK (record_kind IN ('geral', 'odonto', 'estetica', 'fisio', 'psico', 'nutri', 'medicina'));

CREATE TABLE clinical_notes (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
  patient_id      uuid NOT NULL,
  appointment_id  uuid,
  professional_id uuid,
  kind            text NOT NULL CHECK (kind IN ('geral', 'odonto', 'estetica', 'fisio', 'psico', 'nutri', 'medicina')),
  -- Campos do modelo (chave -> valor), validados pela API.
  data            jsonb NOT NULL DEFAULT '{}' CHECK (jsonb_typeof(data) = 'object' AND length(data::text) <= 20000),
  text            text NOT NULL DEFAULT '' CHECK (length(text) <= 10000),
  -- Sigilo: só quem escreveu lê (psicologia, por exemplo).
  private         boolean NOT NULL DEFAULT false,
  author_user_id  uuid REFERENCES users (id) ON DELETE SET NULL,
  -- Finalizada não muda mais; correção entra como adendo (nova evolução ligada a esta).
  locked_at       timestamptz,
  addendum_of     uuid,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (tenant_id, patient_id) REFERENCES patients (tenant_id, id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id, appointment_id) REFERENCES appointments (tenant_id, id) ON DELETE SET NULL (appointment_id),
  FOREIGN KEY (tenant_id, professional_id) REFERENCES professionals (tenant_id, id) ON DELETE SET NULL (professional_id),
  UNIQUE (tenant_id, id)
);
ALTER TABLE clinical_notes
  ADD FOREIGN KEY (tenant_id, addendum_of) REFERENCES clinical_notes (tenant_id, id) ON DELETE CASCADE;
CREATE INDEX clinical_notes_by_patient ON clinical_notes (patient_id, created_at DESC);

-- Estado atual de cada dente (numeração FDI). O histórico fica nas evoluções.
CREATE TABLE tooth_chart (
  tenant_id  uuid NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
  patient_id uuid NOT NULL,
  tooth      smallint NOT NULL CHECK ((tooth BETWEEN 11 AND 48 AND tooth % 10 BETWEEN 1 AND 8)
                                  OR (tooth BETWEEN 51 AND 85 AND tooth % 10 BETWEEN 1 AND 5)),
  state      text NOT NULL CHECK (state IN ('caries', 'restored', 'missing', 'implant', 'crown',
                                            'root_canal', 'extraction', 'prosthesis', 'healthy')),
  note       text NOT NULL DEFAULT '' CHECK (length(note) <= 200),
  updated_by uuid REFERENCES users (id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (patient_id, tooth),
  FOREIGN KEY (tenant_id, patient_id) REFERENCES patients (tenant_id, id) ON DELETE CASCADE
);

-- Fotos clínicas. O arquivo fica fora da pasta pública; só sai pela API, com login.
CREATE TABLE patient_photos (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      uuid NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
  patient_id     uuid NOT NULL,
  appointment_id uuid,
  file           text NOT NULL CHECK (file ~ '^[0-9a-f]{32}\.webp$'),
  stage          text NOT NULL CHECK (stage IN ('before', 'during', 'after')),
  region         text NOT NULL DEFAULT '' CHECK (length(region) <= 60),
  angle          text NOT NULL DEFAULT '' CHECK (length(angle) <= 40),
  taken_on       date NOT NULL DEFAULT current_date,
  note           text NOT NULL DEFAULT '' CHECK (length(note) <= 300),
  created_by     uuid REFERENCES users (id) ON DELETE SET NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (tenant_id, patient_id) REFERENCES patients (tenant_id, id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id, appointment_id) REFERENCES appointments (tenant_id, id) ON DELETE SET NULL (appointment_id),
  UNIQUE (tenant_id, id)
);
CREATE INDEX patient_photos_by_patient ON patient_photos (patient_id, taken_on);

-- Autorização de uso de imagem assinada pelo paciente. Revogável.
CREATE TABLE image_consents (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
  patient_id  uuid NOT NULL,
  -- Onde a clínica pode mostrar: site, redes sociais ou os dois.
  scope       text NOT NULL CHECK (scope IN ('site', 'social', 'both')),
  term_text   text NOT NULL CHECK (length(term_text) BETWEEN 20 AND 4000),
  signed_on   date NOT NULL,
  recorded_by uuid REFERENCES users (id) ON DELETE SET NULL,
  revoked_at  timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (tenant_id, patient_id) REFERENCES patients (tenant_id, id) ON DELETE CASCADE
);
CREATE UNIQUE INDEX image_consents_one_active ON image_consents (patient_id) WHERE revoked_at IS NULL;

-- Par antes/depois publicado na galeria do site. As imagens públicas são cópias:
-- revogou a autorização, as cópias somem e a ficha continua com as originais.
CREATE TABLE gallery_items (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
  patient_id   uuid NOT NULL,
  before_photo uuid NOT NULL,
  after_photo  uuid NOT NULL,
  before_url   text NOT NULL CHECK (before_url ~ '^/media/[0-9a-f]{32}\.webp$'),
  after_url    text NOT NULL CHECK (after_url ~ '^/media/[0-9a-f]{32}\.webp$'),
  title        text NOT NULL CHECK (length(title) BETWEEN 1 AND 80),
  service_id   uuid,
  position     integer NOT NULL DEFAULT 0,
  created_at   timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (tenant_id, patient_id) REFERENCES patients (tenant_id, id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id, before_photo) REFERENCES patient_photos (tenant_id, id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id, after_photo) REFERENCES patient_photos (tenant_id, id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id, service_id) REFERENCES services (tenant_id, id) ON DELETE SET NULL (service_id)
);

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['clinical_notes', 'tooth_chart', 'patient_photos', 'image_consents', 'gallery_items'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY tenant_isolation ON %I
      USING (tenant_id = current_tenant_id()) WITH CHECK (tenant_id = current_tenant_id())', t);
  END LOOP;
END $$;
-- Evolução não se apaga; foto clínica e item da galeria sim.
GRANT SELECT, INSERT, UPDATE ON clinical_notes, image_consents TO tagtech_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON tooth_chart, patient_photos, gallery_items TO tagtech_app;
