import * as esbuild from 'esbuild';
import { mkdirSync, copyFileSync } from 'node:fs';

const watch = process.argv.includes('--watch');
const serve = process.argv.includes('--serve');

mkdirSync('dist', { recursive: true });

/**
 * One bundled IIFE. Spicetify loads extensions as a single classic script from
 * its Extensions folder, so no imports, no code-splitting, no external deps.
 */
const common = {
  bundle: true,
  format: 'iife',
  target: 'es2022',
  platform: 'browser',
  loader: { '.glsl': 'text' },
  logLevel: 'info',
};

const ext = {
  ...common,
  entryPoints: ['src/app.ts'],
  outfile: 'dist/system1-visualizer.js',
  banner: { js: '// system1-visualizer — procedural visualizer directed by Jev (TypeSafe System One)\n' },
  minify: !watch,
};

// The dev harness runs the exact same renderer + director in a plain browser
// tab, with no Spotify and no Spicetify. Iterating on shaders inside the
// Spotify client is miserable; this is the loop you actually work in.
const harness = {
  ...common,
  entryPoints: ['dev/harness.ts'],
  outfile: 'dist/dev/harness.js',
  minify: false,
  sourcemap: true,
};

if (watch) {
  const ctxA = await esbuild.context(ext);
  const ctxB = await esbuild.context(harness);
  await ctxA.watch();
  await ctxB.watch();
  mkdirSync('dist/dev', { recursive: true });
  copyFileSync('dev/index.html', 'dist/dev/index.html');
  if (serve) {
    const { host, port } = await ctxB.serve({ servedir: 'dist/dev', port: 5174 });
    console.log(`\n  dev harness → http://${host === '0.0.0.0' ? 'localhost' : host}:${port}\n`);
  } else {
    console.log('\n  watching…\n');
  }
} else {
  await esbuild.build(ext);
  await esbuild.build(harness);
  mkdirSync('dist/dev', { recursive: true });
  copyFileSync('dev/index.html', 'dist/dev/index.html');
}
