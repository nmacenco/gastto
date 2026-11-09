const expected = process.env.WEBHOOK_BASE_URL;
const mode = process.argv[2];

function validateOrigin(value) {
  if (!value || !/^https:\/\/[A-Za-z0-9.-]+$/.test(value)) {
    throw new Error('WEBHOOK_BASE_URL must be an HTTPS origin without port, path, query, or fragment');
  }
  const url = new URL(value);
  if (url.hostname === 'localhost' || url.hostname.endsWith('.localhost')) {
    throw new Error('WEBHOOK_BASE_URL must use the assigned public ngrok domain');
  }
  return url.origin;
}

async function waitForTunnel(origin) {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch('http://127.0.0.1:4040/api/endpoints', {
        signal: AbortSignal.timeout(2_000),
      });
      if (response.ok) {
        const data = await response.json();
        if (Array.isArray(data.endpoints) && data.endpoints.some((endpoint) => endpoint.url === origin)) {
          process.stdout.write('ngrok endpoint is connected\n');
          return;
        }
      }
    } catch {
      // The agent's local API is not ready yet.
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error('ngrok did not expose WEBHOOK_BASE_URL within 30 seconds; check its token, domain, and logs');
}

try {
  const origin = validateOrigin(expected);
  if (mode === 'validate' && !process.env.NGROK_AUTHTOKEN) {
    throw new Error('NGROK_AUTHTOKEN is required when the tunnel profile is enabled');
  }
  if (mode === 'wait') await waitForTunnel(origin);
  else if (mode !== 'validate') throw new Error('Expected validate or wait mode');
} catch (error) {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
}
