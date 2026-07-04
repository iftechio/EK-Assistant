import type { AssistantTool } from './types.js'
import { searchKols, findSimilarKols, discoverKolsBySource, parseSearchIntent } from './search.js'
import {
  manageEmailTemplate,
  setTemplateFollowups,
  sendOutreachBatch,
  getOutreachStatus,
  manageOutreachQueue,
  sendSingleEmail,
} from './email.js'
import { exportKols, manageExcludeList } from './export.js'
import { extractKolEmails, detectFakeFollowers } from './insights.js'
import { trackCompetitors } from './competitor.js'
import { analyzeAudience } from './audience.js'
import { trackPublications, getTrackingResults, manageTracking, listMyTasks } from './tracking.js'
import { saveKolsToProject } from './kols.js'
import { exportComments, analyzeCommentsFeedback } from './comments.js'
import { compareCampaignPerformance } from './performance.js'
import { rememberPreference } from './memory.js'

/** Tool Registry：名字 + JSON Schema(Zod) + handler，可扩展形状（后续新工具在此登记） */
const tools: AssistantTool[] = [
  searchKols,
  findSimilarKols,
  discoverKolsBySource,
  parseSearchIntent,
  manageEmailTemplate,
  setTemplateFollowups,
  sendOutreachBatch,
  getOutreachStatus,
  manageOutreachQueue,
  trackPublications,
  getTrackingResults,
  manageTracking,
  listMyTasks,
  saveKolsToProject,
  exportComments,
  analyzeCommentsFeedback,
  compareCampaignPerformance,
  rememberPreference,
  sendSingleEmail,
  exportKols,
  manageExcludeList,
  extractKolEmails,
  detectFakeFollowers,
  trackCompetitors,
  analyzeAudience,
]

const byName = new Map(tools.map((t) => [t.name, t]))

export function getTools(): AssistantTool[] {
  return tools
}

export function getToolByName(name: string): AssistantTool | undefined {
  return byName.get(name)
}
