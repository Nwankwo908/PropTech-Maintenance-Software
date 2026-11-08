/** Remove explicit hazard denials without suppressing a separate positive hazard. */
export function maintenanceEvidence(text: string): string {
  return text.replace(/[’]/g, "'")
    .replace(/\bleeking\b/gi, "leaking")
    .replace(/\bwatr\b/gi, "water")
    .replace(/\breal\s+bad\b/gi, "really bad")
    .replace(/\bwater\s+(?:is\s+)?still\s+everywhere\b/gi, "water everywhere")
    .replace(
      /\b(?:no|without)\s+(?:gas\s+(?:smell|leak)|(?:smell\s+of\s+)?gas|fire|smoke)\b(?:\s+(?:or|and)\s+(?:fire|smoke|gas))*/gi,
      " ",
    )
    .replace(
      /\b(?:do\s+not|don't|doesn't|cannot|can't)\s+(?:smell|see)\s+(?:any\s+)?(?:gas|fire|smoke)\b(?:\s+(?:or|and)\s+(?:fire|smoke|gas))*/gi,
      " ",
    )
    .replace(
      /\b(?:kitchen|bathroom|apartment|hallway)\b[^.!?]{0,60}\b(?:indoor\s+swimming\s+pool|under\s+water)\b/gi,
      "$& flooding",
    );
}
