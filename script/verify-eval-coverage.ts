#!/usr/bin/env bun

/// <reference types="bun-types" />

import { existsSync, readFileSync, rmSync } from "fs"
import { join, resolve } from "path"

const THRESHOLD = 85
const COVERAGE_DIR = resolve(process.cwd(), "coverage")
const LCOV_PATH = join(COVERAGE_DIR, "lcov.info")

interface FileCoverage {
  filePath: string
  linesFound: number
  linesHit: number
  functionsFound: number
  functionsHit: number
}

function runCoverage(): void {
  if (existsSync(COVERAGE_DIR)) {
    rmSync(COVERAGE_DIR, { recursive: true, force: true })
  }

  const result = Bun.spawnSync(
    ["bun", "test", "src/features/evals", "--coverage", "--coverage-reporter=lcov"],
    {
      cwd: process.cwd(),
      stdout: "pipe",
      stderr: "pipe",
      env: process.env,
    },
  )

  if (result.exitCode !== 0) {
    process.stderr.write(new TextDecoder().decode(result.stdout))
    process.stderr.write(new TextDecoder().decode(result.stderr))
    process.exit(result.exitCode)
  }
}

function parseLcov(text: string): FileCoverage[] {
  const entries: FileCoverage[] = []
  let current: FileCoverage | null = null

  for (const line of text.split("\n")) {
    if (line.startsWith("SF:")) {
      current = {
        filePath: line.slice(3),
        linesFound: 0,
        linesHit: 0,
        functionsFound: 0,
        functionsHit: 0,
      }
      continue
    }

    if (!current) continue

    if (line.startsWith("LF:")) current.linesFound = Number(line.slice(3))
    if (line.startsWith("LH:")) current.linesHit = Number(line.slice(3))
    if (line.startsWith("FNF:")) current.functionsFound = Number(line.slice(4))
    if (line.startsWith("FNH:")) current.functionsHit = Number(line.slice(4))

    if (line === "end_of_record") {
      entries.push(current)
      current = null
    }
  }

  return entries
}

function toPercent(hit: number, found: number): number {
  if (found === 0) return 100
  return (hit / found) * 100
}

runCoverage()

if (!existsSync(LCOV_PATH)) {
  console.error(`Coverage output not found: ${LCOV_PATH}`)
  process.exit(1)
}

const lcov = readFileSync(LCOV_PATH, "utf-8")
const files = parseLcov(lcov).filter((entry) => {
  const normalized = entry.filePath.replace(/\\/g, "/")
  return normalized.includes("src/features/evals/") && !normalized.includes("/__fixtures__/")
})

if (files.length === 0) {
  console.error("No eval feature files found in coverage output")
  process.exit(1)
}

const totals = files.reduce(
  (acc, file) => ({
    linesFound: acc.linesFound + file.linesFound,
    linesHit: acc.linesHit + file.linesHit,
    functionsFound: acc.functionsFound + file.functionsFound,
    functionsHit: acc.functionsHit + file.functionsHit,
  }),
  { linesFound: 0, linesHit: 0, functionsFound: 0, functionsHit: 0 },
)

const lineCoverage = toPercent(totals.linesHit, totals.linesFound)
const functionCoverage = toPercent(totals.functionsHit, totals.functionsFound)

console.log(`Eval coverage lines: ${lineCoverage.toFixed(1)}%`)
console.log(`Eval coverage functions: ${functionCoverage.toFixed(1)}%`)

if (lineCoverage < THRESHOLD || functionCoverage < THRESHOLD) {
  console.error(`Eval coverage below threshold ${THRESHOLD}%`)
  process.exit(1)
}
