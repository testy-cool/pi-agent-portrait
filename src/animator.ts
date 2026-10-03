import type { TUI } from "@earendil-works/pi-tui";
import type { EmoteState, Config, EmotesConfig } from "./types.js";
import { FALLBACK_STATE } from "./emotes.js";
import type { Renderer, RenderedFrame } from "./renderer.js";
import { log } from "./log.js";

// --- Helpers ---

function randomInRange(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

/** "read2_v3.png" -> "_v3"; files without a suffix are the base variant "". */
function variantOf(file: string): string {
  return /(_v\d+)?\.png$/.exec(file)?.[1] ?? "";
}

function weightedPick(weights: Record<string, number>): string {
  const entries = Object.entries(weights);
  let r = Math.random() * entries.reduce((sum, [, w]) => sum + w, 0);
  for (const [name, w] of entries) {
    r -= w;
    if (r <= 0) return name;
  }
  return entries[entries.length - 1]![0];
}

// --- Animator ---

export class Animator {
  // State machine
  currentState: EmoteState = "idle";

  // Renderer
  private renderer: Renderer;
  private config: Config;
  private emotesConfig: EmotesConfig = {};

  // Timers
  private holdTimer: ReturnType<typeof setTimeout> | null = null;
  private blinkTimer: ReturnType<typeof setTimeout> | null = null;
  private talkTimer: ReturnType<typeof setInterval> | null = null;
  private cycleTimer: ReturnType<typeof setInterval> | null = null;
  private thinkTimer: ReturnType<typeof setTimeout> | null = null;
  private sleepTimer: ReturnType<typeof setTimeout> | null = null;
  private talkGapTimer: ReturnType<typeof setTimeout> | null = null;
  private talkDurationTimer: ReturnType<typeof setTimeout> | null = null;

  // Cycle state
  private cycleIndex = 0;
  private cycleDirection = 1;

  // Hold state
  private holdNextState: EmoteState = "idle";

  // Variant chosen for the current state ("" or "_v2", "_v3", ...). Sets can
  // hold several drawings of a state; one is picked each time the state
  // starts and kept until it ends, so poses from different drawings never mix.
  private variant = "";

  // Talk state
  private talkWordCount = 0;
  private talkStartTime = 0;
  private lastTokenTime = 0;
  private talkMouthClosed = false;

  constructor(config: Config, renderer: Renderer) {
    this.config = config;
    this.renderer = renderer;
  }

  updateConfig(config: Config) {
    this.config = config;
  }

  setRenderer(renderer: Renderer) {
    this.renderer = renderer;
  }

  setTui(tui: TUI | null) {
    this.renderer.setTui(tui);
  }

  setEmotesConfig(emotesConfig: EmotesConfig) {
    this.emotesConfig = emotesConfig;
  }

  setHoldNextState(state: EmoteState) {
    this.holdNextState = state;
  }

  /** Get current rendered frame for the widget. */
  getRenderedFrame(): RenderedFrame | null {
    return this.renderer.getRenderedFrame();
  }

  resetRenderCache() {
    this.renderer.resetCache();
  }

  disposeRenderer() {
    this.renderer.dispose();
  }

  // --- Timer management ---

  clearAllTimers() {
    if (this.holdTimer) { clearTimeout(this.holdTimer); this.holdTimer = null; }
    if (this.blinkTimer) { clearTimeout(this.blinkTimer); this.blinkTimer = null; }
    if (this.talkTimer) { clearInterval(this.talkTimer); this.talkTimer = null; }
    if (this.cycleTimer) { clearInterval(this.cycleTimer); this.cycleTimer = null; }
    if (this.talkGapTimer) { clearTimeout(this.talkGapTimer); this.talkGapTimer = null; }
    if (this.talkDurationTimer) { clearTimeout(this.talkDurationTimer); this.talkDurationTimer = null; }
    if (this.thinkTimer) { clearTimeout(this.thinkTimer); this.thinkTimer = null; }
    if (this.sleepTimer) { clearTimeout(this.sleepTimer); this.sleepTimer = null; }
  }

  private clearStateTimers() {
    if (this.holdTimer) { clearTimeout(this.holdTimer); this.holdTimer = null; }
    if (this.talkTimer) { clearInterval(this.talkTimer); this.talkTimer = null; }
    if (this.cycleTimer) { clearInterval(this.cycleTimer); this.cycleTimer = null; }
    if (this.talkGapTimer) { clearTimeout(this.talkGapTimer); this.talkGapTimer = null; }
    if (this.talkDurationTimer) { clearTimeout(this.talkDurationTimer); this.talkDurationTimer = null; }
    if (this.thinkTimer) { clearTimeout(this.thinkTimer); this.thinkTimer = null; }
    if (this.sleepTimer) { clearTimeout(this.sleepTimer); this.sleepTimer = null; }
  }

  // --- State transitions ---

  transitionTo(state: EmoteState) {
    // Sets drawn before the newer states existed show the closest older one.
    while (!this.renderer.hasFrames(state) && FALLBACK_STATE[state]) {
      state = FALLBACK_STATE[state]!;
    }
    log(`transition: ${this.currentState} -> ${state}`);
    const variants = [...new Set(this.renderer.listFrames(state).map(variantOf))];
    this.variant = variants.length ? variants[Math.floor(Math.random() * variants.length)]! : "";
    this.clearStateTimers();
    if (this.currentState === "idle" && this.blinkTimer) {
      clearTimeout(this.blinkTimer);
      this.blinkTimer = null;
    }
    this.currentState = state;

    switch (state) {
      case "hi": this.enterHi(); break;
      case "idle": this.enterIdle(); break;
      case "think": this.enterThink(); break;
      case "talk": this.enterTalk(); break;
      case "read":
      case "write":
      case "tool":
      case "search":
      case "bash":
      case "wait":
      case "sleep": this.enterCycle(state); break;
      case "interrupted": this.enterHold(state, this.config.holdDuration.interrupted); break;
      case "error": this.enterHold(state, this.config.holdDuration.error); break;
      case "heard": this.enterHold(state, this.config.holdDuration.heard); break;
      case "success": this.enterHold(state, this.config.holdDuration.success, this.holdNextState); this.holdNextState = "idle"; break;
      case "failure": this.enterHold(state, this.config.holdDuration.failure, this.holdNextState); this.holdNextState = "idle"; break;
      case "compact": this.enterCompact(); break;
    }
  }

  /** The current variant's version of a frame, or the frame itself. */
  private named(state: EmoteState, file: string): string {
    const v = file.replace(/\.png$/, `${this.variant}.png`);
    return this.renderer.listFrames(state).includes(v) ? v : file;
  }

  /** The current variant's frames for a looping state. */
  private variantFrames(state: EmoteState): string[] {
    const files = this.renderer.listFrames(state);
    const mine = files.filter((f) => variantOf(f) === this.variant);
    return mine.length ? mine : files;
  }

  private showTalk() {
    const weights = this.emotesConfig.talk?.weights;
    if (this.renderer.listFrames("talk").length && weights) {
      if (this.renderer.showFrame("talk", this.named("talk", weightedPick(weights)))) return;
    }
    this.renderer.showTalkFrame(this.emotesConfig);
  }

  private showTalkClose() {
    const close = this.variantFrames("talk").find((f) => f.includes("close"));
    if (close && this.renderer.showFrame("talk", close)) return;
    this.renderer.showTalkCloseFrame();
  }

  private enterHi() {
    this.renderer.showRandomFrame("hi");
    this.holdTimer = setTimeout(() => this.transitionTo("idle"), this.config.holdDuration.hi);
  }

  enterIdle() {
    const defaultFile = this.named("idle", this.emotesConfig.idle?.default ?? "idle.png");
    this.renderer.showFrame("idle", defaultFile);
    this.scheduleBlink();
    if (this.config.sleepAfterMs > 0) {
      this.sleepTimer = setTimeout(() => {
        if (this.currentState === "idle") this.transitionTo("sleep");
      }, this.config.sleepAfterMs);
    }
  }

  private scheduleBlink() {
    if (this.blinkTimer) { clearTimeout(this.blinkTimer); this.blinkTimer = null; }
    const delay = randomInRange(this.config.blinkInterval[0], this.config.blinkInterval[1]);
    this.blinkTimer = setTimeout(() => {
      if (this.currentState !== "idle") return;
      this.doBlink();
    }, delay);
  }

  private doBlink() {
    const blinkFile = this.named("idle", this.emotesConfig.idle?.blink ?? "idle_blink.png");
    if (!this.renderer.showFrame("idle", blinkFile)) {
      this.scheduleBlink();
      return;
    }

    const doubleBlink = Math.random() < 0.15;
    const blinkDuration = 150;
    const defaultFile = this.named("idle", this.emotesConfig.idle?.default ?? "idle.png");

    setTimeout(() => {
      if (this.currentState !== "idle") return;
      this.renderer.showFrame("idle", defaultFile, true);

      if (doubleBlink) {
        setTimeout(() => {
          if (this.currentState !== "idle") return;
          this.renderer.showFrame("idle", blinkFile, true);
          setTimeout(() => {
            if (this.currentState !== "idle") return;
            this.renderer.showFrame("idle", defaultFile, true);
            this.scheduleBlink();
          }, blinkDuration);
        }, 100);
      } else {
        this.scheduleBlink();
      }
    }, blinkDuration);
  }

  private enterThink() {
    const defaultFile = this.named("think", this.emotesConfig.think?.default ?? "think.png");
    this.renderer.showFrame("think", defaultFile);
    this.scheduleThinkSwap();
  }

  private scheduleThinkSwap() {
    if (this.thinkTimer) { clearTimeout(this.thinkTimer); this.thinkTimer = null; }
    const delay = randomInRange(this.config.blinkInterval[0], this.config.blinkInterval[1]);
    this.thinkTimer = setTimeout(() => {
      if (this.currentState !== "think") return;
      this.doThinkSwap();
    }, delay);
  }

  private doThinkSwap() {
    const hardFile = this.named("think", this.emotesConfig.think?.hard ?? "think_hard.png");
    if (!this.renderer.showFrame("think", hardFile, true)) {
      this.scheduleThinkSwap();
      return;
    }

    const defaultFile = this.named("think", this.emotesConfig.think?.default ?? "think.png");
    setTimeout(() => {
      if (this.currentState !== "think") return;
      this.renderer.showFrame("think", defaultFile, true);
      this.scheduleThinkSwap();
    }, 800);
  }

  private enterTalk() {
    this.talkWordCount = 0;
    this.talkStartTime = Date.now();
    this.lastTokenTime = Date.now();
    this.talkMouthClosed = false;

    this.showTalk();

    this.talkTimer = setInterval(() => {
      if (this.currentState !== "talk") return;
      if (this.talkMouthClosed) {
        this.showTalkClose();
      } else {
        this.showTalk();
      }
    }, this.config.talkTickMs);
  }

  onTalkToken(text: string) {
    if (this.currentState !== "talk") return;

    const words = text.split(/\s+/).filter((w) => w.length > 0).length;
    this.talkWordCount += words;
    this.lastTokenTime = Date.now();

    if (this.talkMouthClosed) {
      this.talkMouthClosed = false;
    }

    if (this.talkGapTimer) { clearTimeout(this.talkGapTimer); this.talkGapTimer = null; }
    this.talkGapTimer = setTimeout(() => {
      if (this.currentState !== "talk") return;
      this.talkMouthClosed = true;
    }, 200);

    this.recalculateTalkDuration();
  }

  private recalculateTalkDuration() {
    if (this.talkDurationTimer) { clearTimeout(this.talkDurationTimer); this.talkDurationTimer = null; }

    const targetDurationMs = (this.talkWordCount / this.config.readingSpeed) * 1000;
    const elapsed = Date.now() - this.talkStartTime;
    const remaining = Math.max(0, targetDurationMs - elapsed);

    this.talkDurationTimer = setTimeout(() => {
      if (this.currentState !== "talk") return;
      const timeSinceLastToken = Date.now() - this.lastTokenTime;
      if (timeSinceLastToken > 200) {
        this.transitionTo("idle");
      } else {
        this.talkDurationTimer = setTimeout(() => {
          if (this.currentState === "talk") this.transitionTo("idle");
        }, 200);
      }
    }, remaining);
  }

  endTalk() {
    if (this.currentState !== "talk") return;
    const targetDurationMs = (this.talkWordCount / this.config.readingSpeed) * 1000;
    const elapsed = Date.now() - this.talkStartTime;
    if (elapsed >= targetDurationMs) {
      this.transitionTo("idle");
    } else {
      // Streaming finished but reading time remains — keep mouth animating
      if (this.talkGapTimer) { clearTimeout(this.talkGapTimer); this.talkGapTimer = null; }
      this.talkMouthClosed = false;
    }
  }

  private enterCycle(state: EmoteState) {
    this.cycleIndex = 0;
    this.cycleDirection = 1;
    // Image sets loop through the chosen variant's files; ASCII sets use the
    // renderer's own frame order.
    const files = this.variantFrames(state);
    const show = (i: number) => files.length
      ? this.renderer.showFrame(state, files[i]!)
      : this.renderer.showCycleFrame(state, i);
    show(0);

    const count = files.length || this.renderer.getCycleFrameCount(state);
    if (count <= 1) return;

    this.cycleTimer = setInterval(() => {
      if (this.currentState !== state) return;
      this.cycleIndex += this.cycleDirection;
      if (this.cycleIndex >= count - 1) this.cycleDirection = -1;
      if (this.cycleIndex <= 0) this.cycleDirection = 1;
      show(this.cycleIndex);
    }, this.config.cycleMs);
  }

  private enterHold(state: EmoteState, duration: number, nextState: EmoteState = "idle") {
    this.renderer.showRandomFrame(state);
    this.holdTimer = setTimeout(() => this.transitionTo(nextState), duration);
  }

  private enterCompact() {
    this.renderer.showRandomFrame("compact");
  }
}
