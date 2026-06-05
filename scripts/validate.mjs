/*
 * ArabSeed Shield - build/release validator (dependency-free)
 *
 * Verifies the unpacked extension is internally consistent before a release:
 *  - manifest.json parses and references files that exist
 *  - DNR rule files parse, have unique integer IDs, and stay inside the
 *    category ID ranges that service_worker.js relies on for stats
 *
 * Run with: node scripts/validate.mjs   (exits non-zero on any problem)
 */

import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const errors = [];
const note = (msg) => console.log("  " + msg);

function readJSON(relPath) {
  const abs = join(ROOT, relPath);
  if (!existsSync(abs)) {
    errors.push(`Missing file: ${relPath}`);
    return null;
  }
  try {
    return JSON.parse(readFileSync(abs, "utf8"));
  } catch (err) {
    errors.push(`Invalid JSON in ${relPath}: ${err.message}`);
    return null;
  }
}

function fileExists(relPath) {
  return existsSync(join(ROOT, relPath));
}

// 1) Manifest + referenced assets.
const manifest = readJSON("manifest.json");
if (manifest) {
  note(`manifest.json parsed (v${manifest.version})`);
  const referenced = new Set();
  for (const size of Object.values(manifest.icons || {})) referenced.add(size);
  for (const size of Object.values((manifest.action && manifest.action.default_icon) || {})) {
    referenced.add(size);
  }
  if (manifest.action && manifest.action.default_popup) referenced.add(manifest.action.default_popup);
  if (manifest.options_page) referenced.add(manifest.options_page);
  if (manifest.background && manifest.background.service_worker) {
    referenced.add(manifest.background.service_worker);
  }
  for (const cs of manifest.content_scripts || []) {
    for (const js of cs.js || []) referenced.add(js);
  }
  for (const res of (manifest.declarative_net_request || {}).rule_resources || []) {
    if (res.path) referenced.add(res.path);
  }
  for (const ref of referenced) {
    if (!fileExists(ref)) errors.push(`manifest references missing file: ${ref}`);
  }
  note(`checked ${referenced.size} referenced files`);

  for (const size of Object.values(manifest.icons || {})) {
    if (!String(size).toLowerCase().endsWith(".png")) {
      errors.push(`icon should be PNG for Chromium toolbar support: ${size}`);
    }
  }
}

// 2) DNR rule files: parse, unique integer IDs, inside expected ranges.
const RULE_FILES = [
  { path: "rules/static_rules.json", min: 1, max: 4999 },
  { path: "rules/strict_rules.json", min: 5000, max: 5999 }
];
const seenIds = new Map();
for (const file of RULE_FILES) {
  const rules = readJSON(file.path);
  if (!Array.isArray(rules)) {
    if (rules !== null) errors.push(`${file.path} must be a JSON array`);
    continue;
  }
  for (const rule of rules) {
    if (!Number.isInteger(rule.id)) {
      errors.push(`${file.path}: rule id must be an integer (got ${JSON.stringify(rule.id)})`);
      continue;
    }
    if (rule.id < file.min || rule.id > file.max) {
      errors.push(`${file.path}: rule id ${rule.id} outside range ${file.min}-${file.max}`);
    }
    if (seenIds.has(rule.id)) {
      errors.push(`Duplicate rule id ${rule.id} (in ${seenIds.get(rule.id)} and ${file.path})`);
    } else {
      seenIds.set(rule.id, file.path);
    }
    if (!rule.action || typeof rule.action.type !== "string") {
      errors.push(`${file.path}: rule ${rule.id} missing action.type`);
    }
    if (!rule.condition || typeof rule.condition !== "object") {
      errors.push(`${file.path}: rule ${rule.id} missing condition`);
    }
    if (!Number.isInteger(rule.priority) || rule.priority < 1) {
      errors.push(`${file.path}: rule ${rule.id} priority must be a positive integer`);
    }
  }
  note(`${file.path}: ${rules.length} rules checked`);
}

if (errors.length) {
  console.error(`\nVALIDATION FAILED (${errors.length} problem(s)):`);
  for (const e of errors) console.error("  - " + e);
  process.exit(1);
}
console.log("\nValidation passed.");
