import {
  SUPPLIER_EXTRACTION_JSON_SCHEMA,
  computeOutputSchemaHash,
  sha256Hex,
  type SupplierExtraction,
} from "@poolguard/shared";

/**
 * Deterministic supplier-document extraction.
 *
 * This is the paid work: it consumes the supplied text and returns structured data
 * with line-level evidence. It is rule-based, not an LLM, so the same input always
 * produces the same output. That makes the provider's behaviour auditable and keeps
 * the demo's "useful result" separate from AI inference costs.
 */
export const EXTRACTION_ENGINE = "rules-v1";
export const OUTPUT_SCHEMA_HASH = computeOutputSchemaHash(SUPPLIER_EXTRACTION_JSON_SCHEMA);

interface Evidence {
  line: number;
  quote: string;
}

const CURRENCY_SYMBOLS: Record<string, string> = { $: "USD", "€": "EUR", "£": "GBP" };
const AMOUNT_PATTERN =
  /(?:(USD|EUR|GBP)|\$|€|£)\s*([0-9][0-9,]*(?:\.[0-9]{1,2})?)|([0-9][0-9,]*(?:\.[0-9]{1,2})?)\s*(USD|EUR|GBP)/gi;

const INJECTION_PATTERN =
  /ignore (?:all |any )?(?:previous|prior|above) instructions|send (?:the )?(?:payment|funds|near)|transfer (?:the )?(?:funds|payment|money)|increase (?:the )?(?:limit|budget|cap)|add (?:a )?(?:new )?(?:provider|vendor|recipient)|change (?:the )?(?:recipient|provider|allowlist)|private key|seed phrase|system prompt|jailbreak|attacker|exfiltrat/i;

const DELIVERY_PATTERN =
  /\b(delivery|deliver|lead time|incoterm|fob|ddp|dap|exw|shipping|ships?|weeks?|days?)\b/i;

function evidence(lineNumber: number, text: string): Evidence {
  return { line: lineNumber, quote: text.trim().slice(0, 300) };
}

function cleanInline(value: string): string {
  return value.replace(/\s+/g, " ").trim().replace(/[.;,]+$/, "");
}

function findLabeled(lines: string[], labels: RegExp): { value: string; line: number } | null {
  for (let i = 0; i < lines.length; i++) {
    const match = labels.exec(lines[i]!);
    if (match?.[1]) return { value: cleanInline(match[1]), line: i + 1 };
  }
  return null;
}

function parseQuotes(lines: string[]): Array<{ amount: string; currency: string; raw: string; evidence: Evidence[] }> {
  const quotes: Array<{ amount: string; currency: string; raw: string; evidence: Evidence[] }> = [];
  const seen = new Set<string>();
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    // Skip adversarial lines from being interpreted as legitimate prices, but keep
    // the warning elsewhere so the demo can show the attempt safely.
    if (INJECTION_PATTERN.test(line)) continue;
    AMOUNT_PATTERN.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = AMOUNT_PATTERN.exec(line)) !== null) {
      const currency = (match[1] ?? match[4] ?? CURRENCY_SYMBOLS[line[match.index]!] ?? "").toUpperCase();
      const amount = (match[2] ?? match[3] ?? "").replace(/,/g, "");
      if (!amount || !currency) continue;
      const key = `${currency}:${amount}`;
      if (seen.has(key)) continue;
      seen.add(key);
      quotes.push({
        amount,
        currency,
        raw: match[0].trim(),
        evidence: [evidence(i + 1, line)],
      });
      if (quotes.length >= 20) return quotes;
    }
  }
  return quotes;
}

function parseProducts(lines: string[]): Array<{
  name: string;
  quantity: string | null;
  unit: string | null;
  evidence: Evidence[];
}> {
  const products: Array<{ name: string; quantity: string | null; unit: string | null; evidence: Evidence[] }> = [];
  let inProducts = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!.trim();
    if (!line) {
      if (inProducts && products.length > 0) inProducts = false;
      continue;
    }
    if (/^(products?|items?|goods|services?)\b[:\s]*$/i.test(line)) {
      inProducts = true;
      continue;
    }
    const labeled = /^(?:product|item|service)\s*[:\-]\s*(.+)$/i.exec(line);
    const bullet = /^[-*•]\s+(.+)$/.exec(line);
    const candidate = labeled?.[1] ?? (inProducts ? bullet?.[1] : undefined);
    if (!candidate) continue;
    if (INJECTION_PATTERN.test(candidate)) continue;
    const quantityMatch = /(?:^|\s)([0-9][0-9,]*)\s*(units?|pcs|pieces|kg|tons?|boxes?|sets?|litres?|meters?)\b/i.exec(
      candidate,
    );
    const name = cleanInline(candidate.replace(/(?:^|\s)[0-9][0-9,]*\s*(?:units?|pcs|pieces|kg|tons?|boxes?|sets?|litres?|meters?)\b/i, " "));
    products.push({
      name: name || cleanInline(candidate),
      quantity: quantityMatch ? quantityMatch[1]!.replace(/,/g, "") : null,
      unit: quantityMatch ? quantityMatch[2]!.toLowerCase() : null,
      evidence: [evidence(i + 1, line)],
    });
    if (products.length >= 40) break;
  }
  return products;
}

export interface ExtractionInput {
  serviceKey: string;
  providerAccountId: string;
  label: string;
  text: string;
  now?: Date;
}

export function extractSupplierDocument(input: ExtractionInput): SupplierExtraction {
  const text = input.text.replace(/\r\n/g, "\n");
  const lines = text.split("\n");
  const documentHash = sha256Hex(text);

  const supplier = findLabeled(lines, /^\s*(?:supplier|company|vendor|from)\s*[:\-]\s*(.+)$/i);
  const products = parseProducts(lines);
  const quotes = parseQuotes(lines);

  const deliveryTerms: string[] = [];
  const deliveryEvidence: Evidence[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (DELIVERY_PATTERN.test(line) && !INJECTION_PATTERN.test(line)) {
      const term = cleanInline(line.replace(/^\s*(?:delivery|lead time|shipping)\s*[:\-]\s*/i, ""));
      if (term) {
        deliveryTerms.push(term.slice(0, 200));
        deliveryEvidence.push(evidence(i + 1, line));
      }
    }
    if (deliveryTerms.length >= 20) break;
  }

  const warnings: string[] = [];
  const injectionLines: number[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (INJECTION_PATTERN.test(lines[i]!)) injectionLines.push(i + 1);
  }
  if (injectionLines.length > 0) {
    warnings.push(
      `Untrusted instruction text detected on line(s) ${injectionLines.slice(0, 5).join(", ")}. It was treated as document content, never as an instruction.`,
    );
  }
  if (quotes.length === 0) warnings.push("No explicit monetary quote was found.");
  if (products.length === 0) warnings.push("No product or service lines were recognized.");
  if (deliveryTerms.length === 0) warnings.push("No delivery terms were found.");

  const missing: string[] = [];
  if (!supplier?.value) missing.push("supplier name");
  if (products.length === 0) missing.push("products or services");
  if (quotes.length === 0) missing.push("quoted amount");
  if (quotes.every((quote) => !quote.currency)) missing.push("quote currency");
  if (deliveryTerms.length === 0) missing.push("delivery terms");
  if (!/\b(?:payment terms|net\s?\d+|due (?:on|within))\b/i.test(text)) missing.push("payment terms");

  return {
    schema_version: "1.0.0",
    service_key: input.serviceKey,
    supplier: {
      name: supplier?.value ?? null,
      confidence: supplier ? 0.9 : 0.3,
      evidence: supplier ? [evidence(supplier.line, lines[supplier.line - 1] ?? supplier.value)] : [],
    },
    products,
    quotes,
    delivery: { terms: deliveryTerms, evidence: deliveryEvidence.slice(0, 12) },
    missing_fields: missing,
    warnings,
    document: {
      label: input.label.slice(0, 120),
      sha256: documentHash,
      characters: text.length,
      lines: lines.length,
    },
    processed_at: (input.now ?? new Date()).toISOString(),
    engine: EXTRACTION_ENGINE,
  };
}

/** Structured comparison assembled from both agents' provider results. */
export function compareSupplierExtractions(
  entries: Array<{ agentLabel: string; documentLabel: string; result: SupplierExtraction }>,
): {
  suppliers: Array<{
    agentLabel: string;
    documentLabel: string;
    supplier: string | null;
    quotes: Array<{ amount: string; currency: string }>;
    deliveryTerms: string[];
    missingFields: string[];
    warnings: string[];
    resultHash: string;
  }>;
  differences: string[];
  incomplete: boolean;
} {
  const suppliers = entries.map((entry) => ({
    agentLabel: entry.agentLabel,
    documentLabel: entry.documentLabel,
    supplier: entry.result.supplier.name,
    quotes: entry.result.quotes.map((quote) => ({ amount: quote.amount, currency: quote.currency })),
    deliveryTerms: entry.result.delivery.terms,
    missingFields: entry.result.missing_fields,
    warnings: entry.result.warnings,
    resultHash: sha256Hex(JSON.stringify(entry.result)),
  }));

  const differences: string[] = [];
  if (new Set(suppliers.map((entry) => entry.supplier ?? "unknown")).size > 1) {
    differences.push("The documents name different suppliers.");
  }
  const currencies = new Set(suppliers.flatMap((entry) => entry.quotes.map((quote) => quote.currency)));
  if (currencies.size > 1) differences.push(`Quotes use different currencies: ${[...currencies].join(", ")}.`);
  if (suppliers.some((entry) => entry.missingFields.length > 0)) {
    differences.push("At least one document has missing required fields.");
  }
  if (suppliers.some((entry) => entry.warnings.length > 0)) {
    differences.push("At least one document contains flagged or untrusted text.");
  }

  return { suppliers, differences, incomplete: entries.length < 2 };
}
