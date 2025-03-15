import { App, Plugin, PluginSettingTab, Setting, Modal, Notice } from 'obsidian';

export default class MyPlugin extends Plugin {
    private recorder: AudioRecorder | null = null;
    private isRecording = false;
    private playbackModal: AudioPlaybackModal | null = null;
    private recordingModal: RecordingModal | null = null;

    async onload() {
        this.recorder = new AudioRecorder();
        this.playbackModal = new AudioPlaybackModal(this.app);
        this.recordingModal = new RecordingModal(this.app);

        this.addRibbonIcon("microphone", "Record", async () => {
            if (!this.recorder) return;
        
            this.isRecording = !this.isRecording;
        
            if (this.isRecording) {
                const stream = await this.recorder.startRecording();
                
                // Set the callback for the recording modal
                if (this.recordingModal) {
                    this.recordingModal.setStopRecordingCallback(async (filename) => {
                        const audioBlob = await this.recorder?.stopRecording();
                        if (audioBlob) {
                            await this.saveAudio(audioBlob, filename);
                            this.isRecording = false;
                            this.recordingModal?.close();
                            this.playbackModal?.open();
                        }
                    });
                    this.recordingModal.open();
                    
                    // Set up waveform visualization with the audio stream
                    if (stream) {
                        this.recordingModal.setupAnalyser(stream);
                    }
                }
            } else if (this.recorder) {
                // If stopping recording without using the modal
                const audioBlob = await this.recorder.stopRecording();
                if (audioBlob) {
                    const defaultName = `Recording-${Date.now()}.mp3`;
                    await this.saveAudio(audioBlob, defaultName);
                    this.recordingModal?.close();
                    this.playbackModal?.open();
                }
            }
        });

        // Add a separate command to open the playback modal
        this.addCommand({
            id: 'open-audio-playback',
            name: 'Open Audio Recordings',
            callback: () => {
                if (this.playbackModal) {
                    this.playbackModal.open();
                }
            }
        });
    }

    async saveAudio(blob: Blob, filename: string) {
        const audioDir = "Audio";
        if (!(await this.app.vault.adapter.exists(audioDir))) {
            await this.app.vault.createFolder(audioDir);
        }
    
        const arrayBuffer = await blob.arrayBuffer();
        await this.app.vault.createBinary(`${audioDir}/${filename}`, new Uint8Array(arrayBuffer));
        new Notice(`Saved: ${filename}`);
    }

    onunload() {
        // Clean up when plugin is disabled
        if (this.recorder && this.isRecording) {
            this.recorder.stopRecording();
        }
        if (this.playbackModal) {
            this.playbackModal.close();
        }
    }
}


class AudioRecorder {
    private mediaRecorder: MediaRecorder | null = null;
    private audioChunks: Blob[] = [];
    private stream: MediaStream | null = null;

    async startRecording(): Promise<MediaStream | null> {
        try {
            this.stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            
            // Try to use MP3 if supported, otherwise fall back to a reliable format
            const mimeTypes = [
                'audio/mp3',
                'audio/mpeg',
                'audio/webm;codecs=opus',
                'audio/webm'
            ];
            
            let selectedType = '';
            for (const type of mimeTypes) {
                if (MediaRecorder.isTypeSupported(type)) {
                    selectedType = type;
                    break;
                }
            }
            
            this.mediaRecorder = new MediaRecorder(this.stream, {
                mimeType: selectedType
            });
            
            this.audioChunks = [];

            this.mediaRecorder.ondataavailable = (event) => {
                this.audioChunks.push(event.data);
            };

            this.mediaRecorder.start();
            new Notice("Recording started...");
            
            // Return the stream so it can be used for visualization
            return this.stream;
        } catch (error) {
            console.error("Error starting recording:", error);
            new Notice("Failed to start recording: " + (error as Error).message);
            return null;
        }
    }

    stopRecording(): Promise<Blob> {
        return new Promise((resolve) => {
            if (!this.mediaRecorder) {
                resolve(new Blob([]));
                return;
            }

            this.mediaRecorder.onstop = () => {
                // Use MP3 as the target format
                const audioBlob = new Blob(this.audioChunks, { type: "audio/mp3" });
                this.audioChunks = [];
                
                // Stop all tracks in the stream
                if (this.stream) {
                    this.stream.getTracks().forEach(track => track.stop());
                    this.stream = null;
                }
                
                resolve(audioBlob);
            };

            this.mediaRecorder.stop();
            new Notice("Recording stopped!");
        });
    }
}
// Add a new modal class for renaming files
class RenameModal extends Modal {
    private file: any;
    private onRename: (newName: string) => void;
    private inputEl: HTMLInputElement;

    constructor(app: App, file: any, onRename: (newName: string) => void) {
        super(app);
        this.file = file;
        this.onRename = onRename;
    }

    onOpen() {
        const { contentEl } = this;
        contentEl.empty();

        contentEl.createEl('h2', { text: 'Rename Recording' });
        
        // Create input field
        this.inputEl = contentEl.createEl('input', {
            type: 'text',
            value: this.file.name + ".mp3"
        });
        this.inputEl.style.width = '100%';
        this.inputEl.style.marginBottom = '10px';
        this.inputEl.select();
        
        // Create buttons container
        const buttonsDiv = contentEl.createEl('div', {
            cls: 'rename-buttons'
        });
        buttonsDiv.style.display = 'flex';
        buttonsDiv.style.justifyContent = 'flex-end';
        
        // Create cancel button
        const cancelBtn = buttonsDiv.createEl('button', {
            text: 'Cancel'
        });
        cancelBtn.onclick = () => {
            this.close();
        };
        
        // Create rename button
        const renameBtn = buttonsDiv.createEl('button', {
            text: 'Rename',
            cls: 'mod-cta'
        });
        renameBtn.style.marginLeft = '10px';
        renameBtn.onclick = () => {
            const newName = this.inputEl.value.trim();
            if (newName) {
                this.onRename(newName + ".mp3");
				this.file.name = newName;
                this.close();
            }
        };
        
        // Allow Enter key to submit
        this.inputEl.onkeydown = (e) => {
            if (e.key === 'Enter') {
                renameBtn.click();
            }
        };
        
        // Focus the input field
        setTimeout(() => {
            this.inputEl.focus();
        }, 10);
    }

    onClose() {
        const { contentEl } = this;
        contentEl.empty();
    }
}

class AudioPlaybackModal extends Modal {
    constructor(app: App) {
        super(app);
    }

    async onOpen() {
        const { contentEl } = this;
        contentEl.empty();

        contentEl.createEl('h2', { text: 'Recorded Audio Files' });
        
        // Find audio files in the "Audio/" folder
        const audioFiles = this.app.vault.getFiles().filter(file => file.path.startsWith("Audio/"));

        if (audioFiles.length === 0) {
            contentEl.setText("No recordings found.");
            return;
        }

        // Create playback UI for each audio file
        audioFiles.forEach(file => {
            const audioURL = this.app.vault.adapter.getResourcePath(file.path);

            const div = document.createElement("div");
            div.style.display = "flex";
            div.style.alignItems = "center";
            div.style.marginBottom = "10px";

            // Audio Element
            const audioElement = document.createElement("audio");
            audioElement.controls = true;
            audioElement.src = audioURL;
            div.appendChild(audioElement);

            // Filename Display
            const nameLabel = document.createElement("span");
            nameLabel.textContent = file.name;
            nameLabel.style.marginLeft = "10px";
            div.appendChild(nameLabel);

            // Delete Button
            const deleteBtn = document.createElement("button");
            deleteBtn.textContent = "🗑️";
            deleteBtn.style.marginLeft = "10px";
            deleteBtn.onclick = async () => {
                await this.app.vault.trash(file, true);
                new Notice(`Deleted: ${file.name}`);
                this.onOpen(); // Refresh the modal after deletion
            };
            div.appendChild(deleteBtn);

            // Rename Button
            const renameBtn = document.createElement("button");
            renameBtn.textContent = "✏️";
            renameBtn.style.marginLeft = "5px";
            renameBtn.onclick = () => {
                // Create and open a rename modal instead of using prompt()
                new RenameModal(this.app, file, async (newName) => {
                    if (newName && newName !== file.name) {
                        const newPath = `Audio/${newName}`;
                        
                        // Check if destination already exists
                        const exists = await this.app.vault.adapter.exists(newPath);
                        if (exists) {
                            new Notice(`Error: A file named "${newName}" already exists`);
                            return;
                        }
                        
                        this.app.vault.rename(file, newPath).then(() => {
                            new Notice(`Renamed to: ${newName}`);
                            this.onOpen(); // Refresh modal
                        }).catch(err => {
                            new Notice(`Error renaming file: ${err.message}`);
                        });
                    }
                }).open();
            };
            div.appendChild(renameBtn);

            contentEl.appendChild(div);
        });
    }

    onClose() {
        this.contentEl.empty();
    }
}

class RecordingModal extends Modal {
    private onStopRecording: (filename: string) => void;
    private inputEl: HTMLInputElement;
    private indicatorEl: HTMLElement;
    private canvasEl: HTMLCanvasElement;
    private analyser: AnalyserNode | null = null;
    private animationId: number | null = null;

    constructor(app: App, onStopRecording?: (filename: string) => void) {
        super(app);
        // Initialize with an empty function as default if not provided
        this.onStopRecording = onStopRecording || ((filename: string) => {});
    }

    // Method to update the callback if needed
    setStopRecordingCallback(callback: (filename: string) => void) {
        this.onStopRecording = callback;
    }

    // Method to set up the audio analyser for visualization
    setupAnalyser(stream: MediaStream) {
        const audioContext = new AudioContext();
        const source = audioContext.createMediaStreamSource(stream);
        this.analyser = audioContext.createAnalyser();
        this.analyser.fftSize = 256;
        source.connect(this.analyser);
        
        this.startVisualizing();
    }
    
    // Method to start the visualization loop
    startVisualizing() {
        if (!this.analyser || !this.canvasEl) return;
        
        const canvas = this.canvasEl;
        const canvasCtx = canvas.getContext('2d');
        const bufferLength = this.analyser.frequencyBinCount;
        const dataArray = new Uint8Array(bufferLength);
        
        const draw = () => {
            if (!canvasCtx) return;
            
            this.animationId = requestAnimationFrame(draw);
            
            this.analyser?.getByteTimeDomainData(dataArray);
            
            canvasCtx.fillStyle = 'rgb(45, 45, 45)';
            canvasCtx.fillRect(0, 0, canvas.width, canvas.height);
            
            canvasCtx.lineWidth = 2;
            canvasCtx.strokeStyle = 'rgb(220, 0, 0)';
            canvasCtx.beginPath();
            
            const sliceWidth = canvas.width / bufferLength;
            let x = 0;
            
            for (let i = 0; i < bufferLength; i++) {
                const v = dataArray[i] / 128.0;
                const y = v * canvas.height / 2;
                
                if (i === 0) {
                    canvasCtx.moveTo(x, y);
                } else {
                    canvasCtx.lineTo(x, y);
                }
                
                x += sliceWidth;
            }
            
            canvasCtx.lineTo(canvas.width, canvas.height / 2);
            canvasCtx.stroke();
        };
        
        draw();
    }
    
    // Method to stop visualization
    stopVisualizing() {
        if (this.animationId !== null) {
            cancelAnimationFrame(this.animationId);
            this.animationId = null;
        }
    }

    async onOpen() {
        const { contentEl } = this;
        contentEl.empty();

        // Create waveform canvas
        const waveformContainer = contentEl.createEl('div', { cls: 'waveform-container' });
        waveformContainer.style.width = '100%';
        waveformContainer.style.height = '100px';
        waveformContainer.style.marginBottom = '15px';
        
        this.canvasEl = waveformContainer.createEl('canvas', { cls: 'waveform-canvas' });
        this.canvasEl.width = waveformContainer.clientWidth;
        this.canvasEl.height = waveformContainer.clientHeight;
        
        // Placeholder waveform pattern until actual recording starts
        const ctx = this.canvasEl.getContext('2d');
        if (ctx) {
            ctx.fillStyle = 'rgb(54, 54, 54)';
            ctx.fillRect(0, 0, this.canvasEl.width, this.canvasEl.height);
            ctx.lineWidth = 2;
            ctx.strokeStyle = 'rgb(200, 200, 200)';
            ctx.beginPath();
            
            // Draw a flat line with small bumps
            const midY = this.canvasEl.height / 2;
            ctx.moveTo(0, midY);
            
            for (let x = 0; x < this.canvasEl.width; x += 10) {
                ctx.lineTo(x, midY + (Math.sin(x * 0.1) * 5));
            }
            
            ctx.lineTo(this.canvasEl.width, midY);
            ctx.stroke();
        }

        // Recording Indicator (Red Dot + "Recording...")
        this.indicatorEl = contentEl.createEl('div', { cls: 'recording-indicator' });
        this.indicatorEl.innerHTML = `<span style="color: red; font-size: 1.2em;">●</span> Recording...`;
        this.indicatorEl.style.display = "flex";
        this.indicatorEl.style.alignItems = "center";
        this.indicatorEl.style.fontSize = "1.2em";
        this.indicatorEl.style.marginBottom = "10px";

        // Input field for filename
        this.inputEl = contentEl.createEl('input', {
            type: 'text',
            placeholder: 'Enter file name...'
        });
        this.inputEl.style.width = '100%';
        this.inputEl.style.marginBottom = '10px';
        this.inputEl.value = `Recording-${Date.now()}`; // Default name

        // Stop Recording Button
        const stopBtn = contentEl.createEl('button', { 
            text: 'Stop & Save',
            cls: 'mod-cta'  // Apply Obsidian's call-to-action button styling
        });
        stopBtn.style.width = '100%';
        stopBtn.style.marginTop = '10px';
        stopBtn.onclick = () => {
            const filename = this.inputEl.value.trim();
            if (filename) {
                this.stopVisualizing();
                this.onStopRecording(`${filename}.mp3`);
            }
        };

        // Allow pressing Enter to stop recording
        this.inputEl.onkeydown = (e) => {
            if (e.key === 'Enter') {
                stopBtn.click();
            }
        };

        // Focus on the input field after a short delay
        setTimeout(() => this.inputEl.focus(), 10);
    }

    onClose() {
        this.stopVisualizing();
        const { contentEl } = this;
        contentEl.empty();
    }
}