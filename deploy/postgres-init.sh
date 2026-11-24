#!/bin/sh
# Roda só na primeira vez que o banco é criado. Cria o usuário da aplicação: não é dono das
# tabelas e não ignora o RLS. A senha vem do .env, nunca do repositório.
set -eu
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<SQL
CREATE ROLE tagtech_app LOGIN PASSWORD '${APP_DB_PASSWORD}' NOSUPERUSER NOBYPASSRLS;
SQL
