// Ported near-verbatim from python-test-platform's
// src/services/codeExecutionService.js (ESM -> CommonJS only). Runs candidate
// Python code against Judge0's hosted CE API for the PROGRAMMING question
// type. Requires JUDGE0_API_KEY (see backend/.env) — without it, runCode /
// grading fail gracefully with a clear error instead of crashing.

const JUDGE0_BASE_URL = 'https://judge0-ce.p.rapidapi.com';
const JUDGE0_HOST = 'judge0-ce.p.rapidapi.com';
const PYTHON_LANGUAGE_ID = process.env.JUDGE0_PYTHON_LANGUAGE_ID || 71;

const MAX_ATTEMPTS = 2;
const RETRY_DELAY_MS = 500;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function toBase64(str) {
  return Buffer.from(str ?? '', 'utf-8').toString('base64');
}

function fromBase64(str) {
  if (!str) return '';
  return Buffer.from(str, 'base64').toString('utf-8');
}

async function callJudge0(code, stdin) {
  const apiKey = process.env.JUDGE0_API_KEY;
  if (!apiKey) {
    throw new Error('JUDGE0_API_KEY is not set.');
  }

  const res = await fetch(`${JUDGE0_BASE_URL}/submissions?base64_encoded=true&wait=true`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-RapidAPI-Key': apiKey,
      'X-RapidAPI-Host': JUDGE0_HOST,
    },
    body: JSON.stringify({
      language_id: PYTHON_LANGUAGE_ID,
      source_code: toBase64(code),
      stdin: toBase64(stdin),
    }),
  });

  if (!res.ok) {
    throw new Error(`Judge0 request failed with status ${res.status}`);
  }

  const data = await res.json();
  const statusId = data.status?.id;

  const success = statusId === 3;

  const stderr = fromBase64(data.stderr);
  const compileOutput = fromBase64(data.compile_output);
  const message = fromBase64(data.message);

  let error = '';
  if (!success) {
    error = stderr || compileOutput || message || data.status?.description || 'Execution failed.';
  }

  return {
    success,
    output: fromBase64(data.stdout).trim(),
    error: error.trim(),
  };
}

async function runPythonCode(code, stdin = '') {
  let lastError = 'Execution service unavailable.';

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      return await callJudge0(code, stdin);
    } catch (err) {
      lastError = err.message || 'Execution service unavailable.';
      console.error(`Judge0 execution error (attempt ${attempt}/${MAX_ATTEMPTS}):`, lastError);
      if (attempt < MAX_ATTEMPTS) {
        await sleep(RETRY_DELAY_MS * attempt);
      }
    }
  }

  return { success: false, output: '', error: lastError };
}

function normalizeOutput(str) {
  return (str || '').trim().replace(/\r\n/g, '\n');
}

module.exports = { runPythonCode, normalizeOutput };
