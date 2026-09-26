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
