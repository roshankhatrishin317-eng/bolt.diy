# Qwen OAuth Setup Guide

## Prerequisites

To use the QwenCode provider, you need OAuth credentials from Qwen AI.

## Setup Steps

### 1. Obtain OAuth Credentials

1. Visit [Qwen AI Settings](https://chat.qwen.ai/settings)
2. Generate OAuth credentials (access_token, refresh_token, etc.)

### 2. Create Credentials File

Create a file at `~/.qwen/oauth_creds.json` (or custom path) with the following structure:

```json
{
  "access_token": "your_access_token_here",
  "refresh_token": "your_refresh_token_here",
  "token_type": "Bearer",
  "expiry_date": 1640995200000
}
```

**Important Notes:**
- `expiry_date` should be in milliseconds since Unix epoch
- The provider automatically uses the correct DashScope API endpoint
- The provider will automatically refresh expired tokens
- Do not include `resource_url` field - it may cause API endpoint conflicts

### 3. Environment Variable (Optional)

If you want to use a custom path for credentials:

```bash
# In .env.local
QWEN_OAUTH_PATH=/path/to/your/oauth_creds.json
```

### 4. Enable Provider

1. Open Bolt.diy settings
2. Go to Cloud Providers tab
3. Enable "QwenCode" provider
4. **Configure OAuth path** (if not using default):
   - Click on the QwenCode provider configuration
   - In the "Base URL" field, enter the path to your OAuth credentials file
   - Example: `/home/user/.qwen/oauth_creds.json`
   - Leave empty to use default: `~/.qwen/oauth_creds.json`
5. Select models: `qwen3-coder-flash`, `qwen3-coder-plus`, or `qwen3-coder-480b-a35b-instruct`
