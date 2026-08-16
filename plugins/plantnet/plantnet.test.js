import { afterEach, describe, expect, it, vi } from 'vitest';
import { identifyPlants, parseAPIKey, parseIdentification } from './index.js';

afterEach(() => vi.unstubAllGlobals());

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
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ results: [] }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const image = new Blob(['png'], { type: 'image/png' });

    await expect(identifyPlants('secret', image)).resolves.toEqual({
      results: [], remaining: null
    });
    const identifyURL = new URL(String(fetchMock.mock.calls[0][0]));
    expect(identifyURL.pathname).toBe('/v2/identify/all');
    expect(identifyURL.searchParams.get('nb-results')).toBe('5');
    expect(fetchMock.mock.calls[0][1].body.get('images')).toBeInstanceOf(Blob);
  });

  it('explains browser setup when PlantNet denies access', async () => {
    vi.stubGlobal('location', { origin: 'http://wails.localhost:9245' });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('', { status: 403 })));
    await expect(identifyPlants('rejected', new Blob(['png'])))
      .rejects.toThrow(`PlantNet access denied. Check the key, enable "Expose my API key", and add these authorized domains:
http://wails.localhost:9245
http://wails.localhost`);
  });

  it('keeps other API errors broad', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('', { status: 404 })));
    await expect(identifyPlants('key', new Blob(['png'])))
      .rejects.toThrow('Plant identification failed. Please try again.');
  });
});
