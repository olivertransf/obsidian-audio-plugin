import { App, Plugin, PluginSettingTab, Setting, Modal, Notice } from 'obsidian';

export default class MyPlugin extends Plugin {
    private recorder: AudioRecorder | null = null;
    private isRecording = false;
    private playbackModal: AudioPlaybackModal | null = null;

    async onload() {
        this.recorder = new AudioRecorder();
        this.playbackModal = new AudioPlaybackModal(this.app);

        this.addRibbonIcon("microphone", "Record", async () => {
            if (!this.recorder) return;

            this.isRecording = !this.isRecording;

            if (this.isRecording) {
                await this.recorder.startRecording();
            } else {
                const audioBlob = await this.recorder.stopRecording();
                await this.saveAudio(audioBlob);
                
                // Open the playback modal after saving
                if (this.playbackModal) {
                    this.playbackModal.open();
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

    async saveAudio(blob: Blob) {
        // Check if the Audio directory exists, if not create it
        const audioDir = "Audio";
        if (!(await this.app.vault.adapter.exists(audioDir))) {
            await this.app.vault.createFolder(audioDir);
        }
        
        // Use .mp3 extension for the saved file
        const filename = `Recording-${Date.now()}.mp3`;
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

    async startRecording() {
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
    }

    stopRecording(): Promise<Blob> {
        return new Promise((resolve) => {
            if (!this.mediaRecorder) return;

            this.mediaRecorder.onstop = () => {
                // Use MP3 as the target format
                const audioBlob = new Blob(this.audioChunks, { type: "audio/mp3" });
                this.audioChunks = [];
                this.stream?.getTracks().forEach(track => track.stop()); // Stop mic
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