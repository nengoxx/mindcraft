import { io } from 'socket.io-client';
import { loadConfig } from './config.mjs';

const config = loadConfig();

const [action = 'status', port = String(config.settings.mindserver_port)] = process.argv.slice(2);
if (!['status', 'stop'].includes(action) || !/^\d+$/.test(port)) {
    throw new Error('Usage: node operator/Control.mjs status|stop [loopback-ui-port]');
}
const socket = io(`http://localhost:${port}`, { reconnection: false });
let stopping = false;
let listening = false;
const timer = setTimeout(() => finish(1, 'No completed response from Mindcraft within 10 seconds.'), 10000);
function finish(code, message) {
    clearTimeout(timer);
    socket.removeAllListeners();
    socket.disconnect();
    if (message) console.log(message);
    process.exitCode = code;
}
socket.on('connect_error', err => finish(1, `Mindcraft is not reachable on localhost:${port}: ${err.message}`));
socket.on('agents-status', agents => {
    if (agents.length !== 1 || agents[0].name !== config.name) {
        finish(1, 'Unexpected agent list; refusing to control this MindServer.');
        return;
    }
    if (action === 'stop') {
        if (!stopping) { stopping = true; socket.emit('shutdown'); }
    } else if (!agents[0].in_game) {
        finish(0, JSON.stringify({ name: config.name, in_game: false, socket_connected: agents[0].socket_connected }));
    } else if (!listening) {
        listening = true;
        socket.emit('listen-to-agents');
    }
});
socket.on('state-update', states => {
    const s = states[config.name];
    if (s) finish(0, JSON.stringify({ name: s.name, gameplay: s.gameplay, action: s.action, inventory: s.inventory?.counts }));
});
socket.on('disconnect', () => {
    if (stopping) finish(0, 'MindServer disconnected after shutdown request. Verify the game player has left; stop ViaProxy separately.');
    else finish(1, 'MindServer disconnected before returning status.');
});
