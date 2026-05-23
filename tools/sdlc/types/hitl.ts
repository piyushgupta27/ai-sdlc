/**
 * HITL (Human-in-the-Loop) gate types — see HITL.md.
 *
 * Five gates: G1 (PLAN), G1.5 (ADR), G2 (REVIEW), G3 (DEMO), G5 (POST-MERGE).
 * Gate records live at `.sdlc-queue/pending-hitl/<gate>-<id>.json` in the target repo.
 */

import type { ProjectSlug } from './project.js'
import type { Tier } from './task.js'

/**
 * Gate identifier. The decimal '1.5' is intentional — captures that G1.5 was
 * added as a refinement between G1 and G2, after the initial planning sessions.
 * The numeric ordering reflects the order in which gates fire in the pipeline.
 */
export type GateId = 'G1' | 'G1.5' | 'G2' | 'G3' | 'G5'

/**
 * User's decision when responding to a HITL gate.
 */
export type HITLDecision =
  | 'approve'
  | 'approve_with_followup'
  | 'request_changes'
  | 'reject'
  | 'escalate'

/**
 * Pre-defined option a user can pick from for a HITL gate. The dashboard
 * renders these as radio buttons; the response carries the chosen id +
 * optional user comment.
 */
export interface HITLOption {
  readonly id: HITLDecision
  readonly label: string
  /** If true, the dashboard requires the user to type a comment */
  readonly requiresInput?: boolean
}

/**
 * Paths to artifacts a user might want to inspect when reviewing a gate.
 * All paths are relative to the target repo root unless absolute.
 */
export interface HITLArtifacts {
  readonly diff?: string
  readonly reviewReport?: string
  readonly demoVideo?: string
  readonly auditRun?: string
  readonly adrDraft?: string
  readonly testResults?: string
}

/**
 * A pending HITL gate record. Written to disk by the orchestrator;
 * read by the dashboard. Mutation (user response) appends to the audit log
 * and removes this file.
 */
export interface HITLRequest {
  /** Unique ID; format: "hitl-<gate>-<YYYYMMDD>-<NNN>" */
  readonly id: string
  /** Which gate this is */
  readonly gate: GateId
  /** Task tier (drives whether the gate even fires per the matrix) */
  readonly tier: Tier
  /** Project this gate belongs to */
  readonly project: ProjectSlug
  /** Task ID (or 'orchestrator' for cross-task gates like G1) */
  readonly taskId: string
  /** Epic ID this belongs to */
  readonly epicId: string
  /** One-line summary shown in macOS notification + dashboard list */
  readonly summary: string
  /** Multi-line context shown when user opens the gate */
  readonly reason: string
  /** Paths to artifacts the user might want to inspect */
  readonly artifacts: HITLArtifacts
  /** Options the user can pick from */
  readonly options: readonly HITLOption[]
  /** Tasks blocked while this gate is pending (informational) */
  readonly blocking: readonly string[]
  /** Auto-decision time (used for gates that allow auto-approve after N hours) */
  readonly autoDecisionAt?: string
  /** Gate expiration; G5 expires after 7 days */
  readonly expiresAt?: string
  /** When this gate was opened */
  readonly createdAt: string
}

/**
 * A user response to a HITL gate. Lands in the audit log.
 */
export interface HITLResponse {
  readonly gateId: string
  readonly decision: HITLDecision
  /** Free-form comment from the user (shown in audit) */
  readonly comment?: string
  /** Approval token (relevant for Tier 0/1 — used by the pre-write hook) */
  readonly approvalToken?: string
  /** ISO timestamp */
  readonly respondedAt: string
}

/**
 * Tier × Gate matrix. True = gate fires for this tier; false = auto-pass.
 * See HITL.md §"Tier ↔ gate matrix".
 *
 * Index signature lookup uses string concatenation: `TIER_GATE_MATRIX[tier][gate]`.
 */
export const TIER_GATE_MATRIX: Readonly<Record<Tier, Readonly<Record<GateId, boolean>>>> = {
  0: { G1: true, 'G1.5': true, G2: true, G3: true, G5: true },
  1: { G1: true, 'G1.5': true, G2: true, G3: true, G5: true },
  2: { G1: true, 'G1.5': false, G2: true, G3: true, G5: true }, // G1.5 heuristic-only; G2 on conf<0.85; G3 on diff>5%
  3: { G1: false, 'G1.5': false, G2: false, G3: false, G5: true }, // most auto; G5 per-epic only
  4: { G1: false, 'G1.5': false, G2: false, G3: false, G5: false },
}
