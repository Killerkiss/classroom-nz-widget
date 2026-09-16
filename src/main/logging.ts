import electronLog from 'electron-log/main';

/**
 * Anything that could carry a credential or a student's data is scrubbed before it
 * reaches a log file. Logs are the easiest place for a secret to leak into plain
 * text, and this app handles tokens and class rosters.
 */
const REDACTIONS: Array<[RegExp, string]> = [
  [/\b(Bearer\s+)[A-Za-z0-9._~+/-]+=*/gi, '$1<redacted>'],
  [/"(access_token|refresh_token|id_token|password|client_secret|code_verifier)"\s*:\s*"[^"]*"/gi, '"$1":"<redacted>"'],
  [/\b(ya29|1\/\/)[A-Za-z0-9._~+/-]{10,}/g, '<redacted-token>'],
  [/\bcookie:\s*[^\n]+/gi, 'cookie: <redacted>'],
  [/[\w.+-]+@[\w-]+\.[\w.]+/g, '<redacted-email>'],
];

function redact(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  let out = value;
  for (const [pattern, replacement] of REDACTIONS) out = out.replace(pattern, replacement);
  return out;
}

electronLog.initialize();
electronLog.hooks.push((message) => ({ ...message, data: message.data.map(redact) }));
electronLog.transports.file.level = 'info';
electronLog.transports.console.level = 'debug';

export const log = electronLog;
