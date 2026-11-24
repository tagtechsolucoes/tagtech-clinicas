-- Agenda: profissionais, salas, serviços, horários, pacientes, consultas e lista de espera.
--
-- Horários de trabalho são guardados em minutos do dia no fuso da unidade.
-- Consultas e bloqueios são instantes (timestamptz). Duas consultas ativas nunca
-- ocupam o mesmo profissional, nem a mesma sala, ao mesmo tempo: quem garante é o banco.

-- ---------------------------------------------------------------- profissionais

CREATE TABLE professionals (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      uuid NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
  -- Conta de acesso do profissional, quando ele usa o sistema. Pode não ter.
  membership_id  uuid UNIQUE REFERENCES memberships (id) ON DELETE SET NULL,
  name           text NOT NULL CHECK (length(name) BETWEEN 1 AND 120),
  specialty      text NOT NULL DEFAULT '' CHECK (length(specialty) <= 80),
  -- Registro no conselho, como aparece para o paciente: "CRO-PE 12.345".
  council        text NOT NULL DEFAULT '' CHECK (length(council) <= 40),
  bio            text NOT NULL DEFAULT '' CHECK (length(bio) <= 600),
  photo_url      text CHECK (photo_url ~ '^/media/[0-9a-f]{32}\.webp$'),
  color          text NOT NULL DEFAULT '#3b82a0' CHECK (color ~ '^#[0-9a-f]{6}$'),
  online_booking boolean NOT NULL DEFAULT true,
  active         boolean NOT NULL DEFAULT true,
  position       integer NOT NULL DEFAULT 0,
  created_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id)
);

-- ---------------------------------------------------------------- salas

CREATE TABLE rooms (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id  uuid NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
  unit_id    uuid NOT NULL,
  name       text NOT NULL CHECK (length(name) BETWEEN 1 AND 60),
  active     boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (tenant_id, unit_id) REFERENCES units (tenant_id, id) ON DELETE CASCADE,
  UNIQUE (tenant_id, id)
);

-- ---------------------------------------------------------------- serviços

CREATE TABLE services (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        uuid NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
  name             text NOT NULL CHECK (length(name) BETWEEN 1 AND 120),
  description      text NOT NULL DEFAULT '' CHECK (length(description) <= 500),
  category         text NOT NULL DEFAULT '' CHECK (length(category) <= 60),
  duration_minutes integer NOT NULL CHECK (duration_minutes BETWEEN 5 AND 600),
  -- Sempre em centavos. NULL = "sob avaliação" (o preço não aparece no site).
  price_cents      integer CHECK (price_cents >= 0),
  color            text NOT NULL DEFAULT '#3b82a0' CHECK (color ~ '^#[0-9a-f]{6}$'),
  online_booking   boolean NOT NULL DEFAULT true,
  active           boolean NOT NULL DEFAULT true,
  position         integer NOT NULL DEFAULT 0,
  created_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id)
);

-- Quem faz cada serviço.
CREATE TABLE service_professionals (
  tenant_id       uuid NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
  service_id      uuid NOT NULL,
  professional_id uuid NOT NULL,
  PRIMARY KEY (service_id, professional_id),
  FOREIGN KEY (tenant_id, service_id) REFERENCES services (tenant_id, id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id, professional_id) REFERENCES professionals (tenant_id, id) ON DELETE CASCADE
);

-- ---------------------------------------------------------------- horários e bloqueios

CREATE TABLE working_hours (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
  professional_id uuid NOT NULL,
  unit_id         uuid NOT NULL,
  weekday         smallint NOT NULL CHECK (weekday BETWEEN 0 AND 6),
  start_minute    smallint NOT NULL CHECK (start_minute BETWEEN 0 AND 1439),
  end_minute      smallint NOT NULL CHECK (end_minute BETWEEN 1 AND 1440),
  CHECK (start_minute < end_minute),
  FOREIGN KEY (tenant_id, professional_id) REFERENCES professionals (tenant_id, id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id, unit_id) REFERENCES units (tenant_id, id) ON DELETE CASCADE
);
CREATE INDEX working_hours_by_professional ON working_hours (professional_id, weekday);

-- Férias, congresso, feriado. Sem profissional = vale para a unidade toda (ou a clínica).
CREATE TABLE time_off (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
  professional_id uuid,
  unit_id         uuid,
  starts_at       timestamptz NOT NULL,
  ends_at         timestamptz NOT NULL,
  reason          text NOT NULL DEFAULT '' CHECK (length(reason) <= 120),
  created_by      uuid,
  created_at      timestamptz NOT NULL DEFAULT now(),
  CHECK (starts_at < ends_at),
  FOREIGN KEY (tenant_id, professional_id) REFERENCES professionals (tenant_id, id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id, unit_id) REFERENCES units (tenant_id, id) ON DELETE CASCADE
);
CREATE INDEX time_off_by_range ON time_off USING gist (tenant_id, tstzrange(starts_at, ends_at));

-- ---------------------------------------------------------------- pacientes

CREATE TYPE patient_source AS ENUM ('staff', 'online', 'import');

CREATE TABLE patients (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
  name        text NOT NULL CHECK (length(name) BETWEEN 2 AND 120),
  -- WhatsApp normalizado (55 + DDD + número). Pode repetir: mãe e filho no mesmo número.
  phone       text NOT NULL DEFAULT '' CHECK (phone = '' OR phone ~ '^55[1-9][0-9][0-9]{8,9}$'),
  email       text NOT NULL DEFAULT '' CHECK (email = '' OR (email = lower(email) AND email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$')),
  birth_date  date,
  cpf         text CHECK (cpf ~ '^[0-9]{11}$'),
  -- Aparecem em destaque na agenda e no atendimento.
  allergies   text NOT NULL DEFAULT '' CHECK (length(allergies) <= 500),
  medications text NOT NULL DEFAULT '' CHECK (length(medications) <= 500),
  notes       text NOT NULL DEFAULT '' CHECK (length(notes) <= 2000),
  source      patient_source NOT NULL DEFAULT 'staff',
  -- Aceite do uso dos dados (LGPD), registrado no primeiro agendamento.
  consent_at  timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id)
);
CREATE INDEX patients_by_phone ON patients (tenant_id, phone);
CREATE INDEX patients_by_name ON patients (tenant_id, lower(name));
CREATE UNIQUE INDEX patients_unique_cpf ON patients (tenant_id, cpf) WHERE cpf IS NOT NULL;

-- Quem abriu ou alterou a ficha de cada paciente. Só cresce.
CREATE TABLE patient_access_log (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
  patient_id    uuid NOT NULL,
  actor_user_id uuid REFERENCES users (id) ON DELETE SET NULL,
  action        text NOT NULL CHECK (action IN ('view', 'create', 'update')),
  created_at    timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (tenant_id, patient_id) REFERENCES patients (tenant_id, id) ON DELETE CASCADE
);
CREATE INDEX patient_access_by_patient ON patient_access_log (patient_id, created_at DESC);

-- ---------------------------------------------------------------- consultas

CREATE TYPE appointment_status AS ENUM
  ('scheduled', 'confirmed', 'arrived', 'in_progress', 'done', 'no_show', 'cancelled');
CREATE TYPE appointment_source AS ENUM ('staff', 'online');

CREATE TABLE appointments (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
  unit_id         uuid NOT NULL,
  professional_id uuid NOT NULL,
  room_id         uuid,
  service_id      uuid NOT NULL,
  patient_id      uuid NOT NULL,
  starts_at       timestamptz NOT NULL,
  ends_at         timestamptz NOT NULL,
  status          appointment_status NOT NULL DEFAULT 'scheduled',
  source          appointment_source NOT NULL DEFAULT 'staff',
  -- Preço combinado nesta consulta (o do serviço pode mudar depois).
  price_cents     integer CHECK (price_cents >= 0),
  notes           text NOT NULL DEFAULT '' CHECK (length(notes) <= 1000),
  cancel_reason   text CHECK (cancel_reason IS NULL OR length(cancel_reason) BETWEEN 3 AND 200),
  -- Link que o paciente recebe para confirmar ou desmarcar. O banco guarda só o hash.
  manage_token_hash text UNIQUE CHECK (manage_token_hash IS NULL OR length(manage_token_hash) = 64),
  confirmed_at    timestamptz,
  created_by      uuid,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  CHECK (starts_at < ends_at),
  CHECK (ends_at - starts_at <= interval '12 hours'),
  CHECK ((status = 'cancelled') = (cancel_reason IS NOT NULL)),
  FOREIGN KEY (tenant_id, unit_id) REFERENCES units (tenant_id, id),
  FOREIGN KEY (tenant_id, professional_id) REFERENCES professionals (tenant_id, id),
  FOREIGN KEY (tenant_id, room_id) REFERENCES rooms (tenant_id, id),
  FOREIGN KEY (tenant_id, service_id) REFERENCES services (tenant_id, id),
  FOREIGN KEY (tenant_id, patient_id) REFERENCES patients (tenant_id, id) ON DELETE CASCADE,
  UNIQUE (tenant_id, id),
  -- O mesmo profissional não atende duas consultas ao mesmo tempo...
  CONSTRAINT appointments_professional_free EXCLUDE USING gist (
    professional_id WITH =, tstzrange(starts_at, ends_at) WITH &&
  ) WHERE (status IN ('scheduled', 'confirmed', 'arrived', 'in_progress', 'done')),
  -- ...nem a mesma sala recebe duas.
  CONSTRAINT appointments_room_free EXCLUDE USING gist (
    room_id WITH =, tstzrange(starts_at, ends_at) WITH &&
  ) WHERE (room_id IS NOT NULL AND status IN ('scheduled', 'confirmed', 'arrived', 'in_progress', 'done'))
);
CREATE INDEX appointments_by_day ON appointments (tenant_id, starts_at);
CREATE INDEX appointments_by_patient ON appointments (patient_id, starts_at DESC);

-- Histórico de cada consulta: quem mudou o estado, quando e por quê. Só cresce.
CREATE TABLE appointment_events (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      uuid NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
  appointment_id uuid NOT NULL,
  from_status    appointment_status,
  to_status      appointment_status NOT NULL,
  -- Remarcação: horário antigo, para o histórico.
  from_starts_at timestamptz,
  actor_user_id  uuid REFERENCES users (id) ON DELETE SET NULL,
  -- 'staff', 'patient' (pelo link) ou 'system' (lembrete, varredura).
  actor_kind     text NOT NULL DEFAULT 'staff' CHECK (actor_kind IN ('staff', 'patient', 'system')),
  reason         text CHECK (reason IS NULL OR length(reason) <= 200),
  created_at     timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (tenant_id, appointment_id) REFERENCES appointments (tenant_id, id) ON DELETE CASCADE
);
CREATE INDEX appointment_events_by_appointment ON appointment_events (appointment_id, created_at);

-- ---------------------------------------------------------------- lista de espera

CREATE TYPE waitlist_status AS ENUM ('waiting', 'offered', 'booked', 'cancelled');

CREATE TABLE waitlist (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
  patient_id      uuid NOT NULL,
  service_id      uuid NOT NULL,
  -- NULL = qualquer profissional que faça o serviço.
  professional_id uuid,
  unit_id         uuid,
  from_date       date NOT NULL,
  to_date         date NOT NULL,
  period          text NOT NULL DEFAULT 'any' CHECK (period IN ('any', 'morning', 'afternoon', 'evening')),
  notes           text NOT NULL DEFAULT '' CHECK (length(notes) <= 300),
  status          waitlist_status NOT NULL DEFAULT 'waiting',
  booked_appointment_id uuid,
  created_at      timestamptz NOT NULL DEFAULT now(),
  CHECK (from_date <= to_date),
  FOREIGN KEY (tenant_id, patient_id) REFERENCES patients (tenant_id, id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id, service_id) REFERENCES services (tenant_id, id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id, professional_id) REFERENCES professionals (tenant_id, id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id, unit_id) REFERENCES units (tenant_id, id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id, booked_appointment_id) REFERENCES appointments (tenant_id, id)
);
CREATE INDEX waitlist_waiting ON waitlist (tenant_id, from_date) WHERE status = 'waiting';

-- ---------------------------------------------------------------- isolamento (RLS)

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['professionals', 'rooms', 'services', 'service_professionals',
    'working_hours', 'time_off', 'patients', 'patient_access_log', 'appointments',
    'appointment_events', 'waitlist']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY tenant_isolation ON %I
      USING (tenant_id = current_tenant_id()) WITH CHECK (tenant_id = current_tenant_id())', t);
  END LOOP;
END $$;

GRANT SELECT, INSERT, UPDATE, DELETE ON professionals, rooms, services, service_professionals,
  working_hours, time_off, waitlist TO tagtech_app;
-- Paciente e consulta não se apagam pela API: consulta é cancelada, paciente é anonimizado.
GRANT SELECT, INSERT, UPDATE ON patients, appointments TO tagtech_app;
GRANT SELECT, INSERT ON patient_access_log, appointment_events TO tagtech_app;

-- Link do paciente (confirmar ou desmarcar) -> clínica e consulta.
CREATE FUNCTION resolve_appointment_token(p_token_hash text)
RETURNS TABLE (tenant_id uuid, appointment_id uuid)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT a.tenant_id, a.id FROM appointments a WHERE a.manage_token_hash = p_token_hash
$$;
REVOKE ALL ON FUNCTION resolve_appointment_token(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION resolve_appointment_token(text) TO tagtech_app;
