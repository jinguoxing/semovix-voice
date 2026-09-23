import path from 'path';
import { fileURLToPath } from 'url';
import { defineConfig } from 'vitest/config';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(__dirname, '.'),
    },
  },
  test: {
    // 集成测试需要真实 better-sqlite3 原生模块，统一用 node 环境
    environment: 'node',
    testTimeout: 30_000,
    projects: [
      {
        test: { name: 'unit', include: ['test/unit/**/*.test.ts'] },
      },
      {
        test: { name: 'integration', include: ['test/integration/**/*.test.ts'] },
      },
    ],
  },
});
