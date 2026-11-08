// The I1 task commands (SPEC §12.0, REQ-TRN-13), registered through the
// commands/index.js carry so they appear in $COMMAND_DOCS. The model's text
// command and the owner's forced command reach the same perform.
//
// On success each one shows its one-line result to the owner, saves it to
// history and returns nothing: a falsy result ends the command loop with no
// follow-up inference and skips its history.save() (agent.js:379-382, :390), so
// the save is explicit here (REQ-PLAN-2).

const DSL_HELP = 'Steps: one string, steps separated by ";", each "skill key=value ...": ' +
    'obtain item=<item> count=<1-256>; go_to target=here|owner|<x>,<y>,<z>; give player=<name> item=<item> count=<n>. ' +
    "Free text goes in single quotes; never put a double quote inside an argument (that gives an argument-count error). " +
    'At most 8 steps. Example: !taskStart("40 oak planks", "obtain item=oak_planks count=40")';

async function report(agent, result) {
    agent.openChat(result.message);
    await agent.history.add('system', result.message);
    await agent.history.save();
}

function taskCommand(name, description, params, run) {
    return {
        name,
        description,
        ...(params ? { params } : {}),
        perform: async function (agent, ...args) {
            if (!agent.work) return 'The task layer is not ready yet.';
            const result = await run(agent.work, ...args);
            // A refusal is returned, so the model sees every error in one system
            // result and may correct the plan (REQ-PLAN-5); the owner sees it too.
            if (!result.ok) return result.message;
            await report(agent, result);
        },
    };
}

export const workCommands = [
    taskCommand('!taskStart',
        'Start a task that runs by itself and survives interruptions and restarts: gathering, crafting, going somewhere, giving items. ' +
        'Prefer it over single commands for any request that takes more than one action. ' + DSL_HELP,
        {
            objective: { type: 'string', description: "The owner's request, restated briefly." },
            steps: { type: 'string', description: 'The steps in the step language above.' },
        },
        (work, objective, steps) => work.startTask(objective, steps)),
    taskCommand('!taskRevise',
        'Replace the unfinished steps of the current task from step from_step on (done steps are kept). Same step language as !taskStart.',
        {
            from_step: { type: 'int', description: 'The first step to replace (1 = the first step).', domain: [1, 100] },
            steps: { type: 'string', description: 'The new steps.' },
        },
        (work, fromStep, steps) => work.reviseTask(fromStep, steps)),
    taskCommand('!taskPause', 'Pause the current task (for example when the owner says to wait or stay).', null,
        work => work.pauseTask()),
    taskCommand('!taskResume', 'Continue a paused or blocked task.', null,
        work => work.resumeTask()),
    taskCommand('!taskCancel', 'Cancel the current task for good.', null,
        work => work.cancelTask()),
];
