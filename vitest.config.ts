import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: false,
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    exclude: ['tests/fixtures/**', 'node_modules/**', 'dist/**'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      include: ['src/**/*.ts'],
      exclude: ['src/cli/index.ts'],
    },
  },
  resolve: {
    // Allow TypeScript path resolution without .js extensions in source
    // (vitest resolves these correctly in test mode)
    conditions: ['import', 'node'],
  },
});
