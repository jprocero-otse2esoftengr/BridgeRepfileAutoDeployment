import { Component, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { HttpClient, HttpClientModule } from '@angular/common/http';
import { LoginComponent } from './login.component';

interface BridgeServer {
  name: string;
  host: string;
  port: string;
  username: string;
  password: string;
  scheme: string;
  authType?: string;
  keycloakUrl?: string;
  clientId?: string;
  clientSecret?: string;
}

interface UploadedFile {
  id: string;
  name: string;
  size: number;
  path: string;
  selected: boolean;
}

interface DeploymentResult {
  successfulDeployments?: Array<{
    fileName: string;
    server: string;
    message: string;
  }>;
  failedDeployments?: Array<{
    fileName: string;
    server: string;
    error: string;
  }>;
  error?: string;
}

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [CommonModule, HttpClientModule, LoginComponent],
  template: `
    <div *ngIf="isAuthenticated" class="container">
      <header class="header">
        <div class="logo-section">
          <img src="assets/logo.png" alt="Onetool Solutions Logo" class="logo">
          <div class="company-info">
            <h1>E2E Bridge Rep File Deployer</h1>
            <p class="company-name">Onetool Solutions</p>
          </div>
        </div>
        <div class="user-section">
          <span class="welcome-text">Welcome, {{ currentUser }}!</span>
          <button class="logout-btn" (click)="logout()">Logout</button>
        </div>
      </header>
      
      <div class="bridge-info">
        <h3>Available Bridge Servers</h3>
        <div class="server-list">
          <div class="server-item" *ngFor="let server of bridgeServers; let i = index">
            <input type="checkbox" 
                   [id]="'server' + i" 
                   [checked]="selectedServers.includes(i)"
                   (change)="toggleServer(i)">
            <label [for]="'server' + i">
              <strong>{{ server.name }}</strong><br>
              <small>{{ server.scheme }}://{{ server.host }}:{{ server.port }} ({{ server.username }})</small>
            </label>
          </div>
        </div>
      </div>

      <div class="upload-area" 
           [class.dragover]="isDragOver"
           (dragover)="onDragOver($event)"
           (dragleave)="onDragLeave($event)"
           (drop)="onDrop($event)"
           (click)="fileInput.click()">
        <h3>📁 Upload .rep Files</h3>
        <p>Drag and drop your .rep files here or click to browse</p>
        <input #fileInput type="file" multiple accept=".rep" style="display: none;" (change)="onFileSelected($event)">
        <button class="btn" (click)="fileInput.click(); $event.stopPropagation()">Choose Files</button>
      </div>

      <div class="file-list" *ngIf="uploadedFiles.length > 0">
        <h3>📋 Uploaded Files</h3>
        <div class="files">
          <div class="file-item" *ngFor="let file of uploadedFiles; let i = index">
            <div class="file-info">
              <div class="file-name">{{ file.name }}</div>
              <div class="file-size">{{ formatFileSize(file.size) }}</div>
            </div>
            <div>
              <input type="checkbox" 
                     [id]="'file' + i" 
                     [checked]="file.selected"
                     (change)="toggleFile(i)">
              <label [for]="'file' + i">Select</label>
            </div>
          </div>
        </div>
        <button class="btn btn-success" (click)="deploySelected()">Deploy Selected Files</button>
        <button class="btn btn-danger" (click)="clearAll()">Clear All</button>
      </div>

      <div class="loading" *ngIf="isLoading">
        <div class="spinner"></div>
        <p>Deploying files to Bridge server...</p>
      </div>

      <div class="deployment-status" *ngIf="deploymentResults">
        <h4>📋 Deployment Results</h4>
        
        <div class="deployment-results" *ngIf="deploymentResults && deploymentResults.successfulDeployments && deploymentResults.successfulDeployments.length > 0">
          <div class="deployment-result success" *ngFor="let success of deploymentResults.successfulDeployments">
            <span class="deployment-result-icon">✅</span>
            <div class="deployment-result-text">
              <strong>{{ success.fileName }} → {{ success.server }}</strong><br>
              <small>{{ success.message }}</small>
            </div>
          </div>
        </div>
        
        <div class="deployment-results" *ngIf="deploymentResults && deploymentResults.failedDeployments && deploymentResults.failedDeployments.length > 0" style="margin-top: 20px;">
          <div class="deployment-result failed" *ngFor="let fail of deploymentResults.failedDeployments">
            <span class="deployment-result-icon">❌</span>
            <div class="deployment-result-text">
              <strong>{{ fail.fileName }} → {{ fail.server }}</strong><br>
              <small>{{ fail.error }}</small>
            </div>
          </div>
        </div>
        
        <div class="deployment-results" *ngIf="deploymentResults && (!deploymentResults.successfulDeployments || deploymentResults.successfulDeployments.length === 0) && (!deploymentResults.failedDeployments || deploymentResults.failedDeployments.length === 0)">
          <div class="deployment-result failed">
            <span class="deployment-result-icon">❌</span>
            <div class="deployment-result-text">
              <strong>Deployment Error</strong><br>
              <small>{{ deploymentResults.error || 'Unknown error occurred' }}</small>
            </div>
          </div>
        </div>
      </div>
    </div>
    
    <app-login *ngIf="!isAuthenticated"></app-login>
  `,
  styleUrls: ['./app.component.css']
})
export class AppComponent implements OnInit, OnDestroy {
  bridgeServers: BridgeServer[] = [];
  selectedServers: number[] = []; // Will be initialized when servers are loaded
  uploadedFiles: UploadedFile[] = [];
  isDragOver = false;
  isLoading = false;
  deploymentResults: DeploymentResult | null = null;
  isAuthenticated = false;
  currentUser: string | null = null;
  private authCheckInterval: any;

  constructor(private http: HttpClient) {}

  ngOnInit() {
    this.checkAuthStatus();
    
    // Check authentication status periodically when not authenticated
    // Reduced frequency to every 5 seconds instead of 1 second
    this.authCheckInterval = setInterval(() => {
      if (!this.isAuthenticated) {
        this.checkAuthStatus();
      }
    }, 5000);
  }

  ngOnDestroy() {
    if (this.authCheckInterval) {
      clearInterval(this.authCheckInterval);
    }
  }

  // Check authentication status
  checkAuthStatus() {
    this.http.get<any>('/api/auth/status').subscribe({
      next: (data) => {
        this.isAuthenticated = data.authenticated;
        this.currentUser = data.username;
        if (this.isAuthenticated) {
          this.loadBridgeServers();
        }
      },
      error: () => {
        this.isAuthenticated = false;
        this.currentUser = null;
      }
    });
  }

  // Logout function
  logout() {
    this.http.post('/api/auth/logout', {}).subscribe({
      next: () => {
        this.isAuthenticated = false;
        this.currentUser = null;
      },
      error: () => {
        this.isAuthenticated = false;
        this.currentUser = null;
      }
    });
  }

  // Load bridge servers from the server
  loadBridgeServers() {
    this.http.get<BridgeServer[]>('/api/servers').subscribe({
      next: (servers) => {
        this.bridgeServers = servers;
        // Select all servers by default
        this.selectedServers = servers.map((_, index) => index);
      },
      error: () => {
        // Error handling - servers will remain empty
      }
    });
  }

  // Toggle server selection
  toggleServer(index: number) {
    if (this.selectedServers.includes(index)) {
      this.selectedServers = this.selectedServers.filter(i => i !== index);
    } else {
      this.selectedServers.push(index);
    }
  }

  // Toggle file selection
  toggleFile(index: number) {
    this.uploadedFiles[index].selected = !this.uploadedFiles[index].selected;
  }

  // Drag and drop handlers
  onDragOver(event: DragEvent) {
    event.preventDefault();
    this.isDragOver = true;
  }

  onDragLeave(event: DragEvent) {
    event.preventDefault();
    this.isDragOver = false;
  }

  onDrop(event: DragEvent) {
    event.preventDefault();
    this.isDragOver = false;
    const files = event.dataTransfer?.files;
    if (files) {
      this.handleFiles(files);
    }
  }

  // File selection handler
  onFileSelected(event: Event) {
    const target = event.target as HTMLInputElement;
    if (target.files) {
      this.handleFiles(target.files);
    }
  }

  // Handle file selection
  handleFiles(files: FileList) {
    const fileArray = Array.from(files);
    const repFiles = fileArray.filter(file => file.name.endsWith('.rep'));
    
    if (repFiles.length === 0) {
      alert('Please select .rep files only!');
      return;
    }

    // Upload files
    repFiles.forEach(file => this.uploadFile(file));
  }

  // Upload a single file
  uploadFile(file: File) {
    const formData = new FormData();
    formData.append('repFile', file);

    this.http.post<any>('/upload', formData).subscribe({
      next: (data) => {
        if (data.success) {
          this.uploadedFiles.push({
            id: data.fileId,
            name: data.originalName,
            size: data.size,
            path: data.filePath,
            selected: false
          });
        } else {
          alert('Upload failed: ' + data.error);
        }
      },
      error: (error) => {
        alert('Upload error: ' + error.message);
      }
    });
  }

  // Deploy selected files
  deploySelected() {
    const selectedFiles = this.uploadedFiles.filter(file => file.selected);
    
    if (selectedFiles.length === 0) {
      alert('Please select at least one file to deploy!');
      return;
    }

    if (this.selectedServers.length === 0) {
      alert('Please select at least one Bridge server!');
      return;
    }

    this.isLoading = true;
    this.deploymentResults = null;

    const fileIds = selectedFiles.map(file => file.id);

    this.http.post<any>('/deploy', {
      fileIds: fileIds,
      serverIds: this.selectedServers
    }).subscribe({
      next: (data) => {
        console.log('Deployment response:', data);
        this.isLoading = false;
        this.deploymentResults = data;
      },
      error: (error) => {
        this.isLoading = false;
        this.deploymentResults = {
          error: error.message
        };
      }
    });
  }

  // Clear all uploaded files
  clearAll() {
    if (confirm('Are you sure you want to clear all uploaded files?')) {
      this.http.post('/clear', {}).subscribe({
        next: (data) => {
          this.uploadedFiles = [];
          this.deploymentResults = null;
        }
      });
    }
  }

  // Format file size for display
  formatFileSize(bytes: number): string {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  }

}
