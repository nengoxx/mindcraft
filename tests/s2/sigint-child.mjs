// Child process for the SIGINT test (work-record.test.mjs): an agent with an
// active task waits until MindServer-style SIGINT arrives.
import * as F from '../work-fixture.mjs';

const bot = F.makeBot();
const agent = F.makeAgent({ bot, name: process.env.WORK_TEST_BOT });
bot.hooks.goto = () => new Promise(() => {}); // never arrives
F.startWork(agent);
agent.work.startTask('walk', 'go_to target=40,64,0');
setInterval(() => {}, 1000);
setTimeout(() => process.stdout.write('ready\n'), 200);
