

## Plan: Remove Batch EOD Feature from UI

### Overview
Remove the batch EOD processing capability from the EOD page, keeping only single-day processing via "Process Staged Trades".

---

### What Will Be Removed

| Component | Current | After |
|-----------|---------|-------|
| Date selector | Single Day + Date Range tabs | Single Day only |
| Run Full EOD button | Present | Removed |
| Stop button | Shows during batch run | Removed |
| Progress bar | Shows batch progress | Removed |
| Batch results tracking | `dayResults`, progress state | Removed |

---

### What Will Be Kept

- **Import DSE Trades** button
- **Import CSE Trades** button  
- **Import Deposits/Withdrawals** button
- **Process Staged Trades** button (primary EOD action)
- **Auto-Create Missing** button
- **Calculate Settlements** button
- **Generate Report** button
- **Clear Selected** button
- **EOD Summary Cards** (showing `stagedResult` or `historicalData`)
- **EOD Log Table** (history of runs)
- **Alerts** (error, stale data, historical data)

---

### Files to Modify

| File | Changes |
|------|---------|
| `src/pages/EodPage.tsx` | Remove range mode, batch run logic, progress tracking, and related state |
| `src/components/eod/EodDateSelector.tsx` | Remove mode toggle, simplify to single date picker only |
| `src/components/eod/EodActionButtons.tsx` | Remove Run Full EOD, Stop button, and related props |
| `src/components/eod/EodProgressBar.tsx` | Consider deletion (no longer needed) |
| `src/components/eod/EodStatusDashboard.tsx` | Simplify or remove if only used for batch status |

---

### Technical Details

**EodPage.tsx changes:**
- Remove `mode`, `dateRange`, `setDateRange` state
- Remove `running`, `stopping`, `stopRequested` state
- Remove `progress`, `currentDateProcessing`, `processedDays`, `totalDays` state
- Remove `dayResults`, `summary` aggregation
- Remove `handleRunFullEod`, `handleStop`, `runSingleDayEod` functions
- Remove `EodProgressBar` component usage
- Simplify `hasDateSelected` to just check `selectedDate`
- Remove `completedCount`, `failedCount`, `skippedCount` calculations

**EodDateSelector.tsx changes:**
- Remove `mode`, `onModeChange` props
- Remove `dateRange`, `onRangeChange` props
- Remove Tabs component (mode toggle)
- Remove range calendar option
- Keep only single date picker with quick date buttons

**EodActionButtons.tsx changes:**
- Remove `onRunFullEod`, `onStop` props
- Remove `isRunning`, `isStopping` props
- Remove Run Full EOD button
- Remove Stop button
- Update disabled logic to only use `isProcessingStaged` and `isClearing`

---

### Expected Outcome

After implementation:
- EOD page will have a simpler, single-day focused workflow
- Users will use "Process Staged Trades" as the primary EOD action
- No batch/range processing capability in UI
- Cleaner, more maintainable code with fewer state variables

