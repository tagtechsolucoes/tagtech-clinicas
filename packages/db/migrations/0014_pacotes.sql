-- Pacotes de sessões (ex.: 10 sessões de fisio) e sessões recorrentes (série semanal).

CREATE TABLE session_packages (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      uuid NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
  patient_id     uuid NOT NULL,
  service_id     uuid NOT NULL,
  title          text NOT NULL CHECK (length(title) BETWEEN 1 AND 120),
  total_sessions smallint NOT NULL CHECK (total_sessions BETWEEN 1 AND 200),
  price_cents    integer NOT NULL DEFAULT 0 CHECK (price_cents >= 0),
  -- Falta conta como sessão usada (política mais comum em fisio e psicologia).
  no_show_counts boolean NOT NULL DEFAULT true,
  valid_until    date,
  status         text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'finished', 'cancelled')),
  notes          text NOT NULL DEFAULT '' CHECK (length(notes) <= 500),
  created_by     uuid REFERENCES users (id) ON DELETE SET NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (tenant_id, patient_id) REFERENCES patients (tenant_id, id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id, service_id) REFERENCES services (tenant_id, id),
  UNIQUE (tenant_id, id)
);
CREATE INDEX session_packages_by_patient ON session_packages (patient_id, status);

ALTER TABLE appointments
  ADD COLUMN package_id uuid,
  -- Consultas marcadas juntas como série (mesmo horário toda semana).
  ADD COLUMN series_id uuid,
  ADD FOREIGN KEY (tenant_id, package_id) REFERENCES session_packages (tenant_id, id)
    ON DELETE SET NULL (package_id);
CREATE INDEX appointments_by_package ON appointments (package_id) WHERE package_id IS NOT NULL;
CREATE INDEX appointments_by_series ON appointments (series_id, starts_at) WHERE series_id IS NOT NULL;

-- A parcela do pacote fica ligada a ele no financeiro.
ALTER TABLE charges ADD COLUMN package_id uuid,
  ADD FOREIGN KEY (tenant_id, package_id) REFERENCES session_packages (tenant_id, id)
    ON DELETE SET NULL (package_id);

ALTER TABLE session_packages ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON session_packages
  USING (tenant_id = current_tenant_id()) WITH CHECK (tenant_id = current_tenant_id());
GRANT SELECT, INSERT, UPDATE ON session_packages TO tagtech_app;
