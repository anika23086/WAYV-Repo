// ============================================================
// WAYV Glove Firmware — Motor-Sequence Learning Mode
// ============================================================
// Hardware: Arduino Nano, 6 flex sensors, 6 vibration motors,
//           1 piezo buzzer, 1 LED
//
// Finger mapping (1-indexed):
//   Finger 1 → Flex A5, Motor pin 7  → Note C
//   Finger 2 → Flex A4, Motor pin 6  → Note D
//   Finger 3 → Flex A3, Motor pin 5  → Note E
//   Finger 4 → Flex A2, Motor pin 4  → Note F
//   Finger 5 → Flex A1, Motor pin 3  → Note G
//   Finger 6 → Flex A0, Motor pin 2  → Note A
//
// Serial protocol (9600 baud, newline-terminated):
//   OUTPUT → F<n>  = finger n bent,  R<n> = finger n released
//   INPUT  → V<n>  = vibrate finger n (300ms)
//            V<n>:<ms> = vibrate finger n for <ms> milliseconds
//            X     = stop all motors
//            S<n1>,<n2>,...:<delay> = haptic sequence
// ============================================================

// ── Pin Definitions ──────────────────────────────────────────
#define adc1 A5   // Flex sensor 1 (Finger 1 / Note C)
#define adc2 A4   // Flex sensor 2 (Finger 2 / Note D)
#define adc3 A3   // Flex sensor 3 (Finger 3 / Note E)
#define adc4 A2   // Flex sensor 4 (Finger 4 / Note F)
#define adc5 A1   // Flex sensor 5 (Finger 5 / Note G)
#define adc6 A0   // Flex sensor 6 (Finger 6 / Note A)

#define m1 7      // Vibration motor 1 (Finger 1)
#define m2 6      // Vibration motor 2 (Finger 2)
#define m3 5      // Vibration motor 3 (Finger 3)
#define m4 4      // Vibration motor 4 (Finger 4)
#define m5 3      // Vibration motor 5 (Finger 5)
#define m6 2      // Vibration motor 6 (Finger 6)

#define buzzer 11 // Piezo buzzer (startup confirmation only)
#define ledd   13 // Status LED

// ── Thresholds & Timing ─────────────────────────────────────
#define BEND_THRESHOLD    700   // ADC value above which = finger bent
#define RELEASE_THRESHOLD 600   // ADC value below which = finger released
#define DEBOUNCE_MS        50   // Ignore state changes within this window
#define DEFAULT_VIBE_MS   300   // Default single-vibration duration
#define LOOP_DELAY_MS      10   // Main loop iteration pause

// ── Finger State Arrays ─────────────────────────────────────
// Lookup tables map finger index (0-5) to hardware pins.
const int adcPins[6]   = { adc1, adc2, adc3, adc4, adc5, adc6 };
const int motorPins[6] = { m1,   m2,   m3,   m4,   m5,   m6   };

// Per-finger tracking: current state and last-change timestamp
bool fingerBent[6]           = { false, false, false, false, false, false };
unsigned long lastChange[6]  = { 0, 0, 0, 0, 0, 0 };

// ── Helper: Vibrate a Single Finger ─────────────────────────
// Activates the motor on the given pin for `duration` ms, then
// turns it off.  Blocking — used for V and S commands.
void vibrateFinger(int pin, int duration) {
  digitalWrite(pin, HIGH);
  delay(duration);
  digitalWrite(pin, LOW);
}

// ── Helper: Stop All Motors ─────────────────────────────────
void stopAllMotors() {
  for (int i = 0; i < 6; i++) {
    digitalWrite(motorPins[i], LOW);
  }
}

// ── Command Parser ──────────────────────────────────────────
// Reads one newline-terminated command from serial and executes
// it.  Supported commands:
//   V<n>        — vibrate finger n for 300 ms
//   V<n>:<ms>   — vibrate finger n for <ms> ms
//   X           — stop all motors immediately
//   S<f1>,<f2>,...:<delay> — haptic sequence
void processSerialCommand() {
  if (!Serial.available()) return;

  String cmd = Serial.readStringUntil('\n');
  cmd.trim();  // Strip any trailing \r or whitespace

  if (cmd.length() == 0) return;

  char type = cmd.charAt(0);

  // ── V command: vibrate one finger ───────────────────────
  if (type == 'V') {
    // Find optional colon for custom duration
    int colonIdx = cmd.indexOf(':');
    int fingerNum;
    int duration = DEFAULT_VIBE_MS;

    if (colonIdx > 0) {
      // Format: V<n>:<ms>
      fingerNum = cmd.substring(1, colonIdx).toInt();
      duration  = cmd.substring(colonIdx + 1).toInt();
    } else {
      // Format: V<n>
      fingerNum = cmd.substring(1).toInt();
    }

    // Validate finger number (1-6)
    if (fingerNum >= 1 && fingerNum <= 6) {
      if (fingerNum == 5 && colonIdx <= 0) duration = 600; // Temp boost for G finger
      vibrateFinger(motorPins[fingerNum - 1], duration);
    }
  }

  // ── X command: kill all motors ──────────────────────────
  else if (type == 'X') {
    stopAllMotors();
  }

  // ── S command: haptic sequence ──────────────────────────
  // Format: S<f1>,<f2>,<f3>:<delay>
  // Example: S1,2,3:800  → vibe 1 (300ms), wait 800ms,
  //          vibe 2 (300ms), wait 800ms, vibe 3 (300ms)
  else if (type == 'S') {
    // Split at colon to separate finger list from delay
    int colonIdx = cmd.indexOf(':');
    if (colonIdx < 0) return;  // Malformed — ignore

    String fingerList = cmd.substring(1, colonIdx);   // e.g. "1,2,3"
    int pauseMs       = cmd.substring(colonIdx + 1).toInt();

    // Walk through the comma-separated finger numbers
    int startPos = 0;
    while (startPos <= (int)fingerList.length()) {
      int commaIdx = fingerList.indexOf(',', startPos);
      String token;

      if (commaIdx < 0) {
        // Last (or only) token
        token = fingerList.substring(startPos);
        startPos = fingerList.length() + 1;  // Exit after this
      } else {
        token = fingerList.substring(startPos, commaIdx);
        startPos = commaIdx + 1;
      }

      int fingerNum = token.toInt();
      if (fingerNum >= 1 && fingerNum <= 6) {
        int duration = (fingerNum == 5) ? 600 : DEFAULT_VIBE_MS; // Temp boost for G finger
        vibrateFinger(motorPins[fingerNum - 1], duration);

        int actualPause = pauseMs - (duration - DEFAULT_VIBE_MS);
        if (actualPause < 0) actualPause = 0;

        // Add inter-note pause unless this was the last finger
        if (startPos <= (int)fingerList.length()) {
          delay(actualPause);
        }
      }
    }
  }
}

// ── Flex Sensor Reader & State Machine ──────────────────────
// For each of the 6 fingers:
//   • Read ADC value
//   • Apply hysteresis (bend > 700, release < 600)
//   • Debounce (ignore changes within 50 ms)
//   • On state change, send F<n> (bent) or R<n> (released)
void readFlexSensors() {
  unsigned long now = millis();

  for (int i = 0; i < 6; i++) {
    int reading = analogRead(adcPins[i]);

    if (!fingerBent[i] && reading > BEND_THRESHOLD) {
      // Finger just bent — check debounce window
      if ((now - lastChange[i]) >= DEBOUNCE_MS) {
        fingerBent[i] = true;
        lastChange[i] = now;
        // Send bend event: F1 through F6 (1-indexed)
        Serial.print('F');
        Serial.println(i + 1);
      }
    }
    else if (fingerBent[i] && reading < RELEASE_THRESHOLD) {
      // Finger just released — check debounce window
      if ((now - lastChange[i]) >= DEBOUNCE_MS) {
        fingerBent[i] = false;
        lastChange[i] = now;
        // Send release event: R1 through R6 (1-indexed)
        Serial.print('R');
        Serial.println(i + 1);
      }
    }
    // If reading is between thresholds, do nothing (hysteresis band)
  }
}

// ── Setup ───────────────────────────────────────────────────
void setup() {
  // Configure motor pins as outputs
  for (int i = 0; i < 6; i++) {
    pinMode(motorPins[i], OUTPUT);
    digitalWrite(motorPins[i], LOW);
  }

  // Configure buzzer and LED
  pinMode(buzzer, OUTPUT);
  pinMode(ledd, OUTPUT);

  // Startup confirmation: short buzz + LED on
  digitalWrite(buzzer, HIGH);
  delay(200);
  digitalWrite(buzzer, LOW);
  digitalWrite(ledd, HIGH);

  // Open serial communication at 9600 baud
  Serial.begin(9600);
}

// ── Main Loop ───────────────────────────────────────────────
// 1. Process any incoming serial commands (V, X, S)
// 2. Read flex sensors and report state changes (F/R)
// 3. Brief pause to avoid flooding
void loop() {
  processSerialCommand();
  readFlexSensors();
  delay(LOOP_DELAY_MS);
}