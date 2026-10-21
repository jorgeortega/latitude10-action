import type { Octokit } from './io.ts';

export const FIXES_BRANCH = 'latitude10/readiness-fixes';

// One pull request with the suggested fixes: the branch is reset to the
// base's head, the fixed file committed, and the open pull request updated
// instead of a second one opened.
export async function openFixesPullRequest(args: { octokit: Octokit; owner: string; repo: string; base: string; path: string; content: string; summary: string }): Promise<{ url: string; updated: boolean }> {
  const { octokit, owner, repo, base, path, content, summary } = args;
  const head = (await octokit.rest.git.getRef({ owner, repo, ref: `heads/${base}` })).data.object.sha;
  let exists = true;
  try {
    await octokit.rest.git.getRef({ owner, repo, ref: `heads/${FIXES_BRANCH}` });
  } catch {
    exists = false;
  }
  if (exists) await octokit.rest.git.updateRef({ owner, repo, ref: `heads/${FIXES_BRANCH}`, sha: head, force: true });
  else await octokit.rest.git.createRef({ owner, repo, ref: `refs/heads/${FIXES_BRANCH}`, sha: head });

  const current = (await octokit.rest.repos.getContent({ owner, repo, path, ref: FIXES_BRANCH })).data as { sha?: string };
  await octokit.rest.repos.createOrUpdateFileContents({
    owner,
    repo,
    path,
    branch: FIXES_BRANCH,
    sha: current.sha,
    message: `Readiness fixes for ${path}`,
    content: Buffer.from(content, 'utf8').toString('base64'),
  });

  const body = `Suggested by [Latitude 10](https://latitude10.tech) from the readiness rules (rules only, no model).\n\n${summary}\n\nReview each change before merging: descriptions and examples are drafts.`;
  const open = (await octokit.rest.pulls.list({ owner, repo, head: `${owner}:${FIXES_BRANCH}`, state: 'open' })).data[0];
  if (open) {
    await octokit.rest.pulls.update({ owner, repo, pull_number: open.number, body });
    return { url: open.html_url, updated: true };
  }
  const created = await octokit.rest.pulls.create({ owner, repo, head: FIXES_BRANCH, base, title: `Readiness fixes for ${path}`, body });
  return { url: created.data.html_url, updated: false };
}
