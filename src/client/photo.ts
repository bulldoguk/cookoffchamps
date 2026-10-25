// Photos are shrunk on the phone before upload (decision 10): a phone camera's
// 12 MP original is several MB, which is slow on venue wifi and wasteful in R2.

export const MAX_EDGE = 1600;

/** Scales (w, h) down so the long edge is at most `max`, keeping the aspect ratio. */
export function fitWithin(width: number, height: number, max = MAX_EDGE): { width: number; height: number } {
  const scale = Math.min(1, max / Math.max(width, height));
  return { width: Math.round(width * scale), height: Math.round(height * scale) };
}

export interface PhotoDeps {
  decode: (file: Blob) => Promise<{ width: number; height: number; close?: () => void } & CanvasImageSource>;
  canvas: () => HTMLCanvasElement;
}

const defaultDeps: PhotoDeps = {
  decode: (file) => createImageBitmap(file, { imageOrientation: "from-image" }),
  canvas: () => document.createElement("canvas"),
};

/** Re-encodes the photo as a JPEG no larger than MAX_EDGE on its long side. */
export async function resizePhoto(file: Blob, deps: PhotoDeps = defaultDeps): Promise<Blob> {
  const image = await deps.decode(file);
  const size = fitWithin(image.width, image.height);
  const canvas = deps.canvas();
  canvas.width = size.width;
  canvas.height = size.height;
  canvas.getContext("2d")!.drawImage(image, 0, 0, size.width, size.height);
  image.close?.();
  return new Promise((resolve, reject) =>
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("Could not process that photo"))), "image/jpeg", 0.82),
  );
}
