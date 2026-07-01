/**
 * Gist Service
 * Manages GitHub Gist storage for research runs, prompts, and caches
 */

import { Octokit } from '@octokit/rest';

const GIST_SCHEMA = {
  researchRuns: [],
  prompts: {
    'lead-finder': '',
    'similar-company': '',
    'osint': ''
  },
  searchCache: {},
  mapVerificationCache: {}
};

const CUSTOMER_DATA_SCHEMA = {
  customers: [],
  leads: [],
  leadWorkspaces: [],
  countries: [],
  keywords: [],
  searchKeywords: [],
  companies: [],
  websites: [],
  evidence: [],
  providerMetadata: {}
};

function normalizeGistData(data = {}) {
  return {
    ...CUSTOMER_DATA_SCHEMA,
    ...GIST_SCHEMA,
    ...(data || {}),
    researchRuns: Array.isArray(data?.researchRuns) ? data.researchRuns : [],
    prompts: {
      ...GIST_SCHEMA.prompts,
      ...(data?.prompts || {})
    },
    searchCache: data?.searchCache && typeof data.searchCache === 'object' && !Array.isArray(data.searchCache) ? data.searchCache : {},
    mapVerificationCache: data?.mapVerificationCache && typeof data.mapVerificationCache === 'object' && !Array.isArray(data.mapVerificationCache) ? data.mapVerificationCache : {},
    providerMetadata: data?.providerMetadata && typeof data.providerMetadata === 'object' && !Array.isArray(data.providerMetadata) ? data.providerMetadata : {}
  };
}

class GistService {
  constructor(gistId, token, filename = 'apply-bot-data.json') {
    this.gistId = gistId;
    this.token = token;
    this.filename = filename || 'apply-bot-data.json';
    this.octokit = new Octokit({ auth: token });
    this.cache = null;
  }

  /**
   * Fetch the entire Gist data
   * @returns {Promise<Object>} Parsed Gist content
   */
  async fetchGist() {
    try {
      const { data } = await this.octokit.gists.get({
        gist_id: this.gistId
      });

      const filename = data.files[this.filename] ? this.filename : Object.keys(data.files)[0];
      const content = data.files[filename].content;
      this.cache = normalizeGistData(JSON.parse(content));

      return this.cache;
    } catch (error) {
      console.error('Error fetching Gist:', error.message);
      throw error;
    }
  }

  getConfigurationStatus() {
    return {
      configured: Boolean(this.gistId && this.token),
      missingEnvVars: [
        this.gistId ? '' : 'GIST_ID',
        this.token ? '' : 'GITHUB_GIST_TOKEN'
      ].filter(Boolean),
      fileName: this.filename
    };
  }

  async readCustomerData() {
    const configuration = this.getConfigurationStatus();

    if (!configuration.configured) {
      const error = new Error('GIST_ID and GITHUB_GIST_TOKEN are required for Gist storage.');
      error.code = 'missing_env';
      error.missingEnvVars = [
        this.gistId ? '' : 'GIST_ID',
        this.token ? '' : 'GITHUB_GIST_TOKEN'
      ].filter(Boolean);
      throw error;
    }

    const data = await this.fetchGist();

    return {
      storage: 'gist',
      gistId: this.gistId,
      fileName: this.filename,
      exists: true,
      updatedAt: null,
      data
    };
  }

  async updateCustomerData(patch) {
    const current = await this.readCustomerData();
    const nextData = {
      ...current.data,
      ...patch
    };

    await this.updateGist(nextData);

    return {
      ...current,
      updatedAt: new Date().toISOString(),
      data: nextData
    };
  }

  /**
   * Update the entire Gist with new data
   * @param {Object} data - Data to save
   * @returns {Promise<Object>} Updated Gist response
   */
  async updateGist(data) {
    try {
      const content = JSON.stringify(normalizeGistData(data), null, 2);

      const { data: responseData } = await this.octokit.gists.update({
        gist_id: this.gistId,
        files: {
          [this.filename]: {
            content
          }
        }
      });

      this.cache = normalizeGistData(data);
      return responseData;
    } catch (error) {
      console.error('Error updating Gist:', error.message);
      throw error;
    }
  }

  /**
   * Get search cache entry
   * @param {string} key - Cache key
   * @returns {Promise<*>} Cached value or null
   */
  async getSearchCache(key) {
    if (!this.cache) {
      await this.fetchGist();
    }
    return this.cache.searchCache[key] || null;
  }

  /**
   * Set search cache entry
   * @param {string} key - Cache key
   * @param {*} value - Value to cache
   * @returns {Promise<void>}
   */
  async setSearchCache(key, value) {
    if (!this.cache) {
      await this.fetchGist();
    }
    this.cache.searchCache[key] = value;
    await this.updateGist(this.cache);
  }

  /**
   * Get map verification cache entry
   * @param {string} key - Cache key
   * @returns {Promise<*>} Cached value or null
   */
  async getMapCache(key) {
    if (!this.cache) {
      await this.fetchGist();
    }
    return this.cache.mapVerificationCache[key] || null;
  }

  /**
   * Set map verification cache entry
   * @param {string} key - Cache key
   * @param {*} value - Value to cache
   * @returns {Promise<void>}
   */
  async setMapCache(key, value) {
    if (!this.cache) {
      await this.fetchGist();
    }
    this.cache.mapVerificationCache[key] = value;
    await this.updateGist(this.cache);
  }

  /**
   * Save a research run to the Gist
   * @param {Object} run - Research run data
   * @returns {Promise<void>}
   */
  async saveResearchRun(run) {
    if (!this.cache) {
      await this.fetchGist();
    }

    const timestamp = new Date().toISOString();
    const runWithTimestamp = {
      ...run,
      timestamp,
      id: run.id || `run_${Date.now()}`
    };

    this.cache.researchRuns.push(runWithTimestamp);
    await this.updateGist(this.cache);
  }

  /**
   * Get a specific prompt by type
   * @param {string} promptType - One of: 'lead-finder', 'similar-company', 'osint'
   * @returns {Promise<string>} Prompt content
   */
  async getPrompt(promptType) {
    if (!this.cache) {
      await this.fetchGist();
    }

    if (!this.cache.prompts.hasOwnProperty(promptType)) {
      throw new Error(`Invalid prompt type: ${promptType}. Valid types: ${Object.keys(GIST_SCHEMA.prompts).join(', ')}`);
    }

    return this.cache.prompts[promptType] || '';
  }

  /**
   * Save or update a prompt
   * @param {string} promptType - One of: 'lead-finder', 'similar-company', 'osint'
   * @param {string} content - Prompt content
   * @returns {Promise<void>}
   */
  async savePrompt(promptType, content) {
    if (!this.cache) {
      await this.fetchGist();
    }

    if (!this.cache.prompts.hasOwnProperty(promptType)) {
      throw new Error(`Invalid prompt type: ${promptType}. Valid types: ${Object.keys(GIST_SCHEMA.prompts).join(', ')}`);
    }

    this.cache.prompts[promptType] = content;
    await this.updateGist(this.cache);
  }

  /**
   * Delete a prompt (reset to empty string)
   * @param {string} promptType - One of: 'lead-finder', 'similar-company', 'osint'
   * @returns {Promise<void>}
   */
  async deletePrompt(promptType) {
    if (!this.cache) {
      await this.fetchGist();
    }

    if (!this.cache.prompts.hasOwnProperty(promptType)) {
      throw new Error(`Invalid prompt type: ${promptType}. Valid types: ${Object.keys(GIST_SCHEMA.prompts).join(', ')}`);
    }

    this.cache.prompts[promptType] = '';
    await this.updateGist(this.cache);
  }

  /**
   * Initialize a new Gist with default schema
   * @returns {Promise<Object>} Initialized Gist data
   */
  async initialize() {
    const initialData = normalizeGistData({});
    await this.updateGist(initialData);
    return initialData;
  }
}

export default GistService;
