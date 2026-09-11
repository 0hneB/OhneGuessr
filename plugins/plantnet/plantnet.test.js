import { afterEach, describe, expect, it, vi } from 'vitest';
import { identifyPlants, parseAPIKey, parseIdentification } from './index.js';

afterEach(() => vi.unstubAllGlobals());

const response = (body, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { 'content-type': 'application/json' }
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
    const fetchMock = vi.fn().mockResolvedValue(response({ results: [] }));
    vi.stubGlobal('fetch', fetchMock);
    const image = new Blob(['png'], { type: 'image/png' });

    await expect(identifyPlants('secret', image)).resolves.toEqual({
      results: [], remaining: null
    });
    const [requestURL, request] = fetchMock.mock.calls[0];
    const identifyURL = new URL(requestURL);
    expect(identifyURL.pathname).toBe('/v2/identify/all');
    expect(identifyURL.searchParams.get('nb-results')).toBe('5');
    expect(request.body.get('images').size).toBe(image.size);
  });

  it('explains browser setup when PlantNet denies access', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response(null, 403)));
    await expect(identifyPlants(
      'rejected', new Blob(['png']), undefined, 'http://wails.localhost:9245'
    ))
      .rejects.toThrow(`PlantNet access denied. Check the key, enable "Expose my API key", and add these authorized domains:
http://wails.localhost:9245
http://wails.localhost`);
  });

  it('keeps other API errors broad', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response(null, 404)));
    await expect(identifyPlants('key', new Blob(['png'])))
      .rejects.toThrow('Plant identification failed. Please try again.');
  });
});
