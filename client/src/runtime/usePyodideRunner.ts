import { useCallback, useEffect, useState } from 'react';

export type RuntimeStatus = 'idle' | 'loading' | 'ready' | 'running' | 'error' | 'restarting';

export interface RunResult {
  runId: string;
  status: 'success' | 'runtime_error' | 'syntax_error' | 'timeout';
  stdout: string;
  stderr: string;
  durationMs: number;
  timedOut?: boolean;
}

type RuntimeStore = {
  worker: Worker | null;
  status: RuntimeStatus;
  ready: boolean;
  errorMessage: string | null;
  activeRunId: string | null;
  lastResult: RunResult | null;
  generation: number;
  timeoutId: number | null;
};

declare global {
  var __debuggingStudyRuntime__: RuntimeStore | undefined;
}

const getRuntimeStore = (): RuntimeStore => {
  if (!globalThis.__debuggingStudyRuntime__) {
    globalThis.__debuggingStudyRuntime__ = {
      worker: null,
      status: 'idle',
      ready: false,
      errorMessage: null,
      activeRunId: null,
      lastResult: null,
      generation: 0,
      timeoutId: null,
    };
  }

  return globalThis.__debuggingStudyRuntime__;
};

export function usePyodideRunner() {
  const runtime = getRuntimeStore();
  const [ready, setReady] = useState(runtime.ready);
  const [status, setStatus] = useState<RuntimeStatus>(runtime.status);
  const [running, setRunning] = useState(false);
  const [stdout, setStdout] = useState('');
  const [stderr, setStderr] = useState('');
  const [lastRun, setLastRun] = useState<RunResult | null>(runtime.lastResult);
  const [errorMessage, setErrorMessage] = useState<string | null>(runtime.errorMessage);

  const applyRuntimeState = useCallback(() => {
    setReady(runtime.ready);
    setStatus(runtime.status);
    setErrorMessage(runtime.errorMessage);
    setLastRun(runtime.lastResult);
  }, [runtime]);

  const createWorker = useCallback(() => {
    if (runtime.worker) return runtime.worker;

    // The worker uses importScripts to load Pyodide, so it must be a classic worker.
    const worker = new Worker(new URL('./pyodideWorker.ts', import.meta.url));
    runtime.worker = worker;
    runtime.status = 'loading';
    setStatus('loading');
    setReady(false);
    setRunning(false);

    runtime.timeoutId = window.setTimeout(() => {
      if (runtime.worker !== worker || runtime.status !== 'loading') return;

      worker.terminate();
      runtime.worker = null;
      runtime.ready = false;
      runtime.status = 'error';
      runtime.errorMessage = 'Python environment timed out while loading.';
      runtime.timeoutId = null;
      setReady(false);
      setStatus('error');
      setErrorMessage(runtime.errorMessage);
    }, 30000);

    worker.onmessage = (event: MessageEvent) => {
      const message = event.data;

      if (message.type === 'ready') {
        if (runtime.timeoutId) {
          window.clearTimeout(runtime.timeoutId);
          runtime.timeoutId = null;
        }
        runtime.ready = true;
        runtime.status = 'ready';
        runtime.errorMessage = null;
        setReady(true);
        setStatus('ready');
        setErrorMessage(null);
        return;
      }

      if (message.type === 'stdout') {
        setStdout((prev) => prev + String(message.data ?? ''));
        return;
      }

      if (message.type === 'stderr') {
        setStderr((prev) => prev + String(message.data ?? ''));
        return;
      }

      if (message.type === 'result') {
        const result = message.data as RunResult;
        if (runtime.activeRunId && result.runId !== runtime.activeRunId) {
          return;
        }

        runtime.lastResult = result;
        runtime.status = 'ready';
        setStatus('ready');
        setReady(true);
        setRunning(false);
        setLastRun(result);

        if (runtime.timeoutId) {
          window.clearTimeout(runtime.timeoutId);
          runtime.timeoutId = null;
        }
        return;
      }

      if (message.type === 'error') {
        runtime.ready = false;
        runtime.status = 'error';
        runtime.errorMessage = String(message.message ?? 'Python environment could not be loaded.');
        setReady(false);
        setStatus('error');
        setRunning(false);
        setErrorMessage(runtime.errorMessage);
      }
    };

    worker.onerror = (event) => {
      if (runtime.timeoutId) {
        window.clearTimeout(runtime.timeoutId);
        runtime.timeoutId = null;
      }
      runtime.worker = null;
      runtime.ready = false;
      runtime.status = 'error';
      runtime.errorMessage = event.message || 'Python worker failed to start.';
      setReady(false);
      setStatus('error');
      setRunning(false);
      setErrorMessage(runtime.errorMessage);
    };

    worker.postMessage({ type: 'init', generation: runtime.generation });
    return worker;
  }, [runtime]);

  const replaceWorker = useCallback(() => {
    if (runtime.timeoutId) {
      window.clearTimeout(runtime.timeoutId);
      runtime.timeoutId = null;
    }

    runtime.worker?.terminate();
    runtime.worker = null;
    runtime.ready = false;
    runtime.status = 'restarting';
    runtime.errorMessage = 'Restarting Python environment...';
    runtime.generation += 1;
    setStatus('restarting');
    setReady(false);
    setErrorMessage('Restarting Python environment...');
    setRunning(false);
    createWorker();
  }, [createWorker, runtime]);

  useEffect(() => {
    if (!runtime.worker) {
      createWorker();
    }

    applyRuntimeState();
  }, [applyRuntimeState, createWorker, runtime]);

  const runCode = useCallback((code: string, runnerCode = '', timeoutMs = 5000) => {
    if (!runtime.worker) {
      createWorker();
    }

    if (!runtime.worker || runtime.status === 'loading' || runtime.status === 'restarting') {
      setErrorMessage('Preparing Python environment...');
      return;
    }

    const runId = crypto.randomUUID();
    runtime.activeRunId = runId;
    runtime.status = 'running';
    setStatus('running');
    setRunning(true);
    setStdout('');
    setStderr('');
    setErrorMessage(null);

    if (runtime.timeoutId) {
      window.clearTimeout(runtime.timeoutId);
    }

    runtime.timeoutId = window.setTimeout(() => {
      if (runtime.activeRunId !== runId) {
        return;
      }

      const timedOutResult: RunResult = {
        runId,
        status: 'timeout',
        stdout: '',
        stderr: 'The program took too long and was stopped.',
        durationMs: timeoutMs,
        timedOut: true,
      };

      runtime.lastResult = timedOutResult;
      runtime.status = 'restarting';
      setStatus('restarting');
      setRunning(false);
      setLastRun(timedOutResult);
      setErrorMessage('Restarting Python environment...');
      replaceWorker();
    }, timeoutMs);

    runtime.worker.postMessage({ type: 'run', runId, code, runnerCode, timeoutMs });
  }, [createWorker, replaceWorker, runtime]);

  return {
    ready,
    status,
    running,
    stdout,
    stderr,
    lastRun,
    errorMessage,
    runCode,
    replaceWorker,
  };
}
