# How to Record and Test Tool Calls

## Quick Start

```typescript
import { recorder } from "@/lib/recorder/bus";
import { runtime } from "@/lib/core/runtime";
import { ToolCallAction } from "@/lib/action/tool_call";
import { ResourceReadAction } from "@/lib/action/resource_read";

// 1. Start recording
recorder.start({ url: "http://localhost:3000" });

// 2. Start runtime
runtime.start();

// 3. Execute actions (automatically recorded)
await runtime.executeAction(new ToolCallAction("get_weather", { city: "SF" }));

await runtime.executeAction(new ResourceReadAction("widget://my-widget"));

// 4. Stop and get session
const session = recorder.stop();

// 5. Session contains all recorded actions!
console.log(session.actions); // Array of recorded actions with timing
```

## Recording Format

```typescript
interface Session {
  version: 2;
  capturedAt: string; // ISO timestamp
  studioVersion: string;
  setup: {
    url: string;
    theme?: string;
    locale?: string;
  };
  actions: RecordedAction[]; // Your recorded actions
}

interface RecordedAction {
  relMs: number; // Relative timestamp (ms)
  action: {
    id: string;
    type: "TOOL_CALL" | "RESOURCE_READ";
    data: any;
    timestamp: number;
  };
}
```

## Replay a Session

```typescript
// Load a saved session
const session = loadSessionFromFile();

// Replay each action
runtime.start();

for (const recorded of session.actions) {
  // Reconstruct the action
  if (recorded.action.type === "TOOL_CALL") {
    const action = new ToolCallAction(
      recorded.action.data.tool,
      recorded.action.data.params,
    );
    await runtime.executeAction(action);
  } else if (recorded.action.type === "RESOURCE_READ") {
    const action = new ResourceReadAction(recorded.action.data.uri);
    await runtime.executeAction(action);
  }
}

runtime.stop();
```

## Assert State After Execution

```typescript
runtime.start();

// Execute action
await runtime.executeAction(new ToolCallAction("get_weather", { city: "SF" }));

// Get state
const state = runtime.getState();

// Assert state changed
expect(state.tools["get_weather"].callCount).toBe(1);
expect(state.tools["get_weather"].calls[0].params).toEqual({ city: "SF" });
expect(state.network.requestCount).toBe(1);
```

## Export and Save Sessions

```typescript
// Record a session
recorder.start({ url: "http://localhost:3000" });
// ... execute actions ...
const session = recorder.stop();

// Save to file
const json = JSON.stringify(session, null, 2);
fs.writeFileSync("test-session.json", json);

// Load from file
const loaded = JSON.parse(fs.readFileSync("test-session.json", "utf8"));

// Replay loaded session
// ... (see replay example above)
```

## Simple Assertions

```typescript
import {
  assertActionSucceeded,
  assertStateChanged,
} from "@/lib/assertion/assert";

const action = new ToolCallAction("get_weather", { city: "SF" });

// Assert action succeeds
assertActionSucceeded(action);

// Execute and check state
const before = runtime.getState();
await runtime.executeAction(action);
const after = runtime.getState();

// Assert state changed
assertStateChanged(before, after, "tools.get_weather");
assertStateChanged(before, after, "network.requestCount");
```

## What Gets Recorded?

✅ **Recorded:**

- Tool call actions (MCP tools/call)
- Resource read actions (MCP resources/read)
- Action timing (relative timestamps)

❌ **Not Recorded (for now):**

- Widget interactions (not implemented yet)
- Studio config changes (not implemented yet)
- MCP responses (handled by MCP event bus, not recorded)

## Example: Full Test Flow

```typescript
// 1. Record a test
recorder.start({ url: "http://localhost:3000" });
runtime.start();

await runtime.executeAction(new ToolCallAction("get_weather", { city: "SF" }));
await runtime.executeAction(
  new ToolCallAction("get_temperature", { location: "NYC" }),
);

const session = recorder.stop();
runtime.stop();

// 2. Save the test
saveSessionToFile(session, "my-test.json");

// 3. Later, replay the test
const savedSession = loadSessionFromFile("my-test.json");

runtime.start();
for (const recorded of savedSession.actions) {
  // Replay each action...
}

// 4. Assert final state
const finalState = runtime.getState();
expect(finalState.tools["get_weather"].callCount).toBe(1);
expect(finalState.tools["get_temperature"].callCount).toBe(1);
```

## Notes

- Recording starts when you call `recorder.start()`
- Actions are automatically recorded when executed via `runtime.executeAction()`
- Recording stops when you call `recorder.stop()`, which returns the Session
- Sessions are JSON-serializable for easy storage
- Timing is normalized so the first action starts at t=0
