// The GitHub Pages relay (docs/callback.html) must forward only provider parameters to the fixed local callback.
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import vm from 'node:vm';
import { createHash } from 'node:crypto';

const html = fs.readFileSync('docs/callback.html', 'utf8');
const script = html.match(/<script>([\s\S]*?)<\/script>/)![1];

function run(search: string) {
  let target = '';
  const link = { href: '' };
  vm.runInNewContext(script, {
    URLSearchParams,
    location: { search, replace: (u: string) => { target = u; } },
    document: { getElementById: () => link },
  });
  return { target, link: link.href };
}

describe('bank redirect relay page', () => {
  it('forwards state/code/error only, to the fixed localhost callback', () => {
    const r = run('?state=abc&code=xyz&evil=javascript:alert(1)&redirect=https://evil.example');
    expect(r.target).toBe('http://localhost:3000/api/connections/callback?state=abc&code=xyz');
    expect(r.link).toBe(r.target);
    expect(run('?state=s&error=access_denied&error_description=User+cancelled').target)
      .toBe('http://localhost:3000/api/connections/callback?state=s&error=access_denied&error_description=User+cancelled');
  });
  it('pins its inline script with a CSP hash', () => {
    const hash = createHash('sha256').update(script, 'utf8').digest('base64');
    expect(html).toContain(`script-src 'sha256-${hash}'`);
  });
});
