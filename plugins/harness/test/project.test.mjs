import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { sandbox, gitRepo } from './helpers.mjs';
import { normalizeRemote, projectInfo, sanitizeGroup, gitExcludeFile } from '../scripts/lib/project.mjs';

test('ssh and https remotes normalize to the same identity', () => {
  const expected = 'github.com/owner/repo';
  assert.equal(normalizeRemote('git@github.com:Owner/Repo.git'), expected);
  assert.equal(normalizeRemote('https://github.com/Owner/Repo'), expected);
  assert.equal(normalizeRemote('https://user:token@github.com/Owner/Repo.git/'), expected);
  assert.equal(normalizeRemote('ssh://git@github.com:22/Owner/Repo.git'), expected);
});

test('group ids only contain characters Graphiti accepts', () => {
  assert.match(sanitizeGroup('my.repo name/with:stuff'), /^[a-zA-Z0-9_-]+$/);
  assert.equal(sanitizeGroup('...'), 'project');
});

test('projectInfo derives a stable group from the remote', (t) => {
  const sb = sandbox(); t.after(sb.cleanup);
  const a = gitRepo(sb.root, 'a', 'git@github.com:Owner/Repo.git');
  const b = gitRepo(sb.root, 'b', 'https://github.com/owner/repo');
  const ia = projectInfo(a); const ib = projectInfo(b);
  assert.equal(ia.groupId, ib.groupId);
  assert.match(ia.groupId, /^repo-[0-9a-f]{6}$/);
  assert.ok(ia.isGit);
});

test('worktrees share the main repository group', (t) => {
  const sb = sandbox(); t.after(sb.cleanup);
  const main = gitRepo(sb.root, 'main-repo');
  writeFileSync(join(main, 'f.txt'), 'x');
  const g = (args) => execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', ...args], { cwd: main });
  g(['add', '.']); g(['commit', '-qm', 'init']);
  const wt = join(sb.root, 'wt');
  g(['worktree', 'add', '-q', wt]);
  assert.equal(projectInfo(wt).groupId, projectInfo(main).groupId);
  assert.ok(gitExcludeFile(wt));
});

test('a plain directory still gets a project identity', (t) => {
  const sb = sandbox(); t.after(sb.cleanup);
  const info = projectInfo(sb.root);
  assert.equal(info.isGit, false);
  assert.match(info.groupId, /^[a-zA-Z0-9_-]+$/);
});
