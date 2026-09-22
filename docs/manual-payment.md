# Pembayaran Manual via WhatsApp (satu-satunya metode)

Toko ini **tidak punya payment gateway**. Satu-satunya cara buyer membayar
adalah **transfer manual**, dan semua detail pembayaran (QRIS statis, nomor
rekening, e-wallet) dikirim penjual **lewat chat WhatsApp** — bukan ditampilkan
di aplikasi.

Kenapa begitu: detail pembayaran jadi selalu yang terbaru, bisa diganti kapan
saja tanpa deploy, dan tidak ada gambar QR / nomor rekening yang tertinggal di
riwayat halaman pembeli.

Prinsip yang dijaga kode: **buyer tidak bisa membuat ordernya sendiri menjadi
lunas.** Klaim "saya sudah transfer" hanya memindahkan order ke antrian
verifikasi penjual; status `PAID` hanya bisa di-set penjual dari dashboard
setelah uang benar-benar terlihat di mutasi.

---

## A. Cara kerja (ringkas)

```
Buyer                        Toko (Next.js)                      Penjual
  │  checkout (tanpa pilih metode) │                                 │
  ├───────────────────────────────▶│ order PENDING                   │
  │                                │ nominal = total + kode unik     │
  │  tekan "Buka WhatsApp Penjual" │ (pesan sudah terisi kode+nominal)│
  ├────────────────────────────────────────────────────────────────▶ │ 💬 chat masuk
  │                                │                                 │ kirim QRIS/rekening
  │◀───────────────────────────────────────────────────────────────  │ di chat
  │  transfer sesuai nominal       │                                 │
  │  "Saya sudah transfer"         │ manual_claim_at + catatan       │
  ├───────────────────────────────▶│──── notifikasi Telegram ───────▶│ 🧾 KLAIM TRANSFER MANUAL
  │                                │                                 │ cek mutasi
  │                                │◀── "Konfirmasi Pembayaran" ─────┤ ✓ / ✕
  │◀── status PAID (polling 8 dtk) ┤ order PAID + Telegram "LUNAS"   │
```

Kolom yang terlibat (tabel `orders`, Supabase #2):

| Kolom | Diisi oleh | Arti |
|---|---|---|
| `payment_method` | server saat order dibuat | selalu `MANUAL` untuk order baru (`STENLY` / `YOBASEPAY` = order arsip dari masa QRIS otomatis) |
| `charged_amount` | server / penjual | total + kode unik → nominal yang harus ditransfer; saat konfirmasi penjual boleh menyimpan nominal yang benar-benar masuk |
| `payment_expired_at` | server | `now + expiry_minutes` (dari pengaturan) |
| `manual_claim_at` | buyer (tombol konfirmasi) | waktu buyer mengklaim sudah transfer |
| `manual_claim_note` / `manual_claim_reference` | buyer | nama pengirim / no. referensi (opsional) |
| `manual_review_status` | penjual | `APPROVED` (lunas) atau `REJECTED` (klaim ditolak) |
| `manual_reviewed_at` / `manual_reviewed_by` / `manual_review_note` | penjual | jejak verifikasi |

Order manual **tidak pernah** punya `payment_id`, `payment_url`, atau
`qr_image_url` — kolom warisan itu dibiarkan `NULL` dan tidak pernah dibaca UI
kecuali untuk menampilkan order arsip apa adanya.

---

## B. Setup (sekali saja)

Buka **`/admin/settings`** (menu *Pembayaran*). Isian yang tersedia:

| Isian | Wajib? | Keterangan |
|---|---|---|
| **Aktifkan pembayaran manual via WhatsApp** | — | saklar utama di database (juga bisa dimatikan global lewat env `MANUAL_PAYMENT_ENABLED`) |
| **Nomor WhatsApp penjual** | **ya** | tujuan chat buyer. Format `081234567890`, `+62 812…`, atau `62 812…` — disimpan ternormalisasi `62…`. **Selama kolom ini kosong, checkout ditolak** dengan pesan jelas (bukan order menggantung) |
| **Nama metode** | ya (default ada) | label yang tampil di checkout, default `Transfer Manual (WhatsApp)` |
| **Nama penerima (a.n.)** | tidak | mis. `Toko Saya` — ditampilkan di halaman bayar & pesan Telegram |
| **Batas waktu bayar (menit)** | ya (default 120) | 10–4320 menit. Order kadaluarsa otomatis bila **belum diklaim** sampai waktu ini |
| **Instruksi tambahan** | tidak | teks bebas di halaman bayar, mis. "setelah transfer, kirim screenshot bukti di chat" |
| **Template pesan WhatsApp** | tidak | pesan yang otomatis terisi saat buyer menekan tombol chat. Placeholder: `{toko}` `{kode}` `{produk}` `{jumlah}` `{total}` `{nama}`. Kosong = template bawaan |

Simpan → halaman langsung memakai nilai baru, **tanpa deploy ulang**. Perubahan
tersimpan di Supabase #2 (`manual_payment_settings`, satu baris `id = 1`).

### Status metode di halaman yang sama

Panel *Status saat ini* menjelaskan kenapa metode belum bisa dipakai:

| Status | Arti | Perbaikan |
|---|---|---|
| `schema_missing` | kolom pembayaran manual / kolom WhatsApp belum ada di database | jalankan `supabase/store/002_manual_payment.sql` lalu `004_whatsapp_payment.sql` (banner merah di `/admin` memuat SQL-nya) |
| `disabled` | saklar di DB mati, **atau** env `MANUAL_PAYMENT_ENABLED=false` | nyalakan salah satu (env butuh redeploy) |
| `no_whatsapp` | nomor WhatsApp penjual masih kosong | isi nomor di form, atau set `WHATSAPP_SELLER_NUMBER` sebagai cadangan |

### Nomor WhatsApp: DB vs env

- Kolom di `/admin/settings` adalah **sumber utama**.
- `WHATSAPP_SELLER_NUMBER` hanya **cadangan** yang dipakai bila kolom DB kosong
  (berguna untuk deploy pertama sebelum sempat membuka dashboard).
- Nilai env tidak pernah ditimpa ke DB; halaman pengaturan menunjukkan apakah
  nomor yang sedang aktif berasal dari database atau dari env.

### Kalau database masih versi lama

Jalankan migrasi (aman berulang, tidak menghapus data):

1. `supabase/store/002_manual_payment.sql` — kolom pembayaran manual
   (`payment_method`, `manual_*`, `charged_amount`).
2. `supabase/store/004_whatsapp_payment.sql` — kolom nomor WhatsApp + template
   pesan, default `payment_method = 'MANUAL'`, dan label default versi WhatsApp.

Project baru cukup menjalankan `supabase/store/001_schema.sql` (sudah memuat
semuanya). File `003_stenly_payment.sql` hanya riwayat migrasi provider QRIS
otomatis yang sudah dihapus dari kode.

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

> Tombol **✓ Konfirmasi Pembayaran Lunas** di detail order selalu ada selama
> order manual belum lunas — termasuk order yang buyer-nya **tidak pernah**
> menekan "Saya sudah transfer" (transfer langsung dari chat WhatsApp) dan order
> yang sudah **kadaluarsa**. Klaim buyer hanya mempercepat antrian, bukan syarat
> penjual mencatat uang yang benar-benar masuk.

> Butuh detail pembayaran diganti? Cukup kirim yang baru di chat — aplikasi
> tidak menyimpan atau menampilkan nomor rekening/QR sama sekali, jadi tidak ada
> yang perlu diedit di dashboard.

---

## D. Kenapa ada "kode unik"?

Pembayaran manual tidak bisa mengunci nominal, jadi buyer mengetik angka
sendiri. Sistem menambahkan **kode unik 1–999** yang diturunkan dari kode order
(FNV-1a, jadi selalu sama untuk order yang sama):

```
harga produk  × qty      = Rp50.000
+ kode unik order        =      417
nominal transfer         = Rp50.417   ← harus persis
```

Manfaatnya: dua buyer yang kebetulan transfer Rp50.000 pada menit yang sama
tetap bisa dibedakan di mutasi. Nominal ini ikut terisi otomatis di pesan
WhatsApp, jadi buyer tidak perlu menyalin manual.

Bila penjual mengisi *nominal masuk* saat konfirmasi dan angkanya **kurang dari
total order**, sistem menolak (409) — mencegah konfirmasi transfer yang
sebenarnya belum penuh.

---

## E. Keamanan & batasan

| Hal | Perilaku kode |
|---|---|
| Buyer mengklaim tanpa transfer | Tidak mengubah status apa pun; hanya antrian + notifikasi. Penjual yang memutuskan |
| Buyer spam tombol konfirmasi | Klaim pertama yang tercatat (guard `manual_claim_at IS NULL`), klaim berikutnya no-op + rate limit 10 klaim / 10 menit / user |
| Buyer mengubah nominal/harga | Tidak mungkin — harga & `charged_amount` dihitung server dari DB |
| Buyer melunasi ordernya sendiri | Tidak ada jalur apa pun: `AdminConfirmManualPayment` cek role admin server-side + guard transisi status |
| Order manual kadaluarsa saat penjual belum cek | Selama `manual_claim_at` terisi, order **tidak** di-expire otomatis — keputusan ada di penjual |
| Order arsip QRIS otomatis | Tetap terbaca (label "QRIS Otomatis (lama)"), tapi **tidak bisa** dikonfirmasi lewat jalur manual (409) |
| Detail pembayaran bocor ke pihak ketiga | Tidak ada detail pembayaran di aplikasi/database; hanya nomor WhatsApp penjual yang ditampilkan |

Batasan yang perlu disadari: verifikasi manual bergantung pada ketelitian
penjual. Tidak ada rekonsiliasi otomatis, tidak ada refund otomatis, dan
nominal yang dibayar buyer **tidak** bisa dipastikan sistem — hanya penjual yang
melihat mutasi. Karena itu metode ini paling cocok untuk volume kecil-menengah.

---

## F. Env terkait

| Variabel | Default | Fungsi |
|---|---|---|
| `MANUAL_PAYMENT_ENABLED` | `true` | saklar global metode manual (di luar saklar dashboard). `false` = checkout ditolak |
| `WHATSAPP_SELLER_NUMBER` | kosong | **cadangan** nomor WA penjual bila kolom DB kosong |

Detail lengkap: `docs/environment-variables.md`.

## G. Checklist uji cepat

1. `/admin/settings` → isi **nomor WhatsApp** → **Simpan** → panel status
   berbunyi siap (tanpa `no_whatsapp`).
2. Buka `/checkout?product=<id>` → tidak ada pilihan metode (satu-satunya
   metode) → buat order.
3. `/pay/ORD-…` menampilkan tombol **💬 Buka WhatsApp Penjual** dengan pesan
   berisi kode order + nominal; **tidak ada** gambar QR maupun nomor rekening.
4. Kirim chatnya (atau cek di WA Web) → pesan terisi kode order, produk,
   jumlah, dan nominal `total + kode unik`.
5. Tekan **Saya sudah transfer** → muncul "Konfirmasi kamu sudah kami terima";
   tombol tidak bisa dipakai dua kali.
6. Telegram (bila terisi) mengirim **🧾 KLAIM TRANSFER MANUAL**.
7. `/admin` → kartu **Perlu verifikasi** = 1; antrian menampilkan order itu.
8. **✓ Konfirmasi Lunas** → halaman buyer berubah jadi **Pembayaran berhasil**
   dalam ≤8 detik (polling), Telegram mengirim **🔔 PESANAN BARU**.
9. Uji tolak: order manual lain → **✕ Tolak Klaim** → halaman buyer menampilkan
   alasan + form konfirmasi muncul lagi.
10. Uji kadaluarsa: order baru tanpa klaim → tunggu lewat batas waktu (atau
    set 10 menit) → status jadi `EXPIRED`, dan order yang **sudah diklaim**
    tetap `PENDING`.
