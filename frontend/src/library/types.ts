export interface MapSource extends Record<string, unknown> {
  type?: string;
  managed?: boolean;
}

export interface MapItem {
  id: string;
  name: string;
  count: number | null;
  file: string;
  folder: string;
  source: MapSource | null;
  managed: boolean;
}
