/**
 * Wiki Session Hooks
 *
 * SessionStart: load wiki context, inject relevant pages, lazy index rebuild,
 *   feed project-memory into wiki environment.md
 * SessionEnd: no-op
 * PreCompact: inject wiki summary for compaction survival
 */
/**
 * SessionStart hook: inject wiki context into session.
 *
 * 1. Read wiki index, rebuild if stale
 * 2. Feed project-memory into environment.md if newer
 * 3. Return context summary for injection
 */
export declare function onSessionStart(data: {
    cwd?: string;
}): {
    additionalContext?: string;
};
/** SessionEnd hook: no-op (auto-capture removed). */
export declare function onSessionEnd(_data: {
    cwd?: string;
    session_id?: string;
}): {
    continue: boolean;
};
/**
 * PreCompact hook: inject wiki summary for compaction survival.
 */
export declare function onPreCompact(data: {
    cwd?: string;
}): {
    additionalContext?: string;
};
//# sourceMappingURL=session-hooks.d.ts.map