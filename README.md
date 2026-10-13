# Debugging Study MVP

A browser-based Python debugging study prototype. Student code runs in Pyodide in a browser worker; the Express server stores participant sessions and submitted study responses in SQLite.

## Requirements

- Node.js 24 recommended
- npm
- SQLite command-line tool, if you want to inspect the database (`sqlite3`)

## Install and run

From the project root:

```bash
npm install
npm run dev
```

Open the frontend at <http://localhost:5173/>. The API runs at <http://localhost:3001/>; its health check is <http://localhost:3001/health>.

Keep the terminal running while using the app. Press `Ctrl+C` to stop the development servers. If you see `EADDRINUSE`, a server is already using that port; stop the existing process before restarting.

## Use the study flow

1. Enter a researcher-assigned anonymous participant code. Do not enter a participant's name.
2. Complete the workflow steps in order.
3. Prediction, diagnosis, and explanation responses are saved when their respective submit buttons succeed.
4. In the Run step, the app displays the function call used to produce the output.
5. In Verify, run the tests to see each result, expected value, and actual value.

Python execution stays in the browser. The backend does not execute submitted Python code.

## View saved responses

The local SQLite database is created at `server/data/study.db`. From the project root, run:

```bash
sqlite3 -header -column server/data/study.db "
SELECT s.student_id, p.problem_id, r.response_type, r.response_text, r.submitted_at
FROM responses r
JOIN problem_attempts p ON p.attempt_id = r.attempt_id
JOIN sessions s ON s.session_id = p.session_id
ORDER BY r.submitted_at;"
```

To show one participant only, add a filter before `ORDER BY`:

```sql
WHERE s.student_id = 'PARTICIPANT_CODE'
```

The database is local to this machine and is excluded from Git. Back it up separately if the study data needs to be retained. The repository currently contains test responses for participant code `test_persistence_20261012_001`; do not treat those as study data.

## Useful commands

```bash
npm run build --workspace client
curl http://localhost:3001/health
```

The client build runs TypeScript checks and creates production assets in `client/dist/`.
