export function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Variável de ambiente ${name} não definida. Copie .env.example para .env.`);
  }
  return value;
}
