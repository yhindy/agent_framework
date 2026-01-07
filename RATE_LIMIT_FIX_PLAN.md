# Plan: Fix GitHub API Rate Limiting in PR Refresh Feature

## Problem Statement

The auto-polling PR status feature (PR #33) is causing GitHub API rate limiting. The current implementation polls PR status every 30 seconds for all assignments with status `pr_open`, which can quickly exhaust GitHub's rate limits (60 requests/hour for unauthenticated, 5000/hour for authenticated CLI).

**Current Polling Behavior:**
- Interval: 30 seconds per PR
- Endpoints: Single endpoint per poll (`gh pr view <PR_NUMBER> --json state,mergedAt`)
- Deduplication: Exists (multiple components = 1 API call)
- No adaptive behavior based on PR age or recent activity
- 5-minute backoff when rate limited is insufficient for user experience

## Root Cause Analysis

1. **Aggressive polling interval** (30 seconds) assumes active user monitoring
2. **No contextual intelligence** - polls recently-opened PRs at same rate as stale ones
3. **No exponential backoff** - switches abruptly from 30s to 5-minute pause
4. **No batch operations** - polls each PR individually instead of combining requests
5. **No local caching strategy** - always calls GitHub API even if PR status unlikely to change

## Solution Overview

Implement a **multi-tiered approach** that intelligently reduces API load while maintaining good user experience:

### Tier 1: Reduce Base Polling Frequency
- Increase default polling interval from 30 seconds to 60-90 seconds
- Rationale: Most PR status changes take minutes, not seconds

### Tier 2: Implement Intelligent Backoff Strategy
- **New PRs** (< 5 minutes): Poll every 30 seconds
- **Recent PRs** (5-60 minutes): Poll every 90 seconds
- **Stale PRs** (> 60 minutes): Poll every 5 minutes
- Rationale: Most activity happens shortly after PR creation

### Tier 3: Add Exponential Backoff on Errors
- Error 1: Retry in 30 seconds
- Error 2: Retry in 2 minutes
- Error 3+: Stop polling, back off for 10 minutes (not 5)
- Rationale: Graceful degradation that doesn't spam during issues

### Tier 4: Implement Manual Refresh with Higher Priority
- Add user-initiated "Refresh Now" button
- Manual refreshes bypass backoff and retry immediately
- Prioritize manual requests over automatic polling
- Rationale: Gives users control when they need immediate feedback

### Tier 5: Add Request Batching (Future Enhancement)
- Combine multiple PR checks into single GitHub API call using GraphQL
- Could reduce 10 PR polls from 10 requests to 1 request
- Requires investigation of `gh` CLI GraphQL support
- Lower priority but high impact if implementable

### Tier 6: Local Caching Strategy
- Cache last known PR state for 5 minutes minimum
- Skip API call if cache is fresh and user hasn't triggered refresh
- Clear cache on manual refresh
- Rationale: Reduces unnecessary calls for unchanged PRs

## Implementation Details

### Phase 1: Core Polling Intelligence (Priority: HIGH)

**Files to Modify:**
- `gui/src/main/services/PRPollingService.ts`

**Changes:**
1. Add `createdAt` field to polling job tracking
2. Implement `calculatePollingInterval()` function:
   ```
   - Input: PR creation timestamp, last update timestamp
   - Output: polling interval in milliseconds
   - Logic: 30s for new PRs, scale up based on age
   ```
3. Modify `executePollingCheck()` to use dynamic interval
4. Update error handling with exponential backoff
5. Add method to detect manual refresh requests

**Pseudo-code:**
```typescript
private calculatePollingInterval(prCreatedAt: number, lastUpdatedAt: number): number {
  const ageMinutes = (Date.now() - prCreatedAt) / 60000

  if (ageMinutes < 5) return 30 * 1000      // New PRs: 30s
  if (ageMinutes < 60) return 90 * 1000     // Recent: 90s
  return 5 * 60 * 1000                      // Stale: 5m
}

private calculateBackoffMs(errorCount: number): number {
  if (errorCount === 1) return 30 * 1000
  if (errorCount === 2) return 2 * 60 * 1000
  return 10 * 60 * 1000
}
```

### Phase 2: Manual Refresh with Higher Priority (Priority: HIGH)

**Files to Modify:**
- `gui/src/main/services/PRPollingService.ts`
- `gui/src/renderer/src/components/Dashboard.tsx` or relevant agent display component

**Changes:**
1. Add `isManualRefresh` flag to polling job
2. Expose `refreshPRNow(assignmentId)` method
3. Manual refresh clears error count and uses immediate interval
4. Modify UI component to add refresh button

### Phase 3: Local Caching (Priority: MEDIUM)

**Files to Modify:**
- `gui/src/main/services/PRPollingService.ts`
- `gui/src/main/services/AgentService.ts`

**Changes:**
1. Add `prStatusCache: Map<string, {status, timestamp, updatedAt}>`
2. Check cache before making API call
3. Return cached value if < 5 minutes old (unless manual refresh)
4. Clear cache entry on error or manual refresh

### Phase 4: Request Batching with GraphQL (Priority: LOW)

**Investigation Tasks:**
1. Check if `gh` CLI supports GraphQL queries
2. Prototype multi-PR status query:
   ```graphql
   query {
     repository(owner: "...", name: "...") {
       pr1: pullRequest(number: 123) { state mergedAt }
       pr2: pullRequest(number: 456) { state mergedAt }
     }
   }
   ```
3. Measure performance improvement
4. Determine implementation effort

## Implementation Steps

1. **Read and understand PRPollingService.ts thoroughly**
   - Map current data structures
   - Identify all polling interval references
   - Document error handling flow

2. **Add PR age tracking**
   - Capture `createdAt` in polling job initialization
   - Requires extracting creation timestamp (may need API call or cache)

3. **Implement intelligent interval calculation**
   - Add `calculatePollingInterval()` method
   - Add `calculateBackoffMs()` method for exponential backoff
   - Unit test both methods with various scenarios

4. **Update executePollingCheck() logic**
   - Calculate dynamic interval based on PR age
   - Use exponential backoff on errors
   - Implement cache checking before API calls

5. **Add manual refresh mechanism**
   - Expose `refreshPRNow(assignmentId)` IPC handler
   - Update UI component with refresh button
   - Ensure manual refresh bypasses backoff

6. **Test with GitHub rate limiting simulation**
   - Mock API to trigger rate limit scenarios
   - Verify backoff behavior
   - Verify manual refresh still works during backoff

7. **Monitor real-world behavior**
   - Add telemetry for polling intervals used
   - Track rate limit hits before/after
   - Gather user feedback on response time

## Automated Testing Strategy

### Unit Tests

**File: `gui/src/main/services/__tests__/PRPollingService.test.ts`**

1. **Dynamic Interval Calculation Tests**
   ```typescript
   describe('calculatePollingInterval', () => {
     test('returns 30s for PR created < 5 minutes ago')
     test('returns 90s for PR created 5-60 minutes ago')
     test('returns 5m for PR created > 60 minutes ago')
     test('handles edge cases at interval boundaries')
   })
   ```

2. **Exponential Backoff Tests**
   ```typescript
   describe('calculateBackoffMs', () => {
     test('returns 30s on first error')
     test('returns 2m on second error')
     test('returns 10m on third+ errors')
   })
   ```

3. **Cache Hit/Miss Tests**
   ```typescript
   describe('PR status caching', () => {
     test('returns cached status if < 5 minutes old')
     test('calls API if cache is stale')
     test('clears cache on error')
     test('clears cache on manual refresh')
   })
   ```

4. **Manual Refresh Priority Tests**
   ```typescript
   describe('manual refresh behavior', () => {
     test('manual refresh works during rate limit backoff')
     test('manual refresh clears error count')
     test('manual refresh bypasses cache')
     test('manual refresh resets polling interval')
   })
   ```

5. **Interval Scheduling Tests**
   ```typescript
   describe('polling interval scheduling', () => {
     test('uses dynamic interval for next poll')
     test('reschedules interval if PR age changes tier')
     test('interval changes after PR merge/close detection')
   })
   ```

### Integration Tests

**File: `gui/src/main/services/__tests__/PRPollingService.integration.test.ts`**

1. **Rate Limit Scenario Simulation**
   - Mock GitHub API to return 429/403 errors
   - Verify service switches to exponential backoff
   - Verify manual refresh works during backoff
   - Verify service recovers after backoff period

2. **Multi-PR Polling Scenario**
   - Start polling 5 PRs simultaneously
   - Verify deduplication still works
   - Verify different intervals for different PR ages
   - Measure total API calls vs expected

3. **Long-Running Polling**
   - Simulate 24-hour polling session
   - Track interval changes as PRs age
   - Verify cleanup and stop conditions
   - Monitor memory leaks from long-running intervals

4. **State Transition Tests**
   - PR status changes from OPEN → MERGED
   - PR auto-stops polling on merge
   - Restarting polling after merge resumes correctly
   - Error recovery after transient failures

### E2E Tests (Optional but Recommended)

**File: `gui/src/renderer/src/__tests__/PRPolling.e2e.test.ts`**

1. **UI Refresh Button**
   - User clicks refresh button
   - API is called immediately
   - Result updates UI within 1 second
   - Button shows loading state during API call

2. **Real GitHub Integration** (requires test PR)
   - Create test PR
   - Verify polling detects merge when PR is actually merged
   - Verify polling stops after merge
   - Verify rate limiting doesn't occur during 1-hour test

3. **Multiple Window Scenario**
   - Open multiple app windows
   - Create same PR assignment in both
   - Verify deduplication still works across windows
   - Verify polling continues if one window closes

### Load Testing

**File: `gui/src/main/services/__tests__/PRPollingService.load.test.ts`**

1. **High PR Count Scenario**
   - Simulate 100 open PRs
   - Calculate total API calls per hour
   - Verify stays well below GitHub rate limit (5000/hr authenticated)
   - Measure memory and CPU impact

2. **Rapid Polling Interval**
   - Force all PRs into "new PR" category (30s interval)
   - Verify rate limit backoff kicks in
   - Measure how long until system recovers

3. **Cache Effectiveness**
   - Measure cache hit rate with 100 PRs over 1 hour
   - Calculate API call reduction percentage
   - Compare memory cost of caching vs API call savings

### Performance Tests

**Metrics to Track:**
1. **Polling Latency**: Time from interval trigger to API call completion
2. **Cache Hit Ratio**: % of polling checks served from cache
3. **Memory Usage**: Size of caching data structures
4. **Error Recovery Time**: Time to recover after rate limit backoff
5. **Total API Calls Per Hour**: Before/after comparison

## Testing Checklist

- [ ] Unit tests for interval calculation pass
- [ ] Unit tests for exponential backoff pass
- [ ] Unit tests for caching logic pass
- [ ] Unit tests for manual refresh pass
- [ ] Integration tests for rate limit scenarios pass
- [ ] Integration tests for multi-PR polling pass
- [ ] E2E test for UI refresh button passes
- [ ] Load test with 100 PRs completes without rate limiting
- [ ] Load test shows cache effectiveness (>50% hit ratio expected)
- [ ] Memory profiling shows no leaks during 24-hour sim
- [ ] Real GitHub integration test passes
- [ ] Manual testing: PR merge detection works reliably
- [ ] Manual testing: Manual refresh works during backoff
- [ ] Manual testing: No regression in existing functionality

## Success Criteria

1. **Eliminates Rate Limiting**: 0 rate limit errors in normal usage (< 50 open PRs)
2. **Maintains Responsiveness**: Manual refresh returns in < 2 seconds
3. **Improves UX**: Automatic polling detects PR changes within 2-5 minutes (acceptable lag)
4. **Reduces API Load**: >70% reduction in API calls vs current implementation
5. **Maintains Reliability**: 99.9% polling success rate (only fails on network/auth issues)
6. **No Performance Regression**: UI responsiveness unaffected, memory stable

## Risk Assessment

### High Risk
- **Stale Status Display**: User sees old PR status
  - Mitigation: Show timestamp of last check, limit cache to 5 minutes max

### Medium Risk
- **Manual Refresh During Error**: User clicks refresh but backoff prevents call
  - Mitigation: Bypass backoff on manual refresh

### Low Risk
- **Missed PR Merge Notification**: Polling stops before PR merge completes
  - Mitigation: Stop polling only on confirmed MERGED status, not CLOSED

## Timeline Estimate (Without time commitments)

1. Understand current implementation
2. Implement dynamic interval calculation
3. Add unit tests for intervals and backoff
4. Implement caching layer
5. Add caching unit tests
6. Implement manual refresh UI
7. Add integration tests for rate limiting scenario
8. Add load testing
9. Real GitHub integration testing
10. Performance profiling and optimization
11. Documentation and code review
12. Monitoring and rollout

## Files to Modify (Summary)

```
Core Implementation:
- gui/src/main/services/PRPollingService.ts (primary changes)
- gui/src/main/index.ts (add manual refresh IPC handler)
- gui/src/preload/index.ts (expose manual refresh to renderer)

UI Integration:
- gui/src/renderer/src/components/Dashboard.tsx (or relevant minion view component)

Testing:
- gui/src/main/services/__tests__/PRPollingService.test.ts (expand existing tests)
- gui/src/main/services/__tests__/PRPollingService.integration.test.ts (new)
- gui/src/main/services/__tests__/PRPollingService.load.test.ts (new)
- gui/src/renderer/src/__tests__/PRPolling.e2e.test.ts (new)

Documentation:
- README or docs (rate limiting behavior)
```

## Rollout Strategy

1. **Feature Flag**: Add config option to enable/disable new behavior
2. **Gradual Rollout**: Test with internal beta first
3. **Monitoring**: Add logging for API call counts, rate limit hits
4. **Feedback Loop**: Gather user feedback on responsiveness
5. **Optimization**: Fine-tune intervals based on real-world data

## Open Questions

1. How are PR creation timestamps currently tracked? Do we have `createdAt`?
2. Is GitHub CLI authenticated? (Affects rate limit: 60/hr vs 5000/hr)
3. Are there multiple GitHub accounts/orgs? (Separate rate limit buckets)
4. What's the target max number of concurrent open PRs per user?
5. Should we implement GraphQL batching for future scalability?

## Future Enhancements

- Adaptive interval based on recent merge activity
- Webhook integration if GitHub app integration is viable
- Priority queue for high-value PRs (e.g., blocking deploys)
- Team-wide polling cache to reduce redundant checks
- WebSocket updates to replace polling entirely (if infrastructure permits)
