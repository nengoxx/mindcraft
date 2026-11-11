// Defaults for the work.* settings of the built iterations (SPEC §14, REQ-CFG-1).
// The owner overrides them in the bot profile's `work` object. Only keys that
// built code reads live here; a deferred mechanism's keys arrive with it (the
// shelter, fit and build keys arrive with S3; the model keys are read by the
// prompter and the outage module, outside src/agent/work/).
export const WORK_DEFAULTS = Object.freeze({
    return_radius: 6,       // blocks from work_pos before the runner goes back
    stall_s: 15,            // idle seconds before the self-heal timer resumes (REQ-RES-10)
    no_progress_s: 120,     // per-call no-progress deadline, crafting included (REQ-RES-5)
    step_stall_s: 600,      // wall time without metric improvement before a step blocks (REQ-RES-16)
    run_deadline_s: 300,    // run bound (REQ-RES-6)
    max_steps: 8,
    max_obtain_count: 256,
    min_free_slots: 4,      // junk drop threshold (REQ-OBT-11)
    junk_items: Object.freeze(['dirt', 'cobblestone', 'gravel', 'cobbled_deepslate', 'andesite',
        'diorite', 'granite', 'tuff', 'netherrack', 'wheat_seeds', 'rotten_flesh']),
    junk_keep: Object.freeze({ dirt: 64, cobblestone: 64 }),
    // Model outages (REQ-RES-17/18). The prompter reads these itself: it is
    // built before Work (OQ-21).
    model_timeout_s: 600,       // OpenAI client timeout (the SDK's; one decision took 551 s)
    model_max_retries: 2,       // OpenAI client retries of every call but decisions, which promptConvo retries
    model_outage_wait_s: 600,   // how long promptConvo waits through an outage
    model_outage_probe_s: 60,   // recovery probe interval of an outage-paused goal
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
            ...['white', 'orange', 'magenta', 'light_blue', 'yellow', 'lime', 'pink', 'gray', 'light_gray', 'cyan',
                'purple', 'blue', 'brown', 'green', 'red', 'black'].map(color => `${color}_shulker_box`),
            'hopper', 'dispenser', 'dropper', 'furnace', 'blast_furnace', 'smoker', 'brewing_stand', 'crafter',
            'lectern', 'chiseled_bookshelf',
            ...['oak', 'spruce', 'birch', 'jungle', 'acacia', 'dark_oak', 'mangrove', 'cherry', 'pale_oak', 'bamboo',
                'crimson', 'warped'].map(wood => `${wood}_shelf`),
            'decorated_pot', 'jukebox', 'campfire', 'soul_campfire', 'suspicious_sand', 'suspicious_gravel']),
        never_remove: Object.freeze(['spawner']), // a clear always keeps these
    }),
    ledger_max: 2000,           // cap on live scaffold entries (REQ-OWN-5)
    // Tidying the bot's own scaffold (REQ-OWN-8, 10).
    tidy: Object.freeze({
        enabled: true,          // the automatic sweeps after a mode and at task end; !tidy always works
        announce: true,         // one line after a sweep that removed or left something
    }),
});

// Object defaults merged one level deep (SPEC §14): a profile that sets one
// sub-key keeps the other defaults.
const MERGED = new Set(['clear', 'tidy']);

// A profile value replaces the default whole (junk_keep included), except the
// MERGED objects. Unknown keys are ignored (logged), so a key of a later
// iteration does nothing until its code exists.
export function loadWorkConfig(profileWork = {}) {
    const config = { ...WORK_DEFAULTS };
    for (const [key, value] of Object.entries(profileWork || {})) {
        if (!(key in WORK_DEFAULTS)) console.log(`[work] ignoring unknown work setting: ${key}`);
        else if (!MERGED.has(key)) config[key] = value;
        else if (!value || typeof value !== 'object' || Array.isArray(value)) console.log(`[work] ignoring work setting ${key}: not an object`);
        else {
            config[key] = { ...WORK_DEFAULTS[key] };
            for (const [sub, subValue] of Object.entries(value)) {
                if (sub in WORK_DEFAULTS[key]) config[key][sub] = subValue;
                else console.log(`[work] ignoring unknown work setting: ${key}.${sub}`);
            }
        }
    }
    return config;
}
