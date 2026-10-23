'use strict';

// Module-boundary check (specs/platform tasks.md 1.10 and 1.11, design §2.1 and §2.2, NFR-MNT-01).
//
// Two checks.
//
// Model ownership. Each Prisma model belongs to the module whose `// @module <name>` marker precedes it in
// prisma/schema.prisma. Code under src/modules/<a>/ may touch only models owned by <a>; anything
// else goes through the owning module's exported service (04-architecture-conventions.md §1.1).
//
// Detected references:
//   accessor  prisma.device.findMany(...), tx.device.update(...)
//   type      Prisma.DeviceWhereInput, Prisma.DeviceGetPayload<...>
//   import    import { Device } from '@prisma/client'
//   sql       FROM "devices", JOIN devices, INSERT INTO devices, UPDATE devices in raw queries
//
// Module dependencies. The solid edges of design Figure 3 (specs/platform/design.md) are the allowed
// DI imports; every module may also import platform. The declared graph must be acyclic, and an import
// from src/modules/<a>/ into src/modules/<b>/ is allowed only when Figure 3 has the edge a --> b.
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

const PLATFORM = 'platform';

/**
 * Reads the allowed module dependencies from the Mermaid block that Figure 3 captions.
 * @returns {Map<string, Set<string>>} module to the modules it may import
 */
function readDependencyGraph(designText) {
  const caption = designText.indexOf('***Figure 3***');
  if (caption < 0) throw new Error('design.md: Figure 3 caption not found');
  const start = designText.lastIndexOf('```mermaid', caption);
  const end = designText.indexOf('```', start + '```mermaid'.length);
  if (start < 0 || end < 0 || end > caption) {
    throw new Error('design.md: no Mermaid block directly above Figure 3');
  }
  const block = designText.slice(start, end);

  const names = new Map();
  for (const m of block.matchAll(/^\s*(\w+)\["([a-z][a-z0-9-]*)"\]\s*$/gm)) names.set(m[1], m[2]);
  const graph = new Map([...names.values()].map((n) => [n, new Set()]));
  for (const m of block.matchAll(/^\s*(\w+)\s*-->\s*(\w+)\s*$/gm)) {
    const [from, to] = [names.get(m[1]), names.get(m[2])];
    if (!from || !to) throw new Error(`design.md Figure 3: edge ${m[1]} --> ${m[2]} names no node`);
    graph.get(from).add(to);
  }
  if (!graph.has(PLATFORM)) throw new Error('design.md Figure 3: no platform node');
  for (const [module, deps] of graph) if (module !== PLATFORM) deps.add(PLATFORM);
  return graph;
}

/**
 * @param {Map<string, Set<string>>} graph
 * @returns {string[] | null} the modules of one cycle, first repeated last, or null
 */
function findCycle(graph) {
  const state = new Map();
  const stack = [];
  const visit = (node) => {
    state.set(node, 'open');
    stack.push(node);
    for (const next of graph.get(node) ?? []) {
      if (state.get(next) === 'open') return [...stack.slice(stack.indexOf(next)), next];
      if (!state.has(next)) {
        const cycle = visit(next);
        if (cycle) return cycle;
      }
    }
    stack.pop();
    state.set(node, 'done');
    return null;
  };
  for (const node of graph.keys()) {
    if (!state.has(node)) {
      const cycle = visit(node);
      if (cycle) return cycle;
    }
  }
  return null;
}

/**
 * Finds imports that cross from one module directory into another.
 * @param {{ file: string, module: string, text: string }[]} files
 * @param {string} modulesDir absolute path of src/modules
 */
function findImportEdges(files, modulesDir) {
  const specifierRe =
    /(?:\bfrom\s*|\bimport\s*\(\s*|\brequire\s*\(\s*|^\s*import\s+)['"](\.{1,2}\/[^'"]*)['"]/gm;
  const edges = [];
  for (const { file, module, text } of files) {
    for (const m of text.matchAll(specifierRe)) {
      const target = path.relative(modulesDir, path.resolve(path.dirname(file), m[1]));
      const [to] = target.split(path.sep);
      if (to && to !== '..' && !path.isAbsolute(target) && to !== module) {
        edges.push({ file, line: lineOf(text, m.index), from: module, to, specifier: m[1] });
      }
    }
  }
  return edges;
}

/**
 * @param {ReturnType<typeof findImportEdges>} edges
 * @param {Map<string, Set<string>>} graph
 */
function findUndeclaredEdges(edges, graph) {
  return edges.filter((e) => !graph.get(e.from)?.has(e.to));
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
  const modulesDir = path.join(backend, 'src', 'modules');
  const files = collectModuleFiles(modulesDir);
  const violations = findViolations(files, ownership);
  const graph = readDependencyGraph(
    fs.readFileSync(path.join(backend, '..', 'specs', 'platform', 'design.md'), 'utf8'),
  );
  const cycle = findCycle(graph);
  const undeclared = findUndeclaredEdges(findImportEdges(files, modulesDir), graph);

  for (const v of violations) {
    console.error(
      `${path.relative(backend, v.file)}:${v.line}: module '${v.module}' references model ` +
        `${v.model} owned by '${v.owner}' (${v.kind}). Use the owning module's exported service.`,
    );
  }
  if (cycle) {
    console.error(`specs/platform/design.md Figure 3: dependency cycle ${cycle.join(' --> ')}.`);
  }
  for (const e of undeclared) {
    console.error(
      `${path.relative(backend, e.file)}:${e.line}: module '${e.from}' imports '${e.specifier}' ` +
        `from '${e.to}', an edge design Figure 3 does not declare.`,
    );
  }
  const failures = violations.length + undeclared.length + (cycle ? 1 : 0);
  if (failures > 0) {
    console.error(`Module boundary check failed: ${failures} violation(s).`);
    process.exit(1);
  }
  console.log(
    `Module boundary check passed: ${files.length} file(s), ${ownership.size} model(s) owned, ` +
      `${graph.size} module(s) in an acyclic graph.`,
  );
}

module.exports = {
  readOwnership,
  findViolations,
  collectModuleFiles,
  readDependencyGraph,
  findCycle,
  findImportEdges,
  findUndeclaredEdges,
};

if (require.main === module) main();
