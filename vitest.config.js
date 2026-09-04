import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: { environment: 'node', setupFiles: ['./tests/setupEnv.js'], fileParallelism: false, hookTimeout: 60000, testTimeout: 30000 }
});
