import type { TUI } from "@earendil-works/pi-tui";
import { getImageDimensions, calculateImageRows, getCellDimensions } from "@earendil-works/pi-tui";
import type { EmoteState, EmotesConfig, FrameSet } from "./types.js";
import type { Renderer, RenderedFrame } from "./renderer.js";
import { discoverFrames } from "./emotes.js";
import { log } from "./log.js";

// --- Helpers ---

function randomPick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)]!;
}

function weightedRandomPick(weights: Record<string, number>): string {
  const entries = Object.entries(weights);
  const total = entries.reduce((sum, [, w]) => sum + w, 0);
  let r = Math.random() * total;
  for (const [file, weight] of entries) {
    r -= weight;
    if (r <= 0) return file;
  }
  return entries[entries.length - 1]![0];
}

export interface ImageDims {
  widthPx: number;
  heightPx: number;
}

/**
 * Base class for image-protocol renderers (Kitty, iTerm2).
 * Handles frame loading, caching, and selection logic.
 * Subclasses implement encoding and cleanup.
 */
export abstract class BaseImageRenderer implements Renderer {
  protected tuiRef: TUI | null = null;
  protected frameMap: Map<EmoteState, FrameSet> = new Map();
  protected lastShownBase64: string | null = null;
  protected currentFrame: RenderedFrame | null = null;
  protected size: number;

  constructor(size: number) {
    this.size = size;
  }

  setTui(tui: TUI | null) {
    this.tuiRef = tui;
  }

  loadFrames(emoteSetDir: string, _extDir: string) {
    this.frameMap = discoverFrames(emoteSetDir);
  }

  getRenderedFrame(): RenderedFrame | null {
    return this.currentFrame;
  }

  /** Whether the cursor advances past the image after rendering. */
  protected abstract cursorAdvances: boolean;

  /** Padding mode for the widget: "spaces" (default) or "skip" (cursor-right). */
  protected padMode: "spaces" | "skip" = "spaces";

  /** Encode base64 image data into a terminal escape sequence. */
  protected abstract encode(base64: string, dims: ImageDims, rows: number, yOffset: number): string | null;

  /** Clean up protocol-specific resources. */
  abstract dispose(): void;

  protected show(base64: string, force = false): boolean {
    // For protocols where cursor advances (iTerm2), always re-encode to produce
    // a unique sequence — prevents the TUI diff engine from skipping the line.
    if (!force && !this.cursorAdvances && base64 === this.lastShownBase64) return true;
    this.lastShownBase64 = base64;

    const dims = getImageDimensions(base64, "image/png") ?? { widthPx: 510, heightPx: 510 };
    const cellDims = getCellDimensions();
    const displayCols = this.size;
    const rows = calculateImageRows(dims, displayCols, cellDims);

    // Vertical centering: offset image down by half the unused pixel space
    const scaledHeightPx = dims.heightPx * (displayCols * cellDims.widthPx / dims.widthPx);
    const totalHeightPx = rows * cellDims.heightPx;
    const yOffset = Math.max(0, Math.floor((totalHeightPx - scaledHeightPx) / 2));

    const sequence = this.encode(base64, dims, rows, yOffset);

    log(`${this.constructor.name}.show: sequence=${sequence !== null}, dims=${dims.widthPx}x${dims.heightPx}, rows=${rows}, yOffset=${yOffset}`);

    if (sequence) {
      this.currentFrame = { kind: "image", sequence, rows, cursorAdvances: this.cursorAdvances, padMode: this.padMode };
    } else {
      this.currentFrame = null;
    }
    this.tuiRef?.requestRender();
    return true;
  }

  private getBase64(state: EmoteState, name: string): string | null {
    return this.frameMap.get(state)?.base64Cache.get(name) ?? null;
  }

  showFrame(state: EmoteState, name: string, force = false): boolean {
    const b64 = this.getBase64(state, name);
    if (!b64) return false;
    return this.show(b64, force);
  }

  showRandomFrame(state: EmoteState, force = false): boolean {
    const frameSet = this.frameMap.get(state);
    if (!frameSet || frameSet.files.length === 0) return false;
    const file = randomPick(frameSet.files);
    const b64 = frameSet.base64Cache.get(file);
    if (!b64) return false;
    return this.show(b64, force);
  }

  showTalkFrame(emotesConfig: EmotesConfig): boolean {
    const frameSet = this.frameMap.get("talk");
    if (!frameSet || frameSet.files.length === 0) return false;

    if (emotesConfig.talk?.weights) {
      const file = weightedRandomPick(emotesConfig.talk.weights);
      const b64 = frameSet.base64Cache.get(file);
      if (!b64) return this.showRandomFrame("talk");
      return this.show(b64);
    }
    return this.showRandomFrame("talk");
  }

  showTalkCloseFrame(): boolean {
    const frameSet = this.frameMap.get("talk");
    if (!frameSet) return false;
    const closeFile = frameSet.files.find((f) => f.includes("close"));
    const file = closeFile ?? frameSet.files[0]!;
    const b64 = frameSet.base64Cache.get(file);
    if (!b64) return false;
    return this.show(b64);
  }

  showCycleFrame(state: EmoteState, index: number): boolean {
    const frameSet = this.frameMap.get(state);
    if (!frameSet || frameSet.files.length === 0) return false;
    const file = frameSet.files[index % frameSet.files.length]!;
    const b64 = frameSet.base64Cache.get(file);
    if (!b64) return false;
    return this.show(b64);
  }

  listFrames(state: EmoteState): string[] {
    return this.frameMap.get(state)?.files ?? [];
  }

  hasFrames(state: EmoteState): boolean {
    return (this.frameMap.get(state)?.files.length ?? 0) > 0;
  }

  getCycleFrameCount(state: EmoteState): number {
    return this.frameMap.get(state)?.files.length ?? 0;
  }

  resetCache() {
    this.lastShownBase64 = null;
  }
}
