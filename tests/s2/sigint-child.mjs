// Child process for the SIGINT test (work-record.test.mjs): an agent with an
// active task waits until MindServer-style SIGINT arrives.
import * as F from '../work-fixture.mjs';

const bot = F.makeBot();
const agent = F.makeAgent({ bot, name: process.env.WORK_TEST_BOT });
bot.hooks.goto = () => new Promise(() => {}); // never arrives
F.startWork(agent);
agent.work.startTask('walk', 'go_to target=40,64,0');
// A ledger change the throttle holds back: only the SIGINT flush writes it.
agent.work.ledger.throttleMs = 600000;
agent.work.ledger.lastWrite = Date.now();
agent.work.ledger.add({ pos: { x: 1, y: 64, z: 1 }, block: 'oak_planks', kind: 'own', by: null, dim: 'overworld', at: 1 });
setInterval(() => {}, 1000);
setTimeout(() => process.stdout.write('ready\n'), 200);
