# 🚀 CollectAI Deployment & Hosting Guide

This guide covers how to deploy and host the **CollectAI** fullstack application (Node.js/Express API + Vite/React SPA + Google Gemini AI + Firebase/Firestore).

---

## 📋 Required Environment Variables

Before deploying to any platform, have these environment variables ready:

### Backend Variables:
| Variable | Description | Example / How to get |
|---|---|---|
| `NODE_ENV` | Environment mode | `production` |
| `PORT` | Server port (auto-set by hosting platforms) | `3000` |
| `GEMINI_API_KEY` | Google Gemini API key | Get from [Google AI Studio](https://aistudio.google.com/) |
| `FIREBASE_PROJECT_ID` | Your Firebase Project ID | e.g. `my-project-939a2` |
| `FIREBASE_SERVICE_ACCOUNT` | *(Recommended)* Full JSON content or Base64 string of `serviceAccountKey.json` | From Firebase Console > Project Settings > Service Accounts > Generate new private key |
| `SMTP_HOST` | Email SMTP host | `smtp.ethereal.email` or `smtp.gmail.com` |
| `SMTP_PORT` | Email SMTP port | `587` |
| `SMTP_USER` | Email username | Your SMTP email |
| `SMTP_PASS` | Email password | Your SMTP app password |
| `SMTP_FROM_NAME` | Sender display name | `CollectAI` |
| `SMTP_FROM_EMAIL` | Sender email address | `noreply@yourdomain.com` |

### Frontend Variables (Vite Client):
| Variable | Description |
|---|---|
| `VITE_FIREBASE_API_KEY` | Firebase Web API Key |
| `VITE_FIREBASE_AUTH_DOMAIN` | Firebase Auth Domain (`<project-id>.firebaseapp.com`) |
| `VITE_FIREBASE_PROJECT_ID` | Firebase Project ID |
| `VITE_FIREBASE_APP_ID` | Firebase Web App ID |
| `VITE_FIREBASE_STORAGE_BUCKET` | *(Optional)* Firebase Storage Bucket |
| `VITE_FIREBASE_MESSAGING_SENDER_ID` | *(Optional)* Sender ID |

---

## 🌟 Option 1: Deploy to Render (Recommended — Free & Easiest)

Render is pre-configured in this repository via [render.yaml](file:///render.yaml).

### Steps:
1. Push your latest code to GitHub:
   ```bash
   git add .
   git commit -m "Configure deployment"
   git push origin main
   ```
2. Go to [Render Dashboard](https://dashboard.render.com/) and click **New +** > **Blueprint** (or **Web Service**).
3. Connect your repository: `https://github.com/IamMewing/COLLECT-AI`.
4. If using **Web Service**:
   - **Environment**: `Node`
   - **Build Command**: `npm install && npm run build`
   - **Start Command**: `npm start`
   - **Plan**: `Free`
5. In the **Environment Variables** tab, add the backend & frontend variables listed above.
6. Click **Deploy**. Render will build the Vite frontend into `public/` and serve both the API and the React SPA under your `https://<app-name>.onrender.com` URL.

---

## 🚂 Option 2: Deploy to Railway

1. Go to [Railway.app](https://railway.app/) and sign in with GitHub.
2. Click **New Project** > **Deploy from GitHub repo**.
3. Select `IamMewing/COLLECT-AI`.
4. Add the Environment Variables under the **Variables** tab.
5. In **Settings** > **Build & Deploy**:
   - Build Command: `npm install && npm run build`
   - Start Command: `npm start`
6. Click **Generate Domain** under Networking.

---

## ☁️ Option 3: Deploy to Google Cloud Run (Native Google Cloud)

Ideal for the Build with Gemini Hackathon:

1. Install Google Cloud SDK (`gcloud`).
2. Authenticate and select your project:
   ```bash
   gcloud auth login
   gcloud config set project <YOUR_PROJECT_ID>
   ```
3. Build and deploy container directly using Cloud Build and Cloud Run:
   ```bash
   gcloud run deploy collectai \
     --source . \
     --platform managed \
     --region us-central1 \
     --allow-unauthenticated \
     --set-env-vars GEMINI_API_KEY="<YOUR_KEY>",FIREBASE_PROJECT_ID="<PROJECT_ID>",NODE_ENV="production"
   ```

---

## 🔥 Option 4: Deploy Frontend to Firebase Hosting

If you want to host static frontend on Firebase Hosting:
1. Install Firebase CLI:
   ```bash
   npm install -g firebase-tools
   ```
2. Login and deploy:
   ```bash
   firebase login
   firebase deploy --only hosting
   ```
