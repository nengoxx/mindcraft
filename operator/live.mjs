// Live-test helper: talk to the running bot through the local MindServer.
// Usage: node operator/live.mjs state | listen | say "<text>" | settings <out.json> | set <settings.json> | restart
// `say` speaks as the owner (settings `only_chat_with[0]`): the bot obeys only its
// owner, so owner requests, answers and raw `!commands` must come from that name.
// A message containing an unquoted `!command` runs that command raw; anything
// else goes to the model.
import fs from 'node:fs';
import { io } from 'socket.io-client';
import { loadConfig } from './config.mjs';

const config = loadConfig();
const owner = config.settings.only_chat_with?.[0];
const [cmd, arg] = process.argv.slice(2);
const usage = 'Usage: node operator/live.mjs state | listen | say "<text>" | settings <out.json> | set <settings.json> | restart';
if (!['state', 'listen', 'say', 'settings', 'set', 'restart'].includes(cmd)
    || (['say', 'settings', 'set'].includes(cmd) && !arg)) {
    console.error(usage);
    process.exit(2);
}
if (cmd === 'say' && !owner) {
    console.error('No owner: set only_chat_with in runtime/config/settings.json.');
    process.exit(2);
}

const socket = io(`http://localhost:${config.settings.mindserver_port}`, { reconnection: false });
const done = out => {
    if (out !== undefined) console.log(typeof out === 'string' ? out : JSON.stringify(out, null, 1));
    socket.close();
    process.exit(0);
};
socket.on('connect_error', err => { console.error(`MindServer not reachable: ${err.message}`); process.exit(1); });
socket.on('connect', () => {
    const name = config.name;
    if (cmd === 'state') {
        socket.on('state-update', states => { if (states[name]) done(states[name]); });
        socket.emit('listen-to-agents');
    } else if (cmd === 'listen') {
        socket.on('bot-output', (agent, message) => console.log(new Date().toTimeString().slice(0, 8), agent, '>>', message));
        socket.emit('listen-to-agents');
    } else if (cmd === 'say') {
        socket.emit('send-message', name, { from: owner, message: arg });
        setTimeout(() => done('sent'), 500);
    } else if (cmd === 'settings') {
        // The live settings hold the profile and endpoint; written owner-only.
        socket.emit('get-settings', name, reply => {
            if (!reply?.settings) { console.error(reply?.error ?? 'no settings returned'); process.exit(1); }
            fs.writeFileSync(arg, JSON.stringify(reply.settings, null, 1), { mode: 0o600 });
            done(`saved ${arg}`);
        });
    } else if (cmd === 'set') {
        socket.emit('set-agent-settings', name, JSON.parse(fs.readFileSync(arg, 'utf8')));
        setTimeout(() => done('set'), 800);
    } else if (cmd === 'restart') {
        socket.emit('restart-agent', name);
        setTimeout(() => done('restart sent'), 800);
    }
});
if (cmd !== 'listen') setTimeout(() => { console.error('timeout'); process.exit(2); }, 8000);
