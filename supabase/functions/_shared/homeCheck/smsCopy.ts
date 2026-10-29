import type { HomeCheckRole } from "../../../../shared/homeCheck.ts";

export const HOME_CHECK_VENDOR_SCOPE =
  "take photos of the water heater and furnace/boiler and flag visible leaks or damage";

/** Capture instructions belong to the person doing the check, not its requester. */
export function homeCheckCaptureSms(input: {
  role: HomeCheckRole;
  location: string;
  company: string;
  link: string;
}) {
  const heading = input.role === "contractor"
    ? `Home Check visit for ${input.location}.`
    : input.role === "tenant"
    ? `Ulo for ${input.company}: a quick equipment photo check at ${input.location}.`
    : `Your Home Check for ${input.location}.`;
  return [
    heading,
    "Please take 4 photos: the label and a full view of the water heater, then the label and a full view of the furnace or boiler.",
    "Visual check only. Do not open covers or touch equipment. No repairs are authorized.",
    "Open the link for guided steps and upload your photos there:",
    input.link,
  ].join("\n\n");
}
