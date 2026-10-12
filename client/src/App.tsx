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

const API_BASE_URL = 'http://localhost:3001';

interface StudySession {
  sessionId: string;
  attemptId: string;
  studentId: string;
}

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
  const [verificationOutcome, setVerificationOutcome] = useState<{
    passed: boolean;
    results: Array<{ name: string; passed: boolean; expected: string; actual: string }>;
  } | null>(null);
  const [runCount, setRunCount] = useState(0);
  const [participantCode, setParticipantCode] = useState('');
  const [studySession, setStudySession] = useState<StudySession | null>(null);
  const [sessionStarting, setSessionStarting] = useState(false);
  const [sessionError, setSessionError] = useState('');
  const [responseSaving, setResponseSaving] = useState(false);
  const [saveError, setSaveError] = useState('');

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

  const handleStartSession = async () => {
    const studentId = participantCode.trim();
    if (!studentId) {
      setSessionError('Enter your study participant code to begin.');
      return;
    }

    setSessionStarting(true);
    setSessionError('');
    try {
      const response = await fetch(`${API_BASE_URL}/api/session/start`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          studentId,
          studyCondition: 'scaffolded',
          appVersion: '0.1.0',
          studyProtocolVersion: '1.0',
          problemId: sampleProblem.problemId,
          problemVersion: sampleProblem.version,
        }),
      });
      const data = await response.json();
      if (!response.ok || !data.attemptId) {
        throw new Error(data.error ?? 'Could not start the study session.');
      }

      setStudySession({ sessionId: data.sessionId, attemptId: data.attemptId, studentId });
    } catch (error) {
      setSessionError(error instanceof Error ? error.message : 'Could not connect to the study server.');
    } finally {
      setSessionStarting(false);
    }
  };

  const saveResponse = async (responseType: 'prediction' | 'diagnosis' | 'explanation', responseText: string) => {
    if (!studySession) {
      setSaveError('No study session is active. Start a session before submitting answers.');
      return false;
    }

    setResponseSaving(true);
    setSaveError('');
    try {
      const response = await fetch(`${API_BASE_URL}/api/session/responses`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          responseId: crypto.randomUUID(),
          attemptId: studySession.attemptId,
          responseType,
          responseText,
        }),
      });
      const data = await response.json();
      if (!response.ok || !data.saved) {
        throw new Error(data.error ?? 'The server did not save this answer.');
      }
      return true;
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : 'Could not connect to the study server. Your answer was not submitted.');
      return false;
    } finally {
      setResponseSaving(false);
    }
  };

  const handleSubmitPrediction = async () => {
    if (!prediction.trim()) {
      alert('Please enter a prediction before continuing.');
      return;
    }

    if (!(await saveResponse('prediction', prediction))) return;
    setPredictionSubmitted(true);
    transition('debug_diagnose', { predictionSubmitted: true });
  };

  const handleSubmitDiagnosis = async () => {
    if (!diagnosis.trim()) {
      alert('Please record your diagnosis before continuing.');
      return;
    }

    if (!(await saveResponse('diagnosis', diagnosis))) return;
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

  const handleVerify = async () => {
    if (!runner.ready || runner.running) return;

    setVerificationOutcome(null);
    const tests = sampleProblem.hiddenVerificationTests;
    const testData = tests.map((test) => ({
      name: test.name,
      input: test.input ?? [],
      expected: test.expected,
      assertion: test.assertion,
    }));
    const runnerCode = [
      'import json as __study_json__',
      `__study_cases__ = __study_json__.loads(${JSON.stringify(JSON.stringify(testData))})`,
      '__study_results__ = []',
      'for __study_case__ in __study_cases__:',
      '    __study_expected__ = __study_case__.get("expected")',
      '    __study_actual__ = None',
      '    __study_passed__ = False',
      '    try:',
      `        __study_function__ = globals()[${JSON.stringify(sampleProblem.entryPoint)}]`,
      '        if __study_case__["assertion"] == "raises":',
      '            try:',
      '                __study_actual__ = __study_function__(*__study_case__["input"])',
      '            except Exception as __study_error__:',
      '                __study_actual__ = f"{type(__study_error__).__name__}: {__study_error__}"',
      '                __study_passed__ = True',
      '        else:',
      '            __study_actual__ = __study_function__(*__study_case__["input"])',
      '            if __study_case__["assertion"] == "equals":',
      '                __study_passed__ = __study_actual__ == __study_expected__',
      '            elif __study_case__["assertion"] == "contains":',
      '                __study_passed__ = __study_expected__ in __study_actual__',
      '    except Exception as __study_error__:',
      '        __study_actual__ = f"{type(__study_error__).__name__}: {__study_error__}"',
      '    __study_results__.append({',
      '        "name": __study_case__["name"],',
      '        "passed": __study_passed__,',
      '        "expected": "an exception" if __study_case__["assertion"] == "raises" else repr(__study_expected__),',
      '        "actual": repr(__study_actual__),',
      '    })',
      'print("__STUDY_TEST_RESULTS__" + __study_json__.dumps(__study_results__))',
    ].join('\n');

    const runResult = await runner.runCode(code, runnerCode, 5000, true);
    const marker = '__STUDY_TEST_RESULTS__';
    const resultLine = runResult?.stdout.split('\n').find((line) => line.startsWith(marker));
    let results: Array<{ name: string; passed: boolean; expected: string; actual: string }>;

    if (runResult?.status === 'success' && resultLine) {
      try {
        results = JSON.parse(resultLine.slice(marker.length));
      } catch {
        results = tests.map((test) => ({
          name: test.name,
          passed: false,
          expected: String(test.expected),
          actual: 'Could not read the test result.',
        }));
      }
    } else {
      const errorText = runResult?.stderr || 'Python environment is not ready. Try again.';
      results = tests.map((test) => ({
        name: test.name,
        passed: false,
        expected: String(test.expected),
        actual: errorText,
      }));
    }

    const passed = results.length > 0 && results.every((result) => result.passed);
    setVerificationPassed(passed);
    setVerificationOutcome({ passed, results });
  };

  const handleSubmitExplanation = async () => {
    if (!explanation.trim()) {
      alert('Please explain your fix before finishing.');
      return;
    }

    if (!(await saveResponse('explanation', explanation))) return;
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
          <pre>{verificationOutcome.results.length} of {verificationOutcome.results.length} tests passed.</pre>
          {renderVerificationCases(verificationOutcome.results)}
        </div>
      );
    }

    return (
      <div className="output-box warning">
        <strong>Verification incomplete</strong>
        <pre>{verificationOutcome.results.filter((result) => result.passed).length} of {verificationOutcome.results.length} tests passed.</pre>
        {renderVerificationCases(verificationOutcome.results)}
      </div>
    );
  };

  const renderVerificationCases = (results: Array<{ name: string; passed: boolean; expected: string; actual: string }>) => (
    <ul className="verification-list">
      {results.map((result) => (
        <li className={result.passed ? 'verification-case passed' : 'verification-case failed'} key={result.name}>
          <div className="verification-case-heading">
            <strong>{result.passed ? 'PASS' : 'FAIL'}</strong>
            <span>{result.name}</span>
          </div>
          <div>Expected: <code>{result.expected}</code></div>
          <div>Actual: <code>{result.actual}</code></div>
        </li>
      ))}
    </ul>
  );

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
          {saveError && <div className="output-box error" role="alert">{saveError}</div>}
          <div className="action-row">
            <button disabled={!prediction.trim() || responseSaving} onClick={handleSubmitPrediction}>
              {responseSaving ? 'Saving...' : 'Submit Prediction'}
            </button>
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
          {saveError && <div className="output-box error" role="alert">{saveError}</div>}
          <div className="action-row">
            <button disabled={!diagnosis.trim() || responseSaving} onClick={handleSubmitDiagnosis}>
              {responseSaving ? 'Saving...' : 'Continue to Run'}
            </button>
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
          <div className="run-call-panel">
            <div className="panel-label">Run call</div>
            <p>The app runs this call with your function and displays the value it returns:</p>
            <pre>{sampleProblem.runCode}</pre>
          </div>
          <div className="result-panel">
            <h3>Output from this call</h3>
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
            <button disabled={!runner.ready || runner.running} onClick={handleVerify}>
              {runner.running ? 'Running tests...' : 'Run Verification Tests'}
            </button>
            {verificationOutcome?.passed ? (
              <button className="secondary" onClick={() => transition('explain_fix', { lastVerificationPassed: true })}>
                Continue to Explain
              </button>
            ) : verificationOutcome ? (
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
          {saveError && <div className="output-box error" role="alert">{saveError}</div>}
          <div className="action-row">
            <button disabled={!explanation.trim() || responseSaving} onClick={handleSubmitExplanation}>
              {responseSaving ? 'Saving...' : 'Submit Problem'}
            </button>
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

  if (!studySession) {
    return (
      <div className="study-shell">
        <section className="study-app">
          <header className="study-header">
            <div className="title-block">
              <span className="app-name">Debugging Study</span>
              <span className="problem-counter">Session setup</span>
            </div>
          </header>
          <main className="study-body">
            <div className="step-panel">
              <div className="step-header">
                <span className="eyebrow">Before you begin</span>
                <h2>Enter participant code</h2>
              </div>
              <p className="study-text muted">Use the anonymous code assigned by the researcher. Do not enter your name.</p>
              <label className="field-label" htmlFor="participant-code">Participant code</label>
              <input
                id="participant-code"
                className="text-input"
                value={participantCode}
                onChange={(event) => setParticipantCode(event.target.value)}
                autoComplete="off"
              />
              {sessionError && <div className="output-box error" role="alert">{sessionError}</div>}
              <div className="action-row">
                <button disabled={sessionStarting || !participantCode.trim()} onClick={handleStartSession}>
                  {sessionStarting ? 'Starting session...' : 'Start Study'}
                </button>
              </div>
            </div>
          </main>
        </section>
      </div>
    );
  }

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
