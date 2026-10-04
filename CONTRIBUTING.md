# Contributing

## Run the tests

```bash
node --test "tests/*.test.ts"
```

Node 22 or newer. To try a change in pi, start it with your checkout:

```bash
pi --no-extensions -e path/to/pi-agent-portrait
```

Set `"debug": true` in `.pi/extensions/pi-emote/config.json` and every state change is written to `debug.log` in the extension folder.

## Add a character

1. Draw it: `scripts/draw-portrait --name <name> --role "..." --direction "..."`.
2. Copy `.pi/extensions/pi-emote/emotes/<name>/` into `emotes/`, without `sheet.png`.
3. Add a row to the Examples table in the README with the role and direction you used.

Only add a set drawn from a photo with that person's agreement.
