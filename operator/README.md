# Foreground operator helpers

These helpers run one configured bot and one loopback ViaProxy from this checkout.
The selected Minecraft server/world and inference endpoint must already be available.
There is no boot service, automatic proxy update or unattended session guarantee.

The Linux cutover smoke verified a survival join, native crafting inventory delta,
literal movement and task stop. Model reporting was inaccurate, and a backticked
command mention was parsed as an unwanted execution attempt. This is operational
migration evidence, not general task-completion qualification. Owner in-game chat
was not retested; the local UI owner channel was used.

## Private setup

Install Node 22 into `runtime/tools` (or set `MINDCRAFT_NODE` to its executable),
and Java 17+ into `runtime/tools`. Keep `node_modules` at the repository root.
Use the committed lockfile and run `npm ci`, including dev dependencies: the
postinstall step needs patch-package. Required canvas/gl dependencies cannot be
removed with `--omit=optional`. Prebuilt binaries may work; a source-build failure
needs the specific OS libraries it reports, not an unrelated graph upgrade.

Copy `operator/examples/` contents to `runtime/config/`. Edit the copied files:

- `settings.json` overlays upstream `settings.js` through native `SETTINGS_JSON`.
  Profile filenames are relative to `runtime/config`; use one profile here.
- `profiles/local.json` selects the bot/model. Chat and code share `model` unless
  a separate `code_model` is supplied. The generic example uses an OpenAI-compatible
  local endpoint and no embeddings. Reasoning fields are endpoint-specific.
- `operator.json` selects a direct Java executable, target server/version and proxy
  auth. Use a Windows `java.exe` path on Windows. Omit `java` to use PATH on Linux.
  `localNoAuth:true` supplies an SDK placeholder only when no API key environment
  variable exists; use it only with a genuinely unauthenticated local endpoint.
  Real keys belong in the environment, not tracked files.

The ignored `runtime/` tree holds configuration, tools, ViaProxy data, process
receipts, bot memory/history/generated code/profile snapshots and logs. Root
`bots/execTemplate.js` and `bots/lintTemplate.js` remain source templates. Keep cwd
at the repository root; changing it is not a supported storage migration.
No previous memory is imported automatically. An ended task must stay ended.

## Linux

```sh
operator/mindcraft.sh update   # explicit latest-stable download + SHA256 check
operator/mindcraft.sh start    # foreground: proxy readiness, then app
operator/mindcraft.sh status  # another terminal
operator/mindcraft.sh stop
```

Ctrl+C in the Start terminal requests full shutdown. Children have separate Linux
signal groups but remain owned and waited by this foreground launcher; nothing is
unrefed or daemonized. Stop uses native MindServer shutdown, with receipt-verified
group cleanup when control is unavailable. It refuses unrelated occupied ports
or changed process identity. Linux matches PID/start/group/session across an
exec shim; executable/cmdline metadata is diagnostic. Matching receipts are cleared
after verified process/group exit, preserving any newer replacement receipt.
Inspect a stale `runtime/operator.lock` before
removing it after an abnormal launcher exit. Never run the same bot identity
simultaneously from another host/checkout.

## Windows

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File operator/Amaia.ps1 Update
powershell -NoProfile -ExecutionPolicy Bypass -NoExit -File operator/Amaia.ps1 Start
powershell -NoProfile -ExecutionPolicy Bypass -File operator/Amaia.ps1 Status
powershell -NoProfile -ExecutionPolicy Bypass -File operator/Amaia.ps1 Stop
```

Start opens visible component terminals. Separate `Proxy.ps1` and `Mindcraft.ps1`
Start/Status/Stop remain available. `MINDCRAFT_NODE` overrides private Node lookup.
Proxy Stop verifies the native Java process receipt before signalling it.
PowerShell transcripts can lag until shutdown; intentional Java termination can
print a nonzero exit in its Start terminal even when Stop succeeds. Exact native
parse/config checks and an isolated proxy Start/Status/Stop with receipt deletion
passed. The full adapted combined Windows desktop lifecycle remains unqualified;
Linux fixtures do not establish it.

## Configuration and updates

Start does not update dependencies or ViaProxy. Explicit Update checks the official
latest stable release, verifies its SHA256 and records `runtime/proxy/installed.json`.
It refuses replacement while the proxy port or recorded process is live. Java and
Node updates are separate explicit maintenance choices; installed versions are
recorded for reproduction, not permanent maximum versions.

Linux update checks owned processes/groups, so an unrelated recycled PID does not
block it. Windows keeps a conservative live-PID update guard after an exceptional
crash/reboot. If Status identifies a stale receipt, first verify that the original
Java and configured proxy port are stopped, then archive
`runtime/proxy/operator-proxy.json` and retry Update. Never stop an unrelated PID
to clear this guard. Ordinary verified exits/Stop clear only their matching receipt.

Disk settings are loaded at full Start. The main MindServer caches per-agent
settings; restoring/changing a file then only restarting the agent is insufficient.
Use full Stop/Start, or deliberately update the matching runtime setting through
the existing UI too. Source changes reload on agent restart where applicable.
Upstream defaults remain available via `node main.js`, without the operator overlay.

In game, an allowed owner can use `/msg <bot> <task>` and literal `!stop` to end a
task/action. Protection can still move/dig/place after task stop; operator Stop
disconnects the app and proxy. Generated JavaScript is authorized only when local
configuration enables it; its timeout is cooperative, not an OS sandbox.

MindServer currently exposes status and last messages outside game. A full
conversation panel or external agent-UI integration is not implemented here.

Focused checks (private Node on PATH):

```sh
node operator/test/runtime.test.mjs
node operator/test/update.test.mjs
node operator/test/lifecycle.test.mjs  # Linux only; inert local fixtures
node --test operator/test/receipts.test.mjs  # Linux exec/exit/group ownership
```
