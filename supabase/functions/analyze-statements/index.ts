import * as XLSX from "https://esm.sh/xlsx@0.18.5"

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS"
}

type StatementFile = {
  name: string
  type: string
  text: string
  candidates: CandidateTransaction[]
}

type CandidateTransaction = {
  rawDate: string
  dateISO: string
  description: string
  amount: number
  sourceName: string
}

type NormalizedTransaction = {
  id: string
  monthKey: string
  dateISO: string
  merchant: string
  category: string
  subcategory: string
  amount: number
  originalDescription: string
  sourceName: string
  confidence: number
  signature: string
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...CORS_HEADERS,
      "Content-Type": "application/json"
    }
  })
}

function cleanText(value: unknown, fallback = "") {
  return String(value ?? fallback).replace(/\s+/g, " ").trim()
}

function normalizeText(value: unknown) {
  return cleanText(value)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
}

const DATE_HEADERS = ["posting date", "transaction date", "booking date", "value date", "date", "fecha", "data", "datum"]
const DESCRIPTION_HEADERS = ["description", "merchant", "payee", "memo", "name", "descripcion", "concepto", "detalle", "comercio", "beneficiary", "beneficiario", "libelle", "narrative"]
const AMOUNT_HEADERS = ["amount", "importe", "monto", "valor", "value", "total", "debit", "debito", "debit", "charge", "cargo", "withdrawal", "retiro", "payment", "pago"]
const DEBIT_HEADERS = ["debit", "debito", "debit", "charge", "cargo", "withdrawal", "retiro", "paid out", "salida"]
const CREDIT_HEADERS = ["credit", "credito", "abono", "deposit", "paid in", "entrada"]
const MONTHS: Record<string, string> = {
  jan: "01",
  january: "01",
  enero: "01",
  ene: "01",
  janeiro: "01",
  janvier: "01",
  feb: "02",
  february: "02",
  febrero: "02",
  fevereiro: "02",
  fevrier: "02",
  mar: "03",
  march: "03",
  marzo: "03",
  marco: "03",
  mars: "03",
  apr: "04",
  april: "04",
  abril: "04",
  avril: "04",
  may: "05",
  mayo: "05",
  maio: "05",
  mai: "05",
  jun: "06",
  june: "06",
  junio: "06",
  junho: "06",
  juin: "06",
  jul: "07",
  july: "07",
  julio: "07",
  julho: "07",
  juillet: "07",
  aug: "08",
  august: "08",
  agosto: "08",
  aout: "08",
  sep: "09",
  sept: "09",
  september: "09",
  septiembre: "09",
  setembro: "09",
  septembre: "09",
  oct: "10",
  october: "10",
  octubre: "10",
  outubro: "10",
  octobre: "10",
  nov: "11",
  november: "11",
  noviembre: "11",
  novembro: "11",
  novembre: "11",
  dec: "12",
  december: "12",
  diciembre: "12",
  dezembro: "12",
  decembre: "12"
}

function makeISO(yearValue: string | number, monthValue: string | number, dayValue: string | number) {
  const year = String(yearValue).padStart(4, "20")
  const month = String(monthValue).padStart(2, "0")
  const day = String(dayValue).padStart(2, "0")
  const y = Number(year)
  const m = Number(month)
  const d = Number(day)
  if (!y || m < 1 || m > 12 || d < 1 || d > 31) return ""
  const date = new Date(Date.UTC(y, m - 1, d))
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) return ""
  return `${year}-${month}-${day}`
}

function normalizeYear(value: string) {
  return value.length === 2 ? `20${value}` : value
}

function resolveNumericDate(first: string, second: string, year: string, preferredOrder = "mdy") {
  const left = Number(first)
  const right = Number(second)
  if (left > 12 && right <= 12) return makeISO(normalizeYear(year), second, first)
  if (right > 12 && left <= 12) return makeISO(normalizeYear(year), first, second)
  return preferredOrder === "dmy"
    ? makeISO(normalizeYear(year), second, first)
    : makeISO(normalizeYear(year), first, second)
}

function inferDateOrder(text: string) {
  let dayFirst = 0
  let monthFirst = 0
  const lowered = normalizeText(text)
  if (/\bdd[/-]mm[/-]yyyy\b|\bfecha\b|\bdata\b|\bimporte\b|\bdebito\b|\bcredito\b/.test(lowered)) dayFirst += 2
  if (/\bmm[/-]dd[/-]yyyy\b|\bposting date\b|\bcheckcard\b|\bchecking\b/.test(lowered)) monthFirst += 2

  for (const match of text.matchAll(/\b(\d{1,2})[./-](\d{1,2})[./-](\d{2,4})\b/g)) {
    const first = Number(match[1])
    const second = Number(match[2])
    if (first > 12 && second <= 12) dayFirst++
    if (second > 12 && first <= 12) monthFirst++
  }

  return dayFirst > monthFirst ? "dmy" : "mdy"
}

function toDateISO(value: unknown, preferredOrder = "mdy") {
  const raw = cleanText(value)
  if (!raw) return ""

  const excelNumber = typeof value === "number" ? value : Number.NaN
  if (Number.isFinite(excelNumber) && excelNumber > 20000 && excelNumber < 80000) {
    const utcDays = Math.floor(excelNumber - 25569)
    const date = new Date(utcDays * 86400 * 1000)
    if (Number.isFinite(date.getTime())) return date.toISOString().slice(0, 10)
  }

  const direct = raw.match(/\b(20\d{2}|19\d{2})[-/.](\d{1,2})[-/.](\d{1,2})\b/)
  if (direct) {
    return makeISO(direct[1], direct[2], direct[3])
  }

  const numeric = raw.match(/\b(\d{1,2})[-/.](\d{1,2})[-/.](20\d{2}|19\d{2}|\d{2})\b/)
  if (numeric) {
    return resolveNumericDate(numeric[1], numeric[2], numeric[3], preferredOrder)
  }

  const normalized = normalizeText(raw)
  const monthName = Object.keys(MONTHS).join("|")
  const dayMonthYear = normalized.match(new RegExp(`\\b(\\d{1,2})\\s+(${monthName})\\s*,?\\s*(20\\d{2}|19\\d{2}|\\d{2})\\b`))
  if (dayMonthYear) {
    return makeISO(normalizeYear(dayMonthYear[3]), MONTHS[dayMonthYear[2]], dayMonthYear[1])
  }

  const monthDayYear = normalized.match(new RegExp(`\\b(${monthName})\\s+(\\d{1,2})(?:st|nd|rd|th)?[,]?\\s*(20\\d{2}|19\\d{2}|\\d{2})\\b`))
  if (monthDayYear) {
    return makeISO(normalizeYear(monthDayYear[3]), MONTHS[monthDayYear[1]], monthDayYear[2])
  }

  const parsed = Date.parse(raw)
  if (Number.isFinite(parsed)) return new Date(parsed).toISOString().slice(0, 10)
  return ""
}

function parseCsvLine(line: string, delimiter = ",") {
  const cells: string[] = []
  let current = ""
  let quoted = false

  for (let i = 0; i < line.length; i++) {
    const char = line[i]
    const next = line[i + 1]

    if (char === '"' && quoted && next === '"') {
      current += '"'
      i++
      continue
    }

    if (char === '"') {
      quoted = !quoted
      continue
    }

    if (char === delimiter && !quoted) {
      cells.push(current.trim())
      current = ""
      continue
    }

    current += char
  }

  cells.push(current.trim())
  return cells
}

function parseMoney(value: unknown): number {
  if (typeof value === "number") return value
  const raw = cleanText(value)
  if (!raw) return 0
  const negative = raw.includes("-") || /^\(.+\)$/.test(raw) || /\b(dr|debit|debito|cargo)\b/i.test(raw)
  let numeric = raw
    .replace(/\((.+)\)/, "$1")
    .replace(/[−–—]/g, "-")
    .replace(/[^0-9,.'\-\s]/g, "")
    .replace(/'/g, "")
    .trim()

  const lastComma = numeric.lastIndexOf(",")
  const lastDot = numeric.lastIndexOf(".")
  if (lastComma >= 0 && lastDot >= 0) {
    const decimal = lastComma > lastDot ? "," : "."
    const thousands = decimal === "," ? "." : ","
    numeric = numeric.replace(new RegExp(`\\${thousands}`, "g"), "").replace(decimal, ".")
  } else if (lastComma >= 0) {
    const decimals = numeric.length - lastComma - 1
    numeric = decimals > 0 && decimals <= 2
      ? numeric.replace(/\./g, "").replace(",", ".")
      : numeric.replace(/,/g, "")
  } else if (lastDot >= 0) {
    const decimals = numeric.length - lastDot - 1
    numeric = decimals === 3 && /\d+\.\d{3}(\D|$)/.test(numeric)
      ? numeric.replace(/\./g, "")
      : numeric
  }

  const cleaned = numeric.replace(/[\s-]/g, "")
  const valueNumber = Math.abs(Number(cleaned) || 0)
  return valueNumber > 0 ? valueNumber * (negative ? -1 : 1) : 0
}

function likelyNotExpense(description: string, amount: number) {
  const text = description.toLowerCase()
  if (!description || !amount) return true
  if (amount === 0) return true
  if (/\b(beginning|ending|available|daily)\s+balance\b/.test(text)) return true
  if (/^total\b|\btotal\s+(fees|debits|credits|subtractions)\b/.test(text)) return true
  if (/\b(direct deposit|payroll|deposit from|mobile check deposit|interest paid|payment from|zelle payment from|credit from|refund|reversal|reversed)\b/.test(text)) return true
  if (/\btransfer (from|to) (sav|saving|savings|chk|checking)\b/.test(text)) return true
  if (/\bonline banking transfer (from|to)\b/.test(text)) return true
  if (/\bpayment to crd\b|\bcredit card payment\b/.test(text)) return true
  return false
}

function candidate(dateValue: unknown, descriptionValue: unknown, amountValue: unknown, sourceName: string, fallbackYear = "", preferredOrder = "mdy"): CandidateTransaction | null {
  const description = cleanText(descriptionValue)
  const amount = parseMoney(amountValue)
  const rawDate = cleanText(dateValue)
  let dateISO = toDateISO(dateValue, preferredOrder)

  if (!dateISO && fallbackYear && /^\d{1,2}[./-]\d{1,2}$/.test(rawDate)) {
    dateISO = toDateISO(`${rawDate}/${fallbackYear}`, preferredOrder)
  }

  if (!dateISO || likelyNotExpense(description, amount)) return null
  return { rawDate, dateISO, description, amount: Math.abs(amount), sourceName }
}

function uniqueCandidates(rows: CandidateTransaction[]) {
  const seen = new Set<string>()
  return rows.filter(row => {
    const signature = `${row.sourceName}|${row.dateISO}|${row.description}|${row.amount.toFixed(2)}`
    if (seen.has(signature)) return false
    seen.add(signature)
    return true
  })
}

function findHeaderIndex(headers: string[], names: string[]) {
  const normalized = headers.map(header => normalizeText(header))
  const normalizedNames = names.map(name => normalizeText(name))
  return normalized.findIndex(header => normalizedNames.some(name => header === name || header.includes(name)))
}

function parseDelimitedLine(line: string) {
  const delimiters = [",", ";", "\t"]
  const delimiter = delimiters
    .map(value => ({ value, count: line.split(value).length - 1 }))
    .sort((a, b) => b.count - a.count)[0]
  if (delimiter?.count > 0) return parseCsvLine(line, delimiter.value)
  return [line.trim()]
}

function extractDelimitedCandidates(text: string, sourceName: string) {
  const rows = text.split(/\r?\n/).map(parseDelimitedLine).filter(row => row.some(Boolean))
  const results: CandidateTransaction[] = []
  const preferredOrder = inferDateOrder(text)
  if (!rows.length) return results

  const headerIndex = rows.findIndex(row => row.length > 1 && findHeaderIndex(row, DATE_HEADERS) >= 0 && findHeaderIndex(row, DESCRIPTION_HEADERS) >= 0)

  if (headerIndex >= 0) {
    const headers = rows[headerIndex]
    const dateIndex = findHeaderIndex(headers, DATE_HEADERS)
    const descIndex = findHeaderIndex(headers, DESCRIPTION_HEADERS)
    const amountIndex = findHeaderIndex(headers, AMOUNT_HEADERS)
    const debitIndex = findHeaderIndex(headers, DEBIT_HEADERS)
    const creditIndex = findHeaderIndex(headers, CREDIT_HEADERS)

    rows.slice(headerIndex + 1).forEach(row => {
      const credit = creditIndex >= 0 ? parseMoney(row[creditIndex]) : 0
      const debit = debitIndex >= 0 ? parseMoney(row[debitIndex]) : 0
      const amount = debitIndex >= 0 ? debit : amountIndex >= 0 ? parseMoney(row[amountIndex]) : 0
      if (credit > 0 && !debit) return
      const item = candidate(row[dateIndex], row[descIndex], amount, sourceName, "", preferredOrder)
      if (item) results.push(item)
    })

    return results
  }

  rows.forEach(row => {
    if (row.length >= 5 && toDateISO(row[0], preferredOrder)) {
      const item = candidate(row[0], row[row.length - 1], row[1], sourceName, "", preferredOrder)
      if (item) results.push(item)
    }
  })

  return results
}

function inferYear(text: string) {
  const match = text.match(/\b(20\d{2}|19\d{2})\b/)
  return match ? match[1] : String(new Date().getFullYear())
}

function extractPlainTextCandidates(text: string, sourceName: string) {
  const year = inferYear(text)
  const preferredOrder = inferDateOrder(text)
  const results: CandidateTransaction[] = []
  let activeSection = true

  text.split(/\r?\n/).forEach(line => {
    const sectionText = line.toLowerCase()
    if (/daily ledger|daily balance|balance summary|account summary|deposits and other additions|credits? and additions|payments and credits/.test(sectionText)) {
      activeSection = false
    }
    if (/atm and debit|other subtractions|checks|service fees|transactions|withdrawals|debits|charges|purchases|activity/.test(sectionText)) {
      activeSection = true
    }
    if (!activeSection) return

    const match = line.match(/^\s*(\d{1,2}\/\d{1,2}(?:\/\d{2,4})?)\s+(.+?)\s+(-?\$?[\d,]+\.\d{2}|\(?\$?[\d,]+\.\d{2}\)?)\s*$/)
    if (!match) return
    if (!/[a-z]/i.test(match[2]) && /\d{1,2}\/\d{1,2}/.test(match[2])) return
    const rawDate = match[1].split(/[./-]/).length === 2 ? `${match[1]}/${year}` : match[1]
    const item = candidate(rawDate, match[2], match[3], sourceName, year, preferredOrder)
    if (item) results.push(item)
  })

  return results
}

function extractSheetCandidates(workbook: XLSX.WorkBook, sourceName: string) {
  const results: CandidateTransaction[] = []

  workbook.SheetNames.forEach((name: string) => {
    const sheet = workbook.Sheets[name]
    const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "" }) as unknown[][]
    const preferredOrder = inferDateOrder(XLSX.utils.sheet_to_csv(sheet, { blankrows: false }).slice(0, 20000))
    const headerIndex = rows.findIndex(row => findHeaderIndex(row.map(cell => cleanText(cell)), DATE_HEADERS) >= 0 && findHeaderIndex(row.map(cell => cleanText(cell)), DESCRIPTION_HEADERS) >= 0)
    if (headerIndex < 0) return

    const headers = rows[headerIndex].map(cell => cleanText(cell))
    const dateIndex = findHeaderIndex(headers, DATE_HEADERS)
    const descIndex = findHeaderIndex(headers, DESCRIPTION_HEADERS)
    const amountIndex = findHeaderIndex(headers, AMOUNT_HEADERS)
    const debitIndex = findHeaderIndex(headers, DEBIT_HEADERS)
    const creditIndex = findHeaderIndex(headers, CREDIT_HEADERS)

    rows.slice(headerIndex + 1).forEach(row => {
      const credit = creditIndex >= 0 ? parseMoney(row[creditIndex]) : 0
      const debit = debitIndex >= 0 ? parseMoney(row[debitIndex]) : 0
      const amount = debitIndex >= 0 ? debit : amountIndex >= 0 ? parseMoney(row[amountIndex]) : 0
      if (credit > 0 && !debit) return
      const item = candidate(row[dateIndex], row[descIndex], amount, sourceName, "", preferredOrder)
      if (item) results.push(item)
    })
  })

  return results
}

function makeId(value: string) {
  let hash = 0
  for (let i = 0; i < value.length; i++) {
    hash = ((hash << 5) - hash) + value.charCodeAt(i)
    hash |= 0
  }
  return `review_${Math.abs(hash).toString(36)}`
}

function normalizeTransaction(row: Record<string, unknown>, index: number): NormalizedTransaction | null {
  const amount = Math.abs(Number(row.amount))
  const dateISO = toDateISO(row.dateISO ?? row.date)
  const monthKey = cleanText(row.monthKey || (dateISO ? dateISO.slice(0, 7) : ""))
  const merchant = cleanText(row.merchant ?? row.store ?? row.payee ?? row.description, "Transaction")
  const category = cleanText(row.category, "Uncategorized")
  const subcategory = cleanText(row.subcategory, "General")
  const sourceName = cleanText(row.sourceName ?? row.fileName, "Statement")
  const originalDescription = cleanText(row.originalDescription ?? row.description ?? merchant, merchant)
  const confidence = Math.max(0, Math.min(1, Number(row.confidence) || 0.75))

  if (!amount || !monthKey || !merchant) return null

  const signature = cleanText(row.signature) || [
    monthKey,
    dateISO || `${monthKey}-01`,
    merchant,
    category,
    subcategory,
    amount.toFixed(2),
    originalDescription,
    sourceName
  ].join("|")

  return {
    id: cleanText(row.id) || makeId(`${signature}|${index}`),
    monthKey,
    dateISO: dateISO || `${monthKey}-01`,
    merchant,
    category,
    subcategory,
    amount,
    originalDescription,
    sourceName,
    confidence,
    signature
  }
}

async function readFileAsText(file: File): Promise<StatementFile> {
  const bytes = new Uint8Array(await file.arrayBuffer())
  const lower = file.name.toLowerCase()
  const type = file.type || ""

  if (lower.endsWith(".xlsx") || lower.endsWith(".xls") || type.includes("spreadsheet") || type.includes("excel")) {
    const workbook = XLSX.read(bytes, { type: "array", cellDates: true })
    const sheets = workbook.SheetNames.map((name: string) => {
      const sheet = workbook.Sheets[name]
      return `SHEET: ${name}\n${XLSX.utils.sheet_to_csv(sheet, { blankrows: false })}`
    })
    return {
      name: file.name,
      type: "excel",
      text: sheets.join("\n\n").slice(0, 90000),
      candidates: uniqueCandidates(extractSheetCandidates(workbook, file.name))
    }
  }

  if (
    lower.endsWith(".csv") ||
    lower.endsWith(".tsv") ||
    lower.endsWith(".txt") ||
    type.includes("csv") ||
    type.includes("text")
  ) {
    const text = new TextDecoder().decode(bytes).slice(0, 90000)
    return {
      name: file.name,
      type: "text",
      text,
      candidates: uniqueCandidates([
        ...extractDelimitedCandidates(text, file.name),
        ...extractPlainTextCandidates(text, file.name)
      ])
    }
  }

  throw new Error(`Unsupported file type: ${file.name}`)
}

function buildCandidatePrompt(candidates: CandidateTransaction[], language: string) {
  return `
The user is building a leak tracker, not a classic budget app.

These candidate spending rows were extracted from uploaded bank/card statements. Categorize and normalize them for the statement review workspace.

Rules:
- Return one transaction for every candidate that is a real expense.
- Do not return zero transactions when candidates are valid expenses.
- Statements can come from any country, bank, currency, language, and date format.
- Use rawDate, dateISO, filename, statement period, and transaction context to correct dates when needed.
- Handle MM/DD/YYYY, DD/MM/YYYY, YYYY-MM-DD, DD.MM.YYYY, month names, decimal commas, decimal points, and local currency symbols.
- Exclude only obvious deposits, refunds, balance rows, internal account transfers, and credit card payoff transfers.
- Rent, groceries, gas, laundry, household basics, ATM cash withdrawals, fees, subscriptions, restaurants, coffee, Uber, clothing, and online shopping are valid expenses.
- Amounts are already positive numbers.
- Categorize by studying the description. Do not trust bank categories if any appear.
- Use clear human categories/subcategories.
- Preserve originalDescription exactly from description.
- Keep sourceName as provided.
- Language preference for category names: ${language || "en"}.

Candidate rows JSON:
${JSON.stringify(candidates.slice(0, 550))}
`
}

function buildPrompt(files: StatementFile[], language: string) {
  const candidates = files.flatMap(file => file.candidates)
  if (candidates.length) {
    return buildCandidatePrompt(candidates, language)
  }

  const joined = files.map((file, index) => `
FILE ${index + 1}: ${file.name}
TYPE: ${file.type}
CONTENT:
${file.text}
`).join("\n\n---\n\n")

  return `
The user is building a leak tracker, not a classic budget app.

Extract spending transactions from these bank or card statement files. The user will later decide what is stable and what is a leak. Your job is only to structure and categorize.

Rules:
- Return expenses only. Exclude payments, transfers between accounts, deposits, refunds, credits, balance rows, fees reversals, and statement metadata.
- Do not return zero transactions if the files contain valid debit card purchases, fees, rent, bills, ATM withdrawals, subscriptions, restaurants, coffee, online shopping, clothing, groceries, gas, or household spending.
- Statements can come from any country, bank, currency, language, and date format.
- Interpret local date formats from context: MM/DD/YYYY, DD/MM/YYYY, YYYY-MM-DD, DD.MM.YYYY, and month names in common languages.
- Interpret local money formats including decimal commas, decimal points, thousands separators, and currency symbols.
- Amounts must be positive numbers.
- Categorize by studying the transaction description, merchant, and context. Do not trust bank-provided categories if they are generic or wrong.
- Use human categories and subcategories such as Groceries, Gas, Laundry, Bills, Household Basics, Coffee, Restaurants, Online Shopping, Clothes, Uber, Transport, Subscriptions, Business Experiments, Extras, Health, Travel, Gifts.
- Preserve the original statement description.
- Use ISO dates when possible.
- Keep sourceName as the uploaded filename.
- confidence should be 0 to 1.
- Language preference for category names: ${language || "en"}.

Files:
${joined}
`
}

function titleCase(value: string) {
  return cleanText(value)
    .toLowerCase()
    .replace(/\b\w/g, c => c.toUpperCase())
}

function categorize(description: string) {
  const text = description.toLowerCase()
  if (/starbucks|coffee|cafe|espresso/.test(text)) return ["Coffee", "Coffee shops"]
  if (/uber|lyft|taxi|trip/.test(text)) return ["Uber", "Rideshare"]
  if (/amazon|amzn|online|etsy|shopify/.test(text)) return ["Online Shopping", "Marketplace"]
  if (/costco|publix|trader joe|whole foods|super marke|grocery/.test(text)) return ["Groceries", "Supermarket"]
  if (/shell|exxon|chevron|mobil|gas|fuel/.test(text)) return ["Gas", "Fuel"]
  if (/restaurant|grill|cafe|doordash|ubereats|mcdonald|burger|pizza|sushi/.test(text)) return ["Restaurants", "Dining"]
  if (/netflix|spotify|apple.com\/bill|subscription/.test(text)) return ["Subscriptions", "Digital subscriptions"]
  if (/fpl|electric|comcast|cable|at&t|mobility|billpay|con edison|geico/.test(text)) return ["Bills", "Recurring bills"]
  if (/target|walgreens|cvs|home depot|clothes|apparel|nike|zara|h&m/.test(text)) return ["Shopping", "Retail"]
  if (/atm|withdrawal|fee/.test(text)) return ["Cash & Fees", "ATM and bank fees"]
  if (/zelle payment to|landlord|rent/.test(text)) return ["Rent", "Housing"]
  return ["Extras", "Other spending"]
}

function merchantFromDescription(description: string) {
  const cleaned = cleanText(description)
    .replace(/\b(POS DEBIT|CHECKCARD|PURCHASE AUTHORIZED ON \d{2}\/\d{2}|RECURRING PAYMENT AUTHORIZED ON \d{2}\/\d{2}|DEBIT CARD PURCHASE|ONLINE BANKING PAYMENT TO)\b/gi, "")
    .replace(/\b(P\d+|CARD \d+|REF#?\s*\w+|WEB ID:\s*\d+|AUTHORIZATION|CONFIRMATION#?)\b.*$/i, "")
    .replace(/\s{2,}/g, " ")
    .trim()
  return titleCase(cleaned.split(/\s{2,}| {1,}(?:MIAMI|NEW YORK|DORAL|WA|CA|FL|NY)\b/i)[0] || cleaned || "Transaction")
}

function heuristicTransactions(files: StatementFile[]) {
  return files.flatMap(file => file.candidates).map((row, index) => {
    const [category, subcategory] = categorize(row.description)
    return normalizeTransaction({
      dateISO: row.dateISO,
      monthKey: row.dateISO.slice(0, 7),
      merchant: merchantFromDescription(row.description),
      category,
      subcategory,
      amount: row.amount,
      originalDescription: row.description,
      sourceName: row.sourceName,
      confidence: 0.58
    }, index)
  }).filter((tx): tx is NormalizedTransaction => !!tx)
}

function dedupeTransactions(rows: NormalizedTransaction[]) {
  const seen = new Set<string>()
  return rows.filter(tx => {
    const identity = [
      tx.sourceName,
      tx.dateISO,
      tx.amount.toFixed(2),
      normalizeText(tx.originalDescription || tx.merchant)
    ].join("|")
    if (seen.has(identity)) return false
    seen.add(identity)
    return true
  })
}

function normalizeRows(rows: Record<string, unknown>[]) {
  return rows
    .map((row: Record<string, unknown>, index: number) => normalizeTransaction(row, index))
    .filter((tx: NormalizedTransaction | null): tx is NormalizedTransaction => !!tx)
}

function getToolRows(result: Record<string, unknown>) {
  const content = result.content
  const toolUse = Array.isArray(content)
    ? content.find((item: Record<string, unknown>) => item.type === "tool_use" && item.name === "return_statement_review")
    : null
  const toolInput = toolUse && typeof toolUse.input === "object" && toolUse.input
    ? toolUse.input as { transactions?: unknown }
    : {}
  return Array.isArray(toolInput.transactions) ? toolInput.transactions as Record<string, unknown>[] : []
}

async function requestClaudeTransactions(anthropicKey: string, model: string, inputSchema: Record<string, unknown>, prompt: string) {
  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": anthropicKey,
      "anthropic-version": "2023-06-01"
    },
    body: JSON.stringify({
      model,
      max_tokens: 8192,
      temperature: 0,
      system: "You are a careful financial transaction extraction engine. Return only structured data through the provided tool. Never give financial advice or decide the user's budget.",
      tools: [{
        name: "return_statement_review",
        description: "Return normalized spending transactions for the leak tracker review workspace.",
        input_schema: inputSchema
      }],
      tool_choice: { type: "tool", name: "return_statement_review" },
      messages: [{ role: "user", content: prompt }]
    })
  })

  const result = await response.json().catch(() => ({})) as Record<string, unknown>
  if (!response.ok) {
    const error = result.error as { message?: string } | undefined
    return {
      rows: [] as Record<string, unknown>[],
      error: error?.message || "AI extraction failed.",
      status: response.status
    }
  }

  return {
    rows: getToolRows(result),
    error: "",
    status: response.status
  }
}

Deno.serve(async req => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS_HEADERS })
  if (req.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405)

  const anthropicKey = Deno.env.get("ANTHROPIC_API_KEY")
  if (!anthropicKey) {
    return jsonResponse({ error: "AI analysis is not configured yet." }, 503)
  }

  try {
    const form = await req.formData()
    const language = cleanText(form.get("language"), "en")
    const uploads = form.getAll("files").filter((item): item is File => item instanceof File)

    if (!uploads.length) return jsonResponse({ error: "Upload at least one statement file." }, 400)
    if (uploads.length > 6) return jsonResponse({ error: "Upload up to 6 files at a time." }, 400)

    const files = await Promise.all(uploads.map(readFileAsText))
    const model = Deno.env.get("ANTHROPIC_MODEL") || "claude-haiku-4-5-20251001"

    const inputSchema = {
      type: "object",
      additionalProperties: false,
      properties: {
        transactions: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            properties: {
              dateISO: { type: "string" },
              monthKey: { type: "string" },
              merchant: { type: "string" },
              category: { type: "string" },
              subcategory: { type: "string" },
              amount: { type: "number" },
              originalDescription: { type: "string" },
              sourceName: { type: "string" },
              confidence: { type: "number" }
            },
            required: ["dateISO", "monthKey", "merchant", "category", "subcategory", "amount", "originalDescription", "sourceName", "confidence"]
          }
        }
      },
      required: ["transactions"]
    }

    let claudeRows: Record<string, unknown>[] = []
    const firstPass = await requestClaudeTransactions(anthropicKey, model, inputSchema, buildPrompt(files, language))
    if (firstPass.error) {
      const fallbackTransactions = dedupeTransactions(heuristicTransactions(files))
      if (fallbackTransactions.length) {
        return jsonResponse({
          transactions: fallbackTransactions,
          files: files.map(file => ({
            name: file.name,
            transactionCount: fallbackTransactions.filter((tx: NormalizedTransaction) => tx.sourceName === file.name).length
          })),
          model,
          source: "local-fallback",
          warning: firstPass.error
        })
      }
      return jsonResponse({ error: firstPass.error }, firstPass.status || 500)
    }
    claudeRows = firstPass.rows

    const candidates = files.flatMap(file => file.candidates)
    let aiTransactions = normalizeRows(claudeRows)
    if (!aiTransactions.length && candidates.length > 45) {
      claudeRows = []
      const chunks: CandidateTransaction[][] = []
      for (let i = 0; i < candidates.length; i += 35) chunks.push(candidates.slice(i, i + 35))
      for (const chunk of chunks) {
        const pass = await requestClaudeTransactions(anthropicKey, model, inputSchema, buildCandidatePrompt(chunk, language))
        if (!pass.error && pass.rows.length) claudeRows.push(...pass.rows)
      }
      aiTransactions = normalizeRows(claudeRows)
    }

    const fallbackTransactions = heuristicTransactions(files)
    const transactions = dedupeTransactions(aiTransactions.length
      ? [...aiTransactions, ...fallbackTransactions]
      : fallbackTransactions)

    return jsonResponse({
      transactions,
      files: files.map(file => ({
        name: file.name,
        transactionCount: transactions.filter((tx: NormalizedTransaction) => tx.sourceName === file.name).length
      })),
      model,
      source: aiTransactions.length ? "claude-plus-local" : "local-fallback"
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not analyze statements."
    return jsonResponse({ error: message }, 500)
  }
})
