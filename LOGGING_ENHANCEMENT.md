# Logging Enhancement for Debugging Vercel Deployment

## Problem
API returns 500 error on Vercel, need comprehensive logging to diagnose the issue.

## Changes Made

### 1. Enhanced api/server.js
Added detailed request/response logging:
- Request ID for tracking
- Incoming request details (method, URL, headers)
- Execution time tracking
- Detailed error logging with stack traces
- Structured error responses

### 2. Enhanced server.js initialization
Added startup logging:
- Environment variable presence check
- Service initialization tracking
- Provider availability logging

### 3. Added middleware logging
Track each middleware execution:
- CORS handling
- Request processing
- Response timing

## How to View Logs

### On Vercel:
1. Go to Vercel Dashboard
2. Select your project (apply-bot)
3. Click on the latest deployment
4. Go to "Functions" tab
5. Find `/api/server` function
6. Click "Logs" to see real-time output

### Expected Log Output:

```
[SERVER INIT] Starting server initialization...
[SERVER INIT] __dirname: /var/task
[SERVER INIT] Loading environment variables...
[SERVER INIT] Environment variables loaded:
[SERVER INIT] - TAVILY_API_KEY: ✓ Present
[SERVER INIT] - BRAVE_API_KEY: ✓ Present
[SERVER INIT] - GOOGLE_MAPS_API_KEY: ✓ Present
[abc123] START GET /api/lead-workspaces
[abc123] Passing to Express app...
[abc123] SUCCESS in 145ms
```

## Common Issues to Check

1. **Missing Environment Variables**
   - Check Vercel project settings
   - Ensure all required env vars are set

2. **Module Import Errors**
   - Check if all dependencies are in package.json
   - Verify build succeeds on Vercel

3. **File System Access**
   - Vercel serverless is read-only
   - Check if code tries to write local files

4. **Memory/Timeout Issues**
   - Default timeout: 10 seconds
   - Check vercel.json maxDuration setting

## Next Steps

After deployment, check Vercel function logs to identify:
- Where the error occurs (initialization vs request handling)
- Which environment variables are missing
- What the actual error message and stack trace show
