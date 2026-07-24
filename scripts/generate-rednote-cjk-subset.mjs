import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'
import {
  mkdir,
  readFile,
  writeFile,
} from 'node:fs/promises'
import { dirname, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const rootDirectory = fileURLToPath(new URL('../', import.meta.url))
const corpusPath = fileURLToPath(
  new URL('./fonts/rednote-gb2312-level1.txt', import.meta.url),
)
const outputPath = fileURLToPath(
  new URL(
    '../src/assets/fonts/rednote-noto-sans-sc-gb2312-l1-500.woff2',
    import.meta.url,
  ),
)
const provenancePath = fileURLToPath(
  new URL(
    '../src/assets/fonts/rednote-noto-sans-sc-gb2312-l1-500.json',
    import.meta.url,
  ),
)
const sourcePackageName = '@fontsource/noto-sans-sc'
const sourceRelativePath =
  'files/noto-sans-sc-chinese-simplified-500-normal.woff2'
const sourcePath = require.resolve(
  `${sourcePackageName}/${sourceRelativePath}`,
)
const fontPackagePath = require.resolve(`${sourcePackageName}/package.json`)
const subsetPackagePath = require.resolve('subset-font/package.json')
const maxOutputBytes = 1_228_800
const checkOnly = process.argv.slice(2).includes('--check')

const [
  corpusFile,
  sourceFont,
  fontPackage,
  subsetPackage,
] = await Promise.all([
  readFile(corpusPath, 'utf8'),
  readFile(sourcePath),
  readJson(fontPackagePath),
  readJson(subsetPackagePath),
])
const corpus = Array.from(
  new Set(Array.from(corpusFile.replaceAll('\r', '').replaceAll('\n', ''))),
).join('')

if (checkOnly) {
  await verifyCommittedArtifact({
    corpus,
    corpusFile,
    fontPackage,
    sourceFont,
    subsetPackage,
  })
} else {
  const imported = await import('subset-font')
  const subsetFont = imported.default
  if (typeof subsetFont !== 'function') {
    throw new TypeError('subset-font did not expose its expected default function.')
  }
  const subset = await subsetFont(sourceFont, corpus, {
    targetFormat: 'woff2',
  })
  const output = Buffer.from(subset)
  assertWoff2(output)
  assertByteBudget(output)

  const provenance = buildProvenance({
    corpus,
    corpusFile,
    fontPackage,
    output,
    sourceFont,
    subsetPackage,
  })
  await mkdir(dirname(outputPath), { recursive: true })
  await Promise.all([
    writeFile(outputPath, output),
    writeFile(provenancePath, `${JSON.stringify(provenance, null, 2)}\n`),
  ])
  console.log(
    `RedNote CJK subset written (${output.byteLength} bytes, `
    + `${Array.from(corpus).length} code points).`,
  )
}

async function verifyCommittedArtifact(context) {
  const [output, provenance] = await Promise.all([
    readFile(outputPath),
    readJson(provenancePath),
  ])
  assertWoff2(output)
  assertByteBudget(output)
  const expected = buildProvenance({ ...context, output })
  if (JSON.stringify(provenance) !== JSON.stringify(expected)) {
    throw new Error(
      'RedNote font provenance does not match the committed source, corpus, '
      + 'tool, and artifact hashes.',
    )
  }
  console.log(
    `RedNote CJK subset verified (${output.byteLength} bytes, `
    + `${expected.corpus.codePoints} code points).`,
  )
}

function buildProvenance({
  corpus,
  corpusFile,
  fontPackage,
  output,
  sourceFont,
  subsetPackage,
}) {
  return {
    schemaVersion: 1,
    source: {
      package: sourcePackageName,
      version: fontPackage.version,
      file: sourceRelativePath,
      sha256: sha256(sourceFont),
    },
    corpus: {
      file: relative(rootDirectory, corpusPath),
      codePoints: Array.from(corpus).length,
      sha256: sha256(Buffer.from(corpusFile, 'utf8')),
    },
    generator: {
      package: 'subset-font',
      version: subsetPackage.version,
    },
    output: {
      file: relative(rootDirectory, outputPath),
      format: 'woff2',
      bytes: output.byteLength,
      maxBytes: maxOutputBytes,
      sha256: sha256(output),
    },
  }
}

function assertWoff2(buffer) {
  if (buffer.subarray(0, 4).toString('ascii') !== 'wOF2') {
    throw new TypeError('Generated RedNote font does not have a WOFF2 signature.')
  }
}

function assertByteBudget(buffer) {
  if (buffer.byteLength === 0 || buffer.byteLength > maxOutputBytes) {
    throw new RangeError(
      `Generated RedNote font is ${buffer.byteLength} bytes; `
      + `the limit is ${maxOutputBytes}.`,
    )
  }
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex')
}

async function readJson(path) {
  return JSON.parse(await readFile(path, 'utf8'))
}
