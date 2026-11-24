// Mesmos valores do .env.example, para os testes rodarem sem configuração extra.
export const APP_URL =
  process.env.DATABASE_URL ?? 'postgres://tagtech_app:tagtech_app@localhost:5432/tagtech_clinicas';
export const OWNER_URL =
  process.env.DATABASE_OWNER_URL ?? 'postgres://tagtech:tagtech@localhost:5432/tagtech_clinicas';
