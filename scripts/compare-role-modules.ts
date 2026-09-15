/**
 * Compares what two roles can reach, from the probe's own output.
 *
 * The interesting artifact is not either menu on its own but the difference
 * between them, because that is where the entitlement boundary actually lives.
 * Three kinds of difference matter, and they are not equally interesting:
 *
 *   only-in-A / only-in-B   a module one role does not get at all
 *   narrowed                both reach it, but one sees fewer controls — the
 *                           Add Branch customer selector is the known example
 *   disagreeing verdict     one role is let in and the other bounced
 *
 * The second is the one a presence check would miss, and the one most likely to
 * be a real defect: a screen that renders for a role it should not serve, with
 * only the absent fields standing between that role and someone else's data.
 *
 *   npx tsx scripts/compare-role-modules.ts
 */
import * as fs from 'fs';
import * as path from 'path';

interface ModuleReport {
  section: string;
  label: string;
  href: string;
  heading: string;
  inputs: { id: string; name: string; type: string; label: string; readonly: boolean }[];
  buttons: { id: string; text: string }[];
  grids: { id: string; columns: string[]; rows: number }[];
  messages: string[];
  verdict: string;
  note: string;
}

interface Walk {
  signedInAs: string;
  account: string;
  role: string;
  context: string;
  modules: ModuleReport[];
}

function load(slug: string): Walk | undefined {
  const file = path.join(process.cwd(), 'test-results', `${slug}-modules`, `${slug}-modules.json`);
  if (!fs.existsSync(file)) {
    console.error(`No walk found at ${file} — run the probe for this role first.`);
    return undefined;
  }
  return JSON.parse(fs.readFileSync(file, 'utf8')) as Walk;
}

const parent = load('parent-admin');
const branch = load('branch-admin');
if (!parent || !branch) process.exit(1);

const byHref = (w: Walk) => new Map(w.modules.map(m => [m.href, m]));
const P = byHref(parent);
const B = byHref(branch);

const line = (s: string) => console.log(s);
const rule = () => line('─'.repeat(78));

line('');
line(`Parent admin : ${parent.signedInAs}  (${parent.role}, ${parent.context})`);
line(`Branch admin : ${branch.signedInAs}  (${branch.role}, ${branch.context})`);
line(`Modules      : ${parent.modules.length} vs ${branch.modules.length}`);
rule();

// ── Reachable only by one role ───────────────────────────────────────────────
const onlyParent = parent.modules.filter(m => !B.has(m.href));
const onlyBranch = branch.modules.filter(m => !P.has(m.href));

line(`\nONLY THE PARENT ADMIN SEES (${onlyParent.length})`);
for (const m of onlyParent) line(`  ${m.label.padEnd(36)} ${m.href}`);

line(`\nONLY THE BRANCH ADMIN SEES (${onlyBranch.length})`);
if (!onlyBranch.length) line('  (none — the branch menu is a subset)');
for (const m of onlyBranch) line(`  ${m.label.padEnd(36)} ${m.href}`);

// ── Shared, but not identical ────────────────────────────────────────────────
line(`\nSHARED BUT DIFFERENT`);
let differences = 0;

for (const [href, p] of P) {
  const b = B.get(href);
  if (!b) continue;

  const pFields = new Set(p.inputs.map(i => i.id || i.name));
  const bFields = new Set(b.inputs.map(i => i.id || i.name));
  const lostToBranch = [...pFields].filter(f => !bFields.has(f));
  const gainedByBranch = [...bFields].filter(f => !pFields.has(f));

  const pButtons = new Set(p.buttons.map(x => x.id || x.text));
  const bButtons = new Set(b.buttons.map(x => x.id || x.text));
  const lostButtons = [...pButtons].filter(x => !bButtons.has(x));
  const gainedButtons = [...bButtons].filter(x => !pButtons.has(x));

  const verdictDiffers = p.verdict !== b.verdict;

  if (!lostToBranch.length && !gainedByBranch.length && !lostButtons.length &&
      !gainedButtons.length && !verdictDiffers) continue;

  differences += 1;
  line(`\n  ${p.label}  (${href})`);
  if (verdictDiffers) {
    line(`    verdict   parent=${p.verdict}${p.note ? ` (${p.note})` : ''}`);
    line(`              branch=${b.verdict}${b.note ? ` (${b.note})` : ''}`);
  }
  if (lostToBranch.length) line(`    fields the branch admin does NOT get : ${lostToBranch.join(', ')}`);
  if (gainedByBranch.length) line(`    fields only the branch admin gets    : ${gainedByBranch.join(', ')}`);
  if (lostButtons.length) line(`    buttons absent for the branch admin  : ${lostButtons.join(', ')}`);
  if (gainedButtons.length) line(`    buttons only the branch admin gets   : ${gainedButtons.join(', ')}`);
}
if (!differences) line('  (every shared module renders identically for both roles)');

// ── Anything that did not open cleanly, for either role ──────────────────────
rule();
for (const [name, walk] of [['parent admin', parent], ['branch admin', branch]] as const) {
  const notClean = walk.modules.filter(m => m.verdict !== 'reachable');
  line(`\n${name.toUpperCase()} — ${notClean.length} module(s) did not open cleanly`);
  for (const m of notClean) {
    line(`  [${m.verdict}] ${m.label.padEnd(32)} ${m.note || ''}`);
  }
}

// ── Write the machine-readable diff next to the walks ────────────────────────
const out = path.join(process.cwd(), 'test-results', 'role-module-diff.json');
fs.writeFileSync(
  out,
  JSON.stringify(
    {
      parent: { role: parent.role, count: parent.modules.length },
      branch: { role: branch.role, count: branch.modules.length },
      onlyParent: onlyParent.map(m => ({ label: m.label, href: m.href })),
      onlyBranch: onlyBranch.map(m => ({ label: m.label, href: m.href })),
    },
    null,
    2
  )
);
line(`\nWritten to ${out}\n`);
