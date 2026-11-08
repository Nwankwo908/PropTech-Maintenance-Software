import {useEffect,useRef,useState} from 'react'
export function HomeCheckSerialReview({value,previouslySaved=false,previewUrl,onSave,onClose}:{value:string;previouslySaved?:boolean;previewUrl:string|null;onSave:(serial:string|null)=>Promise<void>;onClose:()=>void}) {
 const ref=useRef<HTMLDialogElement>(null)
 const [serial,setSerial]=useState(value)
 const [busy,setBusy]=useState(false)
 const [error,setError]=useState('')
 useEffect(()=>{const el=ref.current;if(el?.showModal)el.showModal();else el?.setAttribute('open','')},[])
 async function save(value:string|null){if(busy)return;setBusy(true);setError('');try{await onSave(value);onClose()}catch(e){setError(e instanceof Error?e.message:'Could not save the serial.');setBusy(false)}}
 return <dialog ref={ref} aria-labelledby='serial-review-title' onCancel={e=>{e.preventDefault();if(!busy)onClose()}} className='m-auto w-[min(640px,calc(100%_-_32px))] rounded-xl border border-[#dce4e1] bg-white p-6 text-[#0a0a0a] shadow-xl backdrop:bg-black/40'>
  <h2 id='serial-review-title' className='text-lg font-semibold'>Review serial number</h2>
  <p className='mt-2 text-sm text-[#68717a]'>Check the label photo. Confirm or correct the serial below, or leave it unknown if you cannot read it.</p>
  {previouslySaved?<p className='mt-2 text-sm'>Previously saved for this appliance. Compare it with the label, then confirm or correct it.</p>:null}
  {previewUrl?<a href={previewUrl} target='_blank' rel='noreferrer' className='mt-4 block' aria-label='Open label photo at full size'><img src={previewUrl} alt='Appliance label for this Home Check' className='max-h-[45vh] w-full rounded object-contain'/></a>:<p className='mt-4 text-sm'>The label photo is unavailable. Close and reopen this review to refresh it.</p>}
  <label className='mt-4 block text-sm font-medium'>Serial number<input autoFocus value={serial} disabled={busy} maxLength={80} onChange={e=>setSerial(e.target.value)} className='mt-1 block w-full rounded border border-[#cbd5e1] p-2' autoComplete='off'/></label>
  <p className='mt-2 text-xs text-[#68717a]'>This saves only the serial review. It does not confirm the Home Check or dismiss a photo concern.</p>
  {error?<p role='alert' className='mt-3 text-sm text-red-700'>{error}</p>:null}
  <div className='mt-5 flex flex-wrap gap-2'>
   <button type='button' disabled={busy||!serial.trim()||!previewUrl} onClick={()=>void save(serial.trim())} className='rounded-lg bg-[#186179] px-4 py-2 text-sm font-semibold text-white disabled:opacity-40'>{busy?'Saving…':value && serial.trim()===value.trim()?'Confirm serial number':'Save serial number'}</button>
   <button type='button' disabled={busy} onClick={()=>void save(null)} className='rounded-lg border border-[#cbd5e1] px-4 py-2 text-sm'>Leave unknown</button>
   <button type='button' disabled={busy} onClick={onClose} className='rounded-lg border border-[#cbd5e1] px-4 py-2 text-sm'>Cancel</button>
  </div>
 </dialog>
}
