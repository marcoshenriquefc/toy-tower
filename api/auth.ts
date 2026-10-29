import type { IncomingMessage, ServerResponse } from 'node:http'
import { handleAuthApiRequest } from '../server/authController.js'

/**
 * Primary Vercel Serverless Function Entrypoint for `/api/auth/*` (via `/api/auth?route=:route*`).
 * Handles:
 * - `GET   /api/auth/config`
 * - `POST  /api/auth/google` (Google OAuth 2.0 login + `@nome_000` handle generation)
 * - `GET   /api/auth/me`
 * - `POST  /api/auth/logout`
 * - `PATCH /api/auth/skin`
 * - `PATCH /api/auth/nick`
 * - `POST  /api/auth/friends/request`
 * - `POST  /api/auth/friends/respond`
 */
export default async function handler(
  req: IncomingMessage,
  res: ServerResponse
): Promise<void> {
  try {
    const handled = await handleAuthApiRequest(req, res)
    if (!handled && !res.writableEnded) {
      res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' })
      res.end(JSON.stringify({ ok: false, error: 'Rota de autenticação não encontrada.' }))
    }
  } catch (err) {
    console.error('[Vercel /api/auth Serverless Error]:', err)
    if (!res.writableEnded) {
      res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' })
      res.end(
        JSON.stringify({
          ok: false,
          error:
            err instanceof Error
              ? err.message
              : 'Erro interno no servidor de autenticação.',
        })
      )
    }
  }
}
