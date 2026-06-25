import React from 'react'
import { useFleetStore } from '../../store/useFleetStore'
import { locById } from '../../data/locations'
import { hospitalById } from '../../data/hospitals'
import { STATUS_COLORS, VehicleIcon, Badge, Progress, StatusDot } from '../../components/common/ui.jsx'

export default function VehiclePanel({ vehicle, onClose }) {
  const drivers = useFleetStore((s) => s.drivers)
  const emergencies = useFleetStore((s) => s.emergencies)
  const live = useFleetStore((s) => s.live)

  const driver = drivers.find((d) => d.id === vehicle.driverId)
  const job = emergencies.find((e) => e.ambulanceId === vehicle.id && e.state === 'EN_ROUTE')
  const color = STATUS_COLORS[vehicle.status]

  return (
    <div className="panel h-full flex flex-col backdrop-blur bg-cmd-panel/95">
      <div className="flex items-center justify-between px-4 py-3 border-b border-cmd-border">
        <div className="flex items-center gap-2">
          <span className="text-accent"><VehicleIcon type={vehicle.type} size={22} /></span>
          <div>
            <div className="font-semibold">{vehicle.reg}</div>
            <div className="text-xs text-cmd-muted capitalize">{vehicle.type}</div>
          </div>
        </div>
        <button className="text-cmd-muted hover:text-cmd-text text-xl" onClick={onClose}>×</button>
      </div>

      <div className="p-4 space-y-4 overflow-auto text-sm">
        <div className="flex items-center gap-2">
          <StatusDot color={color} pulse={vehicle.status === 'enroute'} />
          <span className="capitalize font-medium" style={{ color }}>{vehicle.status}</span>
        </div>

        <Row label="Driver" value={driver ? `${driver.name} (${driver.license})` : 'Unassigned'} />

        <div>
          <div className="label mb-1">Current Job</div>
          {job ? (
            <div className="panel-2 p-3">
              <div className="flex items-center justify-between">
                <span className="font-medium">{job.id}</span>
                <Badge color={job.kind === 'fire' ? '#ea580c' : '#22c55e'}>{job.kind === 'fire' ? 'Fire' : job.caseType || 'Medical'}</Badge>
              </div>
              <div className="mt-2 text-xs text-cmd-muted">
                {locById(job.pickup)?.name}{job.kind !== 'fire' && hospitalById(job.hospitalId) ? ` → ${hospitalById(job.hospitalId).name}` : ''}
              </div>
              <div className="mt-2 grid grid-cols-2 gap-2 text-xs">
                <div><span className="text-cmd-muted">Distance</span><div className="font-mono">{job.totalDistanceKm?.toFixed(1)} km</div></div>
                <div><span className="text-cmd-muted">ETA</span><div className="font-mono">{Math.round(job.totalEtaMin)} min</div></div>
              </div>
            </div>
          ) : <div className="text-cmd-muted">No active job</div>}
        </div>

        <div>
          <div className="flex justify-between label mb-1"><span>Fuel</span><span className="text-cmd-text">{vehicle.fuel}%</span></div>
          <Progress value={vehicle.fuel} max={100} color={vehicle.fuel < 25 ? '#ef4444' : '#38bdf8'} />
        </div>

        <Row label="Odometer" value={`${vehicle.odometer.toLocaleString()} km`} mono />
        <Row label="Next service" value={vehicle.nextService} mono />
      </div>
    </div>
  )
}

function Row({ label, value, mono }) {
  return (
    <div className="flex items-center justify-between">
      <span className="label">{label}</span>
      <span className={mono ? 'font-mono text-xs' : ''}>{value}</span>
    </div>
  )
}
