import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { test } from 'node:test'
import ts from 'typescript'

type FindingKind =
  | 'jsx-text'
  | 'visible-attribute'
  | 'jsx-expression'
  | 'visible-object-property'
  | 'visible-variable'
  | 'visible-call'
  | 'ui-return'
  | 'generated-copy-property'

type AllowCategory =
  | 'brand-name'
  | 'url'
  | 'user-data'
  | 'backend-data'
  | 'ai-data'
  | 'prompt'
  | 'generated-poster-copy'

interface Finding {
  file: string
  kind: FindingKind
  text: string
  line: number
}

interface AllowedLiteral {
  file: string
  kind: FindingKind
  text: string
  count: number
  category: AllowCategory
  reason: string
}

/*
 * Deliberate source copy that must not be translated. Entries are exact by file,
 * AST context, text, and count; stale or newly duplicated entries fail the test.
 * Dynamic user/backend/AI values and prompt bodies contain no source literal, so
 * they need no entries here even though those are also permitted categories.
 */
const SOURCE_LITERAL_ALLOWLIST: AllowedLiteral[] = [
  {
    file: 'src/components/AppShell.tsx',
    kind: 'visible-attribute',
    text: 'Posterlytics',
    count: 2,
    category: 'brand-name',
    reason: 'Product brand name stays invariant in the rail label and tooltip.',
  },
  {
    file: 'src/components/AppShell.tsx',
    kind: 'jsx-text',
    text: 'P',
    count: 1,
    category: 'brand-name',
    reason: 'Product brand mark.',
  },
  {
    file: 'src/components/ui/FirstPaintLoadingShell.tsx',
    kind: 'jsx-text',
    text: 'P',
    count: 1,
    category: 'brand-name',
    reason: 'Product brand mark in the first-paint loading shell.',
  },
  {
    file: 'src/components/ui/FirstPaintLoadingShell.tsx',
    kind: 'jsx-text',
    text: 'Posterlytics',
    count: 1,
    category: 'brand-name',
    reason: 'Product name in the first-paint loading shell.',
  },
  {
    file: 'src/marketing/PublicLandingShell.tsx',
    kind: 'jsx-text',
    text: 'P',
    count: 1,
    category: 'brand-name',
    reason: 'Product brand mark.',
  },
  {
    file: 'src/marketing/PublicLandingShell.tsx',
    kind: 'jsx-text',
    text: 'Posterlytics',
    count: 2,
    category: 'brand-name',
    reason: 'Product name in public navigation and hero.',
  },
  {
    file: 'src/marketing/PublicLandingShell.tsx',
    kind: 'jsx-text',
    text: 'PL / 001',
    count: 1,
    category: 'generated-poster-copy',
    reason: 'Decorative sample-poster folio mark.',
  },
  {
    file: 'src/marketing/PublicLandingShell.tsx',
    kind: 'jsx-text',
    text: 'PRINT TO SIGNAL',
    count: 1,
    category: 'generated-poster-copy',
    reason: 'Decorative sample-poster copy.',
  },
  {
    file: 'src/marketing/SamplePoster.tsx',
    kind: 'jsx-text',
    text: 'POSTERLYTICS /',
    count: 1,
    category: 'generated-poster-copy',
    reason: 'Text embedded in the marketing poster mockup.',
  },
  {
    file: 'src/pages/LandingPage.tsx',
    kind: 'jsx-text',
    text: '01 / SOURCE',
    count: 1,
    category: 'generated-poster-copy',
    reason: 'Wireframe poster annotation.',
  },
  {
    file: 'src/pages/LandingPage.tsx',
    kind: 'jsx-text',
    text: 'product.example',
    count: 1,
    category: 'url',
    reason: 'Illustrative hostname in the source mockup.',
  },
  {
    file: 'src/pages/LandingPage.tsx',
    kind: 'jsx-text',
    text: '02 / STRUCTURE',
    count: 1,
    category: 'generated-poster-copy',
    reason: 'Wireframe poster annotation.',
  },
  {
    file: 'src/pages/LandingPage.tsx',
    kind: 'jsx-text',
    text: 'HOOK',
    count: 1,
    category: 'generated-poster-copy',
    reason: 'Wireframe poster annotation.',
  },
  {
    file: 'src/pages/LandingPage.tsx',
    kind: 'jsx-text',
    text: 'CUT THROUGH.',
    count: 1,
    category: 'generated-poster-copy',
    reason: 'Copy inside the illustrative generated-poster layout.',
  },
  {
    file: 'src/pages/LandingPage.tsx',
    kind: 'jsx-text',
    text: 'REFERENCE / PRODUCT',
    count: 1,
    category: 'generated-poster-copy',
    reason: 'Wireframe poster annotation.',
  },
  {
    file: 'src/pages/LandingPage.tsx',
    kind: 'jsx-text',
    text: 'PALETTE / SOURCE',
    count: 1,
    category: 'generated-poster-copy',
    reason: 'Wireframe poster annotation.',
  },
  {
    file: 'src/pages/LandingPage.tsx',
    kind: 'jsx-text',
    text: 'FORMAT / A4',
    count: 1,
    category: 'generated-poster-copy',
    reason: 'Wireframe poster annotation.',
  },
  {
    file: 'src/pages/LandingPage.tsx',
    kind: 'jsx-text',
    text: 'P',
    count: 1,
    category: 'brand-name',
    reason: 'Product brand mark.',
  },
  {
    file: 'src/pages/LandingPage.tsx',
    kind: 'jsx-text',
    text: 'Posterlytics',
    count: 1,
    category: 'brand-name',
    reason: 'Product name in the footer.',
  },
  {
    file: 'src/pages/SignInPage.tsx',
    kind: 'jsx-text',
    text: 'P',
    count: 1,
    category: 'brand-name',
    reason: 'Product brand mark.',
  },
  {
    file: 'src/pages/SignInPage.tsx',
    kind: 'jsx-text',
    text: 'Posterlytics',
    count: 1,
    category: 'brand-name',
    reason: 'Product name in the sign-in header.',
  },
  {
    file: 'src/pages/SignInPage.tsx',
    kind: 'jsx-text',
    text: 'WEBSITE / POSTER / SIGNAL',
    count: 1,
    category: 'generated-poster-copy',
    reason: 'Decorative sample-poster copy.',
  },
  {
    file: 'src/pages/SignInPage.tsx',
    kind: 'jsx-text',
    text: 'PL / 001',
    count: 1,
    category: 'generated-poster-copy',
    reason: 'Decorative sample-poster folio mark.',
  },
  {
    file: 'src/pages/CampaignWizardPage.tsx',
    kind: 'visible-variable',
    text: 'Get started',
    count: 1,
    category: 'generated-poster-copy',
    reason: 'Initial generated-poster CTA supplied as campaign data.',
  },
  {
    file: 'src/pages/CampaignWizardPage.tsx',
    kind: 'generated-copy-property',
    text: 'Learn more',
    count: 1,
    category: 'generated-poster-copy',
    reason: 'Fallback generated-poster CTA persisted with the campaign.',
  },
  {
    file: 'src/pages/CampaignWizardPage.tsx',
    kind: 'visible-attribute',
    text: 'https://yourproduct.com',
    count: 1,
    category: 'url',
    reason: 'Illustrative URL placeholder.',
  },
  {
    file: 'src/pages/CampaignWizardPage.tsx',
    kind: 'visible-attribute',
    text: 'Northstar Reports',
    count: 1,
    category: 'brand-name',
    reason: 'Illustrative product brand placeholder.',
  },
  {
    file: 'src/pages/CampaignWizardPage.tsx',
    kind: 'visible-attribute',
    text: 'https://yourproduct.com/signup',
    count: 1,
    category: 'url',
    reason: 'Illustrative URL placeholder.',
  },
  {
    file: 'src/pages/CampaignWizardPage.tsx',
    kind: 'jsx-text',
    text: 'P',
    count: 1,
    category: 'brand-name',
    reason: 'Product brand mark in the poster summary.',
  },
  {
    file: 'src/components/GenerationReferences.tsx',
    kind: 'visible-attribute',
    text: 'https://…/pic.jpg',
    count: 1,
    category: 'url',
    reason: 'Illustrative image URL placeholder.',
  },
  {
    file: 'src/components/posters/AiPoster.tsx',
    kind: 'visible-variable',
    text: 'Scan to RSVP',
    count: 1,
    category: 'generated-poster-copy',
    reason: 'Approved out-of-scope completed-poster CTA fallback.',
  },
  {
    file: 'src/components/posters/AiPoster.tsx',
    kind: 'visible-variable',
    text: 'Scan to start',
    count: 1,
    category: 'generated-poster-copy',
    reason: 'Approved out-of-scope completed-poster CTA fallback.',
  },
  {
    file: 'src/components/posters/AiPoster.tsx',
    kind: 'jsx-text',
    text: 'Point your camera here',
    count: 1,
    category: 'generated-poster-copy',
    reason: 'Approved out-of-scope completed-poster default copy.',
  },
  {
    file: 'src/lib/posterTranscript.ts',
    kind: 'visible-variable',
    text: 'Scan to start',
    count: 1,
    category: 'generated-poster-copy',
    reason: 'Exact English transcript mirror of the product QR-footer fallback painted by AiPoster.',
  },
  {
    file: 'src/lib/posterTranscript.ts',
    kind: 'visible-variable',
    text: 'Scan to RSVP',
    count: 1,
    category: 'generated-poster-copy',
    reason: 'Exact English transcript mirror of the event QR-footer fallback painted by AiPoster.',
  },
  {
    file: 'src/lib/posterTranscript.ts',
    kind: 'visible-variable',
    text: 'Point your camera here',
    count: 1,
    category: 'generated-poster-copy',
    reason: 'Exact English transcript mirror of the fixed camera instruction painted by AiPoster.',
  },
]

const VISIBLE_ATTRIBUTE_NAME =
  /^(?:alt|aria-label|data-tooltip)$|(?:blurb|caption|copy|description|eyebrow|headline|hint|label|message|note|placeholder|title)$/i

const VISIBLE_OBJECT_PROPERTIES = new Set([
  'blurb',
  'description',
  'eyebrow',
  'label',
  'message',
  'name',
  'placeholder',
  'title',
])

const GENERATED_COPY_PROPERTIES = new Set([
  'cta_text',
  'qr_label',
  'rsvp_label',
])

const VISIBLE_VARIABLE_NAME =
  /(?:blurb|caption|copy|ctaText|description|eyebrow|headline|hint|label|message|note|placeholder|title)$/i
const UI_TEXT_FUNCTION_NAME =
  /(?:Copy|Description|Label|Message|Text|Title)$/
const VISIBLE_SETTER_NAME = /^set.*(?:Error|Feedback|Message|Notice)$/

test('frontend source contains no unexternalized user-facing literals', () => {
  const root = process.cwd()
  const sourceFiles = listSourceFiles(path.join(root, 'src'))
    .filter((file) => !file.endsWith(path.join('src', 'i18n', 'messages.ts')))
  const program = ts.createProgram(sourceFiles, {
    allowJs: false,
    jsx: ts.JsxEmit.ReactJSX,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    skipLibCheck: true,
    target: ts.ScriptTarget.ES2022,
  })
  const checker = program.getTypeChecker()
  const findings: Finding[] = []

  for (const fileName of sourceFiles) {
    const sourceFile = program.getSourceFile(fileName)
    assert.ok(sourceFile, `TypeScript did not parse ${fileName}`)
    auditSourceFile(root, sourceFile, checker, findings)
  }

  const allowlistCounts = new Map<string, number>()
  const unapproved = findings.filter((finding) => {
    const key = findingKey(finding)
    const allowed = SOURCE_LITERAL_ALLOWLIST.find((entry) =>
      findingKey(entry) === key
    )
    if (!allowed) return true
    allowlistCounts.set(key, (allowlistCounts.get(key) ?? 0) + 1)
    return false
  })

  const inaccurateAllowlist = SOURCE_LITERAL_ALLOWLIST.flatMap((entry) => {
    const actual = allowlistCounts.get(findingKey(entry)) ?? 0
    return actual === entry.count
      ? []
      : [`${entry.file} [${entry.kind}] "${entry.text}": expected ${entry.count}, found ${actual}`]
  })

  assert.equal(
    new Set(SOURCE_LITERAL_ALLOWLIST.map(findingKey)).size,
    SOURCE_LITERAL_ALLOWLIST.length,
    'Source literal allowlist contains duplicate entries.',
  )
  assert.equal(
    SOURCE_LITERAL_ALLOWLIST.every((entry) => entry.reason.trim().length > 0),
    true,
    'Every source literal allowlist entry must document why it is exempt.',
  )
  assert.deepEqual(
    unapproved.map(formatFinding),
    [],
    'Unexternalized frontend source literals found.',
  )
  assert.deepEqual(
    inaccurateAllowlist,
    [],
    'Source literal allowlist is stale or broader than the exact approved occurrences.',
  )
})

function listSourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const file = path.join(directory, entry.name)
    if (entry.isDirectory()) return listSourceFiles(file)
    return /\.(?:ts|tsx)$/.test(entry.name) ? [file] : []
  })
}

function auditSourceFile(
  root: string,
  sourceFile: ts.SourceFile,
  checker: ts.TypeChecker,
  findings: Finding[],
) {
  const relativeFile = path.relative(root, sourceFile.fileName).split(path.sep).join('/')

  function add(node: ts.Node, rawText: string, kind: FindingKind) {
    const text = normalizeText(rawText)
    if (!isHumanText(text, kind === 'jsx-text')) return
    if (isTranslationKeyContext(node, checker)) return
    const { line } = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile))
    findings.push({ file: relativeFile, kind, text, line: line + 1 })
  }

  function collectExpression(node: ts.Node, kind: FindingKind) {
    if (isTranslationCall(node)) return
    if (ts.isStringLiteralLike(node)) {
      add(node, node.text, kind)
      return
    }
    if (ts.isTemplateExpression(node)) {
      const staticText = [
        node.head.text,
        ...node.templateSpans.map((span) => span.literal.text),
      ].join('{…}')
      add(node, staticText, kind)
      return
    }
    if (ts.isConditionalExpression(node)) {
      collectExpression(node.whenTrue, kind)
      collectExpression(node.whenFalse, kind)
      return
    }
    if (ts.isBinaryExpression(node)) {
      if (node.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken) {
        collectExpression(node.right, kind)
        return
      }
      if (
        node.operatorToken.kind === ts.SyntaxKind.BarBarToken
        || node.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken
        || node.operatorToken.kind === ts.SyntaxKind.PlusToken
      ) {
        collectExpression(node.left, kind)
        collectExpression(node.right, kind)
      }
      return
    }
    if (ts.isCallExpression(node)) return
    if (ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node) || ts.isJsxFragment(node)) {
      visit(node)
      return
    }
    ts.forEachChild(node, (child) => collectExpression(child, kind))
  }

  function visit(node: ts.Node) {
    if (ts.isJsxText(node)) {
      add(node, node.text, 'jsx-text')
      return
    }

    if (ts.isJsxAttribute(node)) {
      const attributeName = node.name.getText(sourceFile)
      if (VISIBLE_ATTRIBUTE_NAME.test(attributeName) && node.initializer) {
        if (ts.isStringLiteral(node.initializer)) {
          add(node.initializer, node.initializer.text, 'visible-attribute')
        } else if (ts.isJsxExpression(node.initializer) && node.initializer.expression) {
          collectExpression(node.initializer.expression, 'visible-attribute')
        }
      }
      return
    }

    if (
      ts.isJsxExpression(node)
      && node.expression
      && (
        ts.isJsxElement(node.parent)
        || ts.isJsxFragment(node.parent)
      )
    ) {
      collectExpression(node.expression, 'jsx-expression')
      return
    }

    if (ts.isPropertyAssignment(node)) {
      const propertyName = propertyNameText(node.name)
      if (GENERATED_COPY_PROPERTIES.has(propertyName)) {
        collectExpression(node.initializer, 'generated-copy-property')
        return
      }
      if (VISIBLE_OBJECT_PROPERTIES.has(propertyName)) {
        collectExpression(node.initializer, 'visible-object-property')
        return
      }
    }

    if (
      (
        ts.isVariableDeclaration(node)
        || ts.isParameter(node)
        || ts.isBindingElement(node)
      )
      && bindingNames(node.name).some((name) => VISIBLE_VARIABLE_NAME.test(name))
      && node.initializer
    ) {
      if (
        ts.isCallExpression(node.initializer)
        && callExpressionName(node.initializer.expression) === 'useState'
      ) {
        for (const argument of node.initializer.arguments) {
          collectExpression(argument, 'visible-variable')
        }
      } else {
        collectExpression(node.initializer, 'visible-variable')
      }
      return
    }

    if (ts.isCallExpression(node)) {
      const callName = callExpressionName(node.expression)
      if (
        callName === 'alert'
        || callName === 'confirm'
        || callName === 'notify'
        || VISIBLE_SETTER_NAME.test(callName)
      ) {
        const message = node.arguments[0]
        if (message) collectExpression(message, 'visible-call')
        return
      }
    }

    if (ts.isNewExpression(node) && callExpressionName(node.expression) === 'Error') {
      if (!isDeveloperInvariantError(node)) {
        for (const argument of node.arguments ?? []) {
          collectExpression(argument, 'visible-call')
        }
      }
      return
    }

    if (ts.isReturnStatement(node) && node.expression) {
      const functionName = containingFunctionName(node)
      if (functionName && UI_TEXT_FUNCTION_NAME.test(functionName)) {
        collectExpression(node.expression, 'ui-return')
        return
      }
    }

    ts.forEachChild(node, visit)
  }

  visit(sourceFile)
}

function isTranslationCall(node: ts.Node): boolean {
  if (!ts.isCallExpression(node)) return false
  const name = callExpressionName(node.expression)
  return name === 't' || name === 'translate'
}

function isTranslationKeyContext(node: ts.Node, checker: ts.TypeChecker): boolean {
  for (let current: ts.Node | undefined = node; current; current = current.parent) {
    if (
      (
        ts.isVariableDeclaration(current)
        || ts.isParameter(current)
        || ts.isPropertyDeclaration(current)
      )
      && current.type?.getText().includes('TranslationKey')
    ) {
      return true
    }
    if (
      (ts.isAsExpression(current) || ts.isTypeAssertionExpression(current))
      && current.type.getText().includes('TranslationKey')
    ) {
      return true
    }
    if (ts.isSourceFile(current) || ts.isFunctionLike(current)) break
  }

  const contextual = checker.getContextualType(node as ts.Expression)
  if (!contextual) return false
  return contextual.aliasSymbol?.getName() === 'TranslationKey'
    || checker.typeToString(contextual).includes('TranslationKey')
}

function isDeveloperInvariantError(node: ts.NewExpression): boolean {
  const first = node.arguments?.[0]
  return !!first
    && ts.isStringLiteralLike(first)
    && /^use[A-Z]\w+ must be used inside [A-Z]\w+Provider$/.test(first.text)
}

function containingFunctionName(node: ts.Node): string | null {
  for (let current: ts.Node | undefined = node.parent; current; current = current.parent) {
    if (ts.isFunctionDeclaration(current)) return current.name?.text ?? null
    if (
      (ts.isArrowFunction(current) || ts.isFunctionExpression(current))
      && ts.isVariableDeclaration(current.parent)
      && ts.isIdentifier(current.parent.name)
    ) {
      return current.parent.name.text
    }
  }
  return null
}

function callExpressionName(expression: ts.Expression): string {
  if (ts.isIdentifier(expression)) return expression.text
  if (ts.isPropertyAccessExpression(expression)) return expression.name.text
  return ''
}

function propertyNameText(name: ts.PropertyName): string {
  if (ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNumericLiteral(name)) {
    return name.text
  }
  return name.getText()
}

function bindingNames(name: ts.BindingName): string[] {
  if (ts.isIdentifier(name)) return [name.text]
  return name.elements.flatMap((element) =>
    ts.isOmittedExpression(element) ? [] : bindingNames(element.name)
  )
}

function normalizeText(value: string): string {
  return value.replace(/\s+/g, ' ').trim()
}

function isHumanText(value: string, allowSingleLetter: boolean): boolean {
  if (/[\u3400-\u9fff]/u.test(value)) return true
  return allowSingleLetter ? /[A-Za-z]/.test(value) : /[A-Za-z]{2}/.test(value)
}

function findingKey(
  finding: Pick<Finding, 'file' | 'kind' | 'text'>,
): string {
  return `${finding.file}\u0000${finding.kind}\u0000${finding.text}`
}

function formatFinding(finding: Finding): string {
  return `${finding.file}:${finding.line} [${finding.kind}] ${JSON.stringify(finding.text)}`
}

// Ensure the test fails if it is accidentally pointed at a non-repository cwd.
assert.equal(
  readFileSync(path.join(process.cwd(), 'package.json'), 'utf8').includes('"posterlytics"'),
  true,
)
