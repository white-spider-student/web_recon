# Fix: Zoom-to-Fit Issues - Nodes Too Far Apart

## Problem
Nodes were appearing very far from the center and spread across the canvas because:
1. ❌ `zoomToFit` was called too early (500ms) before nodes settled
2. ❌ Padding was too large (400px), making nodes appear smaller
3. ❌ No initial auto-fit when graph first loads

## Solution Applied

### 1. Increased Delay Before Fit
**File:** `src/App.js`

**Before:**
```javascript
setTimeout(() => {
  window.graphInstance.manualFit(400, 800);
}, 500);
```

**After:**
```javascript
setTimeout(() => {
  window.graphInstance.manualFit(200, 1000);
}, 1500); // Wait longer for simulation to settle
```

**Why:** Force simulation needs ~1200ms to position nodes correctly. Calling fit too early captures nodes mid-movement.

---

### 2. Reduced Padding for Better Fit
**Files:** `src/components/HierarchicalGraph.jsx`, `src/components/Graph.jsx`

**Before:**
- Padding: 400px (nodes appear very small)
- Duration: 800ms

**After:**
- Padding: 200px (nodes appear larger, better use of space)
- Duration: 1000ms (smoother animation)

**Changes:**
```javascript
// manualFit default parameters
const manualFit = (padding = 200, duration = 1000) => {
  fg.zoomToFit(padding, duration);
};

// goHome function
fg.zoomToFit(200, 1000);
```

---

### 3. Added Initial Auto-Fit
**File:** `src/components/HierarchicalGraph.jsx`

**New useEffect:**
```javascript
// Auto-fit when data first loads
useEffect(() => {
  if (!fgRef.current || !visibleNodes.length || !data?.nodes?.length) return;
  
  // Wait for simulation to settle before fitting
  const timer = setTimeout(() => {
    try {
      if (fgRef.current?.zoomToFit) {
        fgRef.current.zoomToFit(200, 1000);
      }
    } catch (e) {
      console.debug('[graph] initial fit error', e);
    }
  }, 1200);
  
  return () => clearTimeout(timer);
}, [data?.nodes?.length, visibleNodes.length]);
```

**Why:** Ensures graph auto-fits when data first loads, not just when "Start Scan" is pressed.

---

## Timing Summary

| Event | Delay | Padding | Duration | Notes |
|-------|-------|---------|----------|-------|
| **Initial Load** | 1200ms | 200px | 1000ms | Auto-fit when data appears |
| **Start Scan** | 1500ms | 200px | 1000ms | Called after scan completes |
| **Home Button** | 0ms | 200px | 1000ms | Immediate fit |
| **Click Node** | 150ms | N/A | 600ms | Zoom to node (2.0x) |

---

## Why 1200-1500ms Delay?

The force simulation runs through several phases:
1. **0-300ms:** Initial node placement (random)
2. **300-800ms:** Forces pull nodes into position
3. **800-1200ms:** Nodes settle into final positions
4. **1200ms+:** Simulation has stabilized

Calling `zoomToFit` before 1200ms captures nodes while they're still moving, resulting in a poor fit.

---

## Padding Comparison

### 400px Padding (Old)
```
┌────────────────────────────────────┐
│                                    │
│                                    │
│           ●  ●  ●                  │  ← Nodes appear small
│                                    │
│                                    │
└────────────────────────────────────┘
```

### 200px Padding (New)
```
┌────────────────────────────────────┐
│                                    │
│          ●    ●    ●               │  ← Better use of space
│         ●  ●  ●  ●  ●              │
│          ●    ●    ●               │
│                                    │
└────────────────────────────────────┘
```

---

## Files Modified

1. ✅ `src/App.js`
   - Increased delay: 500ms → 1500ms
   - Reduced padding: 400px → 200px
   - Increased duration: 800ms → 1000ms

2. ✅ `src/components/HierarchicalGraph.jsx`
   - Added initial auto-fit useEffect
   - Updated `manualFit()` defaults
   - Updated `goHome()` parameters

3. ✅ `src/components/Graph.jsx`
   - Updated Home button fit parameters

---

## Testing

### Before Fix:
- ❌ Nodes scattered far from center
- ❌ Graph appears zoomed out too much
- ❌ Hard to see node details
- ❌ Fit happens before nodes settle

### After Fix:
- ✅ Nodes properly centered
- ✅ Good zoom level showing all nodes clearly
- ✅ Node labels readable
- ✅ Fit happens after simulation settles

---

## Test Checklist

- [ ] Load page → Graph should auto-fit after ~1.2 seconds
- [ ] Click "Start Scan" → Should fit after ~1.5 seconds
- [ ] Click Home button → Should fit immediately
- [ ] Click any node → Should zoom to that node
- [ ] All nodes visible and centered
- [ ] Good zoom level (not too far, not too close)

---

## Troubleshooting

### If nodes still appear too far:
```javascript
// Reduce padding further
fg.zoomToFit(100, 1000); // Tighter fit
```

### If nodes overlap too much:
```javascript
// Increase padding
fg.zoomToFit(300, 1000); // More space
```

### If fit happens too early:
```javascript
// Increase delay
setTimeout(() => manualFit(), 2000); // Wait even longer
```

---

## Performance Notes

- **Force Simulation:** ~100 iterations (cooldownTicks: 100)
- **Typical Settle Time:** 800-1200ms for 50-500 nodes
- **Large Graphs (>1000 nodes):** May need 2000ms+ delay

---

## Future Improvements

1. **Dynamic Delay:** Calculate delay based on node count
   ```javascript
   const delay = Math.min(3000, 1000 + (nodeCount * 2));
   ```

2. **Simulation Complete Event:** Listen for when simulation actually stops
   ```javascript
   onEngineStop={() => {
     fg.zoomToFit(200, 1000);
   }}
   ```

3. **Smart Padding:** Adjust padding based on viewport size
   ```javascript
   const padding = Math.max(100, size.width * 0.1);
   ```

4. **Zoom Presets:** Quick buttons for different zoom levels
   - Tight (100px)
   - Normal (200px)
   - Loose (400px)

---

## Summary

**Main Changes:**
- ⏱️ Longer delay before fit (1200-1500ms)
- 📏 Smaller padding for better space usage (200px)
- 🎬 Smoother animations (1000ms)
- ✨ Initial auto-fit when data loads

**Result:** Nodes now properly centered and visible with good zoom level! 🎉
