import type { Server as HttpServer } from 'node:http'
import { defineConfig, type Plugin } from 'vite'
import vue from '@vitejs/plugin-vue'
import { handleAuthApiRequest } from './server/authController'
import { attachMultiplayerSocketServer } from './server/socket/multiplayer'

function toyTowerAuthApiPlugin(): Plugin {
  const handleMiddleware = async (
    req: Parameters< typeof handleAuthApiRequest >[0],
    res: Parameters< typeof handleAuthApiRequest >[1],
    next: () => void
  ) => {
    const url = (req.url || '').split('?')[0]
    if (req.method === 'GET' && url.endsWith('/installHook.js.map')) {
      res.writeHead(200, {
        'Content-Type': 'application/json; charset=utf-8',
      })
      res.end(
        JSON.stringify({
          version: 3,
          sources: [],
          names: [],
          mappings: '',
        })
      )
      return
    }
    if (req.method === 'GET' && url === '/health') {
      res.writeHead(200, {
        'Content-Type': 'application/json; charset=utf-8',
        'Access-Control-Allow-Origin': '*',
      })
      res.end(JSON.stringify({ status: 'ok', uptime: process.uptime() }))
      return
    }
    const handled = await handleAuthApiRequest(req, res)
    if (!handled) {
      next()
    }
  }

  return {
    name: 'toy-tower-auth-api',
    configureServer(server) {
      if (server.httpServer) {
        attachMultiplayerSocketServer(server.httpServer as HttpServer)
      }
      server.middlewares.use(handleMiddleware)
    },
    configurePreviewServer(server) {
      if (server.httpServer) {
        attachMultiplayerSocketServer(server.httpServer as HttpServer)
      }
      server.middlewares.use(handleMiddleware)
    },
  }
}

export default defineConfig({
  plugins: [vue(), toyTowerAuthApiPlugin()],
  server: {
    port: 5173,
    strictPort: true,
  },
})

