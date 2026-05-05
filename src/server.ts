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

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`✅ Server Backend berjalan di port ${PORT}`);
});