export interface Env {
  /** GitHub App webhook secret — set via `wrangler secret put WEBHOOK_SECRET` */
  WEBHOOK_SECRET: string;
  /** Fine-grained PAT with Actions:write on BlastSimulator2026 — set via `wrangler secret put GH_PAT` */
  GH_PAT: string;
  /** Repository owner (set in wrangler.toml [vars]) */
  REPO_OWNER: string;
  /** Repository name (set in wrangler.toml [vars]) */
  REPO_NAME: string;
  /** Workflow file name to dispatch (set in wrangler.toml [vars]) */
  WORKFLOW_FILE: string;
  /** GitHub App bot login that should trigger the agent (set in wrangler.toml [vars]) */
  BOT_LOGIN: string;
}

/**
 * Verify the GitHub webhook HMAC-SHA256 signature using the Web Crypto API.
 * Returns true only when the computed digest matches the header value.
 */
async function verifySignature(secret: string, body: string, sig: string): Promise<boolean> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const mac = await crypto.subtle.sign('HMAC', key, encoder.encode(body));
  const expected =
    'sha256=' +
    Array.from(new Uint8Array(mac))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');

  // Constant-time comparison to prevent timing attacks
  if (expected.length !== sig.length) return false;
  const a = encoder.encode(expected);
  const b = encoder.encode(sig);
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

/** Trigger `workflow_dispatch` on the configured workflow file. */
async function dispatchWorkflow(env: Env, inputs: Record<string, string>): Promise<void> {
  const url = `https://api.github.com/repos/${env.REPO_OWNER}/${env.REPO_NAME}/actions/workflows/${env.WORKFLOW_FILE}/dispatches`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.GH_PAT}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'Content-Type': 'application/json',
      'User-Agent': 'blast-swe-webhook/1.0',
    },
    body: JSON.stringify({ ref: 'main', inputs }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`workflow_dispatch failed: ${res.status} ${text}`);
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    // Only accept POST requests
    if (request.method !== 'POST') {
      return new Response('ok', { status: 200 });
    }

    const body = await request.text();
    const sig = request.headers.get('x-hub-signature-256') ?? '';

    if (!(await verifySignature(env.WEBHOOK_SECRET, body, sig))) {
      return new Response('invalid signature', { status: 401 });
    }

    const event = request.headers.get('x-github-event') ?? '';
    const payload = JSON.parse(body) as Record<string, unknown>;

    let issueNumber: string | undefined;
    let commentBody: string | undefined;

    const action = payload.action as string | undefined;

    if (event === 'issues' && action === 'assigned') {
      const assignee = (payload.assignee as { login?: string } | undefined)?.login;
      if (assignee !== env.BOT_LOGIN) return new Response('ignored');
      issueNumber = String((payload.issue as { number: number }).number);
      commentBody = `assigned to ${env.BOT_LOGIN}`;
    } else if (event === 'issue_comment' && action === 'created') {
      const comment = payload.comment as { body?: string } | undefined;
      const sender = payload.sender as { login?: string; type?: string } | undefined;
      // Only react to owner-posted @openswe mentions
      if (!comment?.body?.includes('@openswe')) return new Response('ignored');
      if (sender?.type !== 'User') return new Response('ignored'); // skip bot comments
      issueNumber = String((payload.issue as { number: number }).number);
      commentBody = comment.body;
    } else if (event === 'pull_request' && (action === 'assigned' || action === 'review_requested')) {
      const assignee = (payload.assignee as { login?: string } | undefined)?.login;
      const reviewer = (payload.requested_reviewer as { login?: string } | undefined)?.login;
      const login = assignee ?? reviewer;
      if (login !== env.BOT_LOGIN) return new Response('ignored');
      issueNumber = String((payload.pull_request as { number: number }).number);
      commentBody = `${action} on PR`;
    } else {
      return new Response('ignored');
    }

    await dispatchWorkflow(env, {
      issue_number: issueNumber,
      comment_body: commentBody ?? '',
    });

    return new Response('dispatched', { status: 202 });
  },
};
