import * as net from 'net';
import { execFile } from 'child_process';
import * as sql from 'mssql';
import { Logger } from './logger.helper';

/**
 * Read-only access to the FleetPlus SQL Server.
 *
 * Exists to answer questions the UI cannot: which mobile numbers are already in
 * CustomerMaster as a Fleet customer, which are in Users, which are in neither.
 * The UserType × CustomerType matrix is defined entirely in those terms, and the
 * application masks customer mobiles in its own grids, so without this the
 * matrix's preconditions cannot be met at all.
 *
 * ── Read-only by construction ─────────────────────────────────────────────
 * The credential this connects with is read-only, and this class refuses to send
 * anything that is not a SELECT. That is belt-and-braces: the server would reject
 * a write anyway, but a test suite that *tries* to write to a shared QA database
 * holding 125k users is a bad neighbour even when it fails. Nothing here calls
 * usp_AddUser — the stored procedure is exercised through the application.
 */

/** Statements this helper will send. Anything else throws before reaching the server. */
const READ_ONLY_STATEMENT = /^\s*(?:WITH\b[\s\S]*?)?SELECT\b/i;

/** Statements that must never appear, even inside an otherwise-SELECT string. */
const FORBIDDEN = /\b(INSERT|UPDATE|DELETE|DROP|TRUNCATE|ALTER|CREATE|MERGE|EXEC|EXECUTE|GRANT|REVOKE)\b/i;

export interface DbConfig {
  server: string;
  port: number;
  database: string;
  user: string;
  password: string;
  encrypt: boolean;
  trustServerCertificate: boolean;
}

export function dbConfigFromEnv(): DbConfig {
  const missing = ['DB_HOST', 'DB_NAME', 'DB_USER', 'DB_PASSWORD'].filter(k => !process.env[k]?.trim());
  if (missing.length) {
    throw new Error(
      `Database is not configured: ${missing.join(', ')} missing from .env.${process.env.ENV ?? 'dev'}. ` +
        `The file is gitignored — add the values there rather than committing them.`
    );
  }

  return {
    server: process.env.DB_HOST!.trim(),
    port: Number(process.env.DB_PORT ?? 1433),
    database: process.env.DB_NAME!.trim(),
    user: process.env.DB_USER!.trim(),
    password: process.env.DB_PASSWORD!,
    // QA servers commonly present a self-signed certificate; encryption stays on
    // and only the certificate check is relaxed, and only when asked for.
    encrypt: process.env.DB_ENCRYPT !== 'false',
    trustServerCertificate: process.env.DB_TRUST_CERT !== 'false',
  };
}

export class DbHelper {
  private static pool: sql.ConnectionPool | undefined;
  private static readonly logger = new Logger('DbHelper');

  /** One pool for the whole run; opening a connection per query is wasteful. */
  static async connect(): Promise<sql.ConnectionPool> {
    if (this.pool?.connected) return this.pool;

    const config = dbConfigFromEnv();
    this.logger.info(`Connecting to ${config.server}:${config.port}/${config.database} as ${config.user}`);

    // TLS takes its certificate server name from `server`, and refuses to use a
    // bare IP for it. Connecting to 10.0.36.12 with encryption on therefore fails
    // outright: "Setting the TLS ServerName to an IP address is not permitted".
    //
    // Encryption is dropped in that case so the connection can be made at all,
    // and it is logged loudly, because it means the password crosses the network
    // in the clear. On an internal 10.x QA network that is a considered trade;
    // on anything reachable from outside it is not. The fix is to put the
    // server's hostname in DB_HOST rather than its IP, which lets TLS verify.
    const hostIsIpAddress = /^\d{1,3}(\.\d{1,3}){3}$/.test(config.server);
    let encrypt = config.encrypt;

    if (encrypt && hostIsIpAddress) {
      this.logger.warn(
        `${config.server} is an IP address, so TLS has no server name to verify ` +
          `against. Falling back to an UNENCRYPTED connection — the password will ` +
          `cross the network in the clear. Put the server's hostname in DB_HOST to ` +
          `keep encryption, or set DB_ENCRYPT=false to make this choice explicit.`
      );
      encrypt = false;
    }

    this.pool = await new sql.ConnectionPool({
      server: config.server,
      port: config.port,
      database: config.database,
      user: config.user,
      password: config.password,
      options: {
        encrypt,
        trustServerCertificate: config.trustServerCertificate,
      },
      // A full matrix run snapshots hundreds of mobiles across 50-odd tests, and
      // four connections with the default acquire timeout ran dry near the end —
      // reported by tarn as "operation timed out for an unknown reason", which
      // names neither the query nor the caller and reads like a database fault.
      pool: { max: 10, min: 0, idleTimeoutMillis: 30_000, acquireTimeoutMillis: 60_000 },
      connectionTimeout: 20_000,
      // 30s was not enough for the fixture-discovery queries once a full run has
      // the pool busy — they scan large tables with correlated filters and were
      // timing out under load while passing in isolation, which reads as a
      // flaky test rather than a slow query.
      requestTimeout: 90_000,
    }).connect();

    return this.pool;
  }

  static async close(): Promise<void> {
    if (this.pool) {
      await this.pool.close().catch(() => undefined);
      this.pool = undefined;
    }
  }

  /**
   * Runs a SELECT and returns its rows.
   *
   * Parameters are bound, never interpolated — a mobile number arriving from a
   * spreadsheet is untrusted input like any other.
   */
  static async query<T = Record<string, unknown>>(
    statement: string,
    params: Record<string, string | number> = {}
  ): Promise<T[]> {
    if (!READ_ONLY_STATEMENT.test(statement)) {
      throw new Error(`DbHelper only sends SELECT statements. Refused: ${statement.slice(0, 80)}`);
    }
    if (FORBIDDEN.test(statement)) {
      throw new Error(
        `Refused a statement containing a write or execute keyword: ${statement.slice(0, 80)}`
      );
    }

    return this.withRetry(statement, async () => {
      const pool = await this.connect();
      const request = pool.request();
      for (const [name, value] of Object.entries(params)) request.input(name, value);
      const result = await request.query<T>(statement);
      return result.recordset ?? [];
    });
  }

  /**
   * Whether the database is reachable, and if not, whose problem it is.
   *
   * Two failures look identical from a test's point of view and have different
   * owners, so this separates them before a run starts rather than after twenty
   * minutes of confusing errors:
   *
   *   port closed         nothing is routing to the host at all
   *   port open, SQL
   *     resets            a proxy answered the handshake; the session never
   *                       reached the server
   *
   * ── A TCP handshake proves nothing on its own ────────────────────────────
   * This originally reported "port open, so this is not the VPN", and that was
   * wrong. On 16 September 2026 the corporate tunnel (GlobalProtect, utun4)
   * dropped while Zscaler stayed up, so traffic for 10.0.36.12 fell through to
   * the Zscaler tunnel. Zscaler answered the SYN itself and then reset the
   * session at a consistent ~4010ms once real data flowed — identical across
   * four different encryption settings, which is the tell: TLS negotiation
   * would not fail with the same timing every time.
   *
   * So a completed handshake can mean a proxy replied, not that the server is
   * reachable. The route is the honest signal, and it is checked first.
   *
   * Deliberately not thrown from: callers decide whether an unreachable
   * database is fatal. Reporting it accurately is the whole job here.
   */
  static async diagnose(): Promise<{ reachable: boolean; portOpen: boolean; detail: string }> {
    const host = process.env.DB_HOST ?? '';
    const port = Number(process.env.DB_PORT ?? 1433);

    // Which interface actually carries traffic for this host. When the
    // corporate tunnel drops, another VPN client can pick the route up and
    // answer handshakes it cannot fulfil, so this is the first thing to read.
    const route = await new Promise<string>(resolve => {
      execFile('route', ['-n', 'get', host], { timeout: 5_000 }, (err, stdout) => {
        if (err) return resolve('');
        const iface = /interface:\s*(\S+)/.exec(stdout)?.[1] ?? '?';
        const gateway = /gateway:\s*(\S+)/.exec(stdout)?.[1] ?? '(none)';
        resolve(`\n\nRoute to ${host}: interface ${iface}, gateway ${gateway}.`);
      });
    }).catch(() => '');

    const portOpen = await new Promise<boolean>(resolve => {
      const socket = new net.Socket();
      const done = (ok: boolean) => {
        socket.destroy();
        resolve(ok);
      };
      socket.setTimeout(5_000);
      socket.once('connect', () => done(true));
      socket.once('timeout', () => done(false));
      socket.once('error', () => done(false));
      socket.connect(port, host);
    });

    if (!portOpen) {
      return {
        reachable: false,
        portOpen: false,
        detail:
          `${host}:${port} is not reachable at all — the VPN is down. ` +
          `Reconnect and run again.${route}`,
      };
    }

    try {
      await this.query('SELECT 1 AS ok', {});
      return { reachable: true, portOpen: true, detail: `${host}:${port} is answering.` };
    } catch (error) {
      const message = error instanceof Error ? error.message.split('\n')[0] : String(error);
      return {
        reachable: false,
        portOpen: true,
        detail:
          `${host}:${port} accepts a TCP connection but the SQL session fails: ` +
          `"${message}".\n\n` +
          `A completed handshake does not mean the server was reached — a proxy ` +
          `can answer it and reset once real data flows. Check the route below ` +
          `before concluding the server is at fault.${route}`,
      };
    }
  }

  /**
   * Retries a query when the *connection* failed, never when the query did.
   *
   * The QA database dropped four times in one session — ECONNRESET, and
   * "Failed to connect ... in 20000ms" — and each arrived as a failed test
   * naming an assertion that had nothing to do with it. That is worse than
   * useless in a signoff: it invites someone to investigate the application for
   * a fault in the network.
   *
   * Only transport-level failures are retried, and the pool is discarded first
   * so the next attempt dials afresh rather than drawing a dead socket. A
   * timeout is deliberately NOT retried: a query too slow to finish will be too
   * slow again, and retrying it three times just triples the wait before the
   * same answer.
   */
  private static async withRetry<T>(statement: string, run: () => Promise<T>): Promise<T> {
    const TRANSPORT_FAILURE = /ECONNRESET|ECONNREFUSED|ETIMEDOUT|EPIPE|socket hang up|Connection lost|Failed to connect|Connection is closed|not connected/i;
    const attempts = 3;
    let lastError: unknown;

    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      try {
        return await run();
      } catch (error) {
        lastError = error;
        const message = error instanceof Error ? error.message : String(error);
        if (!TRANSPORT_FAILURE.test(message) || attempt === attempts) break;

        this.logger.warn(
          `Database connection failed (attempt ${attempt}/${attempts}): ${message}. ` +
            `Reconnecting and retrying. Query: ${statement.slice(0, 60).replace(/\s+/g, ' ')}…`
        );
        await this.close().catch(() => undefined);
        await new Promise(resolve => setTimeout(resolve, attempt * 2_000));
      }
    }

    const message = lastError instanceof Error ? lastError.message : String(lastError);

    // Only claim a transport failure when it actually was one. The loop breaks
    // out for query errors too — "Invalid column name", a missing table, a
    // constraint violation — and appending the transport note to those told the
    // reader the query never reached the server when in fact the server is
    // precisely what rejected it. That sends someone to check the network over
    // a typo in a column name.
    if (!TRANSPORT_FAILURE.test(message)) throw lastError;

    throw new Error(
      `${message}\n\nThis is a database transport failure, not an application ` +
        `defect — the query never reached the server. Retried ${attempts} times.`
    );
  }

  /** First row, or undefined. */
  static async queryOne<T = Record<string, unknown>>(
    statement: string,
    params: Record<string, string | number> = {}
  ): Promise<T | undefined> {
    return (await this.query<T>(statement, params))[0];
  }

  /**
   * What this login can actually do.
   *
   * Reported rather than assumed: "read-only" can mean anything from full SELECT
   * across the schema to a handful of granted views, and a suite that discovers
   * the difference one failing test at a time wastes everybody's time.
   *
   * `tables` is supplied by the caller rather than hard-coded. Object names taken
   * from a test-case document are a guess until someone confirms them, and a
   * capability report built on guesses reports the guess as the problem.
   */
  static async capabilities(tables: string[] = []): Promise<Record<string, string>> {
    const out: Record<string, string> = {};

    const probe = async (label: string, statement: string): Promise<void> => {
      try {
        const rows = await this.query(statement);
        out[label] = `ok (${rows.length} row${rows.length === 1 ? '' : 's'})`;
      } catch (error) {
        out[label] = `DENIED — ${(error as Error).message.split('\n')[0].slice(0, 90)}`;
      }
    };

    await probe('connection', 'SELECT 1 AS ok');
    await probe('current database', 'SELECT DB_NAME() AS db');
    await probe('catalogue readable', 'SELECT TOP 1 TABLE_NAME FROM INFORMATION_SCHEMA.TABLES');

    for (const table of tables) {
      if (!/^[A-Za-z_][A-Za-z0-9_]*(\.[A-Za-z_][A-Za-z0-9_]*)?$/.test(table)) {
        out[table] = 'SKIPPED — not a plain identifier';
        continue;
      }
      await probe(table, `SELECT TOP 1 1 AS ok FROM ${table}`);
    }

    return out;
  }

  /** Tables this login can read, so object names can be confirmed not guessed. */
  static async listTables(like?: string): Promise<string[]> {
    const rows = await this.query<{ name: string }>(
      `SELECT TABLE_SCHEMA + '.' + TABLE_NAME AS name
         FROM INFORMATION_SCHEMA.TABLES
        WHERE TABLE_TYPE = 'BASE TABLE'
          AND (@like = '' OR TABLE_NAME LIKE @like)
        ORDER BY TABLE_NAME`,
      { like: like ?? '' }
    );
    return rows.map(r => r.name);
  }

  /** Columns of a table, for writing a query against a schema nobody documented. */
  static async describe(table: string): Promise<Array<{ column: string; type: string }>> {
    const bare = table.includes('.') ? table.split('.')[1] : table;
    return this.query(
      `SELECT COLUMN_NAME AS column_name, DATA_TYPE AS data_type
         FROM INFORMATION_SCHEMA.COLUMNS
        WHERE TABLE_NAME = @table
        ORDER BY ORDINAL_POSITION`,
      { table: bare }
    ).then(rows => rows.map((r: any) => ({ column: r.column_name, type: r.data_type })));
  }
}
