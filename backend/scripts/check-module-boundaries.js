'use strict';

// Module-boundary check (specs/platform tasks.md 1.9, design §2.2, NFR-MNT-01).
//
// Each Prisma model belongs to the module whose `// @module <name>` marker precedes it in
// prisma/schema.prisma. Code under src/modules/<a>/ may touch only models owned by <a>; anything
// else goes through the owning module's exported service (04-architecture-conventions.md §1.1).
//
// Detected references:
//   accessor  prisma.device.findMany(...), tx.device.update(...)
//   type      Prisma.DeviceWhereInput, Prisma.DeviceGetPayload<...>
//   import    import { Device } from '@prisma/client'
//   sql       FROM "devices", JOIN devices, INSERT INTO devices, UPDATE devices in raw queries
//
// Run: node scripts/check-module-boundaries.js   (part of `npm run lint`)

const fs = require('node:fs');
const path = require('node:path');

const PRISMA_OPERATIONS = [
  'findUnique',
  'findUniqueOrThrow',
  'findFirst',
  'findFirstOrThrow',
  'findMany',
  'create',
  'createMany',
  'createManyAndReturn',
  'update',
  'updateMany',
  'updateManyAndReturn',
  'upsert',
  'delete',
  'deleteMany',
  'count',
  'aggregate',
  'groupBy',
];

const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const lowerFirst = (s) => s.charAt(0).toLowerCase() + s.slice(1);

/**
 * Reads model ownership from schema text.
 * @returns {Map<string, { module: string, table: string }>}
 */
function readOwnership(schemaText) {
  const models = new Map();
  let currentModule = null;
  let currentModel = null;
  const lines = schemaText.split(/\r?\n/);

  lines.forEach((line, index) => {
    const marker = line.match(/^\s*\/\/\s*@module\s+([a-z][a-z0-9-]*)/);
    if (marker) {
      currentModule = marker[1];
      return;
    }
    const model = line.match(/^\s*model\s+(\w+)\s*\{/);
    if (model) {
      if (!currentModule) {
        throw new Error(
          `schema.prisma:${index + 1}: model ${model[1]} has no preceding // @module marker`,
        );
      }
      currentModel = model[1];
      models.set(currentModel, { module: currentModule, table: currentModel });
      return;
    }
    const map = line.match(/^\s*@@map\(\s*"([^"]+)"\s*\)/);
    if (map && currentModel) {
      models.get(currentModel).table = map[1];
      return;
    }
    if (/^\s*\}/.test(line)) currentModel = null;
  });

  return models;
}

const lineOf = (text, index) => text.slice(0, index).split('\n').length;

/**
 * @param {{ file: string, module: string, text: string }[]} files
 * @param {Map<string, { module: string, table: string }>} ownership
 */
function findViolations(files, ownership) {
  const names = [...ownership.keys()].sort((a, b) => b.length - a.length);
  const byAccessor = new Map(names.map((n) => [lowerFirst(n), n]));
  const byTable = new Map(names.map((n) => [ownership.get(n).table, n]));

  const accessorRe = new RegExp(
    `\\.\\s*(${[...byAccessor.keys()].map(escape).join('|')})\\s*\\.\\s*(?:${PRISMA_OPERATIONS.join('|')})\\b`,
    'g',
  );
  const typeRe = new RegExp(`\\bPrisma\\.(${names.map(escape).join('|')})(?![a-z0-9_])`, 'g');
  const importRe = /import\s+(?:type\s+)?\{([^}]*)\}\s*from\s*['"]@prisma\/client['"]/g;
  const sqlRe = new RegExp(
    `\\b(?:FROM|JOIN|INTO|UPDATE)\\s+"?(${[...byTable.keys()].map(escape).join('|')})"?(?![\\w])`,
    'gi',
  );

  const violations = [];
  for (const { file, module, text } of files) {
    const report = (model, index, kind) => {
      const owner = ownership.get(model).module;
      if (owner !== module) {
        violations.push({ file, line: lineOf(text, index), module, model, owner, kind });
      }
    };

    for (const m of text.matchAll(accessorRe)) report(byAccessor.get(m[1]), m.index, 'accessor');
    for (const m of text.matchAll(typeRe)) report(m[1], m.index, 'type');
    for (const m of text.matchAll(importRe)) {
      for (const raw of m[1].split(',')) {
        const name = raw
          .trim()
          .replace(/^type\s+/, '')
          .split(/\s+as\s+/)[0];
        if (ownership.has(name)) report(name, m.index, 'import');
      }
    }
    for (const m of text.matchAll(sqlRe)) report(byTable.get(m[1]), m.index, 'sql');
  }
  return violations;
}

function collectModuleFiles(modulesDir) {
  const files = [];
  if (!fs.existsSync(modulesDir)) return files;
  for (const module of fs.readdirSync(modulesDir)) {
    const root = path.join(modulesDir, module);
    if (!fs.statSync(root).isDirectory()) continue;
    const walk = (dir) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (entry.name.endsWith('.ts')) {
          files.push({ file: full, module, text: fs.readFileSync(full, 'utf8') });
        }
      }
    };
    walk(root);
  }
  return files;
}

function main() {
  const backend = path.resolve(__dirname, '..');
  const ownership = readOwnership(
    fs.readFileSync(path.join(backend, 'prisma', 'schema.prisma'), 'utf8'),
  );
  const files = collectModuleFiles(path.join(backend, 'src', 'modules'));
  const violations = findViolations(files, ownership);

  for (const v of violations) {
    console.error(
      `${path.relative(backend, v.file)}:${v.line}: module '${v.module}' references model ` +
        `${v.model} owned by '${v.owner}' (${v.kind}). Use the owning module's exported service.`,
    );
  }
  if (violations.length > 0) {
    console.error(`Module boundary check failed: ${violations.length} violation(s).`);
    process.exit(1);
  }
  console.log(
    `Module boundary check passed: ${files.length} file(s), ${ownership.size} model(s) owned.`,
  );
}

module.exports = { readOwnership, findViolations, collectModuleFiles };

if (require.main === module) main();
