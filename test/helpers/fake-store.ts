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
  /**
   * Kolom yang TIDAK ADA di tabel DAN tidak dikenal schema cache PostgREST
   * (meniru database yang belum di-migrasi) → error PGRST204.
   */
  missingColumns: Record<string, string[]>;
  /**
   * Kolom yang DIKENAL schema cache PostgREST tetapi tidak ada di tabel
   * (cache basi: database di-restore / kolom dihapus setelah migrasi).
   * `select=*` ikut menyebutnya → Postgres menolak: SQLSTATE 42703
   * "column orders.payment_method does not exist" (error di log produksi).
   */
  phantomColumns: Record<string, string[]>;
  /**
   * CHECK constraint per kolom, mis. { orders: { payment_method: ["YOBASEPAY","MANUAL"] } }
   * — meniru database yang belum menjalankan migrasi 003 (Stenly).
   */
  checkConstraints: Record<string, Record<string, string[]>>;
}

export interface FakeDbOptions {
  /** Kolom yang tidak dikenal schema cache, mis. { orders: ["payment_method"] }. */
  missingColumns?: Record<string, string[]>;
  /** Kolom "hantu": ada di schema cache, tidak ada di tabel (cache basi). */
  phantomColumns?: Record<string, string[]>;
  /** Tabel yang tidak ada sama sekali (meniru schema belum dijalankan). */
  missingTables?: string[];
  /**
   * Nilai yang DIIZINKAN CHECK constraint, mis.
   * `{ orders: { payment_method: ["YOBASEPAY", "MANUAL"] } }` untuk meniru
   * database lama yang menolak `payment_method = 'STENLY'` (SQLSTATE 23514).
   */
  checkConstraints?: Record<string, Record<string, string[]>>;
}

type Filter = (row: Row) => boolean;

/**
 * Bandingkan nilai untuk .gte()/.lte(): angka dibandingkan sebagai angka,
 * timestamp ISO sebagai waktu (Number("2026-09-16T…") = NaN, jadi harus lewat
 * Date.parse — tanpa ini filter tanggal diam-diam selalu false).
 */
function asComparable(value: unknown): number {
  const n = Number(value);
  if (value !== null && value !== "" && !Number.isNaN(n)) return n;
  const t = Date.parse(String(value));
  return Number.isNaN(t) ? NaN : t;
}

const DEFAULTS: Record<string, Row> = {
  orders: {
    id: "",
    order_code: "",
    charged_amount: null,
    payment_method: "STENLY",
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

  /** Kolom yang tidak dikenal schema cache (database belum di-migrasi). */
  private get missing(): Set<string> {
    return new Set(this.db.missingColumns[this.tableName] ?? []);
  }

  /** Kolom hantu: dikenal cache, tidak ada di tabel (cache PostgREST basi). */
  private get phantom(): Set<string> {
    return new Set(this.db.phantomColumns[this.tableName] ?? []);
  }

  /**
   * Nilai yang ditolak CHECK constraint → Postgres 23514. Dipakai untuk meniru
   * skema lama yang belum mengenal `payment_method = 'STENLY'`.
   */
  private failCheckConstraint(row: Row): void {
    if (this.forcedError) return;
    const constraints = this.db.checkConstraints[this.tableName];
    if (!constraints) return;
    for (const [col, allowed] of Object.entries(constraints)) {
      const value = row[col];
      if (value === undefined || value === null) continue;
      if (allowed.includes(String(value))) continue;
      this.forcedError = {
        message:
          `new row for relation "${this.tableName}" violates check constraint ` +
          `"${this.tableName}_${col}_check"`,
        code: "23514",
      };
      return;
    }
  }

  /** Kolom yang tidak boleh muncul di SQL (tidak ada di tabel). */
  private absent(col: string): boolean {
    return this.missing.has(col) || this.phantom.has(col);
  }

  /**
   * Daftar kolom pada `select=`: PostgREST menolaknya SEBELUM query jalan bila
   * kolom tidak dikenal cache → `PGRST204 Could not find the 'x' column of 'y'
   * in the schema cache`. Kolom hantu lolos dari cache lalu ditolak Postgres.
   */
  private failUnknownColumn(col: string): void {
    if (this.forcedError) return;
    if (this.phantom.has(col)) this.failPhantomColumn(col);
    else if (this.missing.has(col)) {
      this.forcedError = {
        message: `Could not find the '${col}' column of '${this.tableName}' in the schema cache`,
        code: "PGRST204",
      };
    }
  }

  /** Postgres menolak SQL yang menyebut kolom tak ada: `42703 … does not exist`. */
  private failPhantomColumn(col: string): void {
    if (this.forcedError) return;
    this.forcedError = {
      message: `column ${this.tableName}.${col} does not exist`,
      code: "42703",
    };
  }

  /**
   * Kolom dipakai sebagai filter/urutan. Kolom tak dikenal cache → PGRST204;
   * kolom hantu → 42703 (persis error di log produksi saat /admin memuat
   * antrian verifikasi manual).
   */
  private failUnknownColumnFilter(col: string): void {
    if (this.forcedError) return;
    if (this.phantom.has(col)) this.failPhantomColumn(col);
    else if (this.missing.has(col)) this.failUnknownColumn(col);
  }

  /** Buang kolom yang tidak ada dari baris hasil query (efek `select=*`). */
  private project<T>(row: Row): T {
    if (this.missing.size === 0 && this.phantom.size === 0) return row as T;
    const out: Row = {};
    for (const [k, v] of Object.entries(row)) {
      if (!this.absent(k)) out[k] = v;
    }
    return out as T;
  }

  select(cols?: string, opts?: { count?: "exact" | "planned"; head?: boolean }): this {
    if (opts?.count) this.wantsCount = true;
    if (!cols || cols.trim() === "*") {
      // `select=*` di-resolve PostgREST dari schema cache → kolom hantu ikut
      // terpilih dan Postgres menolak seluruh query.
      for (const col of this.phantom) this.failPhantomColumn(col);
    } else {
      for (const col of cols.split(",")) this.failUnknownColumn(col.trim());
    }
    return this;
  }

  eq(col: string, value: unknown): this {
    this.failUnknownColumnFilter(col);
    this.filters.push((r) => String(r[col]) === String(value));
    return this;
  }

  in(col: string, values: unknown[]): this {
    this.failUnknownColumnFilter(col);
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
    this.failUnknownColumnFilter(col);
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
    this.failUnknownColumnFilter(col);
    if (op === "is" && value === null) {
      this.filters.push((r) => r[col] !== null && r[col] !== undefined);
    } else if (op === "eq") {
      this.filters.push((r) => String(r[col]) !== String(value));
    }
    return this;
  }

  gte(col: string, value: unknown): this {
    this.failUnknownColumnFilter(col);
    this.filters.push((r) => asComparable(r[col]) >= asComparable(value));
    return this;
  }

  lte(col: string, value: unknown): this {
    this.failUnknownColumnFilter(col);
    this.filters.push((r) => asComparable(r[col]) <= asComparable(value));
    return this;
  }

  order(col: string, opts?: { ascending?: boolean }): this {
    this.failUnknownColumnFilter(col);
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

    // Payload insert/update menyebut kolom yang tidak ada di tabel.
    if (this.payload && (this.op === "insert" || this.op === "update" || this.op === "upsert")) {
      const rows = Array.isArray(this.payload) ? this.payload : [this.payload];
      for (const row of rows) {
        for (const col of Object.keys(row)) {
          this.failUnknownColumn(col);
          if (this.forcedError) break;
        }
        if (!this.forcedError) this.failCheckConstraint(row);
        if (this.forcedError) break;
      }
    }

    // Filter tidak valid → PostgREST membalas error, bukan hasil kosong.
    if (this.forcedError) {
      calls.push(`${this.op}(${this.tableName}) → ${this.forcedError.code ?? "error"}`);
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
      calls.push(
        `insert(${this.tableName}) fields=${Object.keys(incoming[0] ?? {}).join(",")} → ok`,
      );
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
    return {
      data: result.map((r) => this.project<Row>(r)),
      error: null,
      count: this.wantsCount ? result.length : null,
    };
  }

  /** Supabase builder = thenable. */
  then<T1 = FakeResult, T2 = never>(
    onfulfilled?: ((value: FakeResult) => T1 | PromiseLike<T1>) | null,
    onrejected?: ((reason: unknown) => T2 | PromiseLike<T2>) | null,
  ): PromiseLike<T1 | T2> {
    return Promise.resolve(this.run()).then(onfulfilled, onrejected);
  }

  /** Paksa query ini membalas error tertentu (dipakai fake untuk 42P01). */
  forceError(error: { message: string; code?: string }): void {
    this.forcedError = error;
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
    return { data: this.project<T>(rows[0] as Row), error: null };
  }

  async maybeSingle<T = Row>(): Promise<FakeResult<T | null>> {
    const res = this.run();
    if (res.error) return { data: null, error: res.error };
    const rows = FakeBuilder.rowsOf(res);
    if (rows.length === 0) return { data: null, error: null };
    if (rows.length > 1) {
      return { data: null, error: { message: "multiple rows", code: "PGRST116" } };
    }
    return { data: this.project<T>(rows[0] as Row), error: null };
  }
}

export function createFakeDb(
  tables: Record<string, Row[]> = {},
  opts: FakeDbOptions = {},
): FakeDb {
  const db: FakeDb = {
    tables,
    calls: [],
    missingColumns: opts.missingColumns ?? {},
    phantomColumns: opts.phantomColumns ?? {},
    checkConstraints: opts.checkConstraints ?? {},
    from(table: string) {
      if (opts.missingTables?.includes(table)) {
        // Meniru tabel yang belum dibuat: Postgres 42P01 lewat PostgREST.
        const builder = new FakeBuilder(table, db);
        builder.forceError({
          message: `relation 'public.${table}' does not exist`,
          code: "42P01",
        });
        return builder;
      }
      if (!tables[table]) tables[table] = [];
      return new FakeBuilder(table, db);
    },
  };
  return db;
}
