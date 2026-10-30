import {expect,it} from 'vitest'
import {homeCheckCaptureSms,homeCheckObservationQuestion,homeCheckResultsSms,homeCheckObservationAcknowledgement,homeCheckConfirmationSms} from './smsCopy.ts'
for(const role of ['landlord','tenant','contractor'] as const){
 it(`${role} capture uses a photo without codes or retired URLs`,()=>{
  const text=homeCheckCaptureSms({role,location:'Disposable Test Lane',company:'Test Account',reference:'HC-AABBCCDDEEFF'})
  expect(text).not.toContain('HC-AABBCCDDEEFF')
  expect(text).not.toContain('Reply with the photo here')
  expect(text).toContain('Please send One clear photo of the water heater label')
  expect(text).not.toMatch(/https?:|\/c\/|open the link/i)
  expect(text).not.toContain('No repairs are authorized')
  if (role === 'tenant') expect(text).toContain('where you live')
 })
}

it('observations ask for plain answers without a reference or pipe command',()=>{const text=homeCheckObservationQuestion();expect(text).toContain('Reply NONE, YES + details, or UNSURE');expect(text).not.toMatch(/HC-|ANSWERS|\|/);})

const resultInput = { location: '100 Disposable Test Lane', assets: [], answers: { warningSigns: false, warningDetails: '', lastService: '', lastFilterChange: '' }, warning: 'TPR valve discharge line loops upward', pendingSystems: [] }
it('Results addresses the recipient directly, explains the warning and remains unconfirmed',()=>{
 const text=homeCheckResultsSms(resultInput)
 expect(text).toMatch(/^Results: 100 Disposable Test Lane/)
 expect(text).toContain('You noticed no leaks')
 expect(text).toContain('possible relief-valve piping issue')
 expect(text).toContain('Review the photo in Property Intelligence.')
 expect(text).toContain('Reply OK')
 expect(text).not.toMatch(/needs landlord review|Saved|make unreadable|HC-/i)
})
it('pending analysis is distinguished from an unreadable label and cannot invite OK',()=>{
 const text=homeCheckResultsSms({...resultInput,pendingSystems:['heating']})
 expect(text).toContain('HVAC component: analysis pending')
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
 expect(text).toContain('you are unsure')
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
