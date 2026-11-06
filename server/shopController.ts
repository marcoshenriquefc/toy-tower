import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { connectMongoDB, ensureEnvLoaded } from './db.js'
import type { IUser } from './models/User.js'
import {
  BLOCK_SKINS_SHOP_CATALOG,
  COIN_PACKAGES_CATALOG,
  type CoinPackageCatalogItem,
  type IShopOrder,
  type PaymentMethodType,
  PLAYER_SKINS_SHOP_CATALOG,
  ShopOrderModel,
  type ShopOrderStatus,
  type ShopSkinCatalogItem,
} from './models/ShopOrder.js'
import {
  creditUserCoins,
  extractRequestToken,
  findUserByGoogleId,
  purchaseSkinWithCoins,
  verifySessionJwt,
} from './authController.js'

const LOCAL_SHOP_ORDERS_FILE = process.env.VERCEL
  ? path.join(os.tmpdir(), 'toy-tower-shop-orders.json')
  : path.resolve(process.cwd(), 'server', '.data', 'shop-orders.json')

type RealtimeShopNotifier = (event: {
  user: IUser
  order?: IShopOrder
  purchasedSkin?: ShopSkinCatalogItem
}) => void

let realtimeNotifier: RealtimeShopNotifier | null = null

/**
 * Registers a callback from the Socket.io server so that when a Mercado Pago payment
 * is approved (via webhook or status check) or a skin is purchased, the user's live
 * session and multiplayer room are notified immediately.
 */
export function registerShopRealtimeNotifier(fn: RealtimeShopNotifier): void {
  realtimeNotifier = fn
}

function notifyRealtimeUpdate(event: {
  user: IUser
  order?: IShopOrder
  purchasedSkin?: ShopSkinCatalogItem
}): void {
  if (realtimeNotifier) {
    try {
      realtimeNotifier(event)
    } catch (err) {
      console.warn('[ToyTower Shop] Realtime notifier error:', err)
    }
  }
}

export function getMercadoPagoConfig(): {
  accessToken: string
  publicKey: string
  webhookSecret: string
  isConfigured: boolean
} {
  ensureEnvLoaded()
  const accessToken = (process.env.MERCADOPAGO_ACCESS_TOKEN || '').trim()
  const publicKey = (
    process.env.MERCADOPAGO_PUBLIC_KEY ||
    process.env.VITE_MERCADOPAGO_PUBLIC_KEY ||
    ''
  ).trim()
  const webhookSecret = (process.env.MERCADOPAGO_WEBHOOK_SECRET || '').trim()
  const isConfigured = Boolean(
    accessToken &&
      !accessToken.startsWith('SEU_ACCESS_TOKEN') &&
      !accessToken.startsWith('APP_USR-000000')
  )
  return {
    accessToken,
    publicKey,
    webhookSecret,
    isConfigured,
  }
}

function readLocalOrders(): IShopOrder[] {
  try {
    if (!fs.existsSync(LOCAL_SHOP_ORDERS_FILE)) return []
    const raw = fs.readFileSync(LOCAL_SHOP_ORDERS_FILE, 'utf-8')
    const parsed = JSON.parse(raw) as IShopOrder[]
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function writeLocalOrders(orders: IShopOrder[]): void {
  try {
    const dir = path.dirname(LOCAL_SHOP_ORDERS_FILE)
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true })
    }
    fs.writeFileSync(
      LOCAL_SHOP_ORDERS_FILE,
      JSON.stringify(orders, null, 2),
      'utf-8'
    )
  } catch (err) {
    console.error('[ToyTower Shop] Failed to write local shop orders:', err)
  }
}

function sanitizeOrder(raw: IShopOrder): IShopOrder {
  return {
    orderId: String(raw.orderId || ''),
    googleId: String(raw.googleId || ''),
    email: String(raw.email || '').toLowerCase(),
    handle: String(raw.handle || '').toLowerCase(),
    packageId: String(raw.packageId || ''),
    packageTitle: String(raw.packageTitle || ''),
    coinsAmount: Math.max(1, Math.floor(Number(raw.coinsAmount || 1))),
    priceBrl: Number(Number(raw.priceBrl || 0).toFixed(2)),
    paymentMethod: raw.paymentMethod === 'CARD' ? 'CARD' : 'PIX',
    status: (raw.status || 'PENDING') as ShopOrderStatus,
    provider:
      raw.provider === 'MERCADO_PAGO_SANDBOX'
        ? 'MERCADO_PAGO_SANDBOX'
        : 'MERCADO_PAGO',
    mpPaymentId: String(raw.mpPaymentId || ''),
    mpPreferenceId: String(raw.mpPreferenceId || ''),
    pixQrCode: String(raw.pixQrCode || ''),
    pixQrCodeBase64: String(raw.pixQrCodeBase64 || ''),
    ticketUrl: String(raw.ticketUrl || ''),
    checkoutUrl: String(raw.checkoutUrl || ''),
    coinsCredited: Boolean(raw.coinsCredited),
    createdAt: new Date(raw.createdAt || Date.now()),
    updatedAt: new Date(raw.updatedAt || Date.now()),
    approvedAt: raw.approvedAt ? new Date(raw.approvedAt) : null,
  }
}

function generateOrderId(): string {
  const rand = crypto.randomBytes(4).toString('hex').toUpperCase()
  return `ORD-${Date.now().toString(36).toUpperCase()}-${rand}`
}

/**
 * Generates a realistic PIX Copy-and-Paste payload and SVG QR Code (Base64)
 * when running in Sandbox / Dev mode without a live `MERCADOPAGO_ACCESS_TOKEN`.
 */
function buildSandboxPixPayload(
  orderId: string,
  pkg: CoinPackageCatalogItem
): {
  pixQrCode: string
  pixQrCodeBase64: string
} {
  const amountFormatted = pkg.priceBrl.toFixed(2)
  const pixQrCode = `00020126580014BR.GOV.BCB.PIX0136toytower-pix@mercadopago.com.br520400005303986540${amountFormatted.length}${amountFormatted}5802BR5913TOY TOWER LTD6009SAO PAULO62240520${orderId.slice(0, 20)}6304ABCD`

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 220 220" width="220" height="220">
    <rect width="220" height="220" rx="16" fill="#FFFFFF"/>
    <rect x="16" y="16" width="56" height="56" rx="6" fill="none" stroke="#0F172A" stroke-width="8"/>
    <rect x="30" y="30" width="28" height="28" rx="3" fill="#0F172A"/>
    <rect x="148" y="16" width="56" height="56" rx="6" fill="none" stroke="#0F172A" stroke-width="8"/>
    <rect x="162" y="30" width="28" height="28" rx="3" fill="#0F172A"/>
    <rect x="16" y="148" width="56" height="56" rx="6" fill="none" stroke="#0F172A" stroke-width="8"/>
    <rect x="30" y="162" width="28" height="28" rx="3" fill="#0F172A"/>
    <rect x="86" y="24" width="12" height="12" fill="#0F172A"/>
    <rect x="110" y="24" width="20" height="12" fill="#0F172A"/>
    <rect x="86" y="48" width="24" height="12" fill="#0F172A"/>
    <rect x="86" y="84" width="52" height="52" rx="10" fill="#009EE3"/>
    <text x="112" y="115" text-anchor="middle" font-family="Arial, sans-serif" font-weight="900" font-size="18" fill="#FFFFFF">PIX</text>
    <rect x="24" y="92" width="44" height="12" fill="#0F172A"/>
    <rect x="24" y="116" width="28" height="12" fill="#0F172A"/>
    <rect x="152" y="92" width="44" height="12" fill="#0F172A"/>
    <rect x="164" y="116" width="32" height="12" fill="#0F172A"/>
    <rect x="88" y="152" width="20" height="20" fill="#0F172A"/>
    <rect x="120" y="152" width="32" height="14" fill="#0F172A"/>
    <rect x="164" y="152" width="36" height="36" rx="6" fill="#0F172A"/>
    <rect x="92" y="184" width="60" height="14" fill="#0F172A"/>
  </svg>`

  const pixQrCodeBase64 = Buffer.from(svg, 'utf-8').toString('base64')
  return { pixQrCode, pixQrCodeBase64 }
}

async function saveNewOrder(order: IShopOrder): Promise<IShopOrder> {
  const dbMode = await connectMongoDB()
  if (dbMode === 'mongodb') {
    const doc = await ShopOrderModel.create(order)
    return sanitizeOrder(doc.toObject())
  }
  const orders = readLocalOrders()
  orders.unshift(order)
  writeLocalOrders(orders)
  return sanitizeOrder(order)
}

async function findOrderByIdOrMpId(query: {
  orderId?: string
  mpPaymentId?: string
}): Promise<IShopOrder | null> {
  const dbMode = await connectMongoDB()
  if (dbMode === 'mongodb') {
    const orClauses: Array<Record<string, string>> = []
    if (query.orderId) orClauses.push({ orderId: query.orderId })
    if (query.mpPaymentId) orClauses.push({ mpPaymentId: query.mpPaymentId })
    if (orClauses.length === 0) return null
    const doc = await ShopOrderModel.findOne({ $or: orClauses })
    return doc ? sanitizeOrder(doc.toObject()) : null
  }

  const orders = readLocalOrders()
  const found = orders.find(
    (o) =>
      (query.orderId && o.orderId === query.orderId) ||
      (query.mpPaymentId &&
        o.mpPaymentId &&
        o.mpPaymentId === query.mpPaymentId)
  )
  return found ? sanitizeOrder(found) : null
}

/**
 * Idempotent approval & coin crediting:
 * Marks the order as `'APPROVED'` and credits `order.coinsAmount` to the user's Gmail account
 * ONLY IF `coinsCredited` was `false`. Safe against duplicate Mercado Pago webhook retries!
 */
export async function approveShopOrderAndCreditCoins(
  orderId: string,
  mpPaymentId?: string
): Promise<{
  order: IShopOrder | null
  user: IUser | null
  newlyApproved: boolean
}> {
  const now = new Date()
  const dbMode = await connectMongoDB()

  if (dbMode === 'mongodb') {
    // Atomic findOneAndUpdate where coinsCredited !== true ensures 100% idempotency
    const updatedOrderDoc = await ShopOrderModel.findOneAndUpdate(
      { orderId, coinsCredited: { $ne: true } },
      {
        $set: {
          status: 'APPROVED',
          coinsCredited: true,
          updatedAt: now,
          approvedAt: now,
          ...(mpPaymentId ? { mpPaymentId } : {}),
        },
      },
      { new: true }
    )

    if (updatedOrderDoc) {
      const order = sanitizeOrder(updatedOrderDoc.toObject())
      const updatedUser = await creditUserCoins(
        order.googleId,
        order.email,
        order.coinsAmount
      )
      if (updatedUser) {
        notifyRealtimeUpdate({ user: updatedUser, order })
      }
      return {
        order,
        user: updatedUser,
        newlyApproved: true,
      }
    }

    const existingDoc = await ShopOrderModel.findOne({ orderId })
    const existingOrder = existingDoc
      ? sanitizeOrder(existingDoc.toObject())
      : null
    const { user } = existingOrder
      ? await findUserByGoogleId(existingOrder.googleId)
      : { user: null }
    return {
      order: existingOrder,
      user,
      newlyApproved: false,
    }
  }

  // Local fallback store
  const orders = readLocalOrders()
  const idx = orders.findIndex((o) => o.orderId === orderId)
  if (idx === -1) {
    return { order: null, user: null, newlyApproved: false }
  }

  const target = orders[idx]
  if (target.coinsCredited) {
    const { user } = await findUserByGoogleId(target.googleId)
    return {
      order: sanitizeOrder(target),
      user,
      newlyApproved: false,
    }
  }

  target.status = 'APPROVED'
  target.coinsCredited = true
  target.updatedAt = now
  target.approvedAt = now
  if (mpPaymentId) {
    target.mpPaymentId = mpPaymentId
  }
  orders[idx] = target
  writeLocalOrders(orders)

  const order = sanitizeOrder(target)
  const updatedUser = await creditUserCoins(
    order.googleId,
    order.email,
    order.coinsAmount
  )
  if (updatedUser) {
    notifyRealtimeUpdate({ user: updatedUser, order })
  }

  return {
    order,
    user: updatedUser,
    newlyApproved: true,
  }
}

async function updateOrderStatusOnly(
  orderId: string,
  status: ShopOrderStatus,
  mpPaymentId?: string
): Promise<IShopOrder | null> {
  const now = new Date()
  const dbMode = await connectMongoDB()
  if (dbMode === 'mongodb') {
    const doc = await ShopOrderModel.findOneAndUpdate(
      { orderId },
      {
        $set: {
          status,
          updatedAt: now,
          ...(mpPaymentId ? { mpPaymentId } : {}),
        },
      },
      { new: true }
    )
    return doc ? sanitizeOrder(doc.toObject()) : null
  }

  const orders = readLocalOrders()
  const idx = orders.findIndex((o) => o.orderId === orderId)
  if (idx === -1) return null
  orders[idx].status = status
  orders[idx].updatedAt = now
  if (mpPaymentId) {
    orders[idx].mpPaymentId = mpPaymentId
  }
  writeLocalOrders(orders)
  return sanitizeOrder(orders[idx])
}

/**
 * Creates a Coin Package Order via Mercado Pago (`PIX` or `CARD`), linked to the user's Gmail account.
 */
export async function createMercadoPagoCoinOrder(
  googleId: string,
  params: {
    packageId: string
    paymentMethod: PaymentMethodType
    cardToken?: string
    issuerId?: string
    paymentMethodId?: string
    installments?: number
    payerIdentification?: { type: string; number: string }
    originUrl?: string
  }
): Promise<{
  order: IShopOrder
  user: IUser
}> {
  const { user } = await findUserByGoogleId(googleId)
  if (!user) {
    throw new Error('Faça login com sua conta Google (Gmail) para comprar moedas.')
  }

  const pkg = COIN_PACKAGES_CATALOG.find(
    (p) => p.id.toUpperCase() === String(params.packageId || '').trim().toUpperCase()
  )
  if (!pkg) {
    throw new Error('Pacote de moedas inválido.')
  }

  const paymentMethod: PaymentMethodType =
    params.paymentMethod === 'CARD' ? 'CARD' : 'PIX'
  const orderId = generateOrderId()
  const now = new Date()
  const mpConfig = getMercadoPagoConfig()
  const baseOrigin = (
    params.originUrl ||
    process.env.FRONTEND_URL?.split(',')[0] ||
    'http://localhost:5173'
  )
    .trim()
    .replace(/\/+$/, '')

  // 1. Live Mercado Pago API Integration when MERCADOPAGO_ACCESS_TOKEN is configured
  if (mpConfig.isConfigured) {
    if (paymentMethod === 'PIX') {
      const mpRes = await fetch('https://api.mercadopago.com/v1/payments', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${mpConfig.accessToken}`,
          'Content-Type': 'application/json',
          'X-Idempotency-Key': orderId,
        },
        body: JSON.stringify({
          transaction_amount: pkg.priceBrl,
          description: `Toy Tower - ${pkg.title} (${pkg.totalCoins} Moedas)`,
          payment_method_id: 'pix',
          external_reference: orderId,
          payer: {
            email: user.email,
            first_name: user.displayName || user.customNick || 'Jogador',
          },
        }),
      })

      if (!mpRes.ok) {
        const errText = await mpRes.text().catch(() => '')
        throw new Error(
          `Erro ao gerar pagamento PIX no Mercado Pago (${mpRes.status}): ${errText}`
        )
      }

      const mpData = (await mpRes.json()) as {
        id?: number | string
        status?: string
        point_of_interaction?: {
          transaction_data?: {
            qr_code?: string
            qr_code_base64?: string
            ticket_url?: string
          }
        }
      }

      const txData = mpData.point_of_interaction?.transaction_data
      const newOrder: IShopOrder = {
        orderId,
        googleId: user.googleId,
        email: user.email,
        handle: user.handle,
        packageId: pkg.id,
        packageTitle: pkg.title,
        coinsAmount: pkg.totalCoins,
        priceBrl: pkg.priceBrl,
        paymentMethod: 'PIX',
        status: mpData.status === 'approved' ? 'APPROVED' : 'PENDING',
        provider: 'MERCADO_PAGO',
        mpPaymentId: mpData.id ? String(mpData.id) : '',
        mpPreferenceId: '',
        pixQrCode: txData?.qr_code || '',
        pixQrCodeBase64: txData?.qr_code_base64 || '',
        ticketUrl: txData?.ticket_url || '',
        checkoutUrl: txData?.ticket_url || '',
        coinsCredited: false,
        createdAt: now,
        updatedAt: now,
        approvedAt: null,
      }

      const saved = await saveNewOrder(newOrder)
      if (mpData.status === 'approved') {
        const approved = await approveShopOrderAndCreditCoins(
          orderId,
          saved.mpPaymentId
        )
        return {
          order: approved.order || saved,
          user: approved.user || user,
        }
      }

      return { order: saved, user }
    }

    // CARD Payment: Direct Card Token Payment (/v1/payments) OR Checkout Pro Preference (/checkout/preferences)
    if (params.cardToken && params.paymentMethodId) {
      const mpRes = await fetch('https://api.mercadopago.com/v1/payments', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${mpConfig.accessToken}`,
          'Content-Type': 'application/json',
          'X-Idempotency-Key': orderId,
        },
        body: JSON.stringify({
          transaction_amount: pkg.priceBrl,
          token: params.cardToken,
          description: `Toy Tower - ${pkg.title} (${pkg.totalCoins} Moedas)`,
          installments: Math.max(1, Math.floor(Number(params.installments) || 1)),
          payment_method_id: params.paymentMethodId,
          issuer_id: params.issuerId || undefined,
          external_reference: orderId,
          payer: {
            email: user.email,
            identification: params.payerIdentification || undefined,
          },
        }),
      })

      if (!mpRes.ok) {
        const errText = await mpRes.text().catch(() => '')
        throw new Error(
          `Erro ao processar cartão no Mercado Pago (${mpRes.status}): ${errText}`
        )
      }

      const mpData = (await mpRes.json()) as {
        id?: number | string
        status?: string
      }

      const initialStatus: ShopOrderStatus =
        mpData.status === 'approved'
          ? 'APPROVED'
          : mpData.status === 'rejected'
            ? 'REJECTED'
            : 'PENDING'

      const newOrder: IShopOrder = {
        orderId,
        googleId: user.googleId,
        email: user.email,
        handle: user.handle,
        packageId: pkg.id,
        packageTitle: pkg.title,
        coinsAmount: pkg.totalCoins,
        priceBrl: pkg.priceBrl,
        paymentMethod: 'CARD',
        status: initialStatus,
        provider: 'MERCADO_PAGO',
        mpPaymentId: mpData.id ? String(mpData.id) : '',
        mpPreferenceId: '',
        pixQrCode: '',
        pixQrCodeBase64: '',
        ticketUrl: '',
        checkoutUrl: '',
        coinsCredited: false,
        createdAt: now,
        updatedAt: now,
        approvedAt: null,
      }

      const saved = await saveNewOrder(newOrder)
      if (initialStatus === 'APPROVED') {
        const approved = await approveShopOrderAndCreditCoins(
          orderId,
          saved.mpPaymentId
        )
        return {
          order: approved.order || saved,
          user: approved.user || user,
        }
      }

      return { order: saved, user }
    }

    // Checkout Pro Preference for Credit/Debit Card
    const prefRes = await fetch(
      'https://api.mercadopago.com/checkout/preferences',
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${mpConfig.accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          items: [
            {
              id: pkg.id,
              title: `Toy Tower - ${pkg.title} (${pkg.totalCoins} Moedas)`,
              description: `${pkg.totalCoins} Moedas vinculadas à conta ${user.email}`,
              quantity: 1,
              currency_id: 'BRL',
              unit_price: pkg.priceBrl,
            },
          ],
          payer: {
            email: user.email,
            name: user.displayName || user.customNick,
          },
          external_reference: orderId,
          payment_methods: {
            excluded_payment_types: [{ id: 'ticket' }],
            installments: 3,
          },
          back_urls: {
            success: `${baseOrigin}/?shopOrder=${encodeURIComponent(orderId)}&status=approved`,
            pending: `${baseOrigin}/?shopOrder=${encodeURIComponent(orderId)}&status=pending`,
            failure: `${baseOrigin}/?shopOrder=${encodeURIComponent(orderId)}&status=failure`,
          },
          auto_return: 'approved',
        }),
      }
    )

    if (!prefRes.ok) {
      const errText = await prefRes.text().catch(() => '')
      throw new Error(
        `Erro ao criar Checkout de Cartão no Mercado Pago (${prefRes.status}): ${errText}`
      )
    }

    const prefData = (await prefRes.json()) as {
      id?: string
      init_point?: string
      sandbox_init_point?: string
    }

    const newOrder: IShopOrder = {
      orderId,
      googleId: user.googleId,
      email: user.email,
      handle: user.handle,
      packageId: pkg.id,
      packageTitle: pkg.title,
      coinsAmount: pkg.totalCoins,
      priceBrl: pkg.priceBrl,
      paymentMethod: 'CARD',
      status: 'PENDING',
      provider: 'MERCADO_PAGO',
      mpPaymentId: '',
      mpPreferenceId: prefData.id || '',
      pixQrCode: '',
      pixQrCodeBase64: '',
      ticketUrl: '',
      checkoutUrl: prefData.init_point || prefData.sandbox_init_point || '',
      coinsCredited: false,
      createdAt: now,
      updatedAt: now,
      approvedAt: null,
    }

    const saved = await saveNewOrder(newOrder)
    return { order: saved, user }
  }

  // 2. Sandbox / Dev Preparation Mode (when MERCADOPAGO_ACCESS_TOKEN is not yet set in .env)
  const sandboxPix =
    paymentMethod === 'PIX'
      ? buildSandboxPixPayload(orderId, pkg)
      : { pixQrCode: '', pixQrCodeBase64: '' }

  const sandboxOrder: IShopOrder = {
    orderId,
    googleId: user.googleId,
    email: user.email,
    handle: user.handle,
    packageId: pkg.id,
    packageTitle: pkg.title,
    coinsAmount: pkg.totalCoins,
    priceBrl: pkg.priceBrl,
    paymentMethod,
    status: 'PENDING',
    provider: 'MERCADO_PAGO_SANDBOX',
    mpPaymentId: `MP-SANDBOX-${Date.now()}`,
    mpPreferenceId: paymentMethod === 'CARD' ? `PREF-SANDBOX-${orderId}` : '',
    pixQrCode: sandboxPix.pixQrCode,
    pixQrCodeBase64: sandboxPix.pixQrCodeBase64,
    ticketUrl: '',
    checkoutUrl:
      paymentMethod === 'CARD'
        ? `${baseOrigin}/?shopOrder=${encodeURIComponent(orderId)}&sandboxCard=1`
        : '',
    coinsCredited: false,
    createdAt: now,
    updatedAt: now,
    approvedAt: null,
  }

  const saved = await saveNewOrder(sandboxOrder)
  return { order: saved, user }
}

/**
 * Checks an order's current status (and syncs live with Mercado Pago `/v1/payments` if configured).
 */
export async function getShopOrderAndSyncStatus(
  orderId: string,
  googleId?: string
): Promise<{
  order: IShopOrder | null
  user: IUser | null
  newlyApproved: boolean
}> {
  const existing = await findOrderByIdOrMpId({ orderId })
  if (!existing) {
    return { order: null, user: null, newlyApproved: false }
  }
  if (googleId && existing.googleId !== googleId) {
    throw new Error('Este pedido pertence a outra conta.')
  }

  const mpConfig = getMercadoPagoConfig()
  if (
    existing.status === 'PENDING' &&
    existing.provider === 'MERCADO_PAGO' &&
    mpConfig.isConfigured
  ) {
    try {
      if (existing.mpPaymentId) {
        const res = await fetch(
          `https://api.mercadopago.com/v1/payments/${encodeURIComponent(existing.mpPaymentId)}`,
          {
            headers: {
              Authorization: `Bearer ${mpConfig.accessToken}`,
            },
          }
        )
        if (res.ok) {
          const data = (await res.json()) as {
            id?: number | string
            status?: string
          }
          if (data.status === 'approved') {
            return approveShopOrderAndCreditCoins(
              existing.orderId,
              String(data.id || existing.mpPaymentId)
            )
          } else if (
            data.status === 'rejected' ||
            data.status === 'cancelled'
          ) {
            const nextStatus: ShopOrderStatus =
              data.status === 'rejected' ? 'REJECTED' : 'CANCELLED'
            const updatedOrder = await updateOrderStatusOnly(
              existing.orderId,
              nextStatus
            )
            const { user } = await findUserByGoogleId(existing.googleId)
            return {
              order: updatedOrder || existing,
              user,
              newlyApproved: false,
            }
          }
        }
      } else {
        // Search by external_reference (for Checkout Pro Card preferences)
        const searchRes = await fetch(
          `https://api.mercadopago.com/v1/payments/search?external_reference=${encodeURIComponent(existing.orderId)}`,
          {
            headers: {
              Authorization: `Bearer ${mpConfig.accessToken}`,
            },
          }
        )
        if (searchRes.ok) {
          const searchData = (await searchRes.json()) as {
            results?: Array<{ id?: number | string; status?: string }>
          }
          const approvedPayment = searchData.results?.find(
            (p) => p.status === 'approved'
          )
          if (approvedPayment) {
            return approveShopOrderAndCreditCoins(
              existing.orderId,
              approvedPayment.id ? String(approvedPayment.id) : undefined
            )
          }
        }
      }
    } catch (err) {
      console.warn('[ToyTower Shop] Mercado Pago live status check failed:', err)
    }
  }

  const { user } = await findUserByGoogleId(existing.googleId)
  return {
    order: existing,
    user,
    newlyApproved: false,
  }
}

export async function listUserShopOrders(
  googleId: string,
  limit: number = 20
): Promise<IShopOrder[]> {
  const dbMode = await connectMongoDB()
  if (dbMode === 'mongodb') {
    const docs = await ShopOrderModel.find({ googleId })
      .sort({ createdAt: -1 })
      .limit(limit)
    return docs.map((d) => sanitizeOrder(d.toObject()))
  }

  const orders = readLocalOrders()
  return orders
    .filter((o) => o.googleId === googleId)
    .slice(0, limit)
    .map(sanitizeOrder)
}

/**
 * Processes incoming Mercado Pago Webhook notifications (`POST /api/shop/mercadopago/webhook`).
 */
export async function handleMercadoPagoWebhook(
  body: Record<string, unknown>,
  queryParams: URLSearchParams
): Promise<{
  ok: boolean
  orderId?: string
  status?: string
  newlyApproved?: boolean
}> {
  const mpConfig = getMercadoPagoConfig()
  const dataObj =
    body.data && typeof body.data === 'object'
      ? (body.data as Record<string, unknown>)
      : null

  const paymentId = String(
    dataObj?.id ||
      queryParams.get('data.id') ||
      queryParams.get('id') ||
      body.id ||
      ''
  ).trim()

  const externalOrderId = String(
    body.external_reference ||
      body.orderId ||
      queryParams.get('external_reference') ||
      queryParams.get('orderId') ||
      ''
  ).trim()

  if (paymentId && mpConfig.isConfigured) {
    const res = await fetch(
      `https://api.mercadopago.com/v1/payments/${encodeURIComponent(paymentId)}`,
      {
        headers: {
          Authorization: `Bearer ${mpConfig.accessToken}`,
        },
      }
    )
    if (res.ok) {
      const mpPayment = (await res.json()) as {
        id?: number | string
        status?: string
        external_reference?: string
      }
      const resolvedOrderId =
        mpPayment.external_reference ||
        externalOrderId ||
        (await findOrderByIdOrMpId({ mpPaymentId: paymentId }))?.orderId

      if (resolvedOrderId && mpPayment.status === 'approved') {
        const result = await approveShopOrderAndCreditCoins(
          resolvedOrderId,
          String(mpPayment.id || paymentId)
        )
        return {
          ok: true,
          orderId: resolvedOrderId,
          status: 'APPROVED',
          newlyApproved: result.newlyApproved,
        }
      }
      if (
        resolvedOrderId &&
        (mpPayment.status === 'rejected' || mpPayment.status === 'cancelled')
      ) {
        const nextStatus: ShopOrderStatus =
          mpPayment.status === 'rejected' ? 'REJECTED' : 'CANCELLED'
        await updateOrderStatusOnly(resolvedOrderId, nextStatus, paymentId)
        return {
          ok: true,
          orderId: resolvedOrderId,
          status: nextStatus,
          newlyApproved: false,
        }
      }
    }
  }

  // Fallback for sandbox webhook testing with explicit orderId + status: 'approved'
  if (externalOrderId && body.status === 'approved') {
    const result = await approveShopOrderAndCreditCoins(
      externalOrderId,
      paymentId || undefined
    )
    return {
      ok: true,
      orderId: externalOrderId,
      status: 'APPROVED',
      newlyApproved: result.newlyApproved,
    }
  }

  return { ok: true }
}

/**
 * Sandbox / Dev helper to simulate payment confirmation when testing locally or in sandbox mode.
 */
export async function simulateApproveShopOrder(
  orderId: string,
  googleId: string
): Promise<{
  order: IShopOrder
  user: IUser
  newlyApproved: boolean
}> {
  const existing = await findOrderByIdOrMpId({ orderId })
  if (!existing) {
    throw new Error('Pedido não encontrado.')
  }
  if (existing.googleId !== googleId) {
    throw new Error('Este pedido pertence a outra conta.')
  }

  const mpConfig = getMercadoPagoConfig()
  if (existing.provider !== 'MERCADO_PAGO_SANDBOX' && mpConfig.isConfigured) {
    throw new Error(
      'A aprovação simulada só está disponível em modo Sandbox/Teste.'
    )
  }

  const result = await approveShopOrderAndCreditCoins(
    existing.orderId,
    existing.mpPaymentId || `MP-SANDBOX-${Date.now()}`
  )
  if (!result.order || !result.user) {
    throw new Error('Não foi possível aprovar o pedido.')
  }
  return {
    order: result.order,
    user: result.user,
    newlyApproved: result.newlyApproved,
  }
}

function readJsonBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  const vercelReq = req as IncomingMessage & {
    body?: unknown
  }
  if (vercelReq.body !== undefined && vercelReq.body !== null) {
    if (Buffer.isBuffer(vercelReq.body)) {
      const str = vercelReq.body.toString('utf-8').trim()
      return Promise.resolve(
        str ? (JSON.parse(str) as Record<string, unknown>) : {}
      )
    }
    if (typeof vercelReq.body === 'string') {
      const str = vercelReq.body.trim()
      return Promise.resolve(
        str ? (JSON.parse(str) as Record<string, unknown>) : {}
      )
    }
    if (typeof vercelReq.body === 'object') {
      return Promise.resolve(vercelReq.body as Record<string, unknown>)
    }
  }
  if (req.readableEnded) {
    return Promise.resolve({})
  }
  return new Promise((resolve, reject) => {
    let raw = ''
    req.on('data', (chunk) => {
      raw += chunk
      if (raw.length > 300 * 1024 * 1024) {
        reject(new Error('Payload too large'))
      }
    })
    req.on('end', () => {
      if (!raw.trim()) {
        resolve({})
        return
      }
      try {
        resolve(JSON.parse(raw) as Record<string, unknown>)
      } catch (err) {
        reject(err)
      }
    })
    req.on('error', reject)
  })
}

function sendJson(
  res: ServerResponse,
  statusCode: number,
  data: unknown
): void {
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
  })
  res.end(JSON.stringify(data))
}

function resolveCanonicalShopSubpath(req: IncomingMessage): string | null {
  const rawUrl = req.url || ''
  const [pathname, search = ''] = rawUrl.split('?')

  const vercelReq = req as IncomingMessage & {
    query?: Record<string, string | string[] | undefined>
  }
  const params = new URLSearchParams(search)
  const queryRoute =
    vercelReq.query?.route ??
    vercelReq.query?.path ??
    params.get('route') ??
    params.get('path')

  const normalizedQueryRoute = Array.isArray(queryRoute)
    ? queryRoute.join('/')
    : (queryRoute || '').trim().replace(/^\/+/, '')

  let fullPath = pathname.replace(/\/+$/, '')
  if (
    normalizedQueryRoute &&
    (pathname === '/api/auth' ||
      pathname === '/api/auth/' ||
      pathname === '/api/shop' ||
      pathname === '/api/shop/' ||
      pathname.includes('[...route]'))
  ) {
    if (pathname.startsWith('/api/shop')) {
      fullPath = `/api/shop/${normalizedQueryRoute}`.replace(/\/+$/, '')
    } else {
      fullPath = `/api/auth/${normalizedQueryRoute}`.replace(/\/+$/, '')
    }
  }

  if (fullPath.startsWith('/api/shop')) {
    return fullPath.slice('/api/shop'.length) || '/'
  }
  if (fullPath.startsWith('/api/auth/shop')) {
    return fullPath.slice('/api/auth/shop'.length) || '/'
  }
  return null
}

/**
 * Unified HTTP request handler for `/api/shop/*` and `/api/auth/shop/*` routes:
 * - `GET  /catalog` — Returns Coin Packages, Player Skins Catalog, Block Skins Catalog, and Mercado Pago config status
 * - `GET  /orders` — Lists authenticated user's orders or fetches a specific order (`?orderId=ORD-...`)
 * - `POST /orders` — Creates a new Mercado Pago order (`PIX` or `CARD`) linked to the user's Gmail account
 * - `POST /orders/simulate-approve` — Approves a pending sandbox order in dev/test mode and credits coins
 * - `POST /mercadopago/webhook` or `/webhook` — Official Mercado Pago Webhook receiver
 * - `POST /buy-skin` — Spends account coins to permanently unlock (and optionally equip) a Player Skin or Block Skin
 */
export async function handleShopApiRequest(
  req: IncomingMessage,
  res: ServerResponse
): Promise<boolean> {
  const subpath = resolveCanonicalShopSubpath(req)
  if (subpath === null) {
    return false
  }

  const rawUrl = req.url || ''
  const [, search = ''] = rawUrl.split('?')
  const queryParams = new URLSearchParams(search)

  try {
    // 1. GET /api/shop/catalog
    if (req.method === 'GET' && (subpath === '/' || subpath === '/catalog')) {
      const mpConfig = getMercadoPagoConfig()
      sendJson(res, 200, {
        ok: true,
        mercadoPago: {
          isConfigured: mpConfig.isConfigured,
          publicKey: mpConfig.publicKey,
          supportedMethods: ['PIX', 'CARD'] as PaymentMethodType[],
          mode: mpConfig.isConfigured ? 'LIVE' : 'SANDBOX_READY',
        },
        coinPackages: COIN_PACKAGES_CATALOG,
        playerSkins: PLAYER_SKINS_SHOP_CATALOG,
        blockSkins: BLOCK_SKINS_SHOP_CATALOG,
      })
      return true
    }

    // 2. POST /api/shop/mercadopago/webhook or /api/shop/webhook
    if (
      req.method === 'POST' &&
      (subpath === '/mercadopago/webhook' || subpath === '/webhook')
    ) {
      const body = await readJsonBody(req)
      const result = await handleMercadoPagoWebhook(body, queryParams)
      sendJson(res, 200, result)
      return true
    }

    // All remaining shop routes require an authenticated Gmail account
    const token = extractRequestToken(req)
    const verified = token ? verifySessionJwt(token) : null
    if (!verified) {
      sendJson(res, 401, {
        ok: false,
        error:
          'Faça login com sua conta Google (Gmail) para acessar a Loja e suas moedas.',
      })
      return true
    }

    // 3. GET /api/shop/orders or /api/shop/orders/:orderId
    if (req.method === 'GET' && subpath.startsWith('/orders')) {
      const pathOrderId = subpath.slice('/orders'.length).replace(/^\/+/, '')
      const orderId = (pathOrderId || queryParams.get('orderId') || '').trim()

      if (orderId) {
        const result = await getShopOrderAndSyncStatus(
          orderId,
          verified.googleId
        )
        if (!result.order) {
          sendJson(res, 404, { ok: false, error: 'Pedido não encontrado.' })
          return true
        }
        sendJson(res, 200, {
          ok: true,
          order: result.order,
          user: result.user,
          newlyApproved: result.newlyApproved,
        })
        return true
      }

      const orders = await listUserShopOrders(verified.googleId)
      const { user } = await findUserByGoogleId(verified.googleId)
      sendJson(res, 200, {
        ok: true,
        orders,
        user,
      })
      return true
    }

    // 4. POST /api/shop/orders — Create Coin Package Order (PIX or CARD via Mercado Pago)
    if (req.method === 'POST' && subpath === '/orders') {
      const body = await readJsonBody(req)
      const packageId =
        typeof body.packageId === 'string' ? body.packageId.trim() : ''
      const paymentMethod: PaymentMethodType =
        String(body.paymentMethod || 'PIX').toUpperCase() === 'CARD'
          ? 'CARD'
          : 'PIX'
      const originHeader =
        typeof req.headers.origin === 'string' ? req.headers.origin : undefined

      const result = await createMercadoPagoCoinOrder(verified.googleId, {
        packageId,
        paymentMethod,
        cardToken:
          typeof body.cardToken === 'string' ? body.cardToken : undefined,
        issuerId: typeof body.issuerId === 'string' ? body.issuerId : undefined,
        paymentMethodId:
          typeof body.paymentMethodId === 'string'
            ? body.paymentMethodId
            : undefined,
        installments:
          typeof body.installments === 'number' ? body.installments : undefined,
        originUrl: originHeader,
      })

      sendJson(res, 200, {
        ok: true,
        order: result.order,
        user: result.user,
      })
      return true
    }

    // 5. POST /api/shop/orders/simulate-approve — Confirm Sandbox Order in Test Mode
    if (
      req.method === 'POST' &&
      (subpath === '/orders/simulate-approve' ||
        subpath === '/orders/confirm-test')
    ) {
      const body = await readJsonBody(req)
      const orderId =
        typeof body.orderId === 'string'
          ? body.orderId.trim()
          : (queryParams.get('orderId') || '').trim()
      if (!orderId) {
        sendJson(res, 400, { ok: false, error: 'Informe o orderId do pedido.' })
        return true
      }

      const result = await simulateApproveShopOrder(orderId, verified.googleId)
      sendJson(res, 200, {
        ok: true,
        order: result.order,
        user: result.user,
        newlyApproved: result.newlyApproved,
      })
      return true
    }

    // 6. POST /api/shop/buy-skin — Spend account-linked coins to unlock & equip a Player Skin or Block Skin
    if (req.method === 'POST' && subpath === '/buy-skin') {
      const body = await readJsonBody(req)
      const category: 'PLAYER' | 'BLOCK' =
        String(body.category || 'PLAYER').toUpperCase() === 'BLOCK'
          ? 'BLOCK'
          : 'PLAYER'
      const skinCode =
        typeof body.skinCode === 'string'
          ? body.skinCode.trim()
          : typeof body.skinId === 'string'
            ? body.skinId.trim()
            : ''
      const autoEquip = body.autoEquip !== false

      if (!skinCode) {
        sendJson(res, 400, {
          ok: false,
          error: 'Informe a skin que deseja comprar.',
        })
        return true
      }

      const result = await purchaseSkinWithCoins(verified.googleId, {
        category,
        skinCode,
        autoEquip,
      })

      notifyRealtimeUpdate({
        user: result.user,
        purchasedSkin: result.purchasedSkin,
      })

      sendJson(res, 200, {
        ok: true,
        user: result.user,
        purchasedSkin: result.purchasedSkin,
      })
      return true
    }

    sendJson(res, 404, {
      ok: false,
      error: 'Rota da Loja não encontrada.',
    })
    return true
  } catch (err) {
    console.error('[ToyTower Shop API Error]:', err)
    sendJson(res, 400, {
      ok: false,
      error:
        err instanceof Error
          ? err.message
          : 'Erro interno no processamento da Loja.',
    })
    return true
  }
}
