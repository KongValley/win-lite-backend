import fs from 'node:fs';
import path from 'node:path';

function findCompiledTests(directory: string): string[] {
  const files: string[] = [];

  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const entryPath = path.join(directory, entry.name);

    if (entry.isDirectory()) {
      files.push(...findCompiledTests(entryPath));
      continue;
    }

    if (
      entry.isFile() &&
      entry.name.endsWith('.test.js') &&
      path.resolve(entryPath) !== path.resolve(__filename)
    ) {
      files.push(entryPath);
    }
  }

  return files;
}

// Load every compiled test file so additions are picked up automatically. The
// test build is cleaned first by npm test, which also avoids stale test files.
for (const testFile of findCompiledTests(__dirname).sort()) {
  require(testFile);
}
