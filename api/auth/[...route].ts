import type { IncomingMessage, ServerResponse } from 'node:http'
import { handleAuthApiRequest } from '../../server/authController.js'

/**
 * Vercel Serverless Function Catch-All Entrypoint for `/api/auth/*`.
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
    console.error('[Vercel /api/auth/[...route] Serverless Error]:', err)
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
