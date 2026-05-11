import type { EvalSet, EvalMethod } from "@/types";
import { downloadFile } from "./reportGenerator";

/** CSV-escape a field: wrap in quotes if it contains commas, quotes, or newlines. */
function csvEscape(value: string): string {
  if (/[",\n\r]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

/** Pick the first CSV-eligible method (skips "Tool use"). */
function pickCsvMethod(testMethods: EvalMethod[] | null | undefined, setMethods: EvalMethod[]): string {
  const methods = testMethods?.length ? testMethods : setMethods;
  const eligible = methods.find((m) => m.type !== "Tool use");
  return eligible?.type ?? setMethods[0]?.type ?? "General quality";
}

/** Resolve the "Expected response" value for CSV: use keywords for Keyword match, otherwise expected. */
function csvExpectedValue(test: { expected?: string; keywords?: string | null }, method: string): string {
  if (method === "Keyword match" && test.keywords) return test.keywords;
  return test.expected ?? "";
}

/** Sanitize a string for use in a filename. */
function sanitizeFilename(name: string): string {
  return name.replace(/[^a-zA-Z0-9_-]/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");
}

/** Generate CSV string from an eval set (MCS native eval import format + Keywords column). */
export function generateEvalCsv(set: EvalSet): string {
  const rows = ["Question,Expected response,Testing method,Keywords"];
  const tests = set.tests.slice(0, 100); // MCS limit: 100 questions per CSV
  for (const test of tests) {
    if (!test.question?.trim()) continue;
    const method = pickCsvMethod(test.methods, set.methods);
    const expected = csvExpectedValue(test, method);
    const keywords = test.keywords ?? "";
    rows.push(
      `${csvEscape(test.question)},${csvEscape(expected)},${csvEscape(method)},${csvEscape(keywords)}`
    );
  }
  return rows.join("\n");
}

/** Download a single eval set as CSV. */
export function downloadEvalCsv(set: EvalSet, agentName?: string): void {
  if (set.tests.length === 0) return;
  const csv = generateEvalCsv(set);
  const prefix = agentName ? `${sanitizeFilename(agentName)}-` : "";
  downloadFile(csv, `${prefix}evals-${sanitizeFilename(set.name)}.csv`, "text/csv");
}

/** Download all non-empty eval sets as CSVs with a small delay between each. */
export function downloadAllEvalCsvs(sets: EvalSet[], agentName?: string): void {
  const nonEmpty = sets.filter((s) => s.tests.length > 0);
  nonEmpty.forEach((set, i) => {
    setTimeout(() => downloadEvalCsv(set, agentName), i * 300);
  });
}
