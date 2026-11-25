-- Direitos do titular (LGPD): exportar os dados do paciente e atender pedido de exclusão.

-- Pedido de exclusão atendido: contato apagado, prontuário guardado pelo prazo legal.
ALTER TABLE patients ADD COLUMN contact_erased_at timestamptz;

-- Exportação e exclusão também ficam no registro de acesso.
ALTER TABLE patient_access_log DROP CONSTRAINT patient_access_log_action_check;
ALTER TABLE patient_access_log ADD CONSTRAINT patient_access_log_action_check
  CHECK (action IN ('view', 'create', 'update', 'export', 'erase'));

-- Paciente sem histórico clínico nem financeiro pode ser apagado de vez.
GRANT DELETE ON patients TO tagtech_app;
