# Cloudflare — Opsional, Kapan & Bagaimana

## Perlu atau tidak?

**Tidak wajib** — aplikasi sudah aman tanpa Cloudflare (RLS,
validasi server-side, limiter in-app). Tambahkan bila butuh:

| Kebutuhan | Pakai Cloudflare? |
|---|---|
| DDoS/CC attack, bot scan `/auth`, `/api` dari internet Indonesia ramai | ✔ WAF + Rate Limiting Rules (nilai tambah nyata) |
| Domain sudah di Cloudflare (DNS) | ✔ tinggal proxy-kan (atau DNS-only ke Vercel) |
| Toko kecil, trafik dari link WA pribadi | ✖ lewati; serverless sudah mitigasi dasar |
| Ingin Worker custom (redirect edge, KV cache) | ✖ **jangan** — tidak menambah nilai dan menambah kompleksitas operasional |

## Cara pakai yang benar dengan Vercel

1. Domain di Cloudflare → Nameservers aktif.
2. Buat record: `toko` → `cname.vercel-dns.com`, proxy **oranye** (proxied).
3. SSL/TLS mode: **Full (strict)** (Vercel serve sertifikat valid).
4. Vercel → Settings → Domains: domain tsb akan terverifikasi; bila instruksi
   meminta A record `76.76.21.21` (apex) → proxied juga.
5. Uji: `curl -I https://tokoanda.com` ada header `cf-ray` → proxy hidup,
   dan situs 200 (bukan redirect loop; loop = mode SSL salah → Full strict).

## Konfigurasi yang direkomendasikan (bila proxy aktif)

- **Rate Limiting Rules** (Security → WAF → Rate Limiting rules):
  1. `uri_path starts_with "/auth"` → 10 req/60s per IP (brute force login).
  2. `uri_path eq "/api/orders" and http.request.method eq "POST"` → 20/5m/IP.
  3. `uri_path starts_with "/api/payments/status"` → 60 req/60s per IP
     (halaman /pay sudah polling tiap 8 detik; batasi penyalahgunaan).
- **Security Level: High** opsional; Bot Fight Mode ON (aman: tidak ada
  webhook/API pihak ketiga yang perlu masuk — semua trafik berasal dari
  browser pengunjung).
- Cache **OFF** untuk `/api/*` dan halaman login/checkout (default: dynamic
  HTML tidak di-cache — jangan tambahkan Cache Rule bodoh ke seluruh situs;
  session cookie tidak boleh dibagikan antar pengunjung!).

## Rollback sederhana

Cloudflare tidak menyimpan state: bila muncul masalah (ERR_TOO_MANY_REDIRECTS,
521) → ubah record ke **DNS only (awan abu-abu)** → trafik
langsung ke Vercel; atur ulang; nyalakan proxy lagi. Zero downtime.

## Worker? (tidak dipakai)

Dokumentasi ini TIDAK mengarang kebutuhan Worker. Bila kelak butuh (mis.
geoblocking, header khusus, edge cache), aturannya tetap: logika bisnis &
verifikasi pembayaran **tidak pernah** pindah ke Worker — Worker hanya
"lapisan jaringan" di depan aplikasi; sumber kebenaran tetap aksi penjual di
dashboard.
