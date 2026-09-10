/**
 * Rasterizes a standalone wheel SVG (`standalone-svg.ts`) to a PNG at a chosen pixel size
 * (#67's "PNG at selectable resolution") via an off-DOM `<img>`/`<canvas>` pair — the
 * browser's own SVG rasterizer, so this needs no new rendering dependency.
 */
export async function svgToPngBlob(svgMarkup: string, width: number, height: number): Promise<Blob> {
  const svgUrl = URL.createObjectURL(new Blob([svgMarkup], { type: 'image/svg+xml' }));
  try {
    const image = new Image();
    const loaded = new Promise<void>((resolve, reject) => {
      image.onload = () => {
        resolve();
      };
      image.onerror = () => {
        reject(new Error('Could not rasterize the chart wheel for PNG export.'));
      };
    });
    image.src = svgUrl;
    await loaded;

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d');
    if (context === null) throw new Error('Could not get a 2D canvas context for PNG export.');
    context.drawImage(image, 0, 0, width, height);

    return await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((blob) => {
        if (blob === null) {
          reject(new Error('Could not encode the chart wheel as PNG.'));
          return;
        }
        resolve(blob);
      }, 'image/png');
    });
  } finally {
    URL.revokeObjectURL(svgUrl);
  }
}
