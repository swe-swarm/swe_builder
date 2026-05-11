/**
 * Document conversion module.
 *
 * Replaces Python MarkItDown with pure-JS alternatives:
 * - docx → markdown: mammoth + turndown
 * - xlsx/xls → csv: xlsx (SheetJS)
 * - Encrypted detection: ZIP header check
 */

const fs = require("fs");
const path = require("path");

// Lazy-load heavy modules only when needed
let _mammoth, _TurndownService, _XLSX;

function getMammoth() {
  if (!_mammoth) _mammoth = require("mammoth");
  return _mammoth;
}

function getTurndown() {
  if (!_TurndownService) _TurndownService = require("turndown");
  return _TurndownService;
}

function getXLSX() {
  if (!_XLSX) _XLSX = require("xlsx");
  return _XLSX;
}

// ---------------------------------------------------------------------------
// Encrypted file detection
// ---------------------------------------------------------------------------

/**
 * Check if a file is a valid ZIP archive (docx/pptx/xlsx are ZIP-based).
 * Encrypted Office files are OLE2 containers, not ZIP.
 */
function isZipFile(filePath) {
  let fd;
  try {
    fd = fs.openSync(filePath, "r");
    const buf = Buffer.alloc(4);
    fs.readSync(fd, buf, 0, 4, 0);
    // ZIP magic number: PK\x03\x04
    return buf[0] === 0x50 && buf[1] === 0x4b && buf[2] === 0x03 && buf[3] === 0x04;
  } catch {
    return false;
  } finally {
    if (fd !== undefined) try { fs.closeSync(fd); } catch {}
  }
}

/**
 * Check if an Office file is encrypted/protected.
 * Returns true if the file extension suggests ZIP but the content is not ZIP.
 */
function isEncryptedOfficeFile(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if ([".docx", ".pptx", ".xlsx"].includes(ext)) {
    return !isZipFile(filePath);
  }
  return false;
}

// ---------------------------------------------------------------------------
// Conversion functions
// ---------------------------------------------------------------------------

/**
 * Convert a .docx file to markdown.
 * Returns the markdown text, or null on failure.
 */
async function docxToMarkdown(filePath) {
  const mammoth = getMammoth();
  const TurndownService = getTurndown();

  const result = await mammoth.convertToHtml({ path: filePath });
  if (!result.value || !result.value.trim()) return null;

  const turndown = new TurndownService({
    headingStyle: "atx",
    codeBlockStyle: "fenced",
  });
  return turndown.turndown(result.value);
}

/**
 * Convert an .xlsx/.xls file to CSV.
 * Returns the CSV text, or null on failure.
 */
function excelToCsv(filePath) {
  const XLSX = getXLSX();
  const workbook = XLSX.readFile(filePath);
  const sheetName = workbook.SheetNames[0];
  if (!sheetName) return null;
  const sheet = workbook.Sheets[sheetName];
  return XLSX.utils.sheet_to_csv(sheet);
}

// ---------------------------------------------------------------------------
// Main conversion entry point
// ---------------------------------------------------------------------------

/** File extensions that need conversion */
const NEEDS_CONVERSION = new Set([".docx", ".pptx", ".xlsx", ".xls"]);

/**
 * Convert a binary Office file to a readable format.
 *
 * @param {string} filePath - Path to the uploaded file
 * @param {string} docsDir - Directory where converted file should be saved
 * @returns {{ convertedName: string|null, error: string|null }}
 */
async function convertDocument(filePath, docsDir) {
  const ext = path.extname(filePath).toLowerCase();
  const baseName = path.basename(filePath, path.extname(filePath));

  if (!NEEDS_CONVERSION.has(ext)) {
    return { convertedName: null, error: null };
  }

  // Check for encrypted files
  if (isEncryptedOfficeFile(filePath)) {
    return {
      convertedName: null,
      error:
        "This file appears to be encrypted or protected (e.g. Microsoft Information " +
        "Protection). Please remove the protection in the original application and " +
        "re-upload, or paste the content as text instead.",
    };
  }

  try {
    if (ext === ".xlsx" || ext === ".xls") {
      const csv = excelToCsv(filePath);
      if (csv && csv.trim()) {
        const outName = `${baseName}.csv`;
        fs.writeFileSync(path.join(docsDir, outName), csv, "utf-8");
        // Delete original binary
        fs.unlinkSync(filePath);
        return { convertedName: outName, error: null };
      }
      return { convertedName: null, error: "No data extracted from spreadsheet" };
    }

    if (ext === ".docx") {
      const md = await docxToMarkdown(filePath);
      if (md && md.trim()) {
        const outName = `${baseName}.md`;
        fs.writeFileSync(path.join(docsDir, outName), md, "utf-8");
        // Delete original binary
        fs.unlinkSync(filePath);
        return { convertedName: outName, error: null };
      }
      return {
        convertedName: null,
        error: "No text extracted (file may be empty or password-protected)",
      };
    }

    if (ext === ".pptx") {
      // mammoth doesn't support pptx — keep original
      // Future: could use a pptx-specific library
      return {
        convertedName: null,
        error: "PowerPoint conversion not yet supported — file kept as-is",
      };
    }
  } catch (e) {
    return {
      convertedName: null,
      error: `Text extraction failed: ${String(e).slice(0, 200)}`,
    };
  }

  return { convertedName: null, error: null };
}

/**
 * Extract text content from a document for preview (on-demand).
 *
 * @param {string} filePath - Path to the document
 * @returns {{ content: string, error: string|null }}
 */
async function extractContent(filePath) {
  const ext = path.extname(filePath).toLowerCase();

  // Text files: read directly
  if ([".md", ".csv", ".txt", ".json"].includes(ext)) {
    const content = fs.readFileSync(filePath, "utf-8");
    return { content, error: null };
  }

  // Binary Office docs: extract on demand
  if ([".docx", ".pptx", ".xlsx", ".xls"].includes(ext)) {
    if (isEncryptedOfficeFile(filePath)) {
      return {
        content: "",
        error: "This file is encrypted or protected and cannot be previewed.",
      };
    }

    try {
      if (ext === ".docx") {
        const md = await docxToMarkdown(filePath);
        return { content: md || "", error: null };
      }
      if (ext === ".xlsx" || ext === ".xls") {
        const csv = excelToCsv(filePath);
        return { content: csv || "", error: null };
      }
    } catch (e) {
      return { content: "", error: `Extraction failed: ${String(e).slice(0, 200)}` };
    }
  }

  return { content: "", error: null };
}

module.exports = {
  NEEDS_CONVERSION,
  isZipFile,
  isEncryptedOfficeFile,
  convertDocument,
  extractContent,
  docxToMarkdown,
  excelToCsv,
};
