import { useEffect, useState } from 'react'
import {
  ASSET_REGISTRY_CHANGED_EVENT,
  assetRegistryHasContent,
  createDefaultAssetRegistry,
  deriveAssetStatus,
  isAssetComplete,
  loadAssetRegistryAsync,
  saveRegistryAsset,
  type AssetRegistryItem,
  type AssetRegistryState,
  type BoilerFuelType,
  type ManualAssetPatch,
} from '@/lib/assetRegistry'
import {
  loadPropertyBuildingProfile,
  savePropertyBuildingProfile,
} from '@/lib/propertyBuildingProfile'
import { getErrorMessage } from '@/lib/errorMessage'

type AssetRegistryPanelProps = {
  building: string
  /** Seed from onboarding / demo meta when no saved profile yet. */
  initialYearBuilt?: number | null
  onChanged?: (hasContent: boolean) => void
}

const BUILD_YEAR_EDIT_ID = 'build-year'

function BuildYearCard({
  yearBuilt,
  editing,
  saving,
  onEdit,
  onSave,
  onCancel,
}: {
  yearBuilt: number | null
  editing: boolean
  saving: boolean
  onEdit: () => void
  onSave: (year: number | null) => void
  onCancel: () => void
}) {
  const complete = yearBuilt != null
  const [year, setYear] = useState(yearBuilt != null ? String(yearBuilt) : '')

  useEffect(() => {
    if (!editing) return
    setYear(yearBuilt != null ? String(yearBuilt) : '')
  }, [editing, yearBuilt])

  if (!complete && !editing) {
    return (
      <div className="flex min-w-0 flex-1 flex-col gap-3 rounded-[12px] border border-[#f5ece1] bg-[#fcfbf7] p-4">
        <div className="flex items-center justify-between gap-2">
          <p className="text-[14px] font-medium text-[#0d0f11]">Property Build Year</p>
          <button
            type="button"
            onClick={onEdit}
            className="pd-btn pd-btn-icon flex size-7 shrink-0 items-center justify-center rounded-[6px]"
            aria-label="Add property build year"
          >
            <svg viewBox="0 0 24 24" fill="none" className="size-4" aria-hidden>
              <path
                d="M12 5v14M5 12h14"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
              />
            </svg>
          </button>
        </div>
        <p className="text-[12px] leading-normal text-[#475569]">
          Add the year this property was built so Ulo can estimate asset age when install dates
          are unknown.
        </p>
      </div>
    )
  }

  return (
    <div className="flex min-w-0 flex-1 flex-col gap-3 rounded-[12px] border border-[#e2e8f0] bg-white p-4">
      <div className="flex items-center justify-between gap-2">
        <p className="text-[14px] font-medium text-[#0d0f11]">Property Build Year</p>
        {!editing ? (
          <button
            type="button"
            onClick={onEdit}
            className="pd-btn pd-btn-ghost shrink-0 rounded px-1 py-0.5 text-[12px] font-semibold"
          >
            Edit
          </button>
        ) : null}
      </div>

      {editing ? (
        <div className="grid gap-2 sm:grid-cols-2">
          <label className="block text-[11px] font-semibold text-[#64748b]">
            Year built
            <input
              type="number"
              min={1800}
              max={2100}
              step={1}
              value={year}
              onChange={(e) => setYear(e.target.value)}
              placeholder="e.g. 1998"
              className="mt-1 w-full rounded-[8px] border border-[#e2e8f0] bg-[#f8fafc] px-3 py-2 text-[13px] text-[#0d0f11] outline-none"
            />
          </label>
          <div className="flex items-end gap-2 sm:col-span-2">
            <button
              type="button"
              disabled={saving}
              onClick={() => {
                const raw = year.trim()
                if (raw === '') {
                  onSave(null)
                  return
                }
                const parsed = Number(raw)
                if (!Number.isFinite(parsed) || parsed < 1800 || parsed > 2100) return
                onSave(Math.round(parsed))
              }}
              className="pd-btn pd-btn-primary rounded-[8px] px-3 py-2 text-[12px] font-semibold"
            >
              {saving ? 'Saving…' : 'Save'}
            </button>
            <button
              type="button"
              disabled={saving}
              onClick={onCancel}
              className="pd-btn pd-btn-secondary rounded-[8px] px-3 py-2 text-[12px] font-semibold"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <>
          <div className="flex flex-col gap-1 text-[12px] text-[#64748b]">
            <p>
              Built:{' '}
              <span className="font-medium text-[#0d0f11]">{yearBuilt}</span>
            </p>
          </div>
          <div className="rounded-[6px] bg-[#ecfdf5] p-2 text-[11px] font-semibold text-[#10b981]">
            Used to estimate asset age when install dates are unknown
          </div>
        </>
      )}
    </div>
  )
}

function SystemCard({
  item,
  editing,
  saving,
  onEdit,
  onSave,
  onCancel,
}: {
  item: AssetRegistryItem
  editing: boolean
  saving: boolean
  onEdit: () => void
  onSave: (patch: ManualAssetPatch) => void
  onCancel: () => void
}) {
  const complete = isAssetComplete(item)
  const incompleteEmpty = !complete

  const [age, setAge] = useState(item.ageYears != null ? String(item.ageYears) : '')
  const [brand, setBrand] = useState(item.brand)
  const [waterType, setWaterType] = useState(item.waterHeaterType || item.detail)
  const [roofMaterial, setRoofMaterial] = useState(item.roofMaterial || item.detail)
  const [capacityAmps, setCapacityAmps] = useState(
    item.capacityAmps != null ? String(item.capacityAmps) : '',
  )
  const [lastServiceDate, setLastServiceDate] = useState(
    item.lastServiceDate?.slice(0, 10) || '',
  )
  const [lastInspectionDate, setLastInspectionDate] = useState(
    item.lastInspectionDate?.slice(0, 10) || '',
  )
  const [fuelType, setFuelType] = useState<BoilerFuelType | ''>(item.fuelType || '')
  const [btuOutput, setBtuOutput] = useState(
    item.btuOutput != null ? String(item.btuOutput) : '',
  )
  const [lastPressureTest, setLastPressureTest] = useState(
    item.lastPressureTest?.slice(0, 10) || '',
  )

  useEffect(() => {
    if (!editing) return
    setAge(item.ageYears != null && item.ageBasis !== 'estimated_from_build_year' ? String(item.ageYears) : item.ageYears != null ? String(item.ageYears) : '')
    setBrand(item.brand)
    setWaterType(item.waterHeaterType || item.detail)
    setRoofMaterial(item.roofMaterial || item.detail)
    setCapacityAmps(item.capacityAmps != null ? String(item.capacityAmps) : '')
    setLastServiceDate(item.lastServiceDate?.slice(0, 10) || '')
    setLastInspectionDate(item.lastInspectionDate?.slice(0, 10) || '')
    setFuelType(item.fuelType || '')
    setBtuOutput(item.btuOutput != null ? String(item.btuOutput) : '')
    setLastPressureTest(item.lastPressureTest?.slice(0, 10) || '')
  }, [editing, item])

  const actionLabel = complete ? 'Edit' : 'Complete Details'

  function submit() {
    const ageYears = age.trim() === '' ? null : Number(age)
    const amps = capacityAmps.trim() === '' ? null : Number(capacityAmps)
    const btu = btuOutput.trim() === '' ? null : Number(btuOutput)
    const patch: ManualAssetPatch = {
      ageYears: ageYears != null && Number.isFinite(ageYears) ? ageYears : null,
      brand: brand.trim(),
    }
    if (item.registryAssetType === 'hvac') {
      patch.lastServiceDate = lastServiceDate || null
    } else if (item.registryAssetType === 'water_heater') {
      patch.waterHeaterType = waterType.trim()
    } else if (item.registryAssetType === 'boiler') {
      patch.fuelType = fuelType
      patch.btuOutput = btu != null && Number.isFinite(btu) ? btu : null
      patch.lastServiceDate = lastServiceDate || null
      patch.lastPressureTest = lastPressureTest || null
    } else if (item.registryAssetType === 'roof') {
      patch.roofMaterial = roofMaterial.trim()
      patch.lastInspectionDate = lastInspectionDate || null
    } else if (item.registryAssetType === 'electrical_panel') {
      patch.capacityAmps = amps != null && Number.isFinite(amps) ? amps : null
      patch.lastInspectionDate = lastInspectionDate || null
    }
    onSave(patch)
  }

  if (incompleteEmpty && !editing) {
    return (
      <div className="flex min-w-0 flex-1 flex-col gap-3 rounded-[12px] border border-[#f5ece1] bg-[#fcfbf7] p-4">
        <div className="flex items-center justify-between gap-2">
          <p className="text-[14px] font-medium text-[#0d0f11]">{item.title}</p>
          <button
            type="button"
            onClick={onEdit}
            className="pd-btn pd-btn-icon flex size-7 shrink-0 items-center justify-center rounded-[6px]"
            aria-label={`Register ${item.title}`}
          >
            <svg viewBox="0 0 24 24" fill="none" className="size-4" aria-hidden>
              <path
                d="M12 5v14M5 12h14"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
              />
            </svg>
          </button>
        </div>
        <p className="text-[12px] leading-normal text-[#475569]">{item.emptyHint}</p>
      </div>
    )
  }

  return (
    <div className="flex min-w-0 flex-1 flex-col gap-3 rounded-[12px] border border-[#e2e8f0] bg-white p-4">
      <div className="flex items-center justify-between gap-2">
        <p className="text-[14px] font-medium text-[#0d0f11]">{item.title}</p>
        {!editing ? (
          <button
            type="button"
            onClick={onEdit}
            className="pd-btn pd-btn-ghost shrink-0 rounded px-1 py-0.5 text-[12px] font-semibold"
          >
            {actionLabel}
          </button>
        ) : null}
      </div>

      {editing ? (
        <div className="grid gap-2 sm:grid-cols-2">
          <label className="block text-[11px] font-semibold text-[#64748b]">
            Age (years)
            <input
              type="number"
              min={0}
              step={0.5}
              value={age}
              onChange={(e) => setAge(e.target.value)}
              className="mt-1 w-full rounded-[8px] border border-[#e2e8f0] bg-[#f8fafc] px-3 py-2 text-[13px] text-[#0d0f11] outline-none"
            />
          </label>

          {item.registryAssetType === 'hvac' ? (
            <>
              <label className="block text-[11px] font-semibold text-[#64748b]">
                Brand
                <input
                  value={brand}
                  onChange={(e) => setBrand(e.target.value)}
                  placeholder="e.g. Carrier"
                  className="mt-1 w-full rounded-[8px] border border-[#e2e8f0] bg-[#f8fafc] px-3 py-2 text-[13px] text-[#0d0f11] outline-none"
                />
              </label>
              <label className="block text-[11px] font-semibold text-[#64748b] sm:col-span-2">
                Last service date
                <input
                  type="date"
                  value={lastServiceDate}
                  onChange={(e) => setLastServiceDate(e.target.value)}
                  className="mt-1 w-full rounded-[8px] border border-[#e2e8f0] bg-[#f8fafc] px-3 py-2 text-[13px] text-[#0d0f11] outline-none"
                />
              </label>
            </>
          ) : null}

          {item.registryAssetType === 'water_heater' ? (
            <label className="block text-[11px] font-semibold text-[#64748b]">
              Type
              <input
                value={waterType}
                onChange={(e) => setWaterType(e.target.value)}
                placeholder="e.g. tankless, gas, electric"
                className="mt-1 w-full rounded-[8px] border border-[#e2e8f0] bg-[#f8fafc] px-3 py-2 text-[13px] text-[#0d0f11] outline-none"
              />
            </label>
          ) : null}

          {item.registryAssetType === 'boiler' ? (
            <>
              <label className="block text-[11px] font-semibold text-[#64748b]">
                Brand
                <input
                  value={brand}
                  onChange={(e) => setBrand(e.target.value)}
                  placeholder="e.g. Weil-McLain"
                  className="mt-1 w-full rounded-[8px] border border-[#e2e8f0] bg-[#f8fafc] px-3 py-2 text-[13px] text-[#0d0f11] outline-none"
                />
              </label>
              <label className="block text-[11px] font-semibold text-[#64748b]">
                Fuel type
                <select
                  value={fuelType}
                  onChange={(e) => setFuelType(e.target.value as BoilerFuelType | '')}
                  className="mt-1 w-full rounded-[8px] border border-[#e2e8f0] bg-[#f8fafc] px-3 py-2 text-[13px] text-[#0d0f11] outline-none"
                >
                  <option value="">Select fuel</option>
                  <option value="gas">Gas</option>
                  <option value="oil">Oil</option>
                  <option value="electric">Electric</option>
                  <option value="propane">Propane</option>
                  <option value="unknown">Unknown</option>
                </select>
              </label>
              <label className="block text-[11px] font-semibold text-[#64748b]">
                BTU output
                <input
                  type="number"
                  min={0}
                  step={1000}
                  value={btuOutput}
                  onChange={(e) => setBtuOutput(e.target.value)}
                  placeholder="e.g. 80000"
                  className="mt-1 w-full rounded-[8px] border border-[#e2e8f0] bg-[#f8fafc] px-3 py-2 text-[13px] text-[#0d0f11] outline-none"
                />
              </label>
              <label className="block text-[11px] font-semibold text-[#64748b]">
                Last service date
                <input
                  type="date"
                  value={lastServiceDate}
                  onChange={(e) => setLastServiceDate(e.target.value)}
                  className="mt-1 w-full rounded-[8px] border border-[#e2e8f0] bg-[#f8fafc] px-3 py-2 text-[13px] text-[#0d0f11] outline-none"
                />
              </label>
              <label className="block text-[11px] font-semibold text-[#64748b] sm:col-span-2">
                Last pressure test
                <input
                  type="date"
                  value={lastPressureTest}
                  onChange={(e) => setLastPressureTest(e.target.value)}
                  className="mt-1 w-full rounded-[8px] border border-[#e2e8f0] bg-[#f8fafc] px-3 py-2 text-[13px] text-[#0d0f11] outline-none"
                />
              </label>
            </>
          ) : null}

          {item.registryAssetType === 'roof' ? (
            <>
              <label className="block text-[11px] font-semibold text-[#64748b]">
                Material
                <input
                  value={roofMaterial}
                  onChange={(e) => setRoofMaterial(e.target.value)}
                  placeholder="e.g. asphalt shingle, metal"
                  className="mt-1 w-full rounded-[8px] border border-[#e2e8f0] bg-[#f8fafc] px-3 py-2 text-[13px] text-[#0d0f11] outline-none"
                />
              </label>
              <label className="block text-[11px] font-semibold text-[#64748b] sm:col-span-2">
                Last inspection date
                <input
                  type="date"
                  value={lastInspectionDate}
                  onChange={(e) => setLastInspectionDate(e.target.value)}
                  className="mt-1 w-full rounded-[8px] border border-[#e2e8f0] bg-[#f8fafc] px-3 py-2 text-[13px] text-[#0d0f11] outline-none"
                />
              </label>
            </>
          ) : null}

          {item.registryAssetType === 'electrical_panel' ? (
            <>
              <label className="block text-[11px] font-semibold text-[#64748b]">
                Capacity (amps)
                <input
                  type="number"
                  min={0}
                  step={1}
                  value={capacityAmps}
                  onChange={(e) => setCapacityAmps(e.target.value)}
                  placeholder="e.g. 200"
                  className="mt-1 w-full rounded-[8px] border border-[#e2e8f0] bg-[#f8fafc] px-3 py-2 text-[13px] text-[#0d0f11] outline-none"
                />
              </label>
              <label className="block text-[11px] font-semibold text-[#64748b] sm:col-span-2">
                Last inspection date
                <input
                  type="date"
                  value={lastInspectionDate}
                  onChange={(e) => setLastInspectionDate(e.target.value)}
                  className="mt-1 w-full rounded-[8px] border border-[#e2e8f0] bg-[#f8fafc] px-3 py-2 text-[13px] text-[#0d0f11] outline-none"
                />
              </label>
            </>
          ) : null}

          <div className="flex gap-2 sm:col-span-2">
            <button
              type="button"
              disabled={saving}
              onClick={submit}
              className="pd-btn pd-btn-primary rounded-[8px] px-3 py-2 text-[12px] font-semibold"
            >
              {saving ? 'Saving…' : 'Save'}
            </button>
            <button
              type="button"
              disabled={saving}
              onClick={onCancel}
              className="pd-btn pd-btn-secondary rounded-[8px] px-3 py-2 text-[12px] font-semibold"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <>
          <div className="flex flex-col gap-1 text-[12px] text-[#64748b]">
            <p>
              Age:{' '}
              <span className="font-medium text-[#0d0f11]">
                {item.ageYears != null ? `${item.ageYears} Years` : '—'}
              </span>
              {item.ageBasis === 'estimated_from_build_year' ||
              item.ageBasis === 'ai_estimated' ? (
                <span className="ml-1 text-[10px] font-semibold uppercase tracking-wide text-[#94a3b8]">
                  estimated
                </span>
              ) : null}
              {item.registryAssetType === 'hvac' && item.brand ? (
                <>
                  {' '}
                  • Brand:{' '}
                  <span className="font-medium text-[#0d0f11]">{item.brand}</span>
                </>
              ) : null}
              {item.registryAssetType === 'water_heater' &&
              (item.waterHeaterType || item.detail) ? (
                <>
                  {' '}
                  • Type:{' '}
                  <span className="font-medium text-[#0d0f11]">
                    {item.waterHeaterType || item.detail}
                  </span>
                </>
              ) : null}
              {item.registryAssetType === 'boiler' ? (
                <>
                  {item.brand ? (
                    <>
                      {' '}
                      • Brand:{' '}
                      <span className="font-medium text-[#0d0f11]">{item.brand}</span>
                    </>
                  ) : null}
                  {item.fuelType ? (
                    <>
                      {' '}
                      • Fuel:{' '}
                      <span className="font-medium capitalize text-[#0d0f11]">
                        {item.fuelType}
                      </span>
                    </>
                  ) : null}
                  {item.btuOutput != null ? (
                    <>
                      {' '}
                      • BTU:{' '}
                      <span className="font-medium text-[#0d0f11]">
                        {item.btuOutput.toLocaleString()}
                      </span>
                    </>
                  ) : null}
                </>
              ) : null}
              {item.registryAssetType === 'roof' &&
              (item.roofMaterial || item.detail) ? (
                <>
                  {' '}
                  • Material:{' '}
                  <span className="font-medium text-[#0d0f11]">
                    {item.roofMaterial || item.detail}
                  </span>
                </>
              ) : null}
              {item.registryAssetType === 'electrical_panel' &&
              item.capacityAmps != null ? (
                <>
                  {' '}
                  • Capacity:{' '}
                  <span className="font-medium text-[#0d0f11]">{item.capacityAmps}A</span>
                </>
              ) : null}
            </p>
            <p>
              {item.registryAssetType === 'hvac' || item.registryAssetType === 'boiler'
                ? 'Last Service'
                : 'Last Inspection'}
              :{' '}
              <span
                className={
                  item.lastServiceOverdue
                    ? 'font-semibold text-[#ef4444]'
                    : 'font-medium text-[#0d0f11]'
                }
              >
                {item.lastService || '—'}
              </span>
            </p>
            {item.registryAssetType === 'boiler' && item.lastPressureTest ? (
              <p>
                Last pressure test:{' '}
                <span className="font-medium text-[#0d0f11]">
                  {item.lastPressureTest.slice(0, 10)}
                </span>
              </p>
            ) : null}
            {item.source ? (
              <p className="text-[10px] uppercase tracking-wide text-[#94a3b8]">
                {item.source === 'ai_inspection'
                  ? 'From inspection'
                  : item.source === 'manual_updated'
                    ? 'Manual update'
                    : 'Manual'}
              </p>
            ) : null}
            {item.fieldConflicts.length > 0 ? (
              <p className="text-[11px] font-medium text-[#b45309]">
                Review needed: AI estimate differs from saved details
              </p>
            ) : null}
          </div>
          {item.statusNote ? (
            <div
              className={[
                'rounded-[6px] p-2 text-[11px] font-semibold',
                item.statusTone === 'warn'
                  ? 'bg-[#fffbeb] text-[#f59e0b]'
                  : 'bg-[#ecfdf5] text-[#10b981]',
              ].join(' ')}
            >
              {item.statusNote}
            </div>
          ) : null}
        </>
      )}
    </div>
  )
}

function ApplianceChip({
  item,
  editing,
  saving,
  onEdit,
  onSave,
  onCancel,
}: {
  item: AssetRegistryItem
  editing: boolean
  saving: boolean
  onEdit: () => void
  onSave: (patch: ManualAssetPatch) => void
  onCancel: () => void
}) {
  const complete = isAssetComplete(item)
  const [brand, setBrand] = useState(item.brand)
  const [age, setAge] = useState(item.ageYears != null ? String(item.ageYears) : '')
  const [detail, setDetail] = useState(item.detail || item.modelNumber)

  useEffect(() => {
    if (!editing) return
    setBrand(item.brand)
    setAge(item.ageYears != null ? String(item.ageYears) : '')
    setDetail(item.detail || item.modelNumber)
  }, [editing, item])

  if (editing) {
    return (
      <div className="flex w-full flex-col gap-2 rounded-[8px] border border-[#e2e8f0] bg-white px-3.5 py-2.5 sm:w-auto sm:min-w-[200px]">
        <p className="text-[13px] font-semibold text-[#0d0f11]">
          {item.shortTitle || item.title}
        </p>
        <input
          value={brand}
          onChange={(e) => setBrand(e.target.value)}
          placeholder="Brand"
          className="rounded-[6px] border border-[#e2e8f0] px-2 py-1.5 text-[12px] outline-none"
        />
        <input
          type="number"
          min={0}
          step={0.5}
          value={age}
          onChange={(e) => setAge(e.target.value)}
          placeholder="Age (years)"
          className="rounded-[6px] border border-[#e2e8f0] px-2 py-1.5 text-[12px] outline-none"
        />
        <input
          value={detail}
          onChange={(e) => setDetail(e.target.value)}
          placeholder="Model / type"
          className="rounded-[6px] border border-[#e2e8f0] px-2 py-1.5 text-[12px] outline-none"
        />
        <div className="flex gap-2">
          <button
            type="button"
            disabled={saving}
            onClick={() => {
              const ageYears = age.trim() === '' ? null : Number(age)
              onSave({
                brand: brand.trim(),
                detail: detail.trim(),
                modelNumber: detail.trim(),
                ageYears: ageYears != null && Number.isFinite(ageYears) ? ageYears : null,
              })
            }}
            className="pd-btn pd-btn-primary rounded-[6px] px-2.5 py-1 text-[11px] font-semibold"
          >
            {saving ? '…' : 'Save'}
          </button>
          <button
            type="button"
            disabled={saving}
            onClick={onCancel}
            className="pd-btn pd-btn-ghost rounded px-1.5 py-1 text-[11px] font-semibold"
          >
            Cancel
          </button>
        </div>
      </div>
    )
  }

  return (
    <button
      type="button"
      onClick={onEdit}
      className={[
        'pd-btn pd-btn-card flex items-center gap-3 rounded-[8px] px-3.5 py-2.5 text-left',
        complete
          ? 'border-[#e2e8f0] bg-white hover:border-[#187960] hover:bg-[#e2f5f1]'
          : 'border-[#f5ece1] bg-[#fcfbf7] hover:border-[#187960] hover:bg-[#e2f5f1]',
      ].join(' ')}
    >
      <span className="text-[14px]" aria-hidden>
        {complete ? '✅' : '➕'}
      </span>
      <span className="flex flex-col gap-px">
        <span className="text-[13px] font-semibold text-[#0d0f11]">
          {item.shortTitle || item.title}
        </span>
        <span
          className={
            complete ? 'text-[11px] text-[#64748b]' : 'text-[11px] text-[#f59e0b]'
          }
        >
          {complete
            ? [item.brand, item.detail || item.modelNumber].filter(Boolean).join(' ') ||
              'Details added'
            : 'Missing details'}
        </span>
      </span>
    </button>
  )
}

function registryHasContent(state: AssetRegistryState, yearBuilt: number | null): boolean {
  return assetRegistryHasContent(state) || yearBuilt != null
}

/** Expanded Asset Registry — Figma node 1139:1595. */
export function AssetRegistryPanel({
  building,
  initialYearBuilt = null,
  onChanged,
}: AssetRegistryPanelProps) {
  const [state, setState] = useState<AssetRegistryState>(() => createDefaultAssetRegistry())
  const [yearBuilt, setYearBuilt] = useState<number | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [savingId, setSavingId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    async function refresh() {
      const [next, profile] = await Promise.all([
        loadAssetRegistryAsync(building),
        loadPropertyBuildingProfile(building),
      ])
      if (cancelled) return

      let resolvedYear = profile.yearBuilt
      if (resolvedYear == null && initialYearBuilt != null && Number.isFinite(initialYearBuilt)) {
        resolvedYear = initialYearBuilt
        void savePropertyBuildingProfile(building, initialYearBuilt).catch(() => {
          // best-effort seed from onboarding meta
        })
      }

      setState(next)
      setYearBuilt(resolvedYear)
      setEditingId(null)
      onChanged?.(registryHasContent(next, resolvedYear))
    }
    void refresh()

    function onRegistryEvent(ev: Event) {
      const detail = (ev as CustomEvent<{ building?: string }>).detail
      if (detail?.building && detail.building.trim() !== building.trim()) return
      void refresh()
    }
    window.addEventListener(ASSET_REGISTRY_CHANGED_EVENT, onRegistryEvent)
    return () => {
      cancelled = true
      window.removeEventListener(ASSET_REGISTRY_CHANGED_EVENT, onRegistryEvent)
    }
  }, [building, initialYearBuilt, onChanged])

  async function updateItem(id: string, patch: ManualAssetPatch) {
    const item = state.items.find((i) => i.id === id)
    if (!item) return
    setSavingId(id)
    setError(null)
    try {
      const saved = await saveRegistryAsset(building, item, patch)
      setState((prev) => {
        const next = {
          ...prev,
          items: prev.items.map((row) =>
            row.id === id ? deriveAssetStatus(saved) : row,
          ),
          updatedAt: new Date().toISOString(),
        }
        onChanged?.(registryHasContent(next, yearBuilt))
        return next
      })
      setEditingId(null)
    } catch (err) {
      setError(getErrorMessage(err, 'Could not save asset.'))
    } finally {
      setSavingId(null)
    }
  }

  async function updateBuildYear(year: number | null) {
    setSavingId(BUILD_YEAR_EDIT_ID)
    setError(null)
    try {
      const saved = await savePropertyBuildingProfile(building, year)
      setYearBuilt(saved.yearBuilt)
      setState((prev) => ({ ...prev, buildYear: saved.yearBuilt }))
      onChanged?.(registryHasContent(state, saved.yearBuilt))
      setEditingId(null)
    } catch (err) {
      setError(getErrorMessage(err, 'Could not save build year.'))
    } finally {
      setSavingId(null)
    }
  }

  const systems = state.items.filter((i) => i.kind === 'system')
  const appliances = state.items.filter((i) => i.kind === 'appliance')

  return (
    <div className="flex flex-col gap-4">
      {error ? (
        <p className="rounded-[8px] bg-[#fef2f2] px-3 py-2 text-[12px] text-[#b91c1c]">
          {error}
        </p>
      ) : null}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {systems.map((item) => (
          <SystemCard
            key={item.id}
            item={item}
            editing={editingId === item.id}
            saving={savingId === item.id}
            onEdit={() => setEditingId(item.id)}
            onSave={(patch) => void updateItem(item.id, patch)}
            onCancel={() => setEditingId(null)}
          />
        ))}
        <BuildYearCard
          yearBuilt={yearBuilt}
          editing={editingId === BUILD_YEAR_EDIT_ID}
          saving={savingId === BUILD_YEAR_EDIT_ID}
          onEdit={() => setEditingId(BUILD_YEAR_EDIT_ID)}
          onSave={(year) => void updateBuildYear(year)}
          onCancel={() => setEditingId(null)}
        />
      </div>

      <div className="flex flex-col gap-3 pt-2">
        <p className="text-[13px] font-medium uppercase tracking-[0.02em] text-[#64748b]">
          Kitchen &amp; Laundry Appliances
        </p>
        <div className="flex flex-wrap gap-2">
          {appliances.map((item) => (
            <ApplianceChip
              key={item.id}
              item={item}
              editing={editingId === item.id}
              saving={savingId === item.id}
              onEdit={() => setEditingId(item.id)}
              onSave={(patch) => void updateItem(item.id, patch)}
              onCancel={() => setEditingId(null)}
            />
          ))}
        </div>
      </div>
    </div>
  )
}

export default AssetRegistryPanel
