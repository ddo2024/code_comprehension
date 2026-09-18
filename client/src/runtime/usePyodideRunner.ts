import { useEffect, useRef, useState } from 'react';

export interface RunResult {
  success: boolean;
  stdout: string;
  stderr: string;
  durationMs: number;
  runNumber: number;
  timedOut?: boolean;
}

export function usePyodideRunner() {
  const workerRef = useRef<Worker | null>(null);
  const [ready, setReady] = useState(false);
  const [stdout, setStdout] = useState('');
  const [stderr, setStderr] = useState('');
  const [lastRun, setLastRun] = useState<RunResult | null>(null);

  useEffect(() => {
    const worker = new Worker(new URL('./pyodideWorker.ts', import.meta.url), { type: 'module' });
    workerRef.current = worker;

    worker.onmessage = (event: MessageEvent) => {
      const message = event.data;

      if (message.type === 'ready') {
        setReady(true);
      } else if (message.type === 'stdout') {
        setStdout((prev) => prev + message.data);
      } else if (message.type === 'stderr') {
        setStderr((prev) => prev + message.data);
      } else if (message.type === 'result') {
        setLastRun(message.data as RunResult);
      } else if (message.type === 'timeout') {
        setLastRun({
          success: false,
          stdout: '',
          stderr: message.data.message,
          durationMs: message.data.durationMs,
          runNumber: 1,
          timedOut: true,
        });
      }
    };

    worker.postMessage({ type: 'init' });

    return () => {
      worker.terminate();
    };
  }, []);

  const runCode = (code: string, timeoutMs = 5000) => {
    setStdout('');
    setStderr('');
    workerRef.current?.postMessage({ type: 'run', code, timeoutMs });
  };

  return { ready, runCode, stdout, stderr, lastRun };
}
