#!/usr/bin/env node
/**
 * Validate benchmark threshold configuration without running benchmarks.
 *
 * This is intentionally dependency-free so CI can run it for threshold-only
 * changes without installing packages or executing the expensive bench suites.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, "..");

const files = [
  {
    path: "test/bench/thresholds.json",
    metric: "p995",
    allowDerived: true,
    allowFormula: true,
  },
  {
    path: "test/bench/perf-integration-thresholds.json",
    metric: "p95",
    allowDerived: false,
    allowFormula: false,
  },
];

const errors = [];

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isPositiveNumber(value) {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function validateOptionalNumber(value, key, filePath, index) {
  if (value === undefined) {
    return;
  }
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    errors.push(`${filePath}: thresholds[${index}].${key} must be a non-negative number`);
  }
}

function validateRule(rule, filePath, index) {
  if (!isObject(rule)) {
    errors.push(`${filePath}: thresholds[${index}] must be an object`);
    return;
  }

  const hasName = typeof rule.name === "string" && rule.name.length > 0;
  const hasPattern = typeof rule.namePattern === "string" && rule.namePattern.length > 0;
  if (hasName === hasPattern) {
    errors.push(`${filePath}: thresholds[${index}] must define exactly one of name or namePattern`);
  }
  if (hasPattern) {
    try {
      new RegExp(rule.namePattern);
    } catch (error) {
      errors.push(`${filePath}: thresholds[${index}].namePattern is invalid: ${error.message}`);
    }
  }

  if (!isPositiveNumber(rule.maxMs)) {
    errors.push(`${filePath}: thresholds[${index}].maxMs must be a positive number`);
  }

  validateOptionalNumber(rule.baselineMs, "baselineMs", filePath, index);
  validateOptionalNumber(rule.statisticalMarginMs, "statisticalMarginMs", filePath, index);
  validateOptionalNumber(rule.rawMaxMs, "rawMaxMs", filePath, index);

  if (rule.derive !== undefined && typeof rule.derive !== "string") {
    errors.push(`${filePath}: thresholds[${index}].derive must be a string when present`);
  }
}

function validateThresholdFile({ path, metric, allowDerived, allowFormula }) {
  const fullPath = join(repoRoot, path);
  let parsed;
  const text = readFileSync(fullPath, "utf-8");

  try {
    parsed = JSON.parse(text);
  } catch (error) {
    errors.push(`${path}: invalid JSON: ${error.message}`);
    return;
  }

  const expectedText = `${JSON.stringify(parsed, null, 2)}\n`;
  if (text !== expectedText) {
    errors.push(
      `${path}: must be formatted as JSON.stringify(value, null, 2) plus trailing newline`,
    );
  }

  if (!isObject(parsed)) {
    errors.push(`${path}: root value must be an object`);
    return;
  }
  if (parsed.metric !== metric) {
    errors.push(`${path}: metric must be ${JSON.stringify(metric)}`);
  }
  if (!Array.isArray(parsed.thresholds) || parsed.thresholds.length === 0) {
    errors.push(`${path}: thresholds must be a non-empty array`);
    return;
  }

  const seen = new Set();
  parsed.thresholds.forEach((rule, index) => {
    validateRule(rule, path, index);
    const key = rule?.name ?? rule?.namePattern;
    if (typeof key === "string") {
      if (seen.has(key)) {
        errors.push(`${path}: duplicate threshold rule ${JSON.stringify(key)}`);
      }
      seen.add(key);
    }
  });

  if (parsed.derived !== undefined) {
    if (!allowDerived) {
      errors.push(`${path}: derived thresholds are not supported for this file`);
    } else {
      const tokenize = parsed.derived?.tokenize;
      if (!isObject(tokenize)) {
        errors.push(`${path}: derived.tokenize must be an object`);
      } else {
        for (const key of ["minLines", "absoluteFloorMsPerLine", "maxMsPerLine"]) {
          if (!isPositiveNumber(tokenize[key])) {
            errors.push(`${path}: derived.tokenize.${key} must be a positive number`);
          }
        }
      }
    }
  }

  if (parsed.formula !== undefined) {
    if (!allowFormula) {
      errors.push(`${path}: formula is not supported for this file`);
    } else if (!isObject(parsed.formula)) {
      errors.push(`${path}: formula must be an object`);
    } else {
      for (const key of ["absoluteFloorMs", "relativeMargin"]) {
        if (!isPositiveNumber(parsed.formula[key])) {
          errors.push(`${path}: formula.${key} must be a positive number`);
        }
      }
    }
  }
}

for (const file of files) {
  validateThresholdFile(file);
}

if (errors.length > 0) {
  console.error("Benchmark threshold validation failed:");
  for (const error of errors) {
    console.error(`  - ${error}`);
  }
  process.exit(1);
}

console.log("Benchmark threshold configuration is valid.");
