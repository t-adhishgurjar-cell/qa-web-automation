import { expect } from '@playwright/test';
import { test } from '../../src/fixtures/page.fixtures';
import { epic, feature, story, severity, description, owner, attachment } from 'allure-js-commons';

/**
 * Database connectivity and permissions.
 *
 * Runs before any test that depends on the database, and exists so that a broken
 * or revoked login fails *here*, saying so, rather than surfacing later as a
 * matrix test that cannot find its test data. The two failures look nothing alike
 * to whoever reads the report.
 *
 * Deliberately asserts nothing about specific tables. Object names for the
 * UserType × CustomerType matrix have not been confirmed yet, and a test built on
 * a guessed name reports the guess as the defect. The listing below is diagnostic:
 * it attaches what the login can see, so the names can be confirmed from evidence.
 */

const TABLES_TO_CHECK = (process.env.DB_TABLES ?? '')
  .split(',')
  .map(t => t.trim())
  .filter(Boolean);

test.describe('Database', () => {
  test(
    'the read-only login can connect',
    { tag: ['@regression', '@database', '@smoke'] },
    async ({ db }) => {
      await epic('Data');
      await feature('Database');
      await story('Connectivity');
      await owner('QA Team');
      await severity('blocker');
      await description(
        'A single SELECT 1. If this fails, every database-backed test after it is ' +
          'meaningless, so it is tagged @smoke and reported as a blocker.'
      );

      const rows = await db.query<{ ok: number }>('SELECT 1 AS ok');
      expect(rows, 'the server returned no rows for SELECT 1').toHaveLength(1);
      expect(rows[0].ok).toBe(1);
    }
  );

  test(
    'the login reaches the expected database and can read the catalogue',
    { tag: ['@regression', '@database'] },
    async ({ db }) => {
      await epic('Data');
      await feature('Database');
      await story('Permissions');
      await owner('QA Team');
      await severity('critical');
      await description(
        'Confirms which database the credential actually lands in. A login pointed ' +
          'at the wrong catalogue reads perfectly well and answers every question ' +
          'about the wrong environment.'
      );

      const [{ db: current }] = await db.query<{ db: string }>('SELECT DB_NAME() AS db');
      // Compared case-insensitively: SQL Server identifiers are, so "Nayara_Qa"
      // and "Nayara_QA" address the same database and a case mismatch in the env
      // file is not a defect worth failing a run over.
      expect(
        current.toLowerCase(),
        `connected to "${current}", expected "${process.env.DB_NAME}"`
      ).toBe((process.env.DB_NAME ?? '').toLowerCase());

      const capabilities = await db.capabilities(TABLES_TO_CHECK);
      await attachment(
        'Database capabilities',
        Object.entries(capabilities).map(([k, v]) => `${k.padEnd(22)} ${v}`).join('\n'),
        'text/plain'
      );

      expect(capabilities['catalogue readable'], 'cannot read INFORMATION_SCHEMA')
        .toMatch(/^ok/);

      // Only assert on tables the caller actually named. With DB_TABLES unset this
      // is a no-op, which is correct: nothing has been confirmed to assert on yet.
      for (const table of TABLES_TO_CHECK) {
        expect(capabilities[table], `${table} is not readable by this login`).toMatch(/^ok/);
      }
    }
  );

  test(
    'writes are refused before they reach the server',
    { tag: ['@regression', '@database', '@security'] },
    async ({ db }) => {
      await epic('Data');
      await feature('Database');
      await story('Read-only guard');
      await owner('QA Team');
      await severity('critical');
      await description(
        'The credential is read-only, so the server would reject a write anyway. ' +
          'This checks the client refuses first — a suite that *attempts* writes ' +
          'against a shared QA database is a bad neighbour even when they fail, ' +
          'and one accidental UPDATE in a helper is all it would take.'
      );

      const writes = [
        "INSERT INTO Users (Mobile) VALUES ('9999999999')",
        "UPDATE Users SET Mobile = '1' WHERE UserId = 1",
        'DELETE FROM Users',
        'DROP TABLE Users',
        'EXEC usp_AddUser',
        'TRUNCATE TABLE Users',
      ];

      for (const statement of writes) {
        await expect(
          db.query(statement),
          `${statement.split(' ')[0]} was not refused by the client`
        ).rejects.toThrow(/only sends SELECT|write or execute keyword/i);
      }
    }
  );
});
