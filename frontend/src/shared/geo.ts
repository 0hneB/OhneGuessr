export interface Point {
  lat: number;
  lng: number;
}

export interface Location extends Point {
  heading?: number;
  pitch?: number;
  zoom?: number;
  panoid?: string | null;
}

export type Trail = Point[][];
