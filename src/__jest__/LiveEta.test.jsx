/**
 * Tests for src/components/common/LiveEta.jsx
 * This is a pure presentational component with no store or API deps — easy to test.
 */
import React from 'react'
import { render, screen, act } from '@testing-library/react'
import LiveEta from '../components/common/LiveEta'

describe('LiveEta', () => {
  beforeEach(() => {
    jest.useFakeTimers()
  })
  afterEach(() => {
    // Run all pending timers before restoring so setInterval in LiveEta is cleaned up
    jest.runOnlyPendingTimers()
    jest.useRealTimers()
  })

  test('renders fallback minutes when no etaComplete is provided', () => {
    render(<LiveEta fallbackMin={12} />)
    expect(screen.getByText('12 min')).toBeInTheDocument()
  })

  test('rounds fractional fallback minutes', () => {
    render(<LiveEta fallbackMin={7.8} />)
    expect(screen.getByText('8 min')).toBeInTheDocument()
  })

  test('clamps negative fallback to 0', () => {
    render(<LiveEta fallbackMin={-5} />)
    expect(screen.getByText('0 min')).toBeInTheDocument()
  })

  test('defaults to 0 min when no props are given', () => {
    render(<LiveEta />)
    expect(screen.getByText('0 min')).toBeInTheDocument()
  })

  test('applies className to the span', () => {
    const { container } = render(<LiveEta fallbackMin={3} className="font-bold text-red" />)
    const span = container.querySelector('span')
    expect(span).toHaveClass('font-bold', 'text-red')
  })

  test('shows "arriving" when etaComplete is in the past', () => {
    const past = Math.floor(Date.now() / 1000) - 60
    render(<LiveEta etaComplete={past} />)
    expect(screen.getByText('arriving')).toBeInTheDocument()
  })

  test('shows mm/ss countdown when etaComplete is in the future', () => {
    // 90 seconds in the future
    const future = Math.floor(Date.now() / 1000) + 90
    render(<LiveEta etaComplete={future} />)
    // Should show "1m 30s" (or thereabouts — allow for small clock drift)
    expect(screen.getByText(/\dm \d+s/)).toBeInTheDocument()
  })

  test('shows seconds-only when under 1 minute remains', () => {
    const future = Math.floor(Date.now() / 1000) + 45
    render(<LiveEta etaComplete={future} />)
    expect(screen.getByText(/^\d+s$/)).toBeInTheDocument()
  })

  test('countdown updates every second', () => {
    const future = Math.floor(Date.now() / 1000) + 62
    render(<LiveEta etaComplete={future} />)
    const initialText = screen.getByText(/\dm \d+s/).textContent

    act(() => { jest.advanceTimersByTime(1000) })

    const updatedText = screen.getByText(/\dm \d+s|\d+s/).textContent
    // After 1 second, should show 1 less second
    expect(updatedText).not.toBe(initialText)
  })
})
