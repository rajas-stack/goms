// Live smoke test for the Jev API key. Sends a synthetic bid/no-bid question to
// Jev's native decision engine (no real GOMS data) and prints the answer.
// Never prints the key.
//   cd apps/api && npx tsx --env-file=.env.local scripts/jev-smoke.ts
import { callJev, getJevConfig } from '../src/lib/jev.js'

const SAMPLE = {
  state: {
    tender: 'Smart city CCTV supply (synthetic test data)',
    days_to_submission_deadline: 2,
    technical_documents_ready: false,
    emd_paid: false,
    estimated_value_lakh: 450,
  },
  questions: {
    bid_decision: {
      type: 'choice',
      instructions: 'Choose the best next step for this tender.',
      criteria: {
        bid: 'Prepare and submit the bid.',
        escalate: 'Escalate to management before committing.',
        no_bid: 'Do not bid on this tender.',
      },
    },
    deadline_at_risk: {
      type: 'noul',
      instructions: 'Is the submission deadline at risk given the current preparation?',
    },
    risk: {
      type: 'score',
      instructions: 'Score the delivery risk of bidding.',
      criteria: ['Low', 'Moderate', 'High', 'Critical'],
    },
  },
}

try {
  const config = getJevConfig()
  console.log(`Calling ${config.baseUrl} decisions with key ending …${config.apiKey.slice(-4)}`)
  const started = Date.now()
  const data = await callJev('decisions', SAMPLE, { config })
  console.log(`OK in ${Date.now() - started}ms — Jev replied:`)
  console.log(JSON.stringify(data, null, 2))
} catch (e) {
  console.error(`FAILED — ${e instanceof Error ? e.message : String(e)}`)
  process.exitCode = 1
}
