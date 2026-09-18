import { useMemo, useState } from 'react';
import { sampleProblem } from './problem/problemLibrary';
import { workflowPolicy, type WorkflowState } from './workflow/WorkflowPolicy';
import { usePyodideRunner } from './runtime/usePyodideRunner';

const STATE_LABELS: Record<WorkflowState, string> = {
  problem_description: 'Problem Description',
  read_code: 'Read Code',
  predict_output: 'Predict Output',
  debug_diagnose: 'Debug / Diagnose',
  run: 'Run',
  fix: 'Fix',
  verify_tests: 'Verify Tests',
  explain_fix: 'Explain the Fix',
  completed: 'Completed',
};

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
  const [runCount, setRunCount] = useState(0);

  const runner = usePyodideRunner();

  const canEdit = state === 'run' || state === 'fix';
  const canRun = state === 'run' || state === 'fix';

  const transition = (next: WorkflowState) => {
    const snapshot = {
      workflowState: state,
      predictionText: prediction,
      diagnosisText: diagnosis,
      explanationText: explanation,
      currentCode: code,
      predictionSubmitted,
      diagnosisSubmitted,
      explanationSubmitted,
      runCount,
      lastVerificationPassed: verificationPassed,
    };

    const result = workflowPolicy.transition(state, next, snapshot);
    if (!result.ok) {
      alert(result.reason ?? 'Invalid workflow transition');
      return;
    }

    setState(next);
  };

  const handleSubmitPrediction = () => {
    if (!prediction.trim()) {
      alert('Please enter a prediction before continuing.');
      return;
    }
    setPredictionSubmitted(true);
    transition('debug_diagnose');
  };

  const handleSubmitDiagnosis = () => {
    if (!diagnosis.trim()) {
      alert('Please record your diagnosis before continuing.');
      return;
    }
    setDiagnosisSubmitted(true);
    transition('run');
  };

  const handleRun = () => {
    if (!canRun) {
      alert('You must first complete the prediction and diagnosis steps.');
      return;
    }
    setRunCount((count) => count + 1);
    runner.runCode(code, 5000);
  };

  const handleFix = () => {
    transition('fix');
  };

  const handleVerify = () => {
    const passed = code.includes('return') && code.includes('sum') && code.includes('even');
    setVerificationPassed(passed);
    if (passed) {
      transition('explain_fix');
    } else {
      alert('The fix is not yet correct. Keep debugging.');
    }
  };

  const handleSubmitExplanation = () => {
    if (!explanation.trim()) {
      alert('Please explain your fix before finishing.');
      return;
    }
    setExplanationSubmitted(true);
    transition('completed');
  };

  const stepStatus = useMemo(() => {
    return {
      problem_description: true,
      read_code: true,
      predict_output: predictionSubmitted,
      debug_diagnose: diagnosisSubmitted,
      run: runCount > 0,
      fix: state === 'fix' || state === 'verify_tests' || state === 'explain_fix' || state === 'completed',
      verify_tests: verificationPassed,
      explain_fix: explanationSubmitted,
      completed: state === 'completed',
    };
  }, [predictionSubmitted, diagnosisSubmitted, runCount, verificationPassed, explanationSubmitted, state]);

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <h2>Study Flow</h2>
        <ul className="step-list">
          {Object.entries(STATE_LABELS).map(([key, label]) => (
            <li key={key} className={state === key ? 'active' : ''}>
              <span className={stepStatus[key as WorkflowState] ? 'done' : ''}>•</span>
              {label}
            </li>
          ))}
        </ul>
      </aside>

      <main className="main-panel">
        <header>
          <h1>{sampleProblem.title}</h1>
          <p className="meta">Problem {sampleProblem.problemId} • Version {sampleProblem.version}</p>
        </header>

        <section className="panel">
          <h3>Problem Description</h3>
          <p>{sampleProblem.description}</p>
          <button onClick={() => transition('read_code')}>Continue</button>
        </section>

        <section className="panel">
          <h3>Code</h3>
          <textarea
            value={code}
            readOnly={!canEdit}
            onChange={(e) => setCode(e.target.value)}
            rows={12}
          />
          <button onClick={() => transition('predict_output')}>Go to Prediction</button>
        </section>

        <section className="panel">
          <h3>Predict Output</h3>
          <textarea value={prediction} onChange={(e) => setPrediction(e.target.value)} rows={4} />
          <button onClick={handleSubmitPrediction}>Submit Prediction</button>
        </section>

        <section className="panel">
          <h3>Debug / Diagnose</h3>
          <textarea value={diagnosis} onChange={(e) => setDiagnosis(e.target.value)} rows={4} />
          <button onClick={handleSubmitDiagnosis}>Submit Diagnosis</button>
        </section>

        <section className="panel">
          <h3>Run</h3>
          <button onClick={handleRun} disabled={!canRun}>Run Python</button>
          <button onClick={handleFix}>Mark as Fix Stage</button>
          {runner.lastRun && (
            <div className="output-box">
              <p>Duration: {runner.lastRun.durationMs ?? 'n/a'} ms</p>
              <pre>{runner.stdout || runner.stderr || 'No output'}</pre>
            </div>
          )}
        </section>

        <section className="panel">
          <h3>Fix</h3>
          <textarea value={code} onChange={(e) => setCode(e.target.value)} rows={12} readOnly={!canEdit} />
          <button onClick={handleVerify}>Verify with Hidden Tests</button>
        </section>

        <section className="panel">
          <h3>Explain the Fix</h3>
          <textarea value={explanation} onChange={(e) => setExplanation(e.target.value)} rows={4} />
          <button onClick={handleSubmitExplanation}>Submit Explanation</button>
        </section>
      </main>
    </div>
  );
}

export default App;
