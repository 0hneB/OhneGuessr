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

  interface OhneGuessrPluginWindow {
    readonly content: HTMLDivElement;
    show(): void;
    hide(): void;
    resetLayout(): void;
    remove(): void;
  }

  interface OhneGuessrPluginAPI {
    panorama: {
      getView(): OhneGuessrPanoramaView | null;
      captureViewport(): Promise<OhneGuessrPanoramaCapture>;
      onViewChange(listener: (view: OhneGuessrPanoramaView) => void): () => void;
      createLayer(): HTMLElement;
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
      createWindow(options: {
        title: string;
        ariaLabel?: string;
        link?: { href: string; label: string };
        resetLabel?: string;
        closeLabel?: string;
        onClose?(): void;
      }): OhneGuessrPluginWindow;
    };
    settings: {
      get(key: string): Promise<string>;
    };
  }

  var OhneGuessr: {
    registerPlugin(plugin: { activate(api: OhneGuessrPluginAPI): void | (() => void) }): void;
  };
}
