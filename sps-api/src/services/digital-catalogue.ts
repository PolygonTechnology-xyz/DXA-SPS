// Bangladesh e-government platforms the TO-BE may build on. The TO-BE names systems only
// from this list (or proposes "a new module on <portal>"), so "how it is digitalized" is
// realistic. DRAFT — to be checked by someone who knows the current set-up; edit freely.

export interface Platform {
  name: string;
  what: string;          // what it does for a service
  how: string;           // how a service connects to it
  needs: string;         // what must be in place first
  owner: string;
}

export const DIGITAL_CATALOGUE: Platform[] = [
  { name: "myGov (mygov.bd)", what: "Unified citizen portal: online application forms, workflow, status tracking, SMS/email updates, digital certificate delivery.", how: "Service is built on the platform (form + workflow configuration).", needs: "Onboarding with a2i; office officials get platform accounts.", owner: "a2i (ICT Division)" },
  { name: "D-Nothi / e-Nothi", what: "Digital file management inside government offices: noting, approval, forwarding, archiving.", how: "Office uses it for the file; officials approve with their Nothi accounts.", needs: "Office onboarded to Nothi; trained officials.", owner: "a2i (ICT Division)" },
  { name: "Porichoy (porichoy.gov.bd)", what: "NID verification: checks a citizen's NID details (and photo) against Election Commission data.", how: "API call from the service's portal; paid per verification.", needs: "Agreement for Porichoy access; budget for per-check fees.", owner: "a2i / Election Commission data" },
  { name: "Election Commission NID server (partner service)", what: "Direct NID data verification and auto-fill.", how: "API access as an EC partner organisation.", needs: "MoU with the Election Commission.", owner: "Election Commission" },
  { name: "BDRIS (bdris.gov.bd)", what: "Birth and death registration; verifies birth/death registration numbers.", how: "Verification by registration number, or data-sharing API.", needs: "Data-sharing agreement with the Office of the Registrar General (LGD).", owner: "Office of the Registrar General, Birth & Death Registration" },
  { name: "ekPay", what: "Government payment gateway: fees and bills by card, MFS (bKash, Nagad, Rocket) or internet banking.", how: "Payment step integrated into the portal.", needs: "Merchant onboarding with ekPay.", owner: "a2i" },
  { name: "A-Challan (Automated Challan)", what: "Online payment of government fees/charges directly into the treasury against the right economic code.", how: "Portal links to A-Challan; payment verified by challan number.", needs: "Fee's economic code set up with Finance Division.", owner: "Finance Division" },
  { name: "iBAS++", what: "Government budget and accounting system; pays beneficiaries directly by EFT to bank or MFS accounts (G2P).", how: "Approved beneficiary list sent for payment; money goes straight to the account.", needs: "Beneficiary bank/MFS account details verified; office set up in iBAS++.", owner: "Finance Division" },
  { name: "BEFTN / EFT (Bangladesh Bank)", what: "Electronic fund transfer to any bank account.", how: "Through iBAS++ or the paying bank.", needs: "Applicant's bank account number and routing number.", owner: "Bangladesh Bank" },
  { name: "Mobile financial services (bKash, Nagad, Rocket)", what: "Payments to and from citizens' mobile wallets.", how: "Through ekPay (citizen pays) or iBAS++ G2P (government pays).", needs: "Applicant has a registered MFS account.", owner: "Banks / MFS providers" },
  { name: "SMS gateway (e.g. Teletalk bulk SMS / a2i SMS service)", what: "Automatic SMS: receipt, tracking number, defect notice, decision, payment.", how: "Portal or Nothi triggers SMS at each status change.", needs: "SMS gateway account and budget.", owner: "Teletalk / a2i" },
  { name: "GRS (grs.gov.bd)", what: "Grievance Redress System: online complaints and appeals with tracking.", how: "Link from the service and its decision notices; office's GRS focal point handles them.", needs: "Office GRS focal point and appellate officer named.", owner: "Cabinet Division" },
  { name: "333 national helpline", what: "Phone information and complaints about public services.", how: "Service information added to the 333 knowledge base.", needs: "Service information shared with the 333 team.", owner: "a2i" },
  { name: "Digital centres (UDC / PDC / CDC)", what: "Assisted service for citizens without digital skills or devices: application, upload, payment.", how: "Entrepreneurs apply on the citizen's behalf on the same portal.", needs: "Service listed for digital centres; entrepreneurs informed.", owner: "a2i / Local Government Division" },
  { name: "National Portal (bangladesh.gov.bd)", what: "Office websites: service information, citizen charter, forms, notices.", how: "Office updates its page on the portal.", needs: "Office web content manager.", owner: "a2i" },
  { name: "Digital signature (CCA-licensed certifying authorities)", what: "Legally valid electronic signature on certificates and approvals.", how: "Officials sign digitally in Nothi or the portal.", needs: "Officials' digital signature certificates.", owner: "Controller of Certifying Authorities (ICT Division)" },
  { name: "Interoperability / data exchange (Bangladesh National Digital Architecture)", what: "Agencies share verified data with each other instead of asking the citizen for papers.", how: "System-to-system API between the two offices.", needs: "Data-sharing agreement between the offices; API on the data owner's side.", owner: "ICT Division / BCC" },
  { name: "NBR e-TIN", what: "Tax identification number verification.", how: "TIN verification with NBR.", needs: "Agreement with NBR.", owner: "National Board of Revenue" },
];

/** The catalogue as a prompt block (stable text — part of the cached system prompt) */
export function catalogueBlock(): string {
  return `BANGLADESH DIGITAL PLATFORMS (use these to say HOW a step is digitalized; the Bangladesh system a step uses comes only from this list or the documents, otherwise "new module on <portal>"; foreign systems appear only as cited best-practice examples):
${DIGITAL_CATALOGUE.map((p) => `- ${p.name} — ${p.what} How: ${p.how} Needs: ${p.needs} Owner: ${p.owner}`).join("\n")}`;
}

/** Short names, for checking that a TO-BE step names a real platform */
export const PLATFORM_KEYWORDS = ["mygov", "nothi", "porichoy", "election commission", "nid", "bdris", "ekpay", "a-challan", "challan", "ibas", "beftn", "eft", "bkash", "nagad", "rocket", "mfs", "sms", "grs", "333", "udc", "digital centre", "digital center", "national portal", "digital signature", "e-signature", "interoperab", "api", "e-tin", "tin", "new module", "portal"];
