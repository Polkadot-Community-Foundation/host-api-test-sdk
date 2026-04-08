import { build } from 'esbuild';

await build({
  entryPoints: ['test/test-product.ts'],
  bundle: true,
  format: 'iife',
  platform: 'browser',
  target: 'es2022',
  outfile: 'test/test-product-bundle.js',
  sourcemap: false,
  conditions: ['browser'],
});

console.log('Test product bundle built: test/test-product-bundle.js');
