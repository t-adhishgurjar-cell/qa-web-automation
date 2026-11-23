import { Page } from '@playwright/test';
import { BasePage } from '../../base.page';

/**
 * RO Credit Statement — /Customer/RoAccountDetail (menu label "RO Credit Transactions",
 * page heading "RO Credit Statement").
 *
 * Filters: a month picker (#roadSelMonthYear, opened by #roadMonthToggleBtn; months are
 * `.road-month-btn[data-month]`, future months disabled), Branch UID (#roadBranchUid, a
 * SumoSelect over a hidden <select>) and RO Code (#roadCmsCode, validated client-side by
 * NayaraVehicleIdentifiers.validateRoCode). Search posts to /Customer/GetRoAccountDetailGrid
 * and fills #RoAccountDetailTbl.
 */
export const STATEMENT_COLUMNS = [
  'S.No', 'Customer Name', 'Customer UID', 'Branch Location Name', 'Branch Location UID', 'Month',
  'RO Code', 'RO Name', 'RO Location', 'Credit Used', 'Online Credit Repay', 'Offline Credit Settlement',
  'Net Outstanding amount', 'Action',
] as const;

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export class RoCreditStatementPage extends BasePage {
  static readonly route = '/Customer/RoAccountDetail';
  static readonly gridUrl = '/Customer/GetRoAccountDetailGrid';

  readonly title = this.page.locator('p.box-head-title').first();
  readonly month = this.page.locator('#roadSelMonthYear');
  readonly monthToggle = this.page.locator('#roadMonthToggleBtn');
  readonly branch = this.page.locator('#roadBranchUid');
  readonly roCode = this.page.locator('#roadCmsCode');
  readonly roCodeError = this.page.locator('#roadCmsCode_error');
  readonly searchButton = this.page.locator('#roadSearchBtn');
  readonly resetButton = this.page.locator('#roadResetBtn');
  readonly grid = this.page.locator('#RoAccountDetailTbl');
  readonly rows = this.page.locator('#RoAccountDetailTbl tbody tr');

  constructor(page: Page) {
    super(page);
  }

  async open(): Promise<void> {
    await this.navigateTo(RoCreditStatementPage.route);
    await this.searchButton.waitFor({ state: 'visible', timeout: 30_000 });
    await this.settle();
  }

  /** Picks a month in the picker the way a user does: open it, the year, the month. */
  async pickMonth(year: number, month: number): Promise<void> {
    await this.monthToggle.click();
    const picker = this.page.locator('.road-month-btn').first();
    await picker.waitFor({ state: 'visible' });
    const shownYear = Number((await this.page.locator('#roadMonthYearBtn').innerText()).trim());
    if (shownYear !== year) {
      await this.page.locator('#roadMonthYearBtn').click();
      await this.page.locator(`.road-year-btn[data-year="${year}"]`).click();
    }
    await this.page.locator(`.road-month-btn[data-month="${month}"]`).click();
  }

  monthButton(month: number) {
    return this.page.locator(`.road-month-btn[data-month="${month}"]`);
  }

  async chooseBranch(uid: string): Promise<void> {
    await this.page.evaluate(v => {
      const $ = (window as unknown as { jQuery: (s: string) => { val: (x: string) => { trigger: (e: string) => void } } }).jQuery;
      $('#roadBranchUid').val(v).trigger('change');
    }, uid);
  }

  /** Search, and wait for the grid request it causes to answer. Returns that response's items. */
  async search(): Promise<Array<Record<string, unknown>>> {
    const responseP = this.page.waitForResponse(r => r.url().includes(RoCreditStatementPage.gridUrl), { timeout: 45_000 });
    await this.searchButton.click();
    const json = await (await responseP).json().catch(() => ({}));
    await this.settle();
    const data = json?.data ?? json?.Data ?? {};
    return (data.items ?? data.Items ?? []) as Array<Record<string, unknown>>;
  }

  /** The grid's rows as objects keyed by STATEMENT_COLUMNS; the "No records" row yields []. */
  async table(): Promise<Array<Record<string, string>>> {
    const out: Array<Record<string, string>> = [];
    const n = await this.rows.count();
    for (let i = 0; i < n; i++) {
      const cells = (await this.rows.nth(i).locator('td').allInnerTexts()).map(c => c.trim());
      if (cells.length < 6) continue;
      out.push(Object.fromEntries(STATEMENT_COLUMNS.map((c, j) => [c, cells[j] ?? ''])));
    }
    return out;
  }

  static monthLabels(year: number, month: number): RegExp {
    const m = MONTHS[month - 1];
    const yy = String(year).slice(2);
    return new RegExp(`(${m}[-\\s/]*(${year}|${yy}))|(0?${month}[-/]${year})`, 'i');
  }
}
