/**
 * Tests for src/portal/VoiceAgent.jsx
 *
 * VoiceAgent uses:
 *  - import.meta.env.VITE_VOICE_URL
 *  - useFleetStore (Zustand)
 *  - fetch (AWS Lambda)
 *  - Web Speech API (SpeechSynthesis / SpeechRecognition)
 *
 * We mock all external deps so tests are deterministic.
 */
import React from 'react'
import { render, screen, act, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

// ------------------------------------------------------------------
// Mock import.meta.env BEFORE importing anything that reads it
// ------------------------------------------------------------------
jest.mock('../services/api', () => ({
  api: {},
  API_ENABLED: false,
  normalizeVehicle: (v) => v,
  normalizeDriver: (d) => d,
}))

jest.mock('../store/useFleetStore', () => {
  const refreshFromApi = jest.fn().mockResolvedValue(undefined)
  const hydrateLive = jest.fn().mockResolvedValue(undefined)
  return {
    useFleetStore: (selector) =>
      selector({
        emergencies: [],
        vehicles: [],
        refreshFromApi,
        hydrateLive,
      }),
  }
})

jest.mock('../data/locations', () => ({
  locById: jest.fn(() => undefined),
  setGeoReference: jest.fn(),
  LOCATIONS: [],
  ZONES: [],
  bloodBanks: () => [],
  bloodBankById: jest.fn(() => undefined),
  pickupLabel: jest.fn(() => '—'),
  fmtPt: jest.fn(() => null),
  JAMSHEDPUR_CENTER: { lat: 22.76, lng: 86.2, zoom: 13 },
}))

jest.mock('../data/hospitals', () => ({
  hospitalById: jest.fn(() => undefined),
  setHospitals: jest.fn(),
  HOSPITALS: [],
  CASE_TYPES: ['Cardiac'],
  SEVERITIES: ['Critical', 'Urgent', 'Normal'],
  SEVERITY_META: {
    Critical: { rank: 0, color: '#dc2626' },
    Urgent:   { rank: 1, color: '#d97706' },
    Normal:   { rank: 2, color: '#2563eb' },
  },
}))

jest.mock('../auth', () => ({
  getToken: jest.fn(() => null),
}))

// Mock the component's LiveEta import so it doesn't need a timer
jest.mock('../components/common/LiveEta', () =>
  function MockLiveEta({ fallbackMin }) {
    return <span>{fallbackMin ?? 0} min</span>
  }
)

// Stub Web Speech APIs (not available in jsdom)
beforeAll(() => {
  global.SpeechSynthesisUtterance = class {
    constructor(text) { this.text = text; this.rate = 1 }
  }
  global.speechSynthesis = {
    speak: jest.fn(),
    cancel: jest.fn(),
  }
})

// VOICE_URL is a hard-coded same-origin path ('/voice', routed via a
// CloudFront behavior) — no env fallback anymore, so the component always
// opens the call by POSTing the greeting on mount. Tests mock fetch to
// answer that greeting deterministically.

// Import after all mocks are registered
const VoiceAgent = require('../portal/VoiceAgent').default

const GREETING = 'Emergency line. Ambulance or fire truck, and where?'

describe('VoiceAgent', () => {
  const defaultProps = {
    session: { sub: 'user-1', name: 'Test User' },
    onClose: jest.fn(),
  }

  beforeEach(() => {
    jest.clearAllMocks()
    global.fetch = jest.fn().mockResolvedValue({
      json: async () => ({ reply: GREETING, booked: null }),
    })
  })

  test('renders the overlay container', async () => {
    const { container } = render(<VoiceAgent {...defaultProps} />)
    expect(container.firstChild).toHaveClass('fixed')
    await waitFor(() => expect(global.fetch).toHaveBeenCalled())
  })

  test('shows "Emergency Services" header text', async () => {
    render(<VoiceAgent {...defaultProps} />)
    expect(screen.getByText('Emergency Services')).toBeInTheDocument()
    await waitFor(() => expect(global.fetch).toHaveBeenCalled())
  })

  test('opens the call by POSTing the greeting to the same-origin /voice path', async () => {
    render(<VoiceAgent {...defaultProps} />)
    await waitFor(() => expect(global.fetch).toHaveBeenCalled())
    const [url, opts] = global.fetch.mock.calls[0]
    expect(url).toBe('/voice')
    expect(opts.method).toBe('POST')
    // SameSite=Strict sso_session cookie must ride along for SSO users.
    expect(opts.credentials).toBe('same-origin')
    expect(JSON.parse(opts.body).requestedBy).toBe('user-1')
  })

  test('shows the greeting bubble once the agent answers', async () => {
    render(<VoiceAgent {...defaultProps} />)
    expect(await screen.findByText(GREETING)).toBeInTheDocument()
  })

  test('no "Close" button before anything is dispatched', async () => {
    render(<VoiceAgent {...defaultProps} />)
    await waitFor(() => expect(global.fetch).toHaveBeenCalled())
    expect(screen.queryByRole('button', { name: /Close/i })).not.toBeInTheDocument()
  })

  test('does not call onClose on unmount (only on hang up)', async () => {
    const onClose = jest.fn()
    const { unmount } = render(<VoiceAgent {...defaultProps} onClose={onClose} />)
    await waitFor(() => expect(global.fetch).toHaveBeenCalled())
    unmount()
    expect(onClose).not.toHaveBeenCalled()
  })
})
