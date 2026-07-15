/** Dataset loaders — single import point for every golden set. */
import { standardCases1 } from '../extraction/cases-standard-1.js';
import { standardCases2 } from '../extraction/cases-standard-2.js';
import { adversarialCases } from '../extraction/cases-adversarial.js';
import { stateModelCases } from '../state-model/cases.js';
import { tailoringStandardCases } from '../tailoring/cases-standard.js';
import { tailoringAdversarialCases } from '../tailoring/cases-adversarial.js';
import { scoringCases } from '../scoring/cases.js';
import { decisionCases } from '../decision/cases.js';
import { offerComparisonCases } from '../offers/cases.js';
import type { 
  ExtractionCase, 
  ScoringCase, 
  StateModelCase, 
  TailoringCase,
  DecisionCase,
  OfferComparisonCase 
} from './types.js';

export function loadExtractionCases(): ExtractionCase[] {
  return [...standardCases1, ...standardCases2, ...adversarialCases];
}

export function loadStateModelCases(): StateModelCase[] {
  return [...stateModelCases];
}

// ---------- M03 resume-intelligence golden sets ----------

export function loadTailoringCases(): TailoringCase[] {
  return [...tailoringStandardCases, ...tailoringAdversarialCases];
}

export function loadScoringCases(): ScoringCase[] {
  return [...scoringCases];
}

// ---------- M05 decision-support golden sets ----------

export function loadDecisionCases(): DecisionCase[] {
  return [...decisionCases];
}

export function loadOfferComparisonCases(): OfferComparisonCase[] {
  return [...offerComparisonCases];
}

