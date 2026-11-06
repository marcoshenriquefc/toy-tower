import { computed, reactive } from 'vue'
import { spriteRegistry } from '../sprites/SpriteRegistry'

export interface FriendEntry {
  handle: string
  customNick: string
  email?: string
  equippedSkin: string
  equippedBlockSkin?: string
}

export type FriendAccountEntry = FriendEntry

export interface FriendRequestEntry {
  handle: string
  customNick: string
  email?: string
  equippedSkin: string
  equippedBlockSkin?: string
  requestedAt: string
}

export interface UserStats {
  matchesPlayed: number
  wins: number
  survivalBestPieces: number
}

export interface UserAccount {
  googleId: string
  email: string
  displayName: string
  customNick: string
  handle: string
  avatarUrl: string
  coins: number
  equippedSkin: string // 'WIZARD' | 'DINO' | 'PIRATE' | 'DARK_MAGE'
  unlockedSkins: string[]
  equippedBlockSkin: string // 'PLASTIC' | 'WOOD' | 'DIY'
  unlockedBlockSkins: string[]
  friends: FriendEntry[]
  friendRequestsSent?: FriendRequestEntry[]
  friendRequestsReceived?: FriendRequestEntry[]
  stats: UserStats
  createdAt: string
  lastLoginAt: string
}

export interface CoinPackageDTO {
  id: string
  title: string
  subtitle: string
  coins: number
  bonusCoins: number
  totalCoins: number
  priceBrl: number
  badge?: string
  popular?: boolean
}

export interface ShopSkinCatalogDTO {
  code: string
  spriteId: string
  category: 'PLAYER_SKIN' | 'BLOCK_SKIN'
  name: string
  description: string
  priceCoins: number
  isDefaultFree: boolean
}

export interface ShopOrderDTO {
  orderId: string
  googleId: string
  email: string
  handle: string
  packageId: string
  packageTitle: string
  coinsAmount: number
  priceBrl: number
  paymentMethod: 'PIX' | 'CARD'
  status: 'PENDING' | 'APPROVED' | 'REJECTED' | 'CANCELLED' | 'EXPIRED'
  provider: 'MERCADO_PAGO' | 'MERCADO_PAGO_SANDBOX'
  mpPaymentId?: string | null
  mpPreferenceId?: string | null
  pixQrCode?: string | null
  pixQrCodeBase64?: string | null
  ticketUrl?: string | null
  checkoutUrl?: string | null
  coinsCredited: boolean
  createdAt: string
  updatedAt: string
  approvedAt?: string | null
}

const TOKEN_STORAGE_KEY = 'toy_tower_jwt_token'

const DB_SKIN_TO_SPRITE_ID: Record<string, string> = {
  WIZARD: 'player_mage',
  DINO: 'player_dino',
  PIRATE: 'player_pirate',
  DARK_MAGE: 'player_shadow',
  ROBOT: 'player_mage',
}

const SPRITE_ID_TO_DB_SKIN: Record<string, string> = {
  player_mage: 'WIZARD',
  player_dino: 'DINO',
  player_pirate: 'PIRATE',
  player_shadow: 'DARK_MAGE',
}

const DB_BLOCK_SKIN_TO_SPRITE_ID: Record<string, string> = {
  PLASTIC: 'default',
  DEFAULT: 'default',
  WOOD: 'wood',
  DIY: 'diy',
  GOLD: 'gold',
}

const SPRITE_ID_TO_DB_BLOCK_SKIN: Record<string, string> = {
  default: 'PLASTIC',
  plastic: 'PLASTIC',
  wood: 'WOOD',
  diy: 'DIY',
  gold: 'GOLD',
}

export function dbSkinToSpriteId(dbSkin?: string | null): string {
  if (!dbSkin) return 'player_mage'
  return DB_SKIN_TO_SPRITE_ID[dbSkin.toUpperCase()] || 'player_mage'
}

export function spriteIdToDbSkin(spriteId?: string | null): string {
  if (!spriteId) return 'WIZARD'
  return SPRITE_ID_TO_DB_SKIN[spriteId.toLowerCase()] || 'WIZARD'
}

export function dbBlockSkinToSpriteId(dbBlockSkin?: string | null): string {
  if (!dbBlockSkin) return 'default'
  return DB_BLOCK_SKIN_TO_SPRITE_ID[dbBlockSkin.toUpperCase()] || 'default'
}

export function spriteIdToDbBlockSkin(blockSpriteId?: string | null): string {
  if (!blockSpriteId) return 'PLASTIC'
  return SPRITE_ID_TO_DB_BLOCK_SKIN[blockSpriteId.toLowerCase()] || 'PLASTIC'
}

interface AuthState {
  user: UserAccount | null
  token: string | null
  isLoading: boolean
  error: string | null
  dbMode: 'mongodb' | 'local-fallback' | null
  googleClientId: string
  coinPackages: CoinPackageDTO[]
  playerSkinsCatalog: ShopSkinCatalogDTO[]
  blockSkinsCatalog: ShopSkinCatalogDTO[]
  mercadoPagoMode: 'LIVE' | 'SANDBOX_FALLBACK'
  isMercadoPagoConfigured: boolean
  activeOrder: ShopOrderDTO | null
}

const rawMpPubKey = (import.meta.env.VITE_MERCADOPAGO_PUBLIC_KEY || '').trim()
const hasValidClientMpPubKey =
  rawMpPubKey.length > 0 &&
  !rawMpPubKey.includes('SEU_PUBLIC_KEY') &&
  !rawMpPubKey.includes('YOUR_PUBLIC_KEY')

const state = reactive<AuthState>({
  user: null,
  token:
    typeof window !== 'undefined'
      ? window.localStorage.getItem(TOKEN_STORAGE_KEY)
      : null,
  isLoading: false,
  error: null,
  dbMode: null,
  googleClientId: (import.meta.env.VITE_GOOGLE_CLIENT_ID || '').trim(),
  coinPackages: [],
  playerSkinsCatalog: [],
  blockSkinsCatalog: [],
  mercadoPagoMode: hasValidClientMpPubKey ? 'LIVE' : 'SANDBOX_FALLBACK',
  isMercadoPagoConfigured: hasValidClientMpPubKey,
  activeOrder: null,
})

const isAuthenticated = computed(() => Boolean(state.user))

const LOCAL_UNLOCKED_PLAYER_SKINS_KEY = 'toy_tower_local_unlocked_player_skins'
const LOCAL_UNLOCKED_BLOCK_SKINS_KEY = 'toy_tower_local_unlocked_block_skins'

function loadLocalUnlockedCodes(storageKey: string): string[] {
  if (typeof window === 'undefined') return []
  try {
    const raw = window.localStorage.getItem(storageKey)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed)
      ? parsed.map((s) => String(s).toUpperCase())
      : []
  } catch {
    return []
  }
}

const localUnlockedSkinsState = reactive<{
  playerSkins: string[]
  blockSkins: string[]
}>({
  playerSkins: loadLocalUnlockedCodes(LOCAL_UNLOCKED_PLAYER_SKINS_KEY),
  blockSkins: loadLocalUnlockedCodes(LOCAL_UNLOCKED_BLOCK_SKINS_KEY),
})

export function unlockLocalPlayerSkin(skinIdOrCode: string): void {
  const dbCode =
    SPRITE_ID_TO_DB_SKIN[skinIdOrCode.toLowerCase()] ||
    skinIdOrCode.toUpperCase()
  if (!localUnlockedSkinsState.playerSkins.includes(dbCode)) {
    localUnlockedSkinsState.playerSkins.push(dbCode)
    try {
      if (typeof window !== 'undefined') {
        window.localStorage.setItem(
          LOCAL_UNLOCKED_PLAYER_SKINS_KEY,
          JSON.stringify(localUnlockedSkinsState.playerSkins)
        )
      }
    } catch {
      // Ignore storage error
    }
  }
}

export function unlockLocalBlockSkin(blockSkinIdOrCode: string): void {
  const dbCode =
    SPRITE_ID_TO_DB_BLOCK_SKIN[blockSkinIdOrCode.toLowerCase()] ||
    blockSkinIdOrCode.toUpperCase()
  if (!localUnlockedSkinsState.blockSkins.includes(dbCode)) {
    localUnlockedSkinsState.blockSkins.push(dbCode)
    try {
      if (typeof window !== 'undefined') {
        window.localStorage.setItem(
          LOCAL_UNLOCKED_BLOCK_SKINS_KEY,
          JSON.stringify(localUnlockedSkinsState.blockSkins)
        )
      }
    } catch {
      // Ignore storage error
    }
  }
}

/**
 * Checks if a player character skin (`player_mage`, `player_dino`, `player_pirate`, `player_shadow`)
 * is unlocked for the current Gmail account or local shop session.
 * Default initial skin (`player_mage` / `WIZARD`) is always unlocked.
 */
export function isPlayerSkinUnlocked(skinIdOrCode: string): boolean {
  const dbCode =
    SPRITE_ID_TO_DB_SKIN[skinIdOrCode.toLowerCase()] ||
    skinIdOrCode.toUpperCase()
  if (dbCode === 'WIZARD') return true
  if (localUnlockedSkinsState.playerSkins.includes(dbCode)) return true
  if (!state.user || !Array.isArray(state.user.unlockedSkins)) return false
  return state.user.unlockedSkins.some((s) => s.toUpperCase() === dbCode)
}

/**
 * Checks if a block skin (`default`, `wood`, `diy`, `gold`) is unlocked for the current Gmail account or local shop session.
 * Default initial plastic block skin (`default` / `PLASTIC`) is always unlocked.
 */
export function isBlockSkinUnlocked(blockSkinIdOrCode: string): boolean {
  const dbCode =
    SPRITE_ID_TO_DB_BLOCK_SKIN[blockSkinIdOrCode.toLowerCase()] ||
    blockSkinIdOrCode.toUpperCase()
  if (dbCode === 'PLASTIC') return true
  if (localUnlockedSkinsState.blockSkins.includes(dbCode)) return true
  if (!state.user || !Array.isArray(state.user.unlockedBlockSkins)) return false
  return state.user.unlockedBlockSkins.some((s) => s.toUpperCase() === dbCode)
}

function enforceUnlockedSkinsOnSpriteRegistry(user: UserAccount | null): void {
  if (!user) {
    // Unauthenticated / default state: Normal Mage + Normal Plastic Pieces
    spriteRegistry.setActivePlayerSkin('player_mage')
    spriteRegistry.setActiveBlockSkin('default')
    return
  }

  const desiredPlayerSpriteId = dbSkinToSpriteId(user.equippedSkin)
  const validPlayerSpriteId = isPlayerSkinUnlocked(desiredPlayerSpriteId)
    ? desiredPlayerSpriteId
    : 'player_mage'
  spriteRegistry.setActivePlayerSkin(validPlayerSpriteId)

  const desiredBlockSpriteId = dbBlockSkinToSpriteId(
    user.equippedBlockSkin || 'PLASTIC'
  )
  const validBlockSpriteId = isBlockSkinUnlocked(desiredBlockSpriteId)
    ? desiredBlockSpriteId
    : 'default'
  spriteRegistry.setActiveBlockSkin(validBlockSpriteId)
}

// Enforce default initial skin (Normal Mage + Normal Plastic Pieces) until authenticated session restores
enforceUnlockedSkinsOnSpriteRegistry(null)

function isRealClientId(id?: string | null): boolean {
  const cleaned = (id || '').trim()
  return Boolean(
    cleaned &&
      !cleaned.startsWith('seu-client-id') &&
      cleaned.includes('.apps.googleusercontent.com')
  )
}

export function hasRealGoogleClientId(): boolean {
  return (
    isRealClientId(state.googleClientId) ||
    isRealClientId(import.meta.env.VITE_GOOGLE_CLIENT_ID)
  )
}

async function parseApiJsonResponse<T>(res: Response): Promise<T> {
  const rawText = await res.text()
  if (!rawText || !rawText.trim()) {
    throw new Error(
      `Servidor retornou resposta vazia (HTTP ${res.status}). Verifique o deploy da API.`
    )
  }
  try {
    return JSON.parse(rawText) as T
  } catch {
    const preview = rawText.trim().slice(0, 120)
    throw new Error(
      `Erro no servidor da API (HTTP ${res.status}): ${preview}`
    )
  }
}

async function resolveGoogleClientId(): Promise<string> {
  if (isRealClientId(state.googleClientId)) {
    return state.googleClientId.trim()
  }
  const envClientId = (import.meta.env.VITE_GOOGLE_CLIENT_ID || '').trim()
  if (isRealClientId(envClientId)) {
    state.googleClientId = envClientId
    return envClientId
  }
  try {
    const res = await fetch('/api/auth/config', {
      method: 'GET',
      credentials: 'include',
    })
    if (res.ok) {
      const data = await parseApiJsonResponse<{
        ok?: boolean
        googleClientId?: string
      }>(res)
      if (data.googleClientId && isRealClientId(data.googleClientId)) {
        state.googleClientId = data.googleClientId.trim()
        return state.googleClientId
      }
    }
  } catch {
    // Ignore config fetch error
  }
  throw new Error(
    'GOOGLE_CLIENT_ID não encontrado. Configure VITE_GOOGLE_CLIENT_ID / GOOGLE_CLIENT_ID nas variáveis de ambiente.'
  )
}

function applyUserSession(
  user: UserAccount | null,
  token?: string | null,
  dbMode?: 'mongodb' | 'local-fallback' | null
) {
  state.user = user
  if (dbMode !== undefined) {
    state.dbMode = dbMode
  }
  if (token !== undefined) {
    state.token = token
    try {
      if (token) {
        window.localStorage.setItem(TOKEN_STORAGE_KEY, token)
      } else {
        window.localStorage.removeItem(TOKEN_STORAGE_KEY)
      }
    } catch {
      // Ignore storage errors
    }
  }
  enforceUnlockedSkinsOnSpriteRegistry(user)
}

/**
 * Restores active session on startup via `/api/auth/me` (HTTP-Only Cookie or JWT Bearer),
 * or completes an OAuth 2.0 redirect callback if `?code=...` is present in the URL.
 */
async function restoreSession(): Promise<UserAccount | null> {
  try {
    if (typeof window !== 'undefined') {
      const urlParams = new URLSearchParams(window.location.search)
      const redirectCode = urlParams.get('code')
      if (redirectCode) {
        const cleanUrl = window.location.origin + window.location.pathname
        window.history.replaceState({}, document.title, cleanUrl)
        const redirectRes = await fetch('/api/auth/google', {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            code: redirectCode,
            redirectUri: window.location.origin,
          }),
        })
        if (redirectRes.ok) {
          const redirectData = await parseApiJsonResponse<{
            ok?: boolean
            user?: UserAccount
            token?: string
            dbMode?: 'mongodb' | 'local-fallback'
          }>(redirectRes)
          if (redirectData.ok && redirectData.user) {
            applyUserSession(
              redirectData.user,
              redirectData.token || null,
              redirectData.dbMode || 'mongodb'
            )
            return redirectData.user
          }
        }
      }
    }

    const headers: Record<string, string> = {}
    if (state.token) {
      headers.Authorization = `Bearer ${state.token}`
    }
    const res = await fetch('/api/auth/me', {
      method: 'GET',
      credentials: 'include',
      headers,
    })
    if (!res.ok) return null
    const data = await parseApiJsonResponse<{
      ok?: boolean
      user?: UserAccount | null
      token?: string | null
      dbMode?: 'mongodb' | 'local-fallback'
      googleClientId?: string
    }>(res)
    if (data.googleClientId && isRealClientId(data.googleClientId)) {
      state.googleClientId = data.googleClientId.trim()
    }
    if (data.ok && data.user) {
      applyUserSession(
        data.user,
        data.token || state.token,
        data.dbMode ?? null
      )
      return data.user
    }
    applyUserSession(null, null, null)
    return null
  } catch {
    return null
  }
}

interface GoogleOAuth2Namespace {
  initCodeClient: (cfg: {
    client_id: string
    scope: string
    ux_mode?: 'popup' | 'redirect'
    redirect_uri?: string
    select_account?: boolean
    callback: (resp: { code?: string; error?: string }) => void
    error_callback?: (err: { type?: string; message?: string }) => void
  }) => { requestCode: () => void }
  initTokenClient: (cfg: {
    client_id: string
    scope: string
    prompt?: string
    callback: (resp: { access_token?: string; error?: string }) => void
    error_callback?: (err: { type?: string; message?: string }) => void
  }) => { requestAccessToken: (opts?: { prompt?: string }) => void }
}

function getGoogleOAuth2(): GoogleOAuth2Namespace | null {
  const win = window as unknown as {
    google?: {
      accounts?: {
        oauth2?: GoogleOAuth2Namespace
      }
    }
  }
  return win.google?.accounts?.oauth2 || null
}

/**
 * Dynamically loads the official Google Identity Services script (`https://accounts.google.com/gsi/client`).
 */
function loadGoogleGsiScript(): Promise<void> {
  return new Promise((resolve, reject) => {
    if (getGoogleOAuth2()) {
      resolve()
      return
    }
    const existing = document.querySelector(
      'script[src="https://accounts.google.com/gsi/client"]'
    )
    if (existing) {
      existing.addEventListener('load', () => resolve(), { once: true })
      existing.addEventListener(
        'error',
        () => reject(new Error('Falha ao carregar Google Identity Services.')),
        { once: true }
      )
      return
    }
    const script = document.createElement('script')
    script.src = 'https://accounts.google.com/gsi/client'
    script.async = true
    script.defer = true
    script.onload = () => resolve()
    script.onerror = () =>
      reject(new Error('Falha ao carregar script oficial do Google OAuth 2.0.'))
    document.head.appendChild(script)
  })
}

/**
 * Initiates the official Google OAuth 2.0 login flow (scope: `openid email profile`)
 * via Google Identity Services (`accounts.google.com`) and validates the credential
 * on the backend (`POST /api/auth/google`) with MongoDB Atlas persistence.
 */
async function loginWithGoogle(): Promise<{
  user: UserAccount
  isNewUser: boolean
  dbMode: 'mongodb' | 'local-fallback'
}> {
  state.isLoading = true
  state.error = null

  try {
    const clientId = await resolveGoogleClientId()
    await loadGoogleGsiScript()

    const oauth2 = getGoogleOAuth2()
    if (!oauth2) {
      throw new Error(
        'SDK oficial do Google (google.accounts.oauth2) não disponível no navegador.'
      )
    }

    const accessToken = await new Promise<string>((resolve, reject) => {
      let settled = false
      const tokenClient = oauth2.initTokenClient({
        client_id: clientId,
        scope: 'openid email profile',
        prompt: 'select_account',
        callback: (resp) => {
          if (settled) return
          settled = true
          if (resp.error || !resp.access_token) {
            reject(
              new Error(
                resp.error === 'access_denied'
                  ? 'Permissão negada na conta Google.'
                  : resp.error || 'Autenticação com o Google cancelada.'
              )
            )
            return
          }
          resolve(resp.access_token)
        },
        error_callback: (err) => {
          if (settled) return
          settled = true
          if (err?.type === 'popup_closed') {
            reject(new Error('Janela de login do Google foi fechada.'))
            return
          }
          if (err?.type === 'popup_failed_to_open') {
            reject(
              new Error(
                'O navegador bloqueou o popup do Google. Permita popups para este site.'
              )
            )
            return
          }
          reject(
            new Error(
              err?.message || 'Não foi possível abrir o login oficial do Google.'
            )
          )
        },
      })

      tokenClient.requestAccessToken({ prompt: 'select_account' })
    })

    const res = await fetch('/api/auth/google', {
      method: 'POST',
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        accessToken,
      }),
    })

    const data = await parseApiJsonResponse<{
      ok?: boolean
      error?: string
      user?: UserAccount
      token?: string
      isNewUser?: boolean
      dbMode?: 'mongodb' | 'local-fallback'
    }>(res)

    if (!res.ok || !data.ok || !data.user) {
      throw new Error(data.error || 'Não foi possível autenticar com o Google.')
    }

    applyUserSession(
      data.user,
      data.token || null,
      data.dbMode || 'mongodb'
    )

    return {
      user: data.user,
      isNewUser: Boolean(data.isNewUser),
      dbMode: data.dbMode || 'mongodb',
    }
  } catch (err) {
    const msg =
      err instanceof Error ? err.message : 'Erro ao conectar com o Google.'
    state.error = msg
    throw err
  } finally {
    state.isLoading = false
  }
}

async function syncEquippedSkinBySpriteId(spriteId: string): Promise<void> {
  if (!state.user) return
  if (!isPlayerSkinUnlocked(spriteId)) return
  const dbSkin = spriteIdToDbSkin(spriteId)
  state.user.equippedSkin = dbSkin
  try {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    }
    if (state.token) {
      headers.Authorization = `Bearer ${state.token}`
    }
    const res = await fetch('/api/auth/skin', {
      method: 'PATCH',
      credentials: 'include',
      headers,
      body: JSON.stringify({ equippedSkin: dbSkin }),
    })
    if (res.ok) {
      const data = await parseApiJsonResponse<{
        ok?: boolean
        user?: UserAccount
      }>(res)
      if (data.ok && data.user) {
        state.user = data.user
      }
    }
  } catch {
    // Ignore network sync error
  }
}

async function syncEquippedBlockSkinById(blockSkinId: string): Promise<void> {
  if (!state.user) return
  if (!isBlockSkinUnlocked(blockSkinId)) return
  const dbBlockSkin = spriteIdToDbBlockSkin(blockSkinId)
  state.user.equippedBlockSkin = dbBlockSkin
  try {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    }
    if (state.token) {
      headers.Authorization = `Bearer ${state.token}`
    }
    const res = await fetch('/api/auth/skin', {
      method: 'PATCH',
      credentials: 'include',
      headers,
      body: JSON.stringify({ equippedBlockSkin: dbBlockSkin }),
    })
    if (res.ok) {
      const data = await parseApiJsonResponse<{
        ok?: boolean
        user?: UserAccount
      }>(res)
      if (data.ok && data.user) {
        state.user = data.user
      }
    }
  } catch {
    // Ignore network sync error
  }
}

async function fetchShopCatalog(): Promise<{
  coinPackages: CoinPackageDTO[]
  playerSkins: ShopSkinCatalogDTO[]
  blockSkins: ShopSkinCatalogDTO[]
  mercadoPagoMode: 'LIVE' | 'SANDBOX_FALLBACK'
  isMercadoPagoConfigured: boolean
}> {
  const res = await fetch('/api/shop/catalog', {
    method: 'GET',
    credentials: 'include',
  })
  const data = await parseApiJsonResponse<{
    ok?: boolean
    error?: string
    coinPackages?: CoinPackageDTO[]
    playerSkins?: ShopSkinCatalogDTO[]
    blockSkins?: ShopSkinCatalogDTO[]
    mercadoPagoMode?: 'LIVE' | 'SANDBOX_FALLBACK'
    mercadoPago?: {
      isConfigured?: boolean
      publicKey?: string | null
      mode?: 'LIVE' | 'SANDBOX_SIMULATOR'
    }
  }>(res)

  if (!res.ok || !data.ok) {
    throw new Error(data.error || 'Não foi possível carregar o catálogo da loja.')
  }

  const mpConfigured = Boolean(
    data.mercadoPago?.isConfigured || data.mercadoPagoMode === 'LIVE'
  )

  state.coinPackages = data.coinPackages || []
  state.playerSkinsCatalog = data.playerSkins || []
  state.blockSkinsCatalog = data.blockSkins || []
  state.isMercadoPagoConfigured = mpConfigured
  state.mercadoPagoMode = mpConfigured ? 'LIVE' : 'SANDBOX_FALLBACK'

  return {
    coinPackages: state.coinPackages,
    playerSkins: state.playerSkinsCatalog,
    blockSkins: state.blockSkinsCatalog,
    mercadoPagoMode: state.mercadoPagoMode,
    isMercadoPagoConfigured: state.isMercadoPagoConfigured,
  }
}

async function createCoinOrder(
  packageId: string,
  paymentMethod: 'PIX' | 'CARD'
): Promise<ShopOrderDTO> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  }
  if (state.token) {
    headers.Authorization = `Bearer ${state.token}`
  }
  const res = await fetch('/api/shop/orders/create', {
    method: 'POST',
    credentials: 'include',
    headers,
    body: JSON.stringify({ packageId, paymentMethod }),
  })
  const data = await parseApiJsonResponse<{
    ok?: boolean
    error?: string
    order?: ShopOrderDTO
  }>(res)
  if (!res.ok || !data.ok || !data.order) {
    throw new Error(
      data.error || 'Não foi possível criar o pedido no Mercado Pago.'
    )
  }
  state.activeOrder = data.order
  return data.order
}

async function checkCoinOrderStatus(orderId: string): Promise<{
  order: ShopOrderDTO
  newlyCredited: boolean
}> {
  const headers: Record<string, string> = {}
  if (state.token) {
    headers.Authorization = `Bearer ${state.token}`
  }
  const res = await fetch(
    `/api/shop/orders/status?orderId=${encodeURIComponent(orderId)}`,
    {
      method: 'GET',
      credentials: 'include',
      headers,
    }
  )
  const data = await parseApiJsonResponse<{
    ok?: boolean
    error?: string
    order?: ShopOrderDTO
    user?: UserAccount | null
    newlyCredited?: boolean
  }>(res)
  if (!res.ok || !data.ok || !data.order) {
    throw new Error(data.error || 'Não foi possível consultar o pedido.')
  }
  state.activeOrder = data.order
  if (data.user) {
    setUser(data.user)
  }
  return {
    order: data.order,
    newlyCredited: Boolean(data.newlyCredited),
  }
}

async function listCoinOrders(): Promise<ShopOrderDTO[]> {
  const headers: Record<string, string> = {}
  if (state.token) {
    headers.Authorization = `Bearer ${state.token}`
  }
  const res = await fetch('/api/shop/orders', {
    method: 'GET',
    credentials: 'include',
    headers,
  })
  const data = await parseApiJsonResponse<{
    ok?: boolean
    error?: string
    orders?: ShopOrderDTO[]
  }>(res)
  if (!res.ok || !data.ok) {
    throw new Error(data.error || 'Não foi possível listar pedidos.')
  }
  return data.orders || []
}

async function simulateApproveCoinOrder(orderId: string): Promise<{
  order: ShopOrderDTO
  user: UserAccount | null
  newlyCredited: boolean
}> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  }
  if (state.token) {
    headers.Authorization = `Bearer ${state.token}`
  }
  const res = await fetch('/api/shop/orders/simulate-approve', {
    method: 'POST',
    credentials: 'include',
    headers,
    body: JSON.stringify({ orderId }),
  })
  const data = await parseApiJsonResponse<{
    ok?: boolean
    error?: string
    order?: ShopOrderDTO
    user?: UserAccount | null
    newlyCredited?: boolean
  }>(res)
  if (!res.ok || !data.ok || !data.order) {
    throw new Error(data.error || 'Não foi possível aprovar o pedido.')
  }
  state.activeOrder = data.order
  if (data.user) {
    setUser(data.user)
  }
  return {
    order: data.order,
    user: data.user || state.user,
    newlyCredited: Boolean(data.newlyCredited),
  }
}

async function buySkinWithCoins(
  category: 'PLAYER_SKIN' | 'BLOCK_SKIN',
  skinCode: string,
  autoEquip: boolean = true
): Promise<{
  user: UserAccount
  alreadyUnlocked: boolean
  item: ShopSkinCatalogDTO
}> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  }
  if (state.token) {
    headers.Authorization = `Bearer ${state.token}`
  }
  const res = await fetch('/api/shop/skins/buy', {
    method: 'POST',
    credentials: 'include',
    headers,
    body: JSON.stringify({ category, skinCode, autoEquip }),
  })
  const data = await parseApiJsonResponse<{
    ok?: boolean
    error?: string
    user?: UserAccount
    alreadyUnlocked?: boolean
    item?: ShopSkinCatalogDTO
  }>(res)
  if (!res.ok || !data.ok || !data.user || !data.item) {
    throw new Error(data.error || 'Não foi possível comprar a skin.')
  }
  setUser(data.user)
  return {
    user: data.user,
    alreadyUnlocked: Boolean(data.alreadyUnlocked),
    item: data.item,
  }
}

async function addFriend(query: string): Promise<FriendEntry> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  }
  if (state.token) {
    headers.Authorization = `Bearer ${state.token}`
  }
  const res = await fetch('/api/auth/friends', {
    method: 'POST',
    credentials: 'include',
    headers,
    body: JSON.stringify({ query }),
  })
  const data = await parseApiJsonResponse<{
    ok?: boolean
    error?: string
    user?: UserAccount
    addedFriend?: FriendEntry
    targetProfile?: FriendEntry
  }>(res)
  const friend = data.addedFriend || data.targetProfile
  if (!res.ok || !data.ok || !data.user || !friend) {
    throw new Error(data.error || 'Não foi possível adicionar amigo.')
  }
  state.user = data.user
  return friend
}

async function updateCustomNick(customNick: string): Promise<UserAccount> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  }
  if (state.token) {
    headers.Authorization = `Bearer ${state.token}`
  }
  const res = await fetch('/api/auth/nick', {
    method: 'PATCH',
    credentials: 'include',
    headers,
    body: JSON.stringify({ customNick }),
  })
  const data = await parseApiJsonResponse<{
    ok?: boolean
    error?: string
    user?: UserAccount
  }>(res)
  if (!res.ok || !data.ok || !data.user) {
    throw new Error(data.error || 'Não foi possível atualizar o apelido.')
  }
  state.user = data.user
  return data.user
}

async function sendFriendRequest(query: string): Promise<{
  target: FriendEntry
  autoAccepted: boolean
}> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  }
  if (state.token) {
    headers.Authorization = `Bearer ${state.token}`
  }
  const res = await fetch('/api/auth/friends/request', {
    method: 'POST',
    credentials: 'include',
    headers,
    body: JSON.stringify({ query }),
  })
  const data = await parseApiJsonResponse<{
    ok?: boolean
    error?: string
    user?: UserAccount
    target?: FriendEntry
    targetProfile?: FriendEntry
    autoAccepted?: boolean
  }>(res)
  const target = data.target || data.targetProfile
  if (!res.ok || !data.ok || !data.user || !target) {
    throw new Error(data.error || 'Jogador não encontrado')
  }
  state.user = data.user
  return {
    target,
    autoAccepted: Boolean(data.autoAccepted),
  }
}

async function respondFriendRequest(
  senderHandle: string,
  accept: boolean
): Promise<{ acceptedFriend?: FriendEntry }> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  }
  if (state.token) {
    headers.Authorization = `Bearer ${state.token}`
  }
  const res = await fetch('/api/auth/friends/respond', {
    method: 'POST',
    credentials: 'include',
    headers,
    body: JSON.stringify({ senderHandle, accept }),
  })
  const data = await parseApiJsonResponse<{
    ok?: boolean
    error?: string
    user?: UserAccount
    acceptedFriend?: FriendEntry
  }>(res)
  if (!res.ok || !data.ok || !data.user) {
    throw new Error(data.error || 'Não foi possível responder ao pedido.')
  }
  state.user = data.user
  return {
    acceptedFriend: data.acceptedFriend,
  }
}

function setUser(user: UserAccount | null): void {
  state.user = user
  enforceUnlockedSkinsOnSpriteRegistry(user)
}

const PERSONAL_BEST_STORAGE_KEY = 'toy_tower_personal_best'
let personalBestSyncTimer: ReturnType<typeof setTimeout> | null = null

function getPersonalBest(): number {
  const userBest = Number(state.user?.stats?.survivalBestPieces ?? 0)
  let localBest = 0
  if (typeof window !== 'undefined') {
    localBest = Number(
      window.localStorage.getItem(PERSONAL_BEST_STORAGE_KEY) || 0
    )
  }
  return Math.max(0, userBest, localBest)
}

function updatePersonalBest(score: number): number {
  const safeScore = Math.max(0, Math.floor(Number(score) || 0))
  const currentBest = getPersonalBest()
  if (safeScore <= currentBest) {
    return currentBest
  }

  try {
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(PERSONAL_BEST_STORAGE_KEY, String(safeScore))
    }
  } catch {
    // Ignore storage errors
  }

  if (state.user) {
    if (!state.user.stats) {
      state.user.stats = {
        matchesPlayed: 0,
        wins: 0,
        survivalBestPieces: safeScore,
      }
    } else {
      state.user.stats.survivalBestPieces = Math.max(
        Number(state.user.stats.survivalBestPieces ?? 0),
        safeScore
      )
    }

    if (personalBestSyncTimer) {
      clearTimeout(personalBestSyncTimer)
    }
    personalBestSyncTimer = setTimeout(async () => {
      try {
        const headers: Record<string, string> = {
          'Content-Type': 'application/json',
        }
        if (state.token) {
          headers.Authorization = `Bearer ${state.token}`
        }
        await fetch('/api/auth/stats', {
          method: 'PATCH',
          credentials: 'include',
          headers,
          body: JSON.stringify({ survivalBestPieces: safeScore }),
        })
      } catch {
        // Ignore network sync error
      }
    }, 650)
  }

  return safeScore
}

async function logout(): Promise<void> {
  try {
    await fetch('/api/auth/logout', {
      method: 'POST',
      credentials: 'include',
    })
  } catch {
    // Ignore logout network error
  }
  applyUserSession(null, null, null)
}

export const authStore = {
  state,
  isAuthenticated,
  isPlayerSkinUnlocked,
  isBlockSkinUnlocked,
  restoreSession,
  loginWithGoogle,
  syncEquippedSkinBySpriteId,
  syncEquippedBlockSkinById,
  fetchShopCatalog,
  createCoinOrder,
  checkCoinOrderStatus,
  listCoinOrders,
  simulateApproveCoinOrder,
  buySkinWithCoins,
  addFriend,
  updateCustomNick,
  sendFriendRequest,
  respondFriendRequest,
  setUser,
  getPersonalBest,
  updatePersonalBest,
  logout,
}


