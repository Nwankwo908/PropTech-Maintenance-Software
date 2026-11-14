export type ExternalVendorComplianceSubject={name:string;phone?:string|null;website?:string|null;tradeLabel?:string|null;priceLabel?:string|null;sources?:string[]}
export const calls:unknown[]=[]
export function lookupExternalVendorCompliance(subject:unknown){calls.push({action:'lookup',subject});return {license:{simulated:true},coi:{simulated:true}}}
export function attestExternalLicenseNumber(input:unknown){calls.push({action:'license',input});return {simulated:true}}
export function attestExternalCoiOnFile(input:unknown){calls.push({action:'coi',input});return {simulated:true}}
