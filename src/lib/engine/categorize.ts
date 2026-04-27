import type { CommitFile, SemanticBreakdown, SemanticCategory } from '@/lib/engine/types'

export const SEMANTIC_CATEGORIES: SemanticCategory[] = [
  'feature',
  'bugfix',
  'test',
  'refactor',
  'docs',
  'styling',
  'config',
  'generated',
]

export function createEmptySemanticBreakdown(): SemanticBreakdown {
  return {
    feature: 0,
    bugfix: 0,
    test: 0,
    refactor: 0,
    docs: 0,
    styling: 0,
    config: 0,
    generated: 0,
  }
}

export function isSemanticCategory(value: string | null | undefined): value is SemanticCategory {
  return SEMANTIC_CATEGORIES.includes(value as SemanticCategory)
}

export function inferAreaFromPath(path: string): string {
  const normalized = path.replace(/^\/+/, '')
  const segments = normalized.split('/')
  if (segments.length >= 2) return `${segments[0]}/${segments[1]}`
  return segments[0] || 'root'
}

export function isGeneratedPath(path: string): boolean {
  return (
    path.includes('/dist/') ||
    path.includes('/build/') ||
    path.includes('/coverage/') ||
    path.endsWith('.map') ||
    path.endsWith('.min.js') ||
    path.endsWith('pnpm-lock.yaml') ||
    path.endsWith('package-lock.json') ||
    path.endsWith('yarn.lock')
  )
}

export function isTestPath(path: string): boolean {
  return /(^|\/)(tests?|__tests__)\//.test(path) || /\.test\.[a-z0-9]+$/i.test(path) || /\.spec\.[a-z0-9]+$/i.test(path)
}

export function isDocsPath(path: string): boolean {
  return /(^|\/)(docs|guides)\//.test(path) || /\.(md|mdx|txt|rst)$/i.test(path)
}

export function isStylingPath(path: string): boolean {
  return /\.(css|scss|sass|less)$/i.test(path) || /tailwind|theme|tokens/i.test(path)
}

export function isConfigPath(path: string): boolean {
  return (
    /\.(json|ya?ml|toml|ini)$/i.test(path) ||
    /(^|\/)(\.github|scripts)\//.test(path) ||
    /(^|\/)(next\.config|vite\.config|tsconfig|eslint|prettier|vitest|playwright|package\.json|pnpm-workspace)/i.test(path)
  )
}

export function inferCategoryFromFiles(files: CommitFile[]): SemanticCategory | null {
  if (!files.length) return null
  if (files.every((file) => isGeneratedPath(file.filename))) return 'generated'
  if (files.every((file) => isDocsPath(file.filename))) return 'docs'
  if (files.every((file) => isTestPath(file.filename))) return 'test'
  if (files.every((file) => isStylingPath(file.filename))) return 'styling'
  if (files.every((file) => isConfigPath(file.filename))) return 'config'
  return null
}

export function inferCategoryFromMessage(message: string): SemanticCategory | null {
  if (/\b(test|spec|coverage)\b/i.test(message)) return 'test'
  if (/\b(fix|bug|regression|issue|patch)\b/i.test(message)) return 'bugfix'
  if (/\b(refactor|cleanup|rename|restructure|extract)\b/i.test(message)) return 'refactor'
  if (/\b(doc|readme|comment)\b/i.test(message)) return 'docs'
  if (/\b(style|ui|css|layout|spacing)\b/i.test(message)) return 'styling'
  if (/\b(config|ci|workflow|lint|deps|dependency)\b/i.test(message)) return 'config'
  if (/\b(add|implement|create|build|feature)\b/i.test(message)) return 'feature'
  return null
}

export function categorizeChange(
  message: string,
  files: CommitFile[],
): { category: SemanticCategory; ambiguous: boolean } {
  const fromFiles = inferCategoryFromFiles(files)
  const fromMessage = inferCategoryFromMessage(message)

  if (fromFiles && fromMessage && fromFiles !== fromMessage && fromFiles !== 'config' && fromFiles !== 'generated') {
    return { category: fromMessage, ambiguous: true }
  }

  if (fromFiles) return { category: fromFiles, ambiguous: false }
  if (fromMessage) return { category: fromMessage, ambiguous: false }
  return { category: 'feature', ambiguous: true }
}
