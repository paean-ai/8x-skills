#!/usr/bin/env node
/** Audit deterministic mini-tool package and text-file size limits. */

import fs from "node:fs";
import path from "node:path";
import { zipEntries } from "./zip.mjs";

const MIB = 1024 * 1024;
const ZIP_LIMIT = 10 * MIB;
const ZIP_RECOMMENDED = 2 * MIB;
const TEXT_FILE_WARNING = 2 * MIB;
const TEXT_TOTAL_WARNING = 5 * MIB;
const TEXT_SUFFIXES = new Set([".html", ".css", ".js", ".json"]);

function formatSize(size) {
  return `${(size / MIB).toFixed(2)} MiB`;
}

function walkDirectory(root) {
  const files = [];
  function walk(current) {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      if (entry.name === ".git") continue;
      const target = path.join(current, entry.name);
      if (entry.isDirectory()) walk(target);
      else if (entry.isFile()) files.push(target);
    }
  }
  walk(root);
  return files;
}

/** Shared entry audit: per-file and total uncompressed text budgets. */
function auditEntries(entries) {
  const warnings = [];
  let textTotal = 0;
  for (const { name, size } of entries) {
    if (!TEXT_SUFFIXES.has(path.extname(name).toLowerCase())) continue;
    textTotal += size;
    if (size > TEXT_FILE_WARNING) {
      warnings.push(`${name}: text file is ${formatSize(size)}; review parse and memory cost`);
    }
  }
  if (textTotal > TEXT_TOTAL_WARNING) {
    warnings.push(`uncompressed HTML/CSS/JS/JSON total is ${formatSize(textTotal)}; review for embedded databases or generated content`);
  }
  return warnings;
}

function auditDirectory(root) {
  const entries = walkDirectory(root).map((file) => ({
    name: path.relative(root, file).split(path.sep).join("/"),
    size: fs.statSync(file).size,
  }));
  return { errors: [], warnings: auditEntries(entries), count: entries.length };
}

// Reads the archive's central directory in-process (see zip.mjs) so the Node
// auditor covers exactly what the Python one does — no `python3` required, which
// matters on Windows where it is usually `python` or absent.
function auditZip(file) {
  const errors = [];
  const warnings = [];
  const size = fs.statSync(file).size;
  if (size > ZIP_LIMIT) errors.push(`${path.basename(file)}: zip is ${formatSize(size)}; hard limit is 10 MiB`);
  else if (size > ZIP_RECOMMENDED) warnings.push(`${path.basename(file)}: zip is ${formatSize(size)}; recommended target is 2 MiB`);
  const entries = zipEntries(fs.readFileSync(file));
  warnings.push(...auditEntries(entries));
  return { errors, warnings, count: entries.length };
}

function main() {
  const target = process.argv[2];
  if (!target) {
    console.error("Usage: node audit-minitool.mjs <artifact-directory-or-zip>");
    return 2;
  }
  const resolved = path.resolve(target);
  if (!fs.existsSync(resolved)) {
    console.error(`ERROR: path not found: ${resolved}`);
    return 2;
  }

  let result;
  try {
    result = fs.statSync(resolved).isDirectory()
      ? auditDirectory(resolved)
      : auditZip(resolved);
  } catch (error) {
    console.error(`ERROR: cannot inspect ${resolved}: ${error.message}`);
    return 2;
  }

  for (const message of result.errors) console.log(`ERROR: ${message}`);
  for (const message of result.warnings) console.log(`WARN: ${message}`);
  if (result.errors.length) {
    console.log(`FAILED: ${result.errors.length} error(s), ${result.warnings.length} warning(s)`);
    return 1;
  }
  console.log(`PASS: ${result.count} file(s), ${result.warnings.length} warning(s)`);
  return 0;
}

process.exitCode = main();
