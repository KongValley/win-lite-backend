import fs from 'node:fs';
import path from 'node:path';

export interface PackageMetadata {
  readonly name: string;
  readonly version: string;
  readonly dependencies: Readonly<Record<string, string>>;
}

function findProjectRoot(startDirectory: string): string {
  let current = path.resolve(startDirectory);

  while (true) {
    if (fs.existsSync(path.join(current, 'package.json'))) {
      return current;
    }

    const parent = path.dirname(current);
    if (parent === current) {
      return path.resolve(startDirectory, '..');
    }
    current = parent;
  }
}

function readPackageMetadata(projectRoot: string): PackageMetadata {
  const filePath = path.join(projectRoot, 'package.json');
  const parsed: unknown = JSON.parse(fs.readFileSync(filePath, 'utf8'));

  if (
    typeof parsed !== 'object' ||
    parsed === null ||
    !('name' in parsed) ||
    !('version' in parsed) ||
    typeof parsed.name !== 'string' ||
    typeof parsed.version !== 'string'
  ) {
    throw new Error(`Invalid package metadata: ${filePath}`);
  }

  const dependencies = 'dependencies' in parsed ? parsed.dependencies : undefined;
  const runtimeDependencies: Record<string, string> = {};
  if (
    typeof dependencies === 'object' &&
    dependencies !== null &&
    !Array.isArray(dependencies)
  ) {
    for (const [name, version] of Object.entries(dependencies)) {
      if (typeof version === 'string') {
        runtimeDependencies[name] = version;
      }
    }
  }

  return {
    name: parsed.name,
    version: parsed.version,
    dependencies: Object.freeze(runtimeDependencies),
  };
}

export const PROJECT_ROOT = findProjectRoot(__dirname);
export const PACKAGE_METADATA = readPackageMetadata(PROJECT_ROOT);
