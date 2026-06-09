import { DatabaseSync } from 'node:sqlite';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const dbPath = process.env.DATABASE_PATH || path.join(__dirname, 'drone_quiz.db');
const db = new DatabaseSync(dbPath);

// ── USERS ────────────────────────────────────────────────────────────────────
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    email         TEXT    UNIQUE NOT NULL,
    password_hash TEXT,
    name          TEXT    NOT NULL,
    role          TEXT    DEFAULT 'user',
    google_id     TEXT    UNIQUE,
    avatar_url    TEXT,
    created_at    DATETIME DEFAULT CURRENT_TIMESTAMP
  );
`);

// Add google_id / avatar_url columns if upgrading an older DB that lacks them
try { db.exec(`ALTER TABLE users ADD COLUMN google_id   TEXT UNIQUE`); } catch (_) {}
try { db.exec(`ALTER TABLE users ADD COLUMN avatar_url  TEXT`);        } catch (_) {}
try { db.exec(`ALTER TABLE users ADD COLUMN created_at  DATETIME DEFAULT CURRENT_TIMESTAMP`); } catch (_) {}

// ── QUESTIONS ────────────────────────────────────────────────────────────────
db.exec(`
  CREATE TABLE IF NOT EXISTS questions (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    question_text   TEXT NOT NULL,
    option_a        TEXT NOT NULL,
    option_b        TEXT NOT NULL,
    option_c        TEXT NOT NULL,
    option_d        TEXT NOT NULL,
    correct_option  TEXT NOT NULL,
    category        TEXT NOT NULL
  );
`);

// ── QUIZ ATTEMPTS ────────────────────────────────────────────────────────────
db.exec(`
  CREATE TABLE IF NOT EXISTS quiz_attempts (
    id                  INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id             INTEGER NOT NULL,
    score               INTEGER NOT NULL,
    time_taken_seconds  INTEGER NOT NULL,
    completed_at        DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(user_id) REFERENCES users(id)
  );
`);

// ── QUIZ SESSION (global state: ended flag + question count) ─────────────────
db.exec(`
  CREATE TABLE IF NOT EXISTS quiz_session (
    id              INTEGER PRIMARY KEY CHECK (id = 1),
    is_ended        INTEGER DEFAULT 0,
    question_count  INTEGER DEFAULT 10,
    ended_at        DATETIME
  );
`);

// Ensure exactly one session row exists
const sessionRow = db.prepare('SELECT id FROM quiz_session WHERE id = 1').get();
if (!sessionRow) {
  db.prepare('INSERT INTO quiz_session (id, is_ended, question_count) VALUES (1, 0, 10)').run();
}

// ── SEED QUESTIONS ───────────────────────────────────────────────────────────
const { count } = db.prepare('SELECT COUNT(*) as count FROM questions').get();

if (count === 0) {
  const insertStmt = db.prepare(`
    INSERT INTO questions (question_text, option_a, option_b, option_c, option_d, correct_option, category)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);

  const questions = [
    {
      q: "What is the maximum takeoff weight limit for a drone to be classified as a 'Nano' drone in India?",
      a: "100 grams", b: "250 grams", c: "2 kilograms", d: "25 kilograms",
      ans: "B", cat: "DGCA Regulations"
    },
    {
      q: "Which digital platform is mandated by the Indian government for registering drones and obtaining flight permissions?",
      a: "DigiLocker Portal", b: "AirSewa App", c: "Digital Sky Platform", d: "DroneGate India",
      ans: "C", cat: "DGCA Regulations"
    },
    {
      q: "Is a Remote Pilot Certificate (RPC) required to fly a Nano drone for non-commercial purposes in India?",
      a: "Yes, always required", b: "No, RPC is not required for Nano drones", c: "Only if flying above 100 feet", d: "Yes, if the drone has a camera module",
      ans: "B", cat: "DGCA Regulations"
    },
    {
      q: "In which DGCA airspace zone can drones fly up to 400 feet (120 meters) without requiring prior flight permission?",
      a: "Red Zone", b: "Yellow Zone", c: "Green Zone", d: "Orange Zone",
      ans: "C", cat: "DGCA Regulations"
    },
    {
      q: "What is the weight range for a 'Micro' category drone according to the DGCA Drone Rules 2021?",
      a: "100g to 2kg", b: "250g to 2kg", c: "2kg to 25kg", d: "250g to 5kg",
      ans: "B", cat: "DGCA Regulations"
    },
    {
      q: "A 'Small' category drone has a weight range of:",
      a: "2kg to 25kg", b: "250g to 2kg", c: "25kg to 150kg", d: "2kg to 10kg",
      ans: "A", cat: "DGCA Regulations"
    },
    {
      q: "In the DGCA airspace map, what does a 'Yellow Zone' represent?",
      a: "Uncontrolled airspace where anyone can fly freely", b: "No-fly zone near sensitive government areas", c: "Controlled airspace requiring permission from Air Traffic Control (ATC)", d: "Airspace reserved exclusively for military test flights",
      ans: "C", cat: "DGCA Regulations"
    },
    {
      q: "What is the maximum permissible altitude for flying a drone in a Green Zone in India?",
      a: "400 feet (120 meters)", b: "200 feet (60 meters)", c: "500 feet (150 meters)", d: "1000 feet (300 meters)",
      ans: "A", cat: "DGCA Regulations"
    },
    {
      q: "Which of the following components in a drone is responsible for converting DC battery voltage into 3-phase AC signals to control motor speed?",
      a: "Flight Controller (FC)", b: "Electronic Speed Controller (ESC)", c: "Power Distribution Board (PDB)", d: "Radio Receiver (RX)",
      ans: "B", cat: "Drone Electronics"
    },
    {
      q: "What is the main function of an Inertial Measurement Unit (IMU) inside a flight controller?",
      a: "To measure GPS coordinates", b: "To compute the transmitter signal strength", c: "To measure linear acceleration and angular velocity (attitude)", d: "To regulate battery discharge currents",
      ans: "C", cat: "Drone Electronics"
    },
    {
      q: "What type of battery is most widely used in multirotor drones due to its high discharge rate and energy density?",
      a: "Lithium Polymer (LiPo)", b: "Nickel Metal Hydride (NiMH)", c: "Lead Acid", d: "Alkaline",
      ans: "A", cat: "Drone Electronics"
    },
    {
      q: "What does the 'C-rating' of a LiPo battery indicate?",
      a: "The charging speed of the battery", b: "The maximum continuous discharge rate of the battery", c: "The nominal voltage per cell", d: "The chemical capacity in milliampere-hours",
      ans: "B", cat: "Drone Electronics"
    },
    {
      q: "What does the 'KV' rating of a brushless motor represent?",
      a: "RPM per Volt under no-load conditions", b: "Kilovolts required to power the motor", c: "Kilowatts of power generated by the motor", d: "Kinetic Velocity of the shaft",
      ans: "A", cat: "Aerodynamics & Propulsion"
    },
    {
      q: "If a quadcopter's motor 1 (front-right) spins clockwise, what direction should its diagonally opposite motor 4 (back-left) spin?",
      a: "Clockwise", b: "Counter-Clockwise", c: "Alternating direction", d: "It depends on the propeller pitch",
      ans: "A", cat: "Aerodynamics & Propulsion"
    },
    {
      q: "Which sensor in a drone's flight controller measures atmospheric pressure to estimate relative altitude?",
      a: "Gyrometer", b: "Accelerometer", c: "Barometer", d: "Magnetometer",
      ans: "C", cat: "Drone Electronics"
    },
    {
      q: "A magnetometer (digital compass) is used in drones for which of the following purposes?",
      a: "Measuring altitude above sea level", b: "Determining the heading orientation (direction relative to North)", c: "Detecting metal obstacles nearby", d: "Calibrating the motor speed",
      ans: "B", cat: "Drone Electronics"
    },
    {
      q: "What protocol is commonly used to send flight telemetry and command packets between a drone's flight controller and a ground control station (GCS)?",
      a: "S.BUS", b: "DShot", c: "PWM", d: "MAVLink",
      ans: "D", cat: "Drone Electronics"
    },
    {
      q: "What happens if you mount a propeller upside down on a drone motor?",
      a: "The motor will spin in the reverse direction", b: "The drone will hover normally but consume less power", c: "The motor will spin, but the propeller will produce significantly reduced thrust", d: "The motor will overheat and burn out immediately",
      ans: "C", cat: "Aerodynamics & Propulsion"
    },
    {
      q: "What is the primary function of a 'failsafe' mode in a drone?",
      a: "To automatically return-to-home (RTH) or land if the radio control link is lost", b: "To deploy an emergency parachute when the battery is low", c: "To turn off the motors immediately in mid-air", d: "To erase flight logs to protect proprietary data",
      ans: "A", cat: "Operations & Safety"
    },
    {
      q: "Which of the following is a sign of a damaged or end-of-life LiPo battery that poses a serious fire hazard?",
      a: "The battery feels cold to the touch", b: "The battery cells appear swollen or puffed", c: "The color of the outer wrap changes", d: "The battery charges faster than usual",
      ans: "B", cat: "Operations & Safety"
    },
    {
      q: "What is the total voltage of a fully charged 4S (4-cell in series) LiPo battery?",
      a: "12.0V", b: "14.8V", c: "16.8V", d: "18.4V",
      ans: "C", cat: "Drone Electronics"
    },
    {
      q: "What is the nominal voltage of a standard single LiPo battery cell?",
      a: "3.7V", b: "4.2V", c: "1.2V", d: "5.0V",
      ans: "A", cat: "Drone Electronics"
    },
    {
      q: "What does 'ESC desync' refer to?",
      a: "The radio transmitter losing connection with the receiver", b: "The ESC losing synchronization with the brushless motor's magnetic poles, causing motor stuttering", c: "The ESC failing to match the voltage of the battery cells", d: "The ESC and flight controller running different firmware versions",
      ans: "B", cat: "Drone Electronics"
    },
    {
      q: "Which control input on the transmitter controls the drone's rotation around its vertical axis?",
      a: "Roll", b: "Pitch", c: "Yaw", d: "Throttle",
      ans: "C", cat: "Aerodynamics & Propulsion"
    },
    {
      q: "Which control input controls the drone's tilt forward and backward?",
      a: "Pitch", b: "Roll", c: "Yaw", d: "Throttle",
      ans: "A", cat: "Aerodynamics & Propulsion"
    },
    {
      q: "Which control input controls the drone's tilt left and right?",
      a: "Roll", b: "Pitch", c: "Yaw", d: "Throttle",
      ans: "A", cat: "Aerodynamics & Propulsion"
    },
    {
      q: "What is the purpose of PID tuning in a flight controller?",
      a: "To regulate the voltage supply to the receiver", b: "To pair the receiver with the radio transmitter", c: "To configure the failsafe battery threshold", d: "To adjust the responsiveness and stabilization loop coefficients for stable flight",
      ans: "D", cat: "Drone Electronics"
    },
    {
      q: "Which of the following is NOT a component of a standard Inertial Measurement Unit (IMU)?",
      a: "GPS Receiver", b: "Gyroscope", c: "Accelerometer", d: "Temperature Sensor",
      ans: "A", cat: "Drone Electronics"
    },
    {
      q: "In drone communication, what does 'RSSI' stand for?",
      a: "Radio Signal System Interface", b: "Received Signal Strength Indicator", c: "Receiver Signal Speed Index", d: "Rotational Speed Sensor Interface",
      ans: "B", cat: "Drone Electronics"
    },
    {
      q: "What is a major advantage of using a 4-in-1 ESC rather than four individual ESCs?",
      a: "It eliminates the need for a flight controller", b: "It guarantees that the drone cannot experience motor desync", c: "It reduces wiring complexity, weight, and saves space in the drone frame", d: "It allows the drone to run on alternating current (AC) batteries",
      ans: "C", cat: "Drone Electronics"
    },
    {
      q: "What type of camera sensor is commonly used on agricultural drones to assess crop health and vegetation indices?",
      a: "Thermal imaging camera", b: "LiDAR scanner", c: "Standard RGB camera", d: "Multispectral camera",
      ans: "D", cat: "Operations & Safety"
    },
    {
      q: "What range of radio frequency is most commonly used for RC pilot control link signals?",
      a: "2.4 GHz", b: "5.8 GHz", c: "1.2 GHz", d: "900 MHz",
      ans: "A", cat: "Drone Electronics"
    },
    {
      q: "What range of radio frequency is most commonly used for real-time analog FPV video transmissions?",
      a: "2.4 GHz", b: "5.8 GHz", c: "433 MHz", d: "10.4 GHz",
      ans: "B", cat: "Drone Electronics"
    },
    {
      q: "What does the term 'UIN' stand for in DGCA drone registrations in India?",
      a: "Universal Identification Number", b: "Unmanned Instrument Network", c: "Unique Identification Number", d: "User Integration Node",
      ans: "C", cat: "DGCA Regulations"
    },
    {
      q: "Which of the following drone categories requires a type certification from DGCA before legal flight operation in India?",
      a: "Micro drone (flying for commercial use)", b: "Nano drone (flying under 50 feet)", c: "Model aircraft under 250g", d: "Custom toy drones under 100g",
      ans: "A", cat: "DGCA Regulations"
    },
    {
      q: "Which algorithm is commonly used in flight controllers to combine accelerometer and gyroscope data to compute stable orientation?",
      a: "Binary Search", b: "Dijkstra's Algorithm", c: "Fourier Transform", d: "Kalman Filter (or complementary filter)",
      ans: "D", cat: "Drone Electronics"
    },
    {
      q: "What is the primary aerodynamic force that opposes the weight of a drone during hover?",
      a: "Lift", b: "Drag", c: "Thrust", d: "Torque",
      ans: "A", cat: "Aerodynamics & Propulsion"
    },
    {
      q: "What occurs when the angle of attack of a drone propeller blade becomes too steep relative to the incoming airflow?",
      a: "The drone speed increases exponentially", b: "Aerodynamic stall, causing a sudden loss of lift and increased drag", c: "The motor automatically reverses direction", d: "The battery stops discharging",
      ans: "B", cat: "Aerodynamics & Propulsion"
    },
    {
      q: "Why are brushless motors used instead of brushed motors in most professional and hobbyist multirotor drones?",
      a: "Brushed motors are too heavy to lift themselves", b: "Brushless motors require no Electronic Speed Controllers (ESCs)", c: "Brushless motors are more efficient, have higher power-to-weight ratios, and have longer lifespans", d: "Brushless motors only spin in one direction, preventing pilot error",
      ans: "C", cat: "Aerodynamics & Propulsion"
    },
    {
      q: "What is the absolute safety threshold voltage per cell below which a LiPo battery cell should never be discharged?",
      a: "3.7V", b: "3.0V", c: "4.2V", d: "2.0V",
      ans: "B", cat: "Operations & Safety"
    },
    {
      q: "Which sensor helps a drone hover precisely in place when GPS signal is unavailable indoors?",
      a: "Barometer", b: "Magnetometer", c: "Optical Flow Sensor", d: "Thermocouple",
      ans: "C", cat: "Drone Electronics"
    },
    {
      q: "What is the function of a telemetry transceiver on a drone?",
      a: "To transmit real-time flight telemetry (voltage, height, speed) to a ground station", b: "To charge the battery wirelessly in mid-air", c: "To record video onto an onboard SD card", d: "To control the propeller pitch directly",
      ans: "A", cat: "Drone Electronics"
    },
    {
      q: "What does 'PPM' stand for in receiver-to-flight controller communication protocol?",
      a: "Pulse Phase Modulation", b: "Pulse Position Modulation", c: "Power Position Monitor", d: "Proportional Pulse Management",
      ans: "B", cat: "Drone Electronics"
    },
    {
      q: "Which of the following is a high-speed digital serial receiver protocol widely used to connect RC receivers to flight controllers?",
      a: "PWM", b: "PPM", c: "S.BUS", d: "CAN Bus",
      ans: "C", cat: "Drone Electronics"
    },
    {
      q: "What is the main advantage of using carbon fiber as the primary material for drone frames?",
      a: "It is extremely flexible and absorbs crashes by bending", b: "It is cheaper than plastic and wood", c: "It blocks radio signals to prevent interference", d: "It is highly rigid and offers an exceptional strength-to-weight ratio",
      ans: "D", cat: "Aerodynamics & Propulsion"
    },
    {
      q: "In India, what is the weight limit classification for a 'Medium' category drone?",
      a: "25kg to 150kg", b: "2kg to 25kg", c: "150kg to 500kg", d: "Over 500kg",
      ans: "A", cat: "DGCA Regulations"
    },
    {
      q: "What is the acronym used for flying a drone beyond the pilot's direct visual line of sight?",
      a: "VLOS", b: "BVLOS", c: "FPV", d: "RTH",
      ans: "B", cat: "Operations & Safety"
    }
  ];

  for (const q of questions) {
    insertStmt.run(q.q, q.a, q.b, q.c, q.d, q.ans, q.cat);
  }
  console.log(`Seeded ${questions.length} drone quiz questions.`);
} else {
  console.log('Database already has questions. Seeding skipped.');
}

export default db;
