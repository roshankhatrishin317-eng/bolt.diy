// QwenCode Provider - OAuth-based API authentication system
// Supports OAuth credentials from ~/.qwen/oauth_creds.json
import { BaseProvider } from '~/lib/modules/llm/base-provider';
import type { ModelInfo } from '~/lib/modules/llm/types';
import type { IProviderSetting } from '~/types/model';
import type { LanguageModelV1 } from 'ai';
import { createOpenAI } from '@ai-sdk/openai';

// Qwen OAuth configuration
const QWEN_OAUTH_BASE_URL = 'https://chat.qwen.ai';
const QWEN_OAUTH_TOKEN_ENDPOINT = `${QWEN_OAUTH_BASE_URL}/api/v1/oauth2/token`;
const QWEN_OAUTH_CLIENT_ID = 'f0304373b74a44d2b584a3fb70ca9e56';
const QWEN_DEFAULT_DIR = '.qwen';
const QWEN_CREDENTIAL_FILENAME = 'oauth_creds.json';

// OAuth credentials interface
interface QwenOAuthCredentials {
  access_token: string;
  refresh_token: string;
  token_type: string;
  expiry_date: number;
  resource_url?: string;
}

// Utility function to get OAuth credentials file path
async function getQwenCredentialPath(customPath?: string): Promise<string> {
  const pathMod = await import('node:path');
  const osMod = await import('node:os');

  if (customPath) {
    // Support custom path that starts with ~/ or is absolute
    if (customPath.startsWith('~/')) {
      return pathMod.join(osMod.homedir(), customPath.slice(2));
    }
    return pathMod.resolve(customPath);
  }
  
  // Default path: ~/.qwen/oauth_creds.json
  return pathMod.join(osMod.homedir(), QWEN_DEFAULT_DIR, QWEN_CREDENTIAL_FILENAME);
}

// URL encoding utility for OAuth requests
function objectToUrlEncoded(data: Record<string, string>): string {
  return Object.keys(data)
    .map((key) => `${encodeURIComponent(key)}=${encodeURIComponent(data[key])}`)
    .join('&');
}

export default class QwenCodeProvider extends BaseProvider {
  name = 'QwenCode';
  getApiKeyLink = 'https://chat.qwen.ai/settings';
  labelForGetApiKey = 'OAuth credentials required. Ensure ~/.qwen/oauth_creds.json exists with valid tokens';

  config = {
    apiTokenKey: 'QWEN_OAUTH_PATH', // Path to OAuth credentials file
    baseUrlKey: 'QWEN_BASE_URL',    // Optional custom base URL
    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1', // Default Qwen API endpoint
  };

  // OAuth credentials cache with lazy loading
  private _credentials: QwenOAuthCredentials | null = null;
  private _refreshPromise: Promise<QwenOAuthCredentials> | null = null;
  private _oauthPath?: string;
  private _initialized = false;
  private _client: ReturnType<typeof createOpenAI> | null = null;

  // Static models - using official Qwen API model names
  staticModels: ModelInfo[] = [
    {
      name: 'qwen3-coder-flash',
      label: 'Qwen3 Coder Flash - Fast coding model',
      provider: 'QwenCode',
      maxTokenAllowed: 128000,
      maxCompletionTokens: 8192,
    },
    {
      name: 'qwen3-coder-plus',
      label: 'Qwen3 Coder Plus - High-performance coding model',
      provider: 'QwenCode',
      maxTokenAllowed: 128000,
      maxCompletionTokens: 8192,
    },
    {
      name: 'qwen3-coder-480b-a35b-instruct',
      label: 'Qwen3 Coder 480B A35B Instruct - Advanced coding model',
      provider: 'QwenCode',
      maxTokenAllowed: 128000,
      maxCompletionTokens: 8192,
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
    console.log('QwenCode: OAuth path initialized:', this._oauthPath || 'default (~/.qwen/oauth_creds.json)');
  }

  // Load OAuth credentials from file
  private async loadCredentials(): Promise<QwenOAuthCredentials> {
    try {
      const credPath = await getQwenCredentialPath(this._oauthPath);
      const fs = await import('node:fs/promises');
      
      console.log('QwenCode: Loading credentials from:', credPath);
      const credsStr = await fs.readFile(credPath, 'utf-8');
      const credentials = JSON.parse(credsStr) as QwenOAuthCredentials;
      
      if (!credentials.access_token || !credentials.refresh_token) {
        throw new Error('Invalid credentials format: missing access_token or refresh_token');
      }
      
      return credentials;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error('QwenCode: Failed to load credentials:', errorMessage);
      throw new Error(`Failed to load Qwen OAuth credentials: ${errorMessage}`);
    }
  }

  // Save refreshed credentials back to file
  private async saveCredentials(credentials: QwenOAuthCredentials): Promise<void> {
    try {
      const credPath = await getQwenCredentialPath(this._oauthPath);
      const fs = await import('node:fs/promises');
      const pathMod = await import('node:path');
      
      // Ensure directory exists
      await fs.mkdir(pathMod.dirname(credPath), { recursive: true });
      
      await fs.writeFile(credPath, JSON.stringify(credentials, null, 2), 'utf-8');
      console.log('QwenCode: Credentials saved successfully');
    } catch (error) {
      console.error('QwenCode: Failed to save credentials:', error);
      // Don't throw - continue with in-memory credentials
    }
  }

  // Check if access token is valid (not expired)
  private isTokenValid(credentials: QwenOAuthCredentials): boolean {
    const TOKEN_REFRESH_BUFFER = 30 * 1000; // 30 seconds buffer
    if (!credentials.expiry_date) {
      return false;
    }
    return Date.now() < (credentials.expiry_date - TOKEN_REFRESH_BUFFER);
  }

  // Refresh access token using refresh token
  private async refreshAccessToken(credentials: QwenOAuthCredentials): Promise<QwenOAuthCredentials> {
    // Prevent multiple concurrent refresh attempts
    if (this._refreshPromise) {
      console.log('QwenCode: Refresh already in progress, waiting...');
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

  // Perform the actual token refresh
  private async performTokenRefresh(credentials: QwenOAuthCredentials): Promise<QwenOAuthCredentials> {
    if (!credentials.refresh_token) {
      throw new Error('No refresh token available');
    }

    console.log('QwenCode: Refreshing access token...');

    const requestBody = {
      grant_type: 'refresh_token',
      refresh_token: credentials.refresh_token,
      client_id: QWEN_OAUTH_CLIENT_ID,
    };

    try {
      const response = await fetch(QWEN_OAUTH_TOKEN_ENDPOINT, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Accept': 'application/json',
        },
        body: objectToUrlEncoded(requestBody),
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
      const newCredentials: QwenOAuthCredentials = {
        ...credentials,
        access_token: tokenData.access_token,
        token_type: tokenData.token_type || 'Bearer',
        refresh_token: tokenData.refresh_token || credentials.refresh_token, // Keep old refresh token if new one not provided
        expiry_date: Date.now() + (tokenData.expires_in * 1000), // Convert seconds to milliseconds
      };

      // Save refreshed credentials
      await this.saveCredentials(newCredentials);
      
      console.log('QwenCode: Access token refreshed successfully');
      return newCredentials;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error('QwenCode: Token refresh failed:', errorMessage);
      throw new Error(`Failed to refresh access token: ${errorMessage}`);
    }
  }

  // Ensure client is created and authenticated
  private async ensureClient(
    settings?: IProviderSetting,
    serverEnv?: Record<string, string>
  ): Promise<ReturnType<typeof createOpenAI>> {
    // Initialize OAuth path if not done yet
    this.initializeOAuthPath(settings, serverEnv);

    // Load credentials if not cached
    if (!this._credentials) {
      this._credentials = await this.loadCredentials();
    }

    // Refresh token if expired
    if (!this.isTokenValid(this._credentials)) {
      console.log('QwenCode: Access token expired, refreshing...');
      this._credentials = await this.refreshAccessToken(this._credentials);
    }

    // Create or update client with current credentials
    const baseURL = this.getBaseUrl(this._credentials);
    
    if (!this._client) {
      console.log('QwenCode: Creating new OpenAI client');
      this._client = createOpenAI({
        baseURL,
        apiKey: this._credentials.access_token,
      });
    } else {
      // Update existing client with refreshed credentials
      (this._client as any).apiKey = this._credentials.access_token;
      (this._client as any).baseURL = baseURL;
    }

    return this._client;
  }

  // Get valid access token (refresh if needed)
  private async getValidAccessToken(
    settings?: IProviderSetting,
    serverEnv?: Record<string, string>
  ): Promise<string> {
    await this.ensureClient(settings, serverEnv);
    return this._credentials!.access_token;
  }

  // Get base URL for API requests
  private getBaseUrl(creds: QwenOAuthCredentials): string {
    let baseUrl = creds.resource_url || "https://dashscope.aliyuncs.com/compatible-mode/v1";
    if (!baseUrl.startsWith("http://") && !baseUrl.startsWith("https://")) {
      baseUrl = `https://${baseUrl}`;
    }
    return baseUrl.endsWith("/v1") ? baseUrl : `${baseUrl}/v1`;
  }

  // API call wrapper with automatic token refresh on 401 errors
  private async callApiWithRetry<T>(apiCall: () => Promise<T>): Promise<T> {
    try {
      console.log('QwenCode: Making API call...');
      const result = await apiCall();
      console.log('QwenCode: API call successful');
      return result;
    } catch (error: any) {
      console.error('QwenCode: API call failed:', error.message, 'Status:', error.status);
      // If unauthorized, try to refresh token and retry once
      if (error.status === 401 && this._credentials) {
        console.log('QwenCode: Got 401 error, refreshing token and retrying...');
        this._credentials = await this.refreshAccessToken(this._credentials);
        console.log('QwenCode: Retrying API call with refreshed token...');
        return await apiCall(); // Retry with new token
      }
      throw error;
    }
  }

  // Auto-detect and fetch available models from Qwen API
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
        const token = await this.getValidAccessToken(settings, serverEnv);
        console.log('QwenCode: OAuth authentication successful, fetching models...');
        
        // Fetch available models from Qwen API
        const baseURL = this.getBaseUrl(this._credentials!);
        const response = await fetch(`${baseURL}/models`, {
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
        });

        if (response.ok) {
          const data = await response.json() as any;
          console.log('QwenCode: Successfully fetched dynamic models');
          
          if (data.data && Array.isArray(data.data)) {
            return data.data
              .filter((model: any) => {
                // Filter for coder models and compatible models
                return model.id && (
                  model.id.includes('coder') || 
                  model.id.includes('qwen') ||
                  model.id.includes('qwq')
                );
              })
              .map((model: any) => ({
                name: model.id,
                label: `${model.id} - ${model.owned_by || 'Qwen'} (Dynamic)`,
                provider: 'QwenCode',
                maxTokenAllowed: model.context_length || 128000,
                maxCompletionTokens: Math.min(model.max_completion_tokens || 8192, 32000),
              }));
          }
        } else {
          console.warn('QwenCode: Failed to fetch models:', response.status, response.statusText);
        }
      } catch (authError) {
        const errorMessage = authError instanceof Error ? authError.message : String(authError);
        console.log('QwenCode: OAuth credentials not available for dynamic models:', errorMessage);
      }
    } catch (error) {
      console.error('QwenCode: Error in getDynamicModels:', error);
    }

    // Return empty array to use static models as fallback
    return [];
  }

  // Create model instance with OAuth authentication
  getModelInstance(options: {
    model: string;
    serverEnv?: Env;
    apiKeys?: Record<string, string>;
    providerSettings?: Record<string, IProviderSetting>;
  }): LanguageModelV1 {
    if (typeof window !== 'undefined') {
      throw new Error('QwenCodeProvider.getModelInstance must be called on the server');
    }

    const { model, serverEnv, providerSettings } = options;
    
    // Convert Env to Record<string, string> for safe access
    const envRecord: Record<string, string> = {};
    if (serverEnv) {
      Object.entries(serverEnv).forEach(([key, value]) => {
        envRecord[key] = String(value);
      });
    }

    console.log('QwenCode: Creating model instance for:', model);

    // Create a proxy wrapper that handles async authentication
    let clientPromise: Promise<ReturnType<typeof createOpenAI>> | null = null;
    let isInitializing = false;
    
    const getAuthenticatedClient = async () => {
      if (!clientPromise && !isInitializing) {
        isInitializing = true;
        try {
          clientPromise = this.ensureClient(providerSettings?.[this.name], envRecord);
          const client = await clientPromise;
          console.log('QwenCode: Client authenticated successfully');
          return client;
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : String(error);
          console.error('QwenCode: Authentication failed:', errorMessage);
          throw new Error(`QwenCode authentication failed: ${errorMessage}. Please ensure OAuth credentials are properly configured in ~/.qwen/oauth_creds.json`);
        } finally {
          isInitializing = false;
        }
      }
      
      return clientPromise || Promise.reject(new Error('Client initialization in progress'));
    };

    // Create a temporary client for the proxy
    const tempClient = createOpenAI({
      baseURL: this.config.baseUrl!,
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
