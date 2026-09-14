import { test } from '../src/fixtures/page.fixtures';
import { FP_ADMIN } from '../src/config/accounts';

/**
 * Reads the Add Branch and Add Customer Bank Account screens, and their
 * approval counterparts.
 *
 * Neither has a sheet in the workbook, so there is no list of cases to work
 * from — the screens themselves are the specification. Both are maker-checker
 * pairs, which means a test that only fills the form proves half the flow, and
 * the approval side has to be understood before anything is written.
 *
 * Reports what each renders, what it requires, and which fields depend on a
 * customer being selected first.
 *
 *   TOOLS=true ENV=qa npx playwright test --project=tools --grep "probe bank branch"
 */

test.use({ storageState: { cookies: [], origins: [] } });

const SCREENS = [
  { name: 'Add Branch', route: '/Customer/AddBranch' },
  { name: 'Approve Customer Branch', route: '/Customer/ApproveCustomerBranch' },
  { name: 'Add Customer Bank Account', route: '/Financial/AddBankDetails' },
  { name: 'Approve Customer Bank Details', route: '/Financial/BankApprovals' },
];

test.describe('Tools — probes @tools', () => {
  test('probe bank branch — read both maker screens and both checkers', async ({
    loginPage, dashboardPage, page,
  }) => {
    test.setTimeout(300_000);

    await loginPage.navigate();
    await loginPage.login(FP_ADMIN.username, FP_ADMIN.password);
    await dashboardPage.assertDashboardLoaded();

    for (const screen of SCREENS) {
      const response = await page.goto(screen.route, { waitUntil: 'domcontentloaded' })
        .catch(() => null);
      await page.waitForTimeout(2_500);

      const bounced = /login/i.test(page.url());
      console.log(`\n${'='.repeat(70)}`);
      console.log(`${screen.name}  ${screen.route}`);
      console.log(`  HTTP ${response?.status() ?? '?'}  title="${(await page.title()).trim()}"${bounced ? '  BOUNCED TO LOGIN' : ''}`);
      if (bounced) continue;

      const shape = await page.evaluate(() => {
        const vis = (el: Element): boolean => {
          const st = getComputedStyle(el);
          return st.display !== 'none' && st.visibility !== 'hidden' &&
            !!(el as HTMLElement).getClientRects().length;
        };

        const fields = Array.from(document.querySelectorAll('input, select, textarea'))
          .map(el => {
            const node = el as HTMLInputElement;
            return {
              tag: node.tagName.toLowerCase(),
              type: node.getAttribute('type') || '',
              id: node.id || '',
              name: node.getAttribute('name') || '',
              required: node.hasAttribute('required') || node.hasAttribute('data-val-required'),
              visible: vis(node),
              options: node.tagName === 'SELECT'
                ? Array.from((node as unknown as HTMLSelectElement).options).length
                : undefined,
            };
          })
          .filter(f => f.id || f.name);

        const buttons = Array.from(document.querySelectorAll('button, input[type=submit], a.btn'))
          .map(el => ({
            id: (el as HTMLElement).id || '',
            text: ((el.textContent || (el as HTMLInputElement).value || '')).trim().replace(/\s+/g, ' ').slice(0, 35),
            visible: vis(el),
          }))
          .filter(b => b.text || b.id);

        const tables = Array.from(document.querySelectorAll('table')).map(t => ({
          id: t.id || '(no id)',
          visible: vis(t),
          headers: Array.from(t.querySelectorAll('thead th')).map(th => (th.textContent || '').trim()),
          rows: t.querySelectorAll('tbody tr').length,
        }));

        return { fields, buttons, tables };
      });

      const visibleFields = shape.fields.filter(f => f.visible);
      console.log(`  visible fields (${visibleFields.length}):`);
      for (const f of visibleFields) {
        const kind = f.tag === 'select' ? `select[${f.options} opts]` : `${f.tag}[${f.type}]`;
        console.log(`    ${kind.padEnd(18)} #${f.id || '-'} ${f.required ? '[required]' : ''}`);
      }

      const hiddenIds = shape.fields.filter(f => !f.visible && f.id).map(f => f.id);
      if (hiddenIds.length) console.log(`  hidden fields (${hiddenIds.length}): ${hiddenIds.slice(0, 12).join(', ')}`);

      console.log('  visible buttons:');
      for (const b of shape.buttons.filter(b => b.visible)) {
        console.log(`    #${b.id || '-'} "${b.text}"`);
      }

      for (const t of shape.tables) {
        console.log(`  table #${t.id} visible=${t.visible} rows=${t.rows}`);
        if (t.headers.length) console.log(`    headers: ${t.headers.join(' | ')}`);
      }
    }
  });

  test('probe bank flow — what marks a customer as found, and what the queue lists', async ({
    loginPage, dashboardPage, page,
  }) => {
    test.setTimeout(300_000);
    await loginPage.navigate();
    await loginPage.login(FP_ADMIN.username, FP_ADMIN.password);
    await dashboardPage.assertDashboardLoaded();

    for (const id of ['NAYAFP0000000000', 'NAYAFP1013400034']) {
      await page.goto('/Financial/AddBankDetails', { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(1500);
      await page.fill('#searchCustomerId', id);
      await page.click('#btnSearchBankDetails');
      await page.waitForTimeout(3000);

      const state = await page.evaluate(() => {
        const vis = (el: Element | null): boolean => {
          if (!el) return false;
          const st = getComputedStyle(el);
          return st.display !== 'none' && st.visibility !== 'hidden' &&
            !!(el as HTMLElement).getClientRects().length;
        };
        const val = (id: string) => (document.getElementById(id) as HTMLInputElement | null)?.value ?? '(absent)';
        return {
          showBtnVisible: vis(document.getElementById('btnShowAddForm')),
          target: val('TargetCustomerID'),
          bankNameVisible: vis(document.getElementById('BankName')),
          dialogs: Array.from(document.querySelectorAll('.modal.show, .toast, .alert'))
            .filter(vis).map(e => (e.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 90)),
          tables: Array.from(document.querySelectorAll('table')).filter(vis).map(t => ({
            id: t.id, rows: t.querySelectorAll('tbody tr').length,
          })),
        };
      });
      console.log(`\n[AddBankDetails] searched ${id}`);
      console.log(`  showAddForm visible : ${state.showBtnVisible}`);
      console.log(`  TargetCustomerID    : "${state.target}"`);
      console.log(`  BankName visible    : ${state.bankNameVisible}`);
      console.log(`  dialogs             : ${state.dialogs.join(' | ') || '(none)'}`);
      console.log(`  visible tables      : ${JSON.stringify(state.tables)}`);
    }

    // What the approvals queue actually lists for this customer.
    await page.goto('/Financial/BankApprovals', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2000);
    await page.fill('#CustomerID', 'NAYAFP1013400034');
    const searchBtn = page.locator('button:visible').filter({ hasText: /^\s*Search\s*$/ }).first();
    await searchBtn.click().catch(() => undefined);
    await page.waitForTimeout(3500);

    const queue = await page.evaluate(() => {
      const table = Array.from(document.querySelectorAll('table')).find(t => t.querySelectorAll('tbody tr').length);
      if (!table) return { headers: [], rows: [] as string[] };
      return {
        headers: Array.from(table.querySelectorAll('thead th')).map(th => (th.textContent || '').trim()),
        rows: Array.from(table.querySelectorAll('tbody tr')).slice(0, 6).map(tr =>
          Array.from(tr.querySelectorAll('td')).map(td => (td.textContent || '').trim()).join(' | ')),
      };
    });
    console.log('\n[BankApprovals] for NAYAFP1013400034');
    console.log(`  headers: ${queue.headers.join(' | ')}`);
    for (const r of queue.rows) console.log(`  row: ${r}`);
  });

  test('probe bank approve — what the Approve click actually does', async ({
    loginPage, dashboardPage, page,
  }) => {
    test.setTimeout(300_000);
    await loginPage.navigate();
    await loginPage.login(FP_ADMIN.username, FP_ADMIN.password);
    await dashboardPage.assertDashboardLoaded();

    await page.goto('/Financial/BankApprovals', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2000);
    await page.fill('#CustomerID', 'NAYAFP1013400034');
    await page.locator('button:visible').filter({ hasText: /^\s*Search\s*$/ }).first()
      .click().catch(() => undefined);
    await page.waitForTimeout(3500);

    const rows = await page.evaluate(() => {
      const t = Array.from(document.querySelectorAll('table'))
        .find(x => x.querySelectorAll('tbody tr').length);
      if (!t) return [];
      return Array.from(t.querySelectorAll('tbody tr')).map((tr, i) =>
        `${i}: ` + Array.from(tr.querySelectorAll('td'))
          .map(td => (td.textContent || '').trim()).join(' | '));
    });
    console.log('queue rows for NAYAFP1013400034:');
    for (const r of rows) console.log('  ' + r);

    // Click Approve on the first row and watch what the page does next.
    const before = page.url();
    const firstApprove = page.getByRole('button', { name: /^approve$/i }).first();
    console.log(`\nApprove buttons visible: ${await page.getByRole('button', { name: /^approve$/i }).count()}`);
    await firstApprove.click({ timeout: 15000 }).catch(e => console.log('click failed: ' + e.message));
    await page.waitForTimeout(3000);

    const after = await page.evaluate(() => {
      const vis = (el: Element): boolean => {
        const st = getComputedStyle(el);
        return st.display !== 'none' && st.visibility !== 'hidden' &&
          !!(el as HTMLElement).getClientRects().length;
      };
      return {
        url: location.href,
        modals: Array.from(document.querySelectorAll('.modal')).filter(vis)
          .map(m => ({ id: m.id, text: (m.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 160) })),
        newFields: Array.from(document.querySelectorAll('input, textarea, select')).filter(vis)
          .map(f => (f as HTMLElement).id).filter(Boolean),
        buttons: Array.from(document.querySelectorAll('button')).filter(vis)
          .map(b => `${b.id || '-'}:"${(b.textContent || '').trim().slice(0, 24)}"`),
      };
    });
    console.log(`\nurl before: ${before}`);
    console.log(`url after : ${after.url}`);
    console.log(`modals    : ${JSON.stringify(after.modals)}`);
    console.log(`fields    : ${after.newFields.join(', ')}`);
    console.log(`buttons   : ${after.buttons.join(' ')}`);
  });

  test('probe branch flow — what the form reveals once a customer is chosen', async ({
    loginPage, dashboardPage, page,
  }) => {
    test.setTimeout(300_000);
    await loginPage.navigate();
    await loginPage.login(FP_ADMIN.username, FP_ADMIN.password);
    await dashboardPage.assertDashboardLoaded();

    const snapshot = async (label: string) => {
      const state = await page.evaluate(() => {
        const vis = (el: Element | null): boolean => {
          if (!el) return false;
          const st = getComputedStyle(el);
          return st.display !== 'none' && st.visibility !== 'hidden' &&
            !!(el as HTMLElement).getClientRects().length;
        };
        const val = (id: string) => (document.getElementById(id) as HTMLInputElement | null)?.value ?? '';
        return {
          visible: Array.from(document.querySelectorAll('input, select, textarea'))
            .filter(vis).map(e => (e as HTMLElement).id).filter(Boolean),
          name: val('abCustomerName'),
          mobile: val('abCustomerMobile'),
          state: val('abState'),
          city: val('abCity'),
          dialogs: Array.from(document.querySelectorAll('.modal.show, .toast, .alert'))
            .filter(vis).map(e => (e.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 100)),
        };
      });
      console.log(`\n[${label}]`);
      console.log(`  visible fields: ${state.visible.join(', ')}`);
      console.log(`  name="${state.name}" mobile="${state.mobile}" state="${state.state}" city="${state.city}"`);
      if (state.dialogs.length) console.log(`  dialogs: ${state.dialogs.join(' | ')}`);
    };

    await page.goto('/Customer/AddBranch', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2000);
    await snapshot('on load');

    await page.fill('#abCustomerId', 'NAYAFP1013400034');
    await page.locator('#abCustomerId').blur();
    await page.waitForTimeout(3500);
    await snapshot('after entering the parent customer id');

    // Branch type is hidden on load; see whether choosing one opens more.
    const fleet = page.locator('label[for="abBranchTypeFleet"]');
    if (await fleet.isVisible().catch(() => false)) {
      await fleet.click().catch(() => undefined);
      await page.waitForTimeout(2000);
      await snapshot('after choosing Fleet branch type');
    } else {
      console.log('\n[branch type] label[for=abBranchTypeFleet] is not visible');
    }

    await page.fill('#abPinCode', '201304');
    await page.locator('#abPinCode').blur();
    await page.waitForTimeout(3000);
    await snapshot('after pin code');
  });

  test('probe branch otp — what appears once the OTP is sent', async ({
    loginPage, dashboardPage, page,
  }) => {
    test.setTimeout(300_000);
    await loginPage.navigate();
    await loginPage.login(FP_ADMIN.username, FP_ADMIN.password);
    await dashboardPage.assertDashboardLoaded();

    await page.goto('/Customer/AddBranch', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2000);
    await page.fill('#abCustomerId', 'NAYAFP1013400034');
    await page.locator('#abCustomerId').blur();
    await page.waitForTimeout(3500);
    await page.locator('label[for="abBranchTypeFleet"]').click().catch(() => undefined);
    await page.waitForTimeout(1500);

    const mobile = `9${String(Date.now()).slice(-9)}`;
    await page.fill('#abManagerMobile', mobile);
    await page.locator('#abManagerMobile').blur();
    await page.waitForTimeout(1500);
    await page.click('#abBtnGenerateMobileOtp').catch(() => undefined);
    await page.waitForTimeout(3500);

    const after = await page.evaluate(() => {
      const vis = (el: Element): boolean => {
        const st = getComputedStyle(el);
        return st.display !== 'none' && st.visibility !== 'hidden' &&
          !!(el as HTMLElement).getClientRects().length;
      };
      return {
        buttons: Array.from(document.querySelectorAll('button')).filter(vis)
          .map(b => `${b.id || '-'}:"${(b.textContent || '').trim().slice(0, 26)}"`),
        fields: Array.from(document.querySelectorAll('input')).filter(vis)
          .map(f => (f as HTMLElement).id).filter(Boolean),
        dialogs: Array.from(document.querySelectorAll('.modal.show, .toast, .alert')).filter(vis)
          .map(e => (e.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 100)),
      };
    });
    console.log(`\nmobile used: ${mobile}`);
    console.log(`fields  : ${after.fields.join(', ')}`);
    console.log(`buttons : ${after.buttons.join(' ')}`);
    console.log(`dialogs : ${after.dialogs.join(' | ') || '(none)'}`);
  });

  test('probe branch as parent admin — what this role is shown', async ({
    loginPage, dashboardPage, page,
  }) => {
    test.setTimeout(300_000);
    const { PARENT_ADMIN } = await import('../src/config/accounts');

    await loginPage.navigate();
    await loginPage.login(PARENT_ADMIN.username, PARENT_ADMIN.password, PARENT_ADMIN.roleCode);
    await dashboardPage.assertDashboardLoaded();

    const links = await page.evaluate(() =>
      Array.from(document.querySelectorAll('a[href]'))
        .map(a => ({ text: (a.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 44),
                     href: a.getAttribute('href') || '' }))
        .filter(l => l.text && /branch|bank|customer/i.test(l.text + l.href)));
    console.log('menu entries this role can see:');
    for (const l of links) console.log(`  ${l.text.padEnd(44)} ${l.href}`);

    const resp = await page.goto('/Customer/AddBranch', { waitUntil: 'domcontentloaded' })
      .catch(() => null);
    await page.waitForTimeout(2500);
    console.log(`\n/Customer/AddBranch -> HTTP ${resp?.status() ?? '?'} url=${page.url()}`);
    console.log(`title: "${(await page.title()).trim()}"`);

    const shape = await page.evaluate(() => {
      const vis = (el: Element): boolean => {
        const st = getComputedStyle(el);
        return st.display !== 'none' && st.visibility !== 'hidden' &&
          !!(el as HTMLElement).getClientRects().length;
      };
      return {
        fields: Array.from(document.querySelectorAll('input, select, textarea'))
          .filter(vis).map(e => (e as HTMLElement).id || (e as HTMLInputElement).name).filter(Boolean),
        buttons: Array.from(document.querySelectorAll('button')).filter(vis)
          .map(b => `${b.id || '-'}:"${(b.textContent || '').trim().slice(0, 24)}"`),
        heading: (document.querySelector('h1,h2,h3,.page-title')?.textContent || '').trim().slice(0, 80),
        body: (document.body.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 200),
      };
    });
    console.log(`heading : ${shape.heading}`);
    console.log(`fields  : ${shape.fields.join(', ') || '(none)'}`);
    console.log(`buttons : ${shape.buttons.join(' ') || '(none)'}`);
    console.log(`body    : ${shape.body}`);
  });
});
