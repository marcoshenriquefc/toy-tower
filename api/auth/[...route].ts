import type { IncomingMessage, ServerResponse } from 'node:http'
import { handleAuthApiRequest } from '../../server/authController'

/**
 * Vercel Serverless Function Catch-All Entrypoint for `/api/auth/*`.
 * Handles:
 * - `GET  /api/auth/config`
 * - `POST /api/auth/google` (Google OAuth 2.0 login + `@nome_000` handle generation)
 * - `GET  /api/auth/me`
 * - `POST /api/auth/logout`
 * - `PATCH /api/auth/skin`
 * - `PATCH /api/auth/nick`
 * - `POST /api/auth/friends/request`
 * - `POST /api/auth/friends/respond`
 *
 * Uses `global._mongooseCache` in `server/db.ts` to reuse MongoDB Atlas
 * connections across warm Serverless invocations.
 */
export default async function handler(
  req: IncomingMessage,
  res: ServerResponse
): Promise<void> {
  const handled = await handleAuthApiRequest(req, res)
  if (!handled && !res.writableEnded) {
    res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' })
    res.end(JSON.stringify({ ok: false, error: 'Route not found' }))
  }
}
