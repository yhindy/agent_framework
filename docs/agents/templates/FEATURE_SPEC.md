# Feature: [Feature Name]

> Agent: agent-X  
> Branch: feature/agent-X/feature-name  
> Created: [Date]  
> Status: Not Started

## Overview

[1-2 sentence description of the feature]

## Requirements

### Functional Requirements

- [ ] Requirement 1
- [ ] Requirement 2
- [ ] Requirement 3

### Non-Functional Requirements

- [ ] Tests must pass
- [ ] No linter warnings
- [ ] Code formatted

## Files to Modify

### Allowlist (you MAY modify these)

```
src/feature/
src/components/feature/
tests/feature/
```

### Blocklist (you MUST NOT modify these)

```
src/core/           # Shared code - requires coordination
src/auth/           # Auth - shared code
config/             # Configuration - requires approval
```

## Dependencies

### Requires from Other Agents

- None (or list dependencies)

### Blocks Other Agents

- None (or list what this blocks)

## Technical Notes

[Any technical context, existing patterns to follow, etc.]

## Acceptance Criteria

1. [ ] Criterion 1
2. [ ] Criterion 2
3. [ ] Criterion 3

## Testing Instructions

### Unit Tests

```bash
# Run tests for this feature
npm test -- --grep "feature"
```

### Manual Testing

1. Start the application
2. Navigate to [location]
3. [Step-by-step testing instructions]

## Bootstrap Commands

```bash
# Install dependencies
npm install

# Run in development mode
npm run dev

# Run tests
npm test
```

## Questions / Blockers

[Document any questions or blockers here for the coordinator to address]

---

## Progress Log

### [Date] - Session 1
- Started work on [component]
- [Notes about progress]

### [Date] - Session 2
- [Continue logging progress]
