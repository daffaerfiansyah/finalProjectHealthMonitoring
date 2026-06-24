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

// ==========================================
// HELPER: Autentikasi ThingsBoard
// ==========================================
async function getThingsBoardToken(): Promise<string> {
    const response = await fetch(`${process.env.TB_BASE_URL}/api/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            username: process.env.TB_USERNAME,
            password: process.env.TB_PASSWORD
        })
    });

    if (!response.ok) {
        throw new Error("Gagal login ke ThingsBoard API");
    }

    const data = await response.json();
    return data.token;
}

// ==========================================
// HELPER: Tarik Data Customer
// ==========================================
async function fetchTbCustomerInfo(customerId: string, token: string) {
    const response = await fetch(`${process.env.TB_BASE_URL}/api/customer/${customerId}`, {
        method: "GET",
        headers: {
            "Content-Type": "application/json",
            "X-Authorization": `Bearer ${token}`
        }
    });

    if (!response.ok) {
        throw new Error(`Gagal menarik data customer dari ThingsBoard: ${response.statusText}`);
    }

    return await response.json();
}

// ==========================================
// ENDPOINT: Alarm
// ==========================================
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

app.post("/api/history", async (req: Request, res: Response) => {
  try {
    const { device_id, conclusion, severity, sensor_data, handled_by_user_id } = req.body; 

    console.log(`\n[${new Date().toISOString()}] 📊 Data History Masuk:`);
    console.log(`Device: ${device_id} | Hasil: ${conclusion} | User ID: ${handled_by_user_id || 'Tidak ada'}`);

    if (!device_id || !conclusion) {
        return res.status(400).json({ error: "device_id atau conclusion tidak boleh kosong" });
    }

    if (handled_by_user_id) {
        const userCheck = await pool.query("SELECT id FROM users WHERE id = $1", [handled_by_user_id]);

        if (userCheck.rowCount === 0) {
            console.log(`[SINKRONISASI] User ${handled_by_user_id} belum ada di DB. Menarik data dari ThingsBoard...`);
            
            try {
                const tbToken = await getThingsBoardToken();
                const tbUser = await fetchTbCustomerInfo(handled_by_user_id, tbToken);

                await pool.query(
                    "INSERT INTO users (id, email, name, role) VALUES ($1, $2, $3, $4)",
                    [
                        tbUser.id.id, 
                        tbUser.email || "no-email@tb.com", 
                        tbUser.title || tbUser.name, 
                        "Customer"
                    ]
                );
                console.log(`[SINKRONISASI] ✅ User ${tbUser.title} berhasil disimpan ke database.`);
            } catch (syncErr) {
                console.error("❌ Gagal sinkronisasi user:", syncErr);
            }
        }
    }

    await pool.query(
      "INSERT INTO patient_history (device_id, conclusion, severity, sensor_data, handled_by_user_id) VALUES ($1, $2, $3, $4, $5)",
      [device_id, conclusion, severity || "UNKNOWN", sensor_data || {}, handled_by_user_id || null]
    );

    res.status(200).json({ message: "History dan sinkronisasi user tersimpan sukses!" });
  } catch (err) {
    console.error("❌ ERROR DATABASE HISTORY:", err); 
    res.status(500).json({ error: "Gagal menyimpan riwayat" });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`✅ Server Backend berjalan di port ${PORT}`);
});