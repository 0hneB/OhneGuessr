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

  interface OhneGuessrPluginAPI {
    panorama: {
      getView(): OhneGuessrPanoramaView | null;
      onViewChange(listener: (view: OhneGuessrPanoramaView) => void): () => void;
      createLayer(): HTMLElement;
    };
    hud: {
      addButton(options: {
        icon?: string;
        label: string;
        pressed?: boolean;
        onClick(): void;
      }): { setPressed(pressed: boolean): void; remove(): void };
    };
  }

  var OhneGuessr: {
    registerPlugin(plugin: { activate(api: OhneGuessrPluginAPI): void | (() => void) }): void;
  };
}
