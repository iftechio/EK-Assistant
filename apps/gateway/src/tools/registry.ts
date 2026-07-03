import type { AssistantTool } from './types.js'
import { searchKols, findSimilarKols } from './search.js'
import { manageEmailTemplate, sendOutreachBatch, getOutreachStatus } from './email.js'
import { trackPublications, getTrackingResults, listMyTasks } from './tracking.js'
import { saveKolsToProject } from './kols.js'
import { exportComments, analyzeCommentsFeedback } from './comments.js'
import { compareCampaignPerformance } from './performance.js'

/** Tool Registry：名字 + JSON Schema(Zod) + handler，可扩展形状（后续新工具在此登记） */
const tools: AssistantTool[] = [
  searchKols,
  findSimilarKols,
  manageEmailTemplate,
  sendOutreachBatch,
  getOutreachStatus,
  trackPublications,
  getTrackingResults,
  listMyTasks,
  saveKolsToProject,
  exportComments,
  analyzeCommentsFeedback,
  compareCampaignPerformance,
]

const byName = new Map(tools.map((t) => [t.name, t]))

export function getTools(): AssistantTool[] {
  return tools
}

export function getToolByName(name: string): AssistantTool | undefined {
  return byName.get(name)
}
