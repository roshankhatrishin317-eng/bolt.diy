// Gemini CLI Provider - OAuth authentication from Gemini CLI tool
// Supports OAuth credentials from ~/.gemini/oauth_creds.json
import { BaseProvider } from '~/lib/modules/llm/base-provider';
import type { ModelInfo } from '~/lib/modules/llm/types';
import type { IProviderSetting } from '~/types/model';
import type { LanguageModelV1 } from 'ai';
import { createGoogleGenerativeAI } from '@ai-sdk/google';

// OAuth2 Configuration
const OAUTH_REDIRECT_URI = "http://localhost:45289";
const CODE_ASSIST_ENDPOINT = "https://cloudcode-pa.googleapis.com";
const CODE_ASSIST_API_VERSION = "v1internal";

// OAuth credentials interface
interface OAuthCredentials {
  access_token: string;
  refresh_token: string;
  token_type: string;
  expiry_date: number;
}

interface OauthConfig {
  oauthClientId: string;
  oauthClientSecret: string;
}

// Utility function to get OAuth credentials file path
async function getGeminiCredentialPath(customPath?: string): Promise<string> {
  const pathMod = await import('node:path');
  const osMod = await import('node:os');

  if (customPath) {
    // Support custom path that starts with ~/ or is absolute
    if (customPath.startsWith('~/')) {
      return pathMod.join(osMod.homedir(), customPath.slice(2));
    }
    return pathMod.resolve(customPath);
  }
  
  // Default path: ~/.gemini/oauth_creds.json
  return pathMod.join(osMod.homedir(), '.gemini', 'oauth_creds.json');
}

export default class GeminiCliProvider extends BaseProvider {
  name = 'GeminiCli';
  getApiKeyLink = 'https://cloud.google.com/code/docs/intellij/gemini-cli-setup';
  labelForGetApiKey = 'OAuth credentials required from Gemini CLI. Ensure ~/.gemini/oauth_creds.json exists';

  config = {
    apiTokenKey: 'GEMINI_CLI_OAUTH_PATH', // Path to OAuth credentials file
    baseUrlKey: 'GEMINI_CLI_BASE_URL',    // Optional custom base URL
    baseUrl: CODE_ASSIST_ENDPOINT, // Default Gemini Code Assist API endpoint
  };

  // OAuth credentials cache with lazy loading
  private _credentials: OAuthCredentials | null = null;
  private _refreshPromise: Promise<OAuthCredentials> | null = null;
  private _oauthPath?: string;
  private _initialized = false;
  private _projectId: string | null = null;
  private _oauthConfig: OauthConfig | null = null;

  // Static models - Gemini CLI models
  staticModels: ModelInfo[] = [
    {
      name: 'gemini-2.5-pro',
      label: 'Gemini 2.5 Pro - Advanced multimodal model with image support',
      provider: 'GeminiCli',
      maxTokenAllowed: 1048576, // 1,048,576 tokens context window
      maxCompletionTokens: 64000, // 64,000 tokens max output
    },
  ];

  // Initialize OAuth path from settings - prevents infinite loops
  private initializeOAuthPath(
    settings?: IProviderSetting,
    serverEnv?: Record<string, string>
  ): void {
    if (this._initialized) return;

    // Set OAuth path from provider settings or environment
    this._oauthPath =
      settings?.baseUrl || // Using baseUrl field to store OAuth path in UI
      serverEnv?.[this.config.apiTokenKey!] ||
      (typeof process !== 'undefined' ? process.env?.[this.config.apiTokenKey!] : undefined);

    this._initialized = true;
    console.log('GeminiCli: OAuth path initialized:', this._oauthPath || 'default (~/.gemini/oauth_creds.json)');
  }

  // Fetch OAuth configuration from remote config
  private async fetchOAuthConfig(): Promise<OauthConfig> {
    if (this._oauthConfig) {
      return this._oauthConfig;
    }

    try {
      console.log('GeminiCli: Fetching OAuth configuration...');
      const response = await fetch('https://api.kilocode.ai/extension-config.json');
      
      if (!response.ok) {
        throw new Error(`Failed to fetch config: ${response.status} ${response.statusText}`);
      }

      const data = await response.json() as any;
      this._oauthConfig = data.geminiCli;
      
      if (!this._oauthConfig?.oauthClientId || !this._oauthConfig?.oauthClientSecret) {
        throw new Error('OAuth client credentials not found in config');
      }

      console.log('GeminiCli: OAuth configuration loaded successfully');
      return this._oauthConfig;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error('GeminiCli: Failed to fetch OAuth config:', errorMessage);
      throw new Error(`Failed to load OAuth configuration: ${errorMessage}`);
    }
  }

  // Load OAuth credentials from file
  private async loadCredentials(): Promise<OAuthCredentials> {
    try {
      const credPath = await getGeminiCredentialPath(this._oauthPath);
      const fs = await import('node:fs/promises');
      
      console.log('GeminiCli: Loading credentials from:', credPath);
      const credsStr = await fs.readFile(credPath, 'utf-8');
      const credentials = JSON.parse(credsStr) as OAuthCredentials;
      
      if (!credentials.access_token || !credentials.refresh_token) {
        throw new Error('Invalid credentials format: missing access_token or refresh_token');
      }
      
      return credentials;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error('GeminiCli: Failed to load credentials:', errorMessage);
      throw new Error(`Failed to load Gemini CLI OAuth credentials: ${errorMessage}`);
    }
  }

  // Save refreshed credentials back to file
  private async saveCredentials(credentials: OAuthCredentials): Promise<void> {
    try {
      const credPath = await getGeminiCredentialPath(this._oauthPath);
      const fs = await import('node:fs/promises');
      const pathMod = await import('node:path');
      
      // Ensure directory exists
      await fs.mkdir(pathMod.dirname(credPath), { recursive: true });
      
      await fs.writeFile(credPath, JSON.stringify(credentials, null, 2), 'utf-8');
      console.log('GeminiCli: Credentials saved successfully');
    } catch (error) {
      console.error('GeminiCli: Failed to save credentials:', error);
      // Don't throw - continue with in-memory credentials
    }
  }

  // Check if access token is valid (not expired)
  private isTokenValid(credentials: OAuthCredentials): boolean {
    const TOKEN_REFRESH_BUFFER = 30 * 1000; // 30 seconds buffer
    if (!credentials.expiry_date) {
      return false;
    }
    return Date.now() < (credentials.expiry_date - TOKEN_REFRESH_BUFFER);
  }

  // Refresh access token using Google OAuth2
  private async refreshAccessToken(credentials: OAuthCredentials): Promise<OAuthCredentials> {
    // Prevent multiple concurrent refresh attempts
    if (this._refreshPromise) {
      console.log('GeminiCli: Refresh already in progress, waiting...');
      return await this._refreshPromise;
    }

    this._refreshPromise = this.performTokenRefresh(credentials);
    
    try {
      const result = await this._refreshPromise;
      return result;
    } finally {
      this._refreshPromise = null;
    }
  }

  // Perform the actual token refresh using google-auth-library pattern
  private async performTokenRefresh(credentials: OAuthCredentials): Promise<OAuthCredentials> {
    if (!credentials.refresh_token) {
      throw new Error('No refresh token available');
    }

    console.log('GeminiCli: Refreshing access token...');

    try {
      const oauthConfig = await this.fetchOAuthConfig();
      
      const refreshData = {
        grant_type: 'refresh_token',
        refresh_token: credentials.refresh_token,
        client_id: oauthConfig.oauthClientId,
        client_secret: oauthConfig.oauthClientSecret,
      };

      const response = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams(refreshData).toString(),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Token refresh failed: ${response.status} ${response.statusText}. Response: ${errorText}`);
      }

      const tokenData = await response.json() as any;

      if (tokenData.error) {
        throw new Error(`Token refresh error: ${tokenData.error} - ${tokenData.error_description || 'Unknown error'}`);
      }

      // Create new credentials with refreshed token
      const newCredentials: OAuthCredentials = {
        ...credentials,
        access_token: tokenData.access_token,
        token_type: tokenData.token_type || 'Bearer',
        refresh_token: tokenData.refresh_token || credentials.refresh_token,
        expiry_date: Date.now() + (tokenData.expires_in * 1000),
      };

      // Save refreshed credentials
      await this.saveCredentials(newCredentials);
      
      console.log('GeminiCli: Access token refreshed successfully');
      return newCredentials;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error('GeminiCli: Token refresh failed:', errorMessage);
      throw new Error(`Failed to refresh access token: ${errorMessage}`);
    }
  }

  // Ensure authentication and get valid access token
  private async ensureAuthenticated(
    settings?: IProviderSetting,
    serverEnv?: Record<string, string>
  ): Promise<string> {
    // Initialize OAuth path if not done yet
    this.initializeOAuthPath(settings, serverEnv);

    // Load credentials if not cached
    if (!this._credentials) {
      this._credentials = await this.loadCredentials();
    }

    // Refresh token if expired
    if (!this.isTokenValid(this._credentials)) {
      console.log('GeminiCli: Access token expired, refreshing...');
      this._credentials = await this.refreshAccessToken(this._credentials);
    }

    return this._credentials.access_token;
  }

  // API call wrapper with automatic token refresh on 401 errors
  private async callApiWithRetry<T>(apiCall: () => Promise<T>): Promise<T> {
    try {
      console.log('GeminiCli: Making API call...');
      const result = await apiCall();
      console.log('GeminiCli: API call successful');
      return result;
    } catch (error: any) {
      console.error('GeminiCli: API call failed:', error.message, 'Status:', error.status);
      // If unauthorized, try to refresh token and retry once
      if (error.status === 401 && this._credentials) {
        console.log('GeminiCli: Got 401 error, refreshing token and retrying...');
        this._credentials = await this.refreshAccessToken(this._credentials);
        console.log('GeminiCli: Retrying API call with refreshed token...');
        return await apiCall(); // Retry with new token
      }
      throw error;
    }
  }

  // Auto-detect and fetch available models from Gemini CLI API
  async getDynamicModels(
    apiKeys?: Record<string, string>,
    settings?: IProviderSetting,
    serverEnv?: Record<string, string>
  ): Promise<ModelInfo[]> {
    // Avoid server-only operations in browser
    if (typeof window !== 'undefined') {
      return [];
    }

    try {
      // Initialize OAuth path
      this.initializeOAuthPath(settings, serverEnv);

      // Try to get access token and fetch available models
      try {
        const token = await this.ensureAuthenticated(settings, serverEnv);
        console.log('GeminiCli: OAuth authentication successful, using static models');
        
        // Gemini CLI uses specific models, return empty for now
        // Static models will be used
        return [];
      } catch (authError) {
        const errorMessage = authError instanceof Error ? authError.message : String(authError);
        console.log('GeminiCli: OAuth credentials not available for dynamic models:', errorMessage);
      }
    } catch (error) {
      console.error('GeminiCli: Error in getDynamicModels:', error);
    }

    // Return empty array to use static models as fallback
    return [];
  }

  // Create model instance with OAuth authentication (OpenAI-compatible wrapper)
  getModelInstance(options: {
    model: string;
    serverEnv?: Env;
    apiKeys?: Record<string, string>;
    providerSettings?: Record<string, IProviderSetting>;
  }): LanguageModelV1 {
    if (typeof window !== 'undefined') {
      throw new Error('GeminiCliProvider.getModelInstance must be called on the server');
    }

    const { model, serverEnv, providerSettings } = options;
    
    // Convert Env to Record<string, string> for safe access
    const envRecord: Record<string, string> = {};
    if (serverEnv) {
      Object.entries(serverEnv).forEach(([key, value]) => {
        envRecord[key] = String(value);
      });
    }

    console.log('GeminiCli: Creating model instance for:', model);

    // Create a proxy wrapper that handles async authentication
    let clientPromise: Promise<ReturnType<typeof createGoogleGenerativeAI>> | null = null;
    let isInitializing = false;
    
    const getAuthenticatedClient = async () => {
      if (!clientPromise && !isInitializing) {
        isInitializing = true;
        try {
          const token = await this.ensureAuthenticated(providerSettings?.[this.name], envRecord);
          
          console.log('GeminiCli: Authentication successful, creating OpenAI-compatible client');
          
          // Create Google Generative AI client with OAuth token
          const client = createGoogleGenerativeAI({
            apiKey: token,
          });
          
          clientPromise = Promise.resolve(client);
          return client;
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : String(error);
          throw new Error(`GeminiCli authentication failed: ${errorMessage}. Please ensure OAuth credentials are properly configured in ~/.gemini/oauth_creds.json`);
        } finally {
          isInitializing = false;
        }
      }
      
      return clientPromise || Promise.reject(new Error('Client initialization in progress'));
    };

    // Create a temporary client for the proxy
    const tempClient = createGoogleGenerativeAI({
      apiKey: 'placeholder', // Will be replaced with real token
    });

    const baseModel = tempClient(model);

    // Create proxy to intercept API calls and inject authentication
    const authenticatedModel = new Proxy(baseModel, {
      get: (target, prop) => {
        // Intercept doGenerate and doStream methods to inject authentication
        if (prop === 'doGenerate' || prop === 'doStream') {
          return async (...args: any[]) => {
            const client = await getAuthenticatedClient();
            const authenticatedModel = client(model);
            return await this.callApiWithRetry(() => 
              (authenticatedModel as any)[prop](...args)
            );
          };
        }
        
        // Return other properties as-is
        return (target as any)[prop];
      },
    });

    return authenticatedModel as LanguageModelV1;
  }
}
