import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import type { TUI } from "@earendil-works/pi-tui";
import type { EmoteState, EmotesConfig } from "./types.js";
import { ALL_STATES } from "./emotes.js";
import type { Renderer, RenderedFrame } from "./renderer.js";
import { log } from "./log.js";

// --- Minimal YAML parser for ascii.yaml ---
// Handles: scalars, one-level maps, and arrays of scalars. No YAML library needed.

interface AsciiFrameMap {
  [state: string]: string | string[] | string[][] | Record<string, string | string[]>;
}

function unquote(raw: string): string {
  const s = raw.trim();
  if (s.startsWith('"') && s.endsWith('"')) {
    // Double-quoted: process escape sequences
    let result = s.slice(1, -1);
    // Protect escaped backslashes so \x, \e etc. aren't double-processed
    const BS = "\x00BS\x00";
    result = result.replace(/\\\\/g, BS);
    // Hex-escape: \x1b → ESC, \x41 → 'A', etc.
    result = result.replace(/\\x([0-9a-fA-F]{2})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
    // \e → ESC (YAML 1.1 shortcut for \x1b)
    result = result.replace(/\\e/g, "\x1b");
    // Standard escapes
    result = result.replace(/\\n/g, "\n");
    result = result.replace(/\\t/g, "\t");
    result = result.replace(/\\r/g, "\r");
    // Remaining escapes: \" and restore protected backslashes
    result = result.replace(/\\"/g, '"');
    result = result.replace(new RegExp(BS, "g"), "\\");
    return result;
  }
  if (s.startsWith("'") && s.endsWith("'")) {
    // Single-quoted: no escape sequences in YAML single-quote ('' is the only escape)
    return s.slice(1, -1).replace(/''/g, "'");
  }
  return s;
}

/**
 * Extended YAML parser for ascii.yaml.
 *
 * Handles all patterns:
 *   - scalar:       key: "value"
 *   - named scalar: key:\n  name: "value"
 *   - flat array:   key:\n  - "value"
 *   - named multi-line: key:\n  name:\n    - "line1"
 *   - nested arrays:    key:\n  - - "v"\n    - "v"
 */
function parseSimpleYaml(text: string): AsciiFrameMap {
  const result: AsciiFrameMap = {};

  let topKey: string | null = null;
  let nestedObj: Record<string, string | string[]> | null = null;
  let pendingArrKey: string | null = null;
  let pendingArr: string[] | null = null;
  let flatArr: string[] | null = null;
  let nestedArrs: string[][] | null = null;
  let curNestedArr: string[] | null = null;

  function flushObjArray() {
    if (pendingArrKey !== null && pendingArr !== null) {
      if (pendingArr.length === 0) {
        log(`[pi-emote] Warning: empty frame for '${pendingArrKey}' under '${topKey}'`);
      } else {
        if (nestedObj === null) nestedObj = {};
        nestedObj[pendingArrKey] = pendingArr;
      }
      pendingArrKey = null;
      pendingArr = null;
    }
  }

  function flushTopKey() {
    if (topKey === null) return;
    flushObjArray();
    if (nestedArrs !== null) {
      if (curNestedArr !== null && curNestedArr.length > 0) {
        nestedArrs.push(curNestedArr);
        curNestedArr = null;
      }
      result[topKey] = nestedArrs;
    } else if (flatArr !== null) {
      result[topKey] = flatArr;
    } else if (nestedObj !== null) {
      result[topKey] = nestedObj;
    }
    topKey = null;
  }

  for (const raw of text.split("\n")) {
    const line = raw.replace(/\r$/, "");
    if (/^\s*$/.test(line) || /^\s*#/.test(line)) continue;

    const indent = line.length - line.trimStart().length;

    // --- Top-level key (indent 0) ---
    const topM = line.match(/^(\w[\w-]*):\s*(.*)/);
    if (topM) {
      flushTopKey();
      topKey = topM[1];
      nestedObj = null;
      pendingArrKey = null;
      pendingArr = null;
      flatArr = null;
      nestedArrs = null;
      curNestedArr = null;

      const val = unquote(topM[2]);
      if (val) {
        // Inline scalar: key: "value"
        result[topKey] = val;
        topKey = null;
      }
      continue;
    }

    if (topKey === null) continue;

    // --- Array item at any indent:  - value or  - - value ---
    const arrM = line.match(/^(\s+)-\s+(.*)/);
    if (arrM) {
      const arrIndent = arrM[1].length;
      const rawContent = arrM[2].trim();
      const secondDash = rawContent.match(/^-\s+(.*)/);

      if (secondDash) {
        // Nested array: - - value  -> string[][] mode
        if (nestedArrs === null) {
          nestedArrs = [];
          // Promote any accumulated flat items to single-element nested arrays
          if (flatArr !== null) {
            log(`[pi-emote] Warning: mixing single-line and multi-line frames under '${topKey}'`);
            for (const item of flatArr) {
              nestedArrs.push([item]);
            }
            flatArr = null;
          }
        }
        if (curNestedArr !== null && curNestedArr.length > 0) {
          nestedArrs.push(curNestedArr);
        }
        curNestedArr = [unquote(secondDash[1])];
      } else if (nestedArrs !== null && arrIndent >= 4) {
        // Sub-item of current nested array
        curNestedArr!.push(unquote(rawContent));
      } else if (nestedArrs !== null) {
        // Flat item after nested items — wrap in single-element sub-array
        log(`[pi-emote] Warning: mixing single-line and multi-line frames under '${topKey}'`);
        if (curNestedArr !== null && curNestedArr.length > 0) {
          nestedArrs.push(curNestedArr);
        }
        curNestedArr = [unquote(rawContent)];
      } else if (pendingArrKey !== null) {
        // Array item for a pending nested key
        if (pendingArr === null) pendingArr = [];
        pendingArr.push(unquote(rawContent));
      } else if (flatArr !== null) {
        flatArr.push(unquote(rawContent));
      } else if (nestedObj === null) {
        // First array item under this top-level key = flat array
        flatArr = [unquote(rawContent)];
      } else {
        log(`[pi-emote] Warning: unexpected array item under '${topKey}' (cannot mix named keys and arrays)`);
      }
      continue;
    }

    // --- Nested key (indent >= 2):  key: "value" or  key: (no value) ---
    const nestedM = line.match(/^(\s+)(\w[\w-]*):\s*(.*)/);
    if (nestedM) {
      flushObjArray();

      const nestedKey = nestedM[2];
      const nestedVal = unquote(nestedM[3]);

      if (nestedObj === null) nestedObj = {};

      if (nestedVal) {
        // key: "value" (scalar)
        nestedObj[nestedKey] = nestedVal;
      } else {
        // key: (no value) -> expect array follows
        pendingArrKey = nestedKey;
        pendingArr = [];
      }
      continue;
    }
  }

  flushTopKey();
  return result;
}

// --- ASCII frame storage ---

interface AsciiFrameSet {
  /** Named frames — each value is an array of lines. */
  named: Map<string, string[]>;
  /** Ordered list of frame names (for cycling and random pick). */
  names: string[];
}

function randomPick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)]!;
}

/**
 * Text-based renderer for terminals without image protocol support.
 * Loads frames from ascii.yaml in the resolved emote set directory.
 */
export class AsciiRenderer implements Renderer {
  private tuiRef: TUI | null = null;
  private frames: Map<EmoteState, AsciiFrameSet> = new Map();
  private currentFrame: RenderedFrame | null = null;
  private lastShown: string | null = null;

  setTui(tui: TUI | null) {
    this.tuiRef = tui;
  }

  loadFrames(emoteSetDir: string, extDir: string) {
    // Look for ascii.yaml in the resolved emote set directory, fall back to shipped default
    const candidates = [
      ...(emoteSetDir ? [join(emoteSetDir, "ascii.yaml")] : []),
      join(extDir, "emotes", "ascii-bot", "ascii.yaml"),
    ];

    let yamlText: string | null = null;
    for (const path of candidates) {
      if (existsSync(path)) {
        yamlText = readFileSync(path, "utf-8");
        log(`AsciiRenderer: loaded ${path}`);
        break;
      }
    }

    if (!yamlText) {
      log(`AsciiRenderer: no ascii.yaml found`);
      return;
    }

    const parsed = parseSimpleYaml(yamlText);
    this.frames.clear();

    const states = ALL_STATES;

    for (const state of states) {
      const value = parsed[state];
      if (value === undefined) continue;

      const named = new Map<string, string[]>();
      const names: string[] = [];

      if (typeof value === "string") {
        // Single-line backward compat — wrap in array
        named.set("default", [value]);
        names.push("default");
      } else if (Array.isArray(value)) {
        if (value.length > 0 && Array.isArray(value[0])) {
          // Nested array (string[][]) — multi-line cycling frames
          for (let i = 0; i < value.length; i++) {
            const name = `frame_${i}`;
            named.set(name, value[i] as string[]);
            names.push(name);
          }
        } else {
          // Flat array (string[]) — single-line cycling (backward compat)
          for (let i = 0; i < value.length; i++) {
            const name = `frame_${i}`;
            named.set(name, [(value[i] as string)]);
            names.push(name);
          }
        }
      } else {
        // Named frames (Record<string, string | string[]>)
        for (const [name, text] of Object.entries(value)) {
          if (Array.isArray(text)) {
            named.set(name, text);
          } else {
            named.set(name, [text as string]);
          }
          names.push(name);
        }
      }

      this.frames.set(state, { named, names });
    }

    log(`AsciiRenderer: loaded ${this.frames.size} states`);
  }

  getRenderedFrame(): RenderedFrame | null {
    return this.currentFrame;
  }

  private show(lines: string[], force = false): boolean {
    const key = lines.join("\n");
    if (!force && key === this.lastShown) return true;
    this.lastShown = key;
    this.currentFrame = { kind: "text", lines };
    this.tuiRef?.requestRender();
    return true;
  }

  showFrame(state: EmoteState, name: string, force = false): boolean {
    const frameSet = this.frames.get(state);
    if (!frameSet) return false;

    // Try exact match first
    let lines = frameSet.named.get(name);
    if (!lines) {
      // Strip .png extension (e.g. "idle.png" → "idle")
      const bare = name.replace(/\.png$/, "");
      lines = frameSet.named.get(bare);
      // Map image naming conventions to YAML keys:
      //   idle.png / think.png → "default"
      //   idle_blink.png       → "blink"
      //   think_hard.png       → "hard"
      if (!lines && bare === state) lines = frameSet.named.get("default");
      if (!lines) {
        const suffix = bare.replace(`${state}_`, "");
        if (suffix !== bare) lines = frameSet.named.get(suffix);
      }
    }
    if (!lines) return false;
    return this.show(lines, force);
  }

  showRandomFrame(state: EmoteState, force = false): boolean {
    const frameSet = this.frames.get(state);
    if (!frameSet || frameSet.names.length === 0) return false;
    const name = randomPick(frameSet.names);
    const lines = frameSet.named.get(name)!;
    return this.show(lines, force);
  }

  showTalkFrame(_emotesConfig: EmotesConfig): boolean {
    const frameSet = this.frames.get("talk");
    if (!frameSet || frameSet.names.length === 0) return false;
    // Exclude "close" from random talk frames
    const candidates = frameSet.names.filter((n) => n !== "close");
    if (candidates.length === 0) return this.showRandomFrame("talk");
    const name = randomPick(candidates);
    return this.show(frameSet.named.get(name)!);
  }

  showTalkCloseFrame(): boolean {
    const frameSet = this.frames.get("talk");
    if (!frameSet) return false;
    const lines = frameSet.named.get("close") ?? frameSet.named.get(frameSet.names[0]!)!;
    return this.show(lines);
  }

  showCycleFrame(state: EmoteState, index: number): boolean {
    const frameSet = this.frames.get(state);
    if (!frameSet || frameSet.names.length === 0) return false;
    const name = frameSet.names[index % frameSet.names.length]!;
    return this.show(frameSet.named.get(name)!);
  }

  hasFrames(state: EmoteState): boolean {
    return this.frames.has(state);
  }

  getCycleFrameCount(state: EmoteState): number {
    return this.frames.get(state)?.names.length ?? 0;
  }

  dispose() {
    this.currentFrame = null;
  }

  resetCache() {
    this.lastShown = null;
  }
}
