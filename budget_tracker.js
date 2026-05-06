// Variables used by Scriptable.
// icon-color: deep-green; icon-glyph: wallet;

const DEFAULT_BUDGETS = [
    { id: "cafe", label: "Cafés", icon: "☕", budget: 50, color: "#F59E0B" },
    { id: "rest", label: "Restaurantes", icon: "🍽", budget: 200, color: "#EF4444" },
    { id: "uber", label: "Uber", icon: "🚗", budget: 20, color: "#10B981" },
    { id: "online", label: "Compras Online", icon: "📦", budget: 100, color: "#3B82F6" },
    { id: "growth_lab", label: "Business Experiments", icon: "🧪", budget: 15, color: "#8B5CF6" },
]

function hslToHex(h, s, l) {
    s /= 100
    l /= 100

    const k = n => (n + h / 30) % 12
    const a = s * Math.min(l, 1 - l)
    const f = n => {
        const color = l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)))
        return Math.round(255 * color)
            .toString(16)
            .padStart(2, "0")
    }

    return `#${f(0)}${f(8)}${f(4)}`.toUpperCase()
}

function generatedCategoryColor(index) {
    const i = Math.max(0, Number(index) || 0)
    const hue = (i * 137.508) % 360
    const saturation = 68 + ((i * 17) % 18)
    const lightness = 46 + ((i * 11) % 10)

    return hslToHex(hue, saturation, lightness)
}

function nextCategoryColor(budgets) {
    const arr = Array.isArray(budgets) ? budgets : []
    const used = arr.map(b => String(b.color || "").toUpperCase())

    let i = arr.length

    for (let attempts = 0; attempts < 500; attempts++) {
        const color = generatedCategoryColor(i + attempts)

        if (!used.includes(color.toUpperCase())) {
            return color
        }
    }

    return generatedCategoryColor(Date.now() % 100000)
}

const DEFAULT_PRESETS = [
    { id: "preset_starbucks", desc: "Starbucks", amt: 5.50, cat: "cafe", icon: "☕" },
    { id: "preset_uber", desc: "Uber", amt: 6.00, cat: "uber", icon: "🚗" },
    { id: "preset_lunch", desc: "Lunch", amt: 12.00, cat: "rest", icon: "🍽" },
]

const fm = FileManager.local()
const DATA_FILENAME = "budget_v5.json"
const BACKUP_FILENAME = "budget_v5.backup.json"
const DATA_PATH = fm.joinPath(fm.documentsDirectory(), DATA_FILENAME)
const BACKUP_PATH = fm.joinPath(fm.documentsDirectory(), BACKUP_FILENAME)

// Rollover starts with May 2026.
// Important: Date.getMonth() is zero-based, so May = 4.
// This means May 2026 will NOT inherit anything from April 2026.
// June 2026 and later can inherit leftover/debt from May 2026 onward.
const ROLLOVER_START_KEY = "2026-4"

function getICloudFM() {
    try {
        const cfm = FileManager.iCloud()
        if (!cfm) return null
        cfm.documentsDirectory()
        return cfm
    } catch (e) {
        return null
    }
}

function clone(obj) {
    return JSON.parse(JSON.stringify(obj))
}

function loadData() {
    let d = {}

    if (fm.fileExists(DATA_PATH)) {
        try {
            d = JSON.parse(fm.readString(DATA_PATH))
        } catch (e) {
            d = {}
        }
    }

    return ensureDataShape(d)
}

function ensureDataShape(d) {
    if (!d || typeof d !== "object" || Array.isArray(d)) d = {}

    if (!d._settings || typeof d._settings !== "object") {
        d._settings = {}
    }

    if (!Array.isArray(d._settings.budgets) || d._settings.budgets.length === 0) {
        d._settings.budgets = clone(DEFAULT_BUDGETS)
    }

    d._settings.budgets = d._settings.budgets
        .filter(b => b && b.id && b.label)
        .map(b => ({
            id: String(b.id),
            label: String(b.label),
            icon: String(b.icon || "🏷️"),
            budget: Number(b.baseBudget ?? b.budget) || 0,
            color: /^#[0-9A-Fa-f]{6}$/.test(String(b.color || "")) ? String(b.color) : "#0F766E"
        }))

    if (!Array.isArray(d._settings.activeMonthKeys)) {
        d._settings.activeMonthKeys = []
    }

    d._settings.activeMonthKeys = d._settings.activeMonthKeys
        .filter(k => parseMonthKey(k))
        .map(k => String(k))
        .filter((k, i, arr) => arr.indexOf(k) === i)

    if (!Array.isArray(d._settings.deletedPresetIds)) {
        d._settings.deletedPresetIds = []
    }

    d._settings.deletedPresetIds = d._settings.deletedPresetIds
        .filter(Boolean)
        .map(x => String(x))

    if (!Array.isArray(d._settings.presets)) {
        d._settings.presets = []
    }

    DEFAULT_PRESETS.forEach(p => {
        const wasDeleted = d._settings.deletedPresetIds.includes(String(p.id))
        const exists = d._settings.presets.some(x => x && String(x.id) === String(p.id))

        if (!wasDeleted && !exists) {
            d._settings.presets.push(clone(p))
        }
    })

    d._settings.presets = d._settings.presets
        .filter(p => p && p.id && p.desc)
        .map(p => ({
            id: String(p.id),
            desc: String(p.desc || "Gasto"),
            amt: Number(p.amt) || 0,
            cat: String(p.cat || ""),
            icon: String(p.icon || "⚡")
        }))
        .filter(p => p.amt > 0)

    if (!Array.isArray(d._settings.wishes)) {
        d._settings.wishes = []
    }

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

    if (!d._settings._meta || typeof d._settings._meta !== "object") {
        d._settings._meta = {}
    }

    d._settings._meta.schemaVersion = 5
    d._settings._meta.lastICloudBackup = Number(d._settings._meta.lastICloudBackup) || 0

    return d
}

function saveData(d) {
    const shaped = ensureDataShape(d)
    const json = JSON.stringify(shaped, null, 2)

    fm.writeString(DATA_PATH, json)

    const icloud = getICloudFM()

    if (icloud) {
        try {
            const cloudPath = icloud.joinPath(icloud.documentsDirectory(), DATA_FILENAME)
            icloud.writeString(cloudPath, json)
            shaped._settings._meta.lastICloudBackup = Date.now()
            fm.writeString(DATA_PATH, JSON.stringify(shaped, null, 2))
        } catch (e) {}
    }
}

function exportJSONString(data) {
    return JSON.stringify(ensureDataShape(data), null, 2)
}

function csvEscape(value) {
    const s = value === undefined || value === null ? "" : String(value)

    if (/[",\n\r]/.test(s)) {
        return '"' + s.replace(/"/g, '""') + '"'
    }

    return s
}

function exportCSVForMonth(data, key) {
    data = ensureDataShape(data)

    const budgets = getBudgets(data)
    const labelById = {}
    budgets.forEach(b => labelById[b.id] = b.label)

    const entries = Array.isArray(data[key]) ? data[key] : []
    const lines = ["Fecha,Categoria,Descripcion,Monto"]

    entries.forEach(e => {
        const fecha = csvEscape(e.date || "")
        const cat = csvEscape(labelById[e.cat] || e.cat || "")
        const desc = csvEscape(e.desc || "")
        const amt = (Number(e.amt) || 0).toFixed(2)

        lines.push(`${fecha},${cat},${desc},${amt}`)
    })

    return lines.join("\n")
}

function importJSONFromString(jsonString) {
    let parsed

    try {
        parsed = JSON.parse(jsonString)
    } catch (e) {
        return { ok: false, error: "JSON inválido" }
    }

    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        return { ok: false, error: "Archivo no contiene datos válidos" }
    }

    const shaped = ensureDataShape(parsed)
    const monthKeys = Object.keys(shaped).filter(k => k !== "_settings" && parseMonthKey(k))
    const txCount = monthKeys.reduce((acc, k) => acc + (Array.isArray(shaped[k]) ? shaped[k].length : 0), 0)
    const catCount = shaped._settings.budgets.length

    return { ok: true, data: shaped, monthsImported: monthKeys.length, txCount, catCount }
}

function getBudgets(data) {
    data = ensureDataShape(data)
    return data._settings.budgets
}

function getPresets(data) {
    data = ensureDataShape(data)
    return data._settings.presets
}

function getWishes(data) {
    data = ensureDataShape(data)
    return data._settings.wishes
}

function monthKey() {
    const d = new Date()
    return `${d.getFullYear()}-${d.getMonth()}`
}

function parseMonthKey(key) {
    const m = String(key || "").match(/^(\d{4})-(\d{1,2})$/)
    if (!m) return null

    const year = Number(m[1])
    const month = Number(m[2])

    if (!Number.isInteger(year) || !Number.isInteger(month)) return null
    if (month < 0 || month > 11) return null

    return { year, month }
}

function monthKeyFromParts(year, month) {
    let y = Number(year)
    let m = Number(month)

    while (m < 0) {
        y--
        m += 12
    }

    while (m > 11) {
        y++
        m -= 12
    }

    return `${y}-${m}`
}

function compareMonthKeys(a, b) {
    const pa = parseMonthKey(a)
    const pb = parseMonthKey(b)

    if (!pa && !pb) return 0
    if (!pa) return -1
    if (!pb) return 1

    const av = pa.year * 12 + pa.month
    const bv = pb.year * 12 + pb.month

    return av - bv
}

function getTrackedMonthKeys(data) {
    data = ensureDataShape(data)

    const fromEntries = Object.keys(data)
        .filter(k => k !== "_settings")
        .filter(k => parseMonthKey(k))
        .filter(k => Array.isArray(data[k]))

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

    if (!Array.isArray(data._settings.activeMonthKeys)) {
        data._settings.activeMonthKeys = []
    }

    if (!data._settings.activeMonthKeys.includes(key)) {
        data._settings.activeMonthKeys.push(key)
        data._settings.activeMonthKeys = data._settings.activeMonthKeys.sort(compareMonthKeys)
        return true
    }

    return false
}

function roundMoney(n) {
    return Math.round((Number(n) || 0) * 100) / 100
}

function getSpentForMonth(data, key, categoryIds) {
    const spent = {}

    categoryIds.forEach(id => spent[id] = 0)

    const entries = Array.isArray(data[key]) ? data[key] : []

    entries.forEach(e => {
        const cat = String(e.cat || "")
        if (!cat) return

        spent[cat] = (spent[cat] || 0) + (Number(e.amt) || 0)
    })

    return spent
}

function calcRolloverMap(data, key, rawBudgets) {
    data = ensureDataShape(data)

    const budgets = Array.isArray(rawBudgets) ? rawBudgets : getBudgets(data)
    const ids = budgets.map(b => b.id)
    const baseById = {}
    const carry = {}

    budgets.forEach(b => {
        baseById[b.id] = Number(b.budget) || 0
        carry[b.id] = 0
    })

    // Do not calculate rollover before the official tracking start month.
    // For May 2026 itself, this returns zero rollover because there is no valid previous month.
    if (compareMonthKeys(key, ROLLOVER_START_KEY) <= 0) {
        return carry
    }

    const trackedMonths = getTrackedMonthKeys(data)
        .filter(k => compareMonthKeys(k, ROLLOVER_START_KEY) >= 0)
        .filter(k => compareMonthKeys(k, key) < 0)

    trackedMonths.forEach(month => {
        const spent = getSpentForMonth(data, month, ids)

        ids.forEach(id => {
            const base = Number(baseById[id]) || 0
            const previousCarry = Number(carry[id]) || 0
            const used = Number(spent[id]) || 0

            // Smart rollover:
            // Positive leftover goes forward. Overspending also goes forward as a negative adjustment.
            // Example: base $50, carry +$10, spent $40 => next month gets +$20.
            // Example: base $50, carry $0, spent $65 => next month starts with -$15 adjustment.
            carry[id] = roundMoney(base + previousCarry - used)
        })
    })

    return carry
}

function makeCatId(label, budgets) {
    let base = String(label || "cat")
        .toLowerCase()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/[^a-z0-9]+/g, "_")
        .replace(/^_+|_+$/g, "")

    if (!base) base = "cat"

    let id = base
    let n = 2

    while (budgets.some(b => b.id === id)) {
        id = `${base}_${n}`
        n++
    }

    return id
}

function makePresetId(desc, presets) {
    let base = String(desc || "preset")
        .toLowerCase()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/[^a-z0-9]+/g, "_")
        .replace(/^_+|_+$/g, "")

    if (!base) base = "preset"
    if (!base.startsWith("preset_")) base = "preset_" + base

    let id = base
    let n = 2

    while (presets.some(p => p.id === id)) {
        id = `${base}_${n}`
        n++
    }

    return id
}

function makeWishId(desc, wishes) {
    let base = String(desc || "wish")
        .toLowerCase()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/[^a-z0-9]+/g, "_")
        .replace(/^_+|_+$/g, "")

    if (!base) base = "wish"
    if (!base.startsWith("wish_")) base = "wish_" + base

    let id = base
    let n = 2

    while (wishes.some(w => w.id === id)) {
        id = `${base}_${n}`
        n++
    }

    return id
}

function safeJSONString(obj) {
    return JSON.stringify(obj).replace(/</g, "\\u003c")
}

function calcState(data, key) {
    data = ensureDataShape(data)

    const rawBudgets = getBudgets(data)
    const presets = getPresets(data)
    const wishes = getWishes(data)
    const entries = Array.isArray(data[key]) ? data[key] : []
    const rolloverMap = calcRolloverMap(data, key, rawBudgets)

    const budgets = rawBudgets.map(b => {
        const baseBudget = Number(b.budget) || 0
        const rollover = roundMoney(rolloverMap[b.id] || 0)
        const effectiveBudget = roundMoney(baseBudget + rollover)

        return {
            id: b.id,
            label: b.label,
            icon: b.icon,
            color: b.color,
            baseBudget,
            rollover,
            budget: effectiveBudget
        }
    })

    const spent = {}

    budgets.forEach(b => spent[b.id] = 0)

    entries.forEach(e => {
        const cat = e.cat || "uncategorized"
        spent[cat] = (spent[cat] || 0) + (Number(e.amt) || 0)
    })

    return { budgets, presets, wishes, entries, spent, monthKey: key }
}

function delay(ms) {
    return new Promise(resolve => Timer.schedule(ms / 1000, false, resolve))
}

// ─── WIDGET ───────────────────────────────────────────────
async function buildWidget() {
    let data = loadData()
    const key = monthKey()

    if (markActiveMonth(data, key)) {
        saveData(data)
    }

    const budgets = calcState(data, key).budgets
    const { spent } = calcState(data, key)

    const totalBudget = budgets.reduce((s, b) => s + (Number(b.budget) || 0), 0)
    const totalSpent = Object.values(spent).reduce((s, v) => s + (Number(v) || 0), 0)
    const left = totalBudget - totalSpent

    const w = new ListWidget()
    w.backgroundColor = new Color("#F8FAFC")
    w.setPadding(14, 16, 14, 16)
    w.url = URLScheme.forRunningScript()

    const mes = new Date().toLocaleDateString("es-MX", { month: "short" })

    const top = w.addStack()
    top.layoutHorizontally()
    top.centerAlignContent()

    const ico = top.addText("Presupuesto")
    ico.font = Font.boldSystemFont(13)
    ico.textColor = new Color("#111827")

    top.addSpacer()

    const mt = top.addText(mes)
    mt.font = Font.boldSystemFont(10)
    mt.textColor = new Color("#667085")

    w.addSpacer(8)

    const lbl = w.addText(left < 0 ? "Sobrepasado" : "Disponible")
    lbl.font = Font.boldSystemFont(9)
    lbl.textColor = new Color("#667085")

    w.addSpacer(2)

    const amt = w.addText(`$${Math.abs(left).toFixed(0)}`)
    amt.font = Font.boldSystemFont(32)
    amt.textColor = left < 0 ? new Color("#E11D48") : new Color("#111827")

    w.addSpacer(2)

    const sub = w.addText(`$${totalSpent.toFixed(0)} de $${totalBudget.toFixed(0)}`)
    sub.font = Font.systemFont(10)
    sub.textColor = new Color("#667085")

    const totalRollover = budgets.reduce((s, b) => s + (Number(b.rollover) || 0), 0)

    if (Math.abs(totalRollover) >= 0.01) {
        w.addSpacer(2)

        const ro = w.addText(`Rollover ${totalRollover >= 0 ? "+" : "-"}$${Math.abs(totalRollover).toFixed(0)}`)
        ro.font = Font.boldSystemFont(9)
        ro.textColor = totalRollover >= 0 ? new Color("#0F766E") : new Color("#E11D48")
    }

    w.addSpacer(10)

    for (const b of budgets.slice(0, 5)) {
        const s = spent[b.id] || 0
        const over = s > b.budget

        const row = w.addStack()
        row.layoutHorizontally()
        row.centerAlignContent()

        const dot = row.addStack()
        dot.size = new Size(4, 14)
        dot.backgroundColor = new Color(b.color || "#0F766E")
        dot.cornerRadius = 2

        row.addSpacer(7)

        const nt = row.addText(`${b.icon || ""} ${b.label}`)
        nt.font = Font.systemFont(9)
        nt.textColor = new Color("#111827")
        nt.lineLimit = 1

        row.addSpacer()

        const at = row.addText(`$${s.toFixed(0)}/$${Number(b.budget || 0).toFixed(0)}`)
        at.font = Font.boldSystemFont(9)
        at.textColor = over ? new Color("#E11D48") : new Color(b.color || "#0F766E")

        w.addSpacer(3)
    }

    w.addSpacer()

    const hint = w.addText("Toca para abrir ↗")
    hint.font = Font.systemFont(9)
    hint.textColor = new Color("#B0B0C3")
    hint.rightAlignText()

    return w
}

// ─── WEBVIEW APP ──────────────────────────────────────────
async function runApp() {
    let data = loadData()
    const key = monthKey()

    if (markActiveMonth(data, key)) {
        saveData(data)
    }

    const now = new Date()
    const mesLabel = now.toLocaleDateString("es-MX", { month: "long", year: "numeric" })
        .replace(/^\w/, c => c.toUpperCase())

    const wv = new WebView()
    await wv.loadHTML(buildHTML(calcState(data, key), mesLabel))

    let active = true
    const presentPromise = wv.present(false).then(() => { active = false })

    const poll = async () => {
        while (active) {
            await delay(120)

            let raw

            try {
                raw = await wv.evaluateJavaScript(
                    "(function(){ var q=window._q||[]; window._q=[]; return JSON.stringify(q); })()"
                )
            } catch (e) {
                break
            }

            if (!raw) continue

            let msgs

            try {
                msgs = JSON.parse(raw)
            } catch (e) {
                continue
            }

            if (!Array.isArray(msgs) || msgs.length === 0) continue

            let dirty = false

            for (const action of msgs) {
                if (!action || !action.type) continue

                if (action.type === "add") {
                    if (!data[key]) data[key] = []

                    const today = new Date().toLocaleDateString("es-MX", {
                        day: "2-digit",
                        month: "short"
                    })

                    const entryId = Number(action.id) || Date.now() + Math.floor(Math.random() * 1000)
                    const exists = data[key].some(e => Number(e.id) === entryId)

                    if (!exists) {
                        data[key].push({
                            id: entryId,
                            desc: String(action.desc || "Gasto"),
                            amt: Number(action.amt) || 0,
                            cat: String(action.cat || ""),
                            date: today
                        })

                        dirty = true
                    }
                }

                if (action.type === "updateEntry") {
                    if (Array.isArray(data[key])) {
                        const e = data[key].find(x => Number(x.id) === Number(action.id))

                        if (e) {
                            e.desc = String(action.desc || "Gasto")
                            e.amt = Number(action.amt) || 0
                            e.cat = String(action.cat || "")
                            dirty = true
                        }
                    }
                }

                if (action.type === "delete") {
                    if (Array.isArray(data[key])) {
                        data[key] = data[key].filter(e => Number(e.id) !== Number(action.id))
                        dirty = true
                    }
                }

                if (action.type === "addCategory") {
                    data = ensureDataShape(data)

                    const budgets = getBudgets(data)
                    const label = String(action.label || "").trim()
                    const icon = String(action.icon || "•").trim() || "•"
                    const budget = Number(action.budget) || 0
                    const color = /^#[0-9A-Fa-f]{6}$/.test(String(action.color || ""))
                        ? String(action.color)
                        : nextCategoryColor(budgets)

                    const requestedId = String(action.id || "").trim()
                    const validRequestedId = /^[a-z0-9_]+$/.test(requestedId)

                    const duplicatedLabel = budgets.some(
                        b => b.label.trim().toLowerCase() === label.toLowerCase()
                    )

                    const duplicatedId = budgets.some(b => b.id === requestedId)

                    if (label && budget > 0 && !duplicatedLabel) {
                        budgets.push({
                            id: validRequestedId && !duplicatedId ? requestedId : makeCatId(label, budgets),
                            label,
                            icon,
                            budget,
                            color
                        })

                        dirty = true
                    }
                }

                if (action.type === "updateCategory") {
                    data = ensureDataShape(data)

                    const budgets = getBudgets(data)
                    const b = budgets.find(x => x.id === action.id)
                    const budget = Number(action.budget) || 0

                    if (b && budget > 0) {
                        b.budget = budget
                        dirty = true
                    }
                }

                if (action.type === "deleteCategory") {
                    data = ensureDataShape(data)

                    const id = String(action.id || "")

                    if (id && data._settings.budgets.length > 1) {
                        data._settings.budgets = data._settings.budgets.filter(b => b.id !== id)

                        Object.keys(data).forEach(k => {
                            if (k === "_settings") return
                            if (Array.isArray(data[k])) {
                                data[k] = data[k].filter(e => e.cat !== id)
                            }
                        })

                        data._settings.presets = getPresets(data).filter(p => p.cat !== id)
                        data._settings.wishes = getWishes(data).filter(w => w.cat !== id)

                        dirty = true
                    }
                }

                if (action.type === "addPreset") {
                    data = ensureDataShape(data)

                    const desc = String(action.desc || "").trim()
                    const amt = Number(action.amt) || 0
                    const cat = String(action.cat || "")
                    const icon = String(action.icon || "⚡").trim() || "⚡"

                    const budgets = data._settings.budgets
                    const presets = data._settings.presets

                    const catExists = budgets.some(b => b.id === cat)
                    const requestedId = String(action.id || "").trim()
                    const validRequestedId = /^[a-z0-9_]+$/.test(requestedId)
                    const duplicatedId = presets.some(p => p.id === requestedId)

                    if (desc && amt > 0 && catExists) {
                        presets.push({
                            id: validRequestedId && !duplicatedId ? requestedId : makePresetId(desc, presets),
                            desc,
                            amt,
                            cat,
                            icon
                        })

                        dirty = true
                    }
                }

                if (action.type === "deletePreset") {
                    data = ensureDataShape(data)

                    const id = String(action.id || "")

                    if (id) {
                        if (!Array.isArray(data._settings.deletedPresetIds)) {
                            data._settings.deletedPresetIds = []
                        }

                        if (!data._settings.deletedPresetIds.includes(id)) {
                            data._settings.deletedPresetIds.push(id)
                        }

                        data._settings.presets = getPresets(data).filter(p => p.id !== id)
                        dirty = true
                    }
                }

                if (action.type === "addWish") {
                    data = ensureDataShape(data)

                    const desc = String(action.desc || "").trim()
                    const amt = Number(action.amt) || 0
                    const cat = String(action.cat || "")
                    const icon = String(action.icon || "✨").trim() || "✨"

                    const budgets = data._settings.budgets
                    const wishes = data._settings.wishes

                    const catExists = budgets.some(b => b.id === cat)
                    const requestedId = String(action.id || "").trim()
                    const validRequestedId = /^[a-z0-9_]+$/.test(requestedId)
                    const duplicatedId = wishes.some(w => w.id === requestedId)

                    if (desc && amt > 0 && catExists) {
                        wishes.push({
                            id: validRequestedId && !duplicatedId ? requestedId : makeWishId(desc, wishes),
                            desc,
                            amt,
                            cat,
                            icon
                        })

                        dirty = true
                    }
                }

                if (action.type === "updateWish") {
                    data = ensureDataShape(data)

                    const id = String(action.id || "")
                    const desc = String(action.desc || "").trim()
                    const amt = Number(action.amt) || 0
                    const cat = String(action.cat || "")
                    const icon = String(action.icon || "✨").trim() || "✨"

                    const wish = data._settings.wishes.find(w => w.id === id)
                    const catExists = data._settings.budgets.some(b => b.id === cat)

                    if (wish && desc && amt > 0 && catExists) {
                        wish.desc = desc
                        wish.amt = amt
                        wish.cat = cat
                        wish.icon = icon
                        dirty = true
                    }
                }

                if (action.type === "deleteWish") {
                    data = ensureDataShape(data)

                    const id = String(action.id || "")

                    if (id) {
                        data._settings.wishes = getWishes(data).filter(w => w.id !== id)
                        dirty = true
                    }
                }

                if (action.type === "buyWish") {
                    data = ensureDataShape(data)

                    const wishId = String(action.id || "")
                    const wishes = data._settings.wishes
                    const wish = wishes.find(w => w.id === wishId)

                    const desc = String(action.desc || (wish ? wish.desc : "Wish")).trim()
                    const amt = Number(action.amt || (wish ? wish.amt : 0)) || 0
                    const cat = String(action.cat || (wish ? wish.cat : ""))
                    const entryId = Number(action.entryId) || Date.now() + Math.floor(Math.random() * 1000)

                    const catExists = data._settings.budgets.some(b => b.id === cat)

                    if (wishId && desc && amt > 0 && catExists) {
                        if (!data[key]) data[key] = []

                        const exists = data[key].some(e => Number(e.id) === entryId)

                        if (!exists) {
                            const today = new Date().toLocaleDateString("es-MX", {
                                day: "2-digit",
                                month: "short"
                            })

                            data[key].push({
                                id: entryId,
                                desc,
                                amt,
                                cat,
                                date: today
                            })
                        }

                        data._settings.wishes = wishes.filter(w => w.id !== wishId)
                        dirty = true
                    }
                }

                if (action.type === "exportJSON") {
                    try {
                        const json = exportJSONString(data)
                        const tmpDir = fm.temporaryDirectory ? fm.temporaryDirectory() : fm.cacheDirectory()
                        const tmpPath = fm.joinPath(tmpDir, "budget_export.json")
                        fm.writeString(tmpPath, json)
                        await ShareSheet.present([tmpPath])
                        try { await wv.evaluateJavaScript(`toast('✓ Exportado')`) } catch (e) {}
                    } catch (e) {
                        try { await wv.evaluateJavaScript(`toast('Error al exportar')`) } catch (er) {}
                    }
                }

                if (action.type === "exportCSV") {
                    try {
                        const csv = exportCSVForMonth(data, key)
                        const tmpDir = fm.temporaryDirectory ? fm.temporaryDirectory() : fm.cacheDirectory()
                        const tmpPath = fm.joinPath(tmpDir, `budget_${key}.csv`)
                        fm.writeString(tmpPath, csv)
                        await ShareSheet.present([tmpPath])
                        try { await wv.evaluateJavaScript(`toast('✓ CSV listo')`) } catch (e) {}
                    } catch (e) {
                        try { await wv.evaluateJavaScript(`toast('Error al exportar CSV')`) } catch (er) {}
                    }
                }

                if (action.type === "importJSON") {
                    try {
                        const paths = await DocumentPicker.open(["public.json"])
                        const path = Array.isArray(paths) ? paths[0] : paths

                        if (!path) {
                            try { await wv.evaluateJavaScript(`toast('Import cancelado')`) } catch (e) {}
                        } else {
                            const raw = fm.readString(path)
                            const result = importJSONFromString(raw)

                            if (!result.ok) {
                                const a = new Alert()
                                a.title = "Import falló"
                                a.message = result.error || "El archivo no es válido."
                                a.addCancelAction("OK")
                                await a.presentAlert()
                            } else {
                                const a = new Alert()
                                a.title = "Confirmar import"
                                a.message = `Vas a reemplazar tus datos por:\n\n• ${result.catCount} categorías\n• ${result.monthsImported} meses\n• ${result.txCount} transacciones\n\nSe guardará un respaldo automático en ${BACKUP_FILENAME} antes de pisar.`
                                a.addAction("Reemplazar")
                                a.addCancelAction("Cancelar")
                                const choice = await a.presentAlert()

                                if (choice === 0) {
                                    try {
                                        fm.writeString(BACKUP_PATH, JSON.stringify(ensureDataShape(data), null, 2))
                                    } catch (e) {}

                                    data = result.data
                                    markActiveMonth(data, key)
                                    dirty = true

                                    try { await wv.evaluateJavaScript(`toast('✓ Datos importados')`) } catch (e) {}
                                } else {
                                    try { await wv.evaluateJavaScript(`toast('Import cancelado')`) } catch (e) {}
                                }
                            }
                        }
                    } catch (e) {
                        try { await wv.evaluateJavaScript(`toast('Error al importar')`) } catch (er) {}
                    }
                }

                if (action.type === "getBackupStatus") {
                    try {
                        const meta = (data._settings && data._settings._meta) || {}
                        const last = Number(meta.lastICloudBackup) || 0
                        const icloudOk = !!getICloudFM()
                        const payload = safeJSONString({ lastICloudBackup: last, icloudAvailable: icloudOk })
                        await wv.evaluateJavaScript(`updateBackupStatus(${payload})`)
                    } catch (e) {}
                }
            }

            if (dirty) {
                saveData(data)

                const ns = safeJSONString(calcState(data, key))
                const meta = (data._settings && data._settings._meta) || {}
                const backupPayload = safeJSONString({
                    lastICloudBackup: Number(meta.lastICloudBackup) || 0,
                    icloudAvailable: !!getICloudFM()
                })

                try {
                    await wv.evaluateJavaScript(`updateState(${ns}); updateBackupStatus(${backupPayload})`)
                } catch (e) {
                    break
                }
            }
        }
    }

    await Promise.race([presentPromise, poll()])
}

// ─── HTML ─────────────────────────────────────────────────
function buildHTML(state, mesLabel) {
    const sj = safeJSONString(state)

    return `<!DOCTYPE html>
<html>
<head>
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta charset="utf-8">

<style>
:root{
  --bg:#F6F8FA;
  --card:#FFFFFF;
  --card2:#F8FAFC;
  --bord:#DDE3EA;
  --bord2:#E8EDF3;
  --txt:#111827;
  --mut:#667085;
  --soft:#98A2B3;
  --dim:#E6EBF0;
  --red:#E11D48;
  --red2:#FFF1F2;
  --grn:#0F766E;
  --grn2:#E6F6F2;
  --amb:#D97706;
  --amb2:#FFF7E6;
  --acc:#0F766E;
  --acc2:#E6F6F2;
  --acc3:#2563EB;
  --blue:#2563EB;
  --shadow-xs:0 1px 2px rgba(16,24,40,.04);
  --shadow-sm:0 2px 8px rgba(16,24,40,.055);
  --shadow-md:0 6px 18px rgba(16,24,40,.07);
  --shadow-lg:0 16px 36px rgba(16,24,40,.14);
  --ring:0 0 0 3px rgba(15,118,110,.16);
  --r:8px;
}

*{
  box-sizing:border-box;
  margin:0;
  padding:0;
  -webkit-tap-highlight-color:transparent;
}

html{
  -webkit-text-size-adjust:100%;
}

body{
  background:var(--bg);
  color:var(--txt);
  font-family:-apple-system,BlinkMacSystemFont,"SF Pro Display","SF Pro Text",sans-serif;
  padding-top:env(safe-area-inset-top,26px);
  padding-bottom:max(14px, env(safe-area-inset-bottom, 14px));
  min-height:100vh;
  overflow:hidden;
  -webkit-font-smoothing:antialiased;
  -moz-osx-font-smoothing:grayscale;
  text-rendering:optimizeLegibility;
  font-feature-settings:"ss01","cv11";
}

.tnum{
  font-variant-numeric:tabular-nums;
  font-feature-settings:"tnum","ss01";
}

.screen{
  display:none;
  flex-direction:column;
  height:calc(100vh - env(safe-area-inset-top,26px) - max(14px, env(safe-area-inset-bottom, 14px)));
  padding:0 14px;
  overflow:hidden;
}

.screen.on{
  display:flex;
}

.hdr{
  padding:9px 0 5px;
  display:flex;
  align-items:center;
  justify-content:space-between;
  gap:8px;
  flex-shrink:0;
}

.hdr-left{
  min-width:0;
}

.hdr-t{
  font-size:14px;
  font-weight:850;
  color:var(--acc);
  letter-spacing:0;
  line-height:1.2;
}

.hdr-m{
  font-size:12px;
  color:var(--mut);
  font-weight:750;
  letter-spacing:0;
  line-height:1.2;
  margin-top:2px;
}

.top-btn{
  border:.5px solid var(--bord);
  background:rgba(255,255,255,.85);
  -webkit-backdrop-filter:saturate(180%) blur(20px);
  backdrop-filter:saturate(180%) blur(20px);
  color:var(--acc);
  border-radius:999px;
  padding:8px 12px;
  font-size:11px;
  font-weight:800;
  letter-spacing:0;
  -webkit-appearance:none;
  box-shadow:var(--shadow-xs);
  flex-shrink:0;
  transition:transform .15s,box-shadow .2s,background .2s;
}

.top-btn:active{
  transform:scale(.95);
  background:var(--acc2);
}

.hdr-actions{
  display:flex;
  align-items:center;
  gap:6px;
  flex-shrink:0;
}

.hero{
  padding:6px 0 14px;
  flex-shrink:0;
}

.hero-lbl{
  font-size:10.5px;
  font-weight:800;
  color:var(--mut);
  letter-spacing:0;
  margin-bottom:4px;
  text-transform:uppercase;
}

.hero-amt{
  font-size:44px;
  font-weight:800;
  line-height:.96;
  letter-spacing:0;
  color:var(--txt);
  font-variant-numeric:tabular-nums;
  font-feature-settings:"tnum","ss01";
}

.hero-sub{
  font-size:13px;
  color:var(--mut);
  margin-top:7px;
  font-weight:600;
  font-variant-numeric:tabular-nums;
  letter-spacing:0;
}

.hero-health{
  margin-top:6px;
  display:inline-block;
  max-width:100%;
  color:var(--mut);
  font-size:12px;
  font-weight:700;
  line-height:1.25;
  letter-spacing:0;
  white-space:nowrap;
  overflow:hidden;
  text-overflow:ellipsis;
}

.gbar{
  height:6px;
  background:var(--dim);
  border-radius:99px;
  margin-bottom:14px;
  overflow:hidden;
  flex-shrink:0;
  box-shadow:inset 0 0 0 .5px rgba(17,24,39,.02);
}

.gbar-f{
  height:100%;
  border-radius:99px;
  transition:width .4s cubic-bezier(.4,0,.2,1);
  background:var(--acc);
}

.cats{
  flex:1;
  overflow-y:auto;
  display:flex;
  flex-direction:column;
  gap:9px;
  padding-bottom:8px;
  -webkit-overflow-scrolling:touch;
}

.cc{
  background:var(--card);
  border:.5px solid var(--bord);
  border-radius:18px;
  padding:13px 14px;
  cursor:pointer;
  flex-shrink:0;
  box-shadow:var(--shadow-sm);
  transition:transform .18s cubic-bezier(.4,0,.2,1),box-shadow .2s,opacity .2s;
}

.cc:active{
  opacity:.85;
  transform:scale(.985);
  box-shadow:var(--shadow-xs);
}

.cc-top{
  display:flex;
  align-items:center;
  justify-content:space-between;
  margin-bottom:10px;
  gap:10px;
}

.cc-l{
  display:flex;
  align-items:center;
  gap:11px;
  min-width:0;
}

.cc-icon{
  width:36px;
  height:36px;
  display:flex;
  align-items:center;
  justify-content:center;
  font-size:19px;
  border-radius:11px;
  background:var(--card2);
  flex-shrink:0;
  box-shadow:inset 0 0 0 .5px rgba(17,24,39,.04);
}

.cc-name{
  font-size:15.5px;
  font-weight:700;
  letter-spacing:0;
  white-space:nowrap;
  overflow:hidden;
  text-overflow:ellipsis;
  max-width:155px;
}

.cc-pct{
  font-size:11px;
  color:var(--mut);
  margin-top:3px;
  font-weight:600;
  letter-spacing:0;
  font-variant-numeric:tabular-nums;
}

.cc-roll{
  font-size:10.5px;
  color:var(--mut);
  margin-top:1px;
  font-weight:700;
  letter-spacing:0;
  max-width:155px;
  white-space:nowrap;
  overflow:hidden;
  text-overflow:ellipsis;
}

.cc-r{
  text-align:right;
  flex-shrink:0;
}

.cc-spent{
  font-size:17px;
  font-weight:800;
  letter-spacing:0;
  font-variant-numeric:tabular-nums;
  font-feature-settings:"tnum","ss01";
}

.cc-budget{
  font-size:12px;
  color:var(--mut);
  margin-top:2px;
  font-weight:600;
  font-variant-numeric:tabular-nums;
  letter-spacing:0;
}

.bar-bg{
  height:6px;
  background:var(--dim);
  border-radius:99px;
  overflow:hidden;
  box-shadow:inset 0 0 0 .5px rgba(17,24,39,.02);
}

.bar-f{
  height:100%;
  border-radius:99px;
  transition:width .4s cubic-bezier(.4,0,.2,1);
}

.nav{
  display:flex;
  padding:8px 0 2px;
  border-top:.5px solid var(--bord);
  margin-top:auto;
  flex-shrink:0;
  gap:4px;
  background:rgba(255,255,255,.65);
  -webkit-backdrop-filter:saturate(180%) blur(20px);
  backdrop-filter:saturate(180%) blur(20px);
}

.nb{
  flex:1;
  display:flex;
  flex-direction:column;
  align-items:center;
  justify-content:center;
  gap:3px;
  padding:8px 0 7px;
  border:none;
  background:none;
  color:var(--mut);
  font-size:10.5px;
  font-weight:700;
  letter-spacing:0;
  cursor:pointer;
  -webkit-appearance:none;
  border-radius:14px;
  transition:background .2s,color .2s,transform .15s;
}

.nb.on{
  color:var(--acc);
  background:var(--acc2);
  font-weight:800;
}

.nb:active{
  transform:scale(.94);
  background:var(--acc2);
}

.ni{
  font-size:20px;
  line-height:1;
  opacity:.95;
}

.add-hdr{
  padding:9px 0 12px;
  display:flex;
  align-items:center;
  gap:10px;
  flex-shrink:0;
}

.back{
  width:32px;
  height:32px;
  border-radius:50%;
  background:var(--card);
  border:.5px solid var(--bord);
  display:flex;
  align-items:center;
  justify-content:center;
  font-size:20px;
  cursor:pointer;
  color:var(--txt);
  -webkit-appearance:none;
  flex-shrink:0;
  box-shadow:0 3px 10px rgba(17,24,39,.04);
}

.back:active{
  transform:scale(.94);
}

.add-ttl{
  font-size:20px;
  font-weight:850;
  flex:1;
  min-width:0;
}

.sec-row{
  display:flex;
  justify-content:space-between;
  align-items:center;
  margin-bottom:8px;
}

.sec-lbl{
  font-size:12px;
  font-weight:850;
  color:var(--mut);
  letter-spacing:0;
  margin-bottom:8px;
}

.sec-row .sec-lbl{
  margin-bottom:0;
}

.link-btn{
  border:none;
  background:none;
  color:var(--acc);
  font-size:12px;
  font-weight:900;
  letter-spacing:0;
  -webkit-appearance:none;
}

.gear-btn{
  width:34px;
  height:30px;
  border:.5px solid var(--bord);
  background:var(--card);
  color:var(--acc);
  border-radius:999px;
  font-size:15px;
  font-weight:900;
  -webkit-appearance:none;
  box-shadow:0 3px 10px rgba(17,24,39,.035);
}

.gear-btn:active{
  transform:scale(.95);
  opacity:.82;
}

.add-clean-hdr{
  padding-bottom:12px;
}

.preset-wrap{
  margin-bottom:12px;
  flex-shrink:0;
}

.preset-wrap.compact{
  margin-bottom:16px;
}

.presets{
  display:flex;
  gap:7px;
  overflow-x:auto;
  padding-bottom:2px;
  -webkit-overflow-scrolling:touch;
}

.preset-btn{
  flex-shrink:0;
  border:.5px solid var(--bord);
  background:var(--card);
  color:var(--txt);
  border-radius:13px;
  padding:8px 10px;
  font-size:12px;
  font-weight:850;
  display:flex;
  align-items:center;
  gap:6px;
  box-shadow:0 3px 10px rgba(17,24,39,.035);
  -webkit-appearance:none;
}

.preset-btn span{
  color:var(--mut);
  font-size:11px;
}

.preset-btn:active{
  transform:scale(.96);
  opacity:.85;
}

.cat-select-wrap{
  margin-bottom:14px;
  flex-shrink:0;
}

.selected-cat{
  width:100%;
  display:flex;
  align-items:center;
  gap:10px;
  background:var(--card);
  border:.5px solid var(--bord);
  border-radius:16px;
  padding:12px 13px;
  box-shadow:0 4px 14px rgba(17,24,39,.035);
  color:var(--txt);
  -webkit-appearance:none;
  text-align:left;
}

.selected-cat:active{
  transform:scale(.99);
  opacity:.82;
}

.selected-cat-icon{
  width:32px;
  height:32px;
  border-radius:10px;
  background:var(--card2);
  display:flex;
  align-items:center;
  justify-content:center;
  font-size:18px;
  flex-shrink:0;
}

.selected-cat-text{
  flex:1;
  min-width:0;
  font-size:17px;
  font-weight:900;
  white-space:nowrap;
  overflow:hidden;
  text-overflow:ellipsis;
}

.selected-cat-arrow{
  color:var(--mut);
  font-size:24px;
  font-weight:750;
  line-height:1;
  flex-shrink:0;
}

.cat-picker-list{
  display:flex;
  flex-direction:column;
  gap:8px;
  max-height:360px;
  overflow-y:auto;
  -webkit-overflow-scrolling:touch;
}

.cat-picker-item{
  width:100%;
  border:.5px solid var(--bord);
  background:var(--card);
  color:var(--txt);
  border-radius:15px;
  padding:11px 12px;
  display:flex;
  align-items:center;
  gap:10px;
  -webkit-appearance:none;
  text-align:left;
}

.cat-picker-item.sel{
  border-color:var(--sc);
  background:var(--sb);
  color:var(--sc);
}

.cat-picker-item:active{
  transform:scale(.99);
  opacity:.84;
}

.cat-picker-icon{
  width:32px;
  height:32px;
  border-radius:10px;
  background:var(--card2);
  display:flex;
  align-items:center;
  justify-content:center;
  font-size:18px;
  flex-shrink:0;
}

.cat-picker-name{
  flex:1;
  font-size:16px;
  font-weight:900;
  min-width:0;
  white-space:nowrap;
  overflow:hidden;
  text-overflow:ellipsis;
}

.cat-picker-budget{
  color:var(--mut);
  font-size:12px;
  font-weight:800;
  flex-shrink:0;
}

.pills{
  display:flex;
  flex-wrap:wrap;
  gap:6px;
  margin-bottom:14px;
  max-height:120px;
  overflow-y:auto;
  -webkit-overflow-scrolling:touch;
  flex-shrink:0;
}

.pill{
  display:flex;
  align-items:center;
  gap:5px;
  padding:7px 12px;
  border-radius:999px;
  background:var(--card);
  border:.5px solid var(--bord);
  font-size:14px;
  font-weight:750;
  color:var(--mut);
  cursor:pointer;
  -webkit-appearance:none;
  transition:all .15s;
  box-shadow:0 2px 8px rgba(17,24,39,.025);
}

.pill.sel{
  border-color:var(--sc);
  color:var(--sc);
  background:var(--sb);
}

.pill:active{
  transform:scale(.96);
}

.ig{
  margin-bottom:10px;
  flex-shrink:0;
}

.il{
  font-size:11.5px;
  font-weight:800;
  color:var(--mut);
  letter-spacing:0;
  margin-bottom:7px;
  text-transform:uppercase;
}

.ifield{
  width:100%;
  background:var(--card);
  border:.5px solid var(--bord);
  border-radius:14px;
  padding:13px 14px;
  font-size:16px;
  font-weight:600;
  color:var(--txt);
  -webkit-appearance:none;
  outline:none;
  font-family:inherit;
  transition:border-color .2s,box-shadow .2s,background .2s;
  box-shadow:var(--shadow-xs);
  font-variant-numeric:tabular-nums;
  letter-spacing:0;
}

.ifield:focus{
  border-color:var(--acc);
  box-shadow:var(--ring),var(--shadow-xs);
}

.ifield::placeholder{
  color:var(--soft);
  font-weight:500;
}

.emoji-mini{
  width:92px;
  min-width:92px;
  height:44px;
  padding:0 10px;
  text-align:center;
  font-size:15px;
  font-weight:850;
  line-height:44px;
  border-radius:14px;
  background:var(--card);
  box-shadow:0 3px 12px rgba(17,24,39,.025);
}

.emoji-mini:focus{
  border-color:var(--acc);
  box-shadow:0 0 0 3px rgba(124,58,237,.10);
}

.emoji-mini::placeholder{
  color:#9AA1B6;
  font-size:15px;
  font-weight:850;
}

.emoji-mini:not(:placeholder-shown){
  font-size:22px;
}

.sbtn{
  width:100%;
  padding:15px;
  border-radius:16px;
  border:none;
  background:var(--acc);
  color:#fff;
  font-size:15px;
  font-weight:800;
  letter-spacing:0;
  cursor:pointer;
  margin-top:3px;
  -webkit-appearance:none;
  font-family:inherit;
  flex-shrink:0;
  box-shadow:0 6px 18px rgba(124,58,237,.28),inset 0 1px 0 rgba(255,255,255,.18);
  transition:transform .15s cubic-bezier(.4,0,.2,1),box-shadow .2s,opacity .2s;
}

.sbtn:active{
  transform:scale(.985);
  box-shadow:0 3px 10px rgba(124,58,237,.22),inset 0 1px 0 rgba(255,255,255,.18);
}

.sbtn:disabled{
  opacity:.4;
  background:#B7C5C2;
  box-shadow:none;
  transform:none;
}

.log-list{
  flex:1;
  overflow-y:auto;
  -webkit-overflow-scrolling:touch;
}

.li{
  display:flex;
  align-items:center;
  padding:13px 2px;
  border-bottom:.5px solid var(--bord2);
  gap:11px;
  cursor:pointer;
  transition:opacity .18s,transform .18s;
}

.li:last-child{
  border-bottom:none;
}

.li:active{
  opacity:.65;
  transform:scale(.995);
}

.li-ico{
  width:38px;
  height:38px;
  border-radius:11px;
  display:flex;
  align-items:center;
  justify-content:center;
  font-size:19px;
  flex-shrink:0;
  box-shadow:inset 0 0 0 .5px rgba(17,24,39,.04);
}

.li-info{
  flex:1;
  min-width:0;
}

.li-desc{
  font-size:15.5px;
  font-weight:700;
  letter-spacing:0;
  white-space:nowrap;
  overflow:hidden;
  text-overflow:ellipsis;
}

.li-meta{
  font-size:12px;
  color:var(--mut);
  margin-top:3px;
  font-weight:600;
  letter-spacing:0;
}

.li-r{
  text-align:right;
  flex-shrink:0;
}

.li-amt{
  font-size:16.5px;
  font-weight:800;
  letter-spacing:0;
  font-variant-numeric:tabular-nums;
  font-feature-settings:"tnum","ss01";
}

.li-date{
  font-size:11.5px;
  color:var(--mut);
  margin-top:3px;
  font-weight:600;
  letter-spacing:0;
  font-variant-numeric:tabular-nums;
}

.delbtn{
  width:28px;
  height:28px;
  border-radius:50%;
  background:var(--red2);
  border:.5px solid #FECACA;
  color:var(--red);
  font-size:15px;
  font-weight:700;
  cursor:pointer;
  display:flex;
  align-items:center;
  justify-content:center;
  flex-shrink:0;
  -webkit-appearance:none;
  transition:transform .15s,background .2s;
}

.delbtn:active{
  transform:scale(.9);
  background:#FECACA;
}

.cat-screen-body{
  flex:1;
  overflow:hidden;
  display:flex;
  flex-direction:column;
}

.cat-form{
  background:var(--card);
  border:.5px solid var(--bord);
  border-radius:15px;
  padding:11px;
  margin-bottom:10px;
  flex-shrink:0;
  box-shadow:0 4px 14px rgba(17,24,39,.035);
}

.cat-row-inputs{
  display:grid;
  grid-template-columns:92px 1fr;
  gap:8px;
  margin-bottom:8px;
}

.cat-budget-wrap{
  margin-bottom:6px;
}

.cat-list{
  flex:1;
  overflow-y:auto;
  padding-bottom:8px;
  -webkit-overflow-scrolling:touch;
}

.cat-card{
  background:var(--card);
  border:.5px solid var(--bord);
  border-radius:14px;
  padding:10px 11px;
  margin-bottom:8px;
  box-shadow:0 4px 14px rgba(17,24,39,.03);
}

.cat-top{
  display:flex;
  align-items:center;
  gap:8px;
  margin-bottom:8px;
}

.cat-dot{
  width:10px;
  height:10px;
  border-radius:99px;
  flex-shrink:0;
}

.cat-title{
  font-size:15px;
  font-weight:850;
  flex:1;
  min-width:0;
  white-space:nowrap;
  overflow:hidden;
  text-overflow:ellipsis;
}

.cat-budget{
  font-size:13px;
  color:var(--mut);
  font-weight:750;
}

.cat-roll{
  font-size:11px;
  color:var(--mut);
  font-weight:800;
  margin:-3px 0 8px 18px;
  white-space:nowrap;
  overflow:hidden;
  text-overflow:ellipsis;
}

.cat-actions{
  display:flex;
  gap:6px;
  align-items:center;
}

.mini-in{
  flex:1;
  background:var(--card2);
  border:.5px solid var(--bord);
  border-radius:12px;
  padding:9px 10px;
  font-size:13px;
  font-weight:800;
  color:var(--txt);
  outline:none;
  -webkit-appearance:none;
  min-width:0;
}

.mini-in:focus{
  border-color:var(--acc);
}

.mini-save{
  display:none;
  border:none;
  border-radius:12px;
  padding:9px 10px;
  background:var(--acc);
  color:white;
  font-weight:850;
  font-size:13px;
  -webkit-appearance:none;
}

.mini-save.show{
  display:block;
}

.mini-del{
  border:.5px solid #FFE4E6;
  border-radius:12px;
  padding:9px 10px;
  background:#FFF1F2;
  color:var(--red);
  font-weight:850;
  font-size:13px;
  -webkit-appearance:none;
}

.preset-screen-body{
  flex:1;
  overflow:hidden;
  display:flex;
  flex-direction:column;
}

.preset-form{
  background:var(--card);
  border:.5px solid var(--bord);
  border-radius:15px;
  padding:11px;
  margin-bottom:10px;
  flex-shrink:0;
  box-shadow:0 4px 14px rgba(17,24,39,.035);
}

.preset-row-inputs{
  display:grid;
  grid-template-columns:92px 1fr;
  gap:8px;
  margin-bottom:8px;
}

.preset-cats{
  display:flex;
  flex-wrap:wrap;
  gap:6px;
  max-height:92px;
  overflow-y:auto;
  margin-bottom:10px;
  -webkit-overflow-scrolling:touch;
}

.preset-cat-pill{
  display:flex;
  align-items:center;
  gap:5px;
  padding:7px 11px;
  border-radius:999px;
  background:var(--card2);
  border:.5px solid var(--bord);
  font-size:13px;
  font-weight:800;
  color:var(--mut);
  -webkit-appearance:none;
}

.preset-cat-pill.sel{
  background:var(--sb);
  color:var(--sc);
  border-color:var(--sc);
}

.preset-list{
  flex:1;
  overflow-y:auto;
  padding-bottom:8px;
  -webkit-overflow-scrolling:touch;
}

.preset-card{
  background:var(--card);
  border:.5px solid var(--bord);
  border-radius:14px;
  padding:10px 11px;
  margin-bottom:8px;
  box-shadow:0 4px 14px rgba(17,24,39,.03);
  display:flex;
  align-items:center;
  gap:10px;
}

.preset-card-icon{
  width:34px;
  height:34px;
  border-radius:10px;
  background:var(--card2);
  display:flex;
  align-items:center;
  justify-content:center;
  font-size:18px;
  flex-shrink:0;
}

.preset-card-info{
  flex:1;
  min-width:0;
}

.preset-card-title{
  font-size:15px;
  font-weight:850;
  white-space:nowrap;
  overflow:hidden;
  text-overflow:ellipsis;
}

.preset-card-meta{
  font-size:12px;
  color:var(--mut);
  margin-top:2px;
  font-weight:700;
}

.preset-card-del{
  border:.5px solid #FFE4E6;
  border-radius:12px;
  padding:9px 10px;
  background:#FFF1F2;
  color:var(--red);
  font-weight:850;
  font-size:13px;
  -webkit-appearance:none;
}

.wish-actions{
  display:flex;
  flex-direction:column;
  gap:6px;
  flex-shrink:0;
}

.wish-buy{
  border:none;
  border-radius:12px;
  padding:9px 10px;
  background:var(--grn);
  color:white;
  font-weight:850;
  font-size:13px;
  -webkit-appearance:none;
}

.wish-edit{
  border:.5px solid var(--bord);
  border-radius:12px;
  padding:9px 10px;
  background:var(--card2);
  color:var(--acc);
  font-weight:850;
  font-size:13px;
  -webkit-appearance:none;
}

.wish-del{
  border:.5px solid #FFE4E6;
  border-radius:12px;
  padding:9px 10px;
  background:#FFF1F2;
  color:var(--red);
  font-weight:850;
  font-size:13px;
  -webkit-appearance:none;
}

.empty{
  flex:1;
  min-height:180px;
  display:flex;
  flex-direction:column;
  align-items:center;
  justify-content:center;
  gap:7px;
  color:var(--mut);
  text-align:center;
}

.empty-i{
  font-size:34px;
}

.empty-t{
  font-size:15px;
  font-weight:750;
}

.modal{
  position:fixed;
  inset:0;
  background:rgba(17,24,39,.38);
  display:none;
  align-items:flex-end;
  justify-content:center;
  z-index:50;
  padding:14px;
}

.modal.show{
  display:flex;
}

.sheet{
  width:100%;
  background:var(--card);
  border-radius:22px;
  padding:16px;
  box-shadow:0 18px 40px rgba(17,24,39,.22);
  border:.5px solid rgba(255,255,255,.35);
}

.sheet-top{
  display:flex;
  align-items:center;
  justify-content:space-between;
  gap:10px;
  margin-bottom:14px;
}

.sheet-title{
  font-size:19px;
  font-weight:900;
  letter-spacing:0;
}

.sheet-close{
  width:32px;
  height:32px;
  border-radius:50%;
  border:.5px solid var(--bord);
  background:var(--card2);
  color:var(--txt);
  font-size:19px;
  font-weight:850;
  -webkit-appearance:none;
}

.edit-cats{
  display:flex;
  flex-wrap:wrap;
  gap:6px;
  margin-bottom:12px;
  max-height:108px;
  overflow-y:auto;
  -webkit-overflow-scrolling:touch;
}

.edit-pill{
  display:flex;
  align-items:center;
  gap:5px;
  padding:7px 11px;
  border-radius:999px;
  background:var(--card2);
  border:.5px solid var(--bord);
  font-size:13px;
  font-weight:800;
  color:var(--mut);
  -webkit-appearance:none;
}

.edit-pill.sel{
  background:var(--sb);
  color:var(--sc);
  border-color:var(--sc);
}

.sheet-actions{
  display:grid;
  grid-template-columns:1fr 1fr;
  gap:8px;
  margin-top:6px;
}

.sheet-save{
  border:none;
  border-radius:14px;
  padding:13px;
  background:var(--acc);
  color:white;
  font-weight:900;
  font-size:15px;
  -webkit-appearance:none;
}

.sheet-preset{
  border:.5px solid var(--bord);
  border-radius:14px;
  padding:13px;
  background:var(--card2);
  color:var(--acc);
  font-weight:900;
  font-size:15px;
  -webkit-appearance:none;
  margin-top:8px;
  width:100%;
}

.sheet-delete{
  border:.5px solid #FFE4E6;
  border-radius:14px;
  padding:13px;
  background:#FFF1F2;
  color:var(--red);
  font-weight:900;
  font-size:15px;
  -webkit-appearance:none;
}

.toast{
  position:fixed;
  bottom:86px;
  left:50%;
  transform:translateX(-50%) translateY(16px);
  background:#111827;
  color:#FFFFFF;
  padding:10px 16px;
  border-radius:999px;
  font-size:14px;
  font-weight:800;
  opacity:0;
  transition:all .25s;
  pointer-events:none;
  white-space:nowrap;
  border:.5px solid rgba(255,255,255,.12);
  z-index:80;
  box-shadow:0 10px 24px rgba(17,24,39,.18);
}

.toast.show{
  opacity:1;
  transform:translateX(-50%) translateY(0);
}

/* Product polish pass */
body{
  background:var(--bg);
  letter-spacing:0;
}

button,
input{
  font:inherit;
  letter-spacing:0;
}

button{
  touch-action:manipulation;
  outline:none;
}

button:focus-visible{
  box-shadow:var(--ring),var(--shadow-xs);
}

.screen{
  width:min(100%,460px);
  margin:0 auto;
  padding:0 16px;
}

.hdr,
.add-hdr{
  padding:10px 0 8px;
}

.hdr-left{
  display:flex;
  flex-direction:column;
  gap:2px;
}

.hdr-t{
  color:var(--txt);
  font-size:18px;
  font-weight:850;
  line-height:1.1;
  text-transform:none;
}

.hdr-m{
  color:var(--mut);
  font-size:12px;
  font-weight:700;
  text-transform:none;
}

.hdr-actions{
  gap:8px;
}

.top-btn,
.gear-btn,
.back,
.sheet-close{
  min-width:38px;
  height:38px;
  border-radius:999px;
  border:.5px solid var(--bord);
  background:rgba(255,255,255,.92);
  color:var(--txt);
  box-shadow:var(--shadow-xs);
}

.top-btn{
  display:inline-flex;
  align-items:center;
  justify-content:center;
  padding:0 12px;
  font-size:12px;
  font-weight:800;
}

.icon-btn{
  width:38px;
  padding:0;
  font-size:18px;
  line-height:1;
}

.top-btn:active,
.gear-btn:active,
.back:active,
.sheet-close:active{
  transform:scale(.96);
  background:var(--acc2);
}

.hero{
  padding:12px 0 13px;
}

.hero-lbl{
  color:var(--mut);
  font-size:12px;
  font-weight:800;
  margin-bottom:5px;
  text-transform:none;
}

.hero-amt{
  font-size:48px;
  line-height:.98;
  font-weight:850;
  color:var(--txt);
}

.hero-sub{
  margin-top:7px;
  font-size:13px;
  line-height:1.35;
  color:var(--mut);
}

.hero-health{
  margin-top:9px;
  display:inline-flex;
  align-items:center;
  min-height:28px;
  padding:6px 9px;
  border:.5px solid var(--bord);
  border-radius:999px;
  background:var(--card);
  white-space:normal;
  overflow:visible;
  text-overflow:clip;
  font-size:12px;
  font-weight:800;
}

.home-kpis{
  display:grid;
  grid-template-columns:repeat(3,minmax(0,1fr));
  gap:8px;
  margin-top:12px;
}

.kpi{
  min-width:0;
  min-height:64px;
  border:.5px solid var(--bord);
  border-radius:var(--r);
  background:var(--card);
  padding:9px 9px 8px;
  box-shadow:var(--shadow-xs);
}

.kpi-label{
  color:var(--mut);
  font-size:11px;
  font-weight:750;
  line-height:1.15;
}

.kpi-value{
  margin-top:5px;
  color:var(--txt);
  font-size:15px;
  font-weight:850;
  line-height:1.15;
  white-space:nowrap;
  overflow:hidden;
  text-overflow:ellipsis;
}

.gbar{
  height:8px;
  margin-bottom:12px;
  border-radius:var(--r);
  background:var(--dim);
}

.gbar-f,
.bar-f{
  border-radius:var(--r);
}

.cats,
.log-list,
.cat-list,
.preset-list,
.cat-picker-list{
  scrollbar-width:none;
}

.cats::-webkit-scrollbar,
.log-list::-webkit-scrollbar,
.cat-list::-webkit-scrollbar,
.preset-list::-webkit-scrollbar,
.cat-picker-list::-webkit-scrollbar,
.presets::-webkit-scrollbar,
.pills::-webkit-scrollbar,
.preset-cats::-webkit-scrollbar,
.edit-cats::-webkit-scrollbar{
  display:none;
}

.cats{
  gap:8px;
  padding-bottom:10px;
}

.cc{
  position:relative;
  overflow:hidden;
  border-radius:var(--r);
  padding:12px;
  background:var(--card);
  border:.5px solid var(--bord);
  box-shadow:var(--shadow-sm);
}

.cc::before{
  content:"";
  position:absolute;
  left:0;
  top:0;
  bottom:0;
  width:3px;
  background:var(--cat,var(--acc));
}

.cc-top{
  align-items:flex-start;
  margin-bottom:11px;
}

.cc-l{
  gap:10px;
}

.cc-icon{
  width:38px;
  height:38px;
  border-radius:var(--r);
  background:var(--cat-soft,var(--card2));
  color:var(--cat,var(--txt));
  box-shadow:none;
}

.cc-name{
  max-width:100%;
  font-size:15px;
  font-weight:850;
}

.cc-pct,
.cc-roll,
.cc-budget{
  color:var(--mut);
  font-size:12px;
  font-weight:700;
}

.cc-roll{
  max-width:none;
  margin-top:7px;
}

.cc-r{
  max-width:128px;
}

.cc-spent{
  font-size:17px;
  font-weight:850;
}

.cc-remaining{
  margin-top:2px;
  color:var(--mut);
  font-size:12px;
  font-weight:750;
  white-space:nowrap;
}

.cc-progress{
  display:grid;
  grid-template-columns:1fr auto;
  align-items:center;
  gap:9px;
}

.bar-bg{
  height:7px;
  background:var(--dim);
  border-radius:var(--r);
}

.cc-pct-badge{
  min-width:43px;
  text-align:right;
  color:var(--mut);
  font-size:11px;
  font-weight:850;
}

.nav{
  gap:7px;
  padding:8px 0 0;
  border-top:none;
  background:transparent;
  backdrop-filter:none;
  -webkit-backdrop-filter:none;
}

.nb{
  height:51px;
  border:.5px solid var(--bord);
  border-radius:var(--r);
  background:var(--card);
  color:var(--mut);
  box-shadow:var(--shadow-xs);
  font-size:10.5px;
  font-weight:800;
}

.nb.on{
  background:var(--acc2);
  border-color:#9AD8CF;
  color:var(--txt);
}

.ni{
  font-size:17px;
}

.add-ttl{
  font-size:22px;
  font-weight:850;
}

.sec-row{
  margin-bottom:9px;
}

.sec-lbl,
.il{
  color:var(--mut);
  font-size:12px;
  font-weight:850;
  text-transform:none;
}

.link-btn{
  color:var(--acc);
  font-size:12px;
}

.preset-wrap{
  margin-bottom:14px;
}

.presets{
  gap:8px;
}

.preset-btn{
  min-height:42px;
  border-radius:var(--r);
  background:var(--card);
  border:.5px solid var(--bord);
  color:var(--txt);
  padding:8px 10px;
  box-shadow:var(--shadow-xs);
  max-width:210px;
}

.preset-btn .preset-emoji{
  width:25px;
  height:25px;
  display:inline-flex;
  align-items:center;
  justify-content:center;
  border-radius:7px;
  background:var(--cat-soft,var(--card2));
  color:var(--cat,var(--txt));
  flex-shrink:0;
}

.preset-copy{
  min-width:0;
  overflow:hidden;
  text-overflow:ellipsis;
  white-space:nowrap;
}

.preset-amt{
  color:var(--mut);
  font-size:11px;
  font-weight:850;
  flex-shrink:0;
}

.selected-cat,
.cat-picker-item,
.ifield,
.mini-in{
  border-radius:var(--r);
  border:.5px solid var(--bord);
  background:var(--card);
  box-shadow:var(--shadow-xs);
}

.selected-cat{
  min-height:58px;
  padding:11px 12px;
}

.selected-cat-icon,
.cat-picker-icon,
.li-ico,
.preset-card-icon{
  border-radius:var(--r);
}

.selected-cat-text{
  font-size:16px;
  font-weight:850;
}

.cat-picker-list{
  gap:7px;
  max-height:min(430px,62vh);
}

.cat-picker-item{
  min-height:55px;
}

.cat-picker-name{
  font-size:15px;
}

.pills,
.preset-cats,
.edit-cats{
  gap:7px;
}

.pill,
.preset-cat-pill,
.edit-pill{
  border-radius:999px;
  border:.5px solid var(--bord);
  background:var(--card);
  box-shadow:var(--shadow-xs);
}

.ifield{
  min-height:48px;
  padding:12px 13px;
  font-size:16px;
}

.emoji-mini{
  width:84px;
  min-width:84px;
}

.sbtn,
.sheet-save,
.sheet-preset,
.sheet-delete,
.mini-save,
.mini-del,
.preset-card-del,
.wish-buy,
.wish-edit,
.wish-del{
  border-radius:var(--r);
}

.sbtn{
  min-height:50px;
  background:var(--acc);
  box-shadow:0 8px 18px rgba(15,118,110,.22);
}

.sbtn:disabled{
  background:#B7C5C2;
}

.cat-form,
.preset-form,
.cat-card,
.preset-card,
.sheet{
  border-radius:var(--r);
  border:.5px solid var(--bord);
  box-shadow:var(--shadow-sm);
}

.cat-form,
.preset-form{
  padding:12px;
}

.cat-card,
.preset-card{
  padding:11px 12px;
}

.cat-top{
  gap:9px;
}

.cat-dot{
  width:8px;
  height:22px;
  border-radius:999px;
}

.cat-title{
  font-size:15px;
  display:flex;
  align-items:center;
  gap:6px;
}

.cat-title-icon{
  width:20px;
  min-width:20px;
  text-align:center;
}

.cat-title-text{
  min-width:0;
  overflow:hidden;
  text-overflow:ellipsis;
  white-space:nowrap;
}

.cat-actions{
  gap:7px;
}

.mini-in{
  min-height:40px;
}

.log-list{
  padding-bottom:10px;
}

.li{
  min-height:62px;
  padding:11px 0;
  gap:10px;
}

.li-desc{
  font-size:15px;
  font-weight:800;
}

.li-amt{
  color:var(--txt);
  font-size:16px;
}

.delbtn{
  width:30px;
  height:30px;
  border-radius:999px;
}

.modal{
  padding:12px 12px max(12px,env(safe-area-inset-bottom,12px));
  background:rgba(15,23,42,.42);
}

.sheet{
  max-width:430px;
  max-height:86vh;
  overflow-y:auto;
  padding:16px;
}

.sheet-title{
  font-size:18px;
}

.empty{
  min-height:170px;
}

.toast{
  max-width:calc(100vw - 36px);
  overflow:hidden;
  text-overflow:ellipsis;
}

@media (max-height:680px){
  .hero-amt{
    font-size:42px;
  }

  .home-kpis{
    margin-top:9px;
  }

  .kpi{
    min-height:58px;
    padding:8px;
  }

  .preset-wrap.compact{
    margin-bottom:11px;
  }
}

@media (prefers-reduced-motion:reduce){
  *,
  *::before,
  *::after{
    transition:none!important;
    animation:none!important;
  }
}
</style>
</head>

<body>

<!-- HOME -->
<div class="screen on" id="s-home">
  <div class="hdr">
    <div class="hdr-left">
      <div class="hdr-t">Presupuesto</div>
      <div class="hdr-m">${mesLabel}</div>
    </div>
    <div class="hdr-actions">
      <button class="top-btn icon-btn" title="Wishlist" aria-label="Wishlist" onclick="go('wishes')">♡</button>
      <button class="top-btn icon-btn" title="Categorías" aria-label="Categorías" onclick="go('cats')">◎</button>
    </div>
  </div>

  <div class="hero">
    <div class="hero-lbl" id="hero-lbl">Disponible</div>
    <div class="hero-amt" id="hero-amt">$0</div>
    <div class="hero-sub" id="hero-sub"></div>
    <div class="hero-health" id="hero-health"></div>

    <div class="home-kpis">
      <div class="kpi">
        <div class="kpi-label">Gastado</div>
        <div class="kpi-value tnum" id="kpi-spent">$0.00</div>
      </div>
      <div class="kpi">
        <div class="kpi-label">Límite</div>
        <div class="kpi-value tnum" id="kpi-budget">$0.00</div>
      </div>
      <div class="kpi">
        <div class="kpi-label">Uso</div>
        <div class="kpi-value tnum" id="kpi-use">0%</div>
      </div>
    </div>
  </div>

  <div class="gbar">
    <div class="gbar-f" id="gbar-f" style="width:0%"></div>
  </div>

  <div class="cats" id="cats"></div>

  <div class="nav">
    <button class="nb on" data-tab="home" onclick="go('home')"><span class="ni">◉</span>Resumen</button>
    <button class="nb" data-tab="add" onclick="go('add')"><span class="ni">＋</span>Gasto</button>
    <button class="nb" data-tab="log" onclick="go('log')"><span class="ni">≡</span>Historial</button>
  </div>
</div>

<!-- ADD -->
<div class="screen" id="s-add">
  <div class="hdr add-clean-hdr">
    <div class="hdr-left">
      <div class="hdr-t">Nuevo gasto</div>
      <div class="hdr-m">Agregar movimiento</div>
    </div>
  </div>

  <div class="preset-wrap compact">
    <div class="sec-row">
      <div class="sec-lbl">Presets rápidos</div>
      <button class="gear-btn" onclick="go('presets')">⚙</button>
    </div>
    <div class="presets" id="presets"></div>
  </div>

  <div class="cat-select-wrap">
    <div class="sec-row">
      <div class="sec-lbl">Categoría</div>
      <button class="link-btn" onclick="openCatPicker()">Cambiar</button>
    </div>

    <button class="selected-cat" id="selected-cat" onclick="openCatPicker()">
      <span class="selected-cat-icon">＋</span>
      <span class="selected-cat-text">Elige una categoría</span>
      <span class="selected-cat-arrow">›</span>
    </button>
  </div>

  <div class="ig">
    <div class="il">Monto</div>
    <input class="ifield" id="in-amt" type="number" inputmode="decimal" placeholder="$0.00" oninput="chk()">
  </div>

  <div class="ig">
    <div class="il">Descripción</div>
    <input class="ifield" id="in-desc" type="text" placeholder="ej. Starbucks">
  </div>

  <button class="sbtn" id="sbtn" onclick="doSave()" disabled>Guardar gasto</button>

  <div class="nav">
    <button class="nb" data-tab="home" onclick="go('home')"><span class="ni">◉</span>Resumen</button>
    <button class="nb on" data-tab="add" onclick="go('add')"><span class="ni">＋</span>Gasto</button>
    <button class="nb" data-tab="log" onclick="go('log')"><span class="ni">≡</span>Historial</button>
  </div>
</div>

<!-- CATEGORIES -->
<div class="screen" id="s-cats">
  <div class="add-hdr">
    <button class="back" onclick="go('home')">‹</button>
    <span class="add-ttl">Categorías</span>
    <button class="top-btn" onclick="openBackup()">Datos</button>
  </div>

  <div class="cat-screen-body">
    <div class="cat-form">
      <div class="sec-lbl">Nueva categoría</div>

      <div class="cat-row-inputs">
        <input class="ifield emoji-mini" id="cat-icon" type="text" maxlength="2" placeholder="Emoji" oninput="chkCat()">
        <input class="ifield" id="cat-label" type="text" placeholder="Nombre" oninput="chkCat()">
      </div>

      <div class="cat-budget-wrap">
        <input class="ifield" id="cat-budget" type="number" inputmode="decimal" placeholder="Límite mensual base" oninput="chkCat()">
      </div>

      <button class="sbtn" id="cat-btn" onclick="addCategory()" disabled>Agregar</button>
    </div>

    <div class="cat-list" id="cat-list"></div>
  </div>
</div>

<!-- BACKUP MODAL -->
<div class="modal" id="backup-modal">
  <div class="sheet">
    <div class="sheet-top">
      <div class="sheet-title">Datos y respaldo</div>
      <button class="sheet-close" onclick="closeBackup()">×</button>
    </div>

    <div id="backup-status" style="font-size:12px;color:var(--mut);font-weight:650;margin:0 0 14px">Cargando…</div>

    <button class="sheet-preset" style="margin-top:0;margin-bottom:8px" onclick="doExportJSON()">Exportar JSON completo</button>
    <button class="sheet-preset" style="margin-top:0;margin-bottom:8px" onclick="doExportCSV()">Exportar CSV (mes actual)</button>
    <button class="sheet-delete" style="width:100%;margin-top:6px" onclick="doImportJSON()">Importar JSON</button>
  </div>
</div>

<!-- PRESETS MANAGER -->
<div class="screen" id="s-presets">
  <div class="add-hdr">
    <button class="back" onclick="go('add')">‹</button>
    <span class="add-ttl">Presets</span>
  </div>

  <div class="preset-screen-body">
    <div class="preset-form">
      <div class="sec-lbl">Nuevo preset</div>

      <div class="preset-row-inputs">
        <input class="ifield emoji-mini" id="preset-icon" type="text" maxlength="2" placeholder="Emoji" oninput="chkPreset()">
        <input class="ifield" id="preset-desc" type="text" placeholder="Nombre / descripción" oninput="chkPreset()">
      </div>

      <div class="ig">
        <input class="ifield" id="preset-amt" type="number" inputmode="decimal" placeholder="Monto" oninput="chkPreset()">
      </div>

      <div class="il">Categoría</div>
      <div class="preset-cats" id="preset-cats"></div>

      <button class="sbtn" id="preset-btn" onclick="addPreset()" disabled>Guardar preset</button>
    </div>

    <div class="preset-list" id="preset-list"></div>
  </div>
</div>

<!-- WISHLIST MANAGER -->
<div class="screen" id="s-wishes">
  <div class="add-hdr">
    <button class="back" onclick="go('home')">‹</button>
    <span class="add-ttl">Wishlist</span>
  </div>

  <div class="preset-screen-body">
    <div class="preset-form">
      <div class="sec-lbl">Nuevo deseo</div>

      <div class="preset-row-inputs">
        <input class="ifield emoji-mini" id="wish-icon" type="text" maxlength="2" placeholder="Emoji" oninput="chkWish()">
        <input class="ifield" id="wish-desc" type="text" placeholder="Qué quieres comprar" oninput="chkWish()">
      </div>

      <div class="ig">
        <input class="ifield" id="wish-amt" type="number" inputmode="decimal" placeholder="Monto estimado" oninput="chkWish()">
      </div>

      <div class="il">Categoría al comprar</div>
      <div class="preset-cats" id="wish-cats"></div>

      <button class="sbtn" id="wish-btn" onclick="addWish()" disabled>Guardar deseo</button>
    </div>

    <div class="preset-list" id="wish-list"></div>
  </div>
</div>

<!-- LOG -->
<div class="screen" id="s-log">
  <div class="hdr">
    <div class="hdr-left">
      <div class="hdr-t">Historial</div>
      <div class="hdr-m">Toca un gasto para editar</div>
    </div>
    <button class="top-btn icon-btn" title="Categorías" aria-label="Categorías" onclick="go('cats')">◎</button>
  </div>

  <div class="log-list" id="log-list"></div>

  <div class="nav">
    <button class="nb" data-tab="home" onclick="go('home')"><span class="ni">◉</span>Resumen</button>
    <button class="nb" data-tab="add" onclick="go('add')"><span class="ni">＋</span>Gasto</button>
    <button class="nb on" data-tab="log" onclick="go('log')"><span class="ni">≡</span>Historial</button>
  </div>
</div>

<!-- EDIT MODAL -->
<div class="modal" id="edit-modal">
  <div class="sheet">
    <div class="sheet-top">
      <div class="sheet-title">Editar gasto</div>
      <button class="sheet-close" onclick="closeEdit()">×</button>
    </div>

    <div class="ig">
      <div class="il">Descripción</div>
      <input class="ifield" id="edit-desc" type="text" placeholder="Descripción">
    </div>

    <div class="ig">
      <div class="il">Monto</div>
      <input class="ifield" id="edit-amt" type="number" inputmode="decimal" placeholder="$0.00">
    </div>

    <div class="il">Categoría</div>
    <div class="edit-cats" id="edit-cats"></div>

    <div class="sheet-actions">
      <button class="sheet-delete" onclick="deleteEditingEntry()">Borrar</button>
      <button class="sheet-save" onclick="saveEditingEntry()">Guardar</button>
    </div>

    <button class="sheet-preset" onclick="saveEditingAsPreset()">Guardar como preset</button>
  </div>
</div>

<!-- WISH EDIT MODAL -->
<div class="modal" id="wish-edit-modal">
  <div class="sheet">
    <div class="sheet-top">
      <div class="sheet-title">Editar deseo</div>
      <button class="sheet-close" onclick="closeWishEdit()">×</button>
    </div>

    <div class="preset-row-inputs">
      <input class="ifield emoji-mini" id="wish-edit-icon" type="text" maxlength="2" placeholder="Emoji">
      <input class="ifield" id="wish-edit-desc" type="text" placeholder="Qué quieres comprar">
    </div>

    <div class="ig">
      <div class="il">Monto estimado</div>
      <input class="ifield" id="wish-edit-amt" type="number" inputmode="decimal" placeholder="$0.00">
    </div>

    <div class="il">Categoría al comprar</div>
    <div class="edit-cats" id="wish-edit-cats"></div>

    <div class="sheet-actions">
      <button class="sheet-delete" onclick="deleteEditingWish()">Borrar</button>
      <button class="sheet-save" onclick="saveEditingWish()">Guardar</button>
    </div>

    <button class="sheet-preset" onclick="buyEditingWish()">Comprar ahora</button>
  </div>
</div>

<!-- CATEGORY PICKER MODAL -->
<div class="modal" id="cat-picker-modal">
  <div class="sheet">
    <div class="sheet-top">
      <div class="sheet-title">Cambiar categoría</div>
      <button class="sheet-close" onclick="closeCatPicker()">×</button>
    </div>

    <div class="cat-picker-list" id="cat-picker-list"></div>
  </div>
</div>

<div class="toast" id="toast"></div>

<script>
window._q = []

function send(obj) {
  window._q.push(obj)
}

let ST = ${sj}
let selCat = null
let editingId = null
let editingCat = null
let editingWishId = null
let editingWishCat = null
let newPresetCat = null
let newWishCat = null

function updateState(s) {
  ST = s
  renderHome()
  renderPresets()
  renderPills()
  renderCategories()
  renderLog()
  renderPresetManager()
  renderWishlistManager()
  renderWishEditCats()
  chk()
  chkCat()
  chkPreset()
  chkWish()
}

let BK = { lastICloudBackup: 0, icloudAvailable: false }

function updateBackupStatus(s) {
  if (s && typeof s === 'object') BK = s
  renderBackupStatus()
}

function fmtAgo(ts) {
  const t = Number(ts) || 0
  if (!t) return 'aún sin respaldo'
  const ms = Date.now() - t
  if (ms < 0) return 'recién'
  const sec = Math.floor(ms / 1000)
  if (sec < 60) return 'hace pocos segundos'
  const min = Math.floor(sec / 60)
  if (min < 60) return 'hace ' + min + ' min'
  const hr = Math.floor(min / 60)
  if (hr < 24) return 'hace ' + hr + ' h'
  const d = Math.floor(hr / 24)
  return 'hace ' + d + ' d'
}

function renderBackupStatus() {
  const el = document.getElementById('backup-status')
  if (!el) return
  if (!BK.icloudAvailable) {
    el.textContent = 'iCloud no disponible · respaldo solo local'
    return
  }
  el.textContent = 'iCloud · último respaldo ' + fmtAgo(BK.lastICloudBackup)
}

function doExportJSON() {
  send({ type: 'exportJSON' })
  toast('Preparando export…')
}

function doExportCSV() {
  send({ type: 'exportCSV' })
  toast('Preparando CSV…')
}

function doImportJSON() {
  send({ type: 'importJSON' })
  closeBackup()
}

function openBackup() {
  send({ type: 'getBackupStatus' })
  const m = document.getElementById('backup-modal')
  if (m) m.classList.add('show')
}

function closeBackup() {
  const m = document.getElementById('backup-modal')
  if (m) m.classList.remove('show')
}

function fmt(n) {
  return '$' + (Number(n) || 0).toFixed(2)
}

function money0(n) {
  return '$' + Math.round(Number(n) || 0)
}

function esc(v) {
  const s = v === undefined || v === null ? '' : String(v)

  return s.replace(/[&<>'"]/g, c => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    "'": '&#39;',
    '"': '&quot;'
  }[c]))
}

function cssColor(v) {
  return /^#[0-9A-Fa-f]{6}$/.test(String(v || '')) ? v : '#0F766E'
}

function baseBudgetOf(b) {
  if (!b) return 0
  return Number(b.baseBudget ?? b.budget) || 0
}

function effectiveBudgetOf(b) {
  if (!b) return 0
  return Number(b.budget) || 0
}

function rolloverOf(b) {
  if (!b) return 0
  return Number(b.rollover) || 0
}

function rolloverLabel(b) {
  const r = rolloverOf(b)

  if (Math.abs(r) < 0.01) return ''

  return 'Rollover ' + (r > 0 ? '+' : '-') + fmt(Math.abs(r))
}

function hslToHexClient(h, s, l) {
  s /= 100
  l /= 100

  const k = n => (n + h / 30) % 12
  const a = s * Math.min(l, 1 - l)
  const f = n => {
    const color = l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)))
    return Math.round(255 * color)
      .toString(16)
      .padStart(2, '0')
  }

  return ('#' + f(0) + f(8) + f(4)).toUpperCase()
}

function generatedClientCategoryColor(index) {
  const i = Math.max(0, Number(index) || 0)
  const hue = (i * 137.508) % 360
  const saturation = 68 + ((i * 17) % 18)
  const lightness = 46 + ((i * 11) % 10)

  return hslToHexClient(hue, saturation, lightness)
}

function nextClientCategoryColor() {
  const used = (ST.budgets || []).map(b => String(b.color || '').toUpperCase())
  let i = (ST.budgets || []).length

  for (let attempts = 0; attempts < 500; attempts++) {
    const color = generatedClientCategoryColor(i + attempts)

    if (!used.includes(color.toUpperCase())) {
      return color
    }
  }

  return generatedClientCategoryColor(Date.now() % 100000)
}

function catById(id) {
  return ST.budgets.find(x => x.id === id)
}

function entryById(id) {
  return (ST.entries || []).find(x => Number(x.id) === Number(id))
}

function presetById(id) {
  return (ST.presets || []).find(x => x.id === id)
}

function wishById(id) {
  return (ST.wishes || []).find(x => x.id === id)
}

function makeClientCatId(label) {
  let base = String(label || "cat")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\\u0300-\\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")

  if (!base) base = "cat"

  let id = base
  let n = 2

  while (ST.budgets.some(b => b.id === id)) {
    id = base + "_" + n
    n++
  }

  return id
}

function makeClientPresetId(desc) {
  let base = String(desc || "preset")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\\u0300-\\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")

  if (!base) base = "preset"
  if (!base.startsWith("preset_")) base = "preset_" + base

  let id = base
  let n = 2

  while ((ST.presets || []).some(p => p.id === id)) {
    id = base + "_" + n
    n++
  }

  return id
}

function makeClientWishId(desc) {
  let base = String(desc || "wish")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\\u0300-\\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")

  if (!base) base = "wish"
  if (!base.startsWith("wish_")) base = "wish_" + base

  let id = base
  let n = 2

  while ((ST.wishes || []).some(w => w.id === id)) {
    id = base + "_" + n
    n++
  }

  return id
}

function recalcSpent() {
  const sp = {}

  ST.budgets.forEach(b => {
    sp[b.id] = 0
  })

  ;(ST.entries || []).forEach(e => {
    const cat = e.cat || "uncategorized"
    sp[cat] = (sp[cat] || 0) + (Number(e.amt) || 0)
  })

  ST.spent = sp
}

function getBudgetHealth(tb, ts, left, sp) {
  const entries = ST.entries || []

  if (!entries.length || ts <= 0) {
    const totalRoll = ST.budgets.reduce((sum, b) => sum + rolloverOf(b), 0)

    if (Math.abs(totalRoll) >= 0.01) {
      return {
        text: totalRoll > 0 ? 'Sobrante aplicado de meses anteriores' : 'Ajuste aplicado por exceso anterior',
        color: totalRoll > 0 ? 'var(--grn)' : 'var(--red)',
        bg: totalRoll > 0 ? '#ECFDF5' : '#FFF1F2',
        border: totalRoll > 0 ? '#A7F3D0' : '#FCA5A5'
      }
    }

    return {
      text: 'Todavía no hay gastos este mes',
      color: 'var(--mut)',
      bg: 'var(--card)',
      border: 'var(--bord)'
    }
  }

  const cats = ST.budgets
    .map(b => {
      const spent = Number(sp[b.id]) || 0
      const budget = effectiveBudgetOf(b)

      return {
        label: b.label,
        icon: b.icon,
        color: cssColor(b.color),
        spent,
        budget,
        over: spent - budget,
        pct: budget > 0 ? (spent / budget) * 100 : 999
      }
    })
    .filter(x => x.budget !== 0 || x.spent > 0)

  const worstOver = cats
    .filter(x => x.over > 0)
    .sort((a, b) => b.over - a.over)[0]

  if (worstOver) {
    return {
      text: worstOver.icon + ' Te pasaste en ' + worstOver.label + ' por ' + fmt(worstOver.over),
      color: 'var(--red)',
      bg: '#FFF1F2',
      border: '#FCA5A5'
    }
  }

  const warning = cats
    .filter(x => x.pct >= 80)
    .sort((a, b) => b.pct - a.pct)[0]

  if (warning) {
    return {
      text: warning.icon + ' Ojo: ' + warning.label + ' va en ' + Math.round(warning.pct) + '%',
      color: '#D97706',
      bg: '#FFFBEB',
      border: '#FCD34D'
    }
  }

  const globalPct = tb > 0 ? (ts / tb) * 100 : 0

  if (globalPct <= 35) {
    return {
      text: 'Buen ritmo este mes',
      color: 'var(--grn)',
      bg: '#ECFDF5',
      border: '#A7F3D0'
    }
  }

  if (globalPct <= 70) {
    return {
      text: 'Vas bien este mes',
      color: 'var(--acc)',
      bg: 'var(--acc2)',
      border: '#9AD8CF'
    }
  }

  return {
    text: 'Cerca del límite mensual',
    color: '#D97706',
    bg: '#FFFBEB',
    border: '#FCD34D'
  }
}

function renderHome() {
  recalcSpent()

  const sp = ST.spent || {}
  const tb = ST.budgets.reduce((s, b) => s + effectiveBudgetOf(b), 0)
  const ts = Object.values(sp).reduce((s, v) => s + (Number(v) || 0), 0)
  const left = tb - ts
  const globalPct = tb > 0 ? (ts / tb) * 100 : (ts > 0 ? 100 : 0)
  const pct = Math.min(100, globalPct)
  const totalRoll = ST.budgets.reduce((sum, b) => sum + rolloverOf(b), 0)

  document.getElementById('hero-lbl').textContent = left < 0 ? 'Sobrepasado' : 'Disponible'

  const ha = document.getElementById('hero-amt')
  ha.textContent = money0(Math.abs(left))
  ha.style.color = left < 0 ? 'var(--red)' : 'var(--txt)'

  const rollText = Math.abs(totalRoll) >= 0.01
    ? ' · rollover ' + (totalRoll > 0 ? '+' : '-') + fmt(Math.abs(totalRoll))
    : ''

  document.getElementById('hero-sub').textContent = fmt(ts) + ' gastado de ' + fmt(tb) + rollText

  const spentKpi = document.getElementById('kpi-spent')
  const budgetKpi = document.getElementById('kpi-budget')
  const useKpi = document.getElementById('kpi-use')

  if (spentKpi) spentKpi.textContent = fmt(ts)
  if (budgetKpi) budgetKpi.textContent = fmt(tb)
  if (useKpi) {
    useKpi.textContent = Math.round(globalPct) + '%'
    useKpi.style.color = globalPct > 90 ? 'var(--red)' : globalPct > 70 ? 'var(--amb)' : 'var(--txt)'
  }

  const health = getBudgetHealth(tb, ts, left, sp)
  const healthEl = document.getElementById('hero-health')

  if (healthEl) {
    healthEl.textContent = health.text
    healthEl.style.color = health.color
    healthEl.style.background = health.bg
    healthEl.style.borderColor = health.border
  }

  const f = document.getElementById('gbar-f')
  f.style.width = pct + '%'
  f.style.background = pct > 90 ? 'var(--red)' : pct > 70 ? 'var(--amb)' : 'var(--acc)'

  document.getElementById('cats').innerHTML = ST.budgets.map(b => {
    const s = sp[b.id] || 0
    const budget = effectiveBudgetOf(b)
    const p = budget > 0 ? Math.min(100, (s / budget) * 100) : (s > 0 ? 100 : 0)
    const rawPct = budget > 0 ? (s / budget) * 100 : (s > 0 ? 100 : 0)
    const ov = s > budget
    const col = ov ? 'var(--red)' : cssColor(b.color)
    const roll = rolloverLabel(b)
    const rollHtml = roll ? '<div class="cc-roll">' + esc(roll) + '</div>' : ''
    const remaining = budget - s
    const remainingText = remaining >= 0 ? fmt(remaining) + ' libre' : fmt(Math.abs(remaining)) + ' sobre'

    return \`<div class="cc" style="--cat:\${cssColor(b.color)};--cat-soft:\${cssColor(b.color)}16" onclick="quickAdd('\${esc(b.id)}')">
      <div class="cc-top">
        <div class="cc-l">
          <span class="cc-icon">\${esc(b.icon)}</span>
          <div>
            <div class="cc-name">\${esc(b.label)}</div>
            <div class="cc-pct">\${remainingText}</div>
            \${rollHtml}
          </div>
        </div>

        <div class="cc-r">
          <div class="cc-spent" style="color:\${col}">\${fmt(s)}</div>
          <div class="cc-budget">de \${fmt(budget)}</div>
        </div>
      </div>

      <div class="cc-progress">
        <div class="bar-bg">
          <div class="bar-f" style="width:\${p}%;background:\${col}"></div>
        </div>
        <div class="cc-pct-badge">\${Math.round(rawPct)}%</div>
      </div>
    </div>\`
  }).join('')
}

function renderPresets() {
  const el = document.getElementById('presets')
  if (!el) return

  const arr = ST.presets || []

  if (!arr.length) {
    el.innerHTML = '<button class="preset-btn" onclick="go(\\'presets\\')">＋ Crear preset</button>'
    return
  }

  el.innerHTML = arr.map(p => {
    const b = catById(p.cat) || {}
    const color = cssColor(b.color || '#0F766E')
    return \`
      <button class="preset-btn" style="--cat:\${color};--cat-soft:\${color}16" onclick="usePreset('\${esc(p.id)}')">
        <span class="preset-emoji">\${esc(p.icon || b.icon || '⚡')}</span>
        <span class="preset-copy">\${esc(p.desc)}</span>
        <span class="preset-amt">\${fmt(p.amt)}</span>
      </button>
    \`
  }).join('')
}

function usePreset(id) {
  const p = presetById(id)
  if (!p) return

  document.getElementById('in-amt').value = Number(p.amt) || ''
  document.getElementById('in-desc').value = p.desc || ''

  if (catById(p.cat)) {
    pickCat(p.cat, true)
  }

  chk()
  toast('Preset listo')
}

function renderLog() {
  const el = document.getElementById('log-list')
  const arr = [...(ST.entries || [])].reverse()

  if (!arr.length) {
    el.innerHTML = '<div class="empty"><div class="empty-i">📭</div><div class="empty-t">Sin movimientos</div></div>'
    return
  }

  el.innerHTML = arr.map(e => {
    const b = catById(e.cat) || {}
    const color = cssColor(b.color || '#0F766E')

    return \`<div class="li" style="--cat:\${color}" onclick="openEdit(\${Number(e.id)})">
      <div class="li-ico" style="background:\${color}16;color:\${color}">\${esc(b.icon || '·')}</div>

      <div class="li-info">
        <div class="li-desc">\${esc(e.desc || 'Gasto')}</div>
        <div class="li-meta">\${esc(b.label || e.cat || 'Sin categoría')}</div>
      </div>

      <div class="li-r">
        <div class="li-amt">\${fmt(e.amt)}</div>
        <div class="li-date">\${esc(e.date || '')}</div>
      </div>

      <button class="delbtn" onclick="event.stopPropagation(); del(\${Number(e.id)})">×</button>
    </div>\`
  }).join('')
}

function renderPills() {
  renderSelectedCat()
  renderCatPicker()
}

function renderSelectedCat() {
  const el = document.getElementById('selected-cat')
  if (!el) return

  const b = selCat ? catById(selCat) : null

  if (!b) {
    el.innerHTML = '<span class="selected-cat-icon">＋</span><span class="selected-cat-text">Elige una categoría</span><span class="selected-cat-arrow">›</span>'
    el.style.borderColor = 'var(--bord)'
    el.style.background = 'var(--card)'
    el.style.color = 'var(--txt)'
    el.style.removeProperty('--sc')
    return
  }

  const color = cssColor(b.color)
  el.style.setProperty('--sc', color)
  el.style.borderColor = color
  el.style.background = color + '10'
  el.style.color = color
  el.innerHTML = \`
    <span class="selected-cat-icon" style="background:\${color}16;color:\${color}">\${esc(b.icon)}</span>
    <span class="selected-cat-text">\${esc(b.label)}</span>
    <span class="selected-cat-arrow">›</span>
  \`
}

function renderCatPicker() {
  const el = document.getElementById('cat-picker-list')
  if (!el) return

  el.innerHTML = ST.budgets.map(b => \`
    <button 
      class="cat-picker-item \${selCat === b.id ? 'sel' : ''}" 
      style="--sc:\${cssColor(b.color)};--sb:\${cssColor(b.color)}16"
      onclick="chooseCatFromPicker('\${esc(b.id)}')">
      <span class="cat-picker-icon" style="background:\${cssColor(b.color)}16;color:\${cssColor(b.color)}">\${esc(b.icon)}</span>
      <span class="cat-picker-name">\${esc(b.label)}</span>
      <span class="cat-picker-budget">\${fmt(effectiveBudgetOf(b))}</span>
    </button>
  \`).join('')
}

function openCatPicker() {
  renderCatPicker()

  const m = document.getElementById('cat-picker-modal')
  if (m) m.classList.add('show')
}

function closeCatPicker() {
  const m = document.getElementById('cat-picker-modal')
  if (m) m.classList.remove('show')
}

function chooseCatFromPicker(id) {
  pickCat(id, true)
  closeCatPicker()
  toast('Categoría lista')
}

function renderEditCats() {
  const el = document.getElementById('edit-cats')
  if (!el) return

  el.innerHTML = ST.budgets.map(b => \`
    <button 
      class="edit-pill \${editingCat === b.id ? 'sel' : ''}" 
      style="--sc:\${cssColor(b.color)};--sb:\${cssColor(b.color)}22"
      onclick="pickEditCat('\${esc(b.id)}')">
      \${esc(b.icon)} \${esc(b.label)}
    </button>
  \`).join('')
}

function renderWishEditCats() {
  const el = document.getElementById('wish-edit-cats')
  if (!el) return

  el.innerHTML = ST.budgets.map(b => \`
    <button 
      class="edit-pill \${editingWishCat === b.id ? 'sel' : ''}" 
      style="--sc:\${cssColor(b.color)};--sb:\${cssColor(b.color)}22"
      onclick="pickWishEditCat('\${esc(b.id)}')">
      \${esc(b.icon)} \${esc(b.label)}
    </button>
  \`).join('')
}

function renderCategories() {
  const el = document.getElementById('cat-list')

  if (!ST.budgets.length) {
    el.innerHTML = '<div class="empty"><div class="empty-i">◎</div><div class="empty-t">No tienes categorías todavía</div></div>'
    return
  }

  el.innerHTML = ST.budgets.map(b => {
    const base = baseBudgetOf(b)
    const effective = effectiveBudgetOf(b)
    const roll = rolloverLabel(b)
    const rollHtml = roll ? '<div class="cat-roll">' + esc(roll) + ' · efectivo este mes ' + fmt(effective) + '</div>' : '<div class="cat-roll">Sin rollover · efectivo este mes ' + fmt(effective) + '</div>'

    return \`
      <div class="cat-card" style="--cat:\${cssColor(b.color)}">
        <div class="cat-top">
          <span class="cat-dot" style="background:\${cssColor(b.color)}"></span>
          <span class="cat-title">
            <span class="cat-title-icon">\${esc(b.icon)}</span>
            <span class="cat-title-text">\${esc(b.label)}</span>
          </span>
          <span class="cat-budget">Base \${fmt(base)}</span>
        </div>

        \${rollHtml}

        <div class="cat-actions">
          <input 
            class="mini-in" 
            id="bud-\${esc(b.id)}" 
            type="number" 
            inputmode="decimal" 
            value="\${base}"
            data-original="\${base}"
            oninput="markCatChanged('\${esc(b.id)}')">

          <button class="mini-save" id="save-\${esc(b.id)}" onclick="saveCatBudget('\${esc(b.id)}')">Guardar</button>
          <button class="mini-del" onclick="deleteCategory('\${esc(b.id)}')">Borrar</button>
        </div>
      </div>
    \`
  }).join('')
}

function renderPresetManager() {
  renderPresetCatPills()
  renderPresetList()
}

function renderPresetCatPills() {
  const el = document.getElementById('preset-cats')
  if (!el) return

  if (!newPresetCat || !catById(newPresetCat)) {
    newPresetCat = ST.budgets[0] ? ST.budgets[0].id : null
  }

  el.innerHTML = ST.budgets.map(b => \`
    <button 
      class="preset-cat-pill \${newPresetCat === b.id ? 'sel' : ''}" 
      style="--sc:\${cssColor(b.color)};--sb:\${cssColor(b.color)}22"
      onclick="pickPresetCat('\${esc(b.id)}')">
      \${esc(b.icon)} \${esc(b.label)}
    </button>
  \`).join('')
}

function renderPresetList() {
  const el = document.getElementById('preset-list')
  if (!el) return

  const arr = ST.presets || []

  if (!arr.length) {
    el.innerHTML = '<div class="empty"><div class="empty-i">⚡</div><div class="empty-t">No tienes presets todavía</div></div>'
    return
  }

  el.innerHTML = arr.map(p => {
    const b = catById(p.cat) || {}
    const color = cssColor(b.color || '#0F766E')
    return \`
      <div class="preset-card" style="--cat:\${color}">
        <div class="preset-card-icon" style="background:\${color}16;color:\${color}">\${esc(p.icon || b.icon || '⚡')}</div>
        <div class="preset-card-info">
          <div class="preset-card-title">\${esc(p.desc)}</div>
          <div class="preset-card-meta">\${fmt(p.amt)} · \${esc(b.label || 'Sin categoría')}</div>
        </div>
        <button class="preset-card-del" onclick="deletePreset('\${esc(p.id)}')">Borrar</button>
      </div>
    \`
  }).join('')
}

function renderWishlistManager() {
  renderWishCatPills()
  renderWishList()
}

function renderWishCatPills() {
  const el = document.getElementById('wish-cats')
  if (!el) return

  if (!newWishCat || !catById(newWishCat)) {
    newWishCat = ST.budgets[0] ? ST.budgets[0].id : null
  }

  el.innerHTML = ST.budgets.map(b => \`
    <button 
      class="preset-cat-pill \${newWishCat === b.id ? 'sel' : ''}" 
      style="--sc:\${cssColor(b.color)};--sb:\${cssColor(b.color)}22"
      onclick="pickWishCat('\${esc(b.id)}')">
      \${esc(b.icon)} \${esc(b.label)}
    </button>
  \`).join('')
}

function renderWishList() {
  const el = document.getElementById('wish-list')
  if (!el) return

  const arr = ST.wishes || []

  if (!arr.length) {
    el.innerHTML = '<div class="empty"><div class="empty-i">✨</div><div class="empty-t">Tu wishlist está vacía</div></div>'
    return
  }

  el.innerHTML = arr.map(w => {
    const b = catById(w.cat) || {}
    const color = cssColor(b.color || '#0F766E')
    return \`
      <div class="preset-card" style="--cat:\${color}" onclick="openWishEdit('\${esc(w.id)}')">
        <div class="preset-card-icon" style="background:\${color}16;color:\${color}">\${esc(w.icon || '✨')}</div>
        <div class="preset-card-info">
          <div class="preset-card-title">\${esc(w.desc)}</div>
          <div class="preset-card-meta">\${fmt(w.amt)} · \${esc(b.label || 'Sin categoría')}</div>
        </div>
        <div class="wish-actions">
          <button class="wish-buy" onclick="event.stopPropagation(); buyWish('\${esc(w.id)}')">Comprar</button>
          <button class="wish-del" onclick="event.stopPropagation(); deleteWish('\${esc(w.id)}')">Borrar</button>
        </div>
      </div>
    \`
  }).join('')
}

function markCatChanged(id) {
  const input = document.getElementById('bud-' + id)
  const btn = document.getElementById('save-' + id)

  if (!input || !btn) return

  const raw = input.value.trim()
  const original = Number(input.dataset.original)
  const current = Number(raw)

  const changed = raw !== '' && !isNaN(current) && current > 0 && current !== original

  btn.classList.toggle('show', changed)
}

function pickCat(id, silent) {
  if (!catById(id)) return

  selCat = id

  renderSelectedCat()
  renderCatPicker()
  chk()

  if (!silent) toast('Categoría lista')
}

function pickEditCat(id) {
  if (!catById(id)) return
  editingCat = id
  renderEditCats()
}

function pickWishEditCat(id) {
  if (!catById(id)) return
  editingWishCat = id
  renderWishEditCats()
}

function pickPresetCat(id) {
  if (!catById(id)) return
  newPresetCat = id
  renderPresetCatPills()
  chkPreset()
}

function pickWishCat(id) {
  if (!catById(id)) return
  newWishCat = id
  renderWishCatPills()
  chkWish()
}

function quickAdd(id) {
  go('add')
  setTimeout(() => pickCat(id, true), 30)
}

function chk() {
  const a = parseFloat(document.getElementById('in-amt').value)
  document.getElementById('sbtn').disabled = !(selCat && a > 0)
}

function chkCat() {
  const label = document.getElementById('cat-label').value.trim()
  const budget = parseFloat(document.getElementById('cat-budget').value)

  const duplicate = ST.budgets.some(
    b => b.label.trim().toLowerCase() === label.toLowerCase()
  )

  document.getElementById('cat-btn').disabled = !(label && budget > 0 && !duplicate)
}

function chkPreset() {
  const btn = document.getElementById('preset-btn')
  if (!btn) return

  const desc = document.getElementById('preset-desc').value.trim()
  const amt = parseFloat(document.getElementById('preset-amt').value)

  btn.disabled = !(desc && amt > 0 && newPresetCat)
}

function chkWish() {
  const btn = document.getElementById('wish-btn')
  if (!btn) return

  const desc = document.getElementById('wish-desc').value.trim()
  const amt = parseFloat(document.getElementById('wish-amt').value)

  btn.disabled = !(desc && amt > 0 && newWishCat)
}

function doSave() {
  const a = parseFloat(document.getElementById('in-amt').value)
  const d = document.getElementById('in-desc').value.trim()
  const b = catById(selCat)

  if (!selCat || isNaN(a) || a <= 0) return

  const id = Date.now() + Math.floor(Math.random() * 1000)

  const today = new Date().toLocaleDateString("es-MX", {
    day: "2-digit",
    month: "short"
  })

  const entry = {
    id,
    cat: selCat,
    amt: a,
    desc: d || (b ? b.label : selCat),
    date: today
  }

  ST.entries = ST.entries || []
  ST.entries.push(entry)
  recalcSpent()

  send({
    type: 'add',
    id,
    cat: selCat,
    amt: a,
    desc: entry.desc
  })

  document.getElementById('in-amt').value = ''
  document.getElementById('in-desc').value = ''

  selCat = null

  document.getElementById('sbtn').disabled = true

  renderSelectedCat()
  renderCatPicker()
  renderHome()
  renderLog()

  toast('✓ Guardado')
  go('home')
}

function openEdit(id) {
  const e = entryById(id)

  if (!e) {
    toast('No encontré ese gasto')
    return
  }

  editingId = Number(e.id)
  editingCat = e.cat

  document.getElementById('edit-desc').value = e.desc || ''
  document.getElementById('edit-amt').value = Number(e.amt) || ''

  renderEditCats()

  document.getElementById('edit-modal').classList.add('show')
}

function closeEdit() {
  editingId = null
  editingCat = null
  document.getElementById('edit-modal').classList.remove('show')
}

function saveEditingEntry() {
  const e = entryById(editingId)

  if (!e) {
    closeEdit()
    toast('No encontré ese gasto')
    return
  }

  const desc = document.getElementById('edit-desc').value.trim()
  const amt = parseFloat(document.getElementById('edit-amt').value)

  if (!editingCat || isNaN(amt) || amt <= 0) {
    toast('Revisa monto/categoría')
    return
  }

  e.desc = desc || 'Gasto'
  e.amt = amt
  e.cat = editingCat

  recalcSpent()

  send({
    type: 'updateEntry',
    id: e.id,
    desc: e.desc,
    amt: e.amt,
    cat: e.cat
  })

  renderHome()
  renderLog()
  closeEdit()

  toast('✓ Gasto actualizado')
}

function saveEditingAsPreset() {
  const desc = document.getElementById('edit-desc').value.trim()
  const amt = parseFloat(document.getElementById('edit-amt').value)

  if (!desc || isNaN(amt) || amt <= 0 || !editingCat) {
    toast('Revisa los datos')
    return
  }

  const b = catById(editingCat)
  const id = makeClientPresetId(desc)
  const icon = b ? b.icon : '⚡'

  ST.presets = ST.presets || []
  ST.presets.push({
    id,
    desc,
    amt,
    cat: editingCat,
    icon
  })

  send({
    type: 'addPreset',
    id,
    desc,
    amt,
    cat: editingCat,
    icon
  })

  renderPresets()
  renderPresetManager()
  closeEdit()

  toast('✓ Preset creado')
}

function deleteEditingEntry() {
  if (!editingId) return

  const id = editingId

  ST.entries = (ST.entries || []).filter(e => Number(e.id) !== Number(id))
  recalcSpent()

  send({
    type: 'delete',
    id
  })

  renderHome()
  renderLog()
  closeEdit()

  toast('Gasto borrado')
}

function addCategory() {
  const label = document.getElementById('cat-label').value.trim()
  const icon = document.getElementById('cat-icon').value.trim() || '🏷️'
  const budget = parseFloat(document.getElementById('cat-budget').value)
  const color = nextClientCategoryColor()

  const duplicate = ST.budgets.some(
    b => b.label.trim().toLowerCase() === label.toLowerCase()
  )

  if (!label || isNaN(budget) || budget <= 0 || duplicate) return

  const id = makeClientCatId(label)

  ST.budgets.push({
    id,
    label,
    icon,
    baseBudget: budget,
    rollover: 0,
    budget,
    color
  })

  recalcSpent()

  send({
    type: 'addCategory',
    id,
    label,
    icon,
    budget,
    color
  })

  document.getElementById('cat-label').value = ''
  document.getElementById('cat-icon').value = ''
  document.getElementById('cat-budget').value = ''

  renderHome()
  renderPresets()
  renderPills()
  renderCategories()
  renderPresetManager()
  renderWishlistManager()
  chkCat()

  toast('✓ Categoría agregada')
}

function saveCatBudget(id) {
  const input = document.getElementById('bud-' + id)
  const btn = document.getElementById('save-' + id)
  const budget = parseFloat(input ? input.value : '')

  if (isNaN(budget) || budget <= 0) {
    toast('Límite inválido')
    return
  }

  const b = catById(id)

  if (b) {
    b.baseBudget = budget
    b.budget = budget + rolloverOf(b)
    if (input) input.dataset.original = String(budget)
    if (btn) btn.classList.remove('show')
    renderHome()
    renderCategories()
    renderCatPicker()
  }

  send({
    type: 'updateCategory',
    id,
    budget
  })

  toast('✓ Límite base actualizado')
}

function deleteCategory(id) {
  if (ST.budgets.length <= 1) {
    toast('Deja mínimo 1 categoría')
    return
  }

  const b = catById(id)

  if (!b) {
    toast('No encontré esa categoría')
    return
  }

  ST.budgets = ST.budgets.filter(x => x.id !== id)
  ST.entries = (ST.entries || []).filter(e => e.cat !== id)
  ST.presets = (ST.presets || []).filter(p => p.cat !== id)
  ST.wishes = (ST.wishes || []).filter(w => w.cat !== id)

  if (selCat === id) {
    selCat = null
  }

  if (editingCat === id) {
    editingCat = null
  }

  if (editingWishCat === id) {
    editingWishCat = null
  }

  if (newPresetCat === id) {
    newPresetCat = ST.budgets[0] ? ST.budgets[0].id : null
  }

  if (newWishCat === id) {
    newWishCat = ST.budgets[0] ? ST.budgets[0].id : null
  }

  recalcSpent()

  send({
    type: 'deleteCategory',
    id
  })

  renderHome()
  renderPresets()
  renderPills()
  renderCategories()
  renderLog()
  renderEditCats()
  renderPresetManager()
  renderWishlistManager()
  chk()

  toast('Categoría borrada')
}

function addPreset() {
  const desc = document.getElementById('preset-desc').value.trim()
  const amt = parseFloat(document.getElementById('preset-amt').value)
  const icon = document.getElementById('preset-icon').value.trim() || (catById(newPresetCat) ? catById(newPresetCat).icon : '⚡')

  if (!desc || isNaN(amt) || amt <= 0 || !newPresetCat) {
    toast('Revisa el preset')
    return
  }

  const id = makeClientPresetId(desc)

  ST.presets = ST.presets || []
  ST.presets.push({
    id,
    desc,
    amt,
    cat: newPresetCat,
    icon
  })

  send({
    type: 'addPreset',
    id,
    desc,
    amt,
    cat: newPresetCat,
    icon
  })

  document.getElementById('preset-desc').value = ''
  document.getElementById('preset-amt').value = ''
  document.getElementById('preset-icon').value = ''

  renderPresets()
  renderPresetManager()
  chkPreset()

  toast('✓ Preset creado')
}

function deletePreset(id) {
  ST.presets = (ST.presets || []).filter(p => p.id !== id)

  send({
    type: 'deletePreset',
    id
  })

  renderPresets()
  renderPresetManager()

  toast('Preset borrado')
}

function addWish() {
  const desc = document.getElementById('wish-desc').value.trim()
  const amt = parseFloat(document.getElementById('wish-amt').value)
  const icon = document.getElementById('wish-icon').value.trim() || '✨'

  if (!desc || isNaN(amt) || amt <= 0 || !newWishCat) {
    toast('Revisa el deseo')
    return
  }

  const id = makeClientWishId(desc)

  ST.wishes = ST.wishes || []
  ST.wishes.push({
    id,
    desc,
    amt,
    cat: newWishCat,
    icon
  })

  send({
    type: 'addWish',
    id,
    desc,
    amt,
    cat: newWishCat,
    icon
  })

  document.getElementById('wish-desc').value = ''
  document.getElementById('wish-amt').value = ''
  document.getElementById('wish-icon').value = ''

  renderWishlistManager()
  chkWish()

  toast('✓ Deseo guardado')
}

function openWishEdit(id) {
  const w = wishById(id)

  if (!w) {
    toast('No encontré ese deseo')
    return
  }

  editingWishId = w.id
  editingWishCat = w.cat

  document.getElementById('wish-edit-icon').value = w.icon || '✨'
  document.getElementById('wish-edit-desc').value = w.desc || ''
  document.getElementById('wish-edit-amt').value = Number(w.amt) || ''

  renderWishEditCats()

  const m = document.getElementById('wish-edit-modal')
  if (m) m.classList.add('show')
}

function closeWishEdit() {
  editingWishId = null
  editingWishCat = null

  const m = document.getElementById('wish-edit-modal')
  if (m) m.classList.remove('show')
}

function getWishEditValues() {
  const desc = document.getElementById('wish-edit-desc').value.trim()
  const amt = parseFloat(document.getElementById('wish-edit-amt').value)
  const icon = document.getElementById('wish-edit-icon').value.trim() || '✨'

  if (!desc || isNaN(amt) || amt <= 0 || !editingWishCat) {
    return null
  }

  return {
    desc,
    amt,
    cat: editingWishCat,
    icon
  }
}

function saveEditingWish() {
  const w = wishById(editingWishId)
  const vals = getWishEditValues()

  if (!w || !vals) {
    toast('Revisa los datos')
    return
  }

  w.desc = vals.desc
  w.amt = vals.amt
  w.cat = vals.cat
  w.icon = vals.icon

  send({
    type: 'updateWish',
    id: w.id,
    desc: w.desc,
    amt: w.amt,
    cat: w.cat,
    icon: w.icon
  })

  renderWishlistManager()
  closeWishEdit()

  toast('✓ Deseo actualizado')
}

function deleteEditingWish() {
  if (!editingWishId) return

  const id = editingWishId
  closeWishEdit()
  deleteWish(id)
}

function buyEditingWish() {
  const w = wishById(editingWishId)
  const vals = getWishEditValues()

  if (!w || !vals) {
    toast('Revisa los datos')
    return
  }

  if (!catById(vals.cat)) {
    toast('Categoría inválida')
    return
  }

  const entryId = Date.now() + Math.floor(Math.random() * 1000)

  const today = new Date().toLocaleDateString("es-MX", {
    day: "2-digit",
    month: "short"
  })

  ST.entries = ST.entries || []
  ST.entries.push({
    id: entryId,
    desc: vals.desc,
    amt: vals.amt,
    cat: vals.cat,
    date: today
  })

  ST.wishes = (ST.wishes || []).filter(x => x.id !== w.id)
  recalcSpent()

  send({
    type: 'buyWish',
    id: w.id,
    entryId,
    desc: vals.desc,
    amt: vals.amt,
    cat: vals.cat
  })

  renderHome()
  renderLog()
  renderWishlistManager()
  closeWishEdit()

  toast('✓ Comprado y enviado al log')
}

function deleteWish(id) {
  ST.wishes = (ST.wishes || []).filter(w => w.id !== id)

  send({
    type: 'deleteWish',
    id
  })

  renderWishlistManager()

  toast('Deseo borrado')
}

function buyWish(id) {
  const w = wishById(id)

  if (!w) {
    toast('No encontré ese deseo')
    return
  }

  if (!catById(w.cat)) {
    toast('Categoría inválida')
    return
  }

  const entryId = Date.now() + Math.floor(Math.random() * 1000)

  const today = new Date().toLocaleDateString("es-MX", {
    day: "2-digit",
    month: "short"
  })

  ST.entries = ST.entries || []
  ST.entries.push({
    id: entryId,
    desc: w.desc,
    amt: Number(w.amt) || 0,
    cat: w.cat,
    date: today
  })

  ST.wishes = (ST.wishes || []).filter(x => x.id !== id)
  recalcSpent()

  send({
    type: 'buyWish',
    id,
    entryId,
    desc: w.desc,
    amt: Number(w.amt) || 0,
    cat: w.cat
  })

  renderHome()
  renderLog()
  renderWishlistManager()

  toast('✓ Comprado y enviado al log')
}

function del(id) {
  ST.entries = (ST.entries || []).filter(e => Number(e.id) !== Number(id))
  recalcSpent()

  send({
    type: 'delete',
    id
  })

  renderLog()
  renderHome()

  toast('Eliminado')
}

function toast(msg) {
  const t = document.getElementById('toast')

  t.textContent = msg
  t.classList.add('show')

  clearTimeout(window._toastTimer)

  window._toastTimer = setTimeout(() => {
    t.classList.remove('show')
  }, 1700)
}

function go(s) {
  closeEdit()
  closeWishEdit()
  closeCatPicker()

  document.querySelectorAll('.screen').forEach(x => x.classList.remove('on'))

  const screen = document.getElementById('s-' + s)

  if (screen) {
    screen.classList.add('on')
  }

  document.querySelectorAll('.nb').forEach(btn => {
    btn.classList.toggle('on', btn.dataset.tab === s)
  })

  if (s === 'add') {
    renderPresets()
    renderPills()
  }

  if (s === 'cats') renderCategories()
  if (s === 'presets') renderPresetManager()
  if (s === 'wishes') renderWishlistManager()
  if (s === 'log') renderLog()
  if (s === 'home') renderHome()
}

renderHome()
renderPresets()
renderPills()
renderCategories()
renderLog()
renderPresetManager()
renderWishlistManager()
renderWishEditCats()
renderBackupStatus()
send({ type: 'getBackupStatus' })
</script>
</body>
</html>`
}

// ─── ENTRY POINT ──────────────────────────────────────────
if (config.runsInWidget) {
    const w = await buildWidget()
    Script.setWidget(w)
} else {
    await runApp()
}

Script.complete()
