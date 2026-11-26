#!/usr/bin/env node
// Versão do sistema (MAJOR.MINOR.PATCH). A versão fica no package.json da raiz e cada uma tem a
// sua seção no CHANGELOG.md.
//
//   pnpm versao patch     correção: nada novo para o cliente, só conserto
//   pnpm versao minor     função nova ou melhoria visível, sem quebrar nada
//   pnpm versao major     mudança grande: exige ação no servidor, muda planos ou quebra algo
//   pnpm versao           mostra a versão atual
//   pnpm versao conferir  usado no CI: a versão é válida e tem seção no CHANGELOG
//
// Antes de subir a versão, escreva o que mudou em "## Próxima versão" no CHANGELOG.md. O comando
// troca esse título pela versão nova e a data de hoje. Depois do merge, o CI cria a tag vX.Y.Z
// e a release no GitHub.
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const raiz = join(dirname(fileURLToPath(import.meta.url)), '..');
const PKG = join(raiz, 'package.json');
const LOG = join(raiz, 'CHANGELOG.md');
const PROXIMA = '## Próxima versão';
const SEMVER = /^(\d+)\.(\d+)\.(\d+)$/;

const pkg = JSON.parse(readFileSync(PKG, 'utf8'));
const log = readFileSync(LOG, 'utf8');
const atual = pkg.version;
const sair = (msg) => {
  console.error(msg);
  process.exit(1);
};

/** Texto da seção de uma versão (ou da próxima), sem o título. */
export function secao(texto, titulo) {
  const linhas = texto.split('\n');
  const i = linhas.findIndex((l) => l === titulo || l.startsWith(`${titulo} `));
  if (i < 0) return null;
  const fim = linhas.findIndex((l, j) => j > i && l.startsWith('## '));
  return linhas
    .slice(i + 1, fim < 0 ? undefined : fim)
    .join('\n')
    .trim();
}

const tipo = process.argv[2];
if (!tipo) {
  console.log(atual);
} else if (tipo === 'conferir') {
  if (!SEMVER.test(atual ?? '')) sair(`package.json: versão "${atual}" não é X.Y.Z`);
  if (secao(log, `## ${atual}`) === null) sair(`CHANGELOG.md: falta a seção "## ${atual}"`);
  console.log(`versão ${atual} ok`);
} else if (tipo === 'notas') {
  // Notas da versão atual, para a release do GitHub.
  console.log(secao(log, `## ${process.argv[3] ?? atual}`) ?? '');
} else if (['patch', 'minor', 'major'].includes(tipo)) {
  const m = SEMVER.exec(atual) ?? sair(`versão atual inválida: ${atual}`);
  const [maj, min, pat] = m.slice(1).map(Number);
  const nova =
    tipo === 'major'
      ? `${maj + 1}.0.0`
      : tipo === 'minor'
        ? `${maj}.${min + 1}.0`
        : `${maj}.${min}.${pat + 1}`;
  const notas = secao(log, PROXIMA);
  if (!notas) sair(`Escreva o que mudou em "${PROXIMA}" no CHANGELOG.md antes de subir a versão.`);
  const hoje = new Date().toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' });
  writeFileSync(LOG, log.replace(PROXIMA, `${PROXIMA}\n\n## ${nova} · ${hoje}`));
  pkg.version = nova;
  writeFileSync(PKG, `${JSON.stringify(pkg, null, 2)}\n`);
  console.log(`${atual} → ${nova}`);
} else {
  sair('Uso: pnpm versao [patch|minor|major|conferir]');
}
