import mqtt from 'mqtt';
import dotenv from 'dotenv';

dotenv.config();

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

let lastMovementTime = Date.now();
const INACTIVITY_THRESHOLD = 15 * 100;

type PatientProfile = 
    'A_SEHAT' | 
    'B_TAKIKARDIA' | 
    'C_BRADIKARDIA' | 
    'D_HIPOKSEMIA_RINGAN' | 
    'E_HIPOKSEMIA_BERAT' | 
    'F_HIPOTERMIA' | 
    'G_DEMAM' | 
    'H_DEMAM_TINGGI' | 
    'I_JATUH';

const profileSequence: PatientProfile[] = [
    'A_SEHAT', 
    'B_TAKIKARDIA', 
    'C_BRADIKARDIA', 
    'D_HIPOKSEMIA_RINGAN', 
    'E_HIPOKSEMIA_BERAT', 
    'F_HIPOTERMIA', 
    'G_DEMAM', 
    'H_DEMAM_TINGGI', 
    'I_JATUH'
];

let currentState: 'IDLE' | 'WARM_UP' | 'MEASURING' | 'CONCLUSION' = 'IDLE';
let stateTimer = 0;
let currentProfileIndex = 0;
let currentProfile: PatientProfile = profileSequence[0] || 'A_SEHAT';
let bufferData: any[] = [];

function getPatientProfileData(profile: PatientProfile) {
    let heartRate = 75; // Normal
    let spo2 = 98; // Normal
    let bodyTemp = 36.5; // Normal
    let accelX = 0, accelY = 0, accelZ = 1.0; // Normal grav (SMV = 1.0)
    
    switch (profile) {
        case 'A_SEHAT':
            break; 
        case 'B_TAKIKARDIA':
            heartRate = Math.floor(105 + Math.random() * 15); // > 100
            break;
        case 'C_BRADIKARDIA':
            heartRate = Math.floor(45 + Math.random() * 10); // < 60
            break;
        case 'D_HIPOKSEMIA_RINGAN':
            spo2 = Math.floor(91 + Math.random() * 3); // 91-94 (< 95)
            break;
        case 'E_HIPOKSEMIA_BERAT':
            spo2 = Math.floor(85 + Math.random() * 4); // 85-89 (< 90)
            break;
        case 'F_HIPOTERMIA':
            bodyTemp = parseFloat((35.0 + Math.random() * 0.8).toFixed(1)); // < 36.0
            break;
        case 'G_DEMAM':
            bodyTemp = parseFloat((37.6 + Math.random() * 0.3).toFixed(1)); // 37.6 - 37.9
            break;
        case 'H_DEMAM_TINGGI':
            bodyTemp = parseFloat((38.1 + Math.random() * 0.8).toFixed(1)); // >= 38.0
            break;
        case 'I_JATUH':
            accelX = 1.5; accelY = 1.5; accelZ = 1.5; // Menghasilkan SMV ~2.59
            break;
    }
    
    // Tambahkan sedikit noise acak untuk sensor yang sedang normal agar terlihat natural
    if (profile !== 'B_TAKIKARDIA' && profile !== 'C_BRADIKARDIA') heartRate += Math.floor(Math.random() * 4 - 2);
    if (profile !== 'D_HIPOKSEMIA_RINGAN' && profile !== 'E_HIPOKSEMIA_BERAT') spo2 -= Math.floor(Math.random() * 2);
    if (profile !== 'F_HIPOTERMIA' && profile !== 'G_DEMAM' && profile !== 'H_DEMAM_TINGGI') bodyTemp += parseFloat((Math.random() * 0.2 - 0.1).toFixed(1));

    // Rumus Phytagoras 3D untuk SMV (Signal Magnitude Vector) ADXL345
    let smv = Math.sqrt((accelX * accelX) + (accelY * accelY) + (accelZ * accelZ));
    let impactForce = parseFloat(smv.toFixed(2));
    let isFalling = impactForce >= 2.5; // Ambang batas jatuh
    let ecg = Math.floor(100 + Math.random() * 200); // Simulasi mentah ECG

    return { ecg, heartRate, spo2, bodyTemp: parseFloat(bodyTemp.toFixed(1)), impactForce, isFalling };
}

function determineHealthStatus(data: any): { text: string, severity: string } {
    let score = 0;
    let warnings = [];

    // 4. ADXL345 (Deteksi Jatuh via SMV)
    if (data.isFalling) {
        return { text: "CRITICAL (Pasien Terjatuh! SMV >= 2.5g)", severity: "CRITICAL" };
    }

    // 1. AD8232 (Heart Rate)
    if (data.heartRate > 100) {
        score += 3; // Memicu MAJOR
        warnings.push("Takikardia (>100 bpm)");
    } else if (data.heartRate < 60) {
        score += 3; // Memicu MAJOR
        warnings.push("Bradikardia (<60 bpm)");
    }

    // 2. MAX30102 (SpO2)
    if (data.spo2 < 90) {
        score += 5; // Memicu CRITICAL
        warnings.push("Hipoksemia Berat (<90%)");
    } else if (data.spo2 < 95) {
        score += 2; // Memicu MINOR
        warnings.push("Hipoksemia Ringan (<95%)");
    }

    // 3. MLX90614 (Body Temp)
    if (data.bodyTemp >= 38.0) {
        score += 5; // Memicu CRITICAL
        warnings.push("Demam Tinggi (>=38°C)");
    } else if (data.bodyTemp > 37.5) {
        score += 2; // Memicu MINOR
        warnings.push("Demam (>37.5°C)");
    } else if (data.bodyTemp < 36.0) {
        score += 1; // Memicu WARNING
        warnings.push("Hipotermia (<36°C)");
    }

    if (score === 0) return { text: "Pasien Sehat", severity: "NORMAL" };
    
    // Tentukan final severity berdasarkan total poin
    let finalSeverity = "WARNING";
    if (score >= 5) finalSeverity = "CRITICAL";
    else if (score >= 3) finalSeverity = "MAJOR";
    else if (score >= 2) finalSeverity = "MINOR";
    else if (score >= 1) finalSeverity = "WARNING";

    return { text: `${finalSeverity} (${warnings.join(', ')})`, severity: finalSeverity };
}

client.on('connect', () => {
    console.log('✅ Berhasil terhubung ke ThingsBoard Publik!');
  
    setInterval(() => {
        stateTimer++;
        let telemetryData: any = { sessionState: currentState };

        switch (currentState) {
            case 'IDLE':
                telemetryData = {
                    ...telemetryData,
                    heartRate: 0, spo2: 0, bodyTemp: 0, ecg: 0, impactForce: 1.0,
                    isFalling: false,
                    healthStatus: "Menunggu Pasien...",
                    severity: "NORMAL"
                };
                process.stdout.write(`\r[IDLE] Menunggu Pasien... (${stateTimer}/5)   `);

                if (stateTimer >= 5) {
                    currentState = 'WARM_UP';
                    stateTimer = 0;
                    
                    // Urutkan secara bergiliran (Sekuensial)
                    currentProfile = profileSequence[currentProfileIndex] || 'A_SEHAT';
                    currentProfileIndex = (currentProfileIndex + 1) % profileSequence.length;
                    
                    console.log(`\n\n>>> MEMULAI SESI: [${currentProfile}] <<<`);
                }
                break;

            case 'WARM_UP':
                telemetryData = {
                    ...telemetryData,
                    ...getPatientProfileData(currentProfile),
                    heartRate: Math.floor(40 + Math.random() * 100), // Random noise karena tangan baru nempel
                    healthStatus: "Sedang Pemanasan...",
                    severity: "NORMAL"
                };
                process.stdout.write(`\r[WARM_UP] Mengkalibrasi sensor... (${stateTimer}/3)   `);

                if (stateTimer >= 3) {
                    currentState = 'MEASURING';
                    stateTimer = 0;
                    bufferData = [];
                    console.log(); 
                }
                break;

            case 'MEASURING':
                const sensorData = getPatientProfileData(currentProfile);
                bufferData.push(sensorData);
                
                telemetryData = {
                    ...telemetryData,
                    ...sensorData,
                    healthStatus: "Sedang Mengukur...",
                    severity: "NORMAL"
                };
                console.log(`[MEASURING] HR: ${sensorData.heartRate} | Temp: ${sensorData.bodyTemp} | SpO2: ${sensorData.spo2} | SMV: ${sensorData.impactForce}g (${stateTimer}/10)`);

                if (stateTimer >= 10) {
                    currentState = 'CONCLUSION';
                    stateTimer = 0;
                }
                break;

            case 'CONCLUSION':
                const avgData = bufferData.reduce((acc, curr) => {
                    return {
                        heartRate: acc.heartRate + curr.heartRate,
                        spo2: acc.spo2 + curr.spo2,
                        bodyTemp: acc.bodyTemp + curr.bodyTemp,
                        ecg: acc.ecg + curr.ecg,
                        impactForce: acc.impactForce + curr.impactForce,
                        isFalling: acc.isFalling || curr.isFalling
                    };
                });
                
                const count = bufferData.length;
                avgData.heartRate = Math.round(avgData.heartRate / count);
                avgData.spo2 = Math.round(avgData.spo2 / count);
                avgData.bodyTemp = parseFloat((avgData.bodyTemp / count).toFixed(1));
                avgData.ecg = Math.round(avgData.ecg / count);
                avgData.impactForce = parseFloat((avgData.impactForce / count).toFixed(2));

                const conclusion = determineHealthStatus(avgData);

                telemetryData = {
                    ...telemetryData,
                    ...avgData,
                    healthStatus: conclusion.text,
                    severity: conclusion.severity
                };
                
                console.log(`\n[CONCLUSION] Hasil Akhir: ${conclusion.text}\n`);

                currentState = 'IDLE';
                stateTimer = 0;
                break;
        }

        client.publish('v1/devices/me/telemetry', JSON.stringify(telemetryData), { qos: 1 });
    }, 1000);
});

client.on('error', (err) => {
  console.error('❌ Koneksi MQTT gagal:', err);
});