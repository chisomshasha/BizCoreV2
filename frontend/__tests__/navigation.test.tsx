/**
 * Every in-app navigation target must resolve to a real screen.
 *
 * A dead link is a silent dead end for the client: the user taps it and
 * nothing happens (or a 404 screen appears).
 */
import fs from 'fs';
import path from 'path';

const APP_DIR = path.resolve(__dirname, '..', 'app');

function collectRoutes(dir: string, prefix = ''): Set<string> {
  const routes = new Set<string>();
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      const isGroup = /^\(.*\)$/.test(entry.name);
      const seg = isGroup ? '' : entry.name;
      for (const r of collectRoutes(full, `${prefix}/${seg}`)) routes.add(r);
    } else if (entry.name.endsWith('.tsx')) {
      const base = entry.name.replace(/\.tsx$/, '');
      if (base === 'index') {
        routes.add(prefix || '/');
      } else {
        routes.add(`${prefix}/${base}`.replace(/\/+/g, '/'));
      }
    }
  }
  return routes;
}

describe('navigation integrity', () => {
  const routes = collectRoutes(APP_DIR);

  it('discovers the expected route table', () => {
    expect(routes.has('/inventory')).toBe(true);
    expect(routes.has('/login')).toBe(true);
    expect(routes.has('/role-permissions')).toBe(true);
    expect(routes.has('/order/[id]')).toBe(true);
    expect(routes.size).toBeGreaterThan(20);
  });

  it('every href and router.push target resolves to a real route', () => {
    const files: string[] = [];
    const walk = (dir: string) => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, e.name);
        if (e.isDirectory()) walk(full);
        else if (/\.(tsx|ts)$/.test(e.name)) files.push(full);
      }
    };
    walk(APP_DIR);

    const broken: string[] = [];
    for (const file of files) {
      const src = fs.readFileSync(file, 'utf8');
      const rel = path.relative(APP_DIR, file);
      const targets = [
        ...src.matchAll(/href=["'`]([^"'`]+)["'`]/g),
        ...src.matchAll(/router\.(?:push|replace)\(\s*["'`]([^"'`]+)["'`]/g),
      ];
      for (const m of targets) {
        const raw = m[1];
        if (!raw.startsWith('/')) continue;                 // external URL
        if (raw.startsWith('/api')) continue;
        const clean = raw.split('?')[0].split('#')[0].replace(/\/+$/, '') || '/';
        // group-qualified paths are valid in expo-router: /(auth)/login
        const withoutGroups = clean.replace(/\/\([^)]*\)/g, '');
        const segs = withoutGroups.split('/').filter(Boolean);
        const ok = [...routes].some((r) => {
          const rs = r.split('/').filter(Boolean);
          if (rs.length !== segs.length) return false;
          return rs.every((rsx, i) => rsx.startsWith('[') || rsx === segs[i]);
        });
        if (!ok) broken.push(`${rel}: ${raw}`);
      }
    }
    expect(broken).toEqual([]);
  });

  it('every screen is reachable from somewhere in the app', () => {
    const files: string[] = [];
    const walk = (dir: string) => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, e.name);
        if (e.isDirectory()) walk(full);
        else if (/\.(tsx|ts)$/.test(e.name)) files.push(full);
      }
    };
    walk(APP_DIR);

    const targets = new Set<string>();
    for (const file of files) {
      const src = fs.readFileSync(file, 'utf8');
      for (const m of src.matchAll(/(?:href|router\.(?:push|replace))\(\s*["'\`]([^"'`]+)["'\`]/g)) {
        targets.add(m[1].split('?')[0]);
      }
      // Bottom-tab destinations: <Tabs.Screen name="more" />
      for (const m of src.matchAll(/<Tabs\.Screen\s+name=["'`]([^"'`]+)["'`]/g)) {
        targets.add(`/${m[1]}`);
      }
      // template-literal targets, e.g. router.push(`/product/${id}`)
      for (const m of src.matchAll(/(?:href|router\.(?:push|replace))\(\s*`([^`]+)`/g)) {
        const raw = m[1];
        const seg = raw.split('/').map((x) => (x.includes('${') ? '[x]' : x)).join('/');
        targets.add(seg);
      }
    }

    const unreachable: string[] = [];
    for (const route of routes) {
      if (route === '/' || route === '/+html' || route === '/_layout') continue;
      const probe = route.replace(/\[[^\]]+\]/g, '[x]');
      const hit = [...targets].some((t) => {
        const clean = t.replace(/\/\([^)]*\)/g, '');
        const a = clean.split('/').filter(Boolean);
        const b = probe.split('/').filter(Boolean);
        return a.length === b.length && a.every((x, i) => x === b[i]);
      });
      if (!hit) unreachable.push(route);
    }
    expect(unreachable).toEqual([]);
  });
});
