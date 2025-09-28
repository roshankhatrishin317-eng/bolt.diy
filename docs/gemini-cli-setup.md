# Gemini CLI OAuth Setup Guide

## Prerequisites

To use the Gemini CLI provider, you need OAuth credentials from the Gemini CLI tool. This provider uses OAuth authentication and does not require API keys.

## Setup Steps

### 1. Install Gemini CLI

First, install the official Gemini CLI tool:

```bash
# Install Gemini CLI
npm install -g @google/gemini-cli

# Or using other package managers
yarn global add @google/gemini-cli
pnpm add -g @google/gemini-cli
```

### 2. Authenticate with Gemini CLI

Run the authentication command to set up OAuth:

```bash
gemini auth login
```

This will:
- Open your browser for OAuth authentication
- Create OAuth credentials automatically
- Store them in `~/.gemini/oauth_creds.json`

### 3. Verify Credentials File

Check that the credentials file exists with the correct structure:

```json
{
  "access_token": "your_access_token_here",
  "refresh_token": "your_refresh_token_here",
  "token_type": "Bearer",
  "expiry_date": 1735689600000
}
```

**Location**: `~/.gemini/oauth_creds.json`

### 4. Environment Variable (Optional)

If you want to use a custom path for credentials:

```bash
# In .env.local
GEMINI_CLI_OAUTH_PATH=/path/to/your/oauth_creds.json
```

### 5. Enable Provider in Bolt.diy

1. Open Bolt.diy settings
2. Go to Cloud Providers tab
3. Enable "Gemini CLI" provider
4. **Configure OAuth path** (if not using default):
   - Click on the Gemini CLI provider configuration
   - In the "Base URL" field, enter the path to your OAuth credentials file
   - Example: `/home/user/.gemini/oauth_creds.json`
   - Leave empty to use default: `~/.gemini/oauth_creds.json`
5. Select from available models

## Available Models

- **gemini-2.5-pro**: Advanced multimodal model with image support
  - Context Window: 1,048,576 tokens
  - Max Output: 64,000 tokens
  - Supports images and advanced reasoning

## OAuth Token Management

The provider includes comprehensive OAuth token management:

- **Automatic Refresh**: Expired tokens are automatically refreshed using the refresh_token
- **Credential Persistence**: Updated tokens are saved back to the credentials file
- **Error Handling**: Graceful handling of authentication failures
- **Token Validation**: Checks token expiry with 30-second buffer
- **Remote Config**: Fetches OAuth client configuration from remote endpoint

## Key Features

### 1. **No API Keys Required**
- Uses OAuth authentication from Gemini CLI
- Seamless integration with existing Gemini CLI setup

### 2. **Advanced Authentication**
- Fetches OAuth client configuration remotely
- Supports Google OAuth2 token refresh flow
- Automatic credential file management

### 3. **Code Assistance Integration**
- Connects to Google Code Assist API
- Optimized for coding and development tasks
- Supports thinking/reasoning capabilities

## Troubleshooting

### Authentication Issues
- Verify the OAuth credentials file exists: `~/.gemini/oauth_creds.json`
- Check that the JSON format is valid
- Ensure `access_token` and `refresh_token` are present
- Verify `expiry_date` is in milliseconds since Unix epoch

### File Path Issues
- Default path: `~/.gemini/oauth_creds.json`
- Custom path can be set via `GEMINI_CLI_OAUTH_PATH` environment variable
- Or configured in provider settings "Base URL" field
- Directory will be created automatically if it doesn't exist

### Token Refresh Issues
- Check console logs for detailed error messages
- Verify refresh_token is still valid
- Ensure network connectivity to Google OAuth endpoints
- Try re-authenticating with `gemini auth login`

### Model Issues
- Ensure you have access to the Gemini models
- Check that your Google account has proper permissions
- Verify the Code Assist API is accessible from your network

## CLI Commands

Useful Gemini CLI commands for troubleshooting:

```bash
# Check authentication status
gemini auth status

# Re-authenticate if needed
gemini auth login

# Logout and clear credentials
gemini auth logout

# Test model access
gemini chat "Hello, world!"
```

## Integration Benefits

### vs Regular Google Provider
- **No API Key Management**: Uses OAuth instead of API keys
- **CLI Integration**: Leverages existing Gemini CLI setup
- **Enhanced Features**: Access to Code Assist API features

### vs Other Providers
- **Free Tier Access**: May provide access to free tier usage
- **Advanced Models**: Access to latest Gemini models
- **Reasoning Support**: Built-in support for thinking/reasoning models

## Security Notes

- OAuth credentials are managed by Google's secure OAuth2 flow
- Tokens are automatically refreshed as needed
- Credentials are stored securely in your home directory
- No API keys to manage or expose
- Uses industry-standard OAuth2 security practices
