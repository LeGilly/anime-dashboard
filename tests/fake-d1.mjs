// A stand-in for Cloudflare D1 (the relay's tag database), backed by Node's built-in SQLite.
// Only what the relay uses: prepare().bind().all()/run()/first(), and batch() as one transaction.
import { DatabaseSync } from "node:sqlite";

export function fakeD1() {
  const db = new DatabaseSync(":memory:");
  const exec = (sql, args) => {
    const s = db.prepare(sql);
    if (/^\s*(SELECT|WITH)\b/i.test(sql)) return { results: s.all(...args).map((r) => ({ ...r })), meta: {} };
    const r = s.run(...args);
    return { results: [], meta: { changes: Number(r.changes) } };
  };
  const statement = (sql, args = []) => ({
    sql, args,
    bind: (...a) => statement(sql, a),
    all: async () => exec(sql, args),
    run: async () => exec(sql, args),
    first: async () => exec(sql, args).results[0] || null,
  });
  return {
    prepare: (sql) => statement(sql),
    batch: async (list) => {
      db.exec("BEGIN");
      try { const out = list.map((s) => exec(s.sql, s.args)); db.exec("COMMIT"); return out; }
      catch (err) { db.exec("ROLLBACK"); throw err; }
    },
    // For tests: run SQL directly, like the D1 console in the Cloudflare dashboard.
    console: (sql, ...args) => exec(sql, args).results,
  };
}
