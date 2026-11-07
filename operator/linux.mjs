import fs from 'node:fs';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { loadConfig, appEnvironment, proxyArguments } from './config.mjs';
import { owned, record, clearExitedReceipt, portOpen, waitFor, stopOwned } from './process.mjs';
import { updateProxy } from './update.mjs';

if (process.platform !== 'linux') throw new Error('Use the PowerShell helpers on Windows.');
const action = (process.argv[2] || 'status').toLowerCase();
if (!['start', 'stop', 'status', 'update'].includes(action)) throw new Error('Usage: mindcraft.sh start|stop|status|update');
const c = loadConfig();
fs.mkdirSync(c.logRoot, { recursive: true });
fs.mkdirSync(c.proxyRoot, { recursive: true });
const appReceipt = path.join(c.runtime, 'operator-app.json');
const proxyReceipt = path.join(c.proxyRoot, 'operator-proxy.json');
const lock = path.join(c.runtime, 'operator.lock');

function control(operation) {
    const result = spawnSync(process.execPath, [path.join(c.appRoot, 'operator/Control.mjs'), operation],
        { cwd: c.appRoot, env: appEnvironment(c), encoding: 'utf8', timeout: 12000 });
    if (result.error || result.status !== 0)
        throw new Error(result.error?.message || result.stderr || result.stdout || 'MindServer control failed.');
    return result.stdout.trim();
}

async function status(readState = true) {
    const app = owned(appReceipt);
    const proxy = owned(proxyReceipt);
    const appPort = await uiOpen();
    const proxyPort = await portOpen(c.settings.port);
    if (appPort && !app) throw new Error('MindServer port is occupied without a matching process receipt; nothing adopted.');
    if (proxyPort && !proxy) throw new Error('Proxy port is occupied without a matching process receipt; nothing adopted.');
    return { ProxyRunning: !!proxy, ProxyLoopbackReady: !!proxy && proxyPort,
        AppRunning: !!app, Amaia: readState && app && appPort ? JSON.parse(control('status')) : null };
}

async function uiOpen() {
    return await portOpen(c.settings.mindserver_port, '::1') || await portOpen(c.settings.mindserver_port);
}

async function stop() {
    const errors = [];
    let current;
    try { current = await status(false); } catch (e) { errors.push(e); }
    if (current?.AppRunning && await uiOpen()) {
        try {
            control('stop');
            await waitFor(() => !owned(appReceipt), 10, 'Mindcraft shutdown');
        } catch (e) { console.error(`Native shutdown unavailable; using verified owned group: ${e.message}`); }
    }
    for (const [receipt, signal] of [[appReceipt, 'SIGINT'], [proxyReceipt, 'SIGTERM']]) {
        try { await stopOwned(receipt, signal); } catch (e) { errors.push(e); }
    }
    if (await uiOpen() || await portOpen(c.settings.port))
        errors.push(new Error('A component port is still occupied; inspect its owner.'));
    if (errors.length) throw new AggregateError(errors, errors.map(e => e.message).join('\n'));
    console.log('Mindcraft and the operator-owned proxy stopped.');
}

function acquire() {
    try { fs.mkdirSync(lock); }
    catch { throw new Error('Another operator operation is busy. If a prior launcher crashed, inspect processes before removing runtime/operator.lock.'); }
}
function release() { fs.rmdirSync(lock); }

function launch(executable, args, receipt, label, cwd) {
    const file = path.join(c.logRoot, `${label}-${new Date().toISOString().replace(/[:.]/g, '-')}.log`);
    const log = fs.createWriteStream(file, { flags: 'a' });
    // Separate signal groups, still foreground-owned/waited; never unref/daemonize.
    const child = spawn(executable, args, { cwd, env: appEnvironment(c), detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let receiptIdentity;
    const completion = new Promise((resolve, reject) => {
        child.once('error', reject);
        child.once('close', (code, signal) => {
            try { if (receiptIdentity) clearExitedReceipt(receipt, receiptIdentity); }
            catch (e) { console.error(`Receipt cleanup: ${e.message}`); }
            log.end(() => resolve({ code, signal }));
        });
    });
    // Mark rejection handled during readiness waits, then observe it below.
    completion.catch(() => {});
    child.stdout.on('data', bytes => { log.write(bytes); process.stdout.write(bytes); });
    child.stderr.on('data', bytes => { log.write(bytes); process.stderr.write(bytes); });
    child.once('spawn', () => {
        try { receiptIdentity = record(receipt, child.pid); }
        catch (e) { console.error(e.message); child.kill('SIGTERM'); }
    });
    console.log(`${label} log: ${file}`);
    return { child, completion };
}

if (action === 'status') {
    console.log(JSON.stringify(await status()));
} else {
    acquire();
    let locked = true;
    const unlock = () => { if (locked) { release(); locked = false; } };
    try {
        if (action === 'stop') await stop();
        else if (action === 'update') await updateProxy(c);
        else {
            const current = await status();
            if (current.AppRunning || current.ProxyRunning) {
                if (current.AppRunning && current.ProxyLoopbackReady) {
                    console.log('Already running; no duplicate process started.');
                    console.log(JSON.stringify(current));
                } else throw new Error('Partial components already running. Inspect Status, then use Stop before Start.');
            } else {
                if (!fs.existsSync(c.jar)) throw new Error('ViaProxy.jar missing. Run explicit update first.');
                const proxy = launch(c.java, proxyArguments(c), proxyReceipt, 'proxy', c.proxyRoot);
                let app;
                let stopping = false;
                const shutdown = async () => {
                    if (stopping) return;
                    stopping = true;
                    try { await stop(); }
                    catch (e) {
                        console.error(e.message);
                        // Control may not answer during startup/crash. Signal only
                        // receipt-verified owned groups, including the agent child.
                        for (const receipt of [appReceipt, proxyReceipt]) {
                            try { await stopOwned(receipt, 'SIGINT'); }
                            catch (error) {
                                console.error(error.message);
                                try { await stopOwned(receipt, 'SIGKILL'); }
                                catch (failure) { console.error(failure.message); process.exitCode = 1; }
                            }
                        }
                    }
                };
                process.on('SIGINT', shutdown);
                process.on('SIGTERM', shutdown);
                try {
                    await waitFor(async () => {
                        if (proxy.child.exitCode !== null || proxy.child.signalCode) throw new Error('ViaProxy exited; inspect its log.');
                        return owned(proxyReceipt) && await portOpen(c.settings.port);
                    }, 20, 'owned loopback proxy');
                    if (stopping) throw new Error('Startup cancelled before application launch.');
                    app = launch(process.execPath, [path.join(c.appRoot, 'operator/run.mjs')], appReceipt, 'mindcraft', c.appRoot);
                    await waitFor(async () => {
                        if (app.child.exitCode !== null || app.child.signalCode) throw new Error('Mindcraft exited; inspect its log.');
                        return owned(appReceipt) && await uiOpen();
                    }, 40, 'MindServer');
                    console.log('Foreground components ready. Ctrl+C requests full shutdown.');
                    unlock();
                    const result = await Promise.race([app.completion, proxy.completion]);
                    if (!stopping && (result.code !== 0 || result.signal)) process.exitCode = result.code || 1;
                } catch (e) {
                    if (!stopping) throw e;
                } finally {
                    await shutdown();
                    if (app) await app.completion;
                    await proxy.completion;
                    process.removeListener('SIGINT', shutdown);
                    process.removeListener('SIGTERM', shutdown);
                }
            }
        }
    } finally { unlock(); }
}
