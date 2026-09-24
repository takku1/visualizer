import * as esbuild from 'esbuild';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

// Bundles the TypeScript test file for Node and runs it. No test framework:
// the checks are plain asserts, and a failure exits non-zero.
const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const outfile = resolve(projectRoot, 'dist/stream-tests.mjs');
await esbuild.build({
  absWorkingDir: projectRoot,
  entryPoints: [resolve(projectRoot, 'scripts/stream-tests.ts')],
  bundle: true,
  format: 'esm',
  platform: 'node',
  target: 'es2022',
  outfile,
  logLevel: 'silent',
});
await import(`${pathToFileURL(outfile).href}?run=${Date.now()}`);
