import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { HttpClient, HttpClientModule } from '@angular/common/http';
import { Router } from '@angular/router';
import { FormsModule } from '@angular/forms';

@Component({
  selector: 'app-login',
  standalone: true,
  imports: [CommonModule, HttpClientModule, FormsModule],
  template: `
    <div class="login-container">
      <div class="login-header">
        <div class="logo-section">
          <img src="assets/logo.png" alt="Onetool Solutions Logo" class="logo">
        </div>
        <h1>Onetool Solutions</h1>
        <p>Bridge File Deployer</p>
      </div>
      <div class="form-container">
        <div class="form-decoration-top"></div>
        <form (ngSubmit)="onSubmit()" #loginForm="ngForm">
          <div class="form-group">
            <label for="username">Username</label>
            <input 
              type="text" 
              id="username" 
              name="username" 
              [(ngModel)]="username" 
              placeholder="Enter your username" 
              required>
          </div>
          <div class="form-group">
            <label for="password">Password</label>
            <input 
              type="password" 
              id="password" 
              name="password" 
              [(ngModel)]="password" 
              placeholder="Enter your password" 
              required>
          </div>
          <button type="submit" class="login-btn" [disabled]="isLoading">
            <span *ngIf="!isLoading">Sign In</span>
            <span *ngIf="isLoading" class="loading-content">
              <span class="loading-spinner"></span>Signing In...
            </span>
          </button>
          <div *ngIf="errorMessage" class="error">
            {{ errorMessage }}
          </div>
        </form>
        <div class="form-decoration-bottom"></div>
      </div>
      <div class="company-info">
        <p class="company-name">Onetool Solutions</p>
      </div>
    </div>
  `,
  styles: [`
    * { margin: 0; padding: 0; box-sizing: border-box; }
    
    .login-container { 
      max-width: 450px; 
      width: 100%;
      background: white; 
      padding: 50px 40px; 
      border-radius: 16px; 
      box-shadow: 0 10px 40px rgba(0,0,0,0.1);
      position: relative;
      overflow: hidden;
      margin: 50px auto;
    }
    
    .login-container::before {
      content: '';
      position: absolute;
      top: 0;
      left: 0;
      right: 0;
      height: 4px;
      background: linear-gradient(90deg, #2c5aa0 0%, #1e3a8a 100%);
    }
    
    .login-container::after {
      content: '';
      position: absolute;
      bottom: 0;
      left: 0;
      right: 0;
      height: 4px;
      background: linear-gradient(90deg, #059669 0%, #047857 100%);
    }
    
    .login-header { 
      text-align: center; 
      margin-bottom: 40px; 
    }
    
    .logo-section {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 15px;
      margin-bottom: 20px;
      position: relative;
    }
    
    .logo-section::before {
      content: '';
      position: absolute;
      left: -20px;
      top: 50%;
      transform: translateY(-50%);
      width: 8px;
      height: 8px;
      background: #059669;
      border-radius: 50%;
      box-shadow: 0 0 0 3px rgba(5, 150, 105, 0.2);
    }
    
    .logo-section::after {
      content: '';
      position: absolute;
      right: -20px;
      top: 50%;
      transform: translateY(-50%);
      width: 8px;
      height: 8px;
      background: #059669;
      border-radius: 50%;
      box-shadow: 0 0 0 3px rgba(5, 150, 105, 0.2);
    }
    
    .logo {
      width: 60px;
      height: 60px;
      object-fit: contain;
      border-radius: 12px;
      box-shadow: 0 4px 12px rgba(44, 90, 160, 0.2);
    }
    
    .login-header h1 { 
      color: #000; 
      font-weight: 600;
      font-size: 28px; 
      margin: 0;
      margin-bottom: 8px;
    }
    
    .login-header p { 
      color: #2c5aa0; 
      font-weight: 500;
      font-size: 16px; 
      margin: 0;
    }
    
    .form-group { 
      margin-bottom: 25px; 
    }
    
    .form-group label { 
      display: block; 
      margin-bottom: 8px; 
      color: #333; 
      font-weight: 500;
      font-size: 14px;
    }
    
    .form-group input { 
      width: 100%; 
      padding: 16px 20px; 
      border: 2px solid #e5e7eb; 
      border-radius: 12px; 
      font-size: 16px; 
      font-family: 'Poppins', sans-serif;
      font-weight: 400;
      transition: all 0.3s ease;
      background: #f8f9fa;
    }
    
    .form-group input:focus { 
      outline: none; 
      border-color: #2c5aa0; 
      background: white;
      box-shadow: 0 0 0 3px rgba(44, 90, 160, 0.1), 0 0 0 1px rgba(5, 150, 105, 0.2);
    }
    
    .form-group input::placeholder {
      color: #9ca3af;
      font-weight: 400;
    }
    
    .login-btn { 
      width: 100%; 
      padding: 16px; 
      background: linear-gradient(135deg, #2c5aa0 0%, #1e3a8a 100%);
      color: white; 
      border: none; 
      border-radius: 12px; 
      font-size: 16px; 
      font-weight: 600;
      font-family: 'Poppins', sans-serif;
      cursor: pointer; 
      transition: all 0.3s ease;
      box-shadow: 0 4px 15px rgba(44, 90, 160, 0.3), 0 0 0 1px rgba(5, 150, 105, 0.3);
      position: relative;
      overflow: hidden;
    }
    
    .login-btn::before {
      content: '';
      position: absolute;
      top: 0;
      left: -100%;
      width: 100%;
      height: 100%;
      background: linear-gradient(90deg, transparent, rgba(5, 150, 105, 0.2), transparent);
      transition: left 0.5s;
    }
    
    .login-btn:hover::before {
      left: 100%;
    }
    
    .login-btn:hover:not(:disabled) { 
      transform: translateY(-2px);
      box-shadow: 0 8px 25px rgba(44, 90, 160, 0.4);
    }
    
    .login-btn:active {
      transform: translateY(0);
    }
    
    .login-btn:disabled {
      opacity: 0.7;
      cursor: not-allowed;
      transform: none;
    }
    
    .error { 
      color: #dc2626; 
      margin-top: 15px; 
      text-align: center; 
      font-weight: 500;
      font-size: 14px;
      padding: 12px;
      background: #fef2f2;
      border: 1px solid #fecaca;
      border-radius: 8px;
    }
    
    .loading-content {
      display: flex;
      align-items: center;
      justify-content: center;
    }
    
    .loading-spinner {
      display: inline-block;
      width: 20px;
      height: 20px;
      border: 2px solid #ffffff;
      border-radius: 50%;
      border-top-color: transparent;
      animation: spin 1s ease-in-out infinite;
      margin-right: 8px;
    }
    
    @keyframes spin {
      to { transform: rotate(360deg); }
    }
    
    .company-info {
      text-align: center;
      margin-top: 20px;
      padding-top: 20px;
      border-top: 1px solid #e5e7eb;
    }
    
    .company-name {
      color: #6b7280;
      font-size: 14px;
      font-weight: 400;
    }
    
    .form-container {
      position: relative;
    }
    
    .form-decoration-top {
      position: absolute;
      top: -10px;
      left: 50%;
      transform: translateX(-50%);
      width: 60px;
      height: 4px;
      background: linear-gradient(90deg, #059669 0%, #047857 100%);
      border-radius: 2px;
    }
    
    .form-decoration-bottom {
      position: absolute;
      bottom: -10px;
      left: 50%;
      transform: translateX(-50%);
      width: 60px;
      height: 4px;
      background: linear-gradient(90deg, #059669 0%, #047857 100%);
      border-radius: 2px;
    }
    
    @media (max-width: 480px) {
      .login-container {
        padding: 30px 25px;
        margin: 10px;
      }
      
      .login-header h1 {
        font-size: 24px;
      }
    }
  `]
})
export class LoginComponent implements OnInit {
  username: string = '';
  password: string = '';
  isLoading: boolean = false;
  errorMessage: string = '';

  constructor(private http: HttpClient, private router: Router) {}

  ngOnInit() {
    // Check if already authenticated
    this.checkAuthStatus();
  }

  checkAuthStatus() {
    this.http.get<any>('/api/auth/status').subscribe({
      next: (data) => {
        // Don't navigate - let parent component handle the state
        // The parent will show/hide this component based on authentication
      },
      error: (error) => {
        console.error('Auth status check failed:', error);
      }
    });
  }

  onSubmit() {
    if (!this.username || !this.password) {
      this.errorMessage = 'Please enter both username and password.';
      return;
    }

    this.isLoading = true;
    this.errorMessage = '';

    this.http.post<any>('/api/auth/login', {
      username: this.username,
      password: this.password
    }).subscribe({
      next: (result) => {
        if (result.success) {
          // Don't navigate - let parent component handle the state change
          // The parent will detect the authentication change and show the main app
          this.isLoading = false;
          // Clear the form
          this.username = '';
          this.password = '';
        } else {
          this.errorMessage = result.error || 'Login failed. Please check your credentials.';
          this.isLoading = false;
        }
      },
      error: (error) => {
        this.errorMessage = 'Network error. Please check your connection and try again.';
        this.isLoading = false;
      }
    });
  }
}
