const MAX_IMAGE_WIDTH = 2000;
const MAX_IMAGE_HEIGHT = 2000;
const TARGET_SIZE_KB = 500;
const INITIAL_QUALITY = 0.80;
const MIN_QUALITY = 0.6;

export interface CompressedImage {
  blob: Blob;
  originalName: string;
  originalSize: number;
  compressedSize: number;
  width: number;
  height: number;
}

function createCanvas(width: number, height: number): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

function loadImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Failed to load image'));
    img.src = URL.createObjectURL(file);
  });
}

function calculateDimensions(
  originalWidth: number,
  originalHeight: number,
  maxWidth: number,
  maxHeight: number
): { width: number; height: number } {
  let width = originalWidth;
  let height = originalHeight;

  if (width > maxWidth || height > maxHeight) {
    const widthRatio = maxWidth / width;
    const heightRatio = maxHeight / height;
    const ratio = Math.min(widthRatio, heightRatio);
    width = Math.round(width * ratio);
    height = Math.round(height * ratio);
  }

  return { width, height };
}

async function compressToTargetSize(
  canvas: HTMLCanvasElement,
  targetSizeBytes: number,
  initialQuality: number,
  minQuality: number
): Promise<Blob> {
  let quality = initialQuality;
  let blob: Blob | null = null;

  while (quality >= minQuality) {
    blob = await new Promise<Blob | null>((resolve) => {
      canvas.toBlob(resolve, 'image/jpeg', quality);
    });

    if (blob && blob.size <= targetSizeBytes) {
      break;
    }

    quality -= 0.05;
  }

  if (!blob) {
    blob = await new Promise<Blob | null>((resolve) => {
      canvas.toBlob(resolve, 'image/jpeg', minQuality);
    });
  }

  if (!blob) {
    throw new Error('Failed to compress image');
  }

  return blob;
}

export async function compressImage(file: File): Promise<CompressedImage> {
  const isImage = file.type.startsWith('image/');
  if (!isImage) {
    throw new Error('File is not an image');
  }

  const originalSize = file.size;
  const targetSizeBytes = TARGET_SIZE_KB * 1024;

  if (originalSize <= targetSizeBytes && !file.type.includes('png')) {
    return {
      blob: file,
      originalName: file.name,
      originalSize,
      compressedSize: originalSize,
      width: 0,
      height: 0,
    };
  }

  const img = await loadImage(file);
  const { width, height } = calculateDimensions(
    img.naturalWidth,
    img.naturalHeight,
    MAX_IMAGE_WIDTH,
    MAX_IMAGE_HEIGHT
  );

  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error('Failed to get canvas context');
  }

  ctx.fillStyle = '#FFFFFF';
  ctx.fillRect(0, 0, width, height);
  ctx.drawImage(img, 0, 0, width, height);

  URL.revokeObjectURL(img.src);

  const blob = await compressToTargetSize(
    canvas,
    targetSizeBytes,
    INITIAL_QUALITY,
    MIN_QUALITY
  );

  return {
    blob,
    originalName: file.name.replace(/\.[^.]+$/, '.jpg'),
    originalSize,
    compressedSize: blob.size,
    width,
    height,
  };
}

export function isImageFile(file: File): boolean {
  return file.type.startsWith('image/');
}

export async function compressImageIfNeeded(file: File): Promise<File> {
  if (!isImageFile(file)) {
    return file;
  }

  const targetSizeBytes = TARGET_SIZE_KB * 1024;
  if (file.size <= targetSizeBytes && !file.type.includes('png')) {
    return file;
  }

  try {
    const compressed = await compressImage(file);
    return new File([compressed.blob], compressed.originalName, {
      type: 'image/jpeg',
    });
  } catch (error) {
    console.error('Failed to compress image, using original:', error);
    return file;
  }
}
