/** Dataset loaders — single import point for both golden sets. */
import { standardCases1 } from '../extraction/cases-standard-1.js';
import { standardCases2 } from '../extraction/cases-standard-2.js';
import { adversarialCases } from '../extraction/cases-adversarial.js';
import { stateModelCases } from '../state-model/cases.js';
import type { ExtractionCase, StateModelCase } from './types.js';

export function loadExtractionCases(): ExtractionCase[] {
  return [...standardCases1, ...standardCases2, ...adversarialCases];
}

export function loadStateModelCases(): StateModelCase[] {
  return [...stateModelCases];
}
