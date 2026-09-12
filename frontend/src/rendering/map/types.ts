import type { Location, Point } from '../../shared/geo.js';

export interface RevealResult {
  guess: Point | null;
  actual: Location;
  color?: string;
}

export interface TileOptions {
  maxZoom: number;
  minZoom?: number;
  maxNativeZoom?: number;
  subdomains?: string;
  attribution: string;
}

export interface MapStyleDefinition {
  name: string;
  url: string;
  dark?: boolean;
  underlay?: { url: string; options: TileOptions };
  options: TileOptions;
}
