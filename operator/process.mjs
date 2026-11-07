import fs from 'node:fs';
import net from 'node:net';

export const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
export async function portOpen(port, host = '127.0.0.1') {
    return new Promise(resolve => {
        const socket = net.connect({ host, port });
        const finish = yes => { socket.destroy(); resolve(yes); };
        socket.setTimeout(500);
        socket.once('connect', () => finish(true));
        socket.once('error', () => finish(false));
        socket.once('timeout', () => finish(false));
    });
}

export function identity(pid) {
    try {
        const stat = fs.readFileSync(`/proc/${pid}/stat`, 'utf8');
        const fields = stat.slice(stat.lastIndexOf(')') + 2).split(' ');
        if (fields[0] === 'Z') return null;
        const value = { pid, start: fields[19], group: Number(fields[2]), session: Number(fields[3]) };
        // exec changes these diagnostic fields, but not the process identity.
        try {
            value.executable = fs.readlinkSync(`/proc/${pid}/exe`);
            value.command = fs.readFileSync(`/proc/${pid}/cmdline`).toString('base64');
        } catch { }
        return value;
    } catch { return null; }
}

export function sameProcess(a, b) {
    return !!a && !!b && a.pid === b.pid && a.start === b.start &&
        a.group === b.group && a.session === b.session;
}

export function owned(receiptPath) {
    if (!fs.existsSync(receiptPath)) return null;
    const receipt = JSON.parse(fs.readFileSync(receiptPath, 'utf8'));
    const actual = identity(receipt.pid);
    return sameProcess(actual, receipt) ? actual : null;
}

export function record(receiptPath, pid) {
    const value = identity(pid);
    if (!value) throw new Error('Cannot read the child process identity.');
    fs.writeFileSync(receiptPath, JSON.stringify(value, null, 2) + '\n', { mode: 0o600 });
    return value;
}

function ownedGroup(receipt) {
    if (receipt.group !== receipt.pid || receipt.session !== receipt.pid) return false;
    const root = identity(receipt.pid);
    if (root && !sameProcess(root, receipt)) return false;
    // A separate session/group survives its leader only while descendants remain.
    // Do not mistake an inherited terminal group for an owned component group.
    return fs.readdirSync('/proc').filter(n => /^\d+$/.test(n)).some(n => {
        try {
            const stat = fs.readFileSync(`/proc/${n}/stat`, 'utf8');
            const fields = stat.slice(stat.lastIndexOf(')') + 2).split(' ');
            return fields[0] !== 'Z' && Number(fields[2]) === receipt.pid &&
                Number(fields[3]) === receipt.pid && BigInt(fields[19]) >= BigInt(receipt.start);
        } catch { return false; }
    });
}

export function runningOwned(receiptPath) {
    if (!fs.existsSync(receiptPath)) return false;
    const receipt = JSON.parse(fs.readFileSync(receiptPath, 'utf8'));
    return !!owned(receiptPath) || ownedGroup(receipt);
}

export function clearExitedReceipt(receiptPath, expected) {
    if (!fs.existsSync(receiptPath)) return false;
    const current = JSON.parse(fs.readFileSync(receiptPath, 'utf8'));
    if (!sameProcess(current, expected) || runningOwned(receiptPath)) return false;
    fs.unlinkSync(receiptPath);
    return true;
}

export async function waitFor(check, seconds, description) {
    const end = Date.now() + seconds * 1000;
    do {
        if (await check()) return;
        await delay(100);
    } while (Date.now() < end);
    throw new Error(`Timed out waiting for ${description} (${seconds}s).`);
}

export async function stopOwned(receiptPath, signal = 'SIGTERM') {
    if (!fs.existsSync(receiptPath)) return;
    const receipt = JSON.parse(fs.readFileSync(receiptPath, 'utf8'));
    const p = owned(receiptPath);
    const group = ownedGroup(receipt);
    if (!p && identity(receipt.pid)) throw new Error('Stale process receipt; refusing to signal an unowned PID.');
    if (!p && !group) { clearExitedReceipt(receiptPath, receipt); return; }
    process.kill(group ? -receipt.pid : receipt.pid, signal);
    await waitFor(() => !owned(receiptPath) && !ownedGroup(receipt), 10, 'owned process/group exit');
    clearExitedReceipt(receiptPath, receipt);
}
