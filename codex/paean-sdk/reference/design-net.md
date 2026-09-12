# Net: online rooms and multiplayer

Use when cooperation, competition, or shared presence improves the loop. Choose turn-based, asynchronous, or real-time play from the actual latency tolerance; room availability alone does not make an action game network-ready.

- Specify room creation/join, invitations, capacity, ready/start, late join, leave, disconnect, and rematch. Map these to documented `room.join/peek/list/send/leave` and membership/error/resync events.
- Prefer `room.state` for shared state, with explicit field ownership and version/conflict handling; use messages for transient events. On resync restore a snapshot before applying later updates.
- Server-stored room state is not automatically server-validated gameplay or anti-cheat. Define who can change results and resources; never label a client-authored result authoritative merely because the server stores it.
- Keep payloads compact and update rates measured. For real-time play design interpolation, late/stale input handling, and reconnect recovery. For turns use documented version checks to avoid concurrent moves.
- Request `net.room` from the Join/Host action. Keep existing solo play available when networking is optional; if multiplayer is the core loop, provide an honest demo/practice or retry state rather than fake online peers.
- Dispose listeners on exit and avoid room updates in attract mode. Use the SDK's actual room protocol and current host feature detection.

Acceptance: two independent clients; conflicting moves; late join; disconnect/resync; host/member departure; unavailable room.state; denied scope; restart without duplicate listeners. The bundled mock's phantom peers exercise UI only: they do not prove transport, ordering, or concurrent convergence. Record any remaining real-host verification.

