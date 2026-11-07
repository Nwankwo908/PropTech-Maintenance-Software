import { homeCheckEquipment } from '../../../../shared/homeCheckEquipment.ts'
import { homeCheckCaptureSms, type HomeCheckAsset, type HomeCheckAnswers } from "../../../../shared/homeCheck.ts";

export { homeCheckCaptureSms };

export const HOME_CHECK_VENDOR_SCOPE =
  "take photos of the water heater and furnace/boiler and flag visible leaks or damage";

/** Keep identifiers internal; observations stay in the selected conversation. */
export const HOME_CHECK_OBSERVATION_PROMPT = 'Any leaks, unusual noises or smells? Reply NONE, YES + details, or UNSURE.';
export function homeCheckObservationQuestion() {
  return `All four photos are in. ${HOME_CHECK_OBSERVATION_PROMPT}`;
}

export function homeCheckResultsSms(input: {
  location: string; assets: HomeCheckAsset[]; answers: HomeCheckAnswers;
  warning: string | null; pendingSystems: string[]; observerRole?: 'landlord' | 'tenant' | 'contractor'; now?: Date;
}) {
  const answered = input.answers.warningSigns != null || input.answers.observationsConfirmed === true;
  const place = input.location.split(' · ');
  const location = place.length > 1 ? place.slice(1).join(', ') : input.location;
  const describe = (system: 'water_heater' | 'heating', title: string) => {
    if (input.pendingSystems.includes(system)) return `${title}: analysis pending.`;
    const asset = input.assets.find(asset => asset.system === system);
    const fields = asset?.fields;
    const facts = asset ? homeCheckEquipment(asset, input.now) : null;
    const make = String(fields?.make.value || 'manufacturer unknown').replace(/^ICP$/i, 'International Comfort Products');
    const ageText = facts?.age == null ? 'Age unknown.' : `about ${facts.age} years old.`;
    return `\n${facts?.label ?? title}: ${make}.\n${facts?.serialEstimated ? (facts.age == null ? 'Age unknown.' : `Estimated age: about ${facts.age} years, based on the serial number.`) : facts?.made ? `Made ${facts.made}; ${ageText}` : ageText}`;
  };
  const warning = !input.warning ? '' : /TPR|relief.valve|discharge line/i.test(input.warning)
    ? 'Photo flag: possible relief-valve piping issue.'
    : /pan/i.test(input.warning) ? 'Photo flag: drain pan may be missing.'
    : 'Photo flag: possible equipment issue.';
  const subject = input.observerRole === 'contractor' ? 'The vendor reported' : input.observerRole === 'tenant' ? 'The tenant reported' : 'You noticed';
  return [
    `Results: ${location}`,
    describe('water_heater', 'Water heater'), describe('heating', 'Heating system'),
    input.answers.warningSigns === true ? `${subject}: ${input.answers.warningDetails || 'warning signs'}.`
      : input.answers.warningSigns === false ? `${subject} no leaks, unusual noises or smells.`
      : answered ? `${input.observerRole === 'contractor' ? 'The vendor is' : input.observerRole === 'tenant' ? 'The tenant is' : 'You are'} unsure about leaks, noises or smells.` : '',
    warning,
    warning ? 'Review the photo concern in Property Intelligence tab.' : '',
    input.answers.warningSigns ? 'If you smell gas, see smoke or feel unsafe, leave and contact emergency services or your utility.' : '',
    !answered ? HOME_CHECK_OBSERVATION_PROMPT
      : input.pendingSystems.length ? 'Not confirmed; photo analysis must finish first.'
      : 'Reply OK to confirm these records.',
  ].filter(Boolean).join('\n');
}

/** A reply to the observation question should not resend the Results preview. */
export function homeCheckObservationAcknowledgement(answers: HomeCheckAnswers, pending: boolean, hasPhotoWarning: boolean) {
  const noted = answers.warningSigns === false
    ? 'Thanks. No leaks, unusual noises or smells noticed.'
    : answers.warningSigns === true ? 'Thanks. Your reported issue is noted for review.'
    : 'Thanks. Your observations will stay marked unsure.';
  return [noted,
    pending ? 'Photo analysis is pending; results are not confirmed.' : 'Reply OK to confirm the results above.',
    hasPhotoWarning ? 'The photo flag still needs review.' : '',
    answers.warningSigns ? 'If you smell gas, see smoke or feel unsafe, leave and contact emergency services or your utility.' : '',
  ].filter(Boolean).join(' ');
}

export function homeCheckConfirmationSms(location: string, warning: string | null) {
  const parts = location.split(' · ');
  const address = parts.length > 1 ? parts.slice(1).join(', ') : location;
  const next = !warning ? 'View them in Property Intelligence.'
    : /TPR|relief.valve|discharge line/i.test(warning)
    ? 'Next: review a possible water-heater piping concern in Property Intelligence.'
    : /pan/i.test(warning) ? 'Next: review a possibly missing water-heater drain pan in Property Intelligence.'
    : 'Next: review the possible concern in your photos in Property Intelligence.';
  return `Your Home Check records are saved for ${address}. ${next}`;
}
