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

function toDateISO(value: unknown) {
  const raw = cleanText(value)
  if (!raw) return ""

  const direct = raw.match(/\b(20\d{2}|19\d{2})[-/](\d{1,2})[-/](\d{1,2})\b/)
  if (direct) {
    const year = direct[1]
    const month = direct[2].padStart(2, "0")
    const day = direct[3].padStart(2, "0")
    return `${year}-${month}-${day}`
  }

  const us = raw.match(/\b(\d{1,2})[-/](\d{1,2})[-/](20\d{2}|19\d{2}|\d{2})\b/)
  if (us) {
    const year = us[3].length === 2 ? `20${us[3]}` : us[3]
    const month = us[1].padStart(2, "0")
    const day = us[2].padStart(2, "0")
    return `${year}-${month}-${day}`
  }

  const parsed = Date.parse(raw)
  if (Number.isFinite(parsed)) return new Date(parsed).toISOString().slice(0, 10)
  return ""
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
    return { name: file.name, type: "excel", text: sheets.join("\n\n").slice(0, 90000) }
  }

  if (
    lower.endsWith(".csv") ||
    lower.endsWith(".tsv") ||
    lower.endsWith(".txt") ||
    type.includes("csv") ||
    type.includes("text")
  ) {
    return { name: file.name, type: "text", text: new TextDecoder().decode(bytes).slice(0, 90000) }
  }

  throw new Error(`Unsupported file type: ${file.name}`)
}

function buildPrompt(files: StatementFile[], language: string) {
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
    const model = Deno.env.get("ANTHROPIC_MODEL") || "claude-3-5-haiku-20241022"

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
        messages: [{ role: "user", content: buildPrompt(files, language) }]
      })
    })

    const result = await response.json().catch(() => ({}))
    if (!response.ok) {
      const message = result?.error?.message || "AI extraction failed."
      return jsonResponse({ error: message }, response.status)
    }

    const toolUse = Array.isArray(result.content)
      ? result.content.find((item: Record<string, unknown>) => item.type === "tool_use" && item.name === "return_statement_review")
      : null
    const rows = Array.isArray(toolUse?.input?.transactions) ? toolUse.input.transactions : []
    const seen = new Set<string>()
    const transactions = rows
      .map((row: Record<string, unknown>, index: number) => normalizeTransaction(row, index))
      .filter((tx: NormalizedTransaction | null): tx is NormalizedTransaction => {
        if (!tx || seen.has(tx.signature)) return false
        seen.add(tx.signature)
        return true
      })

    return jsonResponse({
      transactions,
      files: files.map(file => ({
        name: file.name,
        transactionCount: transactions.filter((tx: NormalizedTransaction) => tx.sourceName === file.name).length
      })),
      model
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not analyze statements."
    return jsonResponse({ error: message }, 500)
  }
})
