const STORAGE_KEY = "budget_tracker_pwa_v1"
const ROLLOVER_START_KEY = "2026-4"
const SUPABASE_URL = "https://yafcgilvulnbczaizcbf.supabase.co"
const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_xVtese4jTfZsAkB2cgSkOw_b8Wl5ksT"
const CLOUD_SYNC_DELAY = 900

const DEFAULT_BUDGETS = [
  { id: "cafe", label: "Coffee", icon: "☕", budget: 50, color: "#F59E0B" },
  { id: "rest", label: "Restaurants", icon: "🍽", budget: 200, color: "#EF4444" },
  { id: "uber", label: "Uber", icon: "🚗", budget: 20, color: "#10B981" },
  { id: "online", label: "Online Shopping", icon: "📦", budget: 100, color: "#2563EB" },
  { id: "growth_lab", label: "Business Experiments", icon: "🧪", budget: 15, color: "#7C3AED" }
]

const DEFAULT_PRESETS = [
  { id: "preset_starbucks", desc: "Starbucks", amt: 5.50, cat: "cafe", icon: "☕" },
  { id: "preset_uber", desc: "Uber", amt: 6.00, cat: "uber", icon: "🚗" },
  { id: "preset_lunch", desc: "Lunch", amt: 12.00, cat: "rest", icon: "🍽" }
]

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
  editingEntryId: null,
  editingCat: null,
  editingWishId: null,
  editingWishCat: null,
  newPresetCat: null,
  newWishCat: null,
  installPrompt: null,
  cloudUser: null,
  cloudEmail: "",
  cloudReady: false,
  cloudBusy: false,
  cloudStatus: "Cloud not connected",
  lastCloudSyncAt: null,
  drafts: {
    add: { amt: "", desc: "" },
    category: { icon: "", label: "", budget: "" },
    preset: { icon: "", desc: "", amt: "" },
    wish: { icon: "", desc: "", amt: "" },
    edit: { desc: "", amt: "" },
    wishEdit: { icon: "", desc: "", amt: "" },
    cloud: { email: "", code: "", codeSent: false }
  }
}

markActiveMonth(app.data, app.key)
saveData(app.data, { touch: false, sync: false })

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
  if (!Array.isArray(d._settings.budgets) || !d._settings.budgets.length) d._settings.budgets = clone(DEFAULT_BUDGETS)

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
  DEFAULT_PRESETS.forEach(preset => {
    const wasDeleted = d._settings.deletedPresetIds.includes(String(preset.id))
    const exists = d._settings.presets.some(p => p && String(p.id) === String(preset.id))
    if (!wasDeleted && !exists) d._settings.presets.push(clone(preset))
  })

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

  if (!d._settings._meta || typeof d._settings._meta !== "object") d._settings._meta = {}
  d._settings._meta.schemaVersion = 5
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
  const message = error && error.message ? String(error.message) : "Could not connect to Supabase"
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
    app.cloudStatus = "Connect your email to save to Supabase"
  } else if (!app.cloudStatus || app.cloudStatus === "Cloud not connected") {
    app.cloudStatus = "Connecting to your cloud..."
  }
}

function scheduleCloudSave() {
  if (!supabaseClient || !app.cloudUser || !app.cloudReady) return
  clearTimeout(cloudSaveTimer)
  app.cloudStatus = "Pending changes to upload"
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
    app.cloudStatus = "Supabase did not load; the app is still saving locally"
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

  supabaseClient.auth.onAuthStateChange((_event, session) => {
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
    toast("Supabase is not ready")
    return
  }

  const field = document.getElementById("cloud-email")
  const email = String((field && field.value) || app.drafts.cloud.email || "").trim().toLowerCase()
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    toast("Enter a valid email")
    return
  }

  app.drafts.cloud.email = email
  setCloudStatus("Sending email code...", true)

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
    setCloudStatus("Code sent. Type it here without leaving the app.", false)
    haptic("success")
    toast("Check your email")
  } catch (error) {
    setCloudStatus(cloudErrorMessage(error), false)
    toast("Could not send code")
  }
}

async function verifyEmailCode() {
  if (!supabaseClient) {
    toast("Supabase is not ready")
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
    setCloudStatus("Cloud connected", false)
    render()
    haptic("success")
    toast("Cloud connected")
  } catch (error) {
    setCloudStatus(cloudErrorMessage(error), false)
    toast("Invalid code")
  }
}

async function signOutCloud() {
  if (!supabaseClient) return
  setCloudStatus("Signing out...", true)
  await supabaseClient.auth.signOut().catch(() => null)
  applyCloudSession(null)
  render()
  haptic("medium")
  toast("Signed out")
}

async function pushCloudData(options = {}) {
  const silent = !!options.silent
  if (!supabaseClient || !app.cloudUser) {
    if (!silent) toast("Connect cloud first")
    return false
  }

  clearTimeout(cloudSaveTimer)
  setCloudStatus("Uploading changes to Supabase...", true)

  try {
    const payload = ensureDataShape(clone(app.data))
    if (!payload._settings._meta.lastSaved) payload._settings._meta.lastSaved = Date.now()

    const { error } = await supabaseClient
      .from("budget_sync")
      .upsert({ user_id: app.cloudUser.id, data: payload }, { onConflict: "user_id" })

    if (error) throw error

    app.cloudReady = true
    app.lastCloudSyncAt = Date.now()
    setCloudStatus("Cloud is up to date", false)
    if (!silent) haptic("success")
    if (!silent) toast("Saved to cloud")
    return true
  } catch (error) {
    setCloudStatus(cloudErrorMessage(error), false)
    if (!silent) toast("Could not upload")
    return false
  }
}

async function pullCloudData(options = {}) {
  const preferNewer = !!options.preferNewer
  const silent = !!options.silent
  if (!supabaseClient || !app.cloudUser) {
    if (!silent) toast("Connect cloud first")
    return false
  }

  setCloudStatus("Reading Supabase...", true)

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
      if (uploaded && !silent) toast("Current data uploaded to cloud")
      return uploaded
    }

    const remoteData = ensureDataShape(clone(row.data))
    const remoteSavedAt = Math.max(getSavedAt(remoteData), Date.parse(row.updated_at) || 0)
    const localSavedAt = getSavedAt(app.data)

    if (preferNewer && localSavedAt > remoteSavedAt + 1000) {
      app.cloudReady = true
      setCloudStatus("Your local data is newer; uploading...", true)
      const uploaded = await pushCloudData({ silent: true })
      if (uploaded && !silent) toast("Cloud updated")
      return uploaded
    }

    app.data = remoteData
    markActiveMonth(app.data, app.key)
    saveData(app.data, { touch: false, sync: false })
    app.cloudReady = true
    app.lastCloudSyncAt = Date.now()
    setCloudStatus("Cloud downloaded and ready", false)
    render()
    if (!silent) haptic("success")
    if (!silent) toast("Cloud data loaded")
    return true
  } catch (error) {
    setCloudStatus(cloudErrorMessage(error), false)
    if (!silent) toast("Could not download")
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
  const cloudTitle = app.cloudUser ? "Cloud connected" : "Connect cloud"
  const cloudButton = `<button class="top-btn icon-btn cloud-btn ${app.cloudUser ? "online" : ""} ${app.cloudBusy ? "syncing" : ""}" title="${cloudTitle}" aria-label="${cloudTitle}" data-action="go" data-view="account">${icon("cloud")}</button>`

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

      <div class="scroll">
        <div class="category-list">
          ${app.state.budgets.map(renderBudgetCard).join("")}
        </div>
      </div>

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
    <div class="card log-item">
      <div class="list-row">
        <button class="list-left" data-action="openEntryEdit" data-id="${Number(entry.id)}">
          <span class="emoji-box" style="background:${color}16;color:${color}">${esc(cat.icon || "·")}</span>
          <span>
            <span class="row-title">${esc(entry.desc || "Expense")}</span>
            <span class="row-meta">${esc(cat.label || entry.cat || "Uncategorized")}</span>
          </span>
        </button>
        <button class="budget-right" data-action="openEntryEdit" data-id="${Number(entry.id)}">
          <span class="row-amount">${fmt(entry.amt)}</span>
          <span class="row-date">${esc(entry.date || "")}</span>
        </button>
        <button class="delete-circle" title="Delete" aria-label="Delete" data-action="deleteEntry" data-id="${Number(entry.id)}">${icon("trash")}</button>
      </div>
    </div>
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

      <div class="form-card">
        <div class="section-label">New budget</div>
        <div class="two-col" style="margin-top:9px">
          <input class="field emoji-input" id="cat-icon" type="text" maxlength="2" placeholder="Emoji" value="${attr(app.drafts.category.icon)}">
          <input class="field" id="cat-label" type="text" placeholder="Name" value="${attr(app.drafts.category.label)}">
        </div>
        <div class="field-group">
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
    <div class="card cat-card" style="--cat:${cssColor(budget.color)}">
      <div class="cat-top">
        <div class="cat-left">
          <span class="cat-dot"></span>
          <span class="cat-title">
            <span class="cat-icon">${esc(budget.icon)}</span>
            <span class="cat-text">${esc(budget.label)}</span>
          </span>
        </div>
        <div class="cat-budget">Base ${fmt(base)}</div>
      </div>
      <div class="cat-meta">${roll ? esc(roll) : "No rollover"} · effective this month ${fmt(effective)}</div>
      <div class="cat-actions">
        <input class="mini-field cat-budget-input" data-id="${attr(budget.id)}" type="number" inputmode="decimal" value="${base}" aria-label="${attr(budget.label)} limit">
        <button class="small-save" data-action="saveCategoryBudget" data-id="${attr(budget.id)}">${icon("check")} Save</button>
        <button class="small-delete" data-action="deleteCategory" data-id="${attr(budget.id)}">${icon("trash")} Delete</button>
      </div>
    </div>
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
      <div class="form-card">
        <div class="section-label">New preset</div>
        <div class="two-col" style="margin-top:9px">
          <input class="field emoji-input" id="preset-icon" type="text" maxlength="2" placeholder="Emoji" value="${attr(app.drafts.preset.icon)}">
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
    <div class="card preset-card">
      <div class="list-row">
        <div class="list-left">
          <span class="emoji-box" style="background:${color}16;color:${color}">${esc(preset.icon || cat.icon || "⚡")}</span>
          <span>
            <span class="row-title">${esc(preset.desc)}</span>
            <span class="row-meta">${fmt(preset.amt)} · ${esc(cat.label || "Uncategorized")}</span>
          </span>
        </div>
        <button class="small-delete" data-action="deletePreset" data-id="${attr(preset.id)}">${icon("trash")} Delete</button>
      </div>
    </div>
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
      <div class="form-card">
        <div class="section-label">New wish</div>
        <div class="two-col" style="margin-top:9px">
          <input class="field emoji-input" id="wish-icon" type="text" maxlength="2" placeholder="Emoji" value="${attr(app.drafts.wish.icon)}">
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
    <div class="card preset-card">
      <div class="list-row">
        <button class="list-left" data-action="openWishEdit" data-id="${attr(wish.id)}">
          <span class="emoji-box" style="background:${color}16;color:${color}">${esc(wish.icon || "✨")}</span>
          <span>
            <span class="row-title">${esc(wish.desc)}</span>
            <span class="row-meta">${fmt(wish.amt)} · ${esc(cat.label || "Uncategorized")}</span>
          </span>
        </button>
        <div class="list-actions">
          <button class="success-btn" data-action="buyWish" data-id="${attr(wish.id)}">${icon("check")} Buy</button>
          <button class="small-delete" data-action="deleteWish" data-id="${attr(wish.id)}">${icon("trash")} Delete</button>
        </div>
      </div>
    </div>
  `
}

function renderCategoryPills(selectedId, action) {
  return app.state.budgets.map(cat => {
    const color = cssColor(cat.color)
    return `
      <button class="pill ${selectedId === cat.id ? "active" : ""}" style="--cat:${color};--cat-soft:${color}16" data-action="${action}" data-id="${attr(cat.id)}">
        ${esc(cat.icon)} ${esc(cat.label)}
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
    cloudSaved: savedTimeLabel(app.lastCloudSyncAt, "pending")
  }
}

function renderCloudPanel() {
  const summary = getDataSummary()
  const cloudMode = app.cloudUser
    ? `
      <div class="cloud-account">
        <span>${esc(app.cloudEmail || "Signed in")}</span>
        <span>${esc(summary.cloudSaved)}</span>
      </div>
      <div class="sheet-actions">
        <button class="secondary-btn" data-action="cloudPull" ${app.cloudBusy ? "disabled" : ""}>${icon("download")} Pull Cloud</button>
        <button class="primary-btn" data-action="cloudPush" ${app.cloudBusy ? "disabled" : ""}>${icon("upload")} Push Now</button>
      </div>
      <button class="danger-btn cloud-full" data-action="cloudSignOut" ${app.cloudBusy ? "disabled" : ""}>${icon("account")} Sign Out</button>
    `
    : `
      <div class="field-group cloud-login">
        <div class="field-label">Email</div>
        <input class="field" id="cloud-email" type="email" inputmode="email" autocomplete="email" autocapitalize="off" spellcheck="false" placeholder="you@email.com" value="${attr(app.drafts.cloud.email)}">
      </div>
      ${app.drafts.cloud.codeSent ? `
        <div class="field-group cloud-login">
          <div class="field-label">Code</div>
          <input class="field code-field" id="cloud-code" type="text" inputmode="numeric" autocomplete="one-time-code" maxlength="6" placeholder="000000" value="${attr(app.drafts.cloud.code)}">
        </div>
        <div class="sheet-actions">
          <button class="secondary-btn" data-action="cloudLogin" ${app.cloudBusy ? "disabled" : ""}>Resend</button>
          <button class="primary-btn" data-action="cloudVerify" ${app.cloudBusy ? "disabled" : ""}>${icon("check")} Verify</button>
        </div>
      ` : `
        <button class="primary-btn" data-action="cloudLogin" ${app.cloudBusy ? "disabled" : ""}>${icon("cloud")} Send Code</button>
      `}
    `

  return `
    <div class="cloud-panel ${app.cloudUser ? "connected" : ""}">
      <div class="cloud-head">
        <div>
          <div class="cloud-kicker">Supabase</div>
          <div class="cloud-title">${app.cloudUser ? "Automatic sync is active" : "Cloud sync"}</div>
        </div>
        <span class="cloud-dot ${app.cloudBusy ? "busy" : app.cloudUser ? "on" : ""}"></span>
      </div>
      <div class="data-note cloud-copy">
        ${app.cloudUser ? "Changes upload automatically after you save. You can also push or pull manually." : "Use the email code flow so your session stays inside the installed PWA."}
      </div>
      ${cloudMode}
      <div class="cloud-status">${esc(app.cloudStatus)}</div>
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
  if (app.modal === "entryEdit") modalEl.innerHTML = renderEntryEditModal()
  if (app.modal === "wishEdit") modalEl.innerHTML = renderWishEditModal()
  if (app.modal === "data") modalEl.innerHTML = renderDataModal()
}

function renderCatPickerModal() {
  return `
    <div class="sheet" role="dialog" aria-modal="true" aria-label="Change category">
      <div class="sheet-top">
        <div class="sheet-title">Change category</div>
        <button class="sheet-close" aria-label="Close" data-action="closeModal">${icon("close")}</button>
      </div>
      <div class="item-list">
        ${app.state.budgets.map(cat => {
          const color = cssColor(cat.color)
          return `
            <button class="selected-cat" style="--cat:${color};border-color:${app.selectedCat === cat.id ? color : "var(--bord)"};background:${app.selectedCat === cat.id ? color + "10" : "var(--card)"}" data-action="chooseCat" data-id="${attr(cat.id)}">
              <span class="emoji-box" style="background:${color}16;color:${color}">${esc(cat.icon)}</span>
              <span class="label">${esc(cat.label)}</span>
              <span class="cat-budget">${fmt(cat.budget)}</span>
            </button>
          `
        }).join("")}
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
      <div class="two-col">
        <input class="field emoji-input" id="wish-edit-icon" type="text" maxlength="2" placeholder="Emoji" value="${attr(app.drafts.wishEdit.icon)}">
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

  if (target.id === "cat-icon") app.drafts.category.icon = target.value
  if (target.id === "cat-label") app.drafts.category.label = target.value
  if (target.id === "cat-budget") app.drafts.category.budget = target.value
  if (["cat-icon", "cat-label", "cat-budget"].includes(target.id)) {
    updateButtonState("save-category", canAddCategory())
  }

  if (target.id === "preset-icon") app.drafts.preset.icon = target.value
  if (target.id === "preset-desc") app.drafts.preset.desc = target.value
  if (target.id === "preset-amt") app.drafts.preset.amt = target.value
  if (["preset-icon", "preset-desc", "preset-amt"].includes(target.id)) {
    updateButtonState("save-preset", canAddPreset())
  }

  if (target.id === "wish-icon") app.drafts.wish.icon = target.value
  if (target.id === "wish-desc") app.drafts.wish.desc = target.value
  if (target.id === "wish-amt") app.drafts.wish.amt = target.value
  if (["wish-icon", "wish-desc", "wish-amt"].includes(target.id)) {
    updateButtonState("save-wish", canAddWish())
  }

  if (target.id === "edit-desc") app.drafts.edit.desc = target.value
  if (target.id === "edit-amt") app.drafts.edit.amt = target.value

  if (target.id === "wish-edit-icon") app.drafts.wishEdit.icon = target.value
  if (target.id === "wish-edit-desc") app.drafts.wishEdit.desc = target.value
  if (target.id === "wish-edit-amt") app.drafts.wishEdit.amt = target.value

  if (target.id === "cloud-email") app.drafts.cloud.email = target.value
  if (target.id === "cloud-code") {
    const code = target.value.replace(/\D/g, "").slice(0, 6)
    app.drafts.cloud.code = code
    target.value = code
  }
}

function handleClick(event) {
  const target = event.target.closest("[data-action]")
  if (!target) {
    if (event.target === modalEl) closeModal()
    return
  }

  const action = target.dataset.action
  const id = target.dataset.id
  const view = target.dataset.view

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
  if (action === "addPreset") addPreset()
  if (action === "deletePreset") deletePreset(id)
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
  if (action === "cloudLogin") sendEmailCode()
  if (action === "cloudVerify") verifyEmailCode()
  if (action === "cloudPush") pushCloudData()
  if (action === "cloudPull" && confirm("This will replace this local copy with the data in Supabase.")) pullCloudData()
  if (action === "cloudSignOut") signOutCloud()
  if (action === "install") installPWA()
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

function closeModal(shouldRender = true) {
  app.modal = null
  app.editingEntryId = null
  app.editingCat = null
  app.editingWishId = null
  app.editingWishCat = null
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

function deleteCategory(id) {
  if (app.data._settings.budgets.length <= 1) {
    toast("Keep at least 1 budget")
    return
  }

  const cat = rawCategoryById(id)
  if (!cat) return
  if (!confirm(`Delete ${cat.label}? Its expenses, presets, and wishes will also be deleted.`)) return

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

function deletePreset(id) {
  app.data._settings.deletedPresetIds = app.data._settings.deletedPresetIds || []
  if (!app.data._settings.deletedPresetIds.includes(id)) app.data._settings.deletedPresetIds.push(id)
  app.data._settings.presets = app.data._settings.presets.filter(preset => preset.id !== id)
  saveData(app.data)
  render()
  haptic("warning")
  toast("Preset deleted")
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

function deleteWish(id) {
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
  closeModal(false)
  deleteWish(id)
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

function deleteEntry(id) {
  if (!Array.isArray(app.data[app.key])) return
  app.data[app.key] = app.data[app.key].filter(entry => Number(entry.id) !== Number(id))
  saveData(app.data)
  render()
  haptic("warning")
  toast("Deleted")
}

function deleteEditingEntry() {
  const id = app.editingEntryId
  closeModal(false)
  deleteEntry(id)
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
    navigator.serviceWorker.register("./service-worker.js").catch(() => {})
  })
}

render()
requestAnimationFrame(hideBootSplash)
initCloud()
