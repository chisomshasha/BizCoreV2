# BizCore White-Label Deployment Guide

## Client 1 Configuration: BizCore

This guide walks you through deploying BizCore for a new client.

---

## Prerequisites for Each Client

### 1. Client Branding Information
- **App Name**: The name displayed in the app
- **Company Name**: Client's company name
- **Logo**: PNG/SVG file for app icon
- **Colors** (optional): Custom theme colors

### 2. Infrastructure Requirements
- **Domain**: e.g., `erp.clientcompany.com`
- **Hosting Provider**: AWS, GCP, Azure, DigitalOcean, etc.
- **MongoDB Instance**: Dedicated database per client
- **SSL Certificate**: For HTTPS

### 3. Google OAuth Credentials
Each client needs their own Google OAuth credentials.

---

## Setting Up Google OAuth Credentials

### Step 1: Create a Google Cloud Project

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Click **Select a project** → **New Project**
3. Enter project name (e.g., "BizCore Client1")
4. Click **Create**

### Step 2: Enable Required APIs

1. Go to **APIs & Services** → **Library**
2. Search for and enable:
   - **Google+ API**
   - **Google People API**
   - **Google Identity Services**

### Step 3: Configure OAuth Consent Screen

1. Go to **APIs & Services** → **OAuth consent screen**
2. Select **External** (or Internal for G Suite)
3. Fill in the required information:
   - **App name**: BizCore (or client's preferred name)
   - **User support email**: support email
   - **Developer contact email**: your email
4. Add scopes:
   - `email`
   - `profile`
   - `openid`
5. Click **Save and Continue**

### Step 4: Create OAuth Credentials

1. Go to **APIs & Services** → **Credentials**
2. Click **Create Credentials** → **OAuth client ID**
3. Choose **Web application**
4. Enter:
   - **Name**: BizCore Web Client
   - **Authorized JavaScript origins**:
     - `https://your-client-domain.com`
     - `http://localhost:3000` (for development)
   - **Authorized redirect URIs**:
     - `https://your-client-domain.com/api/auth/callback/google`
     - `http://localhost:8001/api/auth/callback/google` (for development)
5. Click **Create**
6. **Save the Client ID and Client Secret**

### Step 5: Configure the App

Add to backend `.env`:
```
GOOGLE_CLIENT_ID=your-client-id.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=your-client-secret
GOOGLE_REDIRECT_URI=https://your-domain.com/api/auth/callback/google
```

---

## Customizing the White-Label Configuration

### Edit `/app/frontend/src/config/clientConfig.ts`:

```typescript
const clientConfig: ClientConfig = {
  // Change these for each client
  appName: 'ClientName ERP',
  companyName: 'Client Company Name',
  tagline: 'Custom Tagline',
  
  // Update theme colors if needed
  theme: {
    primary: '#6366F1',    // Client's brand color
    // ... other colors
  },
  
  // Enable/disable features
  features: {
    enableBarcodeScan: true,
    enableOfflineMode: true,
    enablePushNotifications: true,
    enablePdfExport: true,
    enableGoogleAuth: true,
    enableBiometricLogin: false,
    enableDarkMode: true,
  },
  
  // Support contact
  support: {
    email: 'support@clientcompany.com',
    phone: '+1 (555) 123-4567',
    website: 'https://clientcompany.com',
  },
};
```

### Update `app.json`:

```json
{
  "expo": {
    "name": "ClientName ERP",
    "slug": "clientname-erp",
    "ios": {
      "bundleIdentifier": "com.clientname.erp"
    },
    "android": {
      "package": "com.clientname.erp"
    }
  }
}
```

---

## Deployment Steps

### 1. Clone Repository
```bash
git clone <repo-url> client-bizcore
cd client-bizcore
```

### 2. Configure Environment
```bash
# Backend
cp backend/.env.example backend/.env
# Edit with client-specific values

# Frontend
cp frontend/.env.example frontend/.env
# Edit with client-specific values
```

### 3. Update Configuration Files
- Edit `frontend/src/config/clientConfig.ts`
- Edit `frontend/app.json`

### 4. Build Backend
```bash
cd backend
pip install -r requirements.txt
```

### 5. Build Frontend
```bash
cd frontend
yarn install
eas build --platform all
```

### 6. Deploy
- Deploy backend to client's hosting
- Submit apps to App Store / Play Store
- Configure DNS for client domain

---

## Environment Variables Reference

### Backend (.env)
```
MONGO_URL=mongodb://localhost:27017
MONGO_DB_NAME=bizcore_client1
SECRET_KEY=your-secret-key
GOOGLE_CLIENT_ID=xxx
GOOGLE_CLIENT_SECRET=xxx
GOOGLE_REDIRECT_URI=https://domain.com/api/auth/callback/google
```

### Frontend (.env)
```
EXPO_PUBLIC_BACKEND_URL=https://api.clientdomain.com
EXPO_PUBLIC_PROJECT_ID=your-expo-project-id
```

---

## Features Summary

| Feature | Status | Notes |
|---------|--------|-------|
| Dashboard | ✅ Ready | KPIs, charts, activity feed |
| Inventory | ✅ Ready | Products, stock, barcode scanning |
| Orders | ✅ Ready | Purchase & Sales orders |
| Partners | ✅ Ready | Suppliers & Distributors |
| Finance | ✅ Ready | Expenses, invoices, P&L |
| Reports | ✅ Ready | Stock, aging, P&L, cash flow |
| Barcode Scanning | ✅ Ready | Camera-based scanning |
| Offline Mode | ✅ Ready | Local data caching |
| Push Notifications | ✅ Ready | Low stock alerts |
| PDF Export | ✅ Ready | Invoice & report export |
| Google OAuth | ⏳ Pending | Requires client credentials |

---

## Support

For deployment assistance, contact:
- **Email**: support@bizcore.com
- **Docs**: https://docs.bizcore.com
