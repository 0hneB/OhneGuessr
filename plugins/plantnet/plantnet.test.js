import { describe, expect, it, vi } from 'vitest';
import { identifyPlants, parseAPIKey, parseIdentification } from './index.js';

const pluginAPI = (response, origin = 'http://wails.localhost') => ({
  environment: { origin },
  network: { request: vi.fn().mockResolvedValue(response) }
});

describe('PlantNet plugin', () => {
  it('rejects a copied block instead of sending it as an API key', () => {
    expect(() => parseAPIKey('token plus other text')).toThrow('Check the plugin settings');
    expect(parseAPIKey('  raw-token  ')).toBe('raw-token');
  });

  it('parses clean result data', () => {
    expect(parseIdentification({
      remainingIdentificationRequests: 42,
      results: [{
        score: 0.851,
        species: {
          commonNames: ['Field maple'],
          scientificNameWithoutAuthor: 'Acer campestre',
          scientificName: 'Acer campestre L.',
          family: { scientificNameWithoutAuthor: 'Sapindaceae' }
        }
      }]
    })).toEqual({
      remaining: 42,
      results: [{
        commonName: 'Field maple', scientificName: 'Acer campestre',
        family: 'Sapindaceae', score: 0.851,
        url: 'https://identify.plantnet.org/k-world-flora/species/Acer%20campestre%20L./data'
      }]
    });
  });

  it('uploads one viewport to PlantNet identification', async () => {
    const api = pluginAPI({ ok: true, status: 200, data: { results: [] } });
    const image = new Blob(['png'], { type: 'image/png' });

    await expect(identifyPlants(api, 'secret', image)).resolves.toEqual({
      results: [], remaining: null
    });
    const request = api.network.request.mock.calls[0][0];
    const identifyURL = new URL(request.url);
    expect(identifyURL.pathname).toBe('/v2/identify/all');
    expect(request.query['nb-results']).toBe('5');
    expect(request.file.blob).toBe(image);
  });

  it('explains browser setup when PlantNet denies access', async () => {
    const api = pluginAPI({ ok: false, status: 403, data: null }, 'http://wails.localhost:9245');
    await expect(identifyPlants(api, 'rejected', new Blob(['png'])))
      .rejects.toThrow(`PlantNet access denied. Check the key, enable "Expose my API key", and add these authorized domains:
http://wails.localhost:9245
http://wails.localhost`);
  });

  it('keeps other API errors broad', async () => {
    const api = pluginAPI({ ok: false, status: 404, data: null });
    await expect(identifyPlants(api, 'key', new Blob(['png'])))
      .rejects.toThrow('Plant identification failed. Please try again.');
  });
});
