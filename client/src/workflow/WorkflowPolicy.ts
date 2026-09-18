export type WorkflowState =
  | 'problem_description'
  | 'read_code'
  | 'predict_output'
  | 'debug_diagnose'
  | 'run'
  | 'fix'
  | 'verify_tests'
  | 'explain_fix'
  | 'completed';

export interface StudentSnapshot {
  workflowState: WorkflowState;
  predictionText: string;
  diagnosisText: string;
  explanationText: string;
  currentCode: string;
  predictionSubmitted: boolean;
  diagnosisSubmitted: boolean;
  explanationSubmitted: boolean;
  runCount: number;
  lastVerificationPassed?: boolean;
}

const STEP_ORDER: WorkflowState[] = [
  'problem_description',
  'read_code',
  'predict_output',
  'debug_diagnose',
  'run',
  'fix',
  'verify_tests',
  'explain_fix',
  'completed',
];

export const workflowPolicy = {
  validateTransition(from: WorkflowState, to: WorkflowState, snapshot: StudentSnapshot): boolean {
    const fromIndex = STEP_ORDER.indexOf(from);
    const toIndex = STEP_ORDER.indexOf(to);

    if (toIndex === -1 || fromIndex === -1) return false;

    if (to === from) return true;

    if (toIndex <= fromIndex) {
      return fromIndex === toIndex || (from === 'run' && to === 'debug_diagnose');
    }

    const requiredPrior = STEP_ORDER.slice(0, toIndex);
    const unmet = requiredPrior.filter((step) => {
      if (step === 'predict_output') return !snapshot.predictionSubmitted;
      if (step === 'debug_diagnose') return !snapshot.diagnosisSubmitted;
      if (step === 'verify_tests') return !snapshot.lastVerificationPassed;
      if (step === 'explain_fix') return !snapshot.explanationSubmitted;
      return false;
    });

    if (unmet.length > 0) return false;

    if (to === 'run' && !snapshot.predictionSubmitted) return false;
    if (to === 'explain_fix' && !snapshot.lastVerificationPassed) return false;

    return true;
  },

  transition(current: WorkflowState, next: WorkflowState, snapshot: StudentSnapshot): { ok: boolean; reason?: string } {
    if (!this.validateTransition(current, next, snapshot)) {
      return { ok: false, reason: `Invalid transition from ${current} to ${next}` };
    }
    return { ok: true };
  },
};
