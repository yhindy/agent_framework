# Claude Session Info - Implementation Plan

## Overview
Make Claude session information available in the GUI with live updates showing session ID, actual model being used, token usage, and state (working/waiting). Replace fragile pattern-based detection with robust JSONL-based state detection.

## Completed Milestones

### ✅ Milestone 1: Core Service + Session Info Display
**Goal:** Parse Claude's JSONL files and display basic session info in the UI

**Completed:**
- `ClaudeSessionInfoService` - Parses session JSONL files from `~/.claude/projects/<hash>/`
- Session info extraction: session ID, actual model name, token usage, state detection
- IPC handler `claude:getSessionInfo` for frontend communication
- `SessionInfoPanel` React component showing truncated session ID, model, and state badge
- Fixed base agent (`isBaseBranchAgent`) persistence through AgentService
- Fixed `.minions-base-info` file handling in AgentService.readAgentInfo/writeAgentInfo
- Fixed Claude project path hash to include leading dash and normalize underscores
- All 27 unit tests passing

**Current Status:** ✅ WORKING - Session info displays correctly with model and state

---

### ✅ Milestone 2: Live Updates + State Detection
**Goal:** Detect model changes mid-session and update state in real-time

**Completed:**
- ✅ 2-second polling interval added to SessionInfoPanel
- ✅ Model change history tracked with timestamps
- ✅ **Fixed state detection:** Now uses LAST entry only (not all entries)
  - `stop_reason: "end_turn"` → waiting for user input
  - `tool_use` with `stop_reason: null` → working (awaiting tool results)
  - user message → working (Claude is processing)
- ✅ Token usage and cost estimates update in real-time
- ✅ Efficient diff-based state updates (no unnecessary re-renders)

**Current Status:** ✅ WORKING - State transitions correctly, model changes tracked

**Known Limitations:**
- Model changes via `/model` command update on next "keep going" (not immediately)
- File watcher not yet implemented (polling works well enough for now)

---

## Future Milestones

### 📋 Milestone 3: Robust Session Resume
**Goal:** Resume Claude sessions between app refreshes using JSONL state

**Tasks:**
- [ ] Detect partial sessions (waiting for user input) on app startup
- [ ] Auto-resume with `claude --resume <session-id>`
- [ ] Restore IdleDetector state from `.agent-info`
- [ ] Handle session not found errors gracefully
- [ ] Test resume across multiple refreshes

---

### 📋 Milestone 4: Expanded Session Info Panel
**Goal:** Show detailed session analytics

**Tasks:**
- [ ] Model change history with timestamps
- [ ] Total cost estimation (based on token usage)
- [ ] Time elapsed in session
- [ ] Input/output token counts with visualization
- [ ] Last activity timestamp
- [ ] Expandable details view

---

### 📋 Milestone 5: Notifications + IdleDetector Refactor
**Goal:** Replace fragile regex pattern matching with robust JSONL-based detection

**Tasks:**
- [ ] Replace IdleDetector regex patterns with JSONL state detection
- [ ] Detect "waiting for input" from last message's `stop_reason: 'end_turn'`
- [ ] Detect "working" from presence of `tool_use` or recent user message
- [ ] Emit notifications when state changes (snackbar in bottom right)
- [ ] Handle model changes that affect detection patterns
- [ ] Remove dependency on brittle terminal output patterns

**Benefit:** More reliable, survives Claude CLI updates, works with any output format

---

## Key Files

| File | Purpose |
|------|---------|
| `src/main/services/ClaudeSessionInfoService.ts` | Core service for parsing Claude JSONL files |
| `src/main/services/__tests__/ClaudeSessionInfoService.test.ts` | 27 unit tests |
| `src/main/services/types/ProjectConfig.ts` | AgentInfo types with session fields |
| `src/main/index.ts` | IPC handler `claude:getSessionInfo` |
| `src/renderer/src/components/SessionInfoPanel.tsx` | Frontend UI component |
| `src/renderer/src/components/SessionInfoPanel.css` | Styling |

## Data Flow

```
Claude (creates JSONL at ~/.claude/projects/-Users-.../session-id.jsonl)
  ↓
ClaudeSessionInfoService.parseSessionInfo(sessionId, worktreePath)
  ↓
IPC Handler: claude:getSessionInfo
  ↓
SessionInfoPanel Component (fetches on mount)
  ↓
UI: Shows model, session ID, state badge
```

## Testing Checklist

### Milestone 1 (Current)
- [x] Parse valid JSONL file with model and token usage
- [x] Detect "waiting" state (stop_reason: 'end_turn')
- [x] Detect "working" state (tool_use or user message)
- [x] Handle missing session files gracefully
- [x] UI displays session info when available

### Milestone 2 (Next)
- [ ] Change model mid-session, verify UI updates within 2-3 seconds
- [ ] Model change history tracked and displayed
- [ ] State transitions detected (working → waiting)
- [ ] No console spam from polling

### Milestone 3+
- [ ] Resume works across app restarts
- [ ] Cost/token display accurate
- [ ] Notifications not intrusive

---

## Known Limitations

1. **Session files created lazily:** JSONL file only appears after Claude processes the first message
2. **Underscore normalization:** Worktree path underscores are converted to dashes by Claude
3. **Initial state:** First fetch returns "unknown" until Claude outputs something
