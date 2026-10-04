import { allocateImageId, deleteKittyImage } from "@earendil-works/pi-tui";
import { BaseImageRenderer } from "./render_image.js";
import type { ImageDims } from "./render_image.js";

const CHUNK_SIZE = 4096;

/**
 * Build a raw Kitty graphics protocol escape sequence with arbitrary params.
 * Handles chunking for large payloads.
 */
function buildKittySequence(base64: string, params: Record<string, string | number>): string {
  const paramStr = Object.entries(params).map(([k, v]) => `${k}=${v}`).join(",");

  if (base64.length <= CHUNK_SIZE) {
    return `\x1b_G${paramStr};${base64}\x1b\\`;
  }

  const chunks: string[] = [];
  let offset = 0;
  let isFirst = true;
  while (offset < base64.length) {
    const chunk = base64.slice(offset, offset + CHUNK_SIZE);
    const isLast = offset + CHUNK_SIZE >= base64.length;
    if (isFirst) {
      chunks.push(`\x1b_G${paramStr},m=1;${chunk}\x1b\\`);
      isFirst = false;
    } else if (isLast) {
      chunks.push(`\x1b_Gm=0;${chunk}\x1b\\`);
    } else {
      chunks.push(`\x1b_Gm=1;${chunk}\x1b\\`);
    }
    offset += CHUNK_SIZE;
  }
  return chunks.join("");
}

/**
 * Kitty graphics protocol renderer.
 * Supports image IDs for in-place replacement, explicit row clamping,
 * and vertical pixel offset for centering within the allocated rows.
 */
export class KittyRenderer extends BaseImageRenderer {
  readonly imageId: number;
  protected cursorAdvances = false;

  constructor(size: number) {
    super(size);
    this.imageId = allocateImageId();
  }

  protected encode(base64: string, _dims: ImageDims, rows: number, yOffset: number): string | null {
    const params: Record<string, string | number> = {
      a: "T",
      f: 100,
      q: 2,
      C: 1,
      c: this.size,
      // Older kitty (0.32, as shipped by Ubuntu) scales only the width when
      // given just columns, squashing the portrait; rows keeps it in shape.
      r: rows,
      i: this.imageId,
    };
    if (yOffset > 0) {
      params.Y = yOffset;
    }
    return buildKittySequence(base64, params);
  }

  dispose() {
    process.stdout.write(deleteKittyImage(this.imageId));
    this.currentFrame = null;
  }
}
