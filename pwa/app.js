const STORAGE_KEY = "budget_tracker_pwa_v1"
const APP_VERSION = "43"
const ROLLOVER_START_KEY = "2026-4"
const REVIEW_REQUIRED_MONTHS = 4
const REVIEW_HANDOFF_URL = `https://ezratawachi.github.io/scriptable-budget-tracker/pwa/?v=${APP_VERSION}&review=1`
const SUPABASE_URL = "https://yafcgilvulnbczaizcbf.supabase.co"
const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_xVtese4jTfZsAkB2cgSkOw_b8Wl5ksT"
const AI_FUNCTION_URL = SUPABASE_URL.replace(".supabase.co", ".functions.supabase.co") + "/analyze-statements"
const CLOUD_SYNC_DELAY = 900

const appEl = document.getElementById("app")
const modalEl = document.getElementById("modal")
const toastEl = document.getElementById("toast")
const bootEl = document.getElementById("boot")
const bootStartedAt = performance.now()
const queryParams = new URLSearchParams(window.location.search)
const freshPreviewMode = queryParams.has("fresh-preview")
const storyPreviewMode = freshPreviewMode || queryParams.has("story-preview") || queryParams.has("preview-intro")
const reviewDeepLinkMode = queryParams.has("review")
const inviteTokenFromURL = queryParams.get("invite")
const APP_BASE_URL = `${window.location.origin}${window.location.pathname}`

let supabaseClient = null
let cloudSaveTimer = null
let cloudSyncPromise = null

const app = {
  data: loadData(),
  key: monthKey(),
  state: null,
  view: reviewDeepLinkMode ? "review" : "home",
  modal: null,
  selectedCat: null,
  returnView: null,
  editingBudgetId: null,
  editingPresetId: null,
  editingPresetCat: null,
  editingEntryId: null,
  editingCat: null,
  editingEntryShared: false,
  editingWishId: null,
  editingWishCat: null,
  categoryHistory: {
    catId: null,
    tab: "month",
    query: "",
    mode: "list",
    returnModal: null,
    editBack: "list"
  },
  iconPickerTarget: null,
  iconPickerReturnModal: null,
  iconPickerQuery: "",
  methodIntroMode: "firstRun",
  methodStep: 0,
  methodAutoOpened: false,
  installCoachNext: null,
  reviewBusy: false,
  reviewStatus: "",
  reviewJustAnalyzed: false,
  newPresetCat: null,
  newWishCat: null,
  installPrompt: null,
  confirmConfig: null,
  pendingUndos: [],
  theme: "auto",
  methodJustSaved: false,
  shared: {
    workspace: null,
    workspaceMembers: [],
    budgets: [],
    budgetMembers: {},
    transactions: {},
    pendingInvite: null,
    pendingInvites: [],
    declinedInviteTokens: [],
    inviteTokenFromURL: inviteTokenFromURL || null,
    lastSyncedAt: null,
    syncing: false,
    pullToRefresh: 0,
    error: null
  },
  inviteEmailDraft: "",
  inviteEmailScope: null,
  confirmDeleteCtx: null,
  exportDraft: null,
  shareDraft: { name: "" },
  shareTargetBudgetId: null,
  shareTargetIsWorkspace: false,
  inviteShareLink: null,
  inviteShareLinkExpiresAt: null,
  inviteShareContextName: null,
  cloudUser: null,
  cloudEmail: "",
  cloudReady: false,
  cloudBusy: false,
  cloudStatus: "Sign in to keep your data backed up",
  lastCloudSyncAt: null,
  recoveringPassword: false,
  drafts: {
    add: freshAddDraft(),
    category: { icon: "", label: "", budget: "" },
    preset: { icon: "", desc: "", amt: "" },
    presetEdit: { icon: "", desc: "", amt: "" },
    wish: { icon: "", desc: "", amt: "" },
    budgetEdit: { icon: "", label: "", budget: "" },
    edit: { desc: "", amt: "", dateISO: todayISO() },
    wishEdit: { icon: "", desc: "", amt: "" },
    method: { monthlyIncome: "", predictableExpensesTotal: "", intentionalPool: "" },
    cloud: { email: "", password: "", code: "", codeSent: false, mode: "signin", resetSent: false, newPassword: "", confirmPassword: "" }
  }
}

markActiveMonth(app.data, app.key)
saveData(app.data, { touch: false, sync: false })
syncMethodDraft()

function clone(value) {
  return JSON.parse(JSON.stringify(value))
}

function esc(value) {
  const s = value === undefined || value === null ? "" : String(value)
  return s.replace(/[&<>'"]/g, c => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "'": "&#39;",
    "\"": "&quot;"
  }[c]))
}

function attr(value) {
  return esc(value).replace(/`/g, "&#96;")
}

function fmt(value) {
  return "$" + (Number(value) || 0).toFixed(2)
}

function money0(value) {
  return "$" + Math.round(Number(value) || 0)
}

function pad2(value) {
  return String(value).padStart(2, "0")
}

function isoFromDate(date = new Date()) {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`
}

function todayISO() {
  return isoFromDate(new Date())
}

function datePartsFromISO(value) {
  const match = String(value || "").match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (!match) return null
  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  const date = new Date(year, month - 1, day)
  if (
    date.getFullYear() !== year ||
    date.getMonth() !== month - 1 ||
    date.getDate() !== day
  ) return null
  return { year, month: month - 1, day, date }
}

function isISODate(value) {
  return !!datePartsFromISO(value)
}

function dateLabelFromISO(value) {
  const parts = datePartsFromISO(value)
  const date = parts ? parts.date : new Date()
  return date.toLocaleDateString("en-US", {
    day: "2-digit",
    month: "short"
  })
}

function monthKeyFromISO(value) {
  const parts = datePartsFromISO(value)
  return parts ? `${parts.year}-${parts.month}` : monthKey()
}

function monthShortLabel(key) {
  return monthLabel(key).replace(/\s+\d{4}$/, "")
}

function dateFriendlyLabel(value) {
  const iso = isISODate(value) ? String(value) : todayISO()
  if (iso === todayISO()) return "Today"

  const yesterday = new Date()
  yesterday.setDate(yesterday.getDate() - 1)
  if (iso === isoFromDate(yesterday)) return "Yesterday"

  const parts = datePartsFromISO(iso)
  return parts
    ? parts.date.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })
    : "Today"
}

function clampExpenseDateISO(value) {
  const iso = isISODate(value) ? String(value) : todayISO()
  const today = todayISO()
  return iso > today ? today : iso
}

function normalizeLocalEntryDateISO(entry, key) {
  if (entry && isISODate(entry.dateISO)) return String(entry.dateISO)

  const parsed = parseMonthKey(key)
  if (!parsed) return todayISO()

  const dayMatch = String((entry && entry.date) || "").match(/\d+/)
  let day = dayMatch ? parseInt(dayMatch[0], 10) : 1
  if (!Number.isFinite(day) || day < 1 || day > 31) day = 1

  const safeDate = new Date(parsed.year, parsed.month, day)
  if (safeDate.getMonth() !== parsed.month) day = 1
  return `${parsed.year}-${pad2(parsed.month + 1)}-${pad2(day)}`
}

function freshAddDraft() {
  return { amt: "", desc: "", dateISO: todayISO() }
}

function cssColor(value) {
  return /^#[0-9A-Fa-f]{6}$/.test(String(value || "")) ? String(value) : "#0F766E"
}

function roundMoney(value) {
  return Math.round((Number(value) || 0) * 100) / 100
}

function hslToHex(h, s, l) {
  s /= 100
  l /= 100

  const k = n => (n + h / 30) % 12
  const a = s * Math.min(l, 1 - l)
  const f = n => {
    const color = l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)))
    return Math.round(255 * color).toString(16).padStart(2, "0")
  }

  return ("#" + f(0) + f(8) + f(4)).toUpperCase()
}

function generatedCategoryColor(index) {
  const i = Math.max(0, Number(index) || 0)
  const hue = (i * 137.508) % 360
  const saturation = 68 + ((i * 17) % 18)
  const lightness = 46 + ((i * 11) % 10)
  return hslToHex(hue, saturation, lightness)
}

function nextCategoryColor(budgets) {
  const used = (Array.isArray(budgets) ? budgets : []).map(b => String(b.color || "").toUpperCase())
  const start = Array.isArray(budgets) ? budgets.length : 0

  for (let attempt = 0; attempt < 500; attempt++) {
    const color = generatedCategoryColor(start + attempt)
    if (!used.includes(color.toUpperCase())) return color
  }

  return generatedCategoryColor(Date.now() % 100000)
}

function ensureDataShape(data) {
  const d = data && typeof data === "object" && !Array.isArray(data) ? data : {}

  if (!d._settings || typeof d._settings !== "object") d._settings = {}
  if (!Array.isArray(d._settings.budgets)) d._settings.budgets = []

  d._settings.budgets = d._settings.budgets
    .filter(b => b && b.id && b.label)
    .map(b => ({
      id: String(b.id),
      label: String(b.label),
      icon: String(b.icon || "🏷️"),
      budget: Number(b.baseBudget ?? b.budget) || 0,
      color: cssColor(b.color)
    }))

  if (!Array.isArray(d._settings.activeMonthKeys)) d._settings.activeMonthKeys = []
  d._settings.activeMonthKeys = d._settings.activeMonthKeys
    .filter(k => parseMonthKey(k))
    .map(String)
    .filter((k, i, arr) => arr.indexOf(k) === i)

  if (!Array.isArray(d._settings.deletedPresetIds)) d._settings.deletedPresetIds = []
  d._settings.deletedPresetIds = d._settings.deletedPresetIds.filter(Boolean).map(String)

  if (!Array.isArray(d._settings.presets)) d._settings.presets = []

  d._settings.presets = d._settings.presets
    .filter(p => p && p.id && p.desc)
    .map(p => ({
      id: String(p.id),
      desc: String(p.desc || "Expense"),
      amt: Number(p.amt) || 0,
      cat: String(p.cat || ""),
      icon: String(p.icon || "⚡")
    }))
    .filter(p => p.amt > 0)

  if (!Array.isArray(d._settings.wishes)) d._settings.wishes = []
  d._settings.wishes = d._settings.wishes
    .filter(w => w && w.id && w.desc)
    .map(w => ({
      id: String(w.id),
      desc: String(w.desc || "Wish"),
      amt: Number(w.amt) || 0,
      cat: String(w.cat || ""),
      icon: String(w.icon || "✨")
    }))
    .filter(w => w.amt > 0)

  const method = d._settings.method && typeof d._settings.method === "object" ? d._settings.method : {}
  d._settings.method = {
    monthlyIncome: Number(method.monthlyIncome) || 0,
    predictableExpensesTotal: Number(method.predictableExpensesTotal) || 0,
    intentionalPool: Number(method.intentionalPool) || 0,
    completedAt: Number(method.completedAt) || 0,
    dismissedAt: Number(method.dismissedAt) || 0,
    introSeenAt: Number(method.introSeenAt) || 0,
    installCoachSeenAt: Number(method.installCoachSeenAt) || 0
  }

  d._settings.review = ensureReviewShape(d._settings.review)

  if (!d._settings._meta || typeof d._settings._meta !== "object") d._settings._meta = {}
  d._settings._meta.schemaVersion = 10
  d._settings._meta.lastSaved = Number(d._settings._meta.lastSaved) || 0

  Object.keys(d).forEach(key => {
    if (key === "_settings" || !parseMonthKey(key)) return
    d[key] = Array.isArray(d[key])
      ? d[key].filter(Boolean).map(entry => {
        const dateISO = normalizeLocalEntryDateISO(entry, key)
        return {
          id: Number(entry.id) || Date.now() + Math.floor(Math.random() * 1000),
          desc: String(entry.desc || "Expense"),
          amt: Number(entry.amt) || 0,
          cat: String(entry.cat || ""),
          date: dateLabelFromISO(dateISO),
          dateISO
        }
      }).filter(entry => entry.amt > 0)
      : []
  })

  return d
}

function ensureReviewShape(review) {
  const r = review && typeof review === "object" && !Array.isArray(review) ? review : {}
  const tx = Array.isArray(r.transactions) ? r.transactions : []
  const files = Array.isArray(r.files) ? r.files : []

  return {
    transactions: tx
      .filter(Boolean)
      .map((row, index) => normalizeReviewTransaction(row, index))
      .filter(Boolean),
    files: files
      .filter(Boolean)
      .map(file => ({
        id: String(file.id || makeReviewId(file.name || "file", file.importedAt || Date.now())),
        name: String(file.name || "Statement"),
        transactionCount: Number(file.transactionCount) || 0,
        importedAt: Number(file.importedAt) || Date.now()
      })),
    selectedCategories: normalizeStringArray(r.selectedCategories),
    selectedStores: normalizeStringArray(r.selectedStores),
    selectedTransactions: normalizeStringArray(r.selectedTransactions),
    excludedStores: normalizeStringArray(r.excludedStores),
    excludedTransactions: normalizeStringArray(r.excludedTransactions),
    expandedCategories: normalizeStringArray(r.expandedCategories),
    expandedStores: normalizeStringArray(r.expandedStores),
    activePeriod: String(r.activePeriod || "average"),
    stableMonthlyAmount: Number(r.stableMonthlyAmount) || 0,
    updatedAt: Number(r.updatedAt) || 0
  }
}

function normalizeStringArray(value) {
  return Array.isArray(value)
    ? value.filter(Boolean).map(String).filter((item, index, arr) => arr.indexOf(item) === index)
    : []
}

function normalizeReviewTransaction(row, index = 0) {
  if (!row || typeof row !== "object") return null

  const amount = Math.abs(Number(row.amount) || 0)
  const dateISO = String(row.dateISO || row.date || "").slice(0, 10)
  const monthKeyValue = String(row.monthKey || (dateISO ? dateISO.slice(0, 7) : "") || "")
  const merchant = String(row.merchant || row.store || row.payee || row.description || "Transaction").trim()
  const category = String(row.category || "Uncategorized").trim()
  const subcategory = String(row.subcategory || "General").trim()

  if (!amount || !monthKeyValue || !merchant) return null

  const sourceName = String(row.sourceName || row.fileName || "Statement")
  const originalDescription = String(row.originalDescription || row.description || merchant)
  const signature = String(row.signature || [
    monthKeyValue,
    dateISO,
    merchant,
    category,
    subcategory,
    amount.toFixed(2),
    originalDescription,
    sourceName
  ].join("|"))

  return {
    id: String(row.id || makeReviewId(signature, index)),
    monthKey: monthKeyValue,
    dateISO: dateISO || `${monthKeyValue}-01`,
    merchant,
    category,
    subcategory,
    amount,
    originalDescription,
    sourceName,
    confidence: Math.max(0, Math.min(1, Number(row.confidence) || 0.7)),
    signature
  }
}

function makeReviewId(value, salt = "") {
  const text = String(value || "") + "|" + String(salt || "")
  let hash = 0
  for (let i = 0; i < text.length; i++) {
    hash = ((hash << 5) - hash) + text.charCodeAt(i)
    hash |= 0
  }
  return "review_" + Math.abs(hash).toString(36)
}

function loadData() {
  if (freshPreviewMode) return ensureDataShape({})

  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return ensureDataShape(raw ? JSON.parse(raw) : {})
  } catch (error) {
    return ensureDataShape({})
  }
}

function saveData(data, options = {}) {
  const touch = options.touch !== false
  const sync = options.sync !== false
  const shaped = ensureDataShape(data)
  if (touch) shaped._settings._meta.lastSaved = Date.now()
  if (!freshPreviewMode) localStorage.setItem(STORAGE_KEY, JSON.stringify(shaped))
  if (sync && !freshPreviewMode) scheduleCloudSave()
}

function getSavedAt(data) {
  return Number(data?._settings?._meta?.lastSaved) || 0
}

function dataStats(data) {
  const shaped = ensureDataShape(clone(data || {}))
  const settings = shaped._settings || {}
  const monthKeys = Object.keys(shaped).filter(key => key !== "_settings" && parseMonthKey(key))
  const transactions = monthKeys.reduce((sum, key) => sum + (Array.isArray(shaped[key]) ? shaped[key].length : 0), 0)
  const method = settings.method || {}
  const methodStarted = !!(
    Number(method.monthlyIncome) ||
    Number(method.predictableExpensesTotal) ||
    Number(method.intentionalPool) ||
    Number(method.completedAt) ||
    Number(method.dismissedAt) ||
    Number(method.introSeenAt) ||
    Number(method.installCoachSeenAt)
  )

  return {
    budgets: Array.isArray(settings.budgets) ? settings.budgets.length : 0,
    presets: Array.isArray(settings.presets) ? settings.presets.length : 0,
    wishes: Array.isArray(settings.wishes) ? settings.wishes.length : 0,
    transactions,
    methodStarted
  }
}

function hasBudgetContent(data) {
  const stats = dataStats(data)
  return stats.budgets + stats.presets + stats.wishes + stats.transactions > 0
}

function hasUserContent(data) {
  const stats = dataStats(data)
  return stats.budgets + stats.presets + stats.wishes + stats.transactions > 0 || stats.methodStarted
}

function refreshCloudSurface() {
  if (app.view === "account") render()
  if (app.modal === "data") renderModal()
}

function setCloudStatus(message, busy) {
  app.cloudStatus = message
  if (typeof busy === "boolean") app.cloudBusy = busy
  refreshCloudSurface()
}

function cloudErrorMessage(error) {
  const raw = error && error.message ? String(error.message) : "Backup is unavailable right now"
  const message = raw
    .replace(/supabase/gi, "backup")
    .replace(/invalid login credentials/gi, "Email or password is incorrect")
    .replace(/email not confirmed/gi, "Check your email to finish setting up your account")
  return message.length > 110 ? message.slice(0, 107) + "..." : message
}

function applyCloudSession(session) {
  const user = session && session.user ? session.user : null
  const wasSignedIn = !!app.cloudUser
  app.cloudUser = user
  app.cloudEmail = user ? (user.email || "") : ""

  if (!user) {
    clearTimeout(cloudSaveTimer)
    app.cloudReady = false
    app.cloudBusy = false
    app.lastCloudSyncAt = null
    app.cloudStatus = "Sign in to keep your data backed up"
    if (wasSignedIn) sharedClear()
  } else if (!app.cloudStatus || app.cloudStatus === "Sign in to keep your data backed up") {
    app.cloudStatus = "Setting up backup..."
  }
}

async function onCloudReady() {
  if (!supabaseClient || !app.cloudUser) return
  await sharedFetchAll()

  // Legacy URL token (kept for backward compatibility with existing links)
  const token = app.shared.inviteTokenFromURL
  if (token) {
    app.shared.inviteTokenFromURL = null
    try {
      const url = new URL(window.location.href)
      url.searchParams.delete("invite")
      window.history.replaceState({}, "", url.toString())
    } catch (_) {}

    const invite = await inviteFetch(token)
    if (invite && !invite.used_at && new Date(invite.expires_at) > new Date() && invite.inviter_id !== app.cloudUser.id) {
      // Surface the URL invite at the top of the pending queue
      const fromUrl = {
        token: invite.token,
        inviterEmail: invite.inviter_email,
        workspaceId: invite.workspace_id,
        budgetId: invite.budget_id,
        workspaceName: invite.workspaces && invite.workspaces.name,
        budgetLabel: invite.shared_budgets && invite.shared_budgets.label,
        role: invite.role,
        expiresAt: invite.expires_at
      }
      const dedup = (app.shared.pendingInvites || []).filter(p => p.token !== fromUrl.token)
      app.shared.pendingInvites = [fromUrl, ...dedup]
    } else if (invite && invite.used_at) {
      toast("Invite already used")
    } else if (invite && new Date(invite.expires_at) < new Date()) {
      toast("Invite expired")
    } else if (invite && invite.inviter_id === app.cloudUser.id) {
      toast("That's your own invite link")
    }
  }

  // Auto-present first pending invite, if any
  if ((app.shared.pendingInvites || []).length > 0) {
    app.shared.pendingInvite = app.shared.pendingInvites[0]
    app.modal = "acceptInvite"
    renderModal()
  }

  render()
}

function scheduleCloudSave() {
  if (!supabaseClient || !app.cloudUser || !app.cloudReady) return
  clearTimeout(cloudSaveTimer)
  app.cloudStatus = "Syncing..."
  refreshCloudSurface()
  cloudSaveTimer = setTimeout(() => {
    pushCloudData({ silent: true })
  }, CLOUD_SYNC_DELAY)
}

function startCloudSync(options = {}) {
  if (cloudSyncPromise) return cloudSyncPromise
  cloudSyncPromise = pullCloudData(options).finally(() => {
    cloudSyncPromise = null
  })
  return cloudSyncPromise
}

async function initCloud() {
  if (freshPreviewMode) {
    app.cloudStatus = "Preview mode. Changes are not saved."
    render()
    return
  }

  if (!window.supabase || typeof window.supabase.createClient !== "function") {
    app.cloudStatus = "Backup is unavailable. Data is saved on this device."
    render()
    return
  }

  supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true
    }
  })

  supabaseClient.auth.onAuthStateChange((event, session) => {
    if (event === "PASSWORD_RECOVERY") {
      app.recoveringPassword = true
      app.view = "account"
      app.drafts.cloud.mode = "signin"
      app.drafts.cloud.password = ""
      app.drafts.cloud.newPassword = ""
      app.drafts.cloud.confirmPassword = ""
    }

    applyCloudSession(session)
    if (session && session.user) {
      startCloudSync({ preferNewer: true, silent: true }).then(() => onCloudReady())
    } else {
      render()
    }
  })

  try {
    const { data, error } = await supabaseClient.auth.getSession()
    if (error) throw error
    applyCloudSession(data.session)
    if (data.session && data.session.user) {
      await startCloudSync({ preferNewer: true, silent: true })
      await onCloudReady()
    } else {
      render()
    }
  } catch (error) {
    app.cloudStatus = cloudErrorMessage(error)
    app.cloudBusy = false
    render()
  }
}

async function sendEmailCode() {
  if (!supabaseClient) {
    toast("Backup is not ready")
    return
  }

  const field = document.getElementById("cloud-email")
  const email = String((field && field.value) || app.drafts.cloud.email || "").trim().toLowerCase()
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    toast("Enter a valid email")
    return
  }

  app.drafts.cloud.email = email
  setCloudStatus("Sending code...", true)

  try {
    const { error } = await supabaseClient.auth.signInWithOtp({
      email,
      options: {
        shouldCreateUser: true
      }
    })
    if (error) throw error
    app.drafts.cloud.codeSent = true
    app.drafts.cloud.code = ""
    app.drafts.cloud.mode = "code"
    setCloudStatus("Code sent. Type it here to sign in.", false)
    haptic("success")
    toast("Check your email")
  } catch (error) {
    setCloudStatus(cloudErrorMessage(error), false)
    toast("Could not send code")
  }
}

async function verifyEmailCode() {
  if (!supabaseClient) {
    toast("Backup is not ready")
    return
  }

  const email = String(app.drafts.cloud.email || "").trim().toLowerCase()
  const code = String(app.drafts.cloud.code || "").replace(/\D/g, "")

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    toast("Enter your email first")
    return
  }

  if (code.length < 6) {
    toast("The code has 6 digits")
    return
  }

  setCloudStatus("Verifying code...", true)

  try {
    const { data, error } = await supabaseClient.auth.verifyOtp({
      email,
      token: code,
      type: "email"
    })
    if (error) throw error
    applyCloudSession(data.session)
    app.drafts.cloud.codeSent = false
    app.drafts.cloud.code = ""
    await startCloudSync({ preferNewer: true, silent: true })
    setCloudStatus("Saved", false)
    render()
    haptic("success")
    toast("Signed in")
  } catch (error) {
    setCloudStatus(cloudErrorMessage(error), false)
    toast("Invalid code")
  }
}

function getCloudCredentials() {
  const emailField = document.getElementById("cloud-email")
  const passwordField = document.getElementById("cloud-password")
  const email = String((emailField && emailField.value) || app.drafts.cloud.email || "").trim().toLowerCase()
  const password = String((passwordField && passwordField.value) || app.drafts.cloud.password || "")
  return { email, password }
}

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email || ""))
}

async function signInWithPassword() {
  if (!supabaseClient) {
    toast("Backup is not ready")
    return
  }

  const { email, password } = getCloudCredentials()
  if (!isValidEmail(email) || password.length < 6) {
    toast("Enter email and password")
    return
  }

  app.drafts.cloud.email = email
  app.drafts.cloud.password = password
  setCloudStatus("Signing in...", true)

  try {
    const { data, error } = await supabaseClient.auth.signInWithPassword({ email, password })
    if (error) throw error
    applyCloudSession(data.session)
    app.drafts.cloud.password = ""
    await startCloudSync({ preferNewer: true, silent: true })
    setCloudStatus("Saved", false)
    render()
    haptic("success")
    toast("Signed in")
  } catch (error) {
    setCloudStatus(cloudErrorMessage(error), false)
    toast(cloudErrorMessage(error))
  }
}

async function createPasswordAccount() {
  if (!supabaseClient) {
    toast("Backup is not ready")
    return
  }

  const { email, password } = getCloudCredentials()
  if (!isValidEmail(email) || password.length < 6) {
    toast("Use a valid email and 6+ character password")
    return
  }

  app.drafts.cloud.email = email
  app.drafts.cloud.password = password
  setCloudStatus("Creating account...", true)

  try {
    const { data, error } = await supabaseClient.auth.signUp({ email, password })
    if (error) throw error
    app.drafts.cloud.password = ""

    if (data.session) {
      applyCloudSession(data.session)
      await startCloudSync({ preferNewer: true, silent: true })
      setCloudStatus("Saved", false)
      render()
      haptic("success")
      toast("Account created")
      return
    }

    setCloudStatus("Check your email to finish creating your account.", false)
    render()
    haptic("success")
    toast("Check your email")
  } catch (error) {
    setCloudStatus(cloudErrorMessage(error), false)
    toast(cloudErrorMessage(error))
  }
}

async function sendPasswordReset() {
  if (!supabaseClient) {
    toast("Backup is not ready")
    return
  }

  const { email } = getCloudCredentials()
  if (!isValidEmail(email)) {
    toast("Enter your email first")
    return
  }

  app.drafts.cloud.email = email
  setCloudStatus("Sending reset email...", true)

  try {
    const redirectTo = appBaseUrl()
    const { error } = await supabaseClient.auth.resetPasswordForEmail(email, { redirectTo })
    if (error) throw error
    app.drafts.cloud.resetSent = true
    setCloudStatus("Password reset email sent.", false)
    haptic("success")
    toast("Check your email")
  } catch (error) {
    setCloudStatus(cloudErrorMessage(error), false)
    toast("Could not send reset email")
  }
}

function appBaseUrl() {
  const url = new URL(window.location.href)
  url.search = ""
  url.hash = ""
  return url.href
}

async function updateRecoveredPassword() {
  if (!supabaseClient || !app.cloudUser) {
    toast("Open the reset link again")
    return
  }

  const password = String(app.drafts.cloud.newPassword || "")
  const confirmPassword = String(app.drafts.cloud.confirmPassword || "")
  if (password.length < 6) {
    toast("Use at least 6 characters")
    return
  }

  if (password !== confirmPassword) {
    toast("Passwords do not match")
    return
  }

  setCloudStatus("Updating password...", true)

  try {
    const { error } = await supabaseClient.auth.updateUser({ password })
    if (error) throw error
    app.recoveringPassword = false
    app.drafts.cloud.newPassword = ""
    app.drafts.cloud.confirmPassword = ""
    app.drafts.cloud.password = ""
    app.drafts.cloud.resetSent = false
    setCloudStatus("Password updated", false)
    render()
    haptic("success")
    toast("Password updated")
  } catch (error) {
    setCloudStatus(cloudErrorMessage(error), false)
    toast("Could not update password")
  }
}

function canUpdateRecoveredPassword() {
  const password = String(app.drafts.cloud.newPassword || "")
  const confirmPassword = String(app.drafts.cloud.confirmPassword || "")
  return password.length >= 6 && confirmPassword.length >= 6 && password === confirmPassword
}

async function signOutCloud() {
  if (!supabaseClient) return
  setCloudStatus("Signing out...", true)
  await supabaseClient.auth.signOut().catch(() => null)
  applyCloudSession(null)
  app.drafts.cloud.password = ""
  app.drafts.cloud.code = ""
  app.drafts.cloud.codeSent = false
  app.drafts.cloud.mode = "signin"
  app.drafts.cloud.resetSent = false
  app.drafts.cloud.newPassword = ""
  app.drafts.cloud.confirmPassword = ""
  app.recoveringPassword = false
  render()
  haptic("medium")
  toast("Signed out")
}

async function pushCloudData(options = {}) {
  const silent = !!options.silent
  if (!supabaseClient || !app.cloudUser) {
    if (!silent) toast("Sign in first")
    return false
  }

  clearTimeout(cloudSaveTimer)
  setCloudStatus("Syncing...", true)

  try {
    const payload = ensureDataShape(clone(app.data))
    if (!payload._settings._meta.lastSaved) payload._settings._meta.lastSaved = Date.now()

    const { error } = await supabaseClient
      .from("budget_sync")
      .upsert({ user_id: app.cloudUser.id, data: payload }, { onConflict: "user_id" })

    if (error) throw error

    app.cloudReady = true
    app.lastCloudSyncAt = Date.now()
    setCloudStatus("Saved", false)
    if (!silent) haptic("success")
    if (!silent) toast("Backed up")
    return true
  } catch (error) {
    setCloudStatus(cloudErrorMessage(error), false)
    if (!silent) toast("Could not sync")
    return false
  }
}

async function pullCloudData(options = {}) {
  const preferNewer = !!options.preferNewer
  const silent = !!options.silent
  if (!supabaseClient || !app.cloudUser) {
    if (!silent) toast("Sign in first")
    return false
  }

  setCloudStatus("Restoring backup...", true)

  try {
    const { data: row, error } = await supabaseClient
      .from("budget_sync")
      .select("data, updated_at")
      .eq("user_id", app.cloudUser.id)
      .maybeSingle()

    if (error) throw error

    if (!row || !row.data) {
      app.cloudReady = true
      const uploaded = await pushCloudData({ silent: true })
      if (uploaded && !silent) toast("Backup ready")
      return uploaded
    }

    const remoteData = ensureDataShape(clone(row.data))
    const remoteSavedAt = Math.max(getSavedAt(remoteData), Date.parse(row.updated_at) || 0)
    const localSavedAt = getSavedAt(app.data)
    const localLooksEmpty = !hasBudgetContent(app.data)
    const remoteHasContent = hasUserContent(remoteData)

    if (preferNewer && localSavedAt > remoteSavedAt + 1000 && !(localLooksEmpty && remoteHasContent)) {
      app.cloudReady = true
      setCloudStatus("Saving latest changes...", true)
      const uploaded = await pushCloudData({ silent: true })
      if (uploaded && !silent) toast("Backup updated")
      return uploaded
    }

    app.data = remoteData
    markActiveMonth(app.data, app.key)
    saveData(app.data, { touch: false, sync: false })
    app.cloudReady = true
    app.lastCloudSyncAt = Date.now()
    setCloudStatus("Saved", false)
    render()
    if (!silent) haptic("success")
    if (!silent) toast("Backup restored")
    return true
  } catch (error) {
    setCloudStatus(cloudErrorMessage(error), false)
    if (!silent) toast("Could not restore backup")
    return false
  }
}

// ============================================================
// Shared budgets — workspaces, members, invites
// ============================================================

function sharedClear() {
  app.shared.workspace = null
  app.shared.workspaceMembers = []
  app.shared.budgets = []
  app.shared.budgetMembers = {}
  app.shared.transactions = {}
  app.shared.pendingInvite = null
  app.shared.lastSyncedAt = null
  app.shared.syncing = false
  app.shared.error = null
}

function sharedBudgetById(id) {
  return app.shared.budgets.find(b => b.id === id) || null
}

function sharedTxByBudget(budgetId) {
  return app.shared.transactions[budgetId] || []
}

// Convert a local entry (with monthKey and short "May 10"-style date string)
// into a real YYYY-MM-DD ISO date. Falls back to first-of-month, then today.
function localEntryToISODate(entry, monthKey) {
  return normalizeLocalEntryDateISO(entry, monthKey)
}

function randomInviteToken() {
  const bytes = new Uint8Array(12)
  crypto.getRandomValues(bytes)
  return Array.from(bytes, b => b.toString(36).padStart(2, "0")).join("").slice(0, 16)
}

function inviteShareURL(token) {
  return `${APP_BASE_URL}?invite=${encodeURIComponent(token)}`
}

async function sharedFetchAll() {
  if (!supabaseClient || !app.cloudUser) return false
  app.shared.syncing = true

  try {
    const myId = app.cloudUser.id

    // Workspace membership (v1: max 1)
    const { data: wsMembership, error: e1 } = await supabaseClient
      .from("workspace_members")
      .select("workspace_id, role, workspaces(id, name, owner_id, created_at)")
      .eq("user_id", myId)
      .limit(1)
      .maybeSingle()
    if (e1) throw e1

    let workspace = null
    let workspaceMembers = []
    if (wsMembership && wsMembership.workspaces) {
      workspace = {
        id: wsMembership.workspaces.id,
        name: wsMembership.workspaces.name,
        ownerId: wsMembership.workspaces.owner_id,
        myRole: wsMembership.role
      }
      const { data: members, error: e1b } = await supabaseClient
        .from("workspace_members")
        .select("user_id, display_email, role, joined_at")
        .eq("workspace_id", workspace.id)
      if (e1b) throw e1b
      workspaceMembers = members || []
    }

    // All readable shared budgets (RLS filters to mine), excluding soft-deleted
    const { data: budgets, error: e2 } = await supabaseClient
      .from("shared_budgets")
      .select("*")
      .is("deleted_at", null)
      .order("created_at", { ascending: true })
    if (e2) throw e2

    const budgetList = (budgets || []).map(b => ({
      id: b.id,
      label: b.label,
      icon: b.icon || "🏷️",
      budget: Number(b.monthly_budget) || 0,
      color: b.color || "#0F766E",
      workspaceId: b.workspace_id,
      ownerId: b.owner_id,
      myRole: b.owner_id === myId ? "owner" : "member",
      createdAt: b.created_at,
      rolloverStartKey: b.rollover_start_key || ROLLOVER_START_KEY
    }))

    // Members per budget (relevant for standalone-shared budgets)
    const budgetMembers = {}
    if (budgetList.length) {
      const ids = budgetList.map(b => b.id)
      const { data: bms, error: e3 } = await supabaseClient
        .from("budget_members")
        .select("budget_id, user_id, display_email, role, joined_at")
        .in("budget_id", ids)
      if (e3) throw e3
      for (const bm of bms || []) {
        if (!budgetMembers[bm.budget_id]) budgetMembers[bm.budget_id] = []
        budgetMembers[bm.budget_id].push(bm)
      }
    }

    // Fetch the full shared history. Activity/Dashboard can still render the
    // active month, but older months must remain available for history/export.
    const transactions = {}
    if (budgetList.length) {
      const ids = budgetList.map(b => b.id)
      const { data: txs, error: e4 } = await supabaseClient
        .from("shared_transactions")
        .select("*")
        .in("budget_id", ids)
        .is("deleted_at", null)
        .order("occurred_on", { ascending: false })
      if (e4) throw e4
      for (const tx of txs || []) {
        if (!transactions[tx.budget_id]) transactions[tx.budget_id] = []
        transactions[tx.budget_id].push({
          id: tx.id,
          budgetId: tx.budget_id,
          createdBy: tx.created_by,
          createdByEmail: tx.created_by_email,
          amount: Number(tx.amount) || 0,
          description: tx.description || "",
          occurredOn: tx.occurred_on,
          monthKey: tx.month_key,
          createdAt: tx.created_at
        })
      }
    }

    // Pending invitations for me (matched by email, server-side via RLS)
    const pending = await sharedFetchPendingInvites()
    const visiblePending = pending.filter(p => !(app.shared.declinedInviteTokens || []).includes(p.token))

    app.shared.workspace = workspace
    app.shared.workspaceMembers = workspaceMembers
    app.shared.budgets = budgetList
    app.shared.budgetMembers = budgetMembers
    app.shared.transactions = transactions
    app.shared.pendingInvites = visiblePending
    app.shared.lastSyncedAt = Date.now()
    app.shared.syncing = false
    app.shared.error = null
    return true
  } catch (error) {
    app.shared.syncing = false
    app.shared.error = (error && error.message) ? error.message : String(error)
    console.warn("sharedFetchAll error", error)
    return false
  }
}

async function sharedCreateWorkspace(name) {
  if (!supabaseClient || !app.cloudUser) {
    toast("Sign in first")
    return null
  }
  const trimmed = String(name || "").trim() || "Shared"

  const { data: ws, error } = await supabaseClient
    .from("workspaces")
    .insert({ owner_id: app.cloudUser.id, name: trimmed })
    .select()
    .single()
  if (error) {
    toast(error.message || "Could not create workspace")
    return null
  }

  const { error: memErr } = await supabaseClient
    .from("workspace_members")
    .insert({
      workspace_id: ws.id,
      user_id: app.cloudUser.id,
      role: "owner",
      display_email: app.cloudEmail || null
    })
  if (memErr) {
    toast(memErr.message || "Workspace created but membership failed")
    return null
  }

  await sharedFetchAll()
  return ws
}

async function sharedCreateBudget(payload) {
  if (!supabaseClient || !app.cloudUser) {
    toast("Sign in first")
    return null
  }
  const row = {
    owner_id: app.cloudUser.id,
    workspace_id: payload.workspaceId || null,
    label: String(payload.label || "Budget").trim() || "Budget",
    icon: payload.icon || "🏷️",
    monthly_budget: Number(payload.monthlyBudget) || 0,
    color: payload.color || "#0F766E",
    rollover_start_key: payload.rolloverStartKey || ROLLOVER_START_KEY
  }
  const { data, error } = await supabaseClient
    .from("shared_budgets")
    .insert(row)
    .select()
    .single()
  if (error) {
    toast(error.message || "Could not create shared budget")
    return null
  }

  // For standalone-shared budgets, the owner needs a budget_members row so RLS
  // for shared_transactions read-checks pass without falling back to workspace
  if (!row.workspace_id) {
    await supabaseClient.from("budget_members").upsert({
      budget_id: data.id,
      user_id: app.cloudUser.id,
      role: "owner",
      display_email: app.cloudEmail || null
    }, { onConflict: "budget_id,user_id" })
  }

  await sharedFetchAll()
  return data
}

async function sharedUpdateBudget(budgetId, patch) {
  const { error } = await supabaseClient
    .from("shared_budgets")
    .update(patch)
    .eq("id", budgetId)
  if (error) {
    toast(error.message || "Could not update budget")
    return false
  }
  await sharedFetchAll()
  return true
}

async function sharedDeleteBudget(budgetId) {
  // Soft-delete: flip deleted_at instead of removing the row. Transactions
  // and members stay intact and can be restored within the grace window.
  const { error } = await supabaseClient
    .from("shared_budgets")
    .update({ deleted_at: new Date().toISOString() })
    .eq("id", budgetId)
  if (error) {
    toast(error.message || "Could not delete budget")
    return false
  }
  await sharedFetchAll()
  return true
}

async function sharedRestoreBudget(budgetId) {
  const { error } = await supabaseClient
    .from("shared_budgets")
    .update({ deleted_at: null })
    .eq("id", budgetId)
  if (error) {
    toast(error.message || "Could not restore budget")
    return false
  }
  await sharedFetchAll()
  return true
}

async function sharedConvertSharedToLocal(budgetId) {
  const budget = sharedBudgetById(budgetId)
  if (!budget) return false

  // Pull ALL transactions for this budget (not just current month) so nothing is lost
  const { data: txs, error: e1 } = await supabaseClient
    .from("shared_transactions")
    .select("*")
    .eq("budget_id", budgetId)
    .is("deleted_at", null)
  if (e1) {
    toast(e1.message || "Could not fetch transactions")
    return false
  }

  // Create or find a local budget with a unique slug derived from the label
  const localId = makeCatId(budget.label)
  app.data._settings.budgets.push({
    id: localId,
    label: budget.label,
    icon: budget.icon || "🏷️",
    budget: Number(budget.budget) || 0,
    color: budget.color || "#0F766E"
  })

  // Copy each shared transaction into the appropriate month bucket
  for (const tx of (txs || [])) {
    const mk = tx.month_key
    if (!Array.isArray(app.data[mk])) app.data[mk] = []
    const dateISO = isISODate(tx.occurred_on) ? tx.occurred_on : todayISO()
    app.data[mk].push({
      id: Date.now() + Math.floor(Math.random() * 1000000),
      cat: localId,
      amt: Math.abs(Number(tx.amount) || 0),
      desc: tx.description || "Expense",
      date: dateLabelFromISO(dateISO),
      dateISO
    })
  }
  saveData(app.data)

  // Soft-delete the shared budget on the server (other members lose access)
  await sharedDeleteBudget(budgetId)
  return true
}

async function sharedAddTransaction(budgetId, payload) {
  if (!supabaseClient || !app.cloudUser) {
    toast("Sign in first")
    return null
  }
  const amount = Math.abs(Number(payload.amount) || 0)
  if (!amount) {
    toast("Amount must be greater than zero")
    return null
  }
  const occurredOn = clampExpenseDateISO(payload.occurredOn)
  const mk = monthKeyFromISO(occurredOn)
  const row = {
    budget_id: budgetId,
    created_by: app.cloudUser.id,
    created_by_email: app.cloudEmail || null,
    amount,
    description: String(payload.description || "").trim() || "Expense",
    occurred_on: occurredOn,
    month_key: mk
  }
  const { data, error } = await supabaseClient
    .from("shared_transactions")
    .insert(row)
    .select()
    .single()
  if (error) {
    toast(error.message || "Could not add transaction")
    return null
  }
  await sharedFetchAll()
  return data
}

async function sharedUpdateTransaction(txId, patch) {
  const update = {}
  if ("amount" in patch) update.amount = Math.abs(Number(patch.amount) || 0)
  if ("description" in patch) update.description = String(patch.description || "").trim() || "Expense"
  if ("occurredOn" in patch) {
    const occurredOn = clampExpenseDateISO(patch.occurredOn)
    update.occurred_on = occurredOn
    update.month_key = monthKeyFromISO(occurredOn)
  }
  const { error } = await supabaseClient
    .from("shared_transactions")
    .update(update)
    .eq("id", txId)
  if (error) {
    toast(error.message || "Could not update transaction")
    return false
  }
  await sharedFetchAll()
  return true
}

async function sharedDeleteTransaction(txId) {
  const { data, error } = await supabaseClient
    .rpc("soft_delete_shared_transaction", { tx_id: txId })

  if (error || data === false) {
    toast(sharedPermissionMessage(error, "delete"))
    return false
  }

  await sharedFetchAll()
  return true
}

async function sharedRestoreTransaction(txId) {
  const { data, error } = await supabaseClient
    .rpc("restore_shared_transaction", { tx_id: txId })

  if (error || data === false) return false
  await sharedFetchAll()
  return true
}

function sharedPermissionMessage(error, action) {
  const message = error && error.message ? String(error.message) : ""
  if (/row-level security|not allowed|permission|policy/i.test(message)) {
    return `Only the person who added this expense or the budget owner can ${action} it.`
  }
  return message || `Could not ${action} transaction`
}

async function sharedLeaveWorkspace() {
  if (!app.shared.workspace) return false
  const { error } = await supabaseClient
    .from("workspace_members")
    .delete()
    .eq("workspace_id", app.shared.workspace.id)
    .eq("user_id", app.cloudUser.id)
  if (error) {
    toast(error.message || "Could not leave workspace")
    return false
  }
  await sharedFetchAll()
  return true
}

async function sharedLeaveBudget(budgetId) {
  const { error } = await supabaseClient
    .from("budget_members")
    .delete()
    .eq("budget_id", budgetId)
    .eq("user_id", app.cloudUser.id)
  if (error) {
    toast(error.message || "Could not leave budget")
    return false
  }
  await sharedFetchAll()
  return true
}

async function sharedRemoveMember(scope, scopeId, userId) {
  const table = scope === "workspace" ? "workspace_members" : "budget_members"
  const key = scope === "workspace" ? "workspace_id" : "budget_id"
  const { error } = await supabaseClient
    .from(table)
    .delete()
    .eq(key, scopeId)
    .eq("user_id", userId)
  if (error) {
    toast(error.message || "Could not remove member")
    return false
  }
  await sharedFetchAll()
  return true
}

async function sharedConvertLocalBudget(localBudgetId, options = {}) {
  if (!supabaseClient || !app.cloudUser) {
    toast("Sign in to share")
    return null
  }
  const localBudget = rawCategoryById(localBudgetId)
  if (!localBudget) return null

  // 1. Create the shared budget
  const target = options.target || "workspace"
  let workspaceId = null
  if (target === "workspace") {
    if (app.shared.workspace) {
      workspaceId = app.shared.workspace.id
    } else {
      const workspace = await sharedCreateWorkspace(options.workspaceName || "Shared")
      if (!workspace) return null
      workspaceId = workspace.id
    }
  }

  const sharedBudget = await sharedCreateBudget({
    workspaceId,
    label: localBudget.label,
    icon: localBudget.icon,
    monthlyBudget: localBudget.budget,
    color: localBudget.color,
    rolloverStartKey: ROLLOVER_START_KEY
  })
  if (!sharedBudget) return null

  // 2. Copy local transactions into shared_transactions
  const txInserts = []
  Object.keys(app.data).forEach(key => {
    if (key === "_settings" || !Array.isArray(app.data[key]) || !parseMonthKey(key)) return
    app.data[key].forEach(entry => {
      if (entry.cat !== localBudgetId) return
      const occurredISO = localEntryToISODate(entry, key)
      txInserts.push({
        budget_id: sharedBudget.id,
        created_by: app.cloudUser.id,
        created_by_email: app.cloudEmail || null,
        amount: Number(entry.amt) || 0,
        description: entry.desc || "Expense",
        occurred_on: occurredISO,
        month_key: monthKeyFromISO(occurredISO)
      })
    })
  })

  if (txInserts.length) {
    const { error: txError } = await supabaseClient.from("shared_transactions").insert(txInserts)
    if (txError) {
      // Best-effort: budget exists but tx copy failed. Surface the error and keep going.
      console.warn("Failed to copy local transactions", txError)
      toast("Budget shared, but some history could not be copied")
    }
  }

  // 3. Delete the local budget + its transactions
  app.data._settings.budgets = app.data._settings.budgets.filter(b => b.id !== localBudgetId)
  Object.keys(app.data).forEach(key => {
    if (key === "_settings" || !Array.isArray(app.data[key])) return
    app.data[key] = app.data[key].filter(entry => entry.cat !== localBudgetId)
  })
  app.data._settings.presets = app.data._settings.presets.filter(p => p.cat !== localBudgetId)
  app.data._settings.wishes = app.data._settings.wishes.filter(w => w.cat !== localBudgetId)
  saveData(app.data)

  await sharedFetchAll()
  return sharedBudget
}

async function inviteCreate(options = {}) {
  if (!supabaseClient || !app.cloudUser) {
    toast("Sign in first")
    return null
  }
  const token = randomInviteToken()
  const row = {
    token,
    inviter_id: app.cloudUser.id,
    inviter_email: app.cloudEmail || null,
    workspace_id: options.workspaceId || null,
    budget_id: options.budgetId || null,
    invitee_email: options.inviteeEmail ? String(options.inviteeEmail).trim().toLowerCase() : null,
    role: options.role || "member"
  }
  if (!row.workspace_id && !row.budget_id) {
    toast("Need a workspace or budget to share")
    return null
  }
  const { data, error } = await supabaseClient
    .from("invites")
    .insert(row)
    .select()
    .single()
  if (error) {
    toast(error.message || "Could not create invite")
    return null
  }
  return { token: data.token, url: inviteShareURL(data.token), invite: data }
}

function isLikelyEmail(value) {
  const s = String(value || "").trim()
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s)
}

async function inviteByEmail(options = {}) {
  if (!supabaseClient || !app.cloudUser) {
    toast("Sign in first")
    return null
  }
  const email = String(options.email || "").trim().toLowerCase()
  if (!isLikelyEmail(email)) {
    toast("That doesn't look like a valid email")
    return null
  }
  if (email === (app.cloudEmail || "").toLowerCase()) {
    toast("You can't invite yourself")
    return null
  }
  const result = await inviteCreate({
    workspaceId: options.workspaceId || null,
    budgetId: options.budgetId || null,
    role: options.role || "member",
    inviteeEmail: email
  })
  if (!result) return null
  return result
}

async function sharedFetchPendingInvites() {
  if (!supabaseClient || !app.cloudUser || !app.cloudEmail) return []
  const lower = String(app.cloudEmail).toLowerCase()
  const { data, error } = await supabaseClient
    .from("invites")
    .select("token, inviter_id, inviter_email, workspace_id, budget_id, role, expires_at, used_at, invitee_email, workspaces(id, name), shared_budgets(id, label, icon)")
    .is("used_at", null)
    .gt("expires_at", new Date().toISOString())
    .ilike("invitee_email", lower)
  if (error) {
    console.warn("sharedFetchPendingInvites error", error)
    return []
  }
  return (data || []).map(inv => ({
    token: inv.token,
    inviterEmail: inv.inviter_email,
    workspaceId: inv.workspace_id,
    budgetId: inv.budget_id,
    workspaceName: inv.workspaces && inv.workspaces.name,
    budgetLabel: inv.shared_budgets && inv.shared_budgets.label,
    role: inv.role,
    expiresAt: inv.expires_at
  }))
}

async function sharedFetchOutgoingInvites(scope) {
  if (!supabaseClient || !app.cloudUser) return []
  let query = supabaseClient
    .from("invites")
    .select("token, invitee_email, role, expires_at, used_at, used_by, workspace_id, budget_id, created_at")
    .eq("inviter_id", app.cloudUser.id)
    .is("used_at", null)
    .gt("expires_at", new Date().toISOString())
    .order("created_at", { ascending: false })
  if (scope && scope.workspaceId) query = query.eq("workspace_id", scope.workspaceId)
  if (scope && scope.budgetId) query = query.eq("budget_id", scope.budgetId)
  const { data, error } = await query
  if (error) {
    console.warn("sharedFetchOutgoingInvites error", error)
    return []
  }
  return data || []
}

async function inviteRevoke(token) {
  if (!supabaseClient || !app.cloudUser) return false
  const { error } = await supabaseClient.from("invites").delete().eq("token", token)
  if (error) {
    toast(error.message || "Could not revoke invite")
    return false
  }
  return true
}

async function inviteFetch(token) {
  if (!supabaseClient) return null
  const { data, error } = await supabaseClient
    .from("invites")
    .select("token, inviter_id, inviter_email, workspace_id, budget_id, role, expires_at, used_at, workspaces(id, name), shared_budgets(id, label, icon)")
    .eq("token", token)
    .maybeSingle()
  if (error || !data) return null
  return data
}

async function inviteAccept(token) {
  if (!supabaseClient || !app.cloudUser) {
    toast("Sign in to accept")
    return null
  }
  const invite = await inviteFetch(token)
  if (!invite) {
    toast("Invite not found")
    return null
  }
  if (invite.used_at) {
    toast("Invite already used")
    return null
  }
  if (invite.expires_at && new Date(invite.expires_at) < new Date()) {
    toast("Invite expired")
    return null
  }
  if (invite.inviter_id === app.cloudUser.id) {
    toast("You created this invite")
    return null
  }

  // Insert membership row
  if (invite.workspace_id) {
    const { error: e1 } = await supabaseClient
      .from("workspace_members")
      .upsert({
        workspace_id: invite.workspace_id,
        user_id: app.cloudUser.id,
        role: invite.role || "member",
        display_email: app.cloudEmail || null
      }, { onConflict: "workspace_id,user_id" })
    if (e1) {
      toast(e1.message || "Could not join workspace")
      return null
    }
  } else if (invite.budget_id) {
    const { error: e2 } = await supabaseClient
      .from("budget_members")
      .upsert({
        budget_id: invite.budget_id,
        user_id: app.cloudUser.id,
        role: invite.role || "member",
        display_email: app.cloudEmail || null
      }, { onConflict: "budget_id,user_id" })
    if (e2) {
      toast(e2.message || "Could not join budget")
      return null
    }
  }

  // Mark invite used
  await supabaseClient
    .from("invites")
    .update({ used_at: new Date().toISOString(), used_by: app.cloudUser.id })
    .eq("token", token)

  await sharedFetchAll()
  return invite
}

async function manualRefresh() {
  if (!supabaseClient || !app.cloudUser) {
    haptic("warning")
    toast("Sign in to sync")
    return
  }
  app.shared.syncing = true
  refreshCloudSurface()
  render()
  const ok = await sharedFetchAll()
  app.shared.syncing = false
  render()
  if (ok) {
    haptic("success")
    toast("Synced")
  } else {
    haptic("error")
    toast("Sync failed")
  }
}

function monthKey(date = new Date()) {
  return `${date.getFullYear()}-${date.getMonth()}`
}

function parseMonthKey(key) {
  const match = String(key || "").match(/^(\d{4})-(\d{1,2})$/)
  if (!match) return null

  const year = Number(match[1])
  const month = Number(match[2])

  if (!Number.isInteger(year) || !Number.isInteger(month)) return null
  if (month < 0 || month > 11) return null

  return { year, month }
}

function compareMonthKeys(a, b) {
  const pa = parseMonthKey(a)
  const pb = parseMonthKey(b)
  if (!pa && !pb) return 0
  if (!pa) return -1
  if (!pb) return 1
  return (pa.year * 12 + pa.month) - (pb.year * 12 + pb.month)
}

function monthLabel(key) {
  const parsed = parseMonthKey(key)
  const date = parsed ? new Date(parsed.year, parsed.month, 1) : new Date()
  return date.toLocaleDateString("en-US", { month: "long", year: "numeric" })
    .replace(/^\w/, c => c.toUpperCase())
}

function getTrackedMonthKeys(data) {
  data = ensureDataShape(data)

  const fromEntries = Object.keys(data)
    .filter(k => k !== "_settings" && parseMonthKey(k) && Array.isArray(data[k]))

  const fromActiveMonths = Array.isArray(data._settings.activeMonthKeys)
    ? data._settings.activeMonthKeys.filter(k => parseMonthKey(k))
    : []

  return [...fromEntries, ...fromActiveMonths]
    .filter((k, i, arr) => arr.indexOf(k) === i)
    .sort(compareMonthKeys)
}

function markActiveMonth(data, key) {
  data = ensureDataShape(data)
  if (!parseMonthKey(key)) return false
  if (!Array.isArray(data._settings.activeMonthKeys)) data._settings.activeMonthKeys = []
  if (data._settings.activeMonthKeys.includes(key)) return false
  data._settings.activeMonthKeys.push(key)
  data._settings.activeMonthKeys = data._settings.activeMonthKeys.sort(compareMonthKeys)
  return true
}

function getSpentForMonth(data, key, ids) {
  const spent = {}
  ids.forEach(id => { spent[id] = 0 })
  const entries = Array.isArray(data[key]) ? data[key] : []

  entries.forEach(entry => {
    const cat = String(entry.cat || "")
    if (!cat) return
    spent[cat] = (spent[cat] || 0) + (Number(entry.amt) || 0)
  })

  return spent
}

function calcRolloverMap(data, key, rawBudgets) {
  data = ensureDataShape(data)
  const budgets = Array.isArray(rawBudgets) ? rawBudgets : data._settings.budgets
  return budgets.reduce((carry, budget) => {
    carry[budget.id] = 0
    return carry
  }, {})
}

function calcState(data, key) {
  data = ensureDataShape(data)
  const rawBudgets = data._settings.budgets
  const rolloverMap = calcRolloverMap(data, key, rawBudgets)
  const localEntries = Array.isArray(data[key]) ? data[key] : []

  const localBudgets = rawBudgets.map(b => {
    const baseBudget = Number(b.budget) || 0
    const rollover = roundMoney(rolloverMap[b.id] || 0)
    return {
      id: b.id,
      label: b.label,
      icon: b.icon,
      color: b.color,
      baseBudget,
      rollover,
      budget: roundMoney(baseBudget + rollover),
      shared: false,
      myRole: "owner",
      members: []
    }
  })

  const sharedBudgets = (app.shared.budgets || []).map(b => {
    const baseBudget = Number(b.budget) || 0
    const allMembers = b.workspaceId
      ? app.shared.workspaceMembers
      : (app.shared.budgetMembers[b.id] || [])
    return {
      id: b.id,
      label: b.label,
      icon: b.icon,
      color: b.color,
      baseBudget,
      rollover: 0,
      budget: baseBudget,
      shared: true,
      myRole: b.myRole,
      ownerId: b.ownerId,
      workspaceId: b.workspaceId,
      members: allMembers
    }
  })

  const budgets = [...localBudgets, ...sharedBudgets]

  const shapeLocalEntry = (e, idx, monthKeyValue) => {
    const occurredOn = localEntryToISODate(e, monthKeyValue)
    return {
      id: String(e.id),
      cat: e.cat,
      amt: Number(e.amt) || 0,
      desc: e.desc || "Expense",
      date: dateLabelFromISO(occurredOn),
      dateISO: occurredOn,
      occurredOn,
      monthKey: monthKeyValue,
      insertOrder: idx,
      shared: false
    }
  }

  const localEntriesShaped = localEntries.map((e, idx) => shapeLocalEntry(e, idx, key))
  const allLocalEntriesShaped = getTrackedMonthKeys(data).flatMap(month => {
    const list = Array.isArray(data[month]) ? data[month] : []
    return list.map((entry, idx) => shapeLocalEntry(entry, idx, month))
  })

  const sharedEntriesShaped = []
  const allSharedEntriesShaped = []
  for (const b of sharedBudgets) {
    const txs = app.shared.transactions[b.id] || []
    for (const tx of txs) {
      const dateLabel = tx.occurredOn
        ? dateLabelFromISO(tx.occurredOn)
        : ""
      const shapedTx = {
        id: tx.id,
        cat: b.id,
        amt: tx.amount,
        desc: tx.description,
        date: dateLabel,
        dateISO: tx.occurredOn || "",
        createdBy: tx.createdBy,
        createdByEmail: tx.createdByEmail,
        occurredOn: tx.occurredOn || "",
        monthKey: tx.monthKey || "",
        insertOrder: 0,
        shared: true
      }
      allSharedEntriesShaped.push(shapedTx)
      if (tx.monthKey === key) sharedEntriesShaped.push(shapedTx)
    }
  }

  const entries = [...localEntriesShaped, ...sharedEntriesShaped]
  const allEntries = [...allLocalEntriesShaped, ...allSharedEntriesShaped]

  const spent = {}
  budgets.forEach(b => { spent[b.id] = 0 })
  entries.forEach(entry => {
    const cat = entry.cat || "uncategorized"
    spent[cat] = (spent[cat] || 0) + (Number(entry.amt) || 0)
  })

  return {
    budgets,
    presets: data._settings.presets,
    wishes: data._settings.wishes,
    entries,
    allEntries,
    spent,
    monthKey: key
  }
}

function makeSlug(label, fallback, exists) {
  let base = String(label || fallback)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")

  if (!base) base = fallback

  let id = base
  let n = 2
  while (exists(id)) {
    id = `${base}_${n}`
    n++
  }

  return id
}

function makeCatId(label) {
  return makeSlug(label, "cat", id => app.data._settings.budgets.some(b => b.id === id))
}

function makePresetId(desc) {
  let base = makeSlug(desc, "preset", () => false)
  if (!base.startsWith("preset_")) base = "preset_" + base
  return makeSlug(base, "preset", id => app.data._settings.presets.some(p => p.id === id))
}

function makeWishId(desc) {
  let base = makeSlug(desc, "wish", () => false)
  if (!base.startsWith("wish_")) base = "wish_" + base
  return makeSlug(base, "wish", id => app.data._settings.wishes.some(w => w.id === id))
}

function todayLabel() {
  return dateLabelFromISO(todayISO())
}

function categoryById(id) {
  return app.state.budgets.find(b => b.id === id)
}

function rawCategoryById(id) {
  return app.data._settings.budgets.find(b => b.id === id)
}

function entryById(id) {
  // Local entries use numeric ids, shared use UUIDs — match on string for both
  const target = String(id)
  const inAll = (app.state && app.state.allEntries) ? app.state.allEntries.find(e => String(e.id) === target) : null
  if (inAll) return inAll
  const inMerged = (app.state && app.state.entries) ? app.state.entries.find(e => String(e.id) === target) : null
  if (inMerged) return inMerged
  for (const month of getTrackedMonthKeys(app.data)) {
    const found = (app.data[month] || []).find(entry => String(entry.id) === target)
    if (found) {
      const dateISO = localEntryToISODate(found, month)
      return {
        ...found,
        date: dateLabelFromISO(dateISO),
        dateISO,
        occurredOn: dateISO,
        monthKey: month,
        shared: false
      }
    }
  }
  return null
}

function presetById(id) {
  return app.data._settings.presets.find(preset => preset.id === id)
}

function wishById(id) {
  return app.data._settings.wishes.find(wish => wish.id === id)
}

function getBudgetHealth(totalBudget, totalSpent, spent) {
  const entries = app.state.entries || []

  if (!entries.length || totalSpent <= 0) {
    return { text: "No spending yet this month", color: "var(--mut)", bg: "var(--card)", border: "var(--bord)" }
  }

  const cats = app.state.budgets
    .map(b => {
      const used = Number(spent[b.id]) || 0
      const budget = Number(b.budget) || 0
      return {
        label: b.label,
        icon: b.icon,
        spent: used,
        budget,
        over: used - budget,
        pct: budget > 0 ? (used / budget) * 100 : 999
      }
    })
    .filter(x => x.budget !== 0 || x.spent > 0)

  const worstOver = cats.filter(x => x.over > 0).sort((a, b) => b.over - a.over)[0]
  if (worstOver) {
    return {
      text: worstOver.icon + " " + worstOver.label + " is over by " + fmt(worstOver.over),
      color: "var(--red)",
      bg: "#FFF1F2",
      border: "#FCA5A5"
    }
  }

  const warning = cats.filter(x => x.pct >= 80).sort((a, b) => b.pct - a.pct)[0]
  if (warning) {
    return {
      text: warning.icon + " " + warning.label + " is at " + Math.round(warning.pct) + "%",
      color: "var(--amb)",
      bg: "#FFFBEB",
      border: "#FCD34D"
    }
  }

  const globalPct = totalBudget > 0 ? (totalSpent / totalBudget) * 100 : 0
  if (globalPct <= 35) return { text: "Great pace this month", color: "var(--grn)", bg: "#ECFDF5", border: "#A7F3D0" }
  if (globalPct <= 70) return { text: "On track this month", color: "var(--acc)", bg: "var(--acc2)", border: "#9AD8CF" }
  return { text: "Close to the monthly limit", color: "var(--amb)", bg: "#FFFBEB", border: "#FCD34D" }
}

function syncState() {
  app.state = calcState(app.data, app.key)

  if (!app.newPresetCat || !categoryById(app.newPresetCat)) {
    app.newPresetCat = app.state.budgets[0] ? app.state.budgets[0].id : null
  }

  if (!app.newWishCat || !categoryById(app.newWishCat)) {
    app.newWishCat = app.state.budgets[0] ? app.state.budgets[0].id : null
  }
}

const ICON_PATHS = {
  dashboard: '<path d="M3 11.5 12 4l9 7.5"/><path d="M5 10.5V20h14v-9.5"/><path d="M9 20v-6h6v6"/>',
  add: '<path d="M12 5v14"/><path d="M5 12h14"/>',
  activity: '<path d="M7 3h10l2 2v16H5V5l2-2Z"/><path d="M9 8h6"/><path d="M9 12h6"/><path d="M9 16h4"/>',
  account: '<path d="M20 21a8 8 0 0 0-16 0"/><path d="M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z"/>',
  cloud: '<path d="M17.5 18H8a5 5 0 1 1 1-9.9A6.5 6.5 0 0 1 21 11.5 3.5 3.5 0 0 1 17.5 18Z"/>',
  grid: '<path d="M4 4h6v6H4z"/><path d="M14 4h6v6h-6z"/><path d="M4 14h6v6H4z"/><path d="M14 14h6v6h-6z"/>',
  heart: '<path d="M20.8 5.6a5.2 5.2 0 0 0-7.4 0L12 7l-1.4-1.4a5.2 5.2 0 1 0-7.4 7.4L12 21l8.8-8a5.2 5.2 0 0 0 0-7.4Z"/>',
  download: '<path d="M12 3v12"/><path d="m7 10 5 5 5-5"/><path d="M5 21h14"/>',
  upload: '<path d="M12 21V9"/><path d="m7 14 5-5 5 5"/><path d="M5 3h14"/>',
  trash: '<path d="M4 7h16"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M6 7l1 14h10l1-14"/><path d="M9 7V4h6v3"/>',
  edit: '<path d="M4 20h4l10.5-10.5a2.8 2.8 0 0 0-4-4L4 16v4Z"/><path d="m13.5 6.5 4 4"/>',
  close: '<path d="M6 6l12 12"/><path d="M18 6 6 18"/>',
  back: '<path d="m15 18-6-6 6-6"/>',
  settings: '<path d="M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Z"/><path d="M19.4 15a1.8 1.8 0 0 0 .36 2l.05.05a2.1 2.1 0 0 1-3 3l-.05-.05a1.8 1.8 0 0 0-2-.36 1.8 1.8 0 0 0-1.1 1.65V21a2.1 2.1 0 0 1-4.2 0v-.07a1.8 1.8 0 0 0-1.1-1.65 1.8 1.8 0 0 0-2 .36l-.05.05a2.1 2.1 0 0 1-3-3l.05-.05a1.8 1.8 0 0 0 .36-2 1.8 1.8 0 0 0-1.65-1.1H2a2.1 2.1 0 0 1 0-4.2h.07a1.8 1.8 0 0 0 1.65-1.1 1.8 1.8 0 0 0-.36-2l-.05-.05a2.1 2.1 0 0 1 3-3l.05.05a1.8 1.8 0 0 0 2 .36 1.8 1.8 0 0 0 1.1-1.65V2a2.1 2.1 0 0 1 4.2 0v.07a1.8 1.8 0 0 0 1.1 1.65 1.8 1.8 0 0 0 2-.36l.05-.05a2.1 2.1 0 0 1 3 3l-.05.05a1.8 1.8 0 0 0-.36 2 1.8 1.8 0 0 0 1.65 1.1H22a2.1 2.1 0 0 1 0 4.2h-.07a1.8 1.8 0 0 0-1.65 1.1Z"/>',
  check: '<path d="m20 6-11 11-5-5"/>',
  wallet: '<path d="M4 7a3 3 0 0 1 3-3h11v16H6a2 2 0 0 1-2-2V7Z"/><path d="M4 8h15"/><path d="M16 13h2"/>',
  file: '<path d="M7 3h7l5 5v13H7V3Z"/><path d="M14 3v5h5"/><path d="M9 14h6"/><path d="M9 17h6"/>',
  chevron: '<path d="m9 18 6-6-6-6"/>',
  bell: '<path d="M6 8a6 6 0 1 1 12 0c0 7 3 8 3 8H3s3-1 3-8Z"/><path d="M10 21a2 2 0 0 0 4 0"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 8h.01"/><path d="M11 12h1v4h1"/>',
  shield: '<path d="M12 3 4 6v6c0 5 4 8 8 9 4-1 8-4 8-9V6l-8-3Z"/>',
  sparkles: '<path d="M12 4v4"/><path d="M12 16v4"/><path d="M4 12h4"/><path d="M16 12h4"/><path d="m6 6 2 2"/><path d="m16 16 2 2"/><path d="m6 18 2-2"/><path d="m16 8 2-2"/>',
  users: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
  share: '<circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><path d="m8.59 13.51 6.83 3.98"/><path d="m15.41 6.51-6.82 3.98"/>',
  link: '<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>',
  refresh: '<path d="M3 12a9 9 0 0 1 15-6.7L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-15 6.7L3 16"/><path d="M3 21v-5h5"/>',
  copy: '<rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>',
  doorOut: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="M16 17l5-5-5-5"/><path d="M21 12H9"/>',
  spreadsheet: '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18"/><path d="M3 15h18"/><path d="M9 3v18"/><path d="M15 3v18"/>',
  phonePlus: '<rect x="5" y="2" width="14" height="20" rx="3"/><path d="M12 10v6"/><path d="M9 13h6"/>'
}

const ICON_PICKER_GROUPS = [
  ["Frequent", [
    ["💵", "Cash", "money dollars income"], ["💳", "Card", "credit debit payment"], ["🧾", "Receipt", "bill invoice expense"], ["🏷️", "Extras", "other misc tag"],
    ["➕", "Other", "add plus miscellaneous"], ["🎯", "Goal", "target savings objective"], ["🔁", "Repeat", "recurring subscription"], ["🪙", "Coins", "change cash"]
  ]],
  ["Food & Drink", [
    ["☕", "Coffee", "cafe espresso starbucks"], ["🍽", "Restaurants", "dinner lunch food"], ["🛒", "Groceries", "supermarket market"], ["🍔", "Fast food", "burger takeout"],
    ["🥗", "Healthy food", "salad"], ["🍕", "Pizza", "slice"], ["🍣", "Sushi", "japanese"], ["🧋", "Drinks", "boba tea"],
    ["🍩", "Sweets", "dessert donut"], ["🍞", "Bakery", "bread"], ["🍺", "Bar", "beer drinks"], ["🥘", "Meals", "cooking dinner"]
  ]],
  ["Transport", [
    ["🚗", "Car", "auto vehicle"], ["🚕", "Taxi", "uber lyft cab"], ["⛽", "Gas", "fuel"], ["🅿️", "Parking", "garage"],
    ["🚌", "Bus", "transit"], ["🚆", "Train", "metro subway"], ["✈️", "Flights", "airplane travel"], ["🛵", "Scooter", "moped"],
    ["🚲", "Bike", "bicycle"], ["🛞", "Tires", "maintenance repair"], ["🧰", "Car repair", "mechanic tools"], ["🧼", "Car wash", "cleaning"]
  ]],
  ["Shopping", [
    ["📦", "Online shopping", "amazon package"], ["🛍", "Shopping", "bags mall"], ["👕", "Clothes", "shirt apparel"], ["👟", "Shoes", "sneakers"],
    ["💄", "Beauty", "makeup cosmetics"], ["💻", "Computer", "laptop electronics"], ["📱", "Phone", "mobile device"], ["🎮", "Games", "gaming console"],
    ["🎁", "Gifts", "present"], ["🧸", "Toys", "kids"], ["🏷️", "Deals", "discount sale"], ["🛠", "Hardware", "tools"]
  ]],
  ["Home", [
    ["🏠", "Home", "rent mortgage house"], ["🛋", "Furniture", "sofa"], ["🛏", "Bedroom", "bed"], ["🧺", "Laundry", "clothes wash"],
    ["🧼", "Cleaning", "soap supplies"], ["💡", "Electricity", "power light"], ["🚿", "Water", "shower utility"], ["🔥", "Gas", "heat utility"],
    ["🧰", "Repairs", "maintenance tools"], ["🌱", "Garden", "plants yard"], ["📦", "Storage", "boxes moving"], ["🔑", "Rent fee", "key lease"]
  ]],
  ["Bills", [
    ["🧾", "Bills", "utilities invoice"], ["📱", "Phone plan", "cell mobile"], ["🌐", "Internet", "wifi web"], ["🎬", "Streaming", "netflix movies"],
    ["🎵", "Music", "spotify audio"], ["📰", "News", "subscription"], ["☁️", "Software", "saas cloud"], ["🛡", "Insurance", "protection"],
    ["🏦", "Bank", "account fee"], ["💳", "Credit card", "debt payment"], ["📮", "Mail", "shipping postage"], ["🧮", "Taxes", "accounting"]
  ]],
  ["Health", [
    ["💊", "Pharmacy", "medicine"], ["🩺", "Doctor", "health medical"], ["🦷", "Dentist", "teeth"], ["👓", "Vision", "glasses"],
    ["🧴", "Personal care", "lotion hygiene"], ["🏋️", "Gym", "fitness weights"], ["🧘", "Wellness", "mindfulness"], ["🍎", "Nutrition", "diet"],
    ["🧪", "Lab", "tests"], ["🚑", "Emergency", "urgent medical"], ["🩹", "Care", "bandage"], ["💈", "Haircut", "barber salon"]
  ]],
  ["Work", [
    ["💼", "Work", "business office"], ["📈", "Growth", "chart"], ["🧠", "Learning", "ideas"], ["🛠", "Tools", "software hardware"],
    ["⚙️", "Operations", "settings"], ["🧾", "Invoices", "client billing"], ["📚", "Books", "education"], ["🧪", "Experiments", "testing lab"],
    ["🖥", "Desk setup", "monitor"], ["🖨", "Printing", "printer"], ["👨‍💻", "Developer", "coding api"], ["🎙", "Content", "podcast microphone"]
  ]],
  ["Travel & Fun", [
    ["🧳", "Travel", "luggage trip"], ["🏨", "Hotel", "stay"], ["🗺", "Tours", "map"], ["🎟", "Tickets", "events"],
    ["🎬", "Movies", "cinema"], ["🎵", "Music", "concert"], ["🎨", "Art", "creative"], ["📷", "Photos", "camera"],
    ["🏖", "Vacation", "beach"], ["⛳", "Sports", "golf game"], ["🎲", "Games", "board"], ["🕹", "Arcade", "play"]
  ]],
  ["Personal", [
    ["🎓", "Education", "school course"], ["👶", "Kids", "children family"], ["🎂", "Birthday", "celebration"], ["💐", "Flowers", "gift"],
    ["❤️", "Love", "date relationship"], ["🫶", "Giving", "support"], ["🙏", "Donations", "charity"], ["✂️", "Haircut", "salon"],
    ["🧵", "Tailor", "sewing"], ["🧳", "Personal", "life"], ["📌", "Important", "pin"], ["🗓", "Plans", "calendar"]
  ]],
  ["Money & Goals", [
    ["💰", "Savings", "save money"], ["🏦", "Bank", "financial"], ["📊", "Investing", "stocks chart"], ["📉", "Losses", "down chart"],
    ["📌", "Reserve", "hold"], ["🚨", "Emergency fund", "urgent"], ["🎯", "Goal", "target"], ["🐷", "Piggy bank", "savings"],
    ["🪙", "Coins", "cash"], ["💸", "Spending", "money out"], ["🧮", "Budget", "calculator"], ["📅", "Monthly", "calendar"]
  ]],
  ["Symbols", [
    ["⚡", "Quick", "fast"], ["✨", "Misc", "sparkle"], ["🌟", "Treat", "star"], ["✅", "Done", "check"],
    ["📍", "Location", "pin"], ["🔒", "Secure", "lock"], ["🔔", "Reminder", "bell"], ["🧲", "Supplies", "magnet"],
    ["🔧", "Fix", "repair"], ["💬", "Messages", "chat"], ["📎", "Attachment", "clip"], ["❓", "Unknown", "question"]
  ]]
]

function icon(name, label = "", className = "") {
  const body = ICON_PATHS[name] || ICON_PATHS.dashboard
  const aria = label ? `role="img" aria-label="${attr(label)}"` : 'aria-hidden="true"'
  return `<span class="ui-icon ${className}" ${aria}><svg viewBox="0 0 24 24" focusable="false">${body}</svg></span>`
}

const HAPTIC_PATTERNS = {
  tap: 6,
  light: 8,
  medium: 14,
  heavy: 22,
  success: [10, 28, 10],
  warning: [16, 36, 16],
  error: [22, 48, 22, 48, 22],
  selection: 4
}

function haptic(type = "light") {
  if (!("vibrate" in navigator)) return
  const pattern = HAPTIC_PATTERNS[type] || HAPTIC_PATTERNS.light
  try { navigator.vibrate(pattern) } catch (_) {}
}

function confirmSheet(options = {}) {
  const config = {
    title: String(options.title || "Are you sure?"),
    body: String(options.body || ""),
    primaryLabel: String(options.primaryLabel || (options.destructive ? "Delete" : "Confirm")),
    cancelLabel: String(options.cancelLabel || "Cancel"),
    destructive: !!options.destructive,
    onConfirm: typeof options.onConfirm === "function" ? options.onConfirm : () => {},
    onCancel: typeof options.onCancel === "function" ? options.onCancel : null
  }

  app.confirmConfig = config
  app.modal = "confirm"
  haptic(config.destructive ? "warning" : "light")
  renderModal()
}

function resolveConfirm(accepted) {
  const config = app.confirmConfig
  if (!config) return closeModal()

  app.confirmConfig = null
  app.modal = null
  renderModal()

  if (accepted) {
    try { config.onConfirm() } catch (_) {}
  } else if (config.onCancel) {
    try { config.onCancel() } catch (_) {}
  }
}

function renderConfirmModal() {
  const config = app.confirmConfig
  if (!config) return ""
  const primaryClass = config.destructive ? "danger-btn" : "primary-btn"
  return `
    <div class="sheet confirm-sheet" role="alertdialog" aria-modal="true" aria-label="${attr(config.title)}">
      <div class="confirm-head">
        <div class="confirm-title">${esc(config.title)}</div>
        ${config.body ? `<div class="confirm-body">${esc(config.body)}</div>` : ""}
      </div>
      <div class="confirm-actions">
        <button class="secondary-btn" data-action="confirmNo">${esc(config.cancelLabel)}</button>
        <button class="${primaryClass}" data-action="confirmYes" autofocus>${esc(config.primaryLabel)}</button>
      </div>
    </div>
  `
}

function tickNumber(node, fromValue, toValue, options = {}) {
  if (!node) return
  const from = Number(fromValue) || 0
  const to = Number(toValue) || 0
  const duration = Number(options.duration) || 520
  const formatter = typeof options.format === "function" ? options.format : v => fmt(v)

  if (window.matchMedia && window.matchMedia("(prefers-reduced-motion:reduce)").matches) {
    node.textContent = formatter(to)
    return
  }

  const start = performance.now()
  const delta = to - from
  if (node.__tickToken) cancelAnimationFrame(node.__tickToken)

  const step = now => {
    const t = Math.min(1, (now - start) / duration)
    const eased = 1 - Math.pow(1 - t, 3)
    const current = from + delta * eased
    node.textContent = formatter(current)
    if (t < 1) {
      node.__tickToken = requestAnimationFrame(step)
    } else {
      node.__tickToken = null
    }
  }

  node.__tickToken = requestAnimationFrame(step)
}

let __undoToastTimer = null
let __activeUndo = null

function undoToast(message, onUndo, options = {}) {
  if (!toastEl) return
  const duration = Number(options.duration) || 5000

  if (__activeUndo) {
    try { __activeUndo.commit() } catch (_) {}
  }

  __activeUndo = {
    commit: typeof options.onExpire === "function" ? options.onExpire : () => {}
  }

  toastEl.classList.add("show", "undo")
  toastEl.innerHTML = `<span class="toast-text">${esc(message)}</span><button class="toast-undo" data-action="undoLast">Undo</button>`
  toastEl.dataset.kind = "undo"

  clearTimeout(__undoToastTimer)
  __undoToastTimer = setTimeout(() => {
    const commitFn = __activeUndo && __activeUndo.commit
    __activeUndo = null
    toastEl.classList.remove("show", "undo")
    toastEl.removeAttribute("data-kind")
    toastEl.textContent = ""
    if (commitFn) {
      try { commitFn() } catch (_) {}
    }
  }, duration)

  toastEl.__undoCallback = () => {
    clearTimeout(__undoToastTimer)
    __activeUndo = null
    toastEl.classList.remove("show", "undo")
    toastEl.removeAttribute("data-kind")
    toastEl.textContent = ""
    if (typeof onUndo === "function") {
      try { onUndo() } catch (_) {}
    }
    haptic("light")
  }
}

function applyTheme(theme) {
  const safe = ["auto", "light", "dark"].includes(theme) ? theme : "auto"
  app.theme = safe
  const root = document.documentElement
  if (safe === "auto") root.removeAttribute("data-theme")
  else root.setAttribute("data-theme", safe)
  try { localStorage.setItem("budget_tracker_theme", safe) } catch (_) {}
  const meta = document.querySelector('meta[name="theme-color"]')
  if (meta) {
    const effectiveDark = safe === "dark" || (safe === "auto" && window.matchMedia && window.matchMedia("(prefers-color-scheme:dark)").matches)
    meta.setAttribute("content", effectiveDark ? "#0E1117" : "#F6F8FA")
  }
}

function cycleTheme() {
  const order = ["auto", "light", "dark"]
  const next = order[(order.indexOf(app.theme) + 1) % order.length]
  applyTheme(next)
  haptic("selection")
  toast(`Theme: ${next}`)
  render()
}

try {
  const stored = localStorage.getItem("budget_tracker_theme")
  if (stored) applyTheme(stored)
  else applyTheme("auto")
} catch (_) { applyTheme("auto") }

if (window.matchMedia) {
  const mq = window.matchMedia("(prefers-color-scheme:dark)")
  const onChange = () => {
    if (app.theme === "auto") applyTheme("auto")
  }
  if (mq.addEventListener) mq.addEventListener("change", onChange)
  else if (mq.addListener) mq.addListener(onChange)
}

function secondaryBackView(defaultView = "account") {
  const secondaryViews = ["cats", "presets", "wishes", "review"]
  return app.returnView && !secondaryViews.includes(app.returnView) ? app.returnView : defaultView
}

function iconPickerValue(target) {
  if (target === "category") return app.drafts.category.icon || "🏷️"
  if (target === "budgetEdit") return app.drafts.budgetEdit.icon || "🏷️"
  if (target === "preset") return app.drafts.preset.icon || "⚡"
  if (target === "presetEdit") return app.drafts.presetEdit.icon || "⚡"
  if (target === "wish") return app.drafts.wish.icon || "✨"
  if (target === "wishEdit") return app.drafts.wishEdit.icon || "✨"
  return "✨"
}

function iconPickerButton(target) {
  const value = iconPickerValue(target)
  return `
    <button class="icon-picker-btn" type="button" aria-label="Change icon" title="Change icon" data-action="openIconPicker" data-target="${attr(target)}">
      <span class="icon-picker-preview">${esc(value)}</span>
      <span class="sr-only">Change icon</span>
    </button>
  `
}

function normalizeIconSearch(value) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
}

function iconChoiceValue(choice) {
  return Array.isArray(choice) ? choice[0] : choice.value
}

function iconChoiceLabel(choice) {
  return Array.isArray(choice) ? choice[1] : choice.label
}

function iconChoiceKeywords(choice) {
  return Array.isArray(choice) ? choice[2] || "" : choice.keywords || ""
}

function filteredIconGroups() {
  const query = normalizeIconSearch(app.iconPickerQuery)
  if (!query) return ICON_PICKER_GROUPS

  return ICON_PICKER_GROUPS
    .map(([group, choices]) => {
      const groupText = normalizeIconSearch(group)
      const filtered = choices.filter(choice => {
        const text = normalizeIconSearch([
          groupText,
          iconChoiceValue(choice),
          iconChoiceLabel(choice),
          iconChoiceKeywords(choice)
        ].join(" "))
        return text.includes(query)
      })
      return [group, filtered]
    })
    .filter(([, choices]) => choices.length)
}

function settingsChevron() {
  return `<span class="settings-row-chevron" aria-hidden="true"><svg viewBox="0 0 8 14"><path d="M1 1l5 6-5 6"/></svg></span>`
}

function settingsRow(options = {}) {
  const action = options.action ? `data-action="${attr(options.action)}"` : ""
  const view = options.view ? `data-view="${attr(options.view)}"` : ""
  const id = options.id ? `data-id="${attr(options.id)}"` : ""
  const step = options.step !== undefined ? `data-step="${attr(options.step)}"` : ""
  const tint = options.tint ? `tint-${attr(options.tint)}` : ""
  const iconHtml = options.emoji
    ? `<span class="settings-row-icon ${tint}">${esc(options.emoji)}</span>`
    : `<span class="settings-row-icon ${tint}">${icon(options.icon || "settings")}</span>`
  const right = options.value
    ? `<span class="settings-row-side"><span>${esc(options.value)}</span>${options.action ? settingsChevron() : ""}</span>`
    : options.action ? settingsChevron() : ""
  return `
    <button class="settings-row" ${action} ${view} ${id} ${step}>
      ${iconHtml}
      <span class="settings-row-main">
        <span class="settings-row-title">${esc(options.title)}</span>
        ${options.copy ? `<span class="settings-row-copy">${esc(options.copy)}</span>` : ""}
      </span>
      ${right}
    </button>
  `
}

function settingsSection(label, ...rows) {
  return `
    <section class="settings-section">
      ${label ? `<div class="settings-section-label">${esc(label)}</div>` : ""}
      <div class="settings-card">
        ${rows.filter(Boolean).join("")}
      </div>
    </section>
  `
}

function emptyState(options = {}) {
  const iconName = options.icon || "wallet"
  const title = String(options.title || "")
  const body = String(options.body || "")
  const variant = options.variant ? ` ${attr(options.variant)}` : ""
  const action = options.action
  const actionMarkup = action
    ? `<button class="${action.style || "primary-btn"} empty-action" data-action="${attr(action.action || "go")}" ${action.view ? `data-view="${attr(action.view)}"` : ""}>${icon(action.icon || "add")} ${esc(action.label)}</button>`
    : ""
  return `
    <div class="empty${variant}">
      <div class="empty-icon">${icon(iconName, "", "empty-glyph")}</div>
      <div class="empty-title">${esc(title)}</div>
      ${body ? `<div class="empty-body">${esc(body)}</div>` : ""}
      ${actionMarkup}
    </div>
  `
}

function header(title, subtitle, actions = "") {
  return `
    <div class="header">
      <div>
        <div class="title">${esc(title)}</div>
        <div class="subtitle">${esc(subtitle)}</div>
      </div>
      <div class="actions">${actions}</div>
    </div>
  `
}

function quickFAB() {
  if (!app.state || !app.state.budgets || !app.state.budgets.length) return ""
  return `<button class="fab" data-action="openQuickAdd" aria-label="Log a leak" title="Log a leak">${icon("add")}</button>`
}

function nav() {
  const items = [
    ["home", "dashboard", "Home"],
    ["log", "activity", "Activity"],
    ["account", "account", "Account"]
  ]

  return `
    <nav class="nav" role="tablist" aria-label="Main">
      ${items.map(([view, iconName, label]) => `
        <button class="nav-btn ${app.view === view ? "active" : ""}" role="tab" aria-selected="${app.view === view ? "true" : "false"}" data-action="go" data-view="${view}">
          ${icon(iconName, "", "nav-icon")}
          <span class="nav-label">${label}</span>
        </button>
      `).join("")}
    </nav>
  `
}

function renderHome() {
  const spent = app.state.spent || {}
  const totalBudget = app.state.budgets.reduce((sum, b) => sum + (Number(b.budget) || 0), 0)
  const totalSpent = Object.values(spent).reduce((sum, value) => sum + (Number(value) || 0), 0)
  const left = totalBudget - totalSpent
  const globalPct = totalBudget > 0 ? (totalSpent / totalBudget) * 100 : (totalSpent > 0 ? 100 : 0)
  const pct = Math.min(100, globalPct)
  const health = getBudgetHealth(totalBudget, totalSpent, spent)
  const installButton = app.installPrompt
    ? `<button class="top-btn icon-btn" title="Install" aria-label="Install" data-action="install">${icon("download")}</button>`
    : ""
  const cloudTitle = app.cloudUser ? "Backup connected" : "Set up backup"
  const cloudButton = `<button class="top-btn icon-btn cloud-btn ${app.cloudUser ? "online" : ""} ${app.cloudBusy ? "syncing" : ""}" title="${cloudTitle}" aria-label="${cloudTitle}" data-action="go" data-view="account">${icon("cloud")}</button>`
  const hasShared = app.shared.workspace || app.shared.budgets.length > 0
  const refreshButton = (app.cloudUser && hasShared)
    ? `<button class="top-btn icon-btn refresh-btn ${app.shared.syncing ? "syncing" : ""}" title="Refresh shared" aria-label="Refresh shared" data-action="manualRefresh">${icon("refresh")}</button>`
    : ""
  const budgetContent = app.state.budgets.length
    ? app.state.budgets.map(renderBudgetCard).join("")
    : emptyState({
        icon: "grid",
        title: "No leak budgets",
        body: "Start with what tends to slip.",
        variant: "budget-empty",
        action: { action: "go", view: "cats", label: "New budget", style: "primary-btn" }
      })

  return `
    <section class="view">
      ${header("Budget Tracker", monthLabel(app.key), `
        ${refreshButton}
        ${cloudButton}
        ${installButton}
      `)}

      <div class="hero ${app.methodJustSaved ? "just-saved" : ""}">
        <div class="hero-label">${left < 0 ? "Over budget" : "Available"}</div>
        <div class="hero-amount" data-value="${Math.abs(left)}" style="color:${left < 0 ? "var(--red)" : "var(--txt)"}">${money0(Math.abs(left))}</div>
        <div class="hero-sub">${fmt(totalSpent)} spent of ${fmt(totalBudget)}</div>
        <div class="hero-meta">
          <span class="status-pill" style="color:${health.color};background:${health.bg};border-color:${health.border}">${esc(health.text)}</span>
          <span class="hero-used">${Math.round(globalPct)}% used</span>
        </div>
      </div>

      <div class="global-bar">
        <div class="bar-fill" style="width:${pct}%;background:${pct > 90 ? "var(--red)" : pct > 70 ? "var(--amb)" : "var(--acc)"}"></div>
      </div>

      <div class="scroll">
        <div class="category-list">
          ${budgetContent}
        </div>
      </div>

      ${quickFAB()}
      ${nav()}
    </section>
  `
}

function renderBudgetCard(budget) {
  const spent = app.state.spent[budget.id] || 0
  const limit = Number(budget.budget) || 0
  const p = limit > 0 ? Math.min(100, (spent / limit) * 100) : (spent > 0 ? 100 : 0)
  const rawPct = limit > 0 ? (spent / limit) * 100 : (spent > 0 ? 100 : 0)
  const over = spent > limit
  const color = over ? "var(--red)" : cssColor(budget.color)
  const remaining = limit - spent
  const memberCount = budget.shared && Array.isArray(budget.members) ? budget.members.length : 0
  const sharedChip = budget.shared
    ? `<span class="shared-chip" title="Shared with ${memberCount} ${memberCount === 1 ? "person" : "people"}">${icon("users")}${memberCount > 1 ? `<span>${memberCount}</span>` : ""}</span>`
    : ""

  return `
    <button class="card budget-card ${budget.shared ? "is-shared" : ""}" data-action="openBudgetCapture" data-id="${attr(budget.id)}" style="--cat:${cssColor(budget.color)};--cat-soft:${cssColor(budget.color)}16">
      <div class="budget-top">
        <div class="budget-left">
          <span class="emoji-box">${esc(budget.icon)}</span>
          <div>
            <div class="budget-name">${esc(budget.label)}${sharedChip}</div>
            <div class="budget-meta">${remaining >= 0 ? fmt(remaining) + " left" : fmt(Math.abs(remaining)) + " over"}</div>
          </div>
        </div>
        <div class="budget-right">
          <div class="budget-spent" style="color:${color}">${fmt(spent)}</div>
          <div class="budget-limit">of ${fmt(limit)}</div>
        </div>
      </div>
      <div class="budget-progress">
        <div class="bar-bg">
          <div class="bar-fill" style="width:${p}%;background:${color}"></div>
        </div>
        <div class="pct-badge">${Math.round(rawPct)}%</div>
      </div>
    </button>
  `
}

function renderAdd() {
  const selected = app.selectedCat ? categoryById(app.selectedCat) : null
  const selectedColor = selected ? cssColor(selected.color) : "var(--bord)"
  const addDate = clampExpenseDateISO(app.drafts.add.dateISO)

  return `
    <section class="view">
      ${header("Add Expense", "Create a new transaction", `
        <button class="top-btn icon-btn" title="Presets" aria-label="Presets" data-action="go" data-view="presets">${icon("settings")}</button>
      `)}

      <div class="scroll add-scroll">
        <div class="section">
          <div class="section-row">
            <div class="section-label">Quick presets</div>
            <button class="text-btn" data-action="go" data-view="presets">Manage</button>
          </div>
          <div class="row-scroll">
            ${renderPresetButtons()}
          </div>
        </div>

        <div class="section">
          <div class="section-row">
            <div class="section-label">Category</div>
            <button class="text-btn" data-action="openCatPicker">Change</button>
          </div>
          <button class="selected-cat" style="border-color:${selectedColor};background:${selected ? cssColor(selected.color) + "10" : "var(--card)"};color:${selected ? cssColor(selected.color) : "var(--txt)"}" data-action="openCatPicker">
            <span class="emoji-box" style="background:${selected ? cssColor(selected.color) + "16" : "var(--card2)"};color:${selected ? cssColor(selected.color) : "var(--txt)"}">${selected ? esc(selected.icon) : icon("add")}</span>
            <span class="label">${selected ? esc(selected.label) : "Choose a category"}</span>
            <span class="arrow">${icon("back", "", "chevron-next")}</span>
          </button>
        </div>

        <div class="field-group">
          <div class="field-label">Amount</div>
          <input class="field" id="add-amt" type="number" inputmode="decimal" placeholder="$0.00" value="${attr(app.drafts.add.amt)}">
        </div>

        <div class="field-group">
          <div class="field-label">Date</div>
          <input class="field date-field" id="add-date" type="date" max="${attr(todayISO())}" value="${attr(addDate)}">
          <div class="field-hint" id="add-date-hint">${esc(dateFriendlyLabel(addDate))}</div>
        </div>

        <div class="field-group">
          <div class="field-label">Description</div>
          <input class="field" id="add-desc" type="text" placeholder="e.g. Starbucks" value="${attr(app.drafts.add.desc)}">
        </div>

        <button class="primary-btn" id="save-expense" data-action="saveExpense" ${canSaveExpense() ? "" : "disabled"}>${icon("check")} Save Expense</button>

        ${selected ? renderCategoryHistoryCompact(selected) : ""}
      </div>
      ${nav()}
    </section>
  `
}

function renderPresetButtons() {
  if (!app.state.presets.length) {
    return `<button class="preset-btn" data-action="go" data-view="presets">${icon("add")} Create preset</button>`
  }

  return app.state.presets.map(preset => {
    const cat = categoryById(preset.cat) || {}
    const color = cssColor(cat.color || "#0F766E")
    return `
      <button class="preset-btn" style="--cat:${color};--cat-soft:${color}16" data-action="usePreset" data-id="${attr(preset.id)}">
        <span class="preset-emoji">${esc(preset.icon || cat.icon || "⚡")}</span>
        <span class="preset-copy">${esc(preset.desc)}</span>
        <span class="preset-amt">${fmt(preset.amt)}</span>
      </button>
    `
  }).join("")
}

function renderLog() {
  const entries = [...(app.state.allEntries || app.state.entries || [])].sort((a, b) => {
    // Newest first by occurredOn (ISO YYYY-MM-DD); tiebreak by insertion order desc
    const aDate = a.occurredOn || ""
    const bDate = b.occurredOn || ""
    if (aDate !== bDate) return aDate < bDate ? 1 : -1
    return (b.insertOrder || 0) - (a.insertOrder || 0)
  })
  let content
  if (!entries.length) {
    content = emptyState({
      icon: "activity",
      title: "Nothing logged yet",
      body: "Tap + when something leaks.",
      action: { action: "openQuickAdd", label: "Log a leak", style: "primary-btn" }
    })
  } else {
    const groups = []
    let current = null
    for (const entry of entries) {
      const date = entry.date || "—"
      if (!current || current.date !== date) {
        current = { date, total: 0, entries: [] }
        groups.push(current)
      }
      current.entries.push(entry)
      current.total += Number(entry.amt) || 0
    }
    content = groups.map(g => `
      <section class="log-day">
        <div class="log-day-header">
          <span class="log-day-date">${esc(g.date)}</span>
          <span class="log-day-total">${fmt(g.total)}</span>
        </div>
        ${g.entries.map(renderLogItem).join("")}
      </section>
    `).join("")
  }

  return `
    <section class="view">
      ${header("Activity", "Tap an expense to edit it", `
        <button class="top-btn icon-btn" title="Budgets" aria-label="Budgets" data-action="go" data-view="cats">${icon("grid")}</button>
      `)}
      <div class="scroll">
        <div class="item-list">${content}</div>
      </div>
      ${quickFAB()}
      ${nav()}
    </section>
  `
}

function renderLogItem(entry) {
  const cat = categoryById(entry.cat) || {}
  const color = cssColor(cat.color || "#0F766E")
  const idAttr = entry.shared ? attr(entry.id) : Number(entry.id)
  const isMine = !entry.shared || (app.cloudUser && entry.createdBy === app.cloudUser.id)
  const authorInitials = entry.shared && !isMine && entry.createdByEmail
    ? initialsFromEmail(entry.createdByEmail)
    : ""

  return `
    <button class="card log-item safe-row ${entry.shared ? "is-shared" : ""}" data-action="openEntryEdit" data-id="${idAttr}">
      <span class="emoji-box" style="background:${color}16;color:${color}">${esc(cat.icon || "·")}</span>
      <span class="row-copy">
        <span class="row-title clamp-2">${esc(entry.desc || "Expense")}</span>
        <span class="row-meta clamp-1">${esc(cat.label || entry.cat || "Uncategorized")}${authorInitials ? `<span class="author-chip">${esc(authorInitials)}</span>` : ""}</span>
      </span>
      <span class="row-side">
        <span class="row-amount">${fmt(entry.amt)}</span>
        <span class="row-date">${esc(entry.date || "")}</span>
      </span>
    </button>
  `
}

function entryISO(entry) {
  return isISODate(entry?.dateISO) ? entry.dateISO : isISODate(entry?.occurredOn) ? entry.occurredOn : todayISO()
}

function entryMonth(entry) {
  return entry?.monthKey && parseMonthKey(entry.monthKey) ? entry.monthKey : monthKeyFromISO(entryISO(entry))
}

function sortEntriesNewest(entries) {
  return [...entries].sort((a, b) => {
    const aDate = entryISO(a)
    const bDate = entryISO(b)
    if (aDate !== bDate) return aDate < bDate ? 1 : -1
    return (b.insertOrder || 0) - (a.insertOrder || 0)
  })
}

function exactBudgetEntries(catId, options = {}) {
  const entries = options.all === false
    ? app.state.entries || []
    : app.state.allEntries || app.state.entries || []
  return sortEntriesNewest(entries.filter(entry => String(entry.cat) === String(catId)))
}

function thisMonthBudgetEntries(catId) {
  return exactBudgetEntries(catId).filter(entry => entryMonth(entry) === app.key)
}

function totalEntries(entries) {
  return roundMoney(entries.reduce((sum, entry) => sum + (Number(entry.amt) || 0), 0))
}

function entryShortDate(entry) {
  const iso = entryISO(entry)
  if (iso === todayISO()) return "Today"
  const yesterday = new Date()
  yesterday.setDate(yesterday.getDate() - 1)
  if (iso === isoFromDate(yesterday)) return "Yesterday"
  return dateLabelFromISO(iso)
}

function monthSortLabel(key) {
  return monthLabel(key)
}

function renderCategoryHistoryCompact(cat, options = {}) {
  if (!cat) return ""
  const monthlyEntries = thisMonthBudgetEntries(cat.id)
  const allEntries = exactBudgetEntries(cat.id)
  const total = totalEntries(monthlyEntries)
  const budget = Number(cat.budget) || 0
  const remaining = budget - total
  const hasAllHistory = allEntries.length > 0
  const rows = monthlyEntries.slice(0, 3)
  const compactClass = options.compact ? " compact" : ""

  return `
    <section class="category-history-card${compactClass}" style="--cat:${cssColor(cat.color)};--cat-soft:${cssColor(cat.color)}16">
      <div class="category-history-head">
        <div>
          <div class="section-label">Recent in ${esc(cat.label)}</div>
          <div class="category-history-total">${fmt(total)} this month · ${remaining >= 0 ? fmt(remaining) + " left" : fmt(Math.abs(remaining)) + " over"}</div>
        </div>
        ${hasAllHistory ? `<button class="text-btn compact-history-link" data-action="openCategoryHistory" data-id="${attr(cat.id)}">View full history</button>` : ""}
      </div>
      ${rows.length ? `
        <div class="category-history-rows">
          ${rows.map(entry => renderCategoryHistoryMiniRow(entry)).join("")}
        </div>
      ` : `
        <div class="category-history-empty">
          <strong>No ${esc(cat.label)} leaks yet this month</strong>
          <span>${hasAllHistory ? "Older history is still available." : "Your recent history will show here after you log one."}</span>
        </div>
      `}
    </section>
  `
}

function renderCategoryHistoryMiniRow(entry) {
  const idAttr = entry.shared ? attr(entry.id) : Number(entry.id)
  return `
    <button class="category-history-mini" data-action="openCategoryHistoryEdit" data-id="${idAttr}" data-return="capture">
      <span class="mini-copy">
        <strong class="clamp-1">${esc(entry.desc || "Expense")}</strong>
        <small>${esc(entryShortDate(entry))}</small>
      </span>
      <span class="mini-amount">${fmt(entry.amt)}</span>
    </button>
  `
}

function categoryHistoryQueryText(entry) {
  return [
    entry.desc,
    fmt(entry.amt),
    String(Number(entry.amt) || ""),
    entryShortDate(entry),
    dateFriendlyLabel(entryISO(entry)),
    monthLabel(entryMonth(entry)),
    entry.date
  ].join(" ").toLowerCase()
}

function activeCategoryHistoryEntries() {
  const catId = app.categoryHistory.catId
  const all = exactBudgetEntries(catId)
  const scoped = app.categoryHistory.tab === "all"
    ? all
    : all.filter(entry => entryMonth(entry) === app.key)
  const query = String(app.categoryHistory.query || "").trim().toLowerCase()
  if (!query) return scoped
  return scoped.filter(entry => categoryHistoryQueryText(entry).includes(query))
}

function categoryHistoryStats(cat, entries) {
  const total = totalEntries(entries)
  if (app.categoryHistory.tab === "all") {
    const months = new Set(entries.map(entryMonth))
    const avg = months.size ? roundMoney(total / months.size) : 0
    return [
      ["Total", fmt(total)],
      ["Average / month", fmt(avg)],
      ["Transactions", String(entries.length)]
    ]
  }

  const budget = Number(cat?.budget) || 0
  const left = budget - total
  return [
    ["Spent", fmt(total)],
    [left >= 0 ? "Left" : "Over", fmt(Math.abs(left))],
    ["Transactions", String(entries.length)]
  ]
}

function groupCategoryHistoryEntries(entries) {
  const groups = []
  let current = null
  for (const entry of entries) {
    const groupKey = app.categoryHistory.tab === "all" ? entryMonth(entry) : entryISO(entry)
    const label = app.categoryHistory.tab === "all" ? monthSortLabel(groupKey) : entryShortDate(entry)
    if (!current || current.key !== groupKey) {
      current = { key: groupKey, label, total: 0, entries: [] }
      groups.push(current)
    }
    current.entries.push(entry)
    current.total = roundMoney(current.total + (Number(entry.amt) || 0))
  }
  return groups
}

function renderCategoryHistoryModal() {
  const cat = categoryById(app.categoryHistory.catId)
  if (!cat) {
    closeModal(false)
    return ""
  }
  if (app.categoryHistory.mode === "edit") return renderCategoryHistoryEditModal(cat)

  const entries = activeCategoryHistoryEntries()
  const stats = categoryHistoryStats(cat, entries)
  const allEntries = exactBudgetEntries(cat.id)
  const thisMonthEntries = thisMonthBudgetEntries(cat.id)
  const groups = groupCategoryHistoryEntries(entries)
  const emptyCopy = app.categoryHistory.tab === "month" && allEntries.length && !thisMonthEntries.length
    ? `<button class="text-btn" data-action="setCategoryHistoryTab" data-value="all">View all history</button>`
    : ""

  return `
    <div class="sheet category-history-sheet" role="dialog" aria-modal="true" aria-label="${attr(cat.label)} history">
      <div class="sheet-top">
        <div class="sheet-title">${esc(cat.label)} history</div>
        <button class="sheet-close" aria-label="Close" data-action="closeModal">${icon("close")}</button>
      </div>
      <div class="category-history-hero" style="--cat:${cssColor(cat.color)};--cat-soft:${cssColor(cat.color)}16">
        <span class="emoji-box">${esc(cat.icon || "·")}</span>
        <div>
          <strong>${app.categoryHistory.tab === "all" ? `${fmt(totalEntries(exactBudgetEntries(cat.id)))} total` : `${fmt(totalEntries(thisMonthBudgetEntries(cat.id)))} this month`}</strong>
          <small>${esc(cat.label)} · exact budget history</small>
        </div>
      </div>
      <div class="history-tabs" role="tablist" aria-label="History range">
        <button class="${app.categoryHistory.tab === "month" ? "active" : ""}" data-action="setCategoryHistoryTab" data-value="month">This month</button>
        <button class="${app.categoryHistory.tab === "all" ? "active" : ""}" data-action="setCategoryHistoryTab" data-value="all">All</button>
      </div>
      <div class="history-stats" id="category-history-stats">
        ${renderCategoryHistoryStatsMarkup(stats)}
      </div>
      <input class="field history-search" id="category-history-search" type="search" placeholder="Search description, amount, or date" value="${attr(app.categoryHistory.query)}" autocomplete="off">
      <div class="history-results" id="category-history-results">
        ${renderCategoryHistoryResultsMarkup(groups, emptyCopy)}
      </div>
    </div>
  `
}

function renderCategoryHistoryStatsMarkup(stats) {
  return stats.map(([label, value]) => `
    <div>
      <strong>${esc(value)}</strong>
      <span>${esc(label)}</span>
    </div>
  `).join("")
}

function renderCategoryHistoryResultsMarkup(groups, emptyCopy = "") {
  return groups.length ? groups.map(group => `
    <section class="history-group">
      <div class="history-group-head">
        <span>${esc(group.label)}</span>
        <span>${fmt(group.total)}</span>
      </div>
      ${group.entries.map(renderCategoryHistoryRow).join("")}
    </section>
  `).join("") : `
    <div class="empty compact-empty">
      <div class="empty-title">No matching transactions</div>
      <div class="row-meta">${app.categoryHistory.query ? "Try another search." : "Nothing here yet."}</div>
      ${emptyCopy}
    </div>
  `
}

function updateCategoryHistoryResults() {
  if (app.modal !== "categoryHistory" || app.categoryHistory.mode !== "list") return
  const cat = categoryById(app.categoryHistory.catId)
  if (!cat) return
  const entries = activeCategoryHistoryEntries()
  const groups = groupCategoryHistoryEntries(entries)
  const allEntries = exactBudgetEntries(cat.id)
  const thisMonthEntries = thisMonthBudgetEntries(cat.id)
  const emptyCopy = app.categoryHistory.tab === "month" && allEntries.length && !thisMonthEntries.length
    ? `<button class="text-btn" data-action="setCategoryHistoryTab" data-value="all">View all history</button>`
    : ""
  const stats = document.getElementById("category-history-stats")
  const results = document.getElementById("category-history-results")
  if (stats) stats.innerHTML = renderCategoryHistoryStatsMarkup(categoryHistoryStats(cat, entries))
  if (results) results.innerHTML = renderCategoryHistoryResultsMarkup(groups, emptyCopy)
}

function renderCategoryHistoryRow(entry) {
  const cat = categoryById(entry.cat) || {}
  const idAttr = entry.shared ? attr(entry.id) : Number(entry.id)
  const authorInitials = entry.shared && app.cloudUser && entry.createdBy !== app.cloudUser.id && entry.createdByEmail
    ? initialsFromEmail(entry.createdByEmail)
    : ""
  return `
    <button class="history-row" data-action="openCategoryHistoryEdit" data-id="${idAttr}" data-return="list">
      <span class="emoji-box" style="background:${cssColor(cat.color || "#0F766E")}16;color:${cssColor(cat.color || "#0F766E")}">${esc(cat.icon || "·")}</span>
      <span class="row-copy">
        <span class="row-title clamp-2">${esc(entry.desc || "Expense")}</span>
        <span class="row-meta clamp-1">${esc(entryShortDate(entry))}${authorInitials ? `<span class="author-chip">${esc(authorInitials)}</span>` : ""}</span>
      </span>
      <span class="row-side">
        <span class="row-amount">${fmt(entry.amt)}</span>
      </span>
    </button>
  `
}

function initialsFromEmail(email) {
  const s = String(email || "").trim()
  if (!s) return ""
  const local = s.split("@")[0] || s
  const parts = local.split(/[._-]+/).filter(Boolean)
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase()
  return (local[0] + (local[1] || "")).toUpperCase()
}

function renderCategories() {
  return `
    <section class="view">
      <div class="subheader">
        <button class="back-btn" aria-label="Back" data-action="go" data-view="${secondaryBackView("account")}">${icon("back")}</button>
        <div class="title">Budgets</div>
        <span></span>
      </div>

      <div class="form-card compact-form">
        <div class="section-label">New budget</div>
        <div class="two-col icon-name-grid" style="margin-top:9px">
          ${iconPickerButton("category")}
          <input class="field" id="cat-label" type="text" placeholder="Name" value="${attr(app.drafts.category.label)}">
        </div>
        <div class="field-group compact-field">
          <input class="field" id="cat-budget" type="number" inputmode="decimal" placeholder="Base monthly limit" value="${attr(app.drafts.category.budget)}">
        </div>
        <button class="primary-btn" id="save-category" data-action="addCategory" ${canAddCategory() ? "" : "disabled"}>${icon("add")} Add Budget</button>
      </div>

      <div class="scroll">
        <div class="item-list">
          ${app.state.budgets.map(renderCategoryManagerCard).join("")}
        </div>
      </div>
    </section>
  `
}

function renderCategoryManagerCard(budget) {
  const monthly = Number(budget.baseBudget) || Number(budget.budget) || 0

  return `
    <button class="card cat-card budget-manage-card" data-action="openBudgetEdit" data-id="${attr(budget.id)}" style="--cat:${cssColor(budget.color)};--cat-soft:${cssColor(budget.color)}16">
      <div class="cat-top">
        <div class="cat-left">
          <span class="cat-dot"></span>
          <span class="cat-title">
            <span class="emoji-box cat-manage-icon">${esc(budget.icon)}</span>
            <span class="cat-text clamp-1">${esc(budget.label)}</span>
          </span>
        </div>
        <div class="cat-budget">${fmt(monthly)}</div>
      </div>
      <div class="cat-meta">Monthly limit</div>
    </button>
  `
}

function renderPresets() {
  return `
    <section class="view">
      <div class="subheader">
        <button class="back-btn" aria-label="Back" data-action="go" data-view="${secondaryBackView("account")}">${icon("back")}</button>
        <div class="title">Presets</div>
        <span></span>
      </div>
      <div class="form-card compact-form">
        <div class="section-label">New preset</div>
        <div class="two-col icon-name-grid" style="margin-top:9px">
          ${iconPickerButton("preset")}
          <input class="field" id="preset-desc" type="text" placeholder="Name / description" value="${attr(app.drafts.preset.desc)}">
        </div>
        <div class="field-group">
          <input class="field" id="preset-amt" type="number" inputmode="decimal" placeholder="Amount" value="${attr(app.drafts.preset.amt)}">
        </div>
        <div class="field-label">Category</div>
        <div class="pill-wrap">
          ${renderCategoryPills(app.newPresetCat, "pickPresetCat")}
        </div>
        <button class="primary-btn" id="save-preset" data-action="addPreset" ${canAddPreset() ? "" : "disabled"}>${icon("check")} Save Preset</button>
      </div>
      <div class="scroll">
        <div class="item-list">
          ${app.state.presets.length ? app.state.presets.map(renderPresetCard).join("") : emptyState({
            icon: "settings",
            title: "No presets",
            body: "Save the things you log most."
          })}
        </div>
      </div>
    </section>
  `
}

function renderPresetCard(preset) {
  const cat = categoryById(preset.cat) || {}
  const color = cssColor(cat.color || "#0F766E")

  return `
    <button class="card preset-card safe-row" data-action="openPresetEdit" data-id="${attr(preset.id)}">
      <span class="emoji-box" style="background:${color}16;color:${color}">${esc(preset.icon || cat.icon || "⚡")}</span>
      <span class="row-copy">
        <span class="row-title clamp-2">${esc(preset.desc)}</span>
        <span class="row-meta clamp-2">${fmt(preset.amt)} · ${esc(cat.label || "Uncategorized")}</span>
      </span>
      <span class="row-side subtle-side">${icon("back", "", "chevron-next")}</span>
    </button>
  `
}

function renderWishes() {
  return `
    <section class="view">
      <div class="subheader">
        <button class="back-btn" aria-label="Back" data-action="go" data-view="${secondaryBackView("account")}">${icon("back")}</button>
        <div class="title">Wishlist</div>
        <span></span>
      </div>
      <div class="form-card compact-form">
        <div class="section-label">New wish</div>
        <div class="two-col icon-name-grid" style="margin-top:9px">
          ${iconPickerButton("wish")}
          <input class="field" id="wish-desc" type="text" placeholder="What do you want to buy?" value="${attr(app.drafts.wish.desc)}">
        </div>
        <div class="field-group">
          <input class="field" id="wish-amt" type="number" inputmode="decimal" placeholder="Estimated amount" value="${attr(app.drafts.wish.amt)}">
        </div>
        <div class="field-label">Category when purchased</div>
        <div class="pill-wrap">
          ${renderCategoryPills(app.newWishCat, "pickWishCat")}
        </div>
        <button class="primary-btn" id="save-wish" data-action="addWish" ${canAddWish() ? "" : "disabled"}>${icon("heart")} Save Wish</button>
      </div>
      <div class="scroll">
        <div class="item-list">
          ${app.state.wishes.length ? app.state.wishes.map(renderWishCard).join("") : emptyState({
            icon: "heart",
            title: "Wishlist is empty",
            body: "Add something you're saving for."
          })}
        </div>
      </div>
    </section>
  `
}

function renderWishCard(wish) {
  const cat = categoryById(wish.cat) || {}
  const color = cssColor(cat.color || "#0F766E")

  return `
    <button class="card preset-card safe-row" data-action="openWishEdit" data-id="${attr(wish.id)}">
      <span class="emoji-box" style="background:${color}16;color:${color}">${esc(wish.icon || "✨")}</span>
      <span class="row-copy">
        <span class="row-title clamp-2">${esc(wish.desc)}</span>
        <span class="row-meta clamp-2">${fmt(wish.amt)} · ${esc(cat.label || "Uncategorized")}</span>
      </span>
      <span class="row-side subtle-side">${icon("back", "", "chevron-next")}</span>
    </button>
  `
}

function renderReview() {
  const context = reviewContext()
  const hasTransactions = context.review.transactions.length > 0
  const averageContext = reviewAverageContext()
  const stable = reviewStableAmount(averageContext)
  const visibleTotal = reviewTotal(context.rows, context.divisor)
  const income = Number(app.drafts.method.monthlyIncome) || Number(getMethod().monthlyIncome) || 0
  const available = roundMoney(income - stable)
  const busy = !!app.reviewBusy

  const statusText = app.reviewStatus || (hasTransactions
    ? "Raw files are not stored after processing."
    : "CSV, TXT, and Excel first. We need 4 detected months before saving your pool.")

  let body
  if (busy && !hasTransactions) {
    body = renderReviewSkeleton()
  } else if (hasTransactions) {
    body = renderReviewWorkspace(context, { stable, visibleTotal, income, available })
  } else {
    body = renderReviewEmpty()
  }

  return `
    <section class="view">
      <div class="subheader">
        <button class="back-btn" aria-label="Back" data-action="go" data-view="${secondaryBackView("account")}">${icon("back")}</button>
        <div class="title">Analyze Statements</div>
        <span></span>
      </div>

      <div class="scroll review-scroll">
        <div class="review-hero">
          <div class="section-label">Find your pool</div>
          <div class="review-title">Discover what you don't need to track.</div>
          <p>Upload 4 months of statements. One month can lie. Four months starts to show your real rhythm.</p>
          <div class="review-actions">
            <button class="primary-btn" data-action="pickStatements" ${busy ? "disabled" : ""}>${icon("upload")} ${busy ? "Analyzing…" : "Upload Statements"}</button>
            ${hasTransactions && !busy ? `<button class="secondary-btn" data-action="clearReview">${icon("trash")} Clear Review</button>` : ""}
          </div>
          <div class="review-status ${busy ? "busy" : ""}">
            ${busy ? `<span class="review-status-dot"></span>` : ""}
            <span>${esc(statusText)}</span>
          </div>
        </div>

        ${renderDesktopHandoffCard()}
        ${body}
      </div>
    </section>
  `
}

function renderReviewSkeleton() {
  const groups = [
    { label: "Groceries", rows: 3 },
    { label: "Subscriptions", rows: 4 },
    { label: "Transport", rows: 2 }
  ]

  return `
    <div class="review-skeleton" role="status" aria-live="polite" aria-label="Analyzing statements">
      <div class="skel-pool-card">
        <div class="skel-line skel-pool-label"></div>
        <div class="skel-line skel-pool-amount"></div>
        <div class="skel-line skel-pool-copy"></div>
      </div>
      ${groups.map((g, i) => `
        <article class="skel-group" style="animation-delay:${i * 80}ms">
          <div class="skel-group-head">
            <div class="skel-dot"></div>
            <div class="skel-group-body">
              <div class="skel-line skel-w-40"></div>
              <div class="skel-line skel-w-25"></div>
            </div>
            <div class="skel-group-side">
              <div class="skel-line skel-w-60"></div>
              <div class="skel-line skel-w-30"></div>
            </div>
          </div>
          <div class="skel-bar"></div>
          ${Array.from({ length: g.rows }, (_, j) => `
            <div class="skel-row" style="animation-delay:${i * 80 + j * 40}ms">
              <div class="skel-line skel-w-50"></div>
              <div class="skel-line skel-w-20"></div>
            </div>
          `).join("")}
        </article>
      `).join("")}
    </div>
  `
}

function renderReviewEmpty() {
  return emptyState({
    icon: "upload",
    title: "No statements reviewed",
    body: "Drop in 4 months to find your pool.",
    variant: "review-empty",
    action: { action: "pickStatements", label: "Upload statements", icon: "upload", style: "primary-btn" }
  })
}

function renderDesktopHandoffCard() {
  const signedIn = !!app.cloudUser
  const promoted = isPhoneLikeDevice()
  const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=144x144&margin=8&data=${encodeURIComponent(REVIEW_HANDOFF_URL)}`

  if (!promoted) {
    return `
      <div class="review-handoff compact">
        <div>
          <div class="section-label">Continue elsewhere</div>
          <div class="review-handoff-title">Open this review on a computer</div>
        </div>
        <button class="secondary-btn" data-action="copyReviewLink">${icon("file")} Copy Link</button>
      </div>
    `
  }

  return `
    <div class="review-handoff">
      <div class="review-handoff-copy">
        <div class="section-label">Continue on computer</div>
        <div class="review-handoff-title">Uploading statements is often easier on a computer.</div>
        <p>Open this same account there and continue your review.</p>
        <p class="${signedIn ? "review-handoff-ok" : "review-handoff-warn"}">${signedIn ? "Use this same signed-in account on your computer." : "Sign in first so your review can continue between devices."}</p>
      </div>
      <img class="review-qr" src="${attr(qrUrl)}" alt="QR code to open Budget Tracker on a computer">
      <div class="review-link-row">
        <input class="field review-link-field" readonly value="${attr(REVIEW_HANDOFF_URL)}" aria-label="Review link">
        <button class="secondary-btn" data-action="copyReviewLink">${icon("file")} Copy</button>
      </div>
      ${signedIn ? "" : `<button class="text-btn review-signin-link" data-action="go" data-view="account">Sign in for cross-device backup</button>`}
    </div>
  `
}

function renderReviewWorkspace(context, totals) {
  const groups = buildReviewGroups(context)
  const months = context.months
  const missingMonths = reviewMissingMonths()
  const canSavePool = canSaveReviewPool(totals.income, totals.stable)
  const poolCopy = reviewPoolCopy(totals.income, totals.stable)
  const saveLabel = missingMonths > 0 ? `Need ${missingMonths} more ${missingMonths === 1 ? "month" : "months"}` : "Save Pool"
  const poolNote = context.active === "average"
    ? "Saving uses the all-month average."
    : "You are inspecting one month. Saving still uses the all-month average."

  return `
    <div class="review-stats">
      <div><span>4 months needed</span><strong>${missingMonths > 0 ? `${missingMonths} missing` : "Ready"}</strong></div>
      <div><span>Months detected</span><strong>${months.length}</strong></div>
      <div><span>Visible spend</span><strong>${fmt(totals.visibleTotal)}</strong></div>
      <div><span>Stable monthly average</span><strong>${fmt(totals.stable)}</strong></div>
    </div>

    <div class="review-pool-card">
      <div>
        <div class="section-label">Available for leak budgets</div>
        <div class="review-pool-title" id="review-pool-amount" data-value="${totals.income > 0 ? Math.max(0, totals.available) : 0}">${totals.income > 0 ? fmt(Math.max(0, totals.available)) : "Add income"}</div>
        <p id="review-pool-copy">${poolCopy}</p>
        <p class="review-pool-note" id="review-pool-note">${esc(poolNote)}</p>
      </div>
      <div class="field-group review-income">
        <div class="field-label">Monthly income</div>
        <input class="field" id="review-income" type="number" inputmode="decimal" placeholder="$0.00" value="${attr(app.drafts.method.monthlyIncome || (getMethod().monthlyIncome ? String(getMethod().monthlyIncome) : ""))}">
      </div>
      <button class="primary-btn" id="save-review-pool" data-action="saveReviewPool" ${canSavePool ? "" : "disabled"}>${icon("check")} ${esc(saveLabel)}</button>
    </div>

    <div class="review-periods">
      ${renderReviewPeriodButton("average", "All months average", reviewTotal(context.review.transactions, Math.max(1, months.length)), context.active === "average")}
      ${months.map(month => renderReviewPeriodButton(`month:${month}`, monthLabelFromISO(month), reviewTotal(context.review.transactions.filter(tx => tx.monthKey === month), 1), context.active === `month:${month}`)).join("")}
    </div>

    <div class="review-section-head">
      <div>
        <div class="section-label">Spending types</div>
        <div class="review-subtitle">Tap what you are comfortable not tracking.</div>
      </div>
      <button class="text-btn" data-action="clearReviewSelection">Clear</button>
    </div>

    <div class="review-category-list ${app.reviewJustAnalyzed ? "just-analyzed" : ""}">
      ${groups.length ? groups.map((group, index) => renderReviewGroup(group, totals.visibleTotal, index, context)).join("") : `<div class="empty compact-empty"><div class="empty-title">No transactions for this period</div></div>`}
    </div>

    <details class="review-ledger">
      <summary>
        <span>Transactions</span>
        <strong>${context.rows.length}</strong>
      </summary>
      <div class="review-ledger-list">
        ${context.rows.slice().sort((a, b) => b.dateISO.localeCompare(a.dateISO)).slice(0, 220).map(tx => renderReviewTransaction(tx, context)).join("")}
      </div>
    </details>
  `
}

function renderReviewPeriodButton(key, label, amount, active) {
  return `
    <button class="review-period ${active ? "active" : ""}" data-action="setReviewPeriod" data-value="${attr(key)}">
      <span>${esc(label)}</span>
      <strong>${fmt(amount)}</strong>
    </button>
  `
}

function monthLabelFromISO(key) {
  const [year, month] = String(key || "").split("-").map(Number)
  if (!year || !month) return key
  return new Date(year, month - 1, 1).toLocaleDateString("en-US", { month: "short", year: "numeric" })
}

function renderReviewGroup(group, total, index, context) {
  const review = getReview()
  const expanded = review.expandedCategories.includes(group.category)
  const stableCount = group.rows.filter(isReviewTransactionStable).length
  const mode = review.selectedCategories.includes(group.category) && stableCount === group.rows.length ? "selected" : stableCount > 0 ? "partial" : ""
  const percent = total ? Math.round((group.amount / total) * 100) : 0
  const color = generatedCategoryColor(index)

  return `
    <article class="review-group ${mode} ${expanded ? "expanded" : ""}" style="--cat:${color}" data-review-category="${attr(group.category)}">
      <button class="review-group-main" data-action="toggleReviewCategory" data-id="${attr(group.category)}">
        <span class="cat-dot"></span>
        <span class="review-group-copy">
          <strong class="clamp-1">${esc(group.category)}</strong>
          <small>${stableCount ? `${stableCount} stable of ${group.rows.length}` : `${group.rows.length} transactions`}</small>
        </span>
        <span class="review-group-side">
          <strong>${fmt(group.amount)}</strong>
          <small>${percent}% visible</small>
        </span>
      </button>
      <div class="mini-bar"><span style="width:${Math.min(100, percent)}%;background:${color}"></span></div>
      <button class="review-detail" aria-expanded="${expanded ? "true" : "false"}" data-action="toggleReviewCategoryDetails" data-id="${attr(group.category)}">${expanded ? "Hide details" : "View details"}</button>
      <div class="review-store-list">
        ${group.stores.map(store => renderReviewStore(store, context)).join("")}
      </div>
    </article>
  `
}

function renderReviewStore(store, context) {
  const review = getReview()
  const key = reviewStoreKey(store.category, store.merchant)
  const expanded = review.expandedStores.includes(key)
  const stableCount = store.rows.filter(isReviewTransactionStable).length
  const mode = stableCount === store.rows.length && stableCount > 0 ? "selected" : stableCount > 0 ? "partial" : review.selectedCategories.includes(store.category) || review.selectedStores.includes(key) ? "excluded" : ""

  return `
    <div class="review-store ${mode} ${expanded ? "expanded" : ""}" data-review-store="${attr(key)}">
      <button class="review-store-main" data-action="toggleReviewStore" data-id="${attr(key)}">
        <span>
          <strong class="clamp-1">${esc(store.merchant)}</strong>
          <small class="clamp-1">${esc(store.subcategory)} · ${store.rows.length} tx</small>
        </span>
        <span>${fmt(store.amount)}</span>
      </button>
      ${store.rows.length > 1 ? `<button class="review-detail mini" aria-expanded="${expanded ? "true" : "false"}" data-action="toggleReviewStoreDetails" data-id="${attr(key)}">${expanded ? "Hide" : "Rows"}</button>` : ""}
      <div class="review-transaction-list">
        ${store.rows.map(tx => renderReviewTransaction(tx, context)).join("")}
      </div>
    </div>
  `
}

function renderReviewTransaction(tx, context) {
  const mode = reviewTransactionMode(tx)
  const merchantClean = String(tx.merchant || "").trim()
  const rawDescription = String(tx.originalDescription || "").trim()
  const showRaw = rawDescription && rawDescription.toLowerCase() !== merchantClean.toLowerCase()
  return `
    <button class="review-tx ${mode}" data-action="toggleReviewTransaction" data-id="${attr(tx.id)}">
      <span class="review-tx-copy">
        <strong class="clamp-1">${esc(merchantClean)}</strong>
        ${showRaw ? `<span class="review-tx-raw clamp-1">${esc(rawDescription)}</span>` : ""}
        <small class="clamp-1">${esc(tx.dateISO)} · ${esc(tx.sourceName)}</small>
      </span>
      <span class="review-tx-amt">${fmt(reviewAmount(tx.amount, context.divisor))}</span>
    </button>
  `
}

function renderCategoryPills(selectedId, action) {
  return app.state.budgets.map(cat => {
    const color = cssColor(cat.color)
    return `
      <button class="pill ${selectedId === cat.id ? "active" : ""}" style="--cat:${color};--cat-soft:${color}16" data-action="${action}" data-id="${attr(cat.id)}">
        <span>${esc(cat.icon)}</span><span class="pill-text">${esc(cat.label)}</span>
      </button>
    `
  }).join("")
}

function savedTimeLabel(value, emptyText) {
  if (!value) return emptyText
  const now = Date.now()
  const diff = now - Number(value)
  if (diff < 0) return new Date(value).toLocaleString("en-US")
  if (diff < 45 * 1000) return "just now"
  if (diff < 90 * 1000) return "1 min ago"
  const mins = Math.round(diff / 60000)
  if (mins < 60) return `${mins} min ago`
  const hours = Math.round(diff / 3600000)
  if (hours < 24) return `${hours} hr ago`
  const days = Math.round(diff / 86400000)
  if (days < 7) return `${days}d ago`
  return new Date(value).toLocaleDateString("en-US", { month: "short", day: "numeric" })
}

function pluralize(count, singular, plural) {
  const n = Number(count) || 0
  return `${n} ${n === 1 ? singular : (plural || singular + "s")}`
}

function getDataSummary() {
  const monthKeys = getTrackedMonthKeys(app.data)
  return {
    monthCount: monthKeys.length,
    txCount: monthKeys.reduce((sum, key) => sum + (Array.isArray(app.data[key]) ? app.data[key].length : 0), 0),
    saved: savedTimeLabel(app.data._settings._meta.lastSaved, "not saved yet"),
    cloudSaved: savedTimeLabel(app.lastCloudSyncAt, "not synced yet")
  }
}

function getTransactionCount(data = app.data) {
  return getTrackedMonthKeys(data)
    .reduce((sum, key) => sum + (Array.isArray(data[key]) ? data[key].length : 0), 0)
}

function getMethod() {
  return app.data._settings.method
}

function hasCompletedMethod() {
  return Number(getMethod().completedAt) > 0
}

function hasSeenMethodIntro() {
  const method = getMethod()
  return hasCompletedMethod() || Number(method.introSeenAt) > 0 || Number(method.dismissedAt) > 0
}

function hasSeenInstallCoach() {
  return Number(getMethod().installCoachSeenAt) > 0
}

function isStandaloneApp() {
  return window.matchMedia?.("(display-mode: standalone)")?.matches || window.navigator.standalone === true
}

function isPhoneLikeDevice() {
  return /iPhone|iPod|Android.*Mobile/i.test(navigator.userAgent || "") || window.innerWidth < 700
}

function shouldShowInstallCoach() {
  if (isStandaloneApp()) return false
  if (freshPreviewMode) return true
  if (storyPreviewMode) return false
  return !hasSeenInstallCoach()
}

function getMethodBudgetTotal() {
  return app.data._settings.budgets
    .reduce((sum, budget) => sum + (Number(budget.budget) || 0), 0)
}

function getMethodSummary() {
  const method = getMethod()
  const pool = Number(method.intentionalPool) || 0
  const budgeted = getMethodBudgetTotal()
  return {
    pool,
    budgeted,
    unassigned: roundMoney(pool - budgeted),
    suggested: Math.max(0, roundMoney((Number(method.monthlyIncome) || 0) - (Number(method.predictableExpensesTotal) || 0)))
  }
}

function getReview() {
  app.data._settings.review = ensureReviewShape(app.data._settings.review)
  return app.data._settings.review
}

function reviewMonths() {
  return getReview().transactions
    .map(tx => tx.monthKey)
    .filter((value, index, arr) => value && arr.indexOf(value) === index)
    .sort()
}

function reviewContext() {
  const review = getReview()
  const months = reviewMonths()
  const requestedMonth = review.activePeriod && review.activePeriod.startsWith("month:")
    ? review.activePeriod.replace("month:", "")
    : ""
  const active = requestedMonth && months.includes(requestedMonth)
    ? `month:${requestedMonth}`
    : "average"
  const month = active.startsWith("month:") ? active.replace("month:", "") : ""
  const rows = month
    ? review.transactions.filter(tx => tx.monthKey === month)
    : review.transactions
  const divisor = month ? 1 : Math.max(1, months.length)

  return { review, months, active, month, rows, divisor }
}

function reviewAverageContext() {
  const review = getReview()
  const months = reviewMonths()
  return {
    review,
    months,
    active: "average",
    month: "",
    rows: review.transactions,
    divisor: Math.max(1, months.length)
  }
}

function reviewMissingMonths() {
  return Math.max(0, REVIEW_REQUIRED_MONTHS - reviewMonths().length)
}

function reviewAmount(value, divisor) {
  return roundMoney((Number(value) || 0) / Math.max(1, Number(divisor) || 1))
}

function reviewTotal(rows, divisor) {
  return roundMoney(rows.reduce((sum, tx) => sum + reviewAmount(tx.amount, divisor), 0))
}

function reviewStoreKey(category, merchant) {
  return `${category || "Uncategorized"}|||${merchant || "Transaction"}`
}

function parseReviewStoreKey(key) {
  const [category, merchant] = String(key || "").split("|||")
  return { category: category || "", merchant: merchant || "" }
}

function reviewSelectedSet(key) {
  return new Set(normalizeStringArray(getReview()[key]))
}

function setReviewArray(key, set) {
  getReview()[key] = Array.from(set).filter(Boolean)
}

function isReviewTransactionStable(tx) {
  const review = getReview()
  const selectedCategories = new Set(review.selectedCategories)
  const selectedStores = new Set(review.selectedStores)
  const selectedTransactions = new Set(review.selectedTransactions)
  const excludedStores = new Set(review.excludedStores)
  const excludedTransactions = new Set(review.excludedTransactions)
  const storeKey = reviewStoreKey(tx.category, tx.merchant)

  if (selectedCategories.has(tx.category)) {
    if (excludedStores.has(storeKey)) return selectedTransactions.has(tx.id)
    return !excludedTransactions.has(tx.id)
  }

  if (selectedStores.has(storeKey)) return !excludedTransactions.has(tx.id)

  return selectedTransactions.has(tx.id)
}

function reviewTransactionMode(tx) {
  if (isReviewTransactionStable(tx)) return "selected"
  const review = getReview()
  const storeKey = reviewStoreKey(tx.category, tx.merchant)
  if (review.selectedCategories.includes(tx.category) || review.selectedStores.includes(storeKey)) return "excluded"
  return ""
}

function buildReviewGroups(context = reviewContext()) {
  const groups = new Map()

  context.rows.forEach(tx => {
    if (!groups.has(tx.category)) {
      groups.set(tx.category, { category: tx.category, amount: 0, rows: [], stores: new Map() })
    }

    const group = groups.get(tx.category)
    const amount = reviewAmount(tx.amount, context.divisor)
    group.amount = roundMoney(group.amount + amount)
    group.rows.push(tx)

    if (!group.stores.has(tx.merchant)) {
      group.stores.set(tx.merchant, {
        category: tx.category,
        merchant: tx.merchant,
        subcategory: tx.subcategory || "General",
        amount: 0,
        rows: []
      })
    }

    const store = group.stores.get(tx.merchant)
    store.amount = roundMoney(store.amount + amount)
    store.rows.push(tx)
  })

  return Array.from(groups.values()).map(group => ({
    ...group,
    stores: Array.from(group.stores.values()).sort((a, b) => b.amount - a.amount)
  })).sort((a, b) => b.amount - a.amount)
}

function reviewStableRows(context = reviewContext()) {
  return context.rows.filter(isReviewTransactionStable)
}

function reviewStableAmount(context = reviewContext()) {
  return reviewTotal(reviewStableRows(context), context.divisor)
}

function reviewAvailablePool(context = reviewAverageContext()) {
  return roundMoney((Number(app.drafts.method.monthlyIncome) || Number(getMethod().monthlyIncome) || 0) - reviewStableAmount(context))
}

function saveReviewState() {
  const review = getReview()
  review.updatedAt = Date.now()
  review.stableMonthlyAmount = reviewStableAmount(reviewAverageContext())
  saveData(app.data)
}

function canSaveReviewPool(income, stable) {
  return Number(income) > 0 && Number(stable) > 0 && reviewMissingMonths() === 0
}

function reviewPoolCopy(income, stable) {
  const missing = reviewMissingMonths()
  if (missing > 0) {
    return `Upload ${missing} more ${missing === 1 ? "month" : "months"} before saving. We need 4 months to see the real pattern.`
  }
  if (Number(income) <= 0) return "Add monthly income to see what remains after stable expenses."
  if (Number(stable) <= 0) return "Select the stable expenses you are comfortable not tracking."
  return "Available to split manually into leak budgets."
}

function syncMethodDraft() {
  const method = getMethod()
  app.drafts.method = {
    monthlyIncome: method.monthlyIncome ? String(method.monthlyIncome) : "",
    predictableExpensesTotal: method.predictableExpensesTotal ? String(method.predictableExpensesTotal) : "",
    intentionalPool: method.intentionalPool ? String(method.intentionalPool) : ""
  }
}

function canContinueMethodNumbers() {
  return app.drafts.method.monthlyIncome !== "" &&
    app.drafts.method.predictableExpensesTotal !== "" &&
    Number(app.drafts.method.monthlyIncome) > 0 &&
    Number(app.drafts.method.predictableExpensesTotal) >= 0
}

function canConfirmMethodPool() {
  return app.drafts.method.intentionalPool !== "" && Number(app.drafts.method.intentionalPool) > 0
}

function shouldAutoOpenMethod() {
  if (app.methodAutoOpened || hasSeenMethodIntro()) return false
  if (getTransactionCount(app.data) > 0) return false
  if (hasBudgetContent(app.data)) return false
  return getSavedAt(app.data) === 0
}

function maybeOpenInitialMethod() {
  if (!storyPreviewMode && !shouldAutoOpenMethod()) return

  window.setTimeout(() => {
    if ((!storyPreviewMode && !shouldAutoOpenMethod()) || app.modal || app.view !== "home") return
    app.methodAutoOpened = true
    openMethodIntro({ silent: true, mode: storyPreviewMode && !freshPreviewMode ? "read" : "firstRun" })
  }, 1300)
}

function renderCloudPanel() {
  const summary = getDataSummary()
  const mode = app.drafts.cloud.mode || "signin"
  const signedIn = !!app.cloudUser
  const recovering = app.recoveringPassword && signedIn
  const recoveryStarted = !!(app.drafts.cloud.newPassword || app.drafts.cloud.confirmPassword)
  const recoveryHint = canUpdateRecoveredPassword() ? "Ready to save." : recoveryStarted ? "Passwords must match and be at least 6 characters." : "Use at least 6 characters."
  const statusTitle = recovering ? "Set a new password" : app.cloudBusy ? "Syncing..." : signedIn ? "Backup is on" : mode === "reset" ? "Reset password" : "Sign in to back up"
  const statusCopy = recovering
    ? "Choose a new password to finish securing your account."
    : signedIn
    ? (app.cloudBusy ? "Saving your latest changes..." : `Last synced ${esc(summary.cloudSaved)}`)
    : mode === "reset"
    ? "Enter your email and we will send a secure reset link."
    : "Your budget stays on this device until you sign in."
  const cloudMode = recovering
    ? `
      <div class="field-group cloud-login">
        <div class="field-label">New password</div>
        <input class="field" id="cloud-new-password" type="password" autocomplete="new-password" placeholder="New password" value="${attr(app.drafts.cloud.newPassword)}">
      </div>
      <div class="field-group cloud-login">
        <div class="field-label">Confirm password</div>
        <input class="field" id="cloud-confirm-password" type="password" autocomplete="new-password" placeholder="Confirm password" value="${attr(app.drafts.cloud.confirmPassword)}">
      </div>
      <button class="primary-btn" id="update-password-btn" data-action="cloudUpdatePassword" ${app.cloudBusy || !canUpdateRecoveredPassword() ? "disabled" : ""}>${icon("check")} Save Password</button>
    `
    : signedIn
    ? `
      <div class="cloud-account backup-account">
        <span>${esc(app.cloudEmail || "Signed in")}</span>
        <span>${esc(app.cloudStatus)}</span>
      </div>
      <button class="danger-btn cloud-full" data-action="cloudSignOut" ${app.cloudBusy ? "disabled" : ""}>${icon("account")} Sign Out</button>
    `
    : `
      ${mode === "code" || mode === "reset" ? "" : `
        <div class="auth-tabs" role="group" aria-label="Account mode">
          <button class="${mode === "signin" ? "active" : ""}" data-action="setAuthMode" data-mode="signin">Sign in</button>
          <button class="${mode === "signup" ? "active" : ""}" data-action="setAuthMode" data-mode="signup">Create</button>
        </div>
      `}
      <div class="field-group cloud-login">
        <div class="field-label">Email</div>
        <input class="field" id="cloud-email" type="email" inputmode="email" autocomplete="email" autocapitalize="off" spellcheck="false" placeholder="you@email.com" value="${attr(app.drafts.cloud.email)}">
      </div>
      ${mode === "reset" && app.drafts.cloud.resetSent ? `
        <div class="reset-card">
          <div class="reset-title">Check your email</div>
          <div class="reset-copy">We sent a reset link to ${esc(app.drafts.cloud.email)}. Open it to choose a new password, then come back here and sign in.</div>
        </div>
        <button class="secondary-btn cloud-full" data-action="setAuthMode" data-mode="signin">Back to Sign In</button>
      ` : mode === "reset" ? `
        <button class="primary-btn" id="send-reset-link" data-action="cloudResetPassword" ${app.cloudBusy || !isValidEmail(app.drafts.cloud.email) ? "disabled" : ""}>${icon("check")} Send Reset Link</button>
        <button class="text-btn auth-link" data-action="setAuthMode" data-mode="signin">Back to Sign In</button>
      ` : mode === "code" && app.drafts.cloud.codeSent ? `
        <div class="field-group cloud-login">
          <div class="field-label">Code</div>
          <input class="field code-field" id="cloud-code" type="text" inputmode="numeric" autocomplete="one-time-code" maxlength="6" placeholder="000000" value="${attr(app.drafts.cloud.code)}">
        </div>
        <div class="sheet-actions">
          <button class="secondary-btn" data-action="cloudLogin" ${app.cloudBusy ? "disabled" : ""}>Resend</button>
          <button class="primary-btn" data-action="cloudVerify" ${app.cloudBusy ? "disabled" : ""}>${icon("check")} Verify</button>
        </div>
      ` : `
        ${mode === "code" ? "" : `
          <div class="field-group cloud-login">
            <div class="field-label">Password</div>
            <input class="field" id="cloud-password" type="password" autocomplete="${mode === "signup" ? "new-password" : "current-password"}" placeholder="Password" value="${attr(app.drafts.cloud.password)}">
          </div>
        `}
        ${mode === "signup" ? `
          <button class="primary-btn" data-action="cloudCreateAccount" ${app.cloudBusy ? "disabled" : ""}>${icon("account")} Create Account</button>
        ` : mode === "code" ? `
          <button class="primary-btn" data-action="cloudLogin" ${app.cloudBusy ? "disabled" : ""}>${icon("check")} Send Code</button>
        ` : `
          <button class="primary-btn" data-action="cloudPasswordLogin" ${app.cloudBusy ? "disabled" : ""}>${icon("check")} Sign In</button>
          <button class="text-btn auth-link" data-action="setAuthMode" data-mode="reset">Forgot password?</button>
        `}
      `}
      ${mode === "reset" ? "" : `<button class="text-btn auth-link" data-action="setAuthMode" data-mode="${mode === "code" ? "signin" : "code"}">${mode === "code" ? "Use password instead" : "Use email code instead"}</button>`}
    `

  return `
    <div class="cloud-panel backup-panel ${signedIn ? "connected" : ""}">
      <div class="cloud-head">
        <div>
          <div class="cloud-kicker">Backup</div>
          <div class="cloud-title">${esc(statusTitle)}</div>
        </div>
        <span class="cloud-dot ${app.cloudBusy ? "busy" : signedIn ? "on" : ""}"></span>
      </div>
      <div class="data-note cloud-copy">
        ${statusCopy}
      </div>
      ${cloudMode}
      <div class="cloud-status">${
        recovering
          ? recoveryHint
          : signedIn
          ? "Everything saves automatically."
          : mode === "reset"
          ? app.drafts.cloud.resetSent ? "Use this same device if you can." : "For security, we only send a link if this email has an account."
          : esc(app.cloudStatus)
      }</div>
    </div>
  `
}

function renderBackupPanel() {
  return `
    <div class="account-panel">
      <div class="panel-head">
        <div>
          <div class="section-label">Backup</div>
          <div class="panel-title">Import & export</div>
        </div>
        ${icon("file", "", "panel-icon")}
      </div>
      <div class="data-grid">
        <button class="secondary-btn" data-action="exportJSON">${icon("download")} Export full JSON</button>
        <button class="secondary-btn" data-action="exportCSV">${icon("download")} Export this month CSV</button>
        <button class="danger-btn" data-action="importJSON">${icon("upload")} Import JSON</button>
      </div>
    </div>
  `
}

function renderToolCard(view, iconName, title, copy) {
  return `
    <button class="tool-card" data-action="go" data-view="${view}">
      ${icon(iconName, "", "tool-icon")}
      <span>
        <span class="tool-title">${esc(title)}</span>
        <span class="tool-copy">${esc(copy)}</span>
      </span>
    </button>
  `
}

function renderActionToolCard(action, iconName, title, copy, extras = "") {
  return `
    <button class="tool-card" data-action="${action}" ${extras}>
      ${icon(iconName, "", "tool-icon")}
      <span>
        <span class="tool-title">${esc(title)}</span>
        <span class="tool-copy">${esc(copy)}</span>
      </span>
    </button>
  `
}

function renderAccount() {
  const summary = getDataSummary()
  const signedIn = !!app.cloudUser
  const installed = isStandaloneApp()
  const monthsLabel = pluralize(summary.monthCount, "month")
  const txLabel = pluralize(summary.txCount, "transaction")
  const savedLabel = summary.saved && summary.saved !== "not saved yet" ? `saved ${summary.saved}` : "not saved yet"
  const cloudSubtitle = signedIn
    ? (app.cloudBusy ? "Syncing now…" : `Synced ${summary.cloudSaved}`)
    : "Sign in to keep your data backed up"
  const headerSubtitle = signedIn
    ? (app.cloudBusy
        ? "Syncing…"
        : (summary.cloudSaved && summary.cloudSaved !== "not synced yet"
            ? `Synced ${summary.cloudSaved}`
            : "Setting up backup…"))
    : "Local-first budget tracker"

  return `
    <section class="view">
      ${header("Account", headerSubtitle)}
      <div class="scroll account-scroll">
        <div class="account-card">
          <div class="account-avatar">${icon(signedIn ? "account" : "wallet")}</div>
          <div class="account-main">
            <div class="account-name">${signedIn ? esc(app.cloudEmail) : "Not signed in"}</div>
            <div class="account-meta">${esc(monthsLabel)} · ${esc(txLabel)} · ${esc(savedLabel)}</div>
          </div>
        </div>

        ${signedIn ? renderSharedSection() : ""}

        ${settingsSection("Tools",
          settingsRow({
            action: "go", view: "review",
            icon: "upload", tint: "acc",
            title: "Analyze Statements",
            copy: "Find what you can stop tracking"
          }),
          settingsRow({
            action: "openMethod", step: hasCompletedMethod() ? 1 : 0,
            icon: "wallet", tint: "grn",
            title: "Tracking Pool",
            copy: hasCompletedMethod() ? "Income minus stable monthly expenses" : "Income minus stable expenses"
          }),
          settingsRow({
            action: "go", view: "cats",
            icon: "grid", tint: "blue",
            title: "Budgets",
            copy: "Categories and monthly limits"
          }),
          settingsRow({
            action: "go", view: "presets",
            icon: "sparkles", tint: "amber",
            title: "Presets",
            copy: "Quick-add common expenses"
          }),
          settingsRow({
            action: "go", view: "wishes",
            icon: "heart", tint: "red",
            title: "Wishlist",
            copy: "Future purchases to save for"
          })
        )}

        <section class="settings-section">
          <div class="settings-section-label">Appearance</div>
          <div class="settings-card">
            <div class="settings-block">
              <div class="settings-block-title">Theme</div>
              ${renderThemeSegments()}
            </div>
          </div>
        </section>

        ${settingsSection("Data",
          settingsRow({
            action: "openCloudSheet",
            icon: "cloud", tint: signedIn ? "grn" : "acc",
            title: signedIn ? "Cloud backup" : "Sign in to back up",
            copy: cloudSubtitle
          }),
          settingsRow({
            action: "openExport",
            icon: "download", tint: "blue",
            title: "Export data",
            copy: "Pick range and budgets · CSV or Excel"
          })
        )}

        ${settingsSection("About",
          settingsRow({
            action: "openInstallCoach",
            icon: installed ? "check" : "phonePlus",
            tint: installed ? "grn" : "acc",
            title: installed ? "Installed on this device" : "Add to Home Screen",
            copy: installed ? "Running from your Home Screen" : "Use it like a native app"
          }),
          settingsRow({
            action: "openStory",
            icon: "info", tint: "blue",
            title: "Read Ezra's note",
            copy: "Why this app exists"
          })
        )}

        <div class="version-stamp">Budget Tracker · v${esc(APP_VERSION)}</div>
      </div>
      ${nav()}
    </section>
  `
}

function renderSharedSection() {
  const ws = app.shared.workspace
  const memberCount = app.shared.workspaceMembers.length
  const sharedBudgetCount = app.shared.budgets.length
  const pending = (app.shared.pendingInvites || []).filter(p => !(app.shared.declinedInviteTokens || []).includes(p.token))
  const pendingRow = pending.length ? settingsRow({
    action: "openPendingInvites",
    icon: "bell", tint: "amber",
    title: `${pending.length} pending invitation${pending.length === 1 ? "" : "s"}`,
    copy: pending.length === 1 ? "Tap to review" : "Someone wants to share with you"
  }) : ""

  if (!ws) {
    return settingsSection("Shared",
      pendingRow,
      settingsRow({
        action: "openCreateWorkspace",
        icon: "users", tint: "acc",
        title: "Create shared workspace",
        copy: "Invite a partner or family to share budgets"
      }),
      sharedBudgetCount > 0 ? settingsRow({
        action: "openManageWorkspace",
        icon: "share", tint: "blue",
        title: `${sharedBudgetCount} shared ${sharedBudgetCount === 1 ? "budget" : "budgets"}`,
        copy: "Tap a budget on Home to see members"
      }) : ""
    )
  }

  const roleLabel = ws.myRole === "owner" ? "Owner" : "Member"
  const others = Math.max(0, memberCount - 1)
  const budgetsPart = sharedBudgetCount === 0
    ? "no shared budgets yet"
    : `${sharedBudgetCount} shared ${sharedBudgetCount === 1 ? "budget" : "budgets"}`
  let workspaceCopy
  if (others === 0 && sharedBudgetCount === 0) {
    workspaceCopy = `${roleLabel} · invite someone to start`
  } else if (others === 0) {
    workspaceCopy = `${roleLabel} · just you · ${budgetsPart}`
  } else {
    workspaceCopy = `${roleLabel} · ${memberCount} ${memberCount === 1 ? "member" : "members"} · ${budgetsPart}`
  }

  return settingsSection("Shared",
    pendingRow,
    settingsRow({
      action: "openManageWorkspace",
      icon: "users", tint: "grn",
      title: ws.name,
      copy: workspaceCopy
    }),
    ws.myRole === "owner" ? settingsRow({
      action: "openInviteByEmailWorkspace",
      icon: "share", tint: "blue",
      title: "Invite someone",
      copy: "Send an email invitation"
    }) : settingsRow({
      action: "confirmLeaveWorkspace",
      icon: "doorOut", tint: "red",
      title: "Leave workspace",
      copy: "Stop seeing shared budgets"
    })
  )
}

function renderThemeSegments() {
  const themes = [
    { key: "auto", label: "Auto", desc: "Match system" },
    { key: "light", label: "Light", desc: "Always light" },
    { key: "dark", label: "Dark", desc: "Always dark" }
  ]
  return `
    <div class="theme-segments" role="group" aria-label="Theme">
      ${themes.map(t => `
        <button class="theme-chip ${app.theme === t.key ? "active" : ""}" data-action="setTheme" data-value="${attr(t.key)}" aria-pressed="${app.theme === t.key ? "true" : "false"}">
          <strong>${esc(t.label)}</strong>
          <small>${esc(t.desc)}</small>
        </button>
      `).join("")}
    </div>
  `
}

function renderThemePanel() {
  const themes = [
    { key: "auto", label: "Auto", desc: "Match system" },
    { key: "light", label: "Light", desc: "Always light" },
    { key: "dark", label: "Dark", desc: "Always dark" }
  ]
  return `
    <div class="account-panel">
      <div class="panel-head">
        <div>
          <div class="section-label">Appearance</div>
          <div class="panel-title">Theme</div>
        </div>
        ${icon("settings", "", "panel-icon")}
      </div>
      <div class="theme-segments" role="group" aria-label="Theme">
        ${themes.map(t => `
          <button class="theme-chip ${app.theme === t.key ? "active" : ""}" data-action="setTheme" data-value="${attr(t.key)}" aria-pressed="${app.theme === t.key ? "true" : "false"}">
            <strong>${esc(t.label)}</strong>
            <small>${esc(t.desc)}</small>
          </button>
        `).join("")}
      </div>
    </div>
  `
}

function setTheme(theme) {
  if (theme === app.theme) return
  applyTheme(theme)
  haptic("selection")
  render()
}

function renderModal() {
  if (!app.modal) {
    modalEl.classList.remove("show")
    modalEl.classList.remove("story-mode")
    modalEl.setAttribute("aria-hidden", "true")
    modalEl.innerHTML = ""
    return
  }

  modalEl.classList.add("show")
  modalEl.classList.toggle("story-mode", app.modal === "methodIntro" || app.modal === "installCoach")
  modalEl.setAttribute("aria-hidden", "false")

  if (app.modal === "catPicker") modalEl.innerHTML = renderCatPickerModal()
  if (app.modal === "budgetEdit") modalEl.innerHTML = renderBudgetEditModal()
  if (app.modal === "presetEdit") modalEl.innerHTML = renderPresetEditModal()
  if (app.modal === "entryEdit") modalEl.innerHTML = renderEntryEditModal()
  if (app.modal === "wishEdit") modalEl.innerHTML = renderWishEditModal()
  if (app.modal === "data") modalEl.innerHTML = renderDataModal()
  if (app.modal === "methodIntro") modalEl.innerHTML = renderMethodIntroModal()
  if (app.modal === "installCoach") modalEl.innerHTML = renderInstallCoachModal()
  if (app.modal === "method") modalEl.innerHTML = renderMethodModal()
  if (app.modal === "iconPicker") modalEl.innerHTML = renderIconPickerModal()
  if (app.modal === "categoryHistory") modalEl.innerHTML = renderCategoryHistoryModal()
  if (app.modal === "confirm") modalEl.innerHTML = renderConfirmModal()
  if (app.modal === "quickAdd") modalEl.innerHTML = renderQuickAddModal()
  if (app.modal === "cloud") modalEl.innerHTML = renderCloudModal()
  if (app.modal === "createWorkspace") modalEl.innerHTML = renderCreateWorkspaceModal()
  if (app.modal === "manageWorkspace") modalEl.innerHTML = renderManageWorkspaceModal()
  if (app.modal === "shareBudget") modalEl.innerHTML = renderShareBudgetModal()
  if (app.modal === "acceptInvite") modalEl.innerHTML = renderAcceptInviteModal()
  if (app.modal === "inviteLink") modalEl.innerHTML = renderInviteLinkModal()
  if (app.modal === "manageBudgetMembers") modalEl.innerHTML = renderManageBudgetMembersModal()
  if (app.modal === "sharedBudgetEdit") modalEl.innerHTML = renderSharedBudgetEditModal()
  if (app.modal === "inviteByEmail") modalEl.innerHTML = renderInviteByEmailModal()
  if (app.modal === "pendingInvites") modalEl.innerHTML = renderPendingInvitesModal()
  if (app.modal === "confirmDeleteByName") modalEl.innerHTML = renderConfirmDeleteByNameModal()
  if (app.modal === "export") modalEl.innerHTML = renderExportModal()
}

function renderExportModal() {
  const d = app.exportDraft || defaultExportDraft()
  const allBudgets = allKnownBudgetsForExport()
  const isAllSelected = d.selectedBudgetIds === null
  const isBudgetSelected = id => isAllSelected || (d.selectedBudgetIds && d.selectedBudgetIds.has(id))
  const selectedCount = isAllSelected ? allBudgets.length : (d.selectedBudgetIds ? d.selectedBudgetIds.size : 0)

  const ranges = [
    ["thisMonth", "This month"],
    ["last3", "Last 3 months"],
    ["last6", "Last 6 months"],
    ["thisYear", "This year"],
    ["all", "All time"]
  ]

  return `
    <div class="sheet export-sheet" role="dialog" aria-modal="true" aria-label="Export data">
      <div class="sheet-top">
        <div class="sheet-title">Export data</div>
        <button class="sheet-close" aria-label="Close" data-action="closeModal">${icon("close")}</button>
      </div>

      <div class="export-section">
        <div class="export-section-label">Format</div>
        <div class="export-segments">
          <button class="export-chip ${d.format === "excel" ? "active" : ""}" data-action="setExportFormat" data-value="excel">${icon("spreadsheet")} Excel</button>
          <button class="export-chip ${d.format === "csv" ? "active" : ""}" data-action="setExportFormat" data-value="csv">${icon("file")} CSV</button>
        </div>
      </div>

      <div class="export-section">
        <div class="export-section-label">Date range</div>
        <div class="export-chips-row">
          ${ranges.map(([k, l]) => `
            <button class="export-chip ${d.range === k ? "active" : ""}" data-action="setExportRange" data-value="${k}">${esc(l)}</button>
          `).join("")}
        </div>
      </div>

      <div class="export-section">
        <div class="export-section-label">Type</div>
        <div class="export-segments">
          <button class="export-chip ${d.type === "all" ? "active" : ""}" data-action="setExportType" data-value="all">All</button>
          <button class="export-chip ${d.type === "private" ? "active" : ""}" data-action="setExportType" data-value="private">Private</button>
          <button class="export-chip ${d.type === "shared" ? "active" : ""}" data-action="setExportType" data-value="shared">Shared</button>
        </div>
      </div>

      ${allBudgets.length ? `
        <div class="export-section">
          <div class="export-section-head">
            <div class="export-section-label">Budgets · ${selectedCount}/${allBudgets.length}</div>
            <button class="export-section-action" data-action="toggleAllExportBudgets">${isAllSelected ? "Clear all" : "Select all"}</button>
          </div>
          <div class="export-budgets">
            ${allBudgets.map(b => {
              const selected = isBudgetSelected(b.id)
              const color = cssColor(b.color)
              return `
                <button class="export-budget-chip ${selected ? "active" : ""}" data-action="toggleExportBudget" data-id="${attr(b.id)}" style="--cat:${color};--cat-soft:${color}1A">
                  <span class="export-budget-emoji">${esc(b.icon || "·")}</span>
                  <span class="export-budget-name clamp-1">${esc(b.label)}</span>
                </button>
              `
            }).join("")}
          </div>
        </div>
      ` : ""}

      <button class="primary-btn export-go" data-action="runExport">${icon("download")} Export</button>
    </div>
  `
}

function renderConfirmDeleteByNameModal() {
  const ctx = app.confirmDeleteCtx
  if (!ctx) { closeModal(); return "" }
  const typed = String(ctx.typed || "").trim()
  const matches = typed.length > 0 && typed === String(ctx.targetName)
  return `
    <div class="sheet confirm-sheet confirm-by-name-sheet" role="alertdialog" aria-modal="true" aria-label="Confirm deletion">
      <div class="confirm-head">
        <div class="confirm-title">Delete "${esc(ctx.targetName)}"?</div>
        ${ctx.body ? `<div class="confirm-body">${esc(ctx.body)}</div>` : ""}
        <div class="confirm-body confirm-type-hint">Type <strong>${esc(ctx.targetName)}</strong> below to confirm.</div>
      </div>
      <input class="field confirm-name-field" id="confirm-name-field" type="text" autocomplete="off" autocapitalize="off" spellcheck="false" autocorrect="off" placeholder="${esc(ctx.targetName)}" value="${attr(ctx.typed || "")}">
      <div class="confirm-actions">
        <button class="secondary-btn" data-action="closeModal">Cancel</button>
        <button class="danger-btn" id="confirm-delete-by-name-btn" data-action="confirmDeleteByNameYes" ${matches ? "" : "disabled"}>Delete</button>
      </div>
    </div>
  `
}

function confirmDeleteByName(options = {}) {
  app.confirmDeleteCtx = {
    targetName: String(options.targetName || ""),
    typed: "",
    body: options.body || "",
    onConfirm: typeof options.onConfirm === "function" ? options.onConfirm : () => {}
  }
  app.modal = "confirmDeleteByName"
  haptic("warning")
  renderModal()
  setTimeout(() => {
    const el = document.getElementById("confirm-name-field")
    if (el) el.focus()
  }, 280)
}

function doConfirmDeleteByNameYes() {
  const ctx = app.confirmDeleteCtx
  if (!ctx) { closeModal(); return }
  const typed = String(ctx.typed || "").trim()
  if (typed !== String(ctx.targetName)) {
    toast("Type the name exactly")
    return
  }
  const fn = ctx.onConfirm
  app.confirmDeleteCtx = null
  app.modal = null
  renderModal()
  try { fn() } catch (_) {}
}

function renderInviteByEmailModal() {
  const scope = app.inviteEmailScope || {}
  const isWorkspace = !!scope.workspaceId
  const contextName = isWorkspace
    ? (app.shared.workspace ? app.shared.workspace.name : "workspace")
    : (sharedBudgetById(scope.budgetId) ? sharedBudgetById(scope.budgetId).label : "budget")
  const draft = app.inviteEmailDraft || ""
  const valid = isLikelyEmail(draft)

  return `
    <div class="sheet share-sheet" role="dialog" aria-modal="true" aria-label="Invite by email">
      <div class="sheet-top">
        <div class="sheet-title">Invite to ${esc(contextName)}</div>
        <button class="sheet-close" aria-label="Close" data-action="closeModal">${icon("close")}</button>
      </div>
      <div class="share-intro">
        <div class="share-icon">${icon("users")}</div>
        <p>Type the email of the person you want to invite. They'll see the invitation when they open Budget Tracker.</p>
      </div>
      <div class="field-group">
        <div class="field-label">Email</div>
        <input class="field" id="invite-email-field" type="email" inputmode="email" autocomplete="email" autocapitalize="off" spellcheck="false" placeholder="them@example.com" value="${attr(draft)}">
      </div>
      <button class="primary-btn" id="invite-email-send" data-action="sendEmailInvite" ${valid ? "" : "disabled"}>${icon("check")} Send invite</button>
      <div class="share-warn">
        ${icon("info")}
        <span>They must use the same email when they sign in to see the invitation.</span>
      </div>
    </div>
  `
}

function renderPendingInvitesModal() {
  const list = (app.shared.pendingInvites || []).filter(p => !(app.shared.declinedInviteTokens || []).includes(p.token))
  return `
    <div class="sheet share-sheet" role="dialog" aria-modal="true" aria-label="Pending invitations">
      <div class="sheet-top">
        <div class="sheet-title">Pending invitations</div>
        <button class="sheet-close" aria-label="Close" data-action="closeModal">${icon("close")}</button>
      </div>
      ${list.length ? `
        <div class="members-list">
          ${list.map(p => {
            const name = p.workspaceName || p.budgetLabel || "Shared budget"
            const kind = p.workspaceId ? "Workspace" : "Budget"
            return `
              <div class="member-row pending-invite-row">
                <span class="member-avatar">${esc(initialsFromEmail(p.inviterEmail || "?"))}</span>
                <span class="member-main">
                  <span class="member-email clamp-1">${esc(p.inviterEmail || "Unknown")}</span>
                  <span class="member-role">${esc(kind)} · ${esc(name)}</span>
                </span>
                <span class="pending-invite-actions">
                  <button class="secondary-btn pending-invite-decline" data-action="declineInviteByToken" data-id="${attr(p.token)}">Decline</button>
                  <button class="primary-btn pending-invite-join" data-action="acceptInviteByToken" data-id="${attr(p.token)}">Join</button>
                </span>
              </div>
            `
          }).join("")}
        </div>
      ` : `<div class="empty compact-empty"><div class="empty-title">No pending invitations</div></div>`}
    </div>
  `
}

function renderSharedBudgetEditModal() {
  const budget = sharedBudgetById(app.editingBudgetId)
  if (!budget) { closeModal(); return "" }
  const members = budget.workspaceId
    ? (app.shared.workspaceMembers || [])
    : (app.shared.budgetMembers[budget.id] || [])
  const memberCount = members.length

  return `
    <div class="sheet" role="dialog" aria-modal="true" aria-label="Edit shared budget">
      <div class="sheet-top">
        <div class="sheet-title">Edit shared budget</div>
        <button class="sheet-close" aria-label="Close" data-action="closeModal">${icon("close")}</button>
      </div>
      <div class="shared-badge">${icon("users")} Shared · ${memberCount} ${memberCount === 1 ? "member" : "members"}${budget.workspaceId ? ` · ${esc(app.shared.workspace ? app.shared.workspace.name : "")}` : ""}</div>
      <div class="two-col icon-name-grid">
        ${iconPickerButton("budgetEdit")}
        <input class="field" id="budget-edit-label" type="text" placeholder="Name" value="${attr(app.drafts.budgetEdit.label)}">
      </div>
      <div class="field-group">
        <div class="field-label">Monthly limit</div>
        <input class="field" id="budget-edit-amount" type="number" inputmode="decimal" placeholder="$0.00" value="${attr(app.drafts.budgetEdit.budget)}">
      </div>
      <button class="primary-btn" data-action="saveSharedBudgetEdit">${icon("check")} Save budget</button>
      ${budget.workspaceId
        ? ""
        : `<button class="secondary-btn cloud-full" data-action="openBudgetMembers" data-id="${attr(budget.id)}">${icon("users")} Manage members</button>`}
      <button class="secondary-btn cloud-full" data-action="openInviteByEmailBudget" data-id="${attr(budget.id)}">${icon("share")} Invite by email</button>
      <button class="secondary-btn cloud-full" data-action="openConvertSharedToLocal" data-id="${attr(budget.id)}">${icon("doorOut")} Stop sharing &mdash; keep my copy</button>
      <button class="danger-btn cloud-full danger-final" data-action="confirmDeleteSharedBudget" data-id="${attr(budget.id)}">${icon("trash")} Delete for everyone</button>
    </div>
  `
}

async function doSaveSharedBudgetEdit() {
  const budget = sharedBudgetById(app.editingBudgetId)
  if (!budget) { closeModal(); return }
  const label = String(app.drafts.budgetEdit.label || "").trim()
  const monthly = Number(app.drafts.budgetEdit.budget) || 0
  const iconValue = String(app.drafts.budgetEdit.icon || "").trim() || "🏷️"
  if (!label || monthly <= 0) {
    toast("Check the budget details")
    return
  }
  const ok = await sharedUpdateBudget(budget.id, {
    label,
    monthly_budget: monthly,
    icon: iconValue
  })
  if (!ok) { haptic("error"); return }
  closeModal(false)
  render()
  haptic("success")
  toast("Budget updated")
}

function doConfirmDeleteSharedBudget(budgetId) {
  const budget = sharedBudgetById(budgetId)
  if (!budget) return
  confirmDeleteByName({
    targetName: budget.label,
    body: "Every member loses access. If you want to keep your own copy, use 'Stop sharing' instead.",
    onConfirm: async () => {
      const ok = await sharedDeleteBudget(budgetId)
      if (!ok) { haptic("error"); return }
      render()
      haptic("warning")
      undoToast(`Deleted "${budget.label}"`, async () => {
        const restored = await sharedRestoreBudget(budgetId)
        if (restored) {
          render()
          toast("Restored")
        } else {
          toast("Could not restore")
        }
      })
    }
  })
}

function doConvertSharedToLocal(budgetId) {
  const budget = sharedBudgetById(budgetId)
  if (!budget) return
  const signedIn = !!app.cloudUser
  confirmSheet({
    title: `Stop sharing "${budget.label}"?`,
    body: signedIn
      ? "All transactions come back to your private budgets. Other members lose access. Your data stays backed up to your cloud account."
      : "All transactions come back to your private budgets. Other members lose access. Sign in to keep a cloud backup.",
    primaryLabel: "Stop sharing",
    destructive: false,
    onConfirm: async () => {
      const ok = await sharedConvertSharedToLocal(budgetId)
      if (!ok) { haptic("error"); return }
      closeModal(false)
      render()
      haptic("success")
      toast(signedIn ? `"${budget.label}" is now private · backed up` : `"${budget.label}" is now private`)
    }
  })
}

function renderCreateWorkspaceModal() {
  const name = app.shareDraft.name || ""
  return `
    <div class="sheet share-sheet" role="dialog" aria-modal="true" aria-label="Create shared workspace">
      <div class="sheet-top">
        <div class="sheet-title">Create shared workspace</div>
        <button class="sheet-close" aria-label="Close" data-action="closeModal">${icon("close")}</button>
      </div>
      <div class="share-intro">
        <div class="share-icon">${icon("users")}</div>
        <p>A workspace lets you share budgets with one or more people. Everyone you invite sees the same budgets and transactions.</p>
      </div>
      <div class="field-group">
        <div class="field-label">Workspace name</div>
        <input class="field" id="workspace-name" type="text" autocomplete="off" placeholder="Familia, Pareja, Roomies…" value="${attr(name)}" maxlength="40">
      </div>
      <button class="primary-btn" id="create-workspace-btn" data-action="createWorkspace" ${name.trim() ? "" : "disabled"}>${icon("check")} Create workspace</button>
    </div>
  `
}

function renderManageWorkspaceModal() {
  const ws = app.shared.workspace
  if (!ws) { closeModal(); return "" }
  const members = app.shared.workspaceMembers || []
  const isOwner = ws.myRole === "owner"

  return `
    <div class="sheet share-sheet" role="dialog" aria-modal="true" aria-label="Manage workspace">
      <div class="sheet-top">
        <div class="sheet-title">${esc(ws.name)}</div>
        <button class="sheet-close" aria-label="Close" data-action="closeModal">${icon("close")}</button>
      </div>

      <div class="share-meta">${esc(isOwner ? "You are the owner" : "You are a member")} · ${members.length} ${members.length === 1 ? "member" : "members"}</div>

      <div class="members-list">
        ${members.map(m => {
          const isMe = app.cloudUser && m.user_id === app.cloudUser.id
          const isWsOwner = m.user_id === ws.ownerId
          return `
            <div class="member-row">
              <span class="member-avatar">${esc(initialsFromEmail(m.display_email || "—"))}</span>
              <span class="member-main">
                <span class="member-email clamp-1">${esc(m.display_email || "Unknown")}${isMe ? " · you" : ""}</span>
                <span class="member-role">${esc(isWsOwner ? "Owner" : "Member")}</span>
              </span>
              ${isOwner && !isWsOwner ? `<button class="member-remove" data-action="removeWorkspaceMember" data-id="${attr(m.user_id)}" aria-label="Remove">${icon("close")}</button>` : ""}
            </div>
          `
        }).join("")}
      </div>

      ${isOwner
        ? `<button class="primary-btn" data-action="openInviteByEmailWorkspace">${icon("share")} Invite by email</button>`
        : `<button class="danger-btn cloud-full" data-action="confirmLeaveWorkspace">${icon("doorOut")} Leave workspace</button>`}
    </div>
  `
}

function renderShareBudgetModal() {
  const budget = rawCategoryById(app.shareTargetBudgetId)
  if (!budget) { closeModal(); return "" }
  const hasWorkspace = !!app.shared.workspace
  const wsLabel = hasWorkspace ? app.shared.workspace.name : null

  return `
    <div class="sheet share-sheet" role="dialog" aria-modal="true" aria-label="Share budget">
      <div class="sheet-top">
        <div class="sheet-title">Share "${esc(budget.label)}"</div>
        <button class="sheet-close" aria-label="Close" data-action="closeModal">${icon("close")}</button>
      </div>
      <div class="share-intro">
        <div class="share-icon">${icon("share")}</div>
        <p>This budget will move to the cloud. You and anyone you invite will see the same transactions in real time on next sync.</p>
      </div>
      <div class="share-options">
        <button class="share-option" data-action="shareLocalToWorkspace" data-id="${attr(budget.id)}">
          <span class="share-option-icon">${icon("users")}</span>
          <span class="share-option-main">
            <span class="share-option-title">${hasWorkspace ? `Add to ${esc(wsLabel)}` : "Create a shared workspace"}</span>
            <span class="share-option-copy">${hasWorkspace ? "All members of your workspace see this budget" : "Start a new workspace and add this budget"}</span>
          </span>
          ${icon("chevron")}
        </button>
        <button class="share-option" data-action="shareLocalStandalone" data-id="${attr(budget.id)}">
          <span class="share-option-icon">${icon("link")}</span>
          <span class="share-option-main">
            <span class="share-option-title">Share just this budget</span>
            <span class="share-option-copy">Send one invite link for this single budget</span>
          </span>
          ${icon("chevron")}
        </button>
      </div>
      <div class="share-warn">
        ${icon("info")}
        <span>Shared budgets live in the cloud and need internet to use. You can stop sharing and bring it back to your private budgets anytime — your data stays backed up either way.</span>
      </div>
    </div>
  `
}

function renderAcceptInviteModal() {
  const pi = app.shared.pendingInvite
  if (!pi) { closeModal(); return "" }
  const targetKind = pi.workspaceId ? "workspace" : "budget"
  const targetName = pi.workspaceName || pi.budgetLabel || "a shared budget"
  const inviterEmail = pi.inviterEmail || "Someone"
  const expiresIn = pi.expiresAt ? expiresInLabel(pi.expiresAt) : ""

  return `
    <div class="sheet accept-invite-sheet" role="dialog" aria-modal="true" aria-label="Accept invitation">
      <div class="accept-invite-icon">${icon("users")}</div>
      <div class="accept-invite-title">${esc(inviterEmail)} invited you</div>
      <div class="accept-invite-body">to join <strong>${esc(targetName)}</strong>${targetKind === "workspace" ? "" : " (single budget)"} as <strong>${esc(pi.role || "Member")}</strong>.</div>
      ${expiresIn ? `<div class="accept-invite-meta">Expires ${esc(expiresIn)}</div>` : ""}
      <div class="confirm-actions">
        <button class="secondary-btn" data-action="declinePendingInvite">Decline</button>
        <button class="primary-btn" data-action="acceptPendingInvite">${icon("check")} Join</button>
      </div>
    </div>
  `
}

function expiresInLabel(iso) {
  const ms = new Date(iso).getTime() - Date.now()
  if (ms <= 0) return "just now"
  const days = Math.round(ms / 86400000)
  if (days < 1) {
    const hrs = Math.round(ms / 3600000)
    return `in ${hrs} ${hrs === 1 ? "hour" : "hours"}`
  }
  return `in ${days} ${days === 1 ? "day" : "days"}`
}

function renderInviteLinkModal() {
  const url = app.inviteShareLink || ""
  const contextName = app.inviteShareContextName || "Shared"
  const expiresIso = app.inviteShareLinkExpiresAt
  const expiresStr = expiresIso ? expiresInLabel(expiresIso) : "in 14 days"

  return `
    <div class="sheet share-sheet" role="dialog" aria-modal="true" aria-label="Invite link">
      <div class="sheet-top">
        <div class="sheet-title">Invite to ${esc(contextName)}</div>
        <button class="sheet-close" aria-label="Close" data-action="closeModal">${icon("close")}</button>
      </div>
      <div class="share-intro">
        <div class="share-icon">${icon("link")}</div>
        <p>Anyone who opens this link in the app and signs in will join as a Member. Link expires ${esc(expiresStr)}.</p>
      </div>
      <div class="invite-link-box">
        <input class="field invite-link-input" id="invite-link-field" type="text" readonly value="${attr(url)}">
        <button class="primary-btn" data-action="copyInviteLink" data-value="${attr(url)}">${icon("copy")} Copy</button>
      </div>
      ${navigator.share ? `<button class="secondary-btn cloud-full" data-action="shareInviteSystem" data-value="${attr(url)}">${icon("share")} Share via…</button>` : ""}
    </div>
  `
}

function renderManageBudgetMembersModal() {
  const budget = sharedBudgetById(app.shareTargetBudgetId)
  if (!budget) { closeModal(); return "" }
  const members = app.shared.budgetMembers[budget.id] || []
  const isOwner = budget.myRole === "owner"

  return `
    <div class="sheet share-sheet" role="dialog" aria-modal="true" aria-label="Manage members">
      <div class="sheet-top">
        <div class="sheet-title">${esc(budget.label)}</div>
        <button class="sheet-close" aria-label="Close" data-action="closeModal">${icon("close")}</button>
      </div>
      <div class="share-meta">${members.length} ${members.length === 1 ? "member" : "members"}</div>

      <div class="members-list">
        ${members.map(m => {
          const isMe = app.cloudUser && m.user_id === app.cloudUser.id
          const isBudgetOwner = m.user_id === budget.ownerId
          return `
            <div class="member-row">
              <span class="member-avatar">${esc(initialsFromEmail(m.display_email || "—"))}</span>
              <span class="member-main">
                <span class="member-email clamp-1">${esc(m.display_email || "Unknown")}${isMe ? " · you" : ""}</span>
                <span class="member-role">${esc(isBudgetOwner ? "Owner" : "Member")}</span>
              </span>
              ${isOwner && !isBudgetOwner ? `<button class="member-remove" data-action="removeBudgetMember" data-id="${attr(m.user_id)}" aria-label="Remove">${icon("close")}</button>` : ""}
            </div>
          `
        }).join("")}
      </div>

      ${isOwner
        ? `<button class="primary-btn" data-action="openInviteByEmailBudget" data-id="${attr(budget.id)}">${icon("share")} Invite by email</button>`
        : `<button class="danger-btn cloud-full" data-action="confirmLeaveBudget" data-id="${attr(budget.id)}">${icon("doorOut")} Leave budget</button>`}
    </div>
  `
}

function renderCloudModal() {
  return `
    <div class="sheet cloud-sheet" role="dialog" aria-modal="true" aria-label="Cloud backup">
      <div class="sheet-top">
        <div class="sheet-title">Cloud backup</div>
        <button class="sheet-close" aria-label="Close" data-action="closeModal">${icon("close")}</button>
      </div>
      ${renderCloudPanel()}
    </div>
  `
}

function openCloudSheet() {
  haptic("light")
  app.modal = "cloud"
  renderModal()
}

function renderQuickAddModal() {
  const budgets = app.state.budgets || []
  const presets = (app.state.presets || []).filter(p => categoryById(p.cat))
  const selected = app.selectedCat ? categoryById(app.selectedCat) : null
  const amountValue = app.drafts.add.amt
  const displayAmt = amountValue ? fmt(Number(amountValue) || 0) : "$0.00"
  const addDate = clampExpenseDateISO(app.drafts.add.dateISO)

  return `
    <div class="sheet quick-sheet" role="dialog" aria-modal="true" aria-label="Log a leak">
      <div class="sheet-top">
        <div class="sheet-title">Log a leak</div>
        <button class="sheet-close" aria-label="Close" data-action="closeModal">${icon("close")}</button>
      </div>

      <div class="quick-amount-display ${amountValue ? "filled" : ""}" data-value="${attr(amountValue || "0")}">${esc(displayAmt)}</div>

      <input class="field quick-amount-input" id="add-amt" type="number" inputmode="decimal" placeholder="$0.00" value="${attr(amountValue)}" autocomplete="off">

      <div class="field-group quick-date-group">
        <div class="field-label">Date</div>
        <input class="field date-field" id="add-date" type="date" max="${attr(todayISO())}" value="${attr(addDate)}">
        <div class="field-hint" id="add-date-hint">${esc(dateFriendlyLabel(addDate))}</div>
      </div>

      ${presets.length ? `
        <div class="section-label quick-section-label">Quick presets</div>
        <div class="quick-preset-row">
          ${presets.map(preset => {
            const cat = categoryById(preset.cat) || {}
            const color = cssColor(cat.color || "#0F766E")
            return `
              <button class="preset-btn quick-preset" style="--cat:${color};--cat-soft:${color}16" data-action="usePreset" data-id="${attr(preset.id)}">
                <span class="preset-emoji">${esc(preset.icon || cat.icon || "⚡")}</span>
                <span class="preset-copy clamp-1">${esc(preset.desc)}</span>
                <span class="preset-amt">${fmt(preset.amt)}</span>
              </button>
            `
          }).join("")}
        </div>
      ` : ""}

      <div class="section-label quick-section-label">Category</div>
      <div class="quick-cat-row">
        ${budgets.map(cat => {
          const color = cssColor(cat.color)
          const active = selected && selected.id === cat.id
          return `
            <button class="quick-cat ${active ? "active" : ""}" data-action="chooseQuickCat" data-id="${attr(cat.id)}" style="--cat:${color};--cat-soft:${color}1A">
              <span class="quick-cat-emoji">${esc(cat.icon)}</span>
              <span class="quick-cat-label clamp-1">${esc(cat.label)}</span>
            </button>
          `
        }).join("")}
      </div>

      <input class="field quick-desc" id="add-desc" type="text" placeholder="${selected ? `What was the ${esc(selected.label).toLowerCase()} for?` : "What was it?"}" value="${attr(app.drafts.add.desc)}" autocomplete="off">

      <button class="primary-btn quick-save" id="save-expense" data-action="saveQuickExpense" ${canSaveExpense() ? "" : "disabled"}>${icon("check")} Save</button>

      ${selected ? renderCategoryHistoryCompact(selected, { compact: true }) : ""}
    </div>
  `
}

function openQuickAdd() {
  haptic("light")
  app.modal = "quickAdd"
  renderModal()
  setTimeout(() => {
    const amt = document.getElementById("add-amt")
    if (amt) amt.focus()
  }, 280)
}

function chooseQuickCat(id) {
  if (!categoryById(id)) return
  haptic("selection")
  app.selectedCat = id
  renderModal()
}

async function saveQuickExpense() {
  const amount = Number(app.drafts.add.amt)
  const cat = categoryById(app.selectedCat)
  if (!cat || amount <= 0) return

  const description = app.drafts.add.desc.trim() || cat.label
  const selectedDate = clampExpenseDateISO(app.drafts.add.dateISO)
  const targetKey = monthKeyFromISO(selectedDate)

  if (cat.shared) {
    const result = await sharedAddTransaction(cat.id, {
      amount,
      description,
      occurredOn: selectedDate
    })
    if (!result) {
      haptic("error")
      return
    }
    app.drafts.add = freshAddDraft()
    app.selectedCat = null
    if (targetKey !== app.key) app.view = "log"
    closeModal(false)
    render()
    haptic("success")
    toast(targetKey === app.key ? "Logged" : `Logged for ${monthShortLabel(targetKey)}`)
    return
  }

  if (!Array.isArray(app.data[targetKey])) app.data[targetKey] = []
  app.data[targetKey].push({
    id: Date.now() + Math.floor(Math.random() * 1000),
    cat: cat.id,
    amt: amount,
    desc: description,
    date: dateLabelFromISO(selectedDate),
    dateISO: selectedDate
  })
  markActiveMonth(app.data, targetKey)

  app.drafts.add = freshAddDraft()
  app.selectedCat = null
  if (targetKey !== app.key) app.view = "log"
  closeModal(false)
  saveData(app.data)
  render()
  haptic("success")
  toast(targetKey === app.key ? "Logged" : `Logged for ${monthShortLabel(targetKey)}`)
}

function renderCatPickerModal() {
  return `
    <div class="sheet" role="dialog" aria-modal="true" aria-label="Change category">
      <div class="sheet-top">
        <div class="sheet-title">Change category</div>
        <button class="sheet-close" aria-label="Close" data-action="closeModal">${icon("close")}</button>
      </div>
      <div class="item-list">
        ${app.state.budgets.length ? app.state.budgets.map(cat => {
          const color = cssColor(cat.color)
          return `
            <button class="selected-cat" style="--cat:${color};border-color:${app.selectedCat === cat.id ? color : "var(--bord)"};background:${app.selectedCat === cat.id ? color + "10" : "var(--card)"}" data-action="chooseCat" data-id="${attr(cat.id)}">
              <span class="emoji-box" style="background:${color}16;color:${color}">${esc(cat.icon)}</span>
              <span class="label">${esc(cat.label)}</span>
              <span class="cat-budget">${fmt(cat.budget)}</span>
            </button>
          `
        }).join("") : `
          <div class="empty compact-empty">
            <div class="empty-title">No leak budgets yet</div>
            <div class="row-meta">Create your own categories first.</div>
            <button class="secondary-btn empty-action" data-action="go" data-view="cats">${icon("add")} Create Budget</button>
          </div>
        `}
      </div>
    </div>
  `
}

function renderEntryEditModal() {
  const entry = entryById(app.editingEntryId)
  if (!entry) {
    closeModal()
    return ""
  }
  const editDate = clampExpenseDateISO(app.drafts.edit.dateISO || entry.dateISO || entry.occurredOn)

  return `
    <div class="sheet" role="dialog" aria-modal="true" aria-label="Edit expense">
      <div class="sheet-top">
        <div class="sheet-title">Edit expense</div>
        <button class="sheet-close" aria-label="Close" data-action="closeModal">${icon("close")}</button>
      </div>
      <div class="field-group">
        <div class="field-label">Description</div>
        <input class="field" id="edit-desc" type="text" placeholder="Description" value="${attr(app.drafts.edit.desc)}">
      </div>
      <div class="field-group">
        <div class="field-label">Amount</div>
        <input class="field" id="edit-amt" type="number" inputmode="decimal" placeholder="$0.00" value="${attr(app.drafts.edit.amt)}">
      </div>
      <div class="field-group">
        <div class="field-label">Date</div>
        <input class="field date-field" id="edit-date" type="date" max="${attr(todayISO())}" value="${attr(editDate)}">
        <div class="field-hint" id="edit-date-hint">${esc(dateFriendlyLabel(editDate))}</div>
      </div>
      <div class="field-label">Category</div>
      <div class="pill-wrap">
        ${renderCategoryPills(app.editingCat, "pickEditCat")}
      </div>
      <div class="sheet-actions">
        <button class="danger-btn" data-action="deleteEditingEntry">${icon("trash")} Delete</button>
        <button class="primary-btn" data-action="saveEditingEntry">${icon("check")} Save</button>
      </div>
      <button class="secondary-btn" style="width:100%;margin-top:8px" data-action="saveEditingAsPreset">${icon("settings")} Save as preset</button>
    </div>
  `
}

function renderCategoryHistoryEditModal(cat) {
  const entry = entryById(app.editingEntryId)
  if (!entry) {
    app.categoryHistory.mode = "list"
    return renderCategoryHistoryModal()
  }
  const editDate = clampExpenseDateISO(app.drafts.edit.dateISO || entry.dateISO || entry.occurredOn)
  const currentCat = categoryById(app.editingCat) || cat

  return `
    <div class="sheet category-history-sheet history-edit-sheet" role="dialog" aria-modal="true" aria-label="Edit transaction">
      <div class="sheet-top">
        <button class="back-btn compact-back" aria-label="Back" data-action="backCategoryHistory">${icon("back")}</button>
        <div class="sheet-title">Edit transaction</div>
        <button class="sheet-close" aria-label="Close" data-action="closeModal">${icon("close")}</button>
      </div>
      <div class="history-edit-context" style="--cat:${cssColor(currentCat.color || cat.color)};--cat-soft:${cssColor(currentCat.color || cat.color)}16">
        <span class="emoji-box">${esc(currentCat.icon || "·")}</span>
        <span>
          <strong>${esc(currentCat.label || "Budget")}</strong>
          <small>${entry.shared ? "Shared transaction" : "Local transaction"}</small>
        </span>
      </div>
      <div class="field-group">
        <div class="field-label">Description</div>
        <input class="field" id="edit-desc" type="text" placeholder="Description" value="${attr(app.drafts.edit.desc)}">
      </div>
      <div class="field-group">
        <div class="field-label">Amount</div>
        <input class="field" id="edit-amt" type="number" inputmode="decimal" placeholder="$0.00" value="${attr(app.drafts.edit.amt)}">
      </div>
      <div class="field-group">
        <div class="field-label">Date</div>
        <input class="field date-field" id="edit-date" type="date" max="${attr(todayISO())}" value="${attr(editDate)}">
        <div class="field-hint" id="edit-date-hint">${esc(dateFriendlyLabel(editDate))}</div>
      </div>
      <div class="field-label">Category</div>
      ${entry.shared ? `
        <div class="history-shared-note">
          <strong>${esc(cat.label)}</strong>
          <span>Shared transactions stay in this budget.</span>
        </div>
      ` : `
        <div class="pill-wrap">
          ${renderCategoryPills(app.editingCat, "pickEditCat")}
        </div>
      `}
      <div class="sheet-actions">
        <button class="danger-btn" data-action="deleteCategoryHistoryEntry">${icon("trash")} Delete</button>
        <button class="primary-btn" data-action="saveCategoryHistoryEntry">${icon("check")} Save</button>
      </div>
    </div>
  `
}

function renderBudgetEditModal() {
  const budget = rawCategoryById(app.editingBudgetId)
  if (!budget) {
    closeModal()
    return ""
  }

  return `
    <div class="sheet" role="dialog" aria-modal="true" aria-label="Edit budget">
      <div class="sheet-top">
        <div class="sheet-title">Edit budget</div>
        <button class="sheet-close" aria-label="Close" data-action="closeModal">${icon("close")}</button>
      </div>
      <div class="two-col icon-name-grid">
        ${iconPickerButton("budgetEdit")}
        <input class="field" id="budget-edit-label" type="text" placeholder="Name" value="${attr(app.drafts.budgetEdit.label)}">
      </div>
      <div class="field-group">
        <div class="field-label">Base monthly limit</div>
        <input class="field" id="budget-edit-amount" type="number" inputmode="decimal" placeholder="$0.00" value="${attr(app.drafts.budgetEdit.budget)}">
      </div>
      <button class="primary-btn" data-action="saveEditingBudget">${icon("check")} Save Budget</button>
      <button class="secondary-btn cloud-full" data-action="openShareBudget" data-id="${attr(budget.id)}">${icon("share")} Share this budget…</button>
      <button class="danger-btn cloud-full" data-action="deleteEditingBudget">${icon("trash")} Delete Budget</button>
    </div>
  `
}

function renderPresetEditModal() {
  const preset = presetById(app.editingPresetId)
  if (!preset) {
    closeModal()
    return ""
  }

  return `
    <div class="sheet" role="dialog" aria-modal="true" aria-label="Edit preset">
      <div class="sheet-top">
        <div class="sheet-title">Edit preset</div>
        <button class="sheet-close" aria-label="Close" data-action="closeModal">${icon("close")}</button>
      </div>
      <div class="two-col icon-name-grid">
        ${iconPickerButton("presetEdit")}
        <input class="field" id="preset-edit-desc" type="text" placeholder="Name / description" value="${attr(app.drafts.presetEdit.desc)}">
      </div>
      <div class="field-group">
        <div class="field-label">Amount</div>
        <input class="field" id="preset-edit-amt" type="number" inputmode="decimal" placeholder="$0.00" value="${attr(app.drafts.presetEdit.amt)}">
      </div>
      <div class="field-label">Category</div>
      <div class="pill-wrap">
        ${renderCategoryPills(app.editingPresetCat, "pickPresetEditCat")}
      </div>
      <button class="primary-btn" data-action="saveEditingPreset">${icon("check")} Save Preset</button>
      <button class="danger-btn cloud-full" data-action="deleteEditingPreset">${icon("trash")} Delete Preset</button>
    </div>
  `
}

function renderWishEditModal() {
  const wish = wishById(app.editingWishId)
  if (!wish) {
    closeModal()
    return ""
  }

  return `
    <div class="sheet" role="dialog" aria-modal="true" aria-label="Edit wish">
      <div class="sheet-top">
        <div class="sheet-title">Edit wish</div>
        <button class="sheet-close" aria-label="Close" data-action="closeModal">${icon("close")}</button>
      </div>
      <div class="two-col icon-name-grid">
        ${iconPickerButton("wishEdit")}
        <input class="field" id="wish-edit-desc" type="text" placeholder="What do you want to buy?" value="${attr(app.drafts.wishEdit.desc)}">
      </div>
      <div class="field-group">
        <div class="field-label">Estimated amount</div>
        <input class="field" id="wish-edit-amt" type="number" inputmode="decimal" placeholder="$0.00" value="${attr(app.drafts.wishEdit.amt)}">
      </div>
      <div class="field-label">Category when purchased</div>
      <div class="pill-wrap">
        ${renderCategoryPills(app.editingWishCat, "pickWishEditCat")}
      </div>
      <div class="sheet-actions">
        <button class="danger-btn" data-action="deleteEditingWish">${icon("trash")} Delete</button>
        <button class="primary-btn" data-action="saveEditingWish">${icon("check")} Save</button>
      </div>
      <button class="secondary-btn" style="width:100%;margin-top:8px" data-action="buyEditingWish">${icon("check")} Buy now</button>
    </div>
  `
}

function renderDataModal() {
  const summary = getDataSummary()

  return `
    <div class="sheet" role="dialog" aria-modal="true" aria-label="Data and backup">
      <div class="sheet-top">
        <div class="sheet-title">Data and backup</div>
        <button class="sheet-close" aria-label="Close" data-action="closeModal">${icon("close")}</button>
      </div>
      <div class="data-note">
        Local in this browser · ${summary.monthCount} months · ${summary.txCount} transactions · last saved ${esc(summary.saved)}.
      </div>
      ${renderCloudPanel()}
      ${renderBackupPanel()}
    </div>
  `
}

function renderMethodModal() {
  const step = Math.max(0, Math.min(2, Number(app.methodStep) || 0))
  const steps = [
    renderMethodNumbersStep,
    renderMethodPoolStep,
    renderMethodReviewStep
  ]

  return `
    <div class="sheet method-sheet" role="dialog" aria-modal="true" aria-label="Find your tracking pool">
      <div class="sheet-top">
        <div>
          <div class="sheet-title">Find Your Tracking Pool</div>
          <div class="method-step-label">Step ${step + 1} of 3</div>
        </div>
        <button class="sheet-close" aria-label="Close" data-action="dismissMethod">${icon("close")}</button>
      </div>
      <div class="method-progress" aria-hidden="true">
        ${[0, 1, 2].map(i => `<span class="${i <= step ? "active" : ""}"></span>`).join("")}
      </div>
      ${steps[step]()}
    </div>
  `
}

function renderMethodIntroModal() {
  const readOnly = app.methodIntroMode === "read"

  return `
    <div class="story-screen" role="dialog" aria-modal="true" aria-label="A note from Ezra">
      <div class="story-shell">
        <div class="story-top">
          <div class="story-brand">Budget Tracker</div>
          <button class="story-skip" data-action="dismissMethodIntro">${readOnly ? "Close" : "Not now"}</button>
        </div>

        <div class="story-content">
          <div class="story-eyebrow">A note from Ezra</div>
          <h1>A tracker for leaks, not your whole life.</h1>

          <p class="story-lede">Hey, I'm Ezra. This app started because the normal way of budgeting did not work for us as a couple.</p>

          <p>At first, we tried the classic thing: tracking groceries, gas, laundry, bills, household basics, and every little category. It became hard, stressful, and honestly not very helpful.</p>

          <p>After a lot of trial and error, we reviewed several months of statements and saw something important. Those stable life expenses were usually in a similar range. They were part of our real life, and they were not the real problem.</p>

          <p>The problem was the invisible leaks: a big online purchase out of nowhere, clothes, many coffees, restaurants, Uber rides, random extras, little experiments. Things we enjoyed, but did not want to become unconscious and unlimited.</p>

          <p>So this app has one simple daily job: track only the leaks you choose. Not your whole life. Not every grocery trip. Not every gallon of gas.</p>

          <p>The setup job is different. First, you discover the monthly amount you are comfortable not tracking. Income minus that stable amount becomes the money you can split into leak budgets.</p>

          <blockquote>This app is not here to track your whole life. It helps you choose your leaks, set simple limits, and enjoy spending without quiet stress.</blockquote>

          <p class="story-example">We are building AI statement review to help with that discovery. The AI organizes transactions; you decide what feels stable and what feels like a leak.</p>
        </div>

        <div class="story-actions">
          ${readOnly
            ? `<button class="primary-btn" data-action="dismissMethodIntro">${icon("check")} Close</button>`
            : `
              <button class="primary-btn" data-action="startTrackingLeaks">${icon("add")} Start Tracking Leaks</button>
              <button class="text-btn story-method-link" data-action="startMethodSetup">Find My Pool</button>
            `}
        </div>
      </div>
    </div>
  `
}

function renderInstallCoachModal() {
  const installed = isStandaloneApp()
  const canPrompt = !!app.installPrompt && !installed
  const primaryAction = installed ? "continueInstallCoach" : canPrompt ? "installThenContinue" : "continueInstallCoach"
  const primaryLabel = installed ? "Done" : canPrompt ? "Install App" : "Got it"

  return `
    <div class="story-screen install-screen" role="dialog" aria-modal="true" aria-label="Install Budget Tracker">
      <div class="story-shell install-shell">
        <div class="story-top">
          <div class="story-brand">Budget Tracker</div>
          <button class="story-skip" data-action="continueInstallCoach">${installed ? "Close" : "Continue in Safari"}</button>
        </div>

        <div class="story-content install-content">
          <div class="story-eyebrow">${installed ? "You're all set" : "One small thing"}</div>
          <h1>${installed ? "It is already saved like an app." : "Save it like a real app."}</h1>
          <p class="story-lede">${installed ? "Budget Tracker is running from your Home Screen." : "Budget Tracker works best from your Home Screen, like any other app."}</p>

          ${installed ? `
            <p>Open it from the icon whenever you want to add a leak expense quickly.</p>
          ` : `
            <p>Most people do not know websites can become apps on iPhone. This one is meant to live next to your everyday apps, so tracking stays quick.</p>
            <div class="install-steps" aria-label="iPhone install steps">
              <div><span>1</span><strong>Tap Share</strong><em>Use the Safari share button at the bottom.</em></div>
              <div><span>2</span><strong>Choose Add to Home Screen</strong><em>iPhone will create the Budget Tracker app icon.</em></div>
              <div><span>3</span><strong>Open Budget Tracker</strong><em>Next time, start from your Home Screen.</em></div>
            </div>
          `}
        </div>

        <div class="story-actions">
          <button class="primary-btn" data-action="${primaryAction}">${icon(installed ? "check" : "download")} ${primaryLabel}</button>
          ${installed ? "" : `<button class="text-btn story-method-link" data-action="continueInstallCoach">Continue in Safari</button>`}
        </div>
      </div>
    </div>
  `
}

function renderMethodNumbersStep() {
  return `
    <div class="method-body">
      <div class="method-heading">Start with what you are comfortable not tracking.</div>
      <p class="method-copy-block">Enter monthly income and the stable expenses you accept as part of real life. Income minus stable expenses equals money available for leak budgets.</p>
      <div class="field-group">
        <div class="field-label">Monthly income</div>
        <input class="field" id="method-income" type="number" inputmode="decimal" placeholder="$0.00" value="${attr(app.drafts.method.monthlyIncome)}">
      </div>
      <div class="field-group">
        <div class="field-label">Stable expenses you will not track</div>
        <input class="field" id="method-predictable" type="number" inputmode="decimal" placeholder="$0.00" value="${attr(app.drafts.method.predictableExpensesTotal)}">
      </div>
      <div class="method-note">Rent, groceries, gas, bills, household basics, and other expenses you accept as part of your real lifestyle. The goal is clarity, not judgment.</div>
      <div class="sheet-actions">
        <button class="secondary-btn" data-action="dismissMethod">Not now</button>
        <button class="primary-btn" id="method-numbers-next" data-action="methodNext" ${canContinueMethodNumbers() ? "" : "disabled"}>${icon("check")} Continue</button>
      </div>
    </div>
  `
}

function renderMethodPoolStep() {
  const suggested = Math.max(0, roundMoney(Number(app.drafts.method.monthlyIncome) - Number(app.drafts.method.predictableExpensesTotal)))
  const currentPool = Number(app.drafts.method.intentionalPool) || suggested

  return `
    <div class="method-body">
      <div class="method-heading">Choose what is available for leak budgets.</div>
      <p class="method-copy-block">This is the amount you can split into leak budgets. Once those budgets exist, the daily job is simple: track only those leaks.</p>
      <div class="method-suggestion">
        <span>Income - stable expenses</span>
        <strong>${fmt(suggested)}</strong>
      </div>
      <div class="field-group">
        <div class="field-label">Tracking pool</div>
        <input class="field" id="method-pool" type="number" inputmode="decimal" placeholder="$0.00" value="${attr(currentPool)}">
      </div>
      <div class="method-note">This is permission, not punishment. You can enjoy what fits inside it.</div>
      <div class="sheet-actions">
        <button class="secondary-btn" data-action="methodBack">Back</button>
        <button class="primary-btn" id="method-pool-next" data-action="methodNext" ${currentPool > 0 ? "" : "disabled"}>${icon("check")} Review</button>
      </div>
    </div>
  `
}

function renderMethodReviewStep() {
  const pool = Number(app.drafts.method.intentionalPool) || 0
  const budgeted = getMethodBudgetTotal()
  const unassigned = roundMoney(pool - budgeted)
  const over = unassigned < 0

  return `
    <div class="method-body">
      <div class="method-heading">Your leak budgets start here.</div>
      <p class="method-copy-block">These are the categories you are choosing to manage with awareness, not guilt.</p>
      <div class="method-review-grid">
        <div><span>Tracking pool</span><strong>${fmt(pool)}</strong></div>
        <div><span>Budgeted leaks</span><strong>${fmt(budgeted)}</strong></div>
        <div class="${over ? "danger" : ""}"><span>${over ? "Over pool" : "Unassigned"}</span><strong>${fmt(Math.abs(unassigned))}</strong></div>
      </div>
      <div class="method-budget-list">
        ${app.data._settings.budgets.length ? app.data._settings.budgets.map(budget => `
          <div class="method-budget-row">
            <span>${esc(budget.icon)} ${esc(budget.label)}</span>
            <strong>${fmt(budget.budget)}</strong>
          </div>
        `).join("") : `
          <div class="method-empty-budget">
            No leak budgets yet. Finish this setup, then create only the categories that actually feel like leaks.
          </div>
        `}
      </div>
      <div class="method-note">${over ? "This is a signal, not a failure. Adjust the pool or budgets when it feels right." : "You can leave the rest unassigned or add more leak budgets later."}</div>
      <div class="sheet-actions">
        <button class="secondary-btn" data-action="methodBack">Back</button>
        <button class="primary-btn" data-action="saveMethod">${icon("check")} Finish</button>
      </div>
    </div>
  `
}

function renderIconPickerModal() {
  return `
    <div class="sheet icon-sheet" role="dialog" aria-modal="true" aria-label="Choose icon">
      <div class="sheet-top">
        <div class="sheet-title">Choose icon</div>
        <button class="sheet-close" aria-label="Close" data-action="closeModal">${icon("close")}</button>
      </div>
      <input class="field icon-search" id="icon-search" type="search" placeholder="Search coffee, rent, travel..." value="${attr(app.iconPickerQuery)}">
      <div class="icon-results" id="icon-picker-results">
        ${renderIconPickerResults()}
      </div>
    </div>
  `
}

function renderIconPickerResults() {
  const target = app.iconPickerTarget
  const selected = iconPickerValue(target)
  const groups = filteredIconGroups()

  return `
    <div class="icon-groups">
      ${groups.length ? groups.map(([label, values]) => `
        <div class="icon-group">
          <div class="section-label">${esc(label)}</div>
          <div class="icon-grid">
            ${values.map(choice => {
              const value = iconChoiceValue(choice)
              const labelText = iconChoiceLabel(choice)
              return `
              <button class="icon-choice ${selected === value ? "active" : ""}" title="${attr(labelText)}" aria-label="${attr(labelText)}" data-action="chooseIcon" data-value="${attr(value)}">
                ${esc(value)}
              </button>
            `}).join("")}
          </div>
        </div>
      `).join("") : `<div class="empty icon-empty"><div class="empty-title">No matches</div><div class="row-meta">Try another word.</div></div>`}
    </div>
  `
}

function updateIconPickerResults() {
  const results = document.getElementById("icon-picker-results")
  if (results) results.innerHTML = renderIconPickerResults()
}

function render() {
  syncState()

  const previousHero = (() => {
    const el = appEl.querySelector(".hero-amount")
    if (!el) return null
    const value = Number(el.dataset.value)
    return Number.isFinite(value) ? value : null
  })()

  const views = {
    home: renderHome,
    add: renderAdd,
    log: renderLog,
    account: renderAccount,
    cats: renderCategories,
    presets: renderPresets,
    wishes: renderWishes,
    review: renderReview
  }

  appEl.innerHTML = (views[app.view] || renderHome)()
  renderModal()

  if (app.view === "home") {
    const heroEl = appEl.querySelector(".hero-amount")
    if (heroEl) {
      const newValue = Number(heroEl.dataset.value) || 0
      if (previousHero !== null && Math.abs(previousHero - newValue) > 0.005) {
        tickNumber(heroEl, previousHero, newValue, { format: v => money0(v) })
      }
    }
  }
}

function canSaveExpense() {
  return !!app.selectedCat && Number(app.drafts.add.amt) > 0
}

function canAddCategory() {
  const label = app.drafts.category.label.trim()
  const budget = Number(app.drafts.category.budget)
  const duplicate = app.data._settings.budgets.some(b => b.label.trim().toLowerCase() === label.toLowerCase())
  return !!label && budget > 0 && !duplicate
}

function canAddPreset() {
  return app.drafts.preset.desc.trim() && Number(app.drafts.preset.amt) > 0 && app.newPresetCat
}

function canAddWish() {
  return app.drafts.wish.desc.trim() && Number(app.drafts.wish.amt) > 0 && app.newWishCat
}

function updateButtonState(id, enabled) {
  const button = document.getElementById(id)
  if (button) button.disabled = !enabled
}

function handleInput(event) {
  const target = event.target
  if (!(target instanceof HTMLInputElement)) return

  if (target.id === "add-amt") {
    app.drafts.add.amt = target.value
    updateButtonState("save-expense", canSaveExpense())
    const display = document.querySelector(".quick-amount-display")
    if (display) {
      const val = Number(target.value) || 0
      display.textContent = val > 0 ? fmt(val) : "$0.00"
      display.classList.toggle("filled", val > 0)
    }
  }

  if (target.id === "add-desc") app.drafts.add.desc = target.value
  if (target.id === "add-date") {
    app.drafts.add.dateISO = clampExpenseDateISO(target.value)
    target.value = app.drafts.add.dateISO
    const hint = document.getElementById("add-date-hint")
    if (hint) hint.textContent = dateFriendlyLabel(app.drafts.add.dateISO)
  }

  if (target.id === "cat-label") app.drafts.category.label = target.value
  if (target.id === "cat-budget") app.drafts.category.budget = target.value
  if (["cat-label", "cat-budget"].includes(target.id)) {
    updateButtonState("save-category", canAddCategory())
  }

  if (target.id === "preset-desc") app.drafts.preset.desc = target.value
  if (target.id === "preset-amt") app.drafts.preset.amt = target.value
  if (["preset-desc", "preset-amt"].includes(target.id)) {
    updateButtonState("save-preset", canAddPreset())
  }

  if (target.id === "wish-desc") app.drafts.wish.desc = target.value
  if (target.id === "wish-amt") app.drafts.wish.amt = target.value
  if (["wish-desc", "wish-amt"].includes(target.id)) {
    updateButtonState("save-wish", canAddWish())
  }

  if (target.id === "budget-edit-label") app.drafts.budgetEdit.label = target.value
  if (target.id === "budget-edit-amount") app.drafts.budgetEdit.budget = target.value

  if (target.id === "preset-edit-desc") app.drafts.presetEdit.desc = target.value
  if (target.id === "preset-edit-amt") app.drafts.presetEdit.amt = target.value

  if (target.id === "edit-desc") app.drafts.edit.desc = target.value
  if (target.id === "edit-amt") app.drafts.edit.amt = target.value
  if (target.id === "edit-date") {
    app.drafts.edit.dateISO = clampExpenseDateISO(target.value)
    target.value = app.drafts.edit.dateISO
    const hint = document.getElementById("edit-date-hint")
    if (hint) hint.textContent = dateFriendlyLabel(app.drafts.edit.dateISO)
  }

  if (target.id === "wish-edit-desc") app.drafts.wishEdit.desc = target.value
  if (target.id === "wish-edit-amt") app.drafts.wishEdit.amt = target.value

  if (target.id === "method-income") app.drafts.method.monthlyIncome = target.value
  if (target.id === "method-predictable") app.drafts.method.predictableExpensesTotal = target.value
  if (["method-income", "method-predictable"].includes(target.id)) {
    updateButtonState("method-numbers-next", canContinueMethodNumbers())
  }
  if (target.id === "method-pool") {
    app.drafts.method.intentionalPool = target.value
    updateButtonState("method-pool-next", canConfirmMethodPool())
  }

  if (target.id === "review-income") {
    app.drafts.method.monthlyIncome = target.value
    updateReviewPoolPreview()
  }

  if (target.id === "cloud-email") {
    app.drafts.cloud.email = target.value
    updateButtonState("send-reset-link", isValidEmail(app.drafts.cloud.email))
  }
  if (target.id === "cloud-password") app.drafts.cloud.password = target.value
  if (target.id === "cloud-new-password") app.drafts.cloud.newPassword = target.value
  if (target.id === "cloud-confirm-password") app.drafts.cloud.confirmPassword = target.value
  if (["cloud-new-password", "cloud-confirm-password"].includes(target.id)) {
    updateButtonState("update-password-btn", canUpdateRecoveredPassword())
  }
  if (target.id === "cloud-code") {
    const code = target.value.replace(/\D/g, "").slice(0, 6)
    app.drafts.cloud.code = code
    target.value = code
  }

  if (target.id === "icon-search") {
    app.iconPickerQuery = target.value
    updateIconPickerResults()
  }

  if (target.id === "category-history-search") {
    app.categoryHistory.query = target.value
    updateCategoryHistoryResults()
  }

  if (target.id === "workspace-name") {
    app.shareDraft.name = target.value
    updateButtonState("create-workspace-btn", !!app.shareDraft.name.trim())
  }

  if (target.id === "invite-email-field") {
    app.inviteEmailDraft = target.value
    updateButtonState("invite-email-send", isLikelyEmail(target.value))
  }

  if (target.id === "confirm-name-field") {
    if (!app.confirmDeleteCtx) return
    app.confirmDeleteCtx.typed = target.value
    const typed = String(target.value || "").trim()
    updateButtonState("confirm-delete-by-name-btn", typed === String(app.confirmDeleteCtx.targetName))
  }
}

function handleClick(event) {
  const target = event.target.closest("[data-action]")
  if (!target) {
    if (event.target === modalEl) {
      if (app.modal === "methodIntro") dismissMethodIntro()
      else if (app.modal === "installCoach") continueInstallCoach()
      else if (app.modal === "method") dismissMethod()
      else if (app.modal === "confirm") resolveConfirm(false)
      else closeModal()
    }
    return
  }

  const action = target.dataset.action
  const id = target.dataset.id
  const view = target.dataset.view
  const mode = target.dataset.mode
  const targetName = target.dataset.target
  const value = target.dataset.value
  const returnMode = target.dataset.return

  if (action === "go") go(view)
  if (action === "quickAdd") openBudgetCapture(id)
  if (action === "openBudgetCapture") openBudgetCapture(id)
  if (action === "openCategoryHistory") openCategoryHistory(id)
  if (action === "openCategoryHistoryEdit") openCategoryHistoryEdit(id, returnMode)
  if (action === "backCategoryHistory") backCategoryHistory()
  if (action === "setCategoryHistoryTab") setCategoryHistoryTab(value)
  if (action === "saveCategoryHistoryEntry") saveCategoryHistoryEntry()
  if (action === "deleteCategoryHistoryEntry") deleteCategoryHistoryEntry()
  if (action === "openCatPicker") openModal("catPicker")
  if (action === "chooseCat") chooseCat(id)
  if (action === "saveExpense") saveExpense()
  if (action === "usePreset") usePreset(id)
  if (action === "openData") go("account")
  if (action === "addCategory") addCategory()
  if (action === "saveCategoryBudget") saveCategoryBudget(id)
  if (action === "deleteCategory") deleteCategory(id)
  if (action === "openBudgetEdit") openBudgetEdit(id)
  if (action === "saveEditingBudget") saveEditingBudget()
  if (action === "deleteEditingBudget") deleteEditingBudget()
  if (action === "addPreset") addPreset()
  if (action === "deletePreset") deletePreset(id)
  if (action === "openPresetEdit") openPresetEdit(id)
  if (action === "pickPresetEditCat") pickPresetEditCat(id)
  if (action === "saveEditingPreset") saveEditingPreset()
  if (action === "deleteEditingPreset") deleteEditingPreset()
  if (action === "pickPresetCat") pickPresetCat(id)
  if (action === "addWish") addWish()
  if (action === "deleteWish") deleteWish(id)
  if (action === "buyWish") buyWish(id)
  if (action === "openWishEdit") openWishEdit(id)
  if (action === "pickWishCat") pickWishCat(id)
  if (action === "openEntryEdit") openEntryEdit(id)
  if (action === "deleteEntry") deleteEntry(id)
  if (action === "pickEditCat") pickEditCat(id)
  if (action === "saveEditingEntry") saveEditingEntry()
  if (action === "deleteEditingEntry") deleteEditingEntry()
  if (action === "saveEditingAsPreset") saveEditingAsPreset()
  if (action === "pickWishEditCat") pickWishEditCat(id)
  if (action === "saveEditingWish") saveEditingWish()
  if (action === "deleteEditingWish") deleteEditingWish()
  if (action === "buyEditingWish") buyEditingWish()
  if (action === "openExport") openExport()
  if (action === "setExportFormat") setExportFormat(value)
  if (action === "setExportRange") setExportRange(value)
  if (action === "setExportType") setExportType(value)
  if (action === "toggleAllExportBudgets") toggleAllExportBudgets()
  if (action === "toggleExportBudget") toggleExportBudget(id)
  if (action === "runExport") runExport()
  if (action === "openStory") openMethodIntro({ mode: "read" })
  if (action === "openMethod") openMethod(target.dataset.step)
  if (action === "openInstallCoach") openInstallCoach()
  if (action === "startMethodSetup") startMethodSetup()
  if (action === "startTrackingLeaks") startTrackingLeaks()
  if (action === "dismissMethodIntro") dismissMethodIntro()
  if (action === "continueInstallCoach") continueInstallCoach()
  if (action === "installThenContinue") installThenContinue()
  if (action === "methodNext") methodNext()
  if (action === "methodBack") methodBack()
  if (action === "dismissMethod") dismissMethod()
  if (action === "saveMethod") saveMethod()
  if (action === "pickStatements") pickStatementFiles()
  if (action === "clearReview") clearReview()
  if (action === "setReviewPeriod") setReviewPeriod(value, target)
  if (action === "toggleReviewCategory") toggleReviewCategory(id, target)
  if (action === "toggleReviewCategoryDetails") toggleReviewCategoryDetails(id, target)
  if (action === "toggleReviewStore") toggleReviewStore(id, target)
  if (action === "toggleReviewStoreDetails") toggleReviewStoreDetails(id, target)
  if (action === "toggleReviewTransaction") toggleReviewTransaction(id, target)
  if (action === "clearReviewSelection") clearReviewSelection(target)
  if (action === "saveReviewPool") saveReviewPool()
  if (action === "copyReviewLink") copyReviewLink()
  if (action === "setAuthMode") setAuthMode(mode)
  if (action === "cloudPasswordLogin") signInWithPassword()
  if (action === "cloudCreateAccount") createPasswordAccount()
  if (action === "cloudResetPassword") sendPasswordReset()
  if (action === "cloudUpdatePassword") updateRecoveredPassword()
  if (action === "cloudLogin") sendEmailCode()
  if (action === "cloudVerify") verifyEmailCode()
  if (action === "cloudPush") pushCloudData()
  if (action === "cloudPull") {
    confirmSheet({
      title: "Restore from cloud backup?",
      body: "This replaces this device's data with what's saved on the server.",
      primaryLabel: "Restore",
      destructive: true,
      onConfirm: pullCloudData
    })
  }
  if (action === "cloudSignOut") signOutCloud()
  if (action === "install") installPWA()
  if (action === "openIconPicker") openIconPicker(targetName)
  if (action === "chooseIcon") chooseIcon(value)
  if (action === "closeModal") closeModal()
  if (action === "confirmYes") resolveConfirm(true)
  if (action === "confirmNo") resolveConfirm(false)
  if (action === "undoLast") {
    if (toastEl.__undoCallback) toastEl.__undoCallback()
  }
  if (action === "cycleTheme") cycleTheme()
  if (action === "setTheme") setTheme(value)
  if (action === "openQuickAdd") openQuickAdd()
  if (action === "chooseQuickCat") chooseQuickCat(id)
  if (action === "saveQuickExpense") saveQuickExpense()
  if (action === "openCloudSheet") openCloudSheet()
  if (action === "openCreateWorkspace") openCreateWorkspace()
  if (action === "createWorkspace") doCreateWorkspace()
  if (action === "openManageWorkspace") openManageWorkspace()
  if (action === "createWorkspaceInvite") doCreateWorkspaceInvite()
  if (action === "createBudgetInvite") doCreateBudgetInvite(id)
  if (action === "copyInviteLink") doCopyInviteLink(value)
  if (action === "shareInviteSystem") doShareInviteSystem(value)
  if (action === "confirmLeaveWorkspace") doConfirmLeaveWorkspace()
  if (action === "confirmLeaveBudget") doConfirmLeaveBudget(id)
  if (action === "removeWorkspaceMember") doRemoveWorkspaceMember(id)
  if (action === "removeBudgetMember") doRemoveBudgetMember(id)
  if (action === "openShareBudget") openShareBudget(id)
  if (action === "shareLocalToWorkspace") doShareLocalToWorkspace(id)
  if (action === "shareLocalStandalone") doShareLocalStandalone(id)
  if (action === "openBudgetMembers") openBudgetMembers(id)
  if (action === "acceptPendingInvite") doAcceptPendingInvite()
  if (action === "declinePendingInvite") doDeclinePendingInvite()
  if (action === "manualRefresh") manualRefresh()
  if (action === "saveSharedBudgetEdit") doSaveSharedBudgetEdit()
  if (action === "confirmDeleteSharedBudget") doConfirmDeleteSharedBudget(id)
  if (action === "sendEmailInvite") doSendEmailInvite()
  if (action === "openPendingInvites") openPendingInvitesList()
  if (action === "acceptInviteByToken") doAcceptInviteByToken(id)
  if (action === "declineInviteByToken") doDeclineInviteByToken(id)
  if (action === "openInviteByEmailWorkspace") openInviteByEmailWorkspace()
  if (action === "openInviteByEmailBudget") openInviteByEmailBudget(id)
  if (action === "openConvertSharedToLocal") doConvertSharedToLocal(id)
  if (action === "confirmDeleteByNameYes") doConfirmDeleteByNameYes()
}

function openCreateWorkspace() {
  app.shareDraft.name = ""
  haptic("light")
  app.modal = "createWorkspace"
  renderModal()
}

async function doCreateWorkspace() {
  const name = (app.shareDraft.name || "").trim()
  if (!name) return
  const ws = await sharedCreateWorkspace(name)
  if (!ws) return
  closeModal(false)
  render()
  haptic("success")
  toast(`Workspace "${name}" created`)
  // Immediately offer to copy an invite
  setTimeout(() => doCreateWorkspaceInvite(), 320)
}

function openManageWorkspace() {
  if (!app.shared.workspace) return
  haptic("light")
  app.modal = "manageWorkspace"
  renderModal()
}

function doCreateWorkspaceInvite() {
  // Email-based: open the email-input sheet
  if (!app.shared.workspace) {
    toast("Create a workspace first")
    return
  }
  openInviteByEmailWorkspace()
}

function doCreateBudgetInvite(budgetId) {
  // Email-based: open the email-input sheet for this budget
  if (!sharedBudgetById(budgetId)) return
  openInviteByEmailBudget(budgetId)
}

function openInviteByEmailWorkspace() {
  if (!app.shared.workspace) return
  app.inviteEmailScope = { workspaceId: app.shared.workspace.id }
  app.inviteEmailDraft = ""
  haptic("light")
  app.modal = "inviteByEmail"
  renderModal()
  setTimeout(() => {
    const el = document.getElementById("invite-email-field")
    if (el) el.focus()
  }, 280)
}

function openInviteByEmailBudget(budgetId) {
  if (!sharedBudgetById(budgetId)) return
  app.inviteEmailScope = { budgetId }
  app.inviteEmailDraft = ""
  haptic("light")
  app.modal = "inviteByEmail"
  renderModal()
  setTimeout(() => {
    const el = document.getElementById("invite-email-field")
    if (el) el.focus()
  }, 280)
}

async function doSendEmailInvite() {
  const scope = app.inviteEmailScope || {}
  const email = (app.inviteEmailDraft || "").trim()
  if (!isLikelyEmail(email)) {
    toast("Enter a valid email")
    return
  }
  const result = await inviteByEmail({
    workspaceId: scope.workspaceId,
    budgetId: scope.budgetId,
    email,
    role: "member"
  })
  if (!result) { haptic("error"); return }
  closeModal(false)
  haptic("success")
  toast(`Invitation sent to ${email}`)
}

function openPendingInvitesList() {
  if (!(app.shared.pendingInvites || []).length) {
    toast("No pending invitations")
    return
  }
  haptic("light")
  app.modal = "pendingInvites"
  renderModal()
}

async function doAcceptInviteByToken(token) {
  if (!token) return
  const invite = (app.shared.pendingInvites || []).find(p => p.token === token)
  if (!invite) {
    toast("Invitation not found")
    return
  }
  const result = await inviteAccept(token)
  if (!result) { haptic("error"); return }
  // Remove from pending list
  app.shared.pendingInvites = (app.shared.pendingInvites || []).filter(p => p.token !== token)
  haptic("success")
  toast(`Joined ${invite.workspaceName || invite.budgetLabel || "shared budget"}`)
  // If list is empty, close. If still has pending, advance to next.
  if ((app.shared.pendingInvites || []).length > 0) {
    app.shared.pendingInvite = app.shared.pendingInvites[0]
    app.modal = "acceptInvite"
    renderModal()
  } else {
    app.shared.pendingInvite = null
    closeModal(false)
  }
  render()
}

function doDeclineInviteByToken(token) {
  if (!token) return
  if (!Array.isArray(app.shared.declinedInviteTokens)) app.shared.declinedInviteTokens = []
  app.shared.declinedInviteTokens.push(token)
  app.shared.pendingInvites = (app.shared.pendingInvites || []).filter(p => p.token !== token)
  haptic("light")
  toast("Invitation dismissed")
  if ((app.shared.pendingInvites || []).length > 0) {
    app.shared.pendingInvite = app.shared.pendingInvites[0]
    app.modal = "acceptInvite"
    renderModal()
  } else {
    app.shared.pendingInvite = null
    closeModal(false)
  }
  render()
}

async function doCopyInviteLink(url) {
  if (!url) return
  try {
    await navigator.clipboard.writeText(url)
    haptic("success")
    toast("Link copied")
  } catch (_) {
    // Fallback: select the input
    const field = document.getElementById("invite-link-field")
    if (field) {
      field.select()
      try { document.execCommand("copy") } catch (e) {}
      haptic("success")
      toast("Link copied")
    }
  }
}

async function doShareInviteSystem(url) {
  if (!url || !navigator.share) return
  try {
    await navigator.share({
      title: "Join my shared budget",
      text: "I'm sharing a budget with you on Budget Tracker.",
      url
    })
  } catch (_) {}
}

function doConfirmLeaveWorkspace() {
  if (!app.shared.workspace) return
  const ws = app.shared.workspace
  confirmSheet({
    title: `Leave "${ws.name}"?`,
    body: "You will stop seeing shared budgets from this workspace.",
    primaryLabel: "Leave",
    destructive: true,
    onConfirm: async () => {
      const ok = await sharedLeaveWorkspace()
      if (ok) {
        render()
        haptic("warning")
        toast("Left workspace")
      }
    }
  })
}

function doConfirmLeaveBudget(budgetId) {
  const budget = sharedBudgetById(budgetId)
  if (!budget) return
  confirmSheet({
    title: `Leave "${budget.label}"?`,
    body: "You will stop seeing this budget.",
    primaryLabel: "Leave",
    destructive: true,
    onConfirm: async () => {
      const ok = await sharedLeaveBudget(budgetId)
      if (ok) {
        closeModal(false)
        render()
        haptic("warning")
        toast("Left budget")
      }
    }
  })
}

function doRemoveWorkspaceMember(userId) {
  if (!app.shared.workspace) return
  const ws = app.shared.workspace
  const member = (app.shared.workspaceMembers || []).find(m => m.user_id === userId)
  const label = member && member.display_email ? member.display_email : "this member"
  confirmSheet({
    title: `Remove ${label}?`,
    body: "They will lose access to the workspace.",
    primaryLabel: "Remove",
    destructive: true,
    onConfirm: async () => {
      const ok = await sharedRemoveMember("workspace", ws.id, userId)
      if (ok) {
        render()
        haptic("warning")
        toast("Member removed")
      }
    }
  })
}

function doRemoveBudgetMember(userId) {
  const budget = sharedBudgetById(app.shareTargetBudgetId)
  if (!budget) return
  const member = (app.shared.budgetMembers[budget.id] || []).find(m => m.user_id === userId)
  const label = member && member.display_email ? member.display_email : "this member"
  confirmSheet({
    title: `Remove ${label}?`,
    body: "They will lose access to this budget.",
    primaryLabel: "Remove",
    destructive: true,
    onConfirm: async () => {
      const ok = await sharedRemoveMember("budget", budget.id, userId)
      if (ok) {
        render()
        haptic("warning")
        toast("Member removed")
      }
    }
  })
}

function openShareBudget(localBudgetId) {
  const budget = rawCategoryById(localBudgetId)
  if (!budget) return
  if (!supabaseClient || !app.cloudUser) {
    toast("Sign in first to share")
    app.view = "account"
    render()
    return
  }
  app.shareTargetBudgetId = localBudgetId
  app.shareTargetIsWorkspace = false
  haptic("light")
  app.modal = "shareBudget"
  renderModal()
}

async function doShareLocalToWorkspace(localBudgetId) {
  const budget = rawCategoryById(localBudgetId)
  if (!budget) return

  const proceed = async () => {
    const sharedBudget = await sharedConvertLocalBudget(localBudgetId, {
      target: "workspace",
      workspaceName: app.shared.workspace ? app.shared.workspace.name : "Shared"
    })
    if (!sharedBudget) { haptic("error"); return }
    closeModal(false)
    render()
    haptic("success")
    toast(`"${budget.label}" is now shared`)
  }

  confirmSheet({
    title: `Move "${budget.label}" to shared workspace?`,
    body: app.shared.workspace
      ? `This budget and its transactions will join "${app.shared.workspace.name}" in the cloud. Members can see and add transactions.`
      : "We'll create a new workspace for you, then add this budget to it.",
    primaryLabel: "Share",
    destructive: false,
    onConfirm: proceed
  })
}

async function doShareLocalStandalone(localBudgetId) {
  const budget = rawCategoryById(localBudgetId)
  if (!budget) return

  confirmSheet({
    title: `Share just "${budget.label}"?`,
    body: "This single budget moves to the cloud. You'll get a link to invite one or more people.",
    primaryLabel: "Share",
    destructive: false,
    onConfirm: async () => {
      const sharedBudget = await sharedConvertLocalBudget(localBudgetId, { target: "standalone" })
      if (!sharedBudget) { haptic("error"); return }
      closeModal(false)
      haptic("success")
      toast(`"${budget.label}" is now shared`)
      // Immediately offer the invite link
      app.shareTargetBudgetId = sharedBudget.id
      setTimeout(() => doCreateBudgetInvite(sharedBudget.id), 320)
    }
  })
}

function openBudgetMembers(budgetId) {
  if (!sharedBudgetById(budgetId)) return
  app.shareTargetBudgetId = budgetId
  haptic("light")
  app.modal = "manageBudgetMembers"
  renderModal()
}

async function doAcceptPendingInvite() {
  const pi = app.shared.pendingInvite
  if (!pi) return
  await doAcceptInviteByToken(pi.token)
}

function doDeclinePendingInvite() {
  const pi = app.shared.pendingInvite
  if (!pi) return
  doDeclineInviteByToken(pi.token)
}

function go(view) {
  if (!view) return
  const secondaryViews = ["cats", "presets", "wishes", "review"]
  if (secondaryViews.includes(view) && !secondaryViews.includes(app.view)) {
    app.returnView = app.view || "account"
  } else if (!secondaryViews.includes(view)) {
    app.returnView = null
  }
  if (app.view !== view) haptic("light")
  app.view = view
  closeModal(false)
  render()
}

function openBudgetCapture(id) {
  if (!categoryById(id)) return
  haptic("light")
  app.selectedCat = id
  app.view = "add"
  closeModal(false)
  render()
  requestAnimationFrame(() => {
    const scroll = document.querySelector(".add-scroll")
    if (scroll) scroll.scrollTop = 0
  })
}

function resetCategoryHistory() {
  app.categoryHistory = {
    catId: null,
    tab: "month",
    query: "",
    mode: "list",
    returnModal: null,
    editBack: "list"
  }
}

function openCategoryHistory(id) {
  if (!categoryById(id)) return
  haptic("light")
  app.categoryHistory = {
    catId: id,
    tab: "month",
    query: "",
    mode: "list",
    returnModal: app.modal === "quickAdd" ? "quickAdd" : null,
    editBack: "list"
  }
  app.modal = "categoryHistory"
  renderModal()
}

function openCategoryHistoryEdit(id, back = "list") {
  const entry = entryById(id)
  if (!entry || !categoryById(entry.cat)) return
  haptic("light")
  app.categoryHistory.catId = entry.cat
  app.categoryHistory.mode = "edit"
  app.categoryHistory.editBack = back === "capture" ? "capture" : "list"
  if (!app.categoryHistory.returnModal) app.categoryHistory.returnModal = app.modal === "quickAdd" ? "quickAdd" : null
  app.editingEntryId = entry.shared ? String(entry.id) : Number(entry.id)
  app.editingEntryShared = !!entry.shared
  app.editingCat = entry.cat
  app.drafts.edit = {
    desc: entry.desc || "",
    amt: String(Number(entry.amt) || ""),
    dateISO: clampExpenseDateISO(entry.dateISO || entry.occurredOn)
  }
  app.modal = "categoryHistory"
  renderModal()
}

function closeCategoryHistory(shouldRender = true) {
  const returnModal = app.categoryHistory.returnModal
  resetCategoryHistory()
  app.editingEntryId = null
  app.editingEntryShared = false
  app.editingCat = null
  if (returnModal) {
    app.modal = returnModal
    if (shouldRender) renderModal()
    return
  }
  app.modal = null
  if (shouldRender) {
    render()
  }
}

function backCategoryHistory() {
  if (app.categoryHistory.mode !== "edit") {
    closeCategoryHistory()
    return
  }
  app.editingEntryId = null
  app.editingEntryShared = false
  app.editingCat = null
  if (app.categoryHistory.editBack === "capture") {
    closeCategoryHistory()
    return
  }
  app.categoryHistory.mode = "list"
  app.categoryHistory.editBack = "list"
  renderModal()
}

function setCategoryHistoryTab(value) {
  app.categoryHistory.tab = value === "all" ? "all" : "month"
  haptic("selection")
  renderModal()
}

function openModal(name) {
  haptic("light")
  app.modal = name
  renderModal()
}

function openMethodIntro(options = {}) {
  app.methodIntroMode = options.mode || (options.readOnly ? "read" : "firstRun")
  app.modal = "methodIntro"
  if (!options.silent) haptic("light")
  renderModal()
}

function openInstallCoach(options = {}) {
  app.installCoachNext = options.next || null
  app.modal = "installCoach"
  if (!options.silent) haptic("light")
  renderModal()
}

function openMethod(step = 0, options = {}) {
  syncMethodDraft()
  app.methodStep = Math.max(0, Math.min(2, Number(step) || 0))
  app.modal = "method"
  if (!options.silent) haptic("light")
  renderModal()
}

function methodBack() {
  app.methodStep = Math.max(0, (Number(app.methodStep) || 0) - 1)
  haptic("light")
  renderModal()
}

function methodNext() {
  const step = Number(app.methodStep) || 0

  if (step === 0 && !canContinueMethodNumbers()) {
    toast("Add income and predictable expenses")
    return
  }

  if (step === 0 && !Number(app.drafts.method.intentionalPool)) {
    app.drafts.method.intentionalPool = String(Math.max(0, roundMoney(Number(app.drafts.method.monthlyIncome) - Number(app.drafts.method.predictableExpensesTotal))))
  }

  if (step === 1 && !canConfirmMethodPool()) {
    toast("Choose your tracking pool")
    return
  }

  if (step >= 2) {
    saveMethod()
    return
  }

  app.methodStep = Math.min(2, step + 1)
  haptic("light")
  renderModal()
}

function markMethodIntroSeen() {
  if (storyPreviewMode) return

  if (!Number(app.data._settings.method.introSeenAt)) {
    app.data._settings.method.introSeenAt = Date.now()
    saveData(app.data)
  }
}

function markInstallCoachSeen() {
  if (storyPreviewMode) return

  if (!Number(app.data._settings.method.installCoachSeenAt)) {
    app.data._settings.method.installCoachSeenAt = Date.now()
    saveData(app.data)
  }
}

function maybeShowInstallCoach(next) {
  if (shouldShowInstallCoach()) {
    openInstallCoach({ next, silent: true })
    return
  }

  continueAfterInstallCoach(next)
}

function continueAfterInstallCoach(next) {
  app.installCoachNext = null
  closeModal(false)

  if (next === "method") {
    openMethod(0)
    return
  }

  if (next === "cats") {
    app.view = "cats"
    render()
    haptic("success")
    toast("Create your first leak budget")
    return
  }

  render()
}

function startMethodSetup() {
  markMethodIntroSeen()
  maybeShowInstallCoach("method")
}

function startTrackingLeaks() {
  markMethodIntroSeen()
  maybeShowInstallCoach("cats")
}

function dismissMethodIntro() {
  if (app.methodIntroMode === "read") {
    app.methodIntroMode = "firstRun"
    closeModal(false)
    render()
    haptic("light")
    return
  }

  markMethodIntroSeen()
  closeModal(false)
  render()
  haptic("light")
}

function continueInstallCoach() {
  const next = app.installCoachNext
  markInstallCoachSeen()
  continueAfterInstallCoach(next)
}

async function installThenContinue() {
  await installPWA({ renderAfter: false })
  continueInstallCoach()
}

function dismissMethod() {
  const wasIncomplete = !hasCompletedMethod()
  if (wasIncomplete) {
    app.data._settings.method.dismissedAt = Date.now()
    saveData(app.data)
  }
  closeModal(false)
  render()
  if (wasIncomplete) toast("You can find your pool anytime")
}

function saveMethod() {
  const monthlyIncome = Number(app.drafts.method.monthlyIncome)
  const predictableExpensesTotal = Number(app.drafts.method.predictableExpensesTotal)
  const intentionalPool = Number(app.drafts.method.intentionalPool)

  if (monthlyIncome <= 0 || predictableExpensesTotal < 0 || intentionalPool <= 0) {
    toast("Check the pool numbers")
    return
  }

  app.data._settings.method = {
    monthlyIncome,
    predictableExpensesTotal,
    intentionalPool,
    completedAt: Date.now(),
    dismissedAt: Number(app.data._settings.method.dismissedAt) || 0,
    introSeenAt: Number(app.data._settings.method.introSeenAt) || Date.now(),
    installCoachSeenAt: Number(app.data._settings.method.installCoachSeenAt) || 0
  }
  syncMethodDraft()
  closeModal(false)
  saveData(app.data)
  app.methodJustSaved = true
  setTimeout(() => { app.methodJustSaved = false }, 1600)
  render()
  haptic("success")
  toast("Pool ready")
}

function updateReviewPoolPreview() {
  const stable = reviewStableAmount(reviewAverageContext())
  const income = Number(app.drafts.method.monthlyIncome) || 0
  const available = Math.max(0, roundMoney(income - stable))
  const title = document.getElementById("review-pool-amount")
  const copy = document.getElementById("review-pool-copy")
  const button = document.getElementById("save-review-pool")

  if (title) {
    if (income > 0) {
      const prev = Number(title.dataset.value)
      title.dataset.value = String(available)
      if (Number.isFinite(prev) && Math.abs(prev - available) > 0.005) {
        tickNumber(title, prev, available, { format: v => fmt(v), duration: 420 })
      } else {
        title.textContent = fmt(available)
      }
    } else {
      title.dataset.value = "0"
      title.textContent = "Add income"
    }
  }
  if (copy) copy.textContent = reviewPoolCopy(income, stable)
  updateButtonState("save-review-pool", canSaveReviewPool(income, stable))
  if (button) {
    const missing = reviewMissingMonths()
    button.innerHTML = `${icon("check")} ${missing > 0 ? `Need ${missing} more ${missing === 1 ? "month" : "months"}` : "Save Pool"}`
  }
}

function pickStatementFiles() {
  if (app.reviewBusy) return

  const input = document.createElement("input")
  input.type = "file"
  input.multiple = true
  input.accept = ".csv,.tsv,.txt,.xlsx,.xls,text/csv,text/tab-separated-values,text/plain,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
  input.addEventListener("change", () => {
    const files = Array.from(input.files || [])
    analyzeStatementFiles(files)
  }, { once: true })
  input.click()
}

async function copyReviewLink() {
  try {
    await navigator.clipboard.writeText(REVIEW_HANDOFF_URL)
    haptic("success")
    toast("Review link copied")
  } catch (error) {
    const field = document.querySelector(".review-link-field")
    if (field instanceof HTMLInputElement) {
      field.focus()
      field.select()
    }
    toast("Select and copy the link")
  }
}

function reviewAnchorSelector(anchor) {
  if (!anchor || !(anchor instanceof HTMLElement)) return ""
  const action = anchor.dataset.action
  const id = anchor.dataset.id
  const value = anchor.dataset.value
  if (!action) return ""
  if (id) return `[data-action="${CSS.escape(action)}"][data-id="${CSS.escape(id)}"]`
  if (value) return `[data-action="${CSS.escape(action)}"][data-value="${CSS.escape(value)}"]`
  return `[data-action="${CSS.escape(action)}"]`
}

function renderReviewPreservingPosition(anchor) {
  if (app.view !== "review") {
    render()
    return
  }

  const scroll = document.querySelector(".review-scroll")
  const scrollTop = scroll ? scroll.scrollTop : 0
  const selector = reviewAnchorSelector(anchor)
  const beforeTop = anchor instanceof HTMLElement ? anchor.getBoundingClientRect().top : null

  render()

  requestAnimationFrame(() => {
    const nextScroll = document.querySelector(".review-scroll")
    if (!nextScroll) return

    if (selector && beforeTop !== null) {
      const nextAnchor = document.querySelector(selector)
      if (nextAnchor instanceof HTMLElement) {
        nextScroll.scrollTop += nextAnchor.getBoundingClientRect().top - beforeTop
        return
      }
    }

    nextScroll.scrollTop = scrollTop
  })
}

function reviewErrorMessage(error) {
  const raw = error && error.message ? String(error.message) : "Statement analysis is unavailable right now."
  if (/api key|anthropic|claude|secret|configured/i.test(raw)) {
    return "AI analysis is not connected yet. Turn on the Claude connection, then try again."
  }
  if (/unsupported/i.test(raw)) return "That file type is not ready yet. Try CSV, TXT, Excel, or XLS."
  return raw.length > 116 ? raw.slice(0, 113) + "..." : raw
}

async function analyzeStatementFiles(files) {
  if (!files.length || app.reviewBusy) return

  app.reviewBusy = true
  app.reviewStatus = `Analyzing ${files.length} ${files.length === 1 ? "file" : "files"}...`
  render()

  try {
    const form = new FormData()
    files.forEach(file => form.append("files", file, file.name))
    form.append("language", navigator.language || "en")

    const response = await fetch(AI_FUNCTION_URL, {
      method: "POST",
      headers: { apikey: SUPABASE_PUBLISHABLE_KEY },
      body: form
    })
    const payload = await response.json().catch(() => ({}))

    if (!response.ok) throw new Error(payload.error || payload.message || "Could not analyze statements")

    const added = mergeReviewExtraction(payload, files)
    app.reviewStatus = added
      ? `Added ${added} ${added === 1 ? "transaction" : "transactions"}. Raw files were not stored.`
      : "No new transactions found. Try another statement or format."
    haptic(added ? "success" : "medium")
    toast(added ? "Statements analyzed" : "No new transactions")
    if (added) {
      app.reviewJustAnalyzed = true
      setTimeout(() => { app.reviewJustAnalyzed = false }, 900)
    }
  } catch (error) {
    const message = reviewErrorMessage(error)
    app.reviewStatus = message
    toast(message)
  } finally {
    app.reviewBusy = false
    render()
  }
}

function mergeReviewExtraction(payload, files = []) {
  const txInput = Array.isArray(payload.transactions)
    ? payload.transactions
    : Array.isArray(payload.data?.transactions)
    ? payload.data.transactions
    : []
  const review = getReview()
  const existingSignatures = new Set(review.transactions.map(tx => tx.signature))
  const existingIds = new Set(review.transactions.map(tx => tx.id))
  const importedAt = Date.now()
  let added = 0

  txInput.forEach((row, index) => {
    const tx = normalizeReviewTransaction(row, index + review.transactions.length)
    if (!tx || existingSignatures.has(tx.signature)) return

    while (existingIds.has(tx.id)) tx.id = makeReviewId(tx.signature, `${index}-${added}-${Math.random()}`)
    review.transactions.push(tx)
    existingSignatures.add(tx.signature)
    existingIds.add(tx.id)
    added++
  })

  review.transactions = review.transactions.sort((a, b) => a.dateISO.localeCompare(b.dateISO))

  const sourceCounts = review.transactions.reduce((map, tx) => {
    map[tx.sourceName] = (map[tx.sourceName] || 0) + 1
    return map
  }, {})
  const payloadFiles = Array.isArray(payload.files) ? payload.files : []
  const fileSummaries = payloadFiles.length ? payloadFiles : files.map(file => ({ name: file.name }))
  const existingFileIds = new Set(review.files.map(file => file.id))

  fileSummaries.forEach(file => {
    const name = String(file.name || file.sourceName || "Statement")
    const id = String(file.id || makeReviewId(name, importedAt))
    if (existingFileIds.has(id)) return
    review.files.push({
      id,
      name,
      transactionCount: Number(file.transactionCount) || Number(sourceCounts[name]) || 0,
      importedAt
    })
    existingFileIds.add(id)
  })

  cleanupReviewSelections()
  saveReviewState()
  return added
}

function reviewRowsForStoreKey(key) {
  const { category, merchant } = parseReviewStoreKey(key)
  return getReview().transactions.filter(tx => tx.category === category && tx.merchant === merchant)
}

function reviewTransactionById(id) {
  return getReview().transactions.find(tx => tx.id === id)
}

function toggleSetValue(set, value) {
  if (!value) return false
  if (set.has(value)) {
    set.delete(value)
    return false
  }
  set.add(value)
  return true
}

function removeReviewStoreOverrides(category) {
  const review = getReview()
  const txIds = new Set(review.transactions.filter(tx => tx.category === category).map(tx => tx.id))
  review.selectedStores = review.selectedStores.filter(key => parseReviewStoreKey(key).category !== category)
  review.excludedStores = review.excludedStores.filter(key => parseReviewStoreKey(key).category !== category)
  review.selectedTransactions = review.selectedTransactions.filter(id => !txIds.has(id))
  review.excludedTransactions = review.excludedTransactions.filter(id => !txIds.has(id))
}

function removeReviewTransactionOverridesForStore(key) {
  const ids = new Set(reviewRowsForStoreKey(key).map(tx => tx.id))
  const review = getReview()
  review.selectedTransactions = review.selectedTransactions.filter(id => !ids.has(id))
  review.excludedTransactions = review.excludedTransactions.filter(id => !ids.has(id))
}

function cleanupReviewSelections() {
  const review = getReview()
  const validCategories = new Set(review.transactions.map(tx => tx.category))
  const validStores = new Set(review.transactions.map(tx => reviewStoreKey(tx.category, tx.merchant)))
  const validTx = new Set(review.transactions.map(tx => tx.id))

  review.selectedCategories = review.selectedCategories.filter(value => validCategories.has(value))
  review.selectedStores = review.selectedStores.filter(value => validStores.has(value))
  review.excludedStores = review.excludedStores.filter(value => validStores.has(value))
  review.expandedCategories = review.expandedCategories.filter(value => validCategories.has(value))
  review.expandedStores = review.expandedStores.filter(value => validStores.has(value))
  review.selectedTransactions = review.selectedTransactions.filter(value => validTx.has(value))
  review.excludedTransactions = review.excludedTransactions.filter(value => validTx.has(value))
}

function setReviewPeriod(value, anchor) {
  const review = getReview()
  const valid = value === "average" || (String(value || "").startsWith("month:") && reviewMonths().includes(String(value).replace("month:", "")))
  review.activePeriod = valid ? String(value) : "average"
  saveReviewState()
  renderReviewPreservingPosition(anchor)
  haptic("light")
}

function toggleReviewCategory(category, anchor) {
  if (!category) return
  const set = reviewSelectedSet("selectedCategories")
  toggleSetValue(set, category)
  setReviewArray("selectedCategories", set)
  removeReviewStoreOverrides(category)
  cleanupReviewSelections()
  saveReviewState()
  renderReviewPreservingPosition(anchor)
  haptic("light")
}

function toggleReviewCategoryDetails(category, anchor) {
  if (!category) return
  const set = reviewSelectedSet("expandedCategories")
  toggleSetValue(set, category)
  setReviewArray("expandedCategories", set)
  saveReviewState()
  renderReviewPreservingPosition(anchor)
  haptic("light")
}

function toggleReviewStore(key, anchor) {
  if (!key) return
  const { category } = parseReviewStoreKey(key)
  const review = getReview()
  const categorySelected = review.selectedCategories.includes(category)
  const selectedStores = reviewSelectedSet("selectedStores")
  const excludedStores = reviewSelectedSet("excludedStores")

  if (categorySelected) toggleSetValue(excludedStores, key)
  else toggleSetValue(selectedStores, key)

  setReviewArray("selectedStores", selectedStores)
  setReviewArray("excludedStores", excludedStores)
  removeReviewTransactionOverridesForStore(key)
  cleanupReviewSelections()
  saveReviewState()
  renderReviewPreservingPosition(anchor)
  haptic("light")
}

function toggleReviewStoreDetails(key, anchor) {
  if (!key) return
  const set = reviewSelectedSet("expandedStores")
  toggleSetValue(set, key)
  setReviewArray("expandedStores", set)
  saveReviewState()
  renderReviewPreservingPosition(anchor)
  haptic("light")
}

function toggleReviewTransaction(id, anchor) {
  const tx = reviewTransactionById(id)
  if (!tx) return

  const review = getReview()
  const storeKey = reviewStoreKey(tx.category, tx.merchant)
  const categorySelected = review.selectedCategories.includes(tx.category)
  const storeSelected = review.selectedStores.includes(storeKey)
  const storeExcluded = review.excludedStores.includes(storeKey)
  const selectedTx = reviewSelectedSet("selectedTransactions")
  const excludedTx = reviewSelectedSet("excludedTransactions")

  if ((categorySelected && !storeExcluded) || storeSelected) {
    toggleSetValue(excludedTx, tx.id)
    selectedTx.delete(tx.id)
  } else {
    toggleSetValue(selectedTx, tx.id)
    excludedTx.delete(tx.id)
  }

  setReviewArray("selectedTransactions", selectedTx)
  setReviewArray("excludedTransactions", excludedTx)
  cleanupReviewSelections()
  saveReviewState()
  renderReviewPreservingPosition(anchor)
  haptic("light")
}

function clearReviewSelection(anchor) {
  const review = getReview()
  review.selectedCategories = []
  review.selectedStores = []
  review.selectedTransactions = []
  review.excludedStores = []
  review.excludedTransactions = []
  saveReviewState()
  renderReviewPreservingPosition(anchor)
  haptic("medium")
  toast("Selection cleared")
}

function clearReview() {
  confirmSheet({
    title: "Clear statement review?",
    body: "Your budgets and expenses stay untouched. The uploaded data is forgotten.",
    primaryLabel: "Clear",
    destructive: true,
    onConfirm: () => {
      app.data._settings.review = ensureReviewShape({})
      app.reviewStatus = ""
      saveData(app.data)
      render()
      haptic("warning")
      toast("Review cleared")
    }
  })
}

function saveReviewPool() {
  const context = reviewAverageContext()
  const stable = reviewStableAmount(context)
  const income = Number(app.drafts.method.monthlyIncome) || 0

  if (reviewMissingMonths() > 0) {
    toast(`Upload ${reviewMissingMonths()} more ${reviewMissingMonths() === 1 ? "month" : "months"}`)
    return
  }

  if (income <= 0 || stable <= 0) {
    toast("Add income and select stable expenses")
    return
  }

  const pool = Math.max(0, roundMoney(income - stable))
  const method = getMethod()
  method.monthlyIncome = income
  method.predictableExpensesTotal = stable
  method.intentionalPool = pool
  method.completedAt = Date.now()
  method.introSeenAt = Number(method.introSeenAt) || Date.now()
  getReview().stableMonthlyAmount = stable
  syncMethodDraft()
  saveReviewState()
  render()
  haptic("success")
  toast(`Pool saved: ${fmt(pool)} available`)
}

function closeModal(shouldRender = true) {
  const previousModal = app.modal

  if (app.modal === "iconPicker" && app.iconPickerReturnModal) {
    app.modal = app.iconPickerReturnModal
    app.iconPickerReturnModal = null
    app.iconPickerTarget = null
    app.iconPickerQuery = ""
    if (shouldRender) renderModal()
    return
  }

  if (app.modal === "categoryHistory") {
    closeCategoryHistory(shouldRender)
    return
  }

  app.modal = null
  app.confirmConfig = null
  app.confirmDeleteCtx = null
  if (previousModal === "methodIntro") app.methodIntroMode = "firstRun"
  if (previousModal === "installCoach") app.installCoachNext = null
  app.editingBudgetId = null
  app.editingPresetId = null
  app.editingPresetCat = null
  app.editingEntryId = null
  app.editingCat = null
  app.editingEntryShared = false
  app.editingWishId = null
  app.editingWishCat = null
  app.iconPickerTarget = null
  app.iconPickerReturnModal = null
  app.iconPickerQuery = ""
  if (shouldRender) renderModal()
}

function chooseCat(id) {
  if (!categoryById(id)) return
  haptic("light")
  app.selectedCat = id
  closeModal(false)
  render()
  toast("Category selected")
}

function setAuthMode(mode) {
  app.drafts.cloud.mode = ["signin", "signup", "code", "reset"].includes(mode) ? mode : "signin"
  app.drafts.cloud.codeSent = false
  app.drafts.cloud.resetSent = false
  app.drafts.cloud.password = ""
  app.drafts.cloud.newPassword = ""
  app.drafts.cloud.confirmPassword = ""
  render()
}

function openIconPicker(target) {
  if (!target) return
  app.iconPickerTarget = target
  app.iconPickerQuery = ""
  app.iconPickerReturnModal = app.modal && app.modal !== "iconPicker" ? app.modal : null
  app.modal = "iconPicker"
  haptic("light")
  renderModal()
}

function chooseIcon(value) {
  if (!value) return
  const target = app.iconPickerTarget

  if (target === "category") app.drafts.category.icon = value
  if (target === "budgetEdit") app.drafts.budgetEdit.icon = value
  if (target === "preset") app.drafts.preset.icon = value
  if (target === "presetEdit") app.drafts.presetEdit.icon = value
  if (target === "wish") app.drafts.wish.icon = value
  if (target === "wishEdit") app.drafts.wishEdit.icon = value

  const returnModal = app.iconPickerReturnModal
  app.iconPickerTarget = null
  app.iconPickerReturnModal = null
  app.iconPickerQuery = ""
  app.modal = returnModal || null
  haptic("light")

  if (app.modal) renderModal()
  else render()
}

async function saveExpense() {
  const amount = Number(app.drafts.add.amt)
  const cat = categoryById(app.selectedCat)
  if (!cat || amount <= 0) return

  const description = app.drafts.add.desc.trim() || cat.label
  const selectedDate = clampExpenseDateISO(app.drafts.add.dateISO)
  const targetKey = monthKeyFromISO(selectedDate)

  if (cat.shared) {
    const result = await sharedAddTransaction(cat.id, {
      amount,
      description,
      occurredOn: selectedDate
    })
    if (!result) { haptic("error"); return }
    app.drafts.add = freshAddDraft()
    app.selectedCat = null
    app.view = targetKey === app.key ? "home" : "log"
    render()
    haptic("success")
    toast(targetKey === app.key ? "Saved" : `Saved for ${monthShortLabel(targetKey)}`)
    return
  }

  if (!Array.isArray(app.data[targetKey])) app.data[targetKey] = []
  app.data[targetKey].push({
    id: Date.now() + Math.floor(Math.random() * 1000),
    cat: cat.id,
    amt: amount,
    desc: description,
    date: dateLabelFromISO(selectedDate),
    dateISO: selectedDate
  })
  markActiveMonth(app.data, targetKey)

  app.drafts.add = freshAddDraft()
  app.selectedCat = null
  saveData(app.data)
  app.view = targetKey === app.key ? "home" : "log"
  render()
  haptic("success")
  toast(targetKey === app.key ? "Saved" : `Saved for ${monthShortLabel(targetKey)}`)
}

function usePreset(id) {
  const preset = presetById(id)
  if (!preset) return
  app.drafts.add.amt = String(Number(preset.amt) || "")
  app.drafts.add.desc = preset.desc || ""
  if (categoryById(preset.cat)) app.selectedCat = preset.cat
  render()
  haptic("light")
  toast("Preset ready")
}

function addCategory() {
  if (!canAddCategory()) return

  const label = app.drafts.category.label.trim()
  const budget = Number(app.drafts.category.budget)
  app.data._settings.budgets.push({
    id: makeCatId(label),
    label,
    icon: app.drafts.category.icon.trim() || "🏷️",
    budget,
    color: nextCategoryColor(app.data._settings.budgets)
  })

  app.drafts.category = { icon: "", label: "", budget: "" }
  saveData(app.data)
  render()
  haptic("success")
  toast("Budget added")
}

function saveCategoryBudget(id) {
  const input = document.querySelector(`.cat-budget-input[data-id="${CSS.escape(id)}"]`)
  const amount = Number(input ? input.value : 0)
  const cat = rawCategoryById(id)

  if (!cat || amount <= 0) {
    toast("Invalid limit")
    return
  }

  cat.budget = amount
  saveData(app.data)
  render()
  haptic("success")
  toast("Limit updated")
}

function openBudgetEdit(id) {
  // Local budget?
  const localBudget = rawCategoryById(id)
  if (localBudget) {
    app.editingBudgetId = localBudget.id
    app.editingBudgetShared = false
    app.drafts.budgetEdit = {
      icon: localBudget.icon || "🏷️",
      label: localBudget.label || "",
      budget: String(Number(localBudget.budget) || "")
    }
    openModal("budgetEdit")
    return
  }
  // Shared budget?
  const sharedBudget = sharedBudgetById(id)
  if (sharedBudget) {
    app.editingBudgetId = sharedBudget.id
    app.editingBudgetShared = true
    if (sharedBudget.myRole === "owner") {
      app.drafts.budgetEdit = {
        icon: sharedBudget.icon || "🏷️",
        label: sharedBudget.label || "",
        budget: String(Number(sharedBudget.budget) || "")
      }
      openModal("sharedBudgetEdit")
    } else {
      // Members go straight to the members view
      openBudgetMembers(sharedBudget.id)
    }
  }
}

function saveEditingBudget() {
  const budget = rawCategoryById(app.editingBudgetId)
  const label = app.drafts.budgetEdit.label.trim()
  const amount = Number(app.drafts.budgetEdit.budget)

  if (!budget || !label || amount <= 0) {
    toast("Check the budget details")
    return
  }

  const duplicate = app.data._settings.budgets.some(b =>
    b.id !== budget.id && b.label.trim().toLowerCase() === label.toLowerCase()
  )

  if (duplicate) {
    toast("That budget already exists")
    return
  }

  budget.label = label
  budget.budget = amount
  budget.icon = app.drafts.budgetEdit.icon.trim() || "🏷️"
  closeModal(false)
  saveData(app.data)
  render()
  haptic("success")
  toast("Budget updated")
}

function deleteEditingBudget() {
  const id = app.editingBudgetId
  const budget = rawCategoryById(id)
  if (!budget) return
  confirmSheet({
    title: `Delete ${budget.label}?`,
    body: "Its expenses, presets, and wishes will also be deleted.",
    primaryLabel: "Delete",
    destructive: true,
    onConfirm: () => deleteCategory(id, { confirmed: true })
  })
}

function deleteCategory(id, options = {}) {
  if (app.data._settings.budgets.length <= 1) {
    toast("Keep at least 1 budget")
    return
  }

  const cat = rawCategoryById(id)
  if (!cat) return

  if (!options.confirmed) {
    confirmSheet({
      title: `Delete ${cat.label}?`,
      body: "Its expenses, presets, and wishes will also be deleted.",
      primaryLabel: "Delete",
      destructive: true,
      onConfirm: () => deleteCategory(id, { confirmed: true })
    })
    return
  }

  const snapshot = {
    budget: clone(cat),
    presets: app.data._settings.presets.filter(p => p.cat === id).map(clone),
    wishes: app.data._settings.wishes.filter(w => w.cat === id).map(clone),
    monthEntries: {}
  }
  Object.keys(app.data).forEach(key => {
    if (key === "_settings" || !Array.isArray(app.data[key])) return
    const removed = app.data[key].filter(entry => entry.cat === id)
    if (removed.length) snapshot.monthEntries[key] = removed.map(clone)
    app.data[key] = app.data[key].filter(entry => entry.cat !== id)
  })
  app.data._settings.budgets = app.data._settings.budgets.filter(b => b.id !== id)
  app.data._settings.presets = app.data._settings.presets.filter(p => p.cat !== id)
  app.data._settings.wishes = app.data._settings.wishes.filter(w => w.cat !== id)
  if (app.selectedCat === id) app.selectedCat = null
  if (app.newPresetCat === id) app.newPresetCat = null
  if (app.newWishCat === id) app.newWishCat = null

  saveData(app.data)
  render()
  haptic("warning")
  undoToast(`Deleted ${snapshot.budget.label}`, () => {
    app.data._settings.budgets.push(snapshot.budget)
    snapshot.presets.forEach(p => app.data._settings.presets.push(p))
    snapshot.wishes.forEach(w => app.data._settings.wishes.push(w))
    Object.entries(snapshot.monthEntries).forEach(([key, entries]) => {
      if (!Array.isArray(app.data[key])) app.data[key] = []
      entries.forEach(e => app.data[key].push(e))
    })
    saveData(app.data)
    render()
    toast("Restored")
  })
}

function pickPresetCat(id) {
  if (!categoryById(id)) return
  app.newPresetCat = id
  render()
}

function addPreset() {
  if (!canAddPreset()) return
  const cat = categoryById(app.newPresetCat)
  app.data._settings.presets.push({
    id: makePresetId(app.drafts.preset.desc),
    desc: app.drafts.preset.desc.trim(),
    amt: Number(app.drafts.preset.amt),
    cat: app.newPresetCat,
    icon: app.drafts.preset.icon.trim() || (cat ? cat.icon : "⚡")
  })
  app.drafts.preset = { icon: "", desc: "", amt: "" }
  saveData(app.data)
  render()
  haptic("success")
  toast("Preset created")
}

function deletePreset(id, options = {}) {
  const preset = presetById(id)
  if (!preset) return

  if (!options.confirmed) {
    confirmSheet({
      title: `Delete "${preset.desc}"?`,
      body: "This preset will be removed from your quick-add list.",
      primaryLabel: "Delete",
      destructive: true,
      onConfirm: () => deletePreset(id, { confirmed: true })
    })
    return
  }

  const snapshot = clone(preset)
  app.data._settings.deletedPresetIds = app.data._settings.deletedPresetIds || []
  if (!app.data._settings.deletedPresetIds.includes(id)) app.data._settings.deletedPresetIds.push(id)
  app.data._settings.presets = app.data._settings.presets.filter(p => p.id !== id)
  saveData(app.data)
  render()
  haptic("warning")
  undoToast(`Deleted "${snapshot.desc}"`, () => {
    app.data._settings.deletedPresetIds = (app.data._settings.deletedPresetIds || []).filter(pid => pid !== snapshot.id)
    app.data._settings.presets.push(snapshot)
    saveData(app.data)
    render()
    toast("Restored")
  })
}

function openPresetEdit(id) {
  const preset = presetById(id)
  if (!preset) return
  app.editingPresetId = preset.id
  app.editingPresetCat = preset.cat
  app.drafts.presetEdit = {
    icon: preset.icon || "⚡",
    desc: preset.desc || "",
    amt: String(Number(preset.amt) || "")
  }
  openModal("presetEdit")
}

function pickPresetEditCat(id) {
  if (!categoryById(id)) return
  app.editingPresetCat = id
  renderModal()
}

function saveEditingPreset() {
  const preset = presetById(app.editingPresetId)
  const amount = Number(app.drafts.presetEdit.amt)
  const desc = app.drafts.presetEdit.desc.trim()
  const cat = categoryById(app.editingPresetCat)

  if (!preset || !desc || amount <= 0 || !cat) {
    toast("Check the preset details")
    return
  }

  preset.desc = desc
  preset.amt = amount
  preset.cat = cat.id
  preset.icon = app.drafts.presetEdit.icon.trim() || cat.icon || "⚡"
  closeModal(false)
  saveData(app.data)
  render()
  haptic("success")
  toast("Preset updated")
}

function deleteEditingPreset() {
  const preset = presetById(app.editingPresetId)
  if (!preset) return
  const id = preset.id
  confirmSheet({
    title: `Delete "${preset.desc}"?`,
    body: "This preset will be removed from your quick-add list.",
    primaryLabel: "Delete",
    destructive: true,
    onConfirm: () => deletePreset(id, { confirmed: true })
  })
}

function pickWishCat(id) {
  if (!categoryById(id)) return
  app.newWishCat = id
  render()
}

function addWish() {
  if (!canAddWish()) return
  app.data._settings.wishes.push({
    id: makeWishId(app.drafts.wish.desc),
    desc: app.drafts.wish.desc.trim(),
    amt: Number(app.drafts.wish.amt),
    cat: app.newWishCat,
    icon: app.drafts.wish.icon.trim() || "✨"
  })
  app.drafts.wish = { icon: "", desc: "", amt: "" }
  saveData(app.data)
  render()
  haptic("success")
  toast("Wish saved")
}

function deleteWish(id, options = {}) {
  const wish = wishById(id)
  if (!wish) return

  if (!options.confirmed) {
    confirmSheet({
      title: `Delete "${wish.desc}"?`,
      body: "This wish will be removed from your wishlist.",
      primaryLabel: "Delete",
      destructive: true,
      onConfirm: () => deleteWish(id, { confirmed: true })
    })
    return
  }

  const snapshot = clone(wish)
  app.data._settings.wishes = app.data._settings.wishes.filter(w => w.id !== id)
  saveData(app.data)
  render()
  haptic("warning")
  undoToast(`Deleted "${snapshot.desc}"`, () => {
    app.data._settings.wishes.push(snapshot)
    saveData(app.data)
    render()
    toast("Restored")
  })
}

function buyWish(id) {
  const wish = wishById(id)
  if (!wish || !categoryById(wish.cat)) {
    toast("Invalid category")
    return
  }

  const selectedDate = todayISO()
  if (!Array.isArray(app.data[app.key])) app.data[app.key] = []
  app.data[app.key].push({
    id: Date.now() + Math.floor(Math.random() * 1000),
    desc: wish.desc,
    amt: Number(wish.amt) || 0,
    cat: wish.cat,
    date: dateLabelFromISO(selectedDate),
    dateISO: selectedDate
  })
  app.data._settings.wishes = app.data._settings.wishes.filter(w => w.id !== id)
  saveData(app.data)
  render()
  haptic("success")
  toast("Bought and added to Activity")
}

function openWishEdit(id) {
  const wish = wishById(id)
  if (!wish) return
  haptic("light")
  app.editingWishId = wish.id
  app.editingWishCat = wish.cat
  app.drafts.wishEdit = {
    icon: wish.icon || "✨",
    desc: wish.desc || "",
    amt: String(Number(wish.amt) || "")
  }
  openModal("wishEdit")
}

function pickWishEditCat(id) {
  if (!categoryById(id)) return
  app.editingWishCat = id
  renderModal()
}

function saveEditingWish() {
  const wish = wishById(app.editingWishId)
  const amount = Number(app.drafts.wishEdit.amt)
  const desc = app.drafts.wishEdit.desc.trim()
  if (!wish || !desc || amount <= 0 || !categoryById(app.editingWishCat)) {
    toast("Check the details")
    return
  }

  wish.desc = desc
  wish.amt = amount
  wish.cat = app.editingWishCat
  wish.icon = app.drafts.wishEdit.icon.trim() || "✨"
  closeModal(false)
  saveData(app.data)
  render()
  haptic("success")
  toast("Wish updated")
}

function deleteEditingWish() {
  const id = app.editingWishId
  const wish = wishById(id)
  if (!wish) return
  confirmSheet({
    title: `Delete "${wish.desc}"?`,
    body: "This wish will be removed from your wishlist.",
    primaryLabel: "Delete",
    destructive: true,
    onConfirm: () => deleteWish(id, { confirmed: true })
  })
}

function buyEditingWish() {
  const wish = wishById(app.editingWishId)
  if (!wish) return
  wish.desc = app.drafts.wishEdit.desc.trim() || wish.desc
  wish.amt = Number(app.drafts.wishEdit.amt) || wish.amt
  wish.cat = app.editingWishCat || wish.cat
  wish.icon = app.drafts.wishEdit.icon.trim() || wish.icon
  const id = wish.id
  closeModal(false)
  buyWish(id)
}

function openEntryEdit(id) {
  const entry = entryById(id)
  if (!entry) return
  haptic("light")
  // Shared entries use UUID strings; local use numbers. Store as-is.
  app.editingEntryId = entry.shared ? String(entry.id) : Number(entry.id)
  app.editingEntryShared = !!entry.shared
  app.editingCat = entry.cat
  app.drafts.edit = {
    desc: entry.desc || "",
    amt: String(Number(entry.amt) || ""),
    dateISO: clampExpenseDateISO(entry.dateISO || entry.occurredOn)
  }
  openModal("entryEdit")
}

function pickEditCat(id) {
  if (!categoryById(id)) return
  app.editingCat = id
  renderModal()
}

function finishCategoryHistoryEdit(message, hapticType = "success") {
  const returnToCapture = app.categoryHistory.editBack === "capture"
  if (returnToCapture) {
    closeCategoryHistory(false)
  } else {
    app.categoryHistory.mode = "list"
    app.categoryHistory.editBack = "list"
    app.editingEntryId = null
    app.editingEntryShared = false
    app.editingCat = null
  }
  render()
  haptic(hapticType)
  toast(message)
}

async function saveEditingEntry(options = {}) {
  const entry = entryById(app.editingEntryId)
  const amount = Number(app.drafts.edit.amt)
  if (!entry || !app.editingCat || amount <= 0) {
    toast("Check amount and category")
    return
  }
  const description = app.drafts.edit.desc.trim() || "Expense"
  const selectedDate = clampExpenseDateISO(app.drafts.edit.dateISO || entry.dateISO || entry.occurredOn)
  const targetMonthKey = monthKeyFromISO(selectedDate)
  const currentMonthKey = entry.monthKey || app.key

  if (entry.shared) {
    // Shared transactions: recategorizing across budgets isn't supported in v1 because
    // the budget is determined by the row's budget_id. So we only support edit-in-place.
    if (app.editingCat !== entry.cat) {
      toast("Moving shared transactions across budgets is not supported")
      return
    }
    const ok = await sharedUpdateTransaction(entry.id, {
      amount,
      description,
      occurredOn: selectedDate
    })
    if (!ok) { haptic("error"); return }
    if (options.categoryHistory) {
      finishCategoryHistoryEdit(targetMonthKey === currentMonthKey ? "Expense updated" : `Moved to ${monthShortLabel(targetMonthKey)}`)
      return
    }
    closeModal(false)
    render()
    haptic("success")
    toast(targetMonthKey === currentMonthKey ? "Expense updated" : `Moved to ${monthShortLabel(targetMonthKey)}`)
    return
  }

  // The `entry` from entryById is the state-shaped copy (calcState rebuilds
  // app.state entries every render). Mutate the raw row in the row's original month.
  const monthKey = currentMonthKey
  const rawList = Array.isArray(app.data[monthKey]) ? app.data[monthKey] : []
  const targetId = String(entry.id)
  const rawEntry = rawList.find(e => String(e.id) === targetId)
  if (!rawEntry) {
    toast("Could not find this expense")
    return
  }
  const updatedEntry = {
    ...rawEntry,
    desc: description,
    amt: amount,
    cat: app.editingCat,
    date: dateLabelFromISO(selectedDate),
    dateISO: selectedDate
  }

  if (targetMonthKey === monthKey) {
    Object.assign(rawEntry, updatedEntry)
  } else {
    app.data[monthKey] = rawList.filter(e => String(e.id) !== targetId)
    if (!Array.isArray(app.data[targetMonthKey])) app.data[targetMonthKey] = []
    app.data[targetMonthKey].push(updatedEntry)
    markActiveMonth(app.data, targetMonthKey)
  }

  saveData(app.data)
  if (options.categoryHistory) {
    finishCategoryHistoryEdit(targetMonthKey === monthKey ? "Expense updated" : `Moved to ${monthShortLabel(targetMonthKey)}`)
    return
  }
  closeModal(false)
  render()
  haptic("success")
  toast(targetMonthKey === monthKey ? "Expense updated" : `Moved to ${monthShortLabel(targetMonthKey)}`)
}

async function deleteEntry(id, options = {}) {
  const entry = entryById(id)
  if (!entry) return

  if (!options.confirmed) {
    confirmSheet({
      title: `Delete this expense?`,
      body: `"${entry.desc || "Expense"}" will be removed from your activity.`,
      primaryLabel: "Delete",
      destructive: true,
      onConfirm: () => deleteEntry(id, { confirmed: true })
    })
    return
  }

  if (entry.shared) {
    const ok = await sharedDeleteTransaction(entry.id)
    if (!ok) { haptic("error"); return }
    if (options.categoryHistory) {
      finishCategoryHistoryEdit("Deleted", "warning")
      return
    }
    render()
    haptic("warning")
    const txId = entry.id
    undoToast(`Deleted "${entry.desc || "Expense"}"`, async () => {
      const restored = await sharedRestoreTransaction(txId)
      if (restored) {
        render()
        toast("Restored")
      } else {
        toast("Could not restore")
      }
    })
    return
  }

  const monthKey = entry.monthKey || app.key
  if (!Array.isArray(app.data[monthKey])) return
  const targetId = String(entry.id)
  const rawEntry = app.data[monthKey].find(e => String(e.id) === targetId)
  if (!rawEntry) return
  const snapshot = clone(rawEntry)
  app.data[monthKey] = app.data[monthKey].filter(e => String(e.id) !== targetId)
  saveData(app.data)
  if (options.categoryHistory) {
    finishCategoryHistoryEdit("Deleted", "warning")
    return
  }
  render()
  haptic("warning")
  undoToast(`Deleted "${entry.desc || "Expense"}"`, () => {
    if (!Array.isArray(app.data[monthKey])) app.data[monthKey] = []
    app.data[monthKey].push(snapshot)
    saveData(app.data)
    render()
    toast("Restored")
  })
}

function saveCategoryHistoryEntry() {
  saveEditingEntry({ categoryHistory: true })
}

function deleteCategoryHistoryEntry() {
  const id = app.editingEntryId
  const entry = entryById(id)
  if (!entry) return
  confirmSheet({
    title: "Delete this expense?",
    body: `"${entry.desc || "Expense"}" will be removed from your activity.`,
    primaryLabel: "Delete",
    destructive: true,
    onCancel: () => {
      app.modal = "categoryHistory"
      renderModal()
    },
    onConfirm: () => deleteEntry(id, { confirmed: true, categoryHistory: true })
  })
}

function deleteEditingEntry() {
  const id = app.editingEntryId
  const entry = entryById(id)
  if (!entry) return
  confirmSheet({
    title: "Delete this expense?",
    body: `"${entry.desc || "Expense"}" will be removed from your activity.`,
    primaryLabel: "Delete",
    destructive: true,
    onConfirm: () => deleteEntry(id, { confirmed: true })
  })
}

function saveEditingAsPreset() {
  const desc = app.drafts.edit.desc.trim()
  const amount = Number(app.drafts.edit.amt)
  const cat = categoryById(app.editingCat)

  if (!desc || amount <= 0 || !cat) {
    toast("Check the details")
    return
  }

  app.data._settings.presets.push({
    id: makePresetId(desc),
    desc,
    amt: amount,
    cat: cat.id,
    icon: cat.icon || "⚡"
  })
  closeModal(false)
  saveData(app.data)
  render()
  haptic("success")
  toast("Preset created")
}

function csvEscape(value) {
  const s = value === undefined || value === null ? "" : String(value)
  return /[",\n\r]/.test(s) ? "\"" + s.replace(/"/g, "\"\"") + "\"" : s
}

function downloadFile(filename, content, type) {
  const blob = new Blob([content], { type })
  downloadBlob(filename, blob)
}

function downloadBlob(filename, blob) {
  const url = URL.createObjectURL(blob)
  const link = document.createElement("a")
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  link.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1500)
}

function todayISODate() {
  return todayISO()
}

// ============================================================
// Export — modal flow with format/range/type/budget filters
// ============================================================

function defaultExportDraft() {
  return {
    format: "excel",
    range: "thisMonth",
    type: "all",
    selectedBudgetIds: null  // null = all selected
  }
}

function allKnownBudgetsForExport() {
  const local = (app.data._settings.budgets || []).map(b => ({
    id: b.id,
    label: b.label,
    icon: b.icon || "🏷️",
    color: b.color || "#0F766E",
    shared: false
  }))
  const shared = (app.shared.budgets || []).map(b => ({
    id: b.id,
    label: b.label,
    icon: b.icon || "🏷️",
    color: b.color || "#0F766E",
    shared: true
  }))
  return [...local, ...shared]
}

function monthsInRange(range) {
  const now = new Date()
  const curY = now.getFullYear()
  const curM0 = now.getMonth()
  const key = (y, m0) => `${y}-${m0}`
  const back = n => {
    const out = []
    let y = curY, m = curM0
    for (let i = 0; i < n; i++) {
      out.push(key(y, m))
      m -= 1
      if (m < 0) { m = 11; y -= 1 }
    }
    return out
  }
  switch (range) {
    case "thisMonth": return back(1)
    case "last3": return back(3)
    case "last6": return back(6)
    case "thisYear": {
      const out = []
      for (let m = 0; m <= curM0; m++) out.push(key(curY, m))
      return out
    }
    case "all": return null
    default: return back(1)
  }
}

async function buildExportRows(filter) {
  const rangeMonths = monthsInRange(filter.range)
  const typeFilter = filter.type
  const selected = filter.selectedBudgetIds  // null = all, else Set

  const rows = []

  // ----- Private (local) -----
  if (typeFilter === "all" || typeFilter === "private") {
    Object.keys(app.data).forEach(key => {
      if (key === "_settings" || !parseMonthKey(key)) return
      if (!Array.isArray(app.data[key])) return
      if (rangeMonths && !rangeMonths.includes(key)) return
      app.data[key].forEach(entry => {
        if (selected && !selected.has(entry.cat)) return
        const cat = rawCategoryById(entry.cat) || { label: entry.cat || "Uncategorized", icon: "" }
        rows.push({
          date: localEntryToISODate(entry, key),
          month: monthLabel(key),
          budget: cat.label,
          description: entry.desc || "",
          amount: Number(entry.amt) || 0,
          type: "Private",
          author: app.cloudEmail || ""
        })
      })
    })
  }

  // ----- Shared (workspace + standalone) -----
  if ((typeFilter === "all" || typeFilter === "shared") && supabaseClient && app.cloudUser) {
    const sharedBudgets = (app.shared.budgets || []).filter(b => !selected || selected.has(b.id))
    const ids = sharedBudgets.map(b => b.id)
    if (ids.length) {
      let query = supabaseClient
        .from("shared_transactions")
        .select("*")
        .in("budget_id", ids)
        .is("deleted_at", null)
      if (rangeMonths) query = query.in("month_key", rangeMonths)
      const { data: txs, error } = await query
      if (!error && Array.isArray(txs)) {
        const budgetById = {}
        sharedBudgets.forEach(b => { budgetById[b.id] = b })
        for (const tx of txs) {
          const b = budgetById[tx.budget_id]
          if (!b) continue
          rows.push({
            date: tx.occurred_on,
            month: monthLabel(tx.month_key),
            budget: b.label,
            description: tx.description || "",
            amount: Number(tx.amount) || 0,
            type: b.workspaceId ? "Shared (workspace)" : "Shared",
            author: tx.created_by_email || ""
          })
        }
      }
    }
  }

  rows.sort((a, b) => (b.date || "").localeCompare(a.date || ""))
  return rows
}

function openExport() {
  app.exportDraft = defaultExportDraft()
  haptic("light")
  app.modal = "export"
  renderModal()
}

function setExportFormat(value) {
  if (!app.exportDraft) return
  app.exportDraft.format = value === "csv" ? "csv" : "excel"
  haptic("selection")
  renderModal()
}

function setExportRange(value) {
  if (!app.exportDraft) return
  app.exportDraft.range = value
  haptic("selection")
  renderModal()
}

function setExportType(value) {
  if (!app.exportDraft) return
  app.exportDraft.type = value
  haptic("selection")
  renderModal()
}

function toggleAllExportBudgets() {
  if (!app.exportDraft) return
  if (app.exportDraft.selectedBudgetIds === null) {
    app.exportDraft.selectedBudgetIds = new Set()  // none selected
  } else {
    app.exportDraft.selectedBudgetIds = null  // all selected
  }
  haptic("light")
  renderModal()
}

function toggleExportBudget(id) {
  if (!app.exportDraft) return
  if (app.exportDraft.selectedBudgetIds === null) {
    const ids = new Set(allKnownBudgetsForExport().map(b => b.id))
    ids.delete(id)
    app.exportDraft.selectedBudgetIds = ids
  } else {
    if (app.exportDraft.selectedBudgetIds.has(id)) {
      app.exportDraft.selectedBudgetIds.delete(id)
    } else {
      app.exportDraft.selectedBudgetIds.add(id)
    }
  }
  haptic("selection")
  renderModal()
}

async function runExport() {
  const d = app.exportDraft || defaultExportDraft()
  toast("Preparing export…")
  try {
    const rows = await buildExportRows({
      range: d.range,
      type: d.type,
      selectedBudgetIds: d.selectedBudgetIds
    })
    if (!rows.length) {
      haptic("warning")
      toast("No transactions match these filters")
      return
    }
    const stamp = todayISODate()
    if (d.format === "csv") {
      writeExportCSV(`budget-${stamp}.csv`, rows)
      haptic("success")
      toast(`${rows.length} ${rows.length === 1 ? "row" : "rows"} exported`)
      closeModal(false)
    } else {
      await writeExportExcel(`budget-${stamp}.xlsx`, rows, d)
      haptic("success")
      toast(`${rows.length} ${rows.length === 1 ? "row" : "rows"} exported`)
      closeModal(false)
    }
  } catch (err) {
    console.error("Export failed", err)
    haptic("error")
    toast("Export failed")
  }
}

function writeExportCSV(filename, rows) {
  const headers = ["Date", "Month", "Budget", "Description", "Amount", "Type", "Author"]
  const lines = [headers.join(",")]
  for (const r of rows) {
    lines.push([
      r.date || "",
      csvEscape(r.month || ""),
      csvEscape(r.budget || ""),
      csvEscape(r.description || ""),
      (Number(r.amount) || 0).toFixed(2),
      csvEscape(r.type || ""),
      csvEscape(r.author || "")
    ].join(","))
  }
  // UTF-8 BOM so Excel opens accented chars / emoji correctly
  downloadFile(filename, "﻿" + lines.join("\n"), "text/csv;charset=utf-8")
}

let xlsxStyleLoading = null
function loadXlsxStyle() {
  if (window.XLSX && window.XLSX.write) return Promise.resolve(window.XLSX)
  if (xlsxStyleLoading) return xlsxStyleLoading
  xlsxStyleLoading = new Promise((resolve, reject) => {
    const script = document.createElement("script")
    script.src = "https://cdn.jsdelivr.net/npm/xlsx-js-style@1.2.0/dist/xlsx.bundle.js"
    script.async = true
    script.onload = () => {
      if (window.XLSX && window.XLSX.write) resolve(window.XLSX)
      else reject(new Error("xlsx-js-style loaded but XLSX not found"))
    }
    script.onerror = () => reject(new Error("Could not load xlsx-js-style"))
    document.head.appendChild(script)
  })
  return xlsxStyleLoading
}

async function writeExportExcel(filename, rows, draft) {
  const XLSX = await loadXlsxStyle()

  // ----- Transactions sheet -----
  const aoa = [
    ["Date", "Month", "Budget", "Description", "Amount", "Type", "Author"]
  ]
  rows.forEach(r => {
    aoa.push([r.date || "", r.month || "", r.budget || "", r.description || "", Number(r.amount) || 0, r.type || "", r.author || ""])
  })
  const ws = XLSX.utils.aoa_to_sheet(aoa)

  ws["!cols"] = [
    { wch: 12 },
    { wch: 16 },
    { wch: 22 },
    { wch: 34 },
    { wch: 12 },
    { wch: 18 },
    { wch: 26 }
  ]
  ws["!freeze"] = { xSplit: 0, ySplit: 1 }
  ws["!autofilter"] = { ref: ws["!ref"] }

  const headerStyle = {
    font: { name: "Calibri", sz: 12, bold: true, color: { rgb: "FFFFFF" } },
    fill: { patternType: "solid", fgColor: { rgb: "0F766E" } },
    alignment: { horizontal: "left", vertical: "center" }
  }
  const bodyBase = {
    font: { name: "Calibri", sz: 11, color: { rgb: "111827" } },
    alignment: { vertical: "center" }
  }
  const bodyAlt = {
    font: { name: "Calibri", sz: 11, color: { rgb: "111827" } },
    fill: { patternType: "solid", fgColor: { rgb: "F6F8FA" } },
    alignment: { vertical: "center" }
  }

  const range = XLSX.utils.decode_range(ws["!ref"])
  for (let R = range.s.r; R <= range.e.r; R++) {
    const alt = R > 0 && R % 2 === 0
    for (let C = range.s.c; C <= range.e.c; C++) {
      const ref = XLSX.utils.encode_cell({ c: C, r: R })
      const cell = ws[ref]
      if (!cell) continue

      if (R === 0) {
        cell.s = headerStyle
        continue
      }

      const baseStyle = alt ? bodyAlt : bodyBase
      cell.s = { ...baseStyle }

      if (C === 4) {
        cell.t = "n"
        cell.z = '"$"#,##0.00'
        cell.s = { ...cell.s, alignment: { vertical: "center", horizontal: "right" } }
      }
      if (C === 0 && typeof cell.v === "string" && /^\d{4}-\d{2}-\d{2}/.test(cell.v)) {
        const d = new Date(cell.v + "T00:00:00")
        if (!isNaN(d.getTime())) {
          cell.v = d
          cell.t = "d"
          cell.z = "yyyy-mm-dd"
        }
      }
    }
  }

  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, "Transactions")

  // ----- Summary sheet -----
  const totalsByBudget = {}
  rows.forEach(r => {
    if (!totalsByBudget[r.budget]) totalsByBudget[r.budget] = { count: 0, total: 0 }
    totalsByBudget[r.budget].count += 1
    totalsByBudget[r.budget].total += Number(r.amount) || 0
  })
  const summaryAoa = [["Budget", "Transactions", "Total spent"]]
  Object.entries(totalsByBudget)
    .sort((a, b) => b[1].total - a[1].total)
    .forEach(([label, agg]) => {
      summaryAoa.push([label, agg.count, agg.total])
    })
  const grandTotal = rows.reduce((s, r) => s + (Number(r.amount) || 0), 0)
  summaryAoa.push(["Total", rows.length, grandTotal])

  const sws = XLSX.utils.aoa_to_sheet(summaryAoa)
  sws["!cols"] = [{ wch: 28 }, { wch: 14 }, { wch: 16 }]
  sws["!freeze"] = { xSplit: 0, ySplit: 1 }

  const sRange = XLSX.utils.decode_range(sws["!ref"])
  for (let R = sRange.s.r; R <= sRange.e.r; R++) {
    for (let C = sRange.s.c; C <= sRange.e.c; C++) {
      const ref = XLSX.utils.encode_cell({ c: C, r: R })
      const cell = sws[ref]
      if (!cell) continue
      if (R === 0) {
        cell.s = headerStyle
        continue
      }
      const isTotalRow = R === sRange.e.r
      cell.s = isTotalRow
        ? { font: { name: "Calibri", sz: 11, bold: true, color: { rgb: "0F766E" } }, alignment: { vertical: "center" }, fill: { patternType: "solid", fgColor: { rgb: "E6F6F2" } } }
        : { font: { name: "Calibri", sz: 11, color: { rgb: "111827" } }, alignment: { vertical: "center" } }
      if (C === 2) {
        cell.t = "n"
        cell.z = '"$"#,##0.00'
        cell.s = { ...cell.s, alignment: { ...cell.s.alignment, horizontal: "right" } }
      }
      if (C === 1) cell.t = "n"
    }
  }
  XLSX.utils.book_append_sheet(wb, sws, "Summary")

  const out = XLSX.write(wb, { bookType: "xlsx", type: "array" })
  const blob = new Blob([out], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" })
  downloadBlob(filename, blob)
}

async function installPWA(options = {}) {
  if (!app.installPrompt) return
  haptic("medium")
  app.installPrompt.prompt()
  await app.installPrompt.userChoice.catch(() => null)
  app.installPrompt = null
  if (options.renderAfter !== false) render()
}

function toast(message) {
  toastEl.textContent = message
  toastEl.classList.add("show")
  clearTimeout(window.__toastTimer)
  window.__toastTimer = setTimeout(() => {
    toastEl.classList.remove("show")
  }, 1800)
}

function hideBootSplash() {
  if (!bootEl) return

  const minVisibleMs = 850
  const elapsed = performance.now() - bootStartedAt
  const wait = Math.max(0, minVisibleMs - elapsed)

  window.setTimeout(() => {
    bootEl.classList.add("boot-exit")
    window.setTimeout(() => bootEl.remove(), 520)
  }, wait)
}

window.addEventListener("beforeinstallprompt", event => {
  event.preventDefault()
  app.installPrompt = event
  render()
})

document.addEventListener("input", handleInput)
document.addEventListener("click", handleClick)

document.addEventListener("keydown", event => {
  if (event.key !== "Escape" && event.key !== "Esc") return
  if (!app.modal) return
  if (app.modal === "methodIntro") return dismissMethodIntro()
  if (app.modal === "installCoach") return continueInstallCoach()
  if (app.modal === "method") return dismissMethod()
  if (app.modal === "confirm") return resolveConfirm(false)
  closeModal()
})

let __sheetDrag = null
modalEl.addEventListener("touchstart", event => {
  const sheet = event.target.closest(".sheet")
  if (!sheet) return
  if (modalEl.classList.contains("story-mode")) return
  if (sheet.scrollTop > 0) return
  const touch = event.touches[0]
  __sheetDrag = { sheet, startY: touch.clientY, startTime: performance.now(), dy: 0 }
}, { passive: true })

modalEl.addEventListener("touchmove", event => {
  if (!__sheetDrag) return
  const touch = event.touches[0]
  const dy = touch.clientY - __sheetDrag.startY
  if (dy <= 0) {
    __sheetDrag.sheet.style.transform = ""
    __sheetDrag.dy = 0
    return
  }
  __sheetDrag.dy = dy
  __sheetDrag.sheet.style.transform = `translate3d(0, ${dy}px, 0)`
  __sheetDrag.sheet.style.transition = "none"
}, { passive: true })

modalEl.addEventListener("touchend", () => {
  if (!__sheetDrag) return
  const { sheet, dy, startTime } = __sheetDrag
  const elapsed = performance.now() - startTime
  const velocity = dy / Math.max(elapsed, 1)
  __sheetDrag = null

  if (dy > 110 || velocity > 0.7) {
    sheet.style.transition = "transform 200ms cubic-bezier(.22,1,.36,1), opacity 200ms cubic-bezier(.22,1,.36,1)"
    sheet.style.transform = `translate3d(0, ${Math.max(dy, 200)}px, 0)`
    sheet.style.opacity = "0"
    haptic("light")
    setTimeout(() => {
      if (app.modal === "confirm") resolveConfirm(false)
      else if (app.modal === "methodIntro") dismissMethodIntro()
      else if (app.modal === "installCoach") continueInstallCoach()
      else if (app.modal === "method") dismissMethod()
      else closeModal()
    }, 180)
  } else {
    sheet.style.transition = "transform 260ms cubic-bezier(.34,1.56,.64,1)"
    sheet.style.transform = ""
    setTimeout(() => {
      sheet.style.transition = ""
    }, 280)
  }
})

if ("serviceWorker" in navigator) {
  let refreshingForUpdate = false
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (refreshingForUpdate) return
    refreshingForUpdate = true
    window.location.reload()
  })

  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./service-worker.js", { updateViaCache: "none" })
      .then(registration => {
        registration.update().catch(() => {})
        registration.addEventListener("updatefound", () => {
          const worker = registration.installing
          if (!worker) return

          worker.addEventListener("statechange", () => {
            if (worker.state === "installed" && navigator.serviceWorker.controller) {
              worker.postMessage({ type: "SKIP_WAITING" })
            }
          })
        })
      })
      .catch(() => {})
  })
}

render()
maybeOpenInitialMethod()
requestAnimationFrame(hideBootSplash)
initCloud()
