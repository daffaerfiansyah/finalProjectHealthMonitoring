import express, { type Request, type Response } from "express";
import pkg from "pg";
import dotenv from "dotenv";

dotenv.config();

const { Pool } = pkg;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false 
  }
});

const app = express();
app.use(express.json()); 

app.post("/api/alarm", async (req: Request, res: Response) => {
  try {
    const { device_id, type, value } = req.body; 

    console.log(`[${new Date().toISOString()}] 🚨 Data Alarm Masuk:`, req.body);

    if (!device_id || !type) {
        return res.status(400).json({ error: "device_id atau type tidak boleh kosong" });
    }

    await pool.query(
      "INSERT INTO alarms (device_id, type, value) VALUES ($1, $2, $3)",
      [device_id, type, String(value)]
    );

    res.status(200).json({ message: "Alarm saved to Supabase successfully" });
  } catch (err) {
    console.error("❌ ERROR DATABASE:", err); 
    res.status(500).json({ error: "Failed to save alarm" });
  }
});

// Endpoint BARU: Untuk menyimpan riwayat pengujian (Testing History) beserta data sensornya
app.post("/api/history", async (req: Request, res: Response) => {
  try {
    // Menangkap struktur JSON yang dikirim oleh ThingsBoard
    const { device_id, conclusion, severity, sensor_data } = req.body; 

    console.log(`\n[${new Date().toISOString()}] 📊 Data History Masuk:`);
    console.log(`Device: ${device_id} | Hasil: ${conclusion} | Bahaya: ${severity}`);
    console.log(`Sensor:`, sensor_data);

    // Validasi dasar
    if (!device_id || !conclusion) {
        return res.status(400).json({ error: "device_id atau conclusion tidak boleh kosong" });
    }

    // Memasukkan data ke dalam tabel testing_history di Supabase
    // Parameter $4 (sensor_data) akan otomatis menjadi tipe JSONB di Postgres
    await pool.query(
      "INSERT INTO testing_history (device_id, conclusion, severity, sensor_data) VALUES ($1, $2, $3, $4)",
      [device_id, conclusion, severity || "UNKNOWN", sensor_data || {}]
    );

    res.status(200).json({ message: "History tersimpan sukses di Supabase!" });
  } catch (err) {
    console.error("❌ ERROR DATABASE HISTORY:", err); 
    res.status(500).json({ error: "Gagal menyimpan riwayat" });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`✅ Server Backend berjalan di port ${PORT}`);
});