-- Recursos por especialidade: teleconsulta (psicologia e outras) e plano alimentar (nutrição).

-- Serviço feito por vídeo; o link é a sala fixa do profissional (Meet, Zoom, Jitsi...).
ALTER TABLE services ADD COLUMN telehealth boolean NOT NULL DEFAULT false;
ALTER TABLE professionals ADD COLUMN telehealth_url text NOT NULL DEFAULT ''
  CHECK (telehealth_url = '' OR (telehealth_url ~ '^https://\S+$' AND length(telehealth_url) <= 300));

-- Plano alimentar entra como mais um documento clínico.
ALTER TABLE clinical_documents DROP CONSTRAINT clinical_documents_kind_check;
ALTER TABLE clinical_documents ADD CONSTRAINT clinical_documents_kind_check
  CHECK (kind IN ('prescription', 'certificate', 'declaration', 'exam_request', 'meal_plan'));
