import path from 'node:path';
import { fileURLToPath } from 'node:url';

const sourceRoot = fileURLToPath(new URL('../../', import.meta.url));

// An explicit runtime root moves private output without moving source/templates.
export function botDataPath(name, ...parts) {
    return path.join(process.env.MINDCRAFT_RUNTIME_DIR || '.', 'bots', name, ...parts);
}

export function botLogPath(name, ...parts) {
    return path.join(process.env.MINDCRAFT_RUNTIME_DIR || sourceRoot, 'bots', name, 'logs', ...parts);
}

// Runtime output shared by all bots (e.g. diagnostics). Unset, the root is the
// operator's default runtime directory (operator/config.mjs), which git ignores.
export function runtimePath(...parts) {
    return path.join(process.env.MINDCRAFT_RUNTIME_DIR || path.join(sourceRoot, 'runtime'), ...parts);
}
