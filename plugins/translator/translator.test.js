import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  normalizeTargetLanguage,
  parseAPIKey,
  parseOCRResponse,
  recognizeText,
  splitTranslationText,
  translateText
} from './index.js';

afterEach(() => vi.unstubAllGlobals());

const response = (body, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { 'content-type': 'application/json' }
});

describe('Translator plugin', () => {
  it('validates keys and target languages', () => {
    expect(() => parseAPIKey('copied key and text')).toThrow('Plugins → Additional');
    expect(parseAPIKey('  secret-key  ')).toBe('secret-key');
    expect(normalizeTargetLanguage('de-DE')).toBe('de');
    expect(normalizeTargetLanguage('unknown')).toBe('en');
  });

  it('keeps all detected text in provider order', () => {
    expect(parseOCRResponse({
      OCRExitCode: 1,
      ParsedResults: [{ ParsedText: 'Bonjour' }, { ParsedText: 'le monde\n' }]
    })).toBe('Bonjour\n\nle monde');
    expect(() => parseOCRResponse({
      IsErroredOnProcessing: true,
      ErrorMessage: ['File failed validation']
    })).toThrow('File failed validation');
  });

  it('splits Unicode text without exceeding the provider limit', () => {
    const source = `${'é'.repeat(260)} ${'street sign '.repeat(80)}`.trim();
    const chunks = splitTranslationText(source);
    const encoder = new TextEncoder();
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.every((chunk) => encoder.encode(chunk).length <= 500)).toBe(true);
    expect(chunks.join('').replace(/\s/g, '')).toBe(source.replace(/\s/g, ''));
  });

  it('uploads one JPEG to OCR.space with automatic language detection', async () => {
    const fetchMock = vi.fn().mockResolvedValue(response({
      OCRExitCode: 1,
      ParsedResults: [{ ParsedText: 'Bonjour' }]
    }));
    vi.stubGlobal('fetch', fetchMock);
    const image = new Blob(['jpeg'], { type: 'image/jpeg' });

    await expect(recognizeText('secret', image)).resolves.toBe('Bonjour');
    const [url, request] = fetchMock.mock.calls[0];
    expect(url).toBe('https://api.ocr.space/parse/image');
    expect(request.headers.apikey).toBe('secret');
    expect(request.body.get('language')).toBe('auto');
    expect(request.body.get('OCREngine')).toBe('2');
    expect(request.body.get('file').size).toBe(image.size);
  });

  it('auto-detects and translates through MyMemory', async () => {
    const fetchMock = vi.fn().mockResolvedValue(response({
      responseStatus: 200,
      quotaFinished: false,
      responseData: { translatedText: 'Hello world', detectedLanguage: 'fr' }
    }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(translateText('Bonjour le monde', 'en')).resolves.toEqual({
      text: 'Hello world', detectedLanguage: 'fr'
    });
    const url = new URL(fetchMock.mock.calls[0][0]);
    expect(url.origin + url.pathname).toBe('https://api.mymemory.translated.net/get');
    expect(url.searchParams.get('q')).toBe('Bonjour le monde');
    expect(url.searchParams.get('langpair')).toBe('Autodetect|en');
  });
});
