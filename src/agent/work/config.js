// Defaults for the work.* settings of the built iterations (SPEC §14, REQ-CFG-1).
// The owner overrides them in the bot profile's `work` object. Only keys that
// built code reads live here; a deferred mechanism's keys arrive with it (the
// shelter, fit and build keys arrive with S3).
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
});

// A profile value replaces the default whole (junk_keep included). Unknown keys
// are ignored (logged), so a key of a later iteration does nothing until its
// code exists.
export function loadWorkConfig(profileWork = {}) {
    const config = { ...WORK_DEFAULTS };
    for (const [key, value] of Object.entries(profileWork || {})) {
        if (key in WORK_DEFAULTS) config[key] = value;
        else console.log(`[work] ignoring unknown work setting: ${key}`);
    }
    return config;
}
