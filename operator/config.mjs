import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const appRoot = fileURLToPath(new URL('../', import.meta.url));
export function loadConfig() {
    const runtime = path.resolve(process.env.MINDCRAFT_RUNTIME_DIR || path.join(appRoot, 'runtime'));
    const configDir = path.join(runtime, 'config');
    const read = name => JSON.parse(fs.readFileSync(path.join(configDir, name), 'utf8'));
    const settings = read('settings.json');
    const operator = read('operator.json');
    if (!Array.isArray(settings.profiles) || settings.profiles.length !== 1)
        throw new Error('These foreground operator helpers require exactly one configured profile.');
    settings.profiles = settings.profiles.map(p => path.resolve(configDir, p));
    const profile = JSON.parse(fs.readFileSync(settings.profiles[0], 'utf8'));
    if (!profile.name || !/^[A-Za-z0-9_]{1,16}$/.test(profile.name)) throw new Error('Invalid configured bot name.');
    for (const port of [settings.port, settings.mindserver_port])
        if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Configure explicit valid local ports.');
    if (settings.host !== '127.0.0.1') throw new Error('Operator proxy mode requires Minecraft host 127.0.0.1.');
    if (!operator.target || !operator.targetVersion) throw new Error('Configure proxy target and targetVersion.');
    return { appRoot, runtime, settings, operator, name: profile.name,
        proxyRoot: path.join(runtime, 'proxy'), logRoot: path.join(runtime, 'logs'),
        java: operator.java ? path.resolve(appRoot, operator.java) : 'java',
        jar: path.join(runtime, 'proxy', 'ViaProxy.jar') };
}

export function appEnvironment(config) {
    return { ...process.env, MINDCRAFT_RUNTIME_DIR: config.runtime,
        SETTINGS_JSON: JSON.stringify(config.settings), PROFILES: JSON.stringify(config.settings.profiles),
        ...(config.operator.localNoAuth && !process.env.OPENAI_API_KEY ? { OPENAI_API_KEY: 'local-no-auth' } : {}) };
}

export function proxyArguments(c) {
    return ['-Xmx512M', '-jar', c.jar, 'cli', '--bind-address', `127.0.0.1:${c.settings.port}`,
        '--target-address', c.operator.target, '--target-version', c.operator.targetVersion,
        '--auth-method', c.operator.proxyAuth || 'NONE', '--proxy-online-mode', 'false'];
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    const c = loadConfig();
    // Only operator metadata, never profiles, keys or environment values.
    console.log(JSON.stringify({ runtime: c.runtime, proxyRoot: c.proxyRoot, logRoot: c.logRoot,
        java: c.java, jar: c.jar, name: c.name, port: c.settings.port,
        mindserverPort: c.settings.mindserver_port, proxyArguments: proxyArguments(c) }));
}
