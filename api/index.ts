import type { VercelRequest, VercelResponse } from '@vercel/node';
import type { Express } from 'express';

/**
 * Vercel serverless entry (not compiled by Nest — used by @vercel/node).
 * Nest build output lives in dist/.
 */
let cachedApp: Express | null = null;

async function getApp(): Promise<Express> {
  if (cachedApp) return cachedApp;
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const mod = require('../dist/server');
  cachedApp = await mod.createExpressApp();
  return cachedApp!;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const app = await getApp();
  return app(req, res);
}
