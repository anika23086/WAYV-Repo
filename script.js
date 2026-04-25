
if ("serial" in navigator) {
    // DataCollector class remains the same.
    class DataCollector {
        constructor() {
            this.sessionId = Date.now();
            this.attemptHistory = [];
            this.errorRates = {};
            this.sessionLog = []; 


        }

        startNewAttempt(letter) {
            this.lastPromptTime = Date.now();
            if (!this.errorRates[letter]) {
                this.errorRates[letter] = { attempts: 0, errors: 0 };
            }
        }

        recordResponse(isCorrect, letter) {
            const latency = (Date.now() - this.lastPromptTime) / 1000; // Latency in seconds
            if (!this.errorRates[letter]) {
            this.errorRates[letter] = { attempts: 0, errors: 0 };
        }

            this.errorRates[letter].attempts++;
            if (!isCorrect) {
                this.errorRates[letter].errors++;
            }
            this.attemptHistory.unshift({
                letter: letter.toUpperCase(),
                time: latency ,
                correct: isCorrect,
                timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
            });
            if (this.attemptHistory.length > 5) this.attemptHistory.pop();
        }

        getErrorRate(letter) {
            const rateInfo = this.errorRates[letter.toLowerCase()];
            if (!rateInfo || rateInfo.attempts === 0) return { rate: 0, attempts: 0, errors: 0 };
            return {
                rate: (rateInfo.errors / rateInfo.attempts) * 100,
                attempts: rateInfo.attempts,
                errors: rateInfo.errors
            };
        }
        
        getFocusAreas() {
            return Object.entries(this.errorRates)
                .map(([letter, data]) => ({ letter, ...data, errorRate: data.attempts > 0 ? (data.errors / data.attempts) * 100 : 0 }))
                .filter(item => item.errors > 0)
                .sort((a, b) => b.errorRate - a.errorRate)
                .slice(0, 3);
        }

        saveToCSV() {
            if (this.attemptHistory.length === 0) {
                alert("No session data to export.");
                return;
            }
            let csvContent = "data:text/csv;charset=utf-8,";
            csvContent += "Timestamp,Letter,IsCorrect,ResponseTime(s)\r\n"; // Header

            this.attemptHistory.forEach(attempt => {
                const row = `${attempt.timestamp},${attempt.letter},${attempt.correct},${attempt.time.toFixed(2)}`;
                csvContent += row + "\r\n";
            });

            const encodedUri = encodeURI(csvContent);
            const link = document.createElement("a");
            link.setAttribute("href", encodedUri);
            link.setAttribute("download", `wayv_session_${this.sessionId}.csv`);
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
        }
    }

    class EnhancedBrailleTeacher {
        constructor() {
            // State and Hardware
            this.port = null;
            this.writer = null;
            this.reader = null;
            this.promptTimeout = null;
            this.lastProcessedGesture = null;


            // Session and Mode Control
            this.mode = "learning"; // Default mode
            this.isPaused = false;
            this.recognition = null;
            this.sessionStartTime = null;
            this.sessionTimerInterval = null;
            
            // Data & Gamification
            this.dataCollector = new DataCollector();
            this.correctStreak = 0;
            this.bestStreak = 0;
            this.correctInputs = 0;
            this.totalInputs = 0;
            this.masteredLetters = new Set();
            
            // Content
            // this.alphabet = "abcdefghijklmnopqrstuvwxyz".split("");
            this.alphabet = ["a", "b", "c", "d", "e", "f", "g", "h", "i", "j", "k", "l", "m", "n", "o", "p", "q", "r", "s", "t", "u", "v", "w", "x", "y", "z"];
            this.words = ["cat", "bat", "sun", "moon", "star", "tree", "ice", "bee"];
            this.currentLetterIndex = 0;
            this.currentWordIndex = 0;
            this.currentWordLetterIndex = 0;
            this.alphabetFolds = { "a": [1], "b": [1, 2], "c": [1, 4], "d": [1, 4, 5], "e": [1, 5], "f": [1, 2, 4], "g": [1, 2, 4, 5], "h": [1, 2, 5], "i": [2, 4], "j": [2, 4, 5], "k": [1, 3], "l": [1, 2, 3], "m": [1, 3, 4], "n": [1, 3, 4, 5], "o": [1, 3, 5], "p": [1, 2, 3, 4], "q": [1, 2, 3, 4, 5], "r": [1, 2, 3, 5], "s": [2, 3, 4], "t": [2, 3, 4, 5], "u": [1, 3, 6], "v": [1, 2, 3, 6], "w": [2, 4, 5, 6], "x": [1, 3, 4, 6], "y": [1, 3, 4, 5, 6], "z": [1, 3, 5, 6] };
            
            // MODIFICATION: Voice commands are now always on by default.
            this.isListening = true; 

            this.initializeUI();
            this.initializeEventListeners();
            this.initializeSpeechRecognition();
            
            // MODIFICATION: Start listening immediately on page load and inform the user.
            if (this.isListening && this.recognition) {
                this.recognition.start();
                this.speak("Voice commands are active. Please connect your device to begin.");
                document.getElementById('voice-status').textContent = 'Active';
                document.getElementById('voice-status').style.color = '#2ecc71';
            }
        }

        initializeUI() {
            this.updateMasteryPath();
            this.updateAllStats();
        }

        initializeEventListeners() {
            document.getElementById("connectBtn").addEventListener("click", () => this.connectToSerial());
            document.getElementById("modeSelect").addEventListener("change", (e) => this.switchMode(e.target.value));
            document.getElementById("endBtn").addEventListener("click", () => this.endSession());
            // MODIFICATION: The voice button is no longer needed to toggle functionality.
            // It can be removed from HTML or just have its listener removed.
            // document.getElementById("voiceBtn").addEventListener("click", () => this.toggleVoiceControl());
            document.getElementById("downloadBtn").addEventListener("click", () => this.dataCollector.saveToCSV());
            document.getElementById("repeatBtn").addEventListener("click", () => this.handleRepeatCommand());
            document.getElementById("hintBtn").addEventListener("click", () => this.provideHint());
            document.getElementById("skipBtn").addEventListener("click", () => this.skipPrompt());
            document.getElementById("pauseResumeBtn").addEventListener("click", () => this.togglePause());
            document.getElementById("progressBtn").addEventListener("click", () => this.handleProgressQuery());
        }
        async endSession() {
    // 1. Download the CSV automatically
            this.dataCollector.saveToCSV();

            // 2. Stop the session timer
            if (this.sessionTimerInterval) clearInterval(this.sessionTimerInterval);

            // 3. Close Serial Connection if it exists
            try {
                if (this.reader) {
                    await this.reader.cancel();
                    this.reader.releaseLock();
                }
                if (this.writer) {
                    this.writer.releaseLock();
                }
                if (this.port) {
                    await this.port.close();
                }
            } catch (e) {
                console.log("Connection cleanup:", e);
            }

            // 4. Reset Class State
            this.port = null;
            this.writer = null;
            this.reader = null;
            this.isPaused = false;
            this.currentLetterIndex = 0;
            this.masteredLetters = new Set();
            this.correctInputs = 0;
            this.totalInputs = 0;
            
            // 5. Reset UI to initial state
            document.getElementById('connectionStatus').textContent = '● Disconnected';
            document.getElementById('connectionStatus').className = 'disconnected';
            document.getElementById('sessionTime').textContent = 'Session: 00m 00s';
            document.getElementById('current-word-display').textContent = '-';
            this.updateAllStats();
            this.updateMasteryPath();

            // 6. Voice prompt for the user to reconnect
            this.speak("Session ended. Data has been exported. Please connect your device again to start a new session.");
        }
        
        async connectToSerial() {
            try {
                this.port = await navigator.serial.requestPort();
                await this.port.open({ baudRate: 9600 });
                this.writer = this.port.writable.getWriter();
                this.reader = this.port.readable.getReader();

                document.getElementById('connectionStatus').textContent = '● Connected';
                document.getElementById('connectionStatus').className = 'connected';
                this.sessionStartTime = Date.now();
                this.startSessionTimer();
                
                // MODIFICATION: New, streamlined introduction flow as requested.
                await this.speak("Device connected. Voice commands are now fully active.");
                await this.playIntroduction();
                await this.speak("Let's start with learning mode.");
                
                this.readSerialLoop(); // Start listening for glove input
                this.nextPrompt();     // Give the first prompt ('A')

            } catch (error) { 
                console.error(`Connection failed: ${error}`);
                this.speak("There was an error connecting to the device.");
            }
        }

        async playIntroduction() {
            const fingers = [
                { num: 1, desc: "left ring finger" }, { num: 2, desc: "left middle finger" },
                { num: 3, desc: "left index finger" }, { num: 4, desc: "right index finger" },
                { num: 5, desc: "right middle finger" }, { num: 6, desc: "right ring finger" }
            ];
            await this.speak("Let me introduce the finger mappings.");
            for (const finger of fingers) {
                await this.speak(`Finger ${finger.num} is your ${finger.desc}.`);
                await this.writeToSerial(String(finger.num));
                await new Promise(resolve => setTimeout(resolve, 500));
            }
            await this.speak("Introduction complete.");
        }        

        async writeToSerial(data) {
            if (this.writer) {
                try {
                    const encoder = new TextEncoder();
                    await this.writer.write(encoder.encode(data));
                } catch (error) {
                    console.error("Error writing to serial port:", error);
                }
            }
        }

        async readSerialLoop() {
            const decoder = new TextDecoder();
            try {
                while (true) {
                    const { value, done } = await this.reader.read();
                    if (done) break;
                    const cleanValue = decoder.decode(value).replace(/[\r\n]/g, '');
                    if (cleanValue) this.handleBrailleInput(cleanValue);
                }
            } catch (error) { console.error(`Error reading data: ${error}`); }
        }

        nextPrompt() {
            if (this.isPaused) return;
            let letter;

            if (this.mode === 'learning') {
                letter = this.alphabet[this.currentLetterIndex];
                document.getElementById('current-word-display').textContent = 'A-Z Path';
            } else { // Practice Mode
                const word = this.words[this.currentWordIndex];
                letter = word[this.currentWordLetterIndex];
                document.getElementById('current-word-display').textContent = word.toUpperCase();
            }

            this.updateBraillePatternDisplay(letter);
            this.dataCollector.startNewAttempt(letter);
            const fingers = this.alphabetFolds[letter];
            this.speakWithVibration(`For ${letter.toUpperCase()}, fold ${fingers.join(' and ')}.`, fingers);
            this.updateMasteryPath();

        }

        handleBrailleInput(data) {
        if (this.isPaused || !data) return;
        if (data === this.lastProcessedGesture) {return;} // Ignore duplicate gestures
        this.lastProcessedGesture = data;

        if (this.promptTimeout) {
            clearTimeout(this.promptTimeout);
        }        
        this.totalInputs++;
        const currentLetter = this.mode === 'learning'
            ? this.alphabet[this.currentLetterIndex]
            : this.words[this.currentWordIndex][this.currentWordLetterIndex];

            // MODIFICATION: Added console log for easier debugging of glove input.
        console.log(`Received: '${data}', Expected: '${currentLetter}'`);

    const receivedChar = data.trim().toLowerCase().charAt(0);
    const isCorrect = receivedChar === currentLetter;            
    this.dataCollector.recordResponse(isCorrect, currentLetter);

            if (isCorrect) {
                this.correctInputs++;
                this.correctStreak++;
                if (this.correctStreak > this.bestStreak) this.bestStreak = this.correctStreak;
                this.handleCorrectAnswer(currentLetter);

            } else {
                this.correctStreak = 0;
                this.speak("Not quite. Let's try that letter again.");
                this.promptTimeout = setTimeout(() => this.nextPrompt(), 1200); 
            }
            this.updateAllStats();
        }

        handleCorrectAnswer(letter) {
            const { attempts } = this.dataCollector.getErrorRate(letter);
            if (attempts <= 2 && this.mode === 'learning') {
                this.masteredLetters.add(letter);
            }
            // MODIFICATION: The stray underscore causing a syntax error here has been REMOVED.
            this.speak("Correct!");

            if (this.mode === 'learning') {
                this.currentLetterIndex = (this.currentLetterIndex + 1) % this.alphabet.length;
            } else { // Practice
                this.currentWordLetterIndex++;
                if (this.currentWordLetterIndex >= this.words[this.currentWordIndex].length) {
                    this.speak(`Excellent! You spelled ${this.words[this.currentWordIndex]}.`);
                    this.currentWordLetterIndex = 0;
                    this.currentWordIndex = (this.currentWordIndex + 1) % this.words.length;
                    setTimeout(() => this.speak(`Your next word is ${this.words[this.currentWordIndex]}.`), 1000);
                }
            }
        this.promptTimeout = setTimeout(() => this.nextPrompt(), 1200);
        }

        // --- VOICE AND BUTTON COMMANDS ---
        initializeSpeechRecognition() {
            if ('webkitSpeechRecognition' in window) {
                this.recognition = new webkitSpeechRecognition();
                this.recognition.continuous = true;
                
                // FIX 1: Enable interim results to see low-confidence guesses.
                // This lets us see what the engine is "thinking" in real-time.
                this.recognition.interimResults = true; 
                
                this.recognition.lang = 'en-US';

                this.recognition.onresult = (event) => {
                    // We now loop through the results because interim results can have multiple parts.
                    let final_transcript = '';
                    for (let i = event.resultIndex; i < event.results.length; ++i) {
                        if (event.results[i].isFinal) {
                            final_transcript += event.results[i][0].transcript;
                        }
                    }
                    
                    const command = final_transcript.trim().toLowerCase();
                    if (command) { // Only process if we have a final command
                        console.log("Final command received:", command);
                        this.handleVoiceCommand(command);
                    }
                };

                this.recognition.onerror = (event) => {
                    console.error('Speech recognition error:', event.error);
                };
                
                this.recognition.onend = () => {
                    // This will restart the recognition service if it stops.
                    if (this.isListening) {
                        console.log("[Speech engine] Service ended, restarting...");
                        this.recognition.start();
                    }
                };

                // FIX 2: Add more diagnostic event listeners.
                this.recognition.onstart = () => {
                    console.log("[Speech engine] Recognition service started.");
                };

                this.recognition.onaudiostart = () => {
                    console.log("[Speech engine] Audio capture started.");
                };
                
                this.recognition.onsoundstart = () => {
                    console.log("[Speech engine] Sound detected.");
                };
                
                this.recognition.onspeechstart = () => {
                    console.log("[Speech engine] Speech detected.");
                };
                
                this.recognition.onspeechend = () => {
                    console.log("[Speech engine] Speech ended.");
                };
                
                this.recognition.onaudioend = () => {
                    console.log("[Speech engine] Audio capture ended.");
                };

                // This event is crucial. It fires when speech is detected but not recognized.
                this.recognition.onnomatch = () => {
                    console.warn("[Speech engine] Speech detected, but no match found (low confidence).");
                };            } else {
                console.warn("Speech Recognition API not supported in this browser.");
            }
        }
        
        handleVoiceCommand(command) {
            // MODIFICATION: Added more flexible command terms like "practice mode"
            if (command.includes("learning") || command.includes("learning mode")) {
                this.speak("Switching to learning mode.");
                this.switchMode("learning");
            } else if (command.includes("practice") || command.includes("practice mode")) {
                this.speak("Switching to practice mode.");
                this.switchMode("practice");
            } else if (command.includes("accuracy") || command.includes("how am i doing") || command.includes("progress")) {
                this.handleProgressQuery();
            } else if (command.includes("repeat") || command.includes("again")) {
                this.handleRepeatCommand();
            } else if (command.includes("remaining") || command.includes("left")) {
                this.handleRemainingQuery();
            } else if (command.includes("hint") || command.includes("clue")) {
                this.provideHint();
            } else if (command.includes("skip") || command.includes("next")) {
                this.skipPrompt();
            } else if (command.includes("pause") || command.includes("stop")) {
                if (!this.isPaused) this.togglePause();
            } else if (command.includes("resume") || command.includes("continue") || command.includes("start")) {
                if (this.isPaused) this.togglePause();
            }
        }

        togglePause() {
            this.isPaused = !this.isPaused;
            const button = document.getElementById('pauseResumeBtn');
            if (this.isPaused) {
                button.textContent = 'Resume';
                this.speak("Session paused.");
            } else {
                button.textContent = 'Pause';
                this.speak("Resuming session.");
                this.nextPrompt(); // Restart the prompt cycle
            }
        }

        handleProgressQuery() {
            const accuracy = this.totalInputs > 0 ? (this.correctInputs / this.totalInputs * 100) : 0;
            let report = `Your current accuracy is ${accuracy.toFixed(0)} percent. `;
            const focus = this.dataCollector.getFocusAreas();
            if (focus.length > 0) {
                report += `You might want to focus a little more on letters like ${focus.map(f => f.letter.toUpperCase()).join(', ')}. `;
            }
            report += "You're doing a great job!";
            this.speak(report);
        }

        handleRepeatCommand() {
            this.speak("Repeating the instruction.");
            // nextPrompt uses the current index, so calling it again repeats the prompt
            this.nextPrompt();
        }

        handleRemainingQuery() {
            if (this.mode !== 'learning') {
                this.speak("This command is only available in learning mode.");
                return;
            }
            const remaining = this.alphabet.length - this.masteredLetters.size;
            this.speak(`You have ${remaining} letters left to master. Keep going!`);
        }
        
        provideHint() {
            const letter = this.mode === 'learning' ? this.alphabet[this.currentLetterIndex] : this.words[this.currentWordIndex][this.currentWordLetterIndex];
            const fingers = this.alphabetFolds[letter];
            this.speakWithVibration(`Hint: For ${letter.toUpperCase()}, fold ${fingers.join(' and ')}.`, fingers);
        }

        skipPrompt() {
            this.speak("Skipping to the next one.");
            if (this.mode === 'learning') {
                this.currentLetterIndex = (this.currentLetterIndex + 1) % this.alphabet.length;
            } else {
                this.currentWordLetterIndex++;
                if (this.currentWordLetterIndex >= this.words[this.currentWordIndex].length) {
                    this.currentWordLetterIndex = 0;
                    this.currentWordIndex = (this.currentWordIndex + 1) % this.words.length;
                }
            }
            this.nextPrompt();
        }
        
        // --- UTILITY AND UI UPDATE FUNCTIONS ---
        async switchMode(newMode) {
            if (this.mode === newMode) {
                this.speak(`You are already in ${newMode} mode.`);
                return;
            }
            await this.speak(`Switching to ${newMode} mode.`);
            this.mode = newMode;
            document.getElementById('modeSelect').value = newMode;
            // Reset progress counters for a clean switch
            this.currentLetterIndex = 0;
            this.currentWordIndex = 0;
            this.currentWordLetterIndex = 0;
            this.nextPrompt();
        }

        speakWithVibration(text, fingers) {
            this.speak(text).then(() => {
                // Send vibration haptics after speech is complete
                if (fingers && fingers.length > 0) {
                    fingers.forEach((finger, i) => {
                        setTimeout(() => this.writeToSerial(String(finger)), i * 150);
                    });
                }
            });
        }

        updateAllStats() {
            const accuracy = this.totalInputs > 0 ? (this.correctInputs / this.totalInputs * 100) : 0;
            const history = this.dataCollector.attemptHistory;
            const totalTime = history.reduce((sum, item) => sum + item.time, 0);
            const avgTime = history.length > 0 ? totalTime / history.length : 0;

            document.getElementById('history-accuracy').textContent = `${accuracy.toFixed(0)}%`;
            document.getElementById('history-avg-time').textContent = `${avgTime.toFixed(1)}s`;
            document.getElementById('history-current-streak').textContent = this.correctStreak;
            document.getElementById('history-best-streak').textContent = this.bestStreak;

            document.getElementById('progress-accuracy').textContent = `${accuracy.toFixed(1)}%`;
            document.getElementById('progress-avg-time').textContent = `${avgTime.toFixed(1)}s`;
            document.getElementById('progress-total-attempts').textContent = this.totalInputs;
            document.getElementById('accuracy-progress-bar').style.width = `${accuracy}%`;

            this.updateAttemptHistoryList();
            this.updateFocusAreas();
        }

        updateBraillePatternDisplay(letter) {
            document.getElementById('braille-char-output').textContent = letter.toUpperCase();
            const positions = this.alphabetFolds[letter];
            document.getElementById('active-dots').textContent = positions.join(', ');
            for (let i = 1; i <= 6; i++) {
                document.getElementById(`dot-${i}`).classList.toggle('active', positions.includes(i));
            }
        }
        
        updateMasteryPath() {
            const container = document.getElementById('mastery-path-container');
            container.innerHTML = '';
            this.alphabet.forEach((letter, index) => {
                const tile = document.createElement('div');
                tile.className = 'letter-tile';
                tile.textContent = letter.toUpperCase();
                
                const { attempts, errors } = this.dataCollector.getErrorRate(letter);

                if (this.mode === 'learning' && index === this.currentLetterIndex) {
                    tile.classList.add('current');
                } else if (this.masteredLetters.has(letter)) {
                    tile.classList.add('mastered');
                } else if (attempts > 2 && errors > 0) {
                    tile.classList.add('difficult');
                } else {
                    tile.classList.add('pending');
                }
                container.appendChild(tile);
            });
        }

        updateAttemptHistoryList() {
            const list = document.getElementById('history-list');
            list.innerHTML = '';
            if (this.dataCollector.attemptHistory.length === 0) {
                 list.innerHTML = '<li class="placeholder">Connect the device to begin tracking attempts.</li>';
                 return;
            }
            this.dataCollector.attemptHistory.forEach(item => {
                const li = document.createElement('li');
                li.className = item.correct ? 'correct' : 'incorrect';
                li.innerHTML = `
                    <div class="status-icon">${item.correct ? '✔' : '✖'}</div>
                    <div class="attempt-details">Required: <strong>${item.letter}</strong><small>${item.timestamp}</small></div>
                    <div class="attempt-time">${item.time.toFixed(1)}s</div>
                `;
                list.appendChild(li);
            });
        }

        updateFocusAreas() {
            const container = document.getElementById('focus-areas');
            container.innerHTML = '';
            const areas = this.dataCollector.getFocusAreas();
            if (areas.length > 0) {
                areas.forEach(area => {
                    const item = document.createElement('div');
                    item.className = 'focus-item';
                    item.innerHTML = `<strong>${area.letter.toUpperCase()}</strong><small>${area.errors} errors in ${area.attempts} attempts</small>`;
                    container.appendChild(item);
                });
            } else {
                container.innerHTML = '<p>No specific focus areas yet. Great work!</p>';
            }
        }
        
        startSessionTimer() {
            if (this.sessionTimerInterval) clearInterval(this.sessionTimerInterval);
            this.sessionTimerInterval = setInterval(() => {
                if (this.isPaused) return;
                const elapsed = Math.floor((Date.now() - this.sessionStartTime) / 1000);
                const minutes = String(Math.floor(elapsed / 60)).padStart(2, '0');
                const seconds = String(elapsed % 60).padStart(2, '0');
                document.getElementById('sessionTime').textContent = `Session: ${minutes}m ${seconds}s`;
            }, 1000);
        }

        speak(text) {
            return new Promise(resolve => {
                if ('speechSynthesis' in window) {
                    speechSynthesis.cancel();
                    const utterance = new SpeechSynthesisUtterance(text);
                    utterance.pitch = 1.2;
                    utterance.rate = 1.1;
                    utterance.onend = resolve;
                    utterance.onerror = (e) => {
                        console.error("Speech synthesis error:", e);
                        resolve(); // Resolve promise even on error
                    };
                    speechSynthesis.speak(utterance);
                } else {
                    resolve(); // Resolve if speech synthesis is not available
                }
            });
        }
    }
    
    // Initialize the application
    new EnhancedBrailleTeacher();

} else {
    alert("Web Serial API not supported. Please use a modern browser like Chrome or Edge.");
}
