// Ensure Pyodide is loaded in browser-only runtime.
const PYODIDE_URL = 'https://cdn.jsdelivr.net/pyodide/v0.26.4/full/pyodide.js';

let pyodide: any;
let workerReady = false;
let timeoutHandle: number | undefined;

self.onmessage = async (event: MessageEvent) => {
  const message = event.data;

  if (message.type === 'init') {
    try {
      // @ts-expect-error web worker global importScripts is available
      self.importScripts(PYODIDE_URL);
      // @ts-expect-error pyodide attaches to self
      pyodide = await self.loadPyodide({
        indexURL: 'https://cdn.jsdelivr.net/pyodide/v0.26.4/full/',
      });

      pyodide.setStdout({ batched: (text: string) => self.postMessage({ type: 'stdout', data: text }) });
      pyodide.setStderr({ batched: (text: string) => self.postMessage({ type: 'stderr', data: text }) });
      workerReady = true;
      self.postMessage({ type: 'ready' });
    } catch (error) {
      self.postMessage({
        type: 'error',
        message: error instanceof Error ? error.message : 'Unknown Pyodide init error',
      });
    }
    return;
  }

  if (!workerReady) {
    self.postMessage({ type: 'error', message: 'Pyodide worker not ready' });
    return;
  }

  if (message.type === 'terminate') {
    if (timeoutHandle) clearTimeout(timeoutHandle);
    self.close();
    return;
  }

  if (message.type === 'run') {
    const started = performance.now();
    const timeoutMs = message.timeoutMs ?? 5000;

    if (timeoutHandle) clearTimeout(timeoutHandle);

    timeoutHandle = self.setTimeout(() => {
      self.postMessage({
        type: 'timeout',
        data: {
          message: 'Execution timed out',
          durationMs: timeoutMs,
        },
      });
    }, timeoutMs);

    try {
      pyodide.runPython(message.code || '');
      const durationMs = performance.now() - started;
      self.postMessage({
        type: 'result',
        data: {
          success: true,
          stdout: '',
          stderr: '',
          durationMs,
          runNumber: 1,
        },
      });
    } catch (error) {
      const durationMs = performance.now() - started;
      self.postMessage({
        type: 'result',
        data: {
          success: false,
          stdout: '',
          stderr: error instanceof Error ? error.message : String(error),
          durationMs,
          runNumber: 1,
        },
      });
    } finally {
      if (timeoutHandle) clearTimeout(timeoutHandle);
    }
  }
};
