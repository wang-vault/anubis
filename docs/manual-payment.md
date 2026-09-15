# Pembayaran Manual (QRIS statis penjual)

Metode pembayaran kedua selain **QRIS Otomatis (YoBasePay)**. Dipakai ketika:

- akun QRIS otomatis belum aktif / masih menunggu verifikasi provider,
- kamu lebih nyaman dana masuk langsung ke QRIS merchant sendiri
  (mis. **QR GoPay Merchant**, QRIS bank, QRIS DANA/OVO Bisnis),
- atau kamu ingin tetap berjualan tanpa API provider sama sekali.

Prinsip yang dijaga kode: **buyer tidak bisa membuat ordernya sendiri menjadi
lunas.** Klaim "saya sudah transfer" hanya memindahkan order ke antrian
verifikasi penjual; status `PAID` hanya bisa di-set penjual dari dashboard
setelah uang benar-benar terlihat di mutasi.

---

## A. Cara kerja (ringkas)

```
Buyer                     Toko (Next.js)                    Penjual
  │  pilih "Transfer Manual"  │                                 │
  ├──────────────────────────▶│ order PENDING                   │
  │                           │ nominal = total + kode unik     │
  │  scan QR statis, transfer │                                 │
  ├──────────────────────────▶│                                 │
  │  "Saya sudah transfer"    │ manual_claim_at + catatan       │
  ├──────────────────────────▶│──── notifikasi Telegram ───────▶│ 🧾 KLAIM TRANSFER MANUAL
  │                           │                                 │ cek mutasi QRIS
  │                           │◀── "Konfirmasi Pembayaran" ─────┤ ✓ / ✕
  │◀── status PAID (polling) ─┤ order PAID + Telegram "LUNAS"   │
```

Kolom yang terlibat (tabel `orders`, Supabase #2):

| Kolom | Diisi oleh | Arti |
|---|---|---|
| `payment_method` | server saat order dibuat | `MANUAL` atau `YOBASEPAY` |
| `charged_amount` | server | total + kode unik → nominal yang harus ditransfer |
| `payment_expired_at` | server | `now + expiry_minutes` (dari pengaturan) |
| `manual_claim_at` | buyer (tombol konfirmasi) | waktu buyer mengklaim sudah transfer |
| `manual_claim_note` / `manual_claim_reference` | buyer | nama pengirim / no. referensi |
| `manual_review_status` | penjual | `APPROVED` (lunas) atau `REJECTED` (klaim ditolak) |
| `manual_reviewed_at` / `manual_reviewed_by` / `manual_review_note` | penjual | jejak verifikasi |

Order manual **tidak pernah** punya `payment_id`, jadi webhook YoBasePay tidak
akan pernah menyentuhnya (pencocokan webhook lewat `payment_id`).

---

## B. Setup (sekali saja)

### 1. Ambil gambar QRIS statis kamu
- **GoPay Merchant / GoBiz**: menu *QRIS* → *Unduh/Simpan QR* → file PNG.
- QRIS bank / merchant lain: unduh gambar QR dari dashboard merchant.
- Pastikan QR **statis** (tanpa nominal) — nominal diketik buyer sendiri.

### 2. Unggah lewat dashboard
Buka **`/admin/settings`** (menu *Pembayaran*):

| Isian | Keterangan |
|---|---|
| **Aktifkan metode pembayaran manual** | saklar utama (juga bisa dimatikan via env) |
| **Nama metode** | yang tampil di checkout, mis. `Transfer Manual (QRIS)` |
| **Nama penerima (a.n.)** | mis. `Toko Saya` — ditampilkan di halaman bayar |
| **Batas waktu bayar (menit)** | default 120; lewat itu order otomatis kadaluarsa (10–4320) |
| **Instruksi tambahan** | teks bebas, mis. "gunakan GoPay/OVO/DANA" |
| **Gambar QR** | PNG/JPG/WebP, maks **900 KB** |

Gambar disimpan **base64 di Supabase #2** (tabel `manual_payment_settings`) dan
disajikan ke buyer lewat `GET /api/manual-qr`. Jadi: tidak perlu bucket storage,
tidak perlu hosting eksternal, dan ganti QR tidak perlu deploy ulang.

> Alternatif: bila kamu sudah meng-host gambarnya sendiri, isi
> `MANUAL_PAYMENT_QR_IMAGE_URL=https://…/qris.png`. URL itu yang dipakai buyer
> (gambar di dashboard jadi cadangan).

### 3. Opsi "QRIS Otomatis" — ditampilkan berstatus **Ongoing**

Sejak integrasi pembayaran manual, halaman `/checkout` **selalu** menampilkan
dua opsi bayar (dibangun oleh `getCheckoutPaymentMethods()` di
`src/lib/payment-config.ts`):

| Opsi di checkout | Perilaku |
|---|---|
| **Transfer Manual** | diurutkan **pertama** dan jadi pilihan default; aktif begitu QR kamu terunggah (disabled/greyed bila belum) |
| **QRIS Otomatis** | tampil dengan badge amber **"Ongoing"** + catatan "sedang dalam proses", tapi **tidak dapat dipilih** — radio button dan klik pada kartu dinonaktifkan |

Tujuannya: buyer tetap melihat bahwa metode QRIS sedang disiapkan (alih-alih
mengira tokonya rusak), dan otomatis diarahkan ke Transfer Manual. Tombol
submit checkout berbunyi "Buat Pesanan & Lanjut Bayar (Manual)".

Bila akun YoBasePay belum aktif, cukup kosongkan kedua env-nya:

```
YOBASEPAY_API_KEY=
YOBASEPAY_WEBHOOK_SECRET=
```

Keduanya kosong → integrasi YoBasePay mati di level server: `createPayment`
ditolak (`provider_disabled`), `POST /api/orders` dengan
`paymentMethod=YOBASEPAY` balas **409** ("sedang dalam proses, status
ongoing"), dan **semua webhook ditolak 403** (tanpa secret, signature tidak
bisa diverifikasi). Toko tetap jalan penuh dengan pembayaran manual.

> Mengisi kedua var itu **tidak** mengubah tampilan checkout — opsi QRIS tetap
> "Ongoing" di UI. Yang aktif adalah integrasinya di belakang layar (webhook
> diterima, polling/tombol "Cek Pembayaran" admin bekerja, order bisa dibuat
> via API untuk pengujian). Bila kelak QRIS ingin dibuka untuk buyer di
> halaman checkout, ubah SATU fungsi saja: `getCheckoutPaymentMethods()` —
> logika bisnis tidak tersentuh.

---

## C. Alur penjual (verifikasi)

1. Notifikasi Telegram masuk: **🧾 KLAIM TRANSFER MANUAL** — berisi order,
   nominal yang ditagihkan, nama pengirim, dan no. referensi buyer.
2. Buka aplikasi QRIS merchant / mobile banking → cek mutasi pada nominal itu.
3. Cocokkan: nominal **persis** (termasuk 3 digit kode unik), waktu, dan
   nama pengirim.
4. Di dashboard:
   - uang ada → **Order → tab "Verifikasi Manual"** (atau antrian di
     dashboard) → **✓ Konfirmasi Lunas**; atau buka detail order untuk mengisi
     *nominal masuk* + catatan verifikasi,
   - uang tidak ada → **✕ Tolak Klaim** + alasan. Buyer boleh konfirmasi ulang
     sampai batas waktu bayar habis.
5. Order jadi `PAID` → notifikasi Telegram **🔔 PESANAN BARU … LUNAS** → proses
   pesanan seperti biasa (Proses → Selesai).

Antrian cepat: **`/admin/orders?status=CLAIM`** — hanya order manual yang
menunggu verifikasi, urut dari klaim tertua.

---

## D. Kenapa ada "kode unik"?

QR statis tidak bisa mengunci nominal, jadi buyer mengetik angka sendiri. Sistem
menambahkan **kode unik 1–999** yang diturunkan dari kode order (FNV-1a, jadi
selalu sama untuk order yang sama):

```
harga produk  × qty      = Rp50.000
+ kode unik order        =      417
nominal transfer         = Rp50.417   ← harus persis
```

Manfaatnya: dua buyer yang kebetulan transfer Rp50.000 pada menit yang sama
tetap bisa dibedakan di mutasi. Halaman bayar menampilkan tombol **Salin
nominal** agar buyer tidak salah ketik.

Bila seller mengisi *nominal masuk* saat konfirmasi dan angkanya **kurang dari
total order**, sistem menolak (409) — mencegah konfirmasi transfer yang
sebenarnya belum penuh.

---

## E. Keamanan & batasan

| Hal | Perilaku kode |
|---|---|
| Buyer mengklaim tanpa transfer | Tidak mengubah status apa pun; hanya antrian + notifikasi. Penjual yang memutuskan |
| Buyer spam tombol konfirmasi | Klaim pertama yang tercatat (guard `manual_claim_at IS NULL`), klaim berikutnya no-op + rate limit 10/10 menit/user |
| Buyer mengubah nominal/harga | Tidak mungkin — harga & `charged_amount` dihitung server dari DB |
| Order manual kadaluarsa saat penjual belum cek | Selama `manual_claim_at` terisi, order **tidak** di-expire otomatis — keputusan ada di penjual |
| Order manual + webhook YoBasePay | Tidak mungkin cocok: order manual tidak punya `payment_id` |
| Endpoint gambar QR | `GET /api/manual-qr` publik (QRIS statis memang untuk dibagikan), di-cache 5 menit |
| Ukuran gambar | maks 900 KB, hanya `image/png`/`jpeg`/`webp`; body server action dibatasi 2 MB |

Batasan yang perlu disadari: verifikasi manual bergantung pada ketelitian
penjual. Tidak ada rekonsiliasi otomatis, tidak ada refund otomatis, dan
nominal yang dibayar buyer **tidak** bisa dipastikan sistem — hanya penjual yang
melihat mutasi. Karena itu metode ini paling cocok untuk volume kecil-menengah.

---

## F. Env terkait

| Variabel | Default | Fungsi |
|---|---|---|
| `MANUAL_PAYMENT_ENABLED` | `true` | saklar global metode manual (di luar saklar dashboard) |
| `DEFAULT_PAYMENT_METHOD` | `MANUAL` | metode terpilih default di checkout (`MANUAL`/`YOBASEPAY`) |
| `MANUAL_PAYMENT_QR_IMAGE_URL` | kosong | opsional: URL https gambar QR (mengalahkan upload dashboard) |
| `YOBASEPAY_API_KEY` + `YOBASEPAY_WEBHOOK_SECRET` | kosong | kosong = QRIS otomatis nonaktif |

Detail lengkap: `docs/environment-variables.md`.

## G. Checklist uji cepat

1. `/admin/settings` → unggah QR → **Simpan** → pratinjau muncul; baris
   "QRIS Otomatis" di panel *Status saat ini* berbunyi **ONGOING**.
2. Buka `/checkout?product=<id>` → **Transfer Manual** tampil pertama dan
   terpilih; **QRIS Otomatis** tampil ber-badge **"Ongoing"** dan tidak bisa
   diklik/dipilih (apa pun konfigurasi YoBasePay). Buat order.
3. `/pay/ORD-…` menampilkan QR + nominal `total + kode unik` + tombol salin.
4. Tekan **Saya sudah transfer** → muncul "Konfirmasi kamu sudah kami terima";
   tombol tidak bisa dipakai dua kali.
5. Telegram (bila terisi) mengirim **🧾 KLAIM TRANSFER MANUAL**.
6. `/admin` → kartu **Perlu verifikasi** = 1; antrian menampilkan order itu.
7. **✓ Konfirmasi Lunas** → halaman buyer berubah jadi **Pembayaran berhasil**
   dalam ≤8 detik (polling), Telegram mengirim **🔔 PESANAN BARU**.
8. Uji tolak: order manual lain → **✕ Tolak Klaim** → halaman buyer menampilkan
   alasan + form konfirmasi muncul lagi.
