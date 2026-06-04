/**
 * VirtualList — Bloomberg-style virtual scrolling.
 *
 * Bloomberg terminals routinely display lists of 5,000+ equities.
 * Rendering all rows as DOM nodes is prohibitive (~50ms DOM operations).
 * VirtualList renders only the visible rows + an overscan buffer — O(viewport)
 * not O(total items).
 *
 * Usage:
 *   <VirtualList
 *     items={gainers}           // can be 5000 items
 *     itemHeight={22}           // fixed row height in px
 *     height={containerHeight}
 *     overscan={3}              // extra rows above/below viewport
 *     renderItem={(item, i, style) => (
 *       <div key={item.symbol} style={style}>
 *         <span>{item.symbol}</span>
 *         <span>{item.price}</span>
 *       </div>
 *     )}
 *     getKey={(item) => item.symbol}
 *   />
 *
 * Performance:
 *   1000 items × 22px = 22000px total height.
 *   Viewport = 200px → visible = ~9 rows + 6 overscan = 15 DOM nodes.
 *   React reconciles 15 nodes instead of 1000.
 */

import React, { useRef, useState, useEffect, useCallback, useMemo } from 'react';

export interface VirtualListProps<T> {
  items:       T[];
  itemHeight:  number;     // Fixed row height (px) — enables O(1) scroll math
  height:      number;     // Visible container height (px)
  overscan?:   number;     // Extra rows rendered above + below viewport (default 4)
  renderItem:  (item: T, index: number, style: React.CSSProperties) => React.ReactNode;
  getKey:      (item: T, index: number) => string | number;
  emptyText?:  string;
  className?:  string;
  style?:      React.CSSProperties;
}

export function VirtualList<T>({
  items,
  itemHeight,
  height,
  overscan  = 4,
  renderItem,
  getKey,
  emptyText = 'No data',
  className,
  style: containerStyle,
}: VirtualListProps<T>) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);

  // Sync scroll position on external items change (e.g., sort order change)
  useEffect(() => {
    if (scrollRef.current) setScrollTop(scrollRef.current.scrollTop);
  }, [items]);

  const onScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
    setScrollTop((e.currentTarget).scrollTop);
  }, []);

  // ── O(1) window computation ─────────────────────────────────────────────────
  const { visibleStart, visibleEnd, paddingTop, paddingBottom } = useMemo(() => {
    const totalH  = items.length * itemHeight;
    const rawStart = Math.floor(scrollTop / itemHeight);
    const rawEnd   = Math.floor((scrollTop + height) / itemHeight);
    const start    = Math.max(0, rawStart - overscan);
    const end      = Math.min(items.length - 1, rawEnd + overscan);
    return {
      visibleStart:  start,
      visibleEnd:    end,
      paddingTop:    start * itemHeight,
      paddingBottom: Math.max(0, totalH - (end + 1) * itemHeight),
    };
  }, [scrollTop, itemHeight, height, items.length, overscan]);

  if (items.length === 0) {
    return (
      <div style={{
        height, display: 'flex', alignItems: 'center', justifyContent: 'center',
        color: 'var(--text-muted)', fontSize: 10,
        ...containerStyle,
      }} className={className}>
        {emptyText}
      </div>
    );
  }

  return (
    <div
      ref={scrollRef}
      className={className}
      style={{
        height,
        overflowY: 'auto',
        overflowX: 'hidden',
        contain: 'strict',          // CSS containment — browser skips layout outside
        willChange: 'scroll-position',
        ...containerStyle,
      }}
      onScroll={onScroll}
    >
      {/* Top spacer — represents rows above viewport */}
      {paddingTop > 0 && <div style={{ height: paddingTop, flexShrink: 0 }} />}

      {/* Visible rows only */}
      {items.slice(visibleStart, visibleEnd + 1).map((item, relIdx) => {
        const absIdx = visibleStart + relIdx;
        const rowStyle: React.CSSProperties = {
          height:   itemHeight,
          overflow: 'hidden',
          display:  'flex',
          alignItems: 'center',
        };
        return (
          <React.Fragment key={getKey(item, absIdx)}>
            {renderItem(item, absIdx, rowStyle)}
          </React.Fragment>
        );
      })}

      {/* Bottom spacer — represents rows below viewport */}
      {paddingBottom > 0 && <div style={{ height: paddingBottom, flexShrink: 0 }} />}
    </div>
  );
}

// ── Convenience: auto-measure height ─────────────────────────────────────────
/**
 * AutoVirtualList — same as VirtualList but auto-measures container height.
 * Use when the parent's height is dynamic (flex, grid) and you don't know
 * the exact pixel height at render time.
 */
export function AutoVirtualList<T>(props: Omit<VirtualListProps<T>, 'height'>) {
  const containerRef  = useRef<HTMLDivElement>(null);
  const [height, setHeight] = useState(200);

  useEffect(() => {
    if (!containerRef.current) return;
    const ro = new ResizeObserver(entries => {
      const entry = entries[0];
      if (entry) setHeight(entry.contentRect.height);
    });
    ro.observe(containerRef.current);
    // Initial measurement
    setHeight(containerRef.current.clientHeight);
    return () => ro.disconnect();
  }, []);

  return (
    <div ref={containerRef} style={{ flex: 1, overflow: 'hidden', minHeight: 0 }}>
      <VirtualList {...props} height={height} />
    </div>
  );
}
