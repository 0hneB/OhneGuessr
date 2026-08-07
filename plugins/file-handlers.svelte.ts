export interface FileHandler {
  id: string;
  extensions: string[];
  single: boolean;
  error: string;
  open: (file: File) => Promise<void>;
}

export const fileHandlers = $state<FileHandler[]>([]);

export function registerFileHandler(handler: FileHandler) {
  const index = fileHandlers.findIndex((item) => item.id === handler.id);
  if (index < 0) fileHandlers.push(handler);
  else fileHandlers[index] = handler;
}

export function fileHandlerFor(file: File) {
  const name = file.name.toLocaleLowerCase();
  return fileHandlers.find((handler) =>
    handler.extensions.some((extension) => name.endsWith(extension.toLocaleLowerCase()))
  ) || null;
}

export function acceptedFileTypes() {
  return ['.json', 'application/json', ...fileHandlers.flatMap((handler) => handler.extensions)].join(',');
}
