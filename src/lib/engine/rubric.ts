import type { RubricConfig } from '@/lib/engine/types'

export const DEFAULT_RUBRIC: RubricConfig = {
  version: 'v1',
  componentWeights: {
    impact: 0.45,
    workflow: 0.25,
    quality: 0.2,
    collaboration: 0.1,
  },
  semanticWeights: {
    feature: 1.0,
    bugfix: 0.9,
    test: 0.8,
    refactor: 0.7,
    docs: 0.4,
    styling: 0.4,
    config: 0.2,
    generated: 0.0,
  },
  contributionScale: {
    churnDivisor: 40,
    minVolume: 0.25,
    maxVolume: 3,
  },
  curve: {
    relativeWeight: 0.35,
    floorPercent: 55,
    medianPercent: 80,
    excellentPercent: 96,
    capPercentile: 0.9,
  },
  gradeBands: [
    { label: 'A', minPercent: 90 },
    { label: 'B', minPercent: 80 },
    { label: 'C', minPercent: 70 },
    { label: 'D', minPercent: 60 },
    { label: 'F', minPercent: 0 },
  ],
}

export function normalizeRubric(input: Partial<RubricConfig> | null | undefined): RubricConfig {
  const merged: RubricConfig = {
    ...DEFAULT_RUBRIC,
    ...(input || {}),
    componentWeights: {
      ...DEFAULT_RUBRIC.componentWeights,
      ...(input?.componentWeights || {}),
    },
    semanticWeights: {
      ...DEFAULT_RUBRIC.semanticWeights,
      ...(input?.semanticWeights || {}),
    },
    contributionScale: {
      ...DEFAULT_RUBRIC.contributionScale,
      ...(input?.contributionScale || {}),
    },
    curve: {
      ...DEFAULT_RUBRIC.curve,
      ...(input?.curve || {}),
    },
    gradeBands: input?.gradeBands?.length ? input.gradeBands : DEFAULT_RUBRIC.gradeBands,
  }

  const totalWeight = Object.values(merged.componentWeights).reduce((sum, value) => sum + Math.max(0, Number(value) || 0), 0)
  if (totalWeight > 0) {
    merged.componentWeights = {
      impact: clampWeight(merged.componentWeights.impact / totalWeight),
      workflow: clampWeight(merged.componentWeights.workflow / totalWeight),
      quality: clampWeight(merged.componentWeights.quality / totalWeight),
      collaboration: clampWeight(merged.componentWeights.collaboration / totalWeight),
    }
  }

  merged.contributionScale.churnDivisor = Math.max(1, Number(merged.contributionScale.churnDivisor) || 40)
  merged.contributionScale.minVolume = Math.max(0, Number(merged.contributionScale.minVolume) || 0)
  merged.contributionScale.maxVolume = Math.max(merged.contributionScale.minVolume, Number(merged.contributionScale.maxVolume) || 3)
  merged.curve.relativeWeight = clampWeight(merged.curve.relativeWeight)
  merged.curve.floorPercent = clampPercent(merged.curve.floorPercent)
  merged.curve.medianPercent = clampPercent(merged.curve.medianPercent)
  merged.curve.excellentPercent = clampPercent(merged.curve.excellentPercent)
  merged.curve.capPercentile = clampWeight(merged.curve.capPercentile || 0.9)

  merged.gradeBands = [...merged.gradeBands]
    .map((band) => ({ label: band.label.trim() || 'Grade', minPercent: clampPercent(band.minPercent) }))
    .sort((left, right) => right.minPercent - left.minPercent)

  return merged
}

function clampWeight(value: number): number {
  return Math.min(1, Math.max(0, Number(value) || 0))
}

function clampPercent(value: number): number {
  return Math.min(100, Math.max(0, Number(value) || 0))
}
