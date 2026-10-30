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
  warning: string | null; pendingSystems: string[];
}) {
  const answered = input.answers.warningSigns != null || input.answers.observationsConfirmed === true;
  const place = input.location.split(' · ');
  const location = place.length > 1 ? place.slice(1).join(', ') : input.location;
  const describe = (system: 'water_heater' | 'heating', title: string) => {
    if (input.pendingSystems.includes(system)) return `${title}: analysis pending.`;
    const fields = input.assets.find(asset => asset.system === system)?.fields;
    const age = fields?.approximateAge.value;
    const make = String(fields?.make.value || 'make unknown').replace('International Comfort Products', 'ICP');
    return `${title}: ${make}, ${age == null ? 'age unknown' : `about ${age} years`}.`;
  };
  const warning = !input.warning ? '' : /TPR|relief.valve|discharge line/i.test(input.warning)
    ? 'Photo flag: possible relief-valve piping issue.'
    : /pan/i.test(input.warning) ? 'Photo flag: drain pan may be missing.'
    : 'Photo flag: possible equipment issue.';
  const unknown = !input.pendingSystems.length && input.assets.some(asset => !asset.fields.serial.value || !asset.fields.model.value);
  return [
    `Results: ${location}`,
    describe('water_heater', 'Water heater'), describe('heating', 'HVAC component'),
    input.answers.warningSigns === true ? `You noticed: ${input.answers.warningDetails || 'warning signs'}.`
      : input.answers.warningSigns === false ? 'You noticed no leaks, unusual noises or smells.'
      : answered ? 'Leaks, noises or smells: you are unsure.' : '',
    unknown ? 'Some label details remain unverified.' : '', warning,
    warning ? 'Review the photo in Property Intelligence.' : unknown ? 'Review label details in Property Intelligence.' : '',
    input.answers.warningSigns ? 'If you smell gas, see smoke or feel unsafe, leave and contact emergency services or your utility.' : '',
    !answered ? HOME_CHECK_OBSERVATION_PROMPT
      : input.pendingSystems.length ? 'Not confirmed; photo analysis must finish first.'
      : 'Reply OK to confirm these records. No repairs authorized.',
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
    'No repairs authorized.',
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
