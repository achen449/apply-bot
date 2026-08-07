/**
 * Gist Service
 * Manages GitHub Gist storage for research runs, prompts, and caches
 */

import { Octokit } from '@octokit/rest';
import { calculateResearchRunExpiry, normalizeStoredResearchRun, pruneResearchRuns } from '../server/modules/leads/shared/research-run-contract.js'

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
    this.etag = '';
    this.writeQueue = Promise.resolve();
  }

  async withWriteLock(operation) {
    const previous = this.writeQueue;
    let release;
    this.writeQueue = new Promise((resolve) => { release = resolve });
    await previous;

    try {
      return await operation();
    } finally {
      release();
    }
  }

  isConflictError(error) {
    return [409, 412].includes(Number(error?.status));
  }

  async updateDataWithRetry(mutator, maxAttempts = 3) {
    const configuration = this.getConfigurationStatus();
    if (!configuration.configured) {
      const error = new Error('GIST_ID and GITHUB_GIST_TOKEN are required for Gist storage.');
      error.code = 'missing_env';
      error.missingEnvVars = configuration.missingEnvVars;
      throw error;
    }

    return this.withWriteLock(async () => {
      let lastError;

      for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
        const current = await this.fetchGist();
        const next = normalizeGistData(await mutator(current));

        try {
          await this.updateGist(next, { ifMatch: this.etag });
          return next;
        } catch (error) {
          lastError = error;
          if (!this.isConflictError(error) || attempt === maxAttempts - 1) {
            throw error;
          }
        }
      }

      throw lastError || new Error('Gist update failed after retries.');
    });
  }

  /**
   * Fetch the entire Gist data
   * @returns {Promise<Object>} Parsed Gist content
   */
  async fetchGist() {
    try {
      const response = await this.octokit.gists.get({
        gist_id: this.gistId
      });
      const { data } = response;

      const filename = data.files[this.filename] ? this.filename : Object.keys(data.files)[0];
      const content = data.files[filename]?.content || '';
      this.cache = normalizeGistData(JSON.parse(content));
      this.etag = response.headers?.etag || response.headers?.ETag || '';

      return this.cache;
    } catch (error) {
      console.error('Error fetching Gist:', error.code || error.status || 'gist_request_failed');
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
    const normalizedResearchRuns = data.researchRuns.map(normalizeStoredResearchRun)
    const activeResearchRuns = pruneResearchRuns(normalizedResearchRuns)
    const normalizedData = {
      ...data,
      researchRuns: activeResearchRuns
    }
    const needsRepair = JSON.stringify(normalizedData.researchRuns) !== JSON.stringify(data.researchRuns)
    const finalData = needsRepair
      ? await this.updateDataWithRetry((current) => ({
          ...current,
          researchRuns: pruneResearchRuns(current.researchRuns.map(normalizeStoredResearchRun))
        }))
      : normalizedData

    return {
      storage: 'gist',
      gistId: this.gistId,
      fileName: this.filename,
      exists: true,
      updatedAt: null,
      data: finalData
    };
  }

  async updateCustomerData(patch) {
    const nextData = await this.updateDataWithRetry((current) => ({
      ...current,
      ...(patch || {})
    }));

    return {
      storage: 'gist',
      gistId: this.gistId,
      fileName: this.filename,
      exists: true,
      updatedAt: new Date().toISOString(),
      data: nextData
    };
  }

  async mutateCustomerData(mutator) {
    if (typeof mutator !== 'function') {
      throw new TypeError('mutateCustomerData requires a function.');
    }

    const nextData = await this.updateDataWithRetry((current) => mutator(current));
    return {
      storage: 'gist',
      gistId: this.gistId,
      fileName: this.filename,
      exists: true,
      updatedAt: new Date().toISOString(),
      data: nextData
    };
  }

  /**
   * Update the entire Gist with new data
   * @param {Object} data - Data to save
   * @returns {Promise<Object>} Updated Gist response
   */
  async updateGist(data, { ifMatch = this.etag } = {}) {
    try {
      const content = JSON.stringify(normalizeGistData(data), null, 2);

      const response = await this.octokit.gists.update({
        gist_id: this.gistId,
        files: {
          [this.filename]: {
            content
          }
        },
        ...(ifMatch ? { headers: { 'If-Match': ifMatch } } : {})
      });
      const { data: responseData } = response;

      this.cache = normalizeGistData(data);
      this.etag = response.headers?.etag || response.headers?.ETag || this.etag;
      return responseData;
    } catch (error) {
      console.error('Error updating Gist:', error.code || error.status || 'gist_update_failed');
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
    await this.updateDataWithRetry((current) => ({
      ...current,
      searchCache: { ...current.searchCache, [key]: value }
    }));
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
    await this.updateDataWithRetry((current) => ({
      ...current,
      mapVerificationCache: { ...current.mapVerificationCache, [key]: value }
    }));
  }

  /**
   * Save a research run to the Gist
   * @param {Object} run - Research run data
   * @returns {Promise<void>}
   */
  async saveResearchRun(run) {
    const timestamp = new Date().toISOString();
    const runWithTimestamp = normalizeStoredResearchRun({
      ...run,
      timestamp,
      id: run.id || `run_${Date.now()}`,
      createdAt: run.createdAt || timestamp,
      expiresAt: run.expiresAt || calculateResearchRunExpiry(run.createdAt || timestamp)
    });

    await this.updateDataWithRetry((current) => ({
      ...current,
      researchRuns: pruneResearchRuns([
        ...current.researchRuns.map(normalizeStoredResearchRun),
        runWithTimestamp
      ])
    }));
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
    const current = this.cache || await this.fetchGist();
    if (!current.prompts.hasOwnProperty(promptType)) {
      throw new Error(`Invalid prompt type: ${promptType}. Valid types: ${Object.keys(GIST_SCHEMA.prompts).join(', ')}`);
    }

    await this.updateDataWithRetry((latest) => ({
      ...latest,
      prompts: { ...latest.prompts, [promptType]: content }
    }));
  }

  /**
   * Delete a prompt (reset to empty string)
   * @param {string} promptType - One of: 'lead-finder', 'similar-company', 'osint'
   * @returns {Promise<void>}
   */
  async deletePrompt(promptType) {
    const current = this.cache || await this.fetchGist();
    if (!current.prompts.hasOwnProperty(promptType)) {
      throw new Error(`Invalid prompt type: ${promptType}. Valid types: ${Object.keys(GIST_SCHEMA.prompts).join(', ')}`);
    }

    await this.updateDataWithRetry((latest) => ({
      ...latest,
      prompts: { ...latest.prompts, [promptType]: '' }
    }));
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
