/** @vitest-environment jsdom */
import {afterEach,expect,it,vi} from 'vitest'
import {cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react'
import {HomeCheckSerialReview} from './HomeCheckSerialReview'
afterEach(cleanup)
it('does not prefill an OCR guess and saves only explicit serial text',async()=>{
 const save=vi.fn(async()=>{}),close=vi.fn();render(<HomeCheckSerialReview value='' previewUrl='https://example.invalid/photo' onSave={save} onClose={close}/>);
 expect((screen.getByLabelText('Serial number') as HTMLInputElement).value).toBe('');
 fireEvent.change(screen.getByLabelText('Serial number'),{target:{value:' X132753655 '}});
 fireEvent.click(screen.getByRole('button',{name:'Save serial number'}));
 await waitFor(()=>expect(save).toHaveBeenCalledWith('X132753655'));expect(close).toHaveBeenCalled();
});
it('can explicitly leave the serial unknown without confirming the check',async()=>{
 const save=vi.fn(async()=>{});render(<HomeCheckSerialReview value='old' previewUrl={null} onSave={save} onClose={()=>{}}/>);
 fireEvent.click(screen.getByRole('button',{name:'Leave unknown'}));await waitFor(()=>expect(save).toHaveBeenCalledWith(null));
});
it('keeps the dialog open and reports a failed save',async()=>{
 const close=vi.fn();render(<HomeCheckSerialReview value='SERIAL' previewUrl='https://example.invalid/photo' onSave={async()=>{throw Error('Label changed')}} onClose={close}/>);
 fireEvent.click(screen.getByRole('button',{name:'Confirm serial number'}));expect((await screen.findByRole('alert')).textContent).toBe('Label changed');expect(close).not.toHaveBeenCalled();
});

it('prefills the previous serial for confirmation without typing',async()=>{
 const save=vi.fn(async()=>{});render(<HomeCheckSerialReview value='X132753655' previouslySaved previewUrl='https://example.invalid/photo' onSave={save} onClose={()=>{}}/>);
 expect((screen.getByLabelText('Serial number') as HTMLInputElement).value).toBe('X132753655');
 expect(screen.getByText(/Previously saved for this appliance/)).toBeTruthy();expect(save).not.toHaveBeenCalled();
 fireEvent.click(screen.getByRole('button',{name:'Confirm serial number'}));await waitFor(()=>expect(save).toHaveBeenCalledWith('X132753655'));
});
