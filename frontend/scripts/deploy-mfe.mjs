/**
 * deploy-mfe.mjs — Build the MFE remotes and deploy them to the shared host dir.
 *
 * Each remote (mfe-des, mfe-gp, …) is an independent Vite + Module Federation
 * project. This script builds each one and copies its built `dist/assets` into
 * D:\BB\mfe-host\<slug>\assets, which is served at /mfe/<slug>/… by:
 *   • the shell's Vite middleware in dev (vite.config.ts → mfeHostPlugin), and
 *   • the FastAPI backend's StaticFiles mount in prod (backend/main.py).
 *
 * Usage:  npm run mfe:deploy            (from frontend/)
 * After it finishes, reload the shell — the registry already points at /mfe/…
 *
 * Add a new remote by appending to REMOTES below.
 */

import { execSync } from 'node:child_process';
import { cpSync, mkdirSync, rmSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..'); // → D:\BB
const HOST = join(ROOT, 'mfe-host');

const REMOTES = [
  { slug: 'des', dir: join(ROOT, 'mfe-des') },
  { slug: 'gp',  dir: join(ROOT, 'mfe-gp')  },
];

let failed = false;

for (const { slug, dir } of REMOTES) {
  if (!existsSync(dir)) {
    console.error(`✖ Remote dir missing: ${dir} — skipping ${slug}`);
    failed = true;
    continue;
  }
  try {
    console.log(`\n▶ Building mfe-${slug} …`);
    execSync('npm run build', { cwd: dir, stdio: 'inherit' });

    const src  = join(dir, 'dist', 'assets');
    const dest = join(HOST, slug, 'assets');
    rmSync(dest, { recursive: true, force: true });
    mkdirSync(dest, { recursive: true });
    cpSync(src, dest, { recursive: true });
    console.log(`✔ Deployed ${slug} → ${dest}`);
  } catch (e) {
    console.error(`✖ Failed to build/deploy ${slug}: ${e.message}`);
    failed = true;
  }
}

console.log(
  failed
    ? '\n⚠ MFE deploy finished with errors (see above).'
    : '\n✅ MFE deploy complete. Reload the shell to load the new bundles.',
);
process.exit(failed ? 1 : 0);
