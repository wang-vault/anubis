# Telegram Bot — Notifikasi Penjual (dari nol)

Bot dipakai **hanya** untuk mengirim pesan "🔔 PESANAN BARU" ke penjual saat
order lunas. Tidak untuk buyer, tidak untuk OTP, tidak untuk pembayaran.

## 1. Buat bot dengan @BotFather

1. Buka Telegram → search **`@BotFather`** (centang biru, username resmi).
2. Kirim `/newbot` → ikuti pertanyaan:
   - *Display name*: `Toko Kopi Budi — Order Alert` (beberapa kata, boleh spasi)
   - *Username*: harus unik & diakhiri `bot`, mis. `tokokopibudi_orders_bot`
3. Balasan berisi **HTTP API token**, format `123456789:AA…panjang…`.
   → ini `TELEGRAM_BOT_TOKEN`. **Jangan pernah** share/token di-upload ke repo.
   Bila bocor: `/revoke` di BotFather → token baru → ganti env → redeploy.

## 2. Dapatkan CHAT ID penjual (2 cara, pilih satu)

**Cara A — chat pribadi (paling gampang):**
1. Kirim pesan apa pun dari HP kamu ke bot (mis. `halo`). (Bot harus dulu
   di-`/start`; kalau belum, kirim `/start`.)
2. Buka URL (token diganti milikmu):
   ```
   https://api.telegram.org/bot<TOKEN>/getUpdates
   ```
3. Cari JSON `"chat":{"id":987654321,…}` → **987654321** = `TELEGRAM_CHAT_ID` (positif).

**Cara B — grup (mis. grup toko; id negatif, mulai `-100…`):**
1. Tambahkan bot ke grup → kirim pesan di grup.
2. Sama: buka `getUpdates` → `chat.id` grup = angka negatif.
3. Bila grup "privacy mode" aktif dan bot tidak menerima pesan:
   BotFather → `/setprivacy` → **Disable** untuk bot ini (bot tidak bisa baca
   di grup kalau privacy on; kirim pesan lagi setelah disable).

> Alternatif kalau `getUpdates` kosong (bot lama, webhook terpasang): kirim
> pesan lalu cek via `https://api.telegram.org/bot<TOKEN>/getUpdates?offset=-1`,
> atau tanyakan bot @userinfobot (id privat Anda — cocok utk chat pribadi).

## 3. Masukkan ke environment

```
TELEGRAM_BOT_TOKEN=123456789:AAContohFormatBukanTokenAslixxxxxxxxxx
TELEGRAM_CHAT_ID=987654321          # atau -1001234567890 untuk grup
```
Vercel → Environment Variables → simpan → **Redeploy** (env baru terbaca
setelah deploy ulang). Chat ID bisa diganti kapan saja lewat env — tidak
ada yang di-hardcode.

## 4. Test kirim pesan (tanpa menyentuh sistem)

```bash
curl -s -X POST "https://api.telegram.org/bot$TOKEN/sendMessage" \
  -H 'Content-Type: application/json' \
  -d '{"chat_id":"987654321","text":"tes dari dokumentasi"}'
# {"ok":true,"result":{…}} → pesan muncul di Telegram ✅
```
Gagal `403 Forbidden: bot was kicked from the group chat` → tambahkan lagi.
Gagal `chat not found` → bot belum di-start / chat ID salah.

## 5. Test notifikasi "order PAID"

1. Pastikan env terisi + deploy selesai.
2. Buat order uji → bayar (atau tembak webhook sah per `docs/stenly.md` §7.3).
3. ✅ Pesan masuk ke chat penjual:
   ```
   🔔 PESANAN BARU

   Order: #ORD-20260911-AB7K2M
   Buyer: Budi
   WhatsApp: 6281234567890
   Produk: Kopi Gayo 250g
   Jumlah: 1
   Total: Rp85.000
   Status: LUNAS ✅

   Silakan proses pesanan.
   ```
4. Kirim webhook yang sama dua kali → pesan **tidak** dobel (klaim
   `orders.telegram_notified_at`; lihat `src/lib/orders.ts` → `applyPaid`).

## 6. Perilaku bila Telegram gagal (by design)

- Order **tetap PAID** — pembayaran tidak dibatalkan.
- Pesan error dicatat (log `telegram_send_failed/error`), tidak di-retry
  otomatis; order `telegram_notified_at` sudah terisi → tidak spam.
- Penjual tetap bisa lihat order di dashboard (itu sumber datanya).
- Kirim ulang manual: SQL → `update orders set telegram_notified_at=null where
  order_code='…';` lalu kirim ulang webhook dari dashboard Stenly (Webhook
  Logs → resend) / tekan tombol cek status.
  (Boleh juga tidak apa-apa — order sudah terlihat di dashboard.)

## 7. Keamanan

- Token = rahasia server. Tidak pernah ke browser (module `server-only`).
- Bot tidak menerima perintah apa pun (hanya outbound sendMessage) → tidak ada
  attack surface chat.
- Isi pesan otomatis (order dari DB) — tidak ada input user mentah yang
  di-templating berisiko (format `text`, bukan HTML).
