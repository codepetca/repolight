import type { AnalysisEvent } from '@/lib/engine/types'

// Fictional evidence from the report design; these are not real student records.
export const sampleSha = (index: number) => index.toString(16).padStart(40, '0')
const entries: Array<[number, string, string, Record<string, [number, number]>]> = [
  [5, '09:22', 'Create game window and start screen', { 'Main.java': [24, 0] }],
  [5, '10:01', 'Add player with gravity', { 'Player.java': [45, 0] }],
  [6, '09:45', 'Add spacebar jump control', { 'Player.java': [29, 3], 'Main.java': [12, 2] }],
  [8, '09:26', 'update', { 'Pipe.java': [130, 0], 'Collision.java': [60, 0], 'Main.java': [30, 0] }],
  [8, '10:03', 'Prevent repeat collision after game over', { 'Collision.java': [18, 7] }],
  [13, '09:18', 'Add score when player passes a pipe', { 'Score.java': [35, 0], 'Main.java': [6, 1] }],
  [13, '09:40', 'update', { 'Pipe.java': [20, 12], 'Collision.java': [10, 5] }],
  [15, '09:24', 'Reset player and score on restart', { 'Main.java': [20, 5], 'Player.java': [8, 3] }],
  [15, '09:53', 'fix', { 'Collision.java': [6, 4] }],
  [16, '09:12', 'Check collision at pipe edges', { 'CollisionChecks.java': [40, 0], 'Collision.java': [2, 2] }],
  [16, '09:39', 'Document controls and borrowed assets', { 'README.md': [28, 0] }],
  [16, '09:56', 'polish', { 'Main.java': [8, 4], 'Player.java': [4, 2] }],
]

export const skyHopEvents: AnalysisEvent[] = entries.map(([day, time, title, changes], index) => ({
  type: 'commit', externalId: sampleSha(index + 1), repositoryKey: 'sample-student/sky-hop#main',
  title, authoredAt: `2026-10-${String(day).padStart(2, '0')}T${time}:00-04:00`,
  githubLogin: 'sample-student',
  files: Object.entries(changes).map(([filename, [additions, deletions]]) => ({ filename, status: 'modified', additions, deletions })),
}))

export function skyHopInput() {
  return {
    reportRef: 'fictional-sky-hop', studentRef: 'student-example',
    repositoryUrl: 'https://github.com/sample-student/sky-hop', branch: 'main',
    snapshot: { sha: sampleSha(12), capturedAt: '2026-10-16T14:05:00Z', kind: 'analysis_time' as const },
    period: { startAt: '2026-10-05T00:00:00-04:00', endAt: '2026-10-17T00:00:00-04:00', timezone: 'America/Toronto' },
    scheduledProjectDates: [5, 6, 7, 8, 9, 13, 14, 15, 16].map(day => `2026-10-${String(day).padStart(2, '0')}`),
    identity: { githubLogins: ['sample-student'], commitEmails: [] as string[] },
    baseline: { status: 'applied' as const, reference: 'fictional-starter-v1' },
    coverage: { history: 'complete' as const, files: 'complete' as const, notes: [] as string[] },
    exclusions: { commitShas: [] as string[], pathPrefixes: [] as string[], botLogins: [] as string[] },
    events: structuredClone(skyHopEvents),
  }
}
