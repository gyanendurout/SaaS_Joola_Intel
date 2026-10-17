// Playwright globalSetup: make sure a signed-in QA session exists before the
// suite runs. Specs that must run signed-out override storageState themselves.
import { ensureQaSession } from './qa-session.mjs'

export default async function globalSetup(config) {
  const baseURL = config.projects[0]?.use?.baseURL || 'http://localhost:3000'
  await ensureQaSession(baseURL)
}
