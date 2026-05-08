const STORAGE_KEY = "budget_tracker_pwa_v1"
const ROLLOVER_START_KEY = "2026-4"
const SUPABASE_URL = "https://yafcgilvulnbczaizcbf.supabase.co"
const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_xVtese4jTfZsAkB2cgSkOw_b8Wl5ksT"
const CLOUD_SYNC_DELAY = 900

const appEl = document.getElementById("app")
const modalEl = document.getElementById("modal")
const toastEl = document.getElementById("toast")
const bootEl = document.getElementById("boot")
const bootStartedAt = performance.now()

let supabaseClient = null
let cloudSaveTimer = null
let cloudSyncPromise = null

const app = {
  data: loadData(),
  key: monthKey(),
  state: null,
  view: "home",
  modal: null,
  selectedCat: null,
  returnView: null,
  editingBudgetId: null,
  editingPresetId: null,
  editingPresetCat: null,
  editingEntryId: null,
  editingCat: null,
  editingWishId: null,
  editingWishCat: null,
  iconPickerTarget: null,
  iconPickerReturnModal: null,
  iconPickerQuery: "",
  methodStep: 0,
  methodAutoOpened: false,
  newPresetCat: null,
  newWishCat: null,
  installPrompt: null,
  cloudUser: null,
  cloudEmail: "",
  cloudReady: false,
  cloudBusy: false,
  cloudStatus: "Sign in to keep your data backed up",
  lastCloudSyncAt: null,
  recoveringPassword: false,
  drafts: {
    add: { amt: "", desc: "" },
    category: { icon: "", label: "", budget: "" },
    preset: { icon: "", desc: "", amt: "" },
    presetEdit: { icon: "", desc: "", amt: "" },
    wish: { icon: "", desc: "", amt: "" },
    budgetEdit: { icon: "", label: "", budget: "" },
    edit: { desc: "", amt: "" },
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
    dismissedAt: Number(method.dismissedAt) || 0
  }

  if (!d._settings._meta || typeof d._settings._meta !== "object") d._settings._meta = {}
  d._settings._meta.schemaVersion = 6
  d._settings._meta.lastSaved = Number(d._settings._meta.lastSaved) || 0

  Object.keys(d).forEach(key => {
    if (key === "_settings" || !parseMonthKey(key)) return
    d[key] = Array.isArray(d[key])
      ? d[key].filter(Boolean).map(entry => ({
        id: Number(entry.id) || Date.now() + Math.floor(Math.random() * 1000),
        desc: String(entry.desc || "Expense"),
        amt: Number(entry.amt) || 0,
        cat: String(entry.cat || ""),
        date: String(entry.date || "")
      })).filter(entry => entry.amt > 0)
      : []
  })

  return d
}

function loadData() {
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
  localStorage.setItem(STORAGE_KEY, JSON.stringify(shaped))
  if (sync) scheduleCloudSave()
}

function getSavedAt(data) {
  return Number(data?._settings?._meta?.lastSaved) || 0
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
  app.cloudUser = user
  app.cloudEmail = user ? (user.email || "") : ""

  if (!user) {
    clearTimeout(cloudSaveTimer)
    app.cloudReady = false
    app.cloudBusy = false
    app.lastCloudSyncAt = null
    app.cloudStatus = "Sign in to keep your data backed up"
  } else if (!app.cloudStatus || app.cloudStatus === "Sign in to keep your data backed up") {
    app.cloudStatus = "Setting up backup..."
  }
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
      startCloudSync({ preferNewer: true, silent: true })
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

    if (preferNewer && localSavedAt > remoteSavedAt + 1000) {
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
  const ids = budgets.map(b => b.id)
  const baseById = {}
  const carry = {}

  budgets.forEach(b => {
    baseById[b.id] = Number(b.budget) || 0
    carry[b.id] = 0
  })

  if (compareMonthKeys(key, ROLLOVER_START_KEY) <= 0) return carry

  getTrackedMonthKeys(data)
    .filter(k => compareMonthKeys(k, ROLLOVER_START_KEY) >= 0)
    .filter(k => compareMonthKeys(k, key) < 0)
    .forEach(month => {
      const spent = getSpentForMonth(data, month, ids)

      ids.forEach(id => {
        carry[id] = roundMoney((Number(baseById[id]) || 0) + (Number(carry[id]) || 0) - (Number(spent[id]) || 0))
      })
    })

  return carry
}

function calcState(data, key) {
  data = ensureDataShape(data)
  const rawBudgets = data._settings.budgets
  const rolloverMap = calcRolloverMap(data, key, rawBudgets)
  const entries = Array.isArray(data[key]) ? data[key] : []

  const budgets = rawBudgets.map(b => {
    const baseBudget = Number(b.budget) || 0
    const rollover = roundMoney(rolloverMap[b.id] || 0)
    return {
      id: b.id,
      label: b.label,
      icon: b.icon,
      color: b.color,
      baseBudget,
      rollover,
      budget: roundMoney(baseBudget + rollover)
    }
  })

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
  return new Date().toLocaleDateString("en-US", {
    day: "2-digit",
    month: "short"
  })
}

function categoryById(id) {
  return app.state.budgets.find(b => b.id === id)
}

function rawCategoryById(id) {
  return app.data._settings.budgets.find(b => b.id === id)
}

function entryById(id) {
  return (app.data[app.key] || []).find(entry => Number(entry.id) === Number(id))
}

function presetById(id) {
  return app.data._settings.presets.find(preset => preset.id === id)
}

function wishById(id) {
  return app.data._settings.wishes.find(wish => wish.id === id)
}

function rolloverLabel(budget) {
  const rollover = Number(budget.rollover) || 0
  if (Math.abs(rollover) < 0.01) return ""
  return "Rollover " + (rollover > 0 ? "+" : "-") + fmt(Math.abs(rollover))
}

function getBudgetHealth(totalBudget, totalSpent, spent) {
  const entries = app.state.entries || []

  if (!entries.length || totalSpent <= 0) {
    const totalRoll = app.state.budgets.reduce((sum, b) => sum + (Number(b.rollover) || 0), 0)
    if (Math.abs(totalRoll) >= 0.01) {
      return totalRoll > 0
        ? { text: "Rollover from previous months applied", color: "var(--grn)", bg: "#ECFDF5", border: "#A7F3D0" }
        : { text: "Previous overage applied", color: "var(--red)", bg: "#FFF1F2", border: "#FCA5A5" }
    }

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
  file: '<path d="M7 3h7l5 5v13H7V3Z"/><path d="M14 3v5h5"/><path d="M9 14h6"/><path d="M9 17h6"/>'
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

function haptic(type = "light") {
  if (!("vibrate" in navigator)) return

  const patterns = {
    light: 8,
    medium: 14,
    success: [10, 35, 10],
    warning: [18, 40, 18]
  }

  navigator.vibrate(patterns[type] || patterns.light)
}

function secondaryBackView(defaultView = "account") {
  const secondaryViews = ["cats", "presets", "wishes"]
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

function nav() {
  const items = [
    ["home", "dashboard", "Dashboard"],
    ["add", "add", "Add"],
    ["log", "activity", "Activity"],
    ["account", "account", "Account"]
  ]

  return `
    <nav class="nav">
      ${items.map(([view, iconName, label]) => `
        <button class="nav-btn ${app.view === view ? "active" : ""}" data-action="go" data-view="${view}">
          ${icon(iconName, "", "nav-icon")}
          ${label}
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
  const totalRoll = app.state.budgets.reduce((sum, b) => sum + (Number(b.rollover) || 0), 0)
  const rollText = Math.abs(totalRoll) >= 0.01
    ? " · rollover " + (totalRoll > 0 ? "+" : "-") + fmt(Math.abs(totalRoll))
    : ""
  const health = getBudgetHealth(totalBudget, totalSpent, spent)
  const installButton = app.installPrompt
    ? `<button class="top-btn icon-btn" title="Install" aria-label="Install" data-action="install">${icon("download")}</button>`
    : ""
  const cloudTitle = app.cloudUser ? "Backup connected" : "Set up backup"
  const cloudButton = `<button class="top-btn icon-btn cloud-btn ${app.cloudUser ? "online" : ""} ${app.cloudBusy ? "syncing" : ""}" title="${cloudTitle}" aria-label="${cloudTitle}" data-action="go" data-view="account">${icon("cloud")}</button>`
  const budgetContent = app.state.budgets.length
    ? app.state.budgets.map(renderBudgetCard).join("")
    : `<div class="empty budget-empty">
        <div class="empty-title">No leak budgets yet</div>
        <div class="row-meta">Create only the categories that feel invisible or uncontrolled.</div>
        <button class="secondary-btn empty-action" data-action="go" data-view="cats">${icon("add")} Create Leak Budget</button>
      </div>`

  return `
    <section class="view">
      ${header("Budget Tracker", monthLabel(app.key), `
        ${cloudButton}
        ${installButton}
      `)}

      <div class="hero">
        <div class="hero-label">${left < 0 ? "Over budget" : "Available"}</div>
        <div class="hero-amount" style="color:${left < 0 ? "var(--red)" : "var(--txt)"}">${money0(Math.abs(left))}</div>
        <div class="hero-sub">${fmt(totalSpent)} spent of ${fmt(totalBudget)}${rollText}</div>
        <div class="status-pill" style="color:${health.color};background:${health.bg};border-color:${health.border}">${esc(health.text)}</div>

        <div class="kpis">
          <div class="kpi">
            <div class="kpi-label">Spent</div>
            <div class="kpi-value">${fmt(totalSpent)}</div>
          </div>
          <div class="kpi">
            <div class="kpi-label">Limit</div>
            <div class="kpi-value">${fmt(totalBudget)}</div>
          </div>
          <div class="kpi">
            <div class="kpi-label">Used</div>
            <div class="kpi-value" style="color:${globalPct > 90 ? "var(--red)" : globalPct > 70 ? "var(--amb)" : "var(--txt)"}">${Math.round(globalPct)}%</div>
          </div>
        </div>
      </div>

      <div class="global-bar">
        <div class="bar-fill" style="width:${pct}%;background:${pct > 90 ? "var(--red)" : pct > 70 ? "var(--amb)" : "var(--acc)"}"></div>
      </div>

      ${renderMethodCard()}

      <div class="scroll">
        <div class="category-list">
          ${budgetContent}
        </div>
      </div>

      ${nav()}
    </section>
  `
}

function renderMethodCard() {
  const complete = hasCompletedMethod()
  const summary = getMethodSummary()
  const over = complete && summary.unassigned < 0
  const title = complete ? "Intentional spending pool" : "Set your method"
  const copy = complete
    ? over
      ? "Your leak budgets are above the pool. Treat it as a signal, not a failure."
      : "Stable expenses are accepted. These are the leaks you chose to manage."
    : "Don't fight stable life expenses. Control the invisible leaks."
  const actionLabel = complete ? "Adjust" : "Start"
  const actionStep = complete ? 2 : 0

  return `
    <button class="method-card ${complete ? "complete" : ""}" data-action="openMethod" data-step="${actionStep}">
      <span class="method-card-head">
        <span>
          <span class="method-kicker">Method</span>
          <span class="method-title">${esc(title)}</span>
        </span>
        <span class="method-action">${actionLabel}</span>
      </span>
      <span class="method-copy">${esc(copy)}</span>
      <span class="method-stats">
        <span><strong>${complete ? fmt(summary.pool) : "--"}</strong><em>Pool</em></span>
        <span><strong>${fmt(summary.budgeted)}</strong><em>Budgeted</em></span>
        <span class="${over ? "danger" : ""}"><strong>${complete ? fmt(Math.abs(summary.unassigned)) : "--"}</strong><em>${over ? "Over" : "Unassigned"}</em></span>
      </span>
    </button>
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
  const roll = rolloverLabel(budget)

  return `
    <button class="card budget-card" data-action="quickAdd" data-id="${attr(budget.id)}" style="--cat:${cssColor(budget.color)};--cat-soft:${cssColor(budget.color)}16">
      <div class="budget-top">
        <div class="budget-left">
          <span class="emoji-box">${esc(budget.icon)}</span>
          <div>
            <div class="budget-name">${esc(budget.label)}</div>
            <div class="budget-meta">${remaining >= 0 ? fmt(remaining) + " left" : fmt(Math.abs(remaining)) + " over"}</div>
            ${roll ? `<div class="budget-meta">${esc(roll)}</div>` : ""}
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

  return `
    <section class="view">
      ${header("Add Expense", "Create a new transaction", `
        <button class="top-btn icon-btn" title="Presets" aria-label="Presets" data-action="go" data-view="presets">${icon("settings")}</button>
      `)}

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
        <div class="field-label">Description</div>
        <input class="field" id="add-desc" type="text" placeholder="e.g. Starbucks" value="${attr(app.drafts.add.desc)}">
      </div>

      <button class="primary-btn" id="save-expense" data-action="saveExpense" ${canSaveExpense() ? "" : "disabled"}>${icon("check")} Save Expense</button>

      <div class="scroll"></div>
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
  const entries = [...(app.state.entries || [])].reverse()
  const content = entries.length
    ? entries.map(renderLogItem).join("")
    : `<div class="empty"><div class="empty-icon">${icon("activity")}</div><div class="empty-title">No activity yet</div></div>`

  return `
    <section class="view">
      ${header("Activity", "Tap an expense to edit it", `
        <button class="top-btn icon-btn" title="Budgets" aria-label="Budgets" data-action="go" data-view="cats">${icon("grid")}</button>
      `)}
      <div class="scroll">
        <div class="item-list">${content}</div>
      </div>
      ${nav()}
    </section>
  `
}

function renderLogItem(entry) {
  const cat = categoryById(entry.cat) || {}
  const color = cssColor(cat.color || "#0F766E")

  return `
    <button class="card log-item safe-row" data-action="openEntryEdit" data-id="${Number(entry.id)}">
      <span class="emoji-box" style="background:${color}16;color:${color}">${esc(cat.icon || "·")}</span>
      <span class="row-copy">
        <span class="row-title clamp-2">${esc(entry.desc || "Expense")}</span>
        <span class="row-meta clamp-1">${esc(cat.label || entry.cat || "Uncategorized")}</span>
      </span>
      <span class="row-side">
        <span class="row-amount">${fmt(entry.amt)}</span>
        <span class="row-date">${esc(entry.date || "")}</span>
      </span>
    </button>
  `
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
  const base = Number(budget.baseBudget) || 0
  const roll = rolloverLabel(budget)
  const effective = Number(budget.budget) || 0

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
        <div class="cat-budget">Base ${fmt(base)}</div>
      </div>
      <div class="cat-meta">${roll ? esc(roll) : "No rollover"} · effective ${fmt(effective)}</div>
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
          ${app.state.presets.length ? app.state.presets.map(renderPresetCard).join("") : `<div class="empty"><div class="empty-icon">⚡</div><div class="empty-title">No presets yet</div></div>`}
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
          ${app.state.wishes.length ? app.state.wishes.map(renderWishCard).join("") : `<div class="empty"><div class="empty-icon">✨</div><div class="empty-title">Your wishlist is empty</div></div>`}
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
  return value ? new Date(value).toLocaleString("en-US") : emptyText
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
  const method = getMethod()
  if (app.methodAutoOpened || hasCompletedMethod() || Number(method.dismissedAt) > 0) return false
  if (getTransactionCount(app.data) > 0) return false
  return getSavedAt(app.data) === 0
}

function maybeOpenInitialMethod() {
  if (!shouldAutoOpenMethod()) return

  window.setTimeout(() => {
    if (!shouldAutoOpenMethod() || app.modal || app.view !== "home") return
    app.methodAutoOpened = true
    openMethod(0, { silent: true })
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
  const installPanel = app.installPrompt
    ? `<button class="primary-btn" data-action="install">${icon("download")} Install App</button>`
    : `<div class="data-note install-note">On iPhone, open Share in Safari and choose Add to Home Screen.</div>`

  return `
    <section class="view">
      ${header("Account", signedIn ? app.cloudEmail : "Local-first budget tracker")}
      <div class="scroll account-scroll">
        <div class="account-card">
          <div class="account-avatar">${icon(signedIn ? "account" : "wallet")}</div>
          <div class="account-main">
            <div class="account-name">${signedIn ? esc(app.cloudEmail) : "Not signed in"}</div>
            <div class="account-meta">${summary.monthCount} months · ${summary.txCount} transactions · saved ${esc(summary.saved)}</div>
          </div>
        </div>

        ${renderCloudPanel()}

        <div class="account-panel">
          <div class="panel-head">
            <div>
              <div class="section-label">Manage</div>
              <div class="panel-title">App tools</div>
            </div>
            ${icon("settings", "", "panel-icon")}
          </div>
          <div class="tool-grid">
            ${renderActionToolCard("openMethod", "wallet", "Method", hasCompletedMethod() ? "Intentional spending pool" : "Find your spending leaks", `data-step="${hasCompletedMethod() ? 2 : 0}"`)}
            ${renderToolCard("cats", "grid", "Budgets", "Categories and monthly limits")}
            ${renderToolCard("presets", "settings", "Presets", "Reusable quick expenses")}
            ${renderToolCard("wishes", "heart", "Wishlist", "Planned purchases")}
          </div>
        </div>

        ${renderBackupPanel()}

        <div class="account-panel">
          <div class="panel-head">
            <div>
              <div class="section-label">PWA</div>
              <div class="panel-title">Installed app</div>
            </div>
            ${icon("download", "", "panel-icon")}
          </div>
          ${installPanel}
        </div>
      </div>
      ${nav()}
    </section>
  `
}

function renderModal() {
  if (!app.modal) {
    modalEl.classList.remove("show")
    modalEl.setAttribute("aria-hidden", "true")
    modalEl.innerHTML = ""
    return
  }

  modalEl.classList.add("show")
  modalEl.setAttribute("aria-hidden", "false")

  if (app.modal === "catPicker") modalEl.innerHTML = renderCatPickerModal()
  if (app.modal === "budgetEdit") modalEl.innerHTML = renderBudgetEditModal()
  if (app.modal === "presetEdit") modalEl.innerHTML = renderPresetEditModal()
  if (app.modal === "entryEdit") modalEl.innerHTML = renderEntryEditModal()
  if (app.modal === "wishEdit") modalEl.innerHTML = renderWishEditModal()
  if (app.modal === "data") modalEl.innerHTML = renderDataModal()
  if (app.modal === "method") modalEl.innerHTML = renderMethodModal()
  if (app.modal === "iconPicker") modalEl.innerHTML = renderIconPickerModal()
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
  const step = Math.max(0, Math.min(3, Number(app.methodStep) || 0))
  const steps = [
    renderMethodIntroStep,
    renderMethodNumbersStep,
    renderMethodPoolStep,
    renderMethodReviewStep
  ]

  return `
    <div class="sheet method-sheet" role="dialog" aria-modal="true" aria-label="Budget method">
      <div class="sheet-top">
        <div>
          <div class="sheet-title">Budget Method</div>
          <div class="method-step-label">Step ${step + 1} of 4</div>
        </div>
        <button class="sheet-close" aria-label="Close" data-action="dismissMethod">${icon("close")}</button>
      </div>
      <div class="method-progress" aria-hidden="true">
        ${[0, 1, 2, 3].map(i => `<span class="${i <= step ? "active" : ""}"></span>`).join("")}
      </div>
      ${steps[step]()}
    </div>
  `
}

function renderMethodIntroStep() {
  return `
    <div class="method-body">
      <div class="method-hero">
        <div class="method-kicker">Control the invisible leaks</div>
        <div class="method-heading">Do not fight the stable expenses.</div>
        <p>Groceries, bills, gas, and household basics may simply be the cost of your real life. The leaks are different: small, repeating purchases that quietly become unlimited.</p>
      </div>
      <div class="method-principles">
        <span>Accept predictable life expenses.</span>
        <span>Choose the pool you want to spend intentionally.</span>
        <span>Enjoy small luxuries without hidden stress.</span>
      </div>
      <div class="sheet-actions">
        <button class="secondary-btn" data-action="dismissMethod">Maybe Later</button>
        <button class="primary-btn" data-action="methodNext">${icon("check")} Start</button>
      </div>
    </div>
  `
}

function renderMethodNumbersStep() {
  return `
    <div class="method-body">
      <div class="method-heading">Start with the life you already accept.</div>
      <p class="method-copy-block">Enter your monthly income and the predictable expenses you feel at peace with. This is not about judging them.</p>
      <div class="field-group">
        <div class="field-label">Monthly income</div>
        <input class="field" id="method-income" type="number" inputmode="decimal" placeholder="$0.00" value="${attr(app.drafts.method.monthlyIncome)}">
      </div>
      <div class="field-group">
        <div class="field-label">Predictable life expenses</div>
        <input class="field" id="method-predictable" type="number" inputmode="decimal" placeholder="$0.00" value="${attr(app.drafts.method.predictableExpensesTotal)}">
      </div>
      <div class="method-note">Rent, groceries, gas, bills, household basics, and other expenses you accept as part of your real lifestyle.</div>
      <div class="sheet-actions">
        <button class="secondary-btn" data-action="methodBack">Back</button>
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
      <div class="method-heading">Now choose your intentional pool.</div>
      <p class="method-copy-block">The math suggests what remains, but you decide how much you want to manage inside this app.</p>
      <div class="method-suggestion">
        <span>Suggested from clarity</span>
        <strong>${fmt(suggested)}</strong>
      </div>
      <div class="field-group">
        <div class="field-label">Your intentional spending pool</div>
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
        <div><span>Intentional pool</span><strong>${fmt(pool)}</strong></div>
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
            No leak budgets yet. Finish the method, then create only the categories that actually feel like leaks.
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

  const views = {
    home: renderHome,
    add: renderAdd,
    log: renderLog,
    account: renderAccount,
    cats: renderCategories,
    presets: renderPresets,
    wishes: renderWishes
  }

  appEl.innerHTML = (views[app.view] || renderHome)()
  renderModal()
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
  }

  if (target.id === "add-desc") app.drafts.add.desc = target.value

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
}

function handleClick(event) {
  const target = event.target.closest("[data-action]")
  if (!target) {
    if (event.target === modalEl) {
      if (app.modal === "method") dismissMethod()
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

  if (action === "go") go(view)
  if (action === "quickAdd") quickAdd(id)
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
  if (action === "exportJSON") exportJSON()
  if (action === "exportCSV") exportCSV()
  if (action === "importJSON") importJSON()
  if (action === "openMethod") openMethod(target.dataset.step)
  if (action === "methodNext") methodNext()
  if (action === "methodBack") methodBack()
  if (action === "dismissMethod") dismissMethod()
  if (action === "saveMethod") saveMethod()
  if (action === "setAuthMode") setAuthMode(mode)
  if (action === "cloudPasswordLogin") signInWithPassword()
  if (action === "cloudCreateAccount") createPasswordAccount()
  if (action === "cloudResetPassword") sendPasswordReset()
  if (action === "cloudUpdatePassword") updateRecoveredPassword()
  if (action === "cloudLogin") sendEmailCode()
  if (action === "cloudVerify") verifyEmailCode()
  if (action === "cloudPush") pushCloudData()
  if (action === "cloudPull" && confirm("This will replace this local copy with your saved backup.")) pullCloudData()
  if (action === "cloudSignOut") signOutCloud()
  if (action === "install") installPWA()
  if (action === "openIconPicker") openIconPicker(targetName)
  if (action === "chooseIcon") chooseIcon(value)
  if (action === "closeModal") closeModal()
}

function go(view) {
  if (!view) return
  const secondaryViews = ["cats", "presets", "wishes"]
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

function quickAdd(id) {
  haptic("light")
  app.selectedCat = id
  app.view = "add"
  render()
  requestAnimationFrame(() => document.getElementById("add-amt")?.focus())
}

function openModal(name) {
  haptic("light")
  app.modal = name
  renderModal()
}

function openMethod(step = 0, options = {}) {
  syncMethodDraft()
  app.methodStep = Math.max(0, Math.min(3, Number(step) || 0))
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

  if (step === 1 && !canContinueMethodNumbers()) {
    toast("Add income and predictable expenses")
    return
  }

  if (step === 1 && !Number(app.drafts.method.intentionalPool)) {
    app.drafts.method.intentionalPool = String(Math.max(0, roundMoney(Number(app.drafts.method.monthlyIncome) - Number(app.drafts.method.predictableExpensesTotal))))
  }

  if (step === 2 && !canConfirmMethodPool()) {
    toast("Choose your intentional pool")
    return
  }

  if (step >= 3) {
    saveMethod()
    return
  }

  app.methodStep = Math.min(3, step + 1)
  haptic("light")
  renderModal()
}

function dismissMethod() {
  const wasIncomplete = !hasCompletedMethod()
  if (wasIncomplete) {
    app.data._settings.method.dismissedAt = Date.now()
    saveData(app.data)
  }
  closeModal(false)
  render()
  if (wasIncomplete) toast("You can open Method anytime")
}

function saveMethod() {
  const monthlyIncome = Number(app.drafts.method.monthlyIncome)
  const predictableExpensesTotal = Number(app.drafts.method.predictableExpensesTotal)
  const intentionalPool = Number(app.drafts.method.intentionalPool)

  if (monthlyIncome <= 0 || predictableExpensesTotal < 0 || intentionalPool <= 0) {
    toast("Check the method numbers")
    return
  }

  app.data._settings.method = {
    monthlyIncome,
    predictableExpensesTotal,
    intentionalPool,
    completedAt: Date.now(),
    dismissedAt: Number(app.data._settings.method.dismissedAt) || 0
  }
  syncMethodDraft()
  closeModal(false)
  saveData(app.data)
  render()
  haptic("success")
  toast("Method saved")
}

function closeModal(shouldRender = true) {
  if (app.modal === "iconPicker" && app.iconPickerReturnModal) {
    app.modal = app.iconPickerReturnModal
    app.iconPickerReturnModal = null
    app.iconPickerTarget = null
    app.iconPickerQuery = ""
    if (shouldRender) renderModal()
    return
  }

  app.modal = null
  app.editingBudgetId = null
  app.editingPresetId = null
  app.editingPresetCat = null
  app.editingEntryId = null
  app.editingCat = null
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

function saveExpense() {
  const amount = Number(app.drafts.add.amt)
  const cat = categoryById(app.selectedCat)
  if (!cat || amount <= 0) return

  if (!Array.isArray(app.data[app.key])) app.data[app.key] = []
  app.data[app.key].push({
    id: Date.now() + Math.floor(Math.random() * 1000),
    cat: cat.id,
    amt: amount,
    desc: app.drafts.add.desc.trim() || cat.label,
    date: todayLabel()
  })

  app.drafts.add = { amt: "", desc: "" }
  app.selectedCat = null
  saveData(app.data)
  app.view = "home"
  render()
  haptic("success")
  toast("Saved")
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
  const budget = rawCategoryById(id)
  if (!budget) return
  app.editingBudgetId = budget.id
  app.drafts.budgetEdit = {
    icon: budget.icon || "🏷️",
    label: budget.label || "",
    budget: String(Number(budget.budget) || "")
  }
  openModal("budgetEdit")
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
  if (!confirm(`Delete ${budget.label}? Its expenses, presets, and wishes will also be deleted.`)) return
  closeModal(false)
  deleteCategory(id, { confirmed: true })
}

function deleteCategory(id, options = {}) {
  if (app.data._settings.budgets.length <= 1) {
    toast("Keep at least 1 budget")
    return
  }

  const cat = rawCategoryById(id)
  if (!cat) return
  if (!options.confirmed && !confirm(`Delete ${cat.label}? Its expenses, presets, and wishes will also be deleted.`)) return

  app.data._settings.budgets = app.data._settings.budgets.filter(b => b.id !== id)
  Object.keys(app.data).forEach(key => {
    if (key === "_settings" || !Array.isArray(app.data[key])) return
    app.data[key] = app.data[key].filter(entry => entry.cat !== id)
  })
  app.data._settings.presets = app.data._settings.presets.filter(preset => preset.cat !== id)
  app.data._settings.wishes = app.data._settings.wishes.filter(wish => wish.cat !== id)
  if (app.selectedCat === id) app.selectedCat = null
  if (app.newPresetCat === id) app.newPresetCat = null
  if (app.newWishCat === id) app.newWishCat = null

  saveData(app.data)
  render()
  haptic("warning")
  toast("Budget deleted")
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
  if (!options.confirmed && !confirm(`Delete "${preset.desc}"?`)) return

  app.data._settings.deletedPresetIds = app.data._settings.deletedPresetIds || []
  if (!app.data._settings.deletedPresetIds.includes(id)) app.data._settings.deletedPresetIds.push(id)
  app.data._settings.presets = app.data._settings.presets.filter(preset => preset.id !== id)
  saveData(app.data)
  render()
  haptic("warning")
  toast("Preset deleted")
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
  if (!confirm(`Delete "${preset.desc}"?`)) return
  const id = preset.id
  closeModal(false)
  deletePreset(id, { confirmed: true })
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
  if (!options.confirmed && !confirm(`Delete "${wish.desc}" from your wishlist?`)) return

  app.data._settings.wishes = app.data._settings.wishes.filter(wish => wish.id !== id)
  saveData(app.data)
  render()
  haptic("warning")
  toast("Wish deleted")
}

function buyWish(id) {
  const wish = wishById(id)
  if (!wish || !categoryById(wish.cat)) {
    toast("Invalid category")
    return
  }

  if (!Array.isArray(app.data[app.key])) app.data[app.key] = []
  app.data[app.key].push({
    id: Date.now() + Math.floor(Math.random() * 1000),
    desc: wish.desc,
    amt: Number(wish.amt) || 0,
    cat: wish.cat,
    date: todayLabel()
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
  if (!confirm(`Delete "${wish.desc}" from your wishlist?`)) return
  closeModal(false)
  deleteWish(id, { confirmed: true })
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
  app.editingEntryId = Number(entry.id)
  app.editingCat = entry.cat
  app.drafts.edit = {
    desc: entry.desc || "",
    amt: String(Number(entry.amt) || "")
  }
  openModal("entryEdit")
}

function pickEditCat(id) {
  if (!categoryById(id)) return
  app.editingCat = id
  renderModal()
}

function saveEditingEntry() {
  const entry = entryById(app.editingEntryId)
  const amount = Number(app.drafts.edit.amt)
  if (!entry || !app.editingCat || amount <= 0) {
    toast("Check amount and category")
    return
  }

  entry.desc = app.drafts.edit.desc.trim() || "Expense"
  entry.amt = amount
  entry.cat = app.editingCat
  closeModal(false)
  saveData(app.data)
  render()
  haptic("success")
  toast("Expense updated")
}

function deleteEntry(id, options = {}) {
  const entry = entryById(id)
  if (!entry) return
  if (!options.confirmed && !confirm(`Delete "${entry.desc || "Expense"}"?`)) return

  if (!Array.isArray(app.data[app.key])) return
  app.data[app.key] = app.data[app.key].filter(entry => Number(entry.id) !== Number(id))
  saveData(app.data)
  render()
  haptic("warning")
  toast("Deleted")
}

function deleteEditingEntry() {
  const id = app.editingEntryId
  const entry = entryById(id)
  if (!entry) return
  if (!confirm(`Delete "${entry.desc || "Expense"}"?`)) return
  closeModal(false)
  deleteEntry(id, { confirmed: true })
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

function exportJSON() {
  downloadFile("budget_export.json", JSON.stringify(ensureDataShape(app.data), null, 2), "application/json")
  haptic("success")
  toast("JSON exported")
}

function exportCSV() {
  const budgets = app.data._settings.budgets
  const labels = {}
  budgets.forEach(b => { labels[b.id] = b.label })
  const lines = ["Date,Category,Description,Amount"]
  ;(app.data[app.key] || []).forEach(entry => {
    lines.push([
      csvEscape(entry.date || ""),
      csvEscape(labels[entry.cat] || entry.cat || ""),
      csvEscape(entry.desc || ""),
      (Number(entry.amt) || 0).toFixed(2)
    ].join(","))
  })

  downloadFile(`budget_${app.key}.csv`, lines.join("\n"), "text/csv")
  haptic("success")
  toast("CSV exported")
}

function csvEscape(value) {
  const s = value === undefined || value === null ? "" : String(value)
  return /[",\n\r]/.test(s) ? "\"" + s.replace(/"/g, "\"\"") + "\"" : s
}

function downloadFile(filename, content, type) {
  const blob = new Blob([content], { type })
  const url = URL.createObjectURL(blob)
  const link = document.createElement("a")
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  link.remove()
  URL.revokeObjectURL(url)
}

function importJSON() {
  const input = document.createElement("input")
  input.type = "file"
  input.accept = "application/json,.json"
  input.addEventListener("change", async () => {
    const file = input.files && input.files[0]
    if (!file) return

    try {
      const text = await file.text()
      const parsed = JSON.parse(text)
      const shaped = ensureDataShape(parsed)
      const monthKeys = Object.keys(shaped).filter(k => k !== "_settings" && parseMonthKey(k))
      const txCount = monthKeys.reduce((sum, key) => sum + (Array.isArray(shaped[key]) ? shaped[key].length : 0), 0)
      const message = `This will replace your local data with ${shaped._settings.budgets.length} budgets, ${monthKeys.length} months, and ${txCount} transactions.`

      if (!confirm(message)) return

      app.data = shaped
      markActiveMonth(app.data, app.key)
      saveData(app.data)
      closeModal(false)
      render()
      haptic("success")
      toast("Data imported")
    } catch (error) {
      toast("Invalid JSON")
    }
  })
  input.click()
}

async function installPWA() {
  if (!app.installPrompt) return
  haptic("medium")
  app.installPrompt.prompt()
  await app.installPrompt.userChoice.catch(() => null)
  app.installPrompt = null
  render()
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
