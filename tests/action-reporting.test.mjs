import assert from 'node:assert/strict';
import { mock, test } from 'node:test';

// Only game data is substituted. No bot, server or model connection is created.
const mc = await import('../src/utils/mcdata.js');
mock.module('../src/utils/mcdata.js', {
    namedExports: {
        ...mc,
        getItemId: name => ({ dark_oak_planks: 1, dark_oak_log: 2 })[name],
        getItemCraftingRecipes: () => [[{ dark_oak_log: 1 }, 4]],
        ingredientsFromPrismarineRecipe: () => ({ dark_oak_log: 1 }),
    },
});
const commands = await import('../src/agent/commands/index.js');
const { craftRecipe } = await import('../src/agent/library/skills.js');
const { ActionManager } = await import('../src/agent/action_manager.js');
const { Agent } = await import('../src/agent/agent.js');
const { setSettings } = await import('../src/agent/settings.js');
setSettings({ language: 'en', max_commands: 3 });

const mentions = [
    'The native `!craftRecipe` call was executed but consumed nothing.',
    'I mentioned "!stop", but did not execute it.',
    "The command '!stop' ends the task.",
    'The command “!stop” ends the task.',
    'The command ‘!stop’ ends the task.',
    'He said ‘I’m using !stop now’.',
    'Example:\n```text\n!stop\n```',
    'Example:\n~~~text\n!stop\n~~~',
    'Example: ``use `!stop` here``.',
    'Unclosed code example: `!stop',
    'Unclosed quote: "!stop',
    'Say "use `!stop`" when explaining it.',
    'Example:\n> !stop\nThat was a quote.',
    'Escaped mention: \\!stop',
    'He said "I said \\"!stop\\" earlier".',
];
for (const message of mentions) {
    test(`quoted mention does not execute: ${JSON.stringify(message)}`, async () => {
        assert.equal(commands.containsCommand(message), null);
        assert.equal(commands.truncCommandMessage(message), message);
        // Passing no agent also proves that no command performer is reached.
        assert.equal(await commands.executeCommand(null, message), 'Command is incorrectly formatted');
    });
}

test('literal commands, inline prefaces and string arguments still parse', () => {
    for (const message of ['!stop', "Sure, I'll stop. !stop", 'I’m stopping.\n!stop']) {
        assert.equal(commands.containsCommand(message), '!stop');
        assert.deepEqual(commands.parseCommandMessage(message), { commandName: '!stop', args: [] });
    }
    assert.deepEqual(commands.parseCommandMessage('Crafting now. !craftRecipe("dark_oak_planks", 1)'), {
        commandName: '!craftRecipe', args: ['dark_oak_planks', 1],
    });
    assert.deepEqual(commands.parseCommandMessage('!newAction("Explain `!stop` (without executing it)")'), {
        commandName: '!newAction', args: ['Explain `!stop` (without executing it)'],
    });
});

test('detection, parsing and truncation select the same unquoted command', () => {
    const message = 'I mentioned `!craftRecipe`. Now stopping. !stop Trailing prose.';
    assert.equal(commands.containsCommand(message), '!stop');
    assert.deepEqual(commands.parseCommandMessage(message), { commandName: '!stop', args: [] });
    assert.equal(commands.truncCommandMessage(message), 'I mentioned `!craftRecipe`. Now stopping. !stop');
    assert.match(commands.parseCommandMessage('!craftRecipe'), /given 0 args, but requires 2/);
    assert.match(commands.parseCommandMessage('!notACommand'), /is not a command/);
    const repeated = 'Mention `!stop`. Now !stop';
    assert.equal(commands.commandStart(repeated), repeated.lastIndexOf('!stop'));
    assert.equal(commands.commandStart('Mention `!stop`.'), -1);
});

test('quoted owner/model messages remain conversation with no action or retry inference', async () => {
    const turns = [];
    const responses = [];
    let inferences = 0;
    const reply = 'The native `!craftRecipe` call was executed but consumed nothing.';
    const agent = {
        name: 'fixture', stop_epoch: 0,
        async checkTaskDone() {},
        bot: { modes: { flushBehaviorLog: () => '' } },
        self_prompter: {
            isActive: () => false,
            shouldInterrupt: () => false,
            handleUserPromptedCmd() { assert.fail('mention reached action handling'); },
        },
        history: {
            add: (source, message) => turns.push({ source, message }),
            save() {}, getHistory: () => turns,
        },
        prompter: { async promptConvo() { inferences++; return reply; } },
        routeResponse: (source, message) => responses.push(message),
    };
    const usedCommand = await Agent.prototype.handleMessage.call(agent, 'owner', 'Explain `!craftRecipe`.');
    assert.equal(usedCommand, false);
    assert.equal(inferences, 1);
    assert.deepEqual(responses, [reply]);
    assert.equal(turns.some(turn => turn.source === 'system'), false);
});

function fixture({ logs = 13, planks = 0, change = true, fail = false } = {}) {
    const bot = {
        output: '', interrupt_code: false,
        inventory: { slots: [] },
        recipesFor: () => [{}],
        armorManager: { equipAll() {} },
        emit() {},
        async craft(recipe, runs) {
            this.craftRuns = runs;
            if (change) { logs -= runs; planks += runs * 4; }
            update();
            if (fail) throw new Error('fixture craft failure');
        },
    };
    function update() {
        bot.inventory.slots = [
            { name: 'dark_oak_log', count: logs },
            ...(planks ? [{ name: 'dark_oak_planks', count: planks }] : []),
        ];
    }
    update();
    const agent = {
        bot,
        clearBotLogs() { bot.output = ''; bot.interrupt_code = false; },
    };
    agent.actions = new ActionManager(agent);
    return agent;
}

test('native craft reports input/output before, after and net change through action manager', async () => {
    const agent = fixture();
    const output = await commands.executeCommand(agent, '!craftRecipe("dark_oak_planks", 1)');
    assert.equal(agent.bot.craftRuns, 1);
    assert.match(output, /dark_oak_planks: 0 -> 4 \(net \+4\)/);
    assert.match(output, /dark_oak_log: 13 -> 12 \(net -1\)/);
    assert.doesNotMatch(output, /shortened/);
});

test('pre-existing output is separate from new output', async () => {
    const agent = fixture({ planks: 20 });
    await craftRecipe(agent.bot, 'dark_oak_planks', 2);
    assert.match(agent.bot.output, /dark_oak_planks: 20 -> 28 \(net \+8\)/);
    assert.match(agent.bot.output, /dark_oak_log: 13 -> 11 \(net -2\)/);
});

test('unchanged inventory is reported without claiming crafting success', async () => {
    const agent = fixture({ planks: 4, change: false });
    await craftRecipe(agent.bot, 'dark_oak_planks', 1);
    assert.match(agent.bot.output, /dark_oak_planks: 4 -> 4 \(net 0\)/);
    assert.match(agent.bot.output, /dark_oak_log: 13 -> 13 \(net 0\)/);
    assert.doesNotMatch(agent.bot.output, /Successfully crafted/);
});

test('limited batch reports actual counts and requested versus attempted runs', async () => {
    const agent = fixture({ logs: 1 });
    await craftRecipe(agent.bot, 'dark_oak_planks', 3);
    assert.equal(agent.bot.craftRuns, 1);
    assert.match(agent.bot.output, /requested 3 recipe runs; attempted 1/);
    assert.match(agent.bot.output, /dark_oak_planks: 0 -> 4 \(net \+4\)/);
    assert.match(agent.bot.output, /dark_oak_log: 1 -> 0 \(net -1\)/);
});

test('failed craft preserves observed partial changes and propagates the error', async () => {
    const agent = fixture({ fail: true });
    await assert.rejects(craftRecipe(agent.bot, 'dark_oak_planks', 1), /fixture craft failure/);
    assert.match(agent.bot.output, /dark_oak_planks: 0 -> 4 \(net \+4\)/);
    assert.match(agent.bot.output, /dark_oak_log: 13 -> 12 \(net -1\)/);
    assert.doesNotMatch(agent.bot.output, /Craft call returned|Successfully crafted/);
});

for (const timedout of [false, true]) {
    test(`generated action retains partial output on ${timedout ? 'timeout' : 'interruption'}`, async () => {
        setSettings({ language: 'en', allow_insecure_coding: true, code_timeout_mins: -1 });
        const agent = fixture();
        const turns = [];
        agent.history = { async add(role, content) { turns.push({role, content}); }, async save() {} };
        agent.coder = { async generateCode() {
            agent.bot.output = 'Broke oak_log at x:10, y:64, z:10.\n';
            agent.bot.interrupt_code = true;
            agent.actions.timedout = timedout;
            return null;
        } };
        const output = await commands.executeCommand(agent, '!newAction("Prepare site")');
        if (timedout) {
            assert.match(output, /Action interrupted[\s\S]*Broke oak_log/);
        } else {
            assert.equal(Boolean(output), false); // No immediate command-loop continuation during defense/stop.
            assert.equal(turns.length, 1);
            assert.equal(turns[0].role, 'system');
            assert.match(turns[0].content, /Action interrupted[\s\S]*Broke oak_log/);
        }
    });
}

test('successful generated action keeps its existing code/result report', async () => {
    setSettings({ language: 'en', allow_insecure_coding: true, code_timeout_mins: -1 });
    const agent = fixture();
    agent.coder = { async generateCode() { return 'Agent wrote this code: fixture. Code Output: verified fixture.'; } };
    assert.equal(await commands.executeCommand(agent, '!newAction("fixture")'),
        'Agent wrote this code: fixture. Code Output: verified fixture.');
});

test('cooperative interruption retains the report already consumed by Coder', async () => {
    setSettings({ language: 'en', allow_insecure_coding: true, code_timeout_mins: -1 });
    const agent = fixture();
    const turns = [];
    const partial = 'Agent wrote this code: fixture. Code Output: Action interrupted. Broke oak_log.';
    agent.history = { async add(role, content) { turns.push({role, content}); }, async save() {} };
    agent.coder = { async generateCode() {
        agent.bot.interrupt_code = true;
        agent.bot.output = ''; // Coder has already consumed it into its report.
        return partial;
    } };
    assert.equal(await commands.executeCommand(agent, '!newAction("fixture")'), undefined);
    assert.deepEqual(turns, [{role: 'system', content: partial}]);
});
