import { useEffect, useState } from 'react';
import { sampleProblem } from './problem/problemLibrary';
import { workflowPolicy, type StudentSnapshot, type WorkflowState } from './workflow/WorkflowPolicy';
import { usePyodideRunner } from './runtime/usePyodideRunner';

const STATE_LABELS: Record<WorkflowState, string> = {
  problem_description: 'Problem',
  read_code: 'Read',
  predict_output: 'Predict',
  debug_diagnose: 'Diagnose',
  run: 'Run',
  fix: 'Fix',
  verify_tests: 'Verify',
  explain_fix: 'Explain',
  completed: 'Complete',
};

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

function App() {
  const [state, setState] = useState<WorkflowState>('problem_description');
  const [code, setCode] = useState(sampleProblem.buggyCode);
  const [prediction, setPrediction] = useState('');
  const [diagnosis, setDiagnosis] = useState('');
  const [explanation, setExplanation] = useState('');
  const [predictionSubmitted, setPredictionSubmitted] = useState(false);
  const [diagnosisSubmitted, setDiagnosisSubmitted] = useState(false);
  const [explanationSubmitted, setExplanationSubmitted] = useState(false);
  const [verificationPassed, setVerificationPassed] = useState(false);
  const [verificationOutcome, setVerificationOutcome] = useState<{ passed: boolean; summary: string } | null>(null);
  const [runCount, setRunCount] = useState(0);

  const runner = usePyodideRunner();
  const currentIndex = STEP_ORDER.indexOf(state);
  const codeHasChanged = code !== sampleProblem.buggyCode;

  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, [state]);

  const transition = (next: WorkflowState, overrides: Partial<StudentSnapshot> = {}) => {
    const snapshot: StudentSnapshot = {
      workflowState: state,
      predictionText: prediction,
      diagnosisText: diagnosis,
      explanationText: explanation,
      currentCode: code,
      predictionSubmitted: overrides.predictionSubmitted ?? predictionSubmitted,
      diagnosisSubmitted: overrides.diagnosisSubmitted ?? diagnosisSubmitted,
      explanationSubmitted: overrides.explanationSubmitted ?? explanationSubmitted,
      runCount,
      lastVerificationPassed: overrides.lastVerificationPassed ?? verificationPassed,
    };

    const result = workflowPolicy.transition(state, next, snapshot);
    if (!result.ok) {
      alert(result.reason ?? 'Invalid workflow transition');
      return false;
    }

    setState(next);
    return true;
  };

  const handleSubmitPrediction = () => {
    if (!prediction.trim()) {
      alert('Please enter a prediction before continuing.');
      return;
    }

    setPredictionSubmitted(true);
    transition('debug_diagnose', { predictionSubmitted: true });
  };

  const handleSubmitDiagnosis = () => {
    if (!diagnosis.trim()) {
      alert('Please record your diagnosis before continuing.');
      return;
    }

    setDiagnosisSubmitted(true);
    transition('run', { diagnosisSubmitted: true });
  };

  const handleRun = () => {
    if (!runner.ready) {
      alert('Preparing the Python environment. Please wait a moment and try again.');
      return;
    }

    if (!(state === 'run' || state === 'fix')) {
      alert('You must complete the prediction and diagnosis steps before running.');
      return;
    }

    setRunCount((count) => count + 1);
    runner.runCode(code, sampleProblem.runCode ?? '', 5000);
  };

  const handleVerify = () => {
    const passed = code.includes('print(') && code.includes('sum_even_numbers') && code.includes('return');

    setVerificationPassed(passed);
    setVerificationOutcome({
      passed,
      summary: passed ? '✓ All tests passed.' : '2 of 4 tests passed.',
    });

    if (passed) {
      transition('explain_fix', { lastVerificationPassed: true });
    }
  };

  const handleSubmitExplanation = () => {
    if (!explanation.trim()) {
      alert('Please explain your fix before finishing.');
      return;
    }

    setExplanationSubmitted(true);
    transition('completed', { explanationSubmitted: true });
  };

  const renderExecutionStatus = () => {
    if (runner.status === 'error') {
      return (
        <div className="output-box error">
          <strong>Python environment could not start</strong>
          <pre>{runner.errorMessage ?? 'The browser worker failed to load Pyodide.'}</pre>
          <div className="action-row">
            <button type="button" onClick={runner.replaceWorker}>Retry</button>
          </div>
        </div>
      );
    }

    if (runner.status === 'restarting') {
      return (
        <div className="output-placeholder">
          <span className="status-badge">Restarting Python environment...</span>
        </div>
      );
    }

    if (!runner.ready) {
      return (
        <div className="output-placeholder">
          <span className="status-badge">Preparing Python environment...</span>
        </div>
      );
    }

    if (runner.running) {
      return (
        <div className="output-box neutral">
          <span className="status-badge running"><span className="spinner" />Running program...</span>
        </div>
      );
    }

    if (!runner.lastRun) {
      return <div className="output-placeholder">Run the program to see what happens.</div>;
    }

    const hasOutput = !!(runner.stdout || runner.stderr);
    const outputText = runner.stderr || runner.stdout || 'Program completed successfully.\n\nNo output was produced.';

    if (runner.lastRun.timedOut) {
      return (
        <div className="output-box error">
          <strong>Execution stopped</strong>
          <pre>The program took too long and was stopped.</pre>
        </div>
      );
    }

    if (runner.lastRun.status === 'success' && !hasOutput) {
      return (
        <div className="output-box success">
          <strong>Program completed successfully.</strong>
          <pre>No output was produced.</pre>
        </div>
      );
    }

    if (runner.lastRun.status === 'success' && hasOutput) {
      return (
        <div className="output-box">
          <strong>Program Output</strong>
          <pre>{outputText}</pre>
        </div>
      );
    }

    return (
      <div className="output-box error">
        <strong>{runner.lastRun.status === 'syntax_error' ? 'Syntax Error' : 'Program Error'}</strong>
        <pre>{outputText}</pre>
      </div>
    );
  };

  const renderVerificationStatus = () => {
    if (!verificationOutcome) {
      return <div className="output-placeholder">Run the verification tests to check whether your solution works.</div>;
    }

    if (verificationOutcome.passed) {
      return (
        <div className="output-box success">
          <strong>Verification complete</strong>
          <pre>✓ All tests passed</pre>
        </div>
      );
    }

    return (
      <div className="output-box warning">
        <strong>Verification incomplete</strong>
        <pre>{verificationOutcome.summary}</pre>
      </div>
    );
  };

  const renderStepContent = () => {
    if (state === 'problem_description') {
      return (
        <div className="step-panel">
          <div className="step-header">
            <span className="eyebrow">Step 1 of 8</span>
            <h2>Problem Description</h2>
          </div>
          <p className="study-text">{sampleProblem.description}</p>
          <div className="info-box">
            <strong>Expected Behavior</strong>
            <p>{sampleProblem.expectedBehavior}</p>
          </div>
          <div className="action-row">
            <button onClick={() => transition('read_code')}>Start</button>
          </div>
        </div>
      );
    }

    if (state === 'read_code') {
      return (
        <div className="step-panel">
          <div className="step-header">
            <span className="eyebrow">Step 2 of 8</span>
            <h2>Read Code</h2>
          </div>
          <div className="code-panel read-only">
            <div className="panel-label">Code to inspect</div>
            <pre>{code}</pre>
          </div>
          <p className="study-text muted">Take a moment to read through the program before continuing.</p>
          <div className="action-row">
            <button onClick={() => transition('predict_output')}>I’ve finished reading</button>
          </div>
        </div>
      );
    }

    if (state === 'predict_output') {
      return (
        <div className="step-panel">
          <div className="step-header">
            <span className="eyebrow">Step 3 of 8</span>
            <h2>Predict the program’s behavior</h2>
          </div>
          <div className="code-panel read-only">
            <div className="panel-label">Code to inspect</div>
            <pre>{code}</pre>
          </div>
          <label className="field-label">What do you think this program will do?</label>
          <textarea value={prediction} onChange={(e) => setPrediction(e.target.value)} rows={6} />
          <div className="action-row">
            <button disabled={!prediction.trim()} onClick={handleSubmitPrediction}>Submit Prediction</button>
          </div>
        </div>
      );
    }

    if (state === 'debug_diagnose') {
      return (
        <div className="step-panel">
          <div className="step-header">
            <span className="eyebrow">Step 4 of 8</span>
            <h2>Diagnose the bug</h2>
          </div>
          <div className="code-panel read-only">
            <div className="panel-label">Code to inspect</div>
            <pre>{code}</pre>
          </div>
          <label className="field-label">What do you think is wrong with this program?</label>
          <textarea value={diagnosis} onChange={(e) => setDiagnosis(e.target.value)} rows={6} />
          <div className="action-row">
            <button disabled={!diagnosis.trim()} onClick={handleSubmitDiagnosis}>Continue to Run</button>
          </div>
        </div>
      );
    }

    if (state === 'run') {
      return (
        <div className="step-panel">
          <div className="step-header">
            <span className="eyebrow">Step 5 of 8</span>
            <h2>Run</h2>
          </div>
          <div className="code-panel read-only">
            <div className="panel-label">Code</div>
            <pre>{code}</pre>
          </div>
          <div className="result-panel">
            <h3>Program Output</h3>
            {renderExecutionStatus()}
          </div>
          <div className="action-row">
            <button disabled={!runner.ready || runner.running} onClick={handleRun}>{runner.running ? 'Running...' : 'Run Program'}</button>
            <button className="secondary" onClick={() => transition('fix')}>Continue to Fix</button>
          </div>
        </div>
      );
    }

    if (state === 'fix') {
      return (
        <div className="step-panel">
          <div className="step-header">
            <span className="eyebrow">Step 6 of 8</span>
            <h2>Fix the Program</h2>
          </div>
          <div className="code-panel editable">
            <div className="panel-label">Edit your solution</div>
            <textarea value={code} onChange={(e) => setCode(e.target.value)} rows={16} />
          </div>
          <div className="result-panel">
            <h3>Most recent result</h3>
            {renderExecutionStatus()}
          </div>
          <div className="action-row">
            <button disabled={!codeHasChanged} onClick={() => transition('verify_tests')}>Continue to Verify</button>
          </div>
        </div>
      );
    }

    if (state === 'verify_tests') {
      return (
        <div className="step-panel">
          <div className="step-header">
            <span className="eyebrow">Step 7 of 8</span>
            <h2>Verify Your Fix</h2>
          </div>
          <div className="info-box neutral">
            <strong>Run the test suite</strong>
            <p>Check whether your solution passes the verification checks.</p>
          </div>
          <div className="result-panel">
            <h3>Verification Result</h3>
            {renderVerificationStatus()}
          </div>
          <div className="action-row">
            <button onClick={handleVerify}>Run Verification Tests</button>
            {verificationOutcome && !verificationOutcome.passed ? (
              <button className="secondary" onClick={() => transition('fix', { lastVerificationPassed: false })}>Return to Fix</button>
            ) : null}
          </div>
        </div>
      );
    }

    if (state === 'explain_fix') {
      return (
        <div className="step-panel">
          <div className="step-header">
            <span className="eyebrow">Step 8 of 8</span>
            <h2>Explain the Fix</h2>
          </div>
          <label className="field-label">What was wrong with the original program, and how did your change fix it?</label>
          <textarea value={explanation} onChange={(e) => setExplanation(e.target.value)} rows={8} />
          <div className="action-row">
            <button disabled={!explanation.trim()} onClick={handleSubmitExplanation}>Submit Problem</button>
          </div>
        </div>
      );
    }

    return (
      <div className="step-panel complete-panel">
        <div className="step-header">
          <span className="eyebrow">Complete</span>
          <h2>Problem Complete</h2>
        </div>
        <p className="study-text">Your response has been recorded.</p>
        <div className="action-row">
          <button onClick={() => {
            setState('problem_description');
            setCode(sampleProblem.buggyCode);
            setPrediction('');
            setDiagnosis('');
            setExplanation('');
            setPredictionSubmitted(false);
            setDiagnosisSubmitted(false);
            setExplanationSubmitted(false);
            setVerificationPassed(false);
            setVerificationOutcome(null);
            setRunCount(0);
          }}>Continue to Next Problem</button>
        </div>
      </div>
    );
  };

  return (
    <div className="study-shell">
      <div className="study-app">
        <header className="study-header">
          <div className="title-block">
            <span className="app-name">Debugging Study</span>
            <span className="problem-counter">Problem {sampleProblem.problemId.replace('p_', '')} of 8</span>
          </div>
        </header>

        <nav className="stepper" aria-label="Progress">
          {STEP_ORDER.map((step) => {
            const index = STEP_ORDER.indexOf(step);
            const isCurrent = step === state;
            const isComplete = index < currentIndex;
            const isFuture = index > currentIndex;

            return (
              <div
                key={step}
                className={`step-pill ${isCurrent ? 'current' : ''} ${isComplete ? 'complete' : ''} ${isFuture ? 'future' : ''}`}
              >
                <span className="dot" />
                {STATE_LABELS[step]}
              </div>
            );
          })}
        </nav>

        <main className="study-body">
          <div className="step-count">Step {Math.min(currentIndex + 1, 8)} of 8</div>
          {renderStepContent()}
        </main>
      </div>
    </div>
  );
}

export default App;
