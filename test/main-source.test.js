const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const source = fs.readFileSync('src/main.js', 'utf8');

test('perfis usam diretório isolado por versão e modloader', () => {
  assert.match(source, /path\.join\(base, 'profiles', profileKey\(settings\.version, settings\.modloader\)\)/);
});

test('caminhos recebidos pelo IPC são validados', () => {
  assert.match(source, /function safeChildPath\(root, name = ''\)/);
  assert.match(source, /target\.startsWith\(base \+ path\.sep\)/);
});

test('Forge e NeoForge não podem ser confundidos', () => {
  assert.match(source, /kind === 'forge' \? \['forge-'\]/);
  assert.match(source, /\['neoforge', 'neoforged'\]/);
});

test('atualização verifica SHA-256 quando a release fornece digest', () => {
  assert.match(source, /createHash\('sha256'\)/);
  assert.match(source, /hash SHA-256 da atualização não confere/);
});
