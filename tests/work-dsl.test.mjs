import assert from 'node:assert/strict';
import fs from 'node:fs';
import { after, beforeEach, test } from 'node:test';
import * as F from './work-fixture.mjs';

// S2: the step DSL and the task commands on Mindcraft's text path (SPEC §12.0,
// REQ-TRN-13..15, REQ-PLAN-1/2/5, REQ-RES-9).
const { commands, plan, work: workModule } = F.modules;
const agents = [];
after(() => F.cleanup(agents));
beforeEach(() => F.useSettings());

const config = { max_steps: 8, max_obtain_count: 256 };
function planCtx() {
    const bot = F.makeBot();
    F.player(bot);
    return { bot, owner: F.OWNER, config };
}

function setup({ replies = [], world, inventory } = {}) {
    const bot = F.makeBot({ world, inventory });
    F.player(bot, F.OWNER, [0, 64, 0]);
    const agent = F.makeAgent({ bot, replies });
    F.clearRecord(agent);
    F.startWork(agent);
    agents.push(agent);
    return agent;
}

// A go_to that never arrives until the run is interrupted: the task stays active.
function hangingGoto(agent) {
    agent.bot.hooks.goto = () => F.until(() => agent.bot.interrupt_code, { timeout: 30000 });
}

test('every grammar rule and DSL error message (REQ-TRN-14/15)', () => {
    const cases = [
        ['', 'no steps given'],
        [' ; ', 'no steps given'],
        [Array(9).fill('go_to target=here').join('; '), 'more than 8 steps'],
        ['go_to target=here; ' + 'x'.repeat(1000), 'steps text longer than 1000 characters'],
        ['mine item=stone count=1', "step 1: unknown skill 'mine' (use obtain, go_to, give, build)"],
        ['obtain item=stone count=1 colour=red', "step 1: unknown key 'colour' for obtain"],
        ['obtain item=stone', "step 1: missing key 'count'"],
        ['obtain item=stone item=dirt count=1', "step 1: key 'item' given twice"],
        ["build what='small hut", 'step 1: unclosed quote'],
        ['obtain item=stone count=many', "step 1: 'many' is not a number"],
        ['obtain item=stone count=2.5', "step 1: '2.5' is not a number"],
        ['obtain item=stone count=300', 'step 1: count 300 is outside 1–256'],
        ['obtain item=stone count=0', 'step 1: count 0 is outside 1–256'],
        ['obtain item=unobtainium count=1', "step 1: unknown item or block 'unobtainium'"],
        ['go_to target=castle', "step 1: bad position 'castle' (use here, owner or x,y,z)"],
        ['go_to target=1,2', "step 1: bad position '1,2' (use here, owner or x,y,z)"],
        ['go_to target=a,b,c', "step 1: bad position 'a,b,c' (use here, owner or x,y,z)"],
        ["build what='hut' source=new", "step 1: source 'new' arrives with I3; use auto or catalog"],
        ["build what='hut' source=owner", "step 1: source 'owner' arrives with I3; use auto or catalog"],
        ["build what='hut' source=mine", "step 1: source 'mine' arrives with I3; use auto or catalog"],
        ['obtain item=iron_ingot count=1', 'step 1: no method for iron_ingot in this version'],
        // Messages the spec's list does not name, for malformed input it does not cover.
        ['obtain oak_log 4', "step 1: bad argument 'oak_log' (use key=value)"],
        ['obtain item=oak@log count=1', "step 1: bad value 'oak@log' for item"],
        ["build what='hut' detail=fancy", "step 1: unknown detail 'fancy' (use minimal or basic)"],
        ["build what='hut' source=random", "step 1: unknown source 'random' (use auto or catalog)"],
        // S2 parses build steps; their handler arrives with the shelter slice (S3).
        ["build what='small hut' detail=basic size=3 at=here", 'step 1: build is not available yet'],
    ];
    for (const [text, expected] of cases) {
        const { steps, errors } = plan.planFromText(planCtx(), text);
        assert.equal(steps.length, 0, text);
        assert.ok(errors.some(e => e.startsWith(expected)), `${JSON.stringify(text)} -> ${JSON.stringify(errors)}`);
    }
});

test('accepted grammar: keys in any order, quoted text with ; and spaces, frozen positions', () => {
    const ctx = planCtx();
    const { steps, errors } = plan.planFromText(ctx, ' give  count=3 item=stick player=steve ;go_to target=-5,70.5,12;obtain count=4 item=oak_log; ');
    assert.deepEqual(errors, []);
    assert.deepEqual(steps.map(s => s.skill), ['give', 'go_to', 'obtain']);
    assert.deepEqual(steps[0].args, { count: 3, item: 'stick', player: 'steve' });
    assert.deepEqual(steps[1].args.target, { x: -5, y: 70, z: 12, dim: 'overworld', given: '-5,70.5,12' });
    const quoted = plan.parseSteps("build what='hut; with a door' detail=basic");
    assert.deepEqual(quoted.errors, []);
    assert.equal(quoted.steps[0].raw.what, 'hut; with a door');
});

test('all errors come back together, each naming its step (REQ-PLAN-5)', async () => {
    const agent = setup();
    const result = await commands.executeCommand(agent,
        '!taskStart("x", "obtain item=stone count=1; mine item=stone; obtain item=cobblestone count=300; go_to target=castle")');
    assert.equal(result, "!taskStart refused: step 1: no method for stone in this version; step 2: unknown skill 'mine' (use obtain, go_to, give, build); " +
        "step 3: count 300 is outside 1–256; step 4: bad position 'castle' (use here, owner or x,y,z). " +
        'For an item with no method here, use the existing commands instead (!collectBlocks, !craftRecipe, !smeltItem, or !goal for a longer job); ' +
        'crops and farmed plants (wheat, sugar cane, bamboo, cactus, berries, kelp) are protected as possible farms and cannot be collected');
    // F20: the fallback hint comes only with a "no method" error.
    assert.doesNotMatch(await commands.executeCommand(agent, '!taskStart("x", "mine item=stone")'), /existing commands/);
    assert.equal(agent.work.record, null);
});

test('a double quote inside an argument gives Mindcraft\'s argument-count error', async () => {
    const agent = setup();
    await F.ownerSays(agent, '!taskStart("hut", "build what="small hut"")');
    assert.ok(agent.chats.includes('Command !taskStart was given 0 args, but requires 2 args.'), agent.chats.join('|'));
    assert.equal(agent.work.record, null);
});

test('a command in backticks does not run; only the first command in a reply runs', async () => {
    const quoted = setup({ replies: ['I would use `!taskStart("log", "go_to target=0,64,0")` for that.'] });
    await F.ownerSays(quoted, 'how would you start a task?');
    assert.equal(quoted.work.record, null);
    assert.equal(quoted.modelCalls, 1);

    const two = setup({ replies: ['On it. !taskStart("walk", "go_to target=40,64,0") !taskCancel'] });
    hangingGoto(two);
    await F.ownerSays(two, 'walk over there');
    assert.equal(two.work.record.status, 'active');
    await two.work.cancelTask();
});

test('the task commands appear in $COMMAND_DOCS with the grammar summary', () => {
    const docs = commands.getCommandDocs({ blocked_actions: [] });
    for (const name of ['!taskStart', '!taskRevise', '!taskPause', '!taskResume', '!taskCancel']) assert.match(docs, new RegExp(`${name}:`));
    assert.match(docs, /obtain item=<item> count=<1-256>/);
    assert.match(docs, /never put a double quote inside an argument/);
});

test('!taskStart from the model and from the owner reach the same perform; it returns falsy and saves history', async () => {
    const command = commands.getCommand('!taskStart');
    const perform = command.perform;
    const seen = [];
    command.perform = async (agent, ...args) => { seen.push(args); return perform(agent, ...args); };
    try {
        const model = setup({ replies: ['Sure. !taskStart("walk to the spot", "go_to target=0,64,0")'] });
        const used = await F.ownerSays(model, 'walk to the spot');
        assert.equal(used, true);
        assert.equal(model.modelCalls, 1); // the falsy result ended the loop: no follow-up inference
        assert.ok(model.history.saved >= 1);
        assert.ok(model.turns.some(t => t.source === 'system' && /^Task started: "walk to the spot"/.test(t.content)));
        assert.equal(model.work.record.objective, 'walk to the spot');

        const owner = setup();
        await F.ownerSays(owner, '!taskStart("walk to the spot", "go_to target=0,64,0")');
        assert.equal(owner.modelCalls, 0);
        assert.equal(owner.work.record.objective, 'walk to the spot');
        assert.ok(owner.chats.some(c => /^Task started/.test(c)));
        assert.deepEqual(seen, [['walk to the spot', 'go_to target=0,64,0'], ['walk to the spot', 'go_to target=0,64,0']]);

        assert.equal(await perform(setup(), 'walk', 'go_to target=0,64,0'), undefined);
    } finally {
        command.perform = perform;
    }
});

test('the stop-epoch checks still stop a model command', async () => {
    const agent = setup({ replies: [a => { a.stop_epoch++; return '!taskStart("walk", "go_to target=0,64,0")'; }] });
    await F.ownerSays(agent, 'walk');
    assert.equal(agent.work.record, null);
});

test('the frozen request sequence parses and validates (tests/s2/requests.json)', () => {
    const frozen = JSON.parse(fs.readFileSync(new URL('./s2/requests.json', import.meta.url), 'utf8'));
    assert.ok(frozen.requests.length >= 10);
    const ctx = planCtx();
    for (const request of frozen.requests) {
        const { steps, errors } = plan.planFromText(ctx, request.steps);
        assert.deepEqual(errors, [], `${request.id}: ${request.request}`);
        assert.equal(steps.length, request.steps.split(';').length, `${request.id}`);
    }
});

test('!goal is refused while a task is active, from the model and the owner', async () => {
    const agent = setup({ replies: ['!goal("gather wood forever")', ''] });
    hangingGoto(agent);
    agent.work.startTask('walk', 'go_to target=40,64,0');
    await F.ownerSays(agent, '!goal("gather wood forever")');
    assert.ok(agent.chats.includes(workModule.TASK_ACTIVE));
    await F.ownerSays(agent, 'set a goal to gather wood forever');
    assert.ok(agent.turns.some(t => t.source === 'system' && t.content === workModule.TASK_ACTIVE));
    assert.equal(agent.self_prompter.isStopped(), true);
    await agent.work.cancelTask();
    await F.ownerSays(agent, '!goal("gather wood forever")');
    assert.equal(agent.self_prompter.isActive(), true);
    await agent.self_prompter.stop(false);
});

test('!newAction is refused while a task is non-terminal, from the model and the owner, and runs again once it ends', async () => {
    F.useSettings({ allow_insecure_coding: true });
    const agent = setup({ replies: ['!newAction("build a wall")', ''] });
    let generated = 0;
    agent.coder.generateCode = async () => { generated++; return 'generated code ran'; };
    hangingGoto(agent);
    agent.work.startTask('walk', 'go_to target=40,64,0');
    await F.ownerSays(agent, '!newAction("build a wall")');
    assert.ok(agent.chats.includes(workModule.TASK_ACTIVE));
    await agent.work.pauseTask(); // paused is non-terminal: still refused
    await F.ownerSays(agent, 'build a wall with code');
    assert.ok(agent.turns.some(t => t.source === 'system' && t.content === workModule.TASK_ACTIVE));
    assert.equal(generated, 0);
    await agent.work.cancelTask();
    await F.ownerSays(agent, '!newAction("build a wall")');
    assert.equal(generated, 1);
});

test('supersede: a new request cancels a paused or blocked task as superseded; while active it is refused', async () => {
    const agent = setup();
    hangingGoto(agent);
    agent.work.startTask('first', 'go_to target=40,64,0');
    const first = agent.work.record;
    assert.equal(agent.work.startTask('second', 'go_to target=0,64,0').message, workModule.TASK_ACTIVE);
    await agent.work.pauseTask();
    assert.equal(agent.work.startTask('second', 'go_to target=1,64,0').ok, true);
    assert.equal(first.status, 'cancelled');
    assert.equal(first.reason, 'superseded');
    await F.until(() => agent.work.record.status === 'done');

    const blocked = setup();
    blocked.work.startTask('logs', 'obtain item=oak_log count=1'); // no tree anywhere: blocks
    await F.until(() => blocked.work.record.status === 'blocked');
    const old = blocked.work.record;
    assert.equal(blocked.work.startTask('walk', 'go_to target=0,64,0').ok, true);
    assert.equal(old.reason, 'superseded');
    // A refused request leaves a paused task alone.
    const keep = setup();
    hangingGoto(keep);
    keep.work.startTask('first', 'go_to target=40,64,0');
    await keep.work.pauseTask();
    assert.equal(keep.work.startTask('bad', 'mine item=x').ok, false);
    assert.equal(keep.work.record.status, 'paused');
    await keep.work.cancelTask();
});

test('inherited object names are not skills, keys, items or sources (F16)', () => {
    const ctx = planCtx();
    for (const name of ['constructor', 'toString', '__proto__', 'hasOwnProperty']) {
        assert.match(plan.planFromText(ctx, name).errors.join(), /unknown skill/, name);
        assert.match(plan.planFromText(ctx, `obtain item=oak_log count=1 ${name}=1`).errors.join(), /unknown key/, name);
        assert.match(plan.planFromText(ctx, `obtain item=${name} count=1`).errors.join(), /unknown item or block/, name);
        assert.match(plan.planFromText(ctx, `build what=hut source=${name}`).errors.join(), /unknown source/, name);
    }
});

test('validation counts the current inventory: a held target needs no production method (F15)', () => {
    const bot = F.makeBot({ inventory: { stone: 1, stick: 2, iron_ingot: 3 } });
    F.player(bot);
    const ctx = { bot, owner: F.OWNER, config };
    assert.deepEqual(plan.planFromText(ctx, 'obtain item=stone count=1').errors, []);
    assert.match(plan.planFromText(ctx, 'obtain item=stone count=2').errors.join(), /no method for stone/);
    assert.deepEqual(plan.planFromText(ctx, 'obtain item=iron_pickaxe count=1').errors, []);
});

test('the example profile: build origins stay in the summary until S3, and "no method" falls back to the existing commands (F20/F21)', () => {
    const profile = JSON.parse(fs.readFileSync(new URL('../operator/examples/profiles/local.json', import.meta.url), 'utf8'));
    assert.match(profile.saving_memory, /build origins/);
    assert.match(profile.saving_memory, /under 1000 characters/);
    const turns = profile.conversation_examples.flat();
    assert.ok(turns.some(t => t.role === 'system' && /no method for bread/.test(t.content)));
    assert.ok(turns.some(t => t.role === 'assistant' && /!buildStructure|!newAction\("Build/.test(t.content))); // construction examples kept (F19)
});

// Last in this file: blacklistCommands edits the shared command map.
test('blocked_actions in S2: construction keeps !buildStructure until S3; the deployment\'s !setMode block holds; gather and craft commands run', async () => {
    const overlay = JSON.parse(fs.readFileSync(new URL('../operator/examples/settings.json', import.meta.url), 'utf8'));
    assert.equal((overlay.blocked_actions ?? []).includes('!buildStructure'), false); // F19: blocked with !build in S3
    // The deployment's list: upstream's four plus !setMode (runtime/config/settings.json).
    const blockedList = ['!checkBlueprint', '!checkBlueprintLevel', '!getBlueprint', '!getBlueprintLevel', '!setMode'];
    commands.blacklistCommands(blockedList);
    const agent = setup({ inventory: { oak_log: 2 } });
    agent.blocked_actions = blockedList;
    const docs = commands.getCommandDocs(agent);
    assert.match(docs, /!buildStructure:/);
    assert.doesNotMatch(docs, /!setMode:/);
    for (const name of ['!collectBlocks', '!craftRecipe', '!taskStart', '!newAction']) assert.match(docs, new RegExp(`${name}:`));
    await F.ownerSays(agent, '!setMode("self_defense", false)');
    assert.ok(agent.chats.includes("Command '!setMode' does not exist."));
    await F.ownerSays(agent, '!craftRecipe("oak_planks", 1)');
    await F.until(() => agent.bot.count('oak_planks') === 4);
    assert.ok(commands.commandExists('!collectBlocks'));
});
