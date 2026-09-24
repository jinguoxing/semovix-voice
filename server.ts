/**
 * Semovix Voice Studio - 服务端入口
 * dotenv 必须先于任何 config 取值执行；业务逻辑在 server/ 目录模块化。
 */
import dotenv from 'dotenv';
dotenv.config();

import path from 'path';
import { fileURLToPath } from 'url';
import express from 'express';
import { createApp } from './server/app';
import { getConfig } from './server/config';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function startServer() {
  const app = createApp();
  const { port, isProduction } = getConfig();

  if (!isProduction) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.resolve(__dirname, 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.resolve(distPath, 'index.html'));
    });
  }

  // P01 安全默认：仅本机监听，不暴露到局域网
  app.listen(port, '127.0.0.1', () => {
    console.log(`Semovix Voice Studio running at http://127.0.0.1:${port}`);
  });
}

startServer();
