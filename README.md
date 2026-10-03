# pi-agent-portrait

An animated pixel-art portrait of your agent that lives in the corner of your pi TUI session, like a unit portrait in a strategy game. Each agent can have its own character, drawn for it by an image model.

Based on [pi-emote](https://github.com/cgxeiji/pi-emote) by [@cgxeiji](https://github.com/cgxeiji), who built the widget, the renderers and the original sets. This fork adds the portrait drawing script, the `cipher` set, and stops the mouth moving once a reply has finished.

The portrait reacts to what the agent is doing — thinking, talking, reading, writing, using tools, etc.

![pi-emote demo](pi-emote-demo.gif)

Supports Kitty, iTerm2, and ASCII rendering.

## Gallery

Community-contributed emote sets. [Submit yours via PR!](#custom-emotes)

### Image Sets

| Avatar | Name | Contributor |
|--------|------|-------------|
| <img src="emotes/default/hi/hi1.png" width="64"> | `default` | [@cgxeiji](https://github.com/cgxeiji) |
| <img src="emotes/aza_choi/hi/hi_1.png" width="64"> | `aza_choi` | [@shennguyenrs](https://github.com/shennguyenrs) |
| <img src="emotes/aza_choi_nobg/hi/hi_1.png" width="64"> | `aza_choi_nobg` | [@shennguyenrs](https://github.com/shennguyenrs) |
| <img src="emotes/red/hi/hi1.png" width="64"> | `red` | [@cgxeiji](https://github.com/cgxeiji) |
| <img src="emotes/cipher/hi/hi1.png" width="64"> | `cipher` | [@testy-cool](https://github.com/testy-cool), drawn with `scripts/draw-portrait` |

### ASCII Sets

| Avatar | Name | Contributor |
|--------|------|-------------|
| `(^ ◡ ^)/` | `ascii` | [@cgxeiji](https://github.com/cgxeiji) |
| `ʕ•̫͡•ʔ` | `ascii-bear` | [@LCorleone](https://github.com/LCorleone) |
| <pre>.------.<br>\|  ^o^ \|<br>'--++--'<br>===++===</pre> | `ascii-bot` | [@cgxeiji](https://github.com/cgxeiji) |

## Install

```bash
pi install git:github.com/testy-cool/pi-agent-portrait
```

## Draw a portrait for your agent

`scripts/draw-portrait` sends the `default` set to an image model as a reference sheet, asks for the same 19 poses drawn as a new character, cuts the result into frames, and installs it for the project you run it in. It needs Python 3 with Pillow and NumPy.

```bash
# from your project folder; uses the Codex CLI if installed, else Azure
path/to/pi-agent-portrait/scripts/draw-portrait --name cipher --role "a research agent"

# a likeness of a real person, from a photo
draw-portrait --name sam --role "my coding buddy" --photo sam.jpg

# the same, drawn in the photo's realistic style instead of the default set's
draw-portrait --name sam --role "my coding buddy" --photo sam.jpg --photo-style
```

Add `--direction "..."` for anything else, such as how the character moves: `--direction "weird and idiosyncratic: finger guns instead of a wave, a pencil behind his ear, one eyebrow cocked"`. Each cell keeps its meaning (wave, talk, think, read and so on), so the right frame still shows for each state.

For the most faithful likeness, first ask an image tool for one pixel-art portrait of the person from their photo, then pass that portrait as `--photo` with `--photo-style`. The default set's anime look otherwise makes adults look younger.

It writes the set to `.pi/extensions/pi-emote/emotes/<name>/` and selects it in `.pi/extensions/pi-emote/config.json`. Drawing takes about two minutes.

Image models it can use:

- **Codex CLI** (`--backend codex`): its built-in image tool, on your ChatGPT login.
- **Azure OpenAI** (`--backend azure`): set `AZURE_IMAGE_ENDPOINT` to the full `.../openai/v1/images/edits` URL, plus `AZURE_IMAGE_KEY` and `AZURE_IMAGE_MODEL` (tested with `gpt-image-2` and `gpt-image-2.5`).

### Without the script

Use any image tool that accepts a reference image, such as ChatGPT:

1. Save the reference sheet: `draw-portrait --print-reference ref.png`.
2. Print the prompt: `draw-portrait --print-prompt --name cipher --role "a research agent"`.
3. Give the tool both, save the image it makes, and install it: `draw-portrait --name cipher --sheet sheet.png`.

The prompt asks for the 19 poses on a 5 by 5 grid in a fixed order (idle, blink, two waves, four talking mouths, two thinking, two reading, two typing, two on a phone, two failures, one tidying up), so the script knows where each frame is.

## States

| State | Trigger |
|-------|---------|
| hi | Session start |
| idle | Nothing happening (blinks occasionally) |
| think | Reasoning tokens streaming |
| talk | Text response streaming |
| read | `read` tool / reading tool output |
| write | `write` or `edit` tool |
| tool | Any other tool |
| success | Successful tool execution |
| failure | Failed tool execution |
| compact | Context compaction |

## Config

Drop a `config.json` in one of these paths (highest priority wins):

- `~/.pi/agent/extensions/pi-emote/config.json` — your global prefs
- `.pi/extensions/pi-emote/config.json` — project override

Only include what you want to change:

```json
{
  "size": 12,
  "emotes": [
    { "model": "*claude*", "emote-set": "my-avatar" }
  ]
}
```

See `config.json` in the extension root for all defaults.

### Theme

Customize the widget colors. All fields are optional — omitted fields use the defaults below:

```json
{
  "theme": {
    "model-name": "accent",
    "progress-bar": {
      "default": "text",
      "cache-hit": "success",
      "cache-miss": "error",
      "almost-full": "warning"
    },
    "token-info": "dim",
    "working-directory": "warning",
    "border": "thinking-level-color",
    "vertical-separator": "thinking-level-color"
  }
}
```

- **`model-name`** — model, thinking level, and context window (always bold)
- **`progress-bar`** — token usage and context fill; color follows the context state:
  - `cache-miss`: cache hit rate between 0% and 50% → `error`
  - `almost-full`: context fill ≥ 75% → `warning` (when not a cache-miss)
  - `cache-hit`: cache hit rate ≥ 50% → `success` (when not almost-full)
  - `default`: no cache data yet (0% hit rate on a fresh session) → `text`
- **`token-info`** — input/output tokens, cache hit rate, cost
- **`working-directory`** — current working directory
- **`border`** — top border line
- **`vertical-separator`** — the `│` divider beside the avatar

Each value is either a pi theme color token or the special `thinking-level-color` flag. `thinking-level-color` follows the thinking level's color (the same color the border uses by default), so it shifts live when the thinking level changes — unlike a fixed token like `thinkingHigh`, which pins one specific level's color.

Available theme color tokens: `accent`, `border`, `borderAccent`, `borderMuted`, `success`, `error`, `warning`, `muted`, `dim`, `text`, `thinkingText`, `thinkingOff`–`thinkingMax`, `md*`, `syntax*`, `tool*` (full list in `src/types.ts`). All colors update live when pi's theme changes — no restart needed.

Invalid values are ignored with a warning and fall back to the defaults.

## Multiplexers

pi-emote can render image avatars through **tmux** using DCS passthrough. When tmux is detected, pi-emote auto-detects the outer terminal and picks the right image protocol.

### tmux Setup

Add these to your `tmux.conf`:

```bash
# Required — allow image sequences to pass through to the outer terminal
set -g allow-passthrough on

# Required — detect outer terminal when attaching from a different terminal
set -ga update-environment TERM
set -ga update-environment TERM_PROGRAM

# Recommended — reduces flicker during animation
set -sg escape-time 0
```

Then restart tmux completely:

```bash
tmux kill-server && tmux
```

Without `allow-passthrough`, pi-emote defaults to ASCII and shows a one-time warning with setup instructions.

### Experimental Multiplexer Support

| Outer Terminal | Protocol | Status |
|----------------|----------|--------|
| Ghostty | kitty-unicode | ✅ Stable, pane-safe, auto-detected |
| kitty | kitty-unicode | ⚠️ Untested, pane-safe, auto-detected |
| WarpTerminal | kitty-unicode | ⚠️ Untested, pane-safe, auto-detected |
| iTerm2 | iterm2 | ⚠️ Experimental, opt-in only (pane bleed in multi-pane layouts) |
| WezTerm | iterm2 | ⚠️ Experimental, opt-in only (not verified) |

The outer terminal is detected via `tmux show-environment TERM_PROGRAM`, which reflects the currently attached terminal.

Ghostty and kitty use the **kitty-unicode** renderer (Unicode placeholders) which is pane-safe — images stay within their pane and clean up on session switch. This is the default when auto-detected.

iTerm2 and WezTerm use DCS passthrough for the iTerm2 image protocol. This works but has known limitations: images can bleed into adjacent panes and persist when switching sessions. **Not enabled by default** — opt in explicitly:

```json
{
  "terminals": [
    { "match": "tmux", "render": "iterm2" }
  ]
}
```

### Other Multiplexers

**zellij** and **screen** are not yet supported and default to ASCII.

### Manual Override

Force a specific renderer:

```json
{
  "terminals": [
    { "match": "tmux", "render": "kitty-unicode" }
  ]
}
```

Available render values for tmux: `"auto"`, `"kitty-unicode"`, `"kitty"`, `"iterm2"`, `"ascii"`.

- `"auto"` — detect outer terminal; uses kitty-unicode for Ghostty/kitty, ASCII for others
- `"kitty-unicode"` — pane-safe Unicode placeholders (Ghostty, kitty)
- `"kitty"` — classic DCS passthrough (single-pane only, experimental)
- `"iterm2"` — iTerm2 DCS passthrough (single-pane only, experimental)
- `"ascii"` — text fallback

## Custom Emotes

Emote sets live in `emotes/<set-name>/` with PNG frames per state:

```
emotes/my-avatar/
├── idle/*.png
├── think/*.png
├── talk/*.png
├── read/*.png
├── write/*.png
├── tool/*.png
└── ...          # hi, success, failure, compact
```

Not all states are required. Missing ones just won't animate.

### Where to put them

pi-emote searches in order:

1. `.pi/extensions/pi-emote/emotes/<name>/` (project)
2. `~/.pi/agent/extensions/pi-emote/emotes/<name>/` (user)
3. Extension built-in → falls back to `default`

### Map models or thinking levels to sets

Glob patterns against model ID and/or thinking level, last match wins:

```json
{
  "emotes": [
    { "model": "*", "emote-set": "default" },
    { "model": "*claude*", "emote-set": "my-avatar" },
    { "model": "*haiku*", "emote-set": "haiku-avatar" }
  ]
}
```

In this example, `claude` models use `my-avatar`, but `haiku` ones use `haiku-avatar`.

Each entry matches on two dimensions — the model ID and the thinking level (`off`, `minimal`, `low`, `medium`, `high`, `xhigh`, `max`). Unset selectors default to `*`, so existing model-only entries keep working unchanged. An entry matches when **all** of its selectors match; last match wins:

```json
{
  "emotes": [
    { "model": "*claude*", "emote-set": "my-avatar" },
    { "thinking-level": "high", "emote-set": "focused-avatar" }
  ]
}
```

`claude` models get `my-avatar` at any thinking level, while **any** model at high thinking gets `focused-avatar`. To target a specific combination, set both selectors:

```json
{
  "emotes": [
    { "model": "*claude*", "thinking-level": "high", "emote-set": "deep-focus" }
  ]
}
```

This matches only `claude` models thinking at `high` level — anything else falls back to `default`.

Order matters: later entries override earlier ones, so put broad mappings first and refinements last. A warning is logged when two entries clash within the same dimension (two model patterns or two thinking-level patterns both match); a model entry and a thinking-level entry matching together is intentional layering and stays silent.
See `emotes/default/emotes.json` for per-set frame config (blink frames, talk weights).

## License

MIT
