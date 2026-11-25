-- Usuário da aplicação. Não é dono das tabelas e não pode ignorar o RLS,
-- então só enxerga as linhas da clínica definida em app.tenant_id.
-- Em produção, a senha vem de um segredo, não deste arquivo.
CREATE ROLE tagtech_app LOGIN PASSWORD 'tagtech_app' NOSUPERUSER NOBYPASSRLS;
