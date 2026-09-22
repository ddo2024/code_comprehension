const PYODIDE_URL = 'https://cdn.jsdelivr.net/pyodide/v0.26.4/full/pyodide.js';

let pyodide: any = null;
let initInFlight: Promise<void> | null = null;
let stdoutBuffer = '';
let stderrBuffer = '';

const getNamespaceScript = (code: string) => {
  const sanitized = String(code ?? '');
  return [
    'import builtins',
    '__study_ns__ = {"__builtins__": builtins.__dict__}',
    `exec(${JSON.stringify(sanitized)}, __study_ns__, __study_ns__)`,
  ].join('\n');
};

const initializePyodide = async () => {
  if (pyodide) return;

  if (!initInFlight) {
    initInFlight = (async () => {
      // @ts-expect-error importScripts is available in this classic worker
      self.importScripts(PYODIDE_URL);
      // @ts-expect-error pyodide attaches to self
      pyodide = await self.loadPyodide({
        indexURL: 'https://cdn.jsdelivr.net/pyodide/v0.26.4/full/',
      });

      pyodide.setStdout({ batched: (text: string) => {
        stdoutBuffer += text;
        self.postMessage({ type: 'stdout', data: text });
      }});

      pyodide.setStderr({ batched: (text: string) => {
        stderrBuffer += text;
        self.postMessage({ type: 'stderr', data: text });
      }});

      pyodide.runPython('1 + 1');
    })();
  }

  await initInFlight;
};

self.onmessage = async (event: MessageEvent) => {
  const message = event.data;

  if (message.type === 'init') {
    try {
      await initializePyodide();
      self.postMessage({ type: 'ready' });
    } catch (error) {
      self.postMessage({
        type: 'error',
        message: error instanceof Error ? error.message : 'Unknown Pyodide init error',
      });
    }
    return;
  }

  if (message.type === 'run') {
    if (!pyodide) {
      self.postMessage({ type: 'error', message: 'Pyodide worker not ready' });
      return;
    }

    const started = performance.now();
    stdoutBuffer = '';
    stderrBuffer = '';

    try {
      const combined = [message.runnerCode ?? '', message.code ?? ''].filter(Boolean).join('\n');
      pyodide.runPython(getNamespaceScript(combined));

      self.postMessage({
        type: 'result',
        data: {
          runId: message.runId,
          status: 'success',
          stdout: stdoutBuffer,
          stderr: stderrBuffer,
          durationMs: Math.max(0, performance.now() - started),
        },
      });
    } catch (error) {
      const text = error instanceof Error ? error.message : String(error);
      const normalized = /SyntaxError|IndentationError|Expected|expected|unexpected EOF/.test(text)
        ? 'syntax_error'
        : 'runtime_error';

      self.postMessage({
        type: 'result',
        data: {
          runId: message.runId,
          status: normalized,
          stdout: stdoutBuffer,
          stderr: text,
          durationMs: Math.max(0, performance.now() - started),
        },
      });
    }
  }
};
