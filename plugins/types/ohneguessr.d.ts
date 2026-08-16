export {};

declare global {
  interface OhneGuessrPanoramaView {
    position: { lat: number; lng: number };
    heading: number;
    pitch: number;
    zoom: number;
    width: number;
    height: number;
  }

  interface OhneGuessrPanoramaCapture {
    blob: Blob;
    panoId: string;
    width: number;
    height: number;
  }

  interface OhneGuessrPanoramaCaptureOptions {
    width: number;
    height: number;
  }

  interface OhneGuessrPanoramaMetadata extends OhneGuessrPanoramaView {
    panoId: string;
    imageDate: string;
    description: string;
    shortDescription: string;
    photographer: { heading: number | null; pitch: number | null };
  }

  interface OhneGuessrLocationDetails {
    fullAddress: string;
    country: string;
    countryCode: string;
    state: string;
    region: string;
    feature: string;
    category: string;
    type: string;
    address: Record<string, string>;
  }

  interface OhneGuessrPluginWindow {
    /** Content element inside the host-styled in-game window. */
    readonly content: HTMLDivElement;
    show(): void;
    hide(): void;
    resetLayout(): void;
    remove(): void;
  }

  interface OhneGuessrPluginAPI {
    panorama: {
      getMetadata(): OhneGuessrPanoramaMetadata | null;
      captureViewport(options?: OhneGuessrPanoramaCaptureOptions): Promise<OhneGuessrPanoramaCapture>;
      onRoundStart(listener: () => void): () => void;
    };
    location: {
      reverse(position: { lat: number; lng: number }): Promise<OhneGuessrLocationDetails>;
    };
    hud: {
      addButton(options: {
        icon?: string;
        label: string;
        pressed?: boolean;
        onClick(): void | Promise<void>;
      }): { setPressed(pressed: boolean): void; remove(): void };
    };
    ui: {
      createWindow(options?: {
        title?: string;
        ariaLabel?: string;
        closeLabel?: string;
        onClose?(): void;
      }): OhneGuessrPluginWindow;
      openExternal(url: string): Promise<void>;
    };
    settings: {
      get(key: string): Promise<string>;
    };
  }

  /** Default-export this object from an additional plugin's index.js module. */
  interface OhneGuessrPlugin {
    activate(api: OhneGuessrPluginAPI):
      void | (() => void) | Promise<void | (() => void)>;
  }
}
