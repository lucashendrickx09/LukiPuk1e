import { useEffect, useState } from 'react'
import type { SyncInfo } from '../lib/useSync'

const DOT: Record<string, string> = {
  idle: '#6b7785',
  connecting: '#e8b339',
  connected: '#4cae8a',
  error: '#e24b4a',
}

function label(info: SyncInfo): string {
  if (!info.configured) return 'Sync'
  switch (info.state) {
    case 'connected':
      return 'Synced'
    case 'connecting':
      return 'Syncing…'
    case 'error':
      return 'Sync error'
    default:
      return 'Sync off'
  }
}

export default function SyncButton({ info }: { info: SyncInfo }) {
  const [open, setOpen] = useState(false)
  const color = info.configured ? DOT[info.state] : DOT.idle

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex flex-none items-center gap-1.5 rounded-md border border-edge bg-panel px-2.5 py-1.5 text-[12px] text-muted transition hover:border-gold/60 hover:text-ink"
        title="Cross-device sync"
      >
        <span
          className={`h-2 w-2 flex-none rounded-full ${info.state === 'connecting' ? 'animate-pulse' : ''}`}
          style={{ background: color }}
        />
        {label(info)}
      </button>

      {open && <SyncPanel info={info} onClose={() => setOpen(false)} />}
    </>
  )
}

function SyncPanel({ info, onClose }: { info: SyncInfo; onClose: () => void }) {
  const [value, setValue] = useState(info.passphrase ?? '')

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  const submit = () => {
    if (value.trim()) info.connect(value)
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/70 px-4 py-12 animate-[scrim-in_0.15s_ease]"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Cross-device sync"
        className="w-full max-w-[440px] animate-pop rounded-xl border border-edge bg-panel p-5"
      >
        <div className="mb-3 flex items-start justify-between gap-3">
          <h3 className="text-lg font-semibold">Cross-device sync</h3>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="flex h-[28px] w-[28px] flex-none items-center justify-center rounded-lg border border-edge text-muted transition hover:bg-panel2 hover:text-ink"
          >
            ✕
          </button>
        </div>

        {!info.configured ? (
          <div className="text-[13px] leading-relaxed text-muted">
            <p>
              Sync isn't set up for this deployment yet. Add your Supabase
              <span className="text-ink"> URL</span> and
              <span className="text-ink"> anon key</span> (see the README →{' '}
              <span className="text-ink">Set up sync</span>), then reload. Until then your
              data is saved on this device only.
            </p>
          </div>
        ) : info.state === 'connected' ? (
          <div className="space-y-3 text-[13px]">
            <p className="text-muted">
              <span className="font-semibold text-[#4cae8a]">Connected.</span> Any device that
              enters the same passphrase shares this calendar — changes sync within seconds.
            </p>
            <div>
              <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-faint">
                Passphrase
              </div>
              <code className="block break-all rounded-md border border-edge bg-panel2 px-3 py-2 text-[13px] text-ink">
                {info.passphrase}
              </code>
            </div>
            {info.lastSyncAt && (
              <p className="text-[12px] text-faint">
                Last synced {new Date(info.lastSyncAt).toLocaleTimeString()}.
              </p>
            )}
            <button
              type="button"
              onClick={() => {
                info.disconnect()
              }}
              className="rounded-md border border-edge bg-panel2 px-3 py-1.5 text-[12.5px] text-muted transition hover:border-[#e24b4a]/60 hover:text-ink"
            >
              Disconnect this device
            </button>
          </div>
        ) : (
          <div className="space-y-3">
            <p className="text-[13px] text-muted">
              Enter the <span className="text-ink">same passphrase</span> on each device to link
              them. Pick something only you know.
            </p>
            <input
              type="text"
              autoFocus
              value={value}
              onChange={(e) => setValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') submit()
              }}
              placeholder="e.g. blue-otter-47"
              className="w-full rounded-md border border-edge bg-panel2 px-3 py-2 text-[14px] text-ink outline-none focus:border-gold/70"
            />
            {info.state === 'error' && info.error && (
              <p className="text-[12px] text-[#e24b4a]">{info.error}</p>
            )}
            <button
              type="button"
              onClick={submit}
              disabled={!value.trim() || info.state === 'connecting'}
              className="rounded-md border border-gold/40 bg-gold/15 px-3.5 py-1.5 text-[12.5px] font-semibold text-gold transition hover:bg-gold/25 disabled:opacity-40"
            >
              {info.state === 'connecting' ? 'Connecting…' : 'Connect'}
            </button>
            <p className="text-[11px] leading-relaxed text-faint">
              Anyone who knows this passphrase can read and change your data — keep it private.
              It links devices; it isn't a login.
            </p>
          </div>
        )}
      </div>
    </div>
  )
}
