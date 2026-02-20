# Netlify Deployment Guide — Anti-Mul

This guide walks through deploying the Anti-Mul frontend and backend to Netlify with proper API routing.

---

## 🚀 Quick Start

### 1. **Prepare Your Repository**
Ensure your repo has the correct structure:
```
├── netlify.toml           ← Netlify configuration
├── netlify/
│   └── functions/
│       └── api.js         ← API proxy function
├── public/                ← Frontend static files
│   ├── index.html
│   ├── app.js
│   ├── styles.css
│   └── _redirects
├── requirements.txt       ← Python dependencies
└── backend/               ← Backend source (optional for deployment)
```

### 2. **Connect to Netlify**
```bash
# Option A: Via Netlify CLI
npm install -g netlify-cli
netlify init

# Option B: Via GitHub integration (recommended)
# Push to GitHub, connect in Netlify Dashboard
```

### 3. **Configure Environment Variables**

In Netlify Dashboard → Site Settings → Build & Deploy → Environment:

```
BACKEND_URL = https://your-backend-server.com
```

Where `your-backend-server.com` is:
- **Railway**: `https://your-project.railway.app`
- **Render**: `https://your-service.onrender.com`
- **Fly.io**: `https://your-app.fly.dev`
- **Local Dev**: `http://localhost:8000`

---

## 📋 Deployment Options

### Option 1: Backend on Separate Service (Recommended)

**Backend Server Deployment:**

1. Deploy to Railway, Render, or similar:
   ```bash
   # Railway example
   railway init
   railway up
   ```

2. Get your backend URL (e.g., `https://backend.railway.app`)

3. Set `BACKEND_URL` environment variable in Netlify

**Frontend Deployment:**
```bash
git push origin main
# Netlify auto-deploys via GitHub
```

---

### Option 2: Backend + Frontend on Same Netlify Site

**Limitations:** Netlify functions have 10-second timeout; not ideal for long-running analysis.

**Setup:**
1. Deploy frontend to Netlify (automatic via `netlify.toml`)
2. API calls route through `netlify/functions/api.js`
3. Keep backend running separately; ensure `BACKEND_URL` is set

---

## 🔧 Configuration Details

### netlify.toml

```toml
[build]
  command = "echo 'Frontend ready'"
  publish = "public"
  functions = "netlify/functions"

[[redirects]]
  from = "/analyze"
  to = "/.netlify/functions/api"
  
# SPA fallback
[[redirects]]
  from = "/*"
  to = "/index.html"
```

### netlify/functions/api.js

- Proxies API requests to the backend server
- Reads `BACKEND_URL` environment variable
- Handles CORS headers automatically

### Frontend API Configuration

The frontend automatically detects the environment:
- **Local** (`localhost:*`): Calls `http://localhost:8000`
- **Netlify/Production**: Calls relative paths (routed through functions)
- **Custom**: Set `window.__API_BASE_URL__` before app loads

---

## 📝 API Endpoints

All endpoints are proxied through `/` (relative path):

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/analyze` | POST | Upload CSV and run fraud detection |
| `/account/{id}` | GET | Get account details |
| `/download-json` | GET | Download latest results |
| `/health` | GET | Health check |
| `/neo4j/graph` | GET | Neo4j graph (optional) |

---

## 🧪 Testing

### Local Development
```bash
# Terminal 1: Backend
cd backend
python -m uvicorn main:app --reload --port 8000

# Terminal 2: Frontend (static file server)
npx http-server public -p 3000
```

Visit: `http://localhost:3000`

### Staging on Netlify
```bash
netlify deploy --prod
```

---

## 🔍 Troubleshooting

### "502 Bad Gateway" Errors

**Cause:** Backend server unreachable

**Fix:**
1. Verify `BACKEND_URL` is correct and accessible
2. Check backend health: `curl https://your-backend/health`
3. Verify CORS is enabled on backend

### "Cannot POST /analyze"

**Cause:** API routing misconfigured

**Fix:**
1. Verify `netlify.toml` redirects are present
2. Check function logs: Netlify Dashboard → Functions → api
3. Ensure backend is responding

### Frontend Shows "No data loaded"

**Cause:** API calls failing silently

**Fix:**
1. Open browser DevTools → Console
2. Check for network errors
3. Verify BACKEND_URL environment variable

---

## 📦 Production Checklist

- [ ] Backend deployed and running
- [ ] `BACKEND_URL` environment variable set in Netlify
- [ ] Git repository connected to Netlify
- [ ] CustomDomain configured (optional)
- [ ] CORS enabled on backend
- [ ] Tested file upload → analysis flow
- [ ] Verified PDF export works
- [ ] Checked error logs in Netlify Dashboard

---

## 🔗 Additional Resources

- [Netlify Functions Docs](https://docs.netlify.com/functions/overview/)
- [Netlify Redirects & Rewrites](https://docs.netlify.com/routing/redirects/)
- [Environment Variables](https://docs.netlify.com/build-release-manage/configure-builds/environment/)

---

**Need help?** Check Netlify's function logs and browser DevTools console for detailed error messages.
