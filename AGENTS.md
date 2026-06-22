# Agent Guidelines & Constraints: Antigravity Super Sentinel

Dokumen ini mendefinisikan batasan (constraints) dan aturan kerja untuk semua AI Agent yang memodifikasi codebase ini. Aturan ini bersifat mengikat demi melindungi fungsionalitas inti yang telah dibangun.

> [!IMPORTANT]
> **ATURAN UTAMA: PROTEKSI LOGIC HULU-HILIR**
> Kodebase ini dikembangkan secara hati-hati oleh **Bos Kadzura**. Jangan melakukan modifikasi atau penghapusan logika yang sudah stabil tanpa analisis arsitektur yang mendalam dan persetujuan eksplisit.

## ⛔ Zona Terlarang (Do Not Modify)

Jangan sekali-kali mengubah, mengganti, atau merusak logika inti berikut pada file [extension.js](file:///home/kadzura/proyek-coding/production-app/03_new_project/src/extension.js):
1. **Active Model Detection Logic**: Logika pembacaan preferensi model aktif dari SQLite database, pemetaan tipe data, dan caching-nya.
2. **Status Bar Management**: Pembaruan teks status bar, format countdown reset kuota, tooltip, warna latar belakang (warning/error/remote), dan sinkronisasi status (ACTIVE/PAUSED/NOT INSTALLED/NO UI ACCESS).
3. **Auto-Clicker & Injection Engine**: 
   - Mekanisme injeksi script bypass ke `workbench.html`.
   - File template `autoScript.js`.
   - Pengaturan auto-click patterns, penulisan status JSON (`ag-super-sentinel-state.json`), dan pembersihan V8 code cache (`Code Cache/js`).

## 🛠️ Aturan Penambahan Fitur & Refactoring

Jika Bos Kadzura meminta penambahan fitur baru atau penyempurnaan (refine):
1. **Analisis Akurasi Tinggi**: Lakukan pelacakan kode secara menyeluruh sebelum membuat usulan. Wajib miliki tingkat keyakinan (*confidence*) dan akurasi tinggi sebelum menyentuh file.
2. **Karantina Dampak (Isolation)**: Fitur baru harus diisolasi dari fungsi inti agar tidak mengganggu stabilitas dashboard.
3. **Dokumentasi Perubahan**: Jelaskan secara spesifik baris mana yang akan diubah, alasan teknisnya, serta rencana verifikasinya sebelum eksekusi dijalankan.
4. **Validasi Mutlak**: Setiap kali ada perubahan kecil sekalipun, lakukan verifikasi ulang untuk memastikan status bar dan clicker tetap berfungsi tanpa mengalami degradasi.

---
*Ditetapkan oleh Bos Kadzura & Schatten (Architect-tier Partner).*
