import fs from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig } from './config.mjs';
import { portOpen, runningOwned } from './process.mjs';

async function assertStopped(c, receiptPath) {
    if (await portOpen(c.settings.port)) throw new Error('Stop ViaProxy before updating: its port is occupied.');
    if (process.platform === 'linux') {
        if (runningOwned(receiptPath)) throw new Error('Stop the recorded proxy process/group before updating.');
        return;
    }
    // Windows keeps its conservative live-PID guard after exceptional exits.
    try {
        const receipt = JSON.parse(await fs.readFile(receiptPath, 'utf8'));
        try {
            process.kill(receipt.pid ?? receipt.Pid, 0);
            throw new Error('Recorded proxy PID is live; refusing update. Run Proxy.ps1 Status/Stop. If its receipt is stale after a crash/reboot, verify the original Java and configured port are stopped, archive runtime/proxy/operator-proxy.json, then retry Update; do not kill an unrelated PID.');
        } catch (e) { if (e.code !== 'ESRCH') throw e; }
    } catch (e) { if (e.code !== 'ENOENT') throw e; }
}

export async function updateProxy(c, request = fetch) {
    const receiptPath = path.join(c.proxyRoot, 'operator-proxy.json');
    await assertStopped(c, receiptPath);
    const response = await request('https://api.github.com/repos/ViaVersion/ViaProxy/releases/latest');
    if (!response.ok) throw new Error(`Release lookup failed: HTTP ${response.status}`);
    const release = await response.json();
    if (release.draft || release.prerelease) throw new Error('Expected a stable published release.');
    const asset = release.assets.find(a => /^ViaProxy-[\d.]+\.jar$/.test(a.name));
    if (!asset || !/^sha256:[a-f0-9]{64}$/.test(asset.digest || '') ||
        !asset.browser_download_url.startsWith('https://github.com/ViaVersion/ViaProxy/releases/download/'))
        throw new Error('Release lacks an official normal jar and SHA256 digest.');
    const download = await request(asset.browser_download_url);
    if (!download.ok) throw new Error(`Jar download failed: HTTP ${download.status}`);
    const bytes = Buffer.from(await download.arrayBuffer());
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    if (`sha256:${sha256}` !== asset.digest) throw new Error('ViaProxy checksum mismatch; installed jar preserved.');
    // Recheck after download; a component might have been started meanwhile.
    await assertStopped(c, receiptPath);
    await fs.mkdir(c.proxyRoot, { recursive: true });
    const temporary = c.jar + '.download';
    await fs.writeFile(temporary, bytes);
    await fs.rename(temporary, c.jar);
    const installed = { version: release.tag_name, sha256, url: asset.browser_download_url, installedAt: new Date().toISOString() };
    await fs.writeFile(path.join(c.proxyRoot, 'installed.json'), JSON.stringify(installed, null, 2) + '\n');
    console.log(JSON.stringify(installed));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url))
    await updateProxy(loadConfig());
