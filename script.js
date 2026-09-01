// ═══════════════════════════════════════════════════════════════════════
//  ADAPTIVE MULTIMODAL MOTOR LEARNING TUTOR
//  A UIST-style research prototype for investigating modality-specific
//  motor skill acquisition and adaptive tutoring.
// ═══════════════════════════════════════════════════════════════════════

// ─── CONSTANTS & INSTRUMENT CONFIGURATIONS ─────────────────────────
const TARGET_NOTE_DURATION = 400; // ms — how long each note plays during presentation
const TARGET_NOTE_GAP = 400;      // ms — silence between notes during presentation
const TARGET_INTER_NOTE = TARGET_NOTE_DURATION + TARGET_NOTE_GAP; // 800ms total per note
const INPUT_TIMEOUT = 10000;      // ms — max wait for user input before auto-evaluate
const MAX_ATTEMPTS = 3;           // max attempts per sequence

// Configurable stable hold duration for recorder note triggering (ms)
const RECORDER_STABLE_HOLD_MS = 250;
const RECORDER_SYNCHRONY_WINDOW_MS = 150;

// Piano (Instrument 1) Specifications
const PIANO_FINGER_NOTES = { 1: 'C', 2: 'D', 3: 'E', 4: 'F', 5: 'G', 6: 'A' };
const PIANO_NOTE_FREQUENCIES = { 1: 261.63, 2: 293.66, 3: 329.63, 4: 349.23, 5: 392.00, 6: 440.00 };

const PIANO_SEQUENCES = {
    level1: [
        [1, 2, 3],       // C → D → E
        [1, 4, 6],       // C → F → A
        [2, 4, 6],       // D → F → A
    ],
    level2: [
        [1, 3, 2, 1],    // C → E → D → C
        [2, 4, 3, 2],    // D → F → E → D
        [1, 4, 3, 6],    // C → F → E → A
    ],
    level3: [
        [1, 2, 3, 4, 6, 4],  // C → D → E → F → A → F
        [6, 4, 3, 2, 1, 3],  // A → F → E → D → C → E
        [1, 3, 6, 4, 2, 1],  // C → E → A → F → D → C
    ],
    trainingTarget: [1, 3, 2, 6, 4] // C → E → D → A → F
};

// Recorder (Instrument 2) Specifications
// Hardware Mapping (6 flex sensors):
// Hand   Finger         Hole Position           Sensor/Hardware ID
// Left   Index (L1)     Hole 1 (top)            4
// Left   Middle (L2)    Hole 2                  5
// Left   Ring (L3)      Hole 3                  6
// Right  Index (R1)     Hole 4                  3
// Right  Middle (R2)    Hole 5                  2
// Right  Ring (R3)      Hole 6 (bottom)         1
const RECORDER_NOTE_FREQUENCIES = {
    'C': 261.63,
    'D': 293.66,
    'E': 329.63,
    'F': 349.23,
    'G': 392.00,
    'A': 440.00
};

// Recorder 6-hole diatonic fingering vectors: [L1, L2, L3, R1, R2, R3] (1 = curled/covered, 0 = extended/open)
const RECORDER_NOTE_FINGERS = {
    'C': [1, 1, 1, 1, 1, 1], // all 6 curled
    'D': [1, 1, 1, 1, 1, 0], // R3 extended
    'E': [1, 1, 1, 1, 0, 0], // R2, R3 extended
    'F': [1, 1, 1, 0, 0, 0], // R1, R2, R3 extended
    'G': [1, 1, 0, 0, 0, 0], // L3, R1, R2, R3 extended
    'A': [1, 0, 0, 0, 0, 0], // L2, L3, R1, R2, R3 extended
};

// Covered hardware sensor IDs per recorder note for haptic actuation
const RECORDER_NOTE_HARDWARE_FINGERS = {
    'C': [4, 5, 6, 3, 2, 1],
    'D': [4, 5, 6, 3, 2],
    'E': [4, 5, 6, 3],
    'F': [4, 5, 6],
    'G': [4, 5],
    'A': [4],
};

const RECORDER_SEQUENCES = {
    level1: [
        ['C'],
        ['A'],
        ['F'],
    ],
    level2: [
        ['C', 'E'],
        ['D', 'F', 'E'],
        ['A', 'D'],
        ['G', 'C', 'E'],
    ],
    level3: [
        ['C', 'F', 'A', 'D', 'G']
    ],
    trainingTarget: ['C', 'F', 'A', 'D', 'G']
};

// Aliases for backward-compatibility with existing piano references
const FINGER_NOTES = PIANO_FINGER_NOTES;
const NOTE_FREQUENCIES = PIANO_NOTE_FREQUENCIES;
const SEQUENCES = PIANO_SEQUENCES;

// Profiling plans
const PROFILING_LEVELS = ['level1', 'level1', 'level2'];
const PROFILING_SEQ_INDICES = [0, 1, 0];

// Latin Square for counterbalancing modality order
const MODALITY_ORDERS = [
    ['visual', 'audio', 'haptic', 'visual-haptic'],
    ['audio', 'visual-haptic', 'visual', 'haptic'],
    ['haptic', 'visual', 'visual-haptic', 'audio'],
    ['visual-haptic', 'haptic', 'audio', 'visual'],
];

// Profiling weights
const PROFILING_WEIGHTS = { accuracy: 0.50, responseTime: 0.25, errorRate: 0.25 };


// ═══════════════════════════════════════════════════════════════════════
//  MODULE 1: SerialManager — Web Serial API communication
// ═══════════════════════════════════════════════════════════════════════
class SerialManager {
    constructor() {
        this.port = null;
        this.writer = null;
        this.reader = null;
        this.isConnected = false;
        this.readBuffer = '';

        // Callbacks
        this.onFingerBend = null;   // (fingerNumber, timestamp) => {}
        this.onFingerRelease = null; // (fingerNumber, timestamp) => {}
        this.onConnectionChange = null; // (isConnected) => {}
        this.onRawData = null;       // (msg) => {}
    }

    async connect() {
        if (!('serial' in navigator)) {
            throw new Error('Web Serial API not supported. Please use Chrome or Edge.');
        }
        try {
            this.port = await navigator.serial.requestPort();
            await this.port.open({ baudRate: 9600 });
            this.writer = this.port.writable.getWriter();
            this.reader = this.port.readable.getReader();
            this.isConnected = true;
            if (this.onConnectionChange) this.onConnectionChange(true);
            this._readLoop();
            return true;
        } catch (error) {
            console.error('Serial connection failed:', error);
            throw error;
        }
    }

    async disconnect() {
        try {
            if (this.reader) { await this.reader.cancel(); this.reader.releaseLock(); }
            if (this.writer) { this.writer.releaseLock(); }
            if (this.port) { await this.port.close(); }
        } catch (e) {
            console.log('Serial cleanup:', e);
        }
        this.port = null;
        this.writer = null;
        this.reader = null;
        this.isConnected = false;
        if (this.onConnectionChange) this.onConnectionChange(false);
    }

    async send(data) {
        if (!this.writer) return;
        try {
            const encoder = new TextEncoder();
            await this.writer.write(encoder.encode(data + '\n'));
        } catch (error) {
            console.error('Serial write error:', error);
        }
    }

    async vibrateSequence(fingers, delayMs) {
        // Send the S command: S1,2,3:500 (since Arduino's DEFAULT_VIBE_MS is 300, 300+500 = 800ms start-to-start)
        const pauseMs = Math.max(0, delayMs - 300);
        const cmd = `S${fingers.join(',')}:${pauseMs}`;
        await this.send(cmd);
    }

    async vibrateFinger(finger, durationMs = 300) {
        await this.send(`V${finger}:${durationMs}`);
    }

    async vibrateFingers(fingers, durationMs = 300) {
        if (!fingers || fingers.length === 0) return;
        const cmd = `P${fingers.join(',')}:${durationMs}`;
        await this.send(cmd);
    }

    async stopAllMotors() {
        await this.send('X');
    }

    async _readLoop() {
        const decoder = new TextDecoder();
        try {
            while (true) {
                const { value, done } = await this.reader.read();
                if (done) break;
                this.readBuffer += decoder.decode(value);

                // Process complete messages (newline-terminated)
                let lines = this.readBuffer.split('\n');
                this.readBuffer = lines.pop(); // Keep incomplete line in buffer
                for (const line of lines) {
                    const msg = line.trim();
                    if (!msg) continue;
                    if (this.onRawData) this.onRawData(msg);
                    this._parseMessage(msg);
                }
            }
        } catch (error) {
            if (this.isConnected) {
                console.error('Serial read error:', error);
                this.isConnected = false;
                if (this.onConnectionChange) this.onConnectionChange(false);
            }
        }
    }

    _parseMessage(msg) {
        const timestamp = Date.now();
        if (msg.startsWith('F') && msg.length >= 2) {
            const finger = parseInt(msg.charAt(1));
            if (finger >= 1 && finger <= 6 && this.onFingerBend) {
                this.onFingerBend(finger, timestamp);
            }
        } else if (msg.startsWith('R') && msg.length >= 2) {
            const finger = parseInt(msg.charAt(1));
            if (finger >= 1 && finger <= 6 && this.onFingerRelease) {
                this.onFingerRelease(finger, timestamp);
            }
        }
    }
}


// ═══════════════════════════════════════════════════════════════════════
//  MODULE 2: AudioEngine — Web Audio API for note playback
// ═══════════════════════════════════════════════════════════════════════
class AudioEngine {
    constructor() {
        this.ctx = null;
        this.masterGain = null;
    }

    _ensureContext() {
        if (!this.ctx) {
            this.ctx = new (window.AudioContext || window.webkitAudioContext)();
            this.masterGain = this.ctx.createGain();
            this.masterGain.gain.value = 0.3;
            this.masterGain.connect(this.ctx.destination);
        }
        if (this.ctx.state === 'suspended') {
            this.ctx.resume();
        }
    }

    /**
     * Play a single note for the given finger or note name.
     * @param {number|string} noteOrFinger - Finger number (1-6) or note name ('C','D','E','F','G','A')
     * @param {number} durationMs - Duration in milliseconds
     * @returns {Promise} resolves when the note finishes
     */
    playNote(noteOrFinger, durationMs = TARGET_NOTE_DURATION) {
        return new Promise(resolve => {
            this._ensureContext();
            const isRecorder = (typeof noteOrFinger === 'string' && isNaN(parseInt(noteOrFinger))) || 
                               (typeof noteOrFinger === 'string' && ['C','D','E','F','G','A'].includes(noteOrFinger.toUpperCase()));
            
            let freq = null;
            if (typeof noteOrFinger === 'number') {
                freq = PIANO_NOTE_FREQUENCIES[noteOrFinger];
            } else if (typeof noteOrFinger === 'string') {
                freq = RECORDER_NOTE_FREQUENCIES[noteOrFinger.toUpperCase()] || PIANO_NOTE_FREQUENCIES[parseInt(noteOrFinger)];
            }
            if (!freq) { resolve(); return; }

            const now = this.ctx.currentTime;
            const dur = durationMs / 1000;

            if (isRecorder) {
                // ── Acoustic Woodwind / Soprano Recorder Model ──
                // Master note gain node
                const noteGain = this.ctx.createGain();
                noteGain.gain.setValueAtTime(0, now);
                // Soft breath attack
                noteGain.gain.linearRampToValueAtTime(0.85, now + 0.045);
                // Steady air column sustain
                noteGain.gain.setValueAtTime(0.80, now + dur - 0.06);
                // Natural breath release
                noteGain.gain.linearRampToValueAtTime(0, now + dur);

                // Body resonance formant filter (wooden bore acoustic cavity)
                const bodyFilter = this.ctx.createBiquadFilter();
                bodyFilter.type = 'bandpass';
                bodyFilter.frequency.setValueAtTime(Math.min(freq * 2.2, 2200), now);
                bodyFilter.Q.setValueAtTime(1.5, now);

                // 1. Fundamental oscillator
                const oscFund = this.ctx.createOscillator();
                oscFund.type = 'sine';
                oscFund.frequency.setValueAtTime(freq, now);

                // 2. 2nd Harmonic (gentle air vibration)
                const oscH2 = this.ctx.createOscillator();
                const gainH2 = this.ctx.createGain();
                oscH2.type = 'sine';
                oscH2.frequency.setValueAtTime(freq * 2, now);
                gainH2.gain.setValueAtTime(0.18, now);
                oscH2.connect(gainH2);

                // 3. 3rd Harmonic (characteristic recorder hollow woodwind overtone)
                const oscH3 = this.ctx.createOscillator();
                const gainH3 = this.ctx.createGain();
                oscH3.type = 'triangle';
                oscH3.frequency.setValueAtTime(freq * 3, now);
                gainH3.gain.setValueAtTime(0.28, now);
                oscH3.connect(gainH3);

                // 4. Subtle natural breath vibrato LFO
                const lfo = this.ctx.createOscillator();
                const lfoGain = this.ctx.createGain();
                lfo.frequency.setValueAtTime(5.2, now); // 5.2 Hz natural human vibrato
                lfoGain.gain.setValueAtTime(0, now);
                lfoGain.gain.setValueAtTime(0, now + 0.08);
                lfoGain.gain.linearRampToValueAtTime(freq * 0.012, now + 0.2); // ~1.2% pitch fluctuation
                lfo.connect(lfoGain);
                lfoGain.connect(oscFund.frequency);
                lfoGain.connect(oscH2.frequency);
                lfoGain.connect(oscH3.frequency);

                // 5. Breath Turbulence Chiff (air blowing over labium edge)
                const bufferSize = this.ctx.sampleRate * 0.06; // 60ms noise chiff
                const noiseBuffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
                const output = noiseBuffer.getChannelData(0);
                for (let i = 0; i < bufferSize; i++) {
                    output[i] = Math.random() * 2 - 1;
                }
                const noiseSource = this.ctx.createBufferSource();
                noiseSource.buffer = noiseBuffer;

                const noiseFilter = this.ctx.createBiquadFilter();
                noiseFilter.type = 'bandpass';
                noiseFilter.frequency.setValueAtTime(freq * 2.5, now);
                noiseFilter.Q.setValueAtTime(3.0, now);

                const noiseGain = this.ctx.createGain();
                noiseGain.gain.setValueAtTime(0.35, now);
                noiseGain.gain.exponentialRampToValueAtTime(0.001, now + 0.055);

                noiseSource.connect(noiseFilter);
                noiseFilter.connect(noiseGain);
                noiseGain.connect(noteGain);

                // Connect harmonics into body filter and out to master
                oscFund.connect(noteGain);
                gainH2.connect(noteGain);
                gainH3.connect(noteGain);
                noteGain.connect(bodyFilter);
                bodyFilter.connect(this.masterGain);

                // Start all sound nodes
                oscFund.start(now);
                oscH2.start(now);
                oscH3.start(now);
                lfo.start(now);
                noiseSource.start(now);

                // Stop all sound nodes
                oscFund.stop(now + dur);
                oscH2.stop(now + dur);
                oscH3.stop(now + dur);
                lfo.stop(now + dur);

                oscFund.onended = () => resolve();
            } else {
                // ── Piano / Hammered String Model ──
                const osc = this.ctx.createOscillator();
                const gainNode = this.ctx.createGain();

                osc.type = 'sine';
                osc.frequency.setValueAtTime(freq, now);

                // ADSR envelope for piano struck string
                gainNode.gain.setValueAtTime(0, now);
                gainNode.gain.linearRampToValueAtTime(0.8, now + 0.02);    // Attack: 20ms
                gainNode.gain.linearRampToValueAtTime(0.6, now + 0.08);    // Decay: 60ms
                gainNode.gain.setValueAtTime(0.6, now + dur - 0.05);       // Sustain
                gainNode.gain.linearRampToValueAtTime(0, now + dur);       // Release: 50ms

                osc.connect(gainNode);
                gainNode.connect(this.masterGain);
                osc.start(now);
                osc.stop(now + dur);
                osc.onended = () => { resolve(); };
            }
        });
    }

    /**
     * Play a sequence of notes with gaps between them.
     * @param {Array<number|string>} notes - Array of finger numbers or note names
     * @param {number} noteDuration - Duration of each note in ms
     * @param {number} gapDuration - Gap between notes in ms
     * @returns {Promise} resolves when the full sequence finishes
     */
    async playSequence(notes, noteDuration = TARGET_NOTE_DURATION, gapDuration = TARGET_NOTE_GAP) {
        for (let i = 0; i < notes.length; i++) {
            await this.playNote(notes[i], noteDuration);
            if (i < notes.length - 1) {
                await new Promise(r => setTimeout(r, gapDuration));
            }
        }
    }

    /**
     * Play a short feedback chime.
     * @param {boolean} correct - true for success, false for error
     */
    playFeedback(correct) {
        this._ensureContext();
        const now = this.ctx.currentTime;
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();

        if (correct) {
            // Rising major chord
            osc.type = 'sine';
            osc.frequency.setValueAtTime(523.25, now);       // C5
            osc.frequency.setValueAtTime(659.25, now + 0.1); // E5
        } else {
            // Descending minor
            osc.type = 'triangle';
            osc.frequency.setValueAtTime(330, now);
            osc.frequency.setValueAtTime(262, now + 0.1);
        }

        gain.gain.setValueAtTime(0.3, now);
        gain.gain.linearRampToValueAtTime(0, now + 0.25);

        osc.connect(gain);
        gain.connect(this.masterGain);
        osc.start(now);
        osc.stop(now + 0.25);
    }
}


// ═══════════════════════════════════════════════════════════════════════
//  MODULE 3: ModalityEngine — Visual / Audio / Haptic presenters
// ═══════════════════════════════════════════════════════════════════════
class ModalityEngine {
    constructor(audioEngine, serialManager) {
        this.audio = audioEngine;
        this.serial = serialManager;
        this.onFingerBendHook = null;
    }

    _getNoteLabel(item) {
        return typeof item === 'number' ? (FINGER_NOTES[item] || item) : item;
    }

    waitForFingerBend(targetFinger, timeoutMs = 8000) {
        return new Promise((resolve) => {
            let timer = null;
            const handler = (finger) => {
                if (finger === targetFinger) {
                    cleanup();
                    resolve(true);
                }
            };

            const cleanup = () => {
                if (timer) clearTimeout(timer);
                if (this.onFingerBendHook === handler) {
                    this.onFingerBendHook = null;
                }
            };

            this.onFingerBendHook = handler;

            timer = setTimeout(() => {
                cleanup();
                resolve(false);
            }, timeoutMs);
        });
    }

    /**
     * Present a sequence using the specified modality.
     * @param {'visual'|'audio'|'haptic'|'visual-haptic'} modality
     * @param {Array<number|string>} sequence - Finger numbers or note names
     * @param {string} displayId - ID of the sequence display container
     * @param {string} instructionId - ID of the instruction text element
     * @param {string} instrument - 'piano' or 'recorder'
     * @returns {Promise} resolves when presentation is complete
     */
    async presentSequence(modality, sequence, displayId, instructionId, instrument = 'piano') {
        const display = document.getElementById(displayId);
        const instruction = document.getElementById(instructionId);

        switch (modality) {
            case 'visual':
                return this._presentVisual(sequence, display, instruction);
            case 'audio':
                return this._presentAudio(sequence, display, instruction);
            case 'haptic':
                return this._presentHaptic(sequence, display, instruction, instrument);
            case 'visual-haptic':
                return this._presentVisualHaptic(sequence, display, instruction, instrument);
        }
    }

    async _presentVisual(sequence, display, instruction) {
        instruction.textContent = 'Watch the sequence, then reproduce it.';

        // Build note elements
        display.innerHTML = '';
        const noteEls = [];
        sequence.forEach((item, i) => {
            const noteEl = document.createElement('span');
            noteEl.className = 'sequence-note';
            noteEl.textContent = this._getNoteLabel(item);
            noteEl.id = `${display.id}-note-${i}`;
            display.appendChild(noteEl);
            noteEls.push(noteEl);

            if (i < sequence.length - 1) {
                const arrow = document.createElement('span');
                arrow.className = 'sequence-arrow';
                arrow.textContent = '→';
                display.appendChild(arrow);
            }
        });

        // Animate through: highlight each note in tempo, play its tone
        for (let i = 0; i < noteEls.length; i++) {
            noteEls[i].classList.add('highlight');
            await this.audio.playNote(sequence[i], TARGET_NOTE_DURATION);
            await new Promise(r => setTimeout(r, TARGET_NOTE_GAP));
            noteEls[i].classList.remove('highlight');
            noteEls[i].classList.add('played');
        }

        instruction.textContent = 'Now reproduce the sequence!';
    }

    async _presentAudio(sequence, display, instruction) {
        instruction.textContent = 'Listen carefully, then reproduce the sequence.';
        display.innerHTML = '<span class="text-muted" style="font-size:1.5rem;">🔊 Listen...</span>';

        await this.audio.playSequence(sequence, TARGET_NOTE_DURATION, TARGET_NOTE_GAP);

        display.innerHTML = '<span class="text-muted" style="font-size:1.2rem;">Now reproduce what you heard!</span>';
        instruction.textContent = 'Reproduce the sequence from memory.';
    }

    async _presentHaptic(sequence, display, instruction, instrument = 'piano') {
        if (instrument === 'recorder') {
            return this._presentInteractiveRecorderHaptic(sequence, display, instruction, false);
        }

        instruction.textContent = 'Feel the vibration pattern, then reproduce the sequence.';
        display.innerHTML = '<span class="text-muted" style="font-size:1.5rem;">✋ Feel the pattern...</span>';

        const totalDuration = (sequence.length - 1) * TARGET_INTER_NOTE + 300;
        if (this.serial.isConnected) {
            await this.serial.vibrateSequence(sequence, TARGET_INTER_NOTE);
            await new Promise(r => setTimeout(r, totalDuration));
        } else {
            await new Promise(r => setTimeout(r, totalDuration));
        }

        display.innerHTML = '<span class="text-muted" style="font-size:1.2rem;">Now reproduce what you felt!</span>';
        instruction.textContent = 'Reproduce the sequence from memory.';
    }

    async _presentVisualHaptic(sequence, display, instruction, instrument = 'piano') {
        if (instrument === 'recorder') {
            return this._presentInteractiveRecorderHaptic(sequence, display, instruction, true);
        }

        instruction.textContent = 'Watch the screen and feel the vibration pattern, then reproduce it.';

        display.innerHTML = '';
        const noteEls = [];
        sequence.forEach((item, i) => {
            const noteEl = document.createElement('span');
            noteEl.className = 'sequence-note';
            noteEl.textContent = this._getNoteLabel(item);
            noteEl.id = `${display.id}-note-${i}`;
            display.appendChild(noteEl);
            noteEls.push(noteEl);

            if (i < sequence.length - 1) {
                const arrow = document.createElement('span');
                arrow.className = 'sequence-arrow';
                arrow.textContent = '→';
                display.appendChild(arrow);
            }
        });

        // Highlight notes on screen in tempo AND trigger vibration on glove
        for (let i = 0; i < noteEls.length; i++) {
            noteEls[i].classList.add('highlight');
            if (this.serial.isConnected) {
                this.serial.vibrateFinger(sequence[i], TARGET_NOTE_DURATION);
            }
            await this.audio.playNote(sequence[i], TARGET_NOTE_DURATION);
            await new Promise(r => setTimeout(r, TARGET_NOTE_DURATION + TARGET_NOTE_GAP));
            noteEls[i].classList.remove('highlight');
            noteEls[i].classList.add('played');
        }

        instruction.textContent = 'Now reproduce the sequence!';
    }

    async _presentInteractiveRecorderHaptic(sequence, display, instruction, isVisualHaptic = false) {
        const FINGER_LABELS = {
            4: 'L1 (Left Index)',
            5: 'L2 (Left Middle)',
            6: 'L3 (Left Ring)',
            3: 'R1 (Right Index)',
            2: 'R2 (Right Middle)',
            1: 'R3 (Right Ring)'
        };

        instruction.textContent = 'Follow the vibrations: bend each finger as it buzzes!';

        display.innerHTML = '';
        const noteEls = [];
        sequence.forEach((item, i) => {
            const noteEl = document.createElement('span');
            noteEl.className = 'sequence-note';
            noteEl.textContent = this._getNoteLabel(item);
            noteEl.id = `${display.id}-note-${i}`;
            if (!isVisualHaptic) {
                noteEl.style.opacity = '0.4'; // Dim in pure haptic mode to avoid visual cueing
            }
            display.appendChild(noteEl);
            noteEls.push(noteEl);

            if (i < sequence.length - 1) {
                const arrow = document.createElement('span');
                arrow.className = 'sequence-arrow';
                arrow.textContent = '→';
                display.appendChild(arrow);
            }
        });

        for (let i = 0; i < sequence.length; i++) {
            const note = sequence[i];
            const activeFingers = RECORDER_NOTE_HARDWARE_FINGERS[note] || [];

            noteEls[i].classList.add('highlight');
            noteEls[i].style.opacity = '1';

            // Step through each required finger one by one
            for (let fIdx = 0; fIdx < activeFingers.length; fIdx++) {
                const finger = activeFingers[fIdx];
                const label = FINGER_LABELS[finger] || `Finger ${finger}`;

                instruction.textContent = `▶ Note ${note}: Buzzing ${label} — Bend this finger now!`;

                // Buzz the target finger
                if (this.serial.isConnected) {
                    await this.serial.vibrateFinger(finger, 300);
                }

                // If device connected, wait for user to physically bend this finger
                if (this.serial.isConnected) {
                    let bent = false;
                    for (let retry = 0; retry < 3 && !bent; retry++) {
                        bent = await this.waitForFingerBend(finger, 2500);
                        if (!bent && retry < 2 && this.serial.isConnected) {
                            await this.serial.vibrateFinger(finger, 200);
                        }
                    }
                } else {
                    // Fallback simulation when device not connected
                    await new Promise(r => setTimeout(r, 650));
                }
            }

            // All fingers for this note are bent! Play the acoustic sample
            instruction.textContent = `✅ Note ${note} formed! Listen to the tone...`;
            await this.audio.playNote(note, 450);
            await new Promise(r => setTimeout(r, 450));

            noteEls[i].classList.remove('highlight');
            noteEls[i].classList.add('played');
        }

        instruction.textContent = 'Now reproduce what you felt on your fingers!';
    }

    /**
     * Build static sequence display (for visual reference during input).
     */
    buildSequenceDisplay(sequence, displayId) {
        const display = document.getElementById(displayId);
        if (!display) return;
        display.innerHTML = '';
        sequence.forEach((item, i) => {
            const noteEl = document.createElement('span');
            noteEl.className = 'sequence-note';
            noteEl.textContent = this._getNoteLabel(item);
            noteEl.id = `${display.id}-note-${i}`;
            display.appendChild(noteEl);

            if (i < sequence.length - 1) {
                const arrow = document.createElement('span');
                arrow.className = 'sequence-arrow';
                arrow.textContent = '→';
                display.appendChild(arrow);
            }
        });
    }
}


// ═══════════════════════════════════════════════════════════════════════
//  MODULE 3.5: RecorderOnsetDetector — Multi-finger synchrony window
// ═══════════════════════════════════════════════════════════════════════
class RecorderOnsetDetector {
    constructor(stableHoldMs = RECORDER_STABLE_HOLD_MS) {
        this.stableHoldMs = stableHoldMs;
        this.fingerState = [0, 0, 0, 0, 0, 0]; // [L1, L2, L3, R1, R2, R3]
        this.lastChangeTimes = [0, 0, 0, 0, 0, 0];
        this.holdTimeout = null;
        this.holdInterval = null;
        this.holdStartTime = 0;
        this.onNoteDetected = null;
        this.onStateChange = null; // Callback for live UI preview & hold progress
        this.activeTransitionChanges = [];
        this.isActive = false;
        this.lastCommittedNote = null;
        this.isHoldingCandidate = null;
    }

    hardwareFingerToHoleIndex(finger) {
        const map = {
            4: 0, // L1 (Hole 1)
            5: 1, // L2 (Hole 2)
            6: 2, // L3 (Hole 3)
            3: 3, // R1 (Hole 4)
            2: 4, // R2 (Hole 5)
            1: 5  // R3 (Hole 6)
        };
        return map[finger] !== undefined ? map[finger] : (finger - 1);
    }

    reset() {
        if (this.holdTimeout) clearTimeout(this.holdTimeout);
        if (this.holdInterval) clearInterval(this.holdInterval);
        this.holdTimeout = null;
        this.holdInterval = null;
        this.activeTransitionChanges = [];
        this.lastCommittedNote = null;
        this.isHoldingCandidate = null;
        this._notifyStateChange(null, 0);
    }

    handleFingerChange(finger, isBent, timestamp) {
        const holeIdx = this.hardwareFingerToHoleIndex(finger);
        const oldState = this.fingerState[holeIdx];
        const newState = isBent ? 1 : 0;

        if (oldState !== newState) {
            this.fingerState[holeIdx] = newState;
            this.lastChangeTimes[holeIdx] = timestamp;
            this.activeTransitionChanges.push({ holeIdx, timestamp, state: newState });
        }

        // Cancel any pending hold timer when finger state changes
        if (this.holdTimeout) {
            clearTimeout(this.holdTimeout);
            this.holdTimeout = null;
        }
        if (this.holdInterval) {
            clearInterval(this.holdInterval);
            this.holdInterval = null;
        }

        if (!this.isActive) return;

        // Check if the current finger state corresponds to a valid recorder note
        const currentVector = [...this.fingerState];
        const matchedNote = this._getHierarchicalNoteMatch(currentVector);

        if (!matchedNote) {
            // Open hand [0,0,0,0,0,0] or non-matching transition shape
            if (currentVector.every(v => v === 0)) {
                this.lastCommittedNote = null;
            }
            this.isHoldingCandidate = null;
            this._notifyStateChange(null, 0);
            return;
        }

        // If this note is already committed and user didn't change fingering, keep stable UI
        if (matchedNote === this.lastCommittedNote) {
            this._notifyStateChange(matchedNote, 100);
            return;
        }

        // Start stable hold timer for this candidate note
        this.isHoldingCandidate = matchedNote;
        this.holdStartTime = Date.now();
        const candidateVector = [...currentVector];
        const transitionTimes = this.activeTransitionChanges.map(c => c.timestamp);
        const spread = transitionTimes.length > 1 ? (Math.max(...transitionTimes) - Math.min(...transitionTimes)) : 0;

        this._notifyStateChange(matchedNote, 10);

        this.holdInterval = setInterval(() => {
            const elapsed = Date.now() - this.holdStartTime;
            const pct = Math.min(95, Math.round((elapsed / this.stableHoldMs) * 100));
            this._notifyStateChange(matchedNote, pct);
        }, 20);

        this.holdTimeout = setTimeout(() => {
            if (this.holdInterval) clearInterval(this.holdInterval);
            this.holdInterval = null;
            this._notifyStateChange(matchedNote, 100);
            this._commitNoteEvent(matchedNote, candidateVector, timestamp, spread);
        }, this.stableHoldMs);
    }

    _notifyStateChange(noteName, progressPct) {
        if (this.onStateChange) {
            const holeNames = ['L1', 'L2', 'L3', 'R1', 'R2', 'R3'];
            const active = this.fingerState
                .map((v, i) => v === 1 ? holeNames[i] : null)
                .filter(Boolean);

            this.onStateChange({
                vector: [...this.fingerState],
                activeFingers: active,
                noteName: noteName,
                progressPct: progressPct
            });
        }
    }

    /**
     * Noise-tolerant hierarchical diatonic woodwind matcher.
     * Matches based on progressive top-down hole closure starting at Hole 1 (L1),
     * tolerating resting noise on lower open holes.
     */
    _getHierarchicalNoteMatch(vector) {
        // If all 6 holes are open, no note
        if (vector.every(v => v === 0)) return null;

        // In recorder acoustics, Hole 1 (L1) must be closed to produce standard diatonic notes
        if (vector[0] !== 1) return null;

        // Count consecutive closed holes from top down [L1, L2, L3, R1, R2, R3]
        let consecutiveClosed = 0;
        for (let i = 0; i < 6; i++) {
            if (vector[i] === 1) {
                consecutiveClosed++;
            } else {
                break; // Stop at first open tone hole
            }
        }

        switch (consecutiveClosed) {
            case 6: return 'C'; // All 6 covered
            case 5: return 'D'; // L1, L2, L3, R1, R2 covered (R3 open)
            case 4: return 'E'; // L1, L2, L3, R1 covered (R2, R3 open)
            case 3: return 'F'; // L1, L2, L3 covered (Right hand open)
            case 2: return 'G'; // L1, L2 covered (L3, Right hand open)
            case 1: return 'A'; // L1 covered (L2..R3 open)
            default: return null;
        }
    }

    _commitNoteEvent(noteName, vector, timestamp, spreadMs) {
        this.lastCommittedNote = noteName;
        this.activeTransitionChanges = [];
        this.holdTimeout = null;

        const noteEvent = {
            note: noteName,
            noteName: noteName,
            fingers: vector,
            timestamp: Date.now(),
            spreadMs: spreadMs
        };

        if (this.onNoteDetected) {
            this.onNoteDetected(noteEvent);
        }
    }
}


// ═══════════════════════════════════════════════════════════════════════
//  MODULE 4: DataCollector — Relational Data Access Layer & Storage
// ═══════════════════════════════════════════════════════════════════════
class DataCollector {
    constructor() {
        this.participantData = null;
    }

    /**
     * Initialize a new participant record.
     */
    createParticipant(participantId, group, experience, dominantHand, expectedModality, instrument = 'piano', windExperience = 'none') {
        this.participantData = {
            participantId,
            instrument: instrument || 'piano',
            priorExperience: experience || 'none',
            priorWindExperience: windExperience || 'none',
            dominantHand: dominantHand || 'right',
            expectedModality: expectedModality || 'unsure',
            experimentalGroup: group,
            profilingOrder: [],
            session1Date: new Date().toISOString(),
            session2Date: null,
            modalityScores: {},
            selfSelectedModality: null,
            systemSelectedModality: null,
            activeModality: null,
            session1Trials: [],
            session2Trials: [],
            retentionScores: null,
            studyComplete: false,
            notes: '',
        };
        this._save();
        return this.participantData;
    }

    /**
     * Load an existing participant from localStorage across active, archived, or pilot keys.
     * @returns {object|null} participant data or null if not found
     */
    loadParticipant(participantId) {
        const prefixes = ['amlt_data_', 'amlt_archive_', 'amlt_pilot_'];
        for (const prefix of prefixes) {
            const key = `${prefix}${participantId}`;
            const data = localStorage.getItem(key);
            if (data) {
                try {
                    this.participantData = JSON.parse(data);
                    return this.participantData;
                } catch (e) {}
            }
        }
        return null;
    }

    /**
     * Scan localStorage for participant records based on study type.
     * @param {'main'|'archive'|'pilot'} studyType
     */
    getAllParticipants(studyType = 'main') {
        const list = [];
        let targetPrefix = 'amlt_data_';
        if (studyType === 'pilot') targetPrefix = 'amlt_pilot_';
        else if (studyType === 'archive') targetPrefix = 'amlt_archive_';
        
        for (let i = 0; i < localStorage.length; i++) {
            const key = localStorage.key(i);
            if (key && key.startsWith(targetPrefix)) {
                try {
                    const data = JSON.parse(localStorage.getItem(key));
                    if (data && data.participantId) {
                        list.push(data);
                    }
                } catch (e) {
                    console.error("Error reading participant data", e);
                }
            }
        }
        // Sort alphabetically/numerically by participant ID
        return list.sort((a, b) => {
            const idA = String(a.participantId || '');
            const idB = String(b.participantId || '');
            return idA.localeCompare(idB, undefined, {numeric: true, sensitivity: 'base'});
        });
    }

    /**
     * Migrate pilot data (recorded before July 6, 2026) to amlt_pilot_ prefix.
     */
    migratePilotData() {
        const cutoffDate = new Date('2026-07-06T00:00:00Z');
        for (let i = 0; i < localStorage.length; i++) {
            const key = localStorage.key(i);
            if (key && key.startsWith('amlt_data_')) {
                try {
                    const data = JSON.parse(localStorage.getItem(key));
                    if (data && data.session1Date) {
                        if (new Date(data.session1Date) < cutoffDate) {
                            const newKey = `amlt_pilot_${data.participantId}`;
                            localStorage.setItem(newKey, JSON.stringify(data));
                            localStorage.removeItem(key);
                            i--; // adjust index since we removed a key
                        }
                    }
                } catch (e) {}
            }
        }
    }

    /**
     * Archive previous study run data so new participant IDs start clean from P01.
     */
    archivePreviousStudyData() {
        if (localStorage.getItem('amlt_archive_migration_done_v2') === 'true') return;

        const keysToArchive = [];
        for (let i = 0; i < localStorage.length; i++) {
            const key = localStorage.key(i);
            if (key && key.startsWith('amlt_data_')) {
                keysToArchive.push(key);
            }
        }

        keysToArchive.forEach(key => {
            try {
                const data = JSON.parse(localStorage.getItem(key));
                if (data && data.participantId) {
                    const archiveKey = `amlt_archive_${data.participantId}`;
                    localStorage.setItem(archiveKey, JSON.stringify(data));
                    localStorage.removeItem(key);
                }
            } catch (e) {}
        });

        localStorage.setItem('amlt_archive_migration_done_v2', 'true');
    }

    /**
     * Rename current main study participants to P01, P02, etc. sequentially.
     */
    renameMainStudyParticipants() {
        if (localStorage.getItem('amlt_rename_migration_done') === 'true') return;

        const keysToMigrate = [];
        for (let i = 0; i < localStorage.length; i++) {
            const key = localStorage.key(i);
            if (key && key.startsWith('amlt_data_')) {
                keysToMigrate.push(key);
            }
        }

        const participants = [];
        keysToMigrate.forEach(key => {
            try {
                const data = JSON.parse(localStorage.getItem(key));
                if (data && data.participantId) {
                    participants.push({ key, data });
                }
            } catch(e) {}
        });

        // Sort by session date so the oldest participant gets P01
        participants.sort((a, b) => new Date(a.data.session1Date) - new Date(b.data.session1Date));

        let counter = 1;
        participants.forEach(p => {
            const newId = `P${String(counter).padStart(2, '0')}`;
            p.data.participantId = newId;
            
            if (p.data.session1Trials) {
                p.data.session1Trials.forEach(t => t.participantId = newId);
            }
            if (p.data.session2Trials) {
                p.data.session2Trials.forEach(t => t.participantId = newId);
            }

            const newKey = `amlt_data_${newId}`;
            localStorage.setItem(newKey, JSON.stringify(p.data));
            
            if (p.key !== newKey) {
                localStorage.removeItem(p.key);
            }
            counter++;
        });

        localStorage.setItem('amlt_rename_migration_done', 'true');
    }

    /**
     * Update participant custom notes across active, archive, and pilot records.
     */
    updateParticipantNotes(participantId, notes) {
        const prefixes = ['amlt_data_', 'amlt_archive_', 'amlt_pilot_'];
        for (const prefix of prefixes) {
            const key = `${prefix}${participantId}`;
            const dataStr = localStorage.getItem(key);
            if (dataStr) {
                try {
                    const data = JSON.parse(dataStr);
                    data.notes = notes;
                    localStorage.setItem(key, JSON.stringify(data));
                    if (this.participantData && this.participantData.participantId === participantId) {
                        this.participantData.notes = notes;
                    }
                    break;
                } catch (e) {}
            }
        }
    }

    /**
     * Delete a single participant record.
     */
    deleteParticipant(participantId) {
        localStorage.removeItem(`amlt_data_${participantId}`);
        localStorage.removeItem(`amlt_archive_${participantId}`);
        localStorage.removeItem(`amlt_pilot_${participantId}`);
        if (this.participantData && this.participantData.participantId === participantId) {
            this.participantData = null;
        }
    }

    /**
     * Restore participant data from a JSON backup file.
     * @param {object} data - Parsed JSON data
     */
    restoreFromBackup(data) {
        this.participantData = data;
        this._save();
        return this.participantData;
    }

    /**
     * Record a single trial attempt (relational schema).
     */
    recordTrial(trialData) {
        if (!this.participantData) return;

        const trial = {
            trialId: `T${Date.now()}`,
            participantId: this.participantData.participantId,
            instrument: trialData.instrument || this.participantData.instrument || 'piano',
            sessionNumber: trialData.sessionNumber || 1,
            sessionId: trialData.sessionId || this.participantData.session1Date,
            timestamp: new Date().toISOString(),
            phase: trialData.phase, // 'profiling', 'training', 'retention'
            experimentalGroup: this.participantData.experimentalGroup,
            modality: trialData.modality,
            level: trialData.level,
            targetSequence: trialData.targetSequence,
            userSequence: trialData.userSequence,
            orderAccuracy: trialData.orderAccuracy,
            timingAccuracy: trialData.timingAccuracy,
            combinedScore: trialData.combinedScore,
            passed: trialData.passed !== undefined ? trialData.passed : (trialData.combinedScore >= 0.70),
            responseTimeMs: trialData.responseTimeMs,
            completionTimeMs: trialData.completionTimeMs,
            targetInterNoteTiming: TARGET_INTER_NOTE,
            userInterNoteTimings: trialData.userInterNoteTimings || [],
            errors: trialData.errors,
            attemptsOnThisSequence: trialData.attemptsOnThisSequence,
            fingerTimestamps: trialData.fingerTimestamps || [],
            synchronySpreads: trialData.synchronySpreads || [],
        };

        if (trialData.sessionNumber === 2) {
            this.participantData.session2Trials.push(trial);
        } else {
            this.participantData.session1Trials.push(trial);
        }

        this._save();
        return trial;
    }

    /**
     * Store profiling scores for modalities.
     */
    setModalityScores(scores) {
        if (!this.participantData) return;
        this.participantData.modalityScores = scores;
        this._save();
    }

    /**
     * Store modality selection.
     */
    setModalitySelection(selfSelected, systemSelected, active) {
        if (!this.participantData) return;
        this.participantData.selfSelectedModality = selfSelected;
        this.participantData.systemSelectedModality = systemSelected;
        this.participantData.activeModality = active;
        this._save();
    }

    /**
     * Mark Session 2 start.
     */
    startSession2() {
        if (!this.participantData) return;
        this.participantData.session2Date = new Date().toISOString();
        this._save();
    }

    /**
     * Store final retention scores and mark study as complete.
     */
    setRetentionScores(scores) {
        if (!this.participantData) return;
        this.participantData.retentionScores = scores;
        this.participantData.studyComplete = true;
        this._save();
    }

    /**
     * Export trial-level CSV for this participant.
     */
    exportTrialCSV() {
        if (!this.participantData) return;
        const allTrials = [...(this.participantData.session1Trials || []), ...(this.participantData.session2Trials || [])];
        if (allTrials.length === 0) { alert('No trial data to export.'); return; }

        let csv = 'ParticipantID,Instrument,DominantHand,Session,Group,Phase,Modality,Level,SequenceTarget,SequenceActual,' +
                  'OrderAccuracy,TimingAccuracy,CombinedScore,Passed,ResponseTimeMs,CompletionTimeMs,' +
                  'TargetTempo,UserTimings,Errors,Attempt,SynchronySpreads\r\n';

        allTrials.forEach(t => {
            const seqTarget = Array.isArray(t.targetSequence) ? t.targetSequence.join('-') : t.targetSequence;
            const seqActual = Array.isArray(t.userSequence) ? t.userSequence.join('-') : t.userSequence;
            const syncSpreads = (t.synchronySpreads && t.synchronySpreads.length > 0) ? t.synchronySpreads.join('-') : 'N/A';
            csv += `${t.participantId},${t.instrument || 'piano'},${this.participantData.dominantHand || 'right'},${t.sessionNumber},${t.experimentalGroup},${t.phase},` +
                   `${t.modality},${t.level},"${seqTarget}","${seqActual}",` +
                   `${t.orderAccuracy.toFixed(3)},${t.timingAccuracy.toFixed(3)},${t.combinedScore.toFixed(3)},${t.passed ? 1 : 0},` +
                   `${t.responseTimeMs},${t.completionTimeMs},${t.targetInterNoteTiming},` +
                   `"${t.userInterNoteTimings.map(t => t.toFixed(0)).join('-')}",${t.errors},${t.attemptsOnThisSequence},"${syncSpreads}"\r\n`;
        });

        this._downloadFile(csv, `amlt_${this.participantData.participantId}_trials.csv`, 'text/csv');
    }

    /**
     * Export participant-level summary CSV for this participant.
     */
    exportSummaryCSV() {
        if (!this.participantData) return;
        const p = this.participantData;
        const ms = p.modalityScores || {};

        const trainingTrials = (p.session1Trials || []).filter(t => t.phase === 'training');
        const avgTrainOrder = trainingTrials.length > 0 ? trainingTrials.reduce((s, t) => s + t.orderAccuracy, 0) / trainingTrials.length : 0;
        const avgTrainTiming = trainingTrials.length > 0 ? trainingTrials.reduce((s, t) => s + t.timingAccuracy, 0) / trainingTrials.length : 0;
        const avgTrainCombined = trainingTrials.length > 0 ? trainingTrials.reduce((s, t) => s + t.combinedScore, 0) / trainingTrials.length : 0;

        let daysBetween = 0;
        if (p.session1Date && p.session2Date) {
            daysBetween = Math.round((new Date(p.session2Date) - new Date(p.session1Date)) / (1000 * 60 * 60 * 24));
        }

        let csv = 'ParticipantID,Instrument,DominantHand,Group,VisualScore,AudioScore,HapticScore,VisualHapticScore,' +
                  'SelfSelected,SystemSelected,ActiveModality,AdaptationTriggered,' +
                  'TrainingAvgOrderAcc,TrainingAvgTimingAcc,TrainingAvgCombined,' +
                  'RetentionOrderAcc,RetentionTimingAcc,RetentionCombined,DaysBetweenSessions\r\n';

        csv += `${p.participantId},${p.instrument || 'piano'},${p.dominantHand || 'right'},${p.experimentalGroup},` +
               `${ms.visual?.composite || 0},${ms.audio?.composite || 0},${ms.haptic?.composite || 0},${ms['visual-haptic']?.composite || 0},` +
               `${p.selfSelectedModality || 'N/A'},${p.systemSelectedModality || 'N/A'},${p.activeModality || 'N/A'},${p.adaptationTriggered ? 'Yes' : 'No'},` +
               `${avgTrainOrder.toFixed(3)},${avgTrainTiming.toFixed(3)},${avgTrainCombined.toFixed(3)},` +
               `${p.retentionScores?.orderAccuracy?.toFixed(3) || 0},${p.retentionScores?.timingAccuracy?.toFixed(3) || 0},` +
               `${p.retentionScores?.combined?.toFixed(3) || 0},${daysBetween}\r\n`;

        this._downloadFile(csv, `amlt_${p.participantId}_summary.csv`, 'text/csv');
    }

    /**
     * Export master trial-level CSV for ALL participants.
     */
    exportMasterTrialCSV(studyType = 'main') {
        const participants = this.getAllParticipants(studyType);
        if (participants.length === 0) { alert('No participant data found.'); return; }

        let csv = 'ParticipantID,Instrument,ExpectedModality,Experience,WindExperience,DominantHand,Session,Group,Phase,Modality,Level,SequenceTarget,SequenceActual,' +
                  'OrderAccuracy,TimingAccuracy,CombinedScore,Passed,ResponseTimeMs,CompletionTimeMs,' +
                  'TargetTempo,Errors,Attempt,SynchronySpreads\r\n';

        participants.forEach(p => {
            const allTrials = [...(p.session1Trials || []), ...(p.session2Trials || [])];
            allTrials.forEach(t => {
                const seqTarget = Array.isArray(t.targetSequence) ? t.targetSequence.join('-') : t.targetSequence;
                const seqActual = Array.isArray(t.userSequence) ? t.userSequence.join('-') : t.userSequence;
                const syncSpreads = (t.synchronySpreads && t.synchronySpreads.length > 0) ? t.synchronySpreads.join('-') : 'N/A';
                
                csv += `${p.participantId},${p.instrument || 'piano'},${p.expectedModality || 'unsure'},${p.priorExperience || 'none'},${p.priorWindExperience || 'none'},${p.dominantHand || 'right'},${t.sessionNumber},${p.experimentalGroup},${t.phase},` +
                       `${t.modality},${t.level},"${seqTarget}","${seqActual}",` +
                       `${t.orderAccuracy.toFixed(3)},${t.timingAccuracy.toFixed(3)},${t.combinedScore.toFixed(3)},${t.passed ? 1 : 0},` +
                       `${t.responseTimeMs},${t.completionTimeMs},${t.targetInterNoteTiming},` +
                       `${t.errors},${t.attemptsOnThisSequence},"${syncSpreads}"\r\n`;
            });
        });

        this._downloadFile(csv, `amlt_${studyType}_master_trials.csv`, 'text/csv');
    }

    /**
     * Export master summary CSV for ALL participants.
     */
    exportMasterSummaryCSV(studyType = 'main') {
        const participants = this.getAllParticipants(studyType);
        if (participants.length === 0) { alert('No participant data found.'); return; }

        let csv = 'ParticipantID,Instrument,ExpectedModality,Experience,WindExperience,DominantHand,Group,VisualScore,AudioScore,HapticScore,VisualHapticScore,' +
                  'SelfSelected,SystemSelected,ActiveModality,AdaptationTriggered,' +
                  'TrainingAvgOrderAcc,TrainingAvgTimingAcc,TrainingAvgCombined,' +
                  'RetentionOrderAcc,RetentionTimingAcc,RetentionCombined,DaysBetweenSessions,Notes\r\n';

        participants.forEach(p => {
            const ms = p.modalityScores || {};
            const trainingTrials = (p.session1Trials || []).filter(t => t.phase === 'training');
            const avgTrainOrder = trainingTrials.length > 0 ? trainingTrials.reduce((s, t) => s + t.orderAccuracy, 0) / trainingTrials.length : 0;
            const avgTrainTiming = trainingTrials.length > 0 ? trainingTrials.reduce((s, t) => s + t.timingAccuracy, 0) / trainingTrials.length : 0;
            const avgTrainCombined = trainingTrials.length > 0 ? trainingTrials.reduce((s, t) => s + t.combinedScore, 0) / trainingTrials.length : 0;

            let daysBetween = 0;
            if (p.session1Date && p.session2Date) {
                daysBetween = Math.round((new Date(p.session2Date) - new Date(p.session1Date)) / (1000 * 60 * 60 * 24));
            }

            const sanitizedNotes = (p.notes || '').replace(/"/g, '""').replace(/\r?\n/g, ' ');

            csv += `${p.participantId},${p.instrument || 'piano'},${p.expectedModality || 'unsure'},${p.priorExperience || 'none'},${p.priorWindExperience || 'none'},${p.dominantHand || 'right'},${p.experimentalGroup},` +
                   `${ms.visual?.composite || 0},${ms.audio?.composite || 0},${ms.haptic?.composite || 0},${ms['visual-haptic']?.composite || 0},` +
                   `${p.selfSelectedModality || 'N/A'},${p.systemSelectedModality || 'N/A'},${p.activeModality || 'N/A'},${p.adaptationTriggered ? 'Yes' : 'No'},` +
                   `${avgTrainOrder.toFixed(3)},${avgTrainTiming.toFixed(3)},${avgTrainCombined.toFixed(3)},` +
                   `${p.retentionScores?.orderAccuracy?.toFixed(3) || 0},${p.retentionScores?.timingAccuracy?.toFixed(3) || 0},` +
                   `${p.retentionScores?.combined?.toFixed(3) || 0},${daysBetween},"${sanitizedNotes}"\r\n`;
        });

        this._downloadFile(csv, `amlt_${studyType}_master_summary.csv`, 'text/csv');
    }

    /**
     * Export full JSON backup for this participant.
     */
    exportJSON(filename) {
        if (!this.participantData) return;
        const json = JSON.stringify(this.participantData, null, 2);
        const fn = filename || `amlt_${this.participantData.participantId}_backup.json`;
        this._downloadFile(json, fn, 'application/json');
    }

    /**
     * Sync data to Google Sheets webhook url.
     */
    async syncToGoogleSheets(p) {
        const webhookUrl = localStorage.getItem('amlt_webhook_url');
        if (!webhookUrl) {
            console.log('No Google Sheets Webhook configured.');
            return;
        }

        const ms = p.modalityScores || {};
        const trainingTrials = (p.session1Trials || []).filter(t => t.phase === 'training');
        const avgTrainOrder = trainingTrials.length > 0 ? trainingTrials.reduce((s, t) => s + t.orderAccuracy, 0) / trainingTrials.length : 0;
        const avgTrainTiming = trainingTrials.length > 0 ? trainingTrials.reduce((s, t) => s + t.timingAccuracy, 0) / trainingTrials.length : 0;
        const avgTrainCombined = trainingTrials.length > 0 ? trainingTrials.reduce((s, t) => s + t.combinedScore, 0) / trainingTrials.length : 0;

        let daysBetween = 0;
        if (p.session1Date && p.session2Date) {
            daysBetween = Math.round((new Date(p.session2Date) - new Date(p.session1Date)) / (1000 * 60 * 60 * 24));
        }

        const payload = {
            participantId: p.participantId,
            instrument: p.instrument || 'piano',
            name: p.name || 'N/A',
            age: p.age || 'N/A',
            priorExperience: p.priorExperience || 'none',
            priorWindExperience: p.priorWindExperience || 'none',
            dominantHand: p.dominantHand || 'right',
            experimentalGroup: p.experimentalGroup,
            modalityScores: {
                visual: ms.visual?.composite || 0,
                audio: ms.audio?.composite || 0,
                haptic: ms.haptic?.composite || 0,
                visualHaptic: ms['visual-haptic']?.composite || 0,
                best: ms.bestModality || 'N/A'
            },
            selection: {
                selfSelected: p.selfSelectedModality || 'N/A',
                systemSelected: p.systemSelectedModality || 'N/A',
                active: p.activeModality || 'N/A',
                adaptationTriggered: p.adaptationTriggered || false
            },
            training: {
                avgOrderAccuracy: avgTrainOrder,
                avgTimingAccuracy: avgTrainTiming,
                avgCombinedScore: avgTrainCombined,
                trialsCount: trainingTrials.length
            },
            retention: {
                orderAccuracy: p.retentionScores?.orderAccuracy || 0,
                timingAccuracy: p.retentionScores?.timingAccuracy || 0,
                combined: p.retentionScores?.combined || 0,
                daysBetween: daysBetween
            },
            notes: p.notes || '',
            timestamp: new Date().toISOString()
        };

        try {
            console.log('Sending sync payload to Google Sheets webhook...', payload);
            await fetch(webhookUrl, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                mode: 'no-cors',
                body: JSON.stringify(payload)
            });
            console.log('Webhook push completed.');
        } catch (e) {
            console.error('Failed to sync to Google Sheets webhook:', e);
        }
    }

    _save() {
        if (!this.participantData) return;
        const key = `amlt_data_${this.participantData.participantId}`;
        localStorage.setItem(key, JSON.stringify(this.participantData));
    }

    _downloadFile(content, filename, mimeType) {
        const blob = new Blob([content], { type: mimeType });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = filename;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
    }
}


// ═══════════════════════════════════════════════════════════════════════
//  MODULE 5: Scoring — Generalized Acc_order, Acc_timing, Combined Score
// ═══════════════════════════════════════════════════════════════════════

/**
 * Compute note-level match score (1/6 * sum(matches) for recorder, binary 0 or 1 for piano).
 */
function computeNoteMatch(targetNote, userNote, instrument = 'piano') {
    if (instrument === 'piano') {
        return targetNote === userNote ? 1.0 : 0.0;
    }

    const targetFingers = Array.isArray(targetNote) ? targetNote : RECORDER_NOTE_FINGERS[targetNote];
    const userFingers = Array.isArray(userNote)
        ? userNote
        : (RECORDER_NOTE_FINGERS[userNote] || (userNote?.fingers ? userNote.fingers : null));

    if (!targetFingers || !userFingers) {
        return (targetNote === userNote) ? 1.0 : 0.0;
    }

    let matches = 0;
    for (let i = 0; i < 6; i++) {
        if (targetFingers[i] === userFingers[i]) {
            matches++;
        }
    }
    return matches / 6.0;
}

/**
 * Generalized scoring function for both Piano and Recorder.
 * For Piano: mathematically identical to legacy LCS.
 * For Recorder: fractional match score per note with LCS-style alignment.
 * @param {Array} target - Expected sequence
 * @param {Array} user - User's performed sequence
 * @param {number[]} timestamps - Timestamps (ms) for each user input
 * @param {string} instrument - 'piano' or 'recorder'
 * @param {number} targetInterNote - Target interval in ms
 * @returns {{ orderAccuracy, timingAccuracy, combinedScore, errors, interNoteTimings }}
 */
function scoreAttempt(target, user, timestamps, instrument = 'piano', targetInterNote = TARGET_INTER_NOTE) {
    const m = target.length;
    const n = user.length;

    // Alignment matrix using fractional note match
    const dp = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
    for (let i = 1; i <= m; i++) {
        for (let j = 1; j <= n; j++) {
            const userItem = user[j - 1];
            const targetItem = target[i - 1];
            const matchScore = computeNoteMatch(targetItem, userItem, instrument);
            
            dp[i][j] = Math.max(
                dp[i - 1][j],
                dp[i][j - 1],
                dp[i - 1][j - 1] + matchScore
            );
        }
    }

    const maxAlignmentScore = m > 0 ? dp[m][n] : 0;
    const orderAccuracy = m > 0 ? maxAlignmentScore / m : 0;

    // Errors calculation
    let errors = 0;
    for (let i = 0; i < Math.min(m, n); i++) {
        const match = computeNoteMatch(target[i], user[i], instrument);
        if (match < 1.0) errors++;
    }
    errors += Math.abs(m - n);

    // Timing Accuracy (identical logic)
    let timingAccuracy = 0;
    const interNoteTimings = [];
    if (timestamps.length >= 2) {
        const timingScores = [];
        for (let i = 1; i < timestamps.length; i++) {
            const actualGap = timestamps[i] - timestamps[i - 1];
            interNoteTimings.push(actualGap);
            const deviation = Math.abs(actualGap - targetInterNote) / targetInterNote;
            timingScores.push(Math.max(0, 1 - deviation));
        }
        timingAccuracy = timingScores.reduce((s, v) => s + v, 0) / timingScores.length;
    }

    // Combined score: 60% order, 40% timing
    const combinedScore = 0.60 * orderAccuracy + 0.40 * timingAccuracy;

    return { orderAccuracy, timingAccuracy, combinedScore, errors, interNoteTimings };
}


// ═══════════════════════════════════════════════════════════════════════
//  MODULE 6: LearnerProfiler — Composite modality scoring
// ═══════════════════════════════════════════════════════════════════════
class LearnerProfiler {
    /**
     * Compute composite scores for each modality from profiling trials.
     * @param {object[]} profilingTrials - All profiling trial records
     * @returns {object} - { visual: {..., composite}, audio: {...}, haptic: {...}, bestModality }
     */
    static computeScores(profilingTrials) {
        const modalities = ['visual', 'audio', 'haptic', 'visual-haptic'];
        const scores = {};

        modalities.forEach(mod => {
            const trials = profilingTrials.filter(t => t.modality === mod);
            if (trials.length === 0) {
                scores[mod] = { avgOrderAccuracy: 0, avgTimingAccuracy: 0, avgCombined: 0, avgResponseTime: 0, errorRate: 0, composite: 0 };
                return;
            }

            const avgOrder = trials.reduce((s, t) => s + t.orderAccuracy, 0) / trials.length;
            const avgTiming = trials.reduce((s, t) => s + t.timingAccuracy, 0) / trials.length;
            const avgCombined = trials.reduce((s, t) => s + t.combinedScore, 0) / trials.length;
            const avgRT = trials.reduce((s, t) => s + t.responseTimeMs, 0) / trials.length;

            // Error rate: errors / target sequence length
            const avgErrors = trials.reduce((s, t) => s + (t.errors / t.targetSequence.length), 0) / trials.length;

            // Normalized response time (lower = better, clamped 0-1)
            const normRT = Math.max(0, Math.min(1, 1 - (avgRT / INPUT_TIMEOUT)));

            // Composite score
            const composite = Math.round(
                (PROFILING_WEIGHTS.accuracy * avgCombined +
                 PROFILING_WEIGHTS.responseTime * normRT +
                 PROFILING_WEIGHTS.errorRate * (1 - avgErrors)) * 100
            );

            scores[mod] = {
                avgOrderAccuracy: avgOrder,
                avgTimingAccuracy: avgTiming,
                avgCombined,
                avgResponseTime: avgRT,
                errorRate: avgErrors,
                composite: Math.max(0, Math.min(100, composite)),
            };
        });

        // Find best modality (tiebreaker: highest timing accuracy)
        let bestMod = 'visual';
        let bestScore = -1;
        modalities.forEach(mod => {
            if (scores[mod].composite > bestScore ||
                (scores[mod].composite === bestScore && scores[mod].avgTimingAccuracy > scores[bestMod].avgTimingAccuracy)) {
                bestScore = scores[mod].composite;
                bestMod = mod;
            }
        });
        scores.bestModality = bestMod;

        return scores;
    }
}


// ═══════════════════════════════════════════════════════════════════════
//  MODULE 7: UIRenderer — All DOM manipulation
// ═══════════════════════════════════════════════════════════════════════
class UIRenderer {
    constructor() {
        this.currentScreen = 'screen-setup';
    }

    /**
     * Switch to a named screen. Hides all others.
     */
    showScreen(screenId) {
        document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
        const target = document.getElementById(screenId);
        if (target) {
            target.classList.add('active');
            this.currentScreen = screenId;
        }
    }

    /**
     * Update connection status display.
     */
    updateConnectionStatus(isConnected) {
        const badges = document.querySelectorAll('.connection-badge');
        badges.forEach(badge => {
            const dot = badge.querySelector('.status-dot');
            if (isConnected) {
                dot.className = 'status-dot connected';
                badge.innerHTML = '';
                badge.appendChild(dot);
                badge.append(' Connected');
            } else {
                dot.className = 'status-dot disconnected';
                badge.innerHTML = '';
                badge.appendChild(dot);
                badge.append(' Disconnected');
            }
        });

        // Enable/disable connect buttons
        ['connect-btn', 'returning-connect-btn'].forEach(id => {
            const btn = document.getElementById(id);
            if (btn) {
                if (isConnected) {
                    btn.innerHTML = '<span class="status-dot connected"></span> Connected';
                    btn.disabled = true;
                } else {
                    btn.innerHTML = '<span class="status-dot disconnected"></span> Connect Device';
                    btn.disabled = false;
                }
            }
        });
    }

    /**
     * Show/hide and update the phase progress bar.
     */
    updatePhaseBar(visible, activePhase, completedPhases = []) {
        const bar = document.getElementById('phase-bar');
        if (!visible) { bar.classList.add('hidden'); return; }
        bar.classList.remove('hidden');

        document.querySelectorAll('.phase-step').forEach(step => {
            step.classList.remove('active', 'completed');
            if (completedPhases.includes(step.dataset.phase)) {
                step.classList.add('completed');
            }
            if (step.dataset.phase === activePhase) {
                step.classList.add('active');
            }
        });
    }

    /**
     * Update phase step labels (for counterbalanced modality names).
     */
    setPhaseLabels(modalityOrder) {
        const MODALITY_ICONS = { visual: '👁', audio: '🔊', haptic: '✋' };
        for (let i = 0; i < 3; i++) {
            const step = document.getElementById(`phase-step-${i + 1}`);
            if (step) {
                const mod = modalityOrder[i];
                step.textContent = `${MODALITY_ICONS[mod]} ${mod.charAt(0).toUpperCase() + mod.slice(1)}`;
            }
        }
    }

    /**
     * Update the session badge in the header.
     */
    setSessionBadge(sessionNumber) {
        const badge = document.getElementById('session-badge');
        badge.textContent = `Session ${sessionNumber}`;
        badge.classList.remove('hidden');
    }

    /**
     * Set modality label styling and text.
     */
    setModalityLabel(elementId, modality) {
        const LABELS = {
            visual: { text: '👁 Visual Mode', cls: 'visual' },
            audio: { text: '🔊 Audio Mode', cls: 'audio' },
            haptic: { text: '✋ Haptic Mode', cls: 'haptic' },
            'visual-haptic': { text: '👁✋ Visual+Haptic Mode', cls: 'visual-haptic' },
        };
        const el = document.getElementById(elementId);
        if (el && LABELS[modality]) {
            el.textContent = LABELS[modality].text;
            el.className = `modality-label ${LABELS[modality].cls}`;
        }
    }

    /**
     * Light up a finger indicator when it's bent.
     */
    setFingerActive(prefix, finger, active) {
        const el = document.getElementById(`${prefix}finger-${finger}`);
        if (el) {
            if (active) {
                el.classList.add('active');
            } else {
                el.classList.remove('active');
            }
        }
    }

    /**
     * Reset all finger indicators in a group.
     */
    resetFingers(prefix) {
        for (let i = 1; i <= 6; i++) {
            const el = document.getElementById(`${prefix}finger-${i}`);
            if (el) el.className = 'finger-indicator';
        }
    }

    /**
     * Update sequence display elements to reflect reproduction progress.
     */
    updateVisualReproduction(displayId, enteredLength) {
        const display = document.getElementById(displayId);
        if (!display) return;
        const notes = display.querySelectorAll('.sequence-note');
        notes.forEach((note, idx) => {
            note.classList.remove('highlight', 'played');
            if (idx < enteredLength) {
                note.classList.add('played');
            } else if (idx === enteredLength) {
                note.classList.add('highlight');
            }
        });
    }

    /**
     * Show user's entered sequence as text below finger viz.
     */
    updateUserSequenceDisplay(elementId, inputs) {
        const el = document.getElementById(elementId);
        if (!el) return;
        if (!inputs || inputs.length === 0) {
            el.textContent = '';
            return;
        }
        el.textContent = inputs.map(item => {
            if (typeof item === 'number') return (FINGER_NOTES[item] || item);
            if (typeof item === 'string') return item;
            if (item && item.note) return item.note;
            return String(item);
        }).join(' → ');
    }

    /**
     * Dynamically update UI text, finger labels, and hardware mapping for the selected instrument.
     * @param {'piano'|'recorder'} instrument
     */
    updateInstrumentView(instrument = 'piano') {
        const windGroup = document.getElementById('wind-experience-group');
        if (windGroup) {
            if (instrument === 'recorder') {
                windGroup.classList.remove('hidden');
            } else {
                windGroup.classList.add('hidden');
            }
        }

        const pianoMappingHtml = `
            <ul style="margin:0; padding-left:1.2rem; line-height:1.7; font-size:0.9rem; color:var(--text-secondary); text-align:left;">
                <li><strong style="color:var(--text-primary);">Right Glove (Index, Middle, Ring):</strong>
                    <ul style="margin:0; padding-left:1.2rem;">
                        <li>Finger 1 (Note C): Ring Finger</li>
                        <li>Finger 2 (Note D): Middle Finger</li>
                        <li>Finger 3 (Note E): Index Finger</li>
                    </ul>
                </li>
                <li class="mt-2"><strong style="color:var(--text-primary);">Left Glove (Index, Middle, Ring):</strong>
                    <ul style="margin:0; padding-left:1.2rem;">
                        <li>Finger 4 (Note F): Index Finger</li>
                        <li>Finger 5 (Note G): Middle Finger</li>
                        <li>Finger 6 (Note A): Ring Finger</li>
                    </ul>
                </li>
            </ul>
        `;

        const recorderMappingHtml = `
            <ul style="margin:0; padding-left:1.2rem; line-height:1.7; font-size:0.9rem; color:var(--text-secondary); text-align:left;">
                <li><strong style="color:var(--text-primary);">Left Glove (Top 3 Holes):</strong>
                    <ul style="margin:0; padding-left:1.2rem;">
                        <li>Hole 1 (L1 / Sensor 4): Index Finger</li>
                        <li>Hole 2 (L2 / Sensor 5): Middle Finger</li>
                        <li>Hole 3 (L3 / Sensor 6): Ring Finger</li>
                    </ul>
                </li>
                <li class="mt-2"><strong style="color:var(--text-primary);">Right Glove (Bottom 3 Holes):</strong>
                    <ul style="margin:0; padding-left:1.2rem;">
                        <li>Hole 4 (R1 / Sensor 3): Index Finger</li>
                        <li>Hole 5 (R2 / Sensor 2): Middle Finger</li>
                        <li>Hole 6 (R3 / Sensor 1): Ring Finger</li>
                    </ul>
                </li>
                <li class="mt-2"><strong style="color:var(--text-primary);">Note Fingering (Curled = Covered):</strong>
                    <ul style="margin:0; padding-left:1.2rem;">
                        <li>Note C: All 6 holes covered</li>
                        <li>Note D: Hole 6 (R-Ring) open</li>
                        <li>Note E: Holes 5 & 6 (R-Middle, R-Ring) open</li>
                        <li>Note F: Holes 4, 5 & 6 (Right Hand) open</li>
                        <li>Note G: Holes 3, 4, 5 & 6 open</li>
                        <li>Note A: Holes 2, 3, 4, 5 & 6 open (Left Index only)</li>
                    </ul>
                </li>
            </ul>
        `;

        ['glove-mapping-content', 'returning-glove-mapping-content'].forEach(id => {
            const el = document.getElementById(id);
            if (el) {
                el.innerHTML = instrument === 'recorder' ? recorderMappingHtml : pianoMappingHtml;
            }
        });

        ['glove-mapping-title', 'returning-glove-mapping-title'].forEach(id => {
            const el = document.getElementById(id);
            if (el) {
                el.textContent = '✋ Glove Finger Mapping Reference';
            }
        });

        // Update finger indicator boxes on testing screens preserving the 3-span vertical layout
        const fingerData = instrument === 'recorder' ? {
            1: { num: '6', note: 'R3', pos: 'R-Ring' },
            2: { num: '5', note: 'R2', pos: 'R-Middle' },
            3: { num: '4', note: 'R1', pos: 'R-Index' },
            4: { num: '1', note: 'L1', pos: 'L-Index' },
            5: { num: '2', note: 'L2', pos: 'L-Middle' },
            6: { num: '3', note: 'L3', pos: 'L-Ring' }
        } : {
            1: { num: '1', note: 'C', pos: 'R-Ring' },
            2: { num: '2', note: 'D', pos: 'R-Middle' },
            3: { num: '3', note: 'E', pos: 'R-Index' },
            4: { num: '4', note: 'F', pos: 'L-Index' },
            5: { num: '5', note: 'G', pos: 'L-Middle' },
            6: { num: '6', note: 'A', pos: 'L-Ring' }
        };

        ['', 'training-', 'retention-'].forEach(prefix => {
            for (let f = 1; f <= 6; f++) {
                const el = document.getElementById(`${prefix}finger-${f}`);
                if (el && fingerData[f]) {
                    el.innerHTML = `
                        <span class="finger-num">${fingerData[f].num}</span>
                        <span class="finger-note">${fingerData[f].note}</span>
                        <span class="finger-pos">${fingerData[f].pos}</span>
                    `;
                }
            }
        });

        // Toggle visibility of recorder fingering quick reference guides and live preview banners on testing screens
        document.querySelectorAll('.recorder-fingering-guide').forEach(guide => {
            if (instrument === 'recorder') {
                guide.classList.remove('hidden');
            } else {
                guide.classList.add('hidden');
            }
        });

        document.querySelectorAll('.recorder-live-preview').forEach(preview => {
            if (instrument === 'recorder') {
                preview.classList.remove('hidden');
            } else {
                preview.classList.add('hidden');
            }
        });
    }

    /**
     * Update real-time live recorder candidate preview and hold progress bar.
     */
    updateLiveRecorderPreview(prefix, state) {
        let previewPrefix = prefix;
        if (prefix === '') previewPrefix = 'profiling-';

        const preview = document.getElementById(`${previewPrefix}recorder-live-preview`);
        if (!preview) return;

        const noteBadge = document.getElementById(`${previewPrefix}live-note-name`);
        const dotsBadge = document.getElementById(`${previewPrefix}live-fingers-dots`);
        const progressBar = document.getElementById(`${previewPrefix}hold-progress-bar`);

        if (state.noteName) {
            if (noteBadge) {
                if (state.progressPct >= 100) {
                    noteBadge.textContent = `🎵 Note ${state.noteName}`;
                } else {
                    noteBadge.textContent = `Forming: Note ${state.noteName}`;
                }
                noteBadge.classList.remove('unrecognized');
            }
        } else {
            if (noteBadge) {
                const active = state.activeFingers || [];
                if (active.length > 0) {
                    noteBadge.textContent = `Bent: ${active.join(' + ')}`;
                } else {
                    noteBadge.textContent = 'Open Hand (Ready)';
                }
                noteBadge.classList.add('unrecognized');
            }
        }

        if (dotsBadge && state.vector) {
            const l = state.vector.slice(0, 3).map(v => v === 1 ? '●' : '○').join('');
            const r = state.vector.slice(3, 6).map(v => v === 1 ? '●' : '○').join('');
            dotsBadge.textContent = `[${l} | ${r}]`;
        }

        if (progressBar) {
            progressBar.style.width = `${state.progressPct || 0}%`;
        }
    }

    /**
     * Update trial info stats.
     */
    updateTrialInfo(prefix, info) {
        const set = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
        set(`${prefix}level`, info.level || '—');
        set(`${prefix}modality`, info.modality || '—');
        set(`${prefix}attempt`, info.attempt || '—');
        set(`${prefix}order-score`, info.orderScore || '—');
        set(`${prefix}timing-score`, info.timingScore || '—');
        set(`${prefix}combined-score`, info.combinedScore || '—');
    }

    /**
     * Add an entry to an attempt history list.
     */
    addAttemptHistoryItem(listId, item) {
        const list = document.getElementById(listId);
        if (!list) return;

        // Clear placeholder
        const placeholder = list.querySelector('.text-muted');
        if (placeholder) list.innerHTML = '';

        const li = document.createElement('li');
        li.className = `attempt-item ${item.correct ? 'correct' : 'incorrect'}`;
        li.innerHTML = `
            <div class="attempt-icon">${item.correct ? '✔' : '✖'}</div>
            <div class="attempt-details">
                <strong>${item.sequence}</strong>
                <div class="attempt-scores">
                    Order: ${(item.orderAcc * 100).toFixed(0)}% | Timing: ${(item.timingAcc * 100).toFixed(0)}% | Combined: ${(item.combined * 100).toFixed(0)}%
                </div>
            </div>
            <div style="color:var(--text-muted);font-size:0.8rem;">${(item.responseTime / 1000).toFixed(1)}s</div>
        `;
        list.insertBefore(li, list.firstChild);
    }

    /**
     * Update profiling results screen with scores.
     */
    showProfilingResults(scores, group) {
        // Blind the participant by hiding the objective scorecards grid
        const scoresContainer = document.querySelector('.modality-scores');
        if (scoresContainer) scoresContainer.classList.add('hidden');

        ['visual', 'audio', 'haptic', 'visual-haptic'].forEach(mod => {
            const scoreEl = document.getElementById(`profile-${mod}-score`);
            const barEl = document.getElementById(`profile-${mod}-bar`);
            if (scoreEl) scoreEl.textContent = scores[mod]?.composite || 0;
            if (barEl) barEl.style.width = `${scores[mod]?.composite || 0}%`;
        });

        // Highlight best
        document.querySelectorAll('.score-card').forEach(card => card.classList.remove('best'));
        const bestCard = document.getElementById(`result-card-${scores.bestModality}`);
        if (bestCard) bestCard.classList.add('best');

        // Show appropriate selection UI
        if (group === 'system-selected') {
            document.getElementById('system-recommendation').classList.remove('hidden');
            document.getElementById('self-selection').classList.add('hidden');
            const LABELS = { visual: '👁 Visual', audio: '🔊 Audio', haptic: '✋ Haptic', 'visual-haptic': '👁✋ Visual+Haptic' };
            document.getElementById('system-best-modality').textContent = LABELS[scores.bestModality] || scores.bestModality;
            document.getElementById('system-best-modality').style.color = `var(--modality-${scores.bestModality})`;
        } else {
            document.getElementById('self-selection').classList.remove('hidden');
            document.getElementById('system-recommendation').classList.add('hidden');
        }
    }

    /**
     * Update Session 1 Complete summary.
     */
    updateSession1Summary(data) {
        const set = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
        set('s1-total-trials', data.totalTrials);
        set('s1-avg-order', data.avgOrder);
        set('s1-avg-timing', data.avgTiming);
        set('s1-avg-combined', data.avgCombined);
        set('s1-best-modality', data.bestModality);
        set('s1-assigned-modality', data.assignedModality);
        set('s1-group', data.group);
    }

    /**
     * Update Final Results screen.
     */
    updateFinalResults(data) {
        const set = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
        set('final-visual-score', data.visualScore);
        set('final-audio-score', data.audioScore);
        set('final-haptic-score', data.hapticScore);
        set('final-visual-haptic-score', data.visualHapticScore || 0);
        set('final-training-order', data.trainingOrder);
        set('final-training-timing', data.trainingTiming);
        set('final-training-combined', data.trainingCombined);
        set('final-training-modality', data.trainingModality);
        set('final-selection-method', data.selectionMethod);
        set('final-retention-order', data.retentionOrder);
        set('final-retention-timing', data.retentionTiming);
        set('final-retention-combined', data.retentionCombined);
        set('final-days-between', data.daysBetween);
    }

    /**
     * Show a toast notification.
     */
    showToast(message, durationMs = 3000) {
        const toast = document.getElementById('toast');
        const msg = document.getElementById('toast-message');
        msg.textContent = message;
        toast.classList.remove('hidden');
        toast.classList.add('show');
        setTimeout(() => {
            toast.classList.remove('show');
            setTimeout(() => toast.classList.add('hidden'), 300);
        }, durationMs);
    }

    /**
     * Update the session timer display.
     */
    updateSessionTimer(elapsedMs) {
        const el = document.getElementById('session-timer');
        if (!el) return;
        el.classList.remove('hidden');
        const totalSec = Math.floor(elapsedMs / 1000);
        const min = String(Math.floor(totalSec / 60)).padStart(2, '0');
        const sec = String(totalSec % 60).padStart(2, '0');
        el.textContent = `${min}:${sec}`;
    }

    /**
     * Append a raw line to the serial debug log.
     */
    appendDebugLog(msg) {
        const logEl = document.getElementById('debug-serial-log');
        if (!logEl) return;
        
        if (logEl.textContent.includes('[Console initialized')) {
            logEl.innerHTML = '';
        }
        
        const timestamp = new Date().toLocaleTimeString();
        const line = document.createElement('div');
        line.textContent = `[${timestamp}] Rx: ${msg}`;
        logEl.appendChild(line);
        logEl.scrollTop = logEl.scrollHeight;
        
        while (logEl.children.length > 20) {
            logEl.removeChild(logEl.firstChild);
        }
    }
}


// ═══════════════════════════════════════════════════════════════════════
//  MODULE 8: AppController — State machine & study flow orchestration
// ═══════════════════════════════════════════════════════════════════════
class AppController {
    constructor() {
        this.serial = new SerialManager();
        this.audio = new AudioEngine();
        this.modality = new ModalityEngine(this.audio, this.serial);
        this.data = new DataCollector();
        this.data.migratePilotData(); // Move old data to amlt_pilot_ keys
        this.data.archivePreviousStudyData(); // Archive previous run data to amlt_archive_ so new IDs reset to P01
        this.dashboardTab = 'main'; // 'main', 'archive', or 'pilot'
        this.dashboardSubTab = 'all'; // 'all', 'self-selected', 'system-selected'
        this.ui = new UIRenderer();

        // Instrument & Onset Detection
        this.instrument = 'piano'; // 'piano' or 'recorder'
        this.recorderDetector = new RecorderOnsetDetector(RECORDER_STABLE_HOLD_MS);
        this.recorderDetector.onNoteDetected = (noteEvent) => this._handleRecorderNote(noteEvent);
        this.recorderDetector.onStateChange = (state) => {
            const prefix = this._getFingerPrefix();
            this.ui.updateLiveRecorderPreview(prefix, state);
        };
        this.userSpreadHistory = [];

        // Study state
        this.state = 'SETUP'; // Current state in the state machine
        this.participantId = null;
        this.group = null;
        this.modalityOrder = [];
        this.currentModalityIndex = 0;
        this.currentTrialIndex = 0;
        this.currentAttempt = 0;
        this.currentSequence = [];
        this.currentLevel = '';
        this.currentPhase = ''; // 'profiling', 'training', 'retention'
        this.currentModality = '';

        // Input collection
        this.userInputs = [];       // Array of finger numbers (piano) or note names (recorder)
        this.userTimestamps = [];   // Array of timestamps for each input
        this.isCollectingInput = false;
        this.inputTimeout = null;
        this.presentationEndTime = 0; // When the sequence finished presenting

        // Session timer
        this.sessionStartTime = null;
        this.sessionTimerInterval = null;

        // Initialize
        this._setupEventListeners();
        this._setupSerialCallbacks();
    }

    // ─── Event Listeners ──────────────────────────────────────────
    _setupEventListeners() {
        // Instrument selector
        const instSelect = document.getElementById('instrument-select');
        if (instSelect) {
            instSelect.addEventListener('change', (e) => {
                this.instrument = e.target.value;
                this.ui.updateInstrumentView(this.instrument);
            });
            this.instrument = instSelect.value || 'piano';
            this.ui.updateInstrumentView(this.instrument);
        }

        // Setup screen
        document.getElementById('connect-btn').addEventListener('click', () => this._handleConnect());
        document.getElementById('start-study-btn').addEventListener('click', () => this._startSession1());
        document.getElementById('switch-to-returning').addEventListener('click', (e) => {
            e.preventDefault();
            this._populateReturningDropdown();
            this.ui.showScreen('screen-returning');
        });
        document.getElementById('open-dashboard-setup-btn').addEventListener('click', () => this._openDashboard());

        // Returning screen
        document.getElementById('returning-connect-btn').addEventListener('click', () => this._handleConnect());
        document.getElementById('start-session2-btn').addEventListener('click', () => this._startSession2());
        document.getElementById('switch-to-setup').addEventListener('click', (e) => {
            e.preventDefault();
            this.ui.showScreen('screen-setup');
        });
        document.getElementById('restore-file-input').addEventListener('change', (e) => this._handleRestore(e));
        document.getElementById('open-dashboard-returning-btn').addEventListener('click', () => this._openDashboard());

        // Profiling screen
        document.getElementById('replay-btn').addEventListener('click', () => this._replaySequence());

        // Profile results screen
        document.getElementById('continue-training-btn').addEventListener('click', () => {
            this._selectModality();
        });
        document.getElementById('start-next-modality-btn').addEventListener('click', () => this._startProfilingBlock());

        // Training screen
        document.getElementById('training-replay-btn').addEventListener('click', () => this._replaySequence());

        // Session 1 complete
        document.getElementById('s1-download-backup').addEventListener('click', () => {
            this.data.exportJSON(`amlt_${this.participantId}_session1_backup.json`);
        });

        // Final results
        document.getElementById('export-csv-btn').addEventListener('click', () => this.data.exportTrialCSV());
        document.getElementById('export-summary-csv-btn').addEventListener('click', () => this.data.exportSummaryCSV());
        document.getElementById('export-json-btn').addEventListener('click', () => {
            this.data.exportJSON(`amlt_${this.participantId}_full_study_backup.json`);
        });

        // Save Confirmation Modal
        document.getElementById('save-confirm-yes-btn').addEventListener('click', () => this._handleSaveConfirm(true));
        document.getElementById('save-confirm-no-btn').addEventListener('click', () => this._handleSaveConfirm(false));
        document.getElementById('save-confirm-cancel-btn').addEventListener('click', () => {
            document.getElementById('save-confirmation-dialog').classList.add('hidden');
        });

        // Researcher Dashboard Actions
        document.getElementById('close-dashboard-btn').addEventListener('click', () => {
            document.getElementById('researcher-dashboard').classList.add('hidden');
            this._populateReturningDropdown();
        });
        
        // Subtab switching (Group A/B)
        const subtabAll = document.getElementById('subtab-all');
        const subtabA = document.getElementById('subtab-group-a');
        const subtabB = document.getElementById('subtab-group-b');
        
        const updateSubtabs = (activeBtn) => {
            [subtabAll, subtabA, subtabB].forEach(btn => {
                if (btn) {
                    btn.classList.remove('btn-primary');
                    btn.classList.add('btn-secondary');
                }
            });
            if (activeBtn) {
                activeBtn.classList.remove('btn-secondary');
                activeBtn.classList.add('btn-primary');
            }
        };

        // Tab switching (Active / Archive / Pilot)
        const tabMain = document.getElementById('tab-main-study');
        const tabArchive = document.getElementById('tab-archive-study');
        const tabPilot = document.getElementById('tab-pilot-study');
        const tabs = [
            { el: tabMain, name: 'main' },
            { el: tabArchive, name: 'archive' },
            { el: tabPilot, name: 'pilot' }
        ];

        tabs.forEach(({ el, name }) => {
            if (el) {
                el.addEventListener('click', () => {
                    this.dashboardTab = name;
                    tabs.forEach(t => t.el && t.el.classList.remove('active'));
                    el.classList.add('active');
                    this.dashboardSubTab = 'all'; // Reset subtab
                    updateSubtabs(subtabAll);
                    this._renderDashboardList();
                });
            }
        });

        if (subtabAll && subtabA && subtabB) {
            subtabAll.addEventListener('click', () => {
                this.dashboardSubTab = 'all';
                updateSubtabs(subtabAll);
                this._renderDashboardList();
            });
            subtabA.addEventListener('click', () => {
                this.dashboardSubTab = 'self-selected'; // Group A
                updateSubtabs(subtabA);
                this._renderDashboardList();
            });
            subtabB.addEventListener('click', () => {
                this.dashboardSubTab = 'system-selected'; // Group B
                updateSubtabs(subtabB);
                this._renderDashboardList();
            });
        }

        document.getElementById('dashboard-export-trials-btn').addEventListener('click', () => this.data.exportMasterTrialCSV(this.dashboardTab));
        document.getElementById('dashboard-export-summary-btn').addEventListener('click', () => this.data.exportMasterSummaryCSV(this.dashboardTab));
        
        document.getElementById('dashboard-import-btn').addEventListener('click', () => {
            document.getElementById('dashboard-file-input').click();
        });
        document.getElementById('dashboard-file-input').addEventListener('change', (e) => this._handleDashboardImport(e));
        
        document.getElementById('dashboard-delete-all-btn').addEventListener('click', () => this._handleDeleteAllData());
        
        const webhookInput = document.getElementById('sheets-webhook-input');
        if (webhookInput) {
            webhookInput.value = localStorage.getItem('amlt_webhook_url') || '';
            webhookInput.addEventListener('input', (e) => {
                localStorage.setItem('amlt_webhook_url', e.target.value.trim());
            });
        }

        // Enable start buttons when ID is generated + device connected
        this._checkStartReady();
        const retSelect = document.getElementById('returning-participant-select');
        if (retSelect) {
            retSelect.addEventListener('change', () => this._checkStartReady());
        }

        // Debug Console Collapsible Toggle
        const toggle = document.getElementById('debug-console-toggle');
        const content = document.getElementById('debug-console-content');
        const arrow = document.getElementById('debug-console-arrow');
        if (toggle && content && arrow) {
            toggle.addEventListener('click', () => {
                const hidden = content.classList.toggle('hidden');
                arrow.textContent = hidden ? '▼' : '▲';
            });
            content.classList.add('hidden');
            arrow.textContent = '▼';
        }

        const readAdcBtn = document.getElementById('read-adc-btn');
        if (readAdcBtn) {
            readAdcBtn.addEventListener('click', () => {
                if (this.serial && this.serial.isConnected) {
                    this.serial.sendRaw('D\n');
                } else {
                    this.ui.appendDebugLog('[Web App] Cannot read ADC: Device not connected via Web Serial.');
                }
            });
        }

        // Stop buttons on testing screens
        ['stop-profiling-btn', 'stop-training-btn', 'stop-retention-btn'].forEach(id => {
            const btn = document.getElementById(id);
            if (btn) {
                btn.addEventListener('click', () => this._handleStopClick());
            }
        });

        // Stop modal action buttons
        document.getElementById('stop-save-btn').addEventListener('click', () => this._stopSession(true));
        document.getElementById('stop-discard-btn').addEventListener('click', () => this._stopSession(false));
        document.getElementById('stop-resume-btn').addEventListener('click', () => this._resumeSession());
    }

    _setupSerialCallbacks() {
        this.serial.onConnectionChange = (connected) => {
            this.ui.updateConnectionStatus(connected);
            this._checkStartReady();
            if (!connected && this.participantId) {
                this.ui.showToast('⚠️ Device disconnected! Check connection.');
            }
        };

        this.serial.onRawData = (msg) => {
            this.ui.appendDebugLog(msg);
        };

        this.serial.onFingerBend = (finger, timestamp) => {
            const prefix = this._getFingerPrefix();
            this.ui.setFingerActive(prefix, finger, true);

            // Hook for interactive guided haptic sequence presentation
            if (this.modality && this.modality.onFingerBendHook) {
                this.modality.onFingerBendHook(finger);
            }

            if (!this.isCollectingInput) return;

            if (this.instrument === 'recorder') {
                this.recorderDetector.handleFingerChange(finger, true, timestamp);
            } else {
                // Piano mode: single finger triggers note directly
                this.audio.playNote(finger, 200);

                this.userInputs.push(finger);
                this.userTimestamps.push(timestamp);

                const seqDisplayId = this._getUserSequenceDisplayId();
                this.ui.updateUserSequenceDisplay(seqDisplayId, this.userInputs);

                if (this.currentModality === 'visual') {
                    const displayId = this._getSequenceDisplayId();
                    this.ui.updateVisualReproduction(displayId, this.userInputs.length);
                }

                if (this.userInputs.length >= this.currentSequence.length) {
                    this._evaluateAttempt();
                }
            }
        };

        this.serial.onFingerRelease = (finger, timestamp) => {
            const prefix = this._getFingerPrefix();
            this.ui.setFingerActive(prefix, finger, false);

            if (!this.isCollectingInput) return;

            if (this.instrument === 'recorder') {
                this.recorderDetector.handleFingerChange(finger, false, timestamp);
            }
        };
    }

    _handleRecorderNote(noteEvent) {
        if (!this.isCollectingInput) return;

        this.audio.playNote(noteEvent.note, 200);

        this.userInputs.push(noteEvent.note);
        this.userTimestamps.push(noteEvent.timestamp);
        this.userSpreadHistory.push(noteEvent.spreadMs || 0);

        const seqDisplayId = this._getUserSequenceDisplayId();
        this.ui.updateUserSequenceDisplay(seqDisplayId, this.userInputs);

        if (this.currentModality === 'visual') {
            const displayId = this._getSequenceDisplayId();
            this.ui.updateVisualReproduction(displayId, this.userInputs.length);
        }

        if (this.userInputs.length >= this.currentSequence.length) {
            this._evaluateAttempt();
        }
    }

    // ─── Helpers for screen-specific element prefixes ─────────────
    _getFingerPrefix() {
        switch (this.currentPhase) {
            case 'training': return 'training-';
            case 'retention': return 'retention-';
            default: return ''; // profiling uses #finger-1 etc.
        }
    }

    _getUserSequenceDisplayId() {
        switch (this.currentPhase) {
            case 'training': return 'training-user-sequence';
            case 'retention': return 'retention-user-sequence';
            default: return 'user-sequence-display';
        }
    }

    _getSequenceDisplayId() {
        switch (this.currentPhase) {
            case 'training': return 'training-sequence-display';
            case 'retention': return 'retention-sequence-display';
            default: return 'sequence-display';
        }
    }

    _getInstructionId() {
        switch (this.currentPhase) {
            case 'training': return 'training-instruction';
            default: return 'sequence-instruction';
        }
    }

    _getAttemptHistoryId() {
        switch (this.currentPhase) {
            case 'training': return 'training-attempt-history';
            case 'retention': return 'retention-attempt-history';
            default: return 'attempt-history';
        }
    }

    _getTrialInfoPrefix() {
        switch (this.currentPhase) {
            case 'training': return 'training-';
            case 'retention': return 'retention-';
            default: return 'trial-';
        }
    }

    // ─── Connection & Readiness ───────────────────────────────────
    async _handleConnect() {
        try {
            await this.serial.connect();
            this.ui.showToast('Device connected!');
        } catch (e) {
            this.ui.showToast('Connection failed. Please try again.');
        }
    }

    _updateGeneratedId() {
        const display = document.getElementById('generated-id-display');
        let maxId = 0;
        
        // Count all main study participants
        for (let i = 0; i < localStorage.length; i++) {
            const key = localStorage.key(i);
            if (key && key.startsWith('amlt_data_P')) {
                const num = parseInt(key.replace('amlt_data_P', ''));
                if (!isNaN(num) && num > maxId) maxId = num;
            }
        }
        
        const nextId = maxId + 1;
        const generatedId = `P${String(nextId).padStart(2, '0')}`;
        
        if (display) display.textContent = `${generatedId}`;
        return generatedId;
    }

    _checkStartReady() {
        // Session 1
        const generatedId = this._updateGeneratedId();
        const btn1 = document.getElementById('start-study-btn');
        if (btn1) {
            btn1.disabled = !(generatedId && this.serial.isConnected);
        }

        // Session 2
        const select = document.getElementById('returning-participant-select');
        const id2 = select ? select.value : '';
        const btn2 = document.getElementById('start-session2-btn');
        if (btn2) {
            btn2.disabled = !(id2 && this.serial.isConnected);
        }
    }

    // ─── Session 1 Start ──────────────────────────────────────────
    async _startSession1() {
        const experience = document.getElementById('participant-experience').value;
        const windExperience = document.getElementById('participant-wind-experience')?.value || 'none';
        const hand = document.getElementById('participant-hand').value;
        const expectedModality = document.getElementById('participant-expected-modality').value || 'unsure';
        this.instrument = document.getElementById('instrument-select')?.value || 'piano';
        this.participantId = this._updateGeneratedId();
        this.group = document.getElementById('group-select').value;

        if (!this.participantId) return;

        // Determine modality order via Latin Square (offset by 2 for recorder)
        let charSum = 0;
        for (let i = 0; i < this.participantId.length; i++) {
            const code = this.participantId.charCodeAt(i);
            if (code >= 48 && code <= 57) charSum += (code - 48);
            else charSum += code;
        }
        const offset = this.instrument === 'recorder' ? 2 : 0;
        this.modalityOrder = MODALITY_ORDERS[(charSum + offset) % 4];
        this.consecutiveFailures = 0;

        // Create participant record
        this.data.createParticipant(this.participantId, this.group, experience, hand, expectedModality, this.instrument, windExperience);
        this.data.participantData.profilingOrder = [...this.modalityOrder];

        // UI setup
        this.ui.setSessionBadge(1);
        this.ui.setPhaseLabels(this.modalityOrder);
        this.ui.updateInstrumentView(this.instrument);
        this._startSessionTimer();

        // Play finger introduction
        await this._playIntroduction();

        // Start profiling
        this.currentPhase = 'profiling';
        this.currentModalityIndex = 0;
        this.currentTrialIndex = 0;
        this._startProfilingBlock();
    }

    // ─── Session 2 Start ──────────────────────────────────────────
    async _startSession2() {
        const select = document.getElementById('returning-participant-select');
        this.participantId = select ? select.value : '';

        if (!this.participantId) return;

        const loaded = this.data.loadParticipant(this.participantId);
        if (!loaded) {
            this.ui.showToast('No data found for this ID. Please restore from backup.');
            return;
        }

        this.instrument = loaded.instrument || 'piano';
        this.group = loaded.experimentalGroup;
        this.data.startSession2();

        this.ui.setSessionBadge(2);
        this.ui.updatePhaseBar(false);
        this.ui.updateInstrumentView(this.instrument);
        this._startSessionTimer();

        // Start retention test
        this.currentPhase = 'retention';
        this.currentTrialIndex = 0;
        this.currentAttempt = 0;
        this.ui.showScreen('screen-retention');
        this._runRetentionTrial();
    }

    // ─── Handle backup restore ────────────────────────────────────
    _handleRestore(event) {
        const file = event.target.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = (e) => {
            try {
                const data = JSON.parse(e.target.result);
                this.data.restoreFromBackup(data);
                document.getElementById('returning-participant-id').value = data.participantId;
                this.ui.showToast(`Data restored for ${data.participantId}!`);
                this._checkStartReady();
            } catch (err) {
                this.ui.showToast('Invalid backup file.');
            }
        };
        reader.readAsText(file);
    }

    // ─── Finger Introduction ──────────────────────────────────────
    async _playIntroduction() {
        this.ui.showScreen('screen-profiling');
        const display = document.getElementById('sequence-display');
        const instruction = document.getElementById('sequence-instruction');

        display.innerHTML = `<span style="font-size:1.3rem;color:var(--text-primary);">${this.instrument === 'recorder' ? 'Recorder' : 'Piano'} Introduction</span>`;
        instruction.textContent = this.instrument === 'recorder' 
            ? 'Each note uses a combination of covered holes. Feel and hear each note.' 
            : 'Each finger maps to a note. Feel and hear each one.';

        if (this.instrument === 'recorder') {
            const notes = ['C', 'D', 'E', 'F', 'G', 'A'];
            const notesDesc = {
                'C': 'Note C: All 6 holes covered',
                'D': 'Note D: Hole 6 (R-Ring) open',
                'E': 'Note E: Holes 5, 6 open',
                'F': 'Note F: Holes 4, 5, 6 open',
                'G': 'Note G: Holes 3, 4, 5, 6 open',
                'A': 'Note A: Holes 2, 3, 4, 5, 6 open'
            };
            for (const note of notes) {
                instruction.textContent = notesDesc[note];
                const activeFingers = RECORDER_NOTE_HARDWARE_FINGERS[note] || [];
                activeFingers.forEach(f => this.ui.setFingerActive('', f, true));
                await this.audio.playNote(note, 500);
                if (this.serial.isConnected) {
                    await this.serial.vibrateFingers(activeFingers, 500);
                }
                await new Promise(r => setTimeout(r, 600));
                this.ui.resetFingers('');
                await new Promise(r => setTimeout(r, 200));
            }
        } else {
            const FINGER_MAP_INFO = {
                1: "Finger 1: Right Glove Ring Finger (Note C)",
                2: "Finger 2: Right Glove Middle Finger (Note D)",
                3: "Finger 3: Right Glove Index Finger (Note E)",
                4: "Finger 4: Left Glove Index Finger (Note F)",
                5: "Finger 5: Left Glove Middle Finger (Note G)",
                6: "Finger 6: Left Glove Ring Finger (Note A)"
            };

            for (let finger = 1; finger <= 6; finger++) {
                instruction.textContent = FINGER_MAP_INFO[finger];
                this.ui.setFingerActive('', finger, true);
                await this.audio.playNote(finger, 500);
                await this.serial.vibrateFinger(finger, 500);
                await new Promise(r => setTimeout(r, 600));
                this.ui.setFingerActive('', finger, false);
                await new Promise(r => setTimeout(r, 200));
            }
        }

        instruction.textContent = 'Introduction complete! Starting profiling...';
        await new Promise(r => setTimeout(r, 1000));
    }

    // ─── Profiling Flow ───────────────────────────────────────────
    _startProfilingBlock() {
        if (this.currentModalityIndex >= 4) {
            // All modalities profiled — compute scores
            this._finishProfiling();
            return;
        }

        this.currentModality = this.modalityOrder[this.currentModalityIndex];
        this.currentTrialIndex = 0;
        this.currentAttempt = 0;

        // Update UI
        this.ui.showScreen('screen-profiling');
        this.ui.setModalityLabel('profiling-modality-label', this.currentModality);

        const completedPhases = [];
        for (let i = 0; i < this.currentModalityIndex; i++) {
            completedPhases.push(`profiling-${i + 1}`);
        }
        this.ui.updatePhaseBar(true, `profiling-${this.currentModalityIndex + 1}`, completedPhases);

        this._runProfilingTrial();
    }

    async _runProfilingTrial() {
        if (this.currentTrialIndex >= 3) {
            // Move to next modality via break screen
            this.currentModalityIndex++;
            if (this.currentModalityIndex >= 4) {
                this._finishProfiling();
            } else {
                this._showProfilingBreak();
            }
            return;
        }

        if (this.instrument === 'recorder') {
            // 3 trials per modality:
            // Trial 0: Level 1 rotated
            // Trial 1: Level 1 different rotated
            // Trial 2: Level 2 rotated
            if (this.currentTrialIndex === 0) {
                this.currentSequence = RECORDER_SEQUENCES.level1[this.currentModalityIndex % 3];
                this.currentLevel = 'level1';
            } else if (this.currentTrialIndex === 1) {
                this.currentSequence = RECORDER_SEQUENCES.level1[(this.currentModalityIndex + 1) % 3];
                this.currentLevel = 'level1';
            } else {
                this.currentSequence = RECORDER_SEQUENCES.level2[this.currentModalityIndex % 4];
                this.currentLevel = 'level2';
            }
        } else {
            const level = PROFILING_LEVELS[this.currentTrialIndex];
            const seqIdx = PROFILING_SEQ_INDICES[this.currentTrialIndex];
            this.currentSequence = PIANO_SEQUENCES[level][seqIdx];
            this.currentLevel = level;
        }
        this.currentAttempt = 0;

        // Update trial counter (4 modalities * 3 trials = 12 total)
        const totalTrial = this.currentModalityIndex * 3 + this.currentTrialIndex + 1;
        document.getElementById('profiling-trial-counter').textContent = `Trial ${totalTrial} / 12`;

        await this._presentAndCollect();
    }

    _showProfilingBreak() {
        const nextMod = this.modalityOrder[this.currentModalityIndex];
        const prevMod = this.modalityOrder[this.currentModalityIndex - 1];

        const MOD_TEXTS = {
            visual: 'Visual Mode (👁)',
            audio: 'Audio Mode (🔊)',
            haptic: 'Haptic Mode (✋)',
            'visual-haptic': 'Visual + Haptic Mode (👁✋)',
        };

        const INSTRUCTIONS = {
            visual: 'Watch the on-screen note boxes carefully. They will highlight in rhythm. Remember the pattern and reproduce it on your fingers!',
            audio: 'Listen carefully to the audio tones. The screen will NOT display note boxes! Reproduce the pattern from sound alone.',
            haptic: 'Feel the vibrations on your glove fingers. The screen will NOT display note boxes! Reproduce the pattern from touch alone.',
            'visual-haptic': 'Watch the screen highlights and feel the glove vibrations together. Reproduce the combined multi-sensory pattern!',
        };

        document.getElementById('break-completed-text').textContent = `Great job! You have finished the trials for ${MOD_TEXTS[prevMod] || 'this modality'}.`;
        this.ui.setModalityLabel('break-next-modality-badge', nextMod);
        document.getElementById('break-instructions-text').textContent = INSTRUCTIONS[nextMod] || 'Prepare for the upcoming trial block.';

        this.ui.showScreen('screen-profiling-break');
    }

    _finishProfiling() {
        const profilingTrials = this.data.participantData.session1Trials.filter(t => t.phase === 'profiling');
        const scores = LearnerProfiler.computeScores(profilingTrials);
        this.data.setModalityScores(scores);

        // Update phase bar
        this.ui.updatePhaseBar(true, 'profile-results', ['profiling-1', 'profiling-2', 'profiling-3', 'profiling-4']);

        // Show results
        this.ui.showScreen('screen-profile-results');
        this.ui.showProfilingResults(scores, this.group);
    }

    // ─── Modality Selection ───────────────────────────────────────
    _selectModality() {
        const scores = this.data.participantData.modalityScores;
        const expected = this.data.participantData.expectedModality;
        const systemSelected = scores.bestModality;
        
        // Both groups start with their expected modality.
        // If they were 'unsure', use the system selected best modality.
        const active = (expected && expected !== 'unsure') ? expected : systemSelected;

        this.data.setModalitySelection(active, systemSelected, active);
        this.currentModality = active;

        this.ui.showToast(`Training modality set to: ${active.charAt(0).toUpperCase() + active.slice(1)}`);

        // Start training
        this._startTraining();
    }

    // ─── Training Flow ────────────────────────────────────────────
    _startTraining() {
        this.currentPhase = 'training';
        this.currentTrialIndex = 0;
        this.currentAttempt = 0;
        this.successfulTrainingRuns = 0;
        this.consecutiveFailures = 0;

        const banner = document.getElementById('adaptive-assist-banner');
        if (banner) banner.classList.add('hidden');

        this.ui.showScreen('screen-training');
        this.ui.setModalityLabel('training-modality-label', this.currentModality);
        this.ui.updatePhaseBar(true, 'training', ['profiling-1', 'profiling-2', 'profiling-3', 'profiling-4', 'profile-results']);

        this._runTrainingTrial();
    }

    async _runTrainingTrial() {
        if (this.currentTrialIndex >= 12 || this.successfulTrainingRuns >= 3) {
            this._finishSession1Confirm();
            return;
        }

        if (this.instrument === 'recorder') {
            this.currentSequence = RECORDER_SEQUENCES.level3; // ['C', 'F', 'A', 'D', 'G']
        } else {
            this.currentSequence = PIANO_SEQUENCES.level3; // [1, 3, 2, 6, 4]
        }
        this.currentLevel = 'level3';
        this.currentAttempt = 0;

        document.getElementById('training-trial-counter').textContent =
            `Trial ${this.currentTrialIndex + 1} / 12 (Successes: ${this.successfulTrainingRuns} / 3)`;

        await this._presentAndCollect();
    }

    // ─── Session 1 Complete ───────────────────────────────────────
    _finishSession1() {
        const p = this.data.participantData;
        const allTrials = p.session1Trials;
        const avgOrder = allTrials.length > 0 ? allTrials.reduce((s, t) => s + t.orderAccuracy, 0) / allTrials.length : 0;
        const avgTiming = allTrials.length > 0 ? allTrials.reduce((s, t) => s + t.timingAccuracy, 0) / allTrials.length : 0;
        const avgCombined = allTrials.length > 0 ? allTrials.reduce((s, t) => s + t.combinedScore, 0) / allTrials.length : 0;

        this.ui.updateSession1Summary({
            totalTrials: allTrials.length,
            avgOrder: `${(avgOrder * 100).toFixed(0)}%`,
            avgTiming: `${(avgTiming * 100).toFixed(0)}%`,
            avgCombined: `${(avgCombined * 100).toFixed(0)}%`,
            bestModality: p.modalityScores.bestModality ? p.modalityScores.bestModality.charAt(0).toUpperCase() + p.modalityScores.bestModality.slice(1) : 'N/A',
            assignedModality: p.activeModality ? p.activeModality.charAt(0).toUpperCase() + p.activeModality.slice(1) : 'N/A',
            group: p.experimentalGroup === 'self-selected' ? 'Group A (Self-Selected)' : 'Group B (System-Selected)',
        });

        this.ui.updatePhaseBar(false);
        this.ui.showScreen('screen-session1-complete');

        // Auto-download backup
        this.data.exportJSON(`amlt_${this.participantId}_session1_backup.json`);
        
        // Sync to sheet
        this.data.syncToGoogleSheets(p);
    }

    // ─── Retention Test Flow ──────────────────────────────────────
    async _runRetentionTrial() {
        if (this.currentTrialIndex >= 3) {
            this._finishStudyConfirm();
            return;
        }

        if (this.instrument === 'recorder') {
            this.currentSequence = RECORDER_SEQUENCES.level3; // ['C', 'F', 'A', 'D', 'G']
        } else {
            this.currentSequence = PIANO_SEQUENCES.level3; // [1, 3, 2, 6, 4]
        }
        this.currentLevel = 'level3';
        this.currentAttempt = 0;
        this.currentModality = 'none'; // No cues

        document.getElementById('retention-trial-counter').textContent =
            `Trial ${this.currentTrialIndex + 1} / 3`;

        document.getElementById('retention-sequence-name').textContent =
            `Recall Trial ${this.currentTrialIndex + 1}`;

        this.ui.updateTrialInfo('retention-', {
            level: '3',
            orderScore: '—',
            timingScore: '—',
            combinedScore: '—',
        });

        this.ui.resetFingers('retention-');
        this.ui.updateUserSequenceDisplay('retention-user-sequence', []);
        
        await this._startInputCollection();
    }

    // ─── Study Complete ───────────────────────────────────────────
    async _finishStudy() {
        const p = this.data.participantData;

        // Compute retention scores
        const retTrials = p.session2Trials;
        if (retTrials.length > 0) {
            const retOrder = retTrials.reduce((s, t) => s + t.orderAccuracy, 0) / retTrials.length;
            const retTiming = retTrials.reduce((s, t) => s + t.timingAccuracy, 0) / retTrials.length;
            const retCombined = retTrials.reduce((s, t) => s + t.combinedScore, 0) / retTrials.length;
            this.data.setRetentionScores({ orderAccuracy: retOrder, timingAccuracy: retTiming, combined: retCombined });
        }

        // Training averages
        const trainTrials = p.session1Trials.filter(t => t.phase === 'training');
        const trainOrder = trainTrials.length > 0 ? trainTrials.reduce((s, t) => s + t.orderAccuracy, 0) / trainTrials.length : 0;
        const trainTiming = trainTrials.length > 0 ? trainTrials.reduce((s, t) => s + t.timingAccuracy, 0) / trainTrials.length : 0;
        const trainCombined = trainTrials.length > 0 ? trainTrials.reduce((s, t) => s + t.combinedScore, 0) / trainTrials.length : 0;

        let daysBetween = 0;
        if (p.session1Date && p.session2Date) {
            daysBetween = Math.round((new Date(p.session2Date) - new Date(p.session1Date)) / (1000 * 60 * 60 * 24));
        }

        this.ui.updateFinalResults({
            visualScore: p.modalityScores.visual?.composite || 0,
            audioScore: p.modalityScores.audio?.composite || 0,
            hapticScore: p.modalityScores.haptic?.composite || 0,
            visualHapticScore: p.modalityScores['visual-haptic']?.composite || 0,
            trainingOrder: `${(trainOrder * 100).toFixed(0)}%`,
            trainingTiming: `${(trainTiming * 100).toFixed(0)}%`,
            trainingCombined: `${(trainCombined * 100).toFixed(0)}%`,
            trainingModality: p.activeModality ? p.activeModality.charAt(0).toUpperCase() + p.activeModality.slice(1) : 'N/A',
            selectionMethod: p.experimentalGroup === 'self-selected' ? 'Self-Selected (Group A)' : 'System-Selected (Group B)',
            retentionOrder: `${(p.retentionScores?.orderAccuracy * 100 || 0).toFixed(0)}%`,
            retentionTiming: `${(p.retentionScores?.timingAccuracy * 100 || 0).toFixed(0)}%`,
            retentionCombined: `${(p.retentionScores?.combined * 100 || 0).toFixed(0)}%`,
            daysBetween: `${daysBetween} day${daysBetween !== 1 ? 's' : ''}`,
        });

        this.ui.showScreen('screen-final-results');
        this._stopSessionTimer();

        // Auto-export JSON
        this.data.exportJSON(`amlt_${this.participantId}_full_study_backup.json`);
        
        // Sync to sheets
        await this.data.syncToGoogleSheets(p);
    }

    // ─── Core Sequence Presentation → Input Collection → Evaluation ──
    async _presentAndCollect() {
        this.currentAttempt++;

        // Reset input state
        this.userInputs = [];
        this.userTimestamps = [];
        this.userSpreadHistory = [];
        this.isCollectingInput = false;
        if (this.recorderDetector) this.recorderDetector.reset();

        const prefix = this._getFingerPrefix();
        this.ui.resetFingers(prefix);
        this.ui.updateUserSequenceDisplay(this._getUserSequenceDisplayId(), []);

        const maxAttempts = this.currentPhase === 'retention' ? 1 : 3;

        // Update trial info
        const trialInfoPrefix = this._getTrialInfoPrefix();
        this.ui.updateTrialInfo(trialInfoPrefix, {
            level: this.currentLevel.replace('level', ''),
            modality: this.currentModality?.charAt(0).toUpperCase() + this.currentModality?.slice(1),
            attempt: `${this.currentAttempt} / ${maxAttempts}`,
            orderScore: '—',
            timingScore: '—',
            combinedScore: '—',
        });

        // Set status badge to Wait
        const badgeId = this._getStatusBadgeId();
        const badge = document.getElementById(badgeId);
        if (badge) {
            badge.textContent = "⚠️ WATCH & FEEL";
            badge.className = "status-badge wait";
        }

        // Present the sequence using the current modality
        const displayId = this._getSequenceDisplayId();
        const instrId = this._getInstructionId();

        await this.modality.presentSequence(this.currentModality, this.currentSequence, displayId, instrId, this.instrument);

        this.presentationEndTime = Date.now();

        // Start collecting input
        await this._startInputCollection();
    }

    async _startInputCollection() {
        // Play start beep: a 100ms high-pitched note (880Hz)
        if (this.audio && this.audio.ctx) {
            try {
                const osc = this.audio.ctx.createOscillator();
                const gain = this.audio.ctx.createGain();
                osc.type = 'sine';
                osc.frequency.setValueAtTime(880, this.audio.ctx.currentTime);
                gain.gain.setValueAtTime(0.15, this.audio.ctx.currentTime);
                gain.gain.exponentialRampToValueAtTime(0.01, this.audio.ctx.currentTime + 0.1);
                osc.connect(gain);
                gain.connect(this.audio.ctx.destination);
                osc.start();
                osc.stop(this.audio.ctx.currentTime + 0.1);
            } catch (e) {
                console.error("Error playing start beep", e);
            }
        }

        // Small delay for beep to finish
        await new Promise(r => setTimeout(r, 100));

        // Switch badge to Go
        const badgeId = this._getStatusBadgeId();
        const badge = document.getElementById(badgeId);
        if (badge) {
            badge.textContent = "🟢 GO! (Your Turn)";
            badge.className = "status-badge go";
        }

        if (this.recorderDetector) {
            this.recorderDetector.reset();
            this.recorderDetector.isActive = true;
        }
        this.userInputs = [];
        this.userTimestamps = [];
        this.userSpreadHistory = [];
        this.isCollectingInput = true;

        if (this.currentModality === 'visual') {
            const displayId = this._getSequenceDisplayId();
            this.ui.updateVisualReproduction(displayId, 0);
        }

        // Set timeout for input
        if (this.inputTimeout) clearTimeout(this.inputTimeout);
        this.inputTimeout = setTimeout(() => {
            if (this.isCollectingInput) {
                this._evaluateAttempt();
            }
        }, INPUT_TIMEOUT);
    }

    _evaluateAttempt() {
        this.isCollectingInput = false;
        if (this.recorderDetector) this.recorderDetector.isActive = false;
        if (this.inputTimeout) clearTimeout(this.inputTimeout);

        // Score the attempt
        const result = scoreAttempt(this.currentSequence, this.userInputs, this.userTimestamps, this.instrument, TARGET_INTER_NOTE);

        // Calculate response time
        const responseTimeMs = this.userTimestamps.length > 0
            ? Math.max(0, this.userTimestamps[0] - this.presentationEndTime)
            : INPUT_TIMEOUT;
        const completionTimeMs = this.userTimestamps.length >= 2
            ? Math.max(0, this.userTimestamps[this.userTimestamps.length - 1] - this.userTimestamps[0])
            : 0;

        // Determine success based on phase
        let isGoodEnough = false;
        if (this.currentPhase === 'training') {
            // Success in training is 100% order accuracy + >= 70% timing accuracy
            isGoodEnough = result.orderAccuracy === 1.0 && result.timingAccuracy >= 0.70;
            if (isGoodEnough) {
                this.successfulTrainingRuns++;
                this.consecutiveFailures = 0;
            } else {
                if (this.group === 'system-selected') {
                    this.consecutiveFailures++;
                    if (this.consecutiveFailures >= 2) {
                        this._triggerAdaptiveModalityShift();
                        this.consecutiveFailures = 0;
                    }
                }
            }
        } else {
            isGoodEnough = result.combinedScore >= 0.70; // 70% threshold
        }

        // Record the trial
        const trialRecord = this.data.recordTrial({
            instrument: this.instrument,
            sessionNumber: this.currentPhase === 'retention' ? 2 : 1,
            phase: this.currentPhase,
            modality: this.currentModality,
            level: parseInt(this.currentLevel.replace('level', '')),
            targetSequence: [...this.currentSequence],
            userSequence: [...this.userInputs],
            orderAccuracy: result.orderAccuracy,
            timingAccuracy: result.timingAccuracy,
            combinedScore: result.combinedScore,
            passed: isGoodEnough,
            responseTimeMs,
            completionTimeMs,
            userInterNoteTimings: result.interNoteTimings,
            errors: result.errors,
            attemptsOnThisSequence: this.currentAttempt,
            fingerTimestamps: [...this.userTimestamps],
            synchronySpreads: [...this.userSpreadHistory],
        });

        const maxAttempts = this.currentPhase === 'retention' ? 1 : 3;

        // Update UI with scores
        const trialInfoPrefix = this._getTrialInfoPrefix();
        this.ui.updateTrialInfo(trialInfoPrefix, {
            level: this.currentLevel.replace('level', ''),
            modality: this.currentModality?.charAt(0).toUpperCase() + this.currentModality?.slice(1),
            attempt: `${this.currentAttempt} / ${maxAttempts}`,
            orderScore: `${(result.orderAccuracy * 100).toFixed(0)}%`,
            timingScore: `${(result.timingAccuracy * 100).toFixed(0)}%`,
            combinedScore: `${(result.combinedScore * 100).toFixed(0)}%`,
        });

        // Add to attempt history
        const seqFormatted = this.currentSequence.map(item => typeof item === 'number' ? (FINGER_NOTES[item] || item) : item).join(' → ');
        this.ui.addAttemptHistoryItem(this._getAttemptHistoryId(), {
            correct: isGoodEnough,
            sequence: seqFormatted,
            orderAcc: result.orderAccuracy,
            timingAcc: result.timingAccuracy,
            combined: result.combinedScore,
            responseTime: responseTimeMs,
        });

        // Play feedback
        this.audio.playFeedback(isGoodEnough);

        // Decide next action
        setTimeout(() => {
            if (isGoodEnough || this.currentAttempt >= maxAttempts) {
                // Move to next sequence
                this.currentTrialIndex++;
                this.currentAttempt = 0;

                if (this.currentPhase === 'profiling') {
                    this._runProfilingTrial();
                } else if (this.currentPhase === 'training') {
                    this._runTrainingTrial();
                } else if (this.currentPhase === 'retention') {
                    this._runRetentionTrial();
                }
            } else {
                // Retry the same sequence
                this._presentAndCollect();
            }
        }, 1500);
    }

    _triggerAdaptiveModalityShift() {
        const scores = this.data.participantData?.modalityScores || {};
        const systemSelected = scores.bestModality || 'visual-haptic';
        
        let newMod = systemSelected;
        let msg = '';

        if (this.currentModality !== systemSelected) {
            newMod = systemSelected;
            msg = `⚡ Adaptive Assist Engaged: Shifted to your strongest modality (${newMod.toUpperCase()}) based on profiling!`;
        } else {
            // Already on their best modality, fall back to 2nd best
            const sortedMods = ['visual', 'audio', 'haptic', 'visual-haptic'].sort((a, b) => (scores[b]?.composite || 0) - (scores[a]?.composite || 0));
            newMod = sortedMods[1] || 'haptic';
            msg = `⚡ Adaptive Assist Engaged: Shifted to your alternate modality (${newMod.toUpperCase()})!`;
        }

        this.currentModality = newMod;
        if (this.data.participantData) {
            this.data.participantData.activeModality = newMod;
            this.data.participantData.adaptationTriggered = true;
            this.data._save();
        }

        this.ui.setModalityLabel('training-modality-label', newMod);

        const banner = document.getElementById('adaptive-assist-banner');
        const textEl = document.getElementById('adaptive-assist-text');
        if (banner && textEl) {
            textEl.textContent = msg;
            banner.classList.remove('hidden');
        }
        this.ui.showToast(msg);
    }

    // ─── Replay ───────────────────────────────────────────────────
    async _replaySequence() {
        if (!this.currentSequence.length) return;
        this.isCollectingInput = false;
        if (this.inputTimeout) clearTimeout(this.inputTimeout);

        const displayId = this._getSequenceDisplayId();
        const instrId = this._getInstructionId();
        await this.modality.presentSequence(this.currentModality, this.currentSequence, displayId, instrId);

        this.presentationEndTime = Date.now();
        this._startInputCollection();
    }

    // ─── Stop and Resume Session ──────────────────────────────────
    _handleStopClick() {
        this.isCollectingInput = false;
        if (this.inputTimeout) clearTimeout(this.inputTimeout);
        this.serial.stopAllMotors();

        const modal = document.getElementById('stop-dialog');
        if (modal) {
            modal.classList.remove('hidden');
        }
    }

    _resumeSession() {
        const modal = document.getElementById('stop-dialog');
        if (modal) {
            modal.classList.add('hidden');
        }
        
        this.isCollectingInput = true;
        this.presentationEndTime = Date.now();
        
        if (this.inputTimeout) clearTimeout(this.inputTimeout);
        this.inputTimeout = setTimeout(() => {
            if (this.isCollectingInput) {
                this._evaluateAttempt();
            }
        }, INPUT_TIMEOUT);
    }

    _stopSession(saveData) {
        const modal = document.getElementById('stop-dialog');
        if (modal) {
            modal.classList.add('hidden');
        }

        if (this.inputTimeout) clearTimeout(this.inputTimeout);
        this.isCollectingInput = false;
        this.serial.stopAllMotors();
        this._stopSessionTimer();

        if (saveData) {
            if (this.currentPhase === 'retention') {
                this._finishStudy();
            } else {
                this._finishSession1();
            }
        } else {
            if (this.currentPhase !== 'retention') {
                if (this.participantId) {
                    localStorage.removeItem(`amlt_data_${this.participantId}`);
                }
            }
            window.location.reload();
        }
    }

    // ─── Session Timer ────────────────────────────────────────────
    _startSessionTimer() {
        this.sessionStartTime = Date.now();
        if (this.sessionTimerInterval) clearInterval(this.sessionTimerInterval);
        this.sessionTimerInterval = setInterval(() => {
            const elapsed = Date.now() - this.sessionStartTime;
            this.ui.updateSessionTimer(elapsed);
        }, 1000);
    }

    _stopSessionTimer() {
        if (this.sessionTimerInterval) clearInterval(this.sessionTimerInterval);
    }

    _getStatusBadgeId() {
        switch (this.currentPhase) {
            case 'training': return 'training-status-badge';
            case 'retention': return 'retention-status-badge';
            default: return 'profiling-status-badge';
        }
    }

    _populateReturningDropdown() {
        const select = document.getElementById('returning-participant-select');
        if (!select) return;
        
        select.innerHTML = '<option value="">-- Select Completed Day 1 Participant --</option>';
        
        for (let i = 0; i < localStorage.length; i++) {
            const key = localStorage.key(i);
            if (key && key.startsWith('amlt_data_')) {
                try {
                    const data = JSON.parse(localStorage.getItem(key));
                    if (data && data.session1Trials && data.session1Trials.length > 0 && !data.studyComplete) {
                        const name = data.name || data.participantId;
                        const opt = document.createElement('option');
                        opt.value = data.participantId;
                        opt.textContent = `${name} (${data.participantId})`;
                        select.appendChild(opt);
                    }
                } catch (e) {
                    console.error("Error parsing participant data from localStorage:", e);
                }
            }
        }
    }

    _openDashboard() {
        const modal = document.getElementById('researcher-dashboard');
        if (!modal) return;
        
        modal.classList.remove('hidden');
        this._renderDashboardList();
    }

    _renderDashboardList() {
        const listContainer = document.getElementById('dashboard-participant-list');
        if (!listContainer) return;
        
        let participants = this.data.getAllParticipants(this.dashboardTab);
        
        if (this.dashboardSubTab !== 'all') {
            participants = participants.filter(p => p.experimentalGroup === this.dashboardSubTab);
        }

        listContainer.innerHTML = '';
        
        if (participants.length === 0) {
            listContainer.innerHTML = '<tr><td colspan="4" class="text-muted" style="text-align:center; padding:1.5rem;">No participant data found for this study group.</td></tr>';
            document.getElementById('dashboard-detail-view').innerHTML = '<div class="text-muted" style="text-align:center; margin-top:3rem;">Select a participant from the list to view detailed trial history and edit notes.</div>';
            return;
        }
        
        participants.forEach(p => {
            const tr = document.createElement('tr');
            tr.setAttribute('data-id', p.participantId);
            
            const nameCell = document.createElement('td');
            nameCell.style.padding = '0.5rem';
            if (this.dashboardTab === 'pilot') {
                nameCell.innerHTML = `<strong>${p.name || 'N/A'}</strong><br><span class="text-muted" style="font-size:0.75rem;">${p.participantId}</span>`;
            } else {
                nameCell.innerHTML = `<strong>${p.participantId}</strong>`;
            }
            
            const infoCell = document.createElement('td');
            infoCell.style.padding = '0.5rem';
            if (this.dashboardTab === 'pilot') {
                infoCell.textContent = p.age || 'N/A';
            } else {
                infoCell.innerHTML = `<span style="font-size:0.8rem;color:var(--text-secondary);">${p.expectedModality || 'unsure'}</span>`;
            }
            
            const groupCell = document.createElement('td');
            groupCell.style.padding = '0.5rem';
            groupCell.textContent = p.experimentalGroup === 'self-selected' ? 'Group A' : 'Group B';
            
            const modCell = document.createElement('td');
            modCell.style.padding = '0.5rem';
            modCell.textContent = p.activeModality ? p.activeModality.charAt(0).toUpperCase() + p.activeModality.slice(1) : 'None';
            
            tr.appendChild(nameCell);
            tr.appendChild(infoCell);
            tr.appendChild(groupCell);
            tr.appendChild(modCell);
            
            tr.addEventListener('click', () => {
                document.querySelectorAll('#dashboard-participant-list tr').forEach(row => row.classList.remove('selected'));
                tr.classList.add('selected');
                this._renderDashboardDetail(p.participantId);
            });
            
            listContainer.appendChild(tr);
        });
    }

    _renderDashboardDetail(participantId) {
        const detailContainer = document.getElementById('dashboard-detail-view');
        if (!detailContainer) return;
        
        const p = this.data.loadParticipant(participantId);
        if (!p) {
            detailContainer.innerHTML = '<div class="text-muted" style="text-align:center; margin-top:3rem;">Error loading participant.</div>';
            return;
        }
        
        const ms = p.modalityScores || {};
        const allTrials = [...(p.session1Trials || []), ...(p.session2Trials || [])];
        
        let trialsHtml = '';
        if (allTrials.length === 0) {
            trialsHtml = '<p class="text-muted">No trials recorded yet.</p>';
        } else {
            trialsHtml = `
                <table class="dashboard-trial-table">
                    <thead>
                        <tr style="border-bottom:1px solid var(--border); color:var(--text-secondary);">
                            <th>Session</th>
                            <th>Phase</th>
                            <th>Modality</th>
                            <th>Level</th>
                            <th>Target</th>
                            <th>User</th>
                            <th>Order</th>
                            <th>Timing</th>
                            <th>Combined</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${allTrials.map(t => `
                            <tr>
                                <td>S${t.sessionNumber}</td>
                                <td>${t.phase}</td>
                                <td>${t.modality}</td>
                                <td>${t.level}</td>
                                <td>${t.targetSequence.join('-')}</td>
                                <td>${t.userSequence.join('-')}</td>
                                <td style="color:${t.orderAccuracy >= 0.9 ? 'var(--success)' : 'var(--text-primary)'}">${(t.orderAccuracy*100).toFixed(0)}%</td>
                                <td>${(t.timingAccuracy*100).toFixed(0)}%</td>
                                <td>${(t.combinedScore*100).toFixed(0)}%</td>
                            </tr>
                        `).join('')}
                    </tbody>
                </table>
            `;
        }
        
        detailContainer.innerHTML = `
            <div style="background:var(--bg-tertiary); padding:1rem; border-radius:8px; border:1px solid var(--border); font-size:0.85rem;">
                <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:0.5rem;">
                    <strong>ID: ${p.participantId}</strong>
                    <button class="btn btn-danger" id="dashboard-delete-p-btn" style="padding:0.2rem 0.6rem; font-size:0.75rem;">Delete Participant</button>
                </div>
                <div style="display:grid; grid-template-columns:1fr 1fr; gap:0.5rem; margin-top:0.5rem; color:var(--text-secondary);">
                    <div>Instrument: <span style="color:var(--text-primary); font-weight:600; text-transform:capitalize;">${p.instrument || 'piano'}</span></div>
                    <div>Prior Wind Exp: <span style="color:var(--text-primary); font-weight:500;">${p.priorWindExperience || 'none'}</span></div>
                    ${this.dashboardTab === 'pilot' ? `
                    <div>Name: <span style="color:var(--text-primary); font-weight:500;">${p.name || 'N/A'}</span></div>
                    <div>Age: <span style="color:var(--text-primary); font-weight:500;">${p.age || 'N/A'}</span></div>
                    ` : `
                    <div>Expected Modality: <span style="color:var(--text-primary); font-weight:500;">${p.expectedModality || 'unsure'}</span></div>
                    `}
                    <div>Dominant Hand: <span style="color:var(--text-primary); font-weight:500;">${p.dominantHand ? p.dominantHand.charAt(0).toUpperCase() + p.dominantHand.slice(1) : 'N/A'}</span></div>
                    <div>Experience: <span style="color:var(--text-primary); font-weight:500;">${p.priorExperience || 'none'}</span></div>
                    <div>Group: <span style="color:var(--text-primary); font-weight:500;">${p.experimentalGroup === 'self-selected' ? 'Group A (Self)' : 'Group B (System)'}</span></div>
                    <div>Active Modality: <span style="color:var(--text-primary); font-weight:500;">${p.activeModality || 'None'}</span></div>
                    <div>Status: <span style="color:${p.studyComplete ? 'var(--success)' : 'var(--warning)'}; font-weight:600;">${p.studyComplete ? 'Completed' : 'Session 1 Complete'}</span></div>
                    <div>Adaptation Shifted: <span style="color:${p.adaptationTriggered ? 'var(--warning)' : 'var(--text-primary)'}; font-weight:600;">${p.adaptationTriggered ? '⚡ Yes' : 'No'}</span></div>
                </div>
                <div style="display:grid; grid-template-columns:repeat(4, 1fr); gap:0.5rem; margin-top:0.8rem; padding-top:0.8rem; border-top:1px solid var(--border);">
                    <div style="text-align:center;">
                        <span style="font-size:0.75rem; color:var(--text-muted);">Visual Score</span><br>
                        <strong>${ms.visual?.composite || 0}</strong>
                    </div>
                    <div style="text-align:center;">
                        <span style="font-size:0.75rem; color:var(--text-muted);">Audio Score</span><br>
                        <strong>${ms.audio?.composite || 0}</strong>
                    </div>
                    <div style="text-align:center;">
                        <span style="font-size:0.75rem; color:var(--text-muted);">Haptic Score</span><br>
                        <strong>${ms.haptic?.composite || 0}</strong>
                    </div>
                    <div style="text-align:center;">
                        <span style="font-size:0.75rem; color:var(--text-muted);">Vis+Hap Score</span><br>
                        <strong>${ms['visual-haptic']?.composite || 0}</strong>
                    </div>
                </div>
            </div>
            
            <div>
                <label style="font-size:0.85rem; font-weight:600; margin-bottom:0.3rem; display:block; color:var(--text-secondary);">Researcher Notes</label>
                <textarea class="dashboard-notes-textarea" id="dashboard-notes-input" placeholder="Enter notes here (hand size, distractions, notes during trials...)...">${p.notes || ''}</textarea>
            </div>
            
            <div>
                <label style="font-size:0.85rem; font-weight:600; margin-bottom:0.5rem; display:block; color:var(--text-secondary);">Trial History</label>
                <div style="max-height:220px; overflow-y:auto; border:1px solid var(--border); border-radius:8px; padding:0.5rem; background:var(--bg-tertiary);">
                    ${trialsHtml}
                </div>
            </div>
        `;
        
        const notesInput = document.getElementById('dashboard-notes-input');
        if (notesInput) {
            notesInput.addEventListener('input', (e) => {
                this.data.updateParticipantNotes(participantId, e.target.value);
            });
        }
        
        const delBtn = document.getElementById('dashboard-delete-p-btn');
        if (delBtn) {
            delBtn.addEventListener('click', () => {
                if (confirm(`Are you sure you want to delete participant ${p.name || p.participantId}? This cannot be undone.`)) {
                    this.data.deleteParticipant(participantId);
                    this.ui.showToast(`Deleted ${p.name || participantId}`);
                    this._renderDashboardList();
                }
            });
        }
    }

    _handleDashboardImport(event) {
        const file = event.target.files[0];
        if (!file) return;
        
        const reader = new FileReader();
        reader.onload = (e) => {
            try {
                const data = JSON.parse(e.target.result);
                if (data && data.participantId) {
                    this.data.restoreFromBackup(data);
                    this.ui.showToast(`Imported data for ${data.name || data.participantId}!`);
                    this._renderDashboardList();
                } else {
                    this.ui.showToast('Invalid backup JSON format.');
                }
            } catch (err) {
                this.ui.showToast('Failed to parse JSON.');
            }
        };
        reader.readAsText(file);
        event.target.value = '';
    }

    _handleDeleteAllData() {
        if (confirm('⚠️ WARNING: Are you sure you want to delete ALL research data across all participants? This is permanent and cannot be undone.')) {
            const keysToDelete = [];
            for (let i = 0; i < localStorage.length; i++) {
                const key = localStorage.key(i);
                if (key && key.startsWith('amlt_data_')) {
                    keysToDelete.push(key);
                }
            }
            keysToDelete.forEach(k => localStorage.removeItem(k));
            this.ui.showToast('All participant data deleted.');
            this._renderDashboardList();
        }
    }

    _finishSession1Confirm() {
        this._stopSessionTimer();
        const modal = document.getElementById('save-confirmation-dialog');
        const nameConfirm = document.getElementById('save-confirm-name');
        const idConfirm = document.getElementById('save-confirm-id');
        if (modal && nameConfirm && idConfirm) {
            nameConfirm.textContent = this.data.participantData.name || 'Jane Doe';
            idConfirm.textContent = this.participantId;
            modal.classList.remove('hidden');
        }
        this.saveConfirmationMode = 'session1';
    }

    _finishStudyConfirm() {
        this._stopSessionTimer();
        const modal = document.getElementById('save-confirmation-dialog');
        const nameConfirm = document.getElementById('save-confirm-name');
        const idConfirm = document.getElementById('save-confirm-id');
        if (modal && nameConfirm && idConfirm) {
            nameConfirm.textContent = this.data.participantData.name || 'Jane Doe';
            idConfirm.textContent = this.participantId;
            modal.classList.remove('hidden');
        }
        this.saveConfirmationMode = 'study';
    }

    async _handleSaveConfirm(saveData) {
        const modal = document.getElementById('save-confirmation-dialog');
        if (modal) modal.classList.add('hidden');
        
        if (saveData) {
            if (this.saveConfirmationMode === 'session1') {
                this._finishSession1();
            } else if (this.saveConfirmationMode === 'study') {
                this._finishStudy();
            }
        } else {
            if (this.saveConfirmationMode === 'session1') {
                if (this.participantId) {
                    localStorage.removeItem(`amlt_data_${this.participantId}`);
                }
            } else {
                const loaded = this.data.loadParticipant(this.participantId);
                if (loaded) {
                    loaded.session2Trials = [];
                    loaded.session2Date = null;
                    loaded.retentionScores = null;
                    loaded.studyComplete = false;
                    localStorage.setItem(`amlt_data_${this.participantId}`, JSON.stringify(loaded));
                }
            }
            window.location.reload();
        }
    }
}


// ═══════════════════════════════════════════════════════════════════════
//  INITIALIZATION
// ═══════════════════════════════════════════════════════════════════════
if ('serial' in navigator) {
    const app = new AppController();
} else {
    document.body.innerHTML = `
        <div style="display:flex;align-items:center;justify-content:center;height:100vh;
                    background:#0a0e27;color:#e8eaf6;font-family:Inter,sans-serif;text-align:center;padding:2rem;">
            <div>
                <h1 style="font-size:2rem;margin-bottom:1rem;">Web Serial API Not Supported</h1>
                <p style="color:#9fa8da;">Please open this application in <strong>Google Chrome</strong> or <strong>Microsoft Edge</strong>.</p>
            </div>
        </div>
    `;
}
