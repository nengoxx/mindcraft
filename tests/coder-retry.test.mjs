import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Coder } from '../src/agent/coder.js';

test('lint retries retain each rejected candidate next to its diagnostics and only execute valid code', async () => {
    const candidates = [
        '```js\nconst site = "first candidate"\n```',
        '```js\ntry { throw new Error("fixture"); } catch (error) {}\n```',
        '```js\nconst site = "corrected candidate";\n```',
    ];
    const prompts = [];
    const executed = [];
    const history = [{role: 'assistant', content: '!newAction("Inspect a site; do not build yet.")'}];
    // Run actual generation/retry and ESLint methods with inert model/staging.
    // No bot connection, generated-code execution or file writes.
    const coder = Object.create(Coder.prototype);
    coder.agent = {
        bot: {interrupt_code: false, modes: {pause() {}}},
        prompter: {
            skill_libary: {async getAllSkillDocs() {return [];}},
            async promptCoding(messages) {
                prompts.push(structuredClone(messages));
                return candidates[prompts.length - 1];
            },
        },
        actions: {getBotOutputSummary: () => 'fixture output'},
    };
    coder._stageCode = async code => ({
        src_lint_copy: coder._sanitizeCode(code),
        func: {async main() {executed.push(code);}},
    });
    const result = await coder.generateCode({getHistory: () => structuredClone(history)});
    assert.equal(prompts.length, 3);
    for (let retry = 1; retry < prompts.length; retry++) {
        const prompt = prompts[retry];
        assert.deepEqual(prompt[0], history[0]);
        assert.deepEqual(prompt.at(-2), {role: 'assistant', content: candidates[retry - 1]});
        assert.equal(prompt.at(-1).role, 'system');
        assert.match(prompt.at(-1).content, /Code lint error/);
    }
    assert.equal(executed.length, 1);
    assert.match(executed[0], /corrected candidate/);
    assert.match(result, /fixture output/);
});
