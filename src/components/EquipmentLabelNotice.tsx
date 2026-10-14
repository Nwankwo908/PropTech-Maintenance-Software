import type { LabelReadability } from '@shared/vision/equipmentLabel'

export function EquipmentLabelNotice({ quality }: { quality?: LabelReadability }) {
  if (
    !quality ||
    (!quality.retakeRequested && !quality.uncertainCharacters.length &&
      !quality.formatWarnings.length)
  ) return null
  return (
    <div
      className='mt-2 space-y-1 rounded border border-amber-200 bg-amber-50 p-2 text-xs text-amber-900'
      role='status'
    >
      {quality.retakeRequested && (
        <p>
          {quality.retakeMessage || 'Please send a closer photo of the data plate without flash.'}
        </p>
      )}
      {(['modelNumber', 'serialNumber'] as const).map((field) =>
        quality.readings?.[field]
          ? (
            <p key={field}>
              Unconfirmed {field === 'modelNumber' ? 'model' : 'serial'} reading:{' '}
              <span className='font-mono'>{quality.readings[field]}</span>
            </p>
          )
          : null
      )}
      {quality.uncertainCharacters.map((character, index) => (
        <p key={index}>
          {character.field === 'modelNumber' ? 'Model' : 'Serial'} character {character.index + 1}:
          {' '}
          {character.alternatives.join(' / ')} — check the original label.
        </p>
      ))}
      {quality.formatWarnings.map((warning, index) => <p key={index}>{warning}</p>)}
      <p>Uncertain numbers remain unknown until the label can be read reliably.</p>
    </div>
  )
}
