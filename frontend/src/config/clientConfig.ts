/**
 * WHITE-LABEL CONFIGURATION FILE
 * 
 * This file contains all customizable settings for deploying BizCore
 * to different clients. Each client will have their own copy of this file
 * with their specific branding and credentials.
 * 
 * DEPLOYMENT STEPS FOR NEW CLIENT:
 * 1. Copy this file to a new location
 * 2. Update the values below with client-specific information
 * 3. Update the Google OAuth credentials in app.json
 * 4. Build and deploy the app
 */

export interface ClientConfig {
  // Branding
  appName: string;
  companyName: string;
  tagline: string;
  
  // Theme
  theme: {
    primary: string;
    primaryLight: string;
    secondary: string;
    background: string;
    card: string;
    cardAlt: string;
    text: string;
    textSecondary: string;
    textMuted: string;
    border: string;
    success: string;
    warning: string;
    danger: string;
    info: string;
  };
  
  // Features
  features: {
    enableBarcodeScan: boolean;
    enableOfflineMode: boolean;
    enablePushNotifications: boolean;
    enablePdfExport: boolean;
    enableGoogleAuth: boolean;
    enableBiometricLogin: boolean;
    enableDarkMode: boolean;
  };
  
  // API Configuration
  api: {
    baseUrl: string | null; // null = use environment variable
    timeout: number;
  };
  
  // Default Values
  defaults: {
    currency: string;
    currencySymbol: string;
    dateFormat: string;
    timezone: string;
    language: string;
  };
  
  // Contact/Support
  support: {
    email: string;
    phone: string;
    website: string;
  };
}

// Default configuration for BizCore (Client 1)
const clientConfig: ClientConfig = {
  // Branding
  appName: 'BizCore',
  companyName: 'BizCore Solutions',
  tagline: 'Business Management Made Simple',
  
  // Dark Professional Theme
  theme: {
    primary: '#6366F1',      // Indigo
    primaryLight: '#818CF8', // Light Indigo
    secondary: '#8B5CF6',    // Purple
    background: '#0F172A',   // Dark Navy
    card: '#1E293B',         // Slate Dark
    cardAlt: '#334155',      // Slate Medium
    text: '#F8FAFC',         // Almost White
    textSecondary: '#94A3B8', // Slate Light
    textMuted: '#64748B',    // Slate
    border: '#334155',       // Slate Border
    success: '#10B981',      // Emerald
    warning: '#F59E0B',      // Amber
    danger: '#EF4444',       // Red
    info: '#3B82F6',         // Blue
  },
  
  // Enabled Features
  features: {
    enableBarcodeScan: true,
    enableOfflineMode: true,
    enablePushNotifications: true,
    enablePdfExport: true,
    enableGoogleAuth: false,  // Direct username/password login only (no Google OAuth)
    enableBiometricLogin: false,
    enableDarkMode: true,
  },
  
  // API Configuration
  api: {
    baseUrl: null, // Uses EXPO_PUBLIC_BACKEND_URL from .env
    timeout: 30000,
  },
  
  // ── CHANGED: Nigerian locale ─────────────────────────────────────────────
  defaults: {
    currency: 'NGN',
    currencySymbol: '₦',
    dateFormat: 'dd MMM yyyy',
    timezone: 'Africa/Lagos',
    language: 'en-NG',
  },
  
  // Support Contact
  support: {
    email: 'support@bizcore.com',
    phone: '+234 XXX XXX XXXX',
    website: 'https://bizcore.com',
  },
};

export default clientConfig;

// Helper function to get formatted currency
export const formatCurrency = (value: number, options?: Intl.NumberFormatOptions): string => {
  return new Intl.NumberFormat(clientConfig.defaults.language, {
    style: 'currency',
    currency: clientConfig.defaults.currency,
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
    ...options,
  }).format(value);
};

/** Format a number with the locale's thousand separators, no currency symbol. */
export const formatNumber = (value: number, fractionDigits = 0): string => {
  return new Intl.NumberFormat(clientConfig.defaults.language, {
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  }).format(value);
};

// Helper to check if feature is enabled
export const isFeatureEnabled = (feature: keyof ClientConfig['features']): boolean => {
  return clientConfig.features[feature];
};
