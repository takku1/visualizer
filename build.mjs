import * as esbuild from 'esbuild';
import { mkdirSync, copyFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// Resolve every build input/output from this file, not the caller's cwd. This
// matters for Electron launchers, IDE tasks, and Windows shells whose cwd can
// be outside the repository (esbuild otherwise reports misleading access and
// package-resolution errors).
const projectRoot = dirname(fileURLToPath(import.meta.url));
const distRoot = join(projectRoot, 'dist');

const watch = process.argv.includes('--watch');
const serve = process.argv.includes('--serve');

mkdirSync(distRoot, { recursive: true });

/**
 * One bundled IIFE. Spicetify loads extensions as a single classic script from
 * its Extensions folder, so no imports, no code-splitting, no external deps.
 */
const common = {
  absWorkingDir: projectRoot,
  bundle: true,
  format: 'iife',
  target: 'es2022',
  platform: 'browser',
  loader: { '.glsl': 'text' },
  logLevel: 'info',
};

const ext = {
  ...common,
  entryPoints: [join(projectRoot, 'src/app.ts')],
  outfile: join(distRoot, 'system1-visualizer.js'),
  banner: { js: '// system1-visualizer — two-timescale streaming diffusion visualizer, scenes directed by Jev (TypeSafe System One)\n' },
  minify: !watch,
};

// The dev harness runs the exact same renderer + director in a plain browser
// tab, with no Spotify and no Spicetify. Iterating on shaders inside the
// Spotify client is miserable; this is the loop you actually work in.
const harness = {
  ...common,
  entryPoints: [join(projectRoot, 'dev/harness.ts')],
  outfile: join(distRoot, 'dev/harness.js'),
  minify: false,
  sourcemap: true,
};

if (watch) {
  const ctxA = await esbuild.context(ext);
  const ctxB = await esbuild.context(harness);
  await ctxA.watch();
  await ctxB.watch();
  mkdirSync(join(distRoot, 'dev'), { recursive: true });
  copyFileSync(join(projectRoot, 'dev/index.html'), join(distRoot, 'dev/index.html'));
  if (serve) {
    const { host, port } = await ctxB.serve({ servedir: join(distRoot, 'dev'), port: 5174 });
    console.log(`\n  dev harness → http://${host === '0.0.0.0' ? 'localhost' : host}:${port}\n`);
  } else {
    console.log('\n  watching…\n');
  }
} else {
  await esbuild.build(ext);
  await esbuild.build(harness);
  mkdirSync(join(distRoot, 'dev'), { recursive: true });
  copyFileSync(join(projectRoot, 'dev/index.html'), join(distRoot, 'dev/index.html'));
}
