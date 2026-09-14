/**
 * Fake klien Supabase (PostgREST-ish) untuk unit test DOMAIN LOGIC.
 *
 * Hanya mengimplementasikan rantai query yang benar-benar dipakai
 * lib/orders.ts + lib/payment-config.ts, dengan semantik yang sama:
 *   from().select().eq().in().is().not().order().limit()  → { data, error }
 *   from().insert()/update()/upsert() … .select().single()/maybeSingle()
 *   builder bersifat thenable (boleh di-await tanpa .select()).
 *
 * Tujuannya: mengeksekusi state machine pembayaran manual yang asli
 * (bukan reimplementasi), tanpa Supabase sungguhan.
 */

export type Row = Record<string, unknown>;

export interface FakeResult<T = Row | Row[] | null> {
  data: T;
  error: { message: string; code?: string } | null;
  count?: number | null;
}

export interface FakeDb {
  from(table: string): FakeBuilder;
  /** Isi tabel mentah — untuk assert langsung dari test. */
  tables: Record<string, Row[]>;
  /** Log ringkas operasi (untuk assert urutan/perilaku). */
  calls: string[];
}

type Filter = (row: Row) => boolean;

const DEFAULTS: Record<string, Row> = {
  orders: {
    id: "",
    order_code: "",
    charged_amount: null,
    payment_method: "YOBASEPAY",
    payment_status: "PENDING",
    order_status: "PENDING",
    payment_id: null,
    payment_url: null,
    qr_image_url: null,
    payment_expired_at: null,
    last_payment_checked_at: null,
    paid_at: null,
    telegram_notified_at: null,
    manual_claim_at: null,
    manual_claim_note: "",
    manual_claim_reference: "",
    manual_claim_notified_at: null,
    manual_reviewed_at: null,
    manual_reviewed_by: null,
    manual_review_status: null,
    manual_review_note: "",
  },
  manual_payment_settings: {
    id: 1,
    is_enabled: true,
    label: "Transfer Manual (QRIS)",
    account_name: "",
    instructions: "",
    expiry_minutes: 120,
    qr_image_mime: "image/png",
    qr_image_base64: null,
    qr_image_size: 0,
    updated_at: "2026-09-12T00:00:00.000Z",
  },
};

let idSeq = 0;
function nextId(): string {
  idSeq += 1;
  return `00000000-0000-4000-8000-${String(idSeq).padStart(12, "0")}`;
}

export class FakeBuilder implements PromiseLike<FakeResult> {
  private filters: Filter[] = [];
  private op: "select" | "insert" | "update" | "upsert" = "select";
  private payload: Row | Row[] | null = null;
  private wantsCount = false;
  private limitN: number | null = null;
  private orderSpec: { col: string; asc: boolean } | null = null;
  /** Diisi bila filter yang dipasang tidak valid di PostgREST (mis. `.is("x","STR")`). */
  private forcedError: { message: string; code?: string } | null = null;

  constructor(
    private readonly tableName: string,
    private readonly db: FakeDb,
  ) {}

  private get rows(): Row[] {
    const t = this.db.tables[this.tableName];
    if (!t) throw new Error(`Fake: tabel "${this.tableName}" tidak ada`);
    return t;
  }

  select(_cols?: string, opts?: { count?: "exact" | "planned"; head?: boolean }): this {
    if (opts?.count) this.wantsCount = true;
    return this;
  }

  eq(col: string, value: unknown): this {
    this.filters.push((r) => String(r[col]) === String(value));
    return this;
  }

  in(col: string, values: unknown[]): this {
    const set = values.map((v) => String(v));
    this.filters.push((r) => set.includes(String(r[col])));
    return this;
  }

  /**
   * PostgREST `is.` HANYA menerima `null` / `true` / `false` (lihat tipe
   * `is(column, value: boolean | null)` di @supabase/postgrest-js). Memberi
   * string seperti "PENDING" menghasilkan `payment_status=is.PENDING` yang
   * DITOLAK server dengan error 22P02 — bukan "tidak cocok", tapi query gagal.
   * Fake ini meniru penolakan itu supaya salah-pakai `.is()` ketahuan di test
   * (dulu diam-diam lolos karena dianggap perbandingan biasa).
   */
  is(col: string, value: unknown): this {
    if (value !== null && typeof value !== "boolean") {
      this.forcedError = {
        message: `invalid input syntax for type boolean: "${String(value)}"`,
        code: "22P02",
      };
      return this;
    }
    this.filters.push((r) =>
      value === null ? r[col] === null || r[col] === undefined : r[col] === value,
    );
    return this;
  }

  not(col: string, op: string, value: unknown): this {
    if (op === "is" && value === null) {
      this.filters.push((r) => r[col] !== null && r[col] !== undefined);
    } else if (op === "eq") {
      this.filters.push((r) => String(r[col]) !== String(value));
    }
    return this;
  }

  gte(col: string, value: unknown): this {
    this.filters.push((r) => Number(r[col]) >= Number(value));
    return this;
  }

  lte(col: string, value: unknown): this {
    this.filters.push((r) => Number(r[col]) <= Number(value));
    return this;
  }

  order(col: string, opts?: { ascending?: boolean }): this {
    this.orderSpec = { col, asc: opts?.ascending ?? true };
    return this;
  }

  limit(n: number): this {
    this.limitN = n;
    return this;
  }

  insert(row: Row | Row[]): this {
    this.op = "insert";
    this.payload = row;
    return this;
  }

  update(patch: Row): this {
    this.op = "update";
    this.payload = patch;
    return this;
  }

  upsert(row: Row | Row[], _opts?: { onConflict?: string }): this {
    this.op = "upsert";
    this.payload = row;
    return this;
  }

  private matched(): Row[] {
    return this.rows.filter((r) => this.filters.every((f) => f(r)));
  }

  private run(): FakeResult {
    const calls = this.db.calls;

    // Filter tidak valid → PostgREST membalas error, bukan hasil kosong.
    if (this.forcedError) {
      calls.push(`${this.op}(${this.tableName}) → ${this.forcedError.code}`);
      return { data: null, error: this.forcedError };
    }

    if (this.op === "insert") {
      const incoming = Array.isArray(this.payload) ? this.payload : [this.payload!];
      const inserted: Row[] = [];
      for (const row of incoming) {
        const existing = this.rows.find(
          (r) => row.order_code !== undefined && r.order_code === row.order_code,
        );
        if (existing) {
          calls.push(`insert(${this.tableName}) → 23505`);
          return { data: null, error: { message: "duplicate key", code: "23505" } };
        }
        const full: Row = { ...(DEFAULTS[this.tableName] ?? {}), ...row };
        if (!full.id) full.id = nextId();
        this.rows.push(full);
        inserted.push(full);
      }
      calls.push(`insert(${this.tableName}) → ok`);
      return { data: inserted.length === 1 ? (inserted[0] ?? null) : inserted, error: null };
    }

    if (this.op === "upsert") {
      const incoming = Array.isArray(this.payload) ? this.payload : [this.payload!];
      for (const row of incoming) {
        const idx = this.rows.findIndex((r) => r.id === row.id);
        if (idx >= 0) this.rows[idx] = { ...this.rows[idx], ...row };
        else this.rows.push({ ...(DEFAULTS[this.tableName] ?? {}), ...row });
      }
      calls.push(`upsert(${this.tableName}) → ok`);
      return { data: incoming, error: null };
    }

    if (this.op === "update") {
      const patch = this.payload as Row;
      const targets = this.matched();
      for (const row of targets) Object.assign(row, patch, { updated_at: new Date().toISOString() });
      calls.push(
        `update(${this.tableName}) matched=${targets.length} fields=${Object.keys(patch).join(",")}`,
      );
      return { data: targets, error: null };
    }

    let result = this.matched();
    if (this.orderSpec) {
      const { col, asc } = this.orderSpec;
      result = [...result].sort((a, b) => {
        const av = String(a[col] ?? "");
        const bv = String(b[col] ?? "");
        return asc ? av.localeCompare(bv) : bv.localeCompare(av);
      });
    }
    if (this.limitN !== null) result = result.slice(0, this.limitN);
    calls.push(`select(${this.tableName}) matched=${result.length}`);
    return { data: result, error: null, count: this.wantsCount ? result.length : null };
  }

  /** Supabase builder = thenable. */
  then<T1 = FakeResult, T2 = never>(
    onfulfilled?: ((value: FakeResult) => T1 | PromiseLike<T1>) | null,
    onrejected?: ((reason: unknown) => T2 | PromiseLike<T2>) | null,
  ): PromiseLike<T1 | T2> {
    return Promise.resolve(this.run()).then(onfulfilled, onrejected);
  }

  /** Insert/update menghasilkan object atau array — samakan jadi array. */
  private static rowsOf(res: FakeResult): Row[] {
    if (res.error) return [];
    const raw = res.data as Row | Row[] | null;
    if (raw === null || raw === undefined) return [];
    return Array.isArray(raw) ? raw : [raw];
  }

  async single<T = Row>(): Promise<FakeResult<T | null>> {
    const res = this.run();
    if (res.error) return { data: null, error: res.error };
    const rows = FakeBuilder.rowsOf(res);
    if (rows.length !== 1) {
      return {
        data: null,
        error: {
          message: rows.length === 0 ? "no rows" : "multiple rows",
          code: "PGRST116",
        },
      };
    }
    return { data: rows[0] as T, error: null };
  }

  async maybeSingle<T = Row>(): Promise<FakeResult<T | null>> {
    const res = this.run();
    if (res.error) return { data: null, error: res.error };
    const rows = FakeBuilder.rowsOf(res);
    if (rows.length === 0) return { data: null, error: null };
    if (rows.length > 1) {
      return { data: null, error: { message: "multiple rows", code: "PGRST116" } };
    }
    return { data: rows[0] as T, error: null };
  }
}

export function createFakeDb(tables: Record<string, Row[]> = {}): FakeDb {
  const db: FakeDb = {
    tables,
    calls: [],
    from(table: string) {
      if (!tables[table]) tables[table] = [];
      return new FakeBuilder(table, db);
    },
  };
  return db;
}
