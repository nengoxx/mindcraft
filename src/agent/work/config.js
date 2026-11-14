// Defaults for the work.* settings of the built iterations (SPEC §14, REQ-CFG-1).
// The owner overrides them in the bot profile's `work` object. Only keys that
// built code reads live here; a deferred mechanism's keys arrive with it (the
// shelter, fit and build keys arrive with S3; the model keys are read by the
// prompter and the outage module, outside src/agent/work/).
const COLORS = ['white', 'orange', 'magenta', 'light_blue', 'yellow', 'lime', 'pink', 'gray', 'light_gray', 'cyan',
    'purple', 'blue', 'brown', 'green', 'red', 'black'];

export const WORK_DEFAULTS = Object.freeze({
    return_radius: 6,       // blocks from work_pos before the runner goes back
    stall_s: 15,            // idle seconds before the self-heal timer resumes (REQ-RES-10)
    no_progress_s: 120,     // per-call no-progress deadline, crafting included (REQ-RES-5)
    step_stall_s: 600,      // wall time without metric improvement before a step blocks (REQ-RES-16)
    run_deadline_s: 300,    // run bound (REQ-RES-6)
    max_steps: 8,
    max_obtain_count: 256,
    min_free_slots: 4,      // below this many free slots she drops surplus, in a task and when idle (REQ-OBT-11)
    // The item list (REQ-OBT-11): per item how many she keeps, 0 (junk: all
    // dropped), a count, "stack" (its stack size), "slot" (one slot: the best
    // stack, every other slot dropped) or "all" (never removed); anything not
    // listed is kept. Merged by item name (mergeInventory). A new default needs
    // the owner's approval: it makes a kept item disposable.
    // The bow, crossbow, arrows, banners and ominous bottles are kept for the
    // owner (she fights with melee): of a bow and of a crossbow only the best
    // one stays (DECISIONS 2026-11-12, "best one, period"), of the banners and
    // the ominous bottles the best slot (DECISIONS 2026-11-12 "One slot of the
    // best": bottles of different strengths do not stack together).
    // `idle`: the idle cleanup on or off.
    // The gear slice (REQ-GEAR-1, REQ-OBT-11; DECISIONS 2026-11-12 (night),
    // 2026-11-13), off in public: `gear` "best" keeps only the best of each
    // tool kind, one melee weapon and one piece per armour slot ("all": every
    // one); `cap` "stack" caps every stackable item at one stack, listed or
    // not ("all": the list alone); `surplus_slots` an integer lets that many
    // slots of junk, spares and extra stacks wait above min_free_slots and
    // starts a pass at one more (null: only below min_free_slots);
    // `done_keep_min`: a finished task's obtained goods stay this long, or
    // until the next task.
    inventory: Object.freeze({
        items: Object.freeze({
            rotten_flesh: 0, spider_eye: 0, gravel: 0, leaf_litter: 0, cobbled_deepslate: 0, andesite: 0,
            diorite: 0, granite: 0, tuff: 0, netherrack: 0, wheat_seeds: 0,
            bow: 1, crossbow: 1,
            dirt: 'stack', cobblestone: 'stack', bone: 'stack', string: 'stack', phantom_membrane: 'stack',
            arrow: 'stack', flint: 'stack', coal: 'stack', ominous_bottle: 'slot',
            ...Object.fromEntries(COLORS.map(color => [`${color}_banner`, 'slot'])),
            gunpowder: 'all',
        }),
        idle: true,
        gear: 'all',
        cap: 'all',
        surplus_slots: null,
        done_keep_min: 30,
    }),
    // Model outages (REQ-RES-17/18). The prompter reads these itself: it is
    // built before Work (OQ-21).
    model_timeout_s: 600,       // OpenAI client timeout (the SDK's; one decision took 551 s)
    model_max_retries: 2,       // OpenAI client retries of every call but decisions (promptConvo retries them) and summaries (the next line does)
    model_outage_wait_s: 600,   // how long promptConvo waits through an outage
    model_outage_probe_s: 60,   // recovery probe interval of an outage-paused goal
    // Fix wave 2 (build2 r2 rulings): a memory summary's own deadline, with no
    // SDK retry (the next line retries it); a decision waits behind an overdue
    // summary at most this long. Summaries took a median 19 s; 141 to 817 s
    // only while the engine was slow overall.
    summary_timeout_s: 120,
    // Request body params per request kind (I1-2, DECISIONS 2026-11-14), sent
    // over the model's params by the openai_tools provider, each replacing the
    // param it names; a profile value replaces the whole map. Kinds: decision,
    // summary, coding, bot_responder, probe. The default turns a memory
    // summary's reasoning off with the Qwen chat-template switch (llama.cpp
    // and vLLM read chat_template_kwargs) and, in case the backend ignores it,
    // caps it with the profile's own budget key (fix wave 1): every logged
    // summary reasoned more than 128 tokens (p10 about 200, median about 380;
    // the one at about 2,048 matches the profile's budget being enforced), and
    // a positive value avoids 0's "unlimited" reading. Decisions keep the
    // model's params.
    request_params: Object.freeze({
        summary: Object.freeze({
            chat_template_kwargs: Object.freeze({ enable_thinking: false }),
            reasoning_budget_tokens: 128,
        }),
    }),
    // Clearing an area (REQ-CLR-2, 3, 5).
    clear: Object.freeze({
        max_cells: 32768,       // largest box (32 x 32 x 32; the owner wants no tight limit)
        max_distance: 64,       // farthest box, from the frozen anchor to its nearest cell
        marker_radius: 32,      // the complete marker search around the anchor
        // Every block of the 26.1 registry that holds items (their contents
        // drop, or are lost, when it is broken): kept unless the owner's
        // explicit answer grants them (owner ruling 2026-11-11).
        containers: Object.freeze(['chest', 'trapped_chest',
            ...['', 'exposed_', 'weathered_', 'oxidized_'].flatMap(age => [`${age}copper_chest`, `waxed_${age}copper_chest`]),
            'barrel', 'shulker_box',
            ...COLORS.map(color => `${color}_shulker_box`),
            'hopper', 'dispenser', 'dropper', 'furnace', 'blast_furnace', 'smoker', 'brewing_stand', 'crafter',
            'lectern', 'chiseled_bookshelf',
            ...['oak', 'spruce', 'birch', 'jungle', 'acacia', 'dark_oak', 'mangrove', 'cherry', 'pale_oak', 'bamboo',
                'crimson', 'warped'].map(wood => `${wood}_shelf`),
            'decorated_pot', 'jukebox', 'campfire', 'soul_campfire', 'suspicious_sand', 'suspicious_gravel']),
        never_remove: Object.freeze(['spawner']), // a clear always keeps these
    }),
    ledger_max: 2000,           // cap on live scaffold entries per world (REQ-OWN-5)
    // Tidying the bot's own scaffold (REQ-OWN-8). Its line is chat category
    // `detail` (REQ-CHAT-1); work.tidy.announce is retired.
    tidy: Object.freeze({
        enabled: true,          // the automatic sweeps after a mode and at task end; !tidy always works
    }),
    // What the bot says in chat (REQ-CHAT-1): 'quiet' (only what matters to
    // the owner) or 'debug' (today's full output). Read through
    // agent.prompter.work_config by work/chat.js, so it exists before Work.
    chat: 'quiet',
    // Sleeping through the night (REQ-SLP-1): 'always' (also mid-task,
    // mid-goal and while following), 'idle' (only with nothing to do) or
    // 'off'. The bed pickup runs whatever this says. `max_mode_cuts`: the
    // protective-mode cuts (fights) a night allows before it is done; they do
    // not count toward the 3 failed tries (REQ-SLP-7).
    sleep: Object.freeze({
        when: 'always',
        max_mode_cuts: 6,
    }),
    // The owner's blocks on request (REQ-SAFE-12, 13; DECISIONS 2026-11-13).
    // `placed_radius`: the complete search around where a collect started,
    // for the protected count of !collectBlocks and the candidates of
    // !collectPlaced (8: the whole cube, about 4.9 k block lookups; 64 would cost about 2.1 M).
    // `question_s`: how long the mining question waits for his yes or no.
    collect: Object.freeze({
        placed_radius: 8,
        question_s: 120,
    }),
    // Combat (REQ-CMB-1 … 9; DECISIONS 2026-11-13). `ranged`: the mobs fought
    // once they aggro, within `ranged_radius` of her and along a path with at
    // most `path_digs` digs (none in public: no early engagement); a target
    // whose health has not dropped for `give_up_s` is given up; every fight
    // stays within `leash` of where the first fight began (the owner: "an
    // area [...] by default", 16) and walks back; `travel_speed` (blocks/s, 0
    // off): while she follows a player moving this fast she passes the mobs.
    combat: Object.freeze({
        ranged: Object.freeze([]),
        ranged_radius: 16,
        path_digs: 3,
        give_up_s: 15,
        leash: 16,
        travel_speed: 0,
    }),
    // Travel (REQ-TRV-1, 2; DECISIONS 2026-11-13 (evening), 2026-11-14).
    // `resume_max`: how often the code restarts one walk command
    // (!goToCoordinates, !goToPlayer, !searchForBlock, !goToRememberedPlace)
    // that a fight, unstuck, self_preservation, sleep or the bed pickup cut,
    // before it stops and tells the owner; 0 turns the restart off (the model
    // gets the interruption, as upstream). After self_preservation the
    // restart waits until it is safe (REQ-TRV-2): her health above
    // `safe_health` (of 20) and no hostile within `safe_radius` blocks for
    // `safe_quiet_s` seconds; not safe within `safe_wait_s` seconds, she
    // stops and tells the owner.
    travel: Object.freeze({
        resume_max: 20,
        safe_health: 10,
        safe_radius: 16,
        safe_quiet_s: 5,
        safe_wait_s: 60,
    }),
});

// Object defaults merged one level deep (SPEC §14): a profile that sets one
// sub-key keeps the other defaults.
const MERGED = new Set(['clear', 'tidy', 'sleep', 'collect', 'combat', 'travel']);
// Sub-keys checked before the merge; a bad value keeps the default (logged).
const positive = value => Number.isSafeInteger(value) && value > 0;
const count = value => Number.isSafeInteger(value) && value >= 0;
const SUB_CHECKS = Object.freeze({
    collect: Object.freeze({ placed_radius: positive, question_s: positive }),
    travel: Object.freeze({ resume_max: count, safe_health: count, safe_radius: positive, safe_quiet_s: count, safe_wait_s: positive }),
});
// Top-level keys checked the same way (fix wave 2).
const TOP_CHECKS = Object.freeze({ summary_timeout_s: positive });

// An item's keep value: 0 or another non-negative safe integer, "stack", "slot" or "all".
export const validKeep = value => value === 'stack' || value === 'slot' || value === 'all' || (Number.isSafeInteger(value) && value >= 0);
// work.inventory's keys besides `items`, each with its check (the gear slice
// adds all but `idle`: design gear/recommended-design.md r5 §6).
const INVENTORY_KEYS = Object.freeze({
    idle: value => typeof value === 'boolean',
    gear: value => value === 'all' || value === 'best',
    cap: value => value === 'all' || value === 'stack',
    surplus_slots: value => value === null || count(value),
    done_keep_min: count,
});

// REQ-OBT-11 (design r7 §2): work.inventory merged by item name over the
// defaults, into fresh maps (the defaults are never mutated). The supplied
// structure and every entry are checked before the merge; any error is kept
// as `error` and turns automatic removal off (it never widens it). Item names
// are checked against the registry in Work.init (no bot exists here).
function mergeInventory(value) {
    // A map with no prototype: a "__proto__" entry stays an entry (and fails
    // the registry check) instead of vanishing in the merge (R1-6).
    const { items: defaultItems, ...defaults } = WORK_DEFAULTS.inventory;
    const inventory = { items: Object.assign(Object.create(null), defaultItems), ...defaults, error: null };
    if (value === undefined) return inventory;
    const fail = why => {
        console.log(`[work] work.inventory has an error (${why}); automatic removal is off`);
        inventory.error ??= why;
    };
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        fail('inventory is not an object');
        return inventory;
    }
    for (const [sub, subValue] of Object.entries(value)) {
        if (sub === 'items') {
            if (!subValue || typeof subValue !== 'object' || Array.isArray(subValue)) { fail('items is not an object'); continue; }
            const bad = Object.entries(subValue).find(([, keep]) => !validKeep(keep));
            if (bad) fail(`${bad[0]}: ${JSON.stringify(bad[1])}`);
            else Object.assign(inventory.items, subValue);
        } else if (Object.hasOwn(INVENTORY_KEYS, sub)) {
            if (INVENTORY_KEYS[sub](subValue)) inventory[sub] = subValue;
            else fail(`${sub}: ${JSON.stringify(subValue)}`);
        } else console.log(`[work] ignoring unknown work setting: inventory.${sub}`);
    }
    return inventory;
}

// A profile value replaces the default whole, except the MERGED objects and
// work.inventory (merged by item name). Unknown keys are ignored (logged), so
// a key of a later iteration does nothing until its code exists.
export function loadWorkConfig(profileWork = {}) {
    const config = { ...WORK_DEFAULTS, inventory: mergeInventory(profileWork?.inventory) };
    for (const [key, value] of Object.entries(profileWork || {})) {
        if (!(key in WORK_DEFAULTS)) console.log(`[work] ignoring unknown work setting: ${key}`);
        else if (key === 'inventory') continue;
        else if (TOP_CHECKS[key] && !TOP_CHECKS[key](value))
            console.log(`[work] ignoring work setting ${key}: ${JSON.stringify(value)} is not valid`);
        else if (!MERGED.has(key)) config[key] = value;
        else if (!value || typeof value !== 'object' || Array.isArray(value)) console.log(`[work] ignoring work setting ${key}: not an object`);
        else {
            config[key] = { ...WORK_DEFAULTS[key] };
            for (const [sub, subValue] of Object.entries(value)) {
                if (!(sub in WORK_DEFAULTS[key])) console.log(`[work] ignoring unknown work setting: ${key}.${sub}`);
                else if (SUB_CHECKS[key]?.[sub] && !SUB_CHECKS[key][sub](subValue))
                    console.log(`[work] ignoring work setting ${key}.${sub}: ${JSON.stringify(subValue)} is not valid`);
                else config[key][sub] = subValue;
            }
        }
    }
    return config;
}
