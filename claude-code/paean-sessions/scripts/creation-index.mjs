// Generated from zero-api src/modules/session-assets/creation.ts (SHA-256 cb79cb4bee4bc44d836b58883017f1da9a3ada9e275bdae262e9576efc55ff2f).
// Standalone Node adapter; no database, network, credentials or script execution.
import { createHash } from "crypto";
class SessionError extends Error {
    constructor(status, message) {
        super(message);
        this.status = status;
    }
}
// Protocol limits shared by API capabilities and the standalone skill parser.
export const creationLimits = { maxBytes: 256 * 1024 * 1024, maxStreams: 100, maxScripts: 500, maxRecords: 50000, maxRecordBytes: 8 * 1024 * 1024 };
export const CREATION_FORMAT = "paean_creation_bundle";
const object = (v) => v && typeof v === "object" && !Array.isArray(v);
const identifier = (v) => typeof v === "string" && /^[A-Za-z0-9_.:-]{1,200}$/.test(v);
const fail = (message) => { throw new SessionError(422, message); };
const hash = (text) => createHash("sha256").update(text).digest("hex");
export const safeScriptPath = (v) => typeof v === "string" && v.length <= 500 &&
    !/[\\:\x00-\x1f\x7f]/.test(v) && v.split("/").every(p => p && p !== "." && p !== "..");
/** These are uploaded observations, never executable instructions or proof of provenance. */
export function creationRecords(records) {
    if (records[0]?.type !== CREATION_FORMAT) {
        if (records.some(r => [CREATION_FORMAT, "creation_event", "creation_script"].includes(r.type)))
            fail("Creation records require a versioned bundle header");
        return { format: "legacy-jsonl", streams: [{ id: "main" }],
            events: records.map((event, i) => ({ streamId: "main", record: i + 1, event })), scripts: [] };
    }
    const header = records[0];
    if (header.version !== 1 || !Array.isArray(header.streams) || !header.streams.length || header.streams.length > creationLimits.maxStreams)
        fail("Invalid creation bundle version or streams");
    const streams = new Map();
    for (const stream of header.streams) {
        if (!object(stream) || !identifier(stream.id) || streams.has(stream.id))
            fail("Invalid or duplicate stream ID");
        if (stream.parentStreamId !== undefined && !identifier(stream.parentStreamId))
            fail("Invalid parent stream ID");
        if (stream.parentCallId !== undefined && (!identifier(stream.parentCallId) || !stream.parentStreamId))
            fail("Parent call requires a parent stream");
        streams.set(stream.id, stream);
    }
    for (const stream of streams.values()) {
        const seen = new Set([stream.id]);
        let parent = stream.parentStreamId;
        while (parent !== undefined) {
            if (!streams.has(parent) || seen.has(parent))
                fail("Missing or cyclic parent stream");
            seen.add(parent);
            parent = streams.get(parent).parentStreamId;
        }
    }
    const events = [], scripts = [];
    const scriptIDs = new Set();
    for (let i = 1; i < records.length; i++) {
        const r = records[i];
        if (r.type === "creation_event") {
            if (!streams.has(r.streamId) || !object(r.event))
                fail("Invalid creation event or stream");
            events.push({ streamId: r.streamId, record: i + 1, event: r.event });
        }
        else if (r.type === "creation_script") {
            if (!identifier(r.scriptId) || scriptIDs.has(r.scriptId) || !safeScriptPath(r.path) || typeof r.content !== "string" || r.content.includes("\0"))
                fail("Invalid script ID, relative path or UTF-8 text content");
            if (r.streamId !== undefined && !streams.has(r.streamId))
                fail("Invalid script stream");
            if (r.callId !== undefined && (!identifier(r.callId) || !r.streamId))
                fail("Script call requires a stream");
            scriptIDs.add(r.scriptId);
            scripts.push({ ...r, record: i + 1, digest: hash(r.content), bytes: Buffer.byteLength(r.content) });
            if (scripts.length > creationLimits.maxScripts)
                fail("Too many script snapshots");
        }
        else
            fail(`Unknown creation record at ${i + 1}`);
    }
    if (!events.length)
        fail("Creation bundle requires session events");
    return { format: "creation-bundle-v1", streams: [...streams.values()], events, scripts };
}
export function inspectCreation(records) {
    const data = creationRecords(records);
    const tools = new Map();
    const issues = [];
    let recognizedEvents = 0;
    const key = (stream, call) => JSON.stringify([stream, call]);
    for (const entry of data.events) {
        const e = entry.event;
        // Codex response_item; Claude Code / Zero message content; explicit tool events.
        const payload = e.type === "response_item" && object(e.payload) ? e.payload : e;
        const blocks = Array.isArray(e.message?.content) ? e.message.content : Array.isArray(e.content) ? e.content : [payload];
        let recognized = false;
        for (const b of blocks) {
            if (!object(b))
                continue;
            const call = ["function_call", "custom_tool_call", "tool_use", "tool_call"].includes(b.type);
            const result = ["function_call_output", "custom_tool_call_output", "tool_result"].includes(b.type);
            if (!call && !result)
                continue;
            recognized = true;
            const id = b.call_id ?? b.tool_use_id ?? b.toolUseID ?? (call ? b.id : undefined) ?? b.toolCallId;
            if (!identifier(id)) {
                issues.push({ code: "missing_call_id", streamId: entry.streamId, record: entry.record });
                continue;
            }
            const k = key(entry.streamId, id);
            const tool = tools.get(k) || { streamId: entry.streamId, callId: id, calls: [], results: [] };
            const observation = { record: entry.record, value: call ? (b.arguments ?? b.input ?? b.inputJSON ?? null) : (b.output ?? b.content ?? b.result ?? b.subBlocks ?? b.text ?? null) };
            if (typeof e.timestamp === "string")
                observation.timestamp = e.timestamp;
            if (call) {
                if (typeof (b.name ?? b.toolName) === "string")
                    tool.name = b.name ?? b.toolName;
                const parent = b.parent_call_id ?? e.parent_tool_use_id;
                if (identifier(parent)) {
                    tool.parentCallId = parent;
                    const stream = data.streams.find(s => s.id === entry.streamId);
                    tool.parentStreamId = stream?.parentCallId === parent ? stream.parentStreamId : entry.streamId;
                }
                tool.calls.push(observation);
            }
            else {
                observation.error = b.is_error === true || b.isError === true || b.error === true;
                // Explicit source flags only: never guess from arbitrary tool output text.
                observation.truncated = b.truncated === true || b.output_truncated === true;
                tool.results.push(observation);
            }
            tools.set(k, tool);
        }
        if (recognized)
            recognizedEvents++;
    }
    for (const tool of tools.values()) {
        tool.status = !tool.calls.length ? "orphan_result" : !tool.results.length ? "missing_result" : tool.results.some(r => r.error) ? "error" : "paired";
        if (["orphan_result", "missing_result"].includes(tool.status))
            issues.push({ code: tool.status, streamId: tool.streamId, callId: tool.callId });
        if (tool.calls.length > 1)
            issues.push({ code: "duplicate_call_id", streamId: tool.streamId, callId: tool.callId });
        if (tool.results.some(r => r.truncated))
            issues.push({ code: "truncated_result", streamId: tool.streamId, callId: tool.callId });
        if (tool.parentCallId && !tools.get(key(tool.parentStreamId, tool.parentCallId))?.calls.length)
            issues.push({ code: "missing_parent_call", streamId: tool.streamId, callId: tool.callId, parentCallId: tool.parentCallId });
    }
    for (const stream of data.streams) {
        if (!data.events.some(e => e.streamId === stream.id))
            issues.push({ code: "empty_stream", streamId: stream.id });
        if (stream.parentCallId && !tools.get(key(stream.parentStreamId, stream.parentCallId))?.calls.length)
            issues.push({ code: "missing_parent_call", streamId: stream.id, parentCallId: stream.parentCallId });
    }
    for (const script of data.scripts) {
        if (script.callId && !tools.get(key(script.streamId, script.callId))?.calls.length)
            issues.push({ code: "unmatched_script_call", scriptId: script.scriptId, streamId: script.streamId, callId: script.callId });
    }
    const toolList = [...tools.values()];
    const summary = { format: data.format, streams: data.streams, eventCount: data.events.length,
        scriptCount: data.scripts.length, toolCallCount: toolList.reduce((n, t) => n + t.calls.length, 0),
        toolResultCount: toolList.reduce((n, t) => n + t.results.length, 0), recognizedToolEventCount: recognizedEvents,
        issueCount: issues.length, coverage: "observed-only",
        limitations: ["Only supplied events and script snapshots are available; omitted or truncated source data cannot be reconstructed.",
            "Script snapshots do not establish which historical bytes executed. Unknown event formats remain available in raw events."] };
    return { summary, tools: toolList, scripts: data.scripts, events: data.events, issues };
}
export function validateCreationQuery(section, offset, limit) {
    if (!["summary", "tools", "scripts", "events", "issues"].includes(section) || !Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(limit) || limit < 1 || limit > 100)
        throw new SessionError(400, "Invalid creation section or pagination (limit 1–100)");
}
export function creationPage(records, section = "summary", offset = 0, limit = 50) {
    validateCreationQuery(section, offset, limit);
    const inspection = inspectCreation(records);
    if (section === "summary")
        return inspection.summary;
    const rows = inspection[section];
    return { section, total: rows.length, offset, nextOffset: offset + limit < rows.length ? offset + limit : null, items: rows.slice(offset, offset + limit) };
}
