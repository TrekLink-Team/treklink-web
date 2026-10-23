// Types for check-module-boundaries.js, so its unit test can import it under strict TypeScript.

export interface ModelOwnership {
  module: string;
  table: string;
}

export interface SourceFile {
  file: string;
  module: string;
  text: string;
}

export interface BoundaryViolation {
  file: string;
  line: number;
  module: string;
  model: string;
  owner: string;
  kind: 'accessor' | 'type' | 'import' | 'sql';
}

export function readOwnership(schemaText: string): Map<string, ModelOwnership>;
export function findViolations(
  files: SourceFile[],
  ownership: Map<string, ModelOwnership>,
): BoundaryViolation[];
export function collectModuleFiles(modulesDir: string): SourceFile[];

/** Module to the modules it may import, from design Figure 3. */
export type DependencyGraph = Map<string, Set<string>>;

export interface ImportEdge {
  file: string;
  line: number;
  from: string;
  to: string;
  specifier: string;
}

export function readDependencyGraph(designText: string): DependencyGraph;
export function findCycle(graph: DependencyGraph): string[] | null;
export function findImportEdges(files: SourceFile[], modulesDir: string): ImportEdge[];
export function findUndeclaredEdges(edges: ImportEdge[], graph: DependencyGraph): ImportEdge[];
