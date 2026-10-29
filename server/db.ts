import fs from 'node:fs'
import path from 'node:path'
import mongoose from 'mongoose'

/**
 * Global cache interface for Mongoose connection across Vercel Serverless
 * warm invocations, preventing connection exhaustion on MongoDB Atlas.
 */
export interface MongooseGlobalCache {
  conn: typeof mongoose | null
  promise: Promise<typeof mongoose> | null
}

declare global {
  // eslint-disable-next-line no-var
  var _mongooseCache: MongooseGlobalCache | undefined
}

const globalCache: MongooseGlobalCache = globalThis._mongooseCache ?? {
  conn: null,
  promise: null,
}

if (!globalThis._mongooseCache) {
  globalThis._mongooseCache = globalCache
}

/**
 * Loads `.env` key-value pairs into `process.env` when running locally.
 * On Vercel / Render, environment variables are injected directly into `process.env`.
 */
export function ensureEnvLoaded(): void {
  const envPath = path.resolve(process.cwd(), '.env')
  if (!fs.existsSync(envPath)) return
  try {
    const raw = fs.readFileSync(envPath, 'utf-8')
    for (const line of raw.split(/\r?\n/)) {
      const trimmed = line.trim()
      if (!trimmed || trimmed.startsWith('#')) continue
      const eqIdx = trimmed.indexOf('=')
      if (eqIdx <= 0) continue
      const key = trimmed.slice(0, eqIdx).trim()
      let val = trimmed.slice(eqIdx + 1).trim()
      if (
        (val.startsWith('"') && val.endsWith('"')) ||
        (val.startsWith("'") && val.endsWith("'"))
      ) {
        val = val.slice(1, -1)
      }
      if (val && !process.env[key]) {
        process.env[key] = val
      }
    }
  } catch {
    // Ignore .env parse errors in serverless environments
  }
}

/**
 * Connects to MongoDB Atlas using the global `_mongooseCache` singleton.
 * Reuses active connections across Vercel Serverless function invocations.
 * Falls back gracefully to `'local-fallback'` if `MONGODB_URI` is not configured.
 */
export async function connectMongoDB(): Promise<'mongodb' | 'local-fallback'> {
  ensureEnvLoaded()

  if (globalCache.conn && mongoose.connection.readyState === 1) {
    return 'mongodb'
  }

  const uri = (process.env.MONGODB_URI || '').trim()
  if (!uri || uri.includes('<usuario>') || uri.includes('<senha>')) {
    return 'local-fallback'
  }

  if (!globalCache.promise) {
    const opts: mongoose.ConnectOptions = {
      bufferCommands: false,
      maxPoolSize: 10,
      serverSelectionTimeoutMS: 5000,
      socketTimeoutMS: 45000,
    }

    globalCache.promise = mongoose.connect(uri, opts).then((mongooseInstance) => {
      return mongooseInstance
    })
  }

  try {
    globalCache.conn = await globalCache.promise
    return 'mongodb'
  } catch (err) {
    globalCache.promise = null
    globalCache.conn = null
    console.warn(
      '[ToyTower DB] MongoDB Atlas connection failed, using local fallback store:',
      err instanceof Error ? err.message : err
    )
    return 'local-fallback'
  }
}
