import mqtt from 'mqtt';
import dotenv from 'dotenv';

dotenv.config();

// Safety Check
if (!process.env.THINGSBOARD_HOST || !process.env.THINGSBOARD_TOKEN) {
  console.error('❌ ERROR: Konfigurasi ThingsBoard tidak lengkap di file .env!');
  process.exit(1);
}

const host = process.env.THINGSBOARD_HOST;
const port = parseInt(process.env.THINGSBOARD_PORT || '1883', 10);
const token = process.env.THINGSBOARD_TOKEN;

const options: mqtt.IClientOptions = {
  host: host,
  port: port,
  protocol: 'mqtt', 
  username: token,
  clientId: `sim_${Math.random().toString(16).slice(3)}`
};

console.log(`Menghubungkan ke ThingsBoard di ${host}:${port}...`);
const client = mqtt.connect(options);

function generateSensorData() {
  const ecg = Math.floor(400 + Math.random() * 200);
  const heartRate = Math.floor(70 + Math.random() * 15);
  const spo2 = Math.floor(96 + Math.random() * 4);
  const bodyTemp = parseFloat((36.2 + Math.random() * 2).toFixed(1));

  let accelX = parseFloat((Math.random() * 0.2).toFixed(2));
  let accelY = parseFloat((Math.random() * 0.2).toFixed(2));
  let accelZ = parseFloat((0.9 + Math.random() * 0.1).toFixed(2));

  if (Math.random() < 0.10) { 
      accelX = parseFloat((1.0 + Math.random() * 2.0).toFixed(2));
      accelY = parseFloat((1.0 + Math.random() * 2.0).toFixed(2));
      accelZ = parseFloat((1.0 + Math.random() * 2.0).toFixed(2));
      console.log('⚠️ ALERT: Simulasi Pasien Terjatuh!');
  }

  const smv = Math.sqrt((accelX * accelX) + (accelY * accelY) + (accelZ * accelZ));
  const impactForce = parseFloat(smv.toFixed(2));
  const isFalling = impactForce > 2.5;

  return {
      ecg: ecg,
      heartRate: heartRate, 
      spo2: spo2,       
      bodyTemp: bodyTemp, 
      accelX: accelX,
      accelY: accelY,
      accelZ: accelZ, 
      impactForce: impactForce, 
      isFalling: isFalling      
  };
}

client.on('connect', () => {
  console.log('✅ Berhasil terhubung ke ThingsBoard Publik!');

  setInterval(() => {
      const telemetryData = generateSensorData();
      console.log(`📡 Kirim | HR: ${telemetryData.heartRate} | Temp: ${telemetryData.bodyTemp} | SMV: ${telemetryData.impactForce}g | Jatuh: ${telemetryData.isFalling}`);
      
      client.publish('v1/devices/me/telemetry', JSON.stringify(telemetryData), { qos: 1 });
  }, 2000); // Saya set 2 detik agar tidak terlalu spamming saat testing
});

client.on('error', (err) => {
  console.error('❌ Koneksi MQTT gagal:', err);
});