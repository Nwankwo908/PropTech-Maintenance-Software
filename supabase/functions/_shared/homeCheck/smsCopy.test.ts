import {expect,it} from 'vitest'
import {homeCheckCaptureSms,homeCheckObservationQuestion,homeCheckResultsSms,homeCheckObservationAcknowledgement,homeCheckConfirmationSms} from './smsCopy.ts'
for(const role of ['landlord','tenant','contractor'] as const){
 it(`${role} capture uses a photo without codes or retired URLs`,()=>{
  const text=homeCheckCaptureSms({role,location:'Disposable Test Lane',company:'Test Account',reference:'HC-AABBCCDDEEFF'})
  expect(text).not.toContain('HC-AABBCCDDEEFF')
  expect(text).not.toContain('Reply with the photo here')
  if (role === 'contractor' || role === 'landlord') {
    expect(text).toContain('attach all four photos in one text')
    expect(text).toContain('one at a time')
    expect(text).toContain('1) Water heater label')
  } else {
    expect(text).toContain('Please send one clear photo of the water heater label.')
  }
  expect(text).not.toMatch(/https?:|\/c\/|open the link/i)
  expect(text).not.toContain('No repairs are authorized')
  if (role === 'landlord') {
    expect(text).toMatch(/^Your Home Check for Disposable Test Lane\./)
  }
  if (role === 'tenant') {
    expect(text).not.toMatch(/Ulo for|where you live|equipment photos/)
    expect(text).toMatch(/^Ulo is requesting appliance photos for your Home Check at Disposable Test Lane\./)
    expect(text.indexOf('Please send')).toBeLessThan(text.indexOf("We'll guide you"))
  }
 })
}

it('observations ask for plain answers without a reference or pipe command',()=>{const text=homeCheckObservationQuestion();expect(text).toContain('Reply NONE, YES + details, or UNSURE');expect(text).not.toMatch(/HC-|ANSWERS|\|/);})

const resultInput = { location: '100 Disposable Test Lane', assets: [], answers: { warningSigns: false, warningDetails: '', lastService: '', lastFilterChange: '' }, warning: 'TPR valve discharge line loops upward', pendingSystems: [] }
it('Results addresses the recipient directly, explains the warning and remains unconfirmed',()=>{
 const text=homeCheckResultsSms(resultInput)
 expect(text).toMatch(/^Results: 100 Disposable Test Lane/)
 expect(text).toContain('You noticed no leaks')
 expect(text).toContain('possible relief-valve piping issue')
 expect(text).toContain('Review the photo concern in Property Intelligence tab.')
 expect(text).toContain('Reply OK')
 expect(text).not.toMatch(/needs landlord review|Saved|make unreadable|HC-/i)
})
it('pending analysis is distinguished from an unreadable label and cannot invite OK',()=>{
 const text=homeCheckResultsSms({...resultInput,pendingSystems:['heating']})
 expect(text).toContain('Heating system: analysis pending')
 expect(text).not.toContain('Reply OK')
 expect(text).toContain('photo analysis must finish first')
})

it('reported warning signs retain the existing emergency direction in the single Results message',()=>{const text=homeCheckResultsSms({...resultInput,answers:{...resultInput.answers,warningSigns:true,warningDetails:'smell of gas'}});expect(text).toContain('You noticed: smell of gas');expect(text).toContain('leave and contact emergency services or your utility');})

it('unanswered observations stay unknown and ask the direct question instead of OK',()=>{
 const text=homeCheckResultsSms({...resultInput,answers:{...resultInput.answers,warningSigns:null}})
 expect(text).not.toContain('no leaks')
 expect(text).not.toContain('Reply OK')
 expect(text).toContain('Any leaks, unusual noises or smells? Reply NONE, YES + details, or UNSURE.')
 expect(text.length).toBeLessThan(600)
})
it('explicit uncertainty is not summarized as no leaks',()=>{
 const text=homeCheckResultsSms({...resultInput,answers:{...resultInput.answers,warningSigns:null,observationsConfirmed:true}})
 expect(text).toContain('You are unsure')
 expect(text).not.toContain('no leaks')
 expect(text).toContain('Reply OK')
})

it('after NONE, acknowledges only the change and next action instead of repeating Results',()=>{
 const text=homeCheckObservationAcknowledgement(resultInput.answers,false,true)
 expect(text).toContain('No leaks, unusual noises or smells noticed')
 expect(text).toContain('Reply OK to confirm the results above')
 expect(text).toContain('photo flag still needs review')
 expect(text).not.toMatch(/Results:|Whirlpool|ICP|years|Saved/)
 expect(text.length).toBeLessThan(170)
})
it('a short acknowledgement cannot invite confirmation during pending analysis',()=>{
 const text=homeCheckObservationAcknowledgement(resultInput.answers,true,false)
 expect(text).toContain('not confirmed')
 expect(text).not.toContain('Reply OK')
})

it('the final receipt plainly says what is saved and what to review next',()=>{
 const text=homeCheckConfirmationSms('Maintenance test house · 100 Disposable Test Lane · Newark, NJ','TPR discharge line concern')
 expect(text).toBe('Your Home Check records are saved for 100 Disposable Test Lane, Newark, NJ. Next: review a possible water-heater piping concern in Property Intelligence.')
 expect(text).not.toMatch(/flag|authorized|estimates|Maintenance test house/)
})
it('a receipt without a warning does not invent a follow-up task',()=>{
 expect(homeCheckConfirmationSms('100 Disposable Test Lane',null)).toBe('Your Home Check records are saved for 100 Disposable Test Lane. View them in Property Intelligence.')
})


it('separates unknown water-heater age from estimated heating-component age and expands ICP',()=>{
 const asset=(system:string,make:string,age:number|null)=>({system,fields:{make:{value:make},approximateAge:{value:age},model:{value:'model'},serial:{value:'serial'}}});
 const text=homeCheckResultsSms({...resultInput,warning:null,assets:[asset('water_heater','Whirlpool',null),asset('heating','ICP',13)] as never});
 expect(text).toContain('Water heater: Whirlpool.\nAge unknown.');
 expect(text).toContain('Heating system: International Comfort Products.\nabout 13 years old.');
 expect(text).not.toMatch(/\bICP\b|HVAC component|photographed component only/);
});

it('tenant photo requests use the next requested view when capture resumes',()=>{
 const text=homeCheckCaptureSms({role:'tenant',location:'Test property, Unit 1',company:'Test',reference:'HC-TEST',nextPhoto:'heating_whole'});
 expect(text).toContain('Please send one clear photo of the whole furnace or boiler.');
 expect(text).not.toContain('water heater label');
});

it('uses a known manufacture year and attributes vendor observations without generic warnings',()=>{
 const fields={make:{value:'Craftmaster'},approximateAge:{value:null},model:{value:'model'},serial:{value:null}};
 const text=homeCheckResultsSms({...resultInput,warning:null,observerRole:'contractor',now:new Date('2026-11-02T12:00:00Z'),assets:[{system:'water_heater',manufactureDate:{year:2009,month:null},fields}] as never});
 expect(text).toContain('Made 2009; about 17 years old.');
 expect(text).toContain('The vendor reported no leaks');
 expect(text).not.toMatch(/You noticed|unverified|No repairs authorized/);
});

it('keeps the landlord observation acknowledgement concise for each answer',()=>{
 for(const warningSigns of [false,true,null]){
  const text=homeCheckObservationAcknowledgement({...resultInput.answers,warningSigns},false,false);
  expect(text).not.toMatch(/no repairs/i);
  expect(text).toContain('Reply OK to confirm the results above.');
 }
 expect(homeCheckObservationAcknowledgement({...resultInput.answers,warningSigns:false},false,false)).toBe('Thanks. No leaks, unusual noises or smells noticed. Reply OK to confirm the results above.');
});

it('discloses serial-derived ages without claiming a separately printed date',()=>{
 const fields={make:{value:'Lennox'},model:{value:'ML193UH'},approximateAge:{value:15,basis:'Estimated from the Lennox serial number 5811D05533: April 2011.'}};
 const text=homeCheckResultsSms({...resultInput,warning:null,now:new Date('2026-11-06'),assets:[{system:'heating',manufactureDate:{year:2011,month:4},fields}] as never});
 expect(text).toContain('Estimated age: about 15 years, based on the serial number.');
 expect(text).not.toContain('Made April 2011');
});
